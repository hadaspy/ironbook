import { store, uid } from '../store.js';
import { getEx } from '../exercises.js';
import { icon, esc, sheet, toast, confirmSheet, $, $$ } from '../ui.js';
import { timer, keepAwake } from '../timer.js';
import {
  lastPerformance, fmtW, toDisplay, toKg, unit, fmtClock, fmtDuration, sessionStats, fmtVol,
  platesFor, round, sessions, pct, isWorkSet, fmtDate, dayKey, activity, lastWeight, prKind, prLabel, workoutInsights,
} from '../calc.js';
import { healthEnabled, sendToHealth } from '../health.js';
import { pickExercises, exerciseInfoSheet } from './library.js';
import { go } from '../app.js';
import { syncNow } from '../sync.js';

const num = (v) => (v === '' || v == null ? '' : String(Math.round(toDisplay(v) * 100) / 100));
const inc = () => (unit() === 'lb' ? 5 / 2.2046226218 : 2.5);

// ---------- starting ----------
// Weight preset for an exercise: the latest weight used on it, in this workout if already done here, else from history
function presetWeight(exId, item) {
  const here = (store.active?.exercises || []).filter((x) => x.exId === exId).flatMap((x) => x.sets).filter((x) => x.done && x.type !== 'warmup' && x.w);
  if (here.length) return here[here.length - 1].w;
  return lastWeight(exId, store.active?.id) ?? item?.weight ?? null;
}

function buildExercise(exId, item = null) {
  const last = lastPerformance(exId, store.active?.id);
  const n = item?.sets || last?.sets.filter((s) => s.type !== 'warmup').length || 3;
  const lastWork = last?.sets.filter((s) => s.type !== 'warmup') || [];
  const preset = presetWeight(exId, item);
  // Progressive overload hint: every work set hit the top of the rep range last time → suggest more weight
  let suggestW = null, hint = '';
  if (item && lastWork.length && item.repsMax && lastWork.every((s) => (s.r || 0) >= item.repsMax) && lastWork[0].w) {
    suggestW = Math.max(...lastWork.map((s) => s.w)) + inc();
    hint = `You hit ${item.repsMax} reps on every set last time. Ready for ${fmtW(suggestW)}?`;
  }
  const sets = Array.from({ length: n }, (_, i) => {
    const prev = lastWork[i] || lastWork[lastWork.length - 1];
    return { w: null, r: null, done: false, type: 'normal', pw: preset, pr: item ? (item.repsMin === item.repsMax ? item.repsMin : item.repsMax) : prev?.r ?? null };
  });
  return { exId, rest: item?.rest ?? store.settings.defaultRest, repsMin: item?.repsMin ?? null, repsMax: item?.repsMax ?? null, note: item?.note || '', hint, suggestW, sets };
}

// Carry a weight forward: later unticked sets (of this exercise, wherever it appears in the workout) that you
// haven't typed a weight into get it as their preset.
function carryWeight(exId, w, fromEx, fromJ) {
  if (w == null) return;
  const list = store.active.exercises, from = list.indexOf(fromEx);
  list.forEach((ex, i) => {
    if (ex.exId !== exId || i < from) return;
    ex.sets.forEach((s, j) => { if ((i > from || j > fromJ) && !s.done && s.w == null && s.type !== 'warmup') s.pw = w; });
  });
}

export function startWorkout(planId, { name } = {}) {
  if (store.active) { toast('Finish or discard the current workout first'); go('workout'); return; }
  const plan = planId ? store.get('plans', planId) : null;
  store.setActive({
    id: uid(), planId: plan?.id || null, name: name || plan?.name || 'Workout', startedAt: Date.now(), notes: '', rest: null,
    exercises: plan ? plan.items.map((it) => buildExercise(it.exId, it)) : [],
  });
  keepAwake(true);
  go('workout');
}

