// Pure-ish helpers: dates, units, best sets, PRs, progress series and comparisons.
import { store } from './store.js';
import { getEx, GROUP } from './exercises.js';

// ---------- dates (all local time, keys are YYYY-MM-DD) ----------
export const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDay = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const weekStart = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); }; // Monday
export const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const dowIndex = (d) => (d.getDay() + 6) % 7; // 0 = Monday
export const fmtDate = (d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => d.toLocaleDateString(undefined, opts);
export const fmtDuration = (ms) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m} min`;
};
export const fmtClock = (sec) => { sec = Math.max(0, Math.round(sec)); return `${Math.floor(sec / 60)}:${pad(sec % 60)}`; };

// ---------- activity types (custom logs) ----------
// key, label, Apple Health workout type (used by the Shortcuts bridge), MET for the calorie estimate, has distance
export const ACTIVITIES = [
  ['strength', 'Strength', 'Traditional Strength Training', 5, false],
  ['run', 'Run', 'Running', 9.8, true],
  ['cycle', 'Cycle', 'Cycling', 7.5, true],
  ['swim', 'Swim', 'Swimming', 7, true],
  ['walk', 'Walk / hike', 'Walking', 3.8, true],
  ['hiit', 'HIIT', 'High Intensity Interval Training', 8, false],
  ['sport', 'Sport', 'Other', 7, false],
  ['mobility', 'Yoga / mobility', 'Yoga', 2.5, false],
  ['other', 'Other', 'Other', 5, false],
];
export const activity = (k) => ACTIVITIES.find((a) => a[0] === (k || 'strength')) || ACTIVITIES[0];

// ---------- units ----------
const LB = 2.2046226218;
export const unit = () => store.settings.unit;
export const toDisplay = (kg) => (kg == null || kg === '' ? '' : unit() === 'lb' ? kg * LB : kg);
export const toKg = (v) => (v === '' || v == null || isNaN(v) ? null : unit() === 'lb' ? Number(v) / LB : Number(v));
export const round = (n, step = 0.5) => Math.round(n / step) * step;
export const fmtW = (kg, withUnit = true) => {
  if (kg == null || isNaN(kg)) return '–';
  const v = toDisplay(kg);
  const s = (Math.round(v * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
  return withUnit ? `${s} ${unit()}` : s;
};
export const fmtNum = (n) => Math.round(n).toLocaleString();
export const fmtVol = (kg) => {
  const v = toDisplay(kg);
  return v >= 100000 ? `${(v / 1000).toFixed(0)}k` : v >= 10000 ? `${(v / 1000).toFixed(1)}k` : fmtNum(v);
};

// ---------- strength ----------
export const isWorkSet = (s) => s.done && s.type !== 'warmup';

export function sessionStats(s) {
  let volume = 0, sets = 0, reps = 0;
  for (const ex of s.exercises || []) {
    for (const st of ex.sets) {
      if (!isWorkSet(st)) continue;
      sets++; reps += st.r || 0; volume += (st.w || 0) * (st.r || 0);
    }
  }
  const duration = s.endedAt && s.startedAt ? s.endedAt - s.startedAt : 0;
  return { volume, sets, reps, duration };
}

export const sessions = () => store.all('sessions').sort((a, b) => a.startedAt - b.startedAt);

// Best set of one exercise within a session: the heaviest weight, then the most reps at it
export function bestSet(exEntry) {
  let best = null;
  for (const st of exEntry.sets) {
    if (!isWorkSet(st) || !st.r) continue;
    const w = st.w || 0;
    if (!best || w > best.w || (w === best.w && st.r > best.r)) best = { w, r: st.r };
  }
  return best;
}
export const betterSet = (a, b) => (!b ? !!a : !!a && (a.w > b.w + 0.01 || (Math.abs(a.w - b.w) <= 0.01 && a.r > b.r)));
// Compare two best sets for display: weight change first, else rep change at the same weight
export function setChange(now, before) {
  if (!now || !before) return { kind: 'new', v: 0 };
  const dw = now.w - before.w;
  if (Math.abs(dw) > 0.01) return { kind: 'w', v: dw };
  return { kind: 'r', v: now.r - before.r };
}

// Per-session history for one exercise, oldest first
export function exerciseHistory(exId) {
  const out = [];
  for (const s of sessions()) {
    for (const ex of s.exercises || []) {
      if (ex.exId !== exId) continue;
      const best = bestSet(ex);
      const work = ex.sets.filter(isWorkSet);
      if (!work.length) continue;
      out.push({
        session: s, date: new Date(s.startedAt), best,
        maxW: Math.max(...work.map((x) => x.w || 0)),
        volume: work.reduce((a, x) => a + (x.w || 0) * (x.r || 0), 0),
        reps: work.reduce((a, x) => a + (x.r || 0), 0), sets: work,
      });
    }
  }
  return out;
}

// The sets from the most recent previous time you did this exercise (shown as "Last time")
export function lastPerformance(exId, excludeSessionId) {
  const all = sessions();
  for (let i = all.length - 1; i >= 0; i--) {
    const s = all[i];
    if (s.id === excludeSessionId) continue;
    const ex = (s.exercises || []).find((e) => e.exId === exId);
    if (ex && ex.sets.some((x) => x.done)) return { session: s, sets: ex.sets.filter((x) => x.done) };
  }
  return null;
}

// The weight you used most recently on an exercise: the last ticked work set of the latest session.
// It becomes the preset for every set the next time (and for later sets within the same workout).
export function lastWeight(exId, excludeSessionId) {
  const lp = lastPerformance(exId, excludeSessionId);
  const work = (lp?.sets || []).filter((x) => x.type !== 'warmup' && x.w);
  return work.length ? work[work.length - 1].w : null;
}

// What kind of personal record a set is, compared with every work set logged before `beforeTs`
// plus `earlier` sets from the same workout. 'weight' = heaviest ever,
// 'reps' = most reps (or seconds) at this weight or heavier. First time doing an exercise: no PR.
export function prKind(exId, w, r, beforeTs, earlier = []) {
  if (!r) return null;
  w = w || 0;
  const prior = [];
  for (const h of exerciseHistory(exId)) if (h.session.startedAt < beforeTs) prior.push(...h.sets);
  prior.push(...earlier.filter((x) => x.done && x.type !== 'warmup' && x.r));
  if (!prior.length) return null;
  if (w > Math.max(...prior.map((x) => x.w || 0)) + 0.01) return 'weight';
  const atW = prior.filter((x) => (x.w || 0) >= w - 0.01);
  if (atW.length && r > Math.max(...atW.map((x) => x.r || 0))) return 'reps';
  return null;
}
export const prLabel = (kind, exId) => ({ weight: 'Heaviest ever', reps: getEx(exId).tracks === 'time' ? 'Longest hold' : 'Rep record' }[kind] || 'Personal best');

export function personalBests(exId, beforeTs = Infinity) {
  let w = 0, reps = 0;
  for (const h of exerciseHistory(exId)) {
    if (h.session.startedAt >= beforeTs) continue;
    w = Math.max(w, h.maxW);
    reps = Math.max(reps, ...h.sets.map((x) => x.r || 0));
  }
  return { maxW: w, maxReps: reps };
}

// ---------- buckets ----------
// Returns the last `count` weeks or months as [{key,label,start,end}], oldest first.
export function buckets(period, count) {
  const out = [];
  if (period === 'week') {
    const ws = weekStart();
    for (let i = count - 1; i >= 0; i--) {
      const start = addDays(ws, -7 * i), end = addDays(start, 7);
      out.push({ key: dayKey(start), label: fmtDate(start, { day: 'numeric', month: 'short' }), start, end });
    }
  } else {
    const t = new Date();
    for (let i = count - 1; i >= 0; i--) {
      const start = new Date(t.getFullYear(), t.getMonth() - i, 1), end = new Date(t.getFullYear(), t.getMonth() - i + 1, 1);
      out.push({ key: monthKey(start), label: start.toLocaleDateString(undefined, { month: 'short' }), start, end });
    }
  }
  return out;
}

// metric: 'max' (heaviest weight) | 'volume' | 'reps'
export function exerciseSeries(exId, period, count, metric = 'max') {
  const hist = exerciseHistory(exId);
  return buckets(period, count).map((b) => {
    const inB = hist.filter((h) => h.date >= b.start && h.date < b.end);
    let value = null;
    if (inB.length) {
      if (metric === 'max' || metric === 'e1rm') value = Math.max(...inB.map((h) => h.maxW));
      if (metric === 'volume') value = inB.reduce((a, h) => a + h.volume, 0);
      if (metric === 'reps') value = Math.max(...inB.map((h) => Math.max(...h.sets.map((x) => x.r || 0))));
    }
    return { ...b, value };
  });
}

export function volumeSeries(period, count) {
  const all = sessions();
  return buckets(period, count).map((b) => {
    const inB = all.filter((s) => s.startedAt >= +b.start && s.startedAt < +b.end);
    return { ...b, value: inB.reduce((a, s) => a + sessionStats(s).volume, 0), sessions: inB.length };
  });
}

export function rangeSummary(start, end) {
  const list = sessions().filter((s) => s.startedAt >= +start && s.startedAt < +end);
  const sum = { sessions: list.length, volume: 0, sets: 0, reps: 0, duration: 0, muscles: {}, exercises: {} };
  for (const s of list) {
    const st = sessionStats(s);
    sum.volume += st.volume; sum.sets += st.sets; sum.reps += st.reps; sum.duration += st.duration;
    for (const ex of s.exercises || []) {
      const work = ex.sets.filter(isWorkSet);
      if (!work.length) continue;
      const def = getEx(ex.exId);
      for (const m of def.primary) { const g = GROUP[m] || 'Other'; sum.muscles[g] = (sum.muscles[g] || 0) + work.length; }
      const b = bestSet(ex);
      const prev = sum.exercises[ex.exId];
      if (b && betterSet(b, prev)) sum.exercises[ex.exId] = b;
    }
  }
  return sum;
}

// This week so far vs the whole of last week, plus "last week up to the same weekday" for a fair pace check.
export function compareWeeks(ref = new Date()) {
  const ws = weekStart(ref);
  const today = addDays(new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()), 1);
  const thisW = rangeSummary(ws, addDays(ws, 7));
  const lastW = rangeSummary(addDays(ws, -7), ws);
  const lastToDate = rangeSummary(addDays(ws, -7), addDays(today, -7));
  const lifts = [];
  for (const id in thisW.exercises) {
    if (lastW.exercises[id]) lifts.push({ exId: id, now: thisW.exercises[id], before: lastW.exercises[id] });
  }
  return { thisW, lastW, lastToDate, lifts };
}

export const pct = (a, b) => (!b ? null : ((a - b) / b) * 100);

// ---------- schedule ----------
export function activeProgram() {
  return store.all('programs').find((p) => p.active) || null;
}

// What's planned on a given day: a date override beats the program's rotation.
export function plannedFor(date) {
  const key = dayKey(date);
  const ov = store.get('overrides', key);
  if (ov) return ov.planId ? { planId: ov.planId, source: 'override' } : { planId: null, source: 'skip' };
  const p = activeProgram();
  if (!p || !p.schedule?.length) return { planId: null, source: 'none' };
  const start = weekStart(parseDay(p.startDate || dayKey(weekStart())));
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (d < start) return { planId: null, source: 'none' };
  const days = Math.round((d - start) / 86400000);
  const idx = days % p.schedule.length;
  return { planId: p.schedule[idx] || null, source: 'program', week: Math.floor(days / 7) % (p.schedule.length / 7) + 1 };
}

export function sessionsOn(date) {
  const k = dayKey(date);
  return sessions().filter((s) => dayKey(new Date(s.startedAt)) === k);
}

// Consecutive weeks (ending with the last full week, or this one if already hit) meeting the weekly target
export function weekStreak() {
  const target = store.settings.weeklyTarget || 1;
  const all = sessions();
  const count = (start) => all.filter((s) => s.startedAt >= +start && s.startedAt < +addDays(start, 7)).length;
  let ws = weekStart();
  let streak = count(ws) >= target ? 1 : 0;
  ws = addDays(ws, -7);
  while (count(ws) >= target) { streak++; ws = addDays(ws, -7); }
  return streak;
}

export function usedCounts() {
  const c = {};
  for (const s of store.all('sessions')) for (const ex of s.exercises || []) c[ex.exId] = (c[ex.exId] || 0) + 1;
  for (const p of store.all('plans')) for (const it of p.items || []) c[it.exId] = (c[it.exId] || 0) + 0.5;
  return c;
}

// Plate calculator: plates per side for a barbell total (kg)
export function platesFor(totalKg, barKg, plates) {
  let side = (totalKg - barKg) / 2;
  if (side <= 0) return { per: [], rest: 0 };
  const per = [];
  for (const p of [...plates].sort((a, b) => b - a)) {
    while (side >= p - 1e-6) { per.push(p); side -= p; }
  }
  return { per, rest: Math.round(side * 2 * 100) / 100 };
}

export function goalProgress(g) {
  if (g.type === 'lift') {
    const best = personalBests(g.exId).maxW; // lift goals track the heaviest weight lifted
    const start = g.startValue ?? 0;
    return { current: best, target: g.target, frac: g.target > start ? Math.max(0, Math.min(1, (best - start) / (g.target - start))) : best >= g.target ? 1 : 0 };
  }
  if (g.type === 'frequency') {
    const n = rangeSummary(weekStart(), addDays(weekStart(), 7)).sessions;
    return { current: n, target: g.target, frac: Math.min(1, n / g.target) };
  }
  if (g.type === 'volume') {
    const v = rangeSummary(weekStart(), addDays(weekStart(), 7)).volume;
    return { current: v, target: g.target, frac: Math.min(1, v / g.target) };
  }
  if (g.type === 'bodyweight') {
    const list = store.all('body').sort((a, b) => a.date.localeCompare(b.date));
    const cur = list.length ? list[list.length - 1].kg : null;
    const start = g.startValue ?? cur;
    if (cur == null) return { current: null, target: g.target, frac: 0 };
    const total = Math.abs(g.target - start) || 1;
    const moved = start > g.target ? start - cur : cur - start;
    return { current: cur, target: g.target, frac: Math.max(0, Math.min(1, moved / total)) };
  }
  if (g.type === 'sessions') {
    const n = sessions().filter((s) => s.startedAt >= (g.createdAt || 0)).length;
    return { current: n, target: g.target, frac: Math.min(1, n / g.target) };
  }
  return { current: 0, target: g.target, frac: 0 };
}

// ---------- post-workout insights ----------
// What went well against the previous time you did each exercise, and what to aim for next session.
export function workoutInsights(s) {
  const plan = s.planId ? store.get('plans', s.planId) : null;
  const inc = unit() === 'lb' ? 5 / LB : 2.5;
  const wins = [], next = [];
  const prEx = new Set(s.exercises.filter((e) => e.sets.some((x) => x.pr)).map((e) => e.exId));
  for (const e of s.exercises) {
    const def = getEx(e.exId), work = e.sets.filter(isWorkSet);
    if (!work.length || def.tracks === 'time') continue;
    const name = def.name.replace(/\s*-\s*Medium Grip$/i, '');
    const now = bestSet(e);
    const prevSets = (lastPerformance(e.exId, s.id)?.sets || []).filter((x) => x.type !== 'warmup');
    const prev = prevSets.length ? bestSet({ sets: prevSets }) : null;
    const item = plan?.items.find((it) => it.exId === e.exId);
    if (item?.repsMax && now?.w && work.length >= item.sets && work.every((x) => (x.r || 0) >= item.repsMax)) next.push({ ex: e.exId, t: `${name}: hit ${item.repsMax} reps on every set. Go for ${fmtW(now.w + inc)}` });
    else if (item && work.length < item.sets) next.push({ ex: e.exId, t: `${name}: ${item.sets - work.length} set${item.sets - work.length > 1 ? 's' : ''} short of the plan` });
    if (!prev || !now) continue;
    const c = setChange(now, prev);
    if (c.kind === 'w' && c.v > 0 && !prEx.has(e.exId)) wins.push({ ex: e.exId, t: `${name}: +${fmtW(c.v)} on last time (${fmtW(now.w)} × ${now.r})` });
    else if (c.kind === 'r' && c.v > 0 && !prEx.has(e.exId)) wins.push({ ex: e.exId, t: `${name}: +${c.v} rep${c.v > 1 ? 's' : ''} at ${fmtW(now.w)}` });
    else if (c.kind === 'w' && c.v < 0 && !next.some((n) => n.ex === e.exId)) next.push({ ex: e.exId, t: `${name}: back up to ${fmtW(prev.w)} × ${prev.r}` });
    else if (c.kind === 'r' && c.v < 0 && !next.some((n) => n.ex === e.exId)) next.push({ ex: e.exId, t: `${name}: match ${prev.r} reps at ${fmtW(prev.w)}` });
  }
  const skipped = (plan?.items || []).filter((it) => !s.exercises.some((e) => e.exId === it.exId));
  if (skipped.length) next.push({ t: `Skipped: ${skipped.slice(0, 2).map((it) => getEx(it.exId).name).join(', ')}${skipped.length > 2 ? ` +${skipped.length - 2}` : ''}` });
  const prevSession = sessions().filter((x) => x.id !== s.id && x.startedAt < s.startedAt && (s.planId ? x.planId === s.planId : x.name === s.name)).pop();
  const v = sessionStats(s).volume, pv = prevSession ? sessionStats(prevSession).volume : 0;
  if (pv && v > pv * 1.02) wins.unshift({ t: `Volume up ${Math.round((v / pv - 1) * 100)}% on last time` });
  const wk = rangeSummary(weekStart(), addDays(weekStart(), 7)).sessions, target = store.settings.weeklyTarget || 0;
  if (target && wk === target) wins.push({ t: `Weekly target hit: ${wk}/${target} workouts` });
  if (plan && !skipped.length && plan.items.every((it) => (s.exercises.find((e) => e.exId === it.exId)?.sets.filter(isWorkSet).length || 0) >= it.sets)) wins.push({ t: 'Every planned set done' });
  return { wins: wins.slice(0, 3).map((x) => x.t), next: next.slice(0, 3).map((x) => x.t) };
}
