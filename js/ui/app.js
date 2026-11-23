import { CONFIG } from '../core/config.js';
import { generate, sleep } from '../core/gemini.js';
import { analyzeVideo, buildSeo, designThumbnails, generateThumbImage } from '../core/pipeline.js';
import { parseVideoId, watchUrl, fetchOEmbed, frameUrls } from '../core/youtube.js';
import { tagsLength, fitTags, normHashtag } from '../core/seo.js';
import * as store from './storage.js';
import { grokPrompt } from '../core/prompts.js';
import { render, toJpeg, loadImage, ensureFonts } from './composer.js';
import { initPublish, publishPanel, onPublishTab, resetPublish, refreshPublish } from './publish.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (id) => `<svg><use href="#i-${id}"/></svg>`;
const S = { brief: {}, frames: {}, thumbs: [], face: null, custom: null, aiBlocked: sessionStorage.getItem('ytps.aiBlocked') === '1' };
window.__ytps = S; // handy for debugging

/* ---------- toast & copy ---------- */
let tt; function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(tt); tt = setTimeout(() => t.className = 'toast', 3200); }
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  if (btn) { const o = btn.innerHTML; btn.classList.add('ok'); btn.innerHTML = `${ic('copy')}הועתק ✓`; setTimeout(() => { btn.classList.remove('ok'); btn.innerHTML = o; }, 1600); }
  else toast('הועתק ללוח ✓');
}
const copyBtn = (key, label = 'העתק') => `<button class="copy" data-copy="${key}">${ic('copy')}${label}</button>`;

/* ---------- segmented controls ---------- */
function segVal(name) { return $(`.seg[data-name="${name}"] .on`)?.dataset.v; }
function setSeg(name, v) { $$(`.seg[data-name="${name}"] button`).forEach(b => b.classList.toggle('on', b.dataset.v === v)); }
document.addEventListener('click', e => { const b = e.target.closest('.seg button'); if (b) setSeg(b.parentElement.dataset.name, b.dataset.v); });

/* ---------- settings ---------- */
function refreshKeyDot() { $('#btnSettings').dataset.ok = store.getKey() ? '1' : '0'; }
function openSettings(focus) {
  const s = store.getSettings();
  $('#apiKey').value = store.getKey(); setSeg('quality', s.quality); setSeg('aiImages', s.aiImages); $('#links').value = s.links || ''; $('#clientId').value = s.clientId || '';
  $('#keyStatus').textContent = ''; $('#cidStatus').textContent = ''; $('#settings').classList.add('open');
  if (focus === 'clientId') setTimeout(() => { $('#clientId').scrollIntoView({ block: 'center' }); $('#clientId').focus(); }, 50);
}
function openHelp() { $('#ytHelp').classList.add('open'); }
$('#btnSettings').onclick = () => openSettings(); $('#errSettings').onclick = () => openSettings();
$('#openHelp').onclick = e => { e.preventDefault(); openHelp(); };
const CID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
$('#toggleKey').onclick = () => { const i = $('#apiKey'); i.type = i.type === 'password' ? 'text' : 'password'; $('#toggleKey').textContent = i.type === 'password' ? 'הצג' : 'הסתר'; };
$('#testKey').onclick = async () => {
  const st = $('#keyStatus'); st.className = 'status'; st.textContent = 'בודק…';
  const key = $('#apiKey').value.trim();
  if (!key) { st.className = 'status err'; st.textContent = 'הדבק קודם את המפתח'; return; }
  try {
    // Validate the key via the lightweight models list (not affected by model load), then save it.
    const r = await fetch(`${CONFIG.apiBase}/models?pageSize=1`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(20000) });
    if (r.ok) { store.setKey(key); refreshKeyDot(); st.className = 'status ok'; st.textContent = '✓ המפתח תקין ונשמר'; return; }
    if (r.status === 400 || r.status === 401) { st.className = 'status err'; st.textContent = 'מפתח ה-API לא תקין. ודא שהעתקת אותו במלואו.'; return; }
    if (r.status === 403) { st.className = 'status err'; st.textContent = 'למפתח אין הרשאה ל-Gemini API. ודא שהשירות מופעל בפרויקט.'; return; }
    store.setKey(key); refreshKeyDot(); st.className = 'status ok'; st.textContent = `המפתח נשמר. השרת החזיר ${r.status}, אפשר להתחיל לעבוד.`;
  } catch (e) { store.setKey(key); refreshKeyDot(); st.className = 'status'; st.textContent = 'לא הצלחתי לבדוק כרגע (בעיית רשת), אבל המפתח נשמר.'; }
};
$('#saveSettings').onclick = () => {
  const cid = $('#clientId').value.trim();
  if (cid && !CID_RE.test(cid)) { $('#cidStatus').className = 'status err'; $('#cidStatus').textContent = 'זה לא נראה כמו Client ID — הוא אמור להסתיים ב-.apps.googleusercontent.com'; return; }
  store.setKey($('#apiKey').value); store.setSettings({ quality: segVal('quality'), aiImages: segVal('aiImages'), links: $('#links').value, clientId: cid });
  if ($('[data-p="pub"]')) refreshPublish();
  if (segVal('aiImages') === 'auto') { S.aiBlocked = false; sessionStorage.removeItem('ytps.aiBlocked'); }
  refreshKeyDot(); $('#settings').classList.remove('open'); toast('ההגדרות נשמרו');
};
$('#clearKey').onclick = () => { store.setKey(''); $('#apiKey').value = ''; refreshKeyDot(); toast('המפתח נמחק מהדפדפן'); };
$$('.overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o || e.target.closest('[data-close]')) o.classList.remove('open'); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.overlay.open').forEach(o => o.classList.remove('open')); });

/* ---------- history ---------- */
$('#btnHistory').onclick = () => {
  const h = store.getHistory();
  $('#histList').innerHTML = h.length ? h.map((x, i) => `<div class="hist-item" data-i="${i}"><img src="https://i.ytimg.com/vi/${esc(x.vid)}/mqdefault.jpg" alt=""><div><b>${esc(x.meta?.title || x.seo?.titles?.[0]?.title || 'סרטון')}</b><div class="small muted">${new Date(x.ts).toLocaleString('he-IL')} · ציון ${x.analysis?.scores?.overall ?? '-'}</div></div></div>`).join('') : '<p class="muted" style="margin-top:16px">עדיין אין ניתוחים.</p>';
  $('#history').classList.add('open');
};
$('#histList').onclick = e => { const it = e.target.closest('.hist-item'); if (!it) return; const x = store.getHistory()[+it.dataset.i]; $('#history').classList.remove('open'); restore(x); };

