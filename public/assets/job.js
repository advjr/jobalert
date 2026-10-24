// The job page, opened in a new tab from a tile's "Offer" button: contacts, why it matches,
// the full post, an AI-drafted offer and private notes. Changes are saved to localStorage,
// and the dashboard tab picks them up straight away.

import {
  $, KEYS, STATUS_LABEL, store, rec, statusOf, updateRec, setStatus, needsFollowUp, findPeek,
  esc, safeUrl, icon, fitClass, ago, linkify, toast, copy, boot,
} from './core.js';

const id = new URLSearchParams(location.search).get('id') || '';
const state = { job: null, profile: null, ai: false, drafting: false };

// ---------- finding the job ----------
function fromLocal() {
  const peeked = findPeek(id);
  if (peeked) return peeked;
  if (rec(id).snapshot) return { ...rec(id).snapshot, gone: true };
  for (const scan of Object.values(store.read(KEYS.social, {}))) {
    const hit = (scan.posts || []).find(p => p.id === id);
    if (hit) return hit;
  }
  return null;
}

async function fromApi() {
  const country = store.read(KEYS.filters, {}).country || 'au';
  const res = await fetch(`/api/jobs?country=${country}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  store.write(KEYS.profile, { profile: data.profile, ai: data.ai });
  return { data, job: data.jobs.find(j => j.id === id) || null };
}

// ---------- rendering ----------
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
  rows.push(`<div class="contact-row"><div class="what">${icon('i-link')}<span class="lbl">${j.kind === 'social' ? 'Post' : 'Job post'}</span><span>${esc(j.sourceLabel)}</span></div>
    <div class="tools"><a class="btn btn-sm" target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(j.url))}">Open ${j.kind === 'social' ? 'post' : 'job post'}</a></div></div>`);
  return rows.join('');
}

function actionsHtml(j) {
  const s = statusOf(j.id);
  const r = rec(j.id);
  return `<div class="actions">
      <button class="btn ${s === 'saved' ? 'is-on' : ''}" data-status="saved">${icon('i-bookmark')}${s === 'saved' ? 'Saved' : 'Save'}</button>
      <button class="btn ${s === 'contacted' ? 'is-on' : ''}" data-status="contacted">${icon('i-send')}${s === 'contacted' ? 'Contacted' : 'Mark contacted'}</button>
      <button class="btn ${s === 'replied' ? 'is-on' : ''}" data-status="replied">${icon('i-reply')}${s === 'replied' ? 'Replied' : 'They replied'}</button>
      <button class="btn ${s === 'hidden' ? 'is-on' : ''}" data-status="hidden">${icon('i-eye-off')}${s === 'hidden' ? 'Hidden' : 'Not a fit'}</button>
    </div>
    ${r.contactedAt ? `<div class="meta-line">Contacted ${new Date(r.contactedAt).toLocaleDateString()}${r.contactedVia ? ` via ${esc(r.contactedVia)}` : ''}${needsFollowUp(j.id) ? ' · due a follow-up' : ''}</div>` : ''}`;
}

