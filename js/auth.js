/**
 * auth.js
 * - Firebase 앱 초기화 (단일 진입점)
 * - 이메일/비밀번호 로그인·회원가입·로그아웃
 */

// Firebase 초기화 (auth.js가 단독으로 담당)
let _fbApp  = null;
let _fbAuth = null;

function _initFirebase() {
  if (_fbApp) return true;
  if (!FIREBASE_READY) return false;
  try {
    _fbApp  = firebase.apps.length
      ? firebase.app()
      : firebase.initializeApp(FIREBASE_CONFIG);
    _fbAuth = firebase.auth();
    return true;
  } catch (e) {
    console.error('[Auth] Firebase 초기화 실패:', e);
    return false;
  }
}

const Auth = {
  currentUser: null,

  // Firestore 인스턴스 (storage.js에서 사용)
  getFirestore() {
    if (!_fbApp) return null;
    try { return firebase.firestore(); } catch(e) { return null; }
  },

  // 인증 상태 감지 시작 — app.js에서 콜백 등록 후 호출
  async startWatch(onSignIn, onSignOut) {
    if (!_initFirebase()) { return; }
    // LOCAL 영속성은 Firebase Auth 기본값 — setPersistence 별도 호출 불필요
    // (호출하면 onAuthStateChanged가 두 번 발동하는 부작용 있음)
    _fbAuth.onAuthStateChanged(user => {
      this.currentUser = user;
      if (user) {
        console.info('[Auth] 로그인 완료:', user.email);
        onSignIn(user);
      } else {
        console.info('[Auth] 미로그인');
        onSignOut();
      }
    });
  },

  async login(email, pw) {
    if (!_initFirebase()) return { ok: false, msg: 'Firebase 설정이 필요해요.' };
    try {
      await _fbAuth.signInWithEmailAndPassword(email.trim(), pw);
      return { ok: true };
    } catch (e) { return { ok: false, msg: _errMsg(e.code) }; }
  },

  async signup(email, pw, pw2) {
    if (!_initFirebase()) return { ok: false, msg: 'Firebase 설정이 필요해요.' };
    if (pw !== pw2)    return { ok: false, msg: '비밀번호가 일치하지 않아요.' };
    if (pw.length < 6) return { ok: false, msg: '비밀번호는 6자 이상이어야 해요.' };
    try {
      await _fbAuth.createUserWithEmailAndPassword(email.trim(), pw);
      return { ok: true };
    } catch (e) { return { ok: false, msg: _errMsg(e.code) }; }
  },

  async logout() {
    if (_fbAuth) await _fbAuth.signOut();
  },
};

function _errMsg(code) {
  const map = {
    // 로그인 오류
    'auth/user-not-found':           '등록되지 않은 이메일이에요.',
    'auth/wrong-password':           '비밀번호가 틀렸어요.',
    'auth/invalid-credential':       '이메일 또는 비밀번호가 잘못됐어요.',
    'auth/invalid-email':            '올바른 이메일 형식이 아니에요.',
    'auth/user-disabled':            '비활성화된 계정이에요.',
    // 회원가입 오류
    'auth/email-already-in-use':     '이미 사용 중인 이메일이에요.',
    'auth/weak-password':            '비밀번호는 6자 이상이어야 해요.',
    'auth/operation-not-allowed':    '이메일/비밀번호 로그인이 비활성화되어 있어요.',
    // 네트워크/기타
    'auth/too-many-requests':        '시도 횟수 초과. 잠시 후 다시 해주세요.',
    'auth/network-request-failed':   '네트워크 오류가 발생했어요.',
    'auth/requires-recent-login':    '보안을 위해 다시 로그인해주세요.',
  };
  return map[code] || '오류가 발생했어요. 다시 시도해주세요.';
}