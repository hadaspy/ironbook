// Rest timer. Based on an end timestamp (not a counter), so it stays correct if the phone locks
// or the app is backgrounded. Plays a beep + vibration when it ends while the app is open.
import { store } from './store.js';

let ctx = null;
const listeners = new Set();
let tickHandle = null;
let firedFor = null;

export const timer = {
  get state() { return store.active?.rest || null; },
  remaining() {
    const r = this.state;
    return r ? Math.max(0, (r.endAt - Date.now()) / 1000) : 0;
  },
  start(seconds, label = '') {
    if (!store.active) return;
    store.active.rest = { endAt: Date.now() + seconds * 1000, total: seconds, label };
    firedFor = null;
    store.touchActive();
    this.loop();
    notify();
  },
  add(sec) {
    const r = this.state; if (!r) return;
    r.endAt = Math.max(Date.now(), r.endAt) + sec * 1000;
    r.total = Math.max(1, r.total + sec);
    store.touchActive(); notify();
  },
  stop() {
    if (store.active) store.active.rest = null;
    store.touchActive(); notify();
  },
  loop() {
    cancelAnimationFrame(tickHandle);
    clearInterval(this._iv);
    // setInterval keeps ticking at a sane rate; UI updates via listeners
    this._iv = setInterval(() => {
      const r = this.state;
      if (!r) { clearInterval(this._iv); return; }
      if (Date.now() >= r.endAt && firedFor !== r.endAt) { firedFor = r.endAt; done(); }
      notify();
    }, 250);
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

function notify() { listeners.forEach((fn) => fn()); }

function done() {
  if (store.settings.sound) beep();
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* iOS has no vibrate */ }
  document.body.classList.add('rest-flash');
  setTimeout(() => document.body.classList.remove('rest-flash'), 1200);
  setTimeout(() => { if (timer.state && Date.now() >= timer.state.endAt) timer.stop(); }, 4000);
}

// iOS only allows audio after a tap; call this from any tap to unlock it.
export function unlockAudio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* no audio */ }
}

export function beep() {
  if (!ctx) return;
  const t = ctx.currentTime;
  [0, 0.22, 0.44].forEach((off, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = i === 2 ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t + off);
    g.gain.exponentialRampToValueAtTime(0.35, t + off + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start(t + off); o.stop(t + off + 0.2);
  });
}

// Keep the screen on during a workout (supported in recent iOS for home-screen apps)
let lock = null;
export async function keepAwake(on) {
  try {
    if (on && !lock && 'wakeLock' in navigator) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => (lock = null)); }
    if (!on && lock) { await lock.release(); lock = null; }
  } catch { /* not allowed */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && store.active) keepAwake(true); });
