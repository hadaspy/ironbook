// Local-first data store.
// Everything lives in IndexedDB on this device. Each record carries `updatedAt`, and deletes leave a
// tombstone ({deleted:true}), so two copies (this phone and the private GitHub backup) can be merged
// record by record with "newest edit wins" — see merge().

const DB_NAME = 'ironbook';
const KEY = 'state';
const COLS = ['plans', 'programs', 'sessions', 'overrides', 'goals', 'body', 'customEx'];

export const DEFAULT_SETTINGS = {
  unit: 'kg',            // 'kg' | 'lb' — weights are always stored in kg
  theme: 'ember',        // 'ember' | 'glacier' | 'plum'
  defaultRest: 90,       // seconds
  autoRest: true,        // start the rest timer when a set is ticked
  sound: true,
  bar: 20,               // barbell weight in kg, for the plate calculator
  plates: [25, 20, 15, 10, 5, 2.5, 1.25],
  weeklyTarget: 4,       // workouts per week (drives the streak)
  reminderTime: '07:00', // used in the calendar export
  name: '',
  onboarded: false,
  tz: '',                // device time zone, so the Telegram bot sends at your local time
  // Telegram bot (runs as a GitHub Action in the private backup repo, reads this file)
  tgOn: false,
  tgDaily: true, tgDailyTime: '07:00',   // reminder on training days
  tgRecap: true,                         // summary after each logged workout
  tgWeekly: true, tgWeeklyDay: 6, tgWeeklyTime: '20:00', // 0 = Monday … 6 = Sunday
  tgMonthly: true,                       // on the 1st, at the weekly report time
  // Apple Health via Shortcuts
  healthOn: false, healthShortcut: 'Ironbook to Health',
  updatedAt: 0,
};

const now = () => Date.now();
export const uid = () => now().toString(36) + Math.random().toString(36).slice(2, 8);

function emptyState() {
  const col = {};
  COLS.forEach((c) => (col[c] = {}));
  return { schema: 1, settings: { ...DEFAULT_SETTINGS }, col, active: null, sync: {} };
}

// ---------- IndexedDB (with localStorage fallback) ----------
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction('kv').objectStore('kv').get(KEY);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- store ----------
const listeners = new Set();
let saveTimer = null;
let dirtyListeners = new Set();

export const store = {
  state: emptyState(),

  async load() {
    let saved = null;
    try { saved = await idbGet(); } catch { /* private mode etc. */ }
    if (!saved) {
      try { saved = JSON.parse(localStorage.getItem('ironbook-state') || 'null'); } catch { /* ignore */ }
    }
    if (saved) {
      const base = emptyState();
      this.state = { ...base, ...saved, settings: { ...DEFAULT_SETTINGS, ...saved.settings }, col: { ...base.col, ...saved.col } };
    }
    try { await navigator.storage?.persist?.(); } catch { /* not supported */ }
  },

  save(immediate = false) {
    clearTimeout(saveTimer);
    const write = async () => {
      const snapshot = JSON.parse(JSON.stringify(this.state));
      try { await idbSet(snapshot); } catch {
        try { localStorage.setItem('ironbook-state', JSON.stringify(snapshot)); } catch { /* full */ }
      }
    };
    if (immediate) return write();
    saveTimer = setTimeout(write, 250);
  },

  emit(changedData = true) {
    listeners.forEach((fn) => fn());
    if (changedData) dirtyListeners.forEach((fn) => fn());
    this.save();
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  onDataChange(fn) { dirtyListeners.add(fn); },

  // ----- settings -----
  get settings() { return this.state.settings; },
  setSettings(patch) {
    Object.assign(this.state.settings, patch, { updatedAt: now() });
    this.emit();
  },

  // ----- collections -----
  all(col) {
    return Object.values(this.state.col[col] || {}).filter((r) => !r.deleted);
  },
  get(col, id) {
    const r = this.state.col[col]?.[id];
    return r && !r.deleted ? r : null;
  },
  put(col, rec, { silent = false } = {}) {
    if (!rec.id) rec.id = uid();
    rec.updatedAt = now();
    if (!rec.createdAt) rec.createdAt = rec.updatedAt;
    this.state.col[col][rec.id] = rec;
    if (!silent) this.emit();
    return rec;
  },
  remove(col, id) {
    this.state.col[col][id] = { id, deleted: true, updatedAt: now() };
    this.emit();
  },

  // ----- the workout in progress (device-only, never synced) -----
  get active() { return this.state.active; },
  setActive(a) { this.state.active = a; this.emit(false); },
  touchActive() { this.save(); },

  // ----- sync payload -----
  exportData() {
    return { schema: 1, exportedAt: new Date().toISOString(), settings: this.state.settings, col: this.state.col };
  },
  importData(data, { replace = false } = {}) {
    if (!data || !data.col) throw new Error('This file is not a workout backup.');
    if (replace) {
      const base = emptyState();
      this.state.col = { ...base.col, ...data.col };
      this.state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    } else {
      const merged = merge({ settings: this.state.settings, col: this.state.col }, data);
      this.state.settings = merged.settings;
      this.state.col = merged.col;
    }
    this.emit();
  },
};

// Record-by-record merge: the newer `updatedAt` wins. Tombstones win over older edits.
export function merge(a, b) {
  const col = {};
  for (const c of COLS) {
    const x = a.col?.[c] || {};
    const y = b.col?.[c] || {};
    const out = { ...x };
    for (const id in y) {
      if (!out[id] || (y[id].updatedAt || 0) > (out[id].updatedAt || 0)) out[id] = y[id];
    }
    col[c] = out;
  }
  const sa = a.settings || {}, sb = b.settings || {};
  const settings = { ...DEFAULT_SETTINGS, ...((sb.updatedAt || 0) > (sa.updatedAt || 0) ? sb : sa) };
  return { schema: 1, settings, col };
}
