const MESSAGES: Record<string, string> = {
  ROOM_NOT_FOUND: '방을 찾을 수 없어요. 코드를 다시 확인해 주세요!',
  ROOM_FULL: '방이 꽉 찼어요! (최대 10명)',
  ROOM_CLOSED: '이미 닫힌 방이에요.',
  NOT_MEMBER: '이 방의 참가자가 아니에요.',
  NOT_HOST: '방장만 할 수 있어요.',
  NOT_DRAWER: '출제자만 할 수 있어요.',
  NOT_ENOUGH_PLAYERS: '최소 4명이 모여야 시작할 수 있어요.',
  NOT_ALL_READY: '모든 친구가 준비 완료를 눌러야 시작할 수 있어요.',
  INVALID_PHASE: '지금은 할 수 없는 동작이에요.',
  TURN_OVER: '이미 끝난 문제예요.',
  INVALID_NICKNAME: '닉네임은 1~12자로 입력해 주세요.',
  INVALID_CHARACTER: '캐릭터를 골라 주세요.',
  INVALID_SETTINGS: '설정 값이 올바르지 않아요.',
  INVALID_INPUT: '입력 값이 올바르지 않아요.',
  EMPTY_MESSAGE: '메시지를 입력해 주세요.',
  RATE_LIMITED: '너무 빨라요! 잠시 후 다시 입력해 주세요 🐢',
  DRAWER_CANNOT_CHAT: '그림을 그리는 동안에는 채팅할 수 없어요.',
  WORD_CHANGE_UNAVAILABLE: '제시어는 첫 획을 그리기 전에 한 번만 바꿀 수 있어요.',
  NO_WORDS: '제시어가 없어요. 데이터베이스 설정을 확인해 주세요.',
  UNAUTHORIZED: '접속 정보가 만료됐어요. 새로고침해 주세요.',
  NETWORK: '서버와 연결할 수 없어요. 네트워크를 확인해 주세요.',
  SERVER_ERROR: '서버에서 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
  SERVER_MISCONFIGURED: '서버 설정(Edge Function 비밀 키)이 올바르지 않아요.',
};

export class GameError extends Error {
  code: string;
  constructor(code: string) {
    super(MESSAGES[code] ?? `알 수 없는 오류가 발생했어요 (${code})`);
    this.code = code;
  }
}

export const errorText = (e: unknown): string => {
  if (e instanceof GameError) return e.message;
  if (e instanceof Error && MESSAGES[e.message]) return MESSAGES[e.message];
  return MESSAGES.NETWORK;
};
