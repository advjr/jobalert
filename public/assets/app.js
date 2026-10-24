// JobAlert dashboard: a grid of job and social-post tiles. Clicking a tile opens the original
// post in a new tab; "Offer" opens the job page (contacts, AI offer, notes) in a new tab.
// Leads come live from /api/jobs and /api/social; your pipeline lives in localStorage.

import {
  $, KEYS, COUNTRY_OPTIONS, countryName, STATUS_LABEL, store, reloadCrm, allRecs, rec, statusOf, setStatus, needsFollowUp,
  peekJob, jobPageUrl, esc, safeUrl, icon, fitClass, ago, toast, boot,
} from './core.js';

const TABS = ['jobs', 'social', 'pipeline'];
const PIPELINE = ['saved', 'contacted', 'replied', 'hidden'];
const PLATFORMS = ['LinkedIn', 'Facebook', 'Instagram'];
const QUICK_TERMS = ['virtual assistant', 'HubSpot', 'GoHighLevel', 'Zapier automation', 'CRM setup', 'Shopify', 'WordPress website', 'Klaviyo email marketing', 'AI automation', 'executive assistant'];
const LOCAL_BOOST = 15; // how far a job in the chosen country is lifted above worldwide ones in "Best match"
const DEFAULT_FILTERS = {
  country: 'au',
  anywhere: false,
  contact: ['email', 'apply', 'signup'],
  types: ['Project', 'Contract', 'Part-time', 'Full-time', 'Unspecified'],
  minScore: 30,
  locOnly: true,
  hasPay: false,
  newOnly: false,
  days: 35,
  sources: null, // null = all
  sort: 'score',
  platform: 'all',
  pipe: 'saved',
};

const state = {
  tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'jobs',
  filters: { ...DEFAULT_FILTERS, ...store.read(KEYS.filters, {}) },
  payloads: new Map(), // country -> /api/jobs payload
  data: null,
  social: store.read(KEYS.social, {}), // country -> { scannedAt, posts }
  ai: store.read(KEYS.profile, {}).ai ?? null,
  scanning: false,
  loading: false,
  q: '',
  visible: [],
  hiddenWorldwide: 0,
  seen: store.read(KEYS.seen, {}),
  opened: store.read(KEYS.opened, {}),
  meta: store.read(KEYS.meta, null),
};
if (!state.meta) {
  state.meta = { installedAt: Date.now(), lastVisit: Date.now() };
  store.write(KEYS.meta, state.meta);
}
const previousVisit = state.meta.lastVisit;

// ---------- data helpers ----------
const socialPosts = () => state.social[state.filters.country]?.posts || [];

function liveJobs() {
  const map = new Map();
  for (const p of state.payloads.values()) for (const j of p.jobs) map.set(j.id, j);
  for (const s of Object.values(state.social)) for (const p of s.posts || []) map.set(p.id, p);
  return map;
}

function findJob(id) {
  return liveJobs().get(id) || (rec(id).snapshot && { ...rec(id).snapshot, gone: true }) || null;
}

const isNew = j => {
  const first = state.seen[j.id];
  return first && first > state.meta.installedAt + 60_000 && first >= previousVisit - 1000 && !statusOf(j.id);
};

function inCountry(j, { withAnywhere = state.filters.anywhere } = {}) {
  const c = state.filters.country;
  if (c === 'all') return true;
  return (j.countries || []).includes(c) || (withAnywhere && j.anywhere);
}

function passesFilters(j) {
  const f = state.filters;
  if (!f.contact.includes(j.contactMethod)) return false;
  if (!f.types.includes(j.type)) return false;
  if (j.score < f.minScore) return false;
  if (f.locOnly && j.locationFit === 'restricted') return false;
  if (f.hasPay && !j.salary) return false;
  if (f.newOnly && !isNew(j)) return false;
  if (f.sources && !f.sources.includes(j.source)) return false;
  if (j.postedAt && Date.now() - Date.parse(j.postedAt) > f.days * 86400_000) return false;
  return true;
}

