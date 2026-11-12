import { useState } from 'react';
import Avatar from '../characters/Avatar';
import { useCountdown } from './common';
import { rankPlayers } from './PlayerList';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { useRoom } from '../store/roomStore';
import { toast } from '../store/toastStore';

const DIFF_STYLE = {
  easy: { label: '쉬움', cls: 'bg-mint', emoji: '🌱' },
  normal: { label: '보통', cls: 'bg-butter', emoji: '⭐' },
  hard: { label: '어려움', cls: 'bg-peach', emoji: '🔥' },
} as const;

export function WordSelectOverlay() {
  const state = useRoom((s) => s.state)!;
  const turn = state.turn!;
  const left = useCountdown(state.room.phase_ends_at);
  const drawer = state.players.find((p) => p.id === turn.drawer_id);
  const isDrawer = turn.drawer_id === state.me;
  const [picking, setPicking] = useState<number | null>(null);

  const choose = async (i: number) => {
    if (picking !== null) return;
    setPicking(i);
    try {
      await api.chooseWord(state.room.id, turn.id, i);
    } catch (e) {
      toast(errorText(e), 'error');
      setPicking(null);
    }
  };

  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-gradient-to-b from-lilac/80 to-sky/80 p-3 backdrop-blur-[2px]">
      <div className="animate-pop-in flex w-full max-w-lg flex-col items-center text-center">
        {isDrawer && turn.candidates ? (
          <>
            <p className="font-display text-2xl text-ink sm:text-3xl">🎨 그릴 단어를 골라 주세요!</p>
            <p className="mt-1 text-sm text-ink/60">{Math.ceil(left)}초 안에 고르지 않으면 자동으로 정해져요</p>
            <div className="mt-4 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-3">
              {turn.candidates.map((c, i) => {
                const d = DIFF_STYLE[c.difficulty];
                return (
                  <button
                    key={c.text}
                    onClick={() => choose(i)}
                    disabled={picking !== null}
                    className={`btn btn-white flex-col !gap-1 !py-4 ${picking === i ? 'ring-4 ring-bubble' : ''}`}
                    style={{ animationDelay: `${i * 0.06}s` }}
                  >
                    <span className={`rounded-full px-2 py-0.5 text-xs ${d.cls}`}>
                      {d.emoji} {d.label}
                    </span>
                    <span className="text-2xl">{c.text}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-white/70">
              <div className="h-full rounded-full bg-bubble transition-[width] duration-200 ease-linear" style={{ width: `${(left / 10) * 100}%` }} />
            </div>
          </>
        ) : (
          <>
            {drawer && <Avatar id={drawer.character} size={96} className="animate-bounce-soft" />}
            <p className="mt-3 font-display text-2xl text-ink sm:text-3xl">
              {drawer?.nickname ?? '출제자'}님이 단어를 고르고 있어요
            </p>
            <p className="mt-1 font-display text-lg text-ink/60">
              <span className="inline-block animate-bounce">.</span>
              <span className="inline-block animate-bounce [animation-delay:0.15s]">.</span>
              <span className="inline-block animate-bounce [animation-delay:0.3s]">.</span> {Math.ceil(left)}초
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const REASON: Record<string, string> = {
  all_guessed: '✨ 모두 정답을 맞혔어요!',
  timeout: '⏰ 시간 종료!',
  skipped: '⏭️ 문제를 건너뛰었어요',
  drawer_left: '🚪 출제자가 나갔어요',
  game_aborted: '게임이 종료됐어요',
};

export function TurnResultOverlay() {
  const state = useRoom((s) => s.state)!;
  const turn = state.turn!;
  const left = useCountdown(state.room.phase_ends_at);
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const drawer = turn.drawer_id ? byId.get(turn.drawer_id) : undefined;
  const ranked = rankPlayers(state.players).slice(0, 5);
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-white/85 p-3 backdrop-blur-sm sm:p-5">
      <div className="animate-pop-in mx-auto flex max-w-xl flex-col items-center text-center">
        <p className="font-display text-lg text-ink/60">{REASON[turn.end_reason ?? ''] ?? '문제 종료'}</p>
        {turn.revealed_word ? (
          <p className="mt-1 font-display text-3xl sm:text-4xl">
            정답은 <span className="rounded-2xl bg-butter px-3 py-0.5 text-bubble-dark">{turn.revealed_word}</span>
          </p>
        ) : (
          <p className="mt-1 font-display text-2xl">다음 문제로 넘어가요</p>
        )}
        {drawer && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-ink/60">
            <Avatar id={drawer.character} size={24} /> 출제자 <b className="font-display text-ink">{drawer.nickname}</b>
            {turn.drawer_points > 0 && <span className="font-display text-bubble-dark">+{turn.drawer_points}</span>}
          </p>
        )}

        <div className="mt-3 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-3xl bg-mint/35 p-3">
            <p className="mb-1.5 font-display">🎯 정답자</p>
            {turn.guesses.length === 0 && <p className="py-2 text-sm text-ink/50">아무도 못 맞혔어요 😢</p>}
            <ul className="flex flex-col gap-1">
              {turn.guesses.map((g) => {
                const p = byId.get(g.player_id);
                return (
                  <li key={g.player_id} className="flex items-center gap-2 rounded-xl bg-white/80 px-2 py-1 text-left">
                    <span className="w-6 text-center">{medals[g.order - 1] ?? `${g.order}`}</span>
                    {p && <Avatar id={p.character} size={26} happy />}
                    <span className="flex-1 truncate font-display">{p?.nickname ?? '나간 참가자'}</span>
                    <span className="font-display text-bubble-dark">+{g.points}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="rounded-3xl bg-lilac/40 p-3">
            <p className="mb-1.5 font-display">🏆 현재 순위</p>
            <ul className="flex flex-col gap-1">
              {ranked.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-xl bg-white/80 px-2 py-1 text-left">
                  <span className="w-6 text-center font-display text-ink/60">{p.rank}</span>
                  <Avatar id={p.character} size={26} />
                  <span className="flex-1 truncate font-display">{p.nickname}</span>
                  <span className="font-display">{p.score.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-3 font-display text-ink/50">다음 문제까지 {Math.ceil(left)}초…</p>
      </div>
    </div>
  );
}
