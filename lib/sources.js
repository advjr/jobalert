// One fetcher per job board. Each returns raw listings in a shared shape:
// { sourceId, title, company, url, applyUrl, salary, typeFields, location, postedAt, html, text, tags, signupRequired, meta }
// Every source here is public and readable without an account.

import { decodeEntities, htmlToText } from './text.js';
import { formatRange, extractSalary, firstUrl } from './extract.js';

const UA = 'JobAlert/1.0 (+personal job lead dashboard)';
const HOUR = 3600_000;

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const toIso = v => {
  if (!v) return null;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// ---------- Remotive (asks for max ~4 pulls a day, so it is cached 6h) ----------
async function remotive() {
  const data = await getJson('https://remotive.com/api/remote-jobs');
  return (data.jobs || []).map(j => ({
    sourceId: j.id,
    title: j.title,
    company: j.company_name,
    url: j.url,
    applyUrl: j.url,
    salary: j.salary || null,
    typeFields: [j.job_type],
    location: j.candidate_required_location,
    postedAt: toIso(j.publication_date),
    html: j.description,
    tags: [...(j.tags || []), j.category].filter(Boolean),
  }));
}

// ---------- RemoteOK ----------
async function remoteok() {
  const data = await getJson('https://remoteok.com/api');
  return data
    .filter(j => j && j.id && j.position)
    .map(j => ({
      sourceId: j.id,
      title: j.position,
      company: j.company,
      url: j.url,
      applyUrl: j.apply_url || j.url,
      salary: formatRange(j.salary_min, j.salary_max, { period: 'yearly' }),
      typeFields: j.tags || [],
      location: j.location || 'Worldwide',
      postedAt: toIso(j.date || j.epoch),
      html: j.description,
      tags: j.tags || [],
    }));
}

// ---------- Jobicy ----------
async function jobicy() {
  const data = await getJson('https://jobicy.com/api/v2/remote-jobs?count=100');
  return (data.jobs || []).map(j => ({
    sourceId: j.id,
    title: decodeEntities(j.jobTitle),
    company: decodeEntities(j.companyName),
    url: j.url,
    applyUrl: j.url,
    salary: formatRange(j.salaryMin, j.salaryMax, { currency: j.salaryCurrency || 'USD', period: j.salaryPeriod }),
    typeFields: [].concat(j.jobType || []),
    location: j.jobGeo,
    postedAt: toIso(j.pubDate),
    html: j.jobDescription,
    tags: [].concat(j.jobIndustry || [], j.jobLevel || []).map(decodeEntities),
  }));
}

// ---------- Himalayas (search API, 20 results per query) ----------
const HIMALAYAS_QUERIES = ['hubspot', 'zapier', 'crm', 'automation specialist', 'virtual assistant', 'shopify', 'wordpress', 'klaviyo', 'operations assistant', 'no-code'];

async function himalayas() {
  const pages = await Promise.allSettled(
    HIMALAYAS_QUERIES.map(q => getJson(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}`)),
  );
  const jobs = pages.flatMap(p => (p.status === 'fulfilled' ? p.value.jobs || [] : []));
  if (!jobs.length && pages.every(p => p.status === 'rejected')) throw pages[0].reason;
  return jobs.map(j => ({
    sourceId: j.guid,
    title: j.title,
    company: j.companyName,
    url: j.guid || j.applicationLink,
    applyUrl: j.applicationLink || j.guid,
    salary: formatRange(j.minSalary, j.maxSalary, { currency: j.currency || 'USD', period: j.salaryPeriod }),
    typeFields: [j.employmentType],
    location: j.locationRestrictions?.length ? j.locationRestrictions.join(', ') : 'Worldwide',
    // Himalayas lists the exact countries allowed, so anything without the Philippines is locked out.
    locationRestricted: Boolean(j.locationRestrictions?.length) && !j.locationRestrictions.some(c => /philippines|asia|apac/i.test(c)),
    postedAt: toIso(j.pubDate),
    html: j.description,
    tags: [...(j.categories || []), ...(j.seniority || [])].map(t => String(t).replace(/-/g, ' ')),
  }));
}

// ---------- We Work Remotely (RSS) ----------
const WWR_FEEDS = [
  'https://weworkremotely.com/remote-jobs.rss',
  'https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss',
  'https://weworkremotely.com/categories/all-other-remote-jobs.rss',
  'https://weworkremotely.com/categories/remote-management-and-finance-jobs.rss',
  'https://weworkremotely.com/categories/remote-customer-support-jobs.rss',
];

function rssTag(item, tag) {
  const m = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').trim();
}

async function weworkremotely() {
  const feeds = await Promise.allSettled(WWR_FEEDS.map(getText));
  if (feeds.every(f => f.status === 'rejected')) throw feeds[0].reason;
  const items = feeds.flatMap(f => (f.status === 'fulfilled' ? f.value.match(/<item>[\s\S]*?<\/item>/g) || [] : []));
  return items.map(item => {
    const full = decodeEntities(rssTag(item, 'title'));
    const idx = full.indexOf(':');
    const html = decodeEntities(rssTag(item, 'description'));
    const link = rssTag(item, 'link') || rssTag(item, 'guid');
    return {
      sourceId: link,
      title: idx > 0 ? full.slice(idx + 1).trim() : full,
      company: idx > 0 ? full.slice(0, idx).trim() : '',
      url: link,
      applyUrl: link,
      salary: null,
      typeFields: [rssTag(item, 'type')],
      location: decodeEntities(rssTag(item, 'region')) || decodeEntities(rssTag(item, 'country')),
      postedAt: toIso(rssTag(item, 'pubDate')),
      html,
      tags: [rssTag(item, 'category'), rssTag(item, 'skills')].filter(Boolean).map(decodeEntities),
    };
  });
}

// ---------- Working Nomads ----------
async function workingnomads() {
  const data = await getJson('https://www.workingnomads.com/api/exposed_jobs/');
  return data.map(j => ({
    sourceId: j.url,
    title: j.title,
    company: j.company_name,
    url: j.url,
    applyUrl: j.url,
    salary: null,
    typeFields: [],
    location: j.location,
    postedAt: toIso(j.pub_date),
    html: j.description,
    tags: [j.category_name, ...String(j.tags || '').split(',')].map(s => s && s.trim()).filter(Boolean),
  }));
}

// ---------- Hacker News "Who is hiring?" (posts usually carry a direct email) ----------
async function hackernews() {
  const stories = await getJson('https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10');
  const thread = stories.hits.find(h => /who is hiring/i.test(h.title));
  if (!thread) return [];
  const data = await getJson(
    `https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_${thread.objectID}&hitsPerPage=1000`,
  );
  return data.hits
    .filter(c => c.comment_text && String(c.parent_id) === String(thread.objectID))
    .filter(c => !/^\s*location:.*willing to relocate/is.test(htmlToText(c.comment_text).slice(0, 400))) // job seekers posting in the wrong thread
    .map(c => {
      const html = c.comment_text;
      const header = htmlToText(html.split(/<p>/i)[0]).replace(/\n/g, ' ');
      const sep = header.includes('|') ? '|' : /\s[—–]\s/;
      const parts = header.split(sep).map(s => s.trim()).filter(Boolean);
      const isLoc = s =>
        s.length < 80 &&
        (/remote|onsite|on-site|in-office|hybrid|worldwide|anywhere|relocation|visa/i.test(s) ||
          /,\s*[A-Z]{2}\b|\b(USA|UK|EU|US|NYC|SF)\b/.test(s) ||
          /^[A-Z][a-z]+(?: [A-Z][a-z]+)*,/.test(s));
      const isType = s => s.length < 30 && /full[\s-]?time|part[\s-]?time|contract|freelance|intern/i.test(s);
      const isPay = s => s.length < 40 && /[$€£]\s?\d|\d+k\b/i.test(s);
      const role = parts.slice(1).find(s => !isLoc(s) && !isType(s) && !isPay(s) && !/^https?:/i.test(s));
      const text = htmlToText(html);
      return {
        sourceId: c.objectID,
        title: (role || header).slice(0, 140),
        company: (parts[0] || '').slice(0, 80),
        url: `https://news.ycombinator.com/item?id=${c.objectID}`,
        applyUrl: firstUrl(text),
        salary: extractSalary(header) || extractSalary(text),
        typeFields: parts.filter(isType),
        location: parts.filter(s => isLoc(s) && !isType(s)).join(' · ') || (/remote/i.test(header) ? 'Remote' : ''),
        postedAt: toIso(c.created_at),
        html,
        tags: [],
        meta: { thread: thread.title },
      };
    });
}

