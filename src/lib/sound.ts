// 작은 효과음 (Web Audio 로 즉석 합성 → 별도 음원 파일 없음)
let ctx: AudioContext | null = null;
let muted = typeof localStorage !== 'undefined' && localStorage.getItem('nakseo-muted') === '1';

export const isMuted = () => muted;
export function setMuted(v: boolean) {
  muted = v;
  localStorage.setItem('nakseo-muted', v ? '1' : '0');
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.12) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = ctx.currentTime + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export type Sfx = 'pop' | 'correct' | 'tick' | 'start' | 'fanfare' | 'join';

export function play(s: Sfx) {
  if (muted) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    return;
  }
  switch (s) {
    case 'pop':
      tone(660, 0, 0.08, 'triangle', 0.06);
      break;
    case 'join':
      tone(520, 0, 0.1, 'triangle', 0.08);
      tone(780, 0.08, 0.12, 'triangle', 0.08);
      break;
    case 'correct':
      tone(784, 0, 0.12, 'triangle');
      tone(988, 0.1, 0.12, 'triangle');
      tone(1319, 0.2, 0.25, 'triangle');
      break;
    case 'tick':
      tone(1200, 0, 0.05, 'square', 0.04);
      break;
    case 'start':
      tone(523, 0, 0.12, 'triangle');
      tone(659, 0.12, 0.12, 'triangle');
      tone(784, 0.24, 0.2, 'triangle');
      break;
    case 'fanfare':
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.13, 0.22, 'triangle', 0.1));
      break;
  }
}
