const { createCanvas } = require('@napi-rs/canvas');
const { font, brandFont } = require('./fonts.cjs');
const { ellipsis } = require('./tutorial-brand.cjs');
const { headerDefaults } = require('./header-options.mjs');
const { backgroundImage, readableText } = require('./frame-background.cjs');

async function prepareHeaderStyle(style, value, surfaces) {
  if ((!value || value.enabled === false) && !surfaces) return style;
  const options = headerDefaults(value?.enabled === false ? undefined : value, style.brand);
  const brand = options.inheritBrand
    ? { enabled: true, name: 'YAK', tagline: 'TUTORIAL STUDIO', ...style.brand }
    : { enabled: true, name: options.brandName, tagline: options.brandTagline };
  const image =
    options.mode !== 'hidden' && (options.logoEnabled || options.mode === 'logo')
      ? await backgroundImage(options.path)
      : null;
  return { ...style, header: { options, brand, image } };
}
function headerTimerAllowed(style) {
  const h = style.header?.options;
  return !h || (h.mode === 'full' && h.showTimer);
}
function footerLabelsAllowed(style) {
  return style.header?.options.showFooterChapters !== false;
}

function headerGeometry(ctx, layout, header) {
  const h = header.options,
    u = layout.unit || layout.width / 1440;
  const margin = layout.margin ?? 16 * u;
  const top = layout.custom ? layout.headerTop : 12 * u;
  const bottom = layout.custom ? top + layout.headerBand : Math.min(layout.headerHeight, 104 * u);
  const height = Math.max(1, bottom - top - 4 * u);
  const timer = headerTimerAllowed({ header }) && layout.timer?.enabled !== false;
  const timerWidth = timer
    ? (layout.timer?.timeWidth || (layout.width < 1000 ? 130 : 174)) + 20 * u
    : 0;
  const x = Math.min(layout.width - margin - 8 * u, margin + h.offsetX * u);
  const maxWidth = Math.max(1, layout.width - margin - x - timerWidth);
  const groupMax = h.mode === 'full' ? Math.min(maxWidth, layout.width * 0.38) : maxWidth;
  const logoOnly = h.mode === 'logo';
  const brandVisible = header.brand.enabled || !h.inheritBrand || logoOnly || h.logoEnabled;
  const showName = brandVisible && !logoOnly && h.showName && header.brand.name;
  const showTagline = brandVisible && !logoOnly && h.showTagline && header.brand.tagline;
  let nameSize = Math.min(h.fontSize * u, height * 0.65),
    taglineSize = Math.min(h.taglineSize * u, height * 0.35);
  let textHeight =
    (showName ? nameSize : 0) +
    (showTagline ? taglineSize : 0) +
    (showName && showTagline ? h.textGap * u : 0);
  if (textHeight > height) {
    const scale = height / textHeight;
    nameSize *= scale;
    taglineSize *= scale;
    textHeight = height;
  }
  let logoWidth = 0,
    logoHeight = 0;
  if (header.image) {
    const scale = Math.min(
      (h.logoHeight * u) / header.image.height,
      height / header.image.height,
      (h.logoMaxWidth * u) / header.image.width,
      groupMax / header.image.width,
    );
    logoWidth = header.image.width * scale;
    logoHeight = header.image.height * scale;
  }
  const gap =
    logoWidth && (showName || showTagline)
      ? Math.min(h.logoGap * u, Math.max(0, groupMax - logoWidth))
      : 0;
  const textMax = Math.max(0, groupMax - logoWidth - gap);
  ctx.font = brandFont(nameSize);
  const name = showName ? ellipsis(ctx, header.brand.name, textMax) : '';
  const nameWidth = ctx.measureText(name).width;
  ctx.font = font(taglineSize);
  const tagline = showTagline ? ellipsis(ctx, header.brand.tagline, textMax) : '';
  const width = logoWidth + gap + Math.max(nameWidth, ctx.measureText(tagline).width);
  const groupHeight = Math.max(textHeight, logoHeight);
  const y =
    top + Math.max(0, Math.min(height - groupHeight, (height - groupHeight) / 2 + h.offsetY * u));
  return {
    x,
    y,
    width,
    height: groupHeight,
    logoWidth,
    logoHeight,
    logoY: y + (groupHeight - logoHeight) / 2,
    textX: x + logoWidth + gap,
    textY: y + (groupHeight - textHeight) / 2,
    name,
    tagline,
    nameSize,
    taglineSize,
    textGap: h.textGap * u,
    headingX: x + (width ? width + 24 * u : 0),
    right: layout.width - margin - timerWidth,
    top,
    bandHeight: height,
    u,
  };
}

function paintProjectHeader(ctx, layout, scene, plan, style) {
  const data = style.header,
    h = data.options;
  if (h.mode === 'hidden' || layout.options?.showHeader === false) return;
  const g = headerGeometry(ctx, layout, data),
    u = g.u;
  ctx.save();
  ctx.globalAlpha = h.opacity / 100;
  ctx.textBaseline = 'top';
  if (data.image && g.logoWidth > 0) {
    if (h.logoTone === 'original')
      ctx.drawImage(data.image, g.x, g.logoY, g.logoWidth, g.logoHeight);
    else {
      const canvas = createCanvas(
          Math.max(1, Math.ceil(g.logoWidth)),
          Math.max(1, Math.ceil(g.logoHeight)),
        ),
        c = canvas.getContext('2d');
      c.drawImage(data.image, 0, 0, canvas.width, canvas.height);
      c.globalCompositeOperation = 'source-in';
      c.fillStyle =
        h.logoTone === 'light' ? '#ffffff' : h.logoTone === 'dark' ? '#121820' : style.ink;
      c.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(canvas, g.x, g.logoY, g.logoWidth, g.logoHeight);
    }
  }
  ctx.fillStyle = style.ink;
  ctx.font = brandFont(g.nameSize);
  if (g.name) readableText(ctx, g.name, g.textX, g.textY, style);
  ctx.fillStyle = style.muted;
  ctx.font = font(g.taglineSize);
  if (g.tagline)
    readableText(ctx, g.tagline, g.textX, g.textY + (g.name ? g.nameSize + g.textGap : 0), style);
  ctx.restore();
  if (h.mode !== 'full') return;
  const stacked = layout.stacked,
    x = stacked ? layout.margin || 16 * u : g.headingX;
  const width = Math.max(0, g.right - x),
    size = Math.min((layout.options?.headerFont || 24) * u, g.bandHeight * 0.5);
  const y = stacked
    ? Math.max(g.top + g.bandHeight + 16 * u, layout.headerHeight * 0.48)
    : g.top + 4 * u;
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.font = font(size);
  ctx.fillStyle = style.ink;
  if (h.showSceneTitle) readableText(ctx, ellipsis(ctx, scene.heading, width), x, y, style);
  ctx.font = font(Math.max(8, size * 0.6));
  ctx.fillStyle = style.muted;
  if (h.showChapter)
    readableText(
      ctx,
      ellipsis(ctx, plan.chapters[scene.chapter] || '', width),
      x,
      y + (h.showSceneTitle ? size + 8 * u : 0),
      style,
    );
  ctx.restore();
}
module.exports = {
  prepareHeaderStyle,
  paintProjectHeader,
  headerTimerAllowed,
  footerLabelsAllowed,
  headerGeometry,
};
