/**
 * review.js — 복습 주기 알람 시스템
 *
 * 교재별 on/off, 스터디 세션 후 다음날/1주일 뒤 복습 스케줄,
 * Web Push 구독, 타이머 쉬는시간 팝업 상태머신
 */

// ── VAPID 공개키 (서버의 개인키와 쌍) ─────────────────────────
const VAPID_PUBLIC_KEY =
  'BElhgY-myMZyaZ3dbr4k_hRL4bLNosx1UQqtnaX1cQlrEWTrH0GwsF3DSduH8etl51xlspe4AWU23sNLnc2wyOE';

// ─────────────────────────────────────────────────────────────
class ReviewManager {
  constructor() {
    this.schedules = [];      // ReviewSchedule[]
    this.enabled   = {};      // { textbookId: boolean }

    // 현재 타이머 세션 상태머신
    this._session = {
      reviewId:     null,     // 팝업 중인 복습 ID
      phase:        null,     // 'initial' | 'done' | null
      textbookId:   null,     // 팝업 대상 교재
      subjectName:  null,
      studiedDate:  null,
      skipIds:      new Set() // 이 세션에서 "안할 예정" 선택한 교재들
    };
  }

  // ── 초기화 ────────────────────────────────────────────────
  async init() {
    const saved = await Storage.loadReviews();
    if (saved) {
      this.schedules = saved.schedules || [];
      this.enabled   = saved.enabled   || {};
    }
    // 만료된 스케줄 정리 (90일 이상 지난 완료)
    const cutoff = Date.now() - 90 * 86400000;
    this.schedules = this.schedules.filter(s =>
      s.status === 'pending' || new Date(s.dueDate).getTime() > cutoff
    );
    await this._save();
  }

  // ── 교재별 복습 on/off ────────────────────────────────────
  isEnabled(textbookId) { return this.enabled[textbookId] === true; }

  async setEnabled(textbookId, value) {
    this.enabled[textbookId] = value;
    await this._save();
  }

  // ── 공부 세션 종료 → 복습 스케줄 등록 ────────────────────
  async onStudySessionEnd(textbookId, subjectName, studiedDate) {
    if (!this.isEnabled(textbookId)) return;

    const makeId = (suffix) => `rv_${textbookId}_${studiedDate}_${suffix}`;

    // 이미 같은 날짜/교재 스케줄 있으면 중복 생성 안 함 (pending인 것만)
    const alreadyDay1  = this.schedules.find(s =>
      s.textbookId === textbookId && s.studiedDate === studiedDate && s.type === 'day1' && s.status === 'pending');
    const alreadyWeek1 = this.schedules.find(s =>
      s.textbookId === textbookId && s.studiedDate === studiedDate && s.type === 'week1' && s.status === 'pending');

    const now = Date.now();

    if (!alreadyDay1) {
      this.schedules.push({
        id: makeId('d1_' + now),
        textbookId, subjectName, studiedDate,
        dueDate: this._addDays(studiedDate, 1),
        type:   'day1',
        status: 'pending',
        createdAt: now
      });
    }

    if (!alreadyWeek1) {
      this.schedules.push({
        id: makeId('w1_' + now),
        textbookId, subjectName, studiedDate,
        dueDate: this._addDays(studiedDate, 7),
        type:   'week1',
        status: 'pending',
        createdAt: now
      });
    }

    await this._save();
    await this._syncToFirestore();
    console.info('[Review] 스케줄 등록:', subjectName, studiedDate);
  }

  // ── 날짜별 복습 목록 ──────────────────────────────────────
  getReviewsForDate(date) {
    return this.schedules.filter(s => s.dueDate === date);
  }

  getTodayReviews() {
    return this.getReviewsForDate(this._today());
  }

  getOverdueReviews() {
    const today = this._today();
    return this.schedules.filter(s => s.status === 'pending' && s.dueDate <= today);
  }

  // ── 쉬는시간 팝업 체크 ────────────────────────────────────
  // 반환값: { review, phase } | null
  checkBreak(currentTextbookId) {
    // done_ask 단계: 교재 무관하게 "끝나셨나요?" 팝업
    if (this._session.phase === 'done') {
      return {
        review: this.schedules.find(s => s.id === this._session.reviewId),
        phase:  'done'
      };
    }

    // initial_ask: 현재 교재에 대한 pending 복습 확인
    if (this._session.skipIds.has(currentTextbookId)) return null;

    const today = this._today();
    const pending = this.schedules.find(s =>
      s.textbookId === currentTextbookId &&
      s.dueDate <= today &&
      s.status === 'pending'
    );
    if (!pending) return null;

    // 세션 상태 설정
    this._session.reviewId    = pending.id;
    this._session.phase       = 'initial';
    this._session.textbookId  = pending.textbookId;
    this._session.subjectName = pending.subjectName;
    this._session.studiedDate = pending.studiedDate;

    return { review: pending, phase: 'initial' };
  }

