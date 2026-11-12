import { Link, useParams } from 'react-router-dom';
import Lobby from '../components/Lobby';
import GameView from '../components/GameView';
import GameResult from '../components/GameResult';
import ProfileForm from '../components/ProfileForm';
import { Logo, Spinner } from '../components/common';
import Avatar from '../characters/Avatar';
import { useRoomConnection } from '../hooks/useRoomConnection';
import { useRoom } from '../store/roomStore';

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-5 px-4 py-8">
      <Link to="/">
        <Logo size="sm" />
      </Link>
      <div className="card animate-pop-in w-full p-6 text-center">{children}</div>
    </div>
  );
}

function Problem({ emoji, title, desc }: { emoji: string; title: string; desc: string }) {
  return (
    <CenterCard>
      <div className="text-5xl">{emoji}</div>
      <h1 className="mt-2 font-display text-2xl">{title}</h1>
      <p className="mt-1 text-ink/60">{desc}</p>
      <Link to="/" className="btn btn-primary mt-5 w-full">
        처음으로 돌아가기
      </Link>
    </CenterCard>
  );
}

export default function RoomPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const { join } = useRoomConnection(code);
  const status = useRoom((s) => s.status);
  const errorText = useRoom((s) => s.errorText);
  const phase = useRoom((s) => s.state?.room.status);

  if (status === 'not_found') return <Problem emoji="🔍" title="방을 찾을 수 없어요" desc={`코드 ${code} 를 다시 확인해 주세요.`} />;
  if (status === 'closed') return <Problem emoji="🚪" title="이미 닫힌 방이에요" desc="새 방을 만들어 친구들을 초대해 보세요!" />;
  if (status === 'full') return <Problem emoji="🙈" title="방이 꽉 찼어요" desc="한 방에는 최대 10명까지 들어갈 수 있어요." />;
  if (status === 'error')
    return (
      <CenterCard>
        <div className="text-5xl">📡</div>
        <h1 className="mt-2 font-display text-2xl">연결에 문제가 생겼어요</h1>
        <p className="mt-1 text-ink/60">{errorText}</p>
        <button className="btn btn-primary mt-5 w-full" onClick={() => window.location.reload()}>
          다시 시도
        </button>
      </CenterCard>
    );

  if (status === 'need_profile' || status === 'joining') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 px-4 py-8">
        <Link to="/">
          <Logo size="sm" />
        </Link>
        <div className="card animate-pop-in w-full p-5 sm:p-7">
          <div className="mb-5 flex items-center gap-3 rounded-3xl bg-butter/50 p-3">
            <Avatar id="chick" size={48} happy className="animate-bounce-soft" />
            <div>
              <p className="font-display text-xl">친구가 초대했어요!</p>
              <p className="text-sm text-ink/60">
                방 코드 <b className="font-display tracking-widest text-ink">{code}</b> · 캐릭터와 닉네임만 정하면 바로 입장
              </p>
            </div>
          </div>
          <ProfileForm submitLabel="🚪 입장하기" busy={status === 'joining'} error={errorText} onSubmit={join} />
        </div>
      </div>
    );
  }

  if (status === 'loading' || !phase) {
    return (
      <CenterCard>
        <Spinner label="방에 들어가는 중…" />
      </CenterCard>
    );
  }

  if (phase === 'WAITING') return <Lobby />;
  if (phase === 'GAME_RESULT') return <GameResult />;
  if (phase === 'CLOSED') return <Problem emoji="🚪" title="이미 닫힌 방이에요" desc="새 방을 만들어 보세요!" />;
  return <GameView />;
}
