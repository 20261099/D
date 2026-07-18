/**
 * textbook.js — 교재 인식 v2
 *
 * 개선점 (데모 프로토타입 로직 통합):
 * 1. HSV 히스토그램 → pHash (DCT, 32×32 → 8×8 저주파, BigInt 해밍거리)
 * 2. 전체 화면 비교 → 얼굴 마지막 위치 기반 다중 후보 영역 비교
 *    (5스케일 × 4수직오프셋 = 최대 20개 후보, 가장 가까운 매칭 채택)
 * 3. padToSquare → 등록 시 크롭과 인식 시 크롭의 비율 차이로 인한
 *    이미지 찌그러짐 mismatch 방지 (정확도 핵심 개선 지점)
 *
 * API는 기존 textbook.js와 동일 유지 (app.js 수정 불필요)
 */

// ── pHash 유틸 ─────────────────────────────────────────────
const PHASH_SIZE = 32;
const PHASH_LOW  = 8;

// DCT 기저 행렬 미리 계산 (매 프레임 재계산 방지 → 성능 개선)
const _DCT_BASIS = (() => {
  const basis = [];
  for (let k = 0; k < PHASH_SIZE; k++) {
    const row   = new Float64Array(PHASH_SIZE);
    const alpha = k === 0 ? Math.sqrt(1 / PHASH_SIZE) : Math.sqrt(2 / PHASH_SIZE);
    for (let n = 0; n < PHASH_SIZE; n++)
      row[n] = alpha * Math.cos(Math.PI / PHASH_SIZE * (n + 0.5) * k);
    basis.push(row);
  }
  return basis;
})();

function _dct2d(matrix) {
  const N = PHASH_SIZE;
  // 행 방향 DCT
  const temp = matrix.map(srcRow => {
    const rowOut = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      let sum = 0;
      const br = _DCT_BASIS[k];
      for (let n = 0; n < N; n++) sum += srcRow[n] * br[n];
      rowOut[k] = sum;
    }
    return rowOut;
  });
  // 열 방향 DCT
  const out = Array.from({length: N}, () => new Float64Array(N));
  for (let x = 0; x < N; x++) {
    for (let k = 0; k < N; k++) {
      let sum = 0;
      const br = _DCT_BASIS[k];
      for (let n = 0; n < N; n++) sum += temp[n][x] * br[n];
      out[k][x] = sum;
    }
  }
  return out;
}

/**
 * 정사각형 패딩 (가로세로 비율 정규화)
 * → 등록 시 촬영 비율과 인식 시 후보 영역 비율이 달라도
 *   동일하게 정규화되어 pHash가 일관되게 계산됨
 */
function _padToSquare(srcCanvas) {
  const size = Math.max(srcCanvas.width, srcCanvas.height);
  const sq   = document.createElement('canvas');
  sq.width   = size; sq.height = size;
  const ctx  = sq.getContext('2d');
  ctx.fillStyle = '#808080'; // 회색 여백
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(srcCanvas, (size - srcCanvas.width) / 2, (size - srcCanvas.height) / 2);
  return sq;
}

/** pHash 계산 → BigInt 반환 */
function _computePHash(srcCanvas) {
  const sq   = _padToSquare(srcCanvas);
  const sm   = document.createElement('canvas');
  sm.width   = PHASH_SIZE; sm.height = PHASH_SIZE;
  const sctx = sm.getContext('2d', {willReadFrequently: true});
  sctx.drawImage(sq, 0, 0, PHASH_SIZE, PHASH_SIZE);
  const d = sctx.getImageData(0, 0, PHASH_SIZE, PHASH_SIZE).data;

  const matrix = [];
  for (let y = 0; y < PHASH_SIZE; y++) {
    const row = new Float64Array(PHASH_SIZE);
    for (let x = 0; x < PHASH_SIZE; x++) {
      const i = (y * PHASH_SIZE + x) * 4;
      row[x] = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
    }
    matrix.push(row);
  }

  const freq = _dct2d(matrix);

  // 8×8 저주파 성분 추출
  const low = [];
  for (let y = 0; y < PHASH_LOW; y++)
    for (let x = 0; x < PHASH_LOW; x++)
      low.push(freq[y][x]);

  // DC 성분 제외 후 중앙값 기준 이진화 (평균보다 중앙값이 더 안정적)
  const withoutDC = low.slice(1);
  const sorted    = [...withoutDC].sort((a, b) => a - b);
  const median    = sorted[Math.floor(sorted.length / 2)];

  let hash = 0n;
  for (let i = 0; i < low.length; i++) {
    hash <<= 1n;
    if (low[i] > median) hash |= 1n;
  }
  return hash;
}


