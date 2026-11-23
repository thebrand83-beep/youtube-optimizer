// "Publish to YouTube" — applies the optimizations directly to the video via YouTube Data API v3.
// Everything is previewed (before → after) and opt-in per item; the original is backed up first.
import * as YT from '../core/youtube-api.js';
import { generateCaptions } from '../core/captions.js';
import { loadGIS, signIn, getToken, signOut } from './google-auth.js';
import * as store from './storage.js';

let C; // ctx from app.js
const P = { channel: null, video: null, ownErr: null, busy: false, results: null, caps: {}, capBusy: {}, thumbIdx: 0,
  checks: { title: true, desc: true, tags: true, meta: true, thumb: true, capHe: true, capEn: false, comment: true }, comment: null, connecting: false };
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const LANG_NAME = { he: 'עברית', en: 'English' };
const fmt = n => n.toLocaleString('en-US');

export function initPublish(ctx) { C = ctx; }
export function resetPublish() { Object.assign(P, { video: null, ownErr: null, results: null, caps: {}, capBusy: {}, thumbIdx: 0, comment: null, busy: false }); }
export const backupKey = vid => `ytps.backup.${vid}`;
export const getBackup = vid => { try { return JSON.parse(localStorage.getItem(backupKey(vid)) || 'null'); } catch { return null; } };
const saveBackup = b => { try { localStorage.setItem(backupKey(b.videoId), JSON.stringify(b)); return true; } catch { const { thumbDataUrl, ...rest } = b; localStorage.setItem(backupKey(b.videoId), JSON.stringify(rest)); return false; } };

/* ---------- desired state ---------- */
function desired() {
  const { S } = C, s = S.seo;
  const cat = String(s.category_id || '').replace(/\D/g, '');
  return {
    title: s.titles?.[S.selectedTitle]?.title || '',
    description: C.getDesc(),
    tags: [...(s.tags || [])],
    categoryId: YT.CATEGORIES[cat] ? cat : '',
    defaultLanguage: s.lang === 'en' ? 'en' : 'he',
    defaultAudioLanguage: (S.analysis?.spoken_language || '').toLowerCase().slice(0, 2).replace('iw', 'he') || '',
  };
}
const cur = () => P.video?.snippet || null;
const units = () => {
  const k = P.checks; let u = 0;
  if (k.title || k.desc || k.tags || k.meta) u += YT.QUOTA.update;
  if (k.thumb && C.S.thumbs.length) u += YT.QUOTA.thumbnail;
  if (k.capHe) u += YT.QUOTA.caption; if (k.capEn) u += YT.QUOTA.caption;
  if (k.comment) u += YT.QUOTA.comment;
  return u + 3; // channels.list + videos.list + verification
};

/* ---------- rendering ---------- */
const cost = n => `<span class="cost" title="יחידות מכסה של YouTube API">${n} יח׳</span>`;
const check = (k, label) => `<label class="pchk"><input type="checkbox" data-chk="${k}" ${P.checks[k] ? 'checked' : ''}><span class="box"></span><b>${label}</b></label>`;
const beforeVal = (v, empty = 'יוצג אחרי התחברות') => P.video ? (v || '<span class="muted">— ריק —</span>') : `<span class="muted">${empty}</span>`;
function diff(before, after, { mono = false, changed } = {}) {
  const same = changed === false;
  return `<div class="diff ${same ? 'same' : ''}"><div class="d-before"><span class="d-l">לפני</span><div class="d-v ${mono ? 'mono' : ''}">${before}</div></div><div class="d-arrow">←</div><div class="d-after"><span class="d-l">אחרי</span><div class="d-v ${mono ? 'mono' : ''}">${after}</div></div></div>${same ? '<p class="small muted d-same">ללא שינוי — זהה למה שכבר בסרטון</p>' : ''}`;
}
const tagChips = arr => (arr || []).length ? `<div class="chips sm">${arr.map(t => `<span class="chip">${C.esc(t)}</span>`).join('')}</div>` : '';

