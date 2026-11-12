import { useEffect, useRef, useState } from 'react';
import { RefreshCw, SkipForward } from 'lucide-react';
import Avatar from '../characters/Avatar';
import DrawingBoard from '../drawing/DrawingBoard';
import Chat from './Chat';
import PlayerList from './PlayerList';
import { TurnResultOverlay, WordSelectOverlay } from './Overlays';
import { ConnectionDot, LeaveButton, SoundToggle } from './RoomHeader';
import { Logo, TimerBadge, useCountdown } from './common';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { isConfigured } from '../lib/supabase';
import { play } from '../lib/sound';
import { serverNow, useRoom } from '../store/roomStore';
import { toast } from '../store/toastStore';

function WordHint() {
  const state = useRoom((s) => s.state)!;
  const turn = state.turn;
  if (!turn) return null;
  const isDrawer = turn.drawer_id === state.me;
  const phase = state.room.status;

  if (phase === 'WORD_SELECT') {
    return <p className="font-display text-lg text-ink/60">{isDrawer ? '단어를 골라 주세요!' : '단어 고르는 중…'}</p>;
  }
  if (phase === 'ROUND_RESULT') {
    return (
      <p className="font-display text-xl">
        정답: <span className="text-bubble-dark">{turn.revealed_word ?? '-'}</span>
      </p>
    );
  }
  if (isDrawer && turn.my_word) {
    return (
      <div className="flex flex-col items-center leading-none">
        <span className="text-[11px] text-ink/50">내가 그릴 제시어</span>
        <span className="font-display text-2xl tracking-wide text-bubble-dark sm:text-3xl">{turn.my_word}</span>
      </div>
    );
  }
  const pattern = turn.pattern ?? Array.from({ length: turn.word_length ?? 0 }, () => '');
  const solved = pattern.every((c) => c !== '');
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex gap-1" aria-label={`${pattern.length}글자`}>
        {pattern.map((c, i) => (
          <span
            key={i}
            className={`grid h-9 w-8 place-items-center rounded-xl font-display text-xl sm:h-10 sm:w-9 ${
              c ? (solved ? 'bg-mint text-ink' : 'animate-pop-in bg-butter text-ink') : 'bg-cream text-ink/30'
            } ring-2 ring-ink/10`}
          >
            {c || '?'}
          </span>
        ))}
      </div>
      <span className="text-[11px] text-ink/50">{solved ? '정답을 맞혔어요! 🎉' : `${pattern.length}글자`}</span>
    </div>
  );
}

function TopBar() {
  const state = useRoom((s) => s.state)!;
  const turn = state.turn;
  const drawer = state.players.find((p) => p.id === turn?.drawer_id);
  const phase = state.room.status;
  const total =
    phase === 'DRAWING' ? state.room.settings.draw_time : phase === 'WORD_SELECT' ? 10 : 7;
  const turnsInRound = state.game?.turns_in_round ?? state.players.length;
  const doneInRound = state.players.filter((p) => p.has_drawn).length + 1;

  return (
    <header className="card flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:flex-nowrap">
      <div className="hidden xl:block">
        <Logo size="sm" />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="chip bg-lilac/60 !text-base">
          라운드 <b className="text-bubble-dark">{state.room.current_round}</b>/{state.room.settings.total_rounds}
        </span>
        <span className="chip hidden bg-cream sm:inline-flex">
          {Math.min(doneInRound, turnsInRound)}/{turnsInRound}번째
        </span>
        <span className="chip hidden bg-cream tracking-wider md:inline-flex">#{state.room.code}</span>
      </div>
      {drawer && (
        <div className="flex items-center gap-1.5">
          <Avatar id={drawer.character} size={32} happy />
          <span className="hidden max-w-[7rem] truncate font-display sm:inline">{drawer.nickname}</span>
          <span className="hidden text-sm text-ink/50 sm:inline">출제 중</span>
        </div>
      )}
      <div className="order-last flex min-w-0 flex-1 basis-full justify-center sm:order-none sm:basis-auto">
        <WordHint />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden sm:inline-flex">
          <ConnectionDot />
        </span>
        <TimerBadge endsAt={state.room.phase_ends_at} total={total} />
        <SoundToggle />
        <LeaveButton compact />
      </div>
    </header>
  );
}

function DrawerBar() {
  const state = useRoom((s) => s.state)!;
  const turn = state.turn!;
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="animate-pop-in flex flex-wrap items-center justify-between gap-2 rounded-3xl bg-butter/60 px-3 py-2 ring-2 ring-white">
      <p className="font-display text-lg">
        🎨 내 차례! <span className="text-bubble-dark">「{turn.my_word}」</span>를 그려 주세요
      </p>
      <div className="flex gap-2">
        {turn.can_change_word && (
          <button
            className="btn btn-white !px-3 !py-2 !text-sm"
            disabled={busy}
            onClick={() => run(() => api.changeWord(state.room.id, turn.id), '🔄 제시어를 바꿨어요')}
          >
            <RefreshCw size={15} /> 제시어 바꾸기
          </button>
        )}
        <button
          className="btn btn-white !px-3 !py-2 !text-sm"
          disabled={busy}
          onClick={() => {
            if (window.confirm('이 문제를 건너뛸까요?')) void run(() => api.skipTurn(state.room.id, turn.id));
          }}
        >
          <SkipForward size={15} /> 건너뛰기
        </button>
      </div>
    </div>
  );
}

