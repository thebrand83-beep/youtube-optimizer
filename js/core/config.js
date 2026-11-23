// Central configuration. A future backend can replace these defaults per plan/tier.
export const CONFIG = {
  apiBase: 'https://generativelanguage.googleapis.com/v1beta',
  // Ordered fallback chains. First working model wins; quota/overload errors move to the next one.
  textModels: {
    balanced: ['gemini-3-flash-preview', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite'],
    max: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.5-flash', 'gemini-3.6-flash'],
    fast: ['gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-3.5-flash'],
  },
  imageModels: ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'],
  limits: {
    titleMax: 100,
    titleIdeal: 60,
    descriptionMax: 5000,
    tagsMax: 500,
    hashtagsMax: 15,
    thumbBytesMax: 2 * 1024 * 1024,
    thumbW: 1280,
    thumbH: 720,
    inlineVideoMaxBytes: 18 * 1024 * 1024,
  },
};
