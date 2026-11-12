// 개발 전용: Supabase 없이 각 화면 디자인을 확인하는 미리보기 (/__preview) — 프로덕션 빌드에 포함되지 않음
import { useEffect, useState } from 'react';
import Lobby from '../components/Lobby';
import GameView from '../components/GameView';
import GameResult from '../components/GameResult';
import HomePage from '../pages/HomePage';
import { useRoom } from '../store/roomStore';
import type { ChatMessage, Phase, Player, RoomState, Turn } from '../types';
import type { CharacterId } from '../characters/list';

const P = (id: string, nickname: string, character: CharacterId, score: number, extra: Partial<Player> = {}): Player => ({
  id,
  nickname,
  character,
  score,
  is_ready: true,
  join_order: Number(id.slice(1)),
  is_host: id === 'p1',
  has_drawn: false,
  solved: false,
  ...extra,
});

const in_ = (s: number) => new Date(Date.now() + s * 1000).toISOString();

function mock(view: string): RoomState {
  const players = [
    P('p1', '말랑방장', 'bunny', 1250),
    P('p2', '냥냥펀치', 'cat', 980, { solved: view === 'draw-guess' }),
    P('p3', '개굴개굴', 'frog', 720, { is_ready: false }),
    P('p4', '판다최고', 'panda', 720),
    P('p5', '햄찌', 'hamster', 300),
    P('p6', '펭귄씨', 'penguin', 150),
  ];
  const phaseMap: Record<string, Phase> = {
    lobby: 'WAITING',
    'select-drawer': 'WORD_SELECT',
    'select-guess': 'WORD_SELECT',
    'draw-drawer': 'DRAWING',
    'draw-guess': 'DRAWING',
    result: 'ROUND_RESULT',
    final: 'GAME_RESULT',
  };
  const phase = phaseMap[view];
  const me = view === 'select-guess' || view === 'draw-guess' ? 'p3' : 'p1';
  const turn: Turn | null =
    phase === 'WAITING' || phase === 'GAME_RESULT'
      ? null
      : {
          id: 't1',
          round: 2,
          turn_no: 8,
          drawer_id: 'p1',
          status: phase === 'ROUND_RESULT' ? 'ROUND_RESULT' : phase === 'WORD_SELECT' ? 'WORD_SELECT' : 'DRAWING',
          word_length: 4,
          pattern: me === 'p1' || phase === 'ROUND_RESULT' ? ['놀', '이', '공', '원'] : ['', '이', '', ''],
          select_ends_at: in_(8),
          started_at: in_(-40),
          ends_at: in_(50),
          ended_at: null,
          end_reason: phase === 'ROUND_RESULT' ? 'timeout' : null,
          revealed_word: phase === 'ROUND_RESULT' ? '놀이공원' : null,
          word_changed: false,
          hint_times: [],
          my_word: me === 'p1' && phase !== 'WORD_SELECT' ? '놀이공원' : null,
          candidates:
            me === 'p1' && phase === 'WORD_SELECT'
              ? [
                  { text: '고양이', difficulty: 'easy' },
                  { text: '놀이공원', difficulty: 'normal' },
                  { text: '월요병', difficulty: 'hard' },
                ]
              : null,
          can_change_word: true,
          guesses: [
            { player_id: 'p2', points: 520, order: 1 },
            { player_id: 'p4', points: 310, order: 2 },
          ],
          drawer_points: 100,
        };
  return {
    membership: 'active',
    server_now: new Date().toISOString(),
    me,
    room: {
      id: 'r1',
      code: 'PANG42',
      status: phase,
      host_player_id: 'p1',
      settings: { draw_time: 90, total_rounds: 3, difficulty: 'random', hints_enabled: true },
      current_round: 2,
      phase_ends_at: phase === 'WORD_SELECT' ? in_(8) : phase === 'DRAWING' ? in_(50) : phase === 'ROUND_RESULT' ? in_(6) : null,
      version: Date.now(),
    },
    players: phase === 'WAITING' ? players.slice(0, 5).map((p) => ({ ...p, score: 0 })) : players,
    turn,
    game:
      phase === 'GAME_RESULT'
        ? {
            id: 'g1',
            started_at: in_(-600),
            ended_at: in_(0),
            turns_in_round: 6,
            final_results: [...players]
              .sort((a, b) => b.score - a.score)
              .map((p, i, arr) => ({
                player_id: p.id,
                nickname: p.nickname,
                character: p.character,
                score: p.score,
                rank: arr.findIndex((x) => x.score === p.score) + 1 || i + 1,
              })),
          }
        : { id: 'g1', started_at: in_(-300), ended_at: null, final_results: null, turns_in_round: 6 },
  };
}

