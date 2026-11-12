-- =====================================================================
-- 낙서팡팡 : 스키마 / 인덱스 / RLS / Realtime
-- =====================================================================
-- 설계 원칙
--  * 모든 게임 상태 변경은 service_role 만 실행할 수 있는 game_* 함수(Edge Function 경유)로만 수행
--  * 브라우저(anon/authenticated)는 RLS 로 "자기 방" 데이터만 읽을 수 있음
--  * 제시어(turn_secrets)·단어 목록(words)은 어떤 클라이언트도 직접 읽을 수 없음
--  * 그림 stroke 저장만 예외적으로 클라이언트 INSERT 허용 (RLS 로 "현재 출제자"만 허용)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 제시어
-- ---------------------------------------------------------------------
create table if not exists public.words (
  id          bigint generated always as identity primary key,
  text        text not null unique,
  difficulty  text not null check (difficulty in ('easy', 'normal', 'hard')),
  aliases     text[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists words_difficulty_idx on public.words (difficulty);

-- ---------------------------------------------------------------------
-- 방
-- ---------------------------------------------------------------------
create table if not exists public.rooms (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_player_id    uuid,
  status            text not null default 'WAITING'
                    check (status in ('WAITING', 'WORD_SELECT', 'DRAWING', 'ROUND_RESULT', 'GAME_RESULT', 'CLOSED')),
  -- 설정
  draw_time         int  not null default 90 check (draw_time in (60, 90, 120)),
  total_rounds      int  not null default 3  check (total_rounds in (2, 3, 5)),
  difficulty        text not null default 'random' check (difficulty in ('easy', 'normal', 'hard', 'random')),
  hints_enabled     boolean not null default true,
  -- 진행 상태
  current_game_id   uuid,
  current_round     int not null default 0,
  current_turn_id   uuid,
  phase_ends_at     timestamptz,          -- 서버 기준 현재 단계 마감 시각
  version           bigint not null default 0,  -- 상태가 바뀔 때마다 +1 (클라이언트 재조회 트리거)
  created_at        timestamptz not null default now(),
  last_activity_at  timestamptz not null default now()
);
create index if not exists rooms_last_activity_idx on public.rooms (last_activity_at);

-- ---------------------------------------------------------------------
-- 참가자 (Supabase Anonymous Auth 의 user id 로 식별)
-- ---------------------------------------------------------------------
create table if not exists public.players (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  nickname    text not null check (char_length(nickname) between 1 and 12),
  character   text not null,
  is_ready    boolean not null default false,
  score       int not null default 0,
  join_order  int not null,
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,
  unique (room_id, user_id)
);
create index if not exists players_room_idx on public.players (room_id) where left_at is null;
create index if not exists players_user_idx on public.players (user_id);

alter table public.rooms
  drop constraint if exists rooms_host_fk,
  add constraint rooms_host_fk foreign key (host_player_id) references public.players (id) on delete set null;

-- 접속 상태(heartbeat) - 자주 갱신되므로 players 와 분리 (Realtime 이벤트 폭주 방지)
create table if not exists public.player_presence (
  player_id     uuid primary key references public.players (id) on delete cascade,
  room_id       uuid not null references public.rooms (id) on delete cascade,
  last_seen_at  timestamptz not null default now()
);
create index if not exists player_presence_room_idx on public.player_presence (room_id, last_seen_at);

-- ---------------------------------------------------------------------
-- 게임 / 턴(문제)
-- ---------------------------------------------------------------------
create table if not exists public.games (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms (id) on delete cascade,
  total_rounds   int not null,
  draw_time      int not null,
  difficulty     text not null,
  hints_enabled  boolean not null,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  final_results  jsonb
);
create index if not exists games_room_idx on public.games (room_id);

create table if not exists public.turns (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms (id) on delete cascade,
  game_id         uuid not null references public.games (id) on delete cascade,
  round           int not null,
  turn_no         int not null,
  drawer_id       uuid references public.players (id) on delete set null,
  status          text not null check (status in ('WORD_SELECT', 'DRAWING', 'ROUND_RESULT', 'DONE')),
  word_length     int,              -- 공개 정보 (글자 수 힌트)
  revealed_word   text,             -- 문제가 끝난 뒤에만 채워짐
  word_changed    boolean not null default false,
  select_ends_at  timestamptz,
  started_at      timestamptz,
  ends_at         timestamptz,
  ended_at        timestamptz,
  end_reason      text check (end_reason in ('all_guessed', 'timeout', 'skipped', 'drawer_left', 'game_aborted')),
  created_at      timestamptz not null default now(),
  unique (game_id, turn_no)
);
create index if not exists turns_room_idx on public.turns (room_id, created_at desc);
create index if not exists turns_game_round_idx on public.turns (game_id, round, drawer_id);

alter table public.rooms
  drop constraint if exists rooms_current_game_fk,
  add constraint rooms_current_game_fk foreign key (current_game_id) references public.games (id) on delete set null,
  drop constraint if exists rooms_current_turn_fk,
  add constraint rooms_current_turn_fk foreign key (current_turn_id) references public.turns (id) on delete set null;

-- 비밀 정답: 어떤 클라이언트도 SELECT 불가 (정책 없음). get_room_state() 가 출제자에게만 전달.
create table if not exists public.turn_secrets (
  turn_id     uuid primary key references public.turns (id) on delete cascade,
  room_id     uuid not null references public.rooms (id) on delete cascade,
  candidates  jsonb not null,               -- [{id, text, difficulty}]
  word_id     bigint references public.words (id) on delete set null,
  word        text
);
create index if not exists turn_secrets_room_word_idx on public.turn_secrets (room_id, word_id);

-- 정답 기록 = 점수 원장. (turn_id, player_id) UNIQUE 로 중복 적립 원천 차단
create table if not exists public.guesses (
  id             bigint generated always as identity primary key,
  turn_id        uuid not null references public.turns (id) on delete cascade,
  room_id        uuid not null references public.rooms (id) on delete cascade,
  player_id      uuid not null references public.players (id) on delete cascade,
  points         int not null,
  drawer_points  int not null default 0,
  guess_order    int not null,
  created_at     timestamptz not null default now(),
  unique (turn_id, player_id)
);
create index if not exists guesses_room_idx on public.guesses (room_id);

-- ---------------------------------------------------------------------
-- 채팅 / 시스템 메시지
-- ---------------------------------------------------------------------
create table if not exists public.messages (
  id                bigint generated always as identity primary key,
  room_id           uuid not null references public.rooms (id) on delete cascade,
  turn_id           uuid references public.turns (id) on delete set null,
  player_id         uuid references public.players (id) on delete set null,
  nickname          text,
  character         text,
  kind              text not null check (kind in ('chat', 'system', 'correct', 'close')),
  body              text not null,
  visibility        text not null default 'all' check (visibility in ('all', 'solved', 'private')),
  target_player_id  uuid,
  created_at        timestamptz not null default now()
);
create index if not exists messages_room_idx on public.messages (room_id, id desc);
create index if not exists messages_player_recent_idx on public.messages (player_id, created_at desc);

-- ---------------------------------------------------------------------
-- 그림 데이터 (좌표 기반 stroke 연산 로그: stroke / undo / redo / clear)
-- ---------------------------------------------------------------------
create table if not exists public.strokes (
  id          bigint generated always as identity primary key,
  turn_id     uuid not null references public.turns (id) on delete cascade,
  seq         int not null check (seq >= 0 and seq < 100000),
  op          jsonb not null check (pg_column_size(op) <= 65536),
  created_at  timestamptz not null default now(),
  unique (turn_id, seq)
);

-- =====================================================================
-- RLS 도우미 (SECURITY DEFINER: 정책 안에서 재귀 없이 멤버십 확인)
-- =====================================================================
create or replace function public.my_player_id(p_room uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.players
  where room_id = p_room and user_id = auth.uid() and left_at is null
  limit 1
$$;

create or replace function public.is_room_member(p_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.players
    where room_id = p_room and user_id = auth.uid() and left_at is null
  )
$$;

-- 'solved' 메시지(정답자끼리의 채팅)는 출제자와 정답자만 볼 수 있음
create or replace function public.can_see_solved(p_turn uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.turns t
    join public.players p on p.room_id = t.room_id and p.user_id = auth.uid() and p.left_at is null
    where t.id = p_turn
      and (t.drawer_id = p.id
           or t.status in ('ROUND_RESULT', 'DONE')
           or exists (select 1 from public.guesses g where g.turn_id = t.id and g.player_id = p.id))
  )
$$;

-- 현재 출제자만, 그리는 중(DRAWING)에만 stroke 저장 가능
create or replace function public.can_draw(p_turn uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.turns t
    join public.players p on p.id = t.drawer_id
    where t.id = p_turn
      and t.status = 'DRAWING'
      and p.user_id = auth.uid()
      and p.left_at is null
      and now() < t.ends_at + interval '3 seconds'
  )
$$;

-- Realtime Authorization (private channel)
--   room:<room_id>  → 방 멤버만 구독/Presence
--   draw:<turn_id>  → 방 멤버만 수신, 해당 턴의 출제자만 broadcast 송신
create or replace function public.rt_can_access(p_topic text, p_extension text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid;
  v_room uuid;
  v_drawer uuid;
begin
  if p_topic ~ '^room:[0-9a-f-]{36}$' then
    v_id := substr(p_topic, 6)::uuid;
    if p_write and p_extension is distinct from 'presence' then
      return false;
    end if;
    return public.is_room_member(v_id);
  elsif p_topic ~ '^draw:[0-9a-f-]{36}$' then
    v_id := substr(p_topic, 6)::uuid;
    select room_id, drawer_id into v_room, v_drawer from public.turns where id = v_id;
    if v_room is null then
      return false;
    end if;
    if not p_write then
      return public.is_room_member(v_room);
    end if;
    return p_extension = 'broadcast' and v_drawer is not null and v_drawer = public.my_player_id(v_room);
  end if;
  return false;
end
$$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.words           enable row level security;
alter table public.rooms           enable row level security;
alter table public.players         enable row level security;
alter table public.player_presence enable row level security;
alter table public.games           enable row level security;
alter table public.turns           enable row level security;
alter table public.turn_secrets    enable row level security;
alter table public.guesses         enable row level security;
alter table public.messages        enable row level security;
alter table public.strokes         enable row level security;

drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms for select to authenticated
  using (public.is_room_member(id));

drop policy if exists players_select on public.players;
create policy players_select on public.players for select to authenticated
  using (public.is_room_member(room_id));

drop policy if exists games_select on public.games;
create policy games_select on public.games for select to authenticated
  using (public.is_room_member(room_id));

drop policy if exists turns_select on public.turns;
create policy turns_select on public.turns for select to authenticated
  using (public.is_room_member(room_id));

drop policy if exists guesses_select on public.guesses;
create policy guesses_select on public.guesses for select to authenticated
  using (public.is_room_member(room_id));

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (
    public.is_room_member(room_id)
    and (
      visibility = 'all'
      or (visibility = 'private' and target_player_id = public.my_player_id(room_id))
      or (visibility = 'solved' and public.can_see_solved(turn_id))
    )
  );

drop policy if exists strokes_select on public.strokes;
create policy strokes_select on public.strokes for select to authenticated
  using (exists (select 1 from public.turns t where t.id = turn_id and public.is_room_member(t.room_id)));

drop policy if exists strokes_insert on public.strokes;
create policy strokes_insert on public.strokes for insert to authenticated
  with check (public.can_draw(turn_id));

-- words, turn_secrets, player_presence : 정책 없음 → 클라이언트 접근 불가

-- 쓰기 권한 최소화 (RLS 와 이중 방어)
revoke insert, update, delete, truncate on
  public.words, public.rooms, public.players, public.player_presence, public.games,
  public.turns, public.turn_secrets, public.guesses, public.messages, public.strokes
  from anon, authenticated;
revoke select on public.words, public.turn_secrets, public.player_presence from anon, authenticated;
revoke all on public.rooms, public.players, public.games, public.turns, public.guesses,
  public.messages, public.strokes from anon;
grant select on public.rooms, public.players, public.games, public.turns, public.guesses,
  public.messages, public.strokes to authenticated;
grant insert on public.strokes to authenticated;

-- Realtime Authorization 정책 (private channel)
drop policy if exists doodle_rt_select on realtime.messages;
create policy doodle_rt_select on realtime.messages for select to authenticated
  using (public.rt_can_access(realtime.topic(), realtime.messages.extension, false));

drop policy if exists doodle_rt_insert on realtime.messages;
create policy doodle_rt_insert on realtime.messages for insert to authenticated
  with check (public.rt_can_access(realtime.topic(), realtime.messages.extension, true));

-- =====================================================================
-- Realtime (Postgres Changes) 발행 테이블
--   rooms.version 이 모든 상태 변경마다 증가하므로 rooms 만 구독해도 재조회 트리거로 충분
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms') then
      alter publication supabase_realtime add table public.rooms;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
      alter publication supabase_realtime add table public.messages;
    end if;
  end if;
end
$$;
