// Free-form workout log: record anything outside a workout plan (a run, football, yoga, or gym sets you
// pick yourself) for any past day, and edit any saved workout. Routes: #log/new/YYYY-MM-DD, #log/<sessionId>
import { store, uid } from '../store.js';
import { getEx } from '../exercises.js';
import { icon, esc, toast, confirmSheet, $ } from '../ui.js';
import { dayKey, parseDay, pad, unit, toKg, toDisplay, prKind, lastWeight, fmtDate, ACTIVITIES, activity } from '../calc.js';
import { pickExercises } from './library.js';
import { go } from '../app.js';
import { syncNow } from '../sync.js';


const DRAFT_KEY = 'ironbook-log-draft';
const num = (v) => (v == null || v === '' ? '' : String(Math.round(toDisplay(v) * 100) / 100));
// Preset weight for set j: the last weight typed above it in this log, else the latest weight used on the exercise
const presetFor = (ex, j, sessionId) => {
  for (let k = j - 1; k >= 0; k--) if (ex.sets[k].w != null && ex.sets[k].type !== 'warmup') return ex.sets[k].w;
  return lastWeight(ex.exId, sessionId);
};

function fromSession(s) {
  const d = new Date(s.startedAt);
  return {
    key: s.id, id: s.id, name: s.name, activity: s.activity || 'strength',
    date: dayKey(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    minutes: s.endedAt ? String(Math.round((s.endedAt - s.startedAt) / 60000)) : '',
    distance: s.distanceKm ?? '', calories: s.calories ?? '', effort: s.effort ?? '', notes: s.notes || '',
    exercises: (s.exercises || []).map((e) => ({ exId: e.exId, rest: e.rest, note: e.note || '', sets: e.sets.map((x) => ({ w: x.w, r: x.r, type: x.type || 'normal' })) })),
  };
}

function blank(date) {
  return { key: 'new/' + date, id: null, name: '', activity: 'strength', date, time: date === dayKey() ? `${pad(new Date().getHours())}:00` : '18:00', minutes: '60', distance: '', calories: '', effort: '', notes: '', exercises: [] };
}

function loadDraft(key) {
  try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return d && d.key === key ? d : null; } catch { return null; }
}
const saveDraft = (d) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* ignore */ } };
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };

