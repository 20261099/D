/**
 * app.js — Fit Timer 메인 앱 컨트롤러
 */

const AppState = {
  settings:      { studyMin: DEFAULT_STUDY_MIN, restMin: DEFAULT_REST_MIN },
  timerMode:     null,
  cameraGranted: null,
  currentScreen: 'screen-loading',
};

let regStream           = null;
let capturedHist        = null;
let capturedThumb       = null;
let currentTimerVideoEl = null;

// ─────────────────────────────────────────────────────────────
// 화면 전환
// ─────────────────────────────────────────────────────────────
function showScreen(id, addHistory = true) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.classList.add('active');
    AppState.currentScreen = id;
  }));
}

// ─────────────────────────────────────────────────────────────
// 초기화
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // 로딩 화면 먼저
  showScreen('screen-loading');

  // Firebase Auth 감시
  await Auth.startWatch(
    async user => {
      await Storage.initForUser(user.uid);
      await initApp(user);
    },
    () => {
      _initLock = false;
      showScreen('screen-auth');
    }
  );

  // Auth 탭 전환
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isLogin = tab.dataset.tab === 'login';
      document.getElementById('auth-login-form')?.classList.toggle('hidden', !isLogin);
      document.getElementById('auth-signup-form')?.classList.toggle('hidden',  isLogin);
    };
  });

  ['auth-login-email','auth-login-pw'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') doLogin();
    });
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  // 로딩 최소 1.8초
  setTimeout(() => {
    if (AppState.currentScreen === 'screen-loading') showScreen('screen-auth');
  }, 1800);
});

// ─────────────────────────────────────────────────────────────
// 버튼 이벤트
// ─────────────────────────────────────────────────────────────
document.addEventListener('click', async e => {
  const id = e.target.id || e.target.closest('button')?.id;
  switch (id) {
    case 'btn-auth-login':  await doLogin();  break;
    case 'btn-auth-signup': await doSignup(); break;
    case 'btn-auth-guest':
      Storage.initGuest(); await initApp(null); break;
    case 'btn-logout-confirm':
      await Auth.logout(); break;
  }
  // 메인화면 이미지 카드
  const card = e.target.closest('[data-nav]');
  if (card) navigate(card.dataset.nav);
  // 모드 카드
  const modeCard = e.target.closest('[data-mode]');
  if (modeCard) {
    AppState.settings.timerMode = modeCard.dataset.mode;
    await Storage.saveSettings(AppState.settings);
    await startTimerScreen(modeCard.dataset.mode);
  }
});

function navigate(target) {
  closeMenu();
  switch (target) {
    case 'planner':  showScreen('screen-planner');  Planner.renderAll(PlannerManager.today()); break;
    case 'timer':
      // 이미 시간 설정했으면 바로 모드 선택으로
      if (AppState.settings.onboarded) {
        showScreen('screen-timer-mode');
        const el = document.getElementById('mode-time-info');
        if (el) el.textContent = `집중 ${AppState.settings.studyMin}분 · 휴식 ${AppState.settings.restMin}분`;
      } else {
        initTimerSetup();
        showScreen('screen-timer-setup');
      }
      break;
    case 'suryong':  showScreen('screen-suryong');  SuryongRoom.refresh(); break;
    case 'account':  showScreen('screen-account');  renderAccountScreen(); break;
    case 'settings': showScreen('screen-settings'); renderSettings(); break;
    case 'main':     showScreen('screen-main'); break;
    case 'textbook': openTextbookRegister(); break;
  }
}

// 메뉴에서 AI/설정 타이머 직접 선택
function startDirectTimer(mode) {
  closeMenu();
  if (!AppState.settings.onboarded) {
    AppState._pendingMode = mode;
    initTimerSetup();
    showScreen('screen-timer-setup');
    return;
  }
  AppState.settings.timerMode = mode;
  Storage.saveSettings(AppState.settings).catch(() => {});
  startTimerScreen(mode);
}

// ─────────────────────────────────────────────────────────────
// 사이드 메뉴
// ─────────────────────────────────────────────────────────────
function openMenu() {
  document.getElementById('side-menu')?.classList.remove('hidden');
  requestAnimationFrame(() => document.getElementById('side-menu-panel')?.classList.add('open'));
}
function closeMenu() {
  document.getElementById('side-menu-panel')?.classList.remove('open');
  setTimeout(() => document.getElementById('side-menu')?.classList.add('hidden'), 280);
}
document.getElementById('btn-hamburger')?.addEventListener('click', openMenu);
document.getElementById('side-menu-overlay')?.addEventListener('click', closeMenu);

