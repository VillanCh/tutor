const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadImage, createCanvas } = require('@napi-rs/canvas');
const {
  brandingDefaults,
  WATERMARK_POSITIONS,
  WATERMARK_DENSITIES,
  WATERMARK_TONES,
} = require('./branding-options.mjs');
const { FFMPEG, run, probe, wav } = require('./media.cjs');
const IMAGE = /\.(png|jpe?g|webp)$/i;
const VIDEO = /\.(mp4|mov|mkv|webm|avi|m4v)$/i;
const LABELS = { intro: '片头广告', outro: '片尾广告', watermark: '水印 Logo' };

function normalizeBranding(value) {
  if (value != null && (typeof value !== 'object' || Array.isArray(value)))
    throw Error('广告与水印设置格式无效');
  const b = brandingDefaults(value);
  for (const key of ['intro', 'outro', 'watermark']) {
    if (typeof b[key].enabled !== 'boolean') throw Error(LABELS[key] + '开关无效');
    if (typeof b[key].path !== 'string') throw Error(LABELS[key] + '文件路径无效');
    b[key].path = b[key].path.trim();
  }
  for (const key of ['intro', 'outro']) {
    const ad = b[key];
    if (typeof ad.muted !== 'boolean') throw Error(LABELS[key] + '声音设置无效');
    if (ad.enabled) {
      if (!ad.path) throw Error('请选择' + LABELS[key] + '视频或图片');
      if (!IMAGE.test(ad.path) && !VIDEO.test(ad.path))
        throw Error(LABELS[key] + '支持视频或 PNG、JPG、WebP 图片');
      if (
        IMAGE.test(ad.path) &&
        (!Number.isFinite(ad.duration) || ad.duration < 1 || ad.duration > 60)
      )
        throw Error(LABELS[key] + '图片展示时长需为 1–60 秒');
    }
    b[key] = { enabled: ad.enabled, path: ad.path, duration: ad.duration, muted: ad.muted };
  }
  const w = b.watermark;
  if (!['text', 'image'].includes(w.type)) throw Error('请选择文字或 Logo 水印');
  if (typeof w.text !== 'string') throw Error('水印文字格式无效');
  w.text = w.text.trim();
  if (!Object.hasOwn(WATERMARK_POSITIONS, w.position)) throw Error('水印位置无效');
  if (!Number.isFinite(w.opacity) || w.opacity < 5 || w.opacity > 100)
    throw Error('水印不透明度需为 5%–100%');
  if (!Number.isFinite(w.width) || w.width < 8 || w.width > 35)
    throw Error('水印宽度需为画面宽度的 8%–35%');
  if (!['corner', 'tiled'].includes(w.layout)) throw Error('请选择四角标识或全屏平铺');
  if (!Number.isFinite(w.angle) || w.angle < -60 || w.angle > 60)
    throw Error('水印旋转角度需为 -60°–60°');
  if (!Object.hasOwn(WATERMARK_DENSITIES, w.density)) throw Error('水印平铺密度无效');
  if (!Object.hasOwn(WATERMARK_TONES, w.tone)) throw Error('水印颜色无效');
  if (typeof w.protectSubtitles !== 'boolean') throw Error('字幕保护设置无效');
  if (w.enabled && w.type === 'text' && (!w.text || Array.from(w.text).length > 120))
    throw Error('请输入 1–120 字的水印文字');
  if (w.enabled && w.type === 'image' && (!w.path || !IMAGE.test(w.path)))
    throw Error('请选择 PNG、JPG 或 WebP 水印图片，推荐透明 PNG');
  b.watermark = Object.fromEntries(
    [
      'enabled',
      'type',
      'text',
      'path',
      'position',
      'opacity',
      'width',
      'layout',
      'angle',
      'density',
      'tone',
      'protectSubtitles',
    ].map((key) => [key, w[key]]),
  );
  return b;
}