  // ── 첫 번째 질문 응답 처리 ─────────────────────────────────
  async handleInitialResponse(choice) {
    const { reviewId, textbookId, subjectName } = this._session;
    try {
      switch (choice) {
        case 'only_review':
          this._session.phase = 'done';
          break;
        case 'review_and_study':
          await this._markDone(reviewId);
          await this._newCycleFromToday(textbookId, subjectName);
          await this._completeMissionM3().catch(() => {});
          this._resetSession();
          break;
        case 'skip':
          this._session.skipIds.add(textbookId);
          this._resetSession();
          break;
        case 'later':
          this._session.phase = 'initial';
          this._session.reviewId = null;
          break;
      }
      await this._save().catch(() => {});
    } catch (e) {
      console.error('[Review] handleInitialResponse 오류:', e);
    } finally {
      // 오류가 나도 반드시 팝업 닫기
      ReviewUI.hideBreakPopup();
      ReviewUI.refresh();
    }
  }

  // ── 두 번째 질문 응답 처리 ────────────────────────────────
  async handleDoneResponse(choice) {
    const { reviewId, textbookId, subjectName } = this._session;
    try {
      switch (choice) {
        case 'done_and_studied':
          await this._markDone(reviewId);
          await this._newCycleFromToday(textbookId, subjectName);
          await this._completeMissionM3().catch(() => {});
          this._resetSession();
          break;
        case 'done_only':
          await this._markDone(reviewId);
          await this._completeMissionM3().catch(() => {});
          this._resetSession();
          break;
        case 'not_yet':
          break;
      }
      await this._save().catch(() => {});
    } catch (e) {
      console.error('[Review] handleDoneResponse 오류:', e);
    } finally {
      ReviewUI.hideBreakPopup();
      ReviewUI.refresh();
    }
  }

  // ── 세션 리셋 (타이머 종료 시 호출) ──────────────────────
  resetSession() {
    this._session = {
      reviewId: null, phase: null,
      textbookId: null, subjectName: null, studiedDate: null,
      skipIds: new Set()
    };
  }

  getSession() { return this._session; }

  // ── Private helpers ───────────────────────────────────────
  async _markDone(reviewId) {
    const s = this.schedules.find(r => r.id === reviewId);
    if (s) { s.status = 'done'; s.doneAt = Date.now(); }
    await this._syncToFirestore();
  }

  async _newCycleFromToday(textbookId, subjectName) {
    const today = this._today();
    await this.onStudySessionEnd(textbookId, subjectName, today);
  }

  async _completeMissionM3() {
    if (typeof Suryong !== 'undefined') {
      Suryong.state.reviewDoneToday = true;
      await Suryong._checkMissions();
      await Suryong.save();
      SuryongRoom.refresh();
    }
  }

  _resetSession() {
    this._session.reviewId    = null;
    this._session.phase       = null;
    this._session.textbookId  = null;
    this._session.subjectName = null;
    this._session.studiedDate = null;
    // skipIds는 세션 내 유지
  }

  _today() { return new Date().toLocaleDateString('sv-SE'); }

  _addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('sv-SE');
  }

  async _save() {
    await Storage.saveReviews({ schedules: this.schedules, enabled: this.enabled });
  }

  async _syncToFirestore() {
    if (typeof firebase === 'undefined' || !Auth.currentUser) return;
    try {
      const db  = firebase.firestore();
      const uid = Auth.currentUser.uid;
      // Pending 스케줄만 Firestore에 저장 (Cloud Function이 읽음)
      const pending = this.schedules.filter(s => s.status === 'pending');
      const batch   = db.batch();
      pending.forEach(s => {
        const ref = db.collection('users').doc(uid).collection('reviews').doc(s.id);
        batch.set(ref, s, { merge: true });
      });
      await batch.commit();
    } catch (e) { console.warn('[Review] Firestore 동기화 실패:', e.message); }
  }

  // ── Web Push 구독 ─────────────────────────────────────────
  async requestPushPermission() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('이 브라우저는 푸시 알림을 지원하지 않아요.');
      return false;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return false;

      const reg = await navigator.serviceWorker.ready;
      let sub   = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      }
      await this._savePushSub(sub);
      return true;
    } catch (e) {
      console.error('[Review] Push 구독 실패:', e);
      return false;
    }
  }

  async _savePushSub(sub) {
    const data = sub.toJSON();
    await Storage.savePushSubscription(data);
    // Firestore에 저장 (GitHub Actions에서 읽음)
    await this._syncSubToFirestore(data);
    console.info('[Review] Push 구독 저장 완료', data.endpoint?.slice(-20));
  }

  async _syncSubToFirestore(data) {
    if (typeof firebase === 'undefined') return;
    const user = Auth.currentUser;
    if (!user) {
      // 로그인 전이면 1초 후 재시도 (최대 5회)
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 1000));
        if (Auth.currentUser) break;
      }
      if (!Auth.currentUser) { console.warn('[Review] 로그인 안됨 - Firestore 저장 실패'); return; }
    }
    try {
      await firebase.firestore()
        .collection('users').doc(Auth.currentUser.uid)
        .collection('settings').doc('push')
        .set({ subscription: data, updatedAt: Date.now() }, { merge: true });
      console.info('[Review] Firestore push 구독 동기화 완료 ✅');
    } catch (e) {
      console.error('[Review] Firestore 저장 실패:', e.message);
    }
  }

  hasPushPermission() {
    return Notification.permission === 'granted';
  }
}

