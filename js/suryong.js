/**
 * suryong.js — 수룡이방 시스템
 * 미션 추적, 점수, 수룡이 성장
 */

// ── 성신여대 학과 목록 ─────────────────────────────────────────
const DEPARTMENTS = [
  { id: 1, name: 'ai융합학부', college: '이공' },
  { id: 2, name: '간호학과', college: '간호' },
  { id: 3, name: '경영학부', college: '경영' },
  { id: 4, name: '경제학과', college: '사회' },
  { id: 5, name: '공예과', college: '예술' },
  { id: 6, name: '교육학과', college: '사범' },
  { id: 7, name: '국어국문학과', college: '문과' },
  { id: 8, name: '기악과', college: '음악' },
  { id: 9, name: '독일어문&문화학과', college: '문과' },
  { id:10, name: '동양학과', college: '예술' },
  { id:11, name: '디자인과', college: '예술' },
  { id:12, name: '무용예술학과', college: '예술' },
  { id:13, name: '문화예술경영학과', college: '문과' },
  { id:14, name: '미디어영상연기학과', college: '문과' },
  { id:15, name: '미디어커뮤니케이션학과', college: '사회' },
  { id:16, name: '바이오식품공학과', college: '이공' },
  { id:17, name: '바이오신약의과학부', college: '이공' },
  { id:18, name: '바이오헬스융합학부', college: '이공' },
  { id:19, name: '법학부', college: '법과' },
  { id:20, name: '뷰티산업학과', college: '경영' },
  { id:21, name: '사학과', college: '문과' },
  { id:22, name: '사회교육과', college: '사범' },
  { id:23, name: '사회복지학과', college: '사회' },
  { id:24, name: '서비스디자인공학과', college: '이공' },
  { id:25, name: '서양학과', college: '예술' },
  { id:26, name: '성악과', college: '음악' },
  { id:27, name: '소비자산업학과', college: '사회' },
  { id:28, name: '수리통계데이터사이언스학부', college: '이공' },
  { id:29, name: '스포츠과학부', college: '체육' },
  { id:30, name: '심리학과', college: '사회' },
  { id:31, name: '영어영문학과', college: '문과' },
  { id:32, name: '유아교육과', college: '사범' },
  { id:33, name: '윤리교육과', college: '사범' },
  { id:34, name: '융합보안공학과', college: '이공' },
  { id:35, name: '의류산업학과', college: '경영' },
  { id:36, name: '일본어문&문화학과', college: '문과' },
  { id:37, name: '작곡과', college: '음악' },
  { id:38, name: '정치외교학과', college: '사회' },
  { id:39, name: '조소과', college: '예술' },
  { id:40, name: '중국어문&문화학과', college: '문과' },
  { id:41, name: '지리학과', college: '사회' },
  { id:42, name: '창의융합학부', college: '이공' },
  { id:43, name: '청정신소재공학과', college: '이공' },
  { id:44, name: '컴퓨터공학과', college: '이공' },
  { id:45, name: '프랑스어문&문화학과', college: '문과' },
  { id:46, name: '한문교육과', college: '사범' },
  { id:47, name: '현대실용음악학과', college: '음악' },
  { id:48, name: '화학&에너지융합학부', college: '이공' },
];

function getHakgwaImage(deptId) {
  const dept = DEPARTMENTS.find(d => d.id === deptId);
  return `images/hakgwa/hakgwa${dept.id}.jpg`;
}

// ── 수룡이 단계 ────────────────────────────────────────────────
const SURYONG_STAGES = [
  { id: 0, name: '알',           image: 'images/suryong/su1.jpg',  pointsNeeded: 3,  desc: '처음엔 작은 알이에요 🥚' },
  { id: 1, name: '꼬물이 수룡이', image: 'images/suryong/su2.jpg', pointsNeeded: 10, desc: '꼬물꼬물 자라고 있어요 🐣' },
  { id: 2, name: '유치원 수룡이', image: 'images/suryong/su3.jpg', pointsNeeded: 15, desc: '첫 등원! 모자가 귀엽죠? 🎓' },
  { id: 3, name: '학생 수룡이',  image: 'images/suryong/su4.jpg',  pointsNeeded: 20, desc: '열심히 공부 중이에요 📚' },
  { id: 4, name: '과잠 수룡이',  image: null,                       pointsNeeded: 25, desc: '드디어 과잠을 입었어요! 🎽' },
  { id: 5, name: '학사모 수룡이', image: 'images/suryong/su5.jpg', pointsNeeded: 30, desc: '졸업이 눈앞이에요! 🎓' },
];

