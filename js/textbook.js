/**
 * textbook.js — 교재 인식 v3 (OpenCV ORB 특징점 매칭)
 *
 * pHash → ORB 전환 이유:
 *   pHash: 전체 밝기 분포 → 유사한 책 구분 불가 (해밍 거리 16~22비트 겹침)
 *   ORB:   표지의 고유한 특징점(모서리·텍스트 경계) 매칭 → 명확한 구분
 */

let _cvReady = false;

function _ensureCV() {
  return new Promise((resolve, reject) => {
    if (_cvReady && window.cv?.Mat) { resolve(); return; }
    if (window.cv?.Mat) { _cvReady = true; resolve(); return; }
    const check = setInterval(() => {
      if (window.cv?.Mat) { _cvReady = true; clearInterval(check); resolve(); }
    }, 150);
    setTimeout(() => { clearInterval(check); reject(new Error('OpenCV 타임아웃')); }, 20000);
  });
}

// ── CLAHE 대비 향상 후 ORB 디스크립터 추출 ─────────────
function _extractDescriptors(canvas) {
  const src  = cv.imread(canvas);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
  const eq    = new cv.Mat();
  clahe.apply(gray, eq);
  const orb  = new cv.ORB(600);
  const kps  = new cv.KeyPointVector();
  const desc = new cv.Mat();
  const mask = new cv.Mat();
  orb.detectAndCompute(eq, mask, kps, desc);
  let result = null;
  if (desc.rows > 0) {
    result = {
      rows: desc.rows, cols: desc.cols,
      data: btoa(String.fromCharCode(...new Uint8Array(desc.data)))
    };
  }
  src.delete(); gray.delete(); eq.delete();
  kps.delete(); desc.delete(); mask.delete(); clahe.delete();
  return result;
}

// ── BFMatcher + Lowe ratio test ─────────────────────────
function _countGoodMatches(queryDesc, trainStored) {
  if (!queryDesc || queryDesc.rows < 5) return 0;
  const bytes = Uint8Array.from(atob(trainStored.data), c => c.charCodeAt(0));
  const trainDesc = new cv.Mat(trainStored.rows, trainStored.cols, cv.CV_8U);
  trainDesc.data.set(bytes);
  let count = 0;
  try {
    const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
    const matches = new cv.DMatchVectorVector();
    matcher.knnMatch(queryDesc, trainDesc, matches, Math.min(2, trainDesc.rows));
    for (let i = 0; i < matches.size(); i++) {
      const m = matches.get(i);
      if (m.size() === 1 && m.get(0).distance < 55) { count++; }
      else if (m.size() >= 2 && m.get(0).distance < 0.75 * m.get(1).distance) { count++; }
    }
    matches.delete(); matcher.delete();
  } catch(e) {}
  trainDesc.delete();
  return count;
}

// ─────────────────────────────────────────────────────────
class TextbookManager {
  constructor() {
    this.textbooks = [];
    this._active      = false;
    this._cb          = null;
    this._missCount   = 0;
    this._lastScanMs  = 0;
    this.missFrames       = 6;
    this.scanIntervalMs   = 600;
    this.minGoodMatches   = 12;
    this.marginMatches    = 4;
    this.searchScale      = 1.0;
    this._pendingMatch    = null;
    this._confirmNeeded   = 3;
    this._lastConfirmedId = null;
    this._lastConfirmedMs = 0;
    this._switchCooldownMs= 4000;
  }

  async init() {
    const saved = await Storage.loadTextbooks();
    if (saved) this.textbooks = saved;
    _ensureCV().then(() => console.info('[Textbook] OpenCV 준비 ✅')).catch(() => {});
  }

  // 등록: ORB 또는 pHash 폴백
  extractHistogram(videoEl, cropRect = null) {
    const srcCanvas = videoEl._canvas || (() => {
      const c = document.createElement('canvas');
      c.width = videoEl.videoWidth; c.height = videoEl.videoHeight;
      c.getContext('2d').drawImage(videoEl, 0, 0);
      return c;
    })();
    let src = srcCanvas;
    if (cropRect && cropRect.w > 20 && cropRect.h > 20) {
      const cc = document.createElement('canvas');
      cc.width  = Math.round(cropRect.w); cc.height = Math.round(cropRect.h);
      cc.getContext('2d').drawImage(srcCanvas, cropRect.x, cropRect.y,
        cropRect.w, cropRect.h, 0, 0, cc.width, cc.height);
      src = cc;
    }
    if (_cvReady && window.cv?.Mat) {
      try {
        const desc = _extractDescriptors(src);
        if (desc) return JSON.stringify({ type: 'orb', ...desc });
      } catch(e) { console.warn('[Textbook] ORB 실패, pHash 폴백'); }
    }
    return _pHashFallback(src);
  }