export function render(root, arg) {
  let d;
  if (arg && arg.startsWith('new')) {
    const date = /^new\/\d{4}-\d{2}-\d{2}$/.test(arg) ? arg.slice(4) : dayKey();
    d = loadDraft('new/' + date) || blank(date);
  } else {
    const s = arg && store.get('sessions', arg);
    if (!s) { root.innerHTML = `<div class="empty pad"><div class="empty-t">Workout not found</div><a class="btn" href="#plan/calendar">Back</a></div>`; return; }
    d = loadDraft(s.id) || fromSession(s);
  }

  const draw = () => {
    const act = activity(d.activity);
    root.innerHTML = `<header class="top"><button class="icon-btn" id="lg-x" aria-label="Cancel">${icon.x}</button>
      <div class="grow"><div class="eyebrow">${d.id ? 'Edit workout' : 'Custom log'}</div><h1 class="h1">${d.id ? esc(d.name || 'Workout') : 'Log a workout'}</h1></div>
      <button class="btn small" id="lg-save">Save</button></header>
    <section class="stack log">
      <div class="card">
        <label class="lbl" for="lg-name">Name</label>
        <input id="lg-name" data-k="name" value="${esc(d.name)}" placeholder="${esc(act[0] === 'strength' ? 'e.g. Hotel gym, Arms & abs' : 'e.g. ' + act[1] + ' with friends')}">
        <label class="lbl">Type</label>
        <div class="chips" id="lg-act">${ACTIVITIES.map(([k, l]) => `<button class="chip big ${k === d.activity ? 'on' : ''}" data-act="${k}">${l}</button>`).join('')}</div>
        <div class="log-when">
          <label><span class="lbl">Date</span><input type="date" data-k="date" value="${d.date}" max="${dayKey()}"></label>
          <label><span class="lbl">Start</span><input type="time" data-k="time" value="${d.time}"></label>
          <label><span class="lbl">Minutes</span><input inputmode="numeric" data-k="minutes" value="${esc(d.minutes)}" placeholder="60"></label>
        </div>
        <div class="log-when">
          ${act[4] ? `<label><span class="lbl">Distance km</span><input inputmode="decimal" data-k="distance" value="${esc(d.distance)}" placeholder="5"></label>` : ''}
          <label><span class="lbl">Calories</span><input inputmode="numeric" data-k="calories" value="${esc(d.calories)}" placeholder="optional"></label>
          <label><span class="lbl">Effort 1–10</span><select data-k="effort"><option value="">–</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option ${String(n) === String(d.effort) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        </div>
      </div>

      ${d.exercises.length ? '' : `<p class="muted small pad-x">${act[0] === 'strength' ? 'Add the exercises you did, then fill in each set.' : 'Exercises are optional for this type. Add some if you also did sets (e.g. core work after a run).'}</p>`}
      ${d.exercises.map((ex, i) => exCard(ex, i)).join('')}
      <button class="btn ghost block" id="lg-add">${icon.plus} Add exercise</button>

      <label class="lbl" for="lg-notes">Notes</label>
      <textarea id="lg-notes" data-k="notes" rows="2" placeholder="Where, how it felt, anything to remember">${esc(d.notes)}</textarea>
      <button class="btn block" id="lg-save2">${icon.check} Save workout</button>
      ${d.id ? `<button class="btn danger-ghost block" id="lg-del">${icon.trash} Delete workout</button>` : ''}
    </section>`;
  };

  const exCard = (ex, i) => {
    const def = getEx(ex.exId);
    const timeBased = def.tracks === 'time';
    return `<article class="card ex" data-i="${i}">
      <div class="ex-h"><b class="ex-name">${esc(def.name)}</b><button class="icon-btn" data-x="rm-ex" aria-label="Remove exercise">${icon.x}</button></div>
      <div class="lsets">
        <span class="hd">Set</span><span class="hd">${timeBased ? 'kg' : unit()}</span><span class="hd">${timeBased ? 'sec' : 'Reps'}</span><span class="hd"></span>
        ${ex.sets.map((s, j) => {
          const n = ex.sets.slice(0, j + 1).filter((x) => x.type !== 'warmup').length;
          return `<button class="set-n ${s.type}" data-x="type" data-j="${j}" aria-label="Set type">${s.type === 'warmup' ? 'W' : s.type === 'drop' ? 'D' : s.type === 'fail' ? 'F' : n}</button>
          <input class="in" inputmode="decimal" data-f="w" data-j="${j}" value="${num(s.w)}" placeholder="${timeBased ? '–' : num(presetFor(ex, j, d.id)) || '0'}" aria-label="Weight">
          <input class="in" inputmode="numeric" data-f="r" data-j="${j}" value="${s.r ?? ''}" placeholder="${timeBased ? '30' : '10'}" aria-label="${timeBased ? 'Seconds' : 'Reps'}">
          <button class="icon-btn" data-x="rm-set" data-j="${j}" aria-label="Remove set">${icon.minus}</button>`;
        }).join('')}
      </div>
      <div class="row gap-s ex-foot"><button class="btn tiny ghost" data-x="add-set">${icon.plus} Set</button><span class="muted small">Tap a set number for warm-up / drop / failure</span></div>
    </article>`;
  };

  // one set of delegated listeners for this visit (the router gives each visit a fresh container)
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.k) d[t.dataset.k] = t.value;
    if (t.dataset.f) {
      const ex = d.exercises[t.closest('.ex').dataset.i];
      const s = ex.sets[t.dataset.j];
      const v = t.value.replace(',', '.');
      if (t.dataset.f === 'w') {
        s.w = v === '' ? null : toKg(v);
        if (getEx(ex.exId).tracks !== 'time') t.closest('.ex').querySelectorAll('input[data-f="w"]').forEach((el) => { const j = Number(el.dataset.j); if (ex.sets[j].w == null) el.placeholder = num(presetFor(ex, j, d.id)) || '0'; });
      } else s.r = v === '' ? null : parseInt(v, 10) || null;
    }
    saveDraft(d);
  });
  root.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT' && e.target.dataset.k) { d[e.target.dataset.k] = e.target.value; saveDraft(d); } });
  root.addEventListener('focusin', (e) => { if (e.target.matches('input.in')) setTimeout(() => e.target.select?.(), 0); });
  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    if (a) { d.activity = a.dataset.act; saveDraft(d); return draw(); }
    const b = e.target.closest('[data-x]');
    if (b) {
      const i = Number(b.closest('.ex').dataset.i), ex = d.exercises[i], j = Number(b.dataset.j);
      if (b.dataset.x === 'rm-ex') d.exercises.splice(i, 1);
      if (b.dataset.x === 'add-set') { const l = ex.sets[ex.sets.length - 1]; ex.sets.push({ w: l?.w ?? null, r: l?.r ?? null, type: 'normal' }); }
      if (b.dataset.x === 'rm-set') { ex.sets.splice(j, 1); if (!ex.sets.length) d.exercises.splice(i, 1); }
      if (b.dataset.x === 'type') { const order = ['normal', 'warmup', 'drop', 'fail']; ex.sets[j].type = order[(order.indexOf(ex.sets[j].type) + 1) % order.length]; }
      saveDraft(d); return draw();
    }
    const id = e.target.closest('button')?.id;
    if (id === 'lg-add') {
      const ids = await pickExercises({ multi: true });
      ids.forEach((exId) => d.exercises.push({ exId, rest: store.settings.defaultRest, note: '', sets: [{ w: null, r: null, type: 'normal' }, { w: null, r: null, type: 'normal' }, { w: null, r: null, type: 'normal' }] }));
      saveDraft(d); draw();
    }
    if (id === 'lg-save' || id === 'lg-save2') save();
    if (id === 'lg-x') {
      const dirty = localStorage.getItem(DRAFT_KEY);
      if (dirty && !(await confirmSheet('Discard changes?', 'What you typed here will be lost.', { ok: 'Discard', danger: true }))) return;
      clearDraft(); history.length > 1 ? history.back() : go('plan/calendar');
    }
    if (id === 'lg-del' && await confirmSheet('Delete this workout?', 'It will be removed from your history and charts.', { ok: 'Delete', danger: true })) {
      clearDraft(); store.remove('sessions', d.id); go('plan/calendar');
    }
  });

  function save() {
    if (!d.date) return toast('Pick a date');
    const [h, m] = (d.time || '18:00').split(':').map(Number);
    const start = parseDay(d.date); start.setHours(h || 0, m || 0, 0, 0);
    if (start > Date.now() + 60000) return toast('That time is in the future. Plan it in the calendar instead.');
    const minutes = Math.max(0, parseInt(d.minutes, 10) || 0);
    const exercises = d.exercises
      .map((e) => ({ exId: e.exId, rest: e.rest, note: e.note || '', sets: e.sets.map((s, j) => ({ s, j })).filter(({ s }) => s.r).map(({ s, j }) => ({ w: s.w ?? (getEx(e.exId).tracks === 'time' || s.type === 'warmup' ? null : presetFor(e, j, d.id)), r: s.r, done: true, type: s.type || 'normal' })) }))
      .filter((e) => e.sets.length);
    if (!exercises.length && !minutes) return toast(d.exercises.length ? 'Fill in the reps of at least one set' : 'Add exercises or enter how many minutes it took');
    // Mark PRs (heavier than ever, or more reps at a weight than ever) against everything logged before this workout
    let prs = 0;
    for (const e of exercises) {
      const earlier = [];
      for (const s of e.sets) {
        const kind = s.type !== 'warmup' ? prKind(e.exId, s.w, s.r, +start, [...exercises.filter((x) => x.exId === e.exId && x !== e).flatMap((x) => x.sets), ...earlier]) : null;
        if (kind) { s.pr = kind; prs++; }
        earlier.push(s);
      }
    }
    const act = activity(d.activity);
    const existing = d.id ? store.get('sessions', d.id) : null;
    const rec = store.put('sessions', {
      ...(existing || { id: uid(), planId: null, kind: 'custom' }),
      name: d.name.trim() || (act[0] === 'strength' ? 'Custom workout' : act[1]),
      activity: act[0], startedAt: +start, endedAt: +start + minutes * 60000,
      distanceKm: act[4] && d.distance !== '' ? Number(String(d.distance).replace(',', '.')) || null : null,
      calories: d.calories !== '' ? parseInt(d.calories, 10) || null : null,
      effort: d.effort ? Number(d.effort) : null,
      notes: d.notes, exercises, prs,
    });
    clearDraft();
    toast(existing ? 'Workout updated' : `Logged for ${fmtDate(start)}`);
    syncNow({ quiet: true });
    go('session/' + rec.id);
  }

  draw();
}