export function choosePlanAndStart() {
  const plans = store.all('plans').sort((a, b) => a.name.localeCompare(b.name));
  const s = sheet(`<h3 class="sheet-title">Start a workout</h3>
    <div class="list">${plans.map((p) => `<button class="row-item" data-p="${p.id}"><span class="dot-c c-${p.color || 'a'}"></span><div class="grow min0"><b>${esc(p.name)}</b><div class="muted small">${p.items.length} exercises</div></div>${icon.play}</button>`).join('')}
    <button class="row-item" data-p=""><span class="dot-c"></span><div class="grow"><b>Empty workout</b><div class="muted small">Add exercises as you go</div></div>${icon.plus}</button>
    <button class="row-item" data-log><span class="dot-c"></span><div class="grow"><b>Log a finished workout</b><div class="muted small">A run, a sport, or sets you already did</div></div>${icon.edit}</button></div>`, { tall: true });
  s.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-log]')) { s.close(); return go('log/new/' + dayKey()); }
    const b = e.target.closest('[data-p]'); if (!b) return; s.close(); startWorkout(b.dataset.p || null);
  });
}

// ---------- live screen ----------
export function render(root) {
  const a = store.active;
  if (!a) {
    root.innerHTML = `<div class="empty pad"><div class="empty-t">No workout running</div><p>Start one from Today or from a plan.</p><a class="btn" href="#today">Go to Today</a></div>`;
    return;
  }
  keepAwake(true);
  bindOnce(root);
  draw(root);

  const unsub = timer.subscribe(() => drawTimer(root));
  const clock = setInterval(() => { const el = $('#elapsed', root); if (el && store.active) el.textContent = fmtClock((Date.now() - store.active.startedAt) / 1000); }, 1000);
  return () => { unsub(); clearInterval(clock); };
}

function draw(root) {
  const a = store.active;
  const y = window.scrollY;
  root.innerHTML = `
  <header class="wk-top">
    <a href="#today" class="icon-btn" aria-label="Minimize">${icon.down}</a>
    <div class="grow center"><button class="wk-name" id="rename">${esc(a.name)}</button><div class="muted small mono" id="elapsed">${fmtClock((Date.now() - a.startedAt) / 1000)}</div></div>
    <button class="btn small" id="finish">Finish</button>
  </header>
  <section class="stack wk">
    ${a.exercises.map((ex, i) => exCard(ex, i)).join('') || '<div class="empty"><div class="empty-t">Empty workout</div><p>Add the exercises you’re doing today.</p></div>'}
    <button class="btn ghost block" id="add-ex">${icon.plus} Add exercise</button>
    <label class="lbl" for="wk-notes">Notes</label>
    <textarea id="wk-notes" rows="2" placeholder="How did it feel? Sleep, energy, anything to remember">${esc(a.notes || '')}</textarea>
    <button class="btn danger-ghost block" id="discard">Discard workout</button>
  </section>
  <div id="rest-dock"></div>`;
  window.scrollTo(0, y);
  drawTimer(root);
  bind(root);
}