async function hashAsset(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of require('node:fs').createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function assetKeys(b) {
  return ['intro', 'outro', 'watermark'].filter(
    (key) => b[key].enabled && (key !== 'watermark' || b[key].type === 'image'),
  );
}

async function importBranding(value, dir) {
  const b = normalizeBranding(value);
  for (const key of assetKeys(b)) {
    const item = b[key],
      file = path.resolve(item.path);
    let info;
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) throw Error('请选择文件');
      if (IMAGE.test(file)) {
        if (stat.size > 20 * 1024 * 1024) throw Error('图片不能超过 20 MB');
        const image = await loadImage(file);
        if (!image.width || !image.height || image.width * image.height > 40000000)
          throw Error('图片尺寸不能超过 4000 万像素');
        info = { width: image.width, height: image.height, kind: 'image' };
      } else {
        info = { ...(await probe(file)), kind: 'video' };
        if (!info.width || !info.height || !Number.isFinite(info.duration) || info.duration <= 0)
          throw Error('无法读取视频');
        if (info.duration > 120) throw Error('视频时长不能超过 120 秒');
      }
    } catch (error) {
      throw Error(
        LABELS[key] +
          '无法导入，请重新选择可用文件：' +
          path.basename(file) +
          '（' +
          error.message +
          '）',
      );
    }
    const assetDir = path.join(dir, 'branding');
    await fs.mkdir(assetDir, { recursive: true });
    const target = path.join(assetDir, crypto.randomUUID() + path.extname(file).toLowerCase());
    await fs.copyFile(file, target);
    Object.assign(item, {
      path: target,
      name: path.basename(file),
      hash: await hashAsset(target),
      info,
    });
    // Existing imported names remain readable when saving another setting.
    if (value?.[key]?.name && path.dirname(file) === path.resolve(assetDir))
      item.name = String(value[key].name);
  }
  return b;
}

function brandingHash(value) {
  const b = normalizeBranding(value);
  const active = Object.fromEntries(
    Object.entries(b).map(([key, item]) => [
      key,
      item.enabled ? { ...item, hash: value?.[key]?.hash || null } : { enabled: false },
    ]),
  );
  return crypto.createHash('sha256').update(JSON.stringify(active)).digest('hex');
}

async function verifyBranding(value) {
  const b = normalizeBranding(value);
  for (const key of assetKeys(b)) {
    let hash;
    try {
      hash = await hashAsset(b[key].path);
    } catch {
      /* Prompt for a replacement below. */
    }
    if (!value[key].hash || hash !== value[key].hash)
      throw Error(LABELS[key] + '文件已变更，请重新选择并确认');
  }
}

