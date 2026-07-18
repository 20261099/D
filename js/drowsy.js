/**
 * drowsy.js — 졸음 감지 엔진
 * 신호 1: 눈 5초 이상 감음
 * 신호 2: 고개 앞/뒤 까딱임 4회/20초 (neutralY 변위)
 * 신호 2b: 옆으로 고개 까딱임 4회/20초 (roll 각도, TXT 추가)
 * 신호 3: 얼굴 사라짐 반복 4회/20초
 * 신호 4: 얼굴 없음 + 손 정지
 */

class DrowsinessDetector {
  constructor() {
    this.isDrowsy = false;
    this.active   = false;

    this._eyeClosedStart = null;

    this._neutralY   = null;
    this._nodDown    = false;
    this._nodHistory = [];
    this._lastNod    = 0;

    // 옆 까딱임 (신호 2b)
    this._lateralDown    = false;
    this._lateralHistory = [];
    this._lastLateral    = 0;

    this._prevFaceDetected = true;
    this._faceLostHistory  = [];

    this._faceGoneStart  = null;
    this._handStillStart = null;

    this._awakeEyeOpenStart = null;
    this._movementDetected  = false;

    this._drowsyCb = null;
    this._awakeCb  = null;
  }

  start()  { this.active = true;  this._resetSignals(); }
  stop()   { this.active = false; this.isDrowsy = false; }

  onDrowsy(cb) { this._drowsyCb = cb; }
  onAwake(cb)  { this._awakeCb  = cb; }

  _resetSignals() {
    this._eyeClosedStart    = null;
    this._neutralY          = null;
    this._nodDown           = false;
    this._nodHistory        = [];
    this._lastNod           = 0;
    this._lateralDown       = false;
    this._lateralHistory    = [];
    this._lastLateral       = 0;
    this._prevFaceDetected  = true;
    this._faceLostHistory   = [];
    this._faceGoneStart     = null;
    this._handStillStart    = null;
    this._awakeEyeOpenStart = null;
    this._movementDetected  = false;
  }

  // 교재 인식 후 호출 → 얼굴 없음 타이머 리셋 (알람 방지)
  resetFaceGoneTimer() {
    this._faceGoneStart    = null;
    this._handStillStart   = null;
    // 교재 스캔 중 얼굴 사라짐 반복(face_lost_cycle) 카운트도 리셋
    this._faceLostHistory  = [];
    this._prevFaceDetected = true;
  }

  update() {
    if (!this.active) return;

    const faceDetected = Tracker.isFaceDetected();
    const isClosed     = Tracker.isEyeClosed();
    const isOpen       = Tracker.isEyeOpen();
    const centY        = Tracker.getCentroidY();
    const handVel      = Tracker.getHandVelocity();
    const now          = Date.now();

    if (this.isDrowsy) {
      this._checkAwake(isOpen, faceDetected, centY, handVel, now);
      return;
    }

    // ── 신호 1: 눈 5초 이상 감음 ──────────────────────────────
    if (Tracker.isCalibrated()) {
      if (isClosed) {
        if (!this._eyeClosedStart) this._eyeClosedStart = now;
        if (now - this._eyeClosedStart >= DROWSY_EYE_CLOSED_SEC * 1000) {
          this._trigger('eye_closed'); return;
        }
      } else {
        this._eyeClosedStart = null;
      }
    }

    // ── 신호 2: 앞/옆 고개 까딱임 ────────────────────────────
    if (faceDetected && centY !== null) {
      const yawDeg = Tracker.getYawDegree();
      if (this._checkNod(centY, now) || this._checkLateralNod(yawDeg, now)) {
        this._trigger('head_nod'); return;
      }
    }

    // ── 신호 3: 얼굴 사라짐 반복 ──────────────────────────────
    if (!faceDetected && this._prevFaceDetected) {
      this._faceLostHistory.push(now);
      const cutoff = now - DROWSY_FACE_WINDOW_SEC * 1000;
      this._faceLostHistory = this._faceLostHistory.filter(t => t > cutoff);
      if (this._faceLostHistory.length >= DROWSY_FACE_CYCLE_COUNT) {
        this._trigger('face_lost_cycle'); return;
      }
    }
    this._prevFaceDetected = faceDetected;

    // ── 신호 4: 얼굴 없음 + 손 정지 ──────────────────────────
    if (!faceDetected) {
      if (!this._faceGoneStart) this._faceGoneStart = now;
      if (handVel < HAND_MOVEMENT_THRESHOLD) {
        if (!this._handStillStart) this._handStillStart = now;
        const faceMiss = now - this._faceGoneStart  >= HAND_STILL_SEC * 1000;
        const handMiss = now - this._handStillStart >= HAND_STILL_SEC * 1000;
        if (faceMiss && handMiss) { this._trigger('no_face_no_hand'); return; }
      } else {
        this._handStillStart = null;
      }
    } else {
      this._faceGoneStart  = null;
      this._handStillStart = null;
    }
  }

