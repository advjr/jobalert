// Pulls every source once and prints a summary plus the top matches.
// Usage: npm run check            (Australia)
//        npm run check -- sg      (any country code from lib/geo.js, or "all")
import { getJobs } from '../lib/jobs.js';

const country = process.argv[2] || 'au';
const { sources, jobs } = await getJobs({ country });
console.table(sources.map(s => ({ source: s.label, ok: s.ok, fetched: s.fetched, shown: s.shown, error: s.error || '' })));
const local = country === 'all' ? jobs : jobs.filter(j => j.countries.includes(country));
console.log(`\n${jobs.length} leads, ${local.length} in ${country}. With email: ${jobs.filter(j => j.contactMethod === 'email').length}. No sign-up: ${jobs.filter(j => !j.signupRequired).length}\n`);
for (const j of local.slice(0, 25)) {
  console.log(`${String(j.score).padStart(3)}  ${j.sourceLabel.padEnd(16)} ${j.type.padEnd(11)} ${(j.salary || '-').slice(0, 22).padEnd(22)} ${j.contactMethod.padEnd(6)} ${j.title.slice(0, 60)} | ${j.company.slice(0, 25)}`);
}
