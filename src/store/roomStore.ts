import { create } from 'zustand';
import type { ChatMessage, RoomState } from '../types';

export type ConnStatus =
  | 'loading'
  | 'need_profile'
  | 'joining'
  | 'ready'
  | 'not_found'
  | 'closed'
  | 'full'
  | 'error';

interface RoomStore {
  status: ConnStatus;
  errorText: string | null;
  state: RoomState | null;
  /** 서버 시각 ≈ Date.now() + clockOffset */
  clockOffset: number;
  messages: ChatMessage[];
  online: Set<string>;
  realtimeOk: boolean;
  setStatus: (s: ConnStatus, errorText?: string | null) => void;
  setState: (s: RoomState, offset: number) => void;
  addMessages: (m: ChatMessage[]) => void;
  setOnline: (ids: Set<string>) => void;
  setRealtimeOk: (v: boolean) => void;
  reset: () => void;
}

export const useRoom = create<RoomStore>((set, get) => ({
  status: 'loading',
  errorText: null,
  state: null,
  clockOffset: 0,
  messages: [],
  online: new Set(),
  realtimeOk: false,
  setStatus: (status, errorText = null) => set({ status, errorText }),
  setState: (s, offset) => {
    const cur = get().state;
    // 순서가 뒤바뀐 응답(더 오래된 버전)은 무시
    if (cur && cur.room.id === s.room.id && s.room.version < cur.room.version) return;
    set({ state: s, clockOffset: offset, status: 'ready', errorText: null });
  },
  addMessages: (m) => {
    if (!m.length) return;
    const map = new Map(get().messages.map((x) => [x.id, x]));
    for (const x of m) map.set(x.id, x);
    const merged = [...map.values()].sort((a, b) => a.id - b.id).slice(-200);
    set({ messages: merged });
  },
  setOnline: (online) => set({ online }),
  setRealtimeOk: (realtimeOk) => set({ realtimeOk }),
  reset: () =>
    set({ status: 'loading', errorText: null, state: null, messages: [], online: new Set(), realtimeOk: false }),
}));

export const serverNow = () => Date.now() + useRoom.getState().clockOffset;

export const findMe = (s: RoomState | null) => s?.players.find((p) => p.id === s.me) ?? null;
