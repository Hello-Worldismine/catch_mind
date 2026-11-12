# 🖍️ 낙서팡팡 — 실시간 멀티플레이 그림 퀴즈

4~10명이 각자의 PC·모바일 브라우저에서 접속해 **그리고 맞히는** 실시간 파티게임입니다.
회원가입 없이 캐릭터와 닉네임만 고르면 바로 참여할 수 있어요.

- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS v4 + Zustand + Lucide
- **Backend**: Supabase (PostgreSQL · Anonymous Auth · Realtime · Edge Functions)
- **Hosting**: Netlify (정적 배포)

---

## 1. 폴더 구조

```
catch_mind/
├─ index.html
├─ netlify.toml                 # 빌드 설정 + SPA 리다이렉트
├─ .env.example                 # 브라우저용 환경변수 예시
├─ src/
│  ├─ main.tsx / App.tsx        # 라우팅: /  ·  /room/:code  · (개발 전용) /__preview
│  ├─ index.css                 # 파스텔 테마, 버튼/카드/애니메이션
│  ├─ types.ts                  # 서버 상태 타입
│  ├─ characters/               # 직접 그린 SVG 캐릭터 12종 (Avatar.tsx, list.ts)
│  ├─ lib/
│  │  ├─ supabase.ts            # 클라이언트 + 익명 로그인 세션 (새로고침 복구)
│  │  ├─ api.ts                 # Edge Function "game" 호출
│  │  ├─ errors.ts              # 서버 오류 코드 → 한국어 메시지
│  │  ├─ profile.ts / sound.ts  # 닉네임·캐릭터 저장 / 효과음
│  ├─ store/                    # Zustand (방 상태, 토스트)
│  ├─ hooks/useRoomConnection.ts# 실시간 동기화·heartbeat·타이머 tick·재접속
│  ├─ drawing/
│  │  ├─ ops.ts                 # stroke 연산 로그(획/실행취소/다시실행/전체지우기) + 곡선 렌더링
│  │  └─ DrawingBoard.tsx       # 그림판, 실시간 stroke 송수신, DB 복원
│  ├─ components/               # Lobby, GameView, Chat, PlayerList, Overlays, GameResult …
│  ├─ pages/                    # HomePage, RoomPage
│  └─ dev/PreviewPage.tsx       # 백엔드 없이 화면 확인용 (프로덕션 빌드 제외)
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/
│  │  ├─ 20261112000000_schema.sql      # 테이블·인덱스·RLS·Realtime 권한
│  │  ├─ 20261112000100_game_logic.sql  # 서버 게임 로직 (상태 전환·정답 판정·점수)
│  │  └─ 20261112000200_words_seed.sql  # 제시어 410개 + 별칭
│  ├─ functions/game/index.ts           # Edge Function (JWT 검증 → 게임 로직 호출)
│  └─ optional/cron_cleanup.sql         # (선택) pg_cron 방 정리
└─ tests/
   ├─ db.test.mjs               # 실제 PostgreSQL(PGlite)로 게임 로직·RLS 통합 테스트
   └─ unit.test.ts              # 그림 연산 로그 재생 테스트
```

---

## 2. 로컬 실행

```bash
npm install
```

```bash
cp .env.example .env    # 값 채우기 (아래 3단계 참고)
```

```bash
npm run dev             # http://localhost:5173
```

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 타입 검사 + 프로덕션 빌드 (`dist/`) |
| `npm run typecheck` | 타입 검사만 |
| `npm run test:db` | DB 게임 로직/RLS 통합 테스트 (Supabase 없이 실행 가능) |
| `npm run test:unit` | 그림 replay 단위 테스트 |

> `.env` 없이 `npm run dev` 후 `http://localhost:5173/__preview` 에 들어가면 **백엔드 없이** 모든 화면(대기실/단어선택/그리기/결과)을 확인할 수 있어요.

같은 PC에서 여러 명을 흉내 내려면 **브라우저 프로필을 다르게**(일반 창 + 시크릿 창 + 다른 브라우저 …) 열어야 합니다. 익명 로그인 세션이 localStorage 에 저장되기 때문에 같은 프로필의 탭들은 같은 참가자로 인식돼요.

---

## 3. Supabase 설정 (직접 해 주셔야 하는 작업)

