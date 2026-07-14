# FocusPod 🎯

AI 기반 개인화 뽀모도로 타이머 — 졸음 감지 & 집중도 자동 조정 PWA

---

## 기능

| 기능 | 설명 |
|------|------|
| AI 타이머 | 눈 깜빡임 비율로 집중도 측정 → 공부시간 자동 조정 (±최대 10분) |
| 설정 타이머 | 설정한 시간 그대로 진행 |
| 졸음 감지 | 눈 5초 이상 감음 / 고개 까딱임 4회 / 얼굴 사라짐 반복 / 얼굴 없음+손 정지 |
| 졸음 알람 | 깰 때까지 계속 울리는 버저 알람 |
| 3종 알람 | 공부 시작 / 휴식 시작 / 졸음 알람 구분 |
| PWA | 홈 화면 설치 + 오프라인 지원 |
| Firebase | 기기 로컬 저장 (오프라인 Persistence) |

---

## 빠른 시작

### 1. Firebase 설정

[Firebase Console](https://console.firebase.google.com/)에서:

1. 새 프로젝트 생성
2. **Firestore Database** 생성 (테스트 모드로 시작)
3. **프로젝트 설정** → 웹 앱 추가 → 구성 값 복사
4. `js/config.js` 상단의 `FIREBASE_CONFIG`에 붙여넣기:

```js
const FIREBASE_CONFIG = {
  apiKey:            "실제_API_KEY",
  authDomain:        "프로젝트ID.firebaseapp.com",
  projectId:         "프로젝트ID",
  storageBucket:     "프로젝트ID.appspot.com",
  messagingSenderId: "실제_SENDER_ID",
  appId:             "실제_APP_ID"
};
```

> **Firebase 없이도 동작합니다!** — `FIREBASE_CONFIG`가 미설정이면 자동으로 `localStorage`를 사용합니다.

### 2. 로컬 서버로 실행

PWA / 카메라 API 사용을 위해 **HTTPS 또는 localhost** 환경이 필요합니다.

```bash
# Python
python3 -m http.server 8080

# Node.js
npx serve .

# VS Code Live Server 확장 사용 가능
```

브라우저에서 `http://localhost:8080` 접속.

### 3. 배포 (HTTPS 필수)

```bash
# Firebase Hosting 배포 (권장 — 같은 프로젝트 활용)
npm install -g firebase-tools
firebase init hosting
firebase deploy

# 또는 Vercel / Netlify 등 정적 호스팅 서비스 사용
```

---

## 파일 구조

```
focuspod/
├── index.html          # 메인 HTML (3개 화면 포함)
├── manifest.json       # PWA 설정
├── sw.js               # Service Worker (오프라인 캐시)
├── css/
│   └── style.css       # 전체 스타일 (Dark 테마)
├── icons/
│   ├── icon.svg        # 벡터 아이콘
│   ├── icon-192.png    # PWA 아이콘
│   └── icon-512.png    # PWA 스플래시
└── js/
    ├── config.js       # ⚙️ Firebase 설정 & 상수값 (여기 수정!)
    ├── storage.js      # Firebase + localStorage 저장 레이어
    ├── alarm.js        # Web Audio API 알람 (3종)
    ├── tracker.js      # MediaPipe Face Mesh + Hands
    ├── blink.js        # 눈 깜빡임 분석 (20분 윈도우)
    ├── drowsy.js       # 졸음 감지 (4가지 신호)
    ├── timer.js        # 타이머 엔진 (공부/휴식 페이즈)
    └── app.js          # 메인 컨트롤러 & UI
```

---

## AI 타이머 알고리즘

### 시간 연장 (최대 +10분/세션)

```
20분마다 측정:
  a = 누적 평균 깜빡임/초  (첫 측정 후 계속 업데이트)
  
현재 깜빡임 비율 < a  →  집중 잘 하는 것
  연장분 = (a - current) / (0.5 × a) × 10분
  
예: a = 0.3/초, current = 0.24/초 (a의 80%)
  → (0.3 - 0.24) / (0.5 × 0.3) × 10 = 4분 연장
```

### 시간 단축 (졸음 1회당 -3분, 최대 -10분)
```
졸음 감지 1회 → 공부시간 -3분
졸음 감지 1회 → 휴식시간 +3분 (기준값 기반, 최대 +15분)
```

---

## 눈 보정 (상대값 사용)

눈이 작은 사람도 정확하게 감지하기 위해 앱 시작 시 **본인 EAR 기준값 자동 보정**:

- 처음 4초간 눈 뜬 상태의 EAR 측정 → `openEAR`
- 눈 감음 판단: `현재 EAR < openEAR × 0.55`
- 눈 뜸 판단: `현재 EAR > openEAR × 0.75`

---

## 졸음 감지 신호 (4가지, 하나라도 해당 시 즉시 판단)

1. **눈 5초 이상 감음** — EAR 기반
2. **고개 까딱임 4회/20초** — 얼굴 중심 y좌표 이동 감지
3. **얼굴 감지 사라짐 반복 4회/20초** — 앞으로 깊게 숙일 때
4. **얼굴 미감지 + 손 정지 3초** — 완전히 엎드린 상태

**깸 판단**: 눈을 2초 이상 뜨고 + 움직임 감지 시 알람 해제

---

## 복습 알림 (백그라운드 푸시)

공부를 마치면 **1일 후 / 1주일 후 / 30일 후** 3번의 복습 알림이 각각 독립적으로 등록됩니다.

### 동작 방식

1. 앱(브라우저)이 Firestore에 복습 스케줄(`pending` 상태)을 저장
2. **GitHub Actions**가 매일 정해진 시각(기본 10:00 KST)에 자동 실행되어
   그날이 만기인 `pending` 스케줄을 찾아 Web Push로 알림을 발송
3. 기기의 Service Worker(`sw.js`)가 푸시를 받아 **앱이 꺼져 있어도** 알림을 표시

→ 이 자동 실행 워크플로우(`.github/workflows/send-reviews.yml`)가 있어야만
백그라운드 알림이 동작합니다. 워크플로우가 없으면 앱을 직접 열었을 때만
(밀린 알림을 즉석에서 띄워주는 `_checkOverdueReviews`) 알림을 보게 됩니다.

### 설정 방법

**GitHub 저장소 → Settings → Secrets and variables → Actions**에 아래 4개를 등록하세요.

| Secret 이름 | 값 |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성한 JSON 전체(한 줄로) |
| `VAPID_PUBLIC_KEY` | `js/review.js`의 `VAPID_PUBLIC_KEY`와 동일한 값 |
| `VAPID_PRIVATE_KEY` | 위 공개키와 쌍이 되는 개인키 (`web-push generate-vapid-keys`로 생성) |
| `VAPID_EMAIL` | 연락 가능한 이메일 (예: `you@example.com`) |

설정 후 **Actions 탭 → Send Review Push Notifications → Run workflow**로 수동 테스트할 수 있습니다.

### iPhone(iOS)에서 백그라운드 알림을 받으려면

Web Push는 iOS 16.4 이상에서만, 그리고 **Safari로 열어 "홈 화면에 추가"한 PWA에서만** 동작합니다.
1. Safari로 앱 접속 → 공유 버튼 → **홈 화면에 추가**
2. 홈 화면 아이콘으로 앱 실행 (Safari 탭이 아닌 설치된 앱으로 열어야 함)
3. 플래너에서 알림 권한 허용

### 쉬는시간 복습 확인 팝업

공부를 마치고 쉬는시간에 들어가면, 그 교재에 오늘 마감인 복습이 있을 경우 팝업이 뜹니다.

> [과목]을 공부하셨는데 [날짜] 내용을 복습하셨나요?
> `네, 복습했어요` / `아직이에요` / `오늘은 안 할 생각이에요`

- **네, 복습했어요** → 완료(`done`)로 확정 → 그 날부터 해당 항목 알림 없음
- **아직이에요** → 그대로 대기(`pending`) → 같은 교재를 다시 공부하고 쉬는시간에
  들어가면 또 물어봄 (하루 종일 묻지 않는 게 아니라, 완료/만료 전까진 매번 확인)
- **오늘은 안 할 생각이에요** → 완료 처리는 아니지만, 오늘 하루는 이 항목의 팝업을
  더 이상 띄우지 않음 (앱을 재시작해도 유지). 완료된 게 아니므로 다음날엔 자동으로
  만료(`missed`)되어 조용히 사라짐

### 복습 상태 흐름

각 복습 스케줄은 `pending → done` 또는 `pending → missed` 로만 흐르고,
한 번 상태가 바뀌면 되돌아가지 않습니다. 응답은 즉시 스케줄 자체에 저장되므로
앱이 재시작되거나(iOS 백그라운드 종료 등) 새로고침돼도 유지됩니다.

- `pending` : 아직 완료 전 (알림 대상)
- `done` : 복습 완료로 확정 → 그 날부터 해당 항목에 대한 알림 없음
- `missed` : 마감일 안에 완료하지 못하고 날짜가 지나감 → 그 시점부터 해당 항목은 더 이상
  알리지 않음 (예: 1일 후 알림을 놓쳐도, 1주일 후/30일 후 알림에는 영향 없음)

---

## 주의 사항

- 카메라 권한 거부 시 → **설정 타이머**로 자동 전환 (졸음 감지 없이 동작)
- AI 타이머는 카메라 권한 필수
- 모바일 Safari는 PWA 설치 후 카메라 동작에 제한이 있을 수 있음
- `localhost`가 아닌 환경에서는 반드시 **HTTPS** 필요