// ─────────────────────────────────────────────────────────────
// 로그인 / 회원가입
// ─────────────────────────────────────────────────────────────
async function doLogin() {
  const email = document.getElementById('auth-login-email')?.value || '';
  const pw    = document.getElementById('auth-login-pw')?.value    || '';
  const errEl = document.getElementById('auth-login-err');
  if (!email || !pw) { if(errEl) errEl.textContent='이메일과 비밀번호를 입력해주세요.'; return; }
  if (errEl) errEl.textContent = '';
  const btn = document.getElementById('btn-auth-login');
  btn.disabled=true; btn.textContent='로그인 중...';
  const res = await Auth.login(email, pw);
  btn.disabled=false; btn.textContent='로그인 →';
  if (!res.ok && errEl) errEl.textContent = res.msg;
}

async function doSignup() {
  const email = document.getElementById('auth-signup-email')?.value || '';
  const pw    = document.getElementById('auth-signup-pw')?.value    || '';
  const pw2   = document.getElementById('auth-signup-pw2')?.value   || '';
  const errEl = document.getElementById('auth-signup-err');
  if (!email || !pw) { if(errEl) errEl.textContent='이메일과 비밀번호를 입력해주세요.'; return; }
  if (errEl) errEl.textContent = '';
  const btn = document.getElementById('btn-auth-signup');
  btn.disabled=true; btn.textContent='가입 중...';
  const res = await Auth.signup(email, pw, pw2);
  btn.disabled=false; btn.textContent='가입하기 →';
  if (!res.ok && errEl) errEl.textContent = res.msg;
}

// ─────────────────────────────────────────────────────────────
// 앱 초기화
// ─────────────────────────────────────────────────────────────
let _initLock = false;

async function initApp(user) {
  if (_initLock) return;
  _initLock = true;
  try {
    await TextbookMgr.init();
    await Planner.init();
    await Suryong.init();
    await Review.init();

    // 앱 열릴 때: 밀린 복습 알람 즉시 표시 (백그라운드 알람 못 받았을 경우 대비)
    setTimeout(() => _checkOverdueReviews(), 2000);

    // Push 권한 자동 요청 (이미 있으면 조용히 재구독)
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        Review.requestPushPermission().catch(() => {});
      }
      // 권한 없으면 플래너에서 버튼 눌러야 함 (자동 팝업 안 띄움)
    }
    const saved = await Storage.loadSettings();
    if (saved) Object.assign(AppState.settings, saved);
    const blinkState = await Storage.loadBlinkState();
    if (blinkState) BlinkEngine.restoreState(blinkState);

    showScreen('screen-main');
    if (user) {
      document.querySelectorAll('.user-email-display').forEach(el => el.textContent = user.email);
    }
  } finally {
    _initLock = false;
  }
}

// ─────────────────────────────────────────────────────────────
// 계정 화면
// ─────────────────────────────────────────────────────────────
function renderAccountScreen() {
  const user = Auth.currentUser;
  const emailEl = document.getElementById('account-email-val');
  if (emailEl && user) emailEl.textContent = user.email || '게스트';
}

// 비밀번호 변경 화면
document.getElementById('btn-change-pw')?.addEventListener('click', () => showScreen('screen-change-pw'));
document.getElementById('btn-back-account')?.addEventListener('click', () => navigate('account'));

// 현재 비밀번호 — 입력 중에는 체크 초기화
document.getElementById('pw-current')?.addEventListener('input', () => {
  const icon = document.getElementById('pw-current-check');
  if (icon) icon.textContent = '';
  const el = document.getElementById('pw-current');
  if (el) el.dataset.verified = 'no';
  checkNewPwMatch();
});

// 현재 비밀번호 — 포커스 벗어날 때 Firebase로 실제 검증
document.getElementById('pw-current')?.addEventListener('blur', async e => {
  const val  = e.target.value;
  const icon = document.getElementById('pw-current-check');
  if (!icon || val.length < 6) return;
  icon.textContent = '…'; icon.style.color = 'var(--text-muted)';
  try {
    const user = firebase.auth().currentUser;
    if (!user?.email) { icon.textContent = ''; return; }
    const cred = firebase.auth.EmailAuthProvider.credential(user.email, val);
    await user.reauthenticateWithCredential(cred);
    icon.textContent = '✓'; icon.style.color = '#4bbf87';
    e.target.dataset.verified = 'yes';
  } catch {
    icon.textContent = '✗'; icon.style.color = '#e05555';
    e.target.dataset.verified = 'no';
  }
  checkNewPwMatch();
});