/* ---------- form ---------- */
$('#moreToggle').onclick = () => { $('#more').classList.toggle('open'); $('#moreToggle').textContent = $('#more').classList.contains('open') ? '－ הסתר אפשרויות מתקדמות' : '＋ אפשרויות מתקדמות'; };
$('#videoFile').onchange = e => { const f = e.target.files[0]; $('#videoFileName').textContent = f ? `${f.name} · ${(f.size / 1048576).toFixed(1)}MB` : 'בחר קובץ וידאו (MP4/MOV)'; };
$('#form').onsubmit = e => { e.preventDefault(); run(); };
$('#errRetry').onclick = () => run();

const TIPS = [
  '70% מהצפיות ביוטיוב מגיעות מהמלצות — תמונה ממוזערת וכותרת הם 90% מההחלטה ללחוץ.',
  '2 השורות הראשונות של התיאור מופיעות בתוצאות החיפוש — שם חייבת להיות מילת המפתח.',
  'פרקים (Chapters) בתיאור מגדילים זמן צפייה ומופיעים כ"רגעים מרכזיים" בגוגל.',
  'טקסט על תמונה ממוזערת: 2–4 מילים, לא יותר. הוא צריך להשלים את הכותרת, לא לחזור עליה.',
  '30 השניות הראשונות קובעות את שימור הקהל. הבטיחו את התוצאה כבר בפתיחה.',
  'תגובה מוצמדת עם שאלה פותחת שיחה ומעלה את המעורבות בסרטון.',
];
let tipTimer;
function progress(step, msg, title) {
  $$('.step').forEach(s => { const n = +s.dataset.s; s.classList.toggle('done', n < step); s.classList.toggle('active', n === step); });
  if (msg) $('#progMsg').textContent = msg; if (title) $('#progTitle').textContent = title;
}
function showOnly(id) { document.body.classList.toggle('compact', id === '#results' || id === '#progressSec'); ['#progressSec', '#errorSec', '#results'].forEach(s => $(s).classList.toggle('hidden', s !== id)); }

