import { store } from '../store.js';
import { getEx } from '../exercises.js';
import { icon, esc, empty } from '../ui.js';
import { ring } from '../charts.js';
import {
  plannedFor, sessionsOn, weekStart, addDays, dayKey, DOW, fmtDate, compareWeeks, pct, fmtVol, unit, fmtW,
  weekStreak, sessionStats, fmtDuration, goalProgress, sessions, rangeSummary, activity,
} from '../calc.js';
import { startWorkout, choosePlanAndStart } from './workout.js';

export const estMinutes = (plan) => Math.round(plan.items.reduce((a, i) => a + i.sets * ((i.rest || 90) + 40), 0) / 60) + 5;
const muscleLine = (plan) => [...new Set(plan.items.flatMap((i) => getEx(i.exId).primary.slice(0, 1)))].slice(0, 3).map((m) => m[0].toUpperCase() + m.slice(1)).join(' · ');

export function deltaChip(now, before, { suffix = '%', invert = false } = {}) {
  const p = pct(now, before);
  if (p == null || !isFinite(p)) return `<span class="chip neutral">new</span>`;
  const up = p >= 0.5, down = p <= -0.5;
  const good = invert ? down : up;
  return `<span class="chip ${up || down ? (good ? 'good' : 'bad') : 'neutral'}">${up ? '▲' : down ? '▼' : '='} ${Math.abs(p).toFixed(Math.abs(p) < 10 ? 1 : 0)}${suffix}</span>`;
}

export function render(root) {
  const now = new Date();
  const planned = plannedFor(now);
  const plan = planned.planId ? store.get('plans', planned.planId) : null;
  const doneToday = sessionsOn(now);
  const name = store.settings.name;
  const hour = now.getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  // ----- hero -----
  let hero;
  if (store.active) {
    hero = `<a class="hero" href="#workout"><div class="eyebrow on-ac">In progress</div><div class="hero-t">${esc(store.active.name)}</div>
      <div class="hero-meta"><span>${store.active.exercises.length} exercises</span><span>${store.active.exercises.reduce((a, e) => a + e.sets.filter((s) => s.done).length, 0)} sets done</span></div>
      <span class="btn on-hero">Resume workout</span></a>`;
  } else if (doneToday.length) {
    const st = doneToday.map(sessionStats).reduce((a, b) => ({ volume: a.volume + b.volume, sets: a.sets + b.sets, duration: a.duration + b.duration }));
    hero = `<div class="hero done"><div class="eyebrow on-ac">Done today ${icon.check}</div><div class="hero-t">${esc(doneToday.map((s) => s.name).join(' + '))}</div>
      <div class="hero-meta">${st.sets ? `<span>${fmtVol(st.volume)} ${unit()} lifted</span><span>${st.sets} sets</span>` : `<span>${esc([...new Set(doneToday.map((x) => activity(x.activity)[1]))].join(' + '))}</span>`}<span>${fmtDuration(st.duration)}</span></div>
      <a class="btn on-hero" href="#session/${doneToday[doneToday.length - 1].id}">See summary</a></div>`;
  } else if (plan) {
    const sets = plan.items.reduce((a, i) => a + i.sets, 0);
    hero = `<div class="hero"><div class="eyebrow on-ac">Today${planned.source === 'override' ? ' · rescheduled' : ''}</div>
      <div class="hero-t">${esc(plan.name)}</div><div class="hero-sub">${esc(muscleLine(plan))}</div>
      <div class="hero-meta"><span>${plan.items.length} exercises</span><span>${sets} sets</span><span>~${estMinutes(plan)} min</span></div>
      <button class="btn on-hero" data-start="${plan.id}">${icon.play} Start workout</button></div>`;
  } else {
    // next planned day
    let next = null;
    for (let i = 1; i <= 14 && !next; i++) { const d = addDays(now, i); const p = plannedFor(d); if (p.planId && store.get('plans', p.planId)) next = { d, plan: store.get('plans', p.planId) }; }
    hero = `<div class="hero rest"><div class="eyebrow">Rest day</div><div class="hero-t">Recover &amp; refuel</div>
      <div class="hero-sub muted">${next ? `Next: <b>${esc(next.plan.name)}</b> on ${fmtDate(next.d, { weekday: 'long' })}` : 'No training plan scheduled. Set one up in Plan → Schedule.'}</div>
      <button class="btn ghost" data-any>Start a workout anyway</button></div>`;
  }

  // ----- week strip -----
  const ws = weekStart(now);
  const strip = DOW.map((d, i) => {
    const day = addDays(ws, i);
    const done = sessionsOn(day).length > 0;
    const p = plannedFor(day);
    const isToday = dayKey(day) === dayKey(now);
    const missed = !done && p.planId && day < new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const cls = done ? 'done' : isToday ? 'today' : p.planId ? (missed ? 'missed' : 'planned') : '';
    return `<a class="wd ${cls}" href="#plan/calendar" title="${fmtDate(day)}"><span>${d[0]}</span><i>${day.getDate()}</i></a>`;
  }).join('');

  const cmp = compareWeeks(now);
  const target = store.settings.weeklyTarget || 3;
  const streak = weekStreak();
  const lifts = cmp.lifts.map((l) => ({ ...l, p: pct(l.now.e1rm, l.before.e1rm) })).sort((a, b) => b.p - a.p).slice(0, 3);
  const goals = store.all('goals').slice(0, 2);
  const recent = sessions().slice(-3).reverse();

  root.innerHTML = `
  <header class="top"><div><div class="eyebrow">${fmtDate(now, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    <h1 class="h1">${hello}${name ? ', ' + esc(name) : ''}</h1></div>
    <div class="streak" title="Weeks in a row hitting ${target} workouts">${icon.flame}<b>${streak}</b><span>wk</span></div></header>
  <section class="stack">
    ${hero}
    <div class="card"><div class="week">${strip}</div></div>
    <div class="grid2">
      <div class="card stat"><div class="row between"><div><div class="eyebrow">This week</div>
        <div class="big">${cmp.thisW.sessions}<span class="unit">/ ${target}</span></div><div class="muted small">workouts</div></div>${ring(cmp.thisW.sessions / target, 56, 7)}</div></div>
      <div class="card stat"><div class="eyebrow">Volume vs last wk</div><div class="big">${fmtVol(cmp.thisW.volume)}<span class="unit">${unit()}</span></div>
        <div class="small">${deltaChip(cmp.thisW.volume, cmp.lastToDate.volume)} <span class="muted">vs same day</span></div></div>
    </div>
    <a class="card link" href="#progress/overview">
      <div class="row between"><div class="eyebrow">This week vs last week</div>${icon.chev}</div>
      <div class="cmp">
        <div><span class="muted small">Sets</span><b>${cmp.thisW.sets}</b><span class="muted small">last wk ${cmp.lastW.sets}</span></div>
        <div><span class="muted small">Reps</span><b>${cmp.thisW.reps}</b><span class="muted small">last wk ${cmp.lastW.reps}</span></div>
        <div><span class="muted small">Time</span><b>${fmtDuration(cmp.thisW.duration)}</b><span class="muted small">last wk ${fmtDuration(cmp.lastW.duration)}</span></div>
      </div>
      ${lifts.length ? `<div class="lifts">${lifts.map((l) => `<div class="row between"><span class="ellipsis">${esc(getEx(l.exId).name)}</span><span class="row gap-s"><span class="muted small">e1RM ${fmtW(l.now.e1rm)}</span>${deltaChip(l.now.e1rm, l.before.e1rm)}</span></div>`).join('')}</div>` : ''}
    </a>
    ${goals.length ? `<a class="card link" href="#progress/goals"><div class="row between"><div class="eyebrow">Goals</div>${icon.chev}</div>
      ${goals.map((g) => { const p = goalProgress(g); return `<div class="goal-mini"><div class="row between"><span>${esc(goalTitle(g))}</span><b>${Math.round(p.frac * 100)}%</b></div><div class="bar"><i style="width:${p.frac * 100}%"></i></div></div>`; }).join('')}</a>` : ''}
    <div class="section-h"><h2>Recent</h2><a href="#progress/history" class="small">All history</a></div>
    ${recent.length ? `<div class="list">${recent.map(sessionRow).join('')}</div>` : empty('No workouts yet', 'Start today’s workout or pick any plan. Every set you log builds your progress charts.')}
  </section>`;

  root.querySelector('[data-start]')?.addEventListener('click', (e) => startWorkout(e.currentTarget.dataset.start));
  root.querySelector('[data-any]')?.addEventListener('click', () => choosePlanAndStart());
}

