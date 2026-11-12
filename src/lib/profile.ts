import { CHARACTER_IDS, isCharacterId, type CharacterId } from '../characters/list';

const KEY = 'nakseo-profile';

export interface Profile {
  nickname: string;
  character: CharacterId;
}

export function loadProfile(): Profile | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw.nickname === 'string' && raw.nickname.trim() && isCharacterId(raw.character)) return raw;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveProfile(p: Profile) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export const randomCharacter = (): CharacterId =>
  CHARACTER_IDS[Math.floor(Math.random() * CHARACTER_IDS.length)];

const ADJ = ['말랑한', '용감한', '졸린', '배고픈', '신나는', '수줍은', '반짝이는', '느긋한', '씩씩한', '엉뚱한'];
const NOUN = ['붓', '크레용', '도화지', '물감', '낙서왕', '화가', '연필', '스케치북'];
export const randomNickname = () =>
  (ADJ[Math.floor(Math.random() * ADJ.length)] + NOUN[Math.floor(Math.random() * NOUN.length)]).slice(0, 12);
