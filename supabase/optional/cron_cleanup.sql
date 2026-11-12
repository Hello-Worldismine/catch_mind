-- (선택) 만료된 방을 10분마다 자동 정리
-- 1) Supabase 대시보드 → Database → Extensions 에서 "pg_cron" 활성화
-- 2) SQL Editor 에서 아래 실행
-- ※ 이 작업을 하지 않아도, 새 방이 만들어질 때마다 cleanup_expired_rooms() 가 자동으로 호출됩니다.

select cron.schedule(
  'nakseo-cleanup-rooms',
  '*/10 * * * *',
  $$ select public.cleanup_expired_rooms(); $$
);

-- 해제하려면: select cron.unschedule('nakseo-cleanup-rooms');
