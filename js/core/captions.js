// Caption generation (Gemini watches the video) → validated SRT. Pure helpers are unit-testable in Node.
import { CONFIG } from './config.js';
import { generateWithFallback, textOf, parseJSON } from './gemini.js';

const S = (type, extra = {}) => ({ type, ...extra });
export const CAPTION_SCHEMA = S('OBJECT', {
  properties: { cues: S('ARRAY', { items: S('OBJECT', { properties: { start: S('NUMBER', { description: 'start time in seconds, e.g. 12.4' }), end: S('NUMBER', { description: 'end time in seconds' }), text: S('STRING', { description: '1-2 lines, max ~42 characters per line' }) }, required: ['start', 'end', 'text'] }) }) },
  required: ['cues'],
});

export function captionPrompt(lang, { durationSec, spoken } = {}) {
  const target = lang === 'en' ? 'English' : 'Hebrew (natural Israeli Hebrew)';
  return `Create accurate, professionally timed subtitles in ${target} for this entire video${durationSec ? ` (about ${Math.round(durationSec)} seconds long)` : ''}.
- If the speech is already in ${target}, transcribe it verbatim (fix only obvious filler words). Otherwise translate it faithfully into ${target}.
- Cover ALL speech from start to end, in chronological order; timestamps must match when the words are actually spoken.
- Each cue: 1-2 short lines (max ~42 characters per line), 1-7 seconds long, no overlaps, at least 0.1s gap.
- Include meaningful on-screen text only when it is essential to understanding. No speaker names, no sound-effect tags unless important.
- If there is no speech at all, return an empty cues array.`;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
export function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

function wrapLines(text, max = 42) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const words = t.split(' '); let a = '', i = 0;
  while (i < words.length && (a + ' ' + words[i]).trim().length <= Math.ceil(t.length / 2) + 6) { a = (a + ' ' + words[i]).trim(); i++; }
  return a + '\n' + words.slice(i).join(' ');
}

/** Sort, clamp, remove overlaps/empties, enforce min duration. */
export function normalizeCues(cues = [], durationSec) {
  const out = [];
  const list = cues.map(c => ({ start: +c.start, end: +c.end, text: String(c.text || '').replace(/[<>{}]/g, '').trim() }))
    .filter(c => isFinite(c.start) && isFinite(c.end) && c.text)
    .sort((a, b) => a.start - b.start);
  for (const c of list) {
    if (durationSec && c.start >= durationSec + 1) continue;
    let start = Math.max(0, c.start, out.length ? out[out.length - 1].end + 0.05 : 0);
    let end = Math.max(c.end, start + 0.8);
    if (durationSec) end = Math.min(end, durationSec + 0.5);
    if (end - start < 0.3) continue;
    out.push({ start, end, text: wrapLines(c.text) });
  }
  return out;
}

export function toSRT(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}

/** Strict SRT validator → {ok, errors[], count}. */
export function validateSRT(srt) {
  const errors = []; const blocks = srt.trim().split(/\n\s*\n/); let prevEnd = -1;
  const toS = t => { const m = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(t); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : NaN; };
  blocks.forEach((b, i) => {
    const lines = b.split('\n');
    if (lines[0] !== String(i + 1)) errors.push(`cue ${i + 1}: bad index "${lines[0]}"`);
    const m = /^(\S+) --> (\S+)$/.exec(lines[1] || '');
    if (!m) { errors.push(`cue ${i + 1}: bad timing line`); return; }
    const s = toS(m[1]), e = toS(m[2]);
    if (isNaN(s) || isNaN(e)) errors.push(`cue ${i + 1}: bad timestamp`);
    if (e <= s) errors.push(`cue ${i + 1}: end <= start`);
    if (s < prevEnd) errors.push(`cue ${i + 1}: overlaps previous`);
    if (lines.length < 3 || !lines.slice(2).join('').trim()) errors.push(`cue ${i + 1}: empty text`);
    prevEnd = e;
  });
  return { ok: !errors.length && blocks.length > 0, errors, count: blocks.length };
}

export async function generateCaptions({ apiKey, video, lang, analysis, quality = 'balanced', onStatus, onText, signal }) {
  const part = video.youtubeUrl ? { file_data: { file_uri: video.youtubeUrl } } : { file_data: { file_uri: video.fileUri, mime_type: video.mimeType } };
  const res = await generateWithFallback({
    apiKey, signal, onStatus, onText, stream: true, ...CONFIG.timing.analysis, models: CONFIG.textModels[quality],
    contents: [{ role: 'user', parts: [part, { text: captionPrompt(lang, { durationSec: analysis?.duration_seconds, spoken: analysis?.spoken_language }) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: CAPTION_SCHEMA, temperature: 0.2, maxOutputTokens: 65536, mediaResolution: 'MEDIA_RESOLUTION_LOW' },
  });
  const { cues } = parseJSON(textOf(res.parts));
  const norm = normalizeCues(cues, analysis?.duration_seconds);
  const srt = toSRT(norm);
  return { srt, cues: norm, model: res.model, validation: validateSRT(srt) };
}
