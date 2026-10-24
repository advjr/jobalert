const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·',
  copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', eacute: 'é', times: '×',
};

export function decodeEntities(s = '') {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

// Turn job-board HTML into readable plain text with bullets and paragraph breaks kept.
// The dashboard only ever renders this text, never the source HTML.
export function htmlToText(html = '') {
  let s = String(html);
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => {
    const label = decodeEntities(inner.replace(/<[^>]+>/g, '')).trim();
    const target = decodeEntities(href).replace(/^mailto:/i, '');
    if (!/^(https?:|[^@\s]+@)/i.test(target) || label.includes(target)) return label;
    return label ? `${label} (${target})` : target;
  });
  s = s.replace(/<li[^>]*>/gi, '\n• ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/?(p|div|h[1-6]|ul|ol|tr|section|blockquote|table)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n• *\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function clip(s = '', max = 6000) {
  return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, '') + ' …' : s;
}