// 새 비밀번호 일치 확인 (현재 비밀번호 검증 완료 후에만 활성화)
function checkNewPwMatch() {
  const pw1      = document.getElementById('pw-new')?.value  || '';
  const pw2      = document.getElementById('pw-new2')?.value || '';
  const verified = document.getElementById('pw-current')?.dataset.verified === 'yes';
  const btn      = document.getElementById('btn-submit-pw');
  if (btn) btn.disabled = !(verified && pw1.length >= 6 && pw1 === pw2);
}
document.getElementById('pw-new')?.addEventListener('input',  checkNewPwMatch);
document.getElementById('pw-new2')?.addEventListener('input', checkNewPwMatch);

document.getElementById('btn-submit-pw')?.addEventListener('click', async () => {
  const newPw = document.getElementById('pw-new')?.value || '';
  const btn   = document.getElementById('btn-submit-pw');
  btn.disabled = true; btn.textContent = '변경 중...';
  try {
    const user = firebase.auth().currentUser;
    if (!user) { alert('로그인이 필요해요.'); return; }
    // reauthenticate 이미 blur에서 완료됨 → updatePassword 바로 호출
    await user.updatePassword(newPw);
    ['pw-current','pw-new','pw-new2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.value = ''; el.dataset.verified = 'no'; }
    });
    const chk = document.getElementById('pw-current-check');
    if (chk) chk.textContent = '';
    btn.disabled = true;
    alert('비밀번호가 변경되었어요! 🔮');
    navigate('account');
  } catch (err) {
    let msg = '비밀번호 변경에 실패했어요.';
    if (err.code === 'auth/requires-recent-login') {
      // 세션 만료 시 현재 비밀번호로 재인증 후 재시도
      const current = document.getElementById('pw-current')?.value || '';
      const user2   = firebase.auth().currentUser;
      if (user2?.email && current) {
        try {
          const cred = firebase.auth.EmailAuthProvider.credential(user2.email, current);
          await user2.reauthenticateWithCredential(cred);
          await user2.updatePassword(newPw);
          alert('비밀번호가 변경되었어요! 🔮'); navigate('account'); return;
        } catch { msg = '다시 로그인 후 시도해주세요.'; }
      }
    } else if (err.code === 'auth/weak-password') msg = '새 비밀번호는 6자 이상이어야 해요.';
    alert(msg);
  } finally { btn.textContent = '변경하기'; }
});

// ─────────────────────────────────────────────────────────────
// 설정 화면
// ─────────────────────────────────────────────────────────────
function renderSettings() {
  const sSlider = document.getElementById('settings-study-slider');
  const sVal    = document.getElementById('settings-study-val');
  const rSlider = document.getElementById('settings-rest-slider');
  const rVal    = document.getElementById('settings-rest-val');
  if (!sSlider) return;
  sSlider.value = AppState.settings.studyMin;
  sVal.textContent = AppState.settings.studyMin + '분';
  rSlider.value = AppState.settings.restMin;
  rVal.textContent = AppState.settings.restMin + '분';
  sSlider.oninput = e => { AppState.settings.studyMin=+e.target.value; sVal.textContent=e.target.value+'분'; };
  rSlider.oninput = e => { AppState.settings.restMin=+e.target.value;  rVal.textContent=e.target.value+'분'; };
}
document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
  await Storage.saveSettings(AppState.settings);
  alert('저장되었습니다!');
  navigate('main');
});

