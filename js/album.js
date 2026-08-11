/**
 * album.js — 공부 앨범(타임랩스)
 *
 * 공부 시간(쉬는시간 제외) 동안 일정 간격으로 카메라 사진을 찍어서
 * 날짜별로 모아두고, 그 사진들을 하루 단위 타임랩스 "동영상 파일"로
 * 만들어서 앱 안에서 재생하거나 기기 갤러리(사진 앱)에 저장할 수 있다.
 *
 * ── 저장 위치 ──────────────────────────────────────────────
 * 이 앱의 다른 데이터(설정, 세션 등)는 localStorage를 쓰는데, localStorage는
 * 용량이 보통 5~10MB밖에 안 돼서 사진/동영상을 저장하기엔 너무 작다.
 * 그래서 앨범 데이터(사진 원본 + 인코딩된 동영상)는 브라우저의 IndexedDB
 * (훨씬 큰 용량, 여전히 기기 로컬/무료)에 별도로 저장한다. 서버(클라우드)에는
 * 올라가지 않으므로 이 기기에서만 볼 수 있다.
 *
 * ── 촬영과 인코딩은 서로 다른 시점/방식으로 이뤄진다 ──────────
 * 촬영(공부 중): 사진을 1분마다 한 장씩 찍어서 IndexedDB(frames)에 쌓아둔다.
 *   실시간으로 몇 시간씩 동영상을 녹화하는 건 아이폰 Safari에서 불안정하고
 *   저장 용량도 많이 잡아먹어서 이 방식을 피했다.
 * 인코딩(필요할 때 딱 한 번): 그 날짜를 처음 열어보거나 저장할 때, 이미
 *   찍어둔 사진들을 캔버스에 순서대로 빠르게 그리면서 MediaRecorder로
 *   녹화해서 진짜 mp4/webm 파일을 만든다. 이 녹화는 최종 영상 길이만큼만
 *   걸린다 — 즉 "짧게 녹화한다"는 게 곧 타임랩스로 압축된 결과 그 자체다.
 *   (사진 180장, 초당 8장 재생 → 인코딩도 정확히 22.5초 걸리고, 그 22.5초가
 *   그대로 완성된 영상 길이다. 별도로 자르는 과정은 없다.)
 *   완성된 동영상은 IndexedDB(videos)에 캐시해둬서, 다음에 또 볼 때나
 *   저장할 때 다시 인코딩하지 않고 그대로 재사용한다 — 그래서 앱 안에서
 *   재생하는 영상과 갤러리에 저장되는 영상이 항상 완전히 같은 파일이다.
 *   그 날짜에 사진이 새로 추가되면(예: 같은 날 공부를 더 함) 캐시는
 *   자동으로 무효화되고 다음에 열 때 새로 인코딩된다.
 */

