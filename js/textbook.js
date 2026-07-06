/**
 * textbook.js — 교재 인식 엔진 (v4)
 *
 * [핵심 변경]
 * - setInterval 제거 → Tracker.onResults 콜백에서 얼굴 안 보일 때만 호출
 * - checkFrame(videoEl): 얼굴 없을 때 매 프레임 호출, 500ms 스로틀
 * - resetPending(): 얼굴 다시 보이면 호출 (오인식 방지)
 * - 임계값: 0.70 (얼굴 없을 때만 실행이라 오인식 위험 낮음)
 */

class TextbookManager {
  constructor() {
    this.textbooks       = [];
    this._canvas         = null;
    this._ctx            = null;
    this._lastId         = null;       // 마지막 확정 교재 ID
    this._pendingId      = null;       // 연속 감지 대기
    this._pendingCnt     = 0;
    this._lastSwitchTime = 0;
    this._lastCheckTime  = 0;          // 500ms 스로틀용
    this._onDetect       = null;
    this.lastScore       = 0;
    this.lastScoreName   = '';
  }

  static get COLORS() {
    return [
      '#FFB3C1','#FFD9A0','#FFF3A0','#C3F0C8','#A8DAFF',
      '#D4B0FF','#FFBAA0','#B8F0D8','#C0D4FF','#FFE5B3',
      '#F0C8E8','#C8F0F0','#FFD0D0','#D0F0D8','#D0D8FF'
    ];
  }

  // 같은 과목명이면 같은 색 재사용
  getColorForSubject(subjectName) {
    const norm     = subjectName.trim().toLowerCase();
    const existing = this.textbooks.find(tb => tb.subjectName.trim().toLowerCase() === norm);
    if (existing) return existing.color;
    const usedColors = new Set(this.textbooks.map(tb => tb.color));
    for (const c of TextbookManager.COLORS) {
      if (!usedColors.has(c)) return c;
    }
    return TextbookManager.COLORS[this.textbooks.length % TextbookManager.COLORS.length];
  }

  async init() {
    this.textbooks = await Storage.loadTextbooks();
    console.info('[TextbookMgr] 로드:', this.textbooks.length + '권');
  }

  // ── 캔버스 헬퍼 ───────────────────────────────────────────────
  _getCanvas(w, h) {
    if (!this._canvas || this._canvas.width !== w || this._canvas.height !== h) {
      this._canvas = document.createElement('canvas');
      this._canvas.width = w; this._canvas.height = h;
      this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
    }
    return this._ctx;
  }

  // 중앙 40%×60% 크롭
  _cropFrame(videoEl, w = 64, h = 48) {
    const vw = videoEl.videoWidth  || 320;
    const vh = videoEl.videoHeight || 240;
    const ctx = this._getCanvas(w, h);
    ctx.drawImage(videoEl, vw * 0.30, vh * 0.20, vw * 0.40, vh * 0.60, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  // ── HSV Hue 히스토그램 (16 bins, 무채색·어두운 픽셀 제외) ──────
  extractHistogram(videoEl) {
    const imgData = this._cropFrame(videoEl);
    return this._computeHueHist(imgData.data);
  }

  _computeHueHist(data) {
    const BINS = 16;
    const hist = new Float32Array(BINS);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]/255, g = data[i+1]/255, b = data[i+2]/255;
      const max = Math.max(r,g,b), min = Math.min(r,g,b), delta = max - min;
      const sat = max > 0 ? delta/max : 0;
      if (max < 0.12 || sat < 0.18) continue;
      let h;
      if (delta < 1e-6) continue;
      if (max===r)      h = (((g-b)/delta)%6+6)%6;
      else if (max===g) h = (b-r)/delta + 2;
      else              h = (r-g)/delta + 4;
      h /= 6;
      hist[Math.min(Math.floor(h * BINS), BINS-1)]++;
      n++;
    }
    if (n < 80) return this._computeRgbFallback(data);
    for (let i = 0; i < BINS; i++) hist[i] /= n;
    return Array.from(hist);
  }

