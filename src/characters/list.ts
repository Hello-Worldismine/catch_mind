export const CHARACTER_IDS = [
  'bunny',
  'cat',
  'puppy',
  'bear',
  'panda',
  'penguin',
  'chick',
  'frog',
  'fox',
  'piggy',
  'hamster',
  'koala',
] as const;

export type CharacterId = (typeof CHARACTER_IDS)[number];

export const CHARACTERS: Record<CharacterId, { name: string; bg: string; accent: string }> = {
  bunny: { name: '말랑토끼', bg: '#FFE3EE', accent: '#FF8FB1' },
  cat: { name: '냥냥이', bg: '#FFEBD2', accent: '#FFA45B' },
  puppy: { name: '멍뭉이', bg: '#F6E7D3', accent: '#B98A5E' },
  bear: { name: '곰돌이', bg: '#EFE0D2', accent: '#A9744C' },
  panda: { name: '판다곰', bg: '#E8F4E4', accent: '#5E8F5A' },
  penguin: { name: '펭펭이', bg: '#DDEEFF', accent: '#4F7CC4' },
  chick: { name: '삐약이', bg: '#FFF6C7', accent: '#F2B705' },
  frog: { name: '개굴이', bg: '#DFF7D8', accent: '#4DB35A' },
  fox: { name: '여우비', bg: '#FFE2D2', accent: '#F57A3D' },
  piggy: { name: '꿀꿀이', bg: '#FFE0E8', accent: '#F27A9A' },
  hamster: { name: '햄찌', bg: '#FFF0DC', accent: '#E0A050' },
  koala: { name: '코알라', bg: '#ECEAF6', accent: '#8A86A8' },
};

export const isCharacterId = (v: unknown): v is CharacterId =>
  typeof v === 'string' && (CHARACTER_IDS as readonly string[]).includes(v);
