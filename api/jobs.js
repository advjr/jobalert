import { getJobs } from '../lib/jobs.js';
import { PROFILE } from '../lib/profile.js';

export async function GET(request) {
  const force = new URL(request.url).searchParams.has('refresh');
  const data = await getJobs({ force });
  return Response.json(
    { ...data, profile: { name: PROFILE.name, firstName: PROFILE.firstName, email: PROFILE.email, website: PROFILE.website, proofPoints: PROFILE.proofPoints }, ai: Boolean(process.env.ANTHROPIC_API_KEY) },
    {
      headers: {
        // Let the CDN reuse a pull for 15 minutes so the boards are not hit on every page load.
        'Cache-Control': force ? 'no-store' : 'public, s-maxage=900, stale-while-revalidate=3600',
      },
    },
  );
}