async function run() {
  const apiKey = store.getKey();
  if (!apiKey) { openSettings(); toast('כדי להתחיל, הזן מפתח Gemini API', true); return; }
  const file = $('#videoFile').files[0];
  const vid = parseVideoId($('#url').value);
  if (!vid && !file) { toast('הדבק קישור תקין לסרטון ביוטיוב', true); $('#url').focus(); return; }
  const settings = store.getSettings();
  S.vid = vid; S.brief = {
    language: segVal('language'), detail: segVal('detail'), description: $('#desc').value.trim(), audience: $('#audience').value.trim(), timezone: $('#tz').value.trim(),
    links: settings.links ? settings.links.split('\n').map(s => s.trim()).filter(Boolean) : null,
  };
  resetPublish(); S.quality = settings.quality; S.thumbs = []; S.concepts = []; S.thumbsPending = false; S.thumbErr = null; S.selectedTitle = 0;
  $('#go').disabled = true; showOnly('#progressSec');
  $('#progressSec').scrollIntoView({ behavior: 'smooth', block: 'center' });
  let ti = 0; $('#tip').textContent = TIPS[0]; clearInterval(tipTimer); tipTimer = setInterval(() => { $('#tip').textContent = TIPS[++ti % TIPS.length]; }, 6000);
  const onStatus = m => $('#progMsg').textContent = m;
  P.start();
  try {
    progress(1, 'צופה בסרטון, מקשיב לדיבור וקורא טקסטים על המסך…', 'מנתח את הסרטון');
    P.stage('קריאת פרטי הסרטון', 0, 4, { tau: 3 });
    let video;
    if (file) {
      const { uploadFile } = await import('../core/gemini.js');
      P.stage('מעלה את קובץ הווידאו', 0, 15, { tau: 40 });
      const up = await uploadFile({ apiKey, file, mimeType: file.type || 'video/mp4', displayName: file.name, onStatus });
      video = { fileUri: up.uri, mimeType: up.mimeType }; S.meta = { title: file.name.replace(/\.\w+$/, '') };
    } else {
      S.meta = await fetchOEmbed(vid) || {};
      if (S.meta.private) throw Object.assign(new Error(), { he: 'הסרטון פרטי. Gemini יכול לנתח רק סרטון ציבורי או לא-רשום — או העלה את קובץ הווידאו באפשרויות המתקדמות.' });
      video = { youtubeUrl: watchUrl(vid) };
      preloadFrames(vid);
    }
    P.stage('צפייה וניתוח עומק של הסרטון', P.pct, 58, { tau: 45, expChars: 7500 });
    const A = await analyzeVideo({ apiKey, video, meta: S.meta, brief: S.brief, quality: S.quality, onStatus, onText: t => P.chars(t.length) });
    S.analysis = A.analysis; S.models = { analysis: A.model };
    // SEO package and thumbnail concepts only need the analysis JSON (never the video again) → run in parallel.
    progress(2, 'כותב כותרות, תיאור SEO מלא ותגיות — ובמקביל מתכנן תמונות ממוזערות…', 'בונה חבילת SEO');
    $$('.step[data-s="3"]').forEach(x => x.classList.add('active'));
    P.stage('כותרות, תיאור, תגיות וקונספטים לתמונות', 58, 93, { tau: 30, expChars: 9000 });
    let seoChars = 0, thChars = 0;
    const seoP = buildSeo({ apiKey, analysis: S.analysis, meta: S.meta, brief: S.brief, quality: S.quality, onStatus,
      onText: t => { seoChars = t.length; P.chars(seoChars + thChars); const m = /"title"\s*:\s*"([^"]{8,})"/.exec(t); if (m) P.live(`כותרת ראשונה: "${m[1]}"`); } });
    const thP = designThumbnails({ apiKey, analysis: S.analysis, brief: S.brief, hasFace: !!S.face, quality: S.quality, onStatus,
      onText: t => { thChars = t.length; P.chars(seoChars + thChars); } });
    // Show results as soon as the SEO package is ready; thumbnails fill in when their concepts arrive.
    const thDone = thP.then(async C => {
      S.concepts = C.concepts; S.thumbErr = null; S.thumbsPending = true;
      await buildThumbs({ apiKey, onStatus });
      S.thumbsPending = false;
    }, e => { S.concepts = []; S.thumbs = []; S.thumbsPending = false; S.thumbErr = e.he || e.message; });
    const B = await seoP;
    S.seo = B.seo; S.models.seo = B.model;
    const thReady = await Promise.race([thDone.then(() => true), sleep(400).then(() => false)]);
    if (!thReady) { S.thumbsPending = true; S.concepts = S.concepts || []; S.thumbs = []; }
    P.done(); progress(5);
    saveHistory();
    renderResults();
    if (!thReady) { await thDone; saveHistory(); updateThumbsPanel(); if ($('.tab.on')?.dataset.t !== 'th') toast('התמונות הממוזערות מוכנות ✓'); }
  } catch (e) {
    console.error(e);
    P.stop();
    $('#errTitle').textContent = 'לא הצלחנו להשלים את הניתוח';
    $('#errMsg').textContent = e.he || e.message || String(e);
    showOnly('#errorSec');
  } finally { $('#go').disabled = false; clearInterval(tipTimer); P.stop(); }
}

/* ---------- honest progress bar ----------
   Each stage jumps to its real checkpoint when it completes. While a stage runs, the bar creeps
   asymptotically toward (never reaching) the next checkpoint, and streamed output pushes it further. */
const P = {
  pct: 0, t0: 0, timer: null, st: null,
  start() { this.pct = 0; this.t0 = Date.now(); this.st = null; $('#pNote').textContent = ''; $('#pLive').textContent = ''; this.paint(); clearInterval(this.timer); this.timer = setInterval(() => this.tick(), 200); $('#progressSec').classList.add('running'); },
  stage(name, from, to, { tau = 20, expChars = 0 } = {}) { this.pct = Math.max(this.pct, from); this.st = { name, from: this.pct, to, tau, expChars, chars: 0, t: Date.now() }; $('#pStage').textContent = name; $('#pNote').textContent = ''; this.tick(); },
  chars(n) { if (this.st) this.st.chars = n; },
  live(txt) { $('#pLive').textContent = txt; },
  tick() {
    const st = this.st;
    if (st) {
      const t = (Date.now() - st.t) / 1000, span = st.to - st.from;
      const creep = st.from + span * 0.9 * (1 - Math.exp(-t / st.tau));
      const tok = st.expChars && st.chars ? st.from + span * 0.97 * Math.min(1, st.chars / st.expChars) : 0;
      this.pct = Math.min(st.to - 0.3, Math.max(this.pct, creep, tok));
      if (t > 150) $('#pNote').textContent = 'השרת עמוס, ממשיך לעבוד…';
    }
    this.paint();
  },
  paint() {
    $('#pPct').textContent = Math.floor(this.pct);
    $('#pFill').style.width = this.pct + '%';
    $('#progressSec .pbar').setAttribute('aria-valuenow', Math.floor(this.pct));
    const s = Math.floor((Date.now() - this.t0) / 1000);
    $('#pElapsed').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  },
  done() { this.pct = 100; this.st = null; $('#pStage').textContent = 'הושלם'; this.paint(); },
  stop() { clearInterval(this.timer); $('#progressSec').classList.remove('running'); },
};

function saveHistory() {
  store.addHistory({ id: S.vid || S.meta?.title, vid: S.vid, ts: Date.now(), meta: S.meta, brief: S.brief, analysis: S.analysis, seo: S.seo, concepts: S.concepts, models: S.models });
}
async function restore(x) {
  resetPublish();
  Object.assign(S, { vid: x.vid, meta: x.meta, brief: x.brief, analysis: x.analysis, seo: x.seo, concepts: x.concepts || [], models: x.models, thumbs: [], selectedTitle: 0, thumbsPending: false, thumbErr: null });
  if (S.vid) preloadFrames(S.vid);
  await buildThumbs({ apiKey: store.getKey(), skipAI: true });
  renderResults();
}

/* ---------- frames & thumbnails ---------- */
async function loadFrame(f) { try { return await loadImage(f.url); } catch { try { return await loadImage(f.fallback); } catch { return null; } } }
let framesPromise;
function preloadFrames(vid) {
  framesPromise = Promise.all(frameUrls(vid).map(async f => [f.key, await loadFrame(f)])).then(list => {
    S.frames = Object.fromEntries(list.filter(x => x[1] && x[1].naturalWidth > 200)); return S.frames;
  });
  return framesPromise;
}
const SRC_LABEL = { grok: 'תמונה מ-Grok', ai: 'AI', cover: 'תמונה נוכחית', f1: 'פריים 1', f2: 'פריים 2', f3: 'פריים 3', custom: 'תמונה שהעלית', face: 'התמונה שלך', none: 'רקע גרפי' };
function defaultSource(i) {
  if (S.custom) return 'custom';
  const order = [['f2', 'f1', 'f3', 'cover'], ['f1', 'f3', 'f2', 'cover'], ['f3', 'f2', 'f1', 'cover']][i] || ['cover'];
  return order.find(k => S.frames[k]) || Object.keys(S.frames)[0] || 'none';
}
function imgToB64(img) {
  const c = document.createElement('canvas'); const s = Math.min(1, 1024 / Math.max(img.width, img.height));
  c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { mime: 'image/jpeg', b64: c.toDataURL('image/jpeg', 0.88).split(',')[1] };
}
async function buildThumbs({ apiKey, onStatus, skipAI, only } = {}) {
  await ensureFonts();
  if (framesPromise) await framesPromise;
  const settings = store.getSettings();
  const wantAI = !skipAI && settings.aiImages !== 'off' && !S.aiBlocked;
  const idxs = only != null ? [only] : S.concepts.map((_, i) => i);
  for (const i of idxs) {
    const c = S.concepts[i];
    const t = S.thumbs[i] = { concept: c, headline: c.headline, badge: c.badge || '', layout: c.layout, src: defaultSource(i), ai: null, useFace: !!S.face };
    if (wantAI && apiKey) {
      try {
        onStatus?.(`יוצר תמונה ${i + 1} מתוך ${idxs.length} עם Nano Banana…`);
        const refs = []; if (S.face) refs.push(S.face.ref);
        const fr = S.custom?.img || S.frames[defaultSource(i)]; if (fr) refs.push(imgToB64(fr));
        const img = await generateThumbImage({ apiKey, concept: c, refs, hasFace: !!S.face, onStatus });
        t.ai = await loadImage(`data:${img.mime};base64,${img.b64}`); t.src = 'ai'; t.useFace = false; S.models.image = img.model;
      } catch (e) {
        if (e.code === 'no_free_quota') { S.aiBlocked = true; sessionStorage.setItem('ytps.aiBlocked', '1'); }
        S.aiError = e.he || e.message;
        if (S.aiBlocked) break; // remaining thumbnails fall back to the Smart Composer below
      }
    }
  }
  for (const i of S.concepts.map((_, i) => i)) if (!S.thumbs[i]) S.thumbs[i] = { concept: S.concepts[i], headline: S.concepts[i].headline, badge: S.concepts[i].badge || '', layout: S.concepts[i].layout, src: defaultSource(i), useFace: !!S.face };
}
function bgFor(t) { return t.src === 'grok' ? t.grok : t.src === 'ai' ? t.ai : t.src === 'custom' ? S.custom?.img : t.src === 'face' ? S.face?.img : S.frames[t.src] || null; }
function drawThumb(i, canvas) {
  const t = S.thumbs[i]; if (!t) return;
  render(canvas, { bg: bgFor(t), face: t.useFace && t.src !== 'face' ? S.face?.img : null, concept: { ...t.concept, layout: t.layout }, headline: t.headline, badge: t.badge, bgFocus: t.src === 'grok' || t.src === 'ai' ? 0.5 : null });
}
function redraw(i) {
  $$(`canvas[data-thumb="${i}"]`).forEach(c => drawThumb(i, c));
}

/* ---------- results rendering ---------- */
function ring(score) {
  const r = 50, C = 2 * Math.PI * r, off = C * (1 - (score || 0) / 100);
  return `<div class="ring"><svg viewBox="0 0 120 120"><defs><linearGradient id="rg" x1="0" x2="1"><stop offset="0" stop-color="#f6e2b0"/><stop offset="1" stop-color="#a67c3d"/></linearGradient></defs><circle cx="60" cy="60" r="${r}" stroke="rgba(255,255,255,.07)" stroke-width="9" fill="none"/><circle class="ring-arc" cx="60" cy="60" r="${r}" stroke="url(#rg)" stroke-width="9" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-off="${off}" style="transition:stroke-dashoffset 1.6s cubic-bezier(.2,.7,.2,1)"/></svg><div class="val"><div><b>${score ?? '–'}</b><small>ציון כללי</small></div></div></div>`;
}
const bar = (label, v) => `<div class="bar-row"><span>${esc(label)}</span><div class="bar"><i data-w="${v}"></i></div><b>${v ?? '-'}</b></div>`;
const list = (arr, cls = '') => `<ul class="list ${cls}">${(arr || []).map(x => `<li><span>${esc(x)}</span></li>`).join('')}</ul>`;
const secH = (icon, title, right = '') => `<div class="sec-h"><h3><span class="ic">${ic(icon)}</span>${title}</h3>${right}</div>`;

function thumbsPanel() {
  const s = S.seo, m = S.meta || {};
  if (S.thumbsPending) return `<div class="card lux sec pending-thumbs"><div class="prog-head"><div class="orb"><i></i></div><div><h3>מתכנן 3 קונספטים לתמונות ממוזערות…</h3><p class="muted">שאר התוצאות כבר מוכנות — התמונות יופיעו כאן אוטומטית תוך רגע.</p></div></div><div class="grid3" style="margin-top:20px">${[0, 1, 2].map(() => '<div class="skel" style="height:auto;aspect-ratio:16/9;border-radius:12px"></div>').join('')}</div></div>`;
  return `    <div class="card lux sec grok-steps">
      ${secH('spark', 'רקע מקצועי עם Grok', '<span class="small muted">בחינם במסגרת המנוי שלך</span>')}
      <ol class="steps3">
        <li><b>1</b><div><strong>העתק</strong><span>לחץ "העתק פרומפט ופתח ב-Grok" בקונספט שאהבת${S.face || S.custom ? ' וצרף ב-Grok את התמונה שהעלית' : ''}</span></div></li>
        <li><b>2</b><div><strong>צור והורד</strong><span>הדבק ב-Grok Imagine, בחר את התמונה הכי טובה ושמור אותה למכשיר</span></div></li>
        <li><b>3</b><div><strong>העלה לכאן</strong><span>לחץ על "העלה תמונה מ-Grok" בקונספט (או גרור אותה במחשב) — הכותרת בעברית תתווסף אוטומטית</span></div></li>
      </ol>
      ${S.aiError && store.getSettings().aiImages !== 'off' ? `<p class="small muted" style="margin-top:10px">יצירה אוטומטית ב-Gemini לא זמינה כרגע בחשבון — לכן משתמשים ב-Grok.</p>` : S.models?.image ? `<p class="small muted" style="margin-top:10px">חלק מהרקעים נוצרו אוטומטית ב-${esc(S.models.image)}.</p>` : ''}
    </div>
    <div class="card sec" style="margin-bottom:18px">${secH('refresh', 'שיפור ויצירה מחדש')}
      <div class="refs">
        <label class="ref-slot" id="faceSlot">${S.face ? `<img src="${S.face.url}">` : ic('user')}<span><b>התמונה שלך</b><br>${S.face ? 'לחץ להחלפה' : 'העלה תמונת פנים להבעה חזקה'}</span><input type="file" accept="image/*" hidden id="faceIn"></label>
        <label class="ref-slot" id="frameSlot">${S.custom ? `<img src="${S.custom.url}">` : ic('img')}<span><b>פריים מהסרטון</b><br>${S.custom ? 'לחץ להחלפה' : 'העלה צילום מסך מהסרטון'}</span><input type="file" accept="image/*" hidden id="frameIn"></label>
        <div class="fb"><textarea class="textarea" id="fb" rows="2" placeholder="מה לשנות? לדוגמה: יותר דרמטי, טקסט קצר יותר, צבעים חמים, להדגיש את התוצאה"></textarea></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap"><button class="btn btn-gold" id="regen">${ic('refresh')}צור קונספטים חדשים</button><span class="small muted" style="align-self:center">התמונות שתעלה נשארות בדפדפן בלבד.</span></div>
    </div>
    ${!S.thumbs.length ? `<div class="notice">${ic('warn')}<div><b>הקונספטים לתמונות לא נוצרו הפעם.</b><br><span class="muted">${esc(S.thumbErr || '')} לחץ "צור קונספטים חדשים" כדי לנסות שוב — שאר התוצאות מוכנות.</span></div></div>` : ''}
    <div class="grid3" id="thumbGrid">${S.thumbs.map((t, i) => thumbCard(t, i)).join('')}</div>
    <div class="card sec" style="margin-top:18px">${secH('img', 'כך זה ייראה בפיד של יוטיוב')}<div class="feed">${S.thumbs.map((t, i) => `<div class="feed-item"><div class="ph"><canvas data-thumb="${i}"></canvas></div><div class="fl"><div class="av"></div><div><div class="ft">${esc(s.titles?.[S.selectedTitle]?.title)}</div><div class="fc">${esc(m.author_name || 'הערוץ שלך')} · לפני שעה</div></div></div></div>`).join('')}</div></div>
`;
}

function updateThumbsPanel() {
  const panel = $('[data-p="th"]'); if (!panel) return;
  panel.innerHTML = thumbsPanel();
  const n = $('[data-t="th"] .n'); if (n) n.textContent = S.thumbsPending ? '…' : S.thumbs.length;
  wireThumbs();
  if ($('.tab.on')?.dataset.t === 'pub') refreshPublish();
}

function renderResults() {
  const a = S.analysis, s = S.seo, m = S.meta || {};
  const sc = a.scores || {};
  const days = { Sunday: 'ראשון', Monday: 'שני', Tuesday: 'שלישי', Wednesday: 'רביעי', Thursday: 'חמישי', Friday: 'שישי', Saturday: 'שבת' };
  const thumbSrc = S.vid ? `https://i.ytimg.com/vi/${S.vid}/hqdefault.jpg` : '';
  $('#results').innerHTML = `
  <div class="card lux vhead">
    <div class="vthumb">${thumbSrc ? `<img src="${thumbSrc}" alt="">` : ''}</div>
    <div class="vmeta">
      <div class="chan">${esc(m.author_name || '')}</div>
      <h2>${esc(m.title || s.titles?.[0]?.title || '')}</h2>
      <div class="chips"><span class="chip gold">${esc(a.content_type || '')}</span><span class="chip">${esc(a.niche || a.main_topic || '')}</span>${a.duration_seconds ? `<span class="chip">${Math.floor(a.duration_seconds / 60)}:${String(a.duration_seconds % 60).padStart(2, '0')} דק׳</span>` : ''}<span class="chip">${a.format === 'short' ? 'Shorts' : 'סרטון ארוך'}</span></div>
    </div>
    ${ring(sc.overall)}
  </div>
  <nav class="tabs" id="tabs">
    <button class="tab on" data-t="ov">סקירה</button>
    <button class="tab" data-t="ti">כותרות <span class="n">${s.titles?.length || 0}</span></button>
    <button class="tab" data-t="de">תיאור</button>
    <button class="tab" data-t="tg">תגיות <span class="n">${s.tags.length}</span></button>
    <button class="tab" data-t="th">תמונות ממוזערות <span class="n">${S.thumbsPending ? '…' : S.thumbs.length}</span></button>
    <button class="tab" data-t="re">דוח אופטימיזציה</button>
    <button class="tab tab-pub" data-t="pub">${ic('upload')}פרסום ליוטיוב</button>
  </nav>

  <section class="panel on" data-p="ov">
    <div class="grid2">
      <div class="card sec">${secH('chart', 'ציוני הסרטון')}<div class="bars">${bar('הוק (פתיחה)', sc.hook)}${bar('בהירות המסר', sc.clarity)}${bar('שימור קהל', sc.retention)}${bar('פוטנציאל SEO', sc.seo_potential)}${bar('פוטנציאל תמונה', sc.thumbnail_potential)}</div></div>
      <div class="card sec">${secH('text', 'על מה הסרטון')}<p>${esc(a.summary)}</p></div>
      <div class="card sec">${secH('user', 'קהל יעד')}<div class="kv"><div><span>קהל עיקרי</span>${esc(a.target_audience?.primary)}</div><div><span>קהל משני</span>${esc(a.target_audience?.secondary)}</div><div><span>כוונת חיפוש</span>${esc(a.target_audience?.search_intent)}</div></div>${a.target_audience?.pain_points?.length ? `<div style="margin-top:14px">${list(a.target_audience.pain_points)}</div>` : ''}</div>
      <div class="card sec">${secH('target', 'מילות מפתח')}<div class="chips">${(a.keywords?.primary || []).map(k => `<span class="chip gold">${esc(k)}</span>`).join('')}${(a.keywords?.secondary || []).map(k => `<span class="chip">${esc(k)}</span>`).join('')}</div>${a.keywords?.long_tail?.length ? `<p class="lbl" style="margin-top:16px">ביטויי זנב ארוך</p><div class="chips">${a.keywords.long_tail.map(k => `<span class="chip">${esc(k)}</span>`).join('')}</div>` : ''}</div>
      <div class="card sec">${secH('clock', 'מתי להעלות')}<div class="chips" style="margin-bottom:12px">${(a.upload_time?.best_days || []).map(d => `<span class="chip gold">יום ${esc(days[d] || d)}</span>`).join('')}${(a.upload_time?.best_hours || []).map(h => `<span class="chip" dir="ltr">${esc(h)}</span>`).join('')}</div><p class="small muted">${esc(a.upload_time?.reasoning)}</p></div>
      <div class="card sec">${secH('bolt', 'מה לעשות עכשיו')}${list(a.action_items, 'check')}</div>
    </div>
  </section>

  <section class="panel" data-p="ti">
    <div class="card sec">${secH('spark', 'כותרות מוצעות', '<span class="small muted">לחץ לבחירה · ממוין לפי חוזק</span>')}
      <div class="titles">${(s.titles || []).map((t, i) => `<div class="title-card ${i === S.selectedTitle ? 'sel' : ''}" data-ti="${i}"><div class="num">${i + 1}</div><div><h4>${esc(t.title)}</h4><div class="meta"><span class="chip gold">${esc(t.angle)}</span><span class="ctr">CTR <span class="bar"><i data-w="${t.ctr_score}"></i></span>${t.ctr_score}</span><span class="count ${t.title.length > CONFIG.limits.titleMax ? 'over' : ''}">${t.title.length}/100 תווים</span></div><p class="small muted" style="margin-top:6px">${esc(t.why)}</p></div>${copyBtn('title:' + i)}</div>`).join('')}</div>
    </div>
  </section>

  <section class="panel" data-p="de">
    <div class="desc-wrap">
      <div class="card sec">${secH('text', 'תיאור מלא לסרטון', `<div style="display:flex;gap:10px;align-items:center"><span class="meter"><span class="bar"><i id="descBar"></i></span><span class="count" id="descCount"></span></span>${copyBtn('desc')}</div>`)}
        <textarea class="textarea desc-area" id="descText" spellcheck="false">${esc(s.descriptionText)}</textarea>
        ${!s.chapters.length && (a.duration_seconds || 0) > 60 ? '<p class="small muted" style="margin-top:8px">⚠️ לא נוצרו פרקים תקינים (נדרשים לפחות 3, הראשון ב-0:00).</p>' : ''}
      </div>
      <div style="display:grid;gap:18px;align-content:start">
        <div class="card sec">${secH('img', 'כך זה ייראה ביוטיוב')}<div class="yt-mock" id="ytMock"></div></div>
        <div class="card sec">${secH('clock', 'פרקים בסרטון', copyBtn('chapters'))}<div class="timeline">${s.chapters.map(c => `<div class="tl"><span class="t">${esc(c.time)}</span> &nbsp;${esc(c.title)}</div>`).join('') || '<p class="muted small">אין פרקים</p>'}</div></div>
        <div class="card sec">${secH('spark', 'תגובה מוצמדת', copyBtn('pinned'))}<p class="quote">${esc(s.pinned_comment)}</p></div>
      </div>
    </div>
  </section>

  <section class="panel" data-p="tg">
    <div class="card sec">${secH('tag', 'תגיות (Tags)', `<div style="display:flex;gap:8px">${copyBtn('tags', 'העתק תגיות')}</div>`)}
      <div class="big-meter"><b id="tagCount"></b><div class="bar"><i id="tagBar"></i></div><span class="small muted">מגבלת יוטיוב: 500 תווים</span></div>
      <div class="tagbox" id="tagBox"></div>
      <div style="display:flex;gap:10px;margin-top:12px"><input class="input" id="tagAdd" placeholder="הוסף תגית ולחץ Enter"><button class="btn btn-ghost" id="tagAddBtn">הוסף</button></div>
      <p class="small muted" style="margin-top:10px">5 התגיות הראשונות (מוזהבות) הן החשובות ביותר. ביוטיוב סטודיו: פרטים ← הצג עוד ← תגים ← הדבק.</p>
    </div>
    <div class="card sec" style="margin-top:18px">${secH('tag', 'האשטגים', copyBtn('hashtags'))}<div class="chips">${(s.hashtags || []).map(normHashtag).map((h, i) => `<span class="chip ${i < 3 ? 'gold' : ''}">${esc(h)}</span>`).join('')}</div><p class="small muted" style="margin-top:10px">3 הראשונים יופיעו מעל כותרת הסרטון. הם כבר כלולים בסוף התיאור.</p></div>
  </section>

  <section class="panel" data-p="th">
${thumbsPanel()}
  </section>

  <section class="panel" data-p="re">
    <div class="grid2">
      <div class="card sec">${secH('bolt', `ההוק — ${a.hook?.score ?? '-'}/10`)}<div class="kv"><div><span>מה קורה בשניות הראשונות</span>${esc(a.hook?.first_seconds)}</div><div><span>הערכה</span>${esc(a.hook?.verdict)}</div></div><p class="lbl" style="margin-top:14px">פתיח משופר לסרטון הבא</p><p class="quote">${esc(a.hook?.improved_hook_script)}</p></div>
      <div class="card sec">${secH('clock', 'רגעי מפתח')}<div class="timeline">${(a.key_moments || []).map(k => `<div class="tl"><span class="t">${esc(k.time)}</span> &nbsp;<b>${esc(k.description)}</b><div class="small muted">${esc(k.why)}</div></div>`).join('')}</div></div>
      <div class="card sec">${secH('spark', 'חוזקות')}${list(a.strengths, 'check')}</div>
      <div class="card sec">${secH('warn', 'נקודות לשיפור')}${list(a.weaknesses, 'warn')}</div>
      <div class="card sec">${secH('chart', 'טיפים לשימור קהל')}${list(a.retention_tips)}</div>
      <div class="card sec">${secH('target', 'אסטרטגיית SEO')}${list(s.seo_notes)}</div>
    </div>
    <div class="footer-actions"><button class="btn btn-gold" id="dlReport">${ic('dl')}הורד דוח מלא</button><button class="btn btn-ghost" data-copy="all">${ic('copy')}העתק הכל</button></div>
    <p class="small muted" style="text-align:center;margin-top:14px">נותח על ידי ${esc(S.models?.analysis || '')} · SEO: ${esc(S.models?.seo || '')}</p>
  </section>
  <section class="panel" data-p="pub"></section>`;
  showOnly('#results');
  requestAnimationFrame(() => setTimeout(() => {
    $$('.ring-arc').forEach(c => c.style.strokeDashoffset = c.dataset.off);
    $$('[data-p="ov"] .bar i, .title-card .bar i').forEach(b => b.style.width = (b.dataset.w || 0) + '%');
  }, 60));
  wireResults();
  $('#results').scrollIntoView({ behavior: 'smooth' });
}

function promptFor(i) { return grokPrompt(S.thumbs[i].concept, { hasFace: !!S.face, hasFrame: !!S.custom }); }
function copySync(text) {
  const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ } ta.remove();
  navigator.clipboard?.writeText(text).catch(() => {});
  return ok;
}
async function setGrok(i, file) {
  if (!file || !file.type.startsWith('image/')) return toast('בחר קובץ תמונה (JPG/PNG/WebP)', true);
  const t = S.thumbs[i], url = URL.createObjectURL(file);
  try { t.grok = await loadImage(url); } catch { return toast('לא הצלחתי לקרוא את התמונה', true); }
  t.grokUrl = url; t.src = 'grok'; t.useFace = false;
  const card = document.querySelector(`.thumb-card[data-i="${i}"]`);
  if (card) card.outerHTML = thumbCard(t, i);
  redraw(i); toast('הרקע מ-Grok הוטמע — הכותרת נוספה אוטומטית ✓');
}

