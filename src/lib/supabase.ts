import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as
  | string
  | undefined;

export const isConfigured = Boolean(url && key);

// 브라우저에는 publishable(anon) 키만 사용합니다. service_role / secret 키는 Edge Function 에만 존재.
export const supabase: SupabaseClient = isConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'nakseo-auth' },
      realtime: { params: { eventsPerSecond: 30 } },
    })
  : (null as unknown as SupabaseClient);

let sessionPromise: Promise<string> | null = null;

/** 익명 로그인 세션 확보 (localStorage 에 저장 → 새로고침해도 같은 참가자로 복귀) */
export function ensureSession(): Promise<string> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { data } = await supabase.auth.getSession();
      let session = data.session;
      if (!session) {
        const res = await supabase.auth.signInAnonymously();
        if (res.error || !res.data.session) throw res.error ?? new Error('ANON_SIGNIN_FAILED');
        session = res.data.session;
      }
      await supabase.realtime.setAuth(session.access_token);
      return session.user.id;
    })().catch((e) => {
      sessionPromise = null;
      throw e;
    });
  }
  return sessionPromise;
}

if (isConfigured) {
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) void supabase.realtime.setAuth(session.access_token);
  });
}
