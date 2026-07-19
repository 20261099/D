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

## 주의 사항

- 카메라 권한 거부 시 → **설정 타이머**로 자동 전환 (졸음 감지 없이 동작)
- AI 타이머는 카메라 권한 필수
- 모바일 Safari는 PWA 설치 후 카메라 동작에 제한이 있을 수 있음
- `localhost`가 아닌 환경에서는 반드시 **HTTPS** 필요