// ─────────────────────────────────────────────────────────────
// 타이머 설정 화면 (기존 온보딩)
// ─────────────────────────────────────────────────────────────
function initTimerSetup() {
  const sSlider = document.getElementById('study-slider');
  const sVal    = document.getElementById('study-val');
  const rSlider = document.getElementById('rest-slider');
  const rVal    = document.getElementById('rest-val');
  if (!sSlider) return;
  sSlider.value = AppState.settings.studyMin;
  sVal.textContent = AppState.settings.studyMin + '분';
  rSlider.value = AppState.settings.restMin;
  rVal.textContent = AppState.settings.restMin + '분';
  sSlider.oninput = e => { AppState.settings.studyMin=+e.target.value; sVal.textContent=e.target.value+'분'; };
  rSlider.oninput = e => { AppState.settings.restMin=+e.target.value;  rVal.textContent=e.target.value+'분'; };
}
document.getElementById('btn-timer-setup-next')?.addEventListener('click', async () => {
  AppState.settings.onboarded = true;
  await Storage.saveSettings(AppState.settings);
  if (AppState._pendingMode) {
    const mode = AppState._pendingMode;
    AppState._pendingMode = null;
    startTimerScreen(mode);
  } else {
    showScreen('screen-timer-mode');
    const el = document.getElementById('mode-time-info');
    if (el) el.textContent = `집중 ${AppState.settings.studyMin}분 · 휴식 ${AppState.settings.restMin}분`;
  }
});
document.getElementById('dont-know-study')?.addEventListener('click', () => {
  AppState.settings.studyMin = DEFAULT_STUDY_MIN;
  document.getElementById('study-slider').value = DEFAULT_STUDY_MIN;
  document.getElementById('study-val').textContent = DEFAULT_STUDY_MIN + '분';
});
document.getElementById('dont-know-rest')?.addEventListener('click', () => {
  AppState.settings.restMin = DEFAULT_REST_MIN;
  document.getElementById('rest-slider').value = DEFAULT_REST_MIN;
  document.getElementById('rest-val').textContent = DEFAULT_REST_MIN + '분';
});

// 타이머 설정 화면으로 들어갈 때
document.querySelector('[data-nav="timer"]')?.addEventListener?.('click', () => {
  initTimerSetup();
  showScreen('screen-timer-setup');
});

// ─────────────────────────────────────────────────────────────
// 카메라 권한
// ─────────────────────────────────────────────────────────────
async function requestCameraPermission() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach(t => t.stop());
    AppState.cameraGranted = true; return true;
  } catch { AppState.cameraGranted = false; return false; }
}

function showToast(msg, type = 'warn') {
  const el = document.getElementById('camera-warning');
  if (!el) return;
  el.textContent = msg; el.className = `toast toast-${type}`;
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.add('hidden'), 4500);
}

// ─────────────────────────────────────────────────────────────
// 타이머 화면
// ─────────────────────────────────────────────────────────────
const RING_C = 678.58;

async function startTimerScreen(mode) {
  showScreen('screen-timer');

  Timer.onTick((rem, phase) => updateTimerDisplay(rem, phase));
  Timer.onPhaseChange((phase, sMin, rMin) => onPhaseChange(phase, sMin, rMin));
  Timer.onAdjust((delta, reason, detail) => onAdjust(delta, reason, detail));

  const videoEl    = document.getElementById('camera-video');
  const canvasEl   = document.getElementById('camera-canvas');
  const cameraArea = document.getElementById('camera-area');
  let cameraOk = false;

  const granted = await requestCameraPermission();
  if (granted) {
    cameraArea.classList.remove('hidden');
    await Tracker.init(videoEl, canvasEl);
    Tracker.onResults(() => {
      DrowsyDetector.update();
      if (mode === 'ai' && Tracker.isCalibrated()) BlinkEngine.tick(Tracker.isEyeClosed());
      if (Timer.getPhase() === 'study' && TextbookMgr.textbooks.length > 0) {
        if (!Tracker.isFaceDetected()) TextbookMgr.checkFrame(videoEl);
        else TextbookMgr.resetPending();
      }
      updateEyeStatus();
    });
    try {
      await Tracker.start();
      cameraOk = true;
      currentTimerVideoEl = videoEl;
      if (mode === 'ai') showCalibOverlay();
      else watchCalibration();
    } catch {
      cameraArea.classList.add('hidden');
      showToast('카메라 시작 실패.', 'warn');
    }
  } else {
    cameraArea.classList.add('hidden');
  }
  if (!cameraOk) { setEyeStatus('📵 카메라 없음', ''); currentTimerVideoEl = null; }

  DrowsyDetector.start();
  DrowsyDetector.onDrowsy(() => onDrowsy());
  DrowsyDetector.onAwake(() => onAwake());
  if (cameraOk && TextbookMgr.textbooks.length > 0) {
    TextbookMgr.setDetectionCallback(onTextbookDetected);
  }

  clearFocusLog();
  Timer.start({ mode, studyMin: AppState.settings.studyMin, restMin: AppState.settings.restMin });
  updateTimerDisplay(Timer.getRemainSec(), Timer.getPhase());
  updateTimeInfoRow();
  updateModeLabel(mode);
  updateSubjectIndicator(null);
  setupTimerControls();
  if (mode === 'ai') {
    document.getElementById('blink-stats')?.classList.remove('hidden');
    document.getElementById('focus-log-panel')?.classList.remove('hidden');
  }
}

