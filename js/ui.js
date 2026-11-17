// Small UI toolkit: escaping, icons, bottom sheets, toasts, confirm dialogs.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

const P = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const icon = {
  today: P('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  plan: P('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  lib: P('<path d="M6 7v10M18 7v10M3 9.5v5M21 9.5v5M6 12h12"/>'),
  progress: P('<path d="M3 20h18M6 16l4-5 3 3 5-7"/>'),
  me: P('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  minus: P('<path d="M5 12h14"/>'),
  check: P('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  x: P('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: P('<path d="M15 5l-7 7 7 7"/>'),
  chev: P('<path d="M9 5l7 7-7 7"/>'),
  more: P('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  play: P('<path d="M7 5l12 7-12 7z" fill="currentColor"/>'),
  timer: P('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>'),
  trash: P('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  edit: P('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  search: P('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  trophy: P('<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M8 21h8M9 17h6"/>'),
  flame: P('<path d="M12 3c1 4 6 5 6 11a6 6 0 0 1-12 0c0-3 2-4 2-7 2 1 3 2 4 4 1-3 0-5 0-8z"/>'),
  cloud: P('<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19.5 10 4 4 0 0 1 18 18z"/>'),
  target: P('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>'),
  scale: P('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 9a5 5 0 0 1 8 0l-3 3"/>'),
  swap: P('<path d="M7 7h12l-3-3M17 17H5l3 3"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  note: P('<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4"/>'),
  link: P('<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>'),
  drag: P('<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>'),
  up: P('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: P('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  bell: P('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>'),
  plate: P('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>'),
};

// ---------- sheets ----------
let sheetStack = [];
export function sheet(html, { onOpen, onClose, tall = false, cls = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-scrim"></div><div class="sheet ${tall ? 'tall' : ''} ${cls}" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  const api = {
    el: wrap.querySelector('.sheet'),
    close(result) {
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 220);
      sheetStack = sheetStack.filter((s) => s !== api);
      onClose?.(result);
    },
  };
  wrap.querySelector('.sheet-scrim').addEventListener('click', () => api.close());
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) api.close(); });
  // swipe down on the grab bar to close
  let y0 = null;
  const grab = wrap.querySelector('.grab');
  grab.addEventListener('touchstart', (e) => (y0 = e.touches[0].clientY), { passive: true });
  grab.addEventListener('touchend', (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 40) api.close(); y0 = null; });
  sheetStack.push(api);
  onOpen?.(api.el, api);
  return api;
}
export const closeAllSheets = () => [...sheetStack].forEach((s) => s.close());

export function confirmSheet(title, body, { ok = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const s = sheet(`<h3 class="sheet-title">${esc(title)}</h3>${body ? `<p class="muted">${esc(body)}</p>` : ''}
      <div class="row gap"><button class="btn ghost grow" data-close>Cancel</button><button class="btn grow ${danger ? 'danger' : ''}" data-ok>${esc(ok)}</button></div>`,
    { onClose: () => !answered && resolve(false) });
    s.el.querySelector('[data-ok]').onclick = () => { answered = true; resolve(true); s.close(); };
  });
}

// ---------- toast ----------
let toastTimer;
export function toast(msg, { kind = '', ms = 2600 } = {}) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = `toast show ${kind}`;
  t.innerHTML = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export function segmented(name, options, value) {
  return `<div class="seg" role="tablist" data-seg="${name}">${options.map(([v, l]) => `<button role="tab" class="${v === value ? 'on' : ''}" data-v="${v}" aria-selected="${v === value}">${l}</button>`).join('')}</div>`;
}

export function empty(title, text, action = '') {
  return `<div class="empty"><div class="empty-t">${title}</div><p>${text}</p>${action}</div>`;
}
