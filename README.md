# 특별실 예약 관리 웹앱 (사용 가이드)

월~금 × 1~10교시 격자형 시간표에서 **특별실 예약을 생성/수정/삭제**하는 웹앱입니다.  
프론트는 GitHub Pages 같은 정적 호스팅에서 동작하고, 데이터는 **Supabase(Postgres)**에 저장/공유됩니다.
(기존 Google Apps Script + Google Sheet 방식에서 Supabase로 전환했습니다. 예전 방식 코드는
`apps_script/Code.gs`에 참고용으로 남겨뒀습니다.)

## 핵심 규칙(실사용 기준)

### 고정 특별실 4개(삭제/이름변경 불가)
- **음악실**
- **도서실**
- **4층 회의실**
- **1층 시청각실**

> 서버(시트)에 과거 데이터가 섞여 “같은 이름인데 id가 다른 방”이 있어도, 앱이 자동으로 **1개로 통합**합니다.

### 비밀번호 정책
- **예약 생성**: 비밀번호 없음
- **예약 수정/삭제**: 공통 비밀번호 **`8714`**
- **특별실 삭제/이름 수정**: 공통 비밀번호 **`8714`**  
  (단, 고정 특별실 4개는 아예 불가)

## 사용자(교사용) 사용 방법

### 1) 접속
- 제공받은 GitHub Pages 주소로 접속합니다.
- 서버 URL은 배포자가 고정해두었기 때문에, 보통 **별도 설정 없이** 바로 사용 가능합니다.

### 2) 예약 생성
- 시간표의 **빈 칸**을 클릭 → 예약자명 입력 → 저장

### 3) 예약 수정/삭제
- 예약된 칸을 클릭하면 비밀번호를 물어봅니다 → **`8714`** 입력 후 수정/삭제

### 4) 동기화(서버 저장/불러오기)
- **서버로 저장**: 내 브라우저의 변경 내용을 서버(Supabase)에 저장
- **서버에서 불러오기**: 서버(Supabase)의 내용을 가져옴
- 위 두 버튼과 별개로, 다른 사람이 예약을 추가/수정하면 **Realtime 구독으로 거의 즉시 화면에 반영**됩니다(구글시트 시절의 20초 폴링보다 훨씬 빠릅니다).

#### 자동 동기화 옵션
`서버 설정` 버튼에서 아래 옵션을 켜고/끄며 조절할 수 있습니다.
- **서버 연동 활성화**
- **안전망 폴링**: Realtime이 어떤 이유로 끊겼을 때를 대비한 주기적 재확인(기본 60초)

## 관리자(배포 담당) 설정 방법

### 1) Supabase 프로젝트 준비
- [supabase.com](https://supabase.com)에서 무료 프로젝트 생성
- 프로젝트의 **SQL Editor**에 `supabase/schema.sql` 내용을 그대로 붙여넣고 실행
  - `rooms`/`reservations`/`hints` 테이블, 고정 특별실 4개 시드, Realtime 설정까지 한 번에 만들어집니다.
  - 핵심: `reservations`에 `UNIQUE(room_id, date, period)` 제약이 걸려 있어서, 같은 방/날짜/교시에 예약이 2개 이상 생기는 걸 **DB가 직접 막습니다**(예전 구글시트 버전은 이걸 클라이언트 로직으로만 방어하다 보니 드래그앤드롭 등에서 중복이 생기곤 했습니다).
- 프로젝트의 **Project URL**과 **Publishable(anon) key**를 확보 (Settings → API)
  - `service_role` 키는 절대 프론트에 넣지 마세요. publishable/anon 키만 사용합니다.

### 2) 기존 구글시트 데이터가 있다면: 1회성 이관
- 저장소 루트의 `migrate.html`을 열어서(더블클릭 또는 로컬 서버로) Apps Script Web App URL과 Supabase 정보를 입력
- "1) 구글시트에서 불러오기" → "2) Supabase로 밀어넣기" 순서로 클릭하면 끝
- 이관이 끝나면 `migrate.html`은 지워도 됩니다.

### 3) GitHub Pages(프론트)에서 서버 정보 “고정”하기
이 저장소의 `index.html`에 아래 값이 들어있어야 합니다.
```html
window.APP_DEFAULT_SUPABASE_URL = 'https://xxxx.supabase.co';
window.APP_DEFAULT_SUPABASE_KEY = 'sb_publishable_...';
window.APP_LOCK_SERVER_URL = true;
```
> 값을 고정해두면, 다른 사용자는 “서버 설정”을 따로 하지 않아도 됩니다.

## 문제 해결(가장 자주 묻는 것)

### Q1. 크롬에서 옛 예약/특별실이 계속 보입니다(캐시/강력 새로고침으로도 안 없어짐)
이 앱은 데이터를 **브라우저 LocalStorage**에 저장합니다. “강력 새로고침”은 HTML/JS 캐시만 지우고, LocalStorage는 남습니다.

**해결 방법(추천)**  
Chrome → `F12` → **Application** → **Local Storage** → 해당 사이트 → 아래 키 삭제:
- `specialRooms`
- `specialReservations`
- `supabaseConfig`
- `roomHintById`
- `roomBaseCellHints`

삭제 후 새로고침하면 초기 상태로 돌아옵니다(필요하면 서버에서 불러오기로 복구).

또는 앱에서 `서버 설정` → **이 PC 데이터 초기화** 버튼을 눌러도 됩니다(개발자도구 없이 가능).

### Q2. 같은 방/날짜/교시에 예약이 중복으로 생기나요?
`reservations` 테이블의 `UNIQUE(room_id, date, period)` 제약 때문에 DB 레벨에서 원천 차단됩니다. 두 사람이 거의 동시에 같은 슬롯을 예약 시도하면, 나중 요청은 서버에서 거부되고 클라이언트가 자동으로 서버 최신 상태를 다시 받아와 화면을 바로잡습니다.

## 파일 구조

```
특별실 예약관리/
├── index.html          # 메인 HTML(서버 접속 정보 고정 설정 포함)
├── styles.css          # 스타일
├── migrate.html         # (1회성) 구글시트 → Supabase 데이터 이관 도구
├── js/
│   ├── app.js           # UI/이벤트/병합 로직
│   ├── storage.js       # LocalStorage + 정규화/고정방 통합
│   ├── supabaseSync.js  # Supabase 연동(Realtime 구독 + 자동 저장/불러오기)
│   └── utils.js         # 날짜/주간 유틸
├── supabase/
│   └── schema.sql       # Supabase 테이블/제약/RLS/Realtime 설정
└── apps_script/
   └── Code.gs           # (레거시) 예전 Apps Script 서버 코드, 참고/백업용
```

## 주의사항(보안)
이 앱은 “로그인 없는 공유”를 목표로 하며, 수정/삭제만 공통 비밀번호로 최소 방어를 합니다.  
학교 외부 공개 환경에서는 데이터가 변경될 수 있으니, 배포 범위/공유 설정에 주의하세요.

