import { store } from '../store.js';
import { getEx } from '../exercises.js';
import { icon, esc, sheet, toast, confirmSheet, segmented, empty, $ } from '../ui.js';
import {
  plannedFor, sessionsOn, dayKey, addDays, weekStart, DOW, fmtDate, fmtClock, activeProgram, parseDay, sessionStats, fmtVol, unit, fmtW, toKg, toDisplay,
} from '../calc.js';
import { startWorkout } from './workout.js';
import { pickExercises } from './library.js';
import { estMinutes, sessionRow } from './today.js';
import { go } from '../app.js';
import { shareIcs } from '../ics.js';

const COLORS = ['a', 'b', 'c', 'd', 'e', 'f'];
let monthOffset = 0;

export function render(root, arg) {
  const tab = ['calendar', 'schedule', 'workouts'].includes(arg) ? arg : 'calendar';
  root.innerHTML = `<header class="top"><div><div class="eyebrow">Plan</div><h1 class="h1">${tab === 'calendar' ? 'Calendar' : tab === 'schedule' ? 'Training plan' : 'Workout plans'}</h1></div></header>
    <div class="pad-x">${segmented('plan', [['calendar', 'Calendar'], ['schedule', 'Schedule'], ['workouts', 'Workouts']], tab)}</div>
    <section class="stack" id="pbody"></section>`;
  root.querySelector('[data-seg]').onclick = (e) => { const b = e.target.closest('button'); if (b) go('plan/' + b.dataset.v); };
  const body = $('#pbody', root);
  if (tab === 'calendar') calendar(body);
  if (tab === 'schedule') schedule(body);
  if (tab === 'workouts') workouts(body);
}

// ---------- calendar ----------
function calendar(body) {
  const t = new Date();
  const first = new Date(t.getFullYear(), t.getMonth() + monthOffset, 1);
  const gridStart = weekStart(first);
  const todayK = dayKey(t);
  let cells = '';
  let monthSessions = 0, monthPlanned = 0;
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    if (i >= 35 && d.getMonth() !== first.getMonth()) break;
    const inMonth = d.getMonth() === first.getMonth();
    const done = sessionsOn(d);
    const p = plannedFor(d);
    const plan = p.planId ? store.get('plans', p.planId) : null;
    const past = dayKey(d) < todayK;
    if (inMonth && done.length) monthSessions++;
    if (inMonth && plan) monthPlanned++;
    const state = done.length ? 'done' : plan ? (past ? 'missed' : 'planned') : p.source === 'skip' ? 'skip' : '';
    cells += `<button class="cal-d ${inMonth ? '' : 'out'} ${dayKey(d) === todayK ? 'today' : ''} ${state}" data-d="${dayKey(d)}">
      <span class="n">${d.getDate()}</span>${plan || done.length ? `<span class="lbl-s c-${(done.length ? store.get('plans', done[0].planId)?.color : plan?.color) || 'a'}">${esc((done[0]?.name || plan?.name || '').slice(0, 7))}</span>` : ''}
    </button>`;
  }
  body.innerHTML = `<div class="card">
    <div class="row between cal-nav"><button class="icon-btn" data-m="-1" aria-label="Previous month">${icon.back}</button>
      <b>${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b>
      <button class="icon-btn" data-m="1" aria-label="Next month">${icon.chev}</button></div>
    <div class="cal">${DOW.map((d) => `<span class="cal-h">${d[0]}</span>`).join('')}${cells}</div>
    <div class="legend"><span><i class="lg done"></i>Done</span><span><i class="lg planned"></i>Planned</span><span><i class="lg missed"></i>Missed</span>${monthOffset ? '<button class="chip" data-m="0">Today</button>' : ''}</div>
  </div>
  <div class="grid2"><div class="card stat"><div class="eyebrow">Workouts this month</div><div class="big">${monthSessions}</div></div>
    <div class="card stat"><div class="eyebrow">Planned</div><div class="big">${monthPlanned}</div></div></div>
  <p class="muted small pad-x">Tap a day to see what you did, start its workout, move it, mark it as rest, or log a custom workout.</p>`;
  body.onclick = (e) => {
    const m = e.target.closest('[data-m]');
    if (m) { monthOffset = m.dataset.m === '0' ? 0 : monthOffset + Number(m.dataset.m); return calendar(body); }
    const d = e.target.closest('[data-d]');
    if (d) daySheet(parseDay(d.dataset.d), () => calendar(body));
  };
}

