/**
 * playground.js — 놀이터(친구) 기능
 *
 * 계정마다 영문 대문자 6자리 친구 코드를 하나씩 발급받는다.
 * 다른 사용자의 코드를 검색해서 "마이쮸 주기"를 누르면 자동으로
 * 서로 친구가 되고, 친구 목록에서 각 친구의 누적 공부 시간과
 * 진열장(수룡이 컬렉션) 종류/개수를 확인할 수 있다.
 *
 * ⚠️ 이 기능은 다른 사용자의 데이터를 조회해야 하므로 Firestore(로그인)가
 * 반드시 필요하다. "로그인 없이 시작하기"(게스트 모드)에서는 쓸 수 없다.
 *
 * ── Firestore 구조 ──────────────────────────────────────────
 * friend_codes/{code}              → { uid }                (코드→uid 조회용, 전체 공개 읽기)
 * users/{uid}/friends/{friendUid}  → { code, addedAt }       (본인만 읽기, 상호 쓰기 허용)
 * users/{uid}/public/profile       → { totalStudyMin, collections, updatedAt }
 *                                     (본인 또는 "친구 목록에 등록된 사람"만 읽기)
 */

const PlaygroundManager = {
  myCode: null,

  _uid() { return (typeof Auth !== 'undefined' && Auth.currentUser) ? Auth.currentUser.uid : null; },
  _db()  { return (typeof Auth !== 'undefined' && Auth.getFirestore) ? Auth.getFirestore() : null; },

  isAvailable() { return !!this._uid() && !!this._db(); },

  // 놀이터 화면 진입 시 호출 — 내 코드가 없으면 새로 발급
  async init() {
    if (!this.isAvailable()) { this.myCode = null; return; }
    this.myCode = await Storage.loadFriendCode();
    if (!this.myCode) {
      try { this.myCode = await this._createUniqueCode(); }
      catch (e) { console.warn('[Playground] 친구 코드 생성 실패:', e); }
    }
  },

  _randomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  },

  async _createUniqueCode() {
    const db  = this._db();
    const uid = this._uid();
    for (let i = 0; i < 5; i++) {
      const code = this._randomCode();
      const ref  = db.collection('friend_codes').doc(code);
      try {
        const snap = await ref.get();
        if (snap.exists) continue; // 이미 쓰이는 코드 → 재시도
        await ref.set({ uid, createdAt: Date.now() });
        await Storage.saveFriendCode(code);
        return code;
      } catch (e) {
        console.warn('[Playground] 코드 등록 시도 실패, 재시도:', e);
      }
    }
    throw new Error('친구 코드 생성에 실패했어요');
  },

  // 친구 코드로 검색. 결과: { ok, msg? , code, targetUid, alreadyFriend }
  async searchByCode(rawCode) {
    if (!this.isAvailable()) return { ok: false, msg: '로그인 후 이용할 수 있어요' };
    const code = (rawCode || '').trim().toUpperCase();
    if (!/^[A-Z]{6}$/.test(code)) return { ok: false, msg: '영문 대문자 6자리 코드를 입력해주세요' };
    if (code === this.myCode) return { ok: false, msg: '내 코드는 사용할 수 없어요' };

    const db = this._db();
    const snap = await db.collection('friend_codes').doc(code).get();
    if (!snap.exists) return { ok: false, msg: '존재하지 않는 코드예요' };

    const targetUid = snap.data().uid;
    if (targetUid === this._uid()) return { ok: false, msg: '내 코드는 사용할 수 없어요' };

    const already = await db.collection('users').doc(this._uid())
      .collection('friends').doc(targetUid).get();

    return { ok: true, code, targetUid, alreadyFriend: already.exists };
  },

  // 마이쮸 주기 → 즉시 상호 친구 등록
  async giveCandy(code, targetUid) {
    if (!this.isAvailable()) return false;
    const db  = this._db();
    const uid = this._uid();
    try {
      const batch = db.batch();
      batch.set(
        db.collection('users').doc(uid).collection('friends').doc(targetUid),
        { code, addedAt: Date.now() }
      );
      batch.set(
        db.collection('users').doc(targetUid).collection('friends').doc(uid),
        { code: this.myCode, addedAt: Date.now() }
      );
      await batch.commit();
      return true;
    } catch (e) {
      console.warn('[Playground] 마이쮸 주기 실패:', e);
      return false;
    }
  },

  // 내 친구 목록 (최근 추가순)
  async getFriends() {
    if (!this.isAvailable()) return [];
    const db  = this._db();
    const uid = this._uid();
    try {
      const snap = await db.collection('users').doc(uid)
        .collection('friends').orderBy('addedAt', 'desc').get();
      return snap.docs.map(d => ({ uid: d.id, code: d.data().code || '??????', addedAt: d.data().addedAt }));
    } catch (e) {
      console.warn('[Playground] 친구 목록 조회 실패:', e);
      return [];
    }
  },

  // 특정 친구의 공개 프로필(공부 시간 + 컬렉션) 조회
  async getFriendProfile(friendUid) {
    if (!this.isAvailable()) return null;
    const db = this._db();
    try {
      const snap = await db.collection('users').doc(friendUid)
        .collection('public').doc('profile').get();
      return snap.exists ? snap.data() : { totalStudyMin: 0, collections: [] };
    } catch (e) {
      console.warn('[Playground] 친구 프로필 조회 실패:', e);
      return null;
    }
  },

  // 내 공개 프로필 최신화 — 공부 세션이 끝나거나 진열장 컬렉션이 바뀔 때 호출
  async syncPublicProfile() {
    if (!this.isAvailable()) return;
    try {
      const db  = this._db();
      const uid = this._uid();
      const sessions = (typeof Planner !== 'undefined' && Planner.sessions) ? Planner.sessions : [];
      const totalMs = sessions.reduce((sum, s) =>
        sum + Math.max(0, (s.endTime || 0) - (s.startTime || 0)), 0);
      const totalStudyMin = Math.round(totalMs / 60000);
      const collections = (typeof Suryong !== 'undefined' ? (Suryong.state.collections || []) : [])
        .map(c => ({ id: c.id, name: c.name }));

      await db.collection('users').doc(uid).collection('public').doc('profile')
        .set({ totalStudyMin, collections, updatedAt: Date.now() }, { merge: true });
    } catch (e) {
      console.warn('[Playground] 공개 프로필 동기화 실패:', e);
    }
  }
};

