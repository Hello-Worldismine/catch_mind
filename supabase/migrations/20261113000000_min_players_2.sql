-- =====================================================================
-- 최소 시작 인원 4명 → 2명으로 변경 (game_start 만 교체)
-- =====================================================================
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
  if v_active < 2 then raise exception 'NOT_ENOUGH_PLAYERS'; end if;
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

revoke all on function public.game_start(uuid, uuid) from public, anon, authenticated;
grant execute on function public.game_start(uuid, uuid) to service_role;
