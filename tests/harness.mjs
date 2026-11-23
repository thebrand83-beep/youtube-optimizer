// End-to-end test of the core pipeline in Node, using the key from env ONLY (never written anywhere).
// Usage: GEMINI_API_KEY=... node tests/harness.mjs <youtube-url> [outDir]
import fs from 'node:fs';
import { analyzeVideo, buildSeo, designThumbnails, generateThumbImage } from '../js/core/pipeline.js';
import { parseVideoId, watchUrl, fetchOEmbed } from '../js/core/youtube.js';
import { tagsLength } from '../js/core/seo.js';
import { grokPrompt } from '../js/core/prompts.js';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('GEMINI_API_KEY missing'); process.exit(1); }
const url = process.argv[2] || 'https://www.youtube.com/watch?v=1KItA0PzRUw';
const out = process.argv[3] || '/workspace/youtube-optimizer-preview/harness';
fs.mkdirSync(out, { recursive: true });
const id = parseVideoId(url);
const brief = { language: 'he', description: process.env.BRIEF || '', audience: process.env.AUDIENCE || '', timezone: 'Israel (Asia/Jerusalem)' };
const log = m => console.log(new Date().toISOString().slice(11, 19), m);
const t0 = Date.now();
const meta = await fetchOEmbed(id); log(`oEmbed: ${meta?.title}`);
const A = await analyzeVideo({ apiKey, video: { youtubeUrl: watchUrl(id) }, meta, brief, onStatus: log }); log(`analysis by ${A.model} tokens=${A.usage?.totalTokenCount}`);
fs.writeFileSync(`${out}/analysis.json`, JSON.stringify(A.analysis, null, 2));
const B = await buildSeo({ apiKey, analysis: A.analysis, meta, brief, onStatus: log }); log(`seo by ${B.model}`);
fs.writeFileSync(`${out}/seo.json`, JSON.stringify(B.seo, null, 2));
fs.writeFileSync(`${out}/description.txt`, B.seo.descriptionText);
fs.writeFileSync(`${out}/tags.txt`, B.seo.tags.join(', ') + `\n\n(${tagsLength(B.seo.tags)}/500 chars)`);
const C = await designThumbnails({ apiKey, analysis: A.analysis, seo: B.seo, brief, onStatus: log }); log(`concepts by ${C.model}`);
fs.writeFileSync(`${out}/thumb-concepts.json`, JSON.stringify(C.concepts, null, 2));
fs.writeFileSync(`${out}/grok-prompts.txt`, C.concepts.map((c, i) => `=== Concept ${i + 1}: ${c.name} — "${c.headline}" (${c.layout}) ===\n${grokPrompt(c, {})}`).join('\n\n'));
if (process.env.SKIP_AI_IMAGE) { log('done (skipped AI image)'); process.exit(0); }
try {
  const img = await generateThumbImage({ apiKey, concept: C.concepts[0], onStatus: log });
  fs.writeFileSync(`${out}/ai-thumb-1.${img.mime.split('/')[1]}`, Buffer.from(img.b64, 'base64')); log(`AI image by ${img.model}`);
} catch (e) { log(`AI image failed: ${e.code} ${e.he || e.message}`); fs.writeFileSync(`${out}/ai-image-error.txt`, `${e.code}: ${e.he || e.message}`); }
log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s; description ${B.seo.descriptionText.length} chars, tags ${tagsLength(B.seo.tags)} chars`);
