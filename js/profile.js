/**
 * profile.js — 사용자 프로필 관리
 *   닉네임, 배경색, 캐릭터(해금된 수룡이)
 */

const BG_COLORS = [
  { name: '라벤더', value: '#c8b8f0' },
  { name: '민트',   value: '#b8e8d8' },
  { name: '피치',   value: '#f0c8c8' },
  { name: '스카이', value: '#b8d8f0' },
  { name: '레몬',   value: '#f0e8b8' },
  { name: '라일락', value: '#d8b8f0' },
  { name: '코랄',   value: '#f0c8b0' },
  { name: '세이지', value: '#c8dcc8' },
  { name: '블루베리', value: '#7b6fc4' },
  { name: '딥민트', value: '#4aab8a' },
];

const ProfileManager = {
  _data: { nickname: '', bgColor: '#c8b8f0', characterImg: 'images/suryong/su1.jpg' },

  async init() {
    this._data = await Storage.loadProfile();
  },

  get nickname()     { return this._data.nickname || ''; },
  get bgColor()      { return this._data.bgColor   || '#c8b8f0'; },
  get characterImg() { return this._data.characterImg || 'images/suryong/su1.jpg'; },

  async save(updates) {
    Object.assign(this._data, updates);
    await Storage.saveProfile(this._data);
    // Firestore 동기화 (놀이터용)
    if (typeof PlaygroundManager !== 'undefined') {
      PlaygroundManager.syncPublicProfile().catch(() => {});
    }
  },

  /** 선택 가능한 캐릭터 목록 (해금된 수룡이 단계 + 과잠 컬렉션) */
  getAvailableCharacters() {
    const chars = [];
    if (typeof Suryong === 'undefined') return chars;

    const highest      = Suryong.state.highestStage || Suryong.state.stage || 0;
    const everGraduated= (Suryong.state.collections || []).length > 0;
    const maxStage     = everGraduated ? 4 : Math.min(highest, 4);

    for (let i = 0; i <= maxStage; i++) {
      const s = SURYONG_STAGES[i];
      // image가 null인 스테이지(과잠 수룡이)는 제외 — 대신 컬렉션에서 특정 학과 수룡이로 표시
      if (s && s.image) chars.push({ img: s.image, name: s.name });
    }

    // 졸업한 학과 수룡이 — 특정 학과 이름+이미지로 직접 추가 (과잠 수룡이 X)
    (Suryong.state.collections || []).forEach(c => {
      const img = typeof getHakgwaImage !== 'undefined'
        ? getHakgwaImage(c.id)
        : `images/hakgwa/hakgwa${c.id}.jpg`;
      chars.push({ img, name: c.name + ' 수룡이' });
    });

    // 현재 키우는 중인 학과 수룡이 (stage=4이고 department 선택됐을 때)
    if (Suryong.state.stage === 4 && Suryong.state.department) {
      const dept = Suryong.state.department;
      const img  = typeof getHakgwaImage !== 'undefined'
        ? getHakgwaImage(dept.id)
        : `images/hakgwa/hakgwa${dept.id}.jpg`;
      // 이미 컬렉션에 없으면 추가 (아직 졸업 안 한 진행 중)
      const alreadyAdded = chars.some(c => c.img === img);
      if (!alreadyAdded) chars.push({ img, name: dept.name + ' 수룡이 (키우는 중)' });
    }

    return chars;
  },
};

// ── 프로필 UI ─────────────────────────────────────────────
const ProfileUI = {
  open() {
    const modal = document.getElementById('profile-modal');
    if (!modal) return;
    this._render();
    modal.classList.remove('hidden');
  },

  close() {
    document.getElementById('profile-modal')?.classList.add('hidden');
  },

  _render() {
    // 닉네임
    const nick = document.getElementById('profile-nickname-input');
    if (nick) nick.value = ProfileManager.nickname;

    // 배경색 선택
    const bgWrap = document.getElementById('profile-bg-colors');
    if (bgWrap) {
      bgWrap.innerHTML = BG_COLORS.map(c => `
        <div class="profile-color-chip ${ProfileManager.bgColor === c.value ? 'selected' : ''}"
          style="background:${c.value}"
          data-color="${c.value}"
          title="${c.name}"
          onclick="ProfileUI._selectBg('${c.value}')"></div>
      `).join('');
      // 초기 선택값 세팅
      bgWrap.dataset.selected = ProfileManager.bgColor;
    }

    // 캐릭터 선택
    const charWrap = document.getElementById('profile-chars');
    if (charWrap) {
      const chars = ProfileManager.getAvailableCharacters();
      charWrap.innerHTML = chars.map(c => `
        <div class="profile-char-item ${ProfileManager.characterImg === c.img ? 'selected' : ''}"
          onclick="ProfileUI._selectChar('${c.img}', this)">
          <img src="${c.img}" alt="${c.name}" onerror="this.src='images/suryong/su1.jpg'">
          <div class="profile-char-name">${c.name}</div>
        </div>
      `).join('');
    }

    // 미리보기 갱신
    this._updatePreview();
  },

  _selectBg(color) {
    document.querySelectorAll('.profile-color-chip').forEach(el => {
      el.classList.toggle('selected', el.dataset.color === color);
    });
    this._updatePreview(null, color);
    // 선택값을 data-selected로 직접 보관
    document.getElementById('profile-bg-colors').dataset.selected = color;
  },

  _selectChar(img, el) {
    document.querySelectorAll('.profile-char-item').forEach(e => e.classList.remove('selected'));
    el?.classList.add('selected');
    this._updatePreview(img);
  },

  _updatePreview(charImg, bgColor) {
    const img = charImg || document.querySelector('.profile-char-item.selected img')?.src
      || ProfileManager.characterImg;
    const bg  = bgColor
      || document.getElementById('profile-bg-colors')?.dataset.selected
      || ProfileManager.bgColor;
    const nick = document.getElementById('profile-nickname-input')?.value || '';

    const card = document.getElementById('profile-preview-card');
    if (card) {
      card.style.background = bg;
      card.querySelector('.pp-char img').src = img || 'images/suryong/su1.jpg';
      card.querySelector('.pp-nick').textContent = nick || '닉네임 없음';
    }
  },

  async save() {
    const nick = document.getElementById('profile-nickname-input')?.value.trim() || '';
    // data-selected에서 실제 hex 값 읽기 (style에서 읽으면 rgb로 변환됨)
    const bg = document.getElementById('profile-bg-colors')?.dataset.selected
               || ProfileManager.bgColor;
    const charImg = document.querySelector('.profile-char-item.selected img')?.getAttribute('src')
                 || ProfileManager.characterImg;

    if (nick.length > 12) { alert('닉네임은 12자 이내로 해주세요.'); return; }

    const btn = document.getElementById('btn-profile-save');
    btn.disabled = true; btn.textContent = '저장 중...';
    try {
      await ProfileManager.save({ nickname: nick, bgColor: bg, characterImg: charImg });
      ProfileUI._refreshAccountCard();
      ProfileUI.close();
    } catch(e) {
      alert('저장 실패: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = '저장하기';
    }
  },

  /** 계정 화면의 프로필 카드 갱신 */
  _refreshAccountCard() {
    const card = document.getElementById('account-profile-card');
    if (!card) return;
    card.style.background = ProfileManager.bgColor;
    const img = card.querySelector('.apc-char img');
    if (img) img.src = ProfileManager.characterImg;
    const nick = card.querySelector('.apc-nick');
    if (nick) nick.textContent = ProfileManager.nickname || '닉네임 미설정';
  },

  initAccountCard() {
    this._refreshAccountCard();
  },
};
