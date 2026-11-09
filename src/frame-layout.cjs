const crypto = require('node:crypto');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { normalizeExportOptions, exportDimensions } = require('./export-options.mjs');
const { font, brandFont } = require('./fonts.cjs');
const {
  brandLayout,
  paintHeader,
  paintTimeline,
  chapterSegments,
  ellipsis,
} = require('./tutorial-brand.cjs');

const even = (value) => Math.max(2, Math.round(value / 2) * 2);
function exportHash(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(normalizeExportOptions(value)))
    .digest('hex');
}

function containRect(source, box) {
  const scale = Math.min(box.width / source.width, box.height / source.height);
  const width = even(source.width * scale),
    height = even(source.height * scale);
  return {
    x: even(box.x + (box.width - width) / 2),
    y: even(box.y + (box.height - height) / 2),
    width,
    height,
  };
}

function frameLayout(info, style, options) {
  const value = normalizeExportOptions(options);
  const { width: W, height: H } = exportDimensions(value, info, style);
  if (value.aspect === 'auto') {
    const VW = W - 32,
      VH = H - 200;
    return {
      legacy: true,
      width: W,
      height: H,
      video_x: 16,
      video_y: 72,
      video_width: VW,
      video_height: VH,
      margin: 16,
      headerHeight: 72,
      caption: {
        x: 0,
        y: 74 + VH,
        width: W,
        height: 72,
        size: 27,
        lineHeight: 32,
        baseline: 31,
        textWidth: W - 80,
      },
      timeline: {
        x: 16,
        y: H - 16,
        width: VW,
        height: 8,
        gap: style.chapterGap ?? 12,
        labelBaseline: H - 30,
      },
    };
  }
  const u = Math.min(W, H) / 1080,
    margin = even(40 * u);
  const portrait = H > W * 1.4;
  const landscape = W > H;
  const stacked = H >= W && info.width / info.height > 1.2;
  const headerHeight = even(stacked ? H * (portrait ? 0.265 : 0.225) : (landscape ? 80 : 104) * u);
  const captionHeight = even((landscape ? 80 : stacked && portrait ? 178 : 116) * u);
  const footerTop = H - even((landscape ? 144 : stacked && portrait ? 340 : 218) * u);
  const video = containRect(info, {
    x: margin,
    y: headerHeight + even(20 * u),
    width: W - 2 * margin,
    height: footerTop - headerHeight - even((landscape ? 32 : 48) * u),
  });
  const captionY = stacked ? even(Math.min(footerTop, video.y + video.height + 54 * u)) : footerTop;
  return {
    legacy: false,
    width: W,
    height: H,
    video_x: video.x,
    video_y: video.y,
    video_width: video.width,
    video_height: video.height,
    margin,
    unit: u,
    portrait,
    stacked,
    headerHeight,
    caption: {
      x: margin,
      y: captionY,
      width: W - margin * 2,
      height: captionHeight,
      size: Math.round((landscape ? 28 : stacked && portrait ? 38 : 32) * u),
      lineHeight: Math.round((landscape ? 34 : stacked && portrait ? 54 : 43) * u),
      baseline: Math.round((landscape ? 32 : stacked && portrait ? 59 : 43) * u),
      textWidth: W - margin * 2 - Math.round(52 * u),
    },
    timeline: {
      x: margin,
      y: H - even((landscape ? 18 : 42) * u),
      width: W - margin * 2,
      height: even(6 * u),
      gap: even(16 * u),
      labelBaseline: H - Math.round((landscape ? 34 : 70) * u),
    },
    timer: {
      timeX: W - margin - Math.round(184 * u),
      timeWidth: Math.round(184 * u),
      timeY: Math.round(28 * u),
      timeHeight: Math.round(38 * u),
      timeFont: Math.round(24 * u),
      statusY: Math.round(68 * u),
      statusHeight: Math.round(26 * u),
      statusFont: Math.round(16 * u),
    },
  };
}

function wrapText(ctx, text, size, width) {
  ctx.font = font(size);
  const lines = [];
  let line = '';
  for (const token of (String(text).match(/[A-Za-z0-9./:_+-]+|./gu) || []).flatMap((t) =>
    ctx.measureText(t).width > width ? [...t] : [t],
  )) {
    if (line && ctx.measureText(line + token).width > width) {
      lines.push(line);
      line = token;
    } else line += token;
  }
  if (line) lines.push(line);
  return lines;
}

