const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const {
  normalizeBranding,
  importBranding,
  verifyBranding,
  applyBranding,
  watermarkLayer,
} = require('../src/branding.cjs');
const { brandingDefaults } = require('../src/branding-options.mjs');
const {
  normalizeScript,
  approve,
  requireApproval,
  scriptHash,
  schedule,
} = require('../src/script.cjs');
const { FFMPEG, FFPROBE, run, probe, pcm, wav } = require('../src/media.cjs');
const { DEFAULTS } = require('../src/config.cjs');
const { render } = require('../src/render.cjs');
const { startServer } = require('../src/server.cjs');
const { TestAccount } = require('./helpers/account.cjs');

test('advertising inputs validate active assets, dimensions and text; legacy approvals stay valid', () => {
  const b = brandingDefaults();
  assert.deepEqual(normalizeBranding(), b);
  const p = { revision: 1, script: { title: 't', chapters: ['c'], scenes: [] } };
  approve(p, scriptHash(p.script));
  delete p.approval.brandingHash;
  requireApproval(p);
  p.branding = { watermark: { enabled: true, text: '品牌 · example.com' } };
  assert.throws(() => requireApproval(p), /广告或水印已变更/);
  approve(p, scriptHash(p.script));
  requireApproval(p);
  p.branding.watermark.opacity = 80;
  assert.throws(() => requireApproval(p), /广告或水印已变更/);
  for (const value of [
    { intro: { enabled: true } },
    { outro: { enabled: true, path: 'x.png', duration: 0 } },
    { intro: { enabled: true, path: 'x.txt' } },
    { watermark: { enabled: true, text: '' } },
    { watermark: { enabled: true, text: 'a'.repeat(121) } },
    { watermark: { enabled: true, type: 'image', path: 'x.svg' } },
    { watermark: { position: 'center' } },
    { watermark: { width: 90 } },
    { watermark: { opacity: NaN } },
    { watermark: { layout: 'stretch' } },
    { watermark: { angle: 90 } },
    { watermark: { angle: '30' } },
    { watermark: { density: 'unlimited' } },
    { watermark: { tone: 'red' } },
    { watermark: { protectSubtitles: 1 } },
  ])
    assert.throws(() => normalizeBranding(value));
});

test('new watermarks use a restrained tiled preset while existing corner settings keep their appearance', () => {
  assert.equal(brandingDefaults().watermark.layout, 'tiled');
  assert.equal(brandingDefaults().watermark.opacity, 8);
  assert.equal(brandingDefaults().watermark.width, 14);
  assert.equal(brandingDefaults().watermark.density, 'relaxed');
  const legacy = normalizeBranding({ watermark: { enabled: true, text: 'Old brand' } });
  assert.equal(legacy.watermark.layout, 'corner');
  assert.equal(legacy.watermark.opacity, 65);
  assert.equal(legacy.watermark.width, 18);
});