async function watermarkLayer(w, canvas) {
  const { width: W, height: H, video_x: x, video_y: y, video_width: vw, video_height: vh } = canvas;
  const c = createCanvas(W, H),
    ctx = c.getContext('2d');
  const tiled = w.layout === 'tiled';
  const margin = Math.max(10, Math.round(vw * 0.02));
  const maxWidth = ((tiled ? W : vw) * w.width) / 100;
  const maxHeight = tiled
    ? Math.min(H * 0.16, maxWidth * 0.5)
    : Math.min(vh * 0.24, vh - margin * 2);
  let width, height, image, size;
  if (w.type === 'image') {
    if (!IMAGE.test(w.path)) throw Error('水印图片支持 PNG、JPG 或 WebP');
    const stat = await fs.stat(w.path);
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw Error('请选择 20 MB 以内的水印图片');
    image = await loadImage(w.path);
    if (image.width * image.height > 40000000) throw Error('水印图片尺寸不能超过 4000 万像素');
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    width = image.width * scale;
    height = image.height * scale;
  } else {
    size = Math.min(tiled ? W * 0.033 : 36, maxHeight / 1.6, maxWidth / 2);
    const font = (s) =>
      (tiled ? '500 ' : '') + s + 'px "Tutor Sans", "Microsoft YaHei", sans-serif';
    ctx.font = font(size);
    size *= Math.min(1, (maxWidth - (tiled ? 0 : 12)) / Math.max(1, ctx.measureText(w.text).width));
    ctx.font = font(size);
    width = ctx.measureText(w.text).width + (tiled ? 0 : 12);
    height = size * 1.5 + (tiled ? 0 : 8);
  }
  const color = { light: '#ffffff', dark: '#263247', neutral: '#788394' }[w.tone];
  if (tiled) {
    const angle = (w.angle * Math.PI) / 180;
    const density = { relaxed: [2.6, 1.05], balanced: [2, 0.8], dense: [1.5, 0.58] }[w.density];
    const spacingWidth = Math.max(maxWidth, W * 0.22);
    const pitchX = spacingWidth * density[0];
    const rotatedHeight = Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle));
    const pitchY = Math.max(spacingWidth * density[1], rotatedHeight * 1.25);
    const bottom = w.protectSubtitles ? y + vh : H;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, bottom);
    ctx.clip();
    for (let row = -1; row <= Math.ceil(H / pitchY); row++) {
      for (let col = -1; col <= Math.ceil(W / pitchX); col++) {
        ctx.save();
        ctx.translate((col + 0.5 + (row % 2 ? 0.5 : 0)) * pitchX, (row + 0.5) * pitchY);
        ctx.rotate(angle);
        if (image) ctx.drawImage(image, -width / 2, -height / 2, width, height);
        else {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(0.75, size * 0.045);
          ctx.strokeStyle = w.tone === 'light' ? '#172033' : '#ffffff';
          ctx.strokeText(w.text, 0, 0);
          ctx.fillStyle = color;
          ctx.fillText(w.text, 0, 0);
        }
        ctx.restore();
      }
    }
    ctx.restore();
  } else {
    const left = w.position.endsWith('left') ? x + margin : x + vw - margin - width;
    const top = w.position.startsWith('top') ? y + margin : y + vh - margin - height;
    if (image) ctx.drawImage(image, left, top, width, height);
    else {
      ctx.fillStyle = w.tone === 'light' ? '#15171dcc' : '#f9f6efd9';
      ctx.beginPath();
      ctx.roundRect(left, top, width, height, 4);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.fillText(w.text, left + 6, top + height / 2);
    }
  }
  const faded = createCanvas(W, H);
  const fadedCtx = faded.getContext('2d');
  fadedCtx.globalAlpha = w.opacity / 100;
  fadedCtx.drawImage(c, 0, 0);
  return faded;
}

async function watermarkPng(w, canvas, file) {
  await fs.writeFile(file, (await watermarkLayer(w, canvas)).toBuffer('image/png'));
}