### 3-1. 프로젝트 만들기
1. https://supabase.com 에서 새 프로젝트 생성 (Region: Northeast Asia (Seoul) 추천)
2. **Authentication → Sign In / Providers → "Allow anonymous sign-ins" 켜기** ← 필수!

### 3-2. 데이터베이스 마이그레이션
**방법 A — 대시보드 (가장 쉬움)**
SQL Editor 에서 아래 3개 파일 내용을 **순서대로** 붙여넣고 실행:
1. `supabase/migrations/20261112000000_schema.sql`
2. `supabase/migrations/20261112000100_game_logic.sql`
3. `supabase/migrations/20261112000200_words_seed.sql`

**방법 B — Supabase CLI**
```bash
npx supabase login
```
```bash
npx supabase link --project-ref <프로젝트-ref>
```
```bash
npx supabase db push
```

### 3-3. Edge Function 배포
```bash
npx supabase functions deploy game --no-verify-jwt --project-ref <프로젝트-ref>
```
- `--no-verify-jwt`: 함수 내부에서 `auth.getUser()` 로 사용자 JWT 를 직접 검증합니다 (새 `sb_publishable_` 키와 호환).
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 는 Supabase 가 함수 런타임에 **자동 주입**합니다. 따로 넣을 필요 없어요.
  (레거시 JWT 키를 비활성화한 프로젝트라면 `npx supabase secrets set SERVICE_ROLE_KEY=<secret 키>` 로 넣어 주세요.)

### 3-4. Realtime 확인
- 마이그레이션이 `rooms`, `messages` 테이블을 `supabase_realtime` publication 에 추가하고, private channel 권한 정책(`realtime.messages`)을 만듭니다.
- **Realtime → Settings 에서 "Allow public access"는 켜진 상태(기본값)** 로 두세요. (채팅/상태 알림 채널은 공개 채널 + 테이블 RLS, 그림/접속표시 채널은 private channel 을 사용)

### 3-5. 환경변수
**Project Settings → API Keys** 에서 복사해 `.env` 에 입력:
```
VITE_SUPABASE_URL=https://<프로젝트-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # 또는 기존 anon 키 (eyJ...)
```
⚠️ `service_role` / `sb_secret_` 키는 **절대** `.env`(VITE_ 변수)에 넣지 마세요. 브라우저에 그대로 노출됩니다.

### 3-6. (선택) 만료된 방 자동 정리
`supabase/optional/cron_cleanup.sql` 참고. 안 해도 새 방 생성 시 6시간 이상 비활성 방이 자동 삭제됩니다.

---

## 4. Netlify 배포

1. 이 폴더를 GitHub 저장소로 push
   ```bash
   git init
   ```
   ```bash
   git add -A && git commit -m "낙서팡팡 초기 버전"
   ```
   (GitHub 에서 저장소를 만든 뒤 `git remote add origin …` / `git push -u origin main`)
2. Netlify → **Add new site → Import an existing project → GitHub** → 저장소 선택
3. 빌드 설정은 `netlify.toml` 이 자동 적용됩니다 — Build command `npm run build`, Publish directory `dist`
4. **Site configuration → Environment variables** 에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` 추가 → **Deploy**
5. 이후 `main` 브랜치에 push 할 때마다 자동 배포됩니다.

`/room/ABC123` 같은 주소를 새로고침해도 404 가 나지 않도록 `netlify.toml` 에 SPA 리다이렉트가 들어 있습니다.

---

## 5. 동작 방식

### 상태 흐름
```
WAITING ──(방장 시작: 4명↑, 모두 준비)──▶ WORD_SELECT (10초, 후보 3개)
   ▲                                          │ 선택/자동선택
   │                                          ▼
   │                                       DRAWING (60/90/120초)
   │                                          │ 시간종료 · 모두 정답 · 건너뛰기 · 출제자 이탈
   │                                          ▼
   │                                       ROUND_RESULT (7초) ──▶ 다음 출제자 (WORD_SELECT)
   │                                          │ 마지막 라운드 끝
   └──(대기실로)── GAME_RESULT ◀──────────────┘   (다시 하기 → 같은 방에서 새 게임)
