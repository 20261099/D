/**
 * tracker.js — MediaPipe 통합 관리
 * [추가] faceRollDeg: 양쪽 눈 기울기 계산 → 옆 고개 까딱임 감지용
 * [추가] getRollDegree() / getYawDegree() (alias)
 */

class TrackerManager {
  constructor() {
    this._initialized = false;
    this.faceMesh     = null;
    this.hands        = null;
    this.camera       = null;
    this.videoEl      = null;
    this.canvasEl     = null;
    this.faceRollDeg  = 0;

    this.openEAR       = null;
    this.calibDone     = false;
    this._calibSamples = [];

    this.currentEAR    = null;
    this.faceDetected  = false;
    this.faceCentroidY = null;
    this.handVelocity  = 0;
    this._prevHandPos  = null;

    this._onResultCbs  = [];
    this.isRunning     = false;
    
    this.currentExpression = null;   // ★ 추가
    this._lastExprCheck    = 0; 
  }

  async init(videoEl, canvasEl) {
    this.videoEl  = videoEl;
    this.canvasEl = canvasEl;
    if (!TrackerManager._faceApiLoaded) {
      await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_URL);
      await faceapi.nets.faceExpressionNet.loadFromUri(FACE_API_MODEL_URL);
      TrackerManager._faceApiLoaded = true;
  }

    this.calibDone     = false;
    this.openEAR       = null;
    this._calibSamples = [];
    this._onResultCbs  = [];

    if (this._initialized) {
      this.camera = new Camera(videoEl, {
        onFrame: async () => {
          if (!this.isRunning) return;
          await this.faceMesh.send({ image: videoEl });
          await this.hands.send({ image: videoEl });
        },
        width: 320, height: 240
      });
      return;
    }

    this._initialized = true;

    this.faceMesh = new FaceMesh({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${f}`
    });
    this.faceMesh.setOptions({
      maxNumFaces: 1, refineLandmarks: true,
      minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
    });
    this.faceMesh.onResults(r => this._onFaceResults(r));

    this.hands = new Hands({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${f}`
    });
    this.hands.setOptions({
      maxNumHands: 2, modelComplexity: 0,
      minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
    });
    this.hands.onResults(r => this._onHandResults(r));

