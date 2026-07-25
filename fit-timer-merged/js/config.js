// ===== Firebase 설정 =====
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDFPJeTk8defHkvybhghHDu_wxwR9wzRFI",
  authDomain: "fit-timer-17e94.firebaseapp.com",
  projectId: "fit-timer-17e94",
  storageBucket: "fit-timer-17e94.firebasestorage.app",
  messagingSenderId: "481643850348",
  appId: "1:481643850348:web:d52959cc8e6a4c260f8649"
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
// [주의] 타이머1은 3분, 타이머2는 7분으로 서로 다르게 테스트 중이었음 → 타이머2 값(7분) 유지, 필요시 조정
const BLINK_WINDOW_SEC      = 7 * 60;    // 7분 윈도우 (테스트용, 출시 전 20*60으로 변경)
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

// ===== [병합] 타이머1 핵심수정: 일일 기준 보정 =====
const BASELINE_WINDOW_SEC = 5 * 60; // 하루 첫 세션 5분간 기준 측정

// ===== [병합] 타이머1 핵심수정: 점수 기반 집중/몰입 =====
const FOCUS_RATIO_THRESHOLD   = 0.9;   // 이 이하면 "집중" 상태
const IMMERSION_HOLD_SEC      = 2;     // 표정 지속 최소 시간
const IMMERSION_SCORE_PER_HIT = 1;     // 몰입 1회당 가산점
const MAX_SCORE                = 100;

// ===== [병합] 타이머1 핵심수정: 표정 인식 (face-api.js) =====
// [디버깅 반영] CDN 경로가 npm/gh 둘 다 불안정 + file:// CORS 이슈 → 로컬 models 폴더로 자체 호스팅
const FACE_API_MODEL_URL = 'models';
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
