-- =====================================================================
-- 낙서팡팡 : 서버 측 게임 로직
-- =====================================================================
--  * game_* 함수는 service_role 전용 (Edge Function "game" 이 JWT 를 검증한 뒤 p_uid 로 호출)
--  * 모든 game_* 함수는 가장 먼저 rooms 행을 FOR UPDATE 로 잠금 → 같은 방의 요청은 직렬화되어
--    동시 정답 / 타이머 만료와 정답의 경합 / 동시 입장 등이 원자적으로 처리됨
--  * 오류는 대문자 코드(예: ROOM_FULL)로 raise → 클라이언트가 한국어 메시지로 변환
-- =====================================================================

-- ---------------------------------------------------------------------
-- 공통 유틸
-- ---------------------------------------------------------------------

-- 정답 정규화: 유니코드 NFC → 소문자 → 한글/영문/숫자 외 모든 문자(공백·문장부호·이모지) 제거
create or replace function public.normalize_answer(p text)
returns text language sql immutable as $$
  select regexp_replace(lower(normalize(coalesce(p, ''), NFC)), '[^0-9a-z가-힣]', '', 'g')
$$;

-- 편집 거리 ("아깝다!" 힌트용, 짧은 문자열 전용)
create or replace function public._lev(a text, b text)
returns int language plpgsql immutable as $$
declare
  la int := char_length(a);
  lb int := char_length(b);
  prev int[];
  cur int[];
  i int;
  j int;
  cost int;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  if abs(la - lb) > 2 or la > 30 or lb > 30 then return greatest(abs(la - lb), 3); end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i];
    for j in 1..lb loop
      cost := case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end;
      cur := cur || least(prev[j + 1] + 1, cur[j] + 1, prev[j] + cost);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end
$$;

create or replace function public._clean_nickname(p text)
returns text language plpgsql immutable as $$
declare v text;
begin
  v := btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g'));
  if char_length(v) < 1 or char_length(v) > 12 then
    raise exception 'INVALID_NICKNAME';
  end if;
  return v;
end
$$;

create or replace function public._check_character(p text)
returns void language plpgsql immutable as $$
begin
  if p is null or p not in ('bunny', 'cat', 'puppy', 'bear', 'panda', 'penguin',
                            'chick', 'frog', 'fox', 'piggy', 'hamster', 'koala') then
    raise exception 'INVALID_CHARACTER';
  end if;
end
$$;

-- 6자리 방 코드 (헷갈리는 0/O/1/I 제외, 암호학적 난수 기반)
create or replace function public._gen_code()
returns text language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := uuid_send(gen_random_uuid());
  v text := '';
  i int;
begin
  for i in 0..5 loop
    v := v || substr(alphabet, 1 + (get_byte(b, i) % 32), 1);
  end loop;
  return v;
end
$$;

create or replace function public._touch(p_room uuid)
returns void language sql as $$
  update public.rooms set version = version + 1, last_activity_at = now() where id = p_room
$$;

create or replace function public._msg(
  p_room uuid, p_kind text, p_body text,
  p_player uuid default null, p_visibility text default 'all',
  p_target uuid default null, p_turn uuid default null
) returns void language plpgsql as $$
declare
  v_nick text;
  v_char text;
begin
  if p_player is not null then
    select nickname, character into v_nick, v_char from public.players where id = p_player;
  end if;
  insert into public.messages (room_id, turn_id, player_id, nickname, character, kind, body, visibility, target_player_id)
  values (p_room, p_turn, p_player, v_nick, v_char, p_kind, left(p_body, 200), p_visibility, p_target);
end
$$;

create or replace function public._lock_room(p_room uuid)
returns public.rooms language plpgsql as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if r.status = 'CLOSED' then
    raise exception 'ROOM_CLOSED';
  end if;
  return r;
end
$$;

create or replace function public._member(p_room uuid, p_uid uuid)
returns public.players language plpgsql as $$
declare p public.players;
begin
  if p_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;
  select * into p from public.players where room_id = p_room and user_id = p_uid and left_at is null;
  if not found then
    raise exception 'NOT_MEMBER';
  end if;
  return p;
end
$$;

create or replace function public._unique_nickname(p_room uuid, p_nick text, p_exclude uuid)
returns text language plpgsql as $$
declare
  v text := p_nick;
  n int := 1;
begin
  while exists (select 1 from public.players
                where room_id = p_room and left_at is null
                  and lower(nickname) = lower(v)
                  and id is distinct from p_exclude) loop
    n := n + 1;
    v := left(p_nick, 12 - char_length(n::text)) || n::text;
  end loop;
  return v;
end
$$;

-- ---------------------------------------------------------------------
-- 제시어 선택 (같은 방에서 이미 나온 단어는 최대한 제외)
-- ---------------------------------------------------------------------
create or replace function public._random_words(p_room uuid, p_diff text, p_n int, p_exclude bigint[])
returns setof public.words language plpgsql volatile as $$
declare
  rec public.words;
  v_taken bigint[] := coalesce(p_exclude, '{}');
  v_count int := 0;
begin
  for rec in
    select w.* from public.words w
    where w.difficulty = p_diff
      and not (w.id = any (v_taken))
      and not exists (select 1 from public.turn_secrets s where s.room_id = p_room and s.word_id = w.id)
    order by random()
    limit p_n
  loop
    v_taken := v_taken || rec.id;
    v_count := v_count + 1;
    return next rec;
  end loop;

  if v_count < p_n then  -- 단어가 모두 소진된 경우: 중복 허용
    for rec in
      select w.* from public.words w
      where w.difficulty = p_diff and not (w.id = any (v_taken))
      order by random()
      limit p_n - v_count
    loop
      return next rec;
    end loop;
  end if;
