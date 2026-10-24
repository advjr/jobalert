// Countries the dashboard can filter by, how to spot each one in free-text locations,
// and the country-specific search settings for boards that support them.

export const COUNTRIES = {
  au: {
    name: 'Australia',
    re: /australia|\baus\b|\banz\b|sydney|melbourne|brisbane|perth|adelaide|canberra|hobart|darwin|gold coast|sunshine coast|newcastle|wollongong|geelong|\b(nsw|vic|qld|tas)\b|new south wales|victoria, au|queensland|western australia|south australia/i,
    seek: { host: 'www.seek.com.au', site: 'AU-Main', where: 'All Australia', label: 'SEEK' },
    linkedin: 'Australia',
    workable: 'Australia',
    jobicy: 'australia',
  },
  nz: {
    name: 'New Zealand',
    re: /new zealand|\bnz\b|\banz\b|auckland|wellington|christchurch|hamilton, nz|tauranga|dunedin/i,
    seek: { host: 'www.seek.co.nz', site: 'NZ-Main', where: 'All New Zealand', label: 'SEEK NZ' },
    linkedin: 'New Zealand',
    workable: 'New Zealand',
    jobicy: 'new-zealand',
  },
  sg: {
    name: 'Singapore',
    re: /singapore|\bsg\b/i,
    seek: { host: 'sg.jobstreet.com', site: 'SG-Main', where: '', label: 'Jobstreet SG' },
    linkedin: 'Singapore',
    workable: 'Singapore',
    jobicy: 'singapore',
  },
  ae: {
    name: 'UAE',
    re: /\buae\b|united arab emirates|dubai|abu dhabi|sharjah|ajman/i,
    linkedin: 'United Arab Emirates',
    workable: 'United Arab Emirates',
  },
  ph: {
    name: 'Philippines',
    re: /philippines|\bph\b|manila|makati|taguig|quezon city|cebu|davao|pasig|cavite|luzon|mindanao/i,
    seek: { host: 'ph.jobstreet.com', site: 'PH-Main', where: '', label: 'Jobstreet PH' },
    linkedin: 'Philippines',
    workable: 'Philippines',
    jobicy: 'philippines',
  },
  gb: {
    name: 'United Kingdom',
    re: /united kingdom|\buk\b|\bgb\b|england|scotland|wales|london|manchester|birmingham, uk|edinburgh|glasgow|bristol/i,
    linkedin: 'United Kingdom',
    workable: 'United Kingdom',
    jobicy: 'uk',
  },
  us: {
    name: 'United States',
    re: /united states|\busa?\b|u\.s\.|new york|san francisco|los angeles|chicago|austin|seattle|boston|denver|miami|\b(ca|ny|tx|fl|ma|il|co)\b,?\s*(usa?|$)/i,
    linkedin: 'United States',
    workable: 'United States',
    jobicy: 'usa',
  },
  ca: {
    name: 'Canada',
    re: /canada|toronto|vancouver|montreal|calgary|ottawa|\b(on|bc|ab|qc)\b,?\s*canada/i,
    linkedin: 'Canada',
    workable: 'Canada',
    jobicy: 'canada',
  },
};

// "All countries" pulls the country-specific boards for these markets.
export const ALL_MARKETS = ['au', 'nz', 'sg', 'ae'];

const ANYWHERE = /worldwide|anywhere|global|international|no restriction|remote\s*\(global\)|^remote$|^remote\s*·?\s*$/i;
const REGIONS = [
  [/\bapac\b|asia[\s-]pacific/i, ['au', 'nz', 'sg', 'ph']],
  [/\banz\b|australia\s*(&|and)\s*new zealand/i, ['au', 'nz']],
  [/\bemea\b|middle east|\bgcc\b/i, ['ae', 'gb']],
  [/north america/i, ['us', 'ca']],
];

export const isCountry = code => Object.hasOwn(COUNTRIES, code);

// Returns { countries: ['au', ...], anywhere: bool } for a location string.
export function detectCountries(location = '') {
  const loc = String(location);
  // A long list of allowed countries is really "most places", not a job from any one of them.
  if (loc.split(',').length >= 6) return { countries: [], anywhere: true };
  const found = new Set();
  for (const [code, c] of Object.entries(COUNTRIES)) if (c.re.test(loc)) found.add(code);
  for (const [re, codes] of REGIONS) if (re.test(loc)) codes.forEach(c => found.add(c));
  const anywhere = !loc.trim() ? false : ANYWHERE.test(loc.trim()) || (!found.size && /remote/i.test(loc) && !/onsite|on-site|hybrid/i.test(loc));
  return { countries: [...found], anywhere };
}
