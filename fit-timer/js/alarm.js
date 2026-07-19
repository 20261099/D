/**
 * alarm.js
 * Web Audio API 기반 알람 시스템
 * - 공부 시작: 상승 아르페지오 (활기차게)
 * - 휴식 시작: 하강 아르페지오 (부드럽게)
 * - 졸음 알람: 강렬한 반복 버저 (계속 울림)
 */

class AlarmManager {
  constructor() {
    this._ctx = null;
    this._drowsyInterval = null;
    this._drowsyActive = false;
    this._volume = 0.8;
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
  // 강렬한 사각파 버저: 200ms ON / 100ms OFF 패턴
  startDrowsinessAlarm() {
    if (this._drowsyActive) return;
    this._drowsyActive = true;
    this._playDrowsyBeep();
    this._drowsyInterval = setInterval(() => {
      if (this._drowsyActive) this._playDrowsyBeep();
    }, 600);
  }

  _playDrowsyBeep() {
    const ctx = this._getCtx();
    const now = ctx.currentTime;
    // 긴박한 두 음: A5 + C6
    this._playTone(880, now,       0.15, 'square', 0.6, false);
    this._playTone(1046.50, now + 0.2, 0.15, 'square', 0.5, false);
    this._playTone(880, now + 0.4, 0.15, 'square', 0.6, false);
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
