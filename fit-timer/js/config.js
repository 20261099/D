// ===== Firebase 설정 =====
// 팀 Firebase 프로젝트 생성 후 아래 값을 교체하세요
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAB1aM25FYhjUZ6K9CXrJrTA9g-wmNLZO0",
  authDomain: "aistudy-c24c0.firebaseapp.com",
  projectId: "aistudy-c24c0",
  storageBucket: "aistudy-c24c0.firebasestorage.app",
  messagingSenderId: "456559292708",
  appId: "1:456559292708:web:c3e663b28552d3ad5a43b1",
  measurementId: "G-0ZVPH2VFVD"
};




// Firebase가 설정되지 않은 경우 localStorage 폴백 사용
const FIREBASE_READY = !FIREBASE_CONFIG.apiKey.startsWith("YOUR_");

// ===== 타이머 기본값 =====
const DEFAULT_STUDY_MIN  = 25;
const DEFAULT_REST_MIN   = 5;

// ===== AI 타이머 조정 한도 =====
const MAX_STUDY_EXTEND_MIN  = 10;   // 공부시간 최대 +10분
const MAX_STUDY_REDUCE_MIN  = 10;   // 공부시간 최대 -10분
const MAX_REST_EXTEND_MIN   = 15;   // 쉬는시간 최대 +15분
const DROWSY_STUDY_DELTA    = 3;    // 졸음 1회당 -3분
const DROWSY_REST_DELTA     = 3;    // 졸음 1회당 +3분

// ===== 눈 깜빡임 분석 =====
const BLINK_WINDOW_SEC      = 3 * 60;    // 3분 윈도우 (테스트용, 출시 전 20*60으로 변경)
const EAR_CLOSE_RATIO       = 0.55;      // 기준 EAR의 55% 이하 = 눈 감음
const EAR_CALIBRATION_SEC   = 4;         // 보정 시간 (초)
const EAR_OPEN_RATIO        = 0.75;      // 기준 EAR의 75% 이상 = 눈 뜸 확인

// ===== 졸음 감지 임계값 =====
const DROWSY_EYE_CLOSED_SEC     = 5;   // 눈 5초 이상 감음
const DROWSY_NOD_COUNT          = 4;   // 고개 까딱임 횟수
const DROWSY_NOD_WINDOW_SEC     = 20;  // 측정 윈도우(초)
const DROWSY_FACE_CYCLE_COUNT   = 4;   // 얼굴 감지 사라짐 횟수
const DROWSY_FACE_WINDOW_SEC    = 20;  // 측정 윈도우(초)
const HAND_MOVEMENT_THRESHOLD   = 0.015; // 손 움직임 감도(정규화)
const HAND_STILL_SEC            = 5;     // 손 정지 판단 시간

// ===== 깸 확인 기준 =====
const AWAKE_EYE_OPEN_SEC   = 2;   // 눈 2초 이상 뜬 상태
const AWAKE_MOVEMENT_CHECK = true; // 움직임도 확인

// ===== 고개 숙임 감지 =====
const NOD_Y_THRESHOLD = 0.10;  // y 이동 비율 임계값
const NOD_MIN_INTERVAL_MS = 400; // 연속 까딱임 최소 간격(ms)


// ===== 일일 기준 보정 ===== 
const BASELINE_WINDOW_SEC = 5 * 60; // 하루 첫 세션 5분간 기준 측정

// ===== 점수 기반 집중/몰입 =====
const FOCUS_RATIO_THRESHOLD   = 0.9;   // 이 이하면 "집중" 상태
const IMMERSION_HOLD_SEC      = 2;     // 표정 지속 최소 시간
const IMMERSION_SCORE_PER_HIT = 1;     // 몰입 1회당 가산점
const MAX_SCORE                = 100;

// ===== 표정 인식 (face-api.js) =====
const FACE_API_MODEL_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights';
const EXPRESSION_CONFIDENCE_MIN = 0.5;  // face-api 기본 권장 임계값

const EXPR_LABEL_KR = {
  neutral:   '무표정',
  happy:     '기쁨',
  sad:       '슬픔',
  angry:     '화남',
  fearful:   '두려움',
  disgusted: '혐오',
  surprised: '놀람'
};