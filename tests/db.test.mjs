// =====================================================================
// DB 게임 로직 통합 테스트 (PGlite = WASM 으로 동작하는 실제 PostgreSQL)
//   - Supabase 의 auth / realtime 스키마를 최소한으로 흉내낸 뒤 실제 마이그레이션을 그대로 적용
//   - 4인 시나리오, 10인 정원, 중복 정답, 출제자/방장 이탈, 재접속, 타이머, RLS 를 검증
// 한계: PGlite 는 단일 커넥션이라 "진짜 동시" 요청은 재현 불가 → 동시성은 rooms FOR UPDATE 잠금에 의존
// 실행: npm run test:db
// =====================================================================
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite();

const STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create schema realtime;
create table realtime.messages (id bigserial primary key, topic text, extension text, payload jsonb, event text);
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $$
  select current_setting('realtime.topic', true) $$;
grant usage on schema realtime to authenticated;
create publication supabase_realtime;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

let passed = 0;
let failed = 0;
const ok = (cond, msg) => {
  if (cond) {
    passed++;
    console.log('  ✅', msg);
  } else {
    failed++;
    console.log('  ❌', msg);
  }
};
const section = (t) => console.log('\n▶', t);

async function q(sql, params = []) {
  return (await db.query(sql, params)).rows;
}
async function call(fn, ...args) {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await q(`select public.${fn}(${ph}) as r`, args);
  return rows[0].r;
}
async function callErr(fn, ...args) {
  try {
    await call(fn, ...args);
    return null;
  } catch (e) {
    return e.message;
  }
}
async function asUser(uid, fn) {
  await db.exec('set role authenticated');
  await q(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await q(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
const state = (uid, code) => asUser(uid, async () => (await q('select public.get_room_state($1) as s', [code]))[0].s);
async function expire(roomId) {
  await q(
    `update rooms set phase_ends_at = now() - interval '1 second' where id = $1;
     `,
    [roomId],
  );
  await q(
    `update turns set ends_at = now() - interval '1 second', started_at = now() - interval '91 seconds'
     where id = (select current_turn_id from rooms where id = $1) and status = 'DRAWING'`,
    [roomId],
  );
}
async function newUser() {
  const id = randomUUID();
  await q('insert into auth.users(id) values ($1)', [id]);
  return id;
}
const secretWord = async (turnId) => (await q('select word from turn_secrets where turn_id=$1', [turnId]))[0].word;

// ---------------------------------------------------------------------
await db.exec(STUB);
for (const f of readdirSync(join(root, 'supabase/migrations')).sort()) {
  await db.exec(readFileSync(join(root, 'supabase/migrations', f), 'utf8'));
}
console.log('마이그레이션 적용 완료');

section('제시어');
const wc = await q(`select difficulty, count(*)::int n from words group by 1 order by 1`);
const total = wc.reduce((a, r) => a + r.n, 0);
console.log('   ', wc.map((r) => `${r.difficulty}:${r.n}`).join(' '), 'total', total);
ok(total >= 300, `제시어 300개 이상 (${total})`);
ok(wc.length === 3 && wc.every((r) => r.n >= 80), '난이도 3종 모두 충분');

section('정답 정규화');
const norm = async (s) => (await q('select public.normalize_answer($1) n', [s]))[0].n;
ok((await norm('  놀이 공원!! ')) === '놀이공원', '공백·문장부호 제거');
ok((await norm('TV')) === 'tv', '대소문자 무시');
ok((await q(`select public._lev('놀이공원','놀이공언') d`))[0].d === 1, '편집거리 1');

// ---------------------------------------------------------------------
section('시나리오 1: A 방 생성, B·C·D 입장');
const [A, B, C, D] = [await newUser(), await newUser(), await newUser(), await newUser()];
const created = await call('game_create_room', A, '에이', 'bunny');
const code = created.code;
const roomId = created.room_id;
ok(/^[A-Z0-9]{6}$/.test(code), `6자리 방 코드 ${code}`);
await call('game_join_room', B, code.toLowerCase(), '비', 'cat');
await call('game_join_room', C, code, '씨', 'frog');
ok((await callErr('game_start', A, roomId)) === 'NOT_ENOUGH_PLAYERS', '3명이면 시작 불가');
await call('game_join_room', D, code, '디', 'panda');
let sA = await state(A, code);
ok(sA.players.length === 4, '4명 모두 대기실에 보임');
ok(sA.players.find((p) => p.is_host).nickname === '에이', 'A 가 방장');
const sB0 = await state(B, code);
ok(sB0.players.map((p) => p.nickname).join() === '에이,비,씨,디', 'B 도 모든 닉네임 확인');

ok((await callErr('game_start', B, roomId)) === 'NOT_HOST', '일반 참가자는 시작 불가');
ok((await callErr('game_update_settings', B, roomId, { draw_time: 60 })) === 'NOT_HOST', '일반 참가자는 설정 변경 불가');
ok((await callErr('game_update_settings', A, roomId, { draw_time: 61 })) === 'INVALID_SETTINGS', '잘못된 설정 거부');
await call('game_update_settings', A, roomId, { total_rounds: 2, draw_time: 90, difficulty: 'random', hints_enabled: true });
ok((await callErr('game_start', A, roomId)) === 'NOT_ALL_READY', '모두 준비 전엔 시작 불가');
for (const u of [B, C, D]) await call('game_set_ready', u, roomId, true);
await call('game_start', A, roomId);

section('시나리오 2: 출제자 A 에게만 제시어');
sA = await state(A, code);
let sB = await state(B, code);
const turn1 = sA.turn.id;
ok(sA.room.status === 'WORD_SELECT', 'WORD_SELECT 단계');
ok(sA.turn.drawer_id === sA.me, 'A 가 첫 출제자');
ok(Array.isArray(sA.turn.candidates) && sA.turn.candidates.length === 3, 'A 는 후보 3개를 받음');
ok(sB.turn.candidates == null && sB.turn.my_word == null, 'B 는 후보/정답을 받지 못함');
const secretErr = await asUser(B, async () => {
  try {
    await q('select * from turn_secrets');
    return null;
  } catch (e) {
    return e.message;
  }
});
ok(/permission denied/.test(secretErr ?? ''), 'B 가 turn_secrets 직접 조회 시 거부');
const wordsErr = await asUser(B, async () => {
  try {
    await q('select * from words');
    return null;
  } catch (e) {
    return e.message;
  }
});
ok(/permission denied/.test(wordsErr ?? ''), 'B 가 words 직접 조회 시 거부');
ok((await callErr('game_choose_word', B, roomId, turn1, 0)) === 'NOT_DRAWER', 'B 는 제시어 선택 불가');
await call('game_choose_word', A, roomId, turn1, 1);
sA = await state(A, code);
sB = await state(B, code);
const word1 = await secretWord(turn1);
ok(sA.room.status === 'DRAWING' && sA.turn.my_word === word1, `A 화면에 제시어 「${word1}」`);
ok(sB.turn.my_word == null && sB.turn.pattern.every((c) => c === ''), 'B 화면에는 빈칸만');
ok(sB.turn.word_length === [...word1].length, 'B 에게 글자 수 제공');
ok(sA.turn.can_change_word === true, '첫 획 전에는 제시어 변경 가능');

section('그림판 권한');
const strokeOp = JSON.stringify({ k: 's', c: '#000000', w: 8, p: [10, 10, 20, 20] });
const bStroke = await asUser(B, async () => {
  try {
    await q('insert into strokes(turn_id, seq, op) values ($1, 0, $2)', [turn1, strokeOp]);
    return 'inserted';
  } catch (e) {
    return e.message;
  }
});
ok(/row-level security/.test(bStroke), 'B 가 그림 저장 시도 → RLS 거부');
await asUser(A, () => q('insert into strokes(turn_id, seq, op) values ($1, 0, $2)', [turn1, strokeOp]));
const seen = await asUser(C, () => q('select seq, op from strokes where turn_id=$1', [turn1]));
ok(seen.length === 1, 'C 는 A 의 그림을 읽을 수 있음 (복원용)');
const rt = async (uid, topic, ext, write) =>
  asUser(uid, async () => {
    await q(`select set_config('realtime.topic', $1, false)`, [topic]);
    return (await q('select public.rt_can_access(realtime.topic(), $1, $2) v', [ext, write]))[0].v;
  });
ok((await rt(A, `draw:${turn1}`, 'broadcast', true)) === true, 'A 는 draw 채널 송신 가능');
ok((await rt(B, `draw:${turn1}`, 'broadcast', true)) === false, 'B 는 draw 채널 송신 불가');
ok((await rt(B, `draw:${turn1}`, 'broadcast', false)) === true, 'B 는 draw 채널 수신 가능');
const outsider = await newUser();
ok((await rt(outsider, `room:${roomId}`, 'presence', false)) === false, '외부인은 방 채널 접근 불가');
ok((await call('game_change_word', A, roomId, turn1).catch((e) => e.message)) === 'WORD_CHANGE_UNAVAILABLE', '첫 획 이후 제시어 변경 불가');

section('채팅 & 정답 판정');
ok((await callErr('game_submit_message', A, roomId, '힌트줄게')) === 'DRAWER_CANNOT_CHAT', '출제자 채팅 불가');
let res = await call('game_submit_message', B, roomId, '음... 모르겠다');
ok(res.result === 'wrong', '오답은 일반 채팅');
res = await call('game_submit_message', B, roomId, `  ${[...word1].join(' ')}!! `);
ok(res.result === 'correct' && res.order === 1, '공백/문장부호 섞인 정답 인정, 1등');
ok(res.points >= 200 && res.points <= 600, `첫 정답 점수 ${res.points} (100~500 + 보너스 100)`);
const scoreB1 = res.points;
res = await call('game_submit_message', B, roomId, word1);
ok(res.result === 'solved_chat', '중복 정답 → 점수 재적립 없음');
const bMsgs = await asUser(C, () => q(`select body from messages where room_id=$1 and visibility='solved'`, [roomId]));
ok(bMsgs.length === 0, '정답자의 채팅은 미정답자(C)에게 안 보임');
const aMsgs = await asUser(A, () => q(`select body from messages where room_id=$1 and visibility='solved'`, [roomId]));
ok(aMsgs.length === 1, '출제자(A)는 정답자 채팅을 볼 수 있음');
const publicLeak = await asUser(C, () =>
  q(`select body from messages where room_id=$1 and kind='chat' and body like '%' || $2 || '%'`, [roomId, word1]),
);
ok(publicLeak.length === 0, '공개 채팅에 정답 원문이 없음');
const correctMsg = await asUser(C, () => q(`select body from messages where room_id=$1 and kind='correct'`, [roomId]));
ok(correctMsg[0]?.body === '🎉 비님이 정답을 맞혔습니다!', '정답 알림 메시지 형식');
const hack = await asUser(B, async () => {
  try {
    await q('update players set score = 99999 where user_id = $1', [B]);
    return 'updated';
  } catch (e) {
    return e.message;
  }
});
ok(/permission denied/.test(hack), '점수 임의 변경 거부');
const rpcHack = await asUser(B, async () => {
  try {
    await q('select public.game_tick($1, $2)', [B, roomId]);
    return 'called';
  } catch (e) {
    return e.message;
  }
});
ok(/permission denied/.test(rpcHack), '브라우저 권한으로 game_* 함수 직접 호출 거부');

await call('game_submit_message', C, roomId, word1);
sA = await state(A, code);
ok(sA.room.status === 'DRAWING', '아직 D 가 남아 진행 중');
res = await call('game_submit_message', D, roomId, word1 + '인가요?');
ok(res.result === 'correct', '정답을 포함한 문장도 정답 처리');
sA = await state(A, code);
ok(sA.room.status === 'ROUND_RESULT' && sA.turn.end_reason === 'all_guessed', '모두 맞히면 문제 조기 종료');
ok(sA.turn.revealed_word === word1, '결과 화면에 정답 공개');
ok(sA.turn.guesses.map((g) => g.order).join() === '1,2,3', '정답자 순서 기록');
const pA = sA.players.find((p) => p.nickname === '에이');
ok(pA.score === 150, `출제자 점수 = 정답자 3명 × 50 = ${pA.score}`);
ok(sA.players.find((p) => p.nickname === '비').score === scoreB1, 'B 점수 반영');
res = await call('game_submit_message', C, roomId, word1);
ok(res.result === 'chat', '이미 끝난 문제에 정답 제출 → 일반 채팅 처리, 점수 없음');

section('타이머 & 다음 출제자');
ok((await call('game_tick', B, roomId)).status === 'ROUND_RESULT', '마감 전 tick 은 아무 변화 없음');
await expire(roomId);
await call('game_tick', C, roomId);
await call('game_tick', D, roomId); // 중복 tick 은 멱등
sB = await state(B, code);
ok(sB.room.status === 'WORD_SELECT', '결과 화면 후 다음 문제');
ok(sB.turn.drawer_id === sB.me, '두 번째 출제자는 B');
const turn2 = sB.turn.id;
await expire(roomId);
await call('game_tick', A, roomId);
sB = await state(B, code);
ok(sB.room.status === 'DRAWING' && !!sB.turn.my_word, '10초 미선택 → 자동 선택');
const word2 = await secretWord(turn2);
// 힌트: 절반 경과
await q(`update turns set started_at = now() - interval '50 seconds', ends_at = now() + interval '40 seconds' where id=$1`, [turn2]);
const sC = await state(C, code);
const shown = sC.turn.pattern.filter((c) => c !== '').length;
ok(word2.length < 2 || shown === 1, `절반 경과 시 힌트 1글자 공개 (${sC.turn.pattern.map((c) => c || '_').join('')})`);
// 제한시간 종료와 정답 제출 경합: 마감 시각이 지난 뒤 도착한 정답은 인정하지 않음
await q(`update turns set ends_at = now() - interval '1 second' where id=$1`, [turn2]);
res = await call('game_submit_message', C, roomId, word2);
ok(res.result === 'too_late', '마감 이후 도착한 정답은 거부');
sC2: {
  const s = await state(C, code);
  ok(s.room.status === 'ROUND_RESULT' && s.turn.end_reason === 'timeout', '시간 종료로 문제 종료');
  ok(s.turn.guesses.length === 0, '시간 초과 정답 미적립');
}

section('라운드 진행 → 최종 결과');
let guard = 0;
while (guard++ < 20) {
  const s = await state(A, code);
  if (s.room.status === 'GAME_RESULT') break;
  if (s.room.status === 'ROUND_RESULT') {
    await expire(roomId);
    await call('game_tick', A, roomId);
    continue;
  }
  const drawerUid = { 에이: A, 비: B, 씨: C, 디: D }[s.players.find((p) => p.id === s.turn.drawer_id).nickname];
  if (s.room.status === 'WORD_SELECT') await call('game_choose_word', drawerUid, roomId, s.turn.id, 0);
  await call('game_skip_turn', drawerUid, roomId, s.turn.id);
}
const turns = await q(`select round, turn_no, drawer_id from turns where room_id=$1 order by turn_no`, [roomId]);
ok(turns.length === 8, `2라운드 × 4명 = ${turns.length}문제`);
const perRound = [1, 2].map((r) => new Set(turns.filter((t) => t.round === r).map((t) => t.drawer_id)).size);
ok(perRound[0] === 4 && perRound[1] === 4, '라운드마다 모두 한 번씩 출제');
ok(turns.every((t, i) => i === 0 || t.drawer_id !== turns[i - 1].drawer_id), '같은 사람이 연속 출제하지 않음');
const final = await state(A, code);
ok(final.room.status === 'GAME_RESULT', 'GAME_RESULT');
const fr = final.game.final_results;
ok(fr.length === 4 && fr[0].rank === 1, '최종 순위 계산');
const tie = fr.filter((x) => x.score === 0);
ok(tie.length <= 1 || tie.every((x) => x.rank === tie[0].rank), '동점자는 공동 순위');

section('다시 하기 / 대기실');
ok((await callErr('game_start', B, roomId)) === 'NOT_HOST', '다시 하기도 방장만');
await call('game_start', A, roomId);
const again = await state(A, code);
ok(again.room.status === 'WORD_SELECT' && again.players.every((p) => p.score === 0), '같은 방에서 새 게임, 점수 초기화');
const usedWords = await q(
  `select count(*)::int n, count(distinct word_id)::int d from turn_secrets where room_id=$1 and word_id is not null`,
  [roomId],
);
ok(usedWords[0].n === usedWords[0].d, '같은 방에서 제시어 중복 없음');

// ---------------------------------------------------------------------
section('시나리오 3: 10명 정원, 동일 닉네임, 이탈/재접속');
const users = [];
for (let i = 0; i < 11; i++) users.push(await newUser());
const r2 = await call('game_create_room', users[0], '방장', 'fox');
for (let i = 1; i < 10; i++) await call('game_join_room', users[i], r2.code, i === 1 ? '방장' : `플레이어${i}`, 'chick');
ok((await callErr('game_join_room', users[10], r2.code, '열한번째', 'cat')) === 'ROOM_FULL', '11번째 입장 거부');
let s2 = await state(users[1], r2.code);
ok(s2.players.length === 10, '10명 입장');
ok(s2.players[1].nickname === '방장2', `동일 닉네임 자동 구분 → ${s2.players[1].nickname}`);
await call('game_join_room', users[3], r2.code, '플레이어3', 'chick');
ok((await state(users[3], r2.code)).players.length === 10, '같은 사용자 재입장(새로고침)은 중복 참가 아님');
ok((await callErr('game_join_room', users[0], 'ZZZZZZ', '누구', 'cat')) === 'ROOM_NOT_FOUND', '없는 방 코드');

for (let i = 1; i < 10; i++) await call('game_set_ready', users[i], r2.room_id, true);
await call('game_start', users[0], r2.room_id);
s2 = await state(users[0], r2.code);
ok(s2.turn.drawer_id === s2.me, '방장이 첫 출제자');
await call('game_choose_word', users[0], r2.room_id, s2.turn.id, 0);
const w2 = await secretWord(s2.turn.id);
await call('game_submit_message', users[5], r2.room_id, w2);
const before = (await state(users[5], r2.code)).players.find((p) => p.nickname === '플레이어5').score;

// 출제자 겸 방장 이탈
await call('game_leave_room', users[0], r2.room_id);
s2 = await state(users[1], r2.code);
ok(s2.players.length === 9, '이탈 반영');
ok(s2.players.find((p) => p.is_host)?.nickname === '방장2', '방장 권한이 다음 참가자에게 이전');
ok(s2.room.status === 'ROUND_RESULT' && s2.turn.end_reason === 'drawer_left', '출제자 이탈 → 문제 안전하게 종료');
await expire(r2.room_id);
await call('game_tick', users[1], r2.room_id);
s2 = await state(users[1], r2.code);
ok(s2.room.status === 'WORD_SELECT' && s2.turn.drawer_id === s2.me, '다음 출제자로 진행');

// 연결 끊김 (heartbeat 45초 이상 없음) → 자동 퇴장
await q(`update player_presence set last_seen_at = now() - interval '60 seconds'
         where player_id = (select id from players where user_id = $1)`, [users[5]]);
await call('game_tick', users[2], r2.room_id);
s2 = await state(users[2], r2.code);
ok(!s2.players.some((p) => p.nickname === '플레이어5'), '연결이 끊긴 참가자 자동 퇴장 처리');
const back = await state(users[5], r2.code);
ok(back.membership === 'left', '끊긴 참가자는 left 상태를 확인');
await call('game_join_room', users[5], r2.code, '플레이어5', 'chick');
s2 = await state(users[5], r2.code);
ok(s2.players.find((p) => p.nickname === '플레이어5').score === before, '재접속 시 점수 유지');
ok(await asUser(users[5], async () => (await q('select public.heartbeat($1) v', [r2.room_id]))[0].v), 'heartbeat 정상');

// 도배 방지
let limited = false;
for (let i = 0; i < 7; i++) {
  const e = await callErr('game_submit_message', users[4], r2.room_id, `안녕 ${i}`);
  if (e === 'RATE_LIMITED') limited = true;
}
ok(limited, '5초에 5개 초과 메시지 → RATE_LIMITED');

// 인원 부족 → 게임 종료
for (let i = 2; i < 10; i++) await call('game_leave_room', users[i], r2.room_id);
s2 = await state(users[1], r2.code);
ok(s2.room.status === 'GAME_RESULT', '게임 중 1명만 남으면 게임 종료');
await call('game_leave_room', users[1], r2.room_id);
ok((await q('select status from rooms where id=$1', [r2.room_id]))[0].status === 'CLOSED', '모두 나가면 방 닫힘');
ok((await callErr('game_join_room', users[10], r2.code, '늦었다', 'cat')) === 'ROOM_CLOSED', '닫힌 방 입장 불가');

section('만료된 방 정리');
await q(`update rooms set last_activity_at = now() - interval '7 hours' where id = $1`, [roomId]);
const cleaned = await call('cleanup_expired_rooms');
ok(cleaned >= 1, `만료된 방 ${cleaned}개 삭제 (연관 데이터 cascade)`);
ok((await q('select count(*)::int n from players where room_id=$1', [roomId]))[0].n === 0, '연관 데이터 함께 삭제');

console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
process.exit(failed ? 1 : 0);