end
$$;

create or replace function public._pick_candidates(p_room uuid, p_diff text)
returns jsonb language plpgsql volatile as $$
declare
  v jsonb := '[]'::jsonb;
  d text;
  rec public.words;
  v_taken bigint[] := '{}';
  v_diffs text[];
  v_per int;
begin
  if p_diff = 'random' then
    v_diffs := array['easy', 'normal', 'hard'];
    v_per := 1;
  else
    v_diffs := array[p_diff];
    v_per := 3;
  end if;

  foreach d in array v_diffs loop
    for rec in select * from public._random_words(p_room, d, v_per, v_taken) loop
      v_taken := v_taken || rec.id;
      v := v || jsonb_build_array(jsonb_build_object('id', rec.id, 'text', rec.text, 'difficulty', rec.difficulty));
    end loop;
  end loop;

  if jsonb_array_length(v) = 0 then
    raise exception 'NO_WORDS';
  end if;

  -- 섞기
  select jsonb_agg(e order by random()) into v from jsonb_array_elements(v) e;
  return v;
end
$$;

-- ---------------------------------------------------------------------
-- 출제자 순서: 이번 라운드에 아직 안 그린 활성 참가자 중 입장 순서대로,
-- 직전 출제자는 다른 후보가 있으면 뒤로 미룸 (연속 출제 방지)
-- ---------------------------------------------------------------------
create or replace function public._next_drawer(p_room uuid, p_game uuid, p_round int)
returns uuid language sql stable as $$
  select p.id
  from public.players p
  where p.room_id = p_room
    and p.left_at is null
    and not exists (select 1 from public.turns t
                    where t.game_id = p_game and t.round = p_round and t.drawer_id = p.id)
  order by (p.id is not distinct from (select t2.drawer_id from public.turns t2
                                       where t2.game_id = p_game order by t2.turn_no desc limit 1)) asc,
           p.join_order asc
  limit 1
$$;

-- ---------------------------------------------------------------------
-- 상태 전환 (내부 함수: 호출 전에 반드시 rooms 행이 잠겨 있어야 함)
-- ---------------------------------------------------------------------
create or replace function public._finish_game(p_room uuid)
returns void language plpgsql as $$
declare
  r public.rooms;
  v_results jsonb;
  v_winners text;
begin
  select * into r from public.rooms where id = p_room;

  update public.turns t
     set status = 'DONE',
         ended_at = coalesce(t.ended_at, now()),
         end_reason = coalesce(t.end_reason, 'game_aborted'),
         revealed_word = coalesce(t.revealed_word, (select s.word from public.turn_secrets s where s.turn_id = t.id))
   where t.room_id = p_room and t.status <> 'DONE';

  select coalesce(jsonb_agg(to_jsonb(x) order by x.rank, x.join_order), '[]'::jsonb)
    into v_results
  from (
    select p.id as player_id, p.nickname, p.character, p.score, p.join_order,
           rank() over (order by p.score desc) as rank
    from public.players p
    where p.room_id = p_room and p.left_at is null
  ) x;

  update public.games set ended_at = now(), final_results = v_results where id = r.current_game_id;

  update public.rooms
     set status = 'GAME_RESULT', phase_ends_at = null, current_turn_id = null,
         version = version + 1, last_activity_at = now()
   where id = p_room;

  select string_agg(e->>'nickname', ', ') into v_winners
  from jsonb_array_elements(v_results) e where (e->>'rank')::int = 1;

  perform public._msg(p_room, 'system',
    '🏆 게임이 끝났어요! 우승: ' || coalesce(v_winners, '-'));
end
$$;

create or replace function public._begin_next_turn(p_room uuid)
returns void language plpgsql as $$
declare
  r public.rooms;
  v_active int;
  v_drawer uuid;
  v_turn uuid;
  v_no int;
  v_cands jsonb;
begin
  select * into r from public.rooms where id = p_room;
  select count(*) into v_active from public.players where room_id = p_room and left_at is null;
  if v_active < 2 then
    perform public._finish_game(p_room);
    return;
  end if;

  v_drawer := public._next_drawer(p_room, r.current_game_id, r.current_round);
  if v_drawer is null then
    if r.current_round >= r.total_rounds then
      perform public._finish_game(p_room);
      return;
    end if;
    update public.rooms set current_round = current_round + 1 where id = p_room returning * into r;
    v_drawer := public._next_drawer(p_room, r.current_game_id, r.current_round);
    if v_drawer is null then
      perform public._finish_game(p_room);
      return;
    end if;
    perform public._msg(p_room, 'system', format('📣 %s라운드 시작!', r.current_round));
  end if;

  select coalesce(max(turn_no), 0) + 1 into v_no from public.turns where game_id = r.current_game_id;
  v_cands := public._pick_candidates(p_room, r.difficulty);

  insert into public.turns (room_id, game_id, round, turn_no, drawer_id, status, select_ends_at)
  values (p_room, r.current_game_id, r.current_round, v_no, v_drawer, 'WORD_SELECT', now() + interval '10 seconds')
  returning id into v_turn;

  insert into public.turn_secrets (turn_id, room_id, candidates) values (v_turn, p_room, v_cands);

  update public.rooms
     set status = 'WORD_SELECT', current_turn_id = v_turn,
         phase_ends_at = now() + interval '10 seconds',
         version = version + 1, last_activity_at = now()
   where id = p_room;

  perform public._msg(p_room, 'system',
    format('🎨 %s님이 그림을 그릴 차례예요!', (select nickname from public.players where id = v_drawer)),
    null, 'all', null, v_turn);