  _checkNod(centY, now) {
    if (this._neutralY === null) { this._neutralY = centY; return false; }
    this._neutralY += (centY - this._neutralY) * 0.005;
    const disp = centY - this._neutralY;

    if (!this._nodDown && disp > 0.07) {
      this._nodDown = true;
    } else if (this._nodDown && disp < 0.03) {
      this._nodDown = false;
      if (now - this._lastNod > NOD_MIN_INTERVAL_MS) {
        this._lastNod = now;
        this._nodHistory.push(now);
        const cutoff = now - DROWSY_NOD_WINDOW_SEC * 1000;
        this._nodHistory = this._nodHistory.filter(t => t > cutoff);
        if (this._nodHistory.length >= DROWSY_NOD_COUNT) return true;
      }
    }
    return false;
  }

  _checkLateralNod(yawDeg, now) {
    const absYaw = Math.abs(yawDeg);
    if (!this._lateralDown && absYaw >= 30) {
      this._lateralDown = true;
    } else if (this._lateralDown && absYaw <= 10) {
      this._lateralDown = false;
      if (now - this._lastLateral > NOD_MIN_INTERVAL_MS) {
        this._lastLateral = now;
        this._lateralHistory.push(now);
        const cutoff = now - DROWSY_NOD_WINDOW_SEC * 1000;
        this._lateralHistory = this._lateralHistory.filter(t => t > cutoff);
        if (this._lateralHistory.length >= DROWSY_NOD_COUNT) return true;
      }
    }
    return false;
  }

  _checkAwake(isOpen, faceDetected, centY, handVel, now) {
    const eyeOk  = isOpen && faceDetected;
    const moving = faceDetected
      ? (centY !== null && this._neutralY !== null && Math.abs(centY - this._neutralY) > 0.03)
      : handVel > HAND_MOVEMENT_THRESHOLD;

    if (eyeOk) {
      if (!this._awakeEyeOpenStart) this._awakeEyeOpenStart = now;
      if (now - this._awakeEyeOpenStart >= AWAKE_EYE_OPEN_SEC * 1000) {
        if (this._movementDetected || moving) { this._confirmAwake(); return; }
      }
    } else {
      this._awakeEyeOpenStart = null;
    }
    if (moving) this._movementDetected = true;
  }

  _trigger(reason) {
    if (this.isDrowsy) return;
    this.isDrowsy = true;
    this._awakeEyeOpenStart = null;
    this._movementDetected  = false;
    console.info('[Drowsy] 졸음 감지:', reason);
    BlinkEngine.pause();
    if (this._drowsyCb) this._drowsyCb(reason);
  }

  _confirmAwake() {
    this.isDrowsy = false;
    this._resetSignals();
    BlinkEngine.resume();
    console.info('[Drowsy] 깸 확인');
    if (this._awakeCb) this._awakeCb();
  }

  isCurrentlyDrowsy() { return this.isDrowsy; }
}

const DrowsyDetector = new DrowsinessDetector();
