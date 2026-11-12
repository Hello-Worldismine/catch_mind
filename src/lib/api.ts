import { ensureSession, supabase } from './supabase';
import { GameError } from './errors';
import type { Settings } from '../types';

/** 모든 게임 상태 변경은 Edge Function "game" 을 통해 서버에서 검증·처리됩니다. */
async function gameAction<T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  await ensureSession();
  const { data, error } = await supabase.functions.invoke('game', { body: { action, ...params } });
  if (error) {
    let code = 'NETWORK';
    try {
      const ctx = (error as { context?: Response }).context;
      const body = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
      if (body?.error) code = body.error;
    } catch {
      /* ignore */
    }
    throw new GameError(code);
  }
  if (data?.error) throw new GameError(data.error);
  return data?.data as T;
}

export interface JoinResult {
  code: string;
  room_id: string;
  player_id: string;
}

export const api = {
  createRoom: (nickname: string, character: string) =>
    gameAction<JoinResult>('create_room', { nickname, character }),
  joinRoom: (code: string, nickname: string, character: string) =>
    gameAction<JoinResult>('join_room', { code, nickname, character }),
  leaveRoom: (roomId: string) => gameAction('leave_room', { roomId }),
  setReady: (roomId: string, ready: boolean) => gameAction('set_ready', { roomId, ready }),
  setCharacter: (roomId: string, character: string) => gameAction('set_character', { roomId, character }),
  updateSettings: (roomId: string, settings: Partial<Settings>) =>
    gameAction('update_settings', { roomId, settings }),
  startGame: (roomId: string) => gameAction('start_game', { roomId }),
  returnLobby: (roomId: string) => gameAction('return_lobby', { roomId }),
  chooseWord: (roomId: string, turnId: string, index: number) =>
    gameAction('choose_word', { roomId, turnId, index }),
  changeWord: (roomId: string, turnId: string) => gameAction('change_word', { roomId, turnId }),
  skipTurn: (roomId: string, turnId: string) => gameAction('skip_turn', { roomId, turnId }),
  sendMessage: (roomId: string, text: string) =>
    gameAction<{ result: string; points?: number }>('send_message', { roomId, text }),
  tick: (roomId: string) => gameAction<{ status: string; version: number }>('tick', { roomId }),
};
