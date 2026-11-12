import type { CharacterId } from './characters/list';

export type Phase = 'WAITING' | 'WORD_SELECT' | 'DRAWING' | 'ROUND_RESULT' | 'GAME_RESULT' | 'CLOSED';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'random';

export interface Settings {
  draw_time: 60 | 90 | 120;
  total_rounds: 2 | 3 | 5;
  difficulty: Difficulty;
  hints_enabled: boolean;
}

export interface Player {
  id: string;
  nickname: string;
  character: CharacterId;
  is_ready: boolean;
  score: number;
  join_order: number;
  is_host: boolean;
  has_drawn: boolean;
  solved: boolean;
}

export interface Guess {
  player_id: string;
  points: number;
  order: number;
}

export interface Turn {
  id: string;
  round: number;
  turn_no: number;
  drawer_id: string | null;
  status: 'WORD_SELECT' | 'DRAWING' | 'ROUND_RESULT' | 'DONE';
  word_length: number | null;
  pattern: string[] | null;
  select_ends_at: string | null;
  started_at: string | null;
  ends_at: string | null;
  ended_at: string | null;
  end_reason: 'all_guessed' | 'timeout' | 'skipped' | 'drawer_left' | 'game_aborted' | null;
  revealed_word: string | null;
  word_changed: boolean;
  hint_times: string[];
  my_word: string | null;
  candidates: { text: string; difficulty: Exclude<Difficulty, 'random'> }[] | null;
  can_change_word: boolean;
  guesses: Guess[];
  drawer_points: number;
}

export interface FinalResult {
  player_id: string;
  nickname: string;
  character: CharacterId;
  score: number;
  rank: number;
}

export interface Game {
  id: string;
  started_at: string;
  ended_at: string | null;
  final_results: FinalResult[] | null;
  turns_in_round: number;
}

export interface RoomInfo {
  id: string;
  code: string;
  status: Phase;
  host_player_id: string | null;
  settings: Settings;
  current_round: number;
  phase_ends_at: string | null;
  version: number;
}

export interface RoomState {
  membership: 'active';
  server_now: string;
  me: string;
  room: RoomInfo;
  players: Player[];
  turn: Turn | null;
  game: Game | null;
}

export interface NotMemberState {
  membership: 'none' | 'left';
  server_now: string;
  error?: string;
  room?: { id: string; code: string; status: Phase; player_count: number };
}

export type StateResponse = RoomState | NotMemberState;

export interface ChatMessage {
  id: number;
  room_id: string;
  turn_id: string | null;
  player_id: string | null;
  nickname: string | null;
  character: CharacterId | null;
  kind: 'chat' | 'system' | 'correct' | 'close';
  body: string;
  visibility: 'all' | 'solved' | 'private';
  target_player_id: string | null;
  created_at: string;
}
