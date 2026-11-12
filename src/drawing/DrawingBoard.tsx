import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Eraser, Paintbrush, Redo2, Trash2, Undo2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  BOARD_H,
  BOARD_W,
  BRUSHES,
  MAX_POINTS_PER_STROKE,
  PALETTE,
  drawStroke,
  isOp,
  replay,
  type Op,
  type StrokeOp,
} from './ops';

interface LiveStroke {
  c: string;
  w: number;
  p: number[];
  shown: number;
}

interface Props {
  turnId: string | null;
  /** 현재 출제자 & DRAWING 단계일 때만 true */
  canDraw: boolean;
  /** Supabase 없이 로컬에서만 그리기 (디자인 미리보기용) */
  localOnly?: boolean;
  overlay?: React.ReactNode;
}

const LIVE_FLUSH_MS = 90;
const rid = () => Math.random().toString(36).slice(2, 10);

export default function DrawingBoard({ turnId, canDraw, localOnly = false, overlay }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);

  const ops = useRef(new Map<number, Op>());
  const live = useRef(new Map<string, LiveStroke>());
  const mine = useRef<StrokeOp | null>(null);
  const sentIdx = useRef(0);
  const seq = useRef(0);
  const channel = useRef<RealtimeChannel | null>(null);
  const persistQueue = useRef<Promise<unknown>>(Promise.resolve());
  const baseDirty = useRef(true);
  const liveDirty = useRef(true);

  const [loaded, setLoaded] = useState(localOnly);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState(PALETTE[0]);
  const [size, setSize] = useState(BRUSHES[1].w);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });

  // ------------------------------------------------------------------ 렌더링
  const ctxOf = (c: HTMLCanvasElement | null) => {
    if (!c) return null;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const scale = c.width / BOARD_W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    return ctx;
  };

  const renderBase = useCallback(() => {
    const ctx = ctxOf(baseRef.current);
    if (!ctx) return;
    const sorted = [...ops.current.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    const r = replay(sorted);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);
    for (const s of r.strokes) drawStroke(ctx, s);
    setHistory((h) => (h.canUndo === r.canUndo && h.canRedo === r.canRedo ? h : { canUndo: r.canUndo, canRedo: r.canRedo }));
  }, []);

  const renderLive = useCallback(() => {
    const ctx = ctxOf(liveRef.current);
    if (!ctx) return;
    ctx.clearRect(0, 0, BOARD_W, BOARD_H);
    for (const s of live.current.values()) drawStroke(ctx, s, s.shown);
    if (mine.current) drawStroke(ctx, mine.current);
  }, []);

  // 애니메이션 루프: 원격 획은 수신한 점들을 ~100ms 에 걸쳐 부드럽게 재생
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (baseDirty.current) {
        baseDirty.current = false;
        renderBase();
      }
      for (const s of live.current.values()) {
        if (s.shown < s.p.length) {
          s.shown = Math.min(s.p.length, s.shown + Math.max(2, Math.ceil((s.p.length - s.shown) / 6 / 2) * 2));
          liveDirty.current = true;
        }
      }
      if (liveDirty.current) {
        liveDirty.current = false;
        renderLive();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [renderBase, renderLive]);

  // 반응형 크기
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (const c of [baseRef.current, liveRef.current]) {
        if (!c) continue;
        c.width = Math.round(w * dpr);
        c.height = Math.round(w * dpr * (BOARD_H / BOARD_W));
      }
      baseDirty.current = true;
      liveDirty.current = true;
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // ------------------------------------------------------------------ 동기화
  useEffect(() => {
    ops.current.clear();
    live.current.clear();
    mine.current = null;
    seq.current = 0;
    baseDirty.current = true;
    liveDirty.current = true;
    if (!turnId || localOnly) {
      setLoaded(true);
      return;
    }
    setLoaded(false);
    let cancelled = false;

    const loadFromDb = async () => {
      const { data, error } = await supabase
        .from('strokes')
        .select('seq, op')
        .eq('turn_id', turnId)
        .order('seq', { ascending: true })
        .limit(5000);
      if (cancelled || error) return;
      let max = -1;
      for (const row of data ?? []) {
        if (isOp(row.op)) ops.current.set(row.seq, row.op);
        max = Math.max(max, row.seq);
      }
      seq.current = Math.max(seq.current, max + 1, ...[...ops.current.keys()].map((k) => k + 1));
      baseDirty.current = true;
      setLoaded(true);
    };

    const ch = supabase.channel(`draw:${turnId}`, {
      config: { private: true, broadcast: { self: false, ack: false } },
    });
    ch.on('broadcast', { event: 'live' }, ({ payload }) => {
      const { id, c, w, i, p } = payload ?? {};
      if (typeof id !== 'string' || !Array.isArray(p) || typeof i !== 'number') return;
      let s = live.current.get(id);
      if (!s) {
        s = { c: String(c), w: Number(w) || 4, p: [], shown: 0 };
        live.current.set(id, s);
      }
      if (i <= s.p.length) s.p.length = i;
      s.p.push(...p.map(Number));
      liveDirty.current = true;
    })
      .on('broadcast', { event: 'op' }, ({ payload }) => {
        if (!payload || !Number.isInteger(payload.seq) || !isOp(payload.op)) return;
        ops.current.set(payload.seq, payload.op);
        if (payload.op.k === 's') live.current.delete(payload.op.id);
        seq.current = Math.max(seq.current, payload.seq + 1);
        baseDirty.current = true;
        liveDirty.current = true;
      })
      .subscribe((status) => {
        // (재)연결될 때마다 DB 에서 전체 그림을 다시 받아 누락분 복원
        if (status === 'SUBSCRIBED') void loadFromDb();
      });
    channel.current = ch;
    void loadFromDb();

    return () => {
      cancelled = true;
      channel.current = null;
      void supabase.removeChannel(ch);
    };
  }, [turnId, localOnly]);

  const commit = useCallback(
    (op: Op) => {
      const s = seq.current++;
      ops.current.set(s, op);
      baseDirty.current = true;
      if (localOnly || !turnId) return;
      void channel.current?.send({ type: 'broadcast', event: 'op', payload: { seq: s, op } });
      persistQueue.current = persistQueue.current.then(async () => {
        const { error } = await supabase.from('strokes').insert({ turn_id: turnId, seq: s, op });
        if (error && error.code !== '23505') console.warn('stroke 저장 실패', error.message);
      });
    },
    [localOnly, turnId],
  );

  // 그리는 중인 획을 주기적으로 전송 (좌표 증분만)
  const flushLive = useCallback(() => {
    const s = mine.current;
    if (!s || localOnly || !channel.current) return;
    if (s.p.length > sentIdx.current) {
      void channel.current.send({
        type: 'broadcast',
        event: 'live',
        payload: { id: s.id, c: s.c, w: s.w, i: sentIdx.current, p: s.p.slice(sentIdx.current) },
      });
      sentIdx.current = s.p.length;
    }
  }, [localOnly]);

  useEffect(() => {
    if (!canDraw) return;
    const t = window.setInterval(flushLive, LIVE_FLUSH_MS);
    return () => window.clearInterval(t);
  }, [canDraw, flushLive]);

  // ------------------------------------------------------------------ 입력
  const toLogical = (e: { clientX: number; clientY: number }) => {
    const rect = liveRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * BOARD_W;
    const y = ((e.clientY - rect.top) / rect.height) * BOARD_H;
    return [Math.round(Math.max(0, Math.min(BOARD_W, x))), Math.round(Math.max(0, Math.min(BOARD_H, y)))];
  };

  const finishStroke = useCallback(() => {
    const s = mine.current;
    if (!s) return;
    flushLive();
    mine.current = null;
    liveDirty.current = true;
    commit(s);
  }, [commit, flushLive]);

  useEffect(() => {
    if (!canDraw) finishStroke();
  }, [canDraw, finishStroke]);

  const drawingEnabled = canDraw && loaded;

  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!drawingEnabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = toLogical(e);
    mine.current = {
      k: 's',
      id: rid(),
      c: tool === 'eraser' ? '#FFFFFF' : color,
      w: tool === 'eraser' ? Math.max(size * 1.6, 16) : size,
      p: [x, y],
    };
    sentIdx.current = 0;
    liveDirty.current = true;
  };

  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const s = mine.current;
    if (!s) return;
    const native = e.nativeEvent;
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [native];
    for (const ev of events.length ? events : [native]) {
      const [x, y] = toLogical(ev);
      const lx = s.p[s.p.length - 2];
      const ly = s.p[s.p.length - 1];
      if ((x - lx) ** 2 + (y - ly) ** 2 < 4) continue;
      s.p.push(x, y);
      if (s.p.length >= MAX_POINTS_PER_STROKE * 2) {
        // 너무 긴 획은 끊김 없이 이어서 새 획으로 분할
        const cont: StrokeOp = { k: 's', id: rid(), c: s.c, w: s.w, p: [x, y] };
        finishStroke();
        mine.current = cont;
        sentIdx.current = 0;
      }
    }
    liveDirty.current = true;
  };

  const onUp = () => finishStroke();

  const undo = useCallback(() => history.canUndo && commit({ k: 'u' }), [commit, history.canUndo]);
  const redo = useCallback(() => history.canRedo && commit({ k: 'r' }), [commit, history.canRedo]);
  const clear = () => commit({ k: 'c' });

  useEffect(() => {
    if (!drawingEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawingEnabled, undo, redo]);

  return (
    <div className="flex w-full flex-col gap-2">
      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden rounded-[28px] border-4 border-white bg-white shadow-[0_8px_0_0_rgba(74,59,92,0.12)] ring-2 ring-ink/10"
        style={{ aspectRatio: `${BOARD_W} / ${BOARD_H}` }}
      >
        <canvas ref={baseRef} className="absolute inset-0 h-full w-full" />
        <canvas
          ref={liveRef}
          className={`absolute inset-0 h-full w-full touch-none select-none ${drawingEnabled ? 'cursor-crosshair' : 'cursor-default'}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault()}
        />
        {canDraw && !loaded && (
          <div className="absolute inset-0 grid place-items-center bg-white/70 font-display text-ink/60">
            그림판 준비 중…
          </div>
        )}
        {overlay}
      </div>

      {canDraw && (
        <div className="animate-pop-in flex flex-wrap items-center justify-center gap-2 rounded-3xl bg-white/90 p-2 shadow-[0_5px_0_0_rgba(74,59,92,0.10)] ring-2 ring-ink/5">
          <div className="flex gap-1 rounded-2xl bg-cream p-1">
            <ToolBtn active={tool === 'pen'} onClick={() => setTool('pen')} label="펜">
              <Paintbrush size={18} />
            </ToolBtn>
            <ToolBtn active={tool === 'eraser'} onClick={() => setTool('eraser')} label="지우개">
              <Eraser size={18} />
            </ToolBtn>
          </div>

          <div className="flex items-center gap-1 rounded-2xl bg-cream px-2 py-1">
            {BRUSHES.map((b) => (
              <button
                key={b.w}
                type="button"
                title={b.label}
                aria-label={`굵기 ${b.label}`}
                onClick={() => setSize(b.w)}
                className={`grid h-9 w-9 place-items-center rounded-xl transition ${size === b.w ? 'bg-white shadow ring-2 ring-bubble' : 'hover:bg-white/70'}`}
              >
                <span
                  className="block rounded-full bg-ink"
                  style={{ width: Math.max(4, b.w / 1.6), height: Math.max(4, b.w / 1.6) }}
                />
              </button>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1 rounded-2xl bg-cream p-1.5">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`색상 ${c}`}
                onClick={() => {
                  setColor(c);
                  setTool('pen');
                }}
                className={`h-7 w-7 rounded-full border-2 transition hover:scale-110 ${color === c && tool === 'pen' ? 'scale-110 border-ink ring-2 ring-white' : 'border-white'}`}
                style={{ background: c, boxShadow: c === '#FFFFFF' ? 'inset 0 0 0 1px #ddd' : undefined }}
              />
            ))}
          </div>

          <div className="flex gap-1 rounded-2xl bg-cream p-1">
            <ToolBtn onClick={undo} disabled={!history.canUndo} label="실행 취소 (Ctrl+Z)">
              <Undo2 size={18} />
            </ToolBtn>
            <ToolBtn onClick={redo} disabled={!history.canRedo} label="다시 실행 (Ctrl+Y)">
              <Redo2 size={18} />
            </ToolBtn>
            <ToolBtn onClick={clear} label="전체 지우기">
              <Trash2 size={18} />
            </ToolBtn>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolBtn({
  children,
  active,
  disabled,
  onClick,
  label,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-9 w-9 place-items-center rounded-xl text-ink transition active:scale-90 disabled:opacity-30 ${active ? 'bg-bubble text-white shadow' : 'hover:bg-white'}`}
    >
      {children}
    </button>
  );
}