async function brandingPreview({
  watermark,
  info,
  style,
  background,
  heading = '操作与结果',
  caption,
}) {
  const w = normalizeBranding({ watermark }).watermark;
  const W = style.width,
    vw = W - 32;
  const vh =
    Math.round(Math.min(1400, (vw * (info?.height || 720)) / (info?.width || 1280)) / 2) * 2;
  const canvas = {
    width: W,
    height: 52 + vh + 108,
    video_x: 16,
    video_y: 52,
    video_width: vw,
    video_height: vh,
  };
  const c = createCanvas(W, canvas.height),
    ctx = c.getContext('2d');
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, W, canvas.height);
  ctx.fillStyle = '#eef0f4';
  ctx.fillRect(16, 52, vw, vh);
  if (background) {
    const image = await loadImage(background);
    const scale = Math.min(vw / image.width, vh / image.height);
    ctx.drawImage(
      image,
      16 + (vw - image.width * scale) / 2,
      52 + (vh - image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
  } else {
    ctx.fillStyle = '#dde2eb';
    ctx.fillRect(16, 52, vw * 0.22, vh);
    for (let row = 0; row < 5; row++) {
      ctx.fillStyle = row === 1 ? '#c6cde0' : '#d1d7e2';
      ctx.fillRect(vw * 0.04, 90 + row * vh * 0.11, vw * 0.15, vh * 0.055);
    }
    ctx.fillStyle = '#fff';
    ctx.fillRect(vw * 0.26, 92, vw * 0.68, vh * 0.78);
    ctx.fillStyle = '#c0c9d9';
    for (let row = 0; row < 6; row++)
      ctx.fillRect(vw * 0.3, 140 + row * vh * 0.095, vw * (row % 2 ? 0.48 : 0.57), 9);
  }
  ctx.textBaseline = 'middle';
  ctx.fillStyle = style.ink;
  ctx.font = '21px "Tutor Sans", "Microsoft YaHei", sans-serif';
  ctx.fillText('TUTOR / ' + heading.slice(0, 50), 26, 27);
  ctx.fillStyle = '#81786d';
  ctx.textAlign = 'center';
  ctx.font = '27px "Tutor Sans", "Microsoft YaHei", sans-serif';
  const subtitle = caption
    ? Array.from(caption).slice(0, 38).join('')
    : '字幕保护示意 · 讲解文字显示于此区域';
  ctx.fillText(subtitle, W / 2, 52 + vh + 45, W - 60);
  if (w.enabled) {
    try {
      ctx.drawImage(await watermarkLayer(w, canvas), 0, 0);
    } catch (error) {
      if (w.type === 'image')
        throw Error('无法预览 Logo，请重新选择可读的 PNG、JPG 或 WebP 图片（不超过 20 MB）。');
      throw error;
    }
  }
  const small = createCanvas(800, Math.round((canvas.height * 800) / W));
  small.getContext('2d').drawImage(c, 0, 0, small.width, small.height);
  return {
    image: 'data:image/png;base64,' + small.toBuffer('image/png').toString('base64'),
    canvas,
    sample: !background,
  };
}

async function applyBranding({
  branding,
  plan,
  output,
  dir,
  fps,
  signal,
  progress,
  background = '#000000',
}) {
  const b = normalizeBranding(branding);
  if (!Object.values(b).some((item) => item.enabled)) return null;
  const { width: W, height: H } = plan.canvas;
  const parts = [];
  for (const key of ['intro', 'content', 'outro']) {
    if (key === 'content')
      parts.push({ key, path: output, duration: plan.total_duration, audio: true });
    else if (b[key].enabled) {
      const info = await probe(b[key].path, signal);
      const image = IMAGE.test(b[key].path);
      parts.push({
        key,
        path: b[key].path,
        image,
        audio: !image && info.audio && !b[key].muted,
        duration: Math.ceil((image ? b[key].duration : info.duration) * fps) / fps,
      });
    }
  }
  const total = parts.reduce((sum, part) => sum + part.duration, 0);
  const args = ['-hide_banner', '-v', 'error', '-y', '-filter_complex_threads', '1'];
  for (const part of parts) {
    if (part.image) args.push('-loop', '1', '-framerate', String(fps));
    args.push('-i', part.path);
  }
  let filter = '';
  for (const [i, part] of parts.entries()) {
    filter +=
      '[' +
      i +
      ':v]scale=' +
      W +
      ':' +
      H +
      ':force_original_aspect_ratio=decrease,' +
      'pad=' +
      W +
      ':' +
      H +
      ':(ow-iw)/2:(oh-ih)/2:color=' +
      background +
      ',setsar=1,fps=' +
      fps +
      ',tpad=stop_mode=clone:stop_duration=' +
      part.duration +
      ',trim=duration=' +
      part.duration +
      ',setpts=PTS-STARTPTS,format=yuv420p[v' +
      i +
      '];';
    filter += part.audio
      ? '[' + i + ':a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,'
      : 'anullsrc=r=48000:cl=stereo,';
    filter += 'atrim=duration=' + part.duration + ',asetpts=PTS-STARTPTS[a' + i + '];';
  }
  filter +=
    parts.map((_, i) => '[v' + i + '][a' + i + ']').join('') +
    'concat=n=' +
    parts.length +
    ':v=1:a=1[assembled][audio];';
  if (b.watermark.enabled) {
    const file = path.join(dir, 'assets', 'watermark.png');
    await watermarkPng(b.watermark, plan.canvas, file);
    args.push('-loop', '1', '-framerate', String(fps), '-i', file);
    filter += '[assembled][' + parts.length + ':v]overlay=0:0:shortest=1[video]';
  } else filter += '[assembled]null[video]';

  const lead = parts[0].key === 'intro' ? parts[0].duration : 0;
  const contentDuration = plan.total_duration;
  const chapters = plan.chapters_timed.map((chapter) => ({
    ...chapter,
    start: chapter.start + lead,
    end: chapter.end + lead,
  }));
  if (lead) chapters.unshift({ title: '片头广告', start: 0, end: lead, kind: 'advertisement' });
  if (b.outro.enabled)
    chapters.push({
      title: '片尾广告',
      start: lead + contentDuration,
      end: total,
      kind: 'advertisement',
    });
  const meta = path.join(dir, 'branding.ffmeta');
  await fs.writeFile(
    meta,
    ';FFMETADATA1\ntitle=' +
      plan.title.replace(/[=;\n#\\]/g, ' ') +
      '\n' +
      chapters
        .map(
          (chapter) =>
            '[CHAPTER]\nTIMEBASE=1/1000\nSTART=' +
            Math.round(chapter.start * 1000) +
            '\nEND=' +
            Math.round(chapter.end * 1000) +
            '\ntitle=' +
            chapter.title.replace(/[=;\n#\\]/g, ' ') +
            '\n',
        )
        .join(''),
  );
  const metaIndex = parts.length + Number(b.watermark.enabled);
  args.push(
    '-f',
    'ffmetadata',
    '-i',
    meta,
    '-filter_complex',
    filter,
    '-map',
    '[video]',
    '-map',
    '[audio]',
    '-map_metadata',
    String(metaIndex),
    '-map_chapters',
    String(metaIndex),
    '-t',
    String(total),
    '-r',
    String(fps),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '18',
    '-preset',
    'fast',
    '-threads',
    '4',
    '-video_track_timescale',
    '15360',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
  );
  const branded = path.join(dir, 'branded.mp4');
  args.push(branded);
  await run(FFMPEG, args, {
    signal,
    duration: total,
    onProgress: (r) => progress?.(r, '合成片头、片尾与全程水印'),
  });
  await run(FFMPEG, ['-hide_banner', '-v', 'error', '-i', branded, '-f', 'null', '-'], { signal });
  const info = await probe(branded, signal);
  if (Math.abs(info.duration - total) > 0.15) throw Error('广告合成时长验证失败');
  const subtitles = await fs.readFile(path.join(dir, 'subtitles.srt'), 'utf8');
  const { stamp } = require('./render.cjs');
  const shifted = subtitles.replace(
    /(\d{2}):(\d{2}):(\d{2}),(\d{3})(?= -->|\r?$)/gm,
    (_, h, m, s, ms) =>
      stamp(Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000 + lead),
  );
  await fs.writeFile(path.join(dir, 'subtitles.srt'), shifted);
  const narration = await fs.readFile(path.join(dir, 'narration.wav'));
  const track = Buffer.alloc(Math.round(total * 48000) * 2);
  narration.subarray(44).copy(track, Math.round(lead * 48000) * 2);
  await fs.writeFile(path.join(dir, 'narration.wav'), wav(track));
  for (const scene of plan.scenes) {
    scene.offset += lead;
    if (scene.audio_start != null) scene.audio_start += lead;
    if (scene.audio_end != null) scene.audio_end += lead;
  }
  plan.content_start = lead;
  plan.content_duration = contentDuration;
  plan.total_duration = total;
  plan.chapters_timed = chapters;
  plan.branding = branding;
  plan.advertisements = parts
    .filter((part) => part.key !== 'content')
    .map((part) => ({
      placement: part.key,
      start: part.key === 'intro' ? 0 : lead + contentDuration,
      duration: part.duration,
      name: branding[part.key].name || path.basename(part.path),
      audio: part.audio,
    }));
  await fs.rename(output, path.join(dir, 'content.mp4'));
  await fs.rename(branded, output);
  return {
    passed: true,
    contentStart: lead,
    contentDuration,
    duration: info.duration,
    advertisements: plan.advertisements,
    watermark: b.watermark.enabled,
  };
}

module.exports = {
  normalizeBranding,
  importBranding,
  brandingHash,
  verifyBranding,
  applyBranding,
  watermarkLayer,
  brandingPreview,
};