// ─────────────────────────────────────────────────────────────
// PlaygroundUI — 놀이터 화면 / 모달 렌더링
// ─────────────────────────────────────────────────────────────
const PlaygroundUI = {
  _lastSearch: null, // { code, targetUid, alreadyFriend }

  async enterScreen() {
    const notice  = document.getElementById('pg-guest-notice');
    const actions = document.getElementById('pg-actions');
    if (!PlaygroundManager.isAvailable()) {
      notice?.classList.remove('hidden');
      actions?.classList.add('hidden');
      return;
    }
    notice?.classList.add('hidden');
    actions?.classList.remove('hidden');
    await PlaygroundManager.init();
  },

  // ── 친구 사귀기 모달 ──────────────────────────────────────
  async openMakeFriend() {
    if (!PlaygroundManager.isAvailable()) { alert('로그인 후 이용할 수 있어요.'); return; }
    if (!PlaygroundManager.myCode) await PlaygroundManager.init();

    const codeEl = document.getElementById('pg-mycode-val');
    if (codeEl) codeEl.textContent = PlaygroundManager.myCode || '------';
    const input = document.getElementById('pg-search-input');
    if (input) input.value = '';
    const result = document.getElementById('pg-search-result');
    if (result) result.innerHTML = '';
    this._lastSearch = null;

    document.getElementById('pg-makefriend-modal')?.classList.remove('hidden');
  },

  closeMakeFriend() {
    document.getElementById('pg-makefriend-modal')?.classList.add('hidden');
  },

  async doSearch() {
    const input  = document.getElementById('pg-search-input');
    const result = document.getElementById('pg-search-result');
    if (!input || !result) return;

    result.innerHTML = '<div class="pg-search-status">검색 중...</div>';
    const res = await PlaygroundManager.searchByCode(input.value);

    if (!res.ok) {
      result.innerHTML = `<div class="pg-search-status pg-search-fail">${res.msg}</div>`;
      this._lastSearch = null;
      return;
    }

    this._lastSearch = res;
    if (res.alreadyFriend) {
      result.innerHTML = `
        <div class="pg-search-status pg-search-found">
          <span>${res.code}</span> 님을 찾았어요 — 이미 친구예요 🤝
        </div>`;
    } else {
      result.innerHTML = `
        <div class="pg-search-status pg-search-found">
          <span>${res.code}</span> 님을 찾았어요!
          <button class="btn btn-primary pg-candy-btn" onclick="PlaygroundUI.giveCandy()">🍬 마이쮸 주기</button>
        </div>`;
    }
  },

  async giveCandy() {
    if (!this._lastSearch || this._lastSearch.alreadyFriend) return;
    const { code, targetUid } = this._lastSearch;
    const btn = document.querySelector('.pg-candy-btn');
    if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }

    const ok = await PlaygroundManager.giveCandy(code, targetUid);
    if (ok) {
      const result = document.getElementById('pg-search-result');
      if (result) {
        result.innerHTML = `<div class="pg-search-status pg-search-found">🎉 <span>${code}</span> 님과 친구가 됐어요!</div>`;
      }
      this._lastSearch.alreadyFriend = true;
    } else {
      alert('친구 등록에 실패했어요. 다시 시도해주세요.');
      if (btn) { btn.disabled = false; btn.textContent = '🍬 마이쮸 주기'; }
    }
  },

  // ── 친구 목록 모달 ────────────────────────────────────────
  async openFriendList() {
    if (!PlaygroundManager.isAvailable()) { alert('로그인 후 이용할 수 있어요.'); return; }
    const modal = document.getElementById('pg-friendlist-modal');
    const list  = document.getElementById('pg-friend-list');
    if (!modal || !list) return;

    list.innerHTML = '<div class="pg-empty">불러오는 중...</div>';
    modal.classList.remove('hidden');

    const friends = await PlaygroundManager.getFriends();
    if (!friends.length) {
      list.innerHTML = '<div class="pg-empty">아직 친구가 없어요<br>친구 사귀기로 코드를 주고받아보세요 🤝</div>';
      return;
    }

    list.innerHTML = friends.map(f => `
      <div class="pg-friend-item" onclick="PlaygroundUI.openFriendDetail('${f.uid}','${f.code}')">
        <div class="pg-friend-code">${f.code}</div>
        <div class="pg-friend-arrow">›</div>
      </div>`).join('');
  },

  closeFriendList() {
    document.getElementById('pg-friendlist-modal')?.classList.add('hidden');
  },

  // ── 친구 상세(공부 시간 + 컬렉션) ───────────────────────────
  async openFriendDetail(friendUid, code) {
    const modal = document.getElementById('pg-frienddetail-modal');
    const title = document.getElementById('pg-detail-title');
    const body  = document.getElementById('pg-detail-body');
    if (!modal || !body) return;

    if (title) title.textContent = `${code} 님의 정보`;
    body.innerHTML = '<div class="pg-empty">불러오는 중...</div>';
    modal.classList.remove('hidden');

    const profile = await PlaygroundManager.getFriendProfile(friendUid);
    if (!profile) {
      body.innerHTML = '<div class="pg-empty">정보를 불러오지 못했어요</div>';
      return;
    }

    const h = Math.floor((profile.totalStudyMin || 0) / 60);
    const m = (profile.totalStudyMin || 0) % 60;
    const timeLabel = h > 0 ? `${h}시간 ${m}분` : `${m}분`;
    const colls = profile.collections || [];

    body.innerHTML = `
      <div class="pg-detail-stat">
        <div class="pg-detail-stat-label">📚 누적 공부 시간</div>
        <div class="pg-detail-stat-val">${timeLabel}</div>
      </div>
      <div class="pg-detail-stat">
        <div class="pg-detail-stat-label">🏆 진열장 컬렉션</div>
        <div class="pg-detail-stat-val">${colls.length}종</div>
      </div>
      <div class="pg-detail-colls">
        ${colls.length
          ? colls.map(c => `<span class="pg-detail-coll-chip">${c.name}</span>`).join('')
          : '<div class="pg-empty">아직 졸업한 수룡이가 없어요</div>'}
      </div>`;
  },

  closeFriendDetail() {
    document.getElementById('pg-frienddetail-modal')?.classList.add('hidden');
  }
};
