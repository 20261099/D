/**
 * timer.js — 타이머 엔진
 * [ZIP] 쉬는시간 사이클마다 기준값으로 리셋
 * [ZIP] applyDrowsiness → { studyCut, restAdd } 상세 반환
 * [TXT] _applyExtension: power curve 가중 적용
 */

class TimerEngine {
  constructor() {
    this.mode         = 'set';
    this.phase        = 'study';
    this.running      = false;
    this.paused       = false;

    this.baseStudyMin = DEFAULT_STUDY_MIN;
    this.baseRestMin  = DEFAULT_REST_MIN;
    this.studyMin     = DEFAULT_STUDY_MIN;
    this.restMin      = DEFAULT_REST_MIN;

    this._remainSec   = 0;
    this._elapsed     = 0;
    this._interval    = null;
    this._studyDelta  = 0;
    this._restDelta   = 0;
    this._drowsyCount = 0;

    this._onTick        = null;
    this._onPhaseChange = null;
    this._onAdjust      = null;
  }

  onTick(cb)        { this._onTick        = cb; }
  onPhaseChange(cb) { this._onPhaseChange = cb; }
  onAdjust(cb)      { this._onAdjust      = cb; }

  start({ mode, studyMin, restMin }) {
    this._stopTick();
    this.mode         = mode;
    this.phase        = 'study';
    this.running      = true;
    this.paused       = false;
    this.baseStudyMin = studyMin;
    this.baseRestMin  = restMin;
    this.studyMin     = studyMin;
    this.restMin      = restMin;
    this._remainSec   = studyMin * 60;
    this._elapsed     = 0;
    this._studyDelta  = 0;
    this._restDelta   = 0;
    this._drowsyCount = 0;

    if (mode === 'ai') {
      BlinkEngine.reset();
      Storage.loadBlinkState().then(s => BlinkEngine.restoreState(s)).catch(() => {});
      BlinkEngine.startWindow();
    }
    this._startTick();
  }

  pause()  { if (!this.running || this.paused)  return; this.paused = true;  this._stopTick(); }
  resume() { if (!this.running || !this.paused) return; this.paused = false; this._startTick(); }
  stop()   {
    this.running = false; this.paused = false;
    this._stopTick();
    if (this.mode === 'ai') BlinkEngine.active = false;
  }
  skipPhase() { this._switchPhase(); }

  _startTick() { this._stopTick(); this._interval = setInterval(() => this._tick(), 1000); }
  _stopTick()  { if (this._interval !== null) { clearInterval(this._interval); this._interval = null; } }

  _tick() {
    if (!this.running || this.paused) return;
    this._remainSec = Math.max(0, this._remainSec - 1);
    this._elapsed++;

    if (this.mode === 'ai' && this.phase === 'study') {
      const result = BlinkEngine.onSecondTick();
      if (result && result.extension > 0) this._applyExtension(result);
    }

    if (this._onTick) this._onTick(this._remainSec, this.phase, this._elapsed);
    if (this._remainSec <= 0) this._switchPhase();
  }

  _switchPhase() {
    if (this.phase === 'study') {
      // 수룡이 미션: 공부 세션 완료 알림
      const studiedMs = this._elapsed * 1000;
      if (typeof Suryong !== 'undefined' && studiedMs > 30000) {
        Suryong.onStudyComplete(studiedMs).catch(() => {});
      }
      this.phase      = 'break';
      this._remainSec = Math.round(this.restMin * 60);
      this._elapsed   = 0;
      if (this.mode === 'ai') {
        // ★ 미완성 윈도우 강제 처리 → avgRate 업데이트 (부분 세션도 반영)
        const partial = BlinkEngine.forceEndWindow();
        if (partial && this._onAdjust && partial.extension > 0) {
          this._applyExtension(partial);
        }
        BlinkEngine.pause();
      }
      Alarm.playBreakStart();
    } else {
      // ✅ 휴식 → 공부: 쉬는시간 기준값 리셋 (누적 방지)
      this.phase        = 'study';
      this.restMin      = this.baseRestMin;
      this._restDelta   = 0;
      this._remainSec   = Math.round(this.studyMin * 60);
      this._elapsed     = 0;
      this._drowsyCount = 0;
      this._studyDelta  = 0;
      if (this.mode === 'ai') { BlinkEngine.resume(); BlinkEngine.startWindow(); }
      Alarm.playStudyStart();
    }
    if (this._onPhaseChange) this._onPhaseChange(this.phase, this.studyMin, this.restMin);
  }

  // ── 집중도 기반 시간 연장 (power curve 적용) ──────────────────
  _applyExtension(blinkResult) {
    if (this.mode !== 'ai' || this.phase !== 'study') return;
    const minutes = blinkResult.extension;

    // [TXT] 비선형 가중: 작은 집중도 향상은 더 신중하게 적용
    const ratio    = Math.min(minutes / MAX_STUDY_EXTEND_MIN, 1);
    const weighted = ratio ** 2;
    const curvedMin = weighted * MAX_STUDY_EXTEND_MIN;

    const canAdd = MAX_STUDY_EXTEND_MIN - this._studyDelta;
    const add    = Math.min(curvedMin, canAdd);
    if (add <= 0) return;

    this._remainSec  += Math.round(add * 60);
    this.studyMin    += add;
    this._studyDelta += add;
    // blinkResult(rate, prevAvg, ratio, newAvg) 함께 전달 → focus-log 표시용
    if (this._onAdjust) this._onAdjust(add, 'focus', blinkResult);
  }

  applyDrowsiness() {
    this._drowsyCount++;
    let studyCut = 0, restAdd = 0;

    if (this.mode === 'ai') {
      if (this.phase === 'study') {
        const maxCut  = MAX_STUDY_REDUCE_MIN + this._studyDelta;
        const safeCut = Math.min(DROWSY_STUDY_DELTA, maxCut, this._remainSec / 60 - 0.5);
        if (safeCut > 0) {
          this._remainSec  -= Math.round(safeCut * 60);
          this.studyMin    -= safeCut;
          this._studyDelta -= safeCut;
          studyCut          = safeCut;
          // toast용 콜백 (detail의 restAdd는 아직 미확정 → 0)
          if (this._onAdjust) this._onAdjust(-safeCut, 'drowsy', {
            drowsyCount: this._drowsyCount, studyCut, restAdd: 0
          });
        }
      }
      const maxRestAdd = MAX_REST_EXTEND_MIN - this._restDelta;
      restAdd = Math.min(DROWSY_REST_DELTA, maxRestAdd);
      if (restAdd > 0) { this.restMin += restAdd; this._restDelta += restAdd; }
    }

    return { drowsyCount: this._drowsyCount, restMin: this.restMin, studyCut, restAdd };
  }

  getRemainSec()   { return this._remainSec; }
  getPhase()       { return this.phase; }
  getStudyMin()    { return this.studyMin; }
  getRestMin()     { return this.restMin; }
  getDrowsyCount() { return this._drowsyCount; }
  isRunning()      { return this.running && !this.paused; }
  isPaused()       { return this.paused; }
}

const Timer = new TimerEngine();