// ─────────────────────────────────────────────────────────────
// AlbumDB — IndexedDB 저장 레이어 (사진 원본 + 인코딩된 동영상 캐시)
// ─────────────────────────────────────────────────────────────
const AlbumDB = {
  _db: null,

  _open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._db = null; // 캐시 초기화로 다음에 재시도 가능
        reject(new Error('IndexedDB 열기 타임아웃 (5초)'));
      }, 5000);
      const done = (fn) => { clearTimeout(timeout); fn(); };

      let req;
      try {
        req = indexedDB.open('fittimer_album', 1);
      } catch (e) {
        clearTimeout(timeout);
        return reject(e);
      }

      req.onupgradeneeded = (event) => {
        try {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('frames')) {
            const store = db.createObjectStore('frames', { keyPath: 'id', autoIncrement: true });
            store.createIndex('date', 'date', { unique: false });
          }
          if (!db.objectStoreNames.contains('videos')) {
            db.createObjectStore('videos', { keyPath: 'date' });
          }
        } catch (e) { done(() => reject(e)); }
      };
      req.onsuccess = (event) => done(() => {
        this._db = event.target.result;
        // DB 연결 에러 시 캐시 초기화
        this._db.onerror = () => { this._db = null; };
        resolve(this._db);
      });
      req.onerror   = (event) => done(() => reject(event.target.error));
      req.onblocked = ()      => done(() => {
        this._db = null;
        reject(new Error('IndexedDB가 다른 탭에서 사용 중이에요. 다른 탭을 닫고 다시 시도해주세요.'));
      });
    });
  },

  // ── 사진 원본 ─────────────────────────────────────────────
  async addFrame(date, ts, dataUrl) {
    const db = await this._open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('frames', 'readwrite');
      tx.objectStore('frames').add({ date, ts, dataUrl });
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
    // 새 사진이 추가되면 그 날짜의 캐시된 동영상은 더 이상 최신이 아니므로 무효화
    await this.deleteVideo(date).catch(() => {});
  },

  async getFrames(date) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => resolve([]), 4000); // 4초 내 못 읽으면 빈 배열
      const done = (fn) => { clearTimeout(timeout); fn(); };
      const tx  = db.transaction('frames', 'readonly');
      const idx = tx.objectStore('frames').index('date');
      const req = idx.getAll(IDBKeyRange.only(date));
      req.onsuccess = () => done(() => resolve((req.result || []).sort((a, b) => a.ts - b.ts)));
      req.onerror   = () => done(() => resolve([]));
      tx.onerror    = () => done(() => resolve([]));
    });
  },

  // 사진이 있는 날짜 목록 (최신순)
  async getDates() {
    // _open() 자체가 실패할 수 있으므로 try-catch로 감쌈
    let db;
    try { db = await this._open(); }
    catch(e) { console.warn('[Album] DB 열기 실패:', e.message); return []; }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[Album] getDates 타임아웃');
        resolve([]);
      }, 5000);
      const done = (result) => { clearTimeout(timeout); resolve(result); };

      let tx;
      try { tx = db.transaction('frames', 'readonly'); }
      catch(e) { done([]); return; }

      const idx = tx.objectStore('frames').index('date');
      const req = idx.openKeyCursor(null, 'nextunique');
      const dates = [];
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) { dates.push(cursor.key); cursor.continue(); }
        else done(dates.sort().reverse());
      };
      req.onerror  = () => done([]);
      tx.onerror   = () => done([]);
      tx.onabort   = () => done([]);
    });
  },

  async deleteDate(date) {
    const db = await this._open();
    await new Promise((resolve, reject) => {
      const tx  = db.transaction('frames', 'readwrite');
      const idx = tx.objectStore('frames').index('date');
      const req = idx.openCursor(IDBKeyRange.only(date));
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
    await this.deleteVideo(date).catch(() => {});
  },

  // 보관 기간이 지난 옛날 앨범 자동 정리
  async cleanupOld(retentionDays = ALBUM_RETENTION_DAYS) {
    try {
      const cutoff = new Date(Date.now() - retentionDays * 86400000).toLocaleDateString('sv-SE');
      const dates = await this.getDates();
      for (const d of dates) {
        if (d < cutoff) await this.deleteDate(d);
      }
    } catch (e) { console.warn('[Album] 정리 실패:', e); }
  },

  // ── 인코딩된 동영상 캐시 ────────────────────────────────────
  async getVideo(date) {
    let db;
    try { db = await this._open(); } catch(e) { return null; }
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), 4000);
      const done = (v) => { clearTimeout(t); resolve(v); };
      try {
        const tx  = db.transaction('videos', 'readonly');
        const req = tx.objectStore('videos').get(date);
        req.onsuccess = () => done(req.result || null);
        req.onerror   = () => done(null);
        tx.onerror    = () => done(null);
      } catch(e) { done(null); }
    });
  },

  async saveVideo(date, blob, mimeType, frameCount) {
    let db;
    try { db = await this._open(); } catch(e) { return; }
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(), 5000);
      const done = () => { clearTimeout(t); resolve(); };
      try {
        const tx = db.transaction('videos', 'readwrite');
        tx.objectStore('videos').put({ date, blob, mimeType, frameCount, encodedAt: Date.now() });
        tx.oncomplete = () => done();
        tx.onerror    = () => done();
      } catch(e) { done(); }
    });
  },

  async deleteVideo(date) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('videos', 'readwrite');
      tx.objectStore('videos').delete(date);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  },

  // 캐시가 있고 최신(그 뒤로 새 사진이 안 찍힘)이면 그대로 반환, 아니면 null
  async getFreshVideo(date, currentFrameCount) {
    const cached = await this.getVideo(date).catch(() => null);
    if (cached && cached.frameCount === currentFrameCount) return cached;
    return null;
  }
};