    this.camera = new Camera(videoEl, {
      onFrame: async () => {
        if (!this.isRunning) return;
        await this.faceMesh.send({ image: videoEl });
        await this.hands.send({ image: videoEl });
      },
      width: 320, height: 240
    });
  }

  async start() {
    this.isRunning = true;
    this.calibDone = false;
    this.openEAR   = null;
    this._calibSamples = [];
    await this.camera.start();
  }

  stop() {
    this.isRunning = false;
    if (this.camera) { try { this.camera.stop(); } catch (e) {} }
    this.faceDetected  = false;
    this.currentEAR    = null;
    this.faceCentroidY = null;
  }

  _onFaceResults(results) {
    const ctx = this.canvasEl?.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);

    if (!results.multiFaceLandmarks?.length) {
      this.faceDetected  = false;
      this.currentEAR    = null;
      this.faceCentroidY = null;
      this._detectExpression();
      this._notifyResults();
      return;
    }

    this.faceDetected = true;
    const lm = results.multiFaceLandmarks[0];

    const lEAR = this._calcEAR(lm, [33, 160, 158, 133, 153, 144]);
    const rEAR = this._calcEAR(lm, [362, 385, 387, 263, 373, 380]);
    this.currentEAR = (lEAR + rEAR) / 2;

    const ySum = lm.reduce((s, p) => s + p.y, 0);
    this.faceCentroidY = ySum / lm.length;

    // roll 계산: 양쪽 눈 바깥 꼭짓점 기울기 → 옆 고개 까딱임 감지용
    const le = lm[33], re = lm[263];
    this.faceRollDeg = Math.atan2(re.y - le.y, re.x - le.x) * (180 / Math.PI);

    if (!this.calibDone) {
      this._calibSamples.push(this.currentEAR);
      if (this._calibSamples.length >= 30) {
        const sorted = [...this._calibSamples].sort((a, b) => b - a);
        const keep   = Math.floor(sorted.length * 0.7);
        this.openEAR  = sorted.slice(0, keep).reduce((a, b) => a + b, 0) / keep;
        this.calibDone = true;
        console.info('[Tracker] 보정 완료 openEAR =', this.openEAR.toFixed(4));
      }
    }

    if (ctx && this.calibDone) this._drawEyeOverlay(ctx, lm, lEAR, rEAR);
    this._detectExpression();   // ★ 이 줄 추가
    this._notifyResults();
  }
    async _detectExpression() {
      const now = Date.now();
      if (now - this._lastExprCheck < 300) return;
      this._lastExprCheck = now;
      if (!this.videoEl || !this.faceDetected) { this.currentExpression = null; return; }

      try {
        const result = await faceapi
          .detectSingleFace(this.videoEl, new faceapi.TinyFaceDetectorOptions())
          .withFaceExpressions();
        if (!result) { this.currentExpression = null; return; }

        const sorted = Object.entries(result.expressions).sort((a, b) => b[1] - a[1]);
        this.currentExpression = { label: sorted[0][0], confidence: sorted[0][1] };
      } catch (e) {
        this.currentExpression = null;
      }
    }
    getExpression() { return this.currentExpression; }
  _onHandResults(results) {
    if (!results.multiHandLandmarks?.length) {
      this.handVelocity = 0; this._prevHandPos = null; return;
    }
    const all  = results.multiHandLandmarks.flat();
    const avgX = all.reduce((s, p) => s + p.x, 0) / all.length;
    const avgY = all.reduce((s, p) => s + p.y, 0) / all.length;
    if (this._prevHandPos) {
      const dx = avgX - this._prevHandPos.x;
      const dy = avgY - this._prevHandPos.y;
      this.handVelocity = Math.sqrt(dx*dx + dy*dy);
    } else {
      this.handVelocity = 0;
    }
    this._prevHandPos = { x: avgX, y: avgY };
  }

  _calcEAR(lm, [i1, i2, i3, i4, i5, i6]) {
    const num = this._dist(lm[i2], lm[i6]) + this._dist(lm[i3], lm[i5]);
    const den = 2 * this._dist(lm[i1], lm[i4]);
    return den > 0 ? num / den : 0;
  }
  _dist(a, b) { return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2); }

  _drawEyeOverlay(ctx, lm, lEAR, rEAR) {
    const W = this.canvasEl.width, H = this.canvasEl.height;
    const drawEye = (idx, ear) => {
      ctx.beginPath();
      idx.forEach((i, n) => {
        const p = lm[i];
        n === 0 ? ctx.moveTo(p.x*W, p.y*H) : ctx.lineTo(p.x*W, p.y*H);
      });
      ctx.closePath();
      ctx.strokeStyle = (ear < this.openEAR * EAR_CLOSE_RATIO)
        ? 'rgba(255,100,100,0.95)' : 'rgba(80,255,160,0.95)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };
    drawEye([33,160,158,133,153,144], lEAR);
    drawEye([362,385,387,263,373,380], rEAR);
  }

  isCalibrated()    { return this.calibDone; }
  getEAR()          { return this.currentEAR; }
  isFaceDetected()  { return this.faceDetected; }
  getCentroidY()    { return this.faceCentroidY; }
  getHandVelocity() { return this.handVelocity; }
  getRollDegree()   { return this.faceRollDeg; }
  getYawDegree()    { return this.faceRollDeg; } // alias (lateral nod detection)

  isEyeClosed() {
    if (!this.calibDone || this.currentEAR === null) return false;
    return this.currentEAR < this.openEAR * EAR_CLOSE_RATIO;
  }
  isEyeOpen() {
    if (!this.calibDone || this.currentEAR === null) return false;
    return this.currentEAR > this.openEAR * EAR_OPEN_RATIO;
  }
  getCalibProgress() { return Math.min(this._calibSamples.length / 30, 1); }

  onResults(cb)    { this._onResultCbs.push(cb); }
  _notifyResults() { this._onResultCbs.forEach(cb => cb()); }
}

const Tracker = new TrackerManager();
