const { font, brandFont } = require('./fonts.cjs');
const { resolveTransition } = require('./transition-options.mjs');
const {
  prepareFrameBackground,
  frameStyle,
  backgroundImage,
  regionTheme,
  scrim,
} = require('./frame-background.cjs');

async function prepareTransition(layout, style, frame, value, scene) {
  const options = resolveTransition(value, scene, layout.options?.titleFont);
  const own = value?.enabled !== false && value?.background === 'custom';
  const backdrop = await prepareFrameBackground(
    layout,
    style,
    own
      ? {
          enabled: true,
          preset: 'custom',
          path: value.path,
          blur: options.blur,
          dim: options.dim,
          saturation: options.saturation,
          contrast: options.contrast,
          ...(frame?.surfaces ? { surfaces: frame.surfaces } : {}),
        }
      : frame,
  );
  let image;
  if (options.mode === 'image') image = await backgroundImage(options.path);
  else {
    const separateBands = frame?.surfaces && options.showChrome;
    const y = separateBands ? layout.headerHeight : 0;
    const bottom = separateBands
      ? layout.caption.enabled !== false
        ? layout.caption.y
        : layout.height
      : layout.height;
    const theme = regionTheme(
      backdrop.title,
      { x: 0, y, width: layout.width, height: Math.max(1, bottom - y) },
      options.contrast,
    );
    scrim(backdrop.title.getContext('2d'), theme);
    if (separateBands) backdrop.center = theme;
    else backdrop.top = backdrop.bottom = backdrop.center = theme;
  }
  return { ...frameStyle(style, backdrop, true), transition: { ...options, image } };
}

const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const characters = (text) => Array.from(segmenter.segment(String(text)), (x) => x.segment);
function textWidth(ctx, text, spacing) {
  const chars = characters(text);
  return (
    (spacing
      ? chars.reduce((sum, char) => sum + ctx.measureText(char).width, 0)
      : ctx.measureText(text).width) +
    Math.max(0, chars.length - 1) * spacing
  );
}
function wrap(ctx, text, width, spacing) {
  const lines = [];
  for (const paragraph of String(text).split(/\r?\n/)) {
    let line = '',
      count = 0,
      lineWidth = 0;
    for (const char of characters(paragraph)) {
      const nextWidth = spacing
        ? lineWidth + ctx.measureText(char).width + (count ? spacing : 0)
        : ctx.measureText(line + char).width;
      if (line && nextWidth > width) {
        lines.push(line);
        line = char;
        count = 1;
        lineWidth = ctx.measureText(char).width;
      } else {
        line += char;
        count++;
        lineWidth = nextWidth;
      }
    }
    lines.push(line);
  }
  return lines;
}
function transitionGeometry(ctx, layout, scene, plan, options) {
  const t = options,
    u = layout.unit || layout.width / 1440;
  const margin = Math.min(layout.width * 0.3, Math.max(layout.margin || 0, t.margin * u));
  const top = t.showChrome ? Math.max(margin * 0.5, layout.headerHeight + 20 * u) : margin;
  const footer =
    layout.caption.enabled !== false
      ? layout.caption.y
      : layout.timeline.enabled !== false
        ? layout.timeline.labelBaseline - 30 * u
        : layout.height;
  const bottom = t.showChrome
    ? Math.min(layout.height - margin * 0.5, footer - 20 * u)
    : layout.height - margin;
  const box = {
    x: margin,
    y: top,
    width: layout.width - 2 * margin,
    height: Math.max(40 * u, bottom - top),
  };
  const title = t.heading || scene.heading,
    subtitle = t.subtitle || scene.subtitle || plan.title || '';
  const measure = (scale) => {
    const blocks = [];
    if (t.showNumber)
      blocks.push({
        kind: 'number',
        text: String(scene.chapter + 1).padStart(2, '0') + '.',
        size: t.numberSize * u * scale,
        gap: 0,
        spacing: 0,
        family: brandFont,
      });
    blocks.push({
      kind: 'heading',
      text: title,
      size: t.fontSize * u * scale,
      gap: t.showNumber ? t.numberGap * u * scale : 0,
      spacing: t.letterSpacing * u * scale,
      family: font,
    });
    if (t.showSubtitle && subtitle)
      blocks.push({
        kind: 'subtitle',
        text: subtitle,
        size: t.subtitleSize * u * scale,
        gap: t.subtitleGap * u * scale,
        spacing: 0,
        family: font,
      });
    for (const block of blocks) {
      ctx.font = block.family(block.size);
      block.lines = wrap(ctx, block.text, box.width, block.spacing);
      block.lineHeight = block.size * (block.kind === 'heading' ? t.lineHeight : 1.3);
      block.height = block.lines.length * block.lineHeight;
    }
    return { blocks, height: blocks.reduce((sum, b) => sum + b.gap + b.height, 0) };
  };
  let measured = measure(1);
  if (measured.height > box.height) {
    let low = 0.01,
      high = 1;
    measured = measure(low);
    for (let i = 0; i < 10; i++) {
      const scale = (low + high) / 2,
        next = measure(scale);
      if (next.height <= box.height) {
        low = scale;
        measured = next;
      } else high = scale;
    }
  }
  const { blocks, height } = measured;
  let y =
    box.y +
    (t.verticalAlign === 'top'
      ? 0
      : t.verticalAlign === 'bottom'
        ? box.height - height
        : (box.height - height) / 2);
  y = Math.max(box.y, Math.min(box.y + box.height - height, y + t.offsetY * u));
  for (const block of blocks) {
    y += block.gap;
    block.y = y;
    y += block.height;
    ctx.font = block.family(block.size);
    block.positions = block.lines.map((line) => {
      const width = textWidth(ctx, line, block.spacing);
      const x =
        box.x +
        (t.align === 'left'
          ? 0
          : t.align === 'right'
            ? box.width - width
            : (box.width - width) / 2);
      return {
        text: line,
        x: Math.max(box.x, Math.min(box.x + box.width - width, x + t.offsetX * u)),
        width,
      };
    });
  }
  return { box, blocks, height, top: blocks[0].y, bottom: y };
}

function paintTransitionContent(ctx, layout, scene, plan, style) {
  const t = style.transition || resolveTransition(null, scene, layout.options?.titleFont);
  if (t.mode === 'image') {
    const image = t.image;
    if (!image) throw Error('请重新上传章节过场图片');
    const scale = (t.fit === 'cover' ? Math.max : Math.min)(
      layout.width / image.width,
      layout.height / image.height,
    );
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, layout.width, layout.height);
    ctx.clip();
    ctx.drawImage(
      image,
      (layout.width - image.width * scale) / 2,
      (layout.height - image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
    ctx.restore();
    return;
  }
  const geometry = transitionGeometry(ctx, layout, scene, plan, t);
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const block of geometry.blocks) {
    ctx.font = block.family(block.size);
    ctx.fillStyle =
      block.kind === 'number'
        ? style.titleTheme.accent
        : block.kind === 'subtitle'
          ? style.titleTheme.muted
          : style.titleTheme.ink;
    block.positions.forEach((line, i) => {
      const y = block.y + (i + 0.5) * block.lineHeight;
      if (!block.spacing) ctx.fillText(line.text, line.x, y);
      else {
        let x = line.x;
        for (const char of characters(line.text)) {
          ctx.fillText(char, x, y);
          x += ctx.measureText(char).width + block.spacing;
        }
      }
    });
  }
  ctx.restore();
}
function transitionChrome(style) {
  return style.transition?.showChrome !== false;
}
module.exports = {
  prepareTransition,
  paintTransitionContent,
  transitionGeometry,
  transitionChrome,
};
