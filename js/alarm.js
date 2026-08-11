/**
 * alarm.js
 * Web Audio API 기반 알람 시스템
 * - 공부 시작: 상승 아르페지오 (활기차게)
 * - 휴식 시작: 하강 아르페지오 (부드럽게)
 * - 졸음 알람: 계속 반복 울림 (소리는 설정에서 선택 가능)
 */

// ── 졸음 알람 소리 프리셋 ─────────────────────────────────────────
// 각 프리셋은 { label, cycleMs(반복 간격), play(alarm, ctx, now) }를 가진다.
// 설정 화면에서 이 목록을 그대로 보여주고 선택/미리듣기에 사용한다.
const DROWSY_SOUND_PRESETS = {
  'gentle-bell': {
    label: '🔔 부드러운 벨',
    cycleMs: 900,
    play(a, ctx, now) {
      a._playTone(880,    now,        0.4, 'sine', 0.35);
      a._playTone(659.25, now + 0.25, 0.5, 'sine', 0.30);
    }
  },
  'chime': {
    label: '🎐 경쾌한 차임벨',
    cycleMs: 900,
    play(a, ctx, now) {
      a._playTone(1046.50, now,        0.2,  'sine', 0.40);
      a._playTone(1318.51, now + 0.15, 0.2,  'sine', 0.40);
      a._playTone(1567.98, now + 0.30, 0.35, 'sine', 0.45);
    }
  },
  'pulse': {
    label: '📳 낮은 경고 펄스',
    cycleMs: 700,
    play(a, ctx, now) {
      a._playTone(440, now, 0.5, 'triangle', 0.5, false);
    }
  },
  'classic-buzzer': {
    label: '🚨 강렬한 버저',
    cycleMs: 600,
    play(a, ctx, now) {
      a._playTone(880,     now,       0.15, 'square', 0.6, false);
      a._playTone(1046.50, now + 0.2, 0.15, 'square', 0.5, false);
      a._playTone(880,     now + 0.4, 0.15, 'square', 0.6, false);
    }
  }
};

class AlarmManager {
  constructor() {
    this._ctx = null;
    this._drowsyInterval = null;
    this._drowsyActive = false;
    this._volume = 0.8;
    this._drowsySound = DEFAULT_DROWSY_SOUND;
  }

  _getCtx() {
    if (!this._ctx || this._ctx.state === 'closed') {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // iOS/Android: resume after user gesture
    if (this._ctx.state === 'suspended') this._ctx.resume();
    return this._ctx;
  }

  // ── 기본 음원 생성기 ──────────────────────────────────────────
  _playTone(freq, startTime, duration, type = 'sine', gain = 0.5, fadeOut = true) {
    const ctx = this._getCtx();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(gain * this._volume, startTime + 0.01);
    if (fadeOut) {
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration - 0.02);
    } else {
      gainNode.gain.setValueAtTime(gain * this._volume, startTime + duration - 0.02);
      gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
    }

    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  // ── 화음 (여러 주파수 동시 재생) ──────────────────────────────
  _playChord(freqs, startTime, duration, type = 'sine', gain = 0.3) {
    freqs.forEach(f => this._playTone(f, startTime, duration, type, gain));
  }

  // ── 공부 시작 알람 ────────────────────────────────────────────
  // C5 → E5 → G5 → C6 상승 아르페지오 + 마지막 화음
  playStudyStart() {
    const ctx = this._getCtx();
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      this._playTone(freq, now + i * 0.12, 0.25, 'sine', 0.4);
    });
    // 마지막 화음
    this._playChord([523.25, 659.25, 783.99], now + 0.6, 0.8, 'sine', 0.3);
  }

  // ── 휴식 시작 알람 ────────────────────────────────────────────
  // G5 → E5 → C5 → G4 하강 아르페지오 (부드럽게)
  playBreakStart() {
    const ctx = this._getCtx();
    const now = ctx.currentTime;
    const notes = [783.99, 659.25, 523.25, 392.00]; // G5 E5 C5 G4
    notes.forEach((freq, i) => {
      this._playTone(freq, now + i * 0.18, 0.35, 'triangle', 0.35);
    });
    this._playChord([392.00, 523.25, 659.25], now + 0.9, 1.0, 'triangle', 0.25);
  }

  // ── 졸음 알람 (계속 울림) ─────────────────────────────────────
  // 어떤 소리를 쓸지는 this._drowsySound(설정에서 선택)에 따라 달라짐
  startDrowsinessAlarm() {
    if (this._drowsyActive) return;
    this._drowsyActive = true;
    this._playDrowsyBeep();
    const preset = DROWSY_SOUND_PRESETS[this._drowsySound] || DROWSY_SOUND_PRESETS[DEFAULT_DROWSY_SOUND];
    this._drowsyInterval = setInterval(() => {
      if (this._drowsyActive) this._playDrowsyBeep();
    }, preset.cycleMs);
  }

  _playDrowsyBeep() {
    const ctx = this._getCtx();
    const now = ctx.currentTime;
    const preset = DROWSY_SOUND_PRESETS[this._drowsySound] || DROWSY_SOUND_PRESETS[DEFAULT_DROWSY_SOUND];
    preset.play(this, ctx, now);
  }

  stopDrowsinessAlarm() {
    this._drowsyActive = false;
    if (this._drowsyInterval) {
      clearInterval(this._drowsyInterval);
      this._drowsyInterval = null;
    }
  }

  isDrowsyAlarmActive() {
    return this._drowsyActive;
  }

  // ── 졸음 알람 소리 선택 (설정 화면용) ────────────────────────
  setDrowsySound(id) {
    if (DROWSY_SOUND_PRESETS[id]) this._drowsySound = id;
  }
  getDrowsySound() { return this._drowsySound; }
  getDrowsySoundPresets() {
    return Object.entries(DROWSY_SOUND_PRESETS).map(([id, p]) => ({ id, label: p.label }));
  }
  // 실제 졸음 상태가 아니어도 설정 화면에서 소리만 한 번 들어볼 때 사용
  previewDrowsySound(id) {
    const preset = DROWSY_SOUND_PRESETS[id];
    if (!preset) return;
    const ctx = this._getCtx();
    preset.play(this, ctx, ctx.currentTime);
  }

  // ── 교재 인식 알림 (띠로롱) ──────────────────────────────────
  // 상쾌하고 귀여운 3음 상승 딩
  playDing() {
    const ctx = this._getCtx();
    const now = ctx.currentTime;
    this._playTone(1174.66, now,        0.18, 'sine', 0.35);  // D6
    this._playTone(1318.51, now + 0.12, 0.18, 'sine', 0.30);  // E6
    this._playTone(1567.98, now + 0.24, 0.45, 'sine', 0.40);  // G6
  }

  setVolume(v) { this._volume = Math.max(0, Math.min(1, v)); }
}

const Alarm = new AlarmManager();
