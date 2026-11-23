// Prompt + response-schema definitions. Shared by the browser app and the Node test harness.
const S = (type, extra = {}) => ({ type, ...extra });
const str = d => S('STRING', d ? { description: d } : {});
const int = d => S('INTEGER', d ? { description: d } : {});
const arr = (items, d) => S('ARRAY', { items, ...(d ? { description: d } : {}) });
const obj = (properties, required) => S('OBJECT', { properties, required: required || Object.keys(properties) });

export function langName(lang) {
  return lang === 'en' ? 'English' : lang === 'auto' ? 'the same language that is spoken in the video' : 'Hebrew (עברית, natural Israeli Hebrew, not a translation)';
}

export const SYSTEM = `You are an elite YouTube growth strategist, SEO specialist and thumbnail art director who has grown channels to millions of views.
You base every claim on what actually happens in the video (visuals, speech, on-screen text, pacing). Never invent content that is not in the video.
You follow YouTube's current best practices: strong curiosity gap without clickbait lies, front-loaded keywords, viewer-first value, retention-focused structure.`;

export const ANALYSIS_SCHEMA = obj({
  spoken_language: str('ISO code of the main spoken language'),
  duration_seconds: int('Approximate total duration of the video in seconds'),
  format: str('"short" (vertical/<=60s) or "long"'),
  summary: str('3-5 sentence factual summary of what happens in the video'),
  main_topic: str(),
  niche: str(),
  content_type: str('e.g. tutorial, vlog, review, behind the scenes, promo'),
  target_audience: obj({ primary: str(), secondary: str(), pain_points: arr(str()), search_intent: str() }),
  keywords: obj({ primary: arr(str(), '3-5 high-intent search keywords'), secondary: arr(str()), long_tail: arr(str()) }),
  chapters: arr(obj({ time: str('m:ss timestamp from the real video'), title: str('short chapter title') }), 'Real topic changes in the video. First one at 0:00.'),
  hook: obj({ first_seconds: str('What literally happens in the first 5-15 seconds'), score: int('0-10'), verdict: str(), improved_hook_script: str('A stronger spoken hook for next time') }),
  scores: obj({ overall: int('0-100'), hook: int('0-100'), clarity: int('0-100'), retention: int('0-100'), seo_potential: int('0-100'), thumbnail_potential: int('0-100') }),
  strengths: arr(str()),
  weaknesses: arr(str()),
  retention_tips: arr(str(), 'Specific, timestamped where possible'),
  key_moments: arr(obj({ time: str(), description: str(), why: str() })),
  best_thumbnail_frames: arr(obj({ time: str(), description: str() }), 'Most visually striking, emotional or curiosity-inducing moments'),
  visual_style: str('Colors, lighting, setting, people (appearance, expression), props seen in the video'),
  upload_time: obj({ best_days: arr(str(), 'English weekday names, e.g. Sunday'), best_hours: arr(str(), 'Local time ranges e.g. 19:00-21:00'), timezone: str(), reasoning: str() }),
  action_items: arr(str(), 'Prioritized checklist to maximize views for this specific video'),
});

export function analysisPrompt({ meta, brief }) {
  return `Analyze this YouTube video in depth, as a growth strategist preparing it for maximum views.

Known metadata: ${meta?.title ? `current title "${meta.title}"` : 'no title yet'}${meta?.author_name ? `, channel "${meta.author_name}"` : ''}.
Creator's notes: ${brief.description || '(none)'}
Target audience (creator's view): ${brief.audience || '(not specified — infer it)'}
Audience location / timezone for upload-time advice: ${brief.timezone || 'Israel (Asia/Jerusalem)'}

Rules:
- Write ALL human-readable text values in ${langName(brief.language)}.
- Chapters must use real timestamps where the topic actually changes. First chapter at 0:00. Minimum 3 chapters if the video is longer than 60 seconds; at least 10 seconds apart.
- Scores must be honest and calibrated (an average video scores ~60).
- Be specific to THIS video: reference concrete moments and timestamps.`;
}