function matchesQuery(j) {
  if (!state.q) return true;
  const hay = `${j.title} ${j.company} ${j.location} ${(j.matched || []).map(m => m.label).join(' ')} ${(j.tags || []).join(' ')} ${j.description}`.toLowerCase();
  return state.q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
}

const CONTACT_RANK = { email: 0, apply: 1, signup: 2 };
function sortJobs(list) {
  const by = state.filters.sort;
  const c = state.filters.country;
  const t = j => Date.parse(j.postedAt || 0) || 0;
  const rank = j => j.score + (c !== 'all' && (j.countries || []).includes(c) ? LOCAL_BOOST : 0);
  return list.sort((a, b) => {
    if (by === 'newest') return t(b) - t(a);
    if (by === 'contact') return CONTACT_RANK[a.contactMethod] - CONTACT_RANK[b.contactMethod] || rank(b) - rank(a);
    if (by === 'pay') return (b.salary ? 1 : 0) - (a.salary ? 1 : 0) || rank(b) - rank(a);
    return rank(b) - rank(a) || t(b) - t(a);
  });
}

function trackedJobs(status) {
  const live = liveJobs();
  return Object.entries(allRecs())
    .filter(([, r]) => r.status === status)
    .map(([id, r]) => live.get(id) || (r.snapshot && { ...r.snapshot, gone: true }))
    .filter(Boolean);
}

const inbox = j => !statusOf(j.id) || statusOf(j.id) === 'saved';

function computeVisible() {
  state.hiddenWorldwide = 0;
  if (state.tab === 'pipeline') {
    state.visible = sortJobs(trackedJobs(state.filters.pipe).filter(matchesQuery));
  } else if (state.tab === 'social') {
    const p = state.filters.platform;
    state.visible = sortJobs(
      socialPosts().filter(j => inbox(j) && matchesQuery(j) && inCountry(j, { withAnywhere: true }) && (p === 'all' || (p === 'Other' ? !PLATFORMS.includes(j.platform) : j.platform === p))),
    );
  } else {
    const base = (state.data?.jobs || []).filter(j => inbox(j) && matchesQuery(j) && passesFilters(j));
    state.visible = sortJobs(base.filter(j => inCountry(j)));
    if (!state.filters.anywhere && state.filters.country !== 'all') state.hiddenWorldwide = base.filter(j => !inCountry(j) && j.anywhere).length;
  }
}

// ---------- rendering ----------
function render() {
  computeVisible();
  renderChrome();
  renderSummary();
  renderGrid();
  store.write(KEYS.filters, state.filters);
}

function renderChrome() {
  const f = state.filters;
  document.body.dataset.tab = state.tab;
  document.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.tab === state.tab;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  });
  const jobsCount = (state.data?.jobs || []).filter(j => inbox(j) && passesFilters(j) && inCountry(j)).length;
  const socialCount = socialPosts().filter(j => inbox(j) && inCountry(j, { withAnywhere: true })).length;
  const tracked = Object.values(allRecs()).filter(r => r.status && r.status !== 'hidden').length;
  $('#n-jobs').textContent = state.data ? jobsCount : '';
  $('#n-social').textContent = socialCount || '';
  $('#n-pipeline').textContent = tracked || '';

  $('#anywhere').checked = f.anywhere;
  $('#anywhere-wrap').hidden = state.tab !== 'jobs' || f.country === 'all';
  $('.country-pick').hidden = state.tab === 'pipeline';
  $('#btn-filters').hidden = state.tab !== 'jobs';
  $('#social-panel').hidden = state.tab !== 'social';

  const pipeSeg = $('#pipeline-seg');
  pipeSeg.hidden = state.tab !== 'pipeline';
  if (!pipeSeg.hidden) {
    pipeSeg.innerHTML = PIPELINE.map(s => {
      const n = trackedJobs(s).length;
      const due = s === 'contacted' ? trackedJobs(s).filter(j => needsFollowUp(j.id)).length : 0;
      return `<button class="${f.pipe === s ? 'on' : ''}" data-pipe="${s}">${STATUS_LABEL[s]}<span class="n">${n}</span>${due ? `<span class="due" title="Due a follow-up">${due}</span>` : ''}</button>`;
    }).join('');
  }

  const platSeg = $('#platform-seg');
  platSeg.hidden = state.tab !== 'social';
  if (!platSeg.hidden) {
    const posts = socialPosts();
    const count = p => posts.filter(j => (p === 'all' ? true : p === 'Other' ? !PLATFORMS.includes(j.platform) : j.platform === p)).length;
    platSeg.innerHTML = ['all', ...PLATFORMS, 'Other']
      .map(p => `<button class="${f.platform === p ? 'on' : ''}" data-platform="${p}">${p === 'all' ? 'All' : p}<span class="n">${count(p)}</span></button>`)
      .join('');
    renderSocialPanel();
  }

  const changed = ['contact', 'types', 'minScore', 'locOnly', 'hasPay', 'newOnly', 'days', 'sources'].filter(k => JSON.stringify(f[k]) !== JSON.stringify(DEFAULT_FILTERS[k])).length;
  $('#filter-count').hidden = !changed;
  $('#filter-count').textContent = changed;
}

