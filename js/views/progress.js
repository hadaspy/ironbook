import { store } from '../store.js';
import { getEx } from '../exercises.js';
import { icon, esc, sheet, toast, segmented, empty, confirmSheet, $ } from '../ui.js';
import { lineChart, barChart, hbars, ring, sparkline } from '../charts.js';
import {
  volumeSeries, exerciseSeries, compareWeeks, pct, fmtW, fmtVol, unit, toDisplay, toKg, fmtDuration, sessions, exerciseHistory,
  goalProgress, personalBests, dayKey, fmtDate, parseDay, buckets,
} from '../calc.js';
import { deltaChip, goalTitle, sessionRow } from './today.js';
import { pickExercises } from './library.js';
import { go } from '../app.js';

const ui = { period: 'week', metric: 'e1rm', exId: null };
const disp = (kg) => +toDisplay(kg).toFixed(1);

export function render(root, arg) {
  const tab = ['overview', 'lifts', 'goals', 'body', 'history'].includes(arg) ? arg : 'overview';
  root.innerHTML = `<header class="top"><div><div class="eyebrow">Progress</div><h1 class="h1">${{ overview: 'Overview', lifts: 'Strength', goals: 'Goals', body: 'Body', history: 'History' }[tab]}</h1></div></header>
    <div class="pad-x">${segmented('prog', [['overview', 'Overview'], ['lifts', 'Strength'], ['goals', 'Goals'], ['body', 'Body'], ['history', 'History']], tab)}</div>
    <section class="stack" id="pb"></section>`;
  root.querySelector('[data-seg]').onclick = (e) => { const b = e.target.closest('button'); if (b) go('progress/' + b.dataset.v); };
  const body = $('#pb', root);
  ({ overview, lifts, goals, body: bodyTab, history })[tab](body);
}

const periodSeg = () => segmented('period', [['week', 'Weekly'], ['month', 'Monthly']], ui.period);
function wirePeriod(body, redraw) {
  body.querySelectorAll('[data-seg="period"]').forEach((s) => (s.onclick = (e) => { const b = e.target.closest('button'); if (b) { ui.period = b.dataset.v; redraw(); } }));
}