test('full-screen tiling distributes translucent text and Logos, respects density and protects subtitles', async () => {
  const canvas = {
    width: 800,
    height: 592,
    video_x: 16,
    video_y: 52,
    video_width: 768,
    video_height: 432,
  };
  const value = {
    enabled: true,
    layout: 'tiled',
    text: 'YAKCOOL · 实操课堂',
    opacity: 18,
    width: 22,
    tone: 'dark',
  };
  const measure = (layer) => {
    const data = layer.getContext('2d').getImageData(0, 0, 800, 592).data;
    const result = { maxAlpha: 0, left: 0, right: 0, top: 0, lower: 0, footer: 0, count: 0 };
    for (let y = 0; y < 592; y++)
      for (let x = 0; x < 800; x++) {
        const alpha = data[(y * 800 + x) * 4 + 3];
        if (!alpha) continue;
        result.maxAlpha = Math.max(result.maxAlpha, alpha);
        result.count++;
        if (x < 200) result.left++;
        if (x > 600) result.right++;
        if (y < 150) result.top++;
        if (y > 350 && y < 484) result.lower++;
        if (y >= 484) result.footer++;
      }
    return result;
  };
  const draw = (change) =>
    watermarkLayer(normalizeBranding({ watermark: { ...value, ...change } }).watermark, canvas);
  const balanced = measure(await draw({}));
  for (const region of ['left', 'right', 'top', 'lower'])
    assert(balanced[region] > 20, 'pattern covers the ' + region + ' region');
  assert(
    balanced.maxAlpha >= 45 && balanced.maxAlpha <= 47,
    '18% opacity applies to the complete watermark layer',
  );
  assert.equal(balanced.footer, 0, 'protected subtitles are entirely clear');
  const dense = measure(await draw({ density: 'dense' }));
  const relaxed = measure(await draw({ density: 'relaxed' }));
  assert(dense.count > relaxed.count * 1.3, 'density changes how often the brand repeats');
  assert(
    measure(await draw({ protectSubtitles: false })).footer > 20,
    'full-frame mode can include the subtitle band',
  );
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-tiled-logo-'));
  const logo = path.join(dir, 'logo.png');
  await image(logo, '#ac7bea', 120, 40);
  const logoMeasure = measure(await draw({ type: 'image', path: logo, angle: 35, opacity: 12 }));
  assert(logoMeasure.left > 20 && logoMeasure.right > 20 && logoMeasure.lower > 20);
  assert(logoMeasure.maxAlpha >= 30 && logoMeasure.maxAlpha <= 32);
  assert.equal(logoMeasure.footer, 0);
});

async function image(file, color, width = 320, height = 180) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  await fs.writeFile(file, canvas.toBuffer('image/png'));
}

test('HTTP advertising saves keep old output, invalidate approval and survive a restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-branding-api-'));
  const account = new TestAccount();
  const server = await startServer({ dataDir: path.join(dir, 'projects'), account });
  try {
    const poster = path.join(dir, '品牌海报.png');
    await image(poster, 'green');
    const id = '11111111-1111-1111-1111-111111111111';
    const p = {
      id,
      revision: 2,
      script: { title: 'test', chapters: ['c'], scenes: [] },
      source: 'source.mp4',
      info: { duration: 2 },
      job: null,
      status: 'review',
      progress: {},
      sources: [{ id: 'v01', hash: 'source', path: 'source.mp4', info: { duration: 2 } }],
      output: { revision: 1, path: 'historic.mp4' },
    };
    server.store.projects.set(id, p);
    approve(p, scriptHash(p.script));
    const save = (branding, revision = p.revision) =>
      fetch(server.url + '/api/projects/' + id + '/branding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tutor-Token': server.token },
        body: JSON.stringify({ branding, revision }),
      });
    const response = await save({ intro: { enabled: true, path: poster, duration: 3 } });
    assert.equal(response.status, 200);
    assert.equal(p.revision, 3);
    assert.equal(p.approval, null);
    assert.equal(p.output.path, 'historic.mp4');
    assert.notEqual(p.branding.intro.path, poster);
    const approveVersion = (extra) =>
      fetch(server.url + '/api/projects/' + id + '/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tutor-Token': server.token },
        body: JSON.stringify({ hash: scriptHash(p.script), ...extra }),
      });
    assert.equal(
      (await approveVersion({})).status,
      400,
      'advertising must be included in the approval',
    );
    assert.equal(
      (await approveVersion({ revision: 2, brandingHash: server.store.public(p).brandingHash }))
        .status,
      400,
    );
    assert.equal((await approveVersion({ revision: 3, brandingHash: 'stale' })).status, 400);
    assert.equal(
      (await approveVersion({ revision: 3, brandingHash: server.store.public(p).brandingHash }))
        .status,
      200,
    );
    const preview = await fetch(server.url + '/api/branding/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tutor-Token': server.token },
      body: JSON.stringify({
        watermark: { enabled: true, layout: 'tiled', text: 'YAKCOOL', opacity: 12 },
      }),
    });
    assert.equal(preview.status, 200);
    assert.match((await preview.json()).image, /^data:image\/png;base64,/);
    assert.equal(p.revision, 3, 'preview never writes settings or revokes approval');
    assert(p.approval);
    await fs.writeFile(poster, 'external file changed');
    await verifyBranding(p.branding);
    const { Store } = require('../src/store.cjs');
    const restored = new Store(server.store.root, account);
    await restored.init();
    assert.equal(restored.get(id).branding.intro.hash, p.branding.intro.hash);
    assert.equal((await save({}, 1)).status, 400);
    const before = structuredClone(p.branding);
    p.job = { id: 'busy' };
    assert.equal((await save({})).status, 400);
    assert.deepEqual(p.branding, before);
    p.job = null;
    account.authenticated = false;
    assert.equal((await save({})).status, 401);
    account.authenticated = true;
    await fs.writeFile(p.branding.intro.path, 'imported asset tampered');
    await assert.rejects(verifyBranding(p.branding), /文件已变更/);
  } finally {
    server.close();
  }
});

