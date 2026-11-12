import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DoorOpen, Sparkles } from 'lucide-react';
import { Logo } from '../components/common';
import ProfileForm from '../components/ProfileForm';
import Avatar from '../characters/Avatar';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { saveProfile, type Profile } from '../lib/profile';

export default function HomePage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (p: Profile) => {
    setBusy(true);
    setError(null);
    try {
      saveProfile(p);
      const res =
        mode === 'create'
          ? await api.createRoom(p.nickname, p.character)
          : await api.joinRoom(code.trim().toUpperCase(), p.nickname, p.character);
      navigate(`/room/${res.code}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const codeValid = /^[A-Z0-9]{6}$/.test(code.trim().toUpperCase());

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col items-center px-4 py-8 sm:py-12">
      <header className="relative mb-6 flex flex-col items-center text-center">
        <div className="pointer-events-none absolute -left-24 -top-2 hidden sm:block animate-float" style={{ animationDelay: '0.4s' }}>
          <Avatar id="bunny" size={70} happy />
        </div>
        <div className="pointer-events-none absolute -right-24 top-6 hidden sm:block animate-float" style={{ animationDelay: '1.1s' }}>
          <Avatar id="frog" size={64} happy />
        </div>
        <Logo />
        <p className="mt-3 font-display text-lg text-ink/70 sm:text-xl">
          친구들과 함께 <span className="text-bubble">그리고</span> <span className="text-sky-dark">맞히는</span> 실시간 그림 퀴즈!
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <span className="chip bg-butter/70">👥 4~10명</span>
          <span className="chip bg-mint/70">✨ 회원가입 없이 바로</span>
          <span className="chip bg-sky/70">📱 PC · 모바일</span>
        </div>
      </header>

      <main className="card animate-slide-up w-full max-w-xl p-5 sm:p-7">
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-cream p-1.5">
          {(
            [
              ['create', '새 방 만들기', <Sparkles key="s" size={18} />],
              ['join', '코드로 참가', <DoorOpen key="d" size={18} />],
            ] as const
          ).map(([m, label, icon]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 font-display text-lg transition ${
                mode === m ? 'bg-white text-bubble-dark shadow-[0_3px_0_0_rgba(74,59,92,0.12)]' : 'text-ink/50 hover:text-ink'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        <ProfileForm
          busy={busy || (mode === 'join' && !codeValid)}
          error={error}
          submitLabel={mode === 'create' ? '🎨 방 만들기' : '🚪 참가하기'}
          onSubmit={submit}
          extra={
            mode === 'join' ? (
              <div className="animate-pop-in">
                <label htmlFor="code" className="mb-2 flex items-center gap-2 font-display text-lg">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-mint-dark text-sm text-white">3</span>
                  방 코드를 입력해요
                </label>
                <input
                  id="code"
                  className="input text-center font-display text-2xl tracking-[0.4em] uppercase"
                  placeholder="ABC123"
                  maxLength={6}
                  value={code}
                  autoComplete="off"
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                />
              </div>
            ) : null
          }
        />
      </main>

      <section className="mt-8 grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { e: '🏠', t: '방 만들기', d: '방을 만들고 초대 링크를 친구들에게 보내요' },
          { e: '🖌️', t: '그리기', d: '내 차례엔 제시어를 그림으로 표현해요' },
          { e: '💬', t: '맞히기', d: '채팅창에 정답을 빨리 쓸수록 점수가 높아요' },
        ].map((s, i) => (
          <div key={s.t} className="card animate-slide-up flex items-start gap-3 p-4" style={{ animationDelay: `${0.1 + i * 0.08}s` }}>
            <span className="text-3xl">{s.e}</span>
            <div>
              <h3 className="font-display text-lg">{s.t}</h3>
              <p className="text-sm text-ink/65">{s.d}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
