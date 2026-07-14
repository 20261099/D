/**
 * review.js — 복습 주기 알람 시스템
 *
 * 교재별 on/off, 스터디 세션 후 1일/1주일/30일 뒤 복습 스케줄,
 * Web Push 구독, 타이머 쉬는시간 팝업
 *
 * ── 스케줄 상태(status) ─────────────────────────────────────
 *   pending : 아직 응답하지 않음 (알림 대상). 완료/만료 전까지는
 *             같은 교재를 공부하고 쉬는시간에 들어갈 때마다 계속 물어본다.
 *   done    : 복습 완료로 확정. 이후 다시 묻지 않음.
 *   missed  : 만기일이 지나도록 완료되지 않아 만료됨. 더 이상 알리지 않음.
 *
 * 1일 후 / 1주일 후 / 30일 후 스케줄은 서로 다른 id를 가진 독립적인
 * 항목이므로, 하나가 missed 되어도 나머지 주기의 알림에는 영향을 주지 않는다.
 */

// ── VAPID 공개키 (서버의 개인키와 쌍) ─────────────────────────
const VAPID_PUBLIC_KEY =
  'BJiTt-SGk73nKeQjXtoluMVm1vG2Gt451ojfF0eMKsHFwtO5F_mfCUhlwqKnPe4b13YODTeNL8tc5g9PXe_fr9w';

// ─────────────────────────────────────────────────────────────
class ReviewManager {
  constructor() {
    this.schedules = [];      // ReviewSchedule[]
    this.enabled   = {};      // { textbookId: boolean }

    // 현재 타이머 세션 상태 (팝업 렌더링용 컨텍스트)
    this._session = {
      reviewId:     null,     // 팝업 중인 복습 ID
      textbookId:   null,     // 팝업 대상 교재
      subjectName:  null,
      studiedDate:  null
    };
  }

  // ── 초기화 ────────────────────────────────────────────────
  async init() {
    const saved = await Storage.loadReviews();
    if (saved) {
      this.schedules = saved.schedules || [];
      this.enabled   = saved.enabled   || {};
    }
    // 이전 버전에 있던 'in_progress' 상태는 더 이상 쓰지 않음 → pending으로 이관
    this.schedules.forEach(s => { if (s.status === 'in_progress') s.status = 'pending'; });

    // 만기일이 지났는데 아직 완료되지 않은 스케줄은 missed 처리
    // (앱을 며칠 만에 다시 열었을 때 밀린 알림이 한꺼번에 쌓이는 것 방지)
    const expired = this._expireMissedReviews();

    // 오래된 스케줄 정리 (90일 이상 지난 완료/만료 건)
    const cutoff = Date.now() - 90 * 86400000;
    this.schedules = this.schedules.filter(s =>
      s.status === 'pending' || new Date(s.dueDate).getTime() > cutoff
    );

    await this._save();
    if (expired) await this._syncToFirestore().catch(() => {});
  }

  // ── 교재별 복습 on/off ────────────────────────────────────
  isEnabled(textbookId) { return this.enabled[textbookId] === true; }

  async setEnabled(textbookId, value) {
    this.enabled[textbookId] = value;
    await this._save();
  }

  // ── 공부 세션 종료 → 복습 스케줄 등록 (1일 / 1주일 / 30일 후) ─
  async onStudySessionEnd(textbookId, subjectName, studiedDate) {
    if (!this.isEnabled(textbookId)) return;

    const makeId = (suffix) => `rv_${textbookId}_${studiedDate}_${suffix}`;
    const now = Date.now();

    // 같은 날짜/교재/주기 스케줄이 이미 pending으로 남아있으면 중복 생성하지 않는다.
    // done/missed 된 건은 다시 만들어도 된다.
    const REVIEW_TYPES = [
      { type: 'day1',   days: 1,  tag: 'd1'  },
      { type: 'week1',  days: 7,  tag: 'w1'  },
      { type: 'month1', days: 30, tag: 'm1'  }
    ];

    REVIEW_TYPES.forEach(({ type, days, tag }) => {
      const already = this.schedules.find(s =>
        s.textbookId === textbookId &&
        s.studiedDate === studiedDate &&
        s.type === type &&
        s.status === 'pending'
      );
      if (already) return;

      this.schedules.push({
        id: makeId(tag + '_' + now),
        textbookId, subjectName, studiedDate,
        dueDate: this._addDays(studiedDate, days),
        type,
        status: 'pending',
        createdAt: now
      });
    });

    await this._save();
    await this._syncToFirestore();
    console.info('[Review] 스케줄 등록(1일/1주일/30일):', subjectName, studiedDate);
  }

