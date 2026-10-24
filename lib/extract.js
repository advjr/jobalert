// Pull contact details, pay, job type and requirements out of free-text job posts.

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const EMAIL_BRACKETED_RE = /([a-z0-9._%+-]+)\s*[[(]\s*at\s*[\])]\s*([a-z0-9-]+(?:\s*(?:[[(]\s*dot\s*[\])]|\.)\s*[a-z0-9-]+)+)/gi;
const EMAIL_SPELLED_RE = /\b([a-z0-9._%+-]+)\s+at\s+([a-z0-9-]+(?:\s+dot\s+[a-z]{2,})+)\b/gi;
const EMAIL_IGNORE = /(example\.(com|org)|noreply|no-reply|donotreply|sentry|wixpress|\.(png|jpe?g|gif|svg|webp)$|@\dx\.)/i;
// Mailboxes that exist for accessibility requests, privacy or legal notices, not for hiring.
const EMAIL_NOT_HIRING = /^(reasonable)?accomm?odations?|^(privacy|legal|dpo|gdpr|compliance|security|abuse|unsubscribe|press|media|accessibility|ada|eeo|benefits|payroll)@|@(indeed|linkedin|greenhouse|lever|workable|ashbyhq|smartrecruiters)\./i;

export function extractEmails(...texts) {
  const found = new Set();
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(EMAIL_RE)) found.add(m[0]);
    for (const re of [EMAIL_BRACKETED_RE, EMAIL_SPELLED_RE]) {
      for (const m of t.matchAll(re)) {
        const domain = m[2].replace(/\s*[[(]?\s*dot\s*[\])]?\s*/gi, '.').replace(/\s+/g, '');
        found.add(`${m[1]}@${domain}`);
      }
    }
  }
  return [...found]
    .map(e => e.replace(/[.,;:]+$/, '').toLowerCase())
    .filter(e => !EMAIL_IGNORE.test(e) && !EMAIL_NOT_HIRING.test(e))
    .filter((e, i, all) => all.indexOf(e) === i && !all.some(o => o !== e && o.startsWith(e)))
    .slice(0, 5);
}

const PHONE_INTL_RE = /(?:\+|\b00)\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,5}){2,4}/g;
const PHONE_LABELED_RE = /\b(?:phone|tel|mobile|cell|whatsapp|viber|call|text|sms)\b[^\d+\n]{0,12}(\+?\(?\d[\d\s().-]{7,}\d)/gi;
const WA_LINK_RE = /wa\.me\/(\d{8,15})/gi;

export function extractPhones(text = '') {
  const found = new Map();
  const add = raw => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) return;
    if (/^(19|20)\d{6}$/.test(digits)) return; // looks like a date
    if (!found.has(digits)) found.set(digits, raw.trim());
  };
  for (const m of text.matchAll(PHONE_INTL_RE)) add(m[0]);
  for (const m of text.matchAll(PHONE_LABELED_RE)) add(m[1]);
  for (const m of text.matchAll(WA_LINK_RE)) add('+' + m[1]);
  return [...found.entries()].slice(0, 3).map(([digits, display]) => ({ digits, display }));
}