const msgs: ChatMessage[] = [
  ['system', null, '🎉 말랑방장님이 방을 만들었어요! 친구들을 초대해 보세요.'],
  ['chat', 'p2', '안녕하세요~ 🙌'],
  ['chat', 'p3', '오늘 꼭 1등 할 거예요'],
  ['system', null, '🎨 말랑방장님이 그림을 그릴 차례예요!'],
  ['chat', 'p4', '회전목마?'],
  ['correct', 'p2', '🎉 냥냥펀치님이 정답을 맞혔습니다!'],
  ['close', null, '🔥 「놀이공언」 아깝다! 거의 정답이에요!'],
  ['chat', 'p5', '이게 뭐지 ㅋㅋㅋ'],
].map(([kind, pid, body], i) => {
  const chars: Record<string, [string, CharacterId]> = {
    p2: ['냥냥펀치', 'cat'],
    p3: ['개굴개굴', 'frog'],
    p4: ['판다최고', 'panda'],
    p5: ['햄찌', 'hamster'],
  };
  const c = pid ? chars[pid as string] : null;
  return {
    id: i + 1,
    room_id: 'r1',
    turn_id: null,
    player_id: pid,
    nickname: c?.[0] ?? null,
    character: c?.[1] ?? null,
    kind: kind as ChatMessage['kind'],
    body: body as string,
    visibility: kind === 'close' ? 'private' : 'all',
    target_player_id: null,
    created_at: new Date().toISOString(),
  };
});

const VIEWS = ['home', 'lobby', 'select-drawer', 'select-guess', 'draw-drawer', 'draw-guess', 'result', 'final'];

export default function PreviewPage() {
  const [view, setView] = useState(() => new URLSearchParams(location.search).get('v') ?? 'lobby');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const st = useRoom.getState();
    st.reset();
    if (view !== 'home') {
      st.setState(mock(view), 0);
      st.addMessages(msgs);
      st.setRealtimeOk(true);
      st.setOnline(new Set(['p1', 'p2', 'p4', 'p5', 'p6']));
    }
    setReady(true);
    const u = new URL(location.href);
    u.searchParams.set('v', view);
    history.replaceState(null, '', u);
  }, [view]);

  const phase = useRoom((s) => s.state?.room.status);
  return (
    <div>
      <div className="fixed bottom-2 left-1/2 z-[200] flex -translate-x-1/2 flex-wrap justify-center gap-1 rounded-2xl bg-ink/85 p-1.5 text-xs text-white">
        {VIEWS.map((v) => (
          <button key={v} className={`rounded-lg px-2 py-1 ${v === view ? 'bg-bubble' : 'hover:bg-white/20'}`} onClick={() => setView(v)}>
            {v}
          </button>
        ))}
      </div>
      {ready &&
        (view === 'home' ? (
          <HomePage />
        ) : phase === 'WAITING' ? (
          <Lobby />
        ) : phase === 'GAME_RESULT' ? (
          <GameResult />
        ) : phase ? (
          <GameView preview />
        ) : null)}
    </div>
  );
}