  captureThumbnail(videoEl) {
    const c = document.createElement('canvas');
    c.width = videoEl.videoWidth; c.height = videoEl.videoHeight;
    c.getContext('2d').drawImage(videoEl, 0, 0);
    const t = document.createElement('canvas');
    t.width = 160; t.height = 120;
    t.getContext('2d').drawImage(c, 0, 0, 160, 120);
    return t.toDataURL('image/jpeg', 0.7);
  }

  async register({ subjectName, color, thumbnail, histogram }) {
    const tb = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      subjectName, color, thumbnail, histogram
    };
    this.textbooks.push(tb);
    await Storage.saveTextbook(tb);
  }

  async remove(id) {
    this.textbooks = this.textbooks.filter(t => t.id !== id);
    await Storage.deleteTextbook(id);
  }

  getColorForSubject(name) {
    const C = ['#e8a0b0','#a0b8e8','#e8d0a0','#c8a0e8','#a0e8c8',
                '#e8c8a0','#a0d8e8','#e8b8a0','#b8e8a0','#d0a0e8'];
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
    return C[h % C.length];
  }

  setDetectionCallback(cb) { this._cb = cb; this._active = true; }
  stopDetection()          { this._active = false; this._cb = null; this._missCount = 0; }
  resetDetected()          { this._missCount = 0; this._lastScanMs = 0; this._pendingMatch = null; }
  resetPending()           { this._missCount = 0; }

  checkFrame(videoEl) {
    if (!this._active || !this._cb || !this.textbooks.length) return;
    this._missCount++;
    if (typeof DrowsyDetector !== 'undefined') DrowsyDetector.resetFaceGoneTimer();
    if (this._missCount < this.missFrames) return;
    const now = performance.now();
    if (now - this._lastScanMs < this.scanIntervalMs) return;
    this._lastScanMs = now;
    if (_cvReady && window.cv?.Mat) this._scanORB(videoEl);
    else this._scanPHash(videoEl);
  }

  _scanORB(videoEl) {
    const w = videoEl.videoWidth || 320, h = videoEl.videoHeight || 240;
    const faceBox = Tracker.getFaceBBox() || {x:w*0.2,y:h*0.1,w:w*0.6,h:h*0.8};
    const frame = document.createElement('canvas');
    frame.width = w; frame.height = h;
    frame.getContext('2d').drawImage(videoEl, 0, 0, w, h);
    const counts = {};
    for (const box of this._buildCandidates(faceBox, w, h)) {
      const cc = document.createElement('canvas');
      cc.width  = Math.round(box.w); cc.height = Math.round(box.h);
      cc.getContext('2d').drawImage(frame, box.x, box.y, box.w, box.h, 0, 0, cc.width, cc.height);
      let qd = null;
      try {
        const s=cv.imread(cc), g=new cv.Mat(), e=new cv.Mat();
        cv.cvtColor(s,g,cv.COLOR_RGBA2GRAY);
        const cl=new cv.CLAHE(2.0,new cv.Size(8,8)); cl.apply(g,e);
        const orb=new cv.ORB(600), kp=new cv.KeyPointVector();
        qd=new cv.Mat(); const m=new cv.Mat();
        orb.detectAndCompute(e,m,kp,qd);
        s.delete();g.delete();e.delete();kp.delete();m.delete();cl.delete();
        for (const tb of this.textbooks) {
          if (!tb.histogram) continue;
          try {
            const p = JSON.parse(tb.histogram);
            if (p.type !== 'orb') continue;
            counts[tb.id] = (counts[tb.id]||0) + _countGoodMatches(qd, p);
          } catch{}
        }
      } catch{}
      if (qd) qd.delete();
    }
    const sorted = Object.entries(counts)
      .map(([id,cnt]) => ({tb:this.textbooks.find(t=>t.id===id), cnt}))
      .filter(x=>x.tb).sort((a,b)=>b.cnt-a.cnt);
    if (!sorted.length || sorted[0].cnt < this.minGoodMatches) {
      this._pendingMatch = null;
      console.info(`[Textbook] 매칭 없음 (최고: ${sorted[0]?.cnt??0})`);
      return;
    }
    const best=sorted[0], margin=sorted[1]?best.cnt-sorted[1].cnt:best.cnt;
    console.info(`[Textbook] ${best.tb.subjectName} ${best.cnt}개 매칭 | 마진: ${margin}`);
    if (margin < this.marginMatches) { this._pendingMatch=null; return; }
    const now = performance.now();
    if (this._lastConfirmedId && this._lastConfirmedId!==best.tb.id
        && now-this._lastConfirmedMs < this._switchCooldownMs) return;
    if (this._pendingMatch?.tbId === best.tb.id) {
      this._pendingMatch.count++;
      if (this._pendingMatch.count >= this._confirmNeeded) {
        console.info(`[Textbook] ✅ ${best.tb.subjectName} (${best.cnt}개 매칭)`);
        this._missCount=0; this._lastConfirmedId=best.tb.id;
        this._lastConfirmedMs=performance.now(); this._pendingMatch=null;
        this._cb(best.tb);
      }
    } else { this._pendingMatch={tbId:best.tb.id,count:1}; }
  }

  _scanPHash(videoEl) {
    const w=videoEl.videoWidth||320, h=videoEl.videoHeight||240;
    const faceBox=Tracker.getFaceBBox()||{x:w*0.2,y:h*0.1,w:w*0.6,h:h*0.8};
    const frame=document.createElement('canvas'); frame.width=w; frame.height=h;
    frame.getContext('2d').drawImage(videoEl,0,0,w,h);
    let best=null;
    for (const box of this._buildCandidates(faceBox,w,h)) {
      const cc=document.createElement('canvas');
      cc.width=Math.round(box.w); cc.height=Math.round(box.h);
      cc.getContext('2d').drawImage(frame,box.x,box.y,box.w,box.h,0,0,cc.width,cc.height);
      const hash=_pHashCanvas(cc);
      for (const tb of this.textbooks) {
        if (!tb.histogram||tb.histogram.startsWith('{')) continue;
        try {
          const hh=tb.histogram.includes(',')?tb.histogram.split(','):[tb.histogram];
          const dist=Math.min(...hh.map(h=>_hammingDist(hash,BigInt(h))));
          if (!best||dist<best.dist) best={dist,tb};
        } catch{}
      }
    }
    if (best&&best.dist<=22) this._cb(best.tb);
  }

  _buildCandidates(fb,cW,cH) {
    const sc=this.searchScale, scales=[1.4*sc,1.8*sc,2.2*sc,2.7*sc,3.2*sc];
    const vOff=[-0.3,-0.1,0.1,0.3], boxes=[];
    const cx=fb.x+fb.w/2, cy=fb.y+fb.h/2;
    for (const s of scales) for (const vo of vOff) {
      const bw=fb.w*s, bh=fb.h*s*1.3, bx=cx-bw/2, by=(cy+vo*fb.h)-bh/2;
      const x=Math.max(0,Math.min(bx,cW-Math.min(bw,cW)));
      const y=Math.max(0,Math.min(by,cH-Math.min(bh,cH)));
      const w=Math.min(bw,cW-x), h=Math.min(bh,cH-y);
      if (w>20&&h>20) boxes.push({x,y,w,h});
    }
    return boxes;
  }
}
const TextbookMgr = new TextbookManager();