function renderSummary() {
  const el = $('#summary');
  if (state.tab === 'jobs' && !state.data) { el.textContent = state.loading ? `Pulling jobs for ${countryName(state.filters.country)}…` : ''; return; }
  const v = state.visible;
  const parts = [`<strong>${v.length}</strong> ${state.tab === 'social' ? 'posts' : 'leads'}`];
  if (state.tab === 'jobs') {
    const great = v.filter(j => j.score >= 70).length;
    if (great) parts.push(`<strong>${great}</strong> great fits`);
    if (state.hiddenWorldwide) parts.push(`<button class="link" data-action="show-anywhere">+${state.hiddenWorldwide} worldwide remote</button>`);
  }
  el.innerHTML = parts.join(' · ');
}

function tile(j) {
  const s = statusOf(j.id);
  const fc = fitClass(j.score);
  const social = j.kind === 'social';
  const country = state.filters.country;
  const cc = (j.countries || []).includes(country) ? country : (j.countries || [])[0];
  const meta = [];
  if (j.salary) meta.push(`<span class="pill pay" title="${esc(j.salary)}">${esc(j.salary)}</span>`);
  if (!social && j.type !== 'Unspecified') meta.push(`<span class="pill">${esc(j.type)}</span>`);
  if (j.contactMethod === 'email') meta.push(`<span class="pill mail" title="Email in the post">${icon('i-mail')}Email</span>`);
  if (j.contacts?.phones?.length) meta.push(`<span class="pill mail" title="Phone in the post">${icon('i-phone')}</span>`);
  if (j.locationFit === 'restricted') meta.push(`<span class="pill warn" title="${esc(j.location)}">Location locked</span>`);
  if (s && s !== 'hidden') meta.push(`<span class="pill status">${STATUS_LABEL[s]}</span>`);
  if (needsFollowUp(j.id)) meta.push(`<span class="pill warn">Follow up</span>`);
  if (j.gone) meta.push(`<span class="pill">No longer listed</span>`);
  const snippet = social ? (j.description || '').split('\n').find(Boolean) : '';

  return `<article class="tile${state.opened[j.id] ? ' viewed' : ''}${s === 'hidden' ? ' dim' : ''}" data-id="${esc(j.id)}">
    <div class="tile-top">
      <span class="score fit-${fc}" title="${esc(j.fit)} for your skills">${j.score}<small>match</small></span>
      ${cc ? `<span class="cc" title="${esc(countryName(cc))}">${cc.toUpperCase()}</span>` : j.anywhere ? '<span class="cc" title="Open to most countries">Remote</span>' : ''}
      ${isNew(j) ? '<span class="new">New</span>' : ''}
      <span class="src">${esc(j.sourceLabel)} · ${ago(j.postedAt)}</span>
    </div>
    <h3><a class="tile-link" href="${esc(safeUrl(j.url))}" target="_blank" rel="noopener noreferrer" data-open>${esc(j.title)}</a></h3>
    <p class="company">${esc(j.company || 'Company not named')}${j.location ? ` · ${esc(j.location)}` : ''}</p>
    ${snippet ? `<p class="snippet">${esc(snippet)}</p>` : ''}
    <div class="tile-foot">
      <div class="meta">${meta.join('')}</div>
      <div class="tile-actions">
        <button class="icon-btn sm${s === 'saved' ? ' on' : ''}" data-act="saved" title="${s === 'saved' ? 'Saved' : 'Save'}" aria-label="Save">${icon('i-bookmark')}</button>
        <a class="btn btn-sm" href="${jobPageUrl(j.id)}" target="_blank" rel="noopener" data-act="offer" title="Contacts, offer draft and notes">${icon('i-spark')}Offer</a>
        <button class="icon-btn sm${s === 'hidden' ? ' on' : ''}" data-act="hidden" title="${s === 'hidden' ? 'Unhide' : 'Not a fit'}" aria-label="Hide">${icon('i-x')}</button>
      </div>
    </div>
  </article>`;
}

