// YouTube helpers: parse link, public metadata (oEmbed), public frame images (CORS-enabled i.ytimg.com).
export function parseVideoId(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s.startsWith('http') ? s : 'https://' + s);
    const h = u.hostname.replace(/^www\.|^m\./, '');
    if (h === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (h.endsWith('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v').slice(0, 11);
      const m = /\/(shorts|embed|live|v)\/([\w-]{11})/.exec(u.pathname);
      if (m) return m[2];
    }
  } catch { /* fallthrough */ }
  return null;
}
export const watchUrl = id => `https://www.youtube.com/watch?v=${id}`;
export const isShortsUrl = s => /\/shorts\//.test(String(s));

export async function fetchOEmbed(id) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(id))}`);
    if (r.ok) return await r.json();
    if (r.status === 401 || r.status === 403) return { private: true };
  } catch { /* ignore */ }
  try {
    const r = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(watchUrl(id))}`);
    const j = await r.json();
    if (!j.error) return j;
  } catch { /* ignore */ }
  return null;
}

/** Candidate frames YouTube auto-extracts (start/middle/end) + current cover. */
export function frameUrls(id) {
  const b = `https://i.ytimg.com/vi/${id}`;
  return [
    { key: 'cover', label: 'תמונה נוכחית', url: `${b}/maxresdefault.jpg`, fallback: `${b}/hqdefault.jpg` },
    { key: 'f1', label: 'פריים 1', url: `${b}/maxres1.jpg`, fallback: `${b}/hq1.jpg` },
    { key: 'f2', label: 'פריים 2', url: `${b}/maxres2.jpg`, fallback: `${b}/hq2.jpg` },
    { key: 'f3', label: 'פריים 3', url: `${b}/maxres3.jpg`, fallback: `${b}/hq3.jpg` },
  ];
}