function connectCard() {
  const { esc, ic } = C, cid = store.getSettings().clientId;
  if (!C.S.vid) return `<div class="card sec pub-note warn">${ic('warn')}<div><b>פרסום ישיר זמין רק לסרטון שכבר ביוטיוב</b><p class="small muted">נתח את הסרטון דרך הקישור שלו ביוטיוב (גם סרטון "לא רשום" עובד) כדי שנוכל לעדכן אותו.</p></div></div>`;
  if (!cid) return `<div class="card sec pub-note">${ic('lock')}<div><b>עוד צעד אחד: חיבור לחשבון Google</b><p class="small muted">כדי שהאפליקציה תוכל לעדכן את הסרטון בעצמה צריך Client ID של Google (חינמי, הגדרה חד-פעמית של כ-10 דקות). אין חיובים — זה רק אישור גישה לערוץ שלך.</p><div class="row-btns"><button class="btn btn-gold" data-pub="help">${ic('spark')}מדריך הגדרה שלב-אחר-שלב</button><button class="btn btn-ghost" data-pub="settings">${ic('gear')}הדבק Client ID בהגדרות</button></div></div></div>`;
  if (!P.channel) return `<div class="card sec pub-note">${ic('user')}<div><b>התחבר לערוץ היוטיוב שלך</b><p class="small muted">נבקש הרשאה לנהל את הסרטונים בערוץ. שום דבר לא ישתנה עד שתאשר כל פריט ותלחץ "פרסם".</p><div class="row-btns"><button class="btn btn-gold" data-pub="connect" ${P.connecting ? 'disabled' : ''}>${ic('link')}${P.connecting ? 'מתחבר…' : 'התחבר עם Google'}</button><button class="btn btn-ghost" data-pub="help">איך זה עובד?</button></div>${P.ownErr ? `<p class="status err">${esc(P.ownErr)}</p>` : ''}</div></div>`;
  const ch = P.channel.snippet, ok = P.video && !P.ownErr;
  return `<div class="card sec pub-conn"><img src="${esc(ch.thumbnails?.default?.url || '')}" alt=""><div><div class="small muted">מחובר לערוץ</div><b>${esc(ch.title)}</b></div>
    <span class="chip ${ok ? 'ok' : 'bad'}">${ok ? '✓ הסרטון שייך לערוץ הזה' : '✗ ' + esc(P.ownErr || 'בודק בעלות…')}</span>
    <button class="btn btn-ghost btn-sm" data-pub="disconnect" style="margin-inline-start:auto">התנתק</button></div>`;
}