  // ── 날짜별 복습 목록 ──────────────────────────────────────
  getReviewsForDate(date) {
    this._expireMissedReviews();
    return this.schedules.filter(s => s.dueDate === date);
  }

  getTodayReviews() {
    return this.getReviewsForDate(this._today());
  }

  // 오늘 기준 아직 완료되지 않은(pending) 복습.
  // 만기일이 지난 항목은 init()/lazy 체크에서 이미 missed 처리되므로
  // 여기 남는 것은 사실상 "오늘 마감"인 항목들이다.
  // "오늘은 안 할 생각이에요"로 숨긴 항목은 앱 재오픈 알림에서도 제외한다.
  getOverdueReviews() {
    this._expireMissedReviews();
    const today = this._today();
    return this.schedules.filter(s =>
      s.status === 'pending' && s.dueDate <= today && s.hiddenOn !== today
    );
  }

  // ── 쉬는시간 팝업 체크 ────────────────────────────────────
  // 현재 교재에 오늘 마감인 미완료(pending) 복습이 있으면 팝업 정보를 반환.
  // 완료(done)되거나 다음날로 넘어가 만료(missed)되기 전까지는,
  // 같은 교재를 공부하고 쉬는시간에 들어갈 때마다 매번 다시 물어본다.
  // 반환값: { review } | null
  checkBreak(currentTextbookId) {
    // 날짜가 바뀌었으면 만기 지난 항목부터 정리 (당일 지나면 재알림 안 함)
    if (this._expireMissedReviews()) {
      this._save().catch(() => {});
      this._syncToFirestore().catch(() => {});
    }

    const today = this._today();
    const pending = this.schedules.find(s =>
      s.textbookId === currentTextbookId &&
      s.dueDate === today &&
      s.status === 'pending' &&
      s.hiddenOn !== today   // "오늘은 안 할 생각이에요"를 누른 항목은 오늘 하루 숨김
    );
    if (!pending) return null;

    // 세션 상태 설정 (팝업 렌더링용 컨텍스트)
    this._session.reviewId    = pending.id;
    this._session.textbookId  = pending.textbookId;
    this._session.subjectName = pending.subjectName;
    this._session.studiedDate = pending.studiedDate;

    return { review: pending };
  }

  // ── 쉬는시간 팝업 응답 처리 ────────────────────────────────
  // choice: 'done'(복습했어요) | 'not_yet'(아직이에요) | 'skip_today'(오늘은 안 할 생각이에요)
  // 선택 결과는 즉시 스케줄(this.schedules)에 기록되고 저장/동기화되므로
  // 앱이 재시작되거나(iOS 백그라운드 종료 등) 새로고침돼도 유지된다.
  async handleResponse(choice) {
    const { reviewId } = this._session;
    try {
      if (choice === 'done') {
        await this._markDone(reviewId);
        await this._completeMissionM3().catch(() => {});
      } else if (choice === 'skip_today') {
        // 완료 처리하는 게 아니라, 오늘 하루만 이 항목의 팝업을 숨긴다.
        // 여전히 pending이라 내일도 안 하면 자동으로 missed(만료) 처리된다.
        await this._hideForToday(reviewId);
      }
      // 'not_yet' → 상태 변화 없음. 스케줄은 pending으로 남아
      // 같은 교재를 다시 공부하고 쉬는시간에 들어가면 또 물어본다.
      // (완료되거나 다음날로 넘어가 자동 만료되기 전까진 계속 확인)
    } catch (e) {
      console.error('[Review] handleResponse 오류:', e);
    } finally {
      // 오류가 나도 반드시 팝업 닫기 + 세션(임시 상태) 정리
      this._resetSession();
      ReviewUI.hideBreakPopup();
      ReviewUI.refresh();
    }
  }

  // ── 세션 리셋 (타이머 완전 종료 시 호출) ─────────────────
  resetSession() {
    this._session = {
      reviewId: null,
      textbookId: null, subjectName: null, studiedDate: null
    };
  }

  getSession() { return this._session; }

  // ── Private helpers ───────────────────────────────────────