end
$$;

create or replace function public._start_drawing(p_room uuid, p_turn uuid, p_word_id bigint, p_word text)
returns void language plpgsql as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  update public.turn_secrets set word_id = p_word_id, word = p_word where turn_id = p_turn;
  update public.turns
     set status = 'DRAWING', word_length = char_length(p_word),
         started_at = now(), ends_at = now() + make_interval(secs => r.draw_time)
   where id = p_turn;
  update public.rooms
     set status = 'DRAWING', phase_ends_at = now() + make_interval(secs => r.draw_time),
         version = version + 1, last_activity_at = now()
   where id = p_room;
end
$$;

create or replace function public._end_turn(p_room uuid, p_reason text)
returns void language plpgsql as $$
declare
  r public.rooms;
  t public.turns;
  v_word text;
  v_text text;
begin
  select * into r from public.rooms where id = p_room;
  select * into t from public.turns where id = r.current_turn_id;
  if t.id is null or t.status not in ('WORD_SELECT', 'DRAWING') then
    return;  -- 이미 종료된 문제 → 아무 일도 하지 않음 (멱등)
  end if;

  select word into v_word from public.turn_secrets where turn_id = t.id;

  update public.turns
     set status = 'ROUND_RESULT', ended_at = now(), end_reason = p_reason, revealed_word = v_word
   where id = t.id;

  update public.rooms
     set status = 'ROUND_RESULT',
         phase_ends_at = now() + case when v_word is null then interval '3 seconds' else interval '7 seconds' end,
         version = version + 1, last_activity_at = now()
   where id = p_room;

  v_text := case p_reason
    when 'all_guessed' then '✨ 모두 정답을 맞혔어요!'
    when 'timeout'     then '⏰ 시간 종료!'
    when 'skipped'     then '⏭️ 문제를 건너뛰었어요.'
    when 'drawer_left' then '🚪 출제자가 나가서 문제를 건너뛰어요.'
    else '문제가 끝났어요.'
  end;
  if v_word is not null then
    v_text := v_text || format(' 정답은 「%s」였어요!', v_word);
  end if;
  perform public._msg(p_room, 'system', v_text, null, 'all', null, t.id);
end
$$;

create or replace function public._after_result(p_room uuid)
returns void language plpgsql as $$
begin
  update public.turns set status = 'DONE'
   where id = (select current_turn_id from public.rooms where id = p_room) and status = 'ROUND_RESULT';
  perform public._begin_next_turn(p_room);
end
$$;

create or replace function public._check_all_guessed(p_room uuid, p_turn uuid)
returns boolean language plpgsql as $$
declare
  v_drawer uuid;
  v_guessers int;
  v_remaining int;
begin
  select drawer_id into v_drawer from public.turns where id = p_turn;
  select count(*),
         count(*) filter (where not exists (select 1 from public.guesses g where g.turn_id = p_turn and g.player_id = p.id))
    into v_guessers, v_remaining
  from public.players p
  where p.room_id = p_room and p.left_at is null and p.id is distinct from v_drawer;

  if v_guessers > 0 and v_remaining = 0 then
    perform public._end_turn(p_room, 'all_guessed');
    return true;
  end if;
  return false;
end
$$;

create or replace function public._handle_leave(p_room uuid, p_player uuid)
returns void language plpgsql as $$
declare
  r public.rooms;
  p public.players;
  t public.turns;
  v_active int;
  v_new_host uuid;
begin
  select * into p from public.players where id = p_player;
  if p.id is null or p.left_at is not null then
    return;
  end if;

  update public.players set left_at = now(), is_ready = false where id = p_player;
  perform public._msg(p_room, 'system', format('👋 %s님이 나갔어요.', p.nickname));

  select * into r from public.rooms where id = p_room;
  select count(*) into v_active from public.players where room_id = p_room and left_at is null;

  if v_active = 0 then
    update public.turns set status = 'DONE', ended_at = coalesce(ended_at, now())
     where room_id = p_room and status <> 'DONE';
    update public.rooms
       set status = 'CLOSED', phase_ends_at = null, version = version + 1, last_activity_at = now()
     where id = p_room;
    return;
  end if;

  -- 방장 위임
  if r.host_player_id is not distinct from p_player then
    select id into v_new_host from public.players
     where room_id = p_room and left_at is null order by join_order limit 1;
    update public.rooms set host_player_id = v_new_host where id = p_room;
    perform public._msg(p_room, 'system',
      format('👑 %s님이 새 방장이 되었어요.', (select nickname from public.players where id = v_new_host)));
  end if;

  if r.status in ('WORD_SELECT', 'DRAWING', 'ROUND_RESULT') then
    if v_active < 2 then
      perform public._msg(p_room, 'system', '😢 인원이 부족해서 게임을 종료해요.');
      perform public._finish_game(p_room);
    else
      select * into t from public.turns where id = r.current_turn_id;
      if t.drawer_id = p_player and t.status in ('WORD_SELECT', 'DRAWING') then
        perform public._end_turn(p_room, 'drawer_left');
      elsif t.status = 'DRAWING' then
        perform public._check_all_guessed(p_room, t.id);
      end if;
    end if;
  end if;

  perform public._touch(p_room);