/** 캔버스를 degrees(0/90/180/270) 만큼 회전한 새 캔버스 반환 */
function _rotateCanvas(src, degrees) {
  if (degrees === 0) return src;
  const swap = (degrees === 90 || degrees === 270);
  const c    = document.createElement('canvas');
  c.width    = swap ? src.height : src.width;
  c.height   = swap ? src.width  : src.height;
  const ctx  = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(degrees * Math.PI / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** 해밍 거리 (낮을수록 유사) */
function _hammingDist(a, b) {
  let x = BigInt(a) ^ BigInt(b);
  let cnt = 0n;
  while (x) { cnt += x & 1n; x >>= 1n; }
  return Number(cnt);
}

// ── 교재 관리자 ────────────────────────────────────────────
class TextbookManager {
  constructor() {
    this.textbooks = [];

    // 인식 상태
    this._active     = false;
    this._cb         = null;
    this._missCount  = 0;
    this._lastScanMs = 0;

    // 인식 파라미터 (더 관대하게 조정)
    this.missFrames     = 3;    // 얼굴 소실 판정 프레임 수 (5→3으로 낮춤)
    this.scanIntervalMs = 400;  // 스캔 주기 ms (600→400으로 낮춤)
    this.hammingThresh  = 25;   // 일치 판정 임계값 (로그 분석 후 25로 조정)
    this.searchScale    = 1.0;  // 후보 영역 크기 배율
    this._debugLogged   = 0;    // 로그 빈도 조절용
  }

  // ── 초기화 ─────────────────────────────────────────────
  async init() {
    const saved = await Storage.loadTextbooks();
    if (saved) this.textbooks = saved;
  }

  // ── 등록 ───────────────────────────────────────────────

  /**
   * 비디오 프레임(또는 크롭 영역)에서 pHash 추출
   * cropRect: {x, y, w, h} 픽셀 좌표 (없으면 전체 프레임 사용)
   */
  // videoEl: <video> 또는 { _canvas, videoWidth, videoHeight } 형태 모두 허용
  extractHistogram(videoEl, cropRect = null) {
    const srcCanvas = videoEl._canvas || (() => {
      const c = document.createElement('canvas');
      c.width  = videoEl.videoWidth;
      c.height = videoEl.videoHeight;
      c.getContext('2d').drawImage(videoEl, 0, 0);
      return c;
    })();

    let src = srcCanvas;
    if (cropRect && cropRect.w > 20 && cropRect.h > 20) {
      const cc = document.createElement('canvas');
      cc.width  = Math.round(cropRect.w);
      cc.height = Math.round(cropRect.h);
      cc.getContext('2d').drawImage(
        srcCanvas, cropRect.x, cropRect.y, cropRect.w, cropRect.h,
        0, 0, cc.width, cc.height
      );
      src = cc;
    }
    // 4방향(0/90/180/270) 해시 모두 저장 → 회전에 강인한 인식
    const hashes = [0, 90, 180, 270].map(deg =>
      _computePHash(_rotateCanvas(src, deg)).toString()
    );
    return hashes.join(',');
  }

  captureThumbnail(videoEl) {
    const c = document.createElement('canvas');
    c.width  = videoEl.videoWidth;
    c.height = videoEl.videoHeight;
    c.getContext('2d').drawImage(videoEl, 0, 0);
    const thumb = document.createElement('canvas');
    thumb.width  = 160; thumb.height = 120;
    thumb.getContext('2d').drawImage(c, 0, 0, 160, 120);
    return thumb.toDataURL('image/jpeg', 0.7);
  }

  async register({ subjectName, color, thumbnail, histogram }) {
    const tb = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      subjectName, color, thumbnail,
      histogram // pHash string (BigInt.toString())
    };
    this.textbooks.push(tb);
    await Storage.saveTextbook(tb);  // 단수 메서드 (storage.js 기준)
  }

  async remove(id) {
    this.textbooks = this.textbooks.filter(t => t.id !== id);
    await Storage.deleteTextbook(id);
  }

  getColorForSubject(name) {
    const COLORS = [
      '#e8a0b0','#a0b8e8','#e8d0a0','#c8a0e8','#a0e8c8',
      '#e8c8a0','#a0d8e8','#e8b8a0','#b8e8a0','#d0a0e8',
    ];
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
    return COLORS[h % COLORS.length];
  }

  // ── 인식 (타이머 화면에서 호출) ───────────────────────

  setDetectionCallback(cb) { this._cb = cb; this._active = true; }
  stopDetection()          { this._active = false; this._cb = null; this._missCount = 0; }
  resetDetected()          { this._missCount = 0; this._lastScanMs = 0; }

  /** 얼굴 감지됨 → 교재 없음으로 리셋 */
  resetPending() { this._missCount = 0; }

  /**
   * Tracker.onResults() 안에서 매 프레임 호출됨 (얼굴 미감지 시)
   * FaceMesh가 얼굴을 못 찾으면 → missCount 증가
   * → 임계값 도달 시 마지막 얼굴 위치 기반 다중 후보 영역을 스캔
   */
  checkFrame(videoEl) {
    if (!this._active || !this._cb || this.textbooks.length === 0) return;

    this._missCount++;

    // 교재 스캔 중 → 얼굴 소실 졸음 감지 억제 (매 프레임)
    if (typeof DrowsyDetector !== 'undefined') DrowsyDetector.resetFaceGoneTimer();

    if (this._missCount < this.missFrames) return;

    // 스캔 주기 쓰로틀
    const now = performance.now();
    if (now - this._lastScanMs < this.scanIntervalMs) return;
    this._lastScanMs = now;

    const w = videoEl.videoWidth  || 320;
    const h = videoEl.videoHeight || 240;

    // 얼굴 바운딩박스 (없으면 화면 중앙 기준 폴백)
    const faceBox = Tracker.getFaceBBox() || {
      x: w * 0.2, y: h * 0.15,
      w: w * 0.6, h: h * 0.7
    };

    // 디버그 로그 (매 5번째 스캔만 출력)
    this._debugLogged++;
    if (this._debugLogged % 5 === 1) {
      console.info(`[Textbook] 스캔 중 | 얼굴박스: ${Tracker.getFaceBBox() ? '있음' : '폴백'} | missCount:${this._missCount} | 교재수:${this.textbooks.length}`);
    }

    // 현재 프레임 캡처
    const frame = document.createElement('canvas');
    frame.width = w; frame.height = h;
    frame.getContext('2d').drawImage(videoEl, 0, 0, w, h);

    // 후보 영역 생성 (5스케일 × 4수직오프셋 + 전체 화면 추가)
    const candidates = this._buildCandidates(faceBox, w, h);
    // 전체 화면도 후보에 추가 (작은 교재나 멀리 든 경우 대비)
    candidates.push({ x: 0, y: 0, w, h });

    // 모든 후보에서 pHash 계산 → 가장 가까운 교재 선택
    let best = null;
    for (const box of candidates) {
      const cc = document.createElement('canvas');
      cc.width  = Math.round(box.w); cc.height = Math.round(box.h);
      cc.getContext('2d').drawImage(frame, box.x, box.y, box.w, box.h,
                                    0, 0, cc.width, cc.height);
      const hash = _computePHash(cc);

      for (const tb of this.textbooks) {
        if (!tb.histogram) continue;
        try {
          // 4방향 해시 중 가장 가까운 거리 사용 (회전 불변 매칭)
          const storedHashes = tb.histogram.includes(',')
            ? tb.histogram.split(',').map(h => BigInt(h))
            : [BigInt(tb.histogram)]; // 이전 단일 해시 하위 호환
          const dist = Math.min(...storedHashes.map(h => _hammingDist(hash, h)));
          if (!best || dist < best.dist)
            best = { dist, tb };
        } catch {
          // 이전 방식(히스토그램 배열)으로 저장된 교재는 스킵 → 재등록 필요
        }
      }
    }

    if (best) {
      console.info(`[Textbook] 최소거리: ${best.dist} / 임계값: ${this.hammingThresh} → ${best.dist <= this.hammingThresh ? '✅ 매칭: ' + best.tb.subjectName : '❌ 미달'}`);
    }
    if (best && best.dist <= this.hammingThresh) {
      this._missCount = 0; // 매칭 후 리셋
      this._cb(best.tb);
    }
  }

  /** 얼굴 위치 기반 후보 영역 생성 */
  _buildCandidates(faceBox, canvasW, canvasH) {
    const mult   = this.searchScale;
    const scales = [1.4*mult, 1.8*mult, 2.2*mult, 2.7*mult, 3.2*mult];
    const vOff   = [-0.3, -0.1, 0.1, 0.3];
    const boxes  = [];
    const cx     = faceBox.x + faceBox.w / 2;
    const cy     = faceBox.y + faceBox.h / 2;

    for (const s of scales) {
      for (const vo of vOff) {
        const bw = faceBox.w * s;
        const bh = faceBox.h * s * 1.2; // 세로를 약간 더 크게 (교재가 대부분 세로로 듦)
        const bx = cx - bw / 2;
        const by = (cy + vo * faceBox.h) - bh / 2;

        // 캔버스 범위 클램프
        const x = Math.max(0, Math.min(bx, canvasW - Math.min(bw, canvasW)));
        const y = Math.max(0, Math.min(by, canvasH - Math.min(bh, canvasH)));
        const w = Math.min(bw, canvasW - x);
        const h = Math.min(bh, canvasH - y);

        if (w > 10 && h > 10) boxes.push({x, y, w, h});
      }
    }
    return boxes;
  }
}

const TextbookMgr = new TextbookManager();
