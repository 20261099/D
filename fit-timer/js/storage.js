/**
 * storage.js
 * Firestore(users/{uid}) + localStorage 폴백
 * Auth.getFirestore()로 db 인스턴스를 받아 사용
 */

class StorageManager {
  constructor() {
    this.db       = null;
    this.uid      = null;
    this.deviceId = this._getDeviceId();
  }

  // 로그인 후 호출: uid 설정 + Firestore 연결
  async initForUser(uid) {
    this.uid = uid || null;
    if (uid && FIREBASE_READY) {
      try {
        this.db = Auth.getFirestore();
        if (this.db) {
          // enablePersistence는 페이지당 딱 한 번만 가능
          if (!StorageManager._persistenceEnabled) {
            await this.db.enablePersistence({ synchronizeTabs: false })
              .catch(() => {}); // 이미 활성화된 경우 무시
            StorageManager._persistenceEnabled = true;
          }
          console.info('[Storage] Firestore 연결:', uid);
        }
      } catch (e) {
        console.warn('[Storage] Firestore 연결 실패 → localStorage 폴백:', e);
        this.db = null;
      }
    } else {
      this.db = null;
    }
  }

  // 게스트 모드 (localStorage만)
  initGuest() {
    this.uid = null;
    this.db  = null;
    console.info('[Storage] 게스트 모드');
  }

  _getDeviceId() {
    let id = localStorage.getItem('focuspod_device_id');
    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('focuspod_device_id', id);
    }
    return id;
  }

  _localKey(key) {
    const prefix = this.uid || this.deviceId;
    return `focuspod_${prefix}_${key}`;
  }

  _saveLocal(key, val) {
    try { localStorage.setItem(this._localKey(key), JSON.stringify(val)); } catch(e) {}
  }

  _loadLocal(key, fallback = null) {
    try {
      const raw = localStorage.getItem(this._localKey(key));
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }

  _docRef(key) {
    const ownerId = this.uid || this.deviceId;
    const coll    = this.uid ? 'users' : 'devices';
    return this.db.collection(coll).doc(ownerId).collection('data').doc(key);
  }

  async _set(key, val) {
    this._saveLocal(key, val);
    if (this.db && this.uid) {
      try { await this._docRef(key).set({ value: val, updatedAt: Date.now() }); }
      catch(e) {}
    }
  }

  async _get(key, fallback = null) {
    if (this.db && this.uid) {
      try {
        const snap = await this._docRef(key).get();
        if (snap.exists) return snap.data().value;
      } catch {}
    }
    return this._loadLocal(key, fallback);
  }

  async saveSettings(s)    { await this._set('settings', s); }
  async loadSettings()     {
    return await this._get('settings', {
      studyMin: DEFAULT_STUDY_MIN, restMin: DEFAULT_REST_MIN, timerMode: null
    });
  }

  async saveBlinkState(s)  { await this._set('blink_state', s); }
  async loadBlinkState()   {
    return await this._get('blink_state', { dailyBaseline: null, baselineDate: null, lastUpdated: null});
  }

  async saveLastSession(session) {
    await this._set('last_session', session);
    const h = await this._get('session_history', []);
    h.unshift({ ...session, date: Date.now() });
    if (h.length > 50) h.length = 50;
    await this._set('session_history', h);
  }
  async loadLastSession()     { return await this._get('last_session', null); }
  async loadSessionHistory()  { return await this._get('session_history', []); }

  async saveCurrentSession(s) { await this._set('current_session', s); }
  async loadCurrentSession()  { return await this._get('current_session', null); }
  async clearCurrentSession() { await this._set('current_session', null); }

  async saveTextbook(tb) {
    // 로컬에는 썸네일 포함 전체 저장 (카메라 미리보기용)
    this._saveLocal(`tb_${tb.id}`, tb);
    const ids = this._loadLocal('tb_ids', []);
    if (!ids.includes(tb.id)) { ids.push(tb.id); this._saveLocal('tb_ids', ids); }

    if (this.db && this.uid) {
      try {
        // Firestore에는 썸네일 제외 (용량 초과 방지)
        // histogram은 감지에 필수이므로 반드시 저장
        const { thumbnail, ...meta } = tb;
        await this.db.collection('users').doc(this.uid)
          .collection('textbooks').doc(tb.id)
          .set({ ...meta, updatedAt: Date.now() });
        console.info('[Storage] 교재 저장 완료 →', tb.id);
      } catch (e) {
        console.warn('[Storage] 교재 Firestore 저장 실패:', e);
      }
    }
  }

  async loadTextbooks() {
    // Firestore 우선 — 다른 기기에서 로그인해도 교재 목록 유지
    if (this.db && this.uid) {
      try {
        const snap = await this.db.collection('users').doc(this.uid)
          .collection('textbooks').get();

        if (!snap.empty) {
          const textbooks = [];
          snap.forEach(doc => {
            const data = doc.data();
            // 같은 기기라면 로컬에 썸네일이 있을 수 있음 → 병합
            const local = this._loadLocal(`tb_${doc.id}`, null);
            const merged = { ...data, thumbnail: local?.thumbnail || null };
            textbooks.push(merged);
            // 로컬 캐시 갱신 (썸네일 없는 기기는 null 유지)
            this._saveLocal(`tb_${doc.id}`, merged);
          });
          // tb_ids도 로컬에 업데이트
          this._saveLocal('tb_ids', textbooks.map(t => t.id));
          console.info('[Storage] 교재 Firestore에서 로드:', textbooks.length, '개');
          return textbooks;
        }
      } catch (e) {
        console.warn('[Storage] 교재 Firestore 로드 실패 → 로컬 폴백:', e);
      }
    }

    // 로컬스토리지 폴백
    const ids = this._loadLocal('tb_ids', []);
    return ids.map(id => this._loadLocal(`tb_${id}`, null)).filter(Boolean);
  }

  async deleteTextbook(id) {
    localStorage.removeItem(this._localKey(`tb_${id}`));
    const ids = this._loadLocal('tb_ids', []).filter(i => i !== id);
    this._saveLocal('tb_ids', ids);
    if (this.db && this.uid) {
      try {
        await this.db.collection('users').doc(this.uid)
          .collection('textbooks').doc(id).delete();
        console.info('[Storage] 교재 삭제 완료 →', id);
      } catch (e) {
        console.warn('[Storage] 교재 Firestore 삭제 실패:', e);
      }
    }
  }

  async saveStudySessions(sessions) {
    const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
    await this._set('study_sessions', sessions.filter(s => s.startTime > cutoff));
  }
  async loadStudySessions() { return await this._get('study_sessions', []); }

  // ── 수룡이 상태 ──────────────────────────────────────────────
  async saveSuryongState(state) { await this._set('suryong_state', state); }
  async loadSuryongState()      { return await this._get('suryong_state', null); }

  // ── 복습 알람 시스템 ──────────────────────────────────────────
  async saveReviews(data)        { await this._set('review_data', data); }
  async loadReviews()            { return await this._get('review_data', null); }
  async savePushSubscription(s)  { await this._set('push_sub', s); }
  async loadPushSubscription()   { return await this._get('push_sub', null); }
}

const Storage = new StorageManager();