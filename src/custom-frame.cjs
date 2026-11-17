const { layoutMetrics } = require('./layout-options.mjs');
const { font, brandFont } = require('./fonts.cjs');
const { ellipsis } = require('./tutorial-brand.cjs');
const { paintFrameBackground } = require('./frame-background.cjs');
const floorEven = (n) => Math.floor(n / 2) * 2;

function customFrameLayout(info, style, options, width, height) {
  const unit = options.aspect === 'auto' ? width / 1440 : Math.min(width, height) / 1080;
  const m = layoutMetrics(options.layout, unit),
    l = m.value;
  const headerBottom = m.topPadding + m.header;
  const footerTop = height - m.bottomPadding - m.footer;
  const box = {
    x: m.margin + m.border,
    y: Math.ceil(headerBottom + (m.header ? m.gap : 0) + m.border),
    width: floorEven(width - 2 * m.margin - 2 * m.border),
    bottom: Math.floor(footerTop - (m.footer ? m.gap : 0) - m.border),
  };
  box.height = floorEven(box.bottom - box.y);
  if (box.width < 240 * unit || box.height < 180 * unit)
    throw Error('当前排版留给录屏的空间不足，请减小边距、栏高、字号或字幕行数。');
  const scale = Math.min(box.width / info.width, box.height / info.height);
  const vw = Math.max(2, floorEven(info.width * scale)),
    vh = Math.max(2, floorEven(info.height * scale));
  let vy = box.y + (box.height - vh) / 2;
  if (l.videoAlign === 'top') vy = box.y;
  if (l.videoAlign === 'bottom') vy = box.y + box.height - vh;
  vy = Math.ceil(vy / 2) * 2;
  if (vy + vh > box.bottom) vy -= 2;
  const chapterTop = footerTop + m.caption + (m.caption && m.timeline ? m.gap : 0);
  const timerWidth = Math.ceil(180 * unit);
  return {
    custom: true,
    legacy: false,
    width,
    height,
    unit,
    margin: m.margin,
    options: l,
    headerHeight: headerBottom,
    headerTop: m.topPadding,
    headerBand: m.header,
    borderWidth: m.border,
    video_x: floorEven((width - vw) / 2),
    video_y: vy,
    video_width: vw,
    video_height: vh,
    caption: {
      enabled: l.showCaptions,
      x: m.margin,
      y: footerTop,
      width: width - m.margin * 2,
      height: Math.max(2, m.caption),
      size: m.captionSize,
      lineHeight: m.lineHeight,
      baseline:
        m.padding +
        Math.ceil(m.captionSize * 0.9) +
        Math.floor((m.lineHeight - m.captionSize - 2) / 2),
      lines: l.captionLines,
      textWidth: width - 2 * m.margin - Math.max(16, Math.round(24 * unit)),
    },
    timeline: {
      enabled: l.showTimeline,
      labels: l.timelineLabels,
      fontSize: Math.max(9, Math.round(l.chapterFont * unit)),
      x: m.margin,
      y: l.showTimeline ? chapterTop + m.labels : height - m.rail,
      width: width - 2 * m.margin,
      height: m.rail,
      gap: Math.round(l.chapterGap * unit),
      labelBaseline: chapterTop + Math.round(l.chapterFont * unit),
    },
    timer: {
      enabled: l.showHeader && l.showTimer,
      timeX: width - m.margin - timerWidth,
      timeWidth: timerWidth,
      timeY: m.topPadding + Math.round(5 * unit),
      timeHeight: Math.max(24, Math.ceil(36 * unit)),
      timeFont: Math.max(12, Math.round(20 * unit)),
      statusY: m.topPadding + Math.round(40 * unit),
      statusHeight: Math.max(16, Math.ceil(22 * unit)),
      statusFont: Math.max(9, Math.round(12 * unit)),
    },
  };
}

function paintCustomFrame(ctx, layout, scene, plan, style, wrapText) {
  const { width: W, height: H, unit: u, margin: x, options: l } = layout;
  paintFrameBackground(ctx, style, W, H);
  if (scene.kind === 'title' && !require('./transition.cjs').transitionChrome(style)) {
    require('./transition.cjs').paintTransitionContent(ctx, layout, scene, plan, style);
    return;
  }
  if (style.header)
    require('./header-brand.cjs').paintProjectHeader(ctx, layout, scene, plan, style);
  else if (l.showHeader) {
    const brand = { enabled: true, name: 'YAK', tagline: 'TUTORIAL STUDIO', ...style.brand };
    const top = layout.headerTop,
      size = Math.round(l.headerFont * u);
    const timerSpace = layout.timer.enabled ? layout.timer.timeWidth + 18 * u : 0;
    let headingX = x;
    ctx.textBaseline = 'top';
    if (brand.enabled) {
      const brandWidth = Math.min(W * 0.24, 190 * u);
      ctx.font = brandFont(size);
      ctx.fillStyle = style.ink;
      ctx.fillText(ellipsis(ctx, brand.name, brandWidth - 10 * u), x, top + 4 * u);
      ctx.font = font(Math.max(9, Math.round(size * 0.46)));
      ctx.fillStyle = style.muted;
      ctx.fillText(ellipsis(ctx, brand.tagline, brandWidth - 10 * u), x, top + size + 12 * u);
      headingX += brandWidth + 16 * u;
    }
    const headingWidth = Math.max(0, W - x - timerSpace - headingX);
    ctx.font = font(size);
    ctx.fillStyle = style.ink;
    ctx.fillText(ellipsis(ctx, scene.heading, headingWidth), headingX, top + 4 * u);
    ctx.font = font(Math.max(9, Math.round(size * 0.56)));
    ctx.fillStyle = style.muted;
    ctx.fillText(
      ellipsis(ctx, plan.chapters[scene.chapter] || '', headingWidth),
      headingX,
      top + size + 12 * u,
    );
  }
  if (scene.kind === 'title') {
    require('./transition.cjs').paintTransitionContent(ctx, layout, scene, plan, style);
  } else {
    const r = style.videoRect || {
      x: layout.video_x,
      y: layout.video_y,
      width: layout.video_width,
      height: layout.video_height,
    };
    ctx.clearRect(r.x, r.y, r.width, r.height);
    if (layout.borderWidth > 0) {
      const b = layout.borderWidth;
      ctx.strokeStyle = style.line;
      ctx.lineWidth = b;
      ctx.strokeRect(
        layout.video_x - b / 2,
        layout.video_y - b / 2,
        layout.video_width + b,
        layout.video_height + b,
      );
    }
  }
  const t = layout.timeline,
    footer = style.footer;
  if (t.enabled)
    for (const segment of plan.chapterSegments) {
      if (t.labels && require('./header-brand.cjs').footerLabelsAllowed(style)) {
        ctx.font = font(t.fontSize);
        ctx.fillStyle = footer.ink;
        ctx.textBaseline = 'alphabetic';
        require('./frame-background.cjs').readableText(
          ctx,
          ellipsis(
            ctx,
            String(segment.index + 1).padStart(2, '0') + '  ' + segment.title,
            segment.width - 2,
          ),
          t.x + segment.x,
          t.labelBaseline,
          footer,
        );
      }
      ctx.fillStyle = footer.line;
      ctx.beginPath();
      ctx.roundRect(
        t.x + segment.x,
        t.y,
        segment.width,
        t.height,
        Math.min(t.height / 2, segment.width / 2),
      );
      ctx.fill();
    }
}

module.exports = { customFrameLayout, paintCustomFrame };