function exCard(ex, i) {
  const def = getEx(ex.exId);
  const last = lastPerformance(ex.exId, store.active.id);
  const lastWork = last?.sets || [];
  const target = ex.repsMin ? `${ex.sets.length} × ${ex.repsMin}${ex.repsMax && ex.repsMax !== ex.repsMin ? '–' + ex.repsMax : ''}` : `${ex.sets.length} sets`;
  const timeBased = def.tracks === 'time';
  const allDone = ex.sets.length && ex.sets.every((s) => s.done);
  return `<article class="card ex ${allDone ? 'complete' : ''}" data-i="${i}">
    <div class="ex-h">
      <button class="ex-name" data-act="info">${esc(def.name)}</button>
      <button class="icon-btn" data-act="menu" aria-label="Exercise options">${icon.more}</button>
    </div>
    <div class="ex-sub muted small"><span>${target}</span><button class="chip" data-act="rest">${icon.timer} ${fmtClock(ex.rest)}</button>${last ? `<span>Last: ${fmtDate(new Date(last.session.startedAt), { day: 'numeric', month: 'short' })}</span>` : ''}</div>
    ${ex.hint ? `<div class="hint">${icon.up}<span class="grow">${esc(ex.hint)}</span>${ex.suggestW ? `<button class="chip on" data-act="apply-hint">Use it</button>` : ''}</div>` : ''}
    ${ex.note ? `<div class="muted small note">${icon.note} ${esc(ex.note)}</div>` : ''}
    <div class="sets">
      <span class="hd">Set</span><span class="hd">Last time</span><span class="hd">${timeBased ? 'kg' : unit()}</span><span class="hd">${timeBased ? 'sec' : 'Reps'}</span><span class="hd"></span>
      ${ex.sets.map((s, j) => {
        const prev = lastWork[j];
        const n = ex.sets.slice(0, j + 1).filter((x) => x.type !== 'warmup').length;
        return `<button class="set-n ${s.type}" data-act="type" data-j="${j}" aria-label="Set type">${s.type === 'warmup' ? 'W' : s.type === 'drop' ? 'D' : s.type === 'fail' ? 'F' : n}</button>
        <span class="prev muted" data-act="copy" data-j="${j}">${prev ? `${num(prev.w) || 0}×${prev.r}` : '–'}</span>
        <input class="in ${s.done ? 'done' : ''}" inputmode="decimal" data-f="w" data-j="${j}" value="${num(s.w)}" placeholder="${num(s.pw)}" aria-label="Weight">
        <input class="in ${s.done ? 'done' : ''}" inputmode="numeric" data-f="r" data-j="${j}" value="${s.r ?? ''}" placeholder="${s.pr ?? ''}" aria-label="Reps">
        <button class="ck ${s.done ? 'on' : ''} ${s.isPr ? 'pr' : ''}" data-act="done" data-j="${j}" aria-label="Complete set">${s.isPr ? icon.trophy : icon.check}</button>`;
      }).join('')}
    </div>
    <div class="row gap-s ex-foot"><button class="btn tiny ghost" data-act="add-set">${icon.plus} Set</button>
      ${ex.sets.length > 1 ? `<button class="btn tiny ghost" data-act="del-set">${icon.minus} Set</button>` : ''}
      <span class="grow"></span>${def.equipment === 'barbell' ? `<button class="btn tiny ghost" data-act="plates">${icon.plate} Plates</button>` : ''}</div>
  </article>`;
}