const Review = new ReviewManager();

// ── VAPID helper ─────────────────────────────────────────────
function _urlBase64ToUint8Array(b64) {
  const pad  = '='.repeat((4 - b64.length % 4) % 4);
  const raw  = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const arr  = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// ─────────────────────────────────────────────────────────────
// ReviewUI — DOM 연동 헬퍼
// ─────────────────────────────────────────────────────────────
const ReviewUI = {
  // 플래너 하단 복습 목록 렌더링
  renderForDate(date) {
    const container = document.getElementById('planner-review-list');
    if (!container) return;

    const reviews = Review.getReviewsForDate(date);
    if (!reviews.length) {
      container.innerHTML = '<div class="rv-empty">이 날 복습 일정이 없어요 ✨</div>';
      return;
    }

    const today = new Date().toLocaleDateString('sv-SE');
    container.innerHTML = reviews.map(r => {
      const [, m, d] = r.studiedDate.split('-');
      const isOverdue = r.status === 'pending' && r.dueDate < today;
      const isDone    = r.status === 'done';
      return `
        <div class="rv-item ${isDone ? 'rv-done' : ''} ${isOverdue ? 'rv-overdue' : ''}">
          <div class="rv-dot" style="background:${_getTextbookColor(r.textbookId)}"></div>
          <div class="rv-info">
            <div class="rv-subject">${r.subjectName}</div>
            <div class="rv-date">${m}월 ${d}일 공부 내용 복습 · ${r.type === 'day1' ? '1일 후' : '1주일 후'}</div>
          </div>
          <div class="rv-status">${isDone ? '✅' : isOverdue ? '⚠️' : '🔔'}</div>
        </div>`;
    }).join('');
  },

  // 타이머 복습 팝업 표시
  showBreakPopup(reviewData, phase) {
    const modal   = document.getElementById('review-break-modal');
    const content = document.getElementById('review-break-content');
    if (!modal || !content) return;

    const { review } = reviewData;
    if (!review) return;

    const [, m, d] = (review.studiedDate || '').split('-');
    const dateStr  = `${m}월 ${d}일`;

    if (phase === 'initial') {
      content.innerHTML = `
        <div class="rv-popup-title">🔮 복습 확인</div>
        <div class="rv-popup-q">
          <strong>${review.subjectName}</strong>을 공부하셨는데<br>
          <span class="rv-popup-date">${dateStr} 내용</span>을 복습하신 게 맞나요?
        </div>
        <div class="rv-popup-btns">
          <button class="rv-btn rv-btn-primary" onclick="Review.handleInitialResponse('review_and_study')">
            복습도 하고 공부도 했어요
          </button>
          <button class="rv-btn rv-btn-secondary" onclick="Review.handleInitialResponse('only_review')">
            쭉 그것만 했어요
          </button>
          <button class="rv-btn rv-btn-ghost" onclick="Review.handleInitialResponse('later')">
            이따가 할거에요
          </button>
          <button class="rv-btn rv-btn-danger" onclick="Review.handleInitialResponse('skip')">
            안할 예정이에요
          </button>
        </div>`;
    } else {
      content.innerHTML = `
        <div class="rv-popup-title">🔮 복습 확인</div>
        <div class="rv-popup-q">
          <strong>${review.subjectName}</strong> 복습이 끝나셨나요?
        </div>
        <div class="rv-popup-btns">
          <button class="rv-btn rv-btn-primary" onclick="Review.handleDoneResponse('done_and_studied')">
            네, 끝나고 진도도 나갔어요
          </button>
          <button class="rv-btn rv-btn-secondary" onclick="Review.handleDoneResponse('done_only')">
            끝나기만 했어요
          </button>
          <button class="rv-btn rv-btn-ghost" onclick="Review.handleDoneResponse('not_yet')">
            아니요
          </button>
        </div>`;
    }

    modal.classList.remove('hidden');
  },

  hideBreakPopup() {
    document.getElementById('review-break-modal')?.classList.add('hidden');
  },

  refresh() {
    this.hideBreakPopup();
    // 플래너가 열려있으면 갱신
    if (document.getElementById('screen-planner')?.classList.contains('active')) {
      const dateEl = document.getElementById('planner-date-display');
      const text   = dateEl?.textContent || '';
      // 현재 표시 중인 날짜 갱신 (오늘이면 today)
      const todayStr = new Date().toLocaleDateString('sv-SE');
      ReviewUI.renderForDate(todayStr);
    }
  }
};

function _getTextbookColor(tbId) {
  const tb = TextbookMgr.textbooks.find(t => t.id === tbId);
  return tb?.color || 'var(--purple-mid)';
}