// ─────────────────────────────────────────────────────────────
// AlbumRecorder — 공부 중 주기적으로 사진 캡처
// ─────────────────────────────────────────────────────────────
const AlbumRecorder = {
  _interval: null,
  _videoEl:  null,

  // 타이머 화면 시작 시 호출 (카메라가 켜져 있을 때만 의미 있음)
  // ⚠️ 프라이버시: 설정에서 앨범 기능이 꺼져 있으면(기본값) 아예 시작하지 않음.
  start(videoEl) {
    this.stop();
    if (typeof AppState === 'undefined' || !AppState.settings?.albumEnabled) return;
    this._videoEl = videoEl;
    this._interval = setInterval(() => this._tick(), ALBUM_CAPTURE_INTERVAL_SEC * 1000);
  },

  async _tick() {
    if (!this._videoEl) return;
    // 설정에서 도중에 껐다면 즉시 중단 (다음 tick에서 캡처 안 되도록)
    if (typeof AppState === 'undefined' || !AppState.settings?.albumEnabled) { this.stop(); return; }
    // 쉬는시간이거나 일시정지 중이면 캡처 안 함 ("공부 시간만" 요건)
    if (typeof Timer === 'undefined' || Timer.getPhase() !== 'study' || !Timer.isRunning()) return;
    if (this._videoEl.readyState < 2) return;

    try {
      const dataUrl = this._captureFullFrame(this._videoEl);
      const date = PlannerManager.today();
      await AlbumDB.addFrame(date, Date.now(), dataUrl);
    } catch (e) {
      console.warn('[Album] 캡처 실패:', e);
    }
  },

  _captureFullFrame(videoEl) {
    const vw = videoEl.videoWidth  || 320;
    const vh = videoEl.videoHeight || 240;
    const targetW = ALBUM_FRAME_WIDTH;
    const targetH = Math.round(targetW * (vh / vw));
    const c = document.createElement('canvas');
    c.width = targetW; c.height = targetH;
    c.getContext('2d').drawImage(videoEl, 0, 0, targetW, targetH);
    return c.toDataURL('image/jpeg', 0.5);
  },

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    this._videoEl = null;
  }
};

// ─────────────────────────────────────────────────────────────
// AlbumEncoder — 사진 시퀀스를 실제 동영상 파일(mp4/webm)로 인코딩
// ─────────────────────────────────────────────────────────────
const AlbumEncoder = {
  isSupported() {
    return typeof MediaRecorder !== 'undefined' &&
      !!(HTMLCanvasElement.prototype.captureStream || HTMLCanvasElement.prototype.webkitCaptureStream);
  },

  _pickMimeType() {
    // Safari는 보통 mp4만, Chrome/Firefox는 보통 webm만 지원 → 순서대로 탐색
    const candidates = [
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    for (const t of candidates) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  },

  _loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  },

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); },

  // frames: [{ts, dataUrl}, ...] (시간순 정렬된 상태) → 동영상 Blob 반환
  // 녹화(인코딩) 시간 = 완성된 영상 길이 그 자체 (frames.length / FPS 초).
  // 별도로 자르거나 줄이는 과정 없이, 이 시간 동안 녹화된 게 곧 최종 결과물이다.
  // onProgress(current, total)로 진행 상황을 알려줄 수 있음
  async encode(frames, onProgress) {
    if (!frames.length) throw new Error('사진이 없어요');
    if (!this.isSupported()) throw new Error('이 브라우저는 동영상 저장을 지원하지 않아요');

    // 최대 인코딩 시간: 프레임 수 기반 + 여유 10초
    const maxMs = Math.max(frames.length * (1000 / ALBUM_PLAYBACK_FPS) * 2 + 10000, 30000);
    let _recorder = null;

    const encodePromise = (async () => {
      const first = await this._loadImage(frames[0].dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width  = first.width;
      canvas.height = first.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(first, 0, 0);

      const captureFn = canvas.captureStream || canvas.webkitCaptureStream;
      if (!captureFn) throw new Error('captureStream 미지원');
      const stream   = captureFn.call(canvas, ALBUM_PLAYBACK_FPS);
      const mimeType = this._pickMimeType();
      if (!mimeType) throw new Error('지원하는 동영상 형식이 없어요');

      const recorder = new MediaRecorder(stream, { mimeType });
      _recorder = recorder;
      const chunks = [];
      recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };

      const stopped = new Promise((resolve, reject) => {
        recorder.onstop  = resolve;
        recorder.onerror = e => reject(e.error || new Error('MediaRecorder 오류'));
      });
      recorder.start(200); // 200ms마다 데이터 청크 수집

      const frameDurationMs = 1000 / ALBUM_PLAYBACK_FPS;
      for (let i = 0; i < frames.length; i++) {
        const img = await this._loadImage(frames[i].dataUrl);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (onProgress) onProgress(i + 1, frames.length);
        await this._sleep(frameDurationMs);
      }

      recorder.stop();
      await stopped;

      if (!chunks.length) throw new Error('인코딩 결과가 없어요');
      return { blob: new Blob(chunks, { type: mimeType }), mimeType };
    })();

    // 타임아웃 적용
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => {
        try { if (_recorder?.state === 'recording') _recorder.stop(); } catch {}
        reject(new Error('인코딩 타임아웃 — 사진이 너무 많거나 기기 성능 부족'));
      }, maxMs)
    );

    return Promise.race([encodePromise, timeoutPromise]);
  }
};