function fittedText(ctx, text, box, size, color, maxSize = size) {
  let lines;
  for (size = maxSize; size > 12; size--) {
    lines = wrapText(ctx, text, size, box.width);
    if (lines.length * size * 1.35 <= box.height) break;
  }
  ctx.font = font(size);
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(line, box.x, box.y + i * size * 1.35));
  return { size, lines, box };
}

function drawAdaptiveTimeline(ctx, layout, segments, scene, style) {
  const { unit: u, timeline: t } = layout;
  ctx.textBaseline = 'alphabetic';
  for (const segment of segments) {
    const current = segment.index === scene.chapter;
    ctx.font = font(Math.round(19 * u));
    ctx.fillStyle = current ? style.ink : '#81786D';
    const label = String(segment.index + 1).padStart(2, '0') + '  ' + segment.title;
    ctx.fillText(ellipsis(ctx, label, segment.width - 2), t.x + segment.x, t.labelBaseline);
    ctx.fillStyle = '#DED6C9';
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

function paintAdaptiveFrame(ctx, layout, scene, plan, style) {
  const { width: W, height: H, margin: m, unit: u } = layout;
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, W, H);
  const brand = { enabled: true, name: 'YAK', tagline: 'TUTORIAL STUDIO', ...style.brand };
  if (brand.enabled) {
    ctx.font = brandFont(Math.round(38 * u));
    ctx.fillStyle = style.ink;
    ctx.textBaseline = 'top';
    const name = ellipsis(ctx, brand.name, W - 2 * m - 230 * u);
    ctx.fillText(name, m, 30 * u);
    ctx.fillStyle = style.accent;
    ctx.fillRect(m + ctx.measureText(name).width + 9 * u, 38 * u, 7 * u, 7 * u);
    ctx.font = font(Math.round(12 * u));
    ctx.fillStyle = '#81786D';
    ctx.fillText(ellipsis(ctx, brand.tagline, W - 2 * m - 230 * u), m + u, 76 * u);
  }
  if (scene.kind === 'title') {
    ctx.save();
    ctx.strokeStyle = '#E6DED2';
    ctx.lineWidth = Math.max(1, 1.4 * u);
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.ellipse(W * 1.05 + k * 34 * u, H * 0.44, W * 0.48 + k * 28 * u, H * 0.46, -0.3, 0.6, 5.2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = style.secondary_accent;
    ctx.font = font(Math.round(18 * u));
    ctx.textBaseline = 'top';
    ctx.fillText('TUTOR / PRACTICAL GUIDE', m + 8 * u, H * 0.23);
    ctx.font = brandFont(Math.round(100 * u));
    ctx.fillStyle = style.accent;
    ctx.fillText(String(scene.chapter + 1).padStart(2, '0') + '.', m, H * 0.29);
    fittedText(
      ctx,
      scene.heading,
      { x: m, y: H * 0.43, width: W - 2 * m, height: layout.caption.y - H * 0.43 - 90 * u },
      Math.round(76 * u),
      style.ink,
    );
    ctx.font = font(Math.round(23 * u));
    ctx.fillStyle = '#81786D';
    ctx.fillText(ellipsis(ctx, plan.title || '', W - 2 * m), m, layout.caption.y - 58 * u);
  } else {
    if (layout.stacked) {
      ctx.font = font(Math.round(18 * u));
      ctx.fillStyle = style.secondary_accent;
      ctx.textBaseline = 'top';
      ctx.fillText(
        '第 ' +
          String(scene.chapter + 1).padStart(2, '0') +
          ' 章  /  ' +
          (plan.chapters[scene.chapter] || ''),
        m,
        layout.portrait ? 194 * u : 118 * u,
      );
      fittedText(
        ctx,
        scene.heading,
        {
          x: m,
          y: layout.portrait ? 247 * u : 157 * u,
          width: W - 2 * m,
          height: layout.headerHeight - (layout.portrait ? 247 : 157) * u,
        },
        Math.round((layout.portrait ? 60 : 38) * u),
        style.ink,
      );
    } else {
      ctx.font = font(Math.round(24 * u));
      ctx.fillStyle = style.ink;
      ctx.textBaseline = 'top';
      const x = m + (brand.enabled ? 230 * u : 0);
      ctx.fillText(ellipsis(ctx, scene.heading, layout.timer.timeX - x - 28 * u), x, 38 * u);
      ctx.font = font(Math.round(15 * u));
      ctx.fillStyle = '#81786D';
      ctx.fillText(
        ellipsis(ctx, plan.chapters[scene.chapter] || '', layout.timer.timeX - x - 28 * u),
        x,
        75 * u,
      );
    }
    ctx.clearRect(layout.video_x, layout.video_y, layout.video_width, layout.video_height);
    ctx.strokeStyle = '#D9D0C1';
    ctx.lineWidth = 2 * u;
    ctx.strokeRect(
      layout.video_x - u,
      layout.video_y - u,
      layout.video_width + 2 * u,
      layout.video_height + 2 * u,
    );
  }
  ctx.fillStyle = '#E5DED2';
  ctx.fillRect(m, layout.caption.y, W - 2 * m, Math.max(1, u));
  drawAdaptiveTimeline(ctx, layout, plan.chapterSegments, scene, style);
}

async function framePreview({
  info = { width: 1280, height: 720 },
  style,
  exportOptions,
  background,
  scene,
  script,
  watermark,
  title = false,
}) {
  const layout = frameLayout(info, style, exportOptions);
  const c = createCanvas(layout.width, layout.height),
    ctx = c.getContext('2d');
  const selected = {
    chapter: 0,
    heading: '构造请求，核对响应',
    narration: '观察请求参数与响应内容，确认实际操作结果。',
    ...scene,
    kind: title ? 'title' : 'action',
  };
  const plan = {
    title: script?.title || 'HTTP 请求与响应核对',
    chapters: script?.chapters || ['构造请求', '核对响应', '总结'],
    canvas: layout,
  };
  plan.chapterSegments = chapterSegments(
    plan.chapters.map((name, i) => ({ title: name, start: i, end: i + 1 })),
    plan.chapters.length,
    layout.timeline.width,
    layout.timeline.gap,
  );
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, layout.width, layout.height);
  if (!title) {
    if (background) {
      const image = await loadImage(background),
        r = containRect(image, {
          x: layout.video_x,
          y: layout.video_y,
          width: layout.video_width,
          height: layout.video_height,
        });
      ctx.drawImage(image, r.x, r.y, r.width, r.height);
    } else {
      ctx.fillStyle = '#F0F2F6';
      ctx.fillRect(layout.video_x, layout.video_y, layout.video_width, layout.video_height);
      ctx.fillStyle = '#DEE2EC';
      for (let i = 0; i < 6; i++)
        ctx.fillRect(
          layout.video_x + layout.video_width * 0.06,
          layout.video_y + layout.video_height * (0.12 + i * 0.12),
          layout.video_width * (i % 2 ? 0.65 : 0.82),
          layout.video_height * 0.05,
        );
    }
  }
  const overlay = createCanvas(layout.width, layout.height),
    oc = overlay.getContext('2d');
  if (!layout.legacy) paintAdaptiveFrame(oc, layout, selected, plan, style);
  else {
    oc.fillStyle = style.background;
    oc.fillRect(0, 0, layout.width, layout.height);
    if (!title)
      oc.clearRect(layout.video_x, layout.video_y, layout.video_width, layout.video_height);
    else
      fittedText(
        oc,
        selected.heading,
        { x: 70, y: layout.height * 0.35, width: layout.width - 140, height: layout.height * 0.35 },
        76,
        style.ink,
      );
    paintHeader(oc, brandLayout(oc, style, layout.width, 16), selected, plan, style, 16);
    paintTimeline(
      oc,
      plan.chapterSegments,
      selected,
      style,
      16,
      layout.height,
      layout.timeline.labelBaseline,
    );
  }
  ctx.drawImage(overlay, 0, 0);
  const cap = layout.caption;
  ctx.font = font(cap.size);
  ctx.fillStyle = style.ink;
  ctx.textBaseline = 'alphabetic';
  wrapText(ctx, selected.narration || '', cap.size, cap.textWidth)
    .slice(0, 2)
    .forEach((line, i) =>
      ctx.fillText(
        line,
        (layout.width - ctx.measureText(line).width) / 2,
        cap.y + cap.baseline + i * cap.lineHeight,
      ),
    );
  if (watermark?.enabled) {
    const { normalizeBranding, watermarkLayer } = require('./branding.cjs');
    ctx.drawImage(await watermarkLayer(normalizeBranding({ watermark }).watermark, layout), 0, 0);
  }
  const scale = Math.min(1, 1000 / Math.max(layout.width, layout.height));
  const small = createCanvas(Math.round(layout.width * scale), Math.round(layout.height * scale));
  small.getContext('2d').drawImage(c, 0, 0, small.width, small.height);
  return {
    image: 'data:image/png;base64,' + small.toBuffer('image/png').toString('base64'),
    canvas: layout,
    sample: !background,
  };
}

module.exports = {
  exportHash,
  frameLayout,
  containRect,
  wrapText,
  paintAdaptiveFrame,
  framePreview,
};
