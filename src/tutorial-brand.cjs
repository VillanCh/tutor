const { font, brandFont } = require('./fonts.cjs');
const DEFAULT_BRAND = { enabled: true, name: 'YAK', tagline: 'TUTORIAL STUDIO' };

function ellipsis(ctx, text, width) {
  if (width <= 0 || ctx.measureText('…').width > width) return '';
  if (ctx.measureText(text).width <= width) return text;
  const characters = [...text];
  while (characters.length && ctx.measureText(characters.join('') + '…').width > width)
    characters.pop();
  return characters.join('') + '…';
}

function brandLayout(ctx, style, width, margin) {
  const brand = { ...DEFAULT_BRAND, ...style.brand };
  const size = Math.max(21, Math.min(32, width / 45));
  ctx.font = brandFont(size);
  const textWidth = ctx.measureText(brand.name).width;
  ctx.font = font(10);
  const taglineWidth =
    ctx.measureText(brand.tagline).width + Math.max(0, [...brand.tagline].length - 1) * 1.2;
  const slot = brand.enabled
    ? Math.min(width * 0.28, Math.max(110, textWidth + 16, taglineWidth))
    : 0;
  const timeWidth = width < 1000 ? 130 : 174;
  return {
    brand,
    size,
    brandWidth: slot,
    headingX: margin + (slot ? slot + 30 : 0),
    headingWidth: width - margin * 2 - timeWidth - (slot ? slot + 30 : 0) - 24,
    timeX: width - margin - timeWidth,
    timeWidth,
  };
}

function trackedText(ctx, text, x, baseline, tracking, width) {
  const letters = [...text];
  for (const letter of letters) {
    const advance = ctx.measureText(letter).width;
    if (x + advance > width) break;
    ctx.fillText(letter, x, baseline);
    x += advance + tracking;
  }
}

function paintHeader(ctx, layout, scene, plan, style, margin) {
  ctx.textBaseline = 'alphabetic';
  if (layout.brand.enabled) {
    ctx.font = brandFont(layout.size);
    ctx.fillStyle = style.ink;
    const name = ellipsis(ctx, layout.brand.name, layout.brandWidth - 12);
    ctx.fillText(name, margin, 40);
    ctx.fillStyle = style.accent;
    ctx.fillRect(margin + ctx.measureText(name).width + 5, 20, 5, 5);
    ctx.font = font(10);
    ctx.fillStyle = '#81786D';
    trackedText(
      ctx,
      layout.brand.tagline,
      margin + 1,
      57,
      /^[\x20-\x7e]*$/.test(layout.brand.tagline) ? 1.2 : 0.5,
      margin + layout.brandWidth,
    );
    ctx.fillStyle = '#DED6C9';
    ctx.fillRect(layout.headingX - 15, 17, 1, 39);
  }
  ctx.font = font(Math.max(17, Math.min(22, plan.canvas.width / 55)));
  ctx.fillStyle = style.ink;
  ctx.fillText(ellipsis(ctx, scene.heading, layout.headingWidth), layout.headingX, 39);
  ctx.font = font(11);
  ctx.fillStyle = '#81786D';
  const chapter =
    String(scene.chapter + 1).padStart(2, '0') +
    ' / ' +
    String(plan.chapters.length).padStart(2, '0') +
    '  ·  ' +
    plan.chapters[scene.chapter];
  ctx.fillText(ellipsis(ctx, chapter, layout.headingWidth), layout.headingX, 57);
}

function chapterSegments(chapters, total, width, gap = 12) {
  const usable = width - gap * (chapters.length - 1);
  return chapters.map((chapter, index) => ({
    ...chapter,
    index,
    x: (usable * chapter.start) / total + gap * index,
    width: (usable * (chapter.end - chapter.start)) / total,
  }));
}

function paintTimeline(ctx, segments, scene, style, x, height, labelBaseline = height - 30) {
  ctx.textBaseline = 'alphabetic';
  for (const segment of segments) {
    const current = segment.index === scene.chapter;
    if (segment.width >= 24) {
      ctx.font = brandFont(16);
      ctx.fillStyle = current ? style.accent : '#81786D';
      ctx.fillText(String(segment.index + 1).padStart(2, '0'), x + segment.x, labelBaseline);
      ctx.font = font(15);
      ctx.fillStyle = current ? style.ink : '#81786D';
      ctx.fillText(
        ellipsis(ctx, segment.title, segment.width - 35),
        x + segment.x + 29,
        labelBaseline,
      );
    }
    ctx.fillStyle = '#DED6C9';
    ctx.beginPath();
    ctx.roundRect(x + segment.x, height - 16, segment.width, 8, Math.min(4, segment.width / 2));
    ctx.fill();
  }
}

module.exports = { brandLayout, paintHeader, chapterSegments, paintTimeline, ellipsis };