function itemsHtml() {
  const { esc, S, ic } = C, d = desired(), c = cur() || {};
  const t = S.thumbs, k = P.checks;
  const sameTitle = P.video ? c.title === d.title : undefined, sameDesc = P.video ? (c.description || '') === d.description : undefined;
  const sameTags = P.video ? JSON.stringify(c.tags || []) === JSON.stringify(d.tags) : undefined;
  const catName = id => id ? `${YT.CATEGORIES[id] || 'קטגוריה'} (${id})` : '—';
  const caps = ['he', 'en'].map(l => {
    const cp = P.caps[l], busy = P.capBusy[l];
    return `<div class="cap-row">${check(l === 'he' ? 'capHe' : 'capEn', `כתוביות ${LANG_NAME[l]}`)}
      <span class="small muted">${cp ? `✓ ${cp.cues.length} שורות · ${cp.validation.ok ? 'פורמט SRT תקין' : 'בעיות פורמט'}` : busy ? `<span class="spin"></span> ${esc(busy)}` : 'ייווצר אוטומטית מהסרטון בעת הפרסום'}</span>
      <span class="cap-acts">${cp ? `<button class="btn btn-ghost btn-sm" data-cap-view="${l}">תצוגה</button><button class="btn btn-ghost btn-sm" data-cap-dl="${l}">${ic('dl')}SRT</button>` : ''}<button class="btn btn-ghost btn-sm" data-cap-gen="${l}" ${busy ? 'disabled' : ''}>${cp ? 'צור מחדש' : 'צור עכשיו'}</button></span></div>
      ${cp && P.capView === l ? `<pre class="srt" dir="auto">${esc(cp.srt.split('\n').slice(0, 40).join('\n'))}${cp.srt.split('\n').length > 40 ? '\n…' : ''}</pre>` : ''}`;
  }).join('');
  return `
  <div class="pub-group card sec">
    <div class="pg-h"><h4>${ic('text')}עדכון פרטי הסרטון</h4>${cost(YT.QUOTA.update)}<span class="small muted">קריאה אחת ל-videos.update עבור כל הסעיפים המסומנים</span></div>
    <div class="pitem">${check('title', 'כותרת')}${diff(beforeVal(esc(c.title)), `${esc(d.title)} <span class="count">${d.title.length}/100</span>`, { changed: sameTitle === undefined ? undefined : !sameTitle })}<p class="small muted">הכותרת שנבחרה בלשונית "כותרות" (#${S.selectedTitle + 1}).</p></div>
    <div class="pitem">${check('desc', 'תיאור + פרקים')}${diff(beforeVal(esc((c.description || '').slice(0, 1500))), esc(d.description.slice(0, 1500)) + (d.description.length > 1500 ? '…' : ''), { mono: true, changed: sameDesc === undefined ? undefined : !sameDesc })}<p class="small muted">${d.description.length}/5000 תווים · כולל העריכות שלך בלשונית "תיאור".</p></div>
    <div class="pitem">${check('tags', 'תגיות')}${diff(beforeVal(tagChips(c.tags)), tagChips(d.tags), { changed: sameTags === undefined ? undefined : !sameTags })}</div>
    <div class="pitem">${check('meta', 'קטגוריה ושפה')}${diff(beforeVal(`קטגוריה: ${catName(c.categoryId)}<br>שפת הסרטון: ${esc(c.defaultLanguage || '—')} · שפת אודיו: ${esc(c.defaultAudioLanguage || '—')}`), `קטגוריה: ${d.categoryId ? catName(d.categoryId) : '<span class="muted">ללא שינוי</span>'}<br>שפת הסרטון: ${esc(d.defaultLanguage)} · שפת אודיו: ${esc(d.defaultAudioLanguage || '—')}`)}</div>
  </div>
  <div class="pub-group card sec">
    <div class="pg-h"><h4>${ic('img')}תמונה ממוזערת</h4>${cost(YT.QUOTA.thumbnail)}<span class="small muted">JPG 1280×720 מתחת ל-2MB · דורש ערוץ מאומת</span></div>
    ${t.length ? `<div class="pitem">${check('thumb', 'החלף תמונה ממוזערת')}<div class="diff"><div class="d-before"><span class="d-l">לפני</span><img class="d-img" src="https://i.ytimg.com/vi/${esc(S.vid)}/hqdefault.jpg" alt=""></div><div class="d-arrow">←</div><div class="d-after"><span class="d-l">אחרי — בחר עיצוב</span><canvas class="d-img d-big" data-thumb="${P.thumbIdx}" width="1280" height="720"></canvas><div class="thumb-pick">${t.map((_, i) => `<button class="tp ${i === P.thumbIdx ? 'on' : ''}" data-tp="${i}"><canvas data-thumb="${i}" width="1280" height="720"></canvas><span>${i + 1}</span></button>`).join('')}</div></div></div></div>`
    : `<p class="small muted">${S.thumbsPending ? 'התמונות הממוזערות עדיין בהכנה…' : 'אין תמונות ממוזערות מוכנות.'}</p>`}
  </div>
  <div class="pub-group card sec">
    <div class="pg-h"><h4>${ic('text')}כתוביות (Captions)</h4>${cost(YT.QUOTA.caption + ' לכל שפה')}<span class="small muted">Gemini צופה בסרטון ויוצר כתוביות מתוזמנות</span></div>
    ${caps}
    <p class="small muted">כתוביות משפרות נגישות, זמן צפייה וגם SEO — יוטיוב קורא את הטקסט שלהן.</p>
  </div>
  <div class="pub-group card sec">
    <div class="pg-h"><h4>${ic('spark')}תגובה מוצמדת</h4>${cost(YT.QUOTA.comment)}</div>
    <div class="pitem">${check('comment', 'פרסם תגובה מהערוץ')}<textarea class="textarea" id="pubComment" rows="3">${esc(P.comment ?? S.seo.pinned_comment ?? '')}</textarea>
    <p class="small muted">📌 יוטיוב לא מאפשר להצמיד תגובה דרך ה-API — אחרי הפרסום נציג קישור ישיר לתגובה, ושם לוחצים ⋮ ← "הצמדה".</p></div>
  </div>`;
}

