// Google Identity Services (OAuth 2 token model) — browser only, no client secret, token kept in memory.
export const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
let token = null, exp = 0, client = null, clientFor = '', pending = null;

export function loadGIS() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (pending) return pending;
  pending = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => { pending = null; rej(new Error('לא הצלחתי לטעון את שירות ההתחברות של Google.')); };
    document.head.append(s);
  });
  return pending;
}

/** Must be called from a click handler (popup). Call loadGIS() earlier so this stays synchronous up to requestAccessToken. */
export function signIn(clientId, { prompt = '' } = {}) {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) return reject(new Error('שירות ההתחברות של Google עדיין נטען — נסה שוב בעוד שנייה.'));
    const done = r => {
      if (r.error) return reject(new Error(r.error === 'access_denied' ? 'ההתחברות בוטלה או שלא אושרו ההרשאות.' : `שגיאת התחברות: ${r.error}`));
      if (!window.google.accounts.oauth2.hasGrantedAllScopes?.(r, SCOPE) && r.scope && !r.scope.includes(SCOPE))
        return reject(new Error('לא אושרה ההרשאה לניהול הערוץ. התחבר שוב וסמן את כל ההרשאות.'));
      token = r.access_token; exp = Date.now() + (r.expires_in || 3600) * 1000; resolve(token);
    };
    if (!client || clientFor !== clientId) {
      client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: SCOPE, callback: r => client._cb?.(r),
        error_callback: e => client._err?.(new Error(e?.type === 'popup_closed' ? 'חלון ההתחברות נסגר.' : e?.type === 'popup_failed_to_open' ? 'הדפדפן חסם את חלון ההתחברות — אפשר חלונות קופצים לאתר.' : 'ההתחברות נכשלה.')),
      });
      clientFor = clientId;
    }
    client._cb = done; client._err = reject;
    client.requestAccessToken({ prompt });
  });
}
export const getToken = () => (token && Date.now() < exp - 60000 ? token : null);
export function signOut() { try { if (token) window.google?.accounts?.oauth2?.revoke(token, () => {}); } catch { /* ignore */ } token = null; exp = 0; }
