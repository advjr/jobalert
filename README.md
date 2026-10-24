# JobAlert

A personal job-lead CRM. It pulls public job feeds that need no account, ranks every post against your skills, pulls out emails and phone numbers, and drafts an offer you can send in one click.

There is no database. Leads are fetched live from the boards on each load, and the CDN caches them for 15 minutes. Your pipeline (saved, contacted, replied, hidden, notes, drafts) is stored in your browser's localStorage. Use the download button to export any view to CSV.

## Using the dashboard

- **Jobs** fills the screen with tiles. Click a tile to open its details page in a new tab: position, salary, job type, location, contacts, the full description, an AI-drafted offer, notes, and a button to the original post. The link icon on a tile goes straight to the original post.
- The country picker defaults to **Australia**. Pick another country or **All countries**. "Worldwide remote too" adds remote jobs that are open to most countries; in Best match, jobs in the chosen country still rank first.
- **Social posts** lists LinkedIn, Facebook and Instagram posts from people asking for your services:
  - **Alert feeds (free, no API key):** press **Set up feeds**, create a Google Alert for one of the suggested searches (for example `site:facebook.com/groups "looking for" "virtual assistant" Australia`) with *Deliver to: RSS feed*, and paste the feed link. New public posts that Google indexes show up here. Talkwalker Alerts, FetchRSS and RSS.app feed links work too. Your feed list is kept in the browser.
  - **Quick searches** open each platform's own search in your logged-in browser, which is the only way to see private Facebook groups.
  - **Scan with AI** (only shown when `ANTHROPIC_API_KEY` is set) has Claude search for posts, roughly US$0.30 to US$0.80 per scan.
- **Pipeline** holds everything you saved, contacted, got replies from or hid.
- The moon/sun button switches light and dark mode. It follows your system setting until you choose.

## Install it as a desktop app

JobAlert is an installable web app. Open it in Chrome or Edge and press **Install app** in the header (or the install icon at the right end of the address bar). It then opens in its own window from the Start menu, taskbar or desktop, like any other app, and updates itself whenever you deploy.

Install it from your Vercel URL so it works without the local server running. If you install from `http://localhost:3000`, `npm run dev` has to be running for it to load leads.

## Run it locally

```bash
npm install
npm run dev          # http://localhost:3000
npm run check        # prints source health and the top 25 matches in the terminal
```

To turn on AI-written offers, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. Without a key the composer uses a built-in template.

## Deploy to Vercel

```bash
vercel                # first deploy links the project
vercel env add ANTHROPIC_API_KEY
vercel --prod
```

`public/` is the dashboard. `api/jobs.js` and `api/proposal.js` run as Vercel Functions.

## Sources

| Source | Why it is here | Contact |
|---|---|---|
| SEEK (AU, NZ) and Jobstreet (SG, PH) | The main Australian board; remote roles only, searched per country | Apply link |
| LinkedIn Jobs (public search) | Remote roles per country, no login to read. LinkedIn rate-limits quickly, so it does one search per country | Apply needs a LinkedIn login |
| Workable | Career pages of thousands of companies, searched per country. Hybrid and on-site roles are marked location-locked | Apply link |
| HN "Who is hiring?" | Monthly thread. Most posts include a direct email | Email |
| Himalayas | Searched for HubSpot, Zapier, CRM, VA, Shopify, WordPress, Klaviyo and more | Apply link |
| Jobicy, RemoteOK, We Work Remotely, Working Nomads, Remotive | Remote job boards with open feeds | Apply link, sometimes email |
| Freelancer.com | Small fixed-price projects that match your skills | Needs a Freelancer account to bid |

Remotive is pulled at most every 6 hours because its terms ask for no more than 4 pulls a day. Every lead links back to its original post, as the boards require.

SEEK and LinkedIn are read through the same public search their websites use, not an official API, so either can change or block requests without notice. A red dot next to a source in Filters shows when that happens.

Not included as feeds: Upwork and OnlineJobs.ph need a login. Reddit and Bluesky block server requests. Facebook, Instagram and LinkedIn posts have no public feed, which is why the Social posts tab uses an AI web search plus quick-search links.

Note that `/api/proposal` and `/api/social` spend your Anthropic credit and anyone with the deployment URL can call them. Keep the URL private, or turn on Vercel Deployment Protection.

## Tuning the matches

Edit `lib/profile.js`:

- `SKILLS`: keywords and weights. A keyword in the job title counts about twice as much as one in the description.
- `TITLE_NEGATIVES`: titles that are almost never a fit (for example backend engineer, nurse, SDR).
- `LOCATION_OK` / `LOCATION_RESTRICTED`: which locations you can work from the Philippines.
- `PROFILE.summary` and `proofPoints`: what the AI writer is allowed to say about you.

To add a board, add a fetcher to `lib/sources.js` and list it in `SOURCES` (`scope: 'country'` if it searches per country). Countries, their city names and per-board search settings live in `lib/geo.js`.

`npm run check -- sg` prints the matches for one country (`all` for every market).

## Keyboard

`/` search · `Esc` close filters
