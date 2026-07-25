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
    if (this._ctx.state === 'suspended') this._ctx.resume();
    return this._ctx;
  }

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

  _playChord(freqs, startTime, duration, type = 'sine', gain = 0.3) {
    freqs.forEach(f => this._playTone(f, startTime, duration, type, gain));
  }

  playStudyStart() {
    const ctx = this._getCtx();
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, i) => {
      this._playTone(freq, now + i * 0.12, 0.25, 'sine', 0.4);
    });
    this._playChord([523.25, 659.25, 783.99], now + 0.6, 0.8, 'sine', 0.3);
  }

  playBreakStart() {
    const ctx = this._getCtx();
    const now = ctx.currentTime;
    const notes = [783.99, 659.25, 523.25, 392.00];
    notes.forEach((freq, i) => {
      this._playTone(freq, now + i * 0.18, 0.35, 'triangle', 0.35);
    });
    this._playChord([392.00, 523.25, 659.25], now + 0.9, 1.0, 'triangle', 0.25);
  }

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

  playDing() {
    const ctx = this._getCtx();
    const now = ctx.currentTime;
    this._playTone(1174.66, now,        0.18, 'sine', 0.35);
    this._playTone(1318.51, now + 0.12, 0.18, 'sine', 0.30);
    this._playTone(1567.98, now + 0.24, 0.45, 'sine', 0.40);
  }

  setVolume(v) { this._volume = Math.max(0, Math.min(1, v)); }
}

const Alarm = new AlarmManager();