function quotaHtml() {
  const u = units(), pct = Math.min(100, u / YT.QUOTA.dailyLimit * 100);
  return `<div class="quota"><div><b>${fmt(u)}</b> / ${fmt(YT.QUOTA.dailyLimit)} יחידות מכסה יומית</div><div class="bar"><i style="width:${pct}%"></i></div><span class="small muted">חינם · מתאפס כל יום בכ-10:00 שעון ישראל</span></div>`;
}

function resultsHtml() {
  const { esc } = C, r = P.results; if (!r) return '';
  return `<div class="card sec pub-results"><h4>${r.title}</h4><ul>${r.items.map(x => `<li class="${x.state}"><span class="ri">${x.state === 'ok' ? '✓' : x.state === 'err' ? '✗' : x.state === 'run' ? '<span class="spin"></span>' : x.state === 'skip' ? '–' : '•'}</span><div><b>${esc(x.label)}</b>${x.msg ? `<div class="small">${x.msg}</div>` : ''}</div></li>`).join('')}</ul></div>`;
}

export function publishPanel() {
  const { ic, S } = C, bk = S.vid && getBackup(S.vid), ready = P.channel && P.video && !P.ownErr;
  return `<div class="pub-head card lux sec"><div>${C.secH('upload', 'פרסום ליוטיוב — אופטימיזציה אוטומטית')}<p class="small muted">האפליקציה מעדכנת את הסרטון ישירות: כותרת, תיאור עם פרקים, תגיות, קטגוריה, תמונה ממוזערת, כתוביות ותגובה. כל מה שלא דורש אותך (בלי קריינות). המקור נשמר בגיבוי וניתן לשחזור בלחיצה.</p></div><button class="btn btn-ghost btn-sm" data-pub="help">${ic('spark')}מדריך</button></div>
  ${connectCard()}
  <div id="pubItems">${itemsHtml()}</div>
  <div class="card lux sec pub-go">
    ${quotaHtml()}
    <div class="pbar-wrap ${P.busy ? 'running' : 'hidden'}" id="pubProg"><div class="pbar-top"><span class="pstage"><i class="pulse-dot"></i><span id="pubStage">מתחיל…</span></span><span class="pct"><b id="pubPct">0</b><small>%</small></span></div><div class="pbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="התקדמות הפרסום"><i id="pubFill"></i></div><div class="pbar-meta"><span>זמן שעבר <b id="pubElapsed" dir="ltr">00:00</b></span></div></div>
    <div class="row-btns">
      <button class="btn btn-gold btn-lg" data-pub="publish" ${!ready || P.busy ? 'disabled' : ''}>${ic('upload')}${P.busy ? 'מפרסם…' : 'פרסם ליוטיוב'}</button>
      ${bk ? `<button class="btn btn-ghost" data-pub="restore" ${P.busy || !ready ? 'disabled' : ''}>${ic('history')}שחזר מקור</button><button class="btn btn-ghost" data-pub="backup">${ic('dl')}הורד גיבוי JSON</button>` : ''}
    </div>
    ${!ready ? `<p class="small muted">${S.vid ? 'התחבר לערוץ כדי להפעיל את הפרסום.' : ''}</p>` : ''}
    ${bk ? `<p class="small muted">גיבוי של הגרסה המקורית נשמר ב-${new Date(bk.ts).toLocaleString('he-IL')}.</p>` : ''}
  </div>
  <div id="pubResults">${resultsHtml()}</div>`;
}

