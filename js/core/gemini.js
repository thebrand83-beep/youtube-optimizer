// Thin Gemini REST client with model fallback + Hebrew error mapping.
// Works in the browser and in Node 18+ (global fetch). The API key is passed in, never stored here.
import { CONFIG } from './config.js';

export class GeminiError extends Error {
  constructor(code, he, detail, extra = {}) {
    super(he);
    this.code = code; this.he = he; this.detail = detail; Object.assign(this, extra);
  }
}

function retryAfter(msg) {
  const m = /retry in ([\dhms.]+)/i.exec(msg || '');
  return m ? m[1].replace(/\.\d+s$/, 's') : '';
}

export function mapError(status, body) {
  const msg = body?.error?.message || '';
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg))
    return new GeminiError('bad_key', 'מפתח ה-API לא תקין. בדוק אותו במסך ההגדרות.', msg);
  if (status === 403)
    return new GeminiError('forbidden', 'למפתח אין הרשאה לשירות הזה. ודא שה-Gemini API מופעל בפרויקט.', msg);
  if (status === 404)
    return new GeminiError('no_model', 'המודל לא זמין בחשבון שלך.', msg);
  if (status === 429) {
    const zero = /limit: 0/.test(msg);
    const wait = retryAfter(msg);
    return new GeminiError(zero ? 'no_free_quota' : 'quota',
      zero ? 'למודל הזה אין מכסה חינמית בחשבון שלך (נדרשת הפעלת חיוב ב-Google AI Studio).'
           : `הגעת למכסת השימוש של Gemini${wait ? ` — אפשר לנסות שוב בעוד ${wait}` : ''}.`, msg, { wait });
  }
  if (status === 503 || status === 500 || status === 504)
    return new GeminiError('overloaded', 'שרתי Gemini עמוסים כרגע. ננסה מודל חלופי…', msg);
  if (status === 400 && /video|file|uri|youtube/i.test(msg))
    return new GeminiError('video', 'Gemini לא הצליח לגשת לסרטון. ודא שהסרטון ציבורי (Public) ולא פרטי.', msg);
  return new GeminiError('unknown', `שגיאה מ-Gemini (${status}).`, msg);
}

const FALLBACK_CODES = new Set(['no_free_quota', 'quota', 'overloaded', 'no_model', 'timeout', 'parse']);

/**
 * One model call. stream=true uses SSE so onText(textSoFar) fires as the answer is written.
 * timeoutMs aborts a hung/very slow attempt so the caller can fall back to the next model.
 */