// ── 미션 정의 ──────────────────────────────────────────────────
const MISSIONS = [
  {
    id: 'm1', icon: '📚',
    title: '하루 1시간 공부',
    desc: '오늘 공부 시간 1시간 이상 채우기',
    points: 1,
    check: (state) => state.todayStudyMs >= 3600000,
  },
  {
    id: 'm2', icon: '🔄',
    title: '2사이클 연속 완료',
    desc: '오늘 공부-휴식 2사이클 연속 완료',
    points: 1,
    check: (state) => state.todayCycles >= 2,
  },
  {
    id: 'm3', icon: '📝',
    title: '오늘 복습 완료',
    desc: '복습 주기가 된 교재를 복습하기',
    points: 1,
    check: (state) => state.reviewDoneToday === true,
  },
  {
    id: 'm4', icon: '🌟',
    title: '일주일 개근',
    desc: '7일 연속 매일 30분 이상 공부',
    points: 3,
    check: (state) => state.weekStreak >= 7,
  },
];

// ─────────────────────────────────────────────────────────────
class SuryongManager {
  constructor() {
    this.state = {
      stage: 0,
      points: 0,
      department: null,     // { id, name } — 과잠 단계에서 선택
      collections: [],      // 졸업한 학과 수룡이 목록
      todayStudyMs: 0,
      todayCycles: 0,
      reviewDone: false,
      weekStudy: {},        // 'YYYY-MM-DD' → 공부분(분)
      weekStreak: 0,
      lastDate: null,
      missionsDone:    { m1: false, m2: false, m3: false, m4: false },
      missionsClaimed: { m1: false, m2: false, m3: false, m4: false },
      reviewDoneToday: false,
    };
    this._evolving = false;
  }

  async init() {
    const saved = await Storage.loadSuryongState();
    if (saved) {
      Object.assign(this.state, saved);
      this._checkDayReset();
    }
  }

  _today() {
    return new Date().toLocaleDateString('sv-SE');
  }

  _checkDayReset() {
    const today = this._today();
    if (this.state.lastDate !== today) {
      // 새 날 — 일일 미션/공부기록 리셋 (주간기록은 유지)
      const prevStudyMin = this.state.todayStudyMs / 60000;
      if (this.state.lastDate && prevStudyMin > 0) {
        this.state.weekStudy[this.state.lastDate] = prevStudyMin;
      }
      this.state.todayStudyMs = 0;
      this.state.todayCycles  = 0;
      this.state.reviewDone   = false;
      this.state.missionsDone    = { m1: false, m2: false, m3: false, m4: false };
      this.state.missionsClaimed = { m1: false, m2: false, m3: false, m4: false };
      this.state.reviewDoneToday = false;
      this.state.lastDate = today;
      this.state.weekStreak = this._calcStreak();
    }
  }