  // 만기일이 지났는데 아직 pending 상태인 스케줄을 missed 처리.
  // 반환값: 하나라도 상태가 바뀌었으면 true (호출부에서 저장 여부 판단용)
  _expireMissedReviews() {
    const today = this._today();
    let changed = false;
    this.schedules.forEach(s => {
      if (s.status === 'pending' && s.dueDate < today) {
        s.status = 'missed';
        s.missedAt = Date.now();
        changed = true;
      }
    });
    return changed;
  }

  async _markDone(reviewId) {
    const s = this.schedules.find(r => r.id === reviewId);
    if (s) { s.status = 'done'; s.doneAt = Date.now(); }
    await this._save();
    await this._syncToFirestore();
  }

  // 완료 처리는 아님 — 오늘 하루만 이 항목의 팝업을 숨긴다 (상태는 여전히 pending).
  // 스케줄 자체에 저장하므로 앱을 재시작해도 오늘 안엔 다시 안 뜬다.
  // 다음날 자동 만료(missed) 로직은 그대로 적용된다.
  async _hideForToday(reviewId) {
    const s = this.schedules.find(r => r.id === reviewId);
    if (s) { s.hiddenOn = this._today(); }
    await this._save();
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
    this._session.textbookId  = null;
    this._session.subjectName = null;
    this._session.studiedDate = null;
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

  // 로컬 스케줄 상태를 Firestore와 맞춘다.
  // - pending 인 것만 서버에 올려서 GitHub Actions(send-reviews.js)가 그 날 알림을 보낸다.
  // - done/missed 로 바뀐 항목은 서버 문서를 삭제해서
  //   (앱에서 이미 처리됐는데 서버가 뒤늦게 푸시를 보내는) 유령 알림을 막는다.
  async _syncToFirestore() {
    if (typeof firebase === 'undefined' || !Auth.currentUser) return;
    try {
      const db   = firebase.firestore();
      const uid  = Auth.currentUser.uid;
      const coll = db.collection('users').doc(uid).collection('reviews');

      const pending    = this.schedules.filter(s => s.status === 'pending');
      const notPending = this.schedules.filter(s => s.status !== 'pending');

      const batch = db.batch();
      pending.forEach(s => batch.set(coll.doc(s.id), s, { merge: true }));
      notPending.forEach(s => batch.delete(coll.doc(s.id)));
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

    const REVIEW_TYPE_LABEL = { day1: '1일 후', week1: '1주일 후', month1: '30일 후' };

    container.innerHTML = reviews.map(r => {
      const [, m, d] = r.studiedDate.split('-');
      const isDone      = r.status === 'done';
      const isMissed    = r.status === 'missed';
      const statusClass = isDone ? 'rv-done' : isMissed ? 'rv-missed' : '';
      const statusIcon  = isDone ? '✅' : isMissed ? '❌' : '🔔';
      return `
        <div class="rv-item ${statusClass}">
          <div class="rv-dot" style="background:${_getTextbookColor(r.textbookId)}"></div>
          <div class="rv-info">
            <div class="rv-subject">${r.subjectName}</div>
            <div class="rv-date">${m}월 ${d}일 공부 내용 복습 · ${REVIEW_TYPE_LABEL[r.type] || r.type}</div>
          </div>
          <div class="rv-status">${statusIcon}</div>
        </div>`;
    }).join('');
  },

  // 타이머 쉬는시간 복습 확인 팝업 표시
  showBreakPopup(reviewData) {
    const modal   = document.getElementById('review-break-modal');
    const content = document.getElementById('review-break-content');
    if (!modal || !content) return;

    const { review } = reviewData;
    if (!review) return;

    const [, m, d] = (review.studiedDate || '').split('-');
    const dateStr  = `${m}월 ${d}일`;

    content.innerHTML = `
      <div class="rv-popup-title">🔮 복습 확인</div>
      <div class="rv-popup-q">
        <strong>${review.subjectName}</strong>을 공부하셨는데<br>
        <span class="rv-popup-date">${dateStr} 내용</span>을 복습하셨나요?
      </div>
      <div class="rv-popup-btns">
        <button class="rv-btn rv-btn-primary" onclick="Review.handleResponse('done')">
          네, 복습했어요
        </button>
        <button class="rv-btn rv-btn-secondary" onclick="Review.handleResponse('not_yet')">
          아직이에요
        </button>
        <button class="rv-btn rv-btn-ghost" onclick="Review.handleResponse('skip_today')">
          오늘은 안 할 생각이에요
        </button>
      </div>`;

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
