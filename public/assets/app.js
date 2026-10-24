// JobAlert dashboard. Leads come live from /api/jobs; your pipeline (saved, contacted,
// notes, drafts) is kept in this browser's localStorage, so there is no database.

const $ = sel => document.querySelector(sel);
const KEYS = { crm: 'jobalert.crm.v1', seen: 'jobalert.seen.v1', meta: 'jobalert.meta.v1', filters: 'jobalert.filters.v1' };

const VIEWS = [
  { id: 'inbox', label: 'Matches', icon: 'i-inbox' },
  { id: 'saved', label: 'Saved', icon: 'i-bookmark' },
  { id: 'contacted', label: 'Contacted', icon: 'i-send' },
  { id: 'replied', label: 'Replied', icon: 'i-reply' },
  { id: 'hidden', label: 'Hidden', icon: 'i-eye-off' },
];
const STATUS_LABEL = { saved: 'Saved', contacted: 'Contacted', replied: 'Replied', hidden: 'Hidden' };
const DEFAULT_FILTERS = {
  contact: ['email', 'apply', 'signup'],
  types: ['Project', 'Contract', 'Part-time', 'Full-time', 'Unspecified'],
  minScore: 35,
  locOnly: true,
  hasPay: false,
  newOnly: false,
  days: 14,
  sources: null, // null = all
  sort: 'score',
};

// ---------- storage ----------
const store = {
  read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast('Browser storage is full or blocked: changes will not be kept.'); }
  },
};

const state = {
  data: null,
  jobs: new Map(),
  crm: store.read(KEYS.crm, {}),
  seen: store.read(KEYS.seen, {}),
  meta: store.read(KEYS.meta, null),
  filters: { ...DEFAULT_FILTERS, ...store.read(KEYS.filters, {}) },
  view: 'inbox',
  q: '',
  selectedId: null,
  visible: [],
  drafting: false,
};
if (!state.meta) {
  state.meta = { installedAt: Date.now(), lastVisit: Date.now() };
  store.write(KEYS.meta, state.meta);
}
const previousVisit = state.meta.lastVisit;

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '#');
const icon = id => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
const fitClass = s => (s >= 70 ? 'great' : s >= 45 ? 'good' : s >= 25 ? 'possible' : 'weak');

function ago(iso) {
  if (!iso) return 'date unknown';
  const mins = (Date.now() - Date.parse(iso)) / 60000;
  if (mins < 60) return `${Math.max(1, Math.round(mins))}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  const d = Math.round(mins / 1440);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<)]+/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

async function copy(text, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} to clipboard`);
  } catch {
    toast('Could not copy. Select the text and copy it manually.');
  }
}

// ---------- CRM (localStorage) ----------
const rec = id => state.crm[id] || {};
const statusOf = id => rec(id).status || null;

function updateRec(id, patch) {
  const job = state.jobs.get(id) || rec(id).snapshot;
  const next = { ...rec(id), ...patch, updatedAt: Date.now() };
  if (next.status && job) next.snapshot = job; // keep the post even after it drops off the boards
  if (!next.status && !next.note && !next.draft) delete state.crm[id];
  else state.crm[id] = next;
  store.write(KEYS.crm, state.crm);
}

function setStatus(id, status, { quiet = false } = {}) {
  const current = statusOf(id);
  const nextStatus = current === status ? null : status;
  const patch = { status: nextStatus };
  if (nextStatus === 'contacted' && !rec(id).contactedAt) patch.contactedAt = Date.now();
  if (nextStatus === 'replied') patch.repliedAt = Date.now();
  updateRec(id, patch);
  if (!quiet) toast(nextStatus ? `Moved to ${STATUS_LABEL[nextStatus]}` : 'Moved back to Matches');
  render();
}

// Every job we know about: live ones plus snapshots of tracked ones that have dropped off the feeds.
function allJobs() {
  const list = [...state.jobs.values()];
  for (const [id, r] of Object.entries(state.crm)) {
    if (r.status && r.snapshot && !state.jobs.has(id)) list.push({ ...r.snapshot, gone: true });
  }
  return list;
}

