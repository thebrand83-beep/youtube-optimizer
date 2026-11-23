// Pure helpers for YouTube limits & formatting (no network, no DOM) — unit-testable.
import { CONFIG } from './config.js';

export function toSeconds(t) {
  if (typeof t === 'number') return t;
  const p = String(t).trim().split(':').map(Number);
  if (p.some(isNaN)) return NaN;
  return p.reduce((a, v) => a * 60 + v, 0);
}
export function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
}

/** YouTube chapter rules: first at 0:00, ascending, >=3 entries, each >=10s. */
export function normalizeChapters(chapters = []) {
  let list = chapters
    .map(c => ({ s: toSeconds(c.time), title: String(c.title || '').trim() }))
    .filter(c => !isNaN(c.s) && c.title)
    .sort((a, b) => a.s - b.s);
  const out = [];
  for (const c of list) {
    if (!out.length) { out.push({ s: 0, title: c.title }); continue; }
    if (c.s - out[out.length - 1].s >= 10) out.push(c);
  }
  const valid = out.length >= 3;
  return { valid, chapters: out.map(c => ({ time: fmtTime(c.s), title: c.title })) };
}

/** Characters YouTube counts for tags: commas between + quotes around tags containing spaces. */
export function tagsLength(tags) {
  if (!tags.length) return 0;
  return tags.reduce((n, t) => n + t.length + (/\s/.test(t) ? 2 : 0), 0) + (tags.length - 1);
}
export function fitTags(tags, max = CONFIG.limits.tagsMax) {
  const seen = new Set(), out = [];
  for (let t of tags) {
    t = String(t).replace(/[<>,#]/g, '').replace(/\s+/g, ' ').trim();
    const k = t.toLowerCase();
    if (!t || t.length > 100 || seen.has(k)) continue;
    if (tagsLength([...out, t]) > max) continue;
    seen.add(k); out.push(t);
  }
  return out;
}

export function normHashtag(h) {
  const t = String(h).replace(/^#+/, '').replace(/[\s\-–.,!?'"״׳]+/g, '');
  return t ? '#' + t : '';
}

export function assembleDescription({ hookLines = [], body = '', chapters = [], chaptersHeading, cta = '', links = [], hashtags = [], lang = 'he' }) {
  const he = lang !== 'en';
  const parts = [];
  parts.push(hookLines.filter(Boolean).join('\n'));
  if (body) parts.push(body.trim());
  if (chapters.length) parts.push(`${chaptersHeading || (he ? '⏱️ פרקים בסרטון:' : '⏱️ Chapters:')}\n` + chapters.map(c => `${c.time} ${c.title}`).join('\n'));
  if (cta) parts.push(cta.trim());
  if (links.length) parts.push(links.join('\n'));
  const tags = [...new Set(hashtags.map(normHashtag).filter(Boolean))].slice(0, CONFIG.limits.hashtagsMax);
  if (tags.length) parts.push(tags.join(' '));
  let text = parts.filter(Boolean).join('\n\n').replace(/[<>]/g, '');
  if (text.length > CONFIG.limits.descriptionMax) text = text.slice(0, CONFIG.limits.descriptionMax);
  return text;
}

export function defaultLinks(lang = 'he') {
  return lang === 'en'
    ? ['🔗 Links:', '▸ Website: [your link]', '▸ Instagram: [your link]', '▸ WhatsApp / bookings: [your link]']
    : ['🔗 קישורים:', '▸ אתר: [הקישור שלך]', '▸ אינסטגרם: [הקישור שלך]', '▸ וואטסאפ / הזמנות: [הקישור שלך]'];
}
