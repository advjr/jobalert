// Free social leads without an AI key: reads RSS/Atom alert feeds you set up yourself
// (Google Alerts, Talkwalker Alerts, FetchRSS, RSS.app) and turns each item into a social post.
// Only these alert services are fetched, so the endpoint cannot be used as an open proxy.

import { createHash } from 'node:crypto';
import { decodeEntities, htmlToText } from './text.js';
import { normalise } from './jobs.js';
import { detectCountries } from './geo.js';

const UA = 'JobAlert/1.0 (+personal job lead dashboard)';
const TTL = 30 * 60_000;
export const MAX_FEEDS = 20;

const ALLOWED = [
  /^https:\/\/www\.google\.[a-z.]+\/alerts\/feeds\//i,
  /^https:\/\/alerts\.talkwalker\.com\//i,
  /^https:\/\/fetchrss\.com\/rss\//i,
  /^https:\/\/rss\.app\/feeds\//i,
];
export const isAllowedFeed = url => typeof url === 'string' && ALLOWED.some(re => re.test(url));

// Posts from people offering their own services or looking for a job, not buying help.
const SELLER = /#?open\s?to\s?work|looking for (a |my next |new )?(job|role|position|opportunit|work|clients)|i('| a)m (a |an )?(freelance |certified )?(virtual assistant|va|developer|designer)\b|available for (hire|work|projects|new clients)|hire me|book a (free )?(call|consult)|my services|we offer|our services/i;

const PLATFORM_HOSTS = [
  [/linkedin\.com$/, 'LinkedIn'],
  [/facebook\.com$|fb\.com$/, 'Facebook'],
  [/instagram\.com$/, 'Instagram'],
  [/threads\.(net|com)$/, 'Threads'],
  [/(^|\.)x\.com$|twitter\.com$/, 'X'],
  [/reddit\.com$/, 'Reddit'],
];

const memo = new Map(); // url -> { at, title, items }

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[2].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').trim() : '';
}

const clean = s => htmlToText(decodeEntities(s)).replace(/\s+/g, ' ').trim();

// Google Alerts wraps every link in google.com/url?url=...
function unwrap(link) {
  try {
    const u = new URL(link);
    if (/google\./.test(u.hostname) && u.pathname === '/url') return u.searchParams.get('url') || u.searchParams.get('q') || link;
  } catch {}
  return link;
}

export function parseFeed(xml) {
  const title = clean(tag(xml.split(/<(entry|item)[\s>]/i)[0], 'title'));
  const blocks = xml.match(/<(entry|item)[\s>][\s\S]*?<\/\1>/gi) || [];
  const items = blocks.map(b => {
    const href = (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || tag(b, 'link') || tag(b, 'guid');
    return {
      title: clean(tag(b, 'title')),
      url: unwrap(decodeEntities(href)),
      text: clean(tag(b, 'content') || tag(b, 'description') || tag(b, 'summary')),
      date: tag(b, 'published') || tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'dc:date'),
      author: clean(tag(tag(b, 'author'), 'name') || tag(b, 'dc:creator')),
    };
  });
  return { title, items: items.filter(i => /^https?:\/\//i.test(i.url)) };
}

function platformOf(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\.|^m\./, '');
    const hit = PLATFORM_HOSTS.find(([re]) => re.test(host));
    return hit ? hit[1] : host;
  } catch {
    return 'Web';
  }
}

function toPost(item, feedTitle, feedUrl) {
  const platform = platformOf(item.url);
  const known = PLATFORM_HOSTS.some(([, name]) => name === platform);
  const date = item.date ? new Date(item.date) : null;
  // "Jane Doe on LinkedIn: Looking for a VA..." -> author "Jane Doe", title "Looking for a VA..."
  // "Brisbane Small Business Network | Looking for a VA..." (Facebook groups) -> group as the poster.
  const split = item.title.match(/^(.{2,80}?) (?:on|posted on|in) (?:LinkedIn|Facebook|Instagram|X|Threads)\s*[:|-]\s*(.+)$/i) || item.title.match(/^(.{3,80}?) \| (.{10,})$/);
  const job = normalise(
    { id: 'feed', label: platform },
    {
      sourceId: createHash('sha1').update(item.url).digest('hex').slice(0, 16),
      title: (split ? split[2] : item.title).slice(0, 160) || 'Untitled post',
      company: item.author || (split ? split[1] : '') || `${platform} post`,
      url: item.url,
      applyUrl: item.url,
      location: '',
      postedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
      text: item.text || item.title,
      tags: [platform],
      signupRequired: known,
      meta: { platform, feed: feedTitle, feedUrl },
    },
  );
  // Country comes from the post text, since feeds have no location field.
  job.countries = detectCountries(`${item.title} ${item.text}`.slice(0, 600)).countries;
  job.anywhere = !job.countries.length;
  job.kind = 'social';
  job.platform = known ? platform : 'Other';
  return job;
}

async function readFeed(url) {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const entry = { at: Date.now(), ...parseFeed(await res.text()) };
  memo.set(url, entry);
  return entry;
}

export async function readFeeds(urls) {
  const list = [...new Set(urls)].filter(isAllowedFeed).slice(0, MAX_FEEDS);
  const results = await Promise.all(
    list.map(url => readFeed(url).then(r => ({ url, ...r })).catch(err => ({ url, error: String(err.message || err), items: [] }))),
  );
  const seen = new Set();
  const posts = [];
  for (const r of results) {
    for (const item of r.items) {
      if (seen.has(item.url) || SELLER.test(`${item.title} ${item.text}`)) continue;
      seen.add(item.url);
      posts.push(toPost(item, r.title, r.url));
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    feeds: results.map(r => ({ url: r.url, title: r.title || '', ok: !r.error, error: r.error || null, count: r.items.length })),
    posts,
  };
}