const isNew = j => {
  const first = state.seen[j.id];
  return first && first > state.meta.installedAt + 60_000 && first >= previousVisit - 1000 && !statusOf(j.id);
};

// ---------- filtering ----------
function inView(j, view) {
  const s = statusOf(j.id);
  if (view === 'inbox') return !s || s === 'saved';
  return s === view;
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
  const hay = `${j.title} ${j.company} ${j.location} ${j.matched.map(m => m.label).join(' ')} ${j.tags.join(' ')} ${j.description}`.toLowerCase();
  return state.q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
}

const CONTACT_RANK = { email: 0, apply: 1, signup: 2 };
function sortJobs(list) {
  const by = state.filters.sort;
  const t = j => Date.parse(j.postedAt || 0) || 0;
  return list.sort((a, b) => {
    if (by === 'newest') return t(b) - t(a);
    if (by === 'contact') return CONTACT_RANK[a.contactMethod] - CONTACT_RANK[b.contactMethod] || b.score - a.score;
    if (by === 'pay') return (b.salary ? 1 : 0) - (a.salary ? 1 : 0) || b.score - a.score;
    return b.score - a.score || t(b) - t(a);
  });
}

function computeVisible() {
  const jobs = allJobs();
  // Pipeline views show everything you have tracked; only Matches applies the filters.
  const base = jobs.filter(j => inView(j, state.view) && matchesQuery(j));
  state.visible = sortJobs(state.view === 'inbox' ? base.filter(passesFilters) : base);
}

// ---------- rendering ----------
function render() {
  computeVisible();
  renderViews();
  renderSources();
  renderSummary();
  renderList();
  renderDetail();
  saveFilters();
}

function renderViews() {
  const jobs = allJobs();
  const newCount = state.view === 'inbox' ? state.visible.filter(isNew).length : 0;
  $('#views').innerHTML = VIEWS.map((v, i) => {
    const count = v.id === 'inbox' ? (state.view === 'inbox' ? state.visible.length : jobs.filter(j => inView(j, 'inbox') && passesFilters(j)).length) : jobs.filter(j => inView(j, v.id)).length;
    const followUps = v.id === 'contacted' ? jobs.filter(needsFollowUp).length : 0;
    return `<button class="view-btn ${state.view === v.id ? 'active' : ''}" data-view="${v.id}" title="Press ${i + 1}">
      ${icon(v.icon)}<span>${v.label}</span>
      ${v.id === 'inbox' && newCount ? `<span class="badge-dot" title="New since your last visit">${newCount}</span>` : ''}
      ${followUps ? `<span class="badge-dot" title="Due a follow-up">${followUps}</span>` : ''}
      <span class="count">${count}</span></button>`;
  }).join('');
}