const LINK_KINDS = [
  ['Calendly', /https?:\/\/(?:www\.)?calendly\.com\/[^\s)"'<>]+/gi],
  ['Telegram', /https?:\/\/t\.me\/[^\s)"'<>]+/gi],
  ['Application form', /https?:\/\/(?:forms\.gle|docs\.google\.com\/forms|[a-z0-9-]+\.typeform\.com|tally\.so|airtable\.com\/(?:shr|app)\w*)\/?[^\s)"'<>]*/gi],
  ['LinkedIn', /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^\s)"'<>]+/gi],
];

export function extractLinks(text = '') {
  const out = [];
  for (const [kind, re] of LINK_KINDS) {
    for (const m of text.matchAll(re)) {
      const url = m[0].replace(/[.,;:]+$/, '');
      if (!out.some(l => l.url === url)) out.push({ kind, url });
    }
  }
  return out.slice(0, 5);
}

export function firstUrl(text = '') {
  const m = text.match(/https?:\/\/[^\s)"'<>]+/);
  return m ? m[0].replace(/[.,;:]+$/, '') : null;
}

const MONEY = '(?:US\\$|USD|AUD|A\\$|AU\\$|CAD|C\\$|NZD|SGD|S\\$|EUR|GBP|PHP|\\$|£|€|₱)\\s?\\d{1,3}(?:[,.]\\d{3})*(?:\\.\\d+)?\\s?[kK]?';
const SALARY_RE = new RegExp(
  `${MONEY}(?![\\dMmBb])(?:\\s?(?:-|–|to)\\s?${MONEY}(?![\\dMmBb]))?(?:\\s?(?:\\/|per|an?|p\\/?)\\s?(?:hour|hr|h|month|mo|year|yr|annum|week|wk|project|day))?`,
  'i',
);

export function extractSalary(text = '') {
  const m = text.slice(0, 4000).match(SALARY_RE);
  return m ? m[0].trim() : null;
}

export function formatRange(min, max, { currency = 'USD', period = '' } = {}) {
  const sym = { USD: '$', AUD: 'A$', CAD: 'C$', EUR: '€', GBP: '£', PHP: '₱', SGD: 'S$', NZD: 'NZ$', INR: '₹' }[currency] ?? `${currency} `;
  const fmt = n => (n >= 10000 ? `${Math.round(n / 1000)}k` : n.toLocaleString('en-US'));
  const per = { yearly: '/yr', annual: '/yr', year: '/yr', monthly: '/mo', month: '/mo', hourly: '/hr', hour: '/hr', weekly: '/wk', week: '/wk' }[String(period).toLowerCase()] ?? '';
  if (min && max && min !== max) return `${sym}${fmt(min)}–${fmt(max)}${per}`;
  if (min || max) return `${sym}${fmt(min || max)}${per}`;
  return null;
}

// Normalise to one of: Full-time, Part-time, Contract, Project, Unspecified.
export function classifyJobType(fields = [], text = '') {
  const f = fields.filter(Boolean).join(' ').toLowerCase();
  if (/part[\s_-]?time/.test(f)) return 'Part-time';
  if (/contract|freelance|temporary|temp\b|intern/.test(f)) return 'Contract';
  if (/full[\s_-]?time|permanent|employee/.test(f)) return 'Full-time';
  const t = text.slice(0, 2500).toLowerCase();
  if (/part[\s-]?time/.test(t)) return 'Part-time';
  if (/\b(freelance|freelancer|contractor|contract role|contract basis|project[\s-]based|one[\s-]off|fixed[\s-]price|short[\s-]term)\b/.test(t)) return 'Contract';
  if (/full[\s-]?time/.test(t)) return 'Full-time';
  return 'Unspecified';
}

const REQ_HEADING = /^(?:#+\s*)?(requirements?|qualifications?|minimum qualifications|preferred qualifications|what (?:you'?ll|you will|you) (?:need|bring|have)|what we(?:'re| are) looking for|who you are|about you|you (?:have|bring|are)|must[\s-]haves?|nice[\s-]to[\s-]haves?|skills(?: (?:&|and) experience)?|key skills|ideal candidate|experience|your profile|the ideal candidate)\b[^.]{0,40}:?$/i;
const OTHER_HEADING = /^(?:#+\s*)?(responsibilities|what you(?:'ll| will) do|the role|about (?:us|the (?:role|company|team))|benefits|perks|what we offer|compensation|salary|how to apply|why join|our (?:team|company|mission)|the opportunity|location|hours)\b[^.]{0,40}:?$/i;
const REQ_HINT = /\b(\d\+?\s*(?:years?|yrs)|experience (?:with|in)|proficien|familiar(?:ity)? with|knowledge of|ability to|strong .*skills|must|required|fluent|degree)\b/i;

export function extractRequirements(text = '') {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length && out.length < 10; i++) {
    if (!(REQ_HEADING.test(lines[i]) && lines[i].length < 70)) continue;
    for (let j = i + 1; j < lines.length && out.length < 10; j++) {
      const l = lines[j];
      if ((OTHER_HEADING.test(l) || REQ_HEADING.test(l)) && l.length < 70) break;
      if (l.length < 4) continue;
      if (!l.startsWith('•') && l.length > 260) break;
      out.push(l.replace(/^[•\-*·]\s*/, ''));
    }
  }
  if (out.length) return dedupe(out);
  const hinted = lines
    .filter(l => l.startsWith('•') && REQ_HINT.test(l))
    .map(l => l.replace(/^[•\-*·]\s*/, ''));
  return dedupe(hinted).slice(0, 6);
}

function dedupe(arr) {
  return arr.filter((x, i) => arr.indexOf(x) === i);
}