function daySheet(date, refresh) {
  const k = dayKey(date);
  const done = sessionsOn(date);
  const p = plannedFor(date);
  const plan = p.planId ? store.get('plans', p.planId) : null;
  const plans = store.all('plans').sort((a, b) => a.name.localeCompare(b.name));
  const isFuture = k >= dayKey(new Date());
  const s = sheet(`<h3 class="sheet-title">${fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
    ${done.length ? `<div class="list">${done.map(sessionRow).join('')}</div>` : ''}
    ${plan ? `<div class="card flat"><div class="eyebrow">${p.source === 'override' ? 'Rescheduled' : 'Planned'}</div><b>${esc(plan.name)}</b>
      <div class="muted small">${plan.items.map((i) => esc(getEx(i.exId).name)).join(' · ')}</div></div>` : !done.length ? `<p class="muted">${p.source === 'skip' ? 'Marked as rest day.' : 'Nothing planned.'}</p>` : ''}
    ${k === dayKey(new Date()) && plan && !done.length ? `<button class="btn block" data-a="start">${icon.play} Start ${esc(plan.name)}</button>` : ''}
    ${isFuture || !done.length ? `<label class="lbl" for="ov">Change this day only</label>
      <select id="ov"><option value="">${p.source === 'program' || p.source === 'none' ? 'Keep training plan' : 'Back to training plan'}</option><option value="__rest">Rest day</option>
      ${plans.map((x) => `<option value="${x.id}" ${p.source === 'override' && x.id === p.planId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      ${plan && isFuture ? `<button class="btn ghost block" data-a="move">${icon.swap} Move ${esc(plan.name)} to another day</button>` : ''}` : ''}
    ${k <= dayKey(new Date()) ? `<button class="btn ${done.length || plan ? 'ghost' : ''} block" data-a="custom">${icon.edit} Log a custom workout${done.length ? ' (another one)' : ''}</button>
      <p class="muted small center">Anything outside your plans: a run, a sport, or exercises you pick yourself.</p>` : ''}
    ${!done.length && !isFuture ? `<button class="btn ghost block" data-a="log">${icon.plus} Log one of your workout plans for this day</button>` : ''}`, { onClose: refresh });
  $('#ov', s.el)?.addEventListener('change', (e) => {
    const v = e.target.value;
    if (!v) { if (store.get('overrides', k)) store.remove('overrides', k); }
    else store.put('overrides', { id: k, planId: v === '__rest' ? null : v });
    toast('Schedule updated'); s.close();
  });
  s.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'start') { s.close(); startWorkout(plan.id); }
    if (b.dataset.a === 'move') {
      s.close();
      const days = Array.from({ length: 14 }, (_, i) => addDays(new Date(), i)).filter((d) => dayKey(d) !== k);
      const m = sheet(`<h3 class="sheet-title">Move ${esc(plan.name)} to…</h3><div class="chips">${days.map((d) => { const pp = plannedFor(d); return `<button class="chip big" data-to="${dayKey(d)}">${fmtDate(d)}${pp.planId ? ' · ' + esc(store.get('plans', pp.planId)?.name || '') : ''}</button>`; }).join('')}</div>`, { onClose: refresh });
      m.el.onclick = (ev) => {
        const t = ev.target.closest('[data-to]'); if (!t) return;
        store.put('overrides', { id: k, planId: null }, { silent: true });
        store.put('overrides', { id: t.dataset.to, planId: plan.id });
        toast(`Moved to ${fmtDate(parseDay(t.dataset.to))}`); m.close();
      };
    }
    if (b.dataset.a === 'log') { s.close(); logPast(date); }
    if (b.dataset.a === 'custom') { s.close(); go('log/new/' + k); }
  });
}

// Log a workout after the fact (e.g. forgot the phone): opens the live screen, then back-dates it on finish.
function logPast(date) {
  if (store.active) return toast('Finish the current workout first');
  const plans = store.all('plans');
  const s = sheet(`<h3 class="sheet-title">Log for ${fmtDate(date)}</h3><div class="list">${plans.map((p) => `<button class="row-item" data-p="${p.id}"><span class="grow">${esc(p.name)}</span>${icon.chev}</button>`).join('')}</div>`);
  s.el.onclick = (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return; s.close();
    startWorkout(b.dataset.p);
    const t = new Date(date); t.setHours(18, 0, 0, 0);
    store.active.startedAt = +t; store.touchActive();
    toast('Logging a past workout. Tick the sets you did, then Finish.');
  };
}

// ---------- schedule / training plan ----------
function schedule(body) {
  const progs = store.all('programs').sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || a.name.localeCompare(b.name));
  const p = activeProgram();
  const plans = store.all('plans').sort((a, b) => a.name.localeCompare(b.name));
  if (!p) {
    body.innerHTML = empty('No training plan yet', 'A training plan decides which workout happens on which day. It repeats every week (or every 2–4 weeks).',
      `<button class="btn" data-a="new">${icon.plus} Create training plan</button>`) + programList(progs);
  } else {
    const weeks = p.schedule.length / 7;
    const today = plannedFor(new Date());
    body.innerHTML = `<div class="card">
      <div class="row between"><div class="min0"><div class="eyebrow">Active training plan</div><button class="h2 link-btn" data-a="rename">${esc(p.name)} ${icon.edit}</button></div>
        <select id="weeks" aria-label="Cycle length" class="w-auto">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === weeks ? 'selected' : ''}>${n === 1 ? 'Every week' : `${n}-week cycle`}</option>`).join('')}</select></div>
      ${Array.from({ length: weeks }, (_, w) => `${weeks > 1 ? `<div class="eyebrow wk-l">Week ${w + 1}${today.week === w + 1 ? ' · this week' : ''}</div>` : ''}
        <div class="sched">${DOW.map((d, i) => { const idx = w * 7 + i; const id = p.schedule[idx]; const pl = id && store.get('plans', id);
          return `<label class="sched-row ${pl ? 'c-' + (pl.color || 'a') : 'rest'}"><span class="sd">${d}</span>
          <select data-idx="${idx}"><option value="">Rest</option>${plans.map((x) => `<option value="${x.id}" ${x.id === id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>`; }).join('')}</div>`).join('')}
      <div class="row gap-s wrap"><label class="lbl inline" for="start">Cycle starts week of</label><input type="date" id="start" class="w-auto" value="${p.startDate}"></div>
    </div>
    <div class="card"><div class="row gap">${icon.bell}<div class="grow"><b>Reminders on your iPhone</b><div class="muted small">Adds your workout days to the Calendar app with an alert. Re-export after changing the plan.</div></div></div>
      <div class="row gap-s wrap"><label class="lbl inline" for="rt">Time</label><input type="time" id="rt" class="w-auto" value="${store.settings.reminderTime}">
      <select id="al" class="w-auto"><option value="0">Alert at start</option><option value="15">15 min before</option><option value="30" selected>30 min before</option><option value="60">1 h before</option></select></div>
      <button class="btn ghost block" data-a="ics">${icon.plan} Export to Calendar</button></div>
    ${programList(progs)}
    <button class="btn ghost block" data-a="new">${icon.plus} New training plan</button>`;
    body.querySelectorAll('select[data-idx]').forEach((sel) => sel.onchange = () => { p.schedule[Number(sel.dataset.idx)] = sel.value || null; store.put('programs', p); });
    $('#weeks', body).onchange = (e) => {
      const n = Number(e.target.value), cur = p.schedule.length / 7;
      if (n > cur) for (let w = cur; w < n; w++) p.schedule.push(...p.schedule.slice(0, 7));
      else p.schedule = p.schedule.slice(0, n * 7);
      store.put('programs', p);
    };
    $('#start', body).onchange = (e) => { if (e.target.value) { p.startDate = dayKey(weekStart(parseDay(e.target.value))); store.put('programs', p); } };
    $('#rt', body).onchange = (e) => store.setSettings({ reminderTime: e.target.value });
  }
  body.onclick = async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'new') {
      const n = sheet(`<h3 class="sheet-title">New training plan</h3><label class="lbl" for="pn">Name</label><input id="pn" placeholder="e.g. Summer cut, 5-day split"><button class="btn block" id="ok">Create</button>`);
      $('#ok', n.el).onclick = () => {
        store.all('programs').forEach((x) => x.active && store.put('programs', { ...x, active: false }, { silent: true }));
        store.put('programs', { name: $('#pn', n.el).value.trim() || 'My training plan', active: true, startDate: dayKey(weekStart()), schedule: Array(7).fill(null) });
        n.close();
      };
    }
    if (a === 'rename') {
      const p2 = activeProgram();
      const n = sheet(`<h3 class="sheet-title">Rename</h3><input id="pn" value="${esc(p2.name)}"><button class="btn block" id="ok">Save</button>`);
      $('#ok', n.el).onclick = () => { store.put('programs', { ...p2, name: $('#pn', n.el).value.trim() || p2.name }); n.close(); };
    }
    if (a === 'activate') {
      store.all('programs').forEach((x) => store.put('programs', { ...x, active: x.id === b.dataset.id }, { silent: true }));
      store.emit(); toast('Training plan switched');
    }
    if (a === 'del-prog' && await confirmSheet('Delete this training plan?', 'Your workout plans and history stay.', { ok: 'Delete', danger: true })) store.remove('programs', b.dataset.id);
    if (a === 'ics') {
      try { await shareIcs({ alarmMin: Number($('#al', body).value) }); }
      catch (err) { if (err.name !== 'AbortError') toast(esc(err.message)); }
    }
  };
}

function programList(progs) {
  const others = progs.filter((p) => !p.active);
  if (!others.length) return '';
  return `<div class="section-h"><h2>Other training plans</h2></div><div class="list">${others.map((p) => `<div class="row-item"><div class="grow min0"><b>${esc(p.name)}</b>
    <div class="muted small">${p.schedule.filter(Boolean).length} workouts per ${p.schedule.length / 7 > 1 ? p.schedule.length / 7 + ' weeks' : 'week'}</div></div>
    <button class="btn tiny ghost" data-a="activate" data-id="${p.id}">Use</button><button class="icon-btn" data-a="del-prog" data-id="${p.id}" aria-label="Delete">${icon.trash}</button></div>`).join('')}</div>`;
}

// ---------- workout plans ----------
function workouts(body) {
  const plans = store.all('plans').sort((a, b) => a.name.localeCompare(b.name));
  const p = activeProgram();
  const usedIn = (id) => (p?.schedule || []).map((x, i) => (x === id ? DOW[i % 7] : null)).filter(Boolean);
  body.innerHTML = `${plans.length ? `<div class="plans">${plans.map((pl) => {
    const days = usedIn(pl.id);
    return `<div class="card plan-card c-${pl.color || 'a'}"><a href="#plan-edit/${pl.id}" class="plan-main">
      <div class="row between"><b class="h3">${esc(pl.name)}</b>${icon.chev}</div>
      <div class="muted small">${pl.items.length} exercises · ${pl.items.reduce((a, i) => a + i.sets, 0)} sets · ~${estMinutes(pl)} min${days.length ? ' · ' + days.join(', ') : ''}</div>
      <div class="ex-chips">${pl.items.slice(0, 5).map((i) => `<span>${esc(getEx(i.exId).name)}</span>`).join('')}${pl.items.length > 5 ? `<span>+${pl.items.length - 5}</span>` : ''}</div></a>
      <button class="btn small" data-start="${pl.id}">${icon.play} Start</button></div>`;
  }).join('')}</div>` : empty('No workout plans', 'A workout plan is a list of exercises with sets, reps and rest — e.g. “Push day”.')}
  <button class="btn block" data-a="new">${icon.plus} New workout plan</button>`;
  body.onclick = (e) => {
    const s = e.target.closest('[data-start]');
    if (s) return startWorkout(s.dataset.start);
    if (e.target.closest('[data-a="new"]')) {
      const pl = store.put('plans', { name: 'New workout', color: COLORS[plans.length % COLORS.length], items: [] }, { silent: true });
      go('plan-edit/' + pl.id);
    }
  };
}

// ---------- plan editor ----------
export function renderEditor(root, id) {
  const pl = store.get('plans', id);
  if (!pl) { root.innerHTML = `<div class="empty pad"><div class="empty-t">Plan not found</div><a class="btn" href="#plan/workouts">Back</a></div>`; return; }
  const save = () => store.put('plans', pl, { silent: true }) && store.save();
  const draw = () => {
    root.innerHTML = `<header class="top"><a href="#plan/workouts" class="icon-btn" aria-label="Back">${icon.back}</a>
      <div class="grow"><div class="eyebrow">Workout plan</div><input class="title-in" id="nm" value="${esc(pl.name)}" aria-label="Plan name"></div>
      <button class="icon-btn" id="del" aria-label="Delete plan">${icon.trash}</button></header>
    <section class="stack">
      <div class="row gap-s colors">${COLORS.map((c) => `<button class="swatch c-${c} ${pl.color === c ? 'on' : ''}" data-c="${c}" aria-label="Color ${c}"></button>`).join('')}
        <span class="grow"></span><span class="muted small">~${estMinutes(pl)} min</span></div>
      ${pl.items.map((it, i) => {
        const ex = getEx(it.exId);
        return `<div class="card item" data-i="${i}">
          <div class="row between"><b class="ellipsis">${esc(ex.name)}</b><span class="row">
            <button class="icon-btn" data-a="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon.up}</button>
            <button class="icon-btn" data-a="down" ${i === pl.items.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon.down}</button>
            <button class="icon-btn" data-a="rm" aria-label="Remove">${icon.x}</button></span></div>
          <div class="muted small">${ex.primary.join(', ')} · ${ex.equipment}</div>
          <div class="fields">
            <label><span>Sets</span><input inputmode="numeric" data-f="sets" value="${it.sets}"></label>
            <label><span>Reps</span><input inputmode="numeric" data-f="repsMin" value="${it.repsMin}"></label>
            <label><span>to</span><input inputmode="numeric" data-f="repsMax" value="${it.repsMax}"></label>
            <label><span>Rest</span><select data-f="rest">${[30, 45, 60, 75, 90, 120, 150, 180, 240, 300].map((s) => `<option value="${s}" ${s === it.rest ? 'selected' : ''}>${fmtClock(s)}</option>`).join('')}</select></label>
            <label><span>Start ${unit()}</span><input inputmode="decimal" data-f="weight" value="${it.weight != null ? Math.round(toDisplay(it.weight) * 10) / 10 : ''}" placeholder="auto"></label>
          </div>
        </div>`;
      }).join('') || empty('No exercises yet', 'Add exercises from the library of 870+ movements.')}
      <button class="btn ghost block" id="add">${icon.plus} Add exercises</button>
      <button class="btn block" id="start">${icon.play} Start this workout</button>
      <p class="muted small pad-x">“Start ${unit()}” is only used the first time. After that, the app pre-fills what you lifted last time and suggests adding weight once you hit the top of the rep range on every set.</p>
    </section>`;
    $('#nm', root).oninput = (e) => { pl.name = e.target.value || 'Untitled'; save(); };
    root.querySelector('.colors').onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) { pl.color = b.dataset.c; save(); draw(); } };
    root.querySelectorAll('.item').forEach((card) => {
      const it = pl.items[card.dataset.i];
      card.addEventListener('change', (e) => {
        const f = e.target.dataset.f; if (!f) return;
        const v = e.target.value;
        if (f === 'weight') it.weight = v === '' ? null : toKg(v.replace(',', '.'));
        else it[f] = Math.max(f === 'rest' ? 0 : 1, parseInt(v, 10) || 1);
        if (it.repsMax < it.repsMin) it.repsMax = it.repsMin;
        save(); if (f !== 'weight') draw();
      });
      card.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        const i = Number(card.dataset.i);
        if (b.dataset.a === 'rm') pl.items.splice(i, 1);
        if (b.dataset.a === 'up') [pl.items[i - 1], pl.items[i]] = [pl.items[i], pl.items[i - 1]];
        if (b.dataset.a === 'down') [pl.items[i + 1], pl.items[i]] = [pl.items[i], pl.items[i + 1]];
        save(); draw();
      });
    });
    $('#add', root).onclick = async () => {
      const ids = await pickExercises({ multi: true });
      ids.forEach((exId) => { const ex = getEx(exId); const compound = ex.mechanic === 'compound'; pl.items.push({ exId, sets: 3, repsMin: compound ? 6 : 10, repsMax: compound ? 10 : 15, rest: compound ? 120 : 60, weight: null, note: '' }); });
      save(); draw();
    };
    $('#start', root).onclick = () => { if (!pl.items.length) return toast('Add at least one exercise'); store.emit(); startWorkout(pl.id); };
    $('#del', root).onclick = async () => {
      if (await confirmSheet(`Delete “${pl.name}”?`, 'Past workouts stay in your history.', { ok: 'Delete', danger: true })) { store.remove('plans', pl.id); go('plan/workouts'); }
    };
  };
  draw();
  return () => store.emit(); // let other screens refresh with the edits
}