function thumbCard(t, i) {
  const c = t.concept;
  const srcs = ['grok', 'ai', 'cover', 'f1', 'f2', 'f3', 'custom', 'face', 'none'].filter(k => k === 'none' || (k === 'grok' ? t.grok : k === 'ai' ? t.ai : k === 'custom' ? S.custom : k === 'face' ? S.face : S.frames[k]));
  const L = { 'text-right': 'טקסט מימין', 'text-left': 'טקסט משמאל', 'bottom-bar': 'טקסט למטה', 'center-punch': 'טקסט במרכז' };
  return `<div class="card thumb-card" data-i="${i}">
    <canvas class="thumb-canvas" data-thumb="${i}"></canvas>
    <h4>${esc(c.name)} <span class="src-tag">${esc(SRC_LABEL[t.src] || '')}</span></h4>
    <p>${esc(c.why)}</p>
    <div class="thumb-ctrls">
      <input class="input" data-f="headline" value="${esc(t.headline)}" aria-label="טקסט ראשי">
      <input class="input" data-f="badge" value="${esc(t.badge)}" placeholder="תגית קטנה" aria-label="תגית">
      <select class="select" data-f="src">${srcs.map(k => `<option value="${k}" ${k === t.src ? 'selected' : ''}>רקע: ${SRC_LABEL[k]}</option>`).join('')}</select>
      <select class="select" data-f="layout">${Object.entries(L).map(([k, v]) => `<option value="${k}" ${k === t.layout ? 'selected' : ''}>${v}</option>`).join('')}</select>
      ${S.face ? `<label class="small muted full" style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-f="useFace" ${t.useFace ? 'checked' : ''}> לשלב את התמונה שלך</label>` : ''}
      <div class="grok full">
        <label class="grok-drop ${t.grok ? 'has' : ''}" data-drop="${i}">
          ${t.grok ? `<img src="${t.grokUrl}" alt="">` : ic('upload')}
          <span><b>${t.grok ? 'הרקע מ-Grok הוטמע ✓' : 'העלה תמונה מ-Grok'}</b><br><small>${t.grok ? 'גרור או לחץ להחלפה' : 'גרור לכאן או לחץ לבחירה'}</small></span>
          <input type="file" accept="image/*" hidden data-grok="${i}">
        </label>
        <button type="button" class="btn btn-ghost btn-sm grok-open" data-grokopen="${i}">${ic('spark')}העתק פרומפט ופתח ב-Grok</button>
        <details class="prompt-box"><summary>הצג את הפרומפט (באנגלית)</summary><pre dir="ltr">${esc(promptFor(i))}</pre>${copyBtn('prompt:' + i, 'העתק פרומפט')}</details>
      </div>
      <button class="btn btn-gold btn-sm full" data-dl="${i}">${ic('dl')}הורד JPG (1280×720)</button>
    </div>
  </div>`;
}