export function refreshPublish() {
  const el = $('[data-p="pub"]'); if (!el) return;
  const keepCmt = $('#pubComment')?.value; if (keepCmt !== undefined) P.comment = keepCmt;
  el.innerHTML = publishPanel(); wirePublish(); drawPicks();
}
function drawPicks() { $$('[data-p="pub"] canvas[data-thumb]').forEach(c => C.drawThumb(+c.dataset.thumb, c)); }

export function onPublishTab() {
  if (store.getSettings().clientId) loadGIS().catch(() => {});
  refreshPublish();
}

/* ---------- actions ---------- */
async function connect() {
  const cid = store.getSettings().clientId;
  P.connecting = true; P.ownErr = null; refreshPublish();
  try {
    let token = getToken();
    if (!token) { await loadGIS(); token = await signIn(cid); }
    await loadOwnership(token);
  } catch (e) { P.ownErr = e.he || e.message; C.toast(P.ownErr, true); }
  P.connecting = false; refreshPublish();
}
async function loadOwnership(token) {
  P.channel = await YT.getMyChannel(token);
  try { const r = await YT.verifyOwnership(token, C.S.vid); P.video = r.video; P.ownErr = null; }
  catch (e) { P.video = null; P.ownErr = e.he || e.message; }
}
async function ensureToken() {
  let t = getToken(); if (t) return t;
  C.toast('ההתחברות פגה — מתחבר מחדש…'); t = await signIn(store.getSettings().clientId); return t;
}

async function genCaption(lang) {
  if (P.capBusy[lang]) return P.capBusy[lang + '_p'];
  P.capBusy[lang] = 'Gemini צופה בסרטון וכותב כתוביות…'; refreshPublish();
  const p = generateCaptions({ apiKey: store.getKey(), video: { youtubeUrl: `https://www.youtube.com/watch?v=${C.S.vid}` }, lang, analysis: C.S.analysis, quality: C.S.quality || 'balanced',
    onStatus: m => { P.capBusy[lang] = m; } })
    .then(r => { if (!r.cues.length) throw Object.assign(new Error(), { he: 'לא זוהה דיבור בסרטון — אין כתוביות להעלות.' }); if (!r.validation.ok) throw Object.assign(new Error(), { he: 'קובץ הכתוביות שנוצר לא תקין: ' + r.validation.errors.slice(0, 2).join('; ') }); P.caps[lang] = r; return r; })
    .finally(() => { P.capBusy[lang] = null; refreshPublish(); });
  P.capBusy[lang + '_p'] = p;
  return p;
}

function download(name, text, type = 'application/json') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
}
async function urlToDataUrl(url) {
  const r = await fetch(url); if (!r.ok) throw new Error('thumb'); const b = await r.blob();
  return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
}

const prog = { t0: 0, timer: null,
  start() { this.t0 = Date.now(); clearInterval(this.timer); this.timer = setInterval(() => this.time(), 500); this.set(2, 'מתחיל…'); },
  set(pct, stage) { const f = $('#pubFill'); if (f) f.style.width = pct + '%'; const p = $('#pubPct'); if (p) p.textContent = Math.floor(pct); if (stage && $('#pubStage')) $('#pubStage').textContent = stage; this.pct = pct; this.stage = stage || this.stage; },
  time() { const s = Math.floor((Date.now() - this.t0) / 1000), e = $('#pubElapsed'); if (e) e.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; },
  stop() { clearInterval(this.timer); } };
