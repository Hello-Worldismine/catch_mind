import { useState, type ReactNode } from 'react';
import { Dices } from 'lucide-react';
import Avatar from '../characters/Avatar';
import { CHARACTERS, CHARACTER_IDS, type CharacterId } from '../characters/list';
import { loadProfile, randomCharacter, randomNickname, type Profile } from '../lib/profile';

export function CharacterPicker({ value, onChange }: { value: CharacterId; onChange: (c: CharacterId) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" role="radiogroup" aria-label="캐릭터 선택">
      {CHARACTER_IDS.map((id) => {
        const active = id === value;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(id)}
            className={`group flex flex-col items-center gap-0.5 rounded-2xl p-1.5 transition ${
              active ? 'bg-white shadow-[0_4px_0_0_rgba(255,127,168,0.45)] ring-[3px] ring-bubble' : 'hover:bg-white/80'
            }`}
          >
            <Avatar id={id} size={54} happy={active} className={active ? 'animate-bounce-soft' : 'transition group-hover:scale-110'} />
            <span className={`font-display text-[13px] ${active ? 'text-bubble-dark' : 'text-ink/60'}`}>
              {CHARACTERS[id].name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface Props {
  submitLabel: ReactNode;
  onSubmit: (p: Profile) => void | Promise<void>;
  busy?: boolean;
  error?: string | null;
  extra?: ReactNode;
}

export default function ProfileForm({ submitLabel, onSubmit, busy, error, extra }: Props) {
  const saved = loadProfile();
  const [nickname, setNickname] = useState(saved?.nickname ?? '');
  const [character, setCharacter] = useState<CharacterId>(saved?.character ?? randomCharacter());
  const trimmed = nickname.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 12;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) void onSubmit({ nickname: trimmed, character });
      }}
    >
      <div>
        <label className="mb-2 flex items-center gap-2 font-display text-lg">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-bubble text-sm text-white">1</span>
          나의 캐릭터를 골라요
        </label>
        <CharacterPicker value={character} onChange={setCharacter} />
      </div>

      <div>
        <label htmlFor="nickname" className="mb-2 flex items-center gap-2 font-display text-lg">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-sky-dark text-sm text-white">2</span>
          닉네임을 정해요
        </label>
        <div className="flex items-center gap-2">
          <div className="shrink-0 rounded-2xl bg-cream p-1">
            <Avatar id={character} size={52} happy />
          </div>
          <input
            id="nickname"
            className="input"
            placeholder="닉네임 (최대 12자)"
            maxLength={12}
            value={nickname}
            autoComplete="off"
            onChange={(e) => setNickname(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-white shrink-0 !px-3"
            onClick={() => setNickname(randomNickname())}
            title="랜덤 닉네임"
            aria-label="랜덤 닉네임"
          >
            <Dices size={20} />
          </button>
        </div>
      </div>

      {error && <p className="animate-pop-in rounded-2xl bg-[#FFE4E4] px-4 py-2 font-display text-[#B23A48]">{error}</p>}

      {extra}
      <button type="submit" className="btn btn-primary w-full py-4 text-xl" disabled={!valid || busy}>
        {busy ? '잠깐만요…' : submitLabel}
      </button>
    </form>
  );
}
