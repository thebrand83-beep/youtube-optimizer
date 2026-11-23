# YouTube Pro Studio · Studio Image

A Hebrew (RTL) web app that takes a YouTube link and returns a full optimization package, powered by Google Gemini:

- **Deep video analysis.** Gemini watches the actual video (YouTube URL → `file_data`). It returns a summary, audience, keywords, a hook score, retention tips, key moments, best upload times and a 0–100 score.
- **6 title options** with an angle, a CTR estimate and a character count.
- **Full SEO description.** Hook lines first, then the body, real chapters (validated against YouTube rules: first at 0:00, at least 3 chapters, at least 10 seconds apart), a CTA, saved links and hashtags. It shows a character counter and a YouTube-style preview.
- **Tags** trimmed to YouTube's 500-character limit, counting quotes and commas the way YouTube does. You can edit, add and copy them.
- **3 thumbnail concepts** rendered at 1280×720 and exported as JPG under 2 MB.
  - With Nano Banana (`gemini-3-pro-image` → `gemini-3.1-flash-image` → `gemini-2.5-flash-image`), the background is AI-generated and the text is set in Heebo or Anton.
  - Without image quota, the **Smart Composer** builds the thumbnails from real video frames and your uploaded face photo or frame.
  - You can regenerate with written feedback.
- **Grok workflow (default for AI backgrounds).** For each concept, Gemini writes an English Grok Imagine prompt (16:9, photoreal, high contrast, empty headline side, no text). "העתק פרומפט ופתח ב-Grok" copies it and opens grok.com/imagine. The image you upload back (drag & drop or file picker) is cover-cropped to 1280×720 and gets the Hebrew headline and badge overlay. Nano Banana auto-generation is optional (Settings → Advanced, off by default).
- A pinned comment, a downloadable full report (.md) and a local history.

## Architecture
```
index.html, css/app.css        UI (Heebo, dark/gold)
js/core/   (no DOM; runs in browser AND Node)
  config.js      model fallback chains, YouTube limits
  gemini.js      REST client, fallback on 429/503/404, Hebrew error mapping, Files API upload
  prompts.js     system prompt, prompts and JSON response schemas
  pipeline.js    analyzeVideo → buildSeo → designThumbnails → generateThumbImage
  seo.js         chapters / tags / description rules (pure functions)
  youtube.js     link parsing, oEmbed, CORS-enabled frame URLs
js/ui/
  app.js         screens and state
  composer.js    canvas thumbnail renderer + JPEG export (<2MB)
  storage.js     localStorage (key, settings, history)
tests/
  harness.mjs    Node end-to-end run of the core pipeline (key from env only)
  ui_preview.py  Playwright run of the real UI + screenshots
  grok_preview.py  Playwright test of the Grok upload/overlay/download flow (no API calls)
```

### Security
- The Gemini key is entered in Settings and kept **only in the user's browser `localStorage`**. Calls go straight from the browser to `generativelanguage.googleapis.com`.
- No key is ever committed to this repo. The tests read `GEMINI_API_KEY` from the environment.

### Roadmap to a paid multi-user product
`js/core` is UI-agnostic on purpose, so it can move unchanged into a serverless backend (Cloudflare Workers, Supabase Edge or Vercel):
1. Move the key server-side and have the browser call `/api/optimize`. Swap the import of `gemini.js` for a thin fetch wrapper.
2. Add auth (Supabase) plus per-user history in a database instead of `storage.js`.
3. Add plans and credits: meter calls in `pipeline.js` and take payments (PayPal, Stripe).
4. Optional: YouTube Data API OAuth so the title, description, tags and thumbnail are pushed straight to the channel.

## Run locally
```
python3 -m http.server 8765   # open http://localhost:8765
GEMINI_API_KEY=... node tests/harness.mjs "https://www.youtube.com/watch?v=VIDEO_ID"
```
