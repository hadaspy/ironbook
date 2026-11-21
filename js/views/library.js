import { store } from '../store.js';
import { searchExercises, getEx, MUSCLES, EQUIPMENT, CATEGORIES, reindex } from '../exercises.js';
import { icon, esc, sheet, toast, cap, confirmSheet, $, $$ } from '../ui.js';
import { usedCounts, exerciseHistory, personalBests, exerciseSeries, fmtW, fmtDate, unit, fmtVol } from '../calc.js';
import { lineChart } from '../charts.js';
import { go } from '../app.js';

const filters = { q: '', muscle: '', equipment: '', category: '' };
const PAGE = 60;

function thumb(ex) {
  return ex.images[0] ? `<img loading="lazy" src="${ex.images[0]}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'thumb-ph',textContent:'${esc(ex.name[0])}'}))">` : `<span class="thumb-ph">${esc(ex.name[0])}</span>`;
}

function filterBar(f) {
  const sel = (key, list, label) => `<select data-k="${key}" class="${f[key] ? 'on' : ''}" aria-label="${label}"><option value="">${label}</option>${list.map((x) => `<option value="${x}" ${f[x] === x || f[key] === x ? 'selected' : ''}>${cap(x)}</option>`).join('')}</select>`;
  return `<div class="searchbar">${icon.search}<input type="search" id="q" placeholder="Search 870+ exercises" value="${esc(f.q)}" autocomplete="off"></div>
    <div class="filters">${sel('muscle', MUSCLES, 'Muscle')}${sel('equipment', EQUIPMENT, 'Equipment')}${sel('category', CATEGORIES, 'Type')}</div>
    <div class="muscle-chips">${['chest', 'shoulders', 'lats', 'quadriceps', 'hamstrings', 'glutes', 'biceps', 'triceps', 'abdominals', 'calves'].map((m) => `<button class="chip ${f.muscle === m ? 'on' : ''}" data-m="${m}">${cap(m)}</button>`).join('')}</div>`;
}

function listHtml(list, { selectable = false, selected = new Set(), limit = PAGE } = {}) {
  const counts = usedCounts();
  return list.slice(0, limit).map((ex) => `<${selectable ? 'button' : 'a'} class="ex-row ${selected.has(ex.id) ? 'sel' : ''}" ${selectable ? `data-id="${esc(ex.id)}"` : `href="#exercise/${encodeURIComponent(ex.id)}"`}>
    <span class="thumb">${thumb(ex)}</span>
    <span class="grow min0"><span class="ellipsis b">${esc(ex.name)}</span><span class="muted small ellipsis">${cap(ex.primary[0] || ex.category)} · ${cap(ex.equipment)}${counts[ex.id] >= 1 ? ` · <span class="accent-t">done ${Math.floor(counts[ex.id])}×</span>` : ''}${ex.custom ? ' · custom' : ''}</span></span>
    ${selectable ? `<span class="ck-c">${icon.check}</span>` : icon.chev}</${selectable ? 'button' : 'a'}>`).join('')
    + (list.length > limit ? `<button class="btn ghost block" data-more>Show more (${list.length - limit} left)</button>` : '')
    + (!list.length ? `<div class="empty"><div class="empty-t">No matches</div><p>Try fewer words, clear a filter, or add it as a custom exercise.</p></div>` : '');
}

function wireFilters(container, f, refresh) {
  const q = $('#q', container);
  q.oninput = () => { f.q = q.value; refresh(); };
  container.querySelectorAll('select[data-k]').forEach((s) => (s.onchange = () => { f[s.dataset.k] = s.value; s.classList.toggle('on', !!s.value); syncChips(); refresh(); }));
  const syncChips = () => container.querySelectorAll('[data-m]').forEach((c) => c.classList.toggle('on', c.dataset.m === f.muscle));
  container.querySelector('.muscle-chips').onclick = (e) => {
    const c = e.target.closest('[data-m]'); if (!c) return;
    f.muscle = f.muscle === c.dataset.m ? '' : c.dataset.m;
    container.querySelector('select[data-k="muscle"]').value = f.muscle;
    container.querySelector('select[data-k="muscle"]').classList.toggle('on', !!f.muscle);
    syncChips(); refresh();
  };
}

