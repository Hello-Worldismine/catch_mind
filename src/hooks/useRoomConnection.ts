import { useCallback, useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { ensureSession, supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { GameError, errorText } from '../lib/errors';
import { loadProfile, saveProfile, type Profile } from '../lib/profile';
import { serverNow, useRoom } from '../store/roomStore';
import type { ChatMessage, StateResponse } from '../types';

/**
 * 방 하나에 대한 실시간 연결을 관리합니다.
 *  - get_room_state RPC 로 권위 있는 상태를 조회 (서버 시각으로 시계 보정)
 *  - Postgres Changes: rooms(version 증가) → 상태 재조회, messages INSERT → 채팅 추가
 *  - Presence(private channel): 온라인 표시
 *  - heartbeat 10초, 마감 시각 tick, 15초 안전 폴링, 탭 복귀/네트워크 복구 시 재동기화
 */
export function useRoomConnection(code: string) {
  const roomIdRef = useRef<string | null>(null);
  const meRef = useRef<string | null>(null);
  const inflight = useRef(false);
  const pending = useRef(false);
  const debounce = useRef<number | null>(null);
  const joinAttempted = useRef(false);
  const alive = useRef(true);
  const channelsRef = useRef<RealtimeChannel[]>([]);

  const loadMessages = useCallback(async (roomId: string) => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('room_id', roomId)
      .order('id', { ascending: false })
      .limit(80);
    if (data && alive.current) useRoom.getState().addMessages((data as ChatMessage[]).reverse());
  }, []);

  const subscribe = useCallback(
    (roomId: string, playerId: string) => {
      for (const ch of channelsRef.current) void supabase.removeChannel(ch);
      const store = useRoom.getState();

      const db = supabase
        .channel(`db:${roomId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, () =>
          refetchRef.current(),
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
          (payload) => useRoom.getState().addMessages([payload.new as ChatMessage]),
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            store.setRealtimeOk(true);
            refetchRef.current();
            void loadMessages(roomId);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            store.setRealtimeOk(false);
          }
        });

      const presence = supabase.channel(`room:${roomId}`, {
        config: { private: true, presence: { key: playerId } },
      });
      presence
        .on('presence', { event: 'sync' }, () => {
          const ids = new Set(Object.keys(presence.presenceState()));
          useRoom.getState().setOnline(ids);
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') await presence.track({ at: Date.now() });
        });

      channelsRef.current = [db, presence];
    },
    [loadMessages],
  );

  const fetchState = useCallback(async () => {
    await ensureSession();
    const t0 = Date.now();
    const { data, error } = await supabase.rpc('get_room_state', { p_code: code });
    const t1 = Date.now();
    if (!alive.current) return;
    if (error) throw new GameError('NETWORK');
    const res = data as StateResponse;
    const store = useRoom.getState();

    if (res.membership !== 'active') {
      if (res.error === 'ROOM_NOT_FOUND') return store.setStatus('not_found');
      if (res.room?.status === 'CLOSED') return store.setStatus('closed');
      if (['full', 'joining', 'need_profile'].includes(store.status)) return;
      const profile = loadProfile();
      // 새로고침 / 연결 끊김 후 복귀 / 이전에 플레이한 적 있음 → 저장된 프로필로 자동 (재)입장
      if (profile && (res.membership === 'left' || !joinAttempted.current)) {
        joinAttempted.current = true;
        await joinRef.current(profile);
        return;
      }
      return store.setStatus('need_profile');
    }

    const offset = Date.parse(res.server_now) - (t0 + t1) / 2;
    if (roomIdRef.current !== res.room.id || meRef.current !== res.me) {
      roomIdRef.current = res.room.id;
      meRef.current = res.me;
      subscribe(res.room.id, res.me);
      void loadMessages(res.room.id);
    }
    store.setState(res, offset);
  }, [code, subscribe, loadMessages]);

  const refetch = useCallback(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(async () => {
      if (inflight.current) {
        pending.current = true;
        return;
      }
      inflight.current = true;
      try {
        await fetchState();
      } catch (e) {
        if (!useRoom.getState().state) useRoom.getState().setStatus('error', errorText(e));
      } finally {
        inflight.current = false;
        if (pending.current) {
          pending.current = false;
          refetchRef.current();
        }
      }
    }, 60);
  }, [fetchState]);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  const join = useCallback(
    async (profile: Profile) => {
      const store = useRoom.getState();
      store.setStatus('joining');
      try {
        saveProfile(profile);
        await api.joinRoom(code, profile.nickname, profile.character);
        joinAttempted.current = true;
        await fetchState();
      } catch (e) {
        const c = e instanceof GameError ? e.code : '';
        if (c === 'ROOM_FULL') store.setStatus('full');
        else if (c === 'ROOM_NOT_FOUND') store.setStatus('not_found');
        else if (c === 'ROOM_CLOSED') store.setStatus('closed');
        else store.setStatus('need_profile', errorText(e));
      }
    },
    [code, fetchState],
  );
  const joinRef = useRef(join);
  joinRef.current = join;

  // 최초 로드 & 정리
  useEffect(() => {
    alive.current = true;
    useRoom.getState().reset();
    joinAttempted.current = false;
    roomIdRef.current = null;
    meRef.current = null;
    fetchState().catch((e) => useRoom.getState().setStatus('error', errorText(e)));
    return () => {
      alive.current = false;
      for (const ch of channelsRef.current) void supabase.removeChannel(ch);
      channelsRef.current = [];
    };
  }, [fetchState]);

  // heartbeat + 안전 폴링 + 주기 tick (끊긴 참가자 정리)
  useEffect(() => {
    const hb = window.setInterval(async () => {
      const roomId = roomIdRef.current;
      if (!roomId) return;
      const { data } = await supabase.rpc('heartbeat', { p_room: roomId });
      if (data === false) refetchRef.current();
    }, 10_000);
    const poll = window.setInterval(() => refetchRef.current(), 15_000);
    const periodicTick = window.setInterval(
      () => {
        if (roomIdRef.current && useRoom.getState().status === 'ready') {
          api.tick(roomIdRef.current).catch(() => {});
        }
      },
      25_000 + Math.random() * 5_000,
    );
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetchRef.current();
    };
    const onOnline = () => refetchRef.current();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(hb);
      window.clearInterval(poll);
      window.clearInterval(periodicTick);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  // 서버 마감 시각에 맞춰 tick 요청 (서버가 시각을 검증 → 멱등)
  const state = useRoom((s) => s.state);
  const phaseEnds = state?.room.phase_ends_at;
  const version = state?.room.version;
  const isHost = state ? state.room.host_player_id === state.me : false;
  const isDrawer = state?.turn ? state.turn.drawer_id === state.me : false;
  useEffect(() => {
    if (!phaseEnds || !roomIdRef.current) return;
    const roomId = roomIdRef.current;
    const lead = isHost || isDrawer ? 250 : 1500 + Math.random() * 1500;
    const wait = Math.max(0, Date.parse(phaseEnds) - serverNow()) + lead;
    let retry: number | null = null;
    const fire = async () => {
      try {
        await api.tick(roomId);
      } catch {
        /* 다른 참가자가 처리 */
      }
      refetchRef.current();
      // 응답이 유실되어도 상태가 그대로면 한 번 더 시도
      retry = window.setTimeout(() => {
        const s = useRoom.getState().state;
        if (s && s.room.phase_ends_at === phaseEnds) void fire();
      }, 4000);
    };
    const t = window.setTimeout(fire, wait);
    return () => {
      window.clearTimeout(t);
      if (retry) window.clearTimeout(retry);
    };
  }, [phaseEnds, version, isHost, isDrawer]);

  // 힌트 공개 시각에 재조회
  const hintKey = state?.turn?.status === 'DRAWING' ? state.turn.hint_times.join(',') : '';
  useEffect(() => {
    if (!hintKey) return;
    const timers = hintKey.split(',').map((iso) => {
      const wait = Date.parse(iso) - serverNow() + 300;
      return wait > 0 ? window.setTimeout(() => refetchRef.current(), wait) : 0;
    });
    return () => timers.forEach((t) => t && window.clearTimeout(t));
  }, [hintKey]);

  return { join, refetch };
}