test(
  'real export concatenates ads, preserves their audio and overlays a Logo on all three parts',
  { timeout: 120000 },
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-branding-render-'));
    const source = path.join(dir, '正文.mp4');
    const outro = path.join(dir, '片尾广告.mp4');
    const intro = path.join(dir, '片头广告.png');
    const logo = path.join(dir, '水印.png');
    await image(intro, '#00ff00');
    await image(logo, '#ff00ff', 100, 50);
    await run(FFMPEG, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=320x180:r=10:d=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      source,
    ]);
    await run(FFMPEG, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=yellow:s=180x320:r=12:d=0.8',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=880:sample_rate=44100:duration=0.8',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      outro,
    ]);
    const branding = await importBranding(
      {
        intro: { enabled: true, path: intro, duration: 1 },
        outro: { enabled: true, path: outro },
        watermark: { enabled: true, type: 'image', path: logo, width: 25, opacity: 100 },
      },
      dir,
    );
    const script = normalizeScript(
      {
        title: '广告与水印实测',
        chapters: ['正文'],
        scenes: [0, 1].map((i) => ({
          id: 's' + i,
          kind: 'action',
          chapter: 0,
          heading: '正文',
          source_start: i * 0.5,
          source_end: i * 0.5 + 0.5,
          hold_at: i * 0.5 + 0.3,
          narration: '测试旁白。',
          min_view_seconds: 0.6,
          silent_tail_seconds: 0.7,
        })),
      },
      2,
    );
    const data = Buffer.alloc(96000 * 0.2);
    for (let i = 0; i < data.length / 2; i++)
      data.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 220) / 48000) * 3000), i * 2);
    const voice = path.join(dir, 'voice.wav');
    await fs.writeFile(voice, wav(data));
    const audio = [0, 1].map(() => ({ file: voice, pcm: data, duration: 0.2 }));
    const config = structuredClone(DEFAULTS);
    Object.assign(config.style, { width: 640, fps: 10 });
    const result = await render({
      source,
      info: await probe(source),
      script,
      audio,
      config,
      branding,
      dir,
    });
    assert.equal(result.verification.passed, true);
    assert.equal(result.verification.branding.passed, true);
    assert.equal(result.plan.content_start, 1);
    assert.equal(result.plan.scenes[0].offset, 1);
    assert.equal(result.plan.chapters_timed[0].title, '片头广告');
    assert.equal(result.plan.chapters_timed.at(-1).title, '片尾广告');
    assert(Math.abs(result.verification.duration - result.plan.total_duration) < 0.15);
    const srt = await fs.readFile(path.join(dir, 'subtitles.srt'), 'utf8');
    assert.match(srt, /00:00:01,250 --> 00:00:01,450/);
    const pixel = async (time, x, y) =>
      (
        await run(FFMPEG, [
          '-v',
          'error',
          '-ss',
          String(time),
          '-i',
          result.output,
          '-frames:v',
          '1',
          '-vf',
          `format=rgb24,crop=1:1:${x}:${y}`,
          '-f',
          'rawvideo',
          '-pix_fmt',
          'rgb24',
          '-',
        ])
      ).stdout;
    const times = [0.5, 1.5, result.plan.content_start + result.plan.content_duration + 0.3];
    const expected = [
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
    ];
    for (const [i, time] of times.entries()) {
      const center = await pixel(time, 320, 220);
      for (let c = 0; c < 3; c++)
        assert(Math.abs(center[c] - expected[i][c]) < 25, 'correct ad/body order at ' + time);
      const mark = await pixel(time, 480, 84);
      assert(
        mark[0] > 220 && mark[1] < 35 && mark[2] > 220,
        'Logo visible on every part at ' + time,
      );
    }
    const padding = await pixel(0.5, 3, 3);
    const background = config.style.background
      .slice(1)
      .match(/../g)
      .map((part) => parseInt(part, 16));
    for (let i = 0; i < 3; i++)
      assert(
        Math.abs(padding[i] - background[i]) < 8,
        'advertising padding follows the tutorial background',
      );
    const decoded = await pcm(result.output);
    const energy = (start, end) => {
      let sum = 0,
        count = 0;
      for (let i = Math.round(start * 48000); i < Math.round(end * 48000); i++) {
        sum += (decoded.readInt16LE(i * 2) / 32768) ** 2;
        count++;
      }
      return Math.sqrt(sum / count);
    };
    assert(energy(0.2, 0.5) < 0.001, 'static intro is silent');
    assert(
      energy(times[2], times[2] + 0.1) > 0.02,
      'outro original audio is retained and resampled',
    );
    const { stdout } = await run(FFPROBE, [
      '-v',
      'error',
      '-show_chapters',
      '-of',
      'json',
      result.output,
    ]);
    assert.equal(JSON.parse(stdout).chapters[0].tags.title, '片头广告');

    // Exercise text-only watermarking and muted video ads without rerunning AI or the tutorial render.
    const textDir = path.join(dir, 'text');
    await fs.mkdir(path.join(textDir, 'assets'), { recursive: true });
    const textOutput = path.join(textDir, 'tutorial.mp4');
    await fs.copyFile(path.join(dir, 'content.mp4'), textOutput);
    await fs.writeFile(path.join(textDir, 'subtitles.srt'), '');
    const plainPlan = schedule(script, [0.2, 0.2], config.style);
    plainPlan.canvas = result.plan.canvas;
    await fs.writeFile(
      path.join(textDir, 'narration.wav'),
      wav(Buffer.alloc(Math.round(plainPlan.total_duration * 96000))),
    );
    const textCheck = await applyBranding({
      branding: {
        intro: { enabled: true, path: branding.outro.path, muted: true },
        watermark: {
          enabled: true,
          text: '品牌 · example.com',
          position: 'bottom-left',
          opacity: 50,
          layout: 'tiled',
          tone: 'dark',
        },
      },
      plan: plainPlan,
      output: textOutput,
      dir: textDir,
      fps: 10,
    });
    assert.equal(textCheck.advertisements[0].audio, false);
    const textPng = await loadImage(path.join(textDir, 'assets', 'watermark.png'));
    const textCanvas = createCanvas(textPng.width, textPng.height);
    const ctx = textCanvas.getContext('2d');
    ctx.drawImage(textPng, 0, 0);
    const rgba = ctx.getImageData(0, 0, textPng.width, textPng.height).data;
    let maxAlpha = 0,
      lastVisibleRow = 0;
    for (let i = 3; i < rgba.length; i += 4)
      if (rgba[i]) {
        maxAlpha = Math.max(maxAlpha, rgba[i]);
        lastVisibleRow = Math.floor(i / 4 / textPng.width);
      }
    assert(maxAlpha > 100 && maxAlpha <= 130, 'text opacity is applied');
    assert(
      lastVisibleRow < result.plan.canvas.video_y + result.plan.canvas.video_height,
      'text avoids subtitles',
    );
    const muted = await pcm(textOutput);
    assert(
      muted.subarray(4800 * 2, 14400 * 2).every((byte) => byte === 0),
      'muted video ad has no audio',
    );
  },
);