  _calcStreak() {
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toLocaleDateString('sv-SE');
      const min  = (key === this._today())
        ? this.state.todayStudyMs / 60000
        : (this.state.weekStudy[key] || 0);
      if (min >= 30) streak++;
      else break;
    }
    return streak;
  }

  // 타이머에서 공부 세션 완료 시 호출
  async onStudyComplete(durationMs) {
    this._checkDayReset();
    this.state.todayStudyMs += durationMs;
    this.state.todayCycles++;
    this.state.weekStreak = this._calcStreak();
    await this._checkMissions();
    await this.save();
    SuryongRoom.refresh();
  }

  async _checkMissions() {
    let needsRefresh = false;
    for (const mission of MISSIONS) {
      if (mission.disabled) continue;
      if (!this.state.missionsDone[mission.id] && mission.check(this.state)) {
        this.state.missionsDone[mission.id] = true;
        needsRefresh = true;
        // 점수는 자동으로 주지 않음 - 사용자가 '점수 받기' 버튼을 눌러야 함
      }
    }
    if (needsRefresh) {
      await this.save();
      SuryongRoom.refresh();
    }
  }

  // 사용자가 '점수 받기' 버튼을 눌렀을 때 호출
  async claimMission(missionId) {
    if (!this.state.missionsDone[missionId]) return;
    if (this.state.missionsClaimed[missionId]) return;
    const mission = MISSIONS.find(m => m.id === missionId);
    if (!mission || mission.disabled) return;
    this.state.missionsClaimed[missionId] = true;
    await this.save();
    await this.addPoints(mission.points);
    showMissionComplete(mission);
    SuryongRoom.refresh();
  }

  async addPoints(amount) {
    this.state.points += amount;
    const stage = SURYONG_STAGES[this.state.stage];
    if (stage && this.state.points >= stage.pointsNeeded) {
      await this._evolve();
    } else {
      await this.save();
    }
    SuryongRoom.refresh();
  }

  async _evolve() {
    if (this._evolving) return;
    this._evolving = true;
    const nextStage = this.state.stage + 1;

    if (nextStage > 5) {
      // 졸업!
      await this._graduate();
    } else if (nextStage === 4) {
      // 과잠 → 학과 선택 필요
      await this.save();
      SuryongRoom.showDepartmentSelect();
    } else {
      this.state.stage = nextStage;
      this.state.points = 0;
      await this.save();
      SuryongRoom.showEvolutionAnimation(nextStage);
    }
    this._evolving = false;
  }

  async selectDepartment(dept) {
    this.state.stage = 4;
    this.state.points = 0;
    this.state.department = dept;
    await this.save();
    this._evolving = false;
    SuryongRoom.showEvolutionAnimation(4);
    SuryongRoom.refresh();
  }

  async _graduate() {
    const dept = this.state.department;
    if (dept && !this.state.collections.find(c => c.id === dept.id)) {
      this.state.collections.push(dept);
    }
    this.state.stage = 0;
    this.state.points = 0;
    this.state.department = null;
    await this.save();
    SuryongRoom.showGraduation(dept);
  }

  getCurrentImage() {
  const stage = this.state.stage;
  if (stage === 4 && this.state.department) {
    return getHakgwaImage(this.state.department.id); // ← 이 줄만 교체
  }
  return SURYONG_STAGES[stage]?.image || 'images/suryong/su1.jpg';
}

  getProgressPercent() {
    const needed = SURYONG_STAGES[this.state.stage]?.pointsNeeded || 3;
    return Math.min((this.state.points / needed) * 100, 100);
  }

  async save() {
    await Storage.saveSuryongState(this.state).catch(() => {});
  }
}

const Suryong = new SuryongManager();