function renderGrid() {
  const el = $('#grid');
  if (state.tab === 'jobs' && !state.data) {
    el.innerHTML = state.loading ? Array.from({ length: 12 }, () => '<div class="tile skeleton"></div>').join('') : '';
    return;
  }
  if (!state.visible.length) {
    const msg = {
      jobs: ['No jobs match these filters', state.hiddenWorldwide ? 'Turn on "Worldwide remote too", pick another country, or reset the filters.' : 'Pick another country, lower the minimum match, or reset the filters.'],
      social: state.scanning ? ['Scanning…', 'Claude is searching LinkedIn, Facebook and Instagram posts. This takes a minute or two.'] : ['No posts yet', state.ai === false ? 'The AI scan needs ANTHROPIC_API_KEY. Meanwhile, use the quick searches above.' : 'Press "Scan with AI" to look for fresh posts, or use the quick searches above.'],
      pipeline: {
        saved: ['Nothing saved yet', 'Use the bookmark on a tile to keep it here.'],
        contacted: ['No one contacted yet', 'Sending an offer from the job page moves it here.'],
        replied: ['No replies tracked yet', 'Mark a lead as Replied on its job page when they answer.'],
        hidden: ['Nothing hidden', 'Hide tiles that are not a fit to keep the grid clean.'],
      }[state.filters.pipe],
    }[state.tab];
    el.innerHTML = `<div class="empty"><h3>${msg[0]}</h3><p>${msg[1]}</p>${state.tab === 'jobs' ? '<button class="btn" data-action="reset">Reset filters</button>' : ''}</div>`;
    return;
  }
  el.innerHTML = state.visible.slice(0, 300).map(tile).join('') +
    (state.visible.length > 300 ? '<div class="empty">Showing the top 300. Raise the minimum match to narrow it down.</div>' : '');
}

function renderSources() {
  if (!state.data) return;
  const f = state.filters;
  $('#sources').innerHTML = state.data.sources.map(s => `
    <label class="src" title="${esc(s.error ? `Error: ${s.error}` : `${s.fetched} pulled, ${s.shown} relevant`)}">
      <input type="checkbox" data-source="${s.id}" ${!f.sources || f.sources.includes(s.id) ? 'checked' : ''}>
      <span class="dot ${s.ok ? '' : 'err'}"></span>${esc(s.label)}<span class="n">${s.shown}</span>
    </label>${s.note ? `<div class="src-note">${esc(s.note)}</div>` : ''}`).join('');
}

