import { store } from '../store.js';
import { icon, esc, sheet, toast, confirmSheet, $ } from '../ui.js';
import { getConfig, setConfig, syncNow, syncState, onSyncChange, testConnection } from '../sync.js';
import { addSampleHistory, removeSampleHistory, setupStarter } from '../seed.js';
import { shareJson } from '../ics.js';
import { THEMES, go } from '../app.js';
import { sessions, fmtDate } from '../calc.js';

export function render(root) {
  const st = store.settings;
  const cfg = getConfig();
  const n = sessions().length;
  const hasSample = store.all('sessions').some((s) => s.sample);
  const ago = (t) => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmtDate(new Date(t)); };

  root.innerHTML = `<header class="top"><div><div class="eyebrow">Profile</div><h1 class="h1">${esc(st.name || 'You')}</h1></div></header>
  <section class="stack">
    <div class="card"><div class="eyebrow">Look</div>
      <div class="theme-pick">${THEMES.map(([k, l]) => `<button data-theme="${k}" class="tp ${k} ${k === st.theme ? 'on' : ''}"><i></i><i></i><i></i><span>${l}</span></button>`).join('')}</div></div>

    <div class="card"><div class="eyebrow">Training</div>
      <div class="set-row"><label for="s-name">Name</label><input id="s-name" class="w-auto" value="${esc(st.name)}" placeholder="Optional"></div>
      <div class="set-row"><label>Units</label><div class="seg sm" data-set="unit"><button data-v="kg" class="${st.unit === 'kg' ? 'on' : ''}">kg</button><button data-v="lb" class="${st.unit === 'lb' ? 'on' : ''}">lb</button></div></div>
      <div class="set-row"><label for="s-target">Weekly workout target</label><select id="s-target" class="w-auto">${[1, 2, 3, 4, 5, 6, 7].map((x) => `<option ${x === st.weeklyTarget ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="set-row"><label for="s-rest">Default rest</label><select id="s-rest" class="w-auto">${[30, 45, 60, 90, 120, 150, 180].map((x) => `<option value="${x}" ${x === st.defaultRest ? 'selected' : ''}>${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}</option>`).join('')}</select></div>
      <div class="set-row"><label for="s-auto">Start rest timer when a set is ticked</label><input type="checkbox" class="switch" id="s-auto" ${st.autoRest ? 'checked' : ''}></div>
      <div class="set-row"><label for="s-sound">Beep when rest is over</label><input type="checkbox" class="switch" id="s-sound" ${st.sound ? 'checked' : ''}></div>
      <div class="set-row"><label for="s-bar">Barbell weight (kg)</label><select id="s-bar" class="w-auto">${[20, 15, 10, 25].map((x) => `<option ${x === st.bar ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
    </div>

    <div class="card"><div class="row between"><div class="eyebrow">Backup &amp; sync</div><span class="sync-dot ${cfg ? syncState.status : 'off'}" id="sync-status">${cfg ? esc(syncState.message || 'Connected') : 'Off'}</span></div>
      ${cfg ? `<p class="small">Saving to the private repo <b>${esc(cfg.repo)}</b> → <code>${esc(cfg.path)}</code>.<br><span class="muted">Last synced ${ago(syncState.lastSync)}. Syncs automatically after changes, after each workout and when you open the app.</span></p>
        <div class="row gap-s"><button class="btn grow" id="sync-now">${icon.cloud} Sync now</button><button class="btn ghost" id="sync-edit">Change</button></div>`
      : `<p class="small muted">Your data is only on this phone right now. Connect a <b>private</b> GitHub repository to back it up and use the app on more than one device.</p>
        <button class="btn block" id="sync-edit">${icon.cloud} Set up GitHub backup</button>`}
    </div>

    <div class="card"><div class="row between"><div class="eyebrow">Telegram</div><input type="checkbox" class="switch" id="tg-on" aria-label="Telegram messages" ${st.tgOn ? 'checked' : ''}></div>
      <p class="small muted">Reminders, a recap after each workout, and weekly and monthly progress reports from your own Telegram bot. ${cfg ? 'The bot reads your private backup, so changes here reach it on the next sync.' : '<b>Connect the GitHub backup first</b>: the bot reads your data from it.'} One-time setup: README → <i>Telegram bot</i>.</p>
      <div class="tg-sub" id="tg-sub" ${st.tgOn ? '' : 'hidden'}>
        <div class="set-row"><label for="tg-daily">Reminder on training days</label><span class="row gap-s"><input type="time" id="tg-dt" class="w-auto" value="${esc(st.tgDailyTime)}" aria-label="Reminder time"><input type="checkbox" class="switch" id="tg-daily" ${st.tgDaily ? 'checked' : ''}></span></div>
        <div class="set-row"><label for="tg-recap">Recap after each workout</label><input type="checkbox" class="switch" id="tg-recap" ${st.tgRecap ? 'checked' : ''}></div>
        <div class="set-row"><label for="tg-weekly">Weekly report</label><span class="row gap-s"><select id="tg-wd" class="w-auto" aria-label="Report day">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => `<option value="${i}" ${i === st.tgWeeklyDay ? 'selected' : ''}>${d}</option>`).join('')}</select><input type="time" id="tg-wt" class="w-auto" value="${esc(st.tgWeeklyTime)}" aria-label="Report time"><input type="checkbox" class="switch" id="tg-weekly" ${st.tgWeekly ? 'checked' : ''}></span></div>
        <div class="set-row"><label for="tg-monthly">Monthly progress (on the 1st)</label><input type="checkbox" class="switch" id="tg-monthly" ${st.tgMonthly ? 'checked' : ''}></div>
        <p class="muted small">Time zone: ${esc(st.tz || 'unknown')}. GitHub runs the bot about once an hour, so messages can arrive up to an hour after the time you set.</p>
      </div></div>

    <div class="card"><div class="row between"><div class="eyebrow">Apple Health</div><input type="checkbox" class="switch" id="h-on" aria-label="Apple Health button" ${st.healthOn ? 'checked' : ''}></div>
      <p class="small muted">Web apps can’t talk to Health directly. Turn this on to get a <b>Save to Apple Health</b> button after each workout, which hands it to a shortcut you build once in the Shortcuts app (README → <i>Apple Health</i>).</p>
      ${st.healthOn ? `<div class="set-row"><label for="h-name">Shortcut name</label><input id="h-name" class="w-auto" value="${esc(st.healthShortcut)}" autocapitalize="off" spellcheck="false"></div>` : ''}
    </div>

    <div class="card"><div class="eyebrow">Data</div>
      <p class="small muted">${n} workout${n === 1 ? '' : 's'} · ${store.all('plans').length} workout plans · ${store.all('goals').length} goals</p>
      <div class="list flat">
        <button class="row-item" id="export">${icon.down}<span class="grow">Export backup file (.json)</span></button>
        <label class="row-item" for="import">${icon.up}<span class="grow">Import backup file</span><input type="file" id="import" accept="application/json,.json" hidden></label>
        ${hasSample ? `<button class="row-item" id="unsample">${icon.x}<span class="grow">Remove sample data</span></button>` : `<button class="row-item" id="sample">${icon.progress}<span class="grow">Load sample history (to preview charts)</span></button>`}
        <button class="row-item" id="starter">${icon.plan}<span class="grow">Pick a different starter plan</span></button>
        <button class="row-item danger" id="reset">${icon.trash}<span class="grow">Erase all data on this device</span></button>
      </div></div>

    <p class="muted small pad-x">Exercise library: <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener">free-exercise-db</a> (public domain). Your data never leaves this device except to the GitHub repo you connect.</p>
  </section>`;

  root.querySelector('.theme-pick').onclick = (e) => { const b = e.target.closest('[data-theme]'); if (b) store.setSettings({ theme: b.dataset.theme }); };
  $('#s-name', root).onchange = (e) => store.setSettings({ name: e.target.value.trim() });
  root.querySelector('[data-set="unit"]').onclick = (e) => { const b = e.target.closest('button'); if (b) store.setSettings({ unit: b.dataset.v }); };
  $('#s-target', root).onchange = (e) => store.setSettings({ weeklyTarget: Number(e.target.value) });
  $('#s-rest', root).onchange = (e) => store.setSettings({ defaultRest: Number(e.target.value) });
  $('#s-auto', root).onchange = (e) => store.setSettings({ autoRest: e.target.checked });
  $('#s-sound', root).onchange = (e) => store.setSettings({ sound: e.target.checked });
  $('#s-bar', root).onchange = (e) => store.setSettings({ bar: Number(e.target.value) });

  $('#tg-on', root).onchange = (e) => { store.setSettings({ tgOn: e.target.checked }); if (e.target.checked && !cfg) toast('Next: connect the GitHub backup above, then follow the README to create the bot.', { ms: 5000 }); };
  $('#tg-daily', root).onchange = (e) => store.setSettings({ tgDaily: e.target.checked });
  $('#tg-dt', root).onchange = (e) => e.target.value && store.setSettings({ tgDailyTime: e.target.value });
  $('#tg-recap', root).onchange = (e) => store.setSettings({ tgRecap: e.target.checked });
  $('#tg-weekly', root).onchange = (e) => store.setSettings({ tgWeekly: e.target.checked });
  $('#tg-wd', root).onchange = (e) => store.setSettings({ tgWeeklyDay: Number(e.target.value) });
  $('#tg-wt', root).onchange = (e) => e.target.value && store.setSettings({ tgWeeklyTime: e.target.value });
  $('#tg-monthly', root).onchange = (e) => store.setSettings({ tgMonthly: e.target.checked });
  $('#h-on', root).onchange = (e) => store.setSettings({ healthOn: e.target.checked });
  $('#h-name', root)?.addEventListener('change', (e) => store.setSettings({ healthShortcut: e.target.value.trim() || 'Ironbook to Health' }));

  $('#sync-edit', root).onclick = () => syncSheet();
  $('#sync-now', root)?.addEventListener('click', async () => { const ok = await syncNow(); toast(ok ? 'Synced' : esc(syncState.message), { kind: ok ? '' : 'bad', ms: ok ? 2000 : 6000 }); });
  onSyncChange(() => { const el = document.getElementById('sync-status'); if (el) { el.textContent = syncState.message; el.className = 'sync-dot ' + syncState.status; } });

  $('#export', root).onclick = async () => { try { await shareJson(store.exportData(), `workouts-${new Date().toISOString().slice(0, 10)}.json`); } catch (e) { if (e.name !== 'AbortError') toast(esc(e.message)); } };
  $('#import', root).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { store.importData(JSON.parse(await f.text())); toast('Backup merged into your data'); } catch (err) { toast(esc(err.message), { kind: 'bad' }); }
  };
  $('#sample', root)?.addEventListener('click', async () => {
    if (!(await confirmSheet('Load sample history?', 'Adds ~10 weeks of made-up workouts following your training plan, marked “sample”. You can remove them here any time.', { ok: 'Load sample' }))) return;
    const k = addSampleHistory(10); toast(`Added ${k} sample workouts`);
  });
  $('#unsample', root)?.addEventListener('click', () => { removeSampleHistory(); toast('Sample data removed'); });
  $('#starter', root).onclick = () => {
    const s = sheet(`<h3 class="sheet-title">Starter training plan</h3><p class="muted small">Adds the starter workouts (if missing) and makes this the active training plan. Your own plans and history stay.</p>
      <div class="list">${[[3, 'Full Body ×3', 'Mon · Wed · Fri'], [4, 'Upper / Lower', 'Mon · Tue · Thu · Fri'], [5, 'PPL + Upper/Lower', 'Mon–Wed, Fri, Sat'], [6, 'Push / Pull / Legs ×2', 'Mon–Sat']].map(([d, n2, t]) => `<button class="row-item" data-d="${d}"><div class="grow"><b>${n2}</b><div class="muted small">${d} days · ${t}</div></div>${icon.chev}</button>`).join('')}</div>`);
    s.el.onclick = (e) => { const b = e.target.closest('[data-d]'); if (b) { setupStarter(Number(b.dataset.d)); store.setSettings({ weeklyTarget: Number(b.dataset.d) }); s.close(); go('plan/schedule'); } };
  };
  $('#reset', root).onclick = async () => {
    if (!(await confirmSheet('Erase everything on this device?', cfg ? 'Your GitHub backup is NOT touched. Disconnect sync first if you also want a fresh start there — otherwise the next sync brings your data back.' : 'This cannot be undone. Export a backup first if unsure.', { ok: 'Erase', danger: true }))) return;
    indexedDB.deleteDatabase('ironbook'); localStorage.clear(); location.hash = ''; location.reload();
  };
}

function syncSheet() {
  const cfg = getConfig() || { repo: '', path: 'data/workouts.json', token: '' };
  const s = sheet(`<h3 class="sheet-title">GitHub backup</h3>
    <p class="small muted">Needs a <b>private</b> repository and a fine-grained token that can only touch that repo. Full steps are in the README.</p>
    <label class="lbl" for="g-repo">Repository (owner/name)</label><input id="g-repo" value="${esc(cfg.repo)}" placeholder="yourname/workout-data" autocapitalize="off" autocorrect="off" spellcheck="false">
    <label class="lbl" for="g-path">File path in the repo</label><input id="g-path" value="${esc(cfg.path)}" autocapitalize="off" spellcheck="false">
    <label class="lbl" for="g-token">Fine-grained personal access token</label><input id="g-token" type="password" value="${esc(cfg.token)}" placeholder="github_pat_…" autocapitalize="off" autocomplete="off" spellcheck="false">
    <p class="muted small">The token is stored only on this device. It is never put in the app code or the backup file.</p>
    <div id="g-msg"></div>
    <button class="btn block" id="g-save">Test &amp; connect</button>
    ${getConfig() ? '<button class="btn danger-ghost block" id="g-off">Disconnect (keeps data on this device and in GitHub)</button>' : ''}`, { tall: true });
  const el = s.el;
  $('#g-save', el).onclick = async () => {
    const next = { repo: $('#g-repo', el).value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, ''), path: $('#g-path', el).value.trim().replace(/^\//, '') || 'data/workouts.json', token: $('#g-token', el).value.trim() };
    const msg = $('#g-msg', el);
    if (!/^[\w.-]+\/[\w.-]+$/.test(next.repo)) { msg.innerHTML = `<p class="err">Enter the repository as owner/name, e.g. <code>yourname/workout-data</code>.</p>`; return; }
    if (!next.token) { msg.innerHTML = `<p class="err">Paste the token.</p>`; return; }
    msg.innerHTML = `<p class="muted small">Checking…</p>`;
    try {
      await testConnection(next);
      setConfig(next);
      const ok = await syncNow();
      if (!ok) throw new Error(syncState.message);
      s.close(); toast('Connected. Your data is backed up.'); go('me');
    } catch (e) { msg.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  $('#g-off', el)?.addEventListener('click', () => { setConfig(null); s.close(); toast('Sync turned off'); go('me'); });
}