// pHash 유틸
function _pHashFallback(src) {
  const hashes=[0,90,180,270].map(d=>_pHashCanvas(_rotateCanvas(src,d)).toString());
  return hashes.join(',');
}
function _pHashCanvas(src){
  const S=32,D=8;
  const basis=Array.from({length:S},(_,k)=>{const r=new Float64Array(S),a=k===0?Math.sqrt(1/S):Math.sqrt(2/S);for(let n=0;n<S;n++)r[n]=a*Math.cos(Math.PI/S*(n+0.5)*k);return r;});
  const sq=(()=>{const c=document.createElement('canvas'),sz=Math.max(src.width,src.height);c.width=c.height=sz;const ctx=c.getContext('2d');ctx.fillStyle='#808080';ctx.fillRect(0,0,sz,sz);ctx.drawImage(src,(sz-src.width)/2,(sz-src.height)/2);return c;})();
  const sm=document.createElement('canvas');sm.width=S;sm.height=S;sm.getContext('2d',{willReadFrequently:true}).drawImage(sq,0,0,S,S);
  const d=sm.getContext('2d').getImageData(0,0,S,S).data;
  const mat=Array.from({length:S},(_,y)=>{const r=new Float64Array(S);for(let x=0;x<S;x++){const i=(y*S+x)*4;r[x]=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];}return r;});
  const tmp=mat.map(r=>{const o=new Float64Array(S);for(let k=0;k<S;k++){let s=0;for(let n=0;n<S;n++)s+=r[n]*basis[k][n];o[k]=s;}return o;});
  const freq=Array.from({length:S},()=>new Float64Array(S));
  for(let x=0;x<S;x++)for(let k=0;k<S;k++){let s=0;for(let n=0;n<S;n++)s+=tmp[n][x]*basis[k][n];freq[k][x]=s;}
  const low=[];for(let y=0;y<D;y++)for(let x=0;x<D;x++)low.push(freq[y][x]);
  const sorted=[...low.slice(1)].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)];
  let hash=0n;for(let i=0;i<low.length;i++){hash<<=1n;if(low[i]>median)hash|=1n;}
  return hash;
}
function _hammingDist(a,b){let x=BigInt(a)^BigInt(b),c=0n;while(x){c+=x&1n;x>>=1n;}return Number(c);}
function _rotateCanvas(src,deg){if(!deg)return src;const swap=deg===90||deg===270;const c=document.createElement('canvas');c.width=swap?src.height:src.width;c.height=swap?src.width:src.height;const ctx=c.getContext('2d');ctx.translate(c.width/2,c.height/2);ctx.rotate(deg*Math.PI/180);ctx.drawImage(src,-src.width/2,-src.height/2);return c;}
