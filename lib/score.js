import { SKILLS, TITLE_NEGATIVES, LOCATION_OK, LOCATION_RESTRICTED } from './profile.js';

const compiled = SKILLS.map(([group, label, patterns, weight]) => ({
  group,
  label,
  weight,
  re: new RegExp(patterns.join('|'), 'i'),
}));
const negatives = TITLE_NEGATIVES.map(p => new RegExp(p, 'i'));
const locOk = new RegExp(LOCATION_OK, 'i');
const locRestricted = new RegExp(LOCATION_RESTRICTED, 'i');

export function locationFit(location = '') {
  const loc = location.trim();
  if (!loc) return 'unknown';
  if (locOk.test(loc)) return 'ok';
  if (locRestricted.test(loc)) return 'restricted';
  return 'unknown';
}

// Returns { score 0-100, matched: [{group,label}], warnings: [] }.
export function scoreJob(job) {
  const title = job.title || '';
  const tags = (job.tags || []).join(' ');
  const body = job.description || '';
  let raw = 0;
  const matched = [];
  for (const s of compiled) {
    let pts = 0;
    if (s.re.test(title)) pts = s.weight * 2.2;
    else if (s.re.test(tags)) pts = s.weight * 1.3;
    else if (s.re.test(body)) pts = s.weight;
    if (pts) {
      raw += pts;
      matched.push({ group: s.group, label: s.label, inTitle: s.re.test(title) });
    }
  }

  // Saturating curve: a few strong matches already make a great lead.
  let score = 100 * (1 - Math.exp(-raw / 38));
  const warnings = [];

  if (negatives.some(re => re.test(title))) {
    score *= 0.35;
    warnings.push('Title looks like a different specialty');
  }
  if (job.locationFit === 'restricted') {
    score -= 15;
    warnings.push(`Location restricted: ${job.location}`);
  }
  if (job.type === 'Contract' || job.type === 'Part-time' || job.type === 'Project') score += 5;
  if (job.contacts?.emails?.length) score += 5;
  if (/\b(senior|sr\.?|director|vp|head of|chief)\b/i.test(title)) warnings.push('Senior-level title');

  return { score: Math.max(0, Math.min(100, Math.round(score))), matched, warnings };
}

export function fitLabel(score) {
  if (score >= 70) return 'Great fit';
  if (score >= 45) return 'Good fit';
  if (score >= 25) return 'Possible';
  return 'Weak';
}
