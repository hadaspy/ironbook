// Ironbook Telegram bot: runs as a scheduled GitHub Action inside YOUR PRIVATE data repo (see telegram.yml).
// It reads the backup file the app syncs (data/workouts.json), decides whether a message is due, sends it via
// the Telegram Bot API, and remembers what it sent in bot/state.json (committed back to the data repo).
// No server, no dependencies: plain Node 20+.
//
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (repo secrets), SEND = '' | test | today | recap | week | month,
//      DATA_FILE (default data/workouts.json), STATE_FILE (default bot/state.json), APP_DIR (checkout of the app).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT = process.env.TELEGRAM_CHAT_ID || '';
const SEND = (process.env.SEND || '').trim();
const DATA_FILE = process.env.DATA_FILE || 'data/workouts.json';
const STATE_FILE = process.env.STATE_FILE || 'bot/state.json';
const APP_DIR = process.env.APP_DIR || '.ironbook';
const NOW = process.env.NOW ? new Date(process.env.NOW) : new Date(); // NOW is for testing

// ---------- Telegram ----------
async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description || res.status}`);
  return json.result;
}
const send = (text) => (process.env.DRY_RUN ? (console.log('--- message ---\n' + text), null) : tg('sendMessage', { chat_id: CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true }));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function main() {
  if (!TOKEN && !process.env.DRY_RUN) {
    console.log('TELEGRAM_BOT_TOKEN secret is not set yet. Nothing to do. (README → Telegram bot)');
    return;
  }
  if (!CHAT && !process.env.DRY_RUN) {
    // Help the user find their chat id: list who has messaged the bot
    const ups = await tg('getUpdates', {});
    const chats = [...new Map(ups.map((u) => u.message?.chat || u.my_chat_member?.chat).filter(Boolean).map((c) => [c.id, c])).values()];
    console.log(chats.length
      ? 'TELEGRAM_CHAT_ID is not set. Chats that messaged the bot:\n' + chats.map((c) => `  ${c.id}  ${c.first_name || c.title || ''} ${c.username ? '@' + c.username : ''}`).join('\n') + '\nSave your number as the TELEGRAM_CHAT_ID secret.'
      : 'TELEGRAM_CHAT_ID is not set, and nobody has messaged the bot yet. Open your bot in Telegram, tap Start, then run this workflow again.');
    process.exitCode = 1;
    return;
  }

  if (!existsSync(DATA_FILE)) {
    if (SEND === 'test') { await send('✅ <b>Ironbook bot connected</b>\nNext: connect the GitHub backup in the app (Profile → Backup &amp; sync), then switch on Profile → Telegram.'); console.log('Sent: test (no backup yet)'); return; }
    console.log(`${DATA_FILE} not found. Connect the app's GitHub backup first.`); return;
  }
  const data = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  const st = data.settings || {};
  const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
  const before = JSON.stringify(state);

  if (!st.tgOn && !SEND) { console.log('Telegram is switched off in the app (Profile → Telegram).'); return; }

  const ctx = makeContext(data);
  const sent = [];

  if (SEND === 'test') { await send(`✅ <b>Ironbook bot connected</b>\nTime zone ${esc(ctx.tz)} · ${ctx.sessions.length} workouts in your backup.\nI’ll send what you switched on in Profile → Telegram.`); sent.push('test'); }
  if (SEND === 'today') { await send(dailyMessage(ctx, { force: true }) || `😌 Nothing planned today (${esc(ctx.today)}). Rest day.`); sent.push('today'); }
  if (SEND === 'recap') { const last = ctx.sessions[ctx.sessions.length - 1]; await send(last ? recapMessage(ctx, last) : 'No workouts logged yet.'); sent.push('recap'); }
  if (SEND === 'week') { await send(weeklyMessage(ctx)); sent.push('week'); }
  if (SEND === 'month') { await send(monthlyMessage(ctx)); sent.push('month'); }

  if (!SEND) {
    const { today, hm, dow, dom } = ctx;
    // 1) Recap of newly logged workouts (first run only remembers where we are, no backlog)
    if (state.recapSince == null) state.recapSince = Date.now();
    else {
      const fresh = ctx.sessions.filter((s) => !s.sample && (s.createdAt || s.startedAt) > state.recapSince);
      if (st.tgRecap !== false) for (const s of fresh.slice(-3)) { await send(recapMessage(ctx, s)); sent.push('recap ' + s.name); }
      if (fresh.length) state.recapSince = Math.max(...fresh.map((s) => s.createdAt || s.startedAt));
    }
    // 2) Daily reminder (once per day, any run after the chosen time, but not if it's very late)
    if (st.tgDaily !== false && state.daily !== today && hm >= (st.tgDailyTime || '07:00') && minutesBetween(st.tgDailyTime || '07:00', hm) < 360) {
      const msg = dailyMessage(ctx);
      if (msg) { await send(msg); sent.push('daily'); }
      state.daily = today;
    }
    // 3) Weekly report
    const wkKey = weekStartKey(today);
    if (st.tgWeekly !== false && dow === (st.tgWeeklyDay ?? 6) && hm >= (st.tgWeeklyTime || '20:00') && state.weekly !== wkKey) {
      await send(weeklyMessage(ctx)); sent.push('weekly'); state.weekly = wkKey;
    }
    // 4) Monthly report on the 1st
    const mKey = today.slice(0, 7);
    if (st.tgMonthly !== false && dom === 1 && hm >= (st.tgWeeklyTime || '20:00') && state.monthly !== mKey) {
      await send(monthlyMessage(ctx)); sent.push('monthly'); state.monthly = mKey;
    }
  }

  console.log(sent.length ? 'Sent: ' + sent.join(', ') : `Nothing due (local time ${ctx.today} ${ctx.hm}, ${ctx.tz}).`);
  if (JSON.stringify(state) !== before) {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 1) + '\n');
  }
}

