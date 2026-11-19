const fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { createCanvas } = require('@napi-rs/canvas');
const { normalizeCover } = require('./cover-options.mjs');
const { backgroundImage, prepareFrameBackground } = require('./frame-background.cjs');
const { frameLayout, wrapText } = require('./frame-layout.cjs');
const { font, brandFont, ensureFonts } = require('./fonts.cjs');
const { FFMPEG, FFPROBE, run } = require('./media.cjs');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

async function importCover(value, dir) {
  const cover = normalizeCover(value);
  if (cover.mode !== 'image') return cover;
  await backgroundImage(cover.path);
  const bytes = await fs.readFile(cover.path),
    digest = hash(bytes);
  const target = path.join(dir, 'covers', digest + path.extname(cover.path).toLowerCase());
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
  return { ...cover, path: target, name: value.name || path.basename(cover.path), hash: digest };
}
async function verifyCover(value) {
  const c = normalizeCover(value);
  if (c.mode === 'image' && (!value.hash || hash(await fs.readFile(c.path)) !== value.hash))
    throw Error('封面图片已变更，请重新上传并保存');
}

function linesFor(ctx, text, size, width) {
  return String(text)
    .split(/\r?\n/u)
    .flatMap((s) => wrapText(ctx, s, size, width));
}
async function coverImage({ value, script, info, style, exportOptions, branding, canvas }) {
  const c = normalizeCover(value);
  if (c.mode === 'none') return { image: null, mode: 'none' };
  ensureFonts();
  const layout = canvas || frameLayout(info, style, exportOptions);
  const W = layout.width,
    H = layout.height,
    u = Math.min(W, H) / 1080;
  const board = createCanvas(W, H),
    ctx = board.getContext('2d');
  const light =
    c.theme === 'light' ||
    (c.theme === 'auto' && ['mist', 'porcelain', 'paper'].includes(branding?.frame?.preset));
  const ink = light ? '#172b33' : '#f4f6fc',
    muted = light ? '#52666a' : '#b7c8d9',
    accent = light ? '#a35d21' : '#f4c483';
  if (c.mode === 'image') {
    ctx.fillStyle = light ? '#e8eeeb' : '#132233';
    ctx.fillRect(0, 0, W, H);
    const image = await backgroundImage(c.path);
    const scale = (c.fit === 'contain' ? Math.min : Math.max)(W / image.width, H / image.height);
    ctx.drawImage(
      image,
      (W - image.width * scale) / 2,
      (H - image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
  } else {
    const backdrop = await prepareFrameBackground(
      { ...layout, video_y: 0, video_height: H },
      style,
      branding?.frame,
    );
    ctx.drawImage(backdrop.content, 0, 0);
    ctx.fillStyle = light ? '#eef3eddd' : '#0b192add';
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.9, H * 0.12, 0, W * 0.9, H * 0.12, W * 0.8);
    glow.addColorStop(0, light ? '#e9b87533' : '#8ba8d635');
    glow.addColorStop(1, '#8ba8d600');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = light ? '#577b7825' : '#c0d1eb20';
    ctx.lineWidth = 2 * u;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.ellipse(
        W * 0.96,
        H * 0.14,
        W * (0.25 + i * 0.08),
        H * (0.32 + i * 0.1),
        -0.3,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  }
  const title = c.title || script?.title || '操作与实践教程';
  const subtitle = c.subtitle || (script?.chapters || []).slice(0, 3).join(' · ');
  const text = c.mode === 'generated' || c.overlayTitle;
  if (text) {
    if (c.mode === 'image') {
      ctx.fillStyle = light ? '#f3f5edcc' : '#0b1526cf';
      ctx.fillRect(0, 0, W, H);
    }
    const margin = Math.min(W * 0.1, 104 * u),
      maxWidth = W - margin * 2;
    let size = Math.min(104 * u, W * 0.1),
      lines;
    do {
      lines = linesFor(ctx, title, size, maxWidth);
      if (lines.length <= 4 && lines.length * size * 1.3 <= H * 0.44) break;
      size *= 0.92;
    } while (size > 18 * u);
    // Long user titles remain complete; font size adapts to the cover's available area.
    while (lines.length * size * 1.3 > H * 0.44) {
      size *= 0.92;
      lines = linesFor(ctx, title, size, maxWidth);
    }
    const subSize = 27 * u;
    let sub = c.showSubtitle ? linesFor(ctx, subtitle, subSize, maxWidth).slice(0, 3) : [];
    const blockHeight =
      lines.length * size * 1.3 + (sub.length ? 40 * u + sub.length * subSize * 1.55 : 0);
    const top = (H - blockHeight) / 2 + 20 * u;
    ctx.textBaseline = 'top';
    const brand = { enabled: true, name: 'YAK', tagline: 'TUTORIAL STUDIO', ...style.brand };
    const header = branding?.header;
    if (header?.inheritBrand === false) {
      brand.enabled = true;
      brand.name = header.brandName;
      brand.tagline = header.brandTagline;
    }
    let brandX = margin;
    if (
      header?.enabled !== false &&
      (header?.logoEnabled || header?.mode === 'logo') &&
      header.path
    ) {
      const image = await backgroundImage(header.path),
        s = Math.min((50 * u) / image.height, (160 * u) / image.width);
      if (header.logoTone && header.logoTone !== 'original') {
        const mark = createCanvas(
            Math.max(1, Math.ceil(image.width * s)),
            Math.max(1, Math.ceil(image.height * s)),
          ),
          m = mark.getContext('2d');
        m.drawImage(image, 0, 0, mark.width, mark.height);
        m.globalCompositeOperation = 'source-in';
        m.fillStyle =
          header.logoTone === 'light' ? '#ffffff' : header.logoTone === 'dark' ? '#172b33' : ink;
        m.fillRect(0, 0, mark.width, mark.height);
        ctx.drawImage(mark, brandX, 76 * u);
      } else ctx.drawImage(image, brandX, 76 * u, image.width * s, image.height * s);
      brandX += image.width * s + 18 * u;
    }
    if (brand.enabled) {
      ctx.font = brandFont(29 * u);
      ctx.fillStyle = ink;
      ctx.fillText(brand.name || '', brandX, 76 * u, maxWidth);
      ctx.font = font(13 * u);
      ctx.fillStyle = muted;
      ctx.fillText(brand.tagline || '', brandX, 115 * u, maxWidth);
    }
    ctx.fillStyle = accent;
    ctx.fillRect(c.align === 'center' ? (W - 72 * u) / 2 : margin, top - 45 * u, 72 * u, 5 * u);
    ctx.font = font(size);
    ctx.fillStyle = ink;
    lines.forEach((line, i) =>
      ctx.fillText(
        line,
        c.align === 'center' ? (W - ctx.measureText(line).width) / 2 : margin,
        top + i * size * 1.3,
      ),
    );
    ctx.font = font(subSize);
    ctx.fillStyle = muted;
    sub.forEach((line, i) =>
      ctx.fillText(
        line,
        c.align === 'center' ? (W - ctx.measureText(line).width) / 2 : margin,
        top + lines.length * size * 1.3 + 40 * u + i * subSize * 1.55,
      ),
    );
    ctx.font = font(15 * u);
    ctx.fillStyle = muted;
    ctx.fillText(
      'TUTORIAL  /  ' + String(script?.chapters?.length || 1).padStart(2, '0') + ' CHAPTERS',
      margin,
      H - 90 * u,
    );
  }
  return {
    bytes: board.toBuffer('image/jpeg', 93),
    width: W,
    height: H,
    title: text ? title : '',
    mode: c.mode,
  };
}

async function probeStreams(file, signal) {
  return JSON.parse(
    (
      await run(
        FFPROBE,
        ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', file],
        { signal },
      )
    ).stdout,
  );
}
async function remuxCover(source, target, image, signal) {
  const before = await probeStreams(source, signal);
  const args = ['-hide_banner', '-v', 'error', '-y', '-i', source];
  if (image) args.push('-i', image);
  args.push('-map', '0:V:0', '-map', '0:a?', '-map_metadata', '0', '-map_chapters', '0');
  if (image) args.push('-map', '1:v:0');
  args.push('-c', 'copy');
  if (image) args.push('-disposition:v:1', 'attached_pic', '-metadata:s:v:1', 'title=Cover');
  args.push('-movflags', '+faststart', target);
  await run(FFMPEG, args, { signal });
  const after = await probeStreams(target, signal);
  const main = (data) =>
    data.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const a = main(before),
    b = main(after);
  if (
    !b ||
    b.width !== a.width ||
    b.height !== a.height ||
    b.nb_frames !== a.nb_frames ||
    Math.abs(Number(before.format.duration) - Number(after.format.duration)) > 0.01 ||
    after.chapters.length !== before.chapters.length
  )
    throw Error('封面更新校验失败，原始成片已保留');
  const pictures = after.streams.filter((s) => s.disposition?.attached_pic);
  if (pictures.length !== (image ? 1 : 0)) throw Error('MP4 封面写入校验失败');
  return { embedded: !!image, duration: Number(after.format.duration), frameCount: b.nb_frames };
}
async function writeCover({ source, target, dir, value, signal, ...context }) {
  const c = normalizeCover(value),
    result = await coverImage({ value: c, ...context });
  let file;
  if (result.bytes) {
    file = path.join(dir, 'cover.jpg');
    await fs.writeFile(file, result.bytes);
  } else await fs.rm(path.join(dir, 'cover.jpg'), { force: true });
  let check;
  if (target !== source || (c.embed && file)) {
    const dest =
      target === source ? path.join(dir, 'cover-remux-' + crypto.randomUUID() + '.mp4') : target;
    try {
      check = await remuxCover(source, dest, c.embed ? file : null, signal);
      if (dest !== target) await fs.rename(dest, target);
    } finally {
      if (dest !== target) await fs.rm(dest, { force: true });
    }
  }
  return {
    mode: c.mode,
    enabled: !!file,
    embedded: !!(c.embed && file),
    file: file ? 'cover.jpg' : null,
    title: result.title || '',
    width: result.width,
    height: result.height,
    ...check,
  };
}
async function coverContext(project, config) {
  if (project.output?.coverContext) return project.output.coverContext;
  let script = project.script || { title: project.title, chapters: [] },
    style = config.style;
  if (project.output) {
    try {
      script = JSON.parse(await fs.readFile(path.join(project.output.dir, 'script.json'), 'utf8'));
    } catch {}
    try {
      style =
        JSON.parse(await fs.readFile(path.join(project.output.dir, 'config.json'), 'utf8')).style ||
        style;
    } catch {}
  }
  return {
    script: { title: script.title, chapters: script.chapters },
    style,
    info: project.info,
    exportOptions: project.exportOptions,
    branding: {
      ...project.branding,
      ...(project.output?.plan?.frame?.options ? { frame: project.output.plan.frame.options } : {}),
    },
    ...(project.output?.verification?.canvas ? { canvas: project.output.verification.canvas } : {}),
  };
}
module.exports = {
  importCover,
  verifyCover,
  coverImage,
  writeCover,
  remuxCover,
  probeStreams,
  coverContext,
};
