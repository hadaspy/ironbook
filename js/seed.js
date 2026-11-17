// Starter workout plans + training programs created on first run, and an optional sample history.
import { store, uid } from './store.js';
import { dayKey, weekStart, addDays, plannedFor } from './calc.js';

const it = (exId, sets, reps, rest) => {
  const [a, b] = String(reps).split('-').map(Number);
  return { exId, sets, repsMin: a, repsMax: b || a, rest, weight: null, note: '' };
};
const BENCH = 'Barbell_Bench_Press_-_Medium_Grip';

export const TEMPLATES = {
  fbA: { name: 'Full Body A', color: 'a', items: [it('Barbell_Squat', 3, 5, 180), it(BENCH, 3, 5, 180), it('Bent_Over_Barbell_Row', 3, 8, 120), it('Side_Lateral_Raise', 3, 12, 60), it('Hanging_Leg_Raise', 3, 12, 60)] },
  fbB: { name: 'Full Body B', color: 'b', items: [it('Barbell_Deadlift', 3, 5, 180), it('Standing_Military_Press', 3, 6, 150), it('Pullups', 3, 8, 120), it('Leg_Press', 3, 10, 120), it('Barbell_Curl', 2, 12, 60)] },
  fbC: { name: 'Full Body C', color: 'c', items: [it('Front_Squat_Clean_Grip', 3, 6, 150), it('Incline_Dumbbell_Press', 3, 10, 120), it('Seated_Cable_Rows', 3, 10, 90), it('Romanian_Deadlift', 3, 10, 120), it('Triceps_Pushdown', 2, 12, 60)] },
  push: { name: 'Push', color: 'a', items: [it(BENCH, 4, '6-8', 150), it('Incline_Dumbbell_Press', 3, '8-10', 120), it('Seated_Dumbbell_Press', 3, '8-10', 90), it('Side_Lateral_Raise', 3, '12-15', 60), it('Triceps_Pushdown_-_Rope_Attachment', 3, '10-12', 60)] },
  pull: { name: 'Pull', color: 'b', items: [it('Barbell_Deadlift', 3, 5, 180), it('Pullups', 3, '6-10', 120), it('Seated_Cable_Rows', 3, '10-12', 90), it('Face_Pull', 3, 15, 60), it('Hammer_Curls', 3, '10-12', 60)] },
  legs: { name: 'Legs', color: 'c', items: [it('Barbell_Squat', 4, '6-8', 180), it('Romanian_Deadlift', 3, '8-10', 120), it('Leg_Press', 3, '10-12', 120), it('Lying_Leg_Curls', 3, '10-12', 60), it('Standing_Calf_Raises', 4, '12-15', 60)] },
  upper: { name: 'Upper', color: 'd', items: [it(BENCH, 4, '5-8', 150), it('Bent_Over_Barbell_Row', 4, '6-10', 120), it('Standing_Military_Press', 3, 8, 120), it('Wide-Grip_Lat_Pulldown', 3, '10-12', 90), it('Barbell_Curl', 2, 12, 60), it('EZ-Bar_Skullcrusher', 2, 12, 60)] },
  lower: { name: 'Lower', color: 'e', items: [it('Barbell_Squat', 4, '5-8', 180), it('Romanian_Deadlift', 3, 8, 120), it('Split_Squat_with_Dumbbells', 3, 10, 90), it('Leg_Extensions', 3, '12-15', 60), it('Standing_Calf_Raises', 4, 15, 60)] },
};

// Mon..Sun
export const PROGRAMS = {
  3: { name: 'Full Body ×3', week: ['fbA', null, 'fbB', null, 'fbC', null, null] },
  4: { name: 'Upper / Lower', week: ['upper', 'lower', null, 'upper', 'lower', null, null] },
  5: { name: 'PPL + Upper/Lower', week: ['push', 'pull', 'legs', null, 'upper', 'lower', null] },
  6: { name: 'Push / Pull / Legs ×2', week: ['push', 'pull', 'legs', 'push', 'pull', 'legs', null] },
};