function GuesserBar() {
  const state = useRoom((s) => s.state)!;
  const turn = state.turn!;
  const me = state.players.find((p) => p.id === state.me);
  const drawer = state.players.find((p) => p.id === turn.drawer_id);
  const isHost = state.room.host_player_id === state.me;
  return (
    <div className={`flex items-center justify-between gap-2 rounded-3xl px-3 py-2 ring-2 ring-white ${me?.solved ? 'bg-mint/60' : 'bg-sky/50'}`}>
      <p className="font-display text-lg">
        {me?.solved ? '🎉 정답! 다른 친구들을 기다려요' : `🤔 ${drawer?.nickname ?? '출제자'}님의 그림을 보고 맞혀 보세요!`}
      </p>
      {isHost && (
        <button
          className="btn btn-white !px-3 !py-1.5 !text-sm"
          title="방장 권한으로 건너뛰기"
          onClick={() => {
            if (window.confirm('방장 권한으로 이 문제를 건너뛸까요?'))
              api.skipTurn(state.room.id, turn.id).catch((e) => toast(errorText(e), 'error'));
          }}
        >
          <SkipForward size={14} />
        </button>
      )}
    </div>
  );
}

/** 마감 시각이 지났는지 (경계에서만 리렌더) */
function useDeadlinePassed(endsAt: string | null | undefined) {
  const calc = () => !!endsAt && Date.parse(endsAt) - serverNow() <= 0;
  const [passed, setPassed] = useState(calc);
  useEffect(() => {
    setPassed(calc());
    if (!endsAt) return;
    const wait = Date.parse(endsAt) - serverNow();
    if (wait <= 0) return;
    const t = window.setTimeout(() => setPassed(true), wait + 20);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt]);
  return passed;
}

/** 효과음: 문제 시작 / 정답 / 마지막 5초 (별도 컴포넌트라 타이머 리렌더가 화면 전체로 번지지 않음) */
function GameSounds() {
  const state = useRoom((s) => s.state)!;
  const phase = state.room.status;
  const guesses = state.turn?.guesses.length ?? 0;
  const prevPhase = useRef(phase);
  const prevGuesses = useRef(guesses);
  useEffect(() => {
    if (phase === 'DRAWING' && prevPhase.current !== 'DRAWING') play('start');
    prevPhase.current = phase;
  }, [phase]);
  useEffect(() => {
    if (guesses > prevGuesses.current) play('correct');
    prevGuesses.current = guesses;
  }, [guesses]);
  const left = Math.ceil(useCountdown(phase === 'DRAWING' ? state.room.phase_ends_at : null));
  useEffect(() => {
    if (phase === 'DRAWING' && left > 0 && left <= 5) play('tick');
  }, [left, phase]);
  return null;
}

export default function GameView({ preview = false }: { preview?: boolean }) {
  const state = useRoom((s) => s.state)!;
  const turn = state.turn;
  const phase = state.room.status;
  const isDrawer = !!turn && turn.drawer_id === state.me;
  const timeUp = useDeadlinePassed(phase === 'DRAWING' ? state.room.phase_ends_at : null);
  const canDraw = isDrawer && phase === 'DRAWING' && turn?.status === 'DRAWING' && !timeUp;

  const overlay =
    phase === 'WORD_SELECT' && turn ? <WordSelectOverlay /> : phase === 'ROUND_RESULT' && turn ? <TurnResultOverlay /> : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1500px] flex-col gap-3 p-2 sm:p-3 lg:h-dvh">
      <GameSounds />
      <TopBar />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[230px_minmax(0,1fr)_320px]">
        <PlayerList className="max-lg:max-h-[76px]" />
        <main className="flex min-h-0 flex-col items-center gap-2">
          <div className="flex w-full max-w-[min(100%,calc((100dvh-260px)*4/3))] flex-col gap-2 max-lg:max-w-none">
            {phase === 'DRAWING' && turn && (isDrawer ? <DrawerBar /> : <GuesserBar />)}
            <DrawingBoard
              key={turn?.id ?? 'none'}
              turnId={turn?.id ?? null}
              canDraw={canDraw}
              localOnly={preview || !isConfigured}
              overlay={overlay}
            />
          </div>
        </main>
        <Chat className="h-[320px] lg:h-auto" />
      </div>
    </div>
  );
}