// ---------- Freelancer.com (public read API; bidding needs an account) ----------
const FREELANCER_QUERIES = ['zapier', 'hubspot', 'crm', 'gohighlevel', 'shopify', 'wordpress elementor', 'google sheets', 'virtual assistant', 'automation', 'klaviyo', 'manychat', 'zoho'];

async function freelancer() {
  const pages = await Promise.allSettled(
    FREELANCER_QUERIES.map(q =>
      getJson(`https://www.freelancer.com/api/projects/0.1/projects/active/?query=${encodeURIComponent(q)}&limit=15&full_description=true&job_details=true`),
    ),
  );
  if (pages.every(p => p.status === 'rejected')) throw pages[0].reason;
  const projects = pages.flatMap(p => (p.status === 'fulfilled' ? p.value.result?.projects || [] : []));
  return projects.map(p => {
    const cur = p.currency || {};
    const b = p.budget || {};
    let salary = formatRange(b.minimum, b.maximum, { currency: cur.code || 'USD', period: p.type === 'hourly' ? 'hourly' : '' });
    if (salary && cur.code && cur.code !== 'USD' && cur.exchange_rate) {
      const usd = formatRange(Math.round(b.minimum * cur.exchange_rate), Math.round((b.maximum || b.minimum) * cur.exchange_rate), { period: p.type === 'hourly' ? 'hourly' : '' });
      salary += ` (~${usd} USD)`;
    }
    if (salary) salary += p.type === 'hourly' ? ' hourly' : ' fixed';
    return {
      sourceId: p.id,
      title: p.title,
      company: 'Freelancer.com client',
      url: `https://www.freelancer.com/projects/${p.seo_url}`,
      applyUrl: `https://www.freelancer.com/projects/${p.seo_url}`,
      salary,
      typeFields: ['contract'],
      location: 'Worldwide',
      postedAt: toIso(p.time_submitted || p.submitdate),
      text: p.description || p.preview_description || '',
      tags: (p.jobs || []).map(j => j.name),
      signupRequired: true,
      meta: { bids: p.bid_stats?.bid_count ?? null },
    };
  });
}

export const SOURCES = [
  { id: 'hn', label: 'HN Who is Hiring', fetch: hackernews, ttl: 1 * HOUR, note: 'Posts usually include a direct email.' },
  { id: 'himalayas', label: 'Himalayas', fetch: himalayas, ttl: 1 * HOUR },
  { id: 'jobicy', label: 'Jobicy', fetch: jobicy, ttl: 1 * HOUR },
  { id: 'remoteok', label: 'RemoteOK', fetch: remoteok, ttl: 1 * HOUR },
  { id: 'wwr', label: 'We Work Remotely', fetch: weworkremotely, ttl: 1 * HOUR },
  { id: 'workingnomads', label: 'Working Nomads', fetch: workingnomads, ttl: 1 * HOUR },
  { id: 'remotive', label: 'Remotive', fetch: remotive, ttl: 6 * HOUR },
  { id: 'freelancer', label: 'Freelancer.com', fetch: freelancer, ttl: 1 * HOUR, note: 'Bidding needs a Freelancer account.' },
];