end
$$;

-- heartbeat 가 45초 이상 끊긴 참가자를 퇴장 처리
create or replace function public._cleanup_stale(p_room uuid, p_except uuid)
returns void language plpgsql as $$
declare v_pid uuid;
begin
  for v_pid in
    select p.id from public.players p
    join public.player_presence pr on pr.player_id = p.id
    where p.room_id = p_room and p.left_at is null
      and p.id is distinct from p_except
      and pr.last_seen_at < now() - interval '45 seconds'
    order by p.join_order
  loop
    perform public._handle_leave(p_room, v_pid);
  end loop;
end
$$;

-- 만료된 방 정리 (방 생성 시 자동 호출 + pg_cron 으로 주기 실행 가능)
create or replace function public.cleanup_expired_rooms()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.rooms
   where last_activity_at < now() - interval '6 hours'
      or (status = 'CLOSED' and last_activity_at < now() - interval '10 minutes');
  get diagnostics n = row_count;
  return n;
end
$$;

-- =====================================================================
-- 공개 액션 (service_role 전용 → Edge Function 에서만 호출)
-- =====================================================================

create or replace function public.game_create_room(p_uid uuid, p_nickname text, p_character text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_nick text;
  v_code text;
  v_room uuid;
  v_player uuid;
  i int;
begin
  if p_uid is null then raise exception 'UNAUTHORIZED'; end if;
  v_nick := public._clean_nickname(p_nickname);
  perform public._check_character(p_character);
  perform public.cleanup_expired_rooms();

  for i in 1..20 loop
    v_code := public._gen_code();
    begin
      insert into public.rooms (code) values (v_code) returning id into v_room;
      exit;
    exception when unique_violation then
      v_room := null;
    end;
  end loop;
  if v_room is null then raise exception 'CODE_GENERATION_FAILED'; end if;

  insert into public.players (room_id, user_id, nickname, character, join_order)
  values (v_room, p_uid, v_nick, p_character, 1)
  returning id into v_player;
  insert into public.player_presence (player_id, room_id) values (v_player, v_room);
  update public.rooms set host_player_id = v_player where id = v_room;
  perform public._msg(v_room, 'system', format('🎉 %s님이 방을 만들었어요! 친구들을 초대해 보세요.', v_nick));

  return jsonb_build_object('code', v_code, 'room_id', v_room, 'player_id', v_player);
end
$$;

create or replace function public.game_join_room(p_uid uuid, p_code text, p_nickname text, p_character text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  p public.players;
  v_nick text;
  v_active int;
  v_order int;
  v_player uuid;
begin
  if p_uid is null then raise exception 'UNAUTHORIZED'; end if;
  v_nick := public._clean_nickname(p_nickname);
  perform public._check_character(p_character);

  select * into r from public.rooms where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.status = 'CLOSED' then raise exception 'ROOM_CLOSED'; end if;

  select * into p from public.players where room_id = r.id and user_id = p_uid;

  -- 이미 참가 중 (새로고침 / 재접속)
  if p.id is not null and p.left_at is null then
    update public.player_presence set last_seen_at = now() where player_id = p.id;
    return jsonb_build_object('code', r.code, 'room_id', r.id, 'player_id', p.id, 'rejoined', true);
  end if;

  select count(*) into v_active from public.players where room_id = r.id and left_at is null;
  if v_active >= 10 then raise exception 'ROOM_FULL'; end if;

  v_nick := public._unique_nickname(r.id, v_nick, p.id);

  if p.id is not null then
    -- 퇴장했던 참가자의 재입장: 같은 게임이면 점수 유지
    update public.players
       set left_at = null, nickname = v_nick, character = p_character, is_ready = false
     where id = p.id;
    v_player := p.id;
    insert into public.player_presence (player_id, room_id) values (v_player, r.id)
    on conflict (player_id) do update set last_seen_at = now();
    perform public._msg(r.id, 'system', format('🔄 %s님이 다시 들어왔어요!', v_nick));
  else
    select coalesce(max(join_order), 0) + 1 into v_order from public.players where room_id = r.id;
    insert into public.players (room_id, user_id, nickname, character, join_order)
    values (r.id, p_uid, v_nick, p_character, v_order)
    returning id into v_player;
    insert into public.player_presence (player_id, room_id) values (v_player, r.id);
    perform public._msg(r.id, 'system', format('🙌 %s님이 들어왔어요!', v_nick));
  end if;

  -- 아무도 없던 방(방장 없음)이라면 방장 지정
  if r.host_player_id is null
     or not exists (select 1 from public.players where id = r.host_player_id and left_at is null) then
    update public.rooms set host_player_id = v_player where id = r.id;
  end if;

  perform public._touch(r.id);
  return jsonb_build_object('code', r.code, 'room_id', r.id, 'player_id', v_player, 'rejoined', p.id is not null);
end
$$;

create or replace function public.game_leave_room(p_uid uuid, p_room uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  v_pid uuid;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found then return jsonb_build_object('ok', true); end if;
  select id into v_pid from public.players where room_id = p_room and user_id = p_uid and left_at is null;
  if v_pid is not null then
    perform public._handle_leave(p_room, v_pid);
  end if;
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.game_set_ready(p_uid uuid, p_room uuid, p_ready boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  me public.players;
begin
  r := public._lock_room(p_room);
  me := public._member(p_room, p_uid);
  if r.status <> 'WAITING' then raise exception 'INVALID_PHASE'; end if;
  update public.players set is_ready = coalesce(p_ready, false) where id = me.id;
  perform public._touch(p_room);
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.game_set_character(p_uid uuid, p_room uuid, p_character text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  me public.players;
begin
  r := public._lock_room(p_room);
  me := public._member(p_room, p_uid);
  perform public._check_character(p_character);
  update public.players set character = p_character where id = me.id;
  perform public._touch(p_room);
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.game_update_settings(p_uid uuid, p_room uuid, p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  me public.players;
  v_time int;
  v_rounds int;
  v_diff text;
  v_hints boolean;
begin
  r := public._lock_room(p_room);
  me := public._member(p_room, p_uid);
  if r.host_player_id is distinct from me.id then raise exception 'NOT_HOST'; end if;
  if r.status not in ('WAITING', 'GAME_RESULT') then raise exception 'INVALID_PHASE'; end if;

  begin
    v_time   := coalesce((p_settings->>'draw_time')::int, r.draw_time);
    v_rounds := coalesce((p_settings->>'total_rounds')::int, r.total_rounds);
    v_diff   := coalesce(p_settings->>'difficulty', r.difficulty);
    v_hints  := coalesce((p_settings->>'hints_enabled')::boolean, r.hints_enabled);
  exception when others then
    raise exception 'INVALID_SETTINGS';
  end;
  if v_time not in (60, 90, 120) or v_rounds not in (2, 3, 5)
     or v_diff not in ('easy', 'normal', 'hard', 'random') then
    raise exception 'INVALID_SETTINGS';
  end if;

  update public.rooms
     set draw_time = v_time, total_rounds = v_rounds, difficulty = v_diff, hints_enabled = v_hints
   where id = p_room;
  perform public._touch(p_room);
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.game_start(p_uid uuid, p_room uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  me public.players;
  v_active int;
  v_game uuid;
begin
  r := public._lock_room(p_room);
  me := public._member(p_room, p_uid);
  if r.host_player_id is distinct from me.id then raise exception 'NOT_HOST'; end if;
  if r.status not in ('WAITING', 'GAME_RESULT') then raise exception 'INVALID_PHASE'; end if;

  -- 시작 직전에 연결이 끊긴 참가자 정리 후 인원 재확인
  update public.player_presence set last_seen_at = now() where player_id = me.id;
  perform public._cleanup_stale(p_room, me.id);
  select count(*) into v_active from public.players where room_id = p_room and left_at is null;
  if v_active < 4 then raise exception 'NOT_ENOUGH_PLAYERS'; end if;
  if v_active > 10 then raise exception 'ROOM_FULL'; end if;

  if r.status = 'WAITING' and exists (
    select 1 from public.players
    where room_id = p_room and left_at is null and id <> me.id and not is_ready
  ) then
    raise exception 'NOT_ALL_READY';
  end if;

  insert into public.games (room_id, total_rounds, draw_time, difficulty, hints_enabled)
  values (p_room, r.total_rounds, r.draw_time, r.difficulty, r.hints_enabled)
  returning id into v_game;

  update public.players set score = 0, is_ready = false where room_id = p_room;
  update public.rooms
     set current_game_id = v_game, current_round = 1, current_turn_id = null
   where id = p_room;

  perform public._msg(p_room, 'system',
    format('🚀 게임 시작! 총 %s라운드, 문제당 %s초', r.total_rounds, r.draw_time));
  perform public._msg(p_room, 'system', '📣 1라운드 시작!');
  perform public._begin_next_turn(p_room);
  return jsonb_build_object('ok', true, 'game_id', v_game);
end
$$;

create or replace function public.game_return_lobby(p_uid uuid, p_room uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  me public.players;
begin
  r := public._lock_room(p_room);
  me := public._member(p_room, p_uid);
  if r.host_player_id is distinct from me.id then raise exception 'NOT_HOST'; end if;
  if r.status <> 'GAME_RESULT' then raise exception 'INVALID_PHASE'; end if;
  update public.players set is_ready = false where room_id = p_room;
  update public.rooms set status = 'WAITING', current_round = 0, phase_ends_at = null where id = p_room;
  perform public._msg(p_room, 'system', '🏠 대기실로 돌아왔어요. 준비 버튼을 눌러 주세요!');
  perform public._touch(p_room);
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.game_choose_word(p_uid uuid, p_room uuid, p_turn uuid, p_index int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  me public.players;
  t public.turns;
  v_cands jsonb;
  v_c jsonb;
begin
  r := public._lock_room(p_room);
  me := public._member(p_room, p_uid);
  if r.status <> 'WORD_SELECT' or r.current_turn_id is distinct from p_turn then
    raise exception 'TURN_OVER';
  end if;
  select * into t from public.turns where id = p_turn;
  if t.drawer_id is distinct from me.id then raise exception 'NOT_DRAWER'; end if;

  select candidates into v_cands from public.turn_secrets where turn_id = p_turn;
  if p_index is null or p_index < 0 or p_index >= jsonb_array_length(v_cands) then
    raise exception 'INVALID_INPUT';
  end if;
  v_c := v_cands->p_index;
  perform public._start_drawing(p_room, p_turn, (v_c->>'id')::bigint, v_c->>'text');
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.game_change_word(p_uid uuid, p_room uuid, p_turn uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  me public.players;
  t public.turns;
  s public.turn_secrets;
  v_diff text;
  v_exclude bigint[];
  w public.words;
begin
  r := public._lock_room(p_room);
  me := public._member(p_room, p_uid);
  if r.status <> 'DRAWING' or r.current_turn_id is distinct from p_turn then raise exception 'TURN_OVER'; end if;
  select * into t from public.turns where id = p_turn;
  if t.drawer_id is distinct from me.id then raise exception 'NOT_DRAWER'; end if;
  if t.word_changed or exists (select 1 from public.strokes where turn_id = p_turn) then
    raise exception 'WORD_CHANGE_UNAVAILABLE';
  end if;

  select * into s from public.turn_secrets where turn_id = p_turn;
  select difficulty into v_diff from public.words where id = s.word_id;
  v_diff := coalesce(v_diff, case when r.difficulty = 'random' then 'normal' else r.difficulty end);
  select array_agg((c->>'id')::bigint) into v_exclude from jsonb_array_elements(s.candidates) c;

  select * into w from public._random_words(p_room, v_diff, 1, v_exclude) limit 1;
  if w.id is null then raise exception 'NO_WORDS'; end if;

  update public.turn_secrets set word_id = w.id, word = w.text where turn_id = p_turn;
  update public.turns
     set word_length = char_length(w.text), word_changed = true,
         started_at = now(), ends_at = now() + make_interval(secs => r.draw_time)
   where id = p_turn;
  update public.rooms set phase_ends_at = now() + make_interval(secs => r.draw_time) where id = p_room;
  perform public._msg(p_room, 'system', '🔄 출제자가 제시어를 바꿨어요!', null, 'all', null, p_turn);
  perform public._touch(p_room);
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.game_skip_turn(p_uid uuid, p_room uuid, p_turn uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  me public.players;
  t public.turns;
begin
  r := public._lock_room(p_room);
  me := public._member(p_room, p_uid);
  if r.status not in ('WORD_SELECT', 'DRAWING') or r.current_turn_id is distinct from p_turn then
    raise exception 'TURN_OVER';
  end if;
  select * into t from public.turns where id = p_turn;
  if t.drawer_id is distinct from me.id and r.host_player_id is distinct from me.id then
    raise exception 'NOT_DRAWER';
  end if;
  perform public._end_turn(p_room, 'skipped');
  return jsonb_build_object('ok', true);
end
$$;

-- 채팅 & 정답 판정
create or replace function public.game_submit_message(p_uid uuid, p_room uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  me public.players;
  t public.turns;
  v_text text;
  v_norm text;
  v_answer text;
  v_answer_norm text;
  v_aliases text[];
  v_correct boolean := false;
  v_recent int;
  v_order int;
  v_total numeric;
  v_left numeric;
  v_points int;
  v_dp int;
  v_gid bigint;
begin
  r := public._lock_room(p_room);
  me := public._member(p_room, p_uid);

  v_text := btrim(regexp_replace(coalesce(p_text, ''), '[[:cntrl:]]', '', 'g'));
  if v_text = '' then raise exception 'EMPTY_MESSAGE'; end if;
  v_text := left(v_text, 100);

  -- 도배 방지: 5초에 5개
  select count(*) into v_recent from public.messages
   where player_id = me.id and kind in ('chat', 'correct') and created_at > now() - interval '5 seconds';
  if v_recent >= 5 then raise exception 'RATE_LIMITED'; end if;

  update public.player_presence set last_seen_at = now() where player_id = me.id;

  if r.status in ('WORD_SELECT', 'DRAWING') then
    select * into t from public.turns where id = r.current_turn_id;
  end if;

  if t.id is not null and t.drawer_id = me.id then
    raise exception 'DRAWER_CANNOT_CHAT';
  end if;

  if r.status = 'DRAWING' and t.id is not null then
    -- 이미 맞힌 사람의 채팅은 정답자/출제자에게만 보임 (정답 유출 방지)
    if exists (select 1 from public.guesses where turn_id = t.id and player_id = me.id) then
      perform public._msg(p_room, 'chat', v_text, me.id, 'solved', null, t.id);
      return jsonb_build_object('result', 'solved_chat');
    end if;

    -- 제한시간이 이미 지났다면: 정답 인정하지 않고 문제 종료
    if now() >= t.ends_at then
      perform public._end_turn(p_room, 'timeout');
      return jsonb_build_object('result', 'too_late');
    end if;

    select s.word, coalesce(w.aliases, '{}') into v_answer, v_aliases
    from public.turn_secrets s left join public.words w on w.id = s.word_id
    where s.turn_id = t.id;

    v_norm := public.normalize_answer(v_text);
    v_answer_norm := public.normalize_answer(v_answer);

    v_correct := v_norm <> '' and (
      v_norm = v_answer_norm
      or v_norm = any (select public.normalize_answer(a) from unnest(v_aliases) a)
      -- 정답 단어를 포함한 문장도 정답 처리 (예: "사과인가?") → 오답 채팅으로 정답이 유출되는 것 방지
      or (char_length(v_answer_norm) >= 2 and position(v_answer_norm in v_norm) > 0)
    );

    if v_correct then
      select count(*) + 1 into v_order from public.guesses where turn_id = t.id;
      v_total := greatest(1, extract(epoch from (t.ends_at - t.started_at)));
      v_left := greatest(0, extract(epoch from (t.ends_at - now())));
      v_points := least(500, greatest(100, 100 + round(400 * v_left / v_total)::int));
      if v_order = 1 then v_points := v_points + 100; end if;
      v_dp := case when t.drawer_id is not null then 50 else 0 end;

      insert into public.guesses (turn_id, room_id, player_id, points, drawer_points, guess_order)
      values (t.id, p_room, me.id, v_points, v_dp, v_order)
      on conflict (turn_id, player_id) do nothing
      returning id into v_gid;
      if v_gid is null then
        return jsonb_build_object('result', 'already_solved');
      end if;

      update public.players set score = score + v_points where id = me.id;
      if v_dp > 0 then
        update public.players set score = score + v_dp where id = t.drawer_id;
      end if;

      perform public._msg(p_room, 'correct', format('🎉 %s님이 정답을 맞혔습니다!', me.nickname),
                          me.id, 'all', null, t.id);
      perform public._touch(p_room);
      perform public._check_all_guessed(p_room, t.id);
      return jsonb_build_object('result', 'correct', 'points', v_points, 'order', v_order);
    end if;

    perform public._msg(p_room, 'chat', v_text, me.id, 'all', null, t.id);
    if char_length(v_answer_norm) >= 3 and public._lev(v_norm, v_answer_norm) = 1 then
      perform public._msg(p_room, 'close', format('🔥 「%s」 아깝다! 거의 정답이에요!', v_text),
                          null, 'private', me.id, t.id);
      return jsonb_build_object('result', 'close');
    end if;
    return jsonb_build_object('result', 'wrong');
  end if;

  perform public._msg(p_room, 'chat', v_text, me.id, 'all', null, t.id);
  return jsonb_build_object('result', 'chat');
end
$$;

-- 타이머 진행: 모든 클라이언트가 마감 시각에 호출 (멱등). 서버 시각 기준으로만 전환.
create or replace function public.game_tick(p_uid uuid, p_room uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.rooms;
  me public.players;
  s public.turn_secrets;
  v_c jsonb;
begin
  r := public._lock_room(p_room);
  me := public._member(p_room, p_uid);
  update public.player_presence set last_seen_at = now() where player_id = me.id;

  perform public._cleanup_stale(p_room, me.id);
  select * into r from public.rooms where id = p_room;

  if r.status = 'WORD_SELECT' and now() >= r.phase_ends_at then
    -- 10초 안에 고르지 않으면 자동 선택
    select * into s from public.turn_secrets where turn_id = r.current_turn_id;
    v_c := s.candidates->(floor(random() * jsonb_array_length(s.candidates))::int);
    perform public._msg(p_room, 'system', '⌛ 시간이 지나 제시어가 자동으로 선택됐어요.', null, 'all', null, r.current_turn_id);
    perform public._start_drawing(p_room, r.current_turn_id, (v_c->>'id')::bigint, v_c->>'text');
  elsif r.status = 'DRAWING' and now() >= r.phase_ends_at then
    perform public._end_turn(p_room, 'timeout');
  elsif r.status = 'ROUND_RESULT' and now() >= r.phase_ends_at then
    perform public._after_result(p_room);
  end if;

  select * into r from public.rooms where id = p_room;
  return jsonb_build_object('status', r.status, 'version', r.version);
end
$$;

-- =====================================================================
-- 클라이언트가 직접 호출하는 읽기/heartbeat 함수 (auth.uid() 기반)
-- =====================================================================

create or replace function public.heartbeat(p_room uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.player_presence pr set last_seen_at = now()
    from public.players p
   where p.id = pr.player_id and p.room_id = p_room and p.user_id = auth.uid() and p.left_at is null;
  get diagnostics n = row_count;
  if n > 0 then
    update public.rooms set last_activity_at = now()
     where id = p_room and last_activity_at < now() - interval '5 minutes';
  end if;
  return n > 0;
end
$$;

-- 방 전체 상태 (비밀 정답은 출제자에게만, 힌트 글자는 서버 시각 기준으로 공개)
create or replace function public.get_room_state(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r public.rooms;
  me public.players;
  t public.turns;
  s public.turn_secrets;
  g public.games;
  v_players jsonb;
  v_turn jsonb;
  v_game jsonb;
  v_pattern jsonb;
  v_full boolean;
  v_reveal int := 0;
  v_hint_times jsonb := '[]'::jsonb;
  v_total numeric;
  v_elapsed numeric;
begin
  select * into r from public.rooms where code = upper(btrim(coalesce(p_code, '')));
  if not found then
    return jsonb_build_object('membership', 'none', 'error', 'ROOM_NOT_FOUND', 'server_now', now());
  end if;

  select * into me from public.players where room_id = r.id and user_id = auth.uid();
  if me.id is null or me.left_at is not null then
    return jsonb_build_object(
      'membership', case when me.id is null then 'none' else 'left' end,
      'server_now', now(),
      'room', jsonb_build_object(
        'id', r.id, 'code', r.code, 'status', r.status,
        'player_count', (select count(*) from public.players where room_id = r.id and left_at is null)));
  end if;

  if r.current_turn_id is not null then
    select * into t from public.turns where id = r.current_turn_id;
    select * into s from public.turn_secrets where turn_id = t.id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'nickname', p.nickname, 'character', p.character,
           'is_ready', p.is_ready, 'score', p.score, 'join_order', p.join_order,
           'is_host', p.id = r.host_player_id,
           'has_drawn', exists (select 1 from public.turns x
                                where x.game_id = r.current_game_id and x.round = r.current_round
                                  and x.drawer_id = p.id and x.id is distinct from r.current_turn_id),
           'solved', t.id is not null and exists (select 1 from public.guesses gg
                                                  where gg.turn_id = t.id and gg.player_id = p.id)
         ) order by p.join_order), '[]'::jsonb)
    into v_players
  from public.players p
  where p.room_id = r.id and p.left_at is null;

  if t.id is not null then
    v_full := t.status in ('ROUND_RESULT', 'DONE')
              or t.drawer_id = me.id
              or exists (select 1 from public.guesses gg where gg.turn_id = t.id and gg.player_id = me.id);

    if t.status = 'DRAWING' and t.word_length is not null and r.hints_enabled then
      v_total := extract(epoch from (t.ends_at - t.started_at));
      v_elapsed := extract(epoch from (now() - t.started_at));
      if t.word_length >= 2 then
        v_hint_times := jsonb_build_array(t.started_at + (t.ends_at - t.started_at) / 2);
        if v_elapsed >= v_total / 2 then v_reveal := 1; end if;
      end if;
      if t.word_length >= 4 then
        v_hint_times := v_hint_times || to_jsonb(t.started_at + (t.ends_at - t.started_at) * 0.75);
        if v_elapsed >= v_total * 0.75 then v_reveal := 2; end if;
      end if;
    end if;

    if t.word_length is not null and s.word is not null then
      select jsonb_agg(
               case when v_full or pos in (select q from generate_series(1, t.word_length) q
                                           order by md5(t.id::text || q::text) limit v_reveal)
                    then substr(s.word, pos, 1) else '' end
               order by pos)
        into v_pattern
      from generate_series(1, t.word_length) pos;
    end if;

    v_turn := jsonb_build_object(
      'id', t.id, 'round', t.round, 'turn_no', t.turn_no, 'drawer_id', t.drawer_id, 'status', t.status,
      'word_length', t.word_length, 'pattern', v_pattern,
      'select_ends_at', t.select_ends_at, 'started_at', t.started_at, 'ends_at', t.ends_at,
      'ended_at', t.ended_at, 'end_reason', t.end_reason,
      'revealed_word', t.revealed_word, 'word_changed', t.word_changed, 'hint_times', v_hint_times,
      'my_word', case when t.drawer_id = me.id then s.word end,
      'candidates', case when t.drawer_id = me.id and t.status = 'WORD_SELECT' then
                      (select jsonb_agg(jsonb_build_object('text', c->>'text', 'difficulty', c->>'difficulty') order by o)
                       from jsonb_array_elements(s.candidates) with ordinality as e(c, o))
                    end,
      'can_change_word', t.drawer_id = me.id and t.status = 'DRAWING' and not t.word_changed
                         and not exists (select 1 from public.strokes st where st.turn_id = t.id),
      'guesses', coalesce((select jsonb_agg(jsonb_build_object(
                             'player_id', gu.player_id, 'points', gu.points, 'order', gu.guess_order)
                             order by gu.guess_order)
                           from public.guesses gu where gu.turn_id = t.id), '[]'::jsonb),
      'drawer_points', coalesce((select sum(gu.drawer_points) from public.guesses gu where gu.turn_id = t.id), 0)
    );
  end if;

  if r.current_game_id is not null then
    select * into g from public.games where id = r.current_game_id;
    v_game := jsonb_build_object('id', g.id, 'started_at', g.started_at, 'ended_at', g.ended_at,
                                 'final_results', g.final_results,
                                 'turns_in_round', (select count(*) from public.players
                                                    where room_id = r.id and left_at is null));
  end if;

  return jsonb_build_object(
    'membership', 'active',
    'server_now', now(),
    'me', me.id,
    'room', jsonb_build_object(
      'id', r.id, 'code', r.code, 'status', r.status, 'host_player_id', r.host_player_id,
      'settings', jsonb_build_object('draw_time', r.draw_time, 'total_rounds', r.total_rounds,
                                     'difficulty', r.difficulty, 'hints_enabled', r.hints_enabled),
      'current_round', r.current_round, 'phase_ends_at', r.phase_ends_at, 'version', r.version),
    'players', v_players,
    'turn', v_turn,
    'game', v_game
  );
end
$$;

-- =====================================================================
-- 실행 권한
-- =====================================================================
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'game\_%' or p.proname like '\_%' or p.proname = 'cleanup_expired_rooms')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end
$$;

revoke all on function public.get_room_state(text) from public, anon;
revoke all on function public.heartbeat(uuid) from public, anon;
grant execute on function public.get_room_state(text) to authenticated;
grant execute on function public.heartbeat(uuid) to authenticated;

-- RLS 정책에서 사용하는 함수 (authenticated 에서 실행 가능해야 함)
revoke all on function public.my_player_id(uuid) from public, anon;
revoke all on function public.is_room_member(uuid) from public, anon;
revoke all on function public.can_see_solved(uuid) from public, anon;
revoke all on function public.can_draw(uuid) from public, anon;
revoke all on function public.rt_can_access(text, text, boolean) from public, anon;
grant execute on function public.my_player_id(uuid) to authenticated;
grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.can_see_solved(uuid) to authenticated;
grant execute on function public.can_draw(uuid) to authenticated;
grant execute on function public.rt_can_access(text, text, boolean) to authenticated;
grant execute on function public.normalize_answer(text) to authenticated, service_role;