// ---------- social panel ----------
function quickLinks(term) {
  const c = state.filters.country;
  const place = c === 'all' ? '' : countryName(c);
  const e = encodeURIComponent;
  const ask = `looking for ${term} ${place}`.trim();
  const fbRecent = btoa(JSON.stringify({ 'recent_posts:0': JSON.stringify({ name: 'recent_posts', args: '' }) }));
  return [
    ['LinkedIn posts', `https://www.linkedin.com/search/results/content/?keywords=${e(ask)}&sortBy=%22date_posted%22&datePosted=%22past-week%22`],
    ['Facebook posts', `https://www.facebook.com/search/posts/?q=${e(ask)}&filters=${e(fbRecent)}`],
    ['Facebook groups', `https://www.facebook.com/search/groups/?q=${e(`${place} small business owners`.trim())}`],
    ['Instagram', `https://www.instagram.com/explore/search/keyword/?q=${e(`hiring ${term}`)}`],
    ['X', `https://x.com/search?q=${e(`"looking for" ${term} ${place}`.trim())}&f=live`],
    ['Google (indexed posts)', `https://www.google.com/search?q=${e(`(site:linkedin.com/posts OR site:facebook.com/groups OR site:instagram.com) ("looking for" OR "anyone recommend" OR "hiring") "${term}" ${place}`.trim())}&tbs=qdr:m`],
  ];
}

function renderSocialPanel() {
  const scan = state.social[state.filters.country];
  const where = countryName(state.filters.country);
  let note;
  if (state.ai === false) note = 'The AI scan is off: add ANTHROPIC_API_KEY to turn it on.';
  else if (state.scanning) note = `Searching public posts for ${where}. This takes a minute or two…`;
  else if (scan?.scannedAt) note = `Last scan for ${where}: ${ago(scan.scannedAt)}, ${scan.posts.length} posts found. Each scan costs roughly US$0.30 to US$0.80 in API credit.`;
  else note = `Claude searches public LinkedIn, Facebook group and Instagram posts that search engines have indexed. Each scan costs roughly US$0.30 to US$0.80 in API credit.`;
  $('#scan-note').textContent = note;
  const btn = $('#btn-scan');
  btn.disabled = state.scanning || state.ai === false;
  btn.classList.toggle('spinning', state.scanning);
  btn.querySelector('span').textContent = state.scanning ? 'Scanning…' : scan?.scannedAt ? 'Scan again' : 'Scan with AI';
  const sel = $('#quick-q');
  if (!sel.options.length) sel.innerHTML = QUICK_TERMS.map(t => `<option>${esc(t)}</option>`).join('');
  $('#quick-links').innerHTML = quickLinks(sel.value)
    .map(([label, url]) => `<a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('i-link')}${esc(label)}</a>`)
    .join('');
}

async function scanSocial() {
  const country = state.filters.country;
  state.scanning = true;
  render();
  try {
    const res = await fetch('/api/social', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ country }) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 503) state.ai = false;
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    saveScan(country, data);
    toast(`${data.posts.length} posts found`);
  } catch (err) {
    toast(`Scan failed: ${err.message}`);
  } finally {
    state.scanning = false;
    render();
  }
}

function saveScan(country, data) {
  state.social[country] = { scannedAt: data.scannedAt, posts: data.posts };
  markSeen(data.posts);
  store.write(KEYS.social, state.social);
}

// The server may hold a newer scan than this browser (for example one run from another device).
async function syncSocial() {
  const country = state.filters.country;
  try {
    const res = await fetch(`/api/social?country=${country}`);
    if (!res.ok) return;
    const data = await res.json();
    state.ai = data.ai;
    const mine = state.social[country]?.scannedAt;
    if (data.scannedAt && (!mine || Date.parse(data.scannedAt) > Date.parse(mine))) saveScan(country, data);
    render();
  } catch {}
}

// ---------- data ----------
function markSeen(jobs) {
  const now = Date.now();
  for (const j of jobs) if (!state.seen[j.id]) state.seen[j.id] = now;
  for (const [id, t] of Object.entries(state.seen)) if (now - t > 60 * 86400_000) delete state.seen[id];
  store.write(KEYS.seen, state.seen);
}