function showCalibOverlay() {
  const ov = document.getElementById('calib-overlay');
  ov.classList.remove('hidden');
  const bar = document.getElementById('calib-bar');
  const poll = setInterval(() => {
    if (bar) bar.style.width = (Tracker.getCalibProgress() * 100) + '%';
    if (Tracker.isCalibrated()) {
      clearInterval(poll);
      ov.style.opacity = '0';
      setTimeout(() => { ov.classList.add('hidden'); ov.style.opacity = ''; }, 600);
      BlinkEngine.startWindow();
    }
  }, 200);
}

function watchCalibration() {
  setEyeStatus('🔄 눈 인식 보정 중...', '');
  const poll = setInterval(() => {
    if (Tracker.isCalibrated()) { clearInterval(poll); setEyeStatus('👁 집중 중', 'open'); }
  }, 200);
}

// 타이머 UI
function updateTimerDisplay(remainSec, phase) {
  const m = String(Math.floor(remainSec / 60)).padStart(2, '0');
  const s = String(remainSec % 60).padStart(2, '0');
  document.getElementById('timer-time').textContent = `${m}:${s}`;
  const phaseEl = document.getElementById('timer-phase');
  phaseEl.textContent = phase === 'study' ? '집중 세션' : '휴식 시간';
  phaseEl.className   = `timer-phase ${phase}`;
  const iconEl = document.getElementById('timer-phase-icon');
  if (iconEl) iconEl.textContent = phase === 'study' ? '🔮' : '🍵';
  const totalSec = (phase === 'study' ? Timer.getStudyMin() : Timer.getRestMin()) * 60;
  const progress = totalSec > 0 ? remainSec / totalSec : 0;
  const ring = document.getElementById('timer-ring');
  if (ring) {
    ring.style.strokeDashoffset = RING_C * (1 - progress);
    ring.style.stroke = phase === 'study' ? 'var(--purple-mid)' : 'var(--blue)';
  }
  const bg = document.getElementById('timer-ring-bg');
  if (bg) bg.style.stroke = phase === 'study' ? 'rgba(123,111,196,0.15)' : 'rgba(106,176,232,0.15)';
}

function updateModeLabel(mode) {
  const el = document.getElementById('timer-mode-label');
  if (el) el.textContent = mode === 'ai' ? '🧠 AI 타이머' : '⏱ 설정 타이머';
}

function updateTimeInfoRow() {
  const fmt = n => Math.round(n * 10) / 10;
  const s = document.getElementById('study-min-display');
  const r = document.getElementById('rest-min-display');
  if (s) s.textContent = fmt(Timer.getStudyMin()) + '분';
  if (r) r.textContent = fmt(Timer.getRestMin())  + '분';
}

function setEyeStatus(text, cls) {
  const el = document.getElementById('eye-status');
  if (el) { el.textContent = text; el.className = 'eye-status ' + cls; }
}

function updateEyeStatus() {
  if (DrowsyDetector.isCurrentlyDrowsy()) { setEyeStatus('😴 졸음 감지됨', 'drowsy'); return; }
  if (!Tracker.isCalibrated()) {
    setEyeStatus(`🔄 보정 중 ${Math.round(Tracker.getCalibProgress()*100)}%`, ''); return;
  }
  setEyeStatus(Tracker.isEyeClosed() ? '😑 눈 감음' : '👁 집중 중',
               Tracker.isEyeClosed() ? 'closed' : 'open');
  if (AppState.settings.timerMode === 'ai' && Timer.getPhase() === 'study') updateBlinkStats();
}

let _blinkStatsTimer = 0;
function updateBlinkStats() {
  const now = Date.now();
  if (now - _blinkStatsTimer < 1000) return;
  _blinkStatsTimer = now;
  const count   = BlinkEngine.windowBlinks;
  const elapsed = BlinkEngine.windowStart ? (now - BlinkEngine.windowStart) / 60000 : 0;
  const rate    = elapsed > 0.05 ? count / elapsed : 0;
  const avg     = BlinkEngine.avgRate;
  const c = document.getElementById('bs-count'); if (c) c.textContent = count + '회';
  const r = document.getElementById('bs-rate');  if (r) r.textContent = rate > 0 ? rate.toFixed(1) + '/분' : '--/분';
  const a = document.getElementById('bs-avg');   if (a) a.textContent = avg != null ? avg.toFixed(1) + '/분' : '측정 중';
}

