import { store } from './store.js';
import { loadLibrary, reindex } from './exercises.js';
import { icon, esc, $, sheet } from './ui.js';
import { startAutoSync } from './sync.js';
import { unlockAudio, timer } from './timer.js';
import { setupStarter } from './seed.js';
import { fmtClock } from './calc.js';
import * as today from './views/today.js';
import * as plan from './views/plan.js';
import * as library from './views/library.js';
import * as progress from './views/progress.js';
import * as profile from './views/profile.js';
import * as workout from './views/workout.js';

// route name → [module, render function name, tab]
const ROUTES = {
  today: [today, 'render', 'today'],
  plan: [plan, 'render', 'plan'],
  'plan-edit': [plan, 'renderEditor', 'plan'],
  exercises: [library, 'render', 'exercises'],
  exercise: [library, 'renderDetail', 'exercises'],
  progress: [progress, 'render', 'progress'],
  me: [profile, 'render', 'me'],
  workout: [workout, 'render', null],
  session: [workout, 'renderSession', 'progress'],
};
const TABS = [['today', 'Today', icon.today], ['plan', 'Plan', icon.plan], ['exercises', 'Exercises', icon.lib], ['progress', 'Progress', icon.progress], ['me', 'Profile', icon.me]];

let view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
let current = null;

export function go(hash) { if (location.hash !== '#' + hash) location.hash = hash; else route(); }
export function parseRoute() {
  const [name, ...rest] = (location.hash.slice(1) || 'today').split('/');
  return { name: ROUTES[name] ? name : 'today', arg: rest.length ? decodeURIComponent(rest.join('/')) : null };
}

function route({ keepScroll = false } = {}) {
  const r = parseRoute();
  const [mod, fn, tab] = ROUTES[r.name];
  const scroll = keepScroll ? window.scrollY : 0;
  current?.cleanup?.();
  current = { name: r.name, arg: r.arg, cleanup: null };
  // fresh container each render so no event listeners leak between screens
  const fresh = view.cloneNode(false);
  view.replaceWith(fresh);
  view = fresh;
  const out = mod[fn](view, r.arg);
  if (typeof out === 'function') current.cleanup = out;
  document.body.dataset.route = r.name;
  tabbar.hidden = r.name === 'workout';
  tabbar.innerHTML = TABS.map(([k, l, ic]) => `<a href="#${k}" class="${k === tab ? 'on' : ''}" aria-label="${l}">${ic}<span>${l}</span></a>`).join('');
  renderBanner();
  if (!keepScroll) window.scrollTo(0, 0); else window.scrollTo(0, scroll);
}

// Re-render the current screen when data changes (the live workout screen manages itself)
let pending = false;
store.subscribe(() => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    reindex();
    applyTheme();
    if (current && current.name !== 'workout' && !document.querySelector('.sheet-wrap')) route({ keepScroll: true });
    else renderBanner();
  });
});

// "Workout in progress" pill above the tab bar
function renderBanner() {
  let b = document.getElementById('live-banner');
  const a = store.active;
  if (!a || current?.name === 'workout') { b?.remove(); return; }
  if (!b) {
    b = document.createElement('a'); b.id = 'live-banner'; b.href = '#workout';
    document.body.appendChild(b);
  }
  const rest = timer.state ? ` · rest ${fmtClock(timer.remaining())}` : '';
  b.innerHTML = `<span class="pulse"></span><b>${esc(a.name)}</b><span class="muted">${fmtClock((Date.now() - a.startedAt) / 1000)}${rest}</span><span class="grow"></span>Resume ${icon.chev}`;
}
setInterval(() => store.active && current?.name !== 'workout' && renderBanner(), 1000);

export function applyTheme() {
  const t = store.settings.theme || 'ember';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('ironbook-theme', t); } catch { /* ignore */ }
  const color = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color || '#16130F');
}

// ---------- first run ----------
function onboarding() {
  let days = 4, unit = 'kg', theme = store.settings.theme || 'ember';
  const s = sheet(`
    <h3 class="sheet-title">Set up your training</h3>
    <p class="muted">You can change everything later. This picks a starter plan you can edit.</p>
    <label class="lbl">Workouts per week</label>
    <div class="seg" id="ob-days">${[3, 4, 5, 6].map((d) => `<button data-v="${d}" class="${d === days ? 'on' : ''}">${d}</button>`).join('')}</div>
    <p class="muted small" id="ob-desc"></p>
    <label class="lbl">Units</label>
    <div class="seg" id="ob-unit"><button data-v="kg" class="on">kg</button><button data-v="lb">lb</button></div>
    <label class="lbl">Look</label>
    <div class="theme-pick" id="ob-theme">${THEMES.map(([k, l]) => `<button data-v="${k}" class="tp ${k} ${k === theme ? 'on' : ''}"><i></i><i></i><i></i><span>${l}</span></button>`).join('')}</div>
    <button class="btn block" id="ob-go">Start training</button>
    <button class="btn ghost block" id="ob-skip">Skip — I’ll build my own plans</button>`, { tall: true });
  const desc = { 3: 'Full Body A / B / C on Mon, Wed, Fri', 4: 'Upper / Lower on Mon, Tue, Thu, Fri', 5: 'Push, Pull, Legs + Upper, Lower', 6: 'Push / Pull / Legs twice a week' };
  const el = s.el;
  const upd = () => ($('#ob-desc', el).textContent = desc[days]);
  upd();
  const segs = (id, cb) => $(id, el).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $(id, el).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); cb(b.dataset.v);
  });
  segs('#ob-days', (v) => { days = Number(v); upd(); });
  segs('#ob-unit', (v) => (unit = v));
  segs('#ob-theme', (v) => { theme = v; document.documentElement.dataset.theme = v; });
  $('#ob-go', el).onclick = () => { setupStarter(days); store.setSettings({ unit, theme, onboarded: true, weeklyTarget: days }); s.close(); go('today'); };
  $('#ob-skip', el).onclick = () => { store.setSettings({ unit, theme, onboarded: true }); s.close(); };
}
export const THEMES = [['ember', 'Ember Forge'], ['glacier', 'Glacier Track'], ['plum', 'Plum Pulse']];

// ---------- boot ----------
async function boot() {
  await store.load();
  applyTheme();
  try { await loadLibrary(); } catch (e) { console.error(e); }
  window.addEventListener('hashchange', () => route());
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
  route();
  if (store.active?.rest) timer.loop();
  if (!store.settings.onboarded) onboarding();
  startAutoSync();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  document.documentElement.classList.toggle('standalone', matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
}
boot();