// ---------- overview ----------
function overview(body) {
  const n = ui.period === 'week' ? 12 : 12;
  const vol = volumeSeries(ui.period, n);
  const cmp = compareWeeks();
  const allMuscles = [...new Set([...Object.keys(cmp.thisW.muscles), ...Object.keys(cmp.lastW.muscles)])].sort((a, b) => (cmp.thisW.muscles[b] || 0) - (cmp.thisW.muscles[a] || 0));
  const lastVol = vol[vol.length - 1].value, prevVol = vol[vol.length - 2].value;
  const avg = vol.slice(0, -1).filter((v) => v.value).reduce((a, v, _, arr) => a + v.value / arr.length, 0);
  const row = (label, a, b, fmt = (x) => x, invert = false) => `<tr><td>${label}</td><td class="right"><b>${fmt(a)}</b></td><td class="right muted">${fmt(b)}</td><td class="right">${deltaChip(a, b, { invert })}</td></tr>`;
  const recentPrs = sessions().filter((s) => s.startedAt > Date.now() - 30 * 86400000).flatMap((s) => s.exercises.flatMap((e) => e.sets.filter((x) => x.pr).map((x) => ({ s, e, x })))).reverse().slice(0, 6);

  body.innerHTML = `
  <div class="card"><div class="row between"><div class="eyebrow">Volume lifted</div>${periodSeg()}</div>
    <div class="row gap baseline"><div class="big">${fmtVol(lastVol)}<span class="unit">${unit()}</span></div><span class="muted small">this ${ui.period}</span>${deltaChip(lastVol, prevVol)}</div>
    ${barChart(vol.map((v) => ({ label: v.label, value: disp(v.value) })), { target: avg ? disp(avg) : null })}
    <div class="muted small">Dashed line: your average of the previous ${n - 1} ${ui.period}s. ${ui.period === 'week' ? 'Current week is still in progress.' : ''}</div></div>

  <div class="card"><div class="eyebrow">This week vs last week</div>
    <table class="tbl cmp-t"><thead><tr><th></th><th class="right">This wk</th><th class="right">Last wk</th><th></th></tr></thead><tbody>
      ${row('Workouts', cmp.thisW.sessions, cmp.lastW.sessions)}
      ${row('Sets', cmp.thisW.sets, cmp.lastW.sets)}
      ${row('Reps', cmp.thisW.reps, cmp.lastW.reps)}
      ${row(`Volume (${unit()})`, cmp.thisW.volume, cmp.lastW.volume, fmtVol)}
      ${row('Time', cmp.thisW.duration, cmp.lastW.duration, fmtDuration)}
    </tbody></table>
    <p class="muted small">By this point last week you had done ${cmp.lastToDate.sessions} workout${cmp.lastToDate.sessions === 1 ? '' : 's'} and ${fmtVol(cmp.lastToDate.volume)} ${unit()}.</p></div>

  ${allMuscles.length ? `<div class="card"><div class="row between"><div class="eyebrow">Sets per muscle group</div><div class="legend"><span><i class="lg a"></i>This wk</span><span><i class="lg b"></i>Last wk</span></div></div>
    ${hbars(allMuscles.map((m) => ({ label: m, a: cmp.thisW.muscles[m], b: cmp.lastW.muscles[m] })))}
    <p class="muted small">10–20 hard sets per muscle per week is a common hypertrophy range.</p></div>` : ''}

  ${cmp.lifts.length ? `<div class="card"><div class="eyebrow">Lifts vs last week (best set, e1RM)</div><div class="list flat">
    ${cmp.lifts.map((l) => `<a class="row-item" href="#exercise/${encodeURIComponent(l.exId)}"><div class="grow min0"><div class="ellipsis b">${esc(getEx(l.exId).name)}</div>
      <div class="muted small">${fmtW(l.before.w)}×${l.before.r} → <b>${fmtW(l.now.w)}×${l.now.r}</b></div></div>${deltaChip(l.now.e1rm, l.before.e1rm)}</a>`).join('')}</div></div>` : ''}

  ${recentPrs.length ? `<div class="card"><div class="eyebrow">Personal records · last 30 days</div><div class="list flat">${recentPrs.map(({ s, e, x }) => `<a class="row-item" href="#session/${s.id}"><span class="pr-t">${icon.trophy}</span><span class="grow ellipsis">${esc(getEx(e.exId).name)}</span><span class="muted small">${fmtDate(new Date(s.startedAt), { day: 'numeric', month: 'short' })}</span><b>${fmtW(x.w)}×${x.r}</b></a>`).join('')}</div></div>` : ''}
  ${!sessions().length ? empty('Nothing to chart yet', 'Log a workout and your charts fill in here. Want a preview? Load sample data from Profile → Data.') : ''}`;
  wirePeriod(body, () => overview(body));
}