async function load({ force = false, refetch = false } = {}) {
  const country = state.filters.country;
  if (!force && !refetch && state.payloads.has(country)) {
    state.data = state.payloads.get(country);
    renderSources();
    return render();
  }
  const btn = $('#btn-refresh');
  btn.disabled = true;
  btn.classList.add('spinning');
  state.loading = true;
  if (!state.payloads.has(country)) state.data = null;
  render();
  try {
    const res = await fetch(`/api/jobs?country=${country}${force ? `&refresh=${Date.now()}` : ''}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.payloads.set(country, data);
    if (state.filters.country !== country) return; // switched country while this was loading
    state.data = data;
    state.ai = data.ai;
    store.write(KEYS.profile, { profile: data.profile, ai: data.ai });
    markSeen(data.jobs);
    store.write(KEYS.meta, { ...state.meta, lastVisit: Date.now() });
    const failed = data.sources.filter(s => !s.ok);
    if (failed.length) toast(`Could not reach: ${failed.map(s => s.label).join(', ')}`);
    else if (force) toast(`${data.jobs.length} leads pulled from ${data.sources.length} boards`);
    renderSources();
  } catch (err) {
    if (!state.data) $('#grid').innerHTML = `<div class="empty"><h3>Could not load jobs</h3><p>${esc(err.message)}. Check your connection and try again.</p><button class="btn" data-action="retry">Try again</button></div>`;
    else toast(`Refresh failed: ${err.message}`);
    return;
  } finally {
    state.loading = false;
    btn.disabled = false;
    btn.classList.remove('spinning');
  }
  render();
}

// ---------- filters UI ----------
function syncFilterControls() {
  const f = state.filters;
  $('#country').innerHTML = COUNTRY_OPTIONS.map(([c, name]) => `<option value="${c}">${name}</option>`).join('') + '<option value="all">All countries</option>';
  $('#country').value = f.country;
  document.querySelectorAll('.chips').forEach(group => {
    const list = f[group.dataset.filter];
    group.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', list.includes(c.dataset.value)));
  });
  $('#minScore').value = f.minScore;
  $('#minScoreOut').textContent = f.minScore ? `${f.minScore}+` : 'Any';
  $('#locOnly').checked = f.locOnly;
  $('#hasPay').checked = f.hasPay;
  $('#newOnly').checked = f.newOnly;
  $('#days').value = String(f.days);
  $('#sort').value = f.sort;
}

const openSheet = () => { document.body.classList.add('sheet-open'); $('#sheet').setAttribute('aria-hidden', 'false'); };
const closeSheet = () => { document.body.classList.remove('sheet-open'); $('#sheet').setAttribute('aria-hidden', 'true'); };

function exportCsv() {
  const cols = ['score', 'fit', 'status', 'title', 'company', 'salary', 'type', 'location', 'countries', 'emails', 'phones', 'url', 'applyUrl', 'source', 'postedAt', 'note'];
  const rows = state.visible.map(j => [
    j.score, j.fit, statusOf(j.id) || '', j.title, j.company, j.salary || '', j.type, j.location, (j.countries || []).join(' '),
    j.contacts.emails.join(' '), j.contacts.phones.map(p => p.display).join(' '), j.url, j.applyUrl || '', j.sourceLabel, j.postedAt || '', rec(j.id).note || '',
  ]);
  const csv = [cols, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `jobalert-${state.tab}-${state.filters.country}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function setTab(tab) {
  state.tab = tab;
  history.replaceState(null, '', `#${tab}`);
  if (tab === 'social') syncSocial();
  render();
}

// ---------- events ----------
// Hand the job to the job page before the new tab opens (covers middle-click too).
function onOfferOpen(e) {
  const a = e.target.closest('[data-act="offer"]');
  if (!a) return;
  const j = findJob(a.closest('.tile').dataset.id);
  if (j) peekJob(j);
}
$('#grid').addEventListener('auxclick', e => { onOfferOpen(e); markOpened(e); });

function markOpened(e) {
  const link = e.target.closest('[data-open]');
  if (!link) return;
  const id = link.closest('.tile').dataset.id;
  state.opened[id] = Date.now();
  for (const [k, t] of Object.entries(state.opened)) if (Date.now() - t > 60 * 86400_000) delete state.opened[k];
  store.write(KEYS.opened, state.opened);
  link.closest('.tile').classList.add('viewed');
}

document.addEventListener('click', e => {
  if (e.target.closest('[data-act="offer"]')) return onOfferOpen(e);
  if (e.target.closest('[data-open]')) return markOpened(e);
  const t = e.target.closest('button');
  if (!t) return;

  if (t.dataset.tab) return setTab(t.dataset.tab);
  if (t.dataset.pipe) { state.filters.pipe = t.dataset.pipe; return render(); }
  if (t.dataset.platform) { state.filters.platform = t.dataset.platform; return render(); }
  if (t.dataset.act) {
    const id = t.closest('.tile').dataset.id;
    const now = setStatus(id, t.dataset.act, findJob(id));
    toast(now ? `Moved to ${STATUS_LABEL[now]}` : state.tab === 'pipeline' ? 'Removed from the pipeline' : 'Moved back to the grid');
    return render();
  }
  if (t.closest('.chips')) {
    const key = t.closest('.chips').dataset.filter;
    const list = new Set(state.filters[key]);
    list.has(t.dataset.value) ? list.delete(t.dataset.value) : list.add(t.dataset.value);
    state.filters[key] = [...list];
    syncFilterControls();
    return render();
  }
  switch (t.dataset.action || t.id) {
    case 'show-anywhere': state.filters.anywhere = true; return render();
    case 'retry': return load();
    case 'reset':
    case 'btn-reset':
      state.filters = { ...DEFAULT_FILTERS, country: state.filters.country, anywhere: state.filters.anywhere, sort: state.filters.sort };
      syncFilterControls();
      renderSources();
      return render();
    case 'btn-refresh': return state.tab === 'social' ? syncSocial() : load({ force: true });
    case 'btn-scan': return scanSocial();
    case 'btn-export': return exportCsv();
    case 'btn-filters': return openSheet();
    case 'btn-close-sheet': return closeSheet();
  }
});

$('#scrim').addEventListener('click', closeSheet);
window.addEventListener('hashchange', () => {
  const tab = location.hash.slice(1);
  if (TABS.includes(tab) && tab !== state.tab) setTab(tab);
});
$('#q').addEventListener('input', e => { state.q = e.target.value.trim(); render(); });
$('#country').addEventListener('change', e => {
  state.filters.country = e.target.value;
  state.filters.platform = 'all';
  if (state.tab === 'social') syncSocial();
  load();
});
$('#anywhere').addEventListener('change', e => { state.filters.anywhere = e.target.checked; render(); });
$('#quick-q').addEventListener('change', renderSocialPanel);
$('#minScore').addEventListener('input', e => {
  state.filters.minScore = Number(e.target.value);
  $('#minScoreOut').textContent = state.filters.minScore ? `${state.filters.minScore}+` : 'Any';
  render();
});
for (const id of ['locOnly', 'hasPay', 'newOnly']) {
  $(`#${id}`).addEventListener('change', e => { state.filters[id] = e.target.checked; render(); });
}
$('#days').addEventListener('change', e => { state.filters.days = Number(e.target.value); render(); });
$('#sort').addEventListener('change', e => { state.filters.sort = e.target.value; render(); });
$('#sources').addEventListener('change', () => {
  const boxes = [...document.querySelectorAll('#sources input')];
  const on = boxes.filter(b => b.checked).map(b => b.dataset.source);
  state.filters.sources = on.length === boxes.length ? null : on;
  render();
});

// The job page in another tab saves, contacts or hides leads: reflect that here.
window.addEventListener('storage', e => {
  if (e.key === KEYS.crm) { reloadCrm(); render(); }
});

document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select')) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
  if (e.key === 'Escape') closeSheet();
});

// ---------- start ----------
boot();
syncFilterControls();
render();
load();
if (state.tab === 'social') syncSocial();
// Pick up new posts while the tab stays open.
setInterval(() => { if (document.visibilityState === 'visible') load({ refetch: true }); }, 30 * 60_000);
