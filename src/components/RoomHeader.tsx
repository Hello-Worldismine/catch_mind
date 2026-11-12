import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, LogOut, Share2, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react';
import { Logo } from './common';
import { api } from '../lib/api';
import { isMuted, setMuted } from '../lib/sound';
import { useRoom } from '../store/roomStore';
import { toast } from '../store/toastStore';

export function inviteLink(code: string) {
  return `${window.location.origin}/room/${code}`;
}

export async function copyInvite(code: string) {
  const link = inviteLink(code);
  try {
    await navigator.clipboard.writeText(link);
    toast('📋 초대 링크를 복사했어요! 친구에게 보내 주세요', 'success');
  } catch {
    window.prompt('아래 링크를 복사해 친구에게 보내 주세요', link);
  }
}

export function SoundToggle() {
  const [muted, setM] = useState(isMuted());
  return (
    <button
      className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-ink ring-2 ring-ink/10 transition hover:bg-cream active:scale-90"
      onClick={() => {
        setMuted(!muted);
        setM(!muted);
      }}
      aria-label={muted ? '소리 켜기' : '소리 끄기'}
      title={muted ? '소리 켜기' : '소리 끄기'}
    >
      {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
    </button>
  );
}

export function LeaveButton({ compact }: { compact?: boolean }) {
  const navigate = useNavigate();
  const roomId = useRoom((s) => s.state?.room.id);
  const status = useRoom((s) => s.state?.room.status);
  const leave = async () => {
    const inGame = status && status !== 'WAITING' && status !== 'GAME_RESULT';
    if (inGame && !window.confirm('게임 중이에요. 정말 나갈까요?')) return;
    if (roomId) await api.leaveRoom(roomId).catch(() => {});
    navigate('/');
  };
  return (
    <button
      className={`flex h-10 items-center gap-1.5 rounded-2xl bg-white px-3 font-display text-ink ring-2 ring-ink/10 transition hover:bg-[#FFE4E4] hover:text-[#B23A48] active:scale-95`}
      onClick={leave}
      aria-label="방 나가기"
      title="방 나가기"
    >
      <LogOut size={17} />
      {!compact && <span className="hidden sm:inline">나가기</span>}
    </button>
  );
}

export function ConnectionDot() {
  const ok = useRoom((s) => s.realtimeOk);
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-display ${ok ? 'bg-mint/60 text-ink/70' : 'bg-peach text-ink'}`}
      title={ok ? '실시간 연결됨' : '연결 중…'}
    >
      {ok ? <Wifi size={13} /> : <WifiOff size={13} />}
      <span className="hidden md:inline">{ok ? '연결됨' : '재연결 중'}</span>
    </span>
  );
}

export default function RoomHeader() {
  const code = useRoom((s) => s.state?.room.code ?? '');
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: '낙서팡팡에 초대할게요!', text: `방 코드 ${code}`, url: inviteLink(code) });
        return;
      } catch {
        /* 취소 */
      }
    }
    await copyInvite(code);
  };
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <a href="/" className="shrink-0" aria-label="처음으로">
        <Logo size="sm" />
      </a>
      <div className="flex items-center gap-2">
        <ConnectionDot />
        <div className="flex items-center gap-1 rounded-2xl bg-white py-1 pl-3 pr-1 ring-2 ring-ink/10">
          <span className="hidden whitespace-nowrap text-xs text-ink/50 sm:inline">방 코드</span>
          <span className="font-display text-xl tracking-[0.18em]">{code}</span>
          <button
            className="grid h-8 w-8 place-items-center rounded-xl hover:bg-cream active:scale-90"
            onClick={() => copyInvite(code)}
            title="초대 링크 복사"
            aria-label="초대 링크 복사"
          >
            <Copy size={16} />
          </button>
          <button
            className="grid h-8 w-8 place-items-center rounded-xl hover:bg-cream active:scale-90 sm:hidden"
            onClick={share}
            aria-label="공유하기"
          >
            <Share2 size={16} />
          </button>
        </div>
        <SoundToggle />
        <LeaveButton />
      </div>
    </header>
  );
}