```

### 서버 권한 모델
| 구분 | 처리 위치 | 비고 |
|---|---|---|
| 방 생성/입장/준비/설정/시작, 제시어 선택·변경·건너뛰기, 채팅·**정답 판정**, **점수**, 타이머 진행 | Edge Function `game` → `game_*` SQL 함수 (service_role 전용) | 모든 함수가 `rooms` 행을 `FOR UPDATE` 로 잠그고 시작 → 같은 방 요청은 직렬화 (동시 정답·동시 입장·마감 경합 안전) |
| 방 상태 조회 | `get_room_state()` RPC | 제시어는 **출제자에게만**, 힌트 글자는 서버 시각 기준으로만 공개 |
| 그림 저장 | `strokes` INSERT (RLS: 현재 출제자 & DRAWING 중만) | |
| 그림 실시간 전송 | Realtime Broadcast, private channel `draw:<turnId>` | `realtime.messages` 정책으로 **출제자만 송신 가능** |
| 접속 표시 | Realtime Presence, private channel `room:<roomId>` | 방 멤버만 |
| 정답/단어 테이블 | `turn_secrets`, `words` | 클라이언트 접근 정책 없음 → 조회 불가 |

### 타이머
각 브라우저가 카운트다운하는 게 아니라 **서버가 정한 마감 시각(`phase_ends_at`)** 을 표시합니다. 클라이언트는 서버 시각과의 차이를 보정해 남은 시간을 그리고, 마감 시각이 되면 `tick` 을 요청합니다. 서버는 `now() >= 마감 시각` 일 때만 전환하므로 여러 명이 동시에 요청해도 한 번만 처리돼요. 새로고침해도 타이머는 초기화되지 않습니다.

### 그림 동기화
- 이미지가 아니라 **좌표 연산 로그**(획 / 실행취소 / 다시실행 / 전체지우기)를 전송 (논리 좌표 1000×750 정수)
- 그리는 중에는 ~90ms 마다 새 좌표만 Broadcast → 받는 쪽은 수신한 점을 부드럽게 재생 (이차 베지어 곡선 보간)
- 획이 끝나면 완성된 획을 Broadcast + DB 저장 → 늦게 들어온 사람/재연결 시 DB 에서 정확히 복원

### 정답 판정 규칙 (허용 표기 변형)
1. 앞뒤·중간 공백 무시 (`놀이 공원` = `놀이공원`)
2. 대소문자 무시 (`TV` = `tv`)
3. 문장부호·이모지·특수문자 무시 (`사과!!` = `사과`)
4. 정답 단어를 포함한 문장도 정답 (`사과인가?` → 정답, 정답 2글자 이상) — 오답 채팅으로 정답이 노출되는 것 방지
5. 등록된 별칭 (`텔레비전` ↔ `티비`, `TV` / `짜장면` ↔ `자장면` 등)
6. 1글자 차이면 본인에게만 "🔥 아깝다!" 알림

정답 원문은 채팅에 표시되지 않고 "🎉 OOO님이 정답을 맞혔습니다!" 만 표시됩니다. 정답을 맞힌 사람의 이후 채팅은 **출제자·정답자에게만** 보입니다.

### 점수
- 정답자: 남은 시간 비율에 따라 **100~500점**, 첫 정답자 **+100**
- 출제자: 정답자 1명당 **+50**
- 오답 감점 없음, 미정답 0점
- `guesses (turn_id, player_id)` UNIQUE 제약 + 방 잠금으로 **중복 적립 불가**

### 예외 처리
| 상황 | 처리 |
|---|---|
| 새로고침 / 재접속 | 익명 세션이 localStorage 에 유지 → 같은 참가자로 자동 복귀, 점수 유지, 그림 DB 복원 |
| 네트워크 일시 끊김 | 10초 heartbeat, 15초 안전 폴링, 탭 복귀·`online` 이벤트 시 재동기화 |
| 45초 이상 응답 없음 | 서버가 자동 퇴장 처리 (다시 접속하면 자동 재입장) |
| 출제자 이탈 | 문제 즉시 종료(`drawer_left`) → 결과 → 다음 출제자 |
| 방장 이탈 | 입장 순서가 가장 빠른 참가자에게 방장 위임 |
| 게임 중 1명만 남음 | 게임 종료 → 결과 화면 |
| 모두 나감 | 방 CLOSED |
| 동일 닉네임 | `철수` → `철수2` 자동 구분 |
| 10명 초과 | `ROOM_FULL` |
| 시작 직전 인원 부족 | 시작 시 끊긴 참가자 정리 후 인원 재검증 |
| 마감 후 도착한 정답 | 인정하지 않고 문제 종료 |
| 끝난 문제에 정답 | 일반 채팅으로 처리, 점수 없음 |
| 다른 사람이 그림판 조작 | DB RLS + Realtime 정책으로 거부 |
| 일반 참가자의 방장 기능 / 점수 조작 | 서버에서 `NOT_HOST` / 테이블 쓰기 권한 없음 |
| 도배 | 5초에 5개 초과 시 `RATE_LIMITED` |

---

## 6. 테스트 현황 (정직하게)

### ✅ 실제로 실행해 통과한 것
- **`npm run test:db` — 88개 항목 통과.** 실제 PostgreSQL(PGlite, WASM)에 이 저장소의 마이그레이션을 그대로 적용하고 Supabase 의 `auth`/`realtime` 스키마만 최소한으로 흉내내서 검증:
  - 완료 기준 시나리오 1~11 (A 생성 → B·C·D 입장 → 시작 → A 에게만 제시어 → B·C·D 정답 → 조기 종료 → 다음 출제자 → 라운드 종료 → 최종 순위 → 다시 하기)
  - 10명 정원 / 11번째 거부, 동일 닉네임, 재입장(새로고침) 중복 없음
  - 중복 정답, 마감 후 정답, 끝난 문제에 정답, 출제자·방장 이탈, 45초 무응답 자동 퇴장 후 재접속 점수 유지
  - RLS: 비출제자의 그림 저장 거부, 정답/단어 테이블 조회 거부, 점수 직접 수정 거부, game_* 직접 호출 거부, 정답자 채팅 비공개, Realtime 송신 권한
  - 라운드마다 모두 한 번씩 출제 · 연속 출제 없음 · 같은 방 제시어 중복 없음 · 동점 공동 순위 · 만료 방 정리
- `npm run test:unit` — 그림 실행취소/다시실행/전체지우기 재생 로직
- `npm run typecheck`, `npm run build` 성공
- `/__preview` 에서 PC(1440×900)·모바일(375×812) 화면 확인, 그림판 그리기·색상·실행취소 동작 확인

### ⚠️ 아직 실제로 확인하지 못한 것 (Supabase 프로젝트 연결 후 확인 필요)
- 실제 Supabase 에서의 Edge Function 호출, 익명 로그인, Realtime(Postgres Changes / Broadcast / Presence) 동작
- 여러 브라우저 간 실시간 그림·채팅 동기화, **10명 동시 접속** 부하
- **진짜 동시 요청**(PGlite 는 단일 커넥션이라 재현 불가) — 설계상 방 단위 `FOR UPDATE` 잠금과 UNIQUE 제약으로 보호
- Netlify 실제 배포

### 배포 후 권장 수동 테스트
1. 일반 창 / 시크릿 창 / 다른 브라우저 / 휴대폰으로 4개 이상 접속
2. 시나리오 1~11 진행, 그리는 중 다른 화면에 선이 부드럽게 나타나는지 확인
3. 게임 중 한 명 새로고침 → 같은 점수·같은 그림으로 복귀하는지
4. 출제자 창을 닫기 → 45초 내 다음 출제자로 넘어가는지 (명시적으로 "나가기"를 누르면 즉시)

---

## 7. 알아 두면 좋은 제한 사항
- **Supabase 무료 플랜 Realtime 한도**(초당 메시지 수 등)가 있습니다. 그림 전송은 약 11회/초 × 수신자 수로 계산되므로, 10명 방 여러 개를 동시에 운영한다면 Pro 플랜을 고려하세요.
- **익명 로그인 IP 제한**: 기본값은 IP 당 시간당 30회. 같은 사무실 IP 에서 많은 인원이 처음 접속하면 Authentication → Rate Limits 에서 조정할 수 있습니다.
- 익명 사용자는 자동 삭제되지 않습니다. 필요하면 Authentication → Users 에서 정리하세요.