// ─────────────────────────────────────────────────────────────
// 수룡이방 UI 컨트롤러
// ─────────────────────────────────────────────────────────────
const SuryongRoom = {
  refresh() {
    this._renderMissions();
    this._renderDragon();
    this._renderGauge();
    this._renderCollections();
  },

  _renderMissions() {
    const panel = document.getElementById('mission-panel');
    if (!panel) return;
    const { missionsDone, missionsClaimed } = Suryong.state;

    let html = '';
    MISSIONS.forEach(m => {
      const done     = missionsDone[m.id]    === true;
      const claimed  = missionsClaimed[m.id] === true;
      const disabled = m.disabled === true;

      let statusHtml = '';
      if (disabled) {
        statusHtml = '<span class="mission-soon">준비중</span>';
      } else if (claimed) {
        statusHtml = '<span class="mission-claimed">✅</span>';
      } else if (done) {
        statusHtml = `<button class="mission-claim-btn" onclick="event.stopPropagation();Suryong.claimMission('${m.id}')">🎁 점수 받기</button>`;
      } else {
        statusHtml = `<span class="mission-reward">+${m.points}점</span>`;
      }

      html += `
        <div class="mission-item ${done && !claimed ? 'done-unclaimed' : ''} ${claimed ? 'done' : ''} ${disabled ? 'disabled' : ''}"
             onclick="SuryongRoom.showMissionDetail('${m.id}')">
          <div class="mission-icon">${m.icon}</div>
          <div class="mission-body">
            <div class="mission-title">${m.title}</div>
            <div class="mission-desc">${m.desc}</div>
          </div>
          <div class="mission-pts">${statusHtml}</div>
        </div>`;
    });
    panel.innerHTML = html;
  },

  _renderDragon() {
    const img    = document.getElementById('suryong-img');
    const name   = document.getElementById('suryong-name');
    const badge  = document.getElementById('suryong-stage-badge');
    const cname  = document.getElementById('suryong-center-name');
    if (!img) return;
    img.src = Suryong.getCurrentImage();
    const stage = SURYONG_STAGES[Suryong.state.stage];
    let stageName = stage?.name || '알';
    if (Suryong.state.stage === 4 && Suryong.state.department) {
      stageName = Suryong.state.department.name + ' 수룡이';
    }
    if (name)  name.textContent  = stageName;
    if (badge) badge.textContent = stage ? `${stage.id === 0 ? '🥚' : stage.id <= 2 ? '🐣' : '🔮'} ${stageName}` : '';
    if (cname) cname.textContent = stage?.desc || '';
  },

  _renderGauge() {
    const bar   = document.getElementById('suryong-gauge-bar');
    const label = document.getElementById('suryong-gauge-label');
    const pts   = document.getElementById('suryong-pts');
    const hint  = document.getElementById('gauge-next-hint');
    if (!bar) return;
    const needed = SURYONG_STAGES[Suryong.state.stage]?.pointsNeeded || 3;
    const pct    = Suryong.getProgressPercent();
    bar.style.width  = pct + '%';
    if (label) label.textContent = `${Suryong.state.points} / ${needed} 점`;
    if (pts)   pts.textContent   = `${Suryong.state.points}점`;
    const remaining = needed - Suryong.state.points;
    if (hint)  hint.textContent  = remaining > 0 ? `다음 단계까지 ${remaining}점 남았어요!` : '성장 준비 완료! 🎉';
  },

  _renderCollections() {
    const grid  = document.getElementById('collection-grid');
    const colls = Suryong.state.collections;

    if (grid) {
      if (!colls.length) {
        grid.innerHTML = '<div class="collection-empty">아직 졸업한 수룡이가 없어요<br><small>학사모까지 키워보세요! 🔮</small></div>';
      } else {
        grid.innerHTML = colls.map(dept => `
          <div class="coll-item" title="${dept.name}">
            <img src="${getHakgwaImage(dept.id)}" alt="${dept.name}"> 
            <div class="coll-name">${dept.name}</div>
          </div>`).join('');
      }
    }

    // 캐비닛 슬롯 채우기
    document.querySelectorAll('.cabinet-slot').forEach((el, i) => {
      const dept = colls[i];
      if (dept) {
        el.innerHTML = `<img src="${getHakgwaImage(dept.id)}" style="width:100%;height:100%;object-fit:contain">`;
        el.classList.add('filled');
      } else {
        el.innerHTML = ''; el.classList.remove('filled');
      }
    });

    // 태그 업데이트
    const tag = document.getElementById('cabinet-tag');
    if (tag) tag.textContent = `🏆 진열장 (${colls.length})`;
  },

  showDepartmentSelect() {
    const modal = document.getElementById('dept-select-modal');
    if (!modal) return;
    const grid = document.getElementById('dept-select-grid');
    if (grid) {
      const collectedIds = new Set((Suryong.state.collections || []).map(c => c.id));
      const byCollege = {};
      DEPARTMENTS.forEach(d => {
        if (!byCollege[d.college]) byCollege[d.college] = [];
        byCollege[d.college].push(d);
      });
      grid.innerHTML = Object.entries(byCollege).map(([college, depts]) => `
        <div class="dept-group">
          <div class="dept-college-label">${college}대학</div>
          ${depts.map(d => {
            const already = collectedIds.has(d.id);
            return already
              ? `<button class="dept-btn dept-btn-owned" disabled>
                   <img src="${getHakgwaImage(d.id)}" width="40" height="40">
                   <span>${d.name}</span>
                   <span class="dept-owned-badge">이미 있어요 ✓</span>
                 </button>`
              : `<button class="dept-btn" onclick="SuryongRoom.onDeptSelect(${d.id})">
                   <img src="${getHakgwaImage(d.id)}" width="40" height="40">
                   <span>${d.name}</span>
                 </button>`;
          }).join('')}
        </div>`).join('');
    }
    modal.classList.remove('hidden');
  },

  async onDeptSelect(deptId) {
    const dept = DEPARTMENTS.find(d => d.id === deptId);
    if (!dept) return;
    document.getElementById('dept-select-modal')?.classList.add('hidden');
    await Suryong.selectDepartment(dept);
  },

  showEvolutionAnimation(stage) {
    const stageInfo = SURYONG_STAGES[stage];
    const overlay = document.getElementById('evolution-overlay');
    if (!overlay) return;
    const img  = overlay.querySelector('.evo-img');
    const name = overlay.querySelector('.evo-name');
    const desc = overlay.querySelector('.evo-desc');
    if (img && stageInfo) {
      img.src = stage === 4 && Suryong.state.department
        ? getHakgwaImage(Suryong.state.department.id) // ← 이 줄만 교체
        : stageInfo.image;
    }
    if (name) name.textContent = stageInfo?.name || '';
    if (desc) desc.textContent = stageInfo?.desc || '';
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.add('hidden'), 3500);
    this.refresh();
  },

  showGraduation(dept) {
    const overlay = document.getElementById('graduation-overlay');
    if (!overlay) return;
    const deptName = overlay.querySelector('.grad-dept');
    if (deptName) deptName.textContent = dept ? dept.name : '수룡이';
    overlay.classList.remove('hidden');
  },
};

