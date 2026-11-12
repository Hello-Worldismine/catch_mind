/**
 * 그림 데이터 = 좌표 기반 "연산 로그"
 *   s : 획(stroke)   { id, c: 색, w: 굵기, p: [x0,y0,x1,y1,...] }  (논리 좌표 1000 x 750 정수)
 *   u : 실행 취소   r : 다시 실행   c : 전체 지우기
 * seq 순서로 재생하면 누구나 같은 그림을 정확히 복원합니다.
 */
export const BOARD_W = 1000;
export const BOARD_H = 750;
export const MAX_POINTS_PER_STROKE = 1200;

export interface StrokeOp {
  k: 's';
  id: string;
  c: string;
  w: number;
  p: number[];
}
export type Op = StrokeOp | { k: 'u' } | { k: 'r' } | { k: 'c' };

export interface Replay {
  strokes: StrokeOp[];
  canUndo: boolean;
  canRedo: boolean;
}

export function replay(ops: Op[]): Replay {
  const hist: (StrokeOp | { k: 'c' })[] = [];
  const redo: (StrokeOp | { k: 'c' })[] = [];
  for (const op of ops) {
    if (op.k === 's' || op.k === 'c') {
      hist.push(op);
      redo.length = 0;
    } else if (op.k === 'u') {
      const last = hist.pop();
      if (last) redo.push(last);
    } else if (op.k === 'r') {
      const last = redo.pop();
      if (last) hist.push(last);
    }
  }
  let start = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].k === 'c') {
      start = i + 1;
      break;
    }
  }
  return {
    strokes: hist.slice(start).filter((o): o is StrokeOp => o.k === 's'),
    canUndo: hist.length > 0,
    canRedo: redo.length > 0,
  };
}

/** 이차 베지어 곡선으로 점 사이를 부드럽게 보간해서 그립니다. */
export function drawStroke(ctx: CanvasRenderingContext2D, s: { c: string; w: number; p: number[] }, upto?: number) {
  const p = s.p;
  const n = Math.min(upto ?? p.length, p.length) & ~1;
  if (n < 2) return;
  ctx.strokeStyle = s.c;
  ctx.fillStyle = s.c;
  ctx.lineWidth = s.w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (n === 2) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], s.w / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  if (n === 4) {
    ctx.lineTo(p[2], p[3]);
  } else {
    for (let i = 2; i < n - 2; i += 2) {
      const mx = (p[i] + p[i + 2]) / 2;
      const my = (p[i + 1] + p[i + 3]) / 2;
      ctx.quadraticCurveTo(p[i], p[i + 1], mx, my);
    }
    ctx.lineTo(p[n - 2], p[n - 1]);
  }
  ctx.stroke();
}

export const isOp = (v: unknown): v is Op => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (o.k === 'u' || o.k === 'r' || o.k === 'c') return true;
  return (
    o.k === 's' &&
    typeof o.id === 'string' &&
    typeof o.c === 'string' &&
    /^#[0-9a-fA-F]{6}$/.test(o.c) &&
    typeof o.w === 'number' &&
    Array.isArray(o.p)
  );
};

export const PALETTE = [
  '#2D2A32', '#FFFFFF', '#8C8C99', '#E8424F', '#FF8FB1', '#FF9A3C',
  '#FFD43B', '#7ED957', '#2FB57A', '#4DB8FF', '#3D5AFE', '#9B6BFF',
  '#8B5A3C', '#F5C9A0',
];

export const BRUSHES = [
  { w: 4, label: '가늘게' },
  { w: 10, label: '보통' },
  { w: 20, label: '굵게' },
  { w: 38, label: '아주 굵게' },
];