// ---------- strength ----------
function lifts(body) {
  const counts = {};
  for (const s of sessions()) for (const e of s.exercises) counts[e.exId] = (counts[e.exId] || 0) + 1;
  const ids = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  if (!ids.length) { body.innerHTML = empty('No lifts logged yet', 'Finish a workout to start tracking strength.'); return; }
  if (!ui.exId || !counts[ui.exId]) ui.exId = ids[0];
  const n = ui.period === 'week' ? 12 : 12;
  const series = exerciseSeries(ui.exId, ui.period, n, ui.metric);
  const vals = series.filter((p) => p.value != null);
  const first = vals[0]?.value, last = vals[vals.length - 1]?.value;
  const pb = personalBests(ui.exId);
  const metricLabel = { e1rm: 'Estimated 1-rep max', max: 'Heaviest set', volume: 'Volume', reps: 'Most reps' }[ui.metric];

  // gain table across all your lifts, over the selected window
  const start = buckets(ui.period, n)[0].start;
  const gains = ids.slice(0, 12).map((id) => {
    const h = exerciseHistory(id).filter((x) => x.best && x.best.e1rm > 0);
    const inWin = h.filter((x) => x.date >= start);
    const before = h.filter((x) => x.date < start).pop() || inWin[0];
    const now = inWin[inWin.length - 1];
    return { id, before, now, spark: inWin.map((x) => x.best.e1rm) };
  }).filter((g) => g.now && g.before);

  body.innerHTML = `<div class="card">
    <button class="picker-btn" id="ex-pick"><span class="grow ellipsis b">${esc(getEx(ui.exId).name)}</span>${icon.down}</button>
    <div class="row between wrap gap-s">${segmented('metric', [['e1rm', 'e1RM'], ['max', 'Max'], ['volume', 'Volume'], ['reps', 'Reps']], ui.metric)}${periodSeg()}</div>
    <div class="row gap baseline"><div class="big">${last != null ? (ui.metric === 'reps' ? last : fmtW(last, false)) : '–'}<span class="unit">${ui.metric === 'reps' ? 'reps' : unit()}</span></div>
      ${first != null && vals.length > 1 ? deltaChip(last, first) + `<span class="muted small">over ${vals.length} ${ui.period}s</span>` : ''}</div>
    <div class="muted small">${metricLabel}, best per ${ui.period}</div>
    ${lineChart(series.map((p) => ({ label: p.label, value: p.value == null ? null : ui.metric === 'reps' ? p.value : disp(p.value) })), { zeroBased: ui.metric === 'volume' })}
    <div class="grid3 tight"><div><div class="eyebrow">Best e1RM</div><b>${fmtW(pb.e1rm)}</b></div><div><div class="eyebrow">Heaviest</div><b>${fmtW(pb.maxW)}</b></div><div><div class="eyebrow">Sessions</div><b>${counts[ui.exId]}</b></div></div>
  </div>
  <div class="card"><div class="eyebrow">Strength gain · last ${n} ${ui.period}s</div>
    <p class="muted small">Change in estimated 1-rep max from the start of the window to your latest session.</p>
    <div class="list flat">${gains.map((g) => `<button class="row-item" data-ex="${esc(g.id)}"><div class="grow min0"><div class="ellipsis b">${esc(getEx(g.id).name)}</div>
      <div class="muted small">${fmtW(g.before.best.e1rm)} → <b>${fmtW(g.now.best.e1rm)}</b></div></div>${sparkline(g.spark, { w: 70, h: 28 })}${deltaChip(g.now.best.e1rm, g.before.best.e1rm)}</button>`).join('')}</div>
    <p class="muted small">e1RM uses the Epley formula: weight × (1 + reps ÷ 30). It lets sets of different rep counts be compared.</p></div>`;
  wirePeriod(body, () => lifts(body));
  body.querySelector('[data-seg="metric"]').onclick = (e) => { const b = e.target.closest('button'); if (b) { ui.metric = b.dataset.v; lifts(body); } };
  $('#ex-pick', body).onclick = () => {
    const s = sheet(`<h3 class="sheet-title">Choose a lift</h3><div class="list">${ids.map((id) => `<button class="row-item" data-ex="${esc(id)}"><span class="grow">${esc(getEx(id).name)}</span><span class="muted small">${counts[id]}×</span></button>`).join('')}</div>`, { tall: true });
    s.el.onclick = (e) => { const b = e.target.closest('[data-ex]'); if (b) { ui.exId = b.dataset.ex; s.close(); lifts(body); } };
  };
  body.querySelector('.list.flat').onclick = (e) => { const b = e.target.closest('[data-ex]'); if (b) { ui.exId = b.dataset.ex; lifts(body); window.scrollTo({ top: 0, behavior: 'smooth' }); } };
}