function updateDesc() {
  const v = $('#descText').value, n = v.length;
  $('#descCount').textContent = `${n.toLocaleString()}/5,000`; $('#descCount').classList.toggle('over', n > 5000);
  $('#descBar').style.width = Math.min(100, n / 50) + '%';
  const lines = v.split('\n'), hs = (S.seo.hashtags || []).map(normHashtag).slice(0, 3).join(' ');
  $('#ytMock').innerHTML = `<div class="tagsline" style="color:#3ea6ff;font-size:.8rem">${esc(hs)}</div><div class="yt-title">${esc(S.seo.titles?.[S.selectedTitle]?.title)}</div><div class="yt-box"><b>אלף צפיות · לפני שעה</b>\n${esc(lines.slice(0, 3).join('\n'))}<span class="more">…עוד</span></div>`;
}
function renderTags() {
  const tags = S.seo.tags, n = tagsLength(tags);
  $('#tagBox').innerHTML = tags.map((t, i) => `<span class="tag">${esc(t)}<button data-rm="${i}" aria-label="הסר">×</button></span>`).join('');
  $('#tagCount').textContent = `${n}/500`; $('#tagBar').style.width = Math.min(100, n / 5) + '%';
  $('[data-t="tg"] .n').textContent = tags.length;
}

function wireResults() {
  $('#tabs').onclick = e => { const b = e.target.closest('.tab'); if (!b) return; $$('.tab').forEach(x => x.classList.toggle('on', x === b)); $$('.panel').forEach(p => p.classList.toggle('on', p.dataset.p === b.dataset.t)); if (b.dataset.t === 'th') S.thumbs.forEach((_, i) => redraw(i)); if (b.dataset.t === 'pub') onPublishTab(); if (b.dataset.t === 'ti') setTimeout(() => $$('.title-card .bar i').forEach(x => x.style.width = x.dataset.w + '%'), 50); };
  updateDesc(); renderTags();
  $('#descText').oninput = updateDesc;
  $('#tagBox').onclick = e => { const b = e.target.closest('[data-rm]'); if (b) { S.seo.tags.splice(+b.dataset.rm, 1); renderTags(); } };
  const addTag = () => { const v = $('#tagAdd').value.trim(); if (!v) return; const next = fitTags([...S.seo.tags, ...v.split(',')]); if (next.length === S.seo.tags.length) toast('אין מקום — חריגה מ-500 תווים', true); S.seo.tags = next; $('#tagAdd').value = ''; renderTags(); };
  $('#tagAdd').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }; $('#tagAddBtn').onclick = addTag;
  $$('.title-card').forEach(c => c.onclick = e => { if (e.target.closest('.copy')) return; S.selectedTitle = +c.dataset.ti; $$('.title-card').forEach(x => x.classList.toggle('sel', x === c)); $$('.feed-item .ft').forEach(f => f.textContent = S.seo.titles[S.selectedTitle].title); updateDesc(); });
  $('#results').onclick = e => {
    const cb = e.target.closest('[data-copy]'); if (cb) { e.stopPropagation(); return copyText(copyPayload(cb.dataset.copy), cb); }
    const go = e.target.closest('[data-grokopen]');
    if (go) { copySync(promptFor(+go.dataset.grokopen)); window.open('https://grok.com/imagine', '_blank', 'noopener'); toast('הפרומפט הועתק — הדבק אותו ב-Grok'); return; }
    const dl = e.target.closest('[data-dl]'); if (dl) return downloadThumb(+dl.dataset.dl);
    if (e.target.closest('#dlReport')) return downloadReport();
    if (e.target.closest('#regen')) return regenerate();
  };
  wireThumbs();
}

