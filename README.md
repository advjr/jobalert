# JobAlert

A personal job-lead CRM. It pulls public job feeds that need no account, ranks every post against your skills, pulls out emails and phone numbers, and drafts an offer you can send in one click.

There is no database. Leads are fetched live from the boards on each load, and the CDN caches them for 15 minutes. Your pipeline (saved, contacted, replied, hidden, notes, drafts) is stored in your browser's localStorage. Use the download button to export any view to CSV.

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
| HN "Who is hiring?" | Monthly thread. Most posts include a direct email | Email |
| Himalayas | Searched for HubSpot, Zapier, CRM, VA, Shopify, WordPress, Klaviyo and more | Apply link |
| Jobicy, RemoteOK, We Work Remotely, Working Nomads, Remotive | Remote job boards with open feeds | Apply link, sometimes email |
| Freelancer.com | Small fixed-price projects that match your skills | Needs a Freelancer account to bid |

Remotive is pulled at most every 6 hours because its terms ask for no more than 4 pulls a day. Every lead links back to its original post, as the boards require.

Not included: LinkedIn, Upwork and OnlineJobs.ph have no open feeds and need a login to contact anyone. Reddit blocks server requests.

## Tuning the matches

Edit `lib/profile.js`:

- `SKILLS`: keywords and weights. A keyword in the job title counts about twice as much as one in the description.
- `TITLE_NEGATIVES`: titles that are almost never a fit (for example backend engineer, nurse, SDR).
- `LOCATION_OK` / `LOCATION_RESTRICTED`: which locations you can work from the Philippines.
- `PROFILE.summary` and `proofPoints`: what the AI writer is allowed to say about you.

To add a board, add a fetcher to `lib/sources.js` and list it in `SOURCES`.

## Keyboard

`j`/`k` move · `s` save · `c` contacted · `r` replied · `h` hide · `o` open post · `d` draft offer · `/` search · `1`-`5` switch view · `?` help
