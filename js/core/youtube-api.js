// YouTube Data API v3 client (browser, OAuth access token passed in; no secrets stored).
// Quota costs per https://developers.google.com/youtube/v3/determine_quota_cost
export const QUOTA = { list: 1, update: 50, thumbnail: 50, caption: 400, comment: 50, delete: 50, dailyLimit: 10000 };
const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';

export class YTError extends Error {
  constructor(status, reason, he, detail) { super(he); Object.assign(this, { status, reason, he, detail }); }
}

export function mapYTError(status, body, ctx = '') {
  const err = body?.error || {}, reason = err.errors?.[0]?.reason || err.status || '', msg = err.message || '';
  const R = (he) => new YTError(status, reason, he, msg);
  if (status === 401) return R('ההתחברות ל-Google פגה. לחץ "התחבר מחדש" ונסה שוב.');
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') return R('נגמרה המכסה היומית של YouTube API (10,000 יחידות). היא מתאפסת בחצות שעון פסיפיק (בערך 10:00 בבוקר שעון ישראל).');
  if (reason === 'insufficientPermissions' || reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') return R('לא ניתנה הרשאה מלאה לניהול הערוץ. התחבר מחדש ואשר את כל ההרשאות.');
  if (ctx === 'thumbnail' && status === 403) return R('יוטיוב לא מאפשר להעלות תמונה ממוזערת מותאמת: הערוץ צריך להיות מאומת (אימות טלפון בכתובת youtube.com/verify) או שיש מגבלה על החשבון.');
  if (ctx === 'thumbnail' && status === 413) return R('קובץ התמונה גדול מ-2MB.');
  if (reason === 'videoNotFound' || status === 404) return R('הסרטון לא נמצא או שאין גישה אליו מהחשבון המחובר.');
  if (reason === 'forbidden' && ctx === 'video') return R('אין הרשאה לערוך את הסרטון הזה — ודא שהתחברת לחשבון שהעלה אותו.');
  if (reason === 'invalidTags') return R('יוטיוב דחה את התגיות (ארוכות מדי או תווים לא חוקיים).');
  if (reason === 'invalidTitle') return R('יוטיוב דחה את הכותרת (ריקה, ארוכה מ-100 תווים או מכילה < >).');
  if (reason === 'invalidDescription') return R('יוטיוב דחה את התיאור (ארוך מ-5,000 תווים או מכיל < >).');
  if (reason === 'invalidCategoryId') return R('קטגוריה לא חוקית.');
  if (ctx === 'caption' && reason === 'contentRequired') return R('קובץ הכתוביות ריק.');
  if (ctx === 'caption' && (reason === 'invalidMetadata' || status === 400)) return R('יוטיוב דחה את קובץ הכתוביות (פורמט לא תקין).');
  if (ctx === 'caption' && reason === 'forbidden') return R('אין הרשאה להוסיף כתוביות לסרטון הזה.');
  if (ctx === 'comment' && (reason === 'commentsDisabled' || reason === 'forbidden')) return R('התגובות בסרטון הזה כבויות או שאין הרשאה לפרסם תגובה. הפעל תגובות ב-YouTube Studio ונסה שוב.');
  if (status >= 500) return R('שרתי YouTube לא זמינים כרגע. נסה שוב בעוד רגע.');
  return R(`שגיאה מ-YouTube (${status}${reason ? ' · ' + reason : ''}).`);
}

async function call(token, url, opts = {}, ctx) {
  let res;
  try {
    res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  } catch (e) { throw new YTError(0, 'network', 'אין חיבור ל-YouTube. בדוק את החיבור לאינטרנט.', String(e)); }
  if (res.status === 204) return {};
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw mapYTError(res.status, body, ctx);
  return body;
}

export async function getMyChannel(token) {
  const r = await call(token, `${API}/channels?part=snippet,status&mine=true`, {}, 'channel');
  const ch = r.items?.[0];
  if (!ch) throw new YTError(404, 'noChannel', 'לחשבון Google הזה אין ערוץ יוטיוב. התחבר עם החשבון שמחזיק את הערוץ.');
  return ch;
}

export async function getVideo(token, id) {
  const r = await call(token, `${API}/videos?part=snippet,status&id=${encodeURIComponent(id)}`, {}, 'video');
  const v = r.items?.[0];
  if (!v) throw new YTError(404, 'videoNotFound', 'הסרטון לא נמצא בחשבון הזה.');
  return v;
}

/** Ownership: the video's channelId must equal the signed-in channel. */
export async function verifyOwnership(token, videoId) {
  const [ch, v] = await Promise.all([getMyChannel(token), getVideo(token, videoId)]);
  if (v.snippet.channelId !== ch.id)
    throw new YTError(403, 'notOwner', `הסרטון שייך לערוץ "${v.snippet.channelTitle}", ואתה מחובר לערוץ "${ch.snippet.title}". אפשר לעדכן רק סרטונים של הערוץ המחובר.`);
  return { channel: ch, video: v };
}

/** videos.update replaces the whole snippet → always send the full merged snippet (title + categoryId are required). */
export function mergeSnippet(current, patch) {
  const s = { title: current.title, description: current.description || '', tags: current.tags || [], categoryId: current.categoryId };
  if (current.defaultLanguage) s.defaultLanguage = current.defaultLanguage;
  if (current.defaultAudioLanguage) s.defaultAudioLanguage = current.defaultAudioLanguage;
  for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== null && v !== '') s[k] = v;
  return s;
}

export async function updateSnippet(token, videoId, snippet) {
  return call(token, `${API}/videos?part=snippet`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: videoId, snippet }),
  }, 'video');
}

export async function setThumbnail(token, videoId, blob) {
  if (blob.size > 2 * 1024 * 1024) throw new YTError(413, 'tooLarge', 'קובץ התמונה גדול מ-2MB.');
  return call(token, `${UPLOAD}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
    method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob,
  }, 'thumbnail');
}

export async function insertCaption(token, videoId, { language, name, text }) {
  const boundary = 'ytps' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ snippet: { videoId, language, name, isDraft: false } });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n${text}\r\n--${boundary}--`;
  return call(token, `${UPLOAD}/captions?part=snippet&uploadType=multipart`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: new Blob([body], { type: `multipart/related; boundary=${boundary}` }),
  }, 'caption');
}
export const deleteCaption = (token, id) => call(token, `${API}/captions?id=${encodeURIComponent(id)}`, { method: 'DELETE' }, 'caption');

export async function insertComment(token, { channelId, videoId, text }) {
  return call(token, `${API}/commentThreads?part=snippet`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snippet: { channelId, videoId, topLevelComment: { snippet: { textOriginal: text } } } }),
  }, 'comment');
}
export const deleteComment = (token, id) => call(token, `${API}/comments?id=${encodeURIComponent(id)}`, { method: 'DELETE' }, 'comment');
export const commentLink = (videoId, commentId) => `https://www.youtube.com/watch?v=${videoId}&lc=${commentId}`;

export const CATEGORIES = { 1: 'סרטים ואנימציה', 2: 'רכב', 10: 'מוזיקה', 15: 'חיות', 17: 'ספורט', 19: 'טיולים ואירועים', 20: 'גיימינג', 22: 'אנשים ובלוגים', 23: 'קומדיה', 24: 'בידור', 25: 'חדשות ופוליטיקה', 26: 'מדריכים וסטייל', 27: 'חינוך', 28: 'מדע וטכנולוגיה', 29: 'עמותות ואקטיביזם' };