function paintRun() { // keep progress + results live without losing state
  $('#pubResults').innerHTML = resultsHtml(); prog.set(prog.pct, prog.stage); prog.time();
}

async function publish() {
  const { S } = C, k = P.checks, vid = S.vid;
  P.comment = $('#pubComment')?.value ?? P.comment;
  const d = desired();
  const items = [];
  const add = (id, label) => { const it = { id, label, state: 'wait', msg: '' }; items.push(it); return it; };
  const iOwn = add('own', 'אימות בעלות על הסרטון וגיבוי המקור');
  const snapKeys = k.title || k.desc || k.tags || k.meta;
  const iSnip = snapKeys ? add('snip', `עדכון ${[k.title && 'כותרת', k.desc && 'תיאור', k.tags && 'תגיות', k.meta && 'קטגוריה ושפה'].filter(Boolean).join(', ')}`) : null;
  const iThumb = k.thumb && S.thumbs.length ? add('thumb', `תמונה ממוזערת (עיצוב ${P.thumbIdx + 1})`) : null;
  const iCaps = [k.capHe && 'he', k.capEn && 'en'].filter(Boolean).map(l => ({ l, it: add('cap-' + l, `כתוביות ${LANG_NAME[l]}`) }));
  const iCmt = k.comment && P.comment?.trim() ? add('cmt', 'תגובה (להצמדה ידנית)') : null;
  if (items.length === 1) return C.toast('לא סומן אף פריט לפרסום', true);
  if (!confirm(`לעדכן את הסרטון ביוטיוב עכשיו?\n\n${items.slice(1).map(x => '• ' + x.label).join('\n')}\n\nהמקור יגובה וניתן לשחזור.`)) return;

  P.busy = true; P.results = { title: 'מפרסם ליוטיוב…', items }; refreshPublish(); prog.start(); paintRun();
  const total = items.length; let n = 0;
  const step = async (it, stage, fn) => {
    if (!it) return; it.state = 'run'; prog.set(4 + n / total * 94, stage); paintRun();
    try { it.msg = (await fn()) || ''; it.state = 'ok'; } catch (e) { it.state = 'err'; it.msg = C.esc(e.he || e.message || String(e)); console.error(e); }
    n++; prog.set(4 + n / total * 94); paintRun();
  };
  let token, backup;
  // 1) ownership + backup (abort everything if this fails)
  await step(iOwn, 'מאמת בעלות ושומר גיבוי…', async () => {
    token = await ensureToken();
    const { video, channel } = await YT.verifyOwnership(token, vid); P.video = video; P.channel = channel;
    const prev = getBackup(vid);
    if (prev) { backup = prev; return 'קיים גיבוי מקורי מהפעם הקודמת — נשמר כפי שהוא.'; }
    const sn = video.snippet;
    backup = { videoId: vid, ts: Date.now(), channelId: channel.id, snippet: { title: sn.title, description: sn.description, tags: sn.tags || [], categoryId: sn.categoryId, defaultLanguage: sn.defaultLanguage, defaultAudioLanguage: sn.defaultAudioLanguage }, created: { captions: [], comments: [] }, thumbChanged: false };
    const tu = sn.thumbnails?.maxres?.url || sn.thumbnails?.standard?.url || sn.thumbnails?.high?.url;
    if (tu) try { backup.thumbDataUrl = await urlToDataUrl(tu); } catch { /* best effort */ }
    const full = saveBackup(backup);
    return full ? 'הגרסה המקורית גובתה בדפדפן (כולל התמונה הממוזערת).' : 'הגרסה המקורית גובתה (ללא התמונה — אין מספיק מקום בדפדפן).';
  });
  if (iOwn.state === 'err') { items.filter(x => x.state === 'wait').forEach(x => { x.state = 'skip'; x.msg = 'לא בוצע'; }); return finish(); }
  const persist = () => saveBackup(backup);

  await step(iSnip, 'מעדכן כותרת, תיאור ותגיות…', async () => {
    const patch = {};
    if (k.title) patch.title = d.title; if (k.desc) patch.description = d.description; if (k.tags) patch.tags = d.tags;
    if (k.meta) { patch.categoryId = d.categoryId; patch.defaultLanguage = d.defaultLanguage; patch.defaultAudioLanguage = d.defaultAudioLanguage; }
    const r = await YT.updateSnippet(token, vid, YT.mergeSnippet(P.video.snippet, patch));
    P.video.snippet = r.snippet || P.video.snippet; backup.snippetChanged = true; persist();
    return 'עודכן בהצלחה.';
  });
  await step(iThumb, 'מעלה תמונה ממוזערת…', async () => {
    const blob = await C.thumbJpeg(P.thumbIdx);
    await YT.setThumbnail(token, vid, blob); backup.thumbChanged = true; persist();
    return `הועלתה (${Math.round(blob.size / 1024)}KB). ייתכן שיעברו כמה דקות עד שתופיע בכל מקום.`;
  });
  for (const { l, it } of iCaps) await step(it, `כתוביות ${LANG_NAME[l]}: ${P.caps[l] ? 'מעלה…' : 'Gemini יוצר כתוביות (עד כמה דקות)…'}`, async () => {
    const cp = P.caps[l] || await genCaption(l);
    prog.set(prog.pct, `מעלה כתוביות ${LANG_NAME[l]}…`);
    const r = await YT.insertCaption(token, vid, { language: l, name: l === 'he' ? 'עברית' : 'English', text: cp.srt });
    backup.created.captions.push(r.id); persist();
    return `${cp.cues.length} שורות הועלו.`;
  });
  await step(iCmt, 'מפרסם תגובה…', async () => {
    const r = await YT.insertComment(token, { channelId: P.channel.id, videoId: vid, text: P.comment.trim() });
    const cid = r.snippet?.topLevelComment?.id || r.id; backup.created.comments.push(cid); persist();
    const link = YT.commentLink(vid, cid);
    return `פורסמה. <a href="${link}" target="_blank" rel="noopener">פתח את התגובה ביוטיוב ←</a> ואז ⋮ ← "הצמדה" כדי להצמיד אותה.`;
  });
  finish();
  function finish() {
    prog.set(100, 'הסתיים'); prog.stop(); P.busy = false;
    const errs = items.filter(x => x.state === 'err').length, oks = items.filter(x => x.state === 'ok').length;
    P.results.title = errs ? `הסתיים: ${oks} הצליחו, ${errs} נכשלו` : '✓ הכל עודכן ביוטיוב';
    refreshPublish(); const pp = $('#pubProg'); if (pp) { pp.classList.remove('hidden', 'running'); } prog.set(100, 'הסתיים'); prog.time();
    C.toast(errs ? 'חלק מהפריטים נכשלו — פרטים בהמשך' : 'הסרטון עודכן ביוטיוב ✓', !!errs);
  }
}

