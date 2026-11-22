// Draws one wallpaper on a canvas. Layout units are iPhone points, exported at the screen's pixel ratio.
import { clamp } from './core.js';

const FONT_HOST = 'https://fonts.gstatic.com/s/';
// Each font is loaded as one file with no unicode-range. Google's split files send "space + pause mark"
// to a fallback font, which misdraws the waqf signs.
export const FONT_FILES = {
  amiri: ['Ayah Amiri', `${FONT_HOST}amiriquran/v19/_Xmo-Hk0rD6DbUL4_vH8Zp5v5i2ssg.woff2`],
  scheherazade: ['Ayah Scheherazade', `${FONT_HOST}scheherazadenew/v21/4UaZrFhTvxVnHDvUkUiHg8jprP4DOwFmO24p.woff2`],
  garamond: ['Ayah Garamond', `${FONT_HOST}ebgaramond/v33/SlGDmQSNjdsmc35JDF1K5E55YMjF_7DPuGi-6_RkBI9_.woff2`],
  inter: ['Ayah Inter', `${FONT_HOST}inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hiA.woff2`],
};

export const THEMES = {
  midnight: { label: 'Midnight', stops: ['#050914', '#0d1930', '#182844'], ar: '#f7f0df', en: '#cbd3df', accent: '#d8bd82' },
  dusk: { label: 'Dusk', stops: ['#17192f', '#383153', '#80566b', '#d49a78'], at: [0, 0.45, 0.78, 1], ar: '#fff6ea', en: '#eee0dc', accent: '#f0c9a0' },
  emerald: { label: 'Emerald', stops: ['#041916', '#14483d', '#041916'], ar: '#f4ead2', en: '#c8d6cb', accent: '#d6b978' },
  sand: { label: 'Sand', stops: ['#f6efe4', '#efe2cf'], ar: '#35291e', en: '#62513f', accent: '#8a6238' },
  black: { label: 'Black', stops: ['#000000', '#000000'], ar: '#f5f5f2', en: '#b4b4b0', accent: '#969692' },
  color: { label: 'My color' },
  photo: { label: 'My photo', ar: '#ffffff', en: '#eeeeee', accent: '#e8d3a8' },
};

const loading = new Map();

/** Fails loudly: drawing the Quran in a substitute font is worse than not drawing it. */
export function loadFonts(s) {
  const wanted = [s.arFont, s.enFont].filter((name) => FONT_FILES[name]);
  return Promise.all(wanted.map((name) => {
    if (!loading.has(name)) {
      const [family, url] = FONT_FILES[name];
      const job = new FontFace(family, `url(${url})`).load().then((face) => {
        document.fonts.add(face);
      }, (error) => {
        loading.delete(name);
        throw error;
      });
      loading.set(name, job);
    }
    return loading.get(name);
  }));
}

export function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function palette(s) {
  let base = THEMES[s.theme];
  if (s.theme === 'color') {
    const light = (luminance(s.color1) + luminance(s.color2)) / 2 > 0.58;
    base = light ? THEMES.sand : THEMES.black;
  }
  return { ar: s.arColor || base.ar, en: s.enColor || base.en, accent: s.accent || base.accent };
}

export function topIsLight(s) {
  if (s.theme === 'color') return luminance(s.color1) > 0.58;
  return s.theme === 'sand';
}

function drawStars(ctx, w, h, count, seed) {
  let n = seed;
  const next = () => ((n = (n * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = '#e8ecf5';
  // Stars stop above the verse, where they would read as letter dots.
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = 0.2 + next() * 0.55;
    ctx.beginPath();
    ctx.arc(next() * w, next() * h * 0.33, [0.4, 0.5, 0.6, 0.9][Math.floor(next() * 4)], 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawCrescent(ctx, w, h) {
  const r = w * 0.037;
  const layer = document.createElement('canvas');
  layer.width = layer.height = Math.ceil(r * 8);
  const c = layer.getContext('2d');
  c.scale(4, 4);
  c.fillStyle = '#e9d9ae';
  c.beginPath();
  c.arc(r, r, r, 0, Math.PI * 2);
  c.fill();
  c.globalCompositeOperation = 'destination-out';
  c.beginPath();
  c.arc(r * 1.42, r * 0.78, r * 0.88, 0, Math.PI * 2);
  c.fill();
  ctx.drawImage(layer, w * 0.84 - r, h * 0.355 - r, r * 2, r * 2);
}

function drawMosque(ctx, w, h) {
  ctx.save();
  // Drawn for 402pt wide, anchored to the bottom edge.
  ctx.translate(0, h);
  ctx.scale(w / 402, w / 402);
  ctx.translate(0, -874);
  const path = new Path2D();
  for (const [x, base, r] of [[201, 827, 47], [139, 840, 22], [263, 840, 22], [101, 851, 14], [301, 851, 14]]) {
    path.moveTo(x - r, base);
    path.bezierCurveTo(x - r * 1.12, base - r * 0.7, x - r * 0.3, base - r * 0.95, x, base - r * 1.4);
    path.bezierCurveTo(x + r * 0.3, base - r * 0.95, x + r * 1.12, base - r * 0.7, x + r, base);
    path.closePath();
    path.rect(x - 0.8, base - r * 1.4 - 11, 1.6, 13);
  }
  for (const [x, top] of [[70, 778], [332, 778], [24, 819], [378, 819]]) {
    path.rect(x - 5, top, 10, 880 - top);
    path.rect(x - 8, top + 24, 16, 4);
    path.moveTo(x - 6, top);
    path.lineTo(x, top - 23);
    path.lineTo(x + 6, top);
    path.closePath();
  }
  path.rect(154, 826, 94, 50);
  path.rect(117, 839, 168, 40);
  path.rect(0, 850, 402, 30);
  ctx.fillStyle = '#17142a';
  ctx.fill(path);
  ctx.restore();
}

function drawArch(ctx, w, h) {
  ctx.save();
  ctx.scale(w / 402, h / 874);
  ctx.strokeStyle = '#d6b978';
  ctx.lineWidth = 1;
  for (const [inset, alpha] of [[0, 0.55], [7, 0.22]]) {
    const left = 22 + inset;
    const right = 380 - inset;
    const top = 258 + inset * 1.3;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(left, 880);
    ctx.lineTo(left, 390);
    ctx.bezierCurveTo(left, 326, 150, 318, 201, top);
    ctx.bezierCurveTo(252, 318, right, 326, right, 390);
    ctx.lineTo(right, 880);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDunes(ctx, w, h) {
  ctx.save();
  ctx.scale(w / 402, h / 874);
  ctx.fillStyle = '#dfc7a4';
  ctx.fill(new Path2D('M0 792C90 748 170 806 250 788S360 752 402 766V880H0Z'));
  ctx.fillStyle = '#d2b58d';
  ctx.fill(new Path2D('M0 836C100 798 180 850 280 828S370 810 402 818V880H0Z'));
  ctx.restore();
}

function drawPhoto(ctx, w, h, s, image) {
  const cover = Math.max(w / image.width, h / image.height);
  const iw = image.width * cover;
  const ih = image.height * cover;
  let source = image;
  if (s.blur) {
    // ctx.filter is missing in Safari, so blur by repeatedly halving the image.
    const target = Math.max(12, iw / (1 + s.blur * 0.3));
    let sw = image.width;
    while (sw > target) {
      const nw = Math.max(target, sw / 2);
      const small = document.createElement('canvas');
      small.width = Math.round(nw);
      small.height = Math.max(1, Math.round((nw * image.height) / image.width));
      small.getContext('2d').drawImage(source, 0, 0, small.width, small.height);
      source = small;
      sw = nw;
    }
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, (w - iw) / 2, (h - ih) / 2, iw, ih);
  ctx.fillStyle = `rgba(0,0,0,${s.dim / 100})`;
  ctx.fillRect(0, 0, w, h);
}

export function drawBackground(ctx, w, h, s, photo) {
  if (s.theme === 'photo' && photo) {
    drawPhoto(ctx, w, h, s, photo);
    return;
  }
  const theme = s.theme === 'color' ? { stops: [s.color1, s.color2] }
    : THEMES[s.theme === 'photo' ? 'black' : s.theme];
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  theme.stops.forEach((color, i) => gradient.addColorStop(theme.at?.[i] ?? i / (theme.stops.length - 1), color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  if (s.theme === 'midnight') {
    drawStars(ctx, w, h, 95, 4001);
    drawCrescent(ctx, w, h);
  } else if (s.theme === 'dusk') {
    drawStars(ctx, w, h, 45, 8009);
    drawMosque(ctx, w, h);
  } else if (s.theme === 'emerald') {
    drawArch(ctx, w, h);
  } else if (s.theme === 'sand') {
    drawDunes(ctx, w, h);
  }
}

/** Pause marks stay with the word before them, the section sign with the word after it. */
export function arabicTokens(text) {
  const out = [];
  for (const word of text.split(' ')) {
    const joinsPrevious = /^[\u06d6-\u06dc\u06e9]+$/.test(word) || out.at(-1) === '\u06de';
    if (out.length && joinsPrevious) out[out.length - 1] += ` ${word}`;
    else out.push(word);
  }
  return out;
}

/** A dash never starts a line. */
export function englishTokens(text) {
  const out = [];
  for (const word of text.split(' ')) {
    if (word === '-' && out.length) out[out.length - 1] += ` ${word}`;
    else out.push(word);
  }
  return out;
}

function wrapBalanced(ctx, tokens, maxWidth) {
  const width = new Map();
  const measure = (text) => {
    if (!width.has(text)) width.set(text, ctx.measureText(text).width);
    return width.get(text);
  };
  const greedy = (limit) => {
    const lines = [];
    let line = null;
    for (const token of tokens) {
      const joined = line === null ? token : `${line} ${token}`;
      if (line !== null && measure(joined) > limit) {
        lines.push(line);
        line = token;
      } else {
        line = joined;
      }
    }
    lines.push(line);
    return lines;
  };

  if (tokens.some((token) => measure(token) > maxWidth)) return null;
  let best = greedy(maxWidth);
  if (best.length === 1) return best;
  // Narrow the column as far as the line count allows, so no line has a lone word.
  let low = maxWidth * 0.4;
  let high = maxWidth;
  for (let i = 0; i < 7; i++) {
    const mid = (low + high) / 2;
    const lines = greedy(mid);
    if (lines.length === best.length && lines.every((line) => measure(line) <= maxWidth)) {
      best = lines;
      high = mid;
    } else {
      low = mid;
    }
  }
  return best;
}

function fontFor(name) {
  if (name === 'system') return '-apple-system, system-ui, sans-serif';
  return `"${FONT_FILES[name][0]}"`;
}

/** Finds the largest size that fits the safe area. Returns null if the verse cannot fit. */
export function layoutVerse(ctx, w, h, s, verse) {
  const unit = w / 402;
  const emerald = s.theme === 'emerald';
  // Clear of the clock and one row of widgets above, and the two buttons below.
  const top = h * (emerald ? 0.432 : 0.387);
  const bottom = h * 0.845;
  const maxWidth = w - 2 * (emerald ? 46 : 28) * unit;
  const showAr = s.show !== 'en';
  const showEn = s.show !== 'ar';
  const tokens = arabicTokens(verse.ar);
  const hasHighMarks = /[\u06d6-\u06dc]/.test(verse.ar);

  for (let scale = 1; scale >= 0.38; scale -= 0.025) {
    const arSize = 32 * unit * (s.arSize / 100) * scale;
    const enSize = Math.max(11.5, 20.5 * unit * (s.enSize / 100) * Math.max(scale, 0.5) * (s.enFont === 'garamond' ? 1 : 0.86));
    const arLeading = arSize * (hasHighMarks ? 2.5 : 2.15);
    const enLeading = enSize * 1.36;
    const arFont = `${arSize}px ${fontFor(s.arFont)}`;
    const enFont = `${enSize}px ${fontFor(s.enFont)}`;

    let ar = [];
    let en = [];
    if (showAr) {
      ctx.font = arFont;
      ctx.direction = 'rtl';
      ar = wrapBalanced(ctx, tokens, maxWidth);
      if (!ar) continue;
    }
    if (showEn) {
      ctx.font = enFont;
      ctx.direction = 'ltr';
      en = wrapBalanced(ctx, englishTokens(verse.en), maxWidth);
      if (!en) continue;
    }

    const middle = showAr && showEn ? 38 * unit : 0;
    const footer = s.reference ? 34 * unit : 0;
    const height = ar.length * arLeading + middle + en.length * enLeading + footer;
    if (height > bottom - top) continue;

    if ((showAr && ar.join(' ') !== verse.ar) || (showEn && en.join(' ') !== verse.en)) {
      throw new Error(`Text check failed for ${verse.ref}`);
    }
    const y = top + (bottom - top - height) * ((s.position + 100) / 200);
    return { ar, en, arFont, enFont, arSize, enSize, arLeading, enLeading, middle, footer, height, y, top, bottom, unit };
  }
  return null;
}

function drawVerse(ctx, w, s, verse, box) {
  const color = palette(s);
  const x = w / 2;
  let y = box.y;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font = box.arFont;
  ctx.direction = 'rtl';
  ctx.fillStyle = color.ar;
  for (const line of box.ar) {
    ctx.fillText(line, x, y + box.arLeading * 0.64);
    y += box.arLeading;
  }

  if (box.middle) {
    if (s.divider) {
      ctx.fillStyle = color.accent;
      ctx.fillRect(x - 17 * box.unit, y + box.middle * 0.48, 34 * box.unit, 1);
    }
    y += box.middle;
  }

  ctx.font = box.enFont;
  ctx.direction = 'ltr';
  ctx.fillStyle = color.en;
  for (const line of box.en) {
    ctx.fillText(line, x, y + box.enLeading * 0.75);
    y += box.enLeading;
  }

  if (box.footer) {
    ctx.font = `${13 * box.unit}px ${fontFor(s.enFont)}`;
    ctx.fillStyle = color.accent;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${2 * box.unit}px`;
    ctx.fillText(`${verse.surah.toUpperCase()} · ${verse.ref}`, x, y + box.footer * 0.85);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
}

/** Returns false, leaving only the background, if the verse does not fit. */
export function renderWallpaper(canvas, screen, s, verse, photo) {
  const { w, h, ratio } = screen;
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  drawBackground(ctx, w, h, s, photo);
  if (!verse) return false;
  const box = layoutVerse(ctx, w, h, s, verse);
  if (!box) return false;
  drawVerse(ctx, w, s, verse, box);
  return true;
}
