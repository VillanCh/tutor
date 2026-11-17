const fs = require('node:fs/promises');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { FRAME_DEFAULTS } = require('./branding-options.mjs');

const luminance = (r, g, b) =>
  [r, g, b].reduce((sum, v, i) => {
    v /= 255;
    return (
      sum + (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]
    );
  }, 0);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

async function backgroundImage(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw Error('背景图片不能超过 20 MB');
  const image = await loadImage(file);
  if (!image.width || !image.height || image.width * image.height > 40000000)
    throw Error('背景图片尺寸不能超过 4000 万像素');
  return image;
}

// Sample each area independently. A local scrim handles even a black/white busy image.
function regionTheme(canvas, box, mode) {
  const y = Math.min(canvas.height - 1, box.y);
  const data = canvas
    .getContext('2d')
    .getImageData(box.x, y, box.width, Math.max(1, Math.min(box.height, canvas.height - y))).data;
  // Channel bounds are conservative: small bright details survive the contrast check.
  const darkest = [255, 255, 255],
    brightest = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      darkest[channel] = Math.min(darkest[channel], data[i + channel]);
      brightest[channel] = Math.max(brightest[channel], data[i + channel]);
    }
  }
  const pixels = [darkest, brightest];
  const score = (light, alpha) =>
    Math.min(
      ...pixels.map((p) => {
        const rgb = p.map((v) => v * (1 - alpha) + (light ? 0 : 255) * alpha);
        return ratio(light ? 1 : luminance(18, 24, 32), luminance(...rgb));
      }),
    );
  const light = mode === 'light' || (mode === 'auto' && score(true, 0) >= score(false, 0));
  let opacity = 0;
  while (score(light, opacity) < 4.5 && opacity < 0.85) opacity += 0.05;
  const accent = light ? [255, 196, 118] : [120, 52, 0];
  const accentScore = Math.min(
    ...pixels.map((p) =>
      ratio(
        luminance(...accent),
        luminance(...p.map((v) => v * (1 - opacity) + (light ? 0 : 255) * opacity)),
      ),
    ),
  );
  return {
    ink: light ? '#FFFFFF' : '#121820',
    muted: light ? '#FFFFFF' : '#121820',
    accent: accentScore >= 4.5 ? (light ? '#FFC476' : '#783400') : light ? '#FFFFFF' : '#121820',
    secondary_accent:
      accentScore >= 4.5 ? (light ? '#FFC476' : '#783400') : light ? '#FFFFFF' : '#121820',
    line: light ? '#FFFFFF55' : '#12182044',
    track: light ? '#FFFFFF55' : '#12182044',
    light,
    opacity,
    contrast: score(light, opacity),
    box,
  };
}

function scrim(ctx, theme) {
  ctx.fillStyle = theme.light
    ? `rgba(0,0,0,${theme.opacity})`
    : `rgba(255,255,255,${theme.opacity})`;
  const b = theme.box;
  ctx.fillRect(b.x, b.y, b.width, b.height);
}

async function prepareFrameBackground(layout, style, value) {
  const f = { ...FRAME_DEFAULTS, ...value },
    W = layout.width,
    H = layout.height;
  const canvas = createCanvas(W, H),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, W, H);
  if (f.enabled && f.preset !== 'paper') {
    if (f.preset === 'custom') {
      const image = await backgroundImage(f.path);
      const radius = (f.blur * W) / 1440,
        padding = Math.ceil(radius * 3);
      const scale = Math.max((W + padding * 2) / image.width, (H + padding * 2) / image.height);
      ctx.save();
      ctx.filter = `blur(${radius}px) saturate(${f.saturation / 100})`;
      ctx.drawImage(
        image,
        (W - image.width * scale) / 2,
        (H - image.height * scale) / 2,
        image.width * scale,
        image.height * scale,
      );
      ctx.restore();
      ctx.fillStyle = `rgba(16,24,32,${f.dim / 100})`;
      ctx.fillRect(0, 0, W, H);
    } else {
      const gradient = ctx.createLinearGradient(0, 0, W, H);
      const colors = {
        mist: ['#edf4f7', '#c9dbea', '#e5edf5'],
        porcelain: ['#faf3e8', '#e4d5c8', '#f6eee5'],
        ember: ['#211b2a', '#54372f', '#231f32'],
        midnight: ['#12202d', '#263a50', '#3d2935'],
      }[f.preset];
      colors.forEach((color, i) => gradient.addColorStop(i / 2, color));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, W, H);
    }
  }
  const top = regionTheme(canvas, { x: 0, y: 0, width: W, height: layout.video_y }, f.contrast);
  const bottomY = layout.video_y + layout.video_height;
  const bottom = regionTheme(
    canvas,
    { x: 0, y: bottomY, width: W, height: H - bottomY },
    f.contrast,
  );
  const center = regionTheme(
    canvas,
    { x: 0, y: layout.video_y, width: W, height: layout.video_height },
    f.contrast,
  );
  const content = createCanvas(W, H),
    title = createCanvas(W, H);
  for (const target of [content, title]) {
    const c = target.getContext('2d');
    c.drawImage(canvas, 0, 0);
    scrim(c, top);
    if (target === title) scrim(c, center);
    scrim(c, bottom);
  }
  return { content, title, top, bottom, center, options: f };
}

function frameStyle(style, frame, title = false) {
  return {
    ...style,
    ...frame.top,
    footer: frame.bottom,
    titleTheme: frame.center,
    backgroundLayer: title ? frame.title : frame.content,
  };
}
function paintFrameBackground(ctx, style, width, height) {
  if (style.backgroundLayer) ctx.drawImage(style.backgroundLayer, 0, 0);
  else {
    ctx.fillStyle = style.background;
    ctx.fillRect(0, 0, width, height);
  }
}

module.exports = {
  backgroundImage,
  prepareFrameBackground,
  frameStyle,
  paintFrameBackground,
  luminance,
  ratio,
  regionTheme,
  scrim,
};
