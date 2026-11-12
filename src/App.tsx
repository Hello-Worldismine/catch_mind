import { lazy, Suspense } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import RoomPage from './pages/RoomPage';
import { Logo, Toasts } from './components/common';
import { isConfigured } from './lib/supabase';

const PreviewPage = import.meta.env.DEV ? lazy(() => import('./dev/PreviewPage')) : null;

function SetupNotice() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-5 px-4">
      <Logo />
      <div className="card p-6">
        <h1 className="font-display text-2xl">🔧 Supabase 연결이 필요해요</h1>
        <p className="mt-2 text-ink/70">
          프로젝트 루트에 <code className="rounded bg-cream px-1.5">.env</code> 파일을 만들고 아래 값을 넣은 뒤 다시 실행해 주세요.
          (Netlify 에서는 Site settings → Environment variables)
        </p>
        <pre className="mt-3 overflow-x-auto rounded-2xl bg-ink p-4 text-sm text-white">
{`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`}
        </pre>
        <p className="mt-3 text-sm text-ink/60">자세한 설정 방법은 README.md 를 확인하세요.</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <Toasts />
      <Routes>
        {PreviewPage && (
          <Route
            path="/__preview"
            element={
              <Suspense fallback={null}>
                <PreviewPage />
              </Suspense>
            }
          />
        )}
        <Route path="/" element={isConfigured ? <HomePage /> : <SetupNotice />} />
        <Route path="/room/:code" element={isConfigured ? <RoomPage /> : <SetupNotice />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
