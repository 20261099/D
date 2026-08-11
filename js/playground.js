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
  _db() {
    if (typeof Auth === 'undefined' || !Auth.getFirestore) return null;
    try { return Auth.getFirestore(); } catch(e) { return null; }
  },

  isAvailable() {
    // Firebase Firestore 초기화 타이밍 문제로 _db() 체크 제거
    // → Auth.currentUser가 있으면 (로그인 상태) 기능 사용 가능
    return !!this._uid();
  },

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

      // 최근 7일 공부 기록 요약 (날짜별 공부 분)
      const recentDays = {};
      const cutoff = Date.now() - 7 * 86400000;
      sessions.filter(s => s.startTime >= cutoff && s.endTime).forEach(s => {
        const d = s.date || new Date(s.startTime).toLocaleDateString('sv-SE');
        recentDays[d] = (recentDays[d] || 0) + Math.round((s.endTime - s.startTime) / 60000);
      });

      // 프로필 + 놀이터 수룡이 데이터 동기화
      const profileData = typeof ProfileManager !== 'undefined'
        ? { nickname: ProfileManager.nickname, bgColor: ProfileManager.bgColor, characterImg: ProfileManager.characterImg }
        : {};

      // 놀이터에 공유하는 수룡이 목록 (showInPlayground=true인 것만)
      const playgroundSuryong = (typeof Suryong !== 'undefined' ? Suryong.state.collections || [] : [])
        .filter(c => c.showInPlayground !== false)
        .map(c => ({
          id:      c.id,
          name:    c.name,
          img:     typeof getHakgwaImage !== 'undefined' ? getHakgwaImage(c.id) : `images/hakgwa/hakgwa${c.id}.jpg`,
          message: c.message || '안녕! 🌸'
        }));

      await db.collection('users').doc(uid).collection('public').doc('profile')
        .set({ totalStudyMin, collections, recentDays, ...profileData, playgroundSuryong, updatedAt: Date.now() }, { merge: true });
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
    if (!Auth.currentUser) return;
    document.getElementById('pg-guest-notice')?.classList.add('hidden');
    document.getElementById('pg-actions')?.classList.remove('hidden');
    await PlaygroundManager.init();
  },

  // ── 친구 사귀기 모달 ──────────────────────────────────────
  copyMyCode() {
    const code = PlaygroundManager.myCode;
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      const btn = document.getElementById('pg-copy-btn');
      if (!btn) return;
      btn.textContent = '✓ 복사됨';
      btn.style.background = '#4aab8a';
      setTimeout(() => {
        btn.textContent = '복사';
        btn.style.background = '';
      }, 2000);
    }).catch(() => {
      // clipboard API 실패 시 fallback
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      const btn = document.getElementById('pg-copy-btn');
      if (btn) {
        btn.textContent = '✓ 복사됨';
        setTimeout(() => { btn.textContent = '복사'; }, 2000);
      }
    });
  },

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

    // 친구별 프로필 Firestore에서 로드
    const profilesPromises = friends.map(async f => {
      try {
        const _db_ = PlaygroundManager._db();
        if (!_db_) return { ...f, profile: {} };
        const snap = await _db_.collection('users').doc(f.uid).collection('public').doc('profile').get();
        const profile = snap.exists ? snap.data() : {};
        return { ...f, profile };
      } catch { return { ...f, profile: {} }; }
    });
    const friendsWithProfile = await Promise.all(profilesPromises);

    list.innerHTML = friendsWithProfile.map(f => {
      const nick    = f.profile?.nickname?.trim() || '';
      const displayName = nick || '이름 없음';
      const subLabel    = nick ? `코드: ${f.code}` : `코드: ${f.code} · 닉네임 미설정`;
      const bgCol   = f.profile?.bgColor  || '#c8b8f0';
      const charImg = f.profile?.characterImg || 'images/suryong/su1.jpg';
      const h = Math.floor((f.profile?.totalStudyMin || 0) / 60);
      const m = (f.profile?.totalStudyMin || 0) % 60;
      const timeStr = h > 0 ? `${h}시간 ${m}분` : m > 0 ? `${m}분` : '기록 없음';
      return `
      <div class="pg-friend-item pg-friend-profile-item"
        onclick="PlaygroundUI.openFriendDetail('${f.uid}','${f.code}')"
        style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;background:var(--surface2);border:1.5px solid var(--border-light);margin-bottom:8px;cursor:pointer">
        <div style="width:48px;height:48px;border-radius:50%;background:${bgCol};overflow:hidden;flex-shrink:0">
          <img src="${charImg}" style="width:100%;height:100%;object-fit:contain"
            onerror="this.style.display='none'">
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.9rem;font-weight:800;color:var(--text)">${displayName}</div>
          <div style="font-size:.68rem;color:var(--text-muted);margin-top:1px">${subLabel}</div>
          <div style="font-size:.72rem;color:var(--text-muted);margin-top:2px">📚 ${timeStr}</div>
        </div>
        <div style="color:var(--text-muted)">›</div>
      </div>`;
    }).join('');
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

    if (title) title.textContent = `불러오는 중...`;
    body.innerHTML = '<div class="pg-empty">불러오는 중...</div>';
    modal.classList.remove('hidden');

    const profile = await PlaygroundManager.getFriendProfile(friendUid);
    if (!profile) {
      if (title) title.textContent = `${code} 님의 정보`;
      body.innerHTML = '<div class="pg-empty">정보를 불러오지 못했어요</div>';
      return;
    }
    // 닉네임이 있으면 닉네임, 없으면 코드 사용
    const displayName = profile.nickname?.trim() || code;
    if (title) title.textContent = `${displayName} 님의 정보`;

    const h = Math.floor((profile.totalStudyMin || 0) / 60);
    const m = (profile.totalStudyMin || 0) % 60;
    const timeLabel = h > 0 ? `${h}시간 ${m}분` : `${m}분`;
    const colls = profile.collections || [];

    // 최근 7일 공부 기록 미니 플래너
    const recentDays = profile.recentDays || {};
    const today = new Date().toLocaleDateString('sv-SE');
    const plannerHtml = (() => {
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const ds = d.toLocaleDateString('sv-SE');
        const min = recentDays[ds] || 0;
        const [, mm, dd] = ds.split('-');
        days.push({ ds, label: ds === today ? '오늘' : `${Number(mm)}/${Number(dd)}`, min });
      }
      const maxMin = Math.max(...days.map(d => d.min), 1);
      return `
        <div class="pg-detail-planner">
          ${days.map(d => `
            <div class="pg-planner-col">
              <div class="pg-planner-bar-wrap">
                <div class="pg-planner-bar" style="height:${Math.round(d.min/maxMin*100)}%"></div>
              </div>
              <div class="pg-planner-label ${d.ds === today ? 'pg-today' : ''}">${d.label}</div>
              <div class="pg-planner-min">${d.min > 0 ? (d.min < 60 ? d.min+'분' : Math.round(d.min/60*10)/10+'h') : ''}</div>
            </div>`).join('')}
        </div>`;
    })();

    body.innerHTML = `
      <div class="pg-detail-stat">
        <div class="pg-detail-stat-label">📚 누적 공부 시간</div>
        <div class="pg-detail-stat-val">${timeLabel}</div>
      </div>
      <div class="pg-detail-stat">
        <div class="pg-detail-stat-label">🏆 진열장 컬렉션</div>
        <div class="pg-detail-stat-val">${colls.length}종</div>
      </div>
      <div class="pg-detail-section-title">📅 최근 7일 공부</div>
      ${plannerHtml}
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

// ══════════════════════════════════════════════════════════
// 놀이터 놀러가기
// ══════════════════════════════════════════════════════════
let _pgWalkerIntervals = []; // 이동 interval 목록 (정리용)

PlaygroundUI.openPlayground = async function() {
  if (!Auth.currentUser) { alert('로그인 후 이용할 수 있어요.'); return; }

  const modal = document.getElementById('playground-play-modal');
  if (!modal) return;
  modal.classList.remove('hidden');

  // 패널 초기화
  document.getElementById('pg-panel-list').style.display = '';
  document.getElementById('pg-panel-room').style.display  = 'none';
  PlaygroundUI._clearWalkers();

  // 프로필 목록 로드
  const listEl = document.getElementById('pg-play-profile-list');
  listEl.innerHTML = '<div class="pg-play-loading">불러오는 중...</div>';

  const db  = PlaygroundManager._db();
  const uid = PlaygroundManager._uid();
  if (!db || !uid) { listEl.innerHTML = '<div class="pg-play-loading">로그인이 필요해요</div>'; return; }

  // 내 프로필
  const mySnap    = await db.collection('users').doc(uid).collection('public').doc('profile').get().catch(() => null);
  const myProfile = mySnap?.exists ? mySnap.data() : {};
  const myNick    = myProfile.nickname || Auth.currentUser.email.split('@')[0];
  const myBg      = myProfile.bgColor || '#c8b8f0';
  const myChar    = myProfile.characterImg || 'images/suryong/su1.jpg';
  const mySuryong = myProfile.playgroundSuryong || [];

  // 친구 목록
  const friends = await PlaygroundManager.getFriends().catch(() => []);
  const friendProfiles = await Promise.all(friends.map(async f => {
    const snap = await db.collection('users').doc(f.uid).collection('public').doc('profile').get().catch(() => null);
    const p    = snap?.exists ? snap.data() : {};
    return { uid: f.uid, code: f.code, ...p };
  }));

  // 카드 렌더
  const makeCard = (label, bg, char, suryongs, uid2, isMe) => `
    <div class="pg-play-profile-card ${isMe ? 'pg-play-me' : ''}"
      onclick="PlaygroundUI.enterRoom('${uid2}', '${encodeURIComponent(label)}', ${isMe})">
      <div class="pg-play-avatar" style="background:${bg}">
        <img src="${char}" onerror="this.style.display='none'"
          style="width:100%;height:100%;object-fit:contain">
      </div>
      <div class="pg-play-card-info">
        <div class="pg-play-card-name">${label}${isMe ? ' (나)' : ''}</div>
        <div class="pg-play-card-sub">수룡이 ${suryongs.length}마리</div>
      </div>
      <span style="color:var(--text-muted)">›</span>
    </div>`;

  listEl.innerHTML =
    makeCard(myNick, myBg, myChar, mySuryong, uid, true) +
    friendProfiles.map(f => makeCard(
      f.nickname || f.code,
      f.bgColor || '#c8b8f0',
      f.characterImg || 'images/suryong/su1.jpg',
      f.playgroundSuryong || [],
      f.uid, false
    )).join('');
};

PlaygroundUI.enterRoom = async function(uid, nameEncoded, isMe) {
  const name    = decodeURIComponent(nameEncoded);
  const db      = PlaygroundManager._db();

  // 패널 전환
  document.getElementById('pg-panel-list').style.display = 'none';
  document.getElementById('pg-panel-room').style.display = '';
  document.getElementById('pg-room-title').textContent   = name + '의 방';

  PlaygroundUI._clearWalkers();
  const floor = document.getElementById('pg-room-floor');
  // 빈 방 초기화
  floor.querySelectorAll('.pg-walker-el').forEach(e => e.remove());
  document.getElementById('pg-room-empty').style.display = 'none';

  // 수룡이 목록 가져오기
  let suryongs = [];
  if (isMe) {
    // 내 것: Suryong 상태에서 직접
    suryongs = (typeof Suryong !== 'undefined' ? Suryong.state.collections || [] : [])
      .filter(c => c.showInPlayground !== false)
      .map(c => ({
        img:     typeof getHakgwaImage !== 'undefined' ? getHakgwaImage(c.id) : `images/hakgwa/hakgwa${c.id}.jpg`,
        name:    c.name + ' 수룡이',
        message: c.message || '안녕! 🌸'
      }));
  } else if (db) {
    const snap = await db.collection('users').doc(uid).collection('public').doc('profile').get().catch(() => null);
    suryongs   = snap?.exists ? (snap.data().playgroundSuryong || []) : [];
  }

  if (!suryongs.length) {
    document.getElementById('pg-room-empty').style.display = 'block';
    return;
  }

  suryongs.forEach(s => PlaygroundUI._spawnWalker(floor, s.img, s.name, s.message));
};

PlaygroundUI.backToList = function() {
  PlaygroundUI._clearWalkers();
  document.getElementById('pg-panel-list').style.display = '';
  document.getElementById('pg-panel-room').style.display  = 'none';
};

PlaygroundUI.closePlayground = function() {
  PlaygroundUI._clearWalkers();
  document.getElementById('playground-play-modal')?.classList.add('hidden');
};

PlaygroundUI._clearWalkers = function() {
  _pgWalkerIntervals.forEach(id => clearInterval(id));
  _pgWalkerIntervals = [];
};

PlaygroundUI._spawnWalker = function(floor, imgSrc, name, message) {
  const FLOOR_W = floor.offsetWidth || 340;
  const SIZE    = 72;

  const el = document.createElement('div');
  el.className = 'pg-walker-el';
  el.style.cssText = `position:absolute;width:${SIZE}px;height:${SIZE}px;bottom:12px;cursor:pointer;z-index:2`;

  const img = document.createElement('img');
  img.src     = imgSrc;
  img.alt     = name;
  img.onerror = () => { img.src = 'images/suryong/su1.jpg'; };
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block';
  el.appendChild(img);
  floor.appendChild(el);

  // 시작 위치
  let x   = Math.random() * Math.max(0, FLOOR_W - SIZE);
  let dir = Math.random() > 0.5 ? 1 : -1;
  const spd = 0.9 + Math.random() * 0.7;
  el.style.left = x + 'px';

  const iv = setInterval(() => {
    const fw = floor.offsetWidth || FLOOR_W;
    x += dir * spd;
    if (x < 0)           { x = 0;          dir = 1;  }
    if (x > fw - SIZE)   { x = fw - SIZE;  dir = -1; }
    el.style.left = x + 'px';
    img.style.transform = dir > 0 ? 'scaleX(-1)' : 'scaleX(1)';
  }, 40);
  _pgWalkerIntervals.push(iv);

  // 클릭: interval은 건드리지 않음
  el.onclick = (e) => {
    e.stopPropagation();
    PlaygroundUI._onWalkerClick(floor, el, message);
  };
};

PlaygroundUI._onWalkerClick = function(floor, walker, message) {
  // 소리
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start(); osc.stop(ctx.currentTime + 0.35);
  } catch(e) {}

  // 말풍선 (floor 기준, walker 위에)
  const bubble = document.createElement('div');
  bubble.textContent = message;
  bubble.style.cssText = [
    'position:absolute',
    `left:${(parseFloat(walker.style.left) || 0) + 36}px`,
    `bottom:${12 + 72 + 6}px`,
    'transform:translateX(-50%)',
    'background:white',
    'border:1.5px solid #d8c8f0',
    'border-radius:12px',
    'padding:5px 10px',
    'font-size:.72rem',
    'font-weight:700',
    'white-space:nowrap',
    'box-shadow:0 2px 8px rgba(0,0,0,.12)',
    'z-index:10',
    'pointer-events:none',
    'max-width:130px',
    'white-space:normal',
    'text-align:center'
  ].join(';');
  floor.appendChild(bubble);
  setTimeout(() => bubble.remove(), 2500);

  // 하트 (floor 기준)
  const emojis = ['💜','💛','💖','💕','🌸','✨'];
  const wx     = parseFloat(walker.style.left) || 0;
  for (let i = 0; i < 5; i++) {
    const h = document.createElement('span');
    h.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    const offsetX = wx + 10 + Math.random() * 52;
    const offsetY = 12 + 72 + 4 + Math.random() * 10;
    h.style.cssText = [
      'position:absolute',
      `left:${offsetX}px`,
      `bottom:${offsetY}px`,
      `font-size:${14 + Math.random() * 8}px`,
      'pointer-events:none',
      'z-index:20',
      `animation:heartFloat ${0.8 + Math.random() * 0.4}s ease forwards`,
      `animation-delay:${i * 0.07}s`
    ].join(';');
    floor.appendChild(h);
    setTimeout(() => h.remove(), 1400);
  }
};