async function restoreOriginal() {
  const vid = C.S.vid, bk = getBackup(vid); if (!bk) return;
  if (!confirm('לשחזר את הגרסה המקורית של הסרטון?\n\nהכותרת, התיאור, התגיות והקטגוריה יחזרו למקור, התמונה הממוזערת המקורית תועלה מחדש, והכתוביות והתגובה שהאפליקציה הוסיפה יימחקו.')) return;
  const items = [];
  const add = l => { const it = { label: l, state: 'wait', msg: '' }; items.push(it); return it; };
  const iS = add('שחזור כותרת, תיאור, תגיות וקטגוריה');
  const iT = bk.thumbChanged ? add('שחזור התמונה הממוזערת המקורית') : null;
  const iC = (bk.created?.captions || []).map(id => ({ id, it: add('מחיקת כתוביות שנוספו') }));
  const iM = (bk.created?.comments || []).map(id => ({ id, it: add('מחיקת התגובה שנוספה') }));
  P.busy = true; P.results = { title: 'משחזר את המקור…', items }; refreshPublish(); prog.start(); paintRun();
  let n = 0; const total = items.length;
  const step = async (it, fn) => { if (!it) return; it.state = 'run'; paintRun(); try { it.msg = (await fn()) || ''; it.state = 'ok'; } catch (e) { it.state = 'err'; it.msg = C.esc(e.he || e.message); } n++; prog.set(n / total * 100, it.label); paintRun(); };
  let token;
  await step(iS, async () => {
    token = await ensureToken();
    const v = await YT.getVideo(token, vid);
    const r = await YT.updateSnippet(token, vid, YT.mergeSnippet(v.snippet, { ...bk.snippet, tags: bk.snippet.tags }));
    if (P.video) P.video.snippet = r.snippet || P.video.snippet;
    return 'הוחזר למקור.';
  });
  await step(iT, async () => {
    if (!bk.thumbDataUrl) throw new Error('התמונה המקורית לא נשמרה בגיבוי — העלה אותה ידנית ב-YouTube Studio.');
    const blob = await (await fetch(bk.thumbDataUrl)).blob(); await YT.setThumbnail(token, vid, blob); return 'הועלתה מחדש.';
  });
  for (const { id, it } of iC) await step(it, async () => { await YT.deleteCaption(token, id); return ''; });
  for (const { id, it } of iM) await step(it, async () => { await YT.deleteComment(token, id); return ''; });
  prog.stop(); P.busy = false;
  const errs = items.filter(x => x.state === 'err').length;
  P.results.title = errs ? `השחזור הסתיים עם ${errs} שגיאות` : '✓ הסרטון שוחזר למקור';
  if (!errs) localStorage.removeItem(backupKey(vid));
  refreshPublish(); C.toast(errs ? 'השחזור הושלם חלקית' : 'הסרטון שוחזר למקור ✓', !!errs);
}

