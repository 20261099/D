/**
 * blink.js — 눈 깜빡임 분석 엔진
 * 20분 윈도우마다 초당 깜빡임 횟수 측정 → 집중도 판단 → 시간 연장
 */

class BlinkAnalyzer {
  constructor() {
    this.dailyBaseline  = null;
    this.baselineDate   = null;
    this.calibrating    = false;
    this.windowBlinks   = 0;
    this.windowStart    = null;
    this.active         = false;
    this.paused         = false;
    this.totalExtended  = 0;
    this.immersionCount = 0;      // ★ 신규: 윈도우 내 몰입 횟수
    this._prevClosed    = false;
    this._closedStart   = null;
  }

  _today() {
    return new Date().toLocaleDateString('sv-SE');
  }

  reset() {
    this.windowBlinks   = 0;
    this.windowStart    = null;
    this.active         = false;
    this.paused         = false;
    this.calibrating    = false;
    this.totalExtended  = 0;
    this.immersionCount = 0;      // ★ 신규
    this._prevClosed    = false;
    this._closedStart   = null;
  }

  restoreState(state) {
    if (!state) return;
    if (state.baselineDate === this._today()) {
      this.dailyBaseline = state.dailyBaseline ?? null;
      this.baselineDate  = state.baselineDate;
    }
  }

  getState() {
    return {
      dailyBaseline: this.dailyBaseline,
      baselineDate:  this.baselineDate,
      lastUpdated:   Date.now()
    };
  }

  startWindow() {
    this.windowBlinks   = 0;
    this.windowStart    = Date.now();
    this.active         = true;
    this.paused         = false;
    this.immersionCount = 0;      // ★ 신규
    this.calibrating    = (this.baselineDate !== this._today());
    if (this.calibrating) {
      console.info('[Blink] 오늘 첫 세션 → 5분 기준 보정 시작');
    }
  }

  pause()  { this.paused = true;  }
  resume() { this.paused = false; }

  tick(isClosed) {
    if (!this.active || this.paused) return;
    const now = Date.now();
    if (isClosed && !this._prevClosed) {
      this._closedStart = now;
    }
    if (!isClosed && this._prevClosed && this._closedStart) {
      const dur = now - this._closedStart;
      if (dur < DROWSY_EYE_CLOSED_SEC * 1000) {
        this.windowBlinks++;
      }
      this._closedStart = null;
    }
    this._prevClosed = isClosed;
  }

  // ★ 신규: 실시간 집중 상태 판정 (immersion.js에서 사용)
  isFocused() {
    if (!this.windowStart || this.dailyBaseline === null || this.calibrating) return false;
    const elapsed = (Date.now() - this.windowStart) / 1000;
    if (elapsed < 1) return false;
    const rate  = this.windowBlinks / elapsed;
    const ratio = this.dailyBaseline > 0 ? rate / this.dailyBaseline : 1.0;
    return ratio <= FOCUS_RATIO_THRESHOLD;
  }

  // ★ 신규: 몰입 1회 등록
  registerImmersion() {
    this.immersionCount++;
  }

  onSecondTick() {
    if (!this.active || !this.windowStart) return null;
    const elapsed = (Date.now() - this.windowStart) / 1000;

    if (this.calibrating) {
      if (elapsed < BASELINE_WINDOW_SEC) return null;
      this.dailyBaseline = this.windowBlinks / elapsed;
      this.baselineDate  = this._today();
      this.calibrating   = false;
      this.windowBlinks  = 0;
      this.windowStart   = Date.now();
      Storage.saveBlinkState(this.getState()).catch(() => {});
      console.info(`[Blink] 오늘 기준 확정: ${this.dailyBaseline.toFixed(3)}/초`);
      return { baselineSet: true, baseline: this.dailyBaseline };
    }

    if (elapsed < BLINK_WINDOW_SEC) return null;
    return this._endWindow();
  }

  forceEndWindow() {
    if (!this.windowStart) return null;
    if (this.calibrating) return null;
    const elapsed = (Date.now() - this.windowStart) / 1000;
    if (elapsed < 30) return null;
    if (elapsed >= BLINK_WINDOW_SEC) return null;
    console.info(`[Blink] 부분 윈도우 강제 처리: ${Math.round(elapsed)}초`);
    return this._endWindow();
  }

  // ★ 신규: Blink Ratio → 점수 (구간별 선형)
  _calcBlinkScore(ratio) {
    if (ratio >= 1.0) return 0;
    if (ratio >= FOCUS_RATIO_THRESHOLD) {
      return (1.0 - ratio) * 100;   // 1.0~0.9 → 0~10점
    }
    const clamped = Math.max(ratio, 0);
    return 10 + (FOCUS_RATIO_THRESHOLD - clamped) / FOCUS_RATIO_THRESHOLD * 90; // 0.9~0 → 10~100점
  }

  // ★ 전면 교체: 점수 기반 계산
  _endWindow() {
    if (!this.windowStart || this.dailyBaseline === null) return null;
    const durationSec = (Date.now() - this.windowStart) / 1000;
    if (durationSec < 30) return null;

    const rate  = this.windowBlinks / durationSec;
    const a     = this.dailyBaseline;
    const ratio = a > 0 ? rate / a : 1.0;

    const blinkScore     = this._calcBlinkScore(ratio);
    const immersionBonus = this.immersionCount * IMMERSION_SCORE_PER_HIT;
    const finalScore     = Math.min(blinkScore + immersionBonus, MAX_SCORE);
    const extension       = (finalScore / 100) * MAX_STUDY_EXTEND_MIN;

    this.totalExtended  += extension;
    this.windowBlinks    = 0;
    this.immersionCount  = 0;
    this.windowStart     = Date.now();

    console.info(`[Blink] ratio=${ratio.toFixed(2)} blinkScore=${blinkScore.toFixed(1)} 몰입보너스=${immersionBonus} final=${finalScore.toFixed(1)} → +${extension.toFixed(1)}분`);

    return { rate, ratio, blinkScore, immersionBonus, finalScore, extension };
  }
}

const BlinkEngine = new BlinkAnalyzer();