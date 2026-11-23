// "Smart Composer": renders a polished 1280x720 thumbnail on canvas from a background image
// (AI image, video frame or uploaded photo), an optional face photo and the AI-designed concept.
export const W = 1280, H = 720;
const HEB = /[\u0590-\u05FF]/;

function luminance(hex) {
  const m = /^#?([\da-f]{6})$/i.exec(hex || ''); if (!m) return 0;
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function safeAccent(hex) {
  if (!/^#?[\da-f]{6}$/i.test(hex || '')) return '#FFD23F';
  hex = hex.startsWith('#') ? hex : '#' + hex;
  return luminance(hex) < 0.32 ? '#FFD23F' : hex;
}

function drawCover(ctx, img, x, y, w, h, focusX = 0.5) {
  const ir = img.width / img.height, r = w / h;
  let sw, sh, sx, sy;
  if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) * focusX; sy = 0; }
  else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) * 0.35; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function fontFor(text, size) {
  return HEB.test(text) ? `900 ${size}px Heebo, Rubik, sans-serif` : `400 ${size * 1.08}px Anton, Impact, sans-serif`;
}

function wrap(ctx, words, maxW, size, text) {
  ctx.font = fontFor(text, size);
  const space = ctx.measureText(' ').width * 0.9;
  const lines = []; let cur = [], curW = 0;
  for (const w of words) {
    const ww = ctx.measureText(w).width;
    if (cur.length && curW + space + ww > maxW) { lines.push({ words: cur, w: curW }); cur = [w]; curW = ww; }
    else { curW += (cur.length ? space : 0) + ww; cur.push(w); }
  }
  if (cur.length) lines.push({ words: cur, w: curW });
  return { lines, space, widest: Math.max(...lines.map(l => l.w)) };
}

export function render(canvas, { bg, face, concept, headline, badge, bgFocus = null }) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const layout = concept.layout || 'text-right';
  const accent = safeAccent(concept.accent_color);
  headline = (headline ?? concept.headline ?? '').trim();
  badge = (badge ?? concept.badge ?? '').trim();
  const rtl = HEB.test(headline);
  // ---- background
  ctx.fillStyle = '#0b0b0f'; ctx.fillRect(0, 0, W, H);
  if (bg) {
    ctx.save(); ctx.filter = 'contrast(1.12) saturate(1.28) brightness(1.04)';
    const focus = bgFocus != null ? bgFocus : face ? (layout === 'text-left' ? 0.35 : 0.65) : (layout === 'text-right' ? 0.25 : layout === 'text-left' ? 0.75 : 0.5);
    drawCover(ctx, bg, 0, 0, W, H, focus); ctx.restore();
  } else {
    const g = ctx.createRadialGradient(W * 0.3, H * 0.4, 40, W * 0.5, H * 0.5, W * 0.8);
    g.addColorStop(0, accent + '55'); g.addColorStop(1, '#07070a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // ---- face cut-in (feathered) on the side opposite to text
  const faceSide = layout === 'text-left' ? 'right' : 'left';
  if (face) {
    const fw = layout === 'center-punch' || layout === 'bottom-bar' ? 560 : 640;
    const off = document.createElement('canvas'); off.width = fw; off.height = H;
    const o = off.getContext('2d');
    o.filter = 'contrast(1.1) saturate(1.2) brightness(1.06)'; drawCover(o, face, 0, 0, fw, H); o.filter = 'none';
    o.globalCompositeOperation = 'destination-in';
    const m = o.createLinearGradient(faceSide === 'left' ? fw : 0, 0, faceSide === 'left' ? 0 : fw, 0);
    m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(0.28, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,1)');
    o.fillStyle = m; o.fillRect(0, 0, fw, H);
    const fx = faceSide === 'left' ? 0 : W - fw;
    const glow = ctx.createRadialGradient(fx + fw / 2, H * 0.45, 30, fx + fw / 2, H * 0.45, fw * 0.75);
    glow.addColorStop(0, accent + '40'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(off, fx, 0);
  }
  // ---- readability gradients
  const grad = (x0, y0, x1, y1, a) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(0.55, `rgba(0,0,0,${a * 0.45})`); g.addColorStop(1, 'rgba(0,0,0,0)'); return g; };
  if (layout === 'text-right') { ctx.fillStyle = grad(W, 0, W * 0.38, 0, 0.82); ctx.fillRect(0, 0, W, H); }
  else if (layout === 'text-left') { ctx.fillStyle = grad(0, 0, W * 0.62, 0, 0.82); ctx.fillRect(0, 0, W, H); }
  else if (layout === 'bottom-bar') { ctx.fillStyle = grad(0, H, 0, H * 0.38, 0.9); ctx.fillRect(0, 0, W, H); }
  else { ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(0, 0, W, H); }
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.55)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);

  // ---- headline
  const side = layout === 'text-right' || layout === 'text-left';
  const boxW = side ? (face ? 600 : 640) : 1120;
  const words = headline.split(/\s+/).filter(Boolean);
  let size = side ? 190 : 175, fit;
  const maxLines = side ? 3 : 2, maxH = side ? H * 0.72 : H * 0.48;
  for (; size > 50; size -= 6) {
    fit = wrap(ctx, words, boxW, size, headline);
    if (fit.lines.length <= maxLines && fit.lines.length * size * 1.02 <= maxH && fit.widest <= boxW) break;
  }
  const lh = size * (rtl ? 1.02 : 1.0);
  const blockH = fit.lines.length * lh;
  let top = layout === 'bottom-bar' ? H - 48 - blockH : layout === 'center-punch' ? H * 0.47 - blockH / 2 : H * 0.5 - blockH / 2 + (badge ? 30 : 0);
  const hl = (concept.highlight_word || '').trim();
  ctx.textBaseline = 'alphabetic'; ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  const anchorX = (lineW) => layout === 'text-right' ? W - 64 : layout === 'text-left' ? 64 + (rtl ? lineW : 0) : W / 2 + (rtl ? lineW / 2 : -lineW / 2);
  fit.lines.forEach((line, i) => {
    const y = top + (i + 1) * lh - lh * 0.14;
    let x = anchorX(line.w);
    if (!rtl && layout === 'text-right') x = W - 64 - line.w;
    for (const word of line.words) {
      ctx.font = fontFor(headline, size);
      const ww = ctx.measureText(word).width;
      const isHl = hl && (word.includes(hl) || hl.includes(word.replace(/[^\p{L}\p{N}]/gu, '')) && word.length > 1);
      const dx = rtl ? x - ww : x;
      ctx.textAlign = 'left';
      // shadow + stroke
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = size * 0.22; ctx.shadowOffsetY = size * 0.05;
      ctx.lineWidth = size * 0.13; ctx.strokeStyle = '#000'; ctx.strokeText(word, dx, y); ctx.restore();
      if (isHl) {
        const g = ctx.createLinearGradient(0, y - size * 0.8, 0, y);
        g.addColorStop(0, lighten(accent, 0.35)); g.addColorStop(1, accent); ctx.fillStyle = g;
      } else {
        const g = ctx.createLinearGradient(0, y - size * 0.8, 0, y); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#e9e6df'); ctx.fillStyle = g;
      }
      ctx.fillText(word, dx, y);
      x = rtl ? x - ww - fit.space : x + ww + fit.space;
    }
  });
  // accent underline
  const lastW = fit.lines[fit.lines.length - 1]?.w || 200;
  const ulW = Math.min(lastW * 0.45, 260), ulY = top + blockH + 14;
  if (layout !== 'bottom-bar') {
    let ux = layout === 'text-right' ? W - 64 - ulW : layout === 'text-left' ? 64 : W / 2 - ulW / 2;
    ctx.save(); ctx.shadowColor = accent; ctx.shadowBlur = 18; ctx.fillStyle = accent; roundRect(ctx, ux, ulY, ulW, 11, 6); ctx.fill(); ctx.restore();
  }
  // ---- badge
  if (badge) {
    const bs = 44; ctx.font = (HEB.test(badge) ? `800 ${bs}px Heebo` : `400 ${bs}px Anton`);
    const bw = ctx.measureText(badge).width + 44, bh = bs + 26;
    const bx = layout === 'text-left' ? 54 : W - 54 - bw, by = 46;
    ctx.save(); ctx.translate(bx + bw / 2, by + bh / 2); ctx.rotate((layout === 'text-left' ? 1 : -1) * -0.045);
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 6;
    ctx.fillStyle = accent; roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 14); ctx.fill();
    ctx.direction = HEB.test(badge) ? 'rtl' : 'ltr'; ctx.shadowColor = 'transparent'; ctx.fillStyle = luminance(accent) > 0.5 ? '#111' : '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(badge, 0, 3); ctx.restore();
  }
  return canvas;
}

function lighten(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.round(c + (255 - c) * k);
  return `rgb(${f(n >> 16)},${f(n >> 8 & 255)},${f(n & 255)})`;
}

export async function toJpeg(canvas, maxBytes = 2 * 1024 * 1024) {
  for (let q = 0.93; q >= 0.5; q -= 0.07) {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', q));
    if (blob.size <= maxBytes) return blob;
  }
  return new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.5));
}

export function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image(); i.crossOrigin = 'anonymous'; i.decoding = 'async';
    i.onload = () => res(i); i.onerror = () => rej(new Error('img ' + src)); i.src = src;
  });
}
export async function ensureFonts() {
  try { await Promise.all(['900 80px Heebo', '800 40px Heebo', '400 80px Anton'].map(f => document.fonts.load(f, 'אבג ABC'))); } catch { /* ignore */ }
}