// ---------- goals ----------
function goals(body) {
  const list = store.all('goals').sort((a, b) => a.createdAt - b.createdAt);
  body.innerHTML = `${list.length ? list.map((g) => {
    const p = goalProgress(g);
    const done = p.frac >= 1;
    const cur = g.type === 'frequency' || g.type === 'sessions' ? p.current : g.type === 'volume' ? fmtVol(p.current) + ' ' + unit() : fmtW(p.current);
    const daysLeft = g.deadline ? Math.ceil((parseDay(g.deadline) - new Date()) / 86400000) : null;
    return `<div class="card goal ${done ? 'done' : ''}"><div class="row gap">${ring(p.frac, 58, 7)}<div class="grow min0">
      <div class="b">${esc(goalTitle(g))}</div><div class="muted small">Now: <b>${cur}</b>${g.type === 'frequency' || g.type === 'volume' ? ' this week' : ''}${daysLeft != null ? ` · ${daysLeft >= 0 ? daysLeft + ' days left' : 'deadline passed'}` : ''}</div>
      ${done ? `<span class="chip good">${icon.check} Achieved</span>` : ''}</div>
      <button class="icon-btn" data-del="${g.id}" aria-label="Delete goal">${icon.trash}</button></div></div>`;
  }).join('') : empty('No goals yet', 'Goals keep you honest: a lift target, how often you train, weekly volume or bodyweight.')}
  <button class="btn block" id="add-goal">${icon.target} Add a goal</button>`;
  $('#add-goal', body).onclick = () => goalSheet();
  body.onclick = async (e) => {
    const d = e.target.closest('[data-del]');
    if (d && await confirmSheet('Delete this goal?', '', { ok: 'Delete', danger: true })) store.remove('goals', d.dataset.del);
  };
}

function goalSheet() {
  let type = 'lift', exId = null;
  const s = sheet(`<h3 class="sheet-title">New goal</h3>
    <div class="seg" id="gt"><button data-v="lift" class="on">Lift</button><button data-v="frequency">Frequency</button><button data-v="volume">Volume</button><button data-v="bodyweight">Body</button></div>
    <div id="gf"></div>
    <label class="lbl" for="gd">Deadline (optional)</label><input type="date" id="gd">
    <button class="btn block" id="ok">Save goal</button>`, { tall: true });
  const el = s.el;
  const fields = () => {
    const f = $('#gf', el);
    if (type === 'lift') f.innerHTML = `<label class="lbl">Exercise</label><button class="picker-btn" id="gx"><span class="grow ellipsis">${exId ? esc(getEx(exId).name) : 'Choose exercise'}</span>${icon.down}</button>
      <label class="lbl" for="gv">Target estimated 1-rep max (${unit()})</label><input id="gv" inputmode="decimal" placeholder="${unit() === 'kg' ? '100' : '225'}">
      ${exId ? `<p class="muted small">Current best: ${fmtW(personalBests(exId).e1rm)}</p>` : ''}`;
    if (type === 'frequency') f.innerHTML = `<label class="lbl" for="gv">Workouts per week</label><input id="gv" inputmode="numeric" value="${store.settings.weeklyTarget}">`;
    if (type === 'volume') f.innerHTML = `<label class="lbl" for="gv">Weekly volume (${unit()})</label><input id="gv" inputmode="decimal" placeholder="15000">`;
    if (type === 'bodyweight') f.innerHTML = `<label class="lbl" for="gv">Target bodyweight (${unit()})</label><input id="gv" inputmode="decimal">`;
    $('#gx', el)?.addEventListener('click', async () => { const [id] = await pickExercises({ multi: false }); if (id) { exId = id; fields(); } });
  };
  fields();
  $('#gt', el).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; type = b.dataset.v; $('#gt', el).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); fields(); };
  $('#ok', el).onclick = () => {
    const raw = Number(($('#gv', el)?.value || '').replace(',', '.'));
    if (!raw) return toast('Enter a target');
    if (type === 'lift' && !exId) return toast('Choose an exercise');
    const target = type === 'frequency' ? raw : toKg(raw);
    const g = { type, target, exId, deadline: $('#gd', el).value || null };
    if (type === 'lift') g.startValue = personalBests(exId).e1rm;
    if (type === 'bodyweight') { const b = store.all('body').sort((a, c) => a.date.localeCompare(c.date)).pop(); g.startValue = b?.kg ?? null; }
    if (type === 'frequency') store.setSettings({ weeklyTarget: raw });
    store.put('goals', g); s.close(); toast('Goal added');
  };
}