export function goalTitle(g) {
  if (g.title) return g.title;
  if (g.type === 'lift') return `${getEx(g.exId).name}: ${fmtW(g.target)} e1RM`;
  if (g.type === 'frequency') return `${g.target} workouts every week`;
  if (g.type === 'volume') return `${fmtVol(g.target)} ${unit()} weekly volume`;
  if (g.type === 'bodyweight') return `Bodyweight ${fmtW(g.target)}`;
  if (g.type === 'sessions') return `${g.target} workouts total`;
  return 'Goal';
}

export function sessionRow(s) {
  const st = sessionStats(s);
  const d = new Date(s.startedAt);
  return `<a class="row-item" href="#session/${s.id}"><div class="date-badge"><b>${d.getDate()}</b><span>${d.toLocaleDateString(undefined, { month: 'short' })}</span></div>
    <div class="grow min0"><div class="ellipsis"><b>${esc(s.name)}</b>${s.sample ? ' <span class="chip neutral">sample</span>' : ''}</div>
    <div class="muted small">${fmtDuration(st.duration)} · ${st.sets || !s.activity || s.activity === 'strength' ? `${st.sets} sets · ${fmtVol(st.volume)} ${unit()}` : esc(activity(s.activity)[1]) + (s.distanceKm ? ` · ${s.distanceKm} km` : '')}${s.prs ? ` · <span class="pr-t">${s.prs} PR${s.prs > 1 ? 's' : ''}</span>` : ''}</div></div>${icon.chev}</a>`;
}

export { rangeSummary };
