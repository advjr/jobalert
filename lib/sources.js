// One fetcher per job board. Each returns raw listings in a shared shape:
// { sourceId, title, company, url, applyUrl, salary, typeFields, location, countries, postedAt, html, text, tags, signupRequired, meta, sourceLabel }
// Every source here is public and readable without an account.
// Country-scoped fetchers get the list of country codes being viewed (see lib/geo.js).

import { decodeEntities, htmlToText } from './text.js';
import { formatRange, extractSalary, firstUrl } from './extract.js';
import { COUNTRIES } from './geo.js';
import { scoreJob } from './score.js';

const UA = 'JobAlert/1.0 (+personal job lead dashboard)';
// SEEK and LinkedIn serve their public search pages only to browser-like clients.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const HOUR = 3600_000;

async function getJson(url, ua = UA) {
  const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getText(url, ua = UA) {
  const res = await fetch(url, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Run every task, keep what worked, and only fail if all of them failed.
async function settleAll(tasks) {
  const results = await Promise.allSettled(tasks);
  if (results.length && results.every(r => r.status === 'rejected')) throw results[0].reason;
  return results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
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

// ---------- Jobicy (worldwide feed plus a feed per country) ----------
async function jobicy(countries = []) {
  const geos = countries.map(c => COUNTRIES[c].jobicy).filter(Boolean);
  const urls = ['https://jobicy.com/api/v2/remote-jobs?count=100', ...geos.map(g => `https://jobicy.com/api/v2/remote-jobs?count=50&geo=${g}`)];
  const jobs = await settleAll(urls.map(u => getJson(u).then(d => d.jobs || [])));
  return jobs.map(j => ({
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

// ---------- SEEK (AU, NZ) and Jobstreet (SG, PH): one search API, remote roles only ----------
const SEEK_QUERIES = ['hubspot', 'zapier', 'crm', 'virtual assistant', 'executive assistant', 'automation', 'gohighlevel', 'shopify', 'wordpress', 'klaviyo', 'salesforce administrator', 'marketing automation', 'operations assistant', 'ai automation'];

async function seek(countries = []) {
  const markets = countries.filter(c => COUNTRIES[c].seek);
  if (!markets.length) return [];
  const tasks = markets.flatMap(code => {
    const { host, site, where, label } = COUNTRIES[code].seek;
    return SEEK_QUERIES.map(q =>
      getJson(`https://${host}/api/jobsearch/v5/search?siteKey=${site}&where=${encodeURIComponent(where)}&keywords=${encodeURIComponent(q)}&workarrangement=3&page=1&pageSize=30`, BROWSER_UA)
        .then(d => (d.data || []).map(j => ({ j, code, host, label }))),
    );
  });
  const hits = await settleAll(tasks);
  return hits.map(({ j, code, host, label }) => ({
    sourceId: j.id,
    sourceLabel: label,
    title: j.title,
    company: j.companyName || j.advertiser?.description || '',
    url: `https://${host}/job/${j.id}`,
    applyUrl: `https://${host}/job/${j.id}`,
    salary: j.salaryLabel || null,
    typeFields: j.workTypes || [],
    location: [...new Set((j.locations || []).map(l => l.label)), j.workArrangements?.displayText].filter(Boolean).join(' · '),
    countries: [code],
    postedAt: toIso(j.listingDate),
    text: [j.teaser, ...(j.bulletPoints || []).map(b => `• ${b}`)].filter(Boolean).join('\n'),
    tags: (j.classifications || []).flatMap(c => [c.classification?.description, c.subclassification?.description]).filter(Boolean),
    meta: { partial: true },
  }));
}

// ---------- LinkedIn public job search (no login; rate-limits quickly, so one search per country) ----------
const LINKEDIN_KEYWORDS = 'hubspot OR zapier OR crm OR "virtual assistant" OR "executive assistant" OR gohighlevel OR automation OR shopify OR wordpress OR klaviyo';
const LINKEDIN_DETAILS = 8; // full descriptions fetched for the best-looking titles per country

function parseLinkedInCards(html) {
  return html.split(/<li>/).slice(1).map(li => {
    const pick = re => decodeEntities((li.match(re) || [])[1] || '').replace(/\s+/g, ' ').trim();
    return {
      id: (li.match(/urn:li:jobPosting:(\d+)/) || [])[1],
      title: pick(/base-search-card__title">([\s\S]*?)<\/h3>/),
      company: pick(/base-search-card__subtitle">[\s\S]*?>([^<]+)</),
      location: pick(/job-search-card__location">([\s\S]*?)<\/span>/),
      salary: pick(/job-search-card__salary-info">([\s\S]*?)<\/span>/),
      date: (li.match(/datetime="([^"]+)"/) || [])[1],
      url: decodeEntities((li.match(/base-card__full-link[^>]*href="([^"?]+)/) || [])[1] || ''),
    };
  }).filter(c => c.id && c.title);
}

async function linkedinDetail(id) {
  const html = await getText(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`, BROWSER_UA);
  const body = (html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
  const criteria = Object.fromEntries(
    [...html.matchAll(/description__job-criteria-subheader">\s*([\s\S]*?)\s*<\/h3>\s*<span[^>]*>\s*([\s\S]*?)\s*<\/span>/g)].map(m => [m[1].trim(), decodeEntities(m[2].trim())]),
  );
  return { html: body, type: criteria['Employment type'], seniority: criteria['Seniority level'] };
}

async function linkedin(countries = []) {
  const out = [];
  let lastError;
  for (const code of countries) {
    const where = COUNTRIES[code].linkedin;
    if (!where) continue;
    try {
      const html = await getText(
        `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(LINKEDIN_KEYWORDS)}&location=${encodeURIComponent(where)}&f_WT=2&f_TPR=r1209600&start=0`,
        BROWSER_UA,
      );
      const cards = parseLinkedInCards(html);
      const best = cards.map(c => ({ c, s: scoreJob({ title: c.title }).score })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, LINKEDIN_DETAILS);
      const details = new Map();
      for (const { c } of best) {
        await sleep(400);
        try { details.set(c.id, await linkedinDetail(c.id)); } catch { break; } // usually a 429: keep the cards we have
      }
      for (const c of cards) {
        const d = details.get(c.id);
        out.push({
          sourceId: c.id,
          title: c.title,
          company: c.company,
          url: c.url || `https://www.linkedin.com/jobs/view/${c.id}`,
          applyUrl: c.url || `https://www.linkedin.com/jobs/view/${c.id}`,
          salary: c.salary || null,
          typeFields: [d?.type],
          location: `${c.location} · Remote`,
          countries: [code],
          postedAt: toIso(c.date),
          html: d?.html || '',
          tags: [d?.seniority].filter(Boolean),
          meta: { partial: !d },
        });
      }
    } catch (err) {
      lastError = err;
    }
    await sleep(600);
  }
  if (!out.length && lastError) throw lastError;
  return out;
}

// ---------- Workable job search (thousands of company career pages) ----------
const WORKABLE_QUERIES = ['hubspot', 'crm', 'virtual assistant', 'automation', 'marketing operations', 'shopify', 'executive assistant'];

async function workable(countries = []) {
  const tasks = countries.flatMap(code =>
    WORKABLE_QUERIES.map(q =>
      getJson(`https://jobs.workable.com/api/v1/jobs?query=${encodeURIComponent(q)}&location=${encodeURIComponent(COUNTRIES[code].workable)}`).then(d => (d.jobs || []).map(j => ({ j, code }))),
    ),
  );
  const hits = await settleAll(tasks);
  return hits.map(({ j, code }) => {
    const place = j.workplace === 'on_site' ? 'On-site' : j.workplace === 'hybrid' ? 'Hybrid' : j.workplace === 'remote' ? 'Remote' : '';
    return {
      sourceId: j.id,
      title: j.title,
      company: j.company?.title || '',
      url: j.url,
      applyUrl: j.url,
      salary: null,
      typeFields: [j.employmentType],
      location: [(j.locations || []).join(' / '), place].filter(Boolean).join(' · '),
      countries: [code],
      // Hybrid and on-site roles need you in the office, so they cannot be done from the Philippines.
      locationRestricted: j.workplace === 'on_site' || j.workplace === 'hybrid',
      postedAt: toIso(j.created),
      html: [j.description, j.requirementsSection, j.benefitsSection].filter(Boolean).join('\n'),
      tags: [j.department].filter(Boolean),
    };
  });
}

// scope 'country' sources are pulled once per country being viewed; the rest are worldwide.
export const SOURCES = [
  { id: 'seek', label: 'SEEK & Jobstreet', fetch: seek, scope: 'country', ttl: 1 * HOUR, note: 'Remote roles in AU, NZ, SG and PH.' },
  { id: 'linkedin', label: 'LinkedIn Jobs', fetch: linkedin, scope: 'country', ttl: 2 * HOUR, note: 'Public job search, remote roles. Applying needs a LinkedIn login.' },
  { id: 'workable', label: 'Workable', fetch: workable, scope: 'country', ttl: 1 * HOUR },
  { id: 'hn', label: 'HN Who is Hiring', fetch: hackernews, ttl: 1 * HOUR, note: 'Posts usually include a direct email.' },
  { id: 'himalayas', label: 'Himalayas', fetch: himalayas, ttl: 1 * HOUR },
  { id: 'jobicy', label: 'Jobicy', fetch: jobicy, scope: 'country', ttl: 1 * HOUR },
  { id: 'remoteok', label: 'RemoteOK', fetch: remoteok, ttl: 1 * HOUR },
  { id: 'wwr', label: 'We Work Remotely', fetch: weworkremotely, ttl: 1 * HOUR },
  { id: 'workingnomads', label: 'Working Nomads', fetch: workingnomads, ttl: 1 * HOUR },
  { id: 'remotive', label: 'Remotive', fetch: remotive, ttl: 6 * HOUR },
  { id: 'freelancer', label: 'Freelancer.com', fetch: freelancer, ttl: 1 * HOUR, note: 'Bidding needs a Freelancer account.' },
];
