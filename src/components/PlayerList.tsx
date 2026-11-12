import { useEffect, useRef, useState } from 'react';
import { Crown, Pencil } from 'lucide-react';
import Avatar from '../characters/Avatar';
import { useRoom } from '../store/roomStore';
import type { Player } from '../types';

export function rankPlayers(players: Player[]) {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.join_order - b.join_order);
  let rank = 0;
  let prev: number | null = null;
  return sorted.map((p, i) => {
    if (p.score !== prev) {
      rank = i + 1;
      prev = p.score;
    }
    return { ...p, rank };
  });
}

/** 점수가 오르면 "+N" 이 떠오르는 애니메이션 */
function useScoreDeltas(players: Player[]) {
  const prev = useRef(new Map<string, number>());
  const [deltas, setDeltas] = useState<Record<string, { v: number; k: number }>>({});
  useEffect(() => {
    const next: Record<string, { v: number; k: number }> = {};
    for (const p of players) {
      const before = prev.current.get(p.id);
      if (before !== undefined && p.score > before) next[p.id] = { v: p.score - before, k: Date.now() };
      prev.current.set(p.id, p.score);
    }
    if (Object.keys(next).length) {
      setDeltas((d) => ({ ...d, ...next }));
      const t = window.setTimeout(() => {
        setDeltas((d) => {
          const c = { ...d };
          for (const id of Object.keys(next)) if (c[id]?.k === next[id].k) delete c[id];
          return c;
        });
      }, 1700);
      return () => window.clearTimeout(t);
    }
  }, [players]);
  return deltas;
}

export default function PlayerList({ className = '' }: { className?: string }) {
  const state = useRoom((s) => s.state)!;
  const online = useRoom((s) => s.online);
  const realtimeOk = useRoom((s) => s.realtimeOk);
  const turn = state.turn;
  const ranked = rankPlayers(state.players);
  const deltas = useScoreDeltas(state.players);

  return (
    <aside className={`card scroll-soft flex gap-2 overflow-x-auto p-2 lg:flex-col lg:overflow-y-auto lg:overflow-x-visible ${className}`} aria-label="참가자 점수">
      {ranked.map((p) => {
        const drawing = turn?.drawer_id === p.id && turn.status !== 'DONE';
        const isMe = p.id === state.me;
        const isOnline = !realtimeOk || online.size === 0 || online.has(p.id);
        const delta = deltas[p.id];
        return (
          <div
            key={p.id}
            className={`relative flex min-w-[150px] items-center gap-2 rounded-2xl px-2 py-1.5 transition-colors lg:min-w-0 ${
              drawing ? 'bg-butter/70' : p.solved ? 'bg-mint/60' : 'bg-cream/70'
            } ${isMe ? 'ring-2 ring-bubble/60' : ''}`}
          >
            <span className={`w-5 shrink-0 text-center font-display ${p.rank === 1 ? 'text-[#E0A800]' : 'text-ink/45'}`}>
              {p.rank}
            </span>
            <div className="relative shrink-0">
              <Avatar id={p.character} size={40} happy={p.solved || drawing} className={!isOnline ? 'opacity-40 grayscale' : ''} />
              {drawing && (
                <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-white shadow ring-1 ring-ink/10">
                  <Pencil size={11} className="animate-wiggle" />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 truncate font-display text-[15px] leading-tight">
                {p.is_host && <Crown size={13} className="shrink-0 fill-butter text-[#E0A800]" />}
                <span className="truncate">{p.nickname}</span>
                {isMe && <span className="text-[11px] text-bubble">(나)</span>}
              </p>
              <p className="whitespace-nowrap text-[13px] leading-tight text-ink/60">
                <span className="font-display text-ink">{p.score.toLocaleString()}</span>점
                {drawing && <span className="ml-1 text-[11px] text-[#B98500]">그리는 중</span>}
                {p.solved && !drawing && <span className="ml-1 text-[11px] text-mint-dark">정답!</span>}
              </p>
            </div>
            {delta && (
              <span
                key={delta.k}
                className="animate-score-up pointer-events-none absolute right-2 top-0 rounded-full bg-bubble px-2 py-0.5 font-display text-sm text-white shadow"
              >
                +{delta.v}
              </span>
            )}
          </div>
        );
      })}
    </aside>
  );
}
