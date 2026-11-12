// =====================================================================
// 낙서팡팡 게임 서버 (Supabase Edge Function)
//  1. Authorization 헤더의 사용자 JWT(익명 로그인 세션)를 Auth 서버로 검증
//  2. 입력값 형식 검증
//  3. service_role 로 game_* SQL 함수 호출 → 정답 판정 / 점수 / 턴 전환을 DB 트랜잭션 안에서 원자적으로 처리
// service_role 키는 이 함수 런타임에만 존재하며 브라우저로 절대 전달되지 않습니다.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

class BadInput extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Body = Record<string, unknown>;

const str = (v: unknown, max: number): string => {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw new BadInput();
  return v;
};
const uuid = (v: unknown): string => {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new BadInput();
  return v;
};
const int = (v: unknown, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new BadInput();
  return v;
};
const bool = (v: unknown): boolean => {
  if (typeof v !== 'boolean') throw new BadInput();
  return v;
};

type Call = { fn: string; args: Record<string, unknown> };
const ACTIONS: Record<string, (uid: string, b: Body) => Call> = {
  create_room: (uid, b) => ({
    fn: 'game_create_room',
    args: { p_uid: uid, p_nickname: str(b.nickname, 40), p_character: str(b.character, 20) },
  }),
  join_room: (uid, b) => ({
    fn: 'game_join_room',
    args: {
      p_uid: uid,
      p_code: str(b.code, 10),
      p_nickname: str(b.nickname, 40),
      p_character: str(b.character, 20),
    },
  }),
  leave_room: (uid, b) => ({ fn: 'game_leave_room', args: { p_uid: uid, p_room: uuid(b.roomId) } }),
  set_ready: (uid, b) => ({
    fn: 'game_set_ready',
    args: { p_uid: uid, p_room: uuid(b.roomId), p_ready: bool(b.ready) },
  }),
  set_character: (uid, b) => ({
    fn: 'game_set_character',
    args: { p_uid: uid, p_room: uuid(b.roomId), p_character: str(b.character, 20) },
  }),
  update_settings: (uid, b) => {
    const s = (b.settings ?? {}) as Body;
    const settings: Body = {};
    if (s.draw_time !== undefined) settings.draw_time = int(s.draw_time, 1, 1000);
    if (s.total_rounds !== undefined) settings.total_rounds = int(s.total_rounds, 1, 100);
    if (s.difficulty !== undefined) settings.difficulty = str(s.difficulty, 10);
    if (s.hints_enabled !== undefined) settings.hints_enabled = bool(s.hints_enabled);
    return { fn: 'game_update_settings', args: { p_uid: uid, p_room: uuid(b.roomId), p_settings: settings } };
  },
  start_game: (uid, b) => ({ fn: 'game_start', args: { p_uid: uid, p_room: uuid(b.roomId) } }),
  return_lobby: (uid, b) => ({ fn: 'game_return_lobby', args: { p_uid: uid, p_room: uuid(b.roomId) } }),
  choose_word: (uid, b) => ({
    fn: 'game_choose_word',
    args: { p_uid: uid, p_room: uuid(b.roomId), p_turn: uuid(b.turnId), p_index: int(b.index, 0, 2) },
  }),
  change_word: (uid, b) => ({
    fn: 'game_change_word',
    args: { p_uid: uid, p_room: uuid(b.roomId), p_turn: uuid(b.turnId) },
  }),
  skip_turn: (uid, b) => ({
    fn: 'game_skip_turn',
    args: { p_uid: uid, p_room: uuid(b.roomId), p_turn: uuid(b.turnId) },
  }),
  send_message: (uid, b) => ({
    fn: 'game_submit_message',
    args: { p_uid: uid, p_room: uuid(b.roomId), p_text: str(b.text, 200) },
  }),
  tick: (uid, b) => ({ fn: 'game_tick', args: { p_uid: uid, p_room: uuid(b.roomId) } }),
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  if (!SERVICE_KEY) return json({ error: 'SERVER_MISCONFIGURED' }, 500);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'UNAUTHORIZED' }, 401);

  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) return json({ error: 'UNAUTHORIZED' }, 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'INVALID_INPUT' }, 400);
  }

  const handler = typeof body.action === 'string' ? ACTIONS[body.action] : undefined;
  if (!handler) return json({ error: 'UNKNOWN_ACTION' }, 400);

  let call: Call;
  try {
    call = handler(auth.user.id, body);
  } catch (e) {
    if (e instanceof BadInput) return json({ error: 'INVALID_INPUT' }, 400);
    throw e;
  }

  const { data, error } = await admin.rpc(call.fn, call.args);
  if (error) {
    // 게임 규칙 위반(예: ROOM_FULL)은 200 + error 코드로 응답 → 클라이언트가 한국어로 안내
    if (/^[A-Z_]+$/.test(error.message)) return json({ error: error.message });
    console.error(call.fn, error);
    return json({ error: 'SERVER_ERROR' }, 500);
  }
  return json({ data });
});
