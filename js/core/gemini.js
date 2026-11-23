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

const FALLBACK_CODES = new Set(['no_free_quota', 'quota', 'overloaded', 'no_model']);

export async function generate({ apiKey, model, contents, systemInstruction, generationConfig, signal }) {
  const url = `${CONFIG.apiBase}/models/${model}:generateContent`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents, systemInstruction, generationConfig }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new GeminiError('network', 'אין חיבור ל-Gemini. בדוק את החיבור לאינטרנט.', String(e));
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw mapError(res.status, body);
  const cand = body.candidates?.[0];
  if (!cand?.content?.parts) {
    const reason = body.promptFeedback?.blockReason || cand?.finishReason || 'EMPTY';
    throw new GeminiError('blocked', `Gemini לא החזיר תוצאה (${reason}). נסה שוב או נסח אחרת.`, reason);
  }
  return { model, parts: cand.content.parts, usage: body.usageMetadata, finishReason: cand.finishReason };
}

/** Try models in order; returns first success. onStatus(msg) for UI progress. */
export async function generateWithFallback({ models, onStatus, ...args }) {
  const errors = [];
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await generate({ ...args, model });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        errors.push({ model, code: e.code, he: e.he || e.message });
        if (e.code === 'overloaded' && attempt === 0) { onStatus?.(`${model} עמוס, מנסה שוב…`); await sleep(2500); continue; }
        if (FALLBACK_CODES.has(e.code)) { onStatus?.(`${model}: ${e.he} עובר למודל הבא…`); break; }
        throw e; // bad key, video access, etc. — no point in other models
      }
    }
  }
  const last = errors[errors.length - 1];
  const allNoQuota = errors.every(x => x.code === 'no_free_quota');
  throw new GeminiError(allNoQuota ? 'no_free_quota' : (last?.code || 'unknown'),
    allNoQuota ? 'לאף אחד מהמודלים אין מכסה חינמית בחשבון שלך.' : (last?.he || 'כל המודלים נכשלו.'), errors);
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