// ---------- data + time helpers ----------
function makeContext(data) {
  const st = data.settings || {};
  const tz = st.tz || process.env.TZ_FALLBACK || 'UTC';
  const alive = (c) => Object.values(data.col?.[c] || {}).filter((r) => !r.deleted);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(NOW).map((p) => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const lib = new Map();
  try {
    for (const x of JSON.parse(readFileSync(join(APP_DIR, 'data/exercises.json'), 'utf8'))) lib.set(x.i, { name: x.n, primary: x.p || [], tracks: ['cardio', 'stretching'].includes(x.c) ? 'time' : 'weight' });
  } catch { console.log('Exercise library not found; using ids as names.'); }
  for (const c of alive('customEx')) lib.set(c.id, { name: c.name, primary: c.primary || [], tracks: c.tracks || 'weight' });
  const sessions = alive('sessions').sort((a, b) => a.startedAt - b.startedAt);
  return {
    st, tz, today, hm: `${parts.hour}:${parts.minute}`, dow: dowOf(today), dom: Number(parts.day),
    lb: st.unit === 'lb', target: st.weeklyTarget || 3,
    plans: new Map(alive('plans').map((p) => [p.id, p])),
    program: alive('programs').find((p) => p.active) || null,
    overrides: new Map(alive('overrides').map((o) => [o.id, o])),
    body: alive('body').sort((a, b) => a.date.localeCompare(b.date)),
    goals: alive('goals'),
    sessions, keyOf: (ts) => fmtKey.format(new Date(ts)),
    ex: (id) => lib.get(id) || { name: String(id).replace(/_/g, ' '), primary: [], tracks: 'weight' },
  };
}

const keyMs = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const addKey = (k, n) => new Date(keyMs(k) + n * 86400000).toISOString().slice(0, 10);
const dowOf = (k) => (new Date(keyMs(k)).getUTCDay() + 6) % 7; // 0 = Monday
const weekStartKey = (k) => addKey(k, -dowOf(k));
const minutesBetween = (a, b) => { const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number); return h2 * 60 + m2 - (h1 * 60 + m1); };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const prettyDay = (k) => new Date(keyMs(k)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function plannedFor(ctx, key) {
  const ov = ctx.overrides.get(key);
  if (ov) return ov.planId ? ctx.plans.get(ov.planId) || null : null;
  const p = ctx.program;
  if (!p?.schedule?.length) return null;
  const start = weekStartKey(p.startDate || weekStartKey(key));
  const days = Math.round((keyMs(key) - keyMs(start)) / 86400000);
  if (days < 0) return null;
  const id = p.schedule[days % p.schedule.length];
  return id ? ctx.plans.get(id) || null : null;
}

const e1rm = (w, r) => (!w || !r ? 0 : r === 1 ? w : w * (1 + Math.min(r, 12) / 30));
const isWork = (s) => s.done !== false && s.type !== 'warmup';
const W = (ctx, kg) => { if (kg == null) return '–'; const v = ctx.lb ? kg * 2.2046226218 : kg; return `${Math.round(v * 10) / 10} ${ctx.lb ? 'lb' : 'kg'}`; };
const volStr = (ctx, kg) => { const v = ctx.lb ? kg * 2.2046226218 : kg; return `${v >= 10000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v).toLocaleString('en-US')} ${ctx.lb ? 'lb' : 'kg'}`; };
const pctStr = (a, b) => { if (!b) return a ? 'new' : '='; const p = ((a - b) / b) * 100; return Math.abs(p) < 0.5 ? '=' : `${p > 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(Math.abs(p) < 10 ? 1 : 0)}%`; };
const mins = (s) => (s.endedAt && s.startedAt ? Math.round((s.endedAt - s.startedAt) / 60000) : 0);
const fmtMins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`);
const ACT = { strength: 'Strength', run: 'Run', cycle: 'Cycle', swim: 'Swim', walk: 'Walk / hike', hiit: 'HIIT', sport: 'Sport', mobility: 'Yoga / mobility', other: 'Other' };

function stats(sessions, ctx) {
  let volume = 0, sets = 0, reps = 0, minutes = 0, km = 0;
  for (const s of sessions) {
    minutes += mins(s); km += s.distanceKm || 0;
    for (const e of s.exercises || []) {
      const timed = ctx?.ex(e.exId).tracks === 'time'; // seconds, not reps
      for (const x of e.sets) if (isWork(x)) { sets++; if (!timed) { reps += x.r || 0; volume += (x.w || 0) * (x.r || 0); } }
    }
  }
  return { n: sessions.length, volume, sets, reps, minutes, km };
}
const inRange = (ctx, a, b) => ctx.sessions.filter((s) => { const k = ctx.keyOf(s.startedAt); return k >= a && k < b; });

function bestByExercise(ctx, sessions) {
  const out = new Map();
  for (const s of sessions) for (const e of s.exercises || []) for (const x of e.sets) {
    if (!isWork(x) || !x.w || !x.r || ctx.ex(e.exId).tracks === 'time') continue;
    const v = e1rm(x.w, x.r), cur = out.get(e.exId);
    if (!cur || v > cur.e1rm) out.set(e.exId, { e1rm: v, w: x.w, r: x.r });
  }
  return out;
}
function lastPerformance(ctx, exId, beforeTs) {
  for (let i = ctx.sessions.length - 1; i >= 0; i--) {
    const s = ctx.sessions[i];
    if (s.startedAt >= beforeTs) continue;
    const e = (s.exercises || []).find((x) => x.exId === exId);
    if (e?.sets.some(isWork)) return e.sets.filter(isWork);
  }
  return null;
}
function streak(ctx) {
  let ws = weekStartKey(ctx.today), n = inRange(ctx, ws, addKey(ws, 7)).length >= ctx.target ? 1 : 0;
  ws = addKey(ws, -7);
  while (inRange(ctx, ws, addKey(ws, 7)).length >= ctx.target) { n++; ws = addKey(ws, -7); }
  return n;
}

// ---------- messages ----------
// null = line left out; '' = blank separator (collapsed so there are never two in a row)
const lines2text = (lines) => lines.filter((l) => l != null).filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n').trim();

function dailyMessage(ctx, { force = false } = {}) {
  const plan = plannedFor(ctx, ctx.today);
  const doneToday = ctx.sessions.filter((s) => ctx.keyOf(s.startedAt) === ctx.today);
  if (!plan) return null;
  if (doneToday.length && !force) return null;
  const inc = ctx.lb ? 5 / 2.2046226218 : 2.5;
  const lines = plan.items.map((it) => {
    const def = ctx.ex(it.exId);
    const last = lastPerformance(ctx, it.exId, Date.now() + 1);
    const range = it.repsMin === it.repsMax ? it.repsMin : `${it.repsMin}–${it.repsMax}`;
    let tail = '';
    if (last?.length && last[0].w) {
      const top = last.reduce((a, x) => ((x.w || 0) > (a.w || 0) ? x : a), last[0]);
      tail = ` · last ${W(ctx, top.w)}×${top.r}`;
      if (it.repsMax && last.every((x) => (x.r || 0) >= it.repsMax)) tail += ` → <b>try ${W(ctx, Math.max(...last.map((x) => x.w || 0)) + inc)}</b>`;
    }
    return `• ${esc(def.name)}: ${it.sets}×${range}${tail}`;
  });
  const est = Math.round(plan.items.reduce((a, i) => a + i.sets * ((i.rest || 90) + 40), 0) / 60) + 5;
  const ws = weekStartKey(ctx.today);
  const weekDone = inRange(ctx, ws, addKey(ws, 7)).length;
  const yKey = addKey(ctx.today, -1);
  const yPlan = plannedFor(ctx, yKey);
  const missedY = yPlan && !ctx.sessions.some((s) => ctx.keyOf(s.startedAt) === yKey);
  return lines2text([
    `🏋️ <b>Today: ${esc(plan.name)}</b>`,
    `${plan.items.length} exercises · ${plan.items.reduce((a, i) => a + i.sets, 0)} sets · ~${est} min`,
    '',
    ...lines,
    '',
    `This week: ${weekDone}/${ctx.target} workouts${streak(ctx) ? ` · 🔥 ${streak(ctx)}-week streak` : ''}`,
    missedY ? `Yesterday’s ${esc(yPlan.name)} was missed. You can move it in Plan → Calendar.` : null,
    doneToday.length ? `✅ Already logged today: ${esc(doneToday.map((s) => s.name).join(', '))}` : null,
  ]);
}

function recapMessage(ctx, s) {
  const st = stats([s], ctx);
  const key = ctx.keyOf(s.startedAt);
  const prev = ctx.sessions.filter((x) => x.id !== s.id && x.startedAt < s.startedAt && (s.planId ? x.planId === s.planId : x.name === s.name)).pop();
  const lines = [`✅ <b>${esc(s.name)}</b>${key !== ctx.today ? ` · ${prettyDay(key)}` : ''}`];
  if (st.sets) {
    lines.push(`${fmtMins(st.minutes)} · ${st.sets} sets · ${st.reps} reps · ${volStr(ctx, st.volume)}`);
    if (prev) { const p = stats([prev], ctx); if (p.volume) lines.push(`Volume ${pctStr(st.volume, p.volume)} vs last time (${prettyDay(ctx.keyOf(prev.startedAt))})`); }
  } else {
    lines.push([ACT[s.activity] || 'Workout', st.minutes ? fmtMins(st.minutes) : '', s.distanceKm ? `${s.distanceKm} km` : '', s.distanceKm && st.minutes && ['run', 'walk'].includes(s.activity) ? `${pace(st.minutes, s.distanceKm)}/km` : '', s.calories ? `${s.calories} kcal` : ''].filter(Boolean).join(' · '));
  }
  if (s.effort) lines.push(`Effort ${s.effort}/10`);
  const PRL = { weight: 'heaviest ever', e1rm: 'best est. 1RM', reps: 'rep record' };
  const prs = (s.exercises || []).flatMap((e) => e.sets.filter((x) => x.pr).map((x) => `🏆 ${esc(ctx.ex(e.exId).name)}: ${ctx.ex(e.exId).tracks === 'time' ? x.r + ' s' : `${W(ctx, x.w)} × ${x.r}`} (${PRL[x.pr] || 'PR'})`));
  if (prs.length) lines.push('', `<b>New PRs</b>`, ...prs);
  const tops = (s.exercises || []).slice(0, 8).map((e) => {
    const work = e.sets.filter(isWork); if (!work.length) return null;
    const def = ctx.ex(e.exId);
    return def.tracks === 'time' ? `• ${esc(def.name)}: ${work.map((x) => x.r + 's').join(', ')}` : `• ${esc(def.name)}: ${work.map((x) => `${x.w ? (ctx.lb ? Math.round(x.w * 22.046) / 10 : Math.round(x.w * 10) / 10) : 'BW'}×${x.r}`).join(', ')}`;
  }).filter(Boolean);
  if (tops.length) lines.push('', ...tops);
  const ws = weekStartKey(ctx.today);
  lines.push('', `This week: ${inRange(ctx, ws, addKey(ws, 7)).length}/${ctx.target} workouts`);
  if (s.notes) lines.push(`📝 ${esc(s.notes)}`);
  return lines.join('\n');
}
const pace = (m, km) => { const sec = Math.round((m * 60) / km); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };

function weeklyMessage(ctx) {
  const end = addKey(ctx.today, 1), start = addKey(end, -7), pStart = addKey(start, -7);
  const now = inRange(ctx, start, end), prev = inRange(ctx, pStart, start);
  const a = stats(now, ctx), b = stats(prev, ctx);
  let planned = 0, hit = 0;
  for (let k = start; k < end; k = addKey(k, 1)) if (plannedFor(ctx, k)) { planned++; if (ctx.sessions.some((s) => ctx.keyOf(s.startedAt) === k)) hit++; }
  const bestNow = bestByExercise(ctx, now), bestPrev = bestByExercise(ctx, ctx.sessions.filter((s) => ctx.keyOf(s.startedAt) < start && ctx.keyOf(s.startedAt) >= addKey(start, -28)));
  const lifts = [...bestNow].filter(([id]) => bestPrev.has(id)).map(([id, v]) => ({ id, v, p: bestPrev.get(id), d: (v.e1rm - bestPrev.get(id).e1rm) / bestPrev.get(id).e1rm }))
    .sort((x, y) => y.d - x.d).slice(0, 5);
  const muscles = {};
  for (const s of now) for (const e of s.exercises || []) { const n = e.sets.filter(isWork).length; for (const m of ctx.ex(e.exId).primary.slice(0, 1)) muscles[m] = (muscles[m] || 0) + n; }
  const prs = now.reduce((n, s) => n + (s.prs || 0), 0);
  const next = Array.from({ length: 7 }, (_, i) => addKey(ctx.today, i + 1)).map((k) => [k, plannedFor(ctx, k)]).filter(([, p]) => p);
  const L = [
    `📊 <b>Weekly report</b> · ${prettyDay(start)} – ${prettyDay(ctx.today)}`,
    '',
    `Workouts: <b>${a.n}</b> (last week ${b.n}) · target ${ctx.target}`,
    planned ? `Plan adherence: ${hit}/${planned} planned days done` : null,
    a.sets ? `Sets ${a.sets} (${pctStr(a.sets, b.sets)}) · Volume ${volStr(ctx, a.volume)} (${pctStr(a.volume, b.volume)})` : null,
    `Time ${fmtMins(a.minutes)} (${pctStr(a.minutes, b.minutes)})${a.km ? ` · ${Math.round(a.km * 10) / 10} km` : ''}`,
    prs ? `🏆 ${prs} new PR${prs > 1 ? 's' : ''}` : null,
    streak(ctx) ? `🔥 ${streak(ctx)}-week streak` : null,
  ];
  if (lifts.length) L.push('', '<b>Strength (best set vs previous 4 weeks)</b>', ...lifts.map((l) => `${l.d > 0.004 ? '▲' : l.d < -0.004 ? '▼' : '='} ${esc(ctx.ex(l.id).name)}: ${W(ctx, l.v.w)}×${l.v.r} (est. 1RM ${pctStr(l.v.e1rm, l.p.e1rm)})`));
  const mus = Object.entries(muscles).sort((x, y) => y[1] - x[1]);
  if (mus.length) L.push('', `<b>Sets per muscle</b>: ${mus.slice(0, 6).map(([m, n]) => `${m} ${n}`).join(' · ')}`);
  if (a.n < ctx.target) L.push('', `💡 ${ctx.target - a.n} short of your weekly target. ${next.length ? `Next up: ${esc(next[0][1].name)} on ${prettyDay(next[0][0])}.` : ''}`);
  if (next.length) L.push('', '<b>Coming up</b>', ...next.map(([k, p]) => `${DOW[dowOf(k)]}: ${esc(p.name)}`));
  return lines2text(L);
}

function monthlyMessage(ctx) {
  // Report the month that just ended (or this month so far, if asked for mid-month)
  const thisM = ctx.today.slice(0, 7) + '-01';
  const ended = ctx.dom === 1 || SEND !== 'month';
  const start = ended ? monthShift(thisM, -1) : thisM, end = ended ? thisM : addKey(ctx.today, 1);
  const pStart = monthShift(start, -1);
  const now = inRange(ctx, start, end), prev = inRange(ctx, pStart, start);
  const a = stats(now, ctx), b = stats(prev, ctx);
  const label = new Date(keyMs(start)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const weeks = Math.max(1, (keyMs(end) - keyMs(start)) / (7 * 86400000));
  const bestNow = bestByExercise(ctx, now), bestPrev = bestByExercise(ctx, prev);
  const freq = {};
  for (const s of now) for (const e of s.exercises || []) freq[e.exId] = (freq[e.exId] || 0) + 1;
  const lifts = Object.entries(freq).sort((x, y) => y[1] - x[1]).map(([id]) => id).filter((id) => bestNow.has(id)).slice(0, 6);
  const L = [
    `🗓️ <b>${label}${ended ? '' : ' so far'}</b>`,
    '',
    `Workouts: <b>${a.n}</b> (${pctStr(a.n, b.n)}) · ${(a.n / weeks).toFixed(1)} per week`,
    a.sets ? `Volume ${volStr(ctx, a.volume)} (${pctStr(a.volume, b.volume)}) · ${a.sets} sets` : null,
    `Time ${fmtMins(a.minutes)}${a.km ? ` · ${Math.round(a.km * 10) / 10} km` : ''}`,
    `PRs: ${now.reduce((n, s) => n + (s.prs || 0), 0)}`,
  ];
  if (lifts.length) L.push('', '<b>Strength gain (best est. 1RM vs previous month)</b>', ...lifts.map((id) => {
    const v = bestNow.get(id), p = bestPrev.get(id);
    return `• ${esc(ctx.ex(id).name)}: ${W(ctx, v.e1rm)}${p ? ` (${pctStr(v.e1rm, p.e1rm)})` : ' (new)'}`;
  }));
  const bw = ctx.body.filter((x) => x.date < end);
  const bwStart = ctx.body.filter((x) => x.date < start).pop() || bw.find((x) => x.date >= start);
  if (bw.length && bwStart && bw[bw.length - 1] !== bwStart) { const d = bw[bw.length - 1].kg - bwStart.kg; L.push('', `⚖️ Bodyweight ${W(ctx, bw[bw.length - 1].kg)} (${d >= 0 ? '+' : ''}${W(ctx, d)})`); }
  const liftGoals = ctx.goals.filter((g) => g.type === 'lift' && g.exId);
  if (liftGoals.length) {
    const all = bestByExercise(ctx, ctx.sessions);
    L.push('', '<b>Goals</b>', ...liftGoals.map((g) => { const cur = all.get(g.exId)?.e1rm || 0; return `🎯 ${esc(ctx.ex(g.exId).name)} ${W(ctx, cur)} / ${W(ctx, g.target)} (${Math.min(100, Math.round((cur / g.target) * 100))}%)`; }));
  }
  return lines2text(L);
}
const monthShift = (k, n) => { const [y, m] = k.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 10); };

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