// Hand the remaining rest to a shortcut that starts the iOS Clock timer (rings even when the phone is locked)
function startClockTimer(sec) {
  if (sec < 5) return toast('Rest is almost over');
  const name = store.settings.clockShortcut || 'Ironbook Rest';
  store.flush();
  location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${sec}`;
}

function drawTimer(root) {
  const dock = $('#rest-dock', root);
  if (!dock) return;
  const r = timer.state;
  if (!r) { dock.innerHTML = ''; dock.className = ''; return; }
  const rem = timer.remaining();
  const frac = r.total ? rem / r.total : 0;
  const c = 2 * Math.PI * 22;
  if (!dock.firstChild) {
    dock.className = 'rest-dock';
    dock.innerHTML = `<div class="rd-ring"><svg viewBox="0 0 52 52" width="52" height="52"><circle cx="26" cy="26" r="22" class="ring-bg" stroke-width="5"/><circle cx="26" cy="26" r="22" class="ring-fg" id="rd-arc" stroke-width="5" stroke-dasharray="${c}" transform="rotate(-90 26 26)"/></svg></div>
      <div class="grow"><div class="eyebrow">Rest</div><div class="rd-time mono" id="rd-time"></div><div class="muted small ellipsis" id="rd-label"></div></div>
      ${store.settings.clockTimer ? `<button class="icon-btn pill" data-t="clock" aria-label="Start iPhone Clock timer">${icon.bell}</button>` : ''}<button class="icon-btn pill" data-t="-15">−15</button><button class="icon-btn pill" data-t="15">+15</button><button class="btn small" data-t="skip">Skip</button>`;
    dock.onclick = (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      if (b.dataset.t === 'clock') return startClockTimer(Math.round(timer.remaining()));
      b.dataset.t === 'skip' ? timer.stop() : timer.add(Number(b.dataset.t));
    };
  }
  $('#rd-time', dock).textContent = rem > 0 ? fmtClock(rem) : 'Go!';
  $('#rd-label', dock).textContent = r.label || '';
  $('#rd-arc', dock).style.strokeDashoffset = c * (1 - frac);
  dock.classList.toggle('over', rem <= 0);
}

function bind(root) {
  const a = store.active;
  $('#finish', root).onclick = () => finish();
  $('#discard', root).onclick = async () => {
    if (await confirmSheet('Discard this workout?', 'Nothing from this session will be saved.', { ok: 'Discard', danger: true })) {
      store.setActive(null); keepAwake(false); go('today');
    }
  };
  $('#rename', root).onclick = () => {
    const s = sheet(`<h3 class="sheet-title">Workout name</h3><input id="nm" value="${esc(a.name)}"><button class="btn block" id="ok">Save</button>`);
    $('#ok', s.el).onclick = () => { a.name = $('#nm', s.el).value.trim() || 'Workout'; store.touchActive(); s.close(); draw(root); };
  };
  $('#add-ex', root).onclick = async () => {
    const ids = await pickExercises({ multi: true });
    if (!ids.length) return;
    ids.forEach((id) => a.exercises.push(buildExercise(id)));
    store.touchActive(); draw(root);
  };
  $('#wk-notes', root).oninput = (e) => { a.notes = e.target.value; store.touchActive(); };
}

// Delegated listeners: attached once per visit to this screen (the router gives each visit a fresh container)
function bindOnce(root) {
  // set inputs: update in place (no re-render, so the keyboard stays up)
  root.addEventListener('input', (e) => {
    const a = store.active; if (!a) return;
    const inp = e.target.closest('input[data-f]'); if (!inp) return;
    const ex = a.exercises[inp.closest('.ex').dataset.i];
    const s = ex.sets[inp.dataset.j];
    const v = inp.value.replace(',', '.');
    if (inp.dataset.f === 'w') {
      s.w = v === '' ? null : toKg(v);
      if (s.w != null && s.type !== 'warmup') {
        carryWeight(ex.exId, s.w, ex, Number(inp.dataset.j));
        root.querySelectorAll('.ex').forEach((card) => {
          const e2 = a.exercises[card.dataset.i];
          card.querySelectorAll('input[data-f="w"]').forEach((el) => { const s2 = e2.sets[el.dataset.j]; if (!s2.done && s2.w == null) el.placeholder = num(s2.pw); });
        });
      }
    } else s.r = v === '' ? null : parseInt(v, 10);
    store.touchActive();
  });
  root.addEventListener('focusin', (e) => { if (e.target.matches('input.in')) setTimeout(() => e.target.select?.(), 0); });

  root.addEventListener('click', async (e) => {
    const a = store.active; if (!a) return;
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const card = btn.closest('.ex'); if (!card) return;
    const i = Number(card.dataset.i), ex = a.exercises[i], j = Number(btn.dataset.j);
    const act = btn.dataset.act;
    if (act === 'done') return toggleDone(root, ex, j, card);
    if (act === 'type') { const order = ['normal', 'warmup', 'drop', 'fail']; ex.sets[j].type = order[(order.indexOf(ex.sets[j].type) + 1) % order.length]; store.touchActive(); return draw(root); }
    if (act === 'copy') {
      const last = lastPerformance(ex.exId, a.id)?.sets[j]; if (!last) return;
      ex.sets[j].w = last.w; ex.sets[j].r = last.r; store.touchActive(); return draw(root);
    }
    if (act === 'apply-hint') { ex.sets.forEach((x) => { if (!x.done && x.type !== 'warmup') x.pw = ex.suggestW; }); ex.hint = ''; store.touchActive(); toast(`Going for ${fmtW(ex.suggestW)}`); return draw(root); }
    if (act === 'add-set') { const l = ex.sets[ex.sets.length - 1]; ex.sets.push({ w: null, r: null, done: false, type: 'normal', pw: l?.w ?? l?.pw, pr: l?.r ?? l?.pr }); store.touchActive(); return draw(root); }
    if (act === 'del-set') { const k = ex.sets.findLastIndex((s) => !s.done); ex.sets.splice(k >= 0 ? k : ex.sets.length - 1, 1); store.touchActive(); return draw(root); }
    if (act === 'info') return exerciseInfoSheet(ex.exId);
    if (act === 'rest') return restSheet(root, ex);
    if (act === 'plates') return platesSheet(ex);
    if (act === 'menu') return exMenu(root, i);
  });
}

function toggleDone(root, ex, j, card) {
  const s = ex.sets[j];
  if (!s.done) {
    if (s.w == null && s.pw != null) s.w = s.pw;
    if (s.r == null && s.pr != null) s.r = s.pr;
    if (!s.r) { toast('Enter the reps first'); return; }
    // PR check against history before this workout and the sets already ticked today
    if (s.type !== 'warmup') {
      const earlier = store.active.exercises.filter((x) => x.exId === ex.exId).flatMap((x) => x.sets).filter((x) => x !== s && x.done);
      const kind = prKind(ex.exId, s.w, s.r, store.active.startedAt, earlier);
      if (kind) {
        s.isPr = kind;
        toast(`${icon.trophy} ${prLabel(kind, ex.exId)} · ${getEx(ex.exId).tracks === 'time' ? s.r + ' s' : `${fmtW(s.w)} × ${s.r}`}`, { kind: 'pr', ms: 3000 });
      }
      carryWeight(ex.exId, s.w, ex, j);
    }
    s.done = true; s.at = Date.now();
    const isLastSetOfWorkout = store.active.exercises.every((x) => x.sets.every((y) => y.done));
    if (store.settings.autoRest && !isLastSetOfWorkout) {
      const next = ex.sets.find((x) => !x.done) ? getEx(ex.exId).name : (store.active.exercises.find((x) => x.sets.some((y) => !y.done)) ? 'Next: ' + getEx(store.active.exercises.find((x) => x.sets.some((y) => !y.done)).exId).name : '');
      timer.start(s.type === 'warmup' ? Math.min(60, ex.rest) : ex.rest, next);
    }
  } else {
    s.done = false; s.isPr = false;
  }
  store.touchActive();
  draw(root);
}

function restSheet(root, ex) {
  const opts = [30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
  const s = sheet(`<h3 class="sheet-title">Rest between sets</h3><p class="muted small">${esc(getEx(ex.exId).name)}</p>
    <div class="chips">${opts.map((o) => `<button class="chip big ${o === ex.rest ? 'on' : ''}" data-s="${o}">${fmtClock(o)}</button>`).join('')}</div>
    <button class="btn ghost block" data-s="now">${icon.timer} Start ${fmtClock(ex.rest)} timer now</button>`);
  s.el.onclick = (e) => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    if (b.dataset.s === 'now') timer.start(ex.rest, getEx(ex.exId).name);
    else { ex.rest = Number(b.dataset.s); store.touchActive(); draw(root); }
    s.close();
  };
}

function platesSheet(ex) {
  const s0 = ex.sets.find((s) => !s.done) || ex.sets[ex.sets.length - 1];
  const kg = s0?.w ?? s0?.pw ?? 60;
  const render = (w) => {
    const bar = store.settings.bar, plates = store.settings.plates;
    const { per, rest } = platesFor(w, bar, plates);
    return `<div class="bar-viz">${[...per].reverse().map((p) => `<i class="pl" style="--h:${30 + Math.min(p, 25) * 2.4}px">${p}</i>`).join('')}<span class="bar-shaft"></span>${per.map((p) => `<i class="pl" style="--h:${30 + Math.min(p, 25) * 2.4}px">${p}</i>`).join('')}</div>
      <p class="center"><b>${per.length ? per.join(' + ') : w < bar ? 'Lighter than the bar' : 'Just the bar'}</b>${per.length ? ' per side' : ''}${rest ? `<br><span class="muted small">${Math.round(rest * 100) / 100} kg can’t be made with your plates</span>` : ''}</p>`;
  };
  const s = sheet(`<h3 class="sheet-title">Plate calculator</h3>
    <div class="grid2"><label><span class="lbl">Total (kg)</span><input id="pw" inputmode="decimal" value="${Math.round(kg * 100) / 100}"></label>
      <label><span class="lbl">Bar (kg)</span><input id="pb" inputmode="decimal" value="${store.settings.bar}"></label></div>
    <div id="pv">${render(kg)}</div>
    <p class="muted small">Plates: ${store.settings.plates.join(', ')} kg. Change them in Profile → Training.</p>`);
  const upd = () => ($('#pv', s.el).innerHTML = render(Number($('#pw', s.el).value.replace(',', '.')) || 0));
  $('#pw', s.el).oninput = upd;
  $('#pb', s.el).oninput = (e) => { const v = Number(e.target.value.replace(',', '.')); if (v >= 0) { store.settings.bar = v; upd(); } };
  $('#pb', s.el).onchange = (e) => { const v = Number(e.target.value.replace(',', '.')); if (v >= 0) store.setSettings({ bar: v }); };
}

function exMenu(root, i) {
  const a = store.active, ex = a.exercises[i];
  const s = sheet(`<h3 class="sheet-title">${esc(getEx(ex.exId).name)}</h3><div class="list">
    <button class="row-item" data-m="note">${icon.note}<span class="grow">Add note</span></button>
    <button class="row-item" data-m="swap">${icon.swap}<span class="grow">Replace exercise</span></button>
    ${i > 0 ? `<button class="row-item" data-m="up">${icon.up}<span class="grow">Move up</span></button>` : ''}
    ${i < a.exercises.length - 1 ? `<button class="row-item" data-m="down">${icon.down}<span class="grow">Move down</span></button>` : ''}
    <button class="row-item danger" data-m="del">${icon.trash}<span class="grow">Remove from workout</span></button></div>`);
  s.el.onclick = async (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const m = b.dataset.m; s.close();
    if (m === 'up' || m === 'down') { const k = m === 'up' ? i - 1 : i + 1; [a.exercises[i], a.exercises[k]] = [a.exercises[k], a.exercises[i]]; }
    if (m === 'del') a.exercises.splice(i, 1);
    if (m === 'swap') { const [id] = await pickExercises({ multi: false }); if (id) { const fresh = buildExercise(id); fresh.sets = fresh.sets.slice(0, ex.sets.length); fresh.rest = ex.rest; fresh.repsMin = ex.repsMin; fresh.repsMax = ex.repsMax; a.exercises[i] = fresh; } }
    if (m === 'note') {
      const n = sheet(`<h3 class="sheet-title">Note</h3><textarea id="nt" rows="3" placeholder="Seat height 4, grip width…">${esc(ex.note)}</textarea><button class="btn block" id="ok">Save</button>`);
      $('#ok', n.el).onclick = () => { ex.note = $('#nt', n.el).value; store.touchActive(); n.close(); draw(root); };
    }
    store.touchActive(); draw(root);
  };
}

// ---------- finishing ----------
async function finish() {
  const a = store.active;
  const doneSets = a.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
  const open = a.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.done && (s.w != null || s.r != null)).length, 0);
  if (!doneSets) { toast('Tick at least one set before finishing'); return; }
  if (open && !(await confirmSheet('Finish workout?', `${open} set${open > 1 ? 's have' : ' has'} numbers but isn’t ticked. Unticked sets aren’t saved.`, { ok: 'Finish anyway' }))) return;
  const exercises = a.exercises
    .map((e) => ({ exId: e.exId, rest: e.rest, note: e.note || '', sets: e.sets.filter((s) => s.done).map(({ w, r, type, at, isPr }) => ({ w, r, done: true, type, at, ...(isPr ? { pr: isPr } : {}) })) }))
    .filter((e) => e.sets.length);
  const prs = exercises.reduce((n, e) => n + e.sets.filter((s) => s.pr).length, 0);
  const session = store.put('sessions', { id: a.id, planId: a.planId, name: a.name, startedAt: a.startedAt, endedAt: Date.now(), notes: a.notes, exercises, prs }, { silent: true });
  timer.stop();
  store.setActive(null);
  store.emit();
  keepAwake(false);
  go('session/' + session.id);
  summarySheet(session);
  syncNow({ quiet: true });
}

const PICK = (list, seed) => list[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % list.length];

function summarySheet(s) {
  const st = sessionStats(s);
  const prev = sessions().filter((x) => x.id !== s.id && x.startedAt < s.startedAt && (s.planId ? x.planId === s.planId : x.name === s.name)).pop();
  const pst = prev ? sessionStats(prev) : null;
  const vp = pst && st.volume ? pct(st.volume, pst.volume) : null;
  const prEx = s.exercises.filter((e) => e.sets.some((x) => x.pr));
  const { wins, next } = workoutInsights(s);
  const title = prEx.length ? PICK(['New PR unlocked!', 'Records were harmed', 'Stronger than ever', 'Personal best, baby'], s.id)
    : wins.length ? PICK(['Leveled up', 'Better than last time', 'Moving the needle'], s.id)
    : PICK(['Done and dusted', 'Another one in the bank', 'Showed up. That counts.', 'Sweat: deposited'], s.id);
  const confetti = prEx.length ? `<div class="confetti" aria-hidden="true">${Array.from({ length: 26 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 7) * 0.06}s;--r:${(i * 53) % 360}deg;--c:var(--${['ac', 'pr', 'c-b', 'c-d', 'c-f'][i % 5]})"></i>`).join('')}</div>` : '';
  const setTxt = (e, x) => (getEx(e.exId).tracks === 'time' ? x.r + ' s' : `${fmtW(x.w)} × ${x.r}`);
  const sh = sheet(`<div class="summary">${confetti}
    <div class="sum-head"><div class="sum-badge ${prEx.length ? 'pr' : ''}">${prEx.length ? icon.trophy : icon.check}</div>
      <div class="min0"><h3 class="sheet-title">${title}</h3><div class="muted small ellipsis">${esc(s.name)} · ${fmtDuration(st.duration)}${st.sets ? ` · ${st.sets} sets · ${fmtVol(st.volume)} ${unit()}` : ''}${vp != null ? ` · <span class="${vp >= 0.5 ? 'up' : vp <= -0.5 ? 'down' : ''}">${vp >= 0 ? '▲' : '▼'}${Math.abs(vp).toFixed(0)}%</span>` : ''}</div></div></div>
    ${prEx.length ? `<div class="sum-sec"><div class="eyebrow">${icon.trophy} New PRs</div>${prEx.map((e) => `<div class="sum-line pr"><b class="ellipsis">${esc(getEx(e.exId).name)}</b><span class="sum-pr-sets">${e.sets.filter((x) => x.pr).map((x) => `<span>${setTxt(e, x)} <i>${prLabel(x.pr, e.exId)}</i></span>`).join('')}</span></div>`).join('')}</div>` : ''}
    <div class="sum-sec"><div class="eyebrow">${icon.check} What went well</div>
      ${(wins.length ? wins : [prev ? 'You showed up and got it done. That’s the hardest part.' : 'First one logged. This is your baseline to beat.']).map((t) => `<div class="sum-line win">${esc(t)}</div>`).join('')}</div>
    <div class="sum-sec"><div class="eyebrow">${icon.up} Next session</div>
      ${(next.length ? next : ['Same plan, one more rep on your first set.']).map((t) => `<div class="sum-line nx">${esc(t)}</div>`).join('')}</div>
    <div class="row gap-s">${healthEnabled() ? `<button class="btn ghost" id="to-health" aria-label="Save to Apple Health">${icon.up} Health</button>` : ''}<button class="btn grow" data-close>${PICK(['Nice!', 'Let’s go', 'Heck yes', 'Done'], s.id + 'b')}</button></div></div>`);
  sh.el.querySelector('#to-health')?.addEventListener('click', () => { sh.close(); sendToHealth(store.get('sessions', s.id)); });
}

// ---------- past session ----------
export function renderSession(root, id) {
  const s = store.get('sessions', id);
  if (!s) { root.innerHTML = `<div class="empty pad"><div class="empty-t">Workout not found</div><a class="btn" href="#progress">Back</a></div>`; return; }
  const st = sessionStats(s);
  root.innerHTML = `<header class="top"><a href="javascript:history.back()" class="icon-btn" aria-label="Back">${icon.back}</a>
    <div class="grow"><div class="eyebrow">${fmtDate(new Date(s.startedAt), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div><h1 class="h1">${esc(s.name)}</h1></div>
    <button class="icon-btn" id="menu" aria-label="Options">${icon.more}</button></header>
  <section class="stack">
    ${st.sets || !s.activity || s.activity === 'strength' ? `<div class="grid3"><div class="card stat"><div class="eyebrow">Time</div><div class="big sm">${fmtDuration(st.duration)}</div></div>
      <div class="card stat"><div class="eyebrow">Volume</div><div class="big sm">${fmtVol(st.volume)}</div><div class="muted small">${unit()}</div></div>
      <div class="card stat"><div class="eyebrow">Sets</div><div class="big sm">${st.sets}</div></div></div>`
    : `<div class="grid3"><div class="card stat"><div class="eyebrow">Time</div><div class="big sm">${fmtDuration(st.duration)}</div></div>
      <div class="card stat"><div class="eyebrow">Distance</div><div class="big sm">${s.distanceKm ? s.distanceKm : '–'}</div><div class="muted small">km</div></div>
      <div class="card stat"><div class="eyebrow">Calories</div><div class="big sm">${s.calories || '–'}</div><div class="muted small">kcal</div></div></div>`}
    ${s.kind === 'custom' || s.effort || s.healthAt ? `<div class="act-meta pad-x">${s.kind === 'custom' ? `<span class="chip">${icon.edit} Custom log</span>` : ''}<span class="chip">${esc(activity(s.activity)[1])}</span>
      ${st.sets && s.distanceKm ? `<span class="chip">${s.distanceKm} km</span>` : ''}${st.sets && s.calories ? `<span class="chip">${s.calories} kcal</span>` : ''}
      ${s.effort ? `<span class="chip">Effort ${s.effort}/10</span>` : ''}${s.healthAt ? `<span class="chip good">${icon.check} Sent to Health</span>` : ''}</div>` : ''}
    ${s.notes ? `<div class="card muted">${icon.note} ${esc(s.notes)}</div>` : ''}
    ${s.exercises.map((e) => `<div class="card"><a class="ex-name" href="#exercise/${encodeURIComponent(e.exId)}">${esc(getEx(e.exId).name)}</a>
      <table class="tbl"><tbody>${e.sets.map((x, j) => `<tr class="${x.type}"><td class="muted">${x.type === 'warmup' ? 'W' : j + 1}</td><td><b>${fmtW(x.w)}</b> × ${x.r}</td><td class="right muted small">${x.pr ? esc(prLabel(x.pr, e.exId)) : ''}</td><td class="right">${x.pr ? `<span class="pr-t" title="${prLabel(x.pr, e.exId)}">${icon.trophy}</span>` : ''}</td></tr>`).join('')}</tbody></table>
      ${e.note ? `<div class="muted small">${esc(e.note)}</div>` : ''}</div>`).join('')}
  </section>`;
  $('#menu', root).onclick = () => {
    const m = sheet(`<h3 class="sheet-title">${esc(s.name)}</h3><div class="list">
      <button class="row-item" data-m="again">${icon.play}<span class="grow">Repeat this workout</span></button>
      <button class="row-item" data-m="edit">${icon.edit}<span class="grow">Edit workout</span></button>
      ${healthEnabled() ? `<button class="row-item" data-m="health">${icon.up}<span class="grow">${s.healthAt ? 'Send to Apple Health again' : 'Save to Apple Health'}</span></button>` : ''}
      <button class="row-item danger" data-m="del">${icon.trash}<span class="grow">Delete workout</span></button></div>`);
    m.el.onclick = async (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return; m.close();
      if (b.dataset.m === 'again') {
        if (s.planId && store.get('plans', s.planId)) return startWorkout(s.planId);
        if (store.active) return toast('Finish the current workout first');
        store.setActive({ id: uid(), planId: null, name: s.name, startedAt: Date.now(), notes: '', rest: null, exercises: s.exercises.map((e) => { const x = buildExercise(e.exId); x.rest = e.rest; return x; }) });
        go('workout');
      }
      if (b.dataset.m === 'del' && await confirmSheet('Delete this workout?', 'It will be removed from your history and charts.', { ok: 'Delete', danger: true })) { store.remove('sessions', s.id); go('progress/history'); }
      if (b.dataset.m === 'edit') go('log/' + s.id);
      if (b.dataset.m === 'health') sendToHealth(s);
    };
  };
}

export { isWorkSet, round };
