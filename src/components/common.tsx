import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useToasts } from '../store/toastStore';
import { serverNow } from '../store/roomStore';

export function Logo({ size = 'lg' }: { size?: 'sm' | 'lg' }) {
  const big = size === 'lg';
  const letters = ['낙', '서', '팡', '팡'];
  const colors = ['#FF7FA8', '#FFB347', '#4EA8EF', '#3FBF8F'];
  return (
    <div className={`flex items-center ${big ? 'gap-1' : 'gap-0.5'} select-none`} aria-label="낙서팡팡">
      {letters.map((l, i) => (
        <span
          key={i}
          className={`font-display inline-block ${big ? 'text-5xl sm:text-6xl animate-float' : 'text-2xl'}`}
          style={{
            color: colors[i],
            animationDelay: `${i * 0.18}s`,
            textShadow: `0 ${big ? 4 : 2}px 0 rgba(74,59,92,0.18)`,
            transform: `rotate(${[-6, 4, -3, 6][i]}deg)`,
          }}
        >
          {l}
        </span>
      ))}
      <span className={`${big ? 'ml-2 text-4xl' : 'ml-1 text-xl'} inline-block animate-wiggle`}>🖍️</span>
    </div>
  );
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`animate-pop-in pointer-events-auto rounded-2xl px-4 py-2.5 font-display text-base shadow-lg ring-2 ${
            t.tone === 'error'
              ? 'bg-[#FFE4E4] text-[#B23A48] ring-[#FFC2C2]'
              : t.tone === 'success'
                ? 'bg-mint text-ink ring-white'
                : 'bg-white text-ink ring-ink/10'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card animate-pop-in w-full max-w-md p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-2xl">{title}</h2>
          <button className="grid h-9 w-9 place-items-center rounded-xl hover:bg-cream" onClick={onClose} aria-label="닫기">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 서버 마감 시각 기준 남은 초 (브라우저 시계와 무관) */
export function useCountdown(endsAt: string | null | undefined) {
  const calc = () => (endsAt ? Math.max(0, (Date.parse(endsAt) - serverNow()) / 1000) : 0);
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    if (!endsAt) return;
    const t = window.setInterval(() => setLeft(calc()), 200);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt]);
  return left;
}

export function TimerBadge({ endsAt, total }: { endsAt: string | null | undefined; total: number }) {
  const left = useCountdown(endsAt);
  const secs = Math.ceil(left);
  const ratio = total > 0 ? Math.min(1, left / total) : 0;
  const urgent = secs <= 10 && secs > 0;
  const R = 22;
  const C = 2 * Math.PI * R;
  return (
    <div className={`relative grid h-14 w-14 shrink-0 place-items-center ${urgent ? 'animate-shake' : ''}`} aria-label={`남은 시간 ${secs}초`}>
      <svg viewBox="0 0 52 52" className="absolute inset-0 -rotate-90">
        <circle cx="26" cy="26" r={R} fill="white" stroke="#F1E8F5" strokeWidth="5" />
        <circle
          cx="26"
          cy="26"
          r={R}
          fill="none"
          stroke={urgent ? '#FF5C7A' : secs <= 30 ? '#FFB347' : '#3FBF8F'}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - ratio)}
          style={{ transition: 'stroke-dashoffset 0.2s linear, stroke 0.3s' }}
        />
      </svg>
      <span className={`relative font-display text-lg ${urgent ? 'text-[#FF5C7A]' : ''}`}>{secs}</span>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10">
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-3.5 w-3.5 animate-bounce rounded-full"
            style={{ background: ['#FF7FA8', '#FFB347', '#4EA8EF'][i], animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
      {label && <p className="font-display text-ink/60">{label}</p>}
    </div>
  );
}