function needsFollowUp(j) {
  const r = rec(j.id);
  return r.status === 'contacted' && r.contactedAt && Date.now() - r.contactedAt > 4 * 86400_000;
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

function renderSummary() {
  const v = state.visible;
  if (!state.data) { $('#summary').textContent = 'Loading leads…'; return; }
  const emails = v.filter(j => j.contactMethod === 'email').length;
  const great = v.filter(j => j.score >= 70).length;
  $('#summary').innerHTML = `<strong>${v.length}</strong> leads · <strong>${great}</strong> great fits · <strong>${emails}</strong> with email`;
}

function card(j) {
  const s = statusOf(j.id);
  const fc = fitClass(j.score);
  const pills = [];
  if (j.salary) pills.push(`<span class="pill pay">${esc(j.salary)}</span>`);
  pills.push(`<span class="pill">${esc(j.type === 'Unspecified' ? 'Type not stated' : j.type)}</span>`);
  if (j.contactMethod === 'email') pills.push(`<span class="pill mail">${icon('i-mail')}Email</span>`);
  else if (j.contactMethod === 'apply') pills.push(`<span class="pill apply">${icon('i-link')}Apply link</span>`);
  else pills.push(`<span class="pill lock">${icon('i-lock')}Sign-up</span>`);
  if (j.contacts.phones.length) pills.push(`<span class="pill mail">${icon('i-phone')}Phone</span>`);
  if (j.locationFit === 'restricted') pills.push(`<span class="pill warn">Location locked</span>`);
  if (isNew(j)) pills.push(`<span class="pill new">New</span>`);
  if (s) pills.push(`<span class="pill status">${STATUS_LABEL[s]}</span>`);
  if (needsFollowUp(j)) pills.push(`<span class="pill warn">Follow up</span>`);
  if (j.gone) pills.push(`<span class="pill">No longer listed</span>`);

  return `<button class="card ${state.selectedId === j.id ? 'selected' : ''} ${s === 'hidden' ? 'dim' : ''}" data-id="${esc(j.id)}" role="option" aria-selected="${state.selectedId === j.id}">
    <div class="card-top">
      <span class="score fit-${fc}"><b>${j.score}</b>${esc(j.fit)}</span>
      <span class="right">${esc(j.sourceLabel)} · ${ago(j.postedAt)}</span>
    </div>
    <h4>${esc(j.title)}</h4>
    <div class="company">${esc(j.company || 'Company not named')}${j.location ? ` · ${esc(j.location)}` : ''}</div>
    <div class="row">${pills.join('')}</div>
    ${j.matched.length ? `<div class="skills">Matches: ${esc(j.matched.map(m => m.label).join(', '))}</div>` : ''}
  </button>`;
}

function renderList() {
  const el = $('#list');
  if (!state.data) {
    el.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join('');
    return;
  }
  if (!state.visible.length) {
    const msg = {
      inbox: ['No leads match these filters', 'Lower the minimum match, widen "Posted within", or reset the filters.'],
      saved: ['Nothing saved yet', 'Press S on a lead (or the Save button) to keep it here.'],
      contacted: ['No one contacted yet', 'When you send an offer from a lead it moves here automatically.'],
      replied: ['No replies tracked yet', 'Mark a contacted lead as Replied when they answer.'],
      hidden: ['Nothing hidden', 'Hide leads that are not a fit to keep Matches clean.'],
    }[state.view];
    el.innerHTML = `<div class="empty"><h3>${msg[0]}</h3><p>${msg[1]}</p>${state.view === 'inbox' ? '<button class="btn" data-action="reset">Reset filters</button>' : ''}</div>`;
    return;
  }
  el.innerHTML = state.visible.slice(0, 400).map(card).join('') +
    (state.visible.length > 400 ? `<div class="empty">Showing the top 400. Raise the minimum match to narrow it down.</div>` : '');
}

function contactRows(j) {
  const rows = [];
  for (const e of j.contacts.emails) {
    rows.push(`<div class="contact-row"><div class="what">${icon('i-mail')}<span class="lbl">Email</span><span>${esc(e)}</span></div>
      <div class="tools"><button class="btn btn-sm" data-copy="${esc(e)}">${icon('i-copy')}Copy</button>
      <button class="btn btn-sm btn-primary" data-action="draft-to" data-email="${esc(e)}">${icon('i-spark')}Write offer</button></div></div>`);
  }
  for (const p of j.contacts.phones) {
    rows.push(`<div class="contact-row"><div class="what">${icon('i-phone')}<span class="lbl">Phone</span><span>${esc(p.display)}</span></div>
      <div class="tools"><button class="btn btn-sm" data-copy="${esc(p.display)}">${icon('i-copy')}Copy</button>
      <a class="btn btn-sm" target="_blank" rel="noopener" href="https://wa.me/${esc(p.digits)}?text=${encodeURIComponent(`Hi, I saw your post for "${j.title}" and I'd love to help. Is it still open?`)}">${icon('i-whatsapp')}WhatsApp</a></div></div>`);
  }
  for (const l of j.contacts.links) {
    rows.push(`<div class="contact-row"><div class="what">${icon('i-link')}<span class="lbl">${esc(l.kind)}</span><span>${esc(l.url)}</span></div>
      <div class="tools"><a class="btn btn-sm" target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(l.url))}">Open</a></div></div>`);
  }
  if (j.applyUrl && j.applyUrl !== j.url) {
    rows.push(`<div class="contact-row"><div class="what">${icon('i-link')}<span class="lbl">Apply</span><span>${esc(j.applyUrl)}</span></div>
      <div class="tools"><a class="btn btn-sm" target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(j.applyUrl))}">Open</a></div></div>`);
  }
  rows.push(`<div class="contact-row"><div class="what">${icon('i-link')}<span class="lbl">Job post</span><span>${esc(j.sourceLabel)}</span></div>
    <div class="tools"><a class="btn btn-sm" target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(j.url))}">Open post</a></div></div>`);
  return rows.join('');
}

function renderDetail() {
  const el = $('#detail');
  const j = state.selectedId && (state.jobs.get(state.selectedId) || (rec(state.selectedId).snapshot && { ...rec(state.selectedId).snapshot, gone: true }));
  if (!j) {
    document.body.classList.remove('detail-open');
    el.dataset.id = '';
    el.innerHTML = `<div class="detail-empty"><div>${icon('i-inbox')}<h3>Pick a lead</h3><p>Select a lead on the left to see contacts, requirements and an offer draft.<br>Use <kbd>j</kbd> and <kbd>k</kbd> to move through the list.</p></div></div>`;
    return;
  }
  const s = statusOf(j.id);
  const r = rec(j.id);
  // Only rebuild when something shown here changed, so typing and scrolling are never interrupted.
  const sig = `${j.id}|${s}|${r.contactedAt || ''}|${state.drafting}|${Boolean(r.draft)}|${state.data?.ai}`;
  if (el.dataset.id === sig) return;
  if (el.dataset.id?.startsWith(`${j.id}|`) && el.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
  el.dataset.id = sig;
  const fc = fitClass(j.score);
  const draft = r.draft || null;
  const groups = {};
  for (const m of j.matched) (groups[m.group] ||= []).push(m);

  el.innerHTML = `<article class="detail">
    <button class="btn btn-sm detail-back" data-action="close-detail">${icon('i-back')}Back to list</button>
    <div class="d-head">
      <div class="ring" style="--p:${j.score};--c:var(--${fc})"><span>${j.score}</span></div>
      <div class="d-title">
        <h2>${esc(j.title)}</h2>
        <div class="company">${esc(j.company || 'Company not named')}</div>
        <div class="fitline fit-${fc}">${esc(j.fit)} for your skills${j.gone ? ' · no longer listed on the board' : ''}</div>
      </div>
    </div>

    <div class="facts">
      <div class="fact"><div class="k">Pay / offer</div><div class="v">${esc(j.salary || 'Not stated')}</div></div>
      <div class="fact"><div class="k">Type</div><div class="v">${esc(j.type === 'Unspecified' ? 'Not stated' : j.type)}</div></div>
      <div class="fact"><div class="k">Location</div><div class="v">${esc(j.location || 'Not stated')}</div></div>
      <div class="fact"><div class="k">Posted</div><div class="v">${ago(j.postedAt)} · ${esc(j.sourceLabel)}</div></div>
      ${j.meta?.bids != null ? `<div class="fact"><div class="k">Bids so far</div><div class="v">${j.meta.bids}</div></div>` : ''}
    </div>

    <div class="actions">
      <button class="btn ${s === 'saved' ? 'is-on' : ''}" data-status="saved">${icon('i-bookmark')}${s === 'saved' ? 'Saved' : 'Save'}</button>
      <button class="btn ${s === 'contacted' ? 'is-on' : ''}" data-status="contacted">${icon('i-send')}${s === 'contacted' ? 'Contacted' : 'Mark contacted'}</button>
      <button class="btn ${s === 'replied' ? 'is-on' : ''}" data-status="replied">${icon('i-reply')}${s === 'replied' ? 'Replied' : 'They replied'}</button>
      <button class="btn ${s === 'hidden' ? 'is-on' : ''}" data-status="hidden">${icon('i-eye-off')}${s === 'hidden' ? 'Hidden' : 'Not a fit'}</button>
      <a class="btn" href="${esc(safeUrl(j.url))}" target="_blank" rel="noopener noreferrer">${icon('i-link')}Open post</a>
    </div>
    ${r.contactedAt ? `<div class="meta-line">Contacted ${new Date(r.contactedAt).toLocaleDateString()}${r.contactedVia ? ` via ${esc(r.contactedVia)}` : ''}${needsFollowUp(j) ? ' · due a follow-up' : ''}</div>` : ''}

    <section class="block">
      <h3>How to reach them</h3>
      ${j.signupRequired ? `<div class="callout" style="margin-bottom:10px">${icon('i-lock')}<div>${esc(j.sourceLabel)} only lets you reply after signing up. The offer below still works as your bid text.</div></div>` : ''}
      ${!j.contacts.emails.length && !j.signupRequired ? `<div class="callout" style="margin-bottom:10px">${icon('i-link')}<div>No email in the post. Apply through the link (usually no account needed), or find the company's email on their website and send the offer below.</div></div>` : ''}
      <div class="contact-card">${contactRows(j)}</div>
    </section>

    <section class="block">
      <h3>Why it matches you</h3>
      ${j.matched.length ? Object.entries(groups).map(([g, ms]) => `<div class="tags" style="margin-bottom:6px">${ms.map(m => `<span class="tag ${m.inTitle ? 'title-hit' : ''}" title="${m.inTitle ? 'In the job title' : 'In the description'}">${esc(m.label)}</span>`).join('')}</div>`).join('') : '<p class="muted">No direct skill keywords found.</p>'}
      ${j.warnings.length ? `<div class="warns">${j.warnings.map(w => `<div class="callout">${esc(w)}</div>`).join('')}</div>` : ''}
    </section>

    ${j.requirements.length ? `<section class="block"><h3>Requirements</h3><ul class="reqs">${j.requirements.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}

    <section class="block">
      <h3>Description</h3>
      <div class="desc clamped" id="desc">${linkify(j.description)}</div>
      <button class="btn btn-sm" data-action="toggle-desc" style="margin-top:8px">Show full description</button>
    </section>

    <section class="block" id="composer-block">
      <h3>${icon('i-spark')}Your offer</h3>
      <div class="composer">
        <div class="composer-top">
          <button class="btn btn-primary" data-action="draft" ${state.drafting ? 'disabled' : ''}>${icon('i-spark')}${state.drafting ? 'Writing…' : draft ? 'Rewrite with AI' : state.data?.ai ? 'Draft offer with AI' : 'Draft offer'}</button>
          <span class="muted" style="font-size:12px">${state.data?.ai ? 'Claude reads the post and writes a tailored email.' : 'AI is off, so this uses a smart template. Add ANTHROPIC_API_KEY to turn on AI.'}</span>
        </div>
        <details class="extra"><summary>Add a note for this draft (optional)</summary>
          <div class="field"><input id="extra" placeholder="e.g. mention I can start Monday, quote A$45/hr" value="${esc(r.extra || '')}"></div>
        </details>
        ${draft?.ai ? aiResult(draft.ai) : ''}
        ${draft ? composerFields(j, draft) : ''}
      </div>
    </section>

    <section class="block">
      <h3>Notes</h3>
      <textarea class="note-area" id="note" placeholder="Private notes: who you spoke to, follow-up date, rate quoted…">${esc(r.note || '')}</textarea>
    </section>
  </article>`;
}

function aiResult(ai) {
  return `<div class="ai-result">
    <div><span class="verdict">${esc(ai.verdict)}</span> · AI fit ${ai.fit_score}/100</div>
    <div class="muted" style="margin-top:2px">${esc(ai.pitch_angle)}</div>
    <div class="cols">
      <div><strong>Why you fit</strong><ul>${ai.why_you_fit.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div><strong>Watch out for</strong>${ai.concerns.length ? `<ul>${ai.concerns.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted" style="margin:6px 0 0">Nothing flagged.</p>'}</div>
    </div>
  </div>`;
}

function composerFields(j, d) {
  const emails = j.contacts.emails;
  return `
    <label class="field"><span>To</span>
      <input id="to" list="to-list" value="${esc(d.to || emails[0] || '')}" placeholder="${emails.length ? '' : 'No email in the post: paste one, or copy the text into their form'}">
      <datalist id="to-list">${emails.map(e => `<option value="${esc(e)}">`).join('')}</datalist>
    </label>
    <label class="field"><span>Subject</span><input id="subject" value="${esc(d.subject)}"></label>
    <label class="field"><span>Message</span><textarea id="body">${esc(d.body)}</textarea></label>
    <div class="send-row">
      <button class="btn btn-primary" data-send="gmail">${icon('i-send')}Send with Gmail</button>
      <button class="btn" data-send="mailto">${icon('i-mail')}Open in mail app</button>
      <button class="btn" data-send="copy">${icon('i-copy')}Copy message</button>
      ${!emails.length ? `<a class="btn" data-send="apply" href="${esc(safeUrl(j.applyUrl || j.url))}" target="_blank" rel="noopener noreferrer">${icon('i-link')}Copy + open ${j.signupRequired ? 'bid page' : 'apply page'}</a>` : ''}
    </div>
    <div class="meta-line">Sending marks this lead as Contacted. Gmail opens a ready-to-send compose window as ${esc(state.data?.profile?.email || 'you')}.</div>`;
}

// ---------- offer drafting ----------
function templateDraft(j) {
  const p = state.data.profile;
  const skills = j.matched.map(m => m.label).filter(l => !/^(AI \/ LLMs|Automation|CRM|Webhooks)/.test(l)).slice(0, 3);
  const proofs = (p.proofPoints || []).filter(pp => j.matched.some(m => pp.toLowerCase().includes(m.label.split(/[ /]/)[0].toLowerCase()))).slice(0, 2);
  const who = j.company && !/freelancer\.com client/i.test(j.company) ? `Hi ${j.company} team,` : 'Hi there,';
  const lines = [
    who,
    '',
    `I saw your post for ${j.title} and it lines up closely with the work I do every week${skills.length ? `: ${joinList(skills)}` : ''}.`,
    '',
    proofs.length ? `A couple of recent examples: ${proofs.map(x => (/^[A-Z][a-z]/.test(x) ? x.charAt(0).toLowerCase() + x.slice(1) : x)).join('; ')}.` : `I help small and mid-size businesses connect their CRM, website and automations so leads stop slipping through the cracks.`,
    '',
    j.type === 'Full-time'
      ? `I work as a remote contractor from the Philippines (AU, SG and UAE clients), so I can take this on part-time or as a fixed-scope project if that suits you.`
      : `I work remotely from the Philippines with clients in Australia, Singapore and the UAE, and I can start this week.`,
    '',
    `Would a quick 15-minute call work? If it's easier, I can send a short Loom walkthrough of how I'd set this up first.`,
    '',
    'Best,',
    p.name,
    `Antheon · ${p.website}`,
    p.email,
  ];
  return { subject: `Re: ${j.title}`.slice(0, 90), body: lines.join('\n'), to: j.contacts.emails[0] || '' };
}

const joinList = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);

async function draftOffer(id, toEmail) {
  const j = state.jobs.get(id) || rec(id).snapshot;
  if (!j || state.drafting) return;
  const extra = $('#extra')?.value || '';
  updateRec(id, { extra });

  if (!state.data.ai) {
    const d = templateDraft(j);
    if (toEmail) d.to = toEmail;
    updateRec(id, { draft: d });
    forceDetail();
    focusComposer();
    return;
  }

  state.drafting = true;
  forceDetail();
  try {
    const res = await fetch('/api/proposal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job: j, extra }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    updateRec(id, { draft: { subject: data.subject, body: data.body, to: toEmail || j.contacts.emails[0] || '', ai: data } });
  } catch (err) {
    toast(`AI draft failed (${err.message}). Using the template.`);
    const d = templateDraft(j);
    if (toEmail) d.to = toEmail;
    updateRec(id, { draft: d });
  } finally {
    state.drafting = false;
    forceDetail();
    focusComposer();
  }
}

function forceDetail() {
  $('#detail').dataset.id = '';
  renderDetail();
}

function focusComposer() {
  $('#composer-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function currentDraft() {
  return { to: $('#to')?.value.trim() || '', subject: $('#subject')?.value || '', body: $('#body')?.value || '' };
}

function sendDraft(kind, id) {
  const j = state.jobs.get(id) || rec(id).snapshot;
  const d = currentDraft();
  updateRec(id, { draft: { ...rec(id).draft, ...d } });

  if (kind === 'copy') return copy(`${d.subject}\n\n${d.body}`, 'Message copied');
  if (kind === 'apply') {
    copy(d.body, 'Message copied');
  } else {
    if (!d.to) { toast('Add an email address in the To field first.'); $('#to')?.focus(); return false; }
    const url = kind === 'gmail'
      ? `https://mail.google.com/mail/?view=cm&fs=1&authuser=${encodeURIComponent(state.data.profile.email)}&to=${encodeURIComponent(d.to)}&su=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`
      : `mailto:${encodeURIComponent(d.to)}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
    window.open(url, kind === 'gmail' ? '_blank' : '_self', 'noopener');
  }
  if (statusOf(id) !== 'contacted' && statusOf(id) !== 'replied') {
    updateRec(id, { status: 'contacted', contactedAt: Date.now(), contactedVia: kind === 'gmail' ? 'Gmail' : kind === 'mailto' ? 'email' : j?.signupRequired ? 'platform bid' : 'apply form' });
    toast('Marked as Contacted');
    render();
  }
}

// ---------- data ----------
async function load({ force = false } = {}) {
  const btn = $('#btn-refresh');
  btn.disabled = true;
  btn.classList.add('spinning');
  try {
    const res = await fetch(force ? `/api/jobs?refresh=${Date.now()}` : '/api/jobs');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.data = data;
    state.jobs = new Map(data.jobs.map(j => [j.id, j]));

    const now = Date.now();
    for (const j of data.jobs) if (!state.seen[j.id]) state.seen[j.id] = now;
    // Forget ids not seen for 60 days so storage stays small.
    for (const [id, t] of Object.entries(state.seen)) if (now - t > 60 * 86400_000 && !state.jobs.has(id)) delete state.seen[id];
    store.write(KEYS.seen, state.seen);
    store.write(KEYS.meta, { ...state.meta, lastVisit: now });

    $('#updated').textContent = `Updated ${new Date(data.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    const failed = data.sources.filter(s => !s.ok);
    if (failed.length) toast(`Could not reach: ${failed.map(s => s.label).join(', ')}`);
    else if (force) toast(`${data.jobs.length} leads pulled from ${data.sources.length} boards`);
    render();
    if (!state.selectedId && window.innerWidth > 820 && state.visible[0]) select(state.visible[0].id, { open: false });
  } catch (err) {
    if (!state.data) {
      $('#list').innerHTML = `<div class="empty"><h3>Could not load leads</h3><p>${esc(err.message)}. Check your connection and try again.</p><button class="btn" data-action="retry">Try again</button></div>`;
    } else toast(`Refresh failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.classList.remove('spinning');
  }
}

// ---------- filters UI ----------
function syncFilterControls() {
  const f = state.filters;
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

function saveFilters() {
  store.write(KEYS.filters, state.filters);
}

function select(id, { open = true } = {}) {
  state.selectedId = id;
  document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
  const el = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  el?.classList.add('selected');
  el?.scrollIntoView({ block: 'nearest' });
  renderDetail();
  $('#detail').scrollTop = 0;
  if (open) document.body.classList.add('detail-open');
}

function move(delta) {
  if (!state.visible.length) return;
  const i = state.visible.findIndex(j => j.id === state.selectedId);
  const next = state.visible[Math.max(0, Math.min(state.visible.length - 1, i + delta))] || state.visible[0];
  select(next.id, { open: false });
}

function exportCsv() {
  const cols = ['score', 'fit', 'status', 'title', 'company', 'salary', 'type', 'location', 'emails', 'phones', 'url', 'applyUrl', 'source', 'postedAt', 'note'];
  const rows = state.visible.map(j => [
    j.score, j.fit, statusOf(j.id) || '', j.title, j.company, j.salary || '', j.type, j.location,
    j.contacts.emails.join(' '), j.contacts.phones.map(p => p.display).join(' '), j.url, j.applyUrl || '', j.sourceLabel, j.postedAt || '', rec(j.id).note || '',
  ]);
  const csv = [cols, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `jobalert-${state.view}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- events ----------
document.addEventListener('click', e => {
  const t = e.target.closest('button, a, [data-copy]');
  if (!t) return;

  if (t.matches('.card')) return select(t.dataset.id);
  if (t.dataset.view) {
    state.view = t.dataset.view;
    closeFilters();
    return render();
  }
  if (t.dataset.copy) return copy(t.dataset.copy);
  if (t.dataset.status && state.selectedId) return setStatus(state.selectedId, t.dataset.status);
  if (t.dataset.send && state.selectedId) {
    if (t.dataset.send !== 'apply') e.preventDefault();
    return sendDraft(t.dataset.send, state.selectedId);
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
    case 'draft': return draftOffer(state.selectedId);
    case 'draft-to': return draftOffer(state.selectedId, t.dataset.email);
    case 'toggle-desc': {
      const d = $('#desc');
      d.classList.toggle('clamped');
      t.textContent = d.classList.contains('clamped') ? 'Show full description' : 'Show less';
      return;
    }
    case 'close-detail': return document.body.classList.remove('detail-open');
    case 'retry': return load();
    case 'reset':
    case 'btn-reset':
      state.filters = { ...DEFAULT_FILTERS };
      syncFilterControls();
      return render();
    case 'btn-refresh': return load({ force: true });
    case 'btn-export': return exportCsv();
    case 'btn-help': return $('#help').showModal();
    case 'btn-filters': return document.body.classList.add('filters-open');
    case 'btn-close-filters': return closeFilters();
  }
});

const closeFilters = () => document.body.classList.remove('filters-open');
$('#scrim').addEventListener('click', closeFilters);

$('#q').addEventListener('input', e => {
  state.q = e.target.value.trim();
  render();
});
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
$('#sources').addEventListener('change', e => {
  const boxes = [...document.querySelectorAll('#sources input')];
  const on = boxes.filter(b => b.checked).map(b => b.dataset.source);
  state.filters.sources = on.length === boxes.length ? null : on;
  render();
});

// Notes and draft edits save as you type.
let saveTimer;
$('#detail').addEventListener('input', e => {
  const id = state.selectedId;
  if (!id) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (e.target.id === 'note') updateRec(id, { note: e.target.value });
    else if (['to', 'subject', 'body'].includes(e.target.id)) updateRec(id, { draft: { ...rec(id).draft, ...currentDraft() } });
    else if (e.target.id === 'extra') updateRec(id, { extra: e.target.value });
  }, 300);
});

document.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select')) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey || $('#help').open) return;
  const id = state.selectedId;
  const k = e.key;
  if (k === '/') { e.preventDefault(); return $('#q').focus(); }
  if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); return move(1); }
  if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); return move(-1); }
  if (k === '?') return $('#help').showModal();
  if (k === 'Escape') { closeFilters(); return document.body.classList.remove('detail-open'); }
  if (/^[1-5]$/.test(k)) { state.view = VIEWS[Number(k) - 1].id; return render(); }
  if (!id) return;
  const keep = () => {
    // After triaging, move to the next lead so you can keep going with the keyboard.
    const i = state.visible.findIndex(j => j.id === id);
    const after = state.visible[i + 1] || state.visible[i - 1];
    return after?.id;
  };
  if (k === 's') return setStatus(id, 'saved');
  if (k === 'c') return setStatus(id, 'contacted');
  if (k === 'r') return setStatus(id, 'replied');
  if (k === 'h') {
    const next = keep();
    setStatus(id, 'hidden');
    if (next && state.view !== 'hidden') select(next, { open: false });
    return;
  }
  if (k === 'o') { const j = state.jobs.get(id); if (j) window.open(safeUrl(j.url), '_blank', 'noopener'); return; }
  if (k === 'd') return draftOffer(id);
});

// ---------- start ----------
syncFilterControls();
render();
load();
// Pick up new posts while the tab stays open.
setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30 * 60_000);