// 타이머 이벤트
function onPhaseChange(phase, sMin, rMin) {
  if (phase === 'break') {
    DrowsyDetector.stop(); Alarm.stopDrowsinessAlarm();
    document.getElementById('drowsy-banner')?.classList.add('hidden');
    setEyeStatus('🍵 휴식 중', '');
    TextbookMgr.stopDetection();

    // 플래너 세션 종료 + 복습 스케줄 등록
    const cur = Planner.getCurrentSubject();
    Planner.endSession().then(() => {
      if (cur) {
        _onStudySessionSaved(cur.textbookId || '', cur.name,
          new Date().toLocaleDateString('sv-SE'));
      }
    }).catch(() => {});
    updateSubjectIndicator(null);

    // 복습 팝업 체크: 방금 공부를 마친 교재에 오늘 마감인 복습이 있으면 물어본다.
    if (typeof Review !== 'undefined') {
      const lastTb = Planner.getCurrentSubject();
      const tbId   = lastTb?.textbookId || AppState._lastTextbookId;
      const result = Review.checkBreak(tbId);
      if (result) ReviewUI.showBreakPopup(result);
    }
  } else {
    DrowsyDetector.start();
    DrowsyDetector.onDrowsy(() => onDrowsy());
    DrowsyDetector.onAwake(() => onAwake());
    ReviewUI.hideBreakPopup();
    if (TextbookMgr.textbooks.length > 0) {
      TextbookMgr.resetDetected();
      TextbookMgr.setDetectionCallback(onTextbookDetected);
    }
  }
  updateTimeInfoRow();
  Storage.saveLastSession({ studyMin: sMin, restMin: rMin, drowsyCount: Timer.getDrowsyCount(), date: Date.now() }).catch(() => {});
}

function fmt(n) { return Math.round(n * 10) / 10; }

function onAdjust(delta, reason, detail) {
  const absMin = Math.abs(delta);
  const minStr = absMin < 1 ? Math.round(absMin * 60) + '초' : fmt(absMin) + '분';
  const label  = reason === 'focus' ? '집중도 높음' : '졸음 감지';
  const el = document.getElementById('adjust-toast');
  if (el) {
    el.innerHTML = `${delta > 0 ? '+' : '-'}${minStr} <span class="toast-reason">${label}</span>`;
    el.className = 'adjust-toast ' + (delta > 0 ? 'plus' : 'minus');
    el.classList.remove('hidden');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.add('hidden'), 3500);
  }
  updateTimeInfoRow();
  if (reason === 'focus') addFocusLog(delta, reason, detail);
}

function onDrowsy() {
  const result = Timer.applyDrowsiness();
  Alarm.startDrowsinessAlarm();
  document.getElementById('drowsy-banner')?.classList.remove('hidden');
  const cnt = document.getElementById('drowsy-count');
  if (cnt) cnt.textContent = result.drowsyCount;
  updateTimeInfoRow();
  if (result.studyCut > 0 || result.restAdd > 0) {
    addFocusLog(result.studyCut > 0 ? -result.studyCut : 0, 'drowsy', {
      drowsyCount: result.drowsyCount, studyCut: result.studyCut, restAdd: result.restAdd
    });
  }
}

function onAwake() {
  Alarm.stopDrowsinessAlarm();
  document.getElementById('drowsy-banner')?.classList.add('hidden');
}

async function onTextbookDetected(tb) {
  if (Timer.getPhase() !== 'study') return;
  const cur = Planner.getCurrentSubject();
  if (cur && cur.name.trim().toLowerCase() === tb.subjectName.trim().toLowerCase()) return;
  await Planner.startSession(tb);
  AppState._lastTextbookId = tb.id;
  Alarm.playDing();
  updateSubjectIndicator(tb);
  DrowsyDetector.resetFaceGoneTimer();
}

// 공부 세션 종료 시 복습 스케줄 등록
async function _onStudySessionSaved(textbookId, subjectName, studiedDate) {
  if (typeof Review !== 'undefined') {
    await Review.onStudySessionEnd(textbookId, subjectName, studiedDate);
  }
}