export function render(root) {
  root.innerHTML = `<header class="top"><div><div class="eyebrow">Library</div><h1 class="h1">Exercises</h1></div>
    <button class="btn small ghost" id="custom">${icon.plus} Custom</button></header>
    <section class="stack"><div id="fb">${filterBar(filters)}</div><div class="ex-list" id="list"></div></section>`;
  let limit = PAGE;
  const refresh = () => {
    const list = searchExercises(filters.q, { ...filters, usedCounts: usedCounts() });
    $('#list', root).innerHTML = `<div class="muted small pad-x">${list.length} exercises</div>` + listHtml(list, { limit });
  };
  wireFilters(root, filters, () => { limit = PAGE; refresh(); });
  $('#list', root).onclick = (e) => { if (e.target.closest('[data-more]')) { limit += PAGE * 2; refresh(); } };
  $('#custom', root).onclick = () => customSheet();
  refresh();
}

// ---------- detail ----------
export function renderDetail(root, id) {
  const ex = getEx(id);
  const hist = exerciseHistory(id);
  const pb = personalBests(id);
  const series = exerciseSeries(id, 'week', 12, 'max').map((p) => ({ label: p.label, value: p.value == null ? null : +toUnit(p.value).toFixed(1) }));
  root.innerHTML = `<header class="top"><a href="javascript:history.back()" class="icon-btn" aria-label="Back">${icon.back}</a>
    <div class="grow min0"><div class="eyebrow">${cap(ex.category)} · ${cap(ex.level || '')}</div><h1 class="h1 sm">${esc(ex.name)}</h1></div>
    ${ex.custom ? `<button class="icon-btn" id="edit" aria-label="Edit">${icon.edit}</button>` : ''}</header>
  <section class="stack">
    ${ex.images.length ? `<div class="demo">${ex.images.map((src, i) => `<img src="${src}" alt="${esc(ex.name)} position ${i + 1}" class="${i === 0 ? 'on' : ''}">`).join('')}</div>` : ''}
    <div class="chips">${ex.primary.map((m) => `<span class="chip on">${cap(m)}</span>`).join('')}${ex.secondary.map((m) => `<span class="chip">${cap(m)}</span>`).join('')}<span class="chip">${cap(ex.equipment)}</span>${ex.mechanic ? `<span class="chip">${cap(ex.mechanic)}</span>` : ''}</div>
    ${hist.length ? `<div class="grid3">
      <div class="card stat"><div class="eyebrow">Most reps</div><div class="big sm">${pb.maxReps}</div><div class="muted small">in a set</div></div>
      <div class="card stat"><div class="eyebrow">Heaviest</div><div class="big sm">${fmtW(pb.maxW, false)}</div><div class="muted small">${unit()}</div></div>
      <div class="card stat"><div class="eyebrow">Sessions</div><div class="big sm">${hist.length}</div><div class="muted small">logged</div></div></div>
      <div class="card"><div class="eyebrow">Heaviest weight · 12 weeks</div>${lineChart(series, { unit: '' })}</div>
      <div class="card"><div class="eyebrow">Recent</div><table class="tbl"><tbody>${hist.slice(-6).reverse().map((h) => `<tr><td class="muted small">${fmtDate(h.date, { day: 'numeric', month: 'short' })}</td><td>${h.sets.map((s) => `${fmtW(s.w, false)}×${s.r}`).join(', ')}</td><td class="right small muted">${fmtVol(h.volume)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${ex.steps.length ? `<div class="card"><div class="eyebrow">How to</div><ol class="steps">${ex.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
    ${ex.notes ? `<div class="card"><div class="eyebrow">Notes</div><p>${esc(ex.notes)}</p></div>` : ''}
  </section>`;
  // animate between start and end position like a flipbook
  const imgs = $$('.demo img', root);
  let k = 0;
  const iv = imgs.length > 1 ? setInterval(() => { imgs[k].classList.remove('on'); k = (k + 1) % imgs.length; imgs[k].classList.add('on'); }, 1100) : null;
  $('#edit', root)?.addEventListener('click', () => customSheet(store.get('customEx', id)));
  return () => clearInterval(iv);
}
const toUnit = (kg) => (unit() === 'lb' ? kg * 2.2046226218 : kg);

export function exerciseInfoSheet(id) {
  const ex = getEx(id);
  const s = sheet(`<h3 class="sheet-title">${esc(ex.name)}</h3>
    ${ex.images.length ? `<div class="demo sm">${ex.images.map((src, i) => `<img src="${src}" alt="" class="${i === 0 ? 'on' : ''}">`).join('')}</div>` : ''}
    <div class="chips">${ex.primary.map((m) => `<span class="chip on">${cap(m)}</span>`).join('')}${ex.secondary.slice(0, 3).map((m) => `<span class="chip">${cap(m)}</span>`).join('')}</div>
    ${ex.steps.length ? `<ol class="steps">${ex.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
    <a class="btn ghost block" href="#exercise/${encodeURIComponent(id)}" data-close>History &amp; charts</a>`, { tall: true });
  const imgs = $$('.demo img', s.el); let k = 0;
  const iv = imgs.length > 1 ? setInterval(() => { if (!s.el.isConnected) return clearInterval(iv); imgs[k].classList.remove('on'); k = (k + 1) % imgs.length; imgs[k].classList.add('on'); }, 1100) : null;
}

// ---------- picker ----------
export function pickExercises({ multi = true } = {}) {
  return new Promise((resolve) => {
    const f = { q: '', muscle: '', equipment: '', category: '' };
    const selected = new Set();
    let limit = PAGE, done = false;
    const s = sheet(`<div class="row between"><h3 class="sheet-title">${multi ? 'Add exercises' : 'Choose exercise'}</h3><button class="btn small" id="pk-done" ${multi ? '' : 'hidden'}>Add</button></div>
      ${filterBar(f)}<div class="ex-list picker" id="pk-list"></div>
      <button class="btn ghost block" id="pk-custom">${icon.plus} Create custom exercise</button>`,
    { tall: true, onClose: () => !done && resolve([]) });
    const el = s.el;
    const refresh = () => {
      const list = searchExercises(f.q, { ...f, usedCounts: usedCounts() });
      $('#pk-list', el).innerHTML = listHtml(list, { selectable: true, selected, limit });
      const b = $('#pk-done', el); b.textContent = selected.size ? `Add ${selected.size}` : 'Add'; b.disabled = !selected.size;
    };
    wireFilters(el, f, () => { limit = PAGE; refresh(); });
    $('#pk-list', el).onclick = (e) => {
      if (e.target.closest('[data-more]')) { limit += PAGE * 2; return refresh(); }
      const row = e.target.closest('[data-id]'); if (!row) return;
      const id = row.dataset.id;
      if (!multi) { done = true; resolve([id]); return s.close(); }
      selected.has(id) ? selected.delete(id) : selected.add(id);
      row.classList.toggle('sel'); refresh();
    };
    $('#pk-done', el).onclick = () => { done = true; resolve([...selected]); s.close(); };
    $('#pk-custom', el).onclick = () => customSheet(null, (id) => { if (!multi) { done = true; resolve([id]); s.close(); } else { selected.add(id); refresh(); } });
    refresh();
  });
}

// ---------- custom exercise ----------
function customSheet(existing = null, onCreated) {
  const c = existing || { name: '', category: 'strength', equipment: 'machine', primary: ['chest'], tracks: 'weight', notes: '' };
  const s = sheet(`<h3 class="sheet-title">${existing ? 'Edit' : 'New'} custom exercise</h3>
    <label class="lbl" for="cn">Name</label><input id="cn" value="${esc(c.name)}" placeholder="e.g. Hack squat (gym’s machine)">
    <div class="grid2"><div><label class="lbl" for="cm">Main muscle</label><select id="cm">${MUSCLES.map((m) => `<option ${c.primary[0] === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
    <div><label class="lbl" for="ce">Equipment</label><select id="ce">${EQUIPMENT.map((m) => `<option ${c.equipment === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div></div>
    <label class="lbl" for="ct">Track</label><select id="ct"><option value="weight" ${c.tracks === 'weight' ? 'selected' : ''}>Weight × reps</option><option value="time" ${c.tracks === 'time' ? 'selected' : ''}>Time (seconds)</option></select>
    <label class="lbl" for="cno">Notes / cues</label><textarea id="cno" rows="2">${esc(c.notes || '')}</textarea>
    <button class="btn block" id="ok">Save</button>${existing ? `<button class="btn danger-ghost block" id="rm">Delete exercise</button>` : ''}`);
  $('#ok', s.el).onclick = () => {
    const name = $('#cn', s.el).value.trim();
    if (!name) return toast('Give it a name');
    const rec = store.put('customEx', { ...(existing || {}), id: existing?.id || 'custom_' + Date.now().toString(36), name, category: 'strength', equipment: $('#ce', s.el).value, primary: [$('#cm', s.el).value], secondary: [], tracks: $('#ct', s.el).value, notes: $('#cno', s.el).value });
    reindex(); s.close(); toast('Saved');
    if (onCreated) onCreated(rec.id); else if (!existing) go('exercise/' + encodeURIComponent(rec.id));
  };
  $('#rm', s.el)?.addEventListener('click', async () => {
    if (await confirmSheet('Delete this exercise?', 'Logged sets stay in your history.', { ok: 'Delete', danger: true })) { store.remove('customEx', existing.id); reindex(); s.close(); go('exercises'); }
  });
}