function wireThumbs() {
  if (!$('#thumbGrid')) return;
  $('#thumbGrid').oninput = $('#thumbGrid').onchange = e => {
    const card = e.target.closest('.thumb-card'), f = e.target.dataset.f ?? (e.target.dataset.grok != null ? 'grok' : null); if (!card || !f) return;
    const i = +card.dataset.i, t = S.thumbs[i];
    if (e.target.dataset.grok != null) { if (e.type === 'change') setGrok(i, e.target.files[0]); return; }
    t[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (f === 'src') card.querySelector('.src-tag').textContent = SRC_LABEL[t.src];
    redraw(i);
  };
  const grid = $('#thumbGrid');
  grid.addEventListener('dragover', e => { const d = e.target.closest('.grok-drop'); if (d) { e.preventDefault(); d.classList.add('drag'); } });
  grid.addEventListener('dragleave', e => { const d = e.target.closest('.grok-drop'); if (d && !d.contains(e.relatedTarget)) d.classList.remove('drag'); });
  grid.addEventListener('drop', e => { const d = e.target.closest('.grok-drop'); if (!d) return; e.preventDefault(); d.classList.remove('drag'); setGrok(+d.dataset.drop, e.dataTransfer.files[0]); });
  $('#faceIn').onchange = async e => { const f = e.target.files[0]; if (!f) return; const url = URL.createObjectURL(f); const img = await loadImage(url); S.face = { url, img, ref: imgToB64(img) }; S.thumbs.forEach(t => t.useFace = t.src !== 'grok'); rerenderThumbTab(); toast('התמונה שלך שולבה בתמונות הממוזערות'); };
  $('#frameIn').onchange = async e => { const f = e.target.files[0]; if (!f) return; const url = URL.createObjectURL(f); S.custom = { url, img: await loadImage(url) }; S.thumbs.forEach(t => { if (t.src !== 'ai' && t.src !== 'grok') t.src = 'custom'; }); rerenderThumbTab(); };
  S.thumbs.forEach((_, i) => redraw(i));
}
function rerenderThumbTab() { const keep = S.selectedTitle; renderResults(); S.selectedTitle = keep; $$('.tab').forEach(x => x.classList.toggle('on', x.dataset.t === 'th')); $$('.panel').forEach(p => p.classList.toggle('on', p.dataset.p === 'th')); S.thumbs.forEach((_, i) => redraw(i)); }

async function regenerate() {
  const apiKey = store.getKey(); if (!apiKey) return openSettings();
  const btn = $('#regen'), fb = $('#fb').value.trim(); btn.disabled = true; btn.innerHTML = `${ic('refresh')}יוצר קונספטים חדשים…`;
  try {
    const C = await designThumbnails({ apiKey, analysis: S.analysis, seo: S.seo, brief: S.brief, feedback: fb, previous: S.concepts, hasFace: !!S.face, quality: S.quality, onStatus: m => btn.lastChild.textContent = m });
    S.concepts = C.concepts; S.thumbs = []; S.aiError = null;
    if (store.getSettings().aiImages !== 'off') { S.aiBlocked = false; sessionStorage.removeItem('ytps.aiBlocked'); }
    await buildThumbs({ apiKey, onStatus: m => btn.lastChild.textContent = m });
    saveHistory(); rerenderThumbTab(); $('#fb').value = fb; toast('נוצרו 3 קונספטים חדשים ✓');
  } catch (e) { toast(e.he || e.message, true); btn.disabled = false; btn.innerHTML = `${ic('refresh')}צור קונספטים חדשים`; }
}

async function thumbJpeg(i) { const c = document.createElement('canvas'); drawThumb(i, c); return toJpeg(c, CONFIG.limits.thumbBytesMax); }
async function downloadThumb(i) {
  const c = document.createElement('canvas'); drawThumb(i, c);
  const blob = await toJpeg(c, CONFIG.limits.thumbBytesMax);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `thumbnail-${S.vid || 'video'}-${i + 1}.jpg`; a.click();
  toast(`התמונה הורדה · ${(blob.size / 1024).toFixed(0)}KB`);
}

function copyPayload(k) {
  const s = S.seo;
  if (k.startsWith('title:')) return s.titles[+k.split(':')[1]].title;
  if (k.startsWith('prompt:')) return promptFor(+k.split(':')[1]);
  if (k === 'desc') return $('#descText').value;
  if (k === 'tags') return s.tags.join(', ');
  if (k === 'hashtags') return (s.hashtags || []).map(normHashtag).join(' ');
  if (k === 'chapters') return s.chapters.map(c => `${c.time} ${c.title}`).join('\n');
  if (k === 'pinned') return s.pinned_comment;
  if (k === 'all') return reportText();
  return '';
}
function reportText() {
  const a = S.analysis, s = S.seo;
  return [`# ${S.meta?.title || ''}`, `קישור: ${S.vid ? watchUrl(S.vid) : ''}`, `ציון כללי: ${a.scores?.overall}/100`, '',
    '## כותרות', ...s.titles.map((t, i) => `${i + 1}. ${t.title}`), '', '## תיאור', $('#descText')?.value || s.descriptionText, '',
    '## תגיות', s.tags.join(', '), '', '## תגובה מוצמדת', s.pinned_comment, '',
    '## ניתוח', a.summary, '', '### קהל יעד', a.target_audience?.primary, '', '### הוק', `${a.hook?.score}/10 — ${a.hook?.verdict}`, `פתיח משופר: ${a.hook?.improved_hook_script}`, '',
    '### חוזקות', ...(a.strengths || []).map(x => '- ' + x), '', '### לשיפור', ...(a.weaknesses || []).map(x => '- ' + x), '',
    '### שימור קהל', ...(a.retention_tips || []).map(x => '- ' + x), '', '### מה לעשות עכשיו', ...(a.action_items || []).map(x => '- ' + x), '',
    '### מתי להעלות', `${(a.upload_time?.best_days || []).join(', ')} · ${(a.upload_time?.best_hours || []).join(', ')}`, a.upload_time?.reasoning,
    '', '## קונספטים לתמונה ממוזערת', ...S.concepts.map((c, i) => `${i + 1}. ${c.name}: "${c.headline}" — ${c.why}`)].join('\n');
}
function downloadReport() {
  const blob = new Blob(['\ufeff' + reportText()], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `youtube-report-${S.vid || 'video'}.md`; a.click();
}

/* ---------- init ---------- */
$('#url').addEventListener('focus', () => document.body.classList.remove('compact'));
initPublish({ S, esc, ic, toast, secH, drawThumb, thumbJpeg, openSettings, openHelp, getDesc: () => $('#descText')?.value || S.seo.descriptionText });
refreshKeyDot();
const qp = new URLSearchParams(location.search).get('v'); if (qp) $('#url').value = qp;
