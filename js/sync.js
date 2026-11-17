// Backup + sync to a PRIVATE GitHub repository via the GitHub REST API.
// The token (fine-grained, limited to that one repo, "Contents: read and write") is kept only on this
// device in localStorage — it is never part of the app code or the synced file.
import { store, merge } from './store.js';

const CFG_KEY = 'ironbook-sync';
const API = 'https://api.github.com';

export function getConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch { return null; }
}
export function setConfig(cfg) {
  if (cfg) localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); else localStorage.removeItem(CFG_KEY);
}

const listeners = new Set();
export const syncState = { status: 'idle', message: '', lastSync: Number(localStorage.getItem('ironbook-lastsync') || 0) };
export const onSyncChange = (fn) => listeners.add(fn);
function set(status, message = '') {
  syncState.status = status; syncState.message = message;
  if (status === 'ok') { syncState.lastSync = Date.now(); localStorage.setItem('ironbook-lastsync', String(syncState.lastSync)); }
  listeners.forEach((fn) => fn());
}

function headers(cfg) {
  return { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}

// UTF-8 safe base64
function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromB64(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function gh(cfg, path, opts = {}) {
  const res = await fetch(API + path, { ...opts, headers: { ...headers(cfg), ...(opts.headers || {}) }, cache: 'no-store' });
  return res;
}

function explain(res, body) {
  if (res.status === 401) return 'GitHub rejected the token. Create a new one and paste it again.';
  if (res.status === 403) return 'The token can’t write to this repo. Give it “Contents: Read and write” for this repository.';
  if (res.status === 404) return 'Repository not found. Check the owner/repo name and that the token has access to it.';
  return `GitHub error ${res.status}: ${body?.message || 'unknown'}`;
}

// Read the remote file. Returns {data, sha} or {data:null, sha:null} if it doesn't exist yet.
async function pull(cfg) {
  const res = await gh(cfg, `/repos/${cfg.repo}/contents/${encodeURI(cfg.path)}`);
  if (res.status === 404) {
    // Distinguish "file missing" from "repo missing"
    const repo = await gh(cfg, `/repos/${cfg.repo}`);
    if (repo.ok) return { data: null, sha: null };
    throw new Error(explain(repo, await repo.json().catch(() => ({}))));
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(explain(res, body));
  let text = body.content ? fromB64(body.content) : null;
  if (!text) { // files over 1 MB come back without content: fetch the blob instead
    const blob = await gh(cfg, `/repos/${cfg.repo}/git/blobs/${body.sha}`);
    const bb = await blob.json();
    text = fromB64(bb.content);
  }
  return { data: JSON.parse(text), sha: body.sha };
}

async function push(cfg, data, sha) {
  const device = /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'browser';
  const res = await gh(cfg, `/repos/${cfg.repo}/contents/${encodeURI(cfg.path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Sync from ${device} · ${new Date().toLocaleString()}`,
      content: toB64(JSON.stringify(data, null, 1)),
      ...(sha ? { sha } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 409 || res.status === 422) return { conflict: true };
  if (!res.ok) throw new Error(explain(res, body));
  return { sha: body.content?.sha };
}

let running = null;
export function syncNow({ quiet = false } = {}) {
  const cfg = getConfig();
  if (!cfg?.token || !cfg?.repo) { if (!quiet) set('off', 'Sync is not set up'); return Promise.resolve(false); }
  if (!navigator.onLine) { set('offline', 'Offline — will sync when you’re back online'); return Promise.resolve(false); }
  if (running) return running;
  set('syncing', 'Syncing…');
  running = (async () => {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await pull(cfg);
        const local = { settings: store.state.settings, col: store.state.col };
        const merged = remote.data ? merge(local, remote.data) : merge(local, { col: {} });
        // Apply remote changes locally
        store.state.col = merged.col;
        store.state.settings = merged.settings;
        const unchanged = remote.data && JSON.stringify(stripMeta(remote.data)) === JSON.stringify(stripMeta(merged));
        if (!unchanged) {
          const out = await push(cfg, { ...merged, exportedAt: new Date().toISOString() }, remote.sha);
          if (out.conflict) continue; // someone else wrote in between: pull and merge again
        }
        store.emit(false);
        set('ok', 'Up to date');
        return true;
      }
      throw new Error('Couldn’t sync after 3 tries. Try again in a moment.');
    } catch (e) {
      set('error', e.message || String(e));
      return false;
    } finally { running = null; }
  })();
  return running;
}
const stripMeta = (d) => ({ settings: d.settings, col: d.col });

export async function testConnection(cfg) {
  const res = await gh(cfg, `/repos/${cfg.repo}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(explain(res, body));
  if (!body.private) throw new Error('This repository is PUBLIC — anyone could read your data. Make it private on GitHub (Settings → Danger Zone → Change visibility) and try again.');
  if (body.permissions && !body.permissions.push) throw new Error('The token can read but not write. Give it “Contents: Read and write”.');
  return body;
}

// Auto sync: shortly after changes, when the app goes to the background, and when coming back online
let debounce = null;
export function startAutoSync() {
  store.onDataChange(() => {
    if (!getConfig()) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => syncNow({ quiet: true }), 20000);
  });
  document.addEventListener('visibilitychange', () => {
    if (!getConfig()) return;
    if (document.visibilityState === 'hidden' && debounce) { clearTimeout(debounce); debounce = null; syncNow({ quiet: true }); }
    if (document.visibilityState === 'visible' && Date.now() - syncState.lastSync > 5 * 60000) syncNow({ quiet: true });
  });
  window.addEventListener('online', () => getConfig() && syncNow({ quiet: true }));
  if (getConfig()) syncNow({ quiet: true });
}