// ── 미션 상세 팝업 ────────────────────────────────────────────
SuryongRoom.showMissionDetail = function(missionId) {
  const mission = MISSIONS.find(m => m.id === missionId);
  if (!mission) return;
  const done     = Suryong.state.missionsDone[missionId]    === true;
  const claimed  = Suryong.state.missionsClaimed[missionId] === true;
  const disabled = mission.disabled === true;

  const modal = document.getElementById('mission-detail-modal');
  if (!modal) return;
  modal.dataset.missionId = missionId;

  document.getElementById('md-icon').textContent  = mission.icon;
  document.getElementById('md-title').textContent = mission.title;
  document.getElementById('md-desc').textContent  = mission.desc;
  document.getElementById('md-pts').textContent   = `+${mission.points}점 보상`;

  // display:none/'' 방식 (.hidden 클래스 의존 안 함)
  const _show = (id, visible) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? '' : 'none';
  };
  _show('md-claim-btn', done && !claimed && !disabled);
  _show('md-done',      claimed);
  _show('md-disabled',  disabled && !claimed);
  _show('md-pending',   !done && !claimed && !disabled);

  modal.classList.remove('hidden');
};

SuryongRoom.onMissionDetailClaim = async function() {
  const modal     = document.getElementById('mission-detail-modal');
  const missionId = modal?.dataset.missionId;
  if (!missionId) return;
  await Suryong.claimMission(missionId);
  modal.classList.add('hidden');
  SuryongRoom.refresh();
};

// ── 미션 완료 팝업 ────────────────────────────────────────────
function showMissionComplete(mission) {
  const toast = document.getElementById('mission-toast');
  if (!toast) return;
  toast.innerHTML = `<span>${mission.icon}</span> <strong>${mission.title}</strong> 완료! +${mission.points}점`;
  toast.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.add('hidden'), 3000);
}
