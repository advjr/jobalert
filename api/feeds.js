// Reads your alert feeds (Google Alerts and similar) and returns them as social posts. Free, no API key.
// POST { urls: [...] }. The feed list lives in your browser; nothing is stored here.

import { readFeeds, isAllowedFeed, MAX_FEEDS } from '../lib/feeds.js';

export async function POST(request) {
  let urls;
  try {
    urls = (await request.json()).urls;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(urls)) return Response.json({ error: 'Send { "urls": [...] }' }, { status: 400 });
  const rejected = urls.filter(u => !isAllowedFeed(u));
  const data = await readFeeds(urls.slice(0, MAX_FEEDS));
  return Response.json({ ...data, rejected }, { headers: { 'Cache-Control': 'no-store' } });
}