export const SEO_SCHEMA = obj({
  titles: arr(obj({
    title: str('Max 70 characters, keyword near the start'),
    angle: str('e.g. curiosity, how-to, result, mistake, list'),
    why: str('One line on why it will get clicks'),
    ctr_score: int('Predicted CTR strength 0-100'),
  }), '6 diverse title options, best first'),
  description: obj({
    hook_lines: arr(str(), 'Exactly 2 short lines that appear above "...more"; include the main keyword and a reason to watch'),
    body: str('2-3 short paragraphs, keyword-rich but natural, describing the value of the video'),
    cta: str('Call to action: subscribe, comment question, related video'),
  }),
  hashtags: arr(str(), '3-6 hashtags without spaces; the first 3 are the most important'),
  tags: arr(str(), '25-35 tags ordered by importance: exact keywords, variations, long-tail, misspellings, English+local language mix if relevant'),
  pinned_comment: str('An engaging pinned comment that sparks replies'),
  seo_notes: arr(str(), 'Short notes on keyword strategy'),
});

export function seoPrompt({ analysis, meta, brief }) {
  return `Using this expert analysis of a YouTube video, write the complete SEO package.

ANALYSIS (JSON):
${JSON.stringify(analysis)}

Current title: ${meta?.title || '(none)'}
Creator's notes: ${brief.description || '(none)'}
Target audience: ${brief.audience || analysis.target_audience?.primary || ''}

Rules:
- Output language for EVERY human-readable field (titles, angle, why, description, hashtags, pinned comment, seo_notes): ${langName(brief.language)}.
- Tags: mostly in that language, plus English search terms that people in this niche actually type.
- Titles: no ALL-CAPS spam, no false promises, under 70 characters, use numbers/power words when honest.
- Description hook lines must work as a standalone search snippet.
- Do not include chapters or links in the description — they are added separately.`;
}

export const THUMB_SCHEMA = obj({
  concepts: arr(obj({
    name: str('Short concept name (2-4 words) in the output language'),
    headline: str('2-4 words of thumbnail text, MAX 16 characters, huge and readable'),
    highlight_word: str('One word from the headline to color-highlight'),
    badge: str('Optional tiny badge text (max 12 chars) like "מדריך", "5 טיפים" or empty'),
    emotion: str('Emotion/curiosity trigger'),
    layout: str('One of: "text-right", "text-left", "bottom-bar", "center-punch"'),
    accent_color: str('Hex color for highlight, high contrast vs the scene'),
    frame_time: str('Timestamp of the best real frame for this concept'),
    image_prompt: str('Detailed ENGLISH prompt for an AI image model to create the 16:9 thumbnail background: subject, expression, composition with empty space on the text side, lighting, colors. NO text, letters or logos in the image.'),
    why: str('One sentence in the output language: why this will win the click'),
  }), 'Exactly 3 different concepts'),
});

export function thumbPrompt({ analysis, seo, brief, feedback, previous, hasFace }) {
  return `You are a top YouTube thumbnail art director. Design 3 distinct, high-CTR thumbnail concepts for this video.

Video analysis: ${JSON.stringify({ summary: analysis.summary, main_topic: analysis.main_topic, audience: analysis.target_audience, best_frames: analysis.best_thumbnail_frames, visual_style: analysis.visual_style, keywords: analysis.keywords?.primary })}
Chosen title options: ${JSON.stringify((seo?.titles || []).slice(0, 3).map(t => t.title))}
${hasFace ? 'The creator uploaded a reference photo of his face — concepts should feature him with a strong, readable expression.' : ''}
${previous ? `Previous concepts: ${JSON.stringify(previous.map(c => ({ headline: c.headline, layout: c.layout })))}` : ''}
${feedback ? `CREATOR FEEDBACK — follow it strictly: "${feedback}"` : ''}

Rules:
- Write name, headline, badge, emotion and why in ${langName(brief.language)} (only image_prompt in English). Thumbnail text must COMPLEMENT the title, not repeat it. Max 16 characters.
- One clear focal point, big face/emotion or striking result, high contrast, readable at mobile size.
- Each concept uses a different psychological angle and a different layout.`;
}

export function imagePrompt(concept, { hasFace, hasFrame }) {
  return `Create a professional, high-CTR YouTube thumbnail background, 16:9, photorealistic, ultra sharp, cinematic lighting, vibrant but natural colors, strong subject separation.
${concept.image_prompt}
${hasFace ? 'Use the person from the reference portrait photo as the main subject; keep his identity and facial features accurate, expressive face.' : ''}
${hasFrame ? 'Match the setting, people and style of the reference frame from the video.' : ''}
Leave clean empty space on the ${concept.layout === 'text-left' ? 'left' : concept.layout === 'text-right' ? 'right' : concept.layout === 'bottom-bar' ? 'bottom third' : 'center-top'} for a large headline that will be added later.
ABSOLUTELY NO text, letters, numbers, watermarks or logos in the image.`;
}
