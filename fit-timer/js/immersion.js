/**
 * immersion.js — 표정 기반 몰입 감지
 * face-api.js faceExpressionNet 사용
 * 집중 상태 + 중립 아닌 표정이 2초 이상 지속되면 몰입 1회
 */

class ImmersionDetector {
  constructor() {
    this.active            = false;
    this._holdLabel        = null;
    this._holdStart        = null;
    this._countedThisHold  = false;
  }

  start() { this.active = true; this._reset(); }
  stop()  { this.active = false; this._reset(); }

  _reset() {
    this._holdLabel       = null;
    this._holdStart       = null;
    this._countedThisHold = false;
  }

  // expression: { label, confidence } — tracker.js에서 매 프레임 전달
  update(expression) {
    if (!this.active) return;

    const valid = expression && expression.confidence >= EXPRESSION_CONFIDENCE_MIN;
    const isNeutral = !valid || expression.label === 'neutral';
    const isDrowsy  = DrowsyDetector.isCurrentlyDrowsy();
    const isFocused = BlinkEngine.isFocused();
    const now = Date.now();

    if (isNeutral || isDrowsy || !isFocused) { this._reset(); return; }

    if (this._holdLabel !== expression.label) {
      this._holdLabel = expression.label;
      this._holdStart = now;
      this._countedThisHold = false;
      return;
    }

    if (!this._countedThisHold && now - this._holdStart >= IMMERSION_HOLD_SEC * 1000) {
      this._countedThisHold = true;
      BlinkEngine.registerImmersion();
      console.info('[Immersion] 몰입 감지:', expression.label);
    }
  }
}

const ImmersionEngine = new ImmersionDetector();