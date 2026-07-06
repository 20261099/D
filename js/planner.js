/**
 * planner.js — 공부 세션 추적 & 타임테이블 렌더링
 */

class PlannerManager {
  constructor() {
    this.sessions = [];
    this._current = null;   // 현재 진행 중인 세션
  }

  async init() {
    const raw = await Storage.loadStudySessions();
    const cutoff = Date.now() - 90 * 24 * 3600 * 1000; // 90일 보관
    this.sessions = (raw || []).filter(s => s.startTime > cutoff);
  }

  // ── 날짜 헬퍼 ─────────────────────────────────────────────────
  static today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  static formatTime(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  static formatDuration(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m === 0) return '1분 미만';
    if (m < 60)  return `${m}분`;
    return `${Math.floor(m/60)}시간 ${m%60 > 0 ? m%60 + '분' : ''}`.trim();
  }

  static formatDateLabel(dateStr) {
    const today = PlannerManager.today();
    if (dateStr === today) return '오늘';
    const [, m, d] = dateStr.split('-').map(Number);
    return `${m}/${d}`;
  }

  // ── 세션 관리 ─────────────────────────────────────────────────
  async startSession(textbook) {
    if (this._current) await this.endSession();
    this._current = {
      id:          'ss_' + Date.now(),
      date:        PlannerManager.today(),
      textbookId:  textbook.id,
      subjectName: textbook.subjectName,
      color:       textbook.color,
      startTime:   Date.now(),
      endTime:     null
    };
    console.info('[Planner] 세션 시작:', textbook.subjectName);
  }

  async endSession() {
    if (!this._current) return;
    this._current.endTime = Date.now();
    // 5초 이상인 세션만 저장
    if (this._current.endTime - this._current.startTime >= 5000) {
      this.sessions.push({ ...this._current });
      await Storage.saveStudySessions(this.sessions);
      console.info('[Planner] 세션 저장:', this._current.subjectName,
        PlannerManager.formatDuration(this._current.endTime - this._current.startTime));
    }
    this._current = null;
  }

  getCurrentSubject() {
    return this._current
      ? { name: this._current.subjectName, color: this._current.color, textbookId: this._current.textbookId }
      : null;
  }

  // ── 데이터 조회 ────────────────────────────────────────────────
  getSessionsByDate(date) {
    return this.sessions
      .filter(s => s.date === date && s.endTime)
      .sort((a, b) => a.startTime - b.startTime);
  }

  getStudyDates() {
    return [...new Set(this.sessions.map(s => s.date))].sort().reverse();
  }

  getTotalMs(date) {
    return this.getSessionsByDate(date)
      .reduce((sum, s) => sum + (s.endTime - s.startTime), 0);
  }

  // ── UI 렌더링 ──────────────────────────────────────────────────
  renderAll(date) {
    const sessions = this.getSessionsByDate(date);
    this._renderCalendarHeader(date);
    this._renderSummary(sessions);
    this._renderTimeline(sessions);
    this._renderSessionList(sessions);
    this._renderTextbooks();
    this.renderReviews(date);
  }

  _renderCalendarHeader(selectedDate) {
    const el = document.getElementById('planner-date-display');
    if (!el) return;
    const [y, m, d] = selectedDate.split('-').map(Number);
    const today = PlannerManager.today();
    const label  = selectedDate === today ? `오늘 (${m}월 ${d}일)` : `${y}년 ${m}월 ${d}일`;
    el.textContent = label;
  }

  _renderSummary(sessions) {
    const el = document.getElementById('planner-summary');
    if (!el) return;
    if (!sessions.length) {
      el.innerHTML = '<span class="summary-empty">아직 기록이 없어요 🔮</span>';
      return;
    }
    const totalMs  = sessions.reduce((s, x) => s + x.endTime - x.startTime, 0);
    const subjects = [...new Set(sessions.map(s => s.subjectName))];
    const dots     = subjects.slice(0, 4).map(subj => {
      const sess = sessions.find(s => s.subjectName === subj);
      return `<span class="summary-dot" style="background:${sess.color}"></span>${subj}`;
    }).join('');
    el.innerHTML = `
      <strong>${PlannerManager.formatDuration(totalMs)}</strong> 공부
      <span class="summary-sep">·</span>
      <span class="summary-subjects">${dots}</span>`;
  }

