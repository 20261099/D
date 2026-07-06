/**
 * blink.js — 눈 깜빡임 분석 엔진
 * 20분 윈도우마다 초당 깜빡임 횟수 측정 → 집중도 판단 → 시간 연장
 */

class BlinkAnalyzer {
  constructor() {
    this.avgRate       = null;   // a: 누적 평균 초당 깜빡임
    this.samples       = [];
    this.windowBlinks  = 0;
    this.windowStart   = null;
    this.active        = false;
    this.paused        = false;
    this.totalExtended = 0;      // 이번 세션 누적 연장 분
    this._prevClosed   = false;
    this._closedStart  = null;
  }

  reset() {
    this.avgRate       = null;
    this.samples       = [];
    this.windowBlinks  = 0;
    this.windowStart   = null;
    this.active        = false;
    this.paused        = false;
    this.totalExtended = 0;
    this._prevClosed   = false;
    this._closedStart  = null;
  }

  restoreState(state) {
    if (!state) return;
    if (state.avgRate !== undefined) this.avgRate = state.avgRate;
    if (state.samples?.length)       this.samples = state.samples;
  }

  getState() {
    return { avgRate: this.avgRate, samples: this.samples, lastUpdated: Date.now() };
  }

  startWindow() {
    this.windowBlinks = 0;
    this.windowStart  = Date.now();
    this.active       = true;
    this.paused       = false;
  }

  pause()  { this.paused = true;  }
  resume() { this.paused = false; }

  // 매 프레임: 눈 감음 여부 전달
  tick(isClosed) {
    if (!this.active || this.paused) return;
    const now = Date.now();

    if (isClosed && !this._prevClosed) {
      this._closedStart = now;
    }
    if (!isClosed && this._prevClosed && this._closedStart) {
      const dur = now - this._closedStart;
      // 5초 미만 = 정상 깜빡임 (5초 이상은 졸음으로 분류)
      if (dur < DROWSY_EYE_CLOSED_SEC * 1000) {
        this.windowBlinks++;
      }
      this._closedStart = null;
    }
    this._prevClosed = isClosed;
  }

  // 매초 호출: 20분 윈도우 완료 시 연장 계산값 반환
  onSecondTick() {
    if (!this.active || !this.windowStart) return null;
    const elapsed = (Date.now() - this.windowStart) / 1000;
    if (elapsed < BLINK_WINDOW_SEC) return null;
    return this._endWindow();
  }

  // 공부 페이즈 종료 시 호출 — 미완성 윈도우도 강제 처리
  // (예: 35분 세션 → 20분 정상 처리 후 남은 15분도 여기서 처리)
  forceEndWindow() {
    if (!this.windowStart) return null;
    const elapsed = (Date.now() - this.windowStart) / 1000;
    if (elapsed < 30) return null;          // 30초 미만은 무시
    if (elapsed >= BLINK_WINDOW_SEC) return null; // 이미 정상 처리됨
    console.info(`[Blink] 부분 윈도우 강제 처리: ${Math.round(elapsed)}초`);
    return this._endWindow();
  }

  _endWindow() {
    if (!this.windowStart) return null;
    const durationSec = (Date.now() - this.windowStart) / 1000;
    if (durationSec < 30) return null;  // 너무 짧으면 무시

    const rate = this.windowBlinks / durationSec;
    let extension = 0;
    let ratio     = 0;
    const prevAvg = this.avgRate;   // 계산에 쓰인 기준 평균 (UI 표시용)

    if (this.avgRate !== null) {
      const a = this.avgRate;
      // rate가 avg의 75% 미만으로 떨어져야 연장 시작 (기존 100%에서 강화)
      if (rate < a * 0.75 && a > 0) {
        // 더 조건 까다롭게: 35% 떨어져야 100% (기존 50%)
        ratio         = (a - rate) / (0.35 * a);
        ratio         = Math.min(ratio, 1.0);  // 최대 100%
        const rawMin  = ratio * MAX_STUDY_EXTEND_MIN;
        const canAdd  = MAX_STUDY_EXTEND_MIN - this.totalExtended;
        extension     = Math.max(0, Math.min(rawMin, canAdd));
        extension     = Math.round(extension * 10) / 10;
      }
    }

    // 평균 업데이트
    this.samples.push(rate);
    this.avgRate = this.samples.reduce((s, v) => s + v, 0) / this.samples.length;
    this.totalExtended += extension;

    // 다음 윈도우 시작
    this.windowBlinks = 0;
    this.windowStart  = Date.now();

    Storage.saveBlinkState(this.getState()).catch(() => {});
    console.info(`[Blink] 윈도우 완료 rate=${rate.toFixed(3)} avg=${this.avgRate.toFixed(3)} +${extension}분`);

    // prevAvg·ratio 포함해서 반환 → UI에서 계산식 그대로 표시
    return { rate, extension, prevAvg, ratio, newAvg: this.avgRate };
  }
}

const BlinkEngine = new BlinkAnalyzer();