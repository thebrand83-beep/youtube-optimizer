// Real caption generation on a public video with GEMINI_API_KEY from env; validates SRT format.
import fs from 'node:fs';
import { generateCaptions } from '../js/core/captions.js';
const apiKey = process.env.GEMINI_API_KEY; if (!apiKey) { console.error('GEMINI_API_KEY missing'); process.exit(1); }
const url = process.argv[2] || 'https://www.youtube.com/watch?v=1KItA0PzRUw', out = process.argv[3] || '/workspace/youtube-optimizer-preview/captions';
fs.mkdirSync(out, { recursive: true });
const analysis = JSON.parse(fs.readFileSync('/workspace/youtube-optimizer-preview/harness/analysis.json'));
for (const lang of (process.argv[4] || 'he,en').split(',')) {
  const t = Date.now();
  const r = await generateCaptions({ apiKey, video: { youtubeUrl: url }, lang, analysis, onStatus: m => console.log('  status:', m) });
  fs.writeFileSync(`${out}/captions.${lang}.srt`, r.srt);
  const last = r.cues[r.cues.length - 1];
  console.log(`${lang}: ${r.cues.length} cues by ${r.model} in ${((Date.now() - t) / 1000).toFixed(1)}s, last cue ends ${last?.end.toFixed(1)}s of ~${analysis.duration_seconds}s, valid=${r.validation.ok}`, r.validation.errors.slice(0, 5));
}
