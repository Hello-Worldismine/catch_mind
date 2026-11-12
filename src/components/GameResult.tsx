import { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { Home, RotateCcw } from 'lucide-react';
import Avatar from '../characters/Avatar';
import Chat from './Chat';
import RoomHeader from './RoomHeader';
import { rankPlayers } from './PlayerList';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { play } from '../lib/sound';
import { useRoom } from '../store/roomStore';
import { toast } from '../store/toastStore';
import type { CharacterId } from '../characters/list';

interface Row {
  id: string;
  nickname: string;
  character: CharacterId;
  score: number;
  rank: number;
}

export default function GameResult() {
  const state = useRoom((s) => s.state)!;
  const isHost = state.room.host_player_id === state.me;
  const [busy, setBusy] = useState(false);

  // 최종 결과 스냅샷이 있으면 사용 (게임 종료 시점 순위), 없으면 현재 점수로 계산
  const rows: Row[] =
    state.game?.final_results?.map((r) => ({
      id: r.player_id,
      nickname: r.nickname,
      character: r.character,
      score: r.score,
      rank: r.rank,
    })) ?? rankPlayers(state.players);

  const winners = rows.filter((r) => r.rank === 1);
  const iWon = winners.some((w) => w.id === state.me);

  useEffect(() => {
    play('fanfare');
    const colors = ['#FF7FA8', '#FFE38A', '#A8ECD0', '#B9E0FF', '#DDD0FF', '#FFB347'];
    const end = Date.now() + 2200;
    let raf = 0;
    const frame = () => {
      confetti({ particleCount: 4, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors });
      confetti({ particleCount: 4, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors });
      if (Date.now() < end) raf = requestAnimationFrame(frame);
    };
    confetti({ particleCount: 120, spread: 90, origin: { y: 0.45 }, colors, scalar: 1.1 });
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [state.game?.id]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  // 시상대: 공동 순위 고려해서 1·2·3등 자리를 채움
  const podium = [rows[1], rows[0], rows[2]];
  const heights = ['h-28', 'h-40', 'h-20'];
  const tones = ['bg-sky', 'bg-butter', 'bg-peach'];

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-4 px-3 py-4 sm:px-5">
      <RoomHeader />
      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="card animate-slide-up flex flex-col items-center p-5">
          <p className="font-display text-lg text-ink/60">게임 끝!</p>
          <h1 className="mt-1 text-center font-display text-3xl sm:text-4xl">
            {iWon ? '🎉 내가 우승했어요! 🎉' : `🏆 ${winners.map((w) => w.nickname).join(', ')}님 우승!`}
          </h1>

          <div className="mt-6 flex w-full max-w-lg items-end justify-center gap-2 sm:gap-4">
            {podium.map((r, i) =>
              r ? (
                <div key={r.id} className="animate-slide-up flex w-1/3 flex-col items-center" style={{ animationDelay: `${[0.3, 0.1, 0.5][i]}s` }}>
                  {r.rank === 1 && <span className="animate-bounce-soft text-3xl">👑</span>}
                  <Avatar id={r.character} size={i === 1 ? 92 : 72} happy className={r.rank === 1 ? 'animate-float' : ''} />
                  <p className="mt-1 max-w-full truncate font-display text-lg">{r.nickname}</p>
                  <p className="font-display text-bubble-dark">{r.score.toLocaleString()}점</p>
                  <div className={`mt-1 flex w-full items-start justify-center rounded-t-3xl pt-2 font-display text-3xl text-white ${heights[i]} ${tones[i]}`}
                    style={{ textShadow: '0 2px 0 rgba(74,59,92,0.25)' }}>
                    {r.rank}
                  </div>
                </div>
              ) : (
                <div key={`empty-${i}`} className="w-1/3" />
              ),
            )}
          </div>

          <ol className="mt-6 flex w-full max-w-lg flex-col gap-1.5">
            {rows.map((r, i) => (
              <li
                key={r.id}
                className={`animate-slide-up flex items-center gap-3 rounded-2xl px-3 py-2 ${r.id === state.me ? 'bg-bubble/15 ring-2 ring-bubble/40' : 'bg-cream'}`}
                style={{ animationDelay: `${0.5 + i * 0.05}s` }}
              >
                <span className="w-8 text-center font-display text-xl">{['🥇', '🥈', '🥉'][r.rank - 1] ?? r.rank}</span>
                <Avatar id={r.character} size={36} />
                <span className="flex-1 truncate font-display text-lg">{r.nickname}</span>
                <span className="font-display text-lg">{r.score.toLocaleString()}점</span>
              </li>
            ))}
          </ol>

          <div className="mt-6 flex w-full max-w-lg flex-col gap-2 sm:flex-row">
            {isHost ? (
              <>
                <button className="btn btn-primary flex-1 py-4 text-xl" disabled={busy} onClick={() => run(() => api.startGame(state.room.id))}>
                  <RotateCcw size={20} /> 다시 하기
                </button>
                <button className="btn btn-white flex-1 py-4 text-xl" disabled={busy} onClick={() => run(() => api.returnLobby(state.room.id))}>
                  <Home size={20} /> 대기실로
                </button>
              </>
            ) : (
              <p className="w-full rounded-2xl bg-cream px-4 py-3 text-center font-display text-ink/60">
                방장이 <b className="text-ink">다시 하기</b> 또는 <b className="text-ink">대기실로</b>를 고를 때까지 기다려 주세요 ☕
              </p>
            )}
          </div>
        </section>
        <Chat className="h-[360px] lg:h-auto lg:max-h-[calc(100dvh-110px)]" />
      </div>
    </div>
  );
}
