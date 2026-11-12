import { useState } from 'react';
import { Check, Crown, Link2, Pencil, Play, UserPlus } from 'lucide-react';
import Avatar from '../characters/Avatar';
import { CHARACTERS, type CharacterId } from '../characters/list';
import Chat from './Chat';
import RoomHeader, { copyInvite } from './RoomHeader';
import { Modal } from './common';
import { CharacterPicker } from './ProfileForm';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { loadProfile, saveProfile } from '../lib/profile';
import { findMe, useRoom } from '../store/roomStore';
import { toast } from '../store/toastStore';
import type { Settings } from '../types';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;

const SETTING_ROWS: {
  key: keyof Settings;
  label: string;
  emoji: string;
  options: { v: Settings[keyof Settings]; label: string }[];
}[] = [
  { key: 'draw_time', label: '제한시간', emoji: '⏱️', options: [60, 90, 120].map((v) => ({ v: v as 60, label: `${v}초` })) },
  { key: 'total_rounds', label: '라운드', emoji: '🔁', options: [2, 3, 5].map((v) => ({ v: v as 2, label: `${v}라운드` })) },
  {
    key: 'difficulty',
    label: '난이도',
    emoji: '🎯',
    options: [
      { v: 'easy', label: '쉬움' },
      { v: 'normal', label: '보통' },
      { v: 'hard', label: '어려움' },
      { v: 'random', label: '랜덤' },
    ],
  },
  {
    key: 'hints_enabled',
    label: '힌트',
    emoji: '💡',
    options: [
      { v: true, label: 'ON' },
      { v: false, label: 'OFF' },
    ],
  },
];

