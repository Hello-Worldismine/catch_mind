import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Send, MessageCircle } from 'lucide-react';
import Avatar from '../characters/Avatar';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { findMe, useRoom } from '../store/roomStore';
import { toast } from '../store/toastStore';
import type { ChatMessage } from '../types';

export default function Chat({ className = '' }: { className?: string }) {
  const state = useRoom((s) => s.state)!;
  const messages = useRoom((s) => s.messages);
  const me = findMe(state);
  const phase = state.room.status;
  const turn = state.turn;
  const inTurn = phase === 'WORD_SELECT' || phase === 'DRAWING';
  const isDrawer = inTurn && turn?.drawer_id === state.me;
  const solved = phase === 'DRAWING' && !!me?.solved;
  const guessing = phase === 'DRAWING' && !isDrawer && !solved;

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const lastSent = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // 내 차례가 아닌데 그리는 중이면 입력창에 자동 포커스 (PC)
  useEffect(() => {
    if (guessing && window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus();
  }, [guessing, turn?.id]);

  const placeholder = isDrawer
    ? '✏️ 그리는 중에는 채팅할 수 없어요'
    : solved
      ? '🤫 정답자끼리만 보이는 채팅이에요'
      : guessing
        ? '정답을 입력해 보세요!'
        : '메시지를 입력하세요';

  const send = async () => {
    const t = text.trim();
    if (!t || sending || isDrawer) return;
    if (Date.now() - lastSent.current < 350) return;
    lastSent.current = Date.now();
    setSending(true);
    stick.current = true;
    try {
      const res = await api.sendMessage(state.room.id, t);
      setText('');
      if (res?.result === 'correct') {
        toast(`🎉 정답! +${res.points}점`, 'success');
      } else if (res?.result === 'too_late') {
        toast('⏰ 아쉽게도 시간이 끝났어요!');
      }
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  return (
    <section className={`card flex min-h-0 flex-col overflow-hidden ${className}`} aria-label="채팅">
      <header className="flex items-center gap-2 border-b-2 border-cream px-4 py-2.5">
        <MessageCircle size={18} className="text-bubble" />
        <h2 className="font-display text-lg">{guessing ? '정답 맞히기' : '채팅'}</h2>
      </header>
      <div
        ref={listRef}
        className="scroll-soft flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-3"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {messages.length === 0 && <p className="m-auto font-display text-ink/40">아직 조용해요… 인사해 볼까요? 👋</p>}
        {messages.map((m) => (
          <MessageRow key={m.id} m={m} mine={m.player_id === state.me} />
        ))}
      </div>
      <form
        className="flex gap-2 border-t-2 border-cream p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          ref={inputRef}
          className={`input !py-2.5 !text-base ${guessing ? '!border-bubble/40' : ''} ${solved ? '!bg-mint/25' : ''}`}
          placeholder={placeholder}
          disabled={isDrawer}
          maxLength={100}
          value={text}
          enterKeyHint="send"
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn-primary shrink-0 !px-3.5 !py-2.5" disabled={isDrawer || !text.trim() || sending} aria-label="보내기">
          <Send size={18} />
        </button>
      </form>
    </section>
  );
}

function MessageRow({ m, mine }: { m: ChatMessage; mine: boolean }) {
  if (m.kind === 'system') {
    return (
      <div className="animate-pop-in self-center rounded-full bg-lilac/45 px-3 py-1 text-center text-[13px] text-ink/80">
        {m.body}
      </div>
    );
  }
  if (m.kind === 'correct') {
    return (
      <div className="animate-pop-in self-center rounded-full bg-mint px-3.5 py-1.5 text-center font-display text-[15px] text-ink shadow-[0_3px_0_0_rgba(63,191,143,0.35)]">
        {m.body}
      </div>
    );
  }
  if (m.kind === 'close') {
    return (
      <div className="animate-pop-in self-center rounded-full bg-peach px-3 py-1 text-center font-display text-sm text-ink">
        {m.body}
      </div>
    );
  }
  return (
    <div className={`animate-pop-in flex items-start gap-2 ${m.visibility === 'solved' ? 'rounded-2xl bg-mint/30 px-1.5 py-1' : ''}`}>
      {m.character && <Avatar id={m.character} size={28} className="mt-0.5 shrink-0" />}
      <div className="min-w-0 text-[15px] leading-snug">
        <span className={`mr-1.5 font-display ${mine ? 'text-bubble-dark' : 'text-sky-dark'}`}>{m.nickname}</span>
        {m.visibility === 'solved' && <span className="mr-1 rounded-full bg-mint-dark px-1.5 py-0.5 text-[10px] text-white">정답자</span>}
        <span className="break-words">{m.body}</span>
      </div>
    </div>
  );
}