// ---------- body ----------
function bodyTab(body) {
  const list = store.all('body').sort((a, b) => a.date.localeCompare(b.date));
  const series = buckets(ui.period, 12).map((b) => {
    const inB = list.filter((x) => x.date >= dayKey(b.start) && x.date < dayKey(b.end));
    return { label: b.label, value: inB.length ? disp(inB.reduce((a, x) => a + x.kg, 0) / inB.length) : null };
  });
  const last = list[list.length - 1];
  const monthAgo = list.filter((x) => x.date <= dayKey(new Date(Date.now() - 28 * 86400000))).pop();
  body.innerHTML = `<div class="card"><div class="eyebrow">Log bodyweight</div>
    <div class="row gap"><input id="bw" inputmode="decimal" placeholder="${last ? fmtW(last.kg, false) : unit() === 'kg' ? '75.0' : '165'}"><input type="date" id="bd" class="w-auto" value="${dayKey()}"><button class="btn" id="bw-save">Save</button></div></div>
    ${list.length ? `<div class="card"><div class="row between"><div class="eyebrow">Bodyweight</div>${periodSeg()}</div>
      <div class="row gap baseline"><div class="big">${fmtW(last.kg, false)}<span class="unit">${unit()}</span></div>${monthAgo ? `<span class="muted small">${(toDisplay(last.kg - monthAgo.kg) >= 0 ? '+' : '') + toDisplay(last.kg - monthAgo.kg).toFixed(1)} ${unit()} vs 4 weeks ago</span>` : ''}</div>
      ${lineChart(series)}<div class="muted small">Average per ${ui.period}</div></div>
      <div class="card"><div class="eyebrow">Entries</div><table class="tbl"><tbody>${list.slice(-10).reverse().map((x) => `<tr><td>${fmtDate(parseDay(x.date), { weekday: 'short', day: 'numeric', month: 'short' })}</td><td class="right"><b>${fmtW(x.kg)}</b></td><td class="right"><button class="icon-btn" data-del="${x.id}" aria-label="Delete">${icon.x}</button></td></tr>`).join('')}</tbody></table></div>`
    : empty('No entries yet', 'Weigh in under the same conditions (e.g. morning, before eating) for a useful trend.')}`;
  wirePeriod(body, () => bodyTab(body));
  $('#bw-save', body).onclick = () => {
    const v = toKg(Number($('#bw', body).value.replace(',', '.')));
    if (!v) return toast('Enter your weight');
    const date = $('#bd', body).value || dayKey();
    store.put('body', { id: 'bw-' + date, date, kg: v }); toast('Saved');
  };
  body.onclick = (e) => { const d = e.target.closest('[data-del]'); if (d) store.remove('body', d.dataset.del); };
}

// ---------- history ----------
function history(body) {
  const all = sessions().reverse();
  if (!all.length) { body.innerHTML = empty('No workouts yet', 'Your finished workouts show up here.'); return; }
  const groups = {};
  for (const s of all) { const k = new Date(s.startedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); (groups[k] ||= []).push(s); }
  body.innerHTML = Object.entries(groups).map(([k, list]) => `<div class="section-h"><h2>${k}</h2><span class="muted small">${list.length} workouts</span></div><div class="list">${list.map(sessionRow).join('')}</div>`).join('');
}