export default function Lobby() {
  const state = useRoom((s) => s.state)!;
  const online = useRoom((s) => s.online);
  const realtimeOk = useRoom((s) => s.realtimeOk);
  const me = findMe(state)!;
  const isHost = state.room.host_player_id === state.me;
  const players = state.players;
  const [busy, setBusy] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);

  const others = players.filter((p) => p.id !== state.me);
  const notReady = others.filter((p) => !p.is_ready).length;
  const enough = players.length >= MIN_PLAYERS;
  const canStart = isHost && enough && notReady === 0;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const changeSetting = (key: keyof Settings, v: Settings[keyof Settings]) => {
    if (!isHost || state.room.settings[key] === v) return;
    void run(() => api.updateSettings(state.room.id, { [key]: v }));
  };

  const pickCharacter = (c: CharacterId) => {
    setPickOpen(false);
    const p = loadProfile();
    saveProfile({ nickname: p?.nickname ?? me.nickname, character: c });
    void run(() => api.setCharacter(state.room.id, c));
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-4 px-3 py-4 sm:px-5">
      <RoomHeader />

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          {/* 참가자 */}
          <section className="card animate-slide-up p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-2xl">
                친구들 <span className="text-bubble">{players.length}</span>
                <span className="text-ink/40"> / {MAX_PLAYERS}</span>
              </h2>
              <button className="btn btn-sky !py-2 !text-base" onClick={() => copyInvite(state.room.code)}>
                <Link2 size={18} /> 초대 링크 복사
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-5">
              {players.map((p, i) => {
                const isMe = p.id === state.me;
                const isOnline = !realtimeOk || online.size === 0 || online.has(p.id);
                return (
                  <div
                    key={p.id}
                    className={`animate-pop-in relative flex flex-col items-center rounded-3xl px-2 pb-3 pt-4 transition ${
                      p.is_ready || p.is_host ? 'bg-mint/35' : 'bg-cream'
                    } ${isMe ? 'ring-[3px] ring-bubble/60' : ''}`}
                    style={{ animationDelay: `${i * 0.04}s` }}
                  >
                    {p.is_host && (
                      <Crown size={26} className="absolute -top-3 left-1/2 -translate-x-1/2 fill-butter text-[#E0A800] drop-shadow" />
                    )}
                    <span
                      className={`absolute right-2.5 top-2.5 h-3 w-3 rounded-full ring-2 ring-white ${isOnline ? 'bg-mint-dark' : 'bg-ink/25'}`}
                      title={isOnline ? '접속 중' : '연결 끊김'}
                    />
                    <button
                      type="button"
                      disabled={!isMe}
                      onClick={() => setPickOpen(true)}
                      className={`relative ${isMe ? 'group cursor-pointer' : 'cursor-default'}`}
                      aria-label={isMe ? '캐릭터 바꾸기' : CHARACTERS[p.character].name}
                    >
                      <Avatar id={p.character} size={68} happy={p.is_ready || p.is_host} className={p.is_ready ? 'animate-bounce-soft' : ''} />
                      {isMe && (
                        <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-white text-ink shadow ring-2 ring-ink/10 transition group-hover:scale-110">
                          <Pencil size={12} />
                        </span>
                      )}
                    </button>
                    <p className="mt-1.5 max-w-full truncate font-display text-[17px]">
                      {p.nickname}
                      {isMe && <span className="ml-1 text-xs text-bubble">(나)</span>}
                    </p>
                    <span
                      className={`mt-1 rounded-full px-2.5 py-0.5 font-display text-xs ${
                        p.is_host ? 'bg-butter text-ink' : p.is_ready ? 'bg-mint-dark text-white' : 'bg-white text-ink/50'
                      }`}
                    >
                      {p.is_host ? '방장' : p.is_ready ? '준비 완료!' : '준비 중…'}
                    </span>
                  </div>
                );
              })}
              {Array.from({ length: Math.max(0, MAX_PLAYERS - players.length) }).map((_, i) => (
                <button
                  key={`empty-${i}`}
                  onClick={() => copyInvite(state.room.code)}
                  className="flex min-h-[148px] flex-col items-center justify-center gap-1 rounded-3xl border-[3px] border-dashed border-ink/10 text-ink/30 transition hover:border-bubble/40 hover:text-bubble"
                >
                  <UserPlus size={26} />
                  <span className="font-display text-sm">초대하기</span>
                </button>
              ))}
            </div>
          </section>

          {/* 설정 */}
          <section className="card animate-slide-up p-4 sm:p-5" style={{ animationDelay: '0.06s' }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-2xl">게임 설정</h2>
              {!isHost && <span className="chip bg-cream text-ink/60">방장만 바꿀 수 있어요</span>}
            </div>
            <div className="flex flex-col gap-2.5">
              {SETTING_ROWS.map((row) => (
                <div key={row.key} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                  <span className="w-24 shrink-0 font-display text-[17px]">
                    {row.emoji} {row.label}
                  </span>
                  <div className="flex flex-1 flex-wrap gap-1.5 rounded-2xl bg-cream p-1">
                    {row.options.map((o) => {
                      const active = state.room.settings[row.key] === o.v;
                      return (
                        <button
                          key={String(o.v)}
                          type="button"
                          disabled={!isHost || busy}
                          onClick={() => changeSetting(row.key, o.v)}
                          className={`min-w-16 flex-1 rounded-xl px-3 py-2 font-display transition ${
                            active
                              ? 'bg-white text-bubble-dark shadow-[0_3px_0_0_rgba(255,127,168,0.4)] ring-2 ring-bubble/50'
                              : isHost
                                ? 'text-ink/50 hover:bg-white/70 hover:text-ink'
                                : 'text-ink/35'
                          } disabled:cursor-default`}
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-2 text-sm text-ink/55">
                <span className="w-24 shrink-0 font-display text-[17px] text-ink">🏅 점수</span>
                정답 100~500점(빠를수록↑) · 첫 정답 +100 · 출제자 정답자당 +50
              </div>
            </div>
          </section>

          {/* 시작 / 준비 */}
          <section className="card animate-slide-up flex flex-col items-center gap-2 p-4 sm:flex-row sm:justify-between" style={{ animationDelay: '0.12s' }}>
            <p className="text-center font-display text-ink/70 sm:text-left">
              {!enough
                ? `🙌 ${MIN_PLAYERS - players.length}명이 더 모이면 시작할 수 있어요 (최소 ${MIN_PLAYERS}명)`
                : notReady > 0
                  ? `⏳ ${notReady}명이 아직 준비 중이에요`
                  : isHost
                    ? '🎉 모두 준비됐어요! 게임을 시작해 볼까요?'
                    : '🎉 모두 준비 완료! 방장이 곧 시작해요'}
            </p>
            {isHost ? (
              <button
                className="btn btn-primary w-full px-8 py-4 text-xl sm:w-auto"
                disabled={!canStart || busy}
                onClick={() => run(() => api.startGame(state.room.id))}
              >
                <Play size={22} className="fill-white" /> 게임 시작!
              </button>
            ) : (
              <button
                className={`btn w-full px-8 py-4 text-xl sm:w-auto ${me.is_ready ? 'btn-white' : 'btn-mint'}`}
                disabled={busy}
                onClick={() => run(() => api.setReady(state.room.id, !me.is_ready))}
              >
                {me.is_ready ? '준비 취소' : (<><Check size={22} /> 준비 완료!</>)}
              </button>
            )}
          </section>
        </div>

        <Chat className="h-[380px] lg:h-auto lg:max-h-[calc(100dvh-110px)]" />
      </div>

      <Modal open={pickOpen} onClose={() => setPickOpen(false)} title="캐릭터 바꾸기">
        <CharacterPicker value={me.character} onChange={pickCharacter} />
      </Modal>
    </div>
  );
}
