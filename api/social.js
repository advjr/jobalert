// Social posts from people looking for your services.
// GET returns the last scan this instance holds; POST runs a new AI web scan (costs API credits).

import Anthropic from '@anthropic-ai/sdk';
import { cachedScan, scanSocial } from '../lib/social.js';
import { isCountry } from '../lib/geo.js';

const pickCountry = c => (c === 'all' || isCountry(c) ? c : 'au');

export async function GET(request) {
  const country = pickCountry(new URL(request.url).searchParams.get('country'));
  const hit = cachedScan(country);
  return Response.json(
    { country, ai: Boolean(process.env.ANTHROPIC_API_KEY), scannedAt: hit ? new Date(hit.at).toISOString() : null, posts: hit?.posts || [] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY is not set, so the AI scan is off. Use the quick searches instead.' }, { status: 503 });
  }
  let country = 'au';
  try {
    country = pickCountry((await request.json()).country);
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  try {
    const { at, posts, cached } = await scanSocial(country);
    return Response.json({ country, ai: true, cached: Boolean(cached), scannedAt: new Date(at).toISOString(), posts });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return Response.json({ error: 'The Anthropic API key was rejected.' }, { status: 502 });
    if (err instanceof Anthropic.RateLimitError) return Response.json({ error: 'Rate limited by the Anthropic API. Try again in a minute.' }, { status: 429 });
    if (err instanceof Anthropic.APIError) return Response.json({ error: `Anthropic API error ${err.status}: ${err.message}` }, { status: 502 });
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
