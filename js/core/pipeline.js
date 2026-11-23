// The optimization pipeline. UI-agnostic so a backend (multi-user / paid) can run the same steps later.
import { CONFIG } from './config.js';
import { generateWithFallback, textOf, parseJSON, imagesOf } from './gemini.js';
import * as P from './prompts.js';
import { normalizeChapters, fitTags, assembleDescription, defaultLinks } from './seo.js';

const jsonCfg = (schema, extra = {}) => ({ responseMimeType: 'application/json', responseSchema: schema, temperature: 0.7, ...extra });

export async function analyzeVideo({ apiKey, video, meta, brief, quality = 'balanced', onStatus, onText, signal }) {
  // video: { youtubeUrl } or { fileUri, mimeType }
  const part = video.youtubeUrl ? { file_data: { file_uri: video.youtubeUrl } } : { file_data: { file_uri: video.fileUri, mime_type: video.mimeType } };
  const res = await generateWithFallback({
    apiKey, signal, onStatus, onText, stream: true, ...CONFIG.timing.analysis, models: CONFIG.textModels[quality],
    systemInstruction: { parts: [{ text: P.SYSTEM }] },
    contents: [{ role: 'user', parts: [part, { text: P.analysisPrompt({ meta, brief }) }] }],
    generationConfig: jsonCfg(P.ANALYSIS_SCHEMA, { mediaResolution: brief.detail === 'high' ? 'MEDIA_RESOLUTION_MEDIUM' : 'MEDIA_RESOLUTION_LOW', temperature: 0.4 }),
  });
  const analysis = parseJSON(textOf(res.parts));
  return { analysis, model: res.model, usage: res.usage };
}

export async function buildSeo({ apiKey, analysis, meta, brief, quality = 'balanced', onStatus, onText, signal }) {
  const res = await generateWithFallback({
    apiKey, signal, onStatus, onText, stream: true, ...CONFIG.timing.text, models: CONFIG.textModels[quality],
    systemInstruction: { parts: [{ text: P.SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: P.seoPrompt({ analysis, meta, brief }) }] }],
    generationConfig: jsonCfg(P.SEO_SCHEMA, { temperature: 0.8 }),
  });
  const seo = parseJSON(textOf(res.parts));
  return { seo: finalizeSeo(seo, analysis, brief), model: res.model, usage: res.usage };
}

export function finalizeSeo(seo, analysis, brief) {
  const lang = brief.language === 'en' ? 'en' : (brief.language === 'auto' && analysis.spoken_language?.startsWith('en') ? 'en' : 'he');
  const ch = normalizeChapters(analysis.chapters || []);
  const chapters = (analysis.duration_seconds || 999) > 60 && ch.valid ? ch.chapters : [];
  const links = brief.links?.length ? brief.links : defaultLinks(lang);
  const descriptionText = assembleDescription({
    hookLines: seo.description?.hook_lines, body: seo.description?.body, chapters,
    cta: seo.description?.cta, links, hashtags: seo.hashtags, lang,
  });
  return { ...seo, lang, chapters, chaptersValid: ch.valid, tags: fitTags(seo.tags || []), descriptionText };
}

export async function designThumbnails({ apiKey, analysis, seo, brief, feedback, previous, hasFace, quality = 'balanced', onStatus, onText, signal }) {
  const res = await generateWithFallback({
    apiKey, signal, onStatus, onText, stream: true, ...CONFIG.timing.text, models: CONFIG.textModels[quality],
    systemInstruction: { parts: [{ text: P.SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: P.thumbPrompt({ analysis, seo, brief, feedback, previous, hasFace }) }] }],
    generationConfig: jsonCfg(P.THUMB_SCHEMA, { temperature: 1 }),
  });
  const { concepts } = parseJSON(textOf(res.parts));
  return { concepts: (concepts || []).slice(0, 3), model: res.model };
}

/** refs: [{mime, b64}] optional face photo / video frame. Returns {mime,b64,model}. Throws GeminiError on quota. */
export async function generateThumbImage({ apiKey, concept, refs = [], hasFace, onStatus, signal }) {
  const parts = [
    ...refs.map(r => ({ inline_data: { mime_type: r.mime, data: r.b64 } })),
    { text: P.imagePrompt(concept, { hasFace, hasFrame: refs.length > (hasFace ? 1 : 0) }) },
  ];
  const res = await generateWithFallback({
    apiKey, signal, onStatus, models: CONFIG.imageModels,
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } },
  });
  const img = imagesOf(res.parts)[0];
  if (!img) throw Object.assign(new Error('no image'), { he: 'מודל התמונה לא החזיר תמונה.' });
  return { ...img, model: res.model };
}