export async function generate({ apiKey, model, contents, systemInstruction, generationConfig, signal, stream = false, onText, timeoutMs }) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort(signal.reason);
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  let timedOut = false;
  const timer = timeoutMs ? setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs) : null;
  const url = `${CONFIG.apiBase}/models/${model}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
  try {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents, systemInstruction, generationConfig }),
      });
    } catch (e) {
      throw netErr(e, timedOut, timeoutMs, signal);
    }
    if (!res.ok) throw mapError(res.status, await res.json().catch(() => ({})));
    let parts, usage, finishReason, blockReason;
    if (!stream) {
      const body = await res.json().catch(() => ({}));
      const cand = body.candidates?.[0];
      parts = cand?.content?.parts; usage = body.usageMetadata; finishReason = cand?.finishReason; blockReason = body.promptFeedback?.blockReason;
    } else {
      let text = '', buf = '';
      const reader = res.body.getReader(), dec = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line.startsWith('data:')) continue;
            let chunk; try { chunk = JSON.parse(line.slice(5)); } catch { continue; }
            if (chunk.error) throw mapError(chunk.error.code || 500, chunk);
            const c = chunk.candidates?.[0];
            for (const p of c?.content?.parts || []) if (p.text && !p.thought) text += p.text;
            if (c?.finishReason) finishReason = c.finishReason;
            if (chunk.usageMetadata) usage = chunk.usageMetadata;
            if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;
            onText?.(text);
          }
        }
      } catch (e) {
        if (e instanceof GeminiError) throw e;
        throw netErr(e, timedOut, timeoutMs, signal);
      }
      parts = text ? [{ text }] : null;
    }
    if (!parts?.length) {
      const reason = blockReason || finishReason || 'EMPTY';
      throw new GeminiError('blocked', `Gemini לא החזיר תוצאה (${reason}). נסה שוב או נסח אחרת.`, reason);
    }
    return { model, parts, usage, finishReason };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

function netErr(e, timedOut, timeoutMs, signal) {
  if (timedOut) return new GeminiError('timeout', `המודל לא הגיב תוך ${Math.round(timeoutMs / 1000)} שניות.`, String(e));
  if (signal?.aborted || e.name === 'AbortError') return e;
  return new GeminiError('network', 'אין חיבור ל-Gemini. בדוק את החיבור לאינטרנט.', String(e));
}

/** Try models in order (sequential fallback). onStatus(msg) for UI progress. */
async function sequential({ models, onStatus, onModel, ...args }) {
  const errors = [];
  for (const model of models) {
    onModel?.(model);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await generate({ ...args, model });
      } catch (e) {
        if (e.name === 'AbortError' || args.signal?.aborted) throw e;
        errors.push({ model, code: e.code, he: e.he || e.message });
        if (e.code === 'overloaded' && attempt === 0) { onStatus?.(`${model} עמוס, מנסה שוב…`); await sleep(2500); continue; }
        if (FALLBACK_CODES.has(e.code)) {
          onStatus?.(e.code === 'quota' || e.code === 'no_free_quota' ? 'המכסה היומית של המודל הראשי נוצלה — ממשיך עם מודל הגיבוי ברמה זהה…'
            : e.code === 'timeout' ? 'המודל לא הגיב בזמן — עובר למודל הגיבוי…' : 'ממשיך עם מודל הגיבוי…');
          break;
        }
        throw e; // bad key, video access, etc. — no point in other models
      }
    }
  }
  const last = errors[errors.length - 1];
  const allNoQuota = errors.length && errors.every(x => x.code === 'no_free_quota');
  throw new GeminiError(allNoQuota ? 'no_free_quota' : (last?.code || 'unknown'),
    allNoQuota ? 'לאף אחד מהמודלים אין מכסה חינמית בחשבון שלך.' : (last?.he || 'כל המודלים נכשלו.'), errors);
}

/**
 * Model fallback chain. With hedgeMs, if the primary model has not finished after hedgeMs,
 * the same request is also sent to the backup model and the first good answer wins (the other is aborted).
 * The primary model is never replaced while it is answering normally.
 */
export async function generateWithFallback({ models, hedgeMs, signal, onStatus, onText, ...args }) {
  if (!hedgeMs || models.length < 2) return sequential({ models, signal, onStatus, onText, ...args });
  const ctls = [new AbortController(), new AbortController()];
  const link = () => ctls.forEach(c => c.abort());
  signal?.addEventListener('abort', link, { once: true });
  let best = 0;
  const mkText = () => t => { if (t.length >= best) { best = t.length; onText?.(t); } };
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      let pending = 0, hedged = false, settled = false, lastErr, current = models[0];
      const start = (i, list) => {
        pending++;
        sequential({ models: list, signal: ctls[i].signal, onStatus, onText: mkText(), onModel: m => { if (i === 0) current = m; }, ...args }).then(r => {
          if (settled) return; settled = true; ctls[1 - i].abort(); resolve(r);
        }, e => {
          pending--; lastErr = lastErr && lastErr.code !== 'no_free_quota' ? lastErr : e;
          if (settled) return;
          if (!hedged && i === 0) { clearTimeout(timer); settled = true; reject(e); return; } // primary chain already tried all models
          if (pending === 0) { settled = true; reject(lastErr); }
        });
      };
      start(0, models);
      timer = setTimeout(() => {
        if (settled) return;
        // back up with the next model after the one currently answering (never the same model twice)
        const rest = models.slice(models.indexOf(current) + 1);
        if (!rest.length) return;
        hedged = true; onStatus?.('לוקח יותר זמן מהרגיל — מריץ במקביל גם על מודל הגיבוי…');
        start(1, rest);
      }, hedgeMs);
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', link);
  }
}

export function textOf(parts) {
  return parts.filter(p => p.text && !p.thought).map(p => p.text).join('');
}

export function parseJSON(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch {
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1));
    throw new GeminiError('parse', 'התשובה מ-Gemini לא הגיעה בפורמט תקין. נסה שוב.', t.slice(0, 300));
  }
}

export function imagesOf(parts) {
  return parts.filter(p => p.inlineData?.data).map(p => ({ mime: p.inlineData.mimeType, b64: p.inlineData.data }));
}

/** Upload a local video via the Files API (resumable). Returns {uri, mimeType}. */
export async function uploadFile({ apiKey, file, mimeType, displayName, onStatus }) {
  const size = file.size ?? file.byteLength;
  const start = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey, 'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size), 'X-Goog-Upload-Header-Content-Type': mimeType,
    },
    body: JSON.stringify({ file: { display_name: displayName || 'video' } }),
  });
  if (!start.ok) throw mapError(start.status, await start.json().catch(() => ({})));
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new GeminiError('upload', 'העלאת הקובץ נכשלה (הדפדפן חסם את כתובת ההעלאה).', '');
  onStatus?.('מעלה את הסרטון ל-Gemini…');
  const up = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize', 'Content-Length': String(size) },
    body: file,
  });
  const info = await up.json();
  if (!up.ok) throw mapError(up.status, info);
  let f = info.file;
  for (let i = 0; i < 90 && f.state === 'PROCESSING'; i++) {
    onStatus?.('Gemini מעבד את הסרטון…');
    await sleep(4000);
    const r = await fetch(`${CONFIG.apiBase}/${f.name}`, { headers: { 'x-goog-api-key': apiKey } });
    f = await r.json();
  }
  if (f.state !== 'ACTIVE') throw new GeminiError('upload', 'עיבוד הסרטון ב-Gemini נכשל.', f.state);
  return { uri: f.uri, mimeType: f.mimeType };
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