  _computeRgbFallback(data) {
    const hist = new Float32Array(16);
    const n    = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      hist[(data[i]>>6)*4 + (data[i+1]>>7)*2 + (data[i+2]>>7)]++;
    }
    for (let i = 0; i < 16; i++) hist[i] /= n;
    return Array.from(hist);
  }

  // ── 썸네일 캡처 ─────────────────────────────────────────────────
  captureThumbnail(videoEl) {
    const c = document.createElement('canvas');
    c.width = 120; c.height = 90;
    const ctx = c.getContext('2d');
    const vw  = videoEl.videoWidth  || 320;
    const vh  = videoEl.videoHeight || 240;
    ctx.drawImage(videoEl, vw*0.30, vh*0.20, vw*0.40, vh*0.60, 0, 0, 120, 90);
    return c.toDataURL('image/jpeg', 0.5);
  }

  // ── 유사도 계산 ──────────────────────────────────────────────────
  _similarity(h1, h2) {
    let s = 0;
    for (let i = 0; i < h1.length; i++) s += Math.sqrt(h1[i] * h2[i]);
    return s;
  }

  getTopMatch(histogram) {
    let best = null, bestScore = 0;
    for (const tb of this.textbooks) {
      const s = this._similarity(histogram, tb.histogram);
      if (s > bestScore) { bestScore = s; best = tb; }
    }
    return { match: best, score: bestScore };
  }

  // ── 핵심: 얼굴 없을 때 프레임 단위 감지 ─────────────────────────
  // Tracker.onResults에서 faceDetected=false일 때 호출됨
  checkFrame(videoEl) {
    if (!this.textbooks.length) return;
    if (!videoEl || !(videoEl.videoWidth > 0)) return;

    // 500ms 스로틀 (MediaPipe 15fps → 2fps로 줄임)
    const now = Date.now();
    if (now - this._lastCheckTime < 500) return;
    this._lastCheckTime = now;

    try {
      const hist  = this.extractHistogram(videoEl);
      const { match, score } = this.getTopMatch(hist);
      this.lastScore     = score;
      this.lastScoreName = match ? match.subjectName : '-';

      // 임계값 0.70 (얼굴 없을 때만 실행이라 오인식 걱정 없음)
      const id = (match && score >= 0.70) ? match.id : null;
      this._updateScoreDisplay();

      // 첫 확정: 3연속, 재전환(20초 이내): 5연속
      const timeSinceSwitch = now - this._lastSwitchTime;
      const required = (this._lastId !== null && timeSinceSwitch < 20000) ? 5 : 3;

      if (id === this._pendingId) {
        this._pendingCnt++;
        if (this._pendingCnt >= required && id !== null && id !== this._lastId) {
          this._lastId       = id;
          this._lastSwitchTime = now;
          this._pendingCnt   = 0;
          console.info('[TextbookMgr] 확정:', match.subjectName, score.toFixed(2));
          if (this._onDetect) this._onDetect(match);
        }
      } else {
        this._pendingId  = id;
        this._pendingCnt = 1;
      }
    } catch (e) {}
  }

  // 얼굴 다시 보이면 호출 → 대기 중인 감지 리셋
  resetPending() {
    this._pendingId  = null;
    this._pendingCnt = 0;
    this.lastScore   = 0;
    this._updateScoreDisplay();
  }

  // 교재 감지 콜백 등록
  setDetectionCallback(onDetect) {
    this._onDetect       = onDetect;
    this._lastId         = null;
    this._pendingId      = null;
    this._pendingCnt     = 0;
    this._lastSwitchTime = 0;
    this._lastCheckTime  = 0;
  }

  // 감지 종료 (페이즈 전환 시)
  stopDetection() {
    this._onDetect = null;
    this.resetPending();
  }

  resetDetected() {
    this._lastId         = null;
    this._lastSwitchTime = 0;
  }

  _updateScoreDisplay() {
    const el = document.getElementById('tb-score-display');
    if (!el) return;
    if (this.lastScore >= 0.70) {
      el.textContent = `📚 ${this.lastScoreName} (${Math.round(this.lastScore*100)}%)`;
      el.style.color = 'var(--rest)';
    } else if (this.lastScore >= 0.55) {
      el.textContent = `📖 ${this.lastScoreName}? (${Math.round(this.lastScore*100)}%)`;
      el.style.color = 'var(--study)';
    } else {
      el.textContent = Tracker.isFaceDetected() ? '' : '🔍 교재 감지 중...';
      el.style.color = 'var(--text-muted)';
    }
  }

  // ── 교재 등록 / 삭제 ──────────────────────────────────────────
  async register({ subjectName, color, thumbnail, histogram }) {
    const tb = { id:'tb_'+Date.now(), subjectName, color, thumbnail, histogram, createdAt:Date.now() };
    this.textbooks.push(tb);
    await Storage.saveTextbook(tb);
    return tb;
  }

  async remove(id) {
    this.textbooks = this.textbooks.filter(t => t.id !== id);
    await Storage.deleteTextbook(id);
  }
}

const TextbookMgr = new TextbookManager();