function renderPage() {
  const j = state.job;
  const fc = fitClass(j.score);
  const groups = {};
  for (const m of j.matched) (groups[m.group] ||= []).push(m);
  const social = j.kind === 'social';
  document.title = `${j.title} · JobAlert`;

  $('#page').innerHTML = `<div class="job-layout">
    <article class="job-main">
      <div class="d-head">
        <div class="ring" style="--p:${j.score};--c:var(--${fc})"><span>${j.score}</span></div>
        <div class="d-title">
          <h1>${esc(j.title)}</h1>
          <div class="company">${esc(j.company || 'Company not named')}</div>
          <div class="fitline fit-${fc}">${esc(j.fit)} for your skills${j.gone ? ' · no longer listed on the board' : ''}</div>
        </div>
      </div>

      <a class="btn btn-primary open-post" href="${esc(safeUrl(j.url))}" target="_blank" rel="noopener noreferrer">${icon('i-link')}Open the original ${social ? 'post' : 'job post'} on ${esc(j.sourceLabel)}</a>

      <div class="facts">
        ${social ? '' : `<div class="fact"><div class="k">Pay / offer</div><div class="v">${esc(j.salary || 'Not stated')}</div></div>
        <div class="fact"><div class="k">Type</div><div class="v">${esc(j.type === 'Unspecified' ? 'Not stated' : j.type)}</div></div>`}
        <div class="fact"><div class="k">Location</div><div class="v">${esc(j.location || 'Not stated')}</div></div>
        <div class="fact"><div class="k">Posted</div><div class="v">${ago(j.postedAt)} · ${esc(j.sourceLabel)}</div></div>
        ${j.meta?.bids != null ? `<div class="fact"><div class="k">Bids so far</div><div class="v">${j.meta.bids}</div></div>` : ''}
      </div>

      <div id="actions">${actionsHtml(j)}</div>

      <section class="block">
        <h2>How to reach them</h2>
        ${j.signupRequired ? `<div class="callout">${icon('i-lock')}<div>${social ? `Reply on ${esc(j.sourceLabel)} (comment or DM) while logged in. The offer on this page works as your message.` : `${esc(j.sourceLabel)} only lets you reply after signing up. The offer on this page still works as your bid text.`}</div></div>` : ''}
        ${!j.contacts.emails.length && !j.signupRequired ? `<div class="callout">${icon('i-link')}<div>No email in the post. Apply through the link (usually no account needed), or find the company's email on their website and send the offer.</div></div>` : ''}
        <div class="contact-card">${contactRows(j)}</div>
      </section>

      <section class="block">
        <h2>Why it matches you</h2>
        ${j.matched.length ? Object.values(groups).map(ms => `<div class="tags">${ms.map(m => `<span class="tag ${m.inTitle ? 'title-hit' : ''}" title="${m.inTitle ? 'In the title' : 'In the description'}">${esc(m.label)}</span>`).join('')}</div>`).join('') : '<p class="muted">No direct skill keywords found.</p>'}
        ${j.warnings.length ? `<div class="warns">${j.warnings.map(w => `<div class="callout">${esc(w)}</div>`).join('')}</div>` : ''}
      </section>

      ${j.requirements.length ? `<section class="block"><h2>Requirements</h2><ul class="reqs">${j.requirements.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}

      <section class="block">
        <h2>${social ? 'The post' : 'Description'}</h2>
        ${j.meta?.partial ? `<p class="muted">${esc(j.sourceLabel)} only shares a summary here. Open the post for the full description.</p>` : ''}
        <div class="desc">${linkify(j.description || 'No description available.')}</div>
      </section>
    </article>

    <aside class="job-side">
      <section class="side-card" id="composer"></section>
      <section class="side-card">
        <h2>Notes</h2>
        <textarea class="note-area" id="note" placeholder="Private notes: who you spoke to, follow-up date, rate quoted…">${esc(rec(j.id).note || '')}</textarea>
      </section>
    </aside>
  </div>`;
  renderComposer();
}

function renderComposer() {
  const j = state.job;
  const r = rec(j.id);
  const draft = r.draft || null;
  $('#composer').innerHTML = `
    <h2>${icon('i-spark')}Your offer</h2>
    <div class="composer-top">
      <button class="btn btn-primary" data-action="draft" ${state.drafting ? 'disabled' : ''}>${icon('i-spark')}${state.drafting ? 'Writing…' : draft ? 'Rewrite with AI' : state.ai ? 'Draft offer with AI' : 'Draft offer'}</button>
    </div>
    <p class="muted small">${state.ai ? 'Claude reads the post and writes a tailored message.' : 'AI is off, so this uses a smart template. Add ANTHROPIC_API_KEY to turn on AI.'}</p>
    <details class="extra"><summary>Add a note for this draft (optional)</summary>
      <div class="field"><input id="extra" placeholder="e.g. mention I can start Monday, quote A$45/hr" value="${esc(r.extra || '')}"></div>
    </details>
    ${draft?.ai ? aiResult(draft.ai) : ''}
    ${draft ? composerFields(j, draft) : ''}`;
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
      <input id="to" list="to-list" value="${esc(d.to || emails[0] || '')}" placeholder="${emails.length ? '' : 'No email in the post: paste one, or copy the text'}">
      <datalist id="to-list">${emails.map(e => `<option value="${esc(e)}">`).join('')}</datalist>
    </label>
    <label class="field"><span>Subject</span><input id="subject" value="${esc(d.subject)}"></label>
    <label class="field"><span>Message</span><textarea id="body">${esc(d.body)}</textarea></label>
    <div class="send-row">
      <button class="btn btn-primary" data-send="gmail">${icon('i-send')}Send with Gmail</button>
      <button class="btn" data-send="mailto">${icon('i-mail')}Mail app</button>
      <button class="btn" data-send="copy">${icon('i-copy')}Copy</button>
      ${!emails.length ? `<a class="btn" data-send="apply" href="${esc(safeUrl(j.applyUrl || j.url))}" target="_blank" rel="noopener noreferrer">${icon('i-link')}Copy + open ${j.kind === 'social' ? 'post' : j.signupRequired ? 'bid page' : 'apply page'}</a>` : ''}
    </div>
    <div class="meta-line">Sending marks this lead as Contacted. Gmail opens a ready-to-send compose window as ${esc(state.profile?.email || 'you')}.</div>`;
}

// ---------- offer drafting ----------
const joinList = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);

function templateDraft(j) {
  const p = state.profile || {};
  const skills = j.matched.map(m => m.label).filter(l => !/^(AI \/ LLMs|Automation|CRM|Webhooks)/.test(l)).slice(0, 3);
  const proofs = (p.proofPoints || []).filter(pp => j.matched.some(m => pp.toLowerCase().includes(m.label.split(/[ /]/)[0].toLowerCase()))).slice(0, 2);
  const named = j.company && !/freelancer\.com client| post$/i.test(j.company);
  const lines = [
    named ? (j.kind === 'social' ? `Hi ${j.company.split(' ')[0]},` : `Hi ${j.company} team,`) : 'Hi there,',
    '',
    `I saw your ${j.kind === 'social' ? 'post' : 'post for'} ${j.kind === 'social' ? `about ${j.title.replace(/^looking for /i, '').toLowerCase()}` : j.title} and it lines up closely with the work I do every week${skills.length ? `: ${joinList(skills)}` : ''}.`,
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
    p.name || '',
    `Antheon · ${p.website || ''}`,
    p.email || '',
  ];
  return { subject: `Re: ${j.title}`.slice(0, 90), body: lines.join('\n'), to: j.contacts.emails[0] || '' };
}

async function draftOffer(toEmail) {
  const j = state.job;
  if (state.drafting) return;
  const extra = $('#extra')?.value || '';
  updateRec(j.id, { extra }, j);

  if (!state.ai) {
    const d = templateDraft(j);
    if (toEmail) d.to = toEmail;
    updateRec(j.id, { draft: d }, j);
    renderComposer();
    return;
  }

  state.drafting = true;
  renderComposer();
  try {
    const res = await fetch('/api/proposal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job: j, extra }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    updateRec(j.id, { draft: { subject: data.subject, body: data.body, to: toEmail || j.contacts.emails[0] || '', ai: data } }, j);
  } catch (err) {
    toast(`AI draft failed (${err.message}). Using the template.`);
    const d = templateDraft(j);
    if (toEmail) d.to = toEmail;
    updateRec(j.id, { draft: d }, j);
  } finally {
    state.drafting = false;
    renderComposer();
    $('#composer').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

const currentDraft = () => ({ to: $('#to')?.value.trim() || '', subject: $('#subject')?.value || '', body: $('#body')?.value || '' });

function sendDraft(kind) {
  const j = state.job;
  const d = currentDraft();
  updateRec(j.id, { draft: { ...rec(j.id).draft, ...d } }, j);

  if (kind === 'copy') return copy(`${d.subject}\n\n${d.body}`, 'Message copied');
  if (kind === 'apply') {
    copy(d.body, 'Message copied');
  } else {
    if (!d.to) { toast('Add an email address in the To field first.'); $('#to')?.focus(); return; }
    const url = kind === 'gmail'
      ? `https://mail.google.com/mail/?view=cm&fs=1&authuser=${encodeURIComponent(state.profile?.email || '')}&to=${encodeURIComponent(d.to)}&su=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`
      : `mailto:${encodeURIComponent(d.to)}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
    window.open(url, kind === 'gmail' ? '_blank' : '_self', 'noopener');
  }
  if (statusOf(j.id) !== 'contacted' && statusOf(j.id) !== 'replied') {
    const via = kind === 'gmail' ? 'Gmail' : kind === 'mailto' ? 'email' : j.kind === 'social' ? `${j.sourceLabel} reply` : j.signupRequired ? 'platform bid' : 'apply form';
    updateRec(j.id, { status: 'contacted', contactedAt: Date.now(), contactedVia: via }, j);
    toast('Marked as Contacted');
    $('#actions').innerHTML = actionsHtml(j);
  }
}

// ---------- events ----------
document.addEventListener('click', e => {
  const t = e.target.closest('button, a, [data-copy]');
  if (!t || !state.job) return;
  if (t.dataset.copy) return copy(t.dataset.copy);
  if (t.dataset.status) {
    const now = setStatus(state.job.id, t.dataset.status, state.job);
    toast(now ? `Moved to ${STATUS_LABEL[now]}` : 'Moved back to the grid');
    $('#actions').innerHTML = actionsHtml(state.job);
    return;
  }
  if (t.dataset.send) {
    if (t.dataset.send !== 'apply') e.preventDefault();
    return sendDraft(t.dataset.send);
  }
  if (t.dataset.action === 'draft') return draftOffer();
  if (t.dataset.action === 'draft-to') return draftOffer(t.dataset.email);
});

// Notes and draft edits save as you type.
let saveTimer;
$('#page').addEventListener('input', e => {
  const j = state.job;
  if (!j) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (e.target.id === 'note') updateRec(j.id, { note: e.target.value }, j);
    else if (['to', 'subject', 'body'].includes(e.target.id)) updateRec(j.id, { draft: { ...rec(j.id).draft, ...currentDraft() } }, j);
    else if (e.target.id === 'extra') updateRec(j.id, { extra: e.target.value }, j);
  }, 300);
});

// ---------- start ----------
boot();
const saved = store.read(KEYS.profile, {});
state.profile = saved.profile || null;
state.ai = Boolean(saved.ai);
state.job = fromLocal();
if (state.job && state.profile) {
  renderPage();
} else {
  $('#page').innerHTML = '<div class="empty"><h3>Loading…</h3></div>';
  try {
    const { data, job } = await fromApi();
    state.profile = data.profile;
    state.ai = data.ai;
    state.job ||= job;
    if (state.job) renderPage();
    else $('#page').innerHTML = '<div class="empty"><h3>This lead is no longer listed</h3><p>It has dropped off the boards. Go back to the dashboard for current leads.</p><a class="btn" href="./">All leads</a></div>';
  } catch (err) {
    $('#page').innerHTML = `<div class="empty"><h3>Could not load this lead</h3><p>${esc(err.message)}</p><a class="btn" href="./">All leads</a></div>`;
  }
}