function wirePublish() {
  const el = $('[data-p="pub"]');
  el.onchange = e => {
    const c = e.target.closest('[data-chk]'); if (c) { P.checks[c.dataset.chk] = c.checked; el.querySelector('.quota').outerHTML = quotaHtml(); }
  };
  el.oninput = e => { if (e.target.id === 'pubComment') P.comment = e.target.value; };
  el.onclick = e => {
    const b = e.target.closest('[data-pub]');
    if (b) {
      const a = b.dataset.pub;
      if (a === 'help') return C.openHelp();
      if (a === 'settings') return C.openSettings('clientId');
      if (a === 'connect') return connect();
      if (a === 'disconnect') { signOut(); P.channel = null; P.video = null; P.ownErr = null; return refreshPublish(); }
      if (a === 'publish') return publish();
      if (a === 'restore') return restoreOriginal();
      if (a === 'backup') { const bk = getBackup(C.S.vid); return download(`youtube-backup-${C.S.vid}.json`, JSON.stringify(bk, null, 2)); }
    }
    const tp = e.target.closest('[data-tp]'); if (tp) { P.thumbIdx = +tp.dataset.tp; $$('.tp').forEach(x => x.classList.toggle('on', x === tp)); const big = $('.d-big'); if (big) { big.dataset.thumb = P.thumbIdx; C.drawThumb(P.thumbIdx, big); } return; }
    const g = e.target.closest('[data-cap-gen]'); if (g) return genCaption(g.dataset.capGen).then(() => C.toast('הכתוביות מוכנות ✓')).catch(er => C.toast(er.he || er.message, true));
    const v = e.target.closest('[data-cap-view]'); if (v) { P.capView = P.capView === v.dataset.capView ? null : v.dataset.capView; return refreshPublish(); }
    const dl = e.target.closest('[data-cap-dl]'); if (dl) { const l = dl.dataset.capDl; return download(`captions-${C.S.vid}-${l}.srt`, P.caps[l].srt, 'application/x-subrip'); }
  };
}