function updateSubjectIndicator(tb) {
  const wrap = document.getElementById('subject-indicator');
  if (!wrap) return;
  if (tb) {
    wrap.classList.remove('hidden');
    const dot = document.getElementById('subject-dot');
    const nm  = document.getElementById('subject-name-display');
    if (dot) dot.style.background = tb.color;
    if (nm)  nm.textContent = tb.subjectName + ' 공부 중';
  } else {
    wrap.classList.add('hidden');
  }
}

// Focus log
function addFocusLog(delta, reason, detail) {
  const panel = document.getElementById('focus-log-list');
  if (!panel) return;
  const now  = new Date();
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const entry = document.createElement('div');
  entry.className = 'fl-entry fl-' + (delta >= 0 ? 'plus' : 'minus');
  if (reason === 'focus' && detail) {
    const r = detail.rate?.toFixed(3) || '?';
    const a = detail.prevAvg?.toFixed(3) || '?';
    const rt = detail.ratio != null ? (detail.ratio * 100).toFixed(0) : '?';
    entry.innerHTML = `<div class="fl-header"><span class="fl-time">${time}</span><span class="fl-badge fl-plus">+${fmt(delta)}분 집중</span></div>
      <div class="fl-body"><div class="fl-formula">깜빡임 ${r}/초 (평균 ${a}/초) → <b>+${fmt(delta)}분</b></div></div>`;
  } else if (reason === 'drowsy' && detail) {
    const cut = detail.studyCut > 0 ? `공부 −${fmt(detail.studyCut)}분` : '유지';
    entry.innerHTML = `<div class="fl-header"><span class="fl-time">${time}</span><span class="fl-badge fl-minus">졸음 #${detail.drowsyCount}</span></div>
      <div class="fl-body"><div class="fl-row"><span>${cut}</span></div></div>`;
  }
  panel.insertBefore(entry, panel.firstChild);
  while (panel.children.length > 10) panel.removeChild(panel.lastChild);
  const sub = document.getElementById('fl-panel-sub');
  if (sub) sub.style.display = 'none';
}

function clearFocusLog() {
  const panel = document.getElementById('focus-log-list');
  if (panel) panel.innerHTML = '';
  const sub = document.getElementById('fl-panel-sub');
  if (sub) sub.style.display = '';
}

// 타이머 컨트롤
function setupTimerControls() {
  document.getElementById('btn-pause-resume').onclick = () => {
    const btn = document.getElementById('btn-pause-resume');
    if (Timer.isPaused()) {
      Timer.resume();
      btn.textContent = '일시정지';
      // 재개 시 공부 페이즈면 졸음 감지 재시작
      if (Timer.getPhase() === 'study') {
        DrowsyDetector.start();
        DrowsyDetector.onDrowsy(() => onDrowsy());
        DrowsyDetector.onAwake(() => onAwake());
      }
    } else {
      Timer.pause();
      btn.textContent = '▶ 재개';
      // 일시정지 시 졸음 감지 완전 중단
      DrowsyDetector.stop();
      Alarm.stopDrowsinessAlarm();
      document.getElementById('drowsy-banner')?.classList.add('hidden');
    }
  };
  document.getElementById('btn-skip').onclick = () => Timer.skipPhase();
  document.getElementById('btn-end-session').onclick = async () => {
    Timer.stop(); Tracker.stop(); DrowsyDetector.stop();
    TextbookMgr.stopDetection(); Alarm.stopDrowsinessAlarm();
    const cur2 = Planner.getCurrentSubject();
    await Planner.endSession();
    if (cur2) {
      await _onStudySessionSaved(cur2.textbookId || '', cur2.name,
        new Date().toLocaleDateString('sv-SE'));
    }
    if (typeof Review !== 'undefined') Review.resetSession();
    ReviewUI.hideBreakPopup();
    document.getElementById('drowsy-banner')?.classList.add('hidden');
    document.getElementById('btn-pause-resume').textContent = '일시정지';
    document.getElementById('blink-stats')?.classList.add('hidden');
    document.getElementById('focus-log-panel')?.classList.add('hidden');
    currentTimerVideoEl = null;
    showScreen('screen-main');
  };
  document.getElementById('btn-toggle-camera').onclick = () => {
    const area = document.getElementById('camera-area');
    const btn  = document.getElementById('btn-toggle-camera');
    area.classList.toggle('cam-hidden');
    btn.textContent = area.classList.contains('cam-hidden') ? '📷 카메라 보기' : '📷 카메라 숨기기';
  };
}

