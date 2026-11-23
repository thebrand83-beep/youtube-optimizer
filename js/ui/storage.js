// Browser-only persistence. A future multi-user version swaps this for an authenticated backend.
const K = { key: 'ytps.geminiKey', settings: 'ytps.settings', history: 'ytps.history' };
export const getKey = () => localStorage.getItem(K.key) || '';
export const setKey = v => v ? localStorage.setItem(K.key, v.trim()) : localStorage.removeItem(K.key);
export const getSettings = () => ({ quality: 'balanced', aiImages: 'auto', links: '', ...JSON.parse(localStorage.getItem(K.settings) || '{}') });
export const setSettings = s => localStorage.setItem(K.settings, JSON.stringify(s));
export const getHistory = () => JSON.parse(localStorage.getItem(K.history) || '[]');
export function addHistory(item) {
  const h = getHistory().filter(x => x.id !== item.id);
  h.unshift(item);
  try { localStorage.setItem(K.history, JSON.stringify(h.slice(0, 12))); }
  catch { localStorage.setItem(K.history, JSON.stringify(h.slice(0, 4))); }
}
