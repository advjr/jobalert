// Pull every source in parallel, normalise, extract contacts, score, dedupe.
// Nothing is stored: results live in this function instance's memory for the
// source's TTL (so we stay polite to the boards) and are rebuilt after that.

import { SOURCES } from './sources.js';
import { htmlToText, clip } from './text.js';
import { extractEmails, extractPhones, extractLinks, extractRequirements, extractSalary, classifyJobType } from './extract.js';
import { scoreJob, locationFit, fitLabel } from './score.js';
import { ALL_MARKETS, detectCountries, isCountry } from './geo.js';

const MAX_AGE_DAYS = 35;
const MIN_SCORE = 20;
const MIN_REFRESH_MS = 10 * 60_000;

const memo = new Map(); // "sourceId" or "sourceId:au,nz" -> { at, jobs, error }

async function loadSource(src, force, countries) {
  const key = src.scope === 'country' ? `${src.id}:${countries.join(',')}` : src.id;
  const hit = memo.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  const fresh = hit && !hit.error && (age < src.ttl || (force && age < MIN_REFRESH_MS));
  const keepForPolicy = hit && !hit.error && src.id === 'remotive' && age < src.ttl; // Remotive asks for <= 4 pulls/day
  if (fresh || keepForPolicy) return { ...hit, cached: true };

  const started = Date.now();
  try {
    const raw = await src.fetch(countries);
    const entry = { at: Date.now(), jobs: raw.map(r => normalise(src, r)), ms: Date.now() - started };
    memo.set(key, entry);
    return entry;
  } catch (err) {
    // Serve the previous good pull if we have one.
    if (hit && !hit.error) return { ...hit, cached: true, staleError: String(err.message || err) };
    const entry = { at: Date.now(), jobs: [], error: String(err.message || err), ms: Date.now() - started };
    memo.set(key, entry);
    return entry;
  }
}

// "au" -> ['au']; "all" -> the main markets. Unknown codes fall back to Australia.
export function countriesFor(country) {
  if (country === 'all') return ALL_MARKETS;
  return [isCountry(country) ? country : 'au'];
}

export function normalise(src, r) {
  const text = r.text != null ? r.text : htmlToText(r.html || '');
  const fullForContacts = [text, r.html ? r.html.replace(/&#x40;|&#64;/gi, '@') : ''];
  const contacts = {
    emails: extractEmails(...fullForContacts),
    phones: extractPhones(text),
    links: extractLinks(text),
  };
  const job = {
    id: `${src.id}:${r.sourceId}`,
    kind: 'job',
    source: src.id,
    sourceLabel: r.sourceLabel || src.label,
    title: (r.title || 'Untitled').trim(),
    company: (r.company || '').trim(),
    url: r.url,
    applyUrl: r.applyUrl || r.url,
    salary: r.salary || extractSalary(text),
    type: classifyJobType(r.typeFields || [], text),
    location: (r.location || '').trim(),
    postedAt: r.postedAt,
    tags: (r.tags || []).slice(0, 12),
    requirements: extractRequirements(text),
    description: clip(text, 4000),
    contacts,
    signupRequired: Boolean(r.signupRequired),
    meta: r.meta || {},
  };
  if (job.signupRequired && job.type === 'Contract') job.type = 'Project';
  // Boards often put the real restriction in the title ("Salesforce Lead - USA").
  const titleTail = job.title.split(/\s[-–]\s/).slice(1).join(' ');
  job.locationFit = r.locationRestricted || (titleTail && locationFit(titleTail) === 'restricted') ? 'restricted' : locationFit(job.location);
  if (job.locationFit === 'restricted' && titleTail && !job.location.includes(titleTail)) job.location = [job.location, titleTail].filter(Boolean).join(' · ');
  const geo = detectCountries(job.location);
  job.countries = [...new Set([...(r.countries || []), ...geo.countries])];
  job.anywhere = !r.countries?.length && geo.anywhere;
  job.contactMethod = contacts.emails.length ? 'email' : job.signupRequired ? 'signup' : 'apply';
  const { score, matched, warnings } = scoreJob(job);
  job.score = score;
  job.fit = fitLabel(score);
  job.matched = matched;
  job.warnings = warnings;
  return job;
}

const dedupeKey = j => `${j.title}|${j.company}`.toLowerCase().replace(/[^a-z0-9|]/g, '');

export async function getJobs({ force = false, country = 'au' } = {}) {
  const countries = countriesFor(country);
  const results = await Promise.all(SOURCES.map(src => loadSource(src, force, countries).then(r => ({ src, r }))));
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400_000;

  const byKey = new Map();
  for (const { r } of results) {
    for (const job of r.jobs) {
      if (job.score < MIN_SCORE) continue;
      if (job.postedAt && Date.parse(job.postedAt) < cutoff) continue;
      const key = dedupeKey(job);
      const prev = byKey.get(key);
      // Keep the copy with the best way to reach them.
      const rank = j => (j.contactMethod === 'email' ? 2 : j.contactMethod === 'apply' ? 1 : 0) + (j.salary ? 0.5 : 0);
      if (!prev || rank(job) > rank(prev)) byKey.set(key, job);
    }
  }

  const jobs = [...byKey.values()].sort((a, b) => b.score - a.score || Date.parse(b.postedAt || 0) - Date.parse(a.postedAt || 0));
  const sources = results.map(({ src, r }) => ({
    id: src.id,
    label: src.label,
    note: src.note || null,
    ok: !r.error,
    error: r.error || r.staleError || null,
    fetched: r.jobs.length,
    shown: jobs.filter(j => j.source === src.id).length,
    pulledAt: new Date(r.at).toISOString(),
  }));
  return { generatedAt: new Date().toISOString(), country: country === 'all' ? 'all' : countries[0], sources, jobs };
}