  _renderTimeline(sessions) {
    const container = document.getElementById('planner-timeline');
    if (!container) return;
    if (!sessions.length) {
      container.innerHTML = '<div class="tl-empty">공부를 시작하면 타임라인이 표시돼요</div>';
      return;
    }

    // 세션 날짜 기준으로 00:00 ~ 23:59 생성
    const [year, month, day] = sessions[0].date.split('-').map(Number);

    let html = '<div class="tl-grid">';
    for (let h = 0; h < 24; h++) {
      const hStart = new Date(year, month - 1, day, h, 0, 0, 0).getTime();
      const hEnd   = hStart + 3600000;

      // 이 시간대에 걸치는 세션 찾기
      const segs = sessions.filter(s => s.startTime < hEnd && s.endTime > hStart);

      // 세션이 없는 시간대는 렌더하되 빈 바로 표시
      let segsHtml = '';
      for (const s of segs) {
        const segStart = Math.max(s.startTime, hStart);
        const segEnd   = Math.min(s.endTime,   hEnd);
        const left  = ((segStart - hStart) / 3600000 * 100).toFixed(1);
        const width = Math.max(0.5, (segEnd - segStart) / 3600000 * 100).toFixed(1);
        const dur   = PlannerManager.formatDuration(segEnd - segStart);
        segsHtml += `<div class="tl-seg"
          style="left:${left}%;width:${width}%;background:${s.color}"
          title="${s.subjectName} (${dur})"></div>`;
      }

      // 공부한 시간대만 진하게, 나머지는 흐리게
      const hasSession = segs.length > 0;
      // 10분 단위 눈금 (6칸으로 나눔)
      const ticksHtml = [10, 20, 30, 40, 50].map(m => {
        const pct = (m / 60 * 100).toFixed(1);
        const cls = m === 30 ? 'tl-tick-half' : 'tl-tick';
        return `<div class="${cls}" style="left:${pct}%"></div>`;
      }).join('');

      html += `
        <div class="tl-row${hasSession ? ' tl-row-active' : ''}">
          <div class="tl-hour-label">${String(h).padStart(2, '0')}시</div>
          <div class="tl-hour-bar">${segsHtml}${ticksHtml}</div>
        </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
  }

  _renderSessionList(sessions) {
    const container = document.getElementById('session-list');
    if (!container) return;
    if (!sessions.length) { container.innerHTML = ''; return; }
    container.innerHTML = sessions.map(s => `
      <div class="session-card">
        <div class="session-color" style="background:${s.color}"></div>
        <div class="session-info">
          <div class="session-subject">${s.subjectName}</div>
          <div class="session-time">
            ${PlannerManager.formatTime(s.startTime)} ~ ${PlannerManager.formatTime(s.endTime)}
          </div>
        </div>
        <div class="session-dur">${PlannerManager.formatDuration(s.endTime - s.startTime)}</div>
      </div>`).join('');
  }

  _renderTextbooks() {
    const container = document.getElementById('textbook-list');
    if (!container) return;
    const tbs = TextbookMgr.textbooks;
    if (!tbs.length) {
      container.innerHTML = '<div class="tb-empty">등록된 교재가 없어요<br><small>+ 추가 버튼으로 등록해보세요</small></div>';
      return;
    }
    container.innerHTML = tbs.map(tb => {
      const reviewOn = (typeof Review !== 'undefined') && Review.isEnabled(tb.id);
      return `
        <div class="tb-item">
          <div class="tb-dot" style="background:${tb.color}"></div>
          <img class="tb-thumb" src="${tb.thumbnail}" alt="${tb.subjectName}">
          <span class="tb-name">${tb.subjectName}</span>
          <label class="rv-toggle" title="복습 알람 on/off">
            <input type="checkbox" ${reviewOn ? 'checked' : ''}
              onchange="Review.setEnabled('${tb.id}', this.checked)">
            <span class="rv-slider"></span>
          </label>
          <button class="tb-del-btn" data-id="${tb.id}" title="삭제">×</button>
        </div>`;
    }).join('');

    container.querySelectorAll('.tb-del-btn').forEach(btn => {
      btn.onclick = async () => {
        if (!confirm(`"${btn.closest('.tb-item').querySelector('.tb-name').textContent}" 교재를 삭제할까요?`)) return;
        await TextbookMgr.remove(btn.dataset.id);
        this._renderTextbooks();
      };
    });
  }

  // 복습 목록 렌더링
  renderReviews(date) {
    if (typeof ReviewUI !== 'undefined') ReviewUI.renderForDate(date);
  }
}

const Planner = new PlannerManager();

// 날짜 선택 (외부에서 호출)
function selectPlannerDate(date) {
  Planner.renderAll(date);
  document.getElementById('calendar-modal')?.classList.add('hidden');
}

// 달력 모달 열기
function openCalendar() {
  const modal = document.getElementById('calendar-modal');
  if (!modal) return;
  const now = new Date();
  renderCalendarMonth(now.getFullYear(), now.getMonth());
  modal.classList.remove('hidden');
}

function closeCalendar() {
  document.getElementById('calendar-modal')?.classList.add('hidden');
}

let _calYear = new Date().getFullYear();
let _calMonth = new Date().getMonth();

function renderCalendarMonth(year, month) {
  _calYear = year; _calMonth = month;
  const studyDates = new Set(Planner.getStudyDates());
  const header = document.getElementById('cal-month-label');
  if (header) header.textContent = `${year}년 ${month + 1}월`;

  const grid = document.getElementById('cal-grid');
  if (!grid) return;

  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const lastDate = new Date(year, month + 1, 0).getDate();
  const today    = PlannerManager.today();

  let html = '';
  // Day labels
  ['일','월','화','수','목','금','토'].forEach(d => {
    html += `<div class="cal-day-label">${d}</div>`;
  });
  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    html += `<div class="cal-cell cal-empty"></div>`;
  }
  for (let d = 1; d <= lastDate; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const hasStudy = studyDates.has(dateStr);
    const isToday  = dateStr === today;
    html += `<button class="cal-cell ${isToday ? 'cal-today' : ''} ${hasStudy ? 'cal-has-data' : ''}"
                     onclick="selectPlannerDate('${dateStr}')">
               ${d}
               ${hasStudy ? '<span class="cal-dot"></span>' : ''}
             </button>`;
  }
  grid.innerHTML = html;
}

function calPrev() { _calMonth--; if(_calMonth<0){_calMonth=11;_calYear--;} renderCalendarMonth(_calYear,_calMonth); }
function calNext() { _calMonth++; if(_calMonth>11){_calMonth=0;_calYear++;} renderCalendarMonth(_calYear,_calMonth); }