// 캐시된 동영상이 있고 최신이면 그대로, 없거나 오래됐으면 새로 인코딩해서 캐시.
// 이 함수 하나를 앱 내 재생과 저장(내보내기) 양쪽에서 똑같이 사용 →
// "앱에서 보는 영상"과 "갤러리에 저장되는 영상"이 항상 같은 파일이 되도록 보장한다.
async function getOrEncodeVideo(date, onProgress) {
  const frames = await AlbumDB.getFrames(date);
  if (!frames.length) return null;

  const fresh = await AlbumDB.getFreshVideo(date, frames.length);
  if (fresh) return fresh;

  const { blob, mimeType } = await AlbumEncoder.encode(frames, onProgress);
  await AlbumDB.saveVideo(date, blob, mimeType, frames.length);
  return { date, blob, mimeType, frameCount: frames.length };
}

// ─────────────────────────────────────────────────────────────
// AlbumUI — 갤러리 / 재생 / 저장 화면
// ─────────────────────────────────────────────────────────────
const AlbumUI = {
  _allDates: [],
  _currentDate: null,
  _currentVideoUrl: null, // URL.createObjectURL로 만든 임시 URL (닫을 때 해제 필요)

  _selectMode: false,
  _selectedDates: new Set(),

  // 앨범 화면 진입 시 호출
  async renderGallery() {
    const grid = document.getElementById('album-grid');
    if (!grid) return;

    // 앨범 비활성화 상태
    if (typeof AppState !== 'undefined' && !AppState.settings?.albumEnabled) {
      grid.innerHTML = '<div class="album-empty">앨범 기능이 꺼져 있어요.<br>설정에서 켜면 공부 중 자동으로 사진이 찍혀요 📸</div>';
      return;
    }

    // IndexedDB 지원 여부 확인
    if (typeof indexedDB === 'undefined') {
      grid.innerHTML = '<div class="album-empty">이 브라우저는 앨범 기능을 지원하지 않아요.</div>';
      return;
    }

    grid.innerHTML = '<div class="album-empty">불러오는 중...</div>';
    console.log('[Album] renderGallery 시작');
    this._selectMode = false;
    this._selectedDates.clear();
    this._updateSelectBar();

    // 전체 로딩에 12초 하드 타임아웃
    let _timedOut = false;
    const hardTimeout = setTimeout(() => {
      _timedOut = true;
      grid.innerHTML = `<div class="album-empty">불러오는 데 시간이 너무 걸려요 😢<br><small>IndexedDB가 응답하지 않아요</small><br><br><button class="btn btn-ghost btn-sm" onclick="AlbumUI.renderGallery()">다시 시도</button></div>`;
    }, 12000);

    try {
      // cleanupOld는 백그라운드에서만 실행 (갤러리 표시 차단 안 함)
      AlbumDB.cleanupOld().catch(() => {});

      console.log('[Album] getDates 호출 시작');
      const dates = await AlbumDB.getDates();
      console.log('[Album] getDates 완료, 날짜 수:', dates.length);
      if (_timedOut) return;

      this._allDates = dates;
      clearTimeout(hardTimeout);

      if (!dates.length) {
        grid.innerHTML = '<div class="album-empty">아직 저장된 타임랩스가 없어요<br>공부를 시작하면 자동으로 쌓여요 📸</div>';
        return;
      }

      const cards = await Promise.all(dates.map(d => this._buildCard(d).catch(() => '')));
      if (_timedOut) return;
      grid.innerHTML = cards.filter(Boolean).join('') ||
        '<div class="album-empty">불러올 수 없어요. 다시 시도해주세요.</div>';

    } catch (e) {
      clearTimeout(hardTimeout);
      if (_timedOut) return;
      console.warn('[Album] 갤러리 로딩 실패:', e.message);
      grid.innerHTML = `<div class="album-empty">앨범을 불러오지 못했어요 😢<br><small>${e.message || ''}</small><br><br><button class="btn btn-ghost btn-sm" onclick="AlbumUI.renderGallery()">다시 시도</button></div>`;
    }
  },

  async _buildCard(date) {
    const frames = await AlbumDB.getFrames(date).catch(() => []);
    if (!frames.length) return '';
    const thumb = frames[Math.floor(frames.length / 2)].dataUrl; // 가운데 프레임을 대표 썸네일로
    const [, m, d] = date.split('-');
    const label = PlannerManager.formatDateLabel(date);
    return `
      <div class="album-card" data-date="${date}" onclick="AlbumUI.onCardClick('${date}')">
        <div class="album-card-check" data-date="${date}">✓</div>
        <img src="${thumb}" alt="${date} 타임랩스">
        <div class="album-card-label">${label === '오늘' ? '오늘' : `${m}월 ${d}일`}</div>
        <div class="album-card-sub">사진 ${frames.length}장</div>
        <button class="album-card-save" onclick="event.stopPropagation(); AlbumUI.saveDayAsVideo('${date}')">💾</button>
      </div>`;
  },

  // ── 다중 선택 모드 ────────────────────────────────────────
  toggleSelectMode() {
    this._selectMode = !this._selectMode;
    if (!this._selectMode) this._selectedDates.clear();
    document.getElementById('album-grid')?.classList.toggle('select-mode', this._selectMode);
    const btn = document.getElementById('btn-album-select');
    if (btn) btn.textContent = this._selectMode ? '취소' : '선택';
    this._updateSelectBar();
  },

  onCardClick(date) {
    if (this._selectMode) {
      if (this._selectedDates.has(date)) this._selectedDates.delete(date);
      else this._selectedDates.add(date);
      const check = document.querySelector(`.album-card-check[data-date="${date}"]`);
      check?.classList.toggle('checked', this._selectedDates.has(date));
      this._updateSelectBar();
    } else {
      this.openPlayer(date);
    }
  },

  _updateSelectBar() {
    const bar   = document.getElementById('album-select-bar');
    const label = document.getElementById('album-select-count');
    if (!bar) return;
    const n = this._selectedDates.size;
    bar.classList.toggle('hidden', !(this._selectMode && n > 0));
    if (label) label.textContent = `선택한 ${n}일 저장`;
  },

  async saveSelected() {
    const dates = [...this._selectedDates];
    if (!dates.length) return;
    for (let i = 0; i < dates.length; i++) {
      this._showProgress(`(${i + 1}/${dates.length}일째) 인코딩 준비 중...`);
      try {
        await this._exportDate(dates[i], (cur, total) => {
          this._showProgress(`(${i + 1}/${dates.length}일째) 사진 ${cur}/${total}장 처리 중...`);
        });
      } catch (e) {
        console.warn('[Album] 저장 실패:', dates[i], e);
      }
      // 연속으로 공유/다운로드 시트가 겹치지 않도록 짧게 텀을 둠
      await AlbumEncoder._sleep(400);
    }
    this._hideProgress();
    this.toggleSelectMode();
  },

  // ── 재생 (날짜 단위로 하나씩 넘겨봄) ─────────────────────────
  async openPlayer(date) {
    const modal = document.getElementById('album-player-modal');
    const video = document.getElementById('album-player-video');
    const title = document.getElementById('album-player-title');
    if (!modal || !video) return;

    modal.classList.remove('hidden');
    this._setNavButtonsEnabled(false);
    this._showProgress('불러오는 중...');

    try {
      // 인코딩 (타임아웃 + 취소 기능)
      let _encodeCancelled = false;
      const result = await Promise.race([
        getOrEncodeVideo(date, (cur, total) => {
          this._showProgress(`사진 ${cur}/${total}장 처리 중...`, () => { _encodeCancelled = true; });
        }),
        new Promise((_, r) => setTimeout(() => r(new Error('인코딩 타임아웃 (20초)')), 20000)),
        new Promise((_, r) => {
          const check = setInterval(() => { if (_encodeCancelled) { clearInterval(check); r(new Error('취소됨')); }}, 200);
        })
      ]).catch(e => { console.warn('[Album] 인코딩 실패:', e.message); return null; });
      if (!result) { this.closePlayer(); return; }

      this._currentDate = date;
      if (this._currentVideoUrl) URL.revokeObjectURL(this._currentVideoUrl);
      this._currentVideoUrl = URL.createObjectURL(result.blob);
      video.src = this._currentVideoUrl;
      video.play().catch(() => {}); // 자동재생 실패해도 무시(사용자가 직접 재생 가능)

      const [, m, d] = date.split('-');
      if (title) title.textContent = `${m}월 ${d}일 타임랩스`;
    } catch (e) {
      console.warn('[Album] 재생용 인코딩 실패:', e);
      alert('타임랩스를 불러오지 못했어요.');
      this.closePlayer();
      return;
    } finally {
      this._hideProgress();
      this._setNavButtonsEnabled(true);
    }
  },

  closePlayer() {
    const video = document.getElementById('album-player-video');
    if (video) { video.pause(); video.src = ''; }
    if (this._currentVideoUrl) { URL.revokeObjectURL(this._currentVideoUrl); this._currentVideoUrl = null; }
    this._currentDate = null;
    document.getElementById('album-player-modal')?.classList.add('hidden');
  },

  // 날짜 목록에서 이전/다음 날짜로 이동 (하루씩 넘겨보기)
  goDay(delta) {
    if (!this._currentDate || !this._allDates.length) return;
    const idx = this._allDates.indexOf(this._currentDate);
    if (idx === -1) return;
    const nextIdx = idx + delta; // _allDates는 최신순이라 delta=1이 "더 이전 날짜"
    if (nextIdx < 0 || nextIdx >= this._allDates.length) return;
    this.openPlayer(this._allDates[nextIdx]);
  },

  _setNavButtonsEnabled(enabled) {
    const prev = document.getElementById('album-player-prev');
    const next = document.getElementById('album-player-next');
    if (prev) prev.disabled = !enabled;
    if (next) next.disabled = !enabled;
  },

  // ── 저장(내보내기) ────────────────────────────────────────
  // 재생 화면에서 현재 열려있는 날짜를 저장 (이미 캐시된 영상이 있으면 재인코딩 없이 그대로 씀)
  savePlayingDay() {
    if (this._currentDate) this.saveDayAsVideo(this._currentDate);
  },

  async saveDayAsVideo(date) {
    if (!AlbumEncoder.isSupported()) {
      alert('이 브라우저(또는 기기)는 동영상 저장 기능을 지원하지 않아요.');
      return;
    }
    this._showProgress('인코딩 준비 중...');
    try {
      await this._exportDate(date, (cur, total) => {
        this._showProgress(`사진 ${cur}/${total}장 처리 중...`);
      });
    } catch (e) {
      console.warn('[Album] 저장 실패:', e);
      alert('동영상 저장에 실패했어요. 다시 시도해주세요.');
    } finally {
      this._hideProgress();
    }
  },

  async _exportDate(date, onProgress) {
    const result = await getOrEncodeVideo(date, onProgress);
    if (!result) return;
    const { blob, mimeType } = result;
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const filename = `fittimer_${date}.${ext}`;

    try {
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], filename, { type: mimeType });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: `${date} 공부 타임랩스` });
          return;
        }
      }
    } catch (e) {
      if (e?.name === 'AbortError') return; // 사용자가 공유 취소
      console.warn('[Album] 공유 실패, 다운로드로 대체:', e);
    }

    // 폴백: 다운로드 (데스크톱은 바로 저장, iOS는 "파일" 앱에 저장된 뒤
    // 직접 사진 앱으로 옮겨야 할 수 있음)
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },

  // ── 진행 상황 표시 ────────────────────────────────────────
  _showProgress(text, onCancel) {
    const overlay   = document.getElementById('album-progress-overlay');
    const label     = document.getElementById('album-progress-text');
    const cancelBtn = document.getElementById('album-progress-cancel');
    if (label)   label.textContent = text;
    overlay?.classList.remove('hidden');
    if (cancelBtn) {
      cancelBtn.style.display = onCancel ? 'block' : 'none';
      cancelBtn._onCancel = onCancel || null;
    }
  },
  _cancelProgress() {
    const btn = document.getElementById('album-progress-cancel');
    if (btn?._onCancel) btn._onCancel();
    this._hideProgress();
  },
  _hideProgress() {
    document.getElementById('album-progress-overlay')?.classList.add('hidden');
    const btn = document.getElementById('album-progress-cancel');
    if (btn) { btn.style.display = 'none'; btn._onCancel = null; }
  }
};
