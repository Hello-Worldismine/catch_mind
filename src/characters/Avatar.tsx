import type { ReactNode } from 'react';
import { CHARACTERS, type CharacterId } from './list';

const INK = '#4A3B5C';
const CHEEK = '#FF9BB5';

interface FaceOpts {
  eyeY?: number;
  eyeGap?: number;
  happy?: boolean;
  eyeColor?: string;
  cheekY?: number;
  mouthY?: number;
  mouth?: 'w' | 'smile' | 'none' | 'wide';
}

function Face({
  eyeY = 54,
  eyeGap = 13,
  happy,
  eyeColor = INK,
  cheekY = 64,
  mouthY = 64,
  mouth = 'w',
}: FaceOpts) {
  const lx = 50 - eyeGap;
  const rx = 50 + eyeGap;
  return (
    <g>
      {happy ? (
        <g fill="none" stroke={eyeColor} strokeWidth={3.2} strokeLinecap="round">
          <path d={`M${lx - 5} ${eyeY + 1} Q${lx} ${eyeY - 5} ${lx + 5} ${eyeY + 1}`} />
          <path d={`M${rx - 5} ${eyeY + 1} Q${rx} ${eyeY - 5} ${rx + 5} ${eyeY + 1}`} />
        </g>
      ) : (
        <g>
          <ellipse cx={lx} cy={eyeY} rx={4.2} ry={5} fill={eyeColor} />
          <ellipse cx={rx} cy={eyeY} rx={4.2} ry={5} fill={eyeColor} />
          <circle cx={lx + 1.5} cy={eyeY - 2} r={1.6} fill="#fff" />
          <circle cx={rx + 1.5} cy={eyeY - 2} r={1.6} fill="#fff" />
        </g>
      )}
      <ellipse cx={lx - 6} cy={cheekY} rx={6} ry={3.8} fill={CHEEK} opacity={0.65} />
      <ellipse cx={rx + 6} cy={cheekY} rx={6} ry={3.8} fill={CHEEK} opacity={0.65} />
      {mouth === 'w' && (
        <path
          d={`M44.5 ${mouthY} Q47.25 ${mouthY + 3.5} 50 ${mouthY} Q52.75 ${mouthY + 3.5} 55.5 ${mouthY}`}
          fill="none"
          stroke={INK}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {mouth === 'smile' && (
        <path
          d={`M45 ${mouthY} Q50 ${mouthY + 5} 55 ${mouthY}`}
          fill="none"
          stroke={INK}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      )}
      {mouth === 'wide' && (
        <path
          d={`M38 ${mouthY} Q50 ${mouthY + 9} 62 ${mouthY}`}
          fill={happy ? '#FF7A93' : 'none'}
          stroke={INK}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
      )}
    </g>
  );
}

const line = { stroke: INK, strokeWidth: 3, strokeLinejoin: 'round' as const };

function body(id: CharacterId, happy: boolean): ReactNode {
  switch (id) {
    case 'bunny':
      return (
        <>
          <ellipse cx={36} cy={24} rx={9} ry={21} fill="#fff" {...line} transform="rotate(-8 36 24)" />
          <ellipse cx={64} cy={24} rx={9} ry={21} fill="#fff" {...line} transform="rotate(8 64 24)" />
          <ellipse cx={36} cy={25} rx={4} ry={14} fill="#FFC2D4" transform="rotate(-8 36 25)" />
          <ellipse cx={64} cy={25} rx={4} ry={14} fill="#FFC2D4" transform="rotate(8 64 25)" />
          <circle cx={50} cy={60} r={30} fill="#fff" {...line} />
          <Face happy={happy} eyeY={58} cheekY={67} mouthY={67} />
          <ellipse cx={50} cy={63} rx={2.6} ry={2} fill="#FF8FB1" />
        </>
      );
    case 'cat':
      return (
        <>
          <path d="M22 44 L25 14 L46 30 Z" fill="#FFB877" {...line} />
          <path d="M78 44 L75 14 L54 30 Z" fill="#FFB877" {...line} />
          <path d="M27 36 L28 22 L39 30 Z" fill="#FFC9D6" />
          <path d="M73 36 L72 22 L61 30 Z" fill="#FFC9D6" />
          <ellipse cx={50} cy={58} rx={32} ry={29} fill="#FFB877" {...line} />
          <path d="M44 31 L46 39 M50 30 L50 39 M56 31 L54 39" stroke="#E8873A" strokeWidth={3} strokeLinecap="round" />
          <Face happy={happy} />
          <g stroke={INK} strokeWidth={1.8} strokeLinecap="round">
            <path d="M20 58 L31 60 M20 65 L31 64" />
            <path d="M80 58 L69 60 M80 65 L69 64" />
          </g>
          <path d="M48 60.5 L52 60.5 L50 63 Z" fill="#FF8FB1" />
        </>
      );
    case 'puppy':
      return (
        <>
          <circle cx={50} cy={56} r={31} fill="#F5DDB8" {...line} />
          <ellipse cx={21} cy={52} rx={11} ry={21} fill="#B98A5E" {...line} transform="rotate(18 21 52)" />
          <ellipse cx={79} cy={52} rx={11} ry={21} fill="#B98A5E" {...line} transform="rotate(-18 79 52)" />
          <ellipse cx={63} cy={45} rx={9} ry={8} fill="#E5C597" />
          <Face happy={happy} mouth="smile" mouthY={67} cheekY={66} />
          <ellipse cx={50} cy={62} rx={5} ry={3.6} fill={INK} />
          {happy && <path d="M47 69 Q50 76 53 69 Z" fill="#FF7A93" stroke={INK} strokeWidth={1.5} />}
        </>
      );
    case 'bear':
      return (
        <>
          <circle cx={25} cy={30} r={12} fill="#B07D56" {...line} />
          <circle cx={75} cy={30} r={12} fill="#B07D56" {...line} />
          <circle cx={25} cy={30} r={6} fill="#E8C4A0" />
          <circle cx={75} cy={30} r={6} fill="#E8C4A0" />
          <circle cx={50} cy={57} r={31} fill="#B07D56" {...line} />
          <ellipse cx={50} cy={67} rx={14} ry={10} fill="#E8C4A0" />
          <Face happy={happy} mouthY={70} cheekY={64} eyeY={52} />
          <ellipse cx={50} cy={63} rx={4.6} ry={3.4} fill={INK} />
        </>
      );
    case 'panda':
      return (
        <>
          <circle cx={25} cy={30} r={12} fill={INK} />
          <circle cx={75} cy={30} r={12} fill={INK} />
          <circle cx={50} cy={57} r={31} fill="#fff" {...line} />
          <ellipse cx={37} cy={54} rx={8.5} ry={10.5} fill={INK} transform="rotate(25 37 54)" />
          <ellipse cx={63} cy={54} rx={8.5} ry={10.5} fill={INK} transform="rotate(-25 63 54)" />
          <Face happy={happy} eyeColor="#fff" mouthY={68} cheekY={66} />
          <ellipse cx={50} cy={63} rx={4} ry={3} fill={INK} />
        </>
      );
    case 'penguin':
      return (
        <>
          <circle cx={50} cy={55} r={33} fill="#4F6487" {...line} />
          <path d="M50 38 C38 26 18 40 24 62 C28 80 72 80 76 62 C82 40 62 26 50 38 Z" fill="#fff" />
          <Face happy={happy} eyeY={53} mouth="none" cheekY={63} />
          <path d="M44 61 Q50 57 56 61 Q50 68 44 61 Z" fill="#FFB347" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
          <path d="M44 22 Q50 14 54 22" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
        </>
      );
    case 'chick':
      return (
        <>
          <path d="M48 26 Q44 14 52 12 Q50 20 56 18 Q54 24 52 27" fill="#FFE066" {...line} />
          <circle cx={50} cy={57} r={31} fill="#FFE066" {...line} />
          <Face happy={happy} mouth="none" eyeY={54} />
          <path d="M43 62 L50 58 L57 62 L50 67 Z" fill="#FF9F43" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
          <path d="M43 62 L57 62" stroke={INK} strokeWidth={1.5} />
        </>
      );
    case 'frog':
      return (
        <>
          <circle cx={31} cy={33} r={13} fill="#9BE08E" {...line} />
          <circle cx={69} cy={33} r={13} fill="#9BE08E" {...line} />
          <ellipse cx={50} cy={60} rx={34} ry={27} fill="#9BE08E" {...line} />
          <circle cx={31} cy={33} r={8} fill="#fff" />
          <circle cx={69} cy={33} r={8} fill="#fff" />
          {happy ? (
            <g fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round">
              <path d="M26 35 Q31 29 36 35" />
              <path d="M64 35 Q69 29 74 35" />
            </g>
          ) : (
            <g fill={INK}>
              <circle cx={32} cy={34} r={4.5} />
              <circle cx={70} cy={34} r={4.5} />
              <circle cx={33.5} cy={32.3} r={1.5} fill="#fff" />
              <circle cx={71.5} cy={32.3} r={1.5} fill="#fff" />
            </g>
          )}
          <ellipse cx={26} cy={62} rx={6} ry={3.8} fill={CHEEK} opacity={0.65} />
          <ellipse cx={74} cy={62} rx={6} ry={3.8} fill={CHEEK} opacity={0.65} />
          <path d="M34 62 Q50 76 66 62" fill={happy ? '#FF7A93' : 'none'} stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
          <circle cx={45} cy={52} r={1.4} fill={INK} />
          <circle cx={55} cy={52} r={1.4} fill={INK} />
        </>
      );
    case 'fox':
      return (
        <>
          <path d="M20 46 L22 12 L46 32 Z" fill="#FF9A5A" {...line} />
          <path d="M80 46 L78 12 L54 32 Z" fill="#FF9A5A" {...line} />
          <path d="M22.5 22 L22 12 L31 19.5 Z" fill={INK} />
          <path d="M77.5 22 L78 12 L69 19.5 Z" fill={INK} />
          <path d="M18 54 C18 32 82 32 82 54 C82 76 62 88 50 88 C38 88 18 76 18 54 Z" fill="#FF9A5A" {...line} />
          <path d="M20 58 C30 56 42 64 50 72 C58 64 70 56 80 58 C78 76 62 86 50 86 C38 86 22 76 20 58 Z" fill="#FFF4EA" />
          <Face happy={happy} eyeY={53} mouth="none" cheekY={63} />
          <ellipse cx={50} cy={70} rx={4.2} ry={3.2} fill={INK} />
          <path d="M46 75 Q50 78 54 75" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" />
        </>
      );
    case 'piggy':
      return (
        <>
          <path d="M24 40 L22 20 L40 30 Z" fill="#FFB8C8" {...line} />
          <path d="M76 40 L78 20 L60 30 Z" fill="#FFB8C8" {...line} />
          <circle cx={50} cy={57} r={31} fill="#FFB8C8" {...line} />
          <Face happy={happy} eyeY={50} cheekY={60} mouth="none" eyeGap={15} />
          <ellipse cx={50} cy={64} rx={12} ry={8.5} fill="#FF94AE" stroke={INK} strokeWidth={2.4} />
          <ellipse cx={46} cy={64} rx={2} ry={3} fill={INK} />
          <ellipse cx={54} cy={64} rx={2} ry={3} fill={INK} />
          <path d="M45 77 Q50 80 55 77" fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
        </>
      );
    case 'hamster':
      return (
        <>
          <circle cx={27} cy={32} r={9} fill="#F7C98B" {...line} />
          <circle cx={73} cy={32} r={9} fill="#F7C98B" {...line} />
          <circle cx={27} cy={32} r={4.5} fill="#FFC2D4" />
          <circle cx={73} cy={32} r={4.5} fill="#FFC2D4" />
          <ellipse cx={50} cy={59} rx={33} ry={29} fill="#F7C98B" {...line} />
          <path d="M20 64 C26 52 40 56 50 62 C60 56 74 52 80 64 C76 80 62 87 50 87 C38 87 24 80 20 64 Z" fill="#FFF8EE" />
          <Face happy={happy} eyeY={53} cheekY={64} mouthY={68} />
          <ellipse cx={50} cy={63} rx={3} ry={2.2} fill="#FF8FB1" />
        </>
      );
    case 'koala':
      return (
        <>
          <circle cx={21} cy={40} r={16} fill="#B9B9C9" {...line} />
          <circle cx={79} cy={40} r={16} fill="#B9B9C9" {...line} />
          <circle cx={21} cy={41} r={9} fill="#F3E3EC" />
          <circle cx={79} cy={41} r={9} fill="#F3E3EC" />
          <circle cx={50} cy={57} r={30} fill="#B9B9C9" {...line} />
          <Face happy={happy} eyeY={51} eyeGap={14} mouth="none" cheekY={64} />
          <ellipse cx={50} cy={62} rx={7} ry={9} fill={INK} />
          <ellipse cx={48} cy={58} rx={2} ry={2.4} fill="#fff" opacity={0.6} />
          <path d="M45 75 Q50 78 55 75" fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
        </>
      );
  }
}

interface AvatarProps {
  id: CharacterId;
  size?: number;
  happy?: boolean;
  className?: string;
  noBg?: boolean;
  title?: string;
}

export default function Avatar({ id, size = 48, happy = false, className = '', noBg = false, title }: AvatarProps) {
  const ch = CHARACTERS[id] ?? CHARACTERS.bunny;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title ?? ch.name}
    >
      {!noBg && <circle cx={50} cy={50} r={50} fill={ch.bg} />}
      <g transform="translate(5 3) scale(0.9)">{body(CHARACTERS[id] ? id : 'bunny', happy)}</g>
    </svg>
  );
}