export function setupStarter(daysPerWeek) {
  const ids = {};
  const prog = PROGRAMS[daysPerWeek] || PROGRAMS[4];
  // Create every template once so all are available to mix and match later
  for (const [key, t] of Object.entries(TEMPLATES)) {
    const existing = store.all('plans').find((p) => p.templateKey === key);
    ids[key] = existing ? existing.id : store.put('plans', { ...structuredClone(t), templateKey: key }, { silent: true }).id;
  }
  store.all('programs').forEach((p) => { if (p.active) store.put('programs', { ...p, active: false }, { silent: true }); });
  store.put('programs', {
    name: prog.name, active: true, startDate: dayKey(weekStart()),
    schedule: prog.week.map((k) => (k ? ids[k] : null)),
  }, { silent: true });
  store.emit();
}

// ---------- sample history (clearly flagged, removable from Profile) ----------
const BASE = {
  [BENCH]: 70, Incline_Dumbbell_Press: 24, Seated_Dumbbell_Press: 20, Side_Lateral_Raise: 9, 'Triceps_Pushdown_-_Rope_Attachment': 25,
  Triceps_Pushdown: 27, Barbell_Deadlift: 120, Pullups: 0, Seated_Cable_Rows: 55, Face_Pull: 20, Hammer_Curls: 14, Barbell_Squat: 95,
  Romanian_Deadlift: 80, Leg_Press: 160, Lying_Leg_Curls: 40, Standing_Calf_Raises: 60, Bent_Over_Barbell_Row: 65,
  Standing_Military_Press: 45, 'Wide-Grip_Lat_Pulldown': 55, Barbell_Curl: 30, 'EZ-Bar_Skullcrusher': 27.5, Split_Squat_with_Dumbbells: 18,
  Leg_Extensions: 50, Hanging_Leg_Raise: 0, Front_Squat_Clean_Grip: 70,
};

export function addSampleHistory(weeks = 10) {
  const start = addDays(weekStart(), -7 * weeks);
  // Pretend the active training plan has been running for the whole sample period (same rotation phase)
  const prog = store.all('programs').find((p) => p.active);
  if (prog && prog.startDate > dayKey(start)) {
    const cycle = prog.schedule.length / 7;
    let s = new Date(prog.startDate + 'T00:00');
    while (s > start) s = addDays(s, -7 * cycle);
    store.put('programs', { ...prog, startDate: dayKey(s) }, { silent: true });
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let n = 0;
  for (let d = new Date(start); d < today; d = addDays(d, 1)) {
    const { planId } = plannedFor(d);
    if (!planId || Math.random() < 0.12) continue; // the odd missed day
    const plan = store.get('plans', planId);
    if (!plan) continue;
    const wk = Math.floor((d - start) / (7 * 86400000));
    const t0 = new Date(d); t0.setHours(18, 10 + Math.floor(Math.random() * 30));
    let t = +t0;
    const exercises = plan.items.map((item) => {
      const base = BASE[item.exId] ?? 20;
      const w = base ? Math.round((base * (1 + wk * 0.018) + (Math.random() - 0.4) * 2) / 2.5) * 2.5 : 0;
      const sets = Array.from({ length: item.sets }, (_, i) => {
        t += (item.rest + 40) * 1000;
        const r = Math.max(item.repsMin, item.repsMax - i - (Math.random() < 0.3 ? 1 : 0));
        return { w, r, done: true, type: 'normal', at: t };
      });
      return { exId: item.exId, rest: item.rest, sets };
    });
    store.put('sessions', { planId, name: plan.name, startedAt: +t0, endedAt: t + 60000, notes: '', exercises, sample: true }, { silent: true });
    n++;
  }
  // bodyweight trend
  for (let i = weeks * 7; i >= 0; i -= 3) {
    const d = addDays(today, -i);
    store.put('body', { id: 'sample-' + dayKey(d), date: dayKey(d), kg: Math.round((78.5 - (weeks * 7 - i) * 0.02 + (Math.random() - 0.5) * 0.6) * 10) / 10, sample: true }, { silent: true });
  }
  store.emit();
  return n;
}

export function removeSampleHistory() {
  for (const c of ['sessions', 'body']) for (const r of store.all(c)) if (r.sample) store.remove(c, r.id);
}

export const newSessionId = uid;
