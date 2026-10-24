// Shared by the dashboard (index.html) and the job page (job.html): storage, the pipeline
// records, the theme switch, icons and small helpers. Everything is kept in localStorage,
// so both tabs see the same pipeline without a database.

export const $ = sel => document.querySelector(sel);
export const KEYS = {
  crm: 'jobalert.crm.v1',
  seen: 'jobalert.seen.v1',
  meta: 'jobalert.meta.v1',
  filters: 'jobalert.filters.v2',
  theme: 'jobalert.theme',
  peek: 'jobalert.peek.v1',
  opened: 'jobalert.opened.v1',
  social: 'jobalert.social.v1',
  profile: 'jobalert.profile.v1',
};

export const COUNTRY_OPTIONS = [
  ['au', 'Australia'],
  ['nz', 'New Zealand'],
  ['sg', 'Singapore'],
  ['ae', 'UAE'],
  ['ph', 'Philippines'],
  ['gb', 'United Kingdom'],
  ['us', 'United States'],
  ['ca', 'Canada'],
];
export const countryName = code => (COUNTRY_OPTIONS.find(([c]) => c === code) || [, 'All countries'])[1];

export const STATUS_LABEL = { saved: 'Saved', contacted: 'Contacted', replied: 'Replied', hidden: 'Hidden' };

// ---------- storage ----------
export const store = {
  read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast('Browser storage is full or blocked: changes will not be kept.'); }
  },
};

// ---------- pipeline records (saved, contacted, notes, drafts) ----------
let crm = store.read(KEYS.crm, {});
export const reloadCrm = () => { crm = store.read(KEYS.crm, {}); };
export const allRecs = () => crm;
export const rec = id => crm[id] || {};
export const statusOf = id => rec(id).status || null;

export function updateRec(id, patch, job) {
  crm = store.read(KEYS.crm, {}); // the other tab may have written since we last looked
  const snapshot = job || crm[id]?.snapshot;
  const next = { ...crm[id], ...patch, updatedAt: Date.now() };
  if (next.status && snapshot) next.snapshot = snapshot; // keep the post even after it drops off the boards
  if (!next.status && !next.note && !next.draft) delete crm[id];
  else crm[id] = next;
  store.write(KEYS.crm, crm);
}

export function setStatus(id, status, job) {
  const nextStatus = statusOf(id) === status ? null : status;
  const patch = { status: nextStatus };
  if (nextStatus === 'contacted' && !rec(id).contactedAt) patch.contactedAt = Date.now();
  if (nextStatus === 'replied') patch.repliedAt = Date.now();
  updateRec(id, patch, job);
  return nextStatus;
}

export function needsFollowUp(id) {
  const r = rec(id);
  return r.status === 'contacted' && r.contactedAt && Date.now() - r.contactedAt > 4 * 86400_000;
}

// ---------- handing a job to the job page in a new tab ----------
export function peekJob(job) {
  const peek = store.read(KEYS.peek, {});
  peek[job.id] = { job, at: Date.now() };
  const ids = Object.keys(peek).sort((a, b) => peek[b].at - peek[a].at);
  for (const id of ids.slice(40)) delete peek[id];
  store.write(KEYS.peek, peek);
}
export const findPeek = id => store.read(KEYS.peek, {})[id]?.job || null;
export const jobPageUrl = id => `job.html?id=${encodeURIComponent(id)}`;

// ---------- theme ----------
const media = window.matchMedia('(prefers-color-scheme: dark)');
export const currentTheme = () => document.documentElement.dataset.theme || (media.matches ? 'dark' : 'light');

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(KEYS.theme, next); } catch {}
  syncThemeButton();
}

export function syncThemeButton() {
  const btn = $('#btn-theme');
  if (!btn) return;
  const dark = currentTheme() === 'dark';
  btn.innerHTML = icon(dark ? 'i-sun' : 'i-moon');
  btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  btn.setAttribute('aria-label', btn.title);
}

// ---------- helpers ----------
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '#');
export const icon = id => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
export const fitClass = s => (s >= 70 ? 'great' : s >= 45 ? 'good' : s >= 25 ? 'possible' : 'weak');

export function ago(iso) {
  if (!iso) return 'date unknown';
  const mins = (Date.now() - Date.parse(iso)) / 60000;
  if (mins < 60) return `${Math.max(1, Math.round(mins))}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  const d = Math.round(mins / 1440);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

export function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<)]+/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

let toastTimer;
export function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export async function copy(text, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} to clipboard`);
  } catch {
    toast('Could not copy. Select the text and copy it manually.');
  }
}

// ---------- icons ----------
const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></symbol>
  <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.9-3.6L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.9 3.6L20 15"/><path d="M20 20v-5h-5"/></symbol>
  <symbol id="i-filter" viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></symbol>
  <symbol id="i-mail" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></symbol>
  <symbol id="i-phone" viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></symbol>
  <symbol id="i-link" viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></symbol>
  <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></symbol>
  <symbol id="i-bookmark" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12l5 5 9-11"/></symbol>
  <symbol id="i-reply" viewBox="0 0 24 24"><path d="M9 14l-5-5 5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v5"/></symbol>
  <symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3 3.4M6.5 7.6A17 17 0 0 0 3 12s4 6 9 6a9 9 0 0 0 3.4-.7"/><path d="M9.9 10a3 3 0 0 0 4.1 4.1"/></symbol>
  <symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></symbol>
  <symbol id="i-copy" viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></symbol>
  <symbol id="i-back" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
  <symbol id="i-download" viewBox="0 0 24 24"><path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/></symbol>
  <symbol id="i-send" viewBox="0 0 24 24"><path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/></symbol>
  <symbol id="i-inbox" viewBox="0 0 24 24"><path d="M4 13l2-8h12l2 8v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/></symbol>
  <symbol id="i-whatsapp" viewBox="0 0 24 24"><path d="M4 20l1.3-4A8 8 0 1 1 8 19z"/><path d="M9 9.5c.3 2 2.5 4.3 4.5 4.8l1-1.2 1.8.8c-.3 1.3-1.3 2-2.6 1.8C10.7 15.2 8.6 13 8 10.2c-.2-1.3.5-2.3 1.8-2.6l.8 1.8z"/></symbol>
  <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></symbol>
  <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></symbol>
  <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></symbol>
  <symbol id="i-briefcase" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/></symbol>
  <symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></symbol>
  <symbol id="i-layers" viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></symbol>
</svg>`;

export function boot() {
  document.body.insertAdjacentHTML('afterbegin', SPRITE);
  syncThemeButton();
  media.addEventListener('change', syncThemeButton);
  $('#btn-theme')?.addEventListener('click', toggleTheme);
}