// ─────────────────────────────────────────────────────────────
// 교재 등록
// ─────────────────────────────────────────────────────────────
document.getElementById('btn-add-textbook')?.addEventListener('click', () => openTextbookRegister());

async function openTextbookRegister() {
  DrowsyDetector.stop(); Alarm.stopDrowsinessAlarm();
  document.getElementById('drowsy-banner')?.classList.add('hidden');
  showScreen('screen-textbook');
  resetRegisterState();
  await startRegCamera();
}

function resetRegisterState() {
  capturedHist = null; capturedThumb = null;
  document.getElementById('reg-before-capture')?.classList.remove('hidden');
  document.getElementById('reg-after-capture')?.classList.add('hidden');
  const inp = document.getElementById('reg-subject-input');
  if (inp) inp.value = '';
}

async function startRegCamera() {
  const videoEl = document.getElementById('reg-video');
  try {
    regStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: 320, height: 240 }
    });
  } catch {
    try { regStream = await navigator.mediaDevices.getUserMedia({ video: true }); }
    catch { alert('카메라를 시작할 수 없어요.'); return; }
  }
  if (videoEl) { videoEl.srcObject = regStream; await videoEl.play(); }
}

function stopRegCamera() {
  if (regStream) { regStream.getTracks().forEach(t => t.stop()); regStream = null; }
  const v = document.getElementById('reg-video');
  if (v) v.srcObject = null;
}

document.getElementById('btn-reg-back')?.addEventListener('click', () => {
  stopRegCamera(); navigate('planner');
});
document.getElementById('btn-capture')?.addEventListener('click', () => {
  const videoEl = document.getElementById('reg-video');
  if (!videoEl?.readyState || videoEl.readyState < 2) { alert('카메라가 준비 중이에요.'); return; }
  capturedHist  = TextbookMgr.extractHistogram(videoEl);
  capturedThumb = TextbookMgr.captureThumbnail(videoEl);
  const preview = document.getElementById('reg-preview');
  if (preview) {
    const ctx = preview.getContext('2d');
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, preview.width, preview.height);
    img.src = capturedThumb;
  }
  document.getElementById('reg-before-capture')?.classList.add('hidden');
  document.getElementById('reg-after-capture')?.classList.remove('hidden');
  document.getElementById('reg-subject-input')?.focus();
});
document.getElementById('btn-reg-retake')?.addEventListener('click', resetRegisterState);
document.getElementById('btn-reg-save')?.addEventListener('click', async () => {
  const name = document.getElementById('reg-subject-input')?.value.trim();
  if (!name) { alert('과목 이름을 입력해주세요.'); return; }
  if (!capturedHist || !capturedThumb) { alert('교재를 먼저 촬영해주세요.'); return; }
  const btn = document.getElementById('btn-reg-save');
  btn.disabled = true; btn.textContent = '저장 중...';
  const color = TextbookMgr.getColorForSubject(name);
  await TextbookMgr.register({ subjectName: name, color, thumbnail: capturedThumb, histogram: capturedHist });
  btn.disabled = false; btn.textContent = '저장하기 →';
  stopRegCamera();
  navigate('planner');
  Planner.renderAll(PlannerManager.today());
});
document.getElementById('reg-subject-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-reg-save')?.click();
});

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// 수룡이방 진열장 팝업
// ─────────────────────────────────────────────────────────────

// 앱 열릴 때 밀린 복습 알람을 브라우저 알림으로 즉시 표시
function _checkOverdueReviews() {
  if (typeof Review === 'undefined') return;
  const overdue = Review.getOverdueReviews();
  if (!overdue.length) return;
  if (Notification.permission !== 'granted') return;

  // 중복 방지: 오늘 이미 알림 보낸 것 체크
  const todayKey = 'review_notified_' + new Date().toLocaleDateString('sv-SE');
  const notified = JSON.parse(localStorage.getItem(todayKey) || '[]');

  overdue.forEach(r => {
    const key = r.id;
    if (notified.includes(key)) return;
    const [,m,d] = (r.studiedDate || '').split('-');
    new Notification('📚 복습 시간이에요!', {
      body: `${m}월 ${d}일에 공부한 ${r.subjectName} 내용을 복습하실 시간이에요!`,
      icon: '/icons/icon-192.png',
      tag:  'review-' + key
    });
    notified.push(key);
  });

  localStorage.setItem(todayKey, JSON.stringify(notified));
}

function openCollections() {
  SuryongRoom._renderCollections();
  document.getElementById('collections-modal')?.classList.remove('hidden');
}
