const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { DEFAULTS } = require('../src/config.cjs');
const {
  normalizeBranding,
  importBranding,
  verifyBranding,
  brandingHash,
} = require('../src/branding.cjs');
const { FRAME_PRESETS } = require('../src/branding-options.mjs');
const { frameLayout, framePreview } = require('../src/frame-layout.cjs');
const { prepareFrameBackground, luminance, ratio } = require('../src/frame-background.cjs');
const { startServer } = require('../src/server.cjs');
const { TestAccount } = require('./helpers/account.cjs');
const { FFMPEG, run, probe, frame } = require('../src/media.cjs');
const { render } = require('../src/render.cjs');
const { normalizeScript, scriptHash } = require('../src/script.cjs');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-frame-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const canvas = createCanvas(640, 480),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 640, 240);
  ctx.fillStyle = '#080c13';
  ctx.fillRect(0, 240, 640, 240);
  const image = path.join(dir, 'split.png');
  await fs.writeFile(image, canvas.toBuffer('image/png'));
  return { dir, image };
}

test('frame options validate assets, blur and contrast; default frame preserves existing branding hashes', () => {
  assert.equal(normalizeBranding().frame.blur, 24);
  for (const frame of [
    { preset: 'invalid' },
    { blur: -1 },
    { blur: 61 },
    { blur: '24' },
    { contrast: 'red' },
    { dim: 71 },
    { dim: '18' },
    { saturation: -1 },
    { saturation: 101 },
    { enabled: 'yes' },
    { preset: 'custom', path: 'x.svg' },
    { preset: 'custom', path: '' },
  ])
    assert.throws(() => normalizeBranding({ frame }));
  const old = normalizeBranding();
  delete old.frame;
  const previousHash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify(Object.fromEntries(Object.keys(old).map((key) => [key, { enabled: false }]))),
    )
    .digest('hex');
  assert.equal(brandingHash(), previousHash);
  assert.notEqual(brandingHash({ frame: { preset: 'mist' } }), previousHash);
});

test('light, dark and split backgrounds choose readable colors independently; blur changes only the backdrop', async (t) => {
  const { image } = await fixture(t),
    layout = frameLayout({ width: 640, height: 360 }, DEFAULTS.style);
  for (const preset of Object.keys(FRAME_PRESETS).filter((p) => p !== 'custom')) {
    const result = await prepareFrameBackground(layout, DEFAULTS.style, { preset });
    assert(result.top.contrast >= 4.5);
    assert(result.bottom.contrast >= 4.5);
    assert.equal(result.top.light, ['midnight', 'ember'].includes(preset));
  }
  const result = await prepareFrameBackground(layout, DEFAULTS.style, {
    preset: 'custom',
    path: image,
    blur: 0,
  });
  assert.equal(result.top.light, false);
  assert.equal(result.bottom.light, true);
  for (const mode of ['auto', 'dark', 'light']) {
    const c = createCanvas(640, 480),
      ctx = c.getContext('2d');
    for (let x = 0; x < 640; x += 32) {
      ctx.fillStyle = x % 64 ? '#000' : '#fff';
      ctx.fillRect(x, 0, 32, 480);
    }
    const busy = image.replace('split', 'busy');
    await fs.writeFile(busy, c.toBuffer('image/png'));
    const prepared = await prepareFrameBackground(layout, DEFAULTS.style, {
      preset: 'custom',
      path: busy,
      blur: 0,
      contrast: mode,
    });
    assert(prepared.top.contrast >= 4.5);
    assert(prepared.bottom.contrast >= 4.5);
    const pixels = prepared.content
      .getContext('2d')
      .getImageData(0, 0, layout.width, layout.video_y).data;
    const ink = prepared.top.light ? 1 : luminance(18, 24, 32);
    for (let i = 0; i < pixels.length; i += 4 * 19)
      assert(ratio(ink, luminance(pixels[i], pixels[i + 1], pixels[i + 2])) >= 4.4);
    const blurred = await prepareFrameBackground(layout, DEFAULTS.style, {
      preset: 'custom',
      path: busy,
      blur: 40,
    });
    assert.notDeepEqual(
      blurred.content.toBuffer('image/png'),
      prepared.content.toBuffer('image/png'),
    );
  }
});

test('ordinary PNG, JPEG and WebP uploads retain focus parameters in reusable presets after restart', async (t) => {
  const { dir } = await fixture(t),
    dataDir = path.join(dir, 'presets');
  let studio = await startServer({ dataDir, account: new TestAccount() });
  t.after(() => studio.close());
  const image = createCanvas(500, 800),
    ctx = image.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 500, 800);
  gradient.addColorStop(0, '#ff0022');
  gradient.addColorStop(0.5, '#00ff88');
  gradient.addColorStop(1, '#0055ff');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 500, 800);
  const frames = [];
  for (const [extension, mime] of [
    ['png', 'image/png'],
    ['jpg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ]) {
    const response = await fetch(
      studio.url + '/api/uploads/frame-background?name=ordinary.' + extension,
      {
        method: 'POST',
        headers: { 'X-Tutor-Token': studio.token },
        body: image.toBuffer(mime),
      },
    );
    assert.equal(response.status, 200);
    const asset = await response.json();
    const frame = {
      enabled: true,
      preset: 'custom',
      path: asset.path,
      blur: 40,
      dim: 30,
      saturation: 40,
      contrast: 'auto',
    };
    const saved = await fetch(studio.url + '/api/frame-templates', {
      method: 'POST',
      headers: { 'X-Tutor-Token': studio.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: extension + ' 自定义预设', frame }),
    });
    assert.equal(saved.status, 200);
    frames.push((await saved.json()).frame);
    const layout = frameLayout({ width: 1280, height: 720 }, DEFAULTS.style);
    const original = await prepareFrameBackground(layout, DEFAULTS.style, {
      ...frame,
      blur: 0,
      dim: 0,
      saturation: 100,
    });
    const softened = await prepareFrameBackground(layout, DEFAULTS.style, frame);
    const pixel = (canvas) =>
      [...canvas.getContext('2d').getImageData(200, 300, 1, 1).data].slice(0, 3);
    const a = pixel(original.content),
      b = pixel(softened.content);
    assert(luminance(...b) < luminance(...a), 'background dimming reduces visual intensity');
    assert(
      Math.max(...b) - Math.min(...b) < Math.max(...a) - Math.min(...a),
      'desaturation reduces color distraction',
    );
    await fs.rm(asset.path);
  }
  studio.close();
  studio = await startServer({ dataDir, account: new TestAccount() });
  const presets = await (await fetch(studio.url + '/api/frame-templates')).json();
  assert.equal(presets.length, 3);
  for (const preset of presets) {
    assert.equal(preset.frame.blur, 40);
    assert.equal(preset.frame.dim, 30);
    assert.equal(preset.frame.saturation, 40);
    await verifyBranding({ frame: preset.frame });
  }
});

test('background uploads, template reuse and project copies persist, revoke approval and detect tampering', async (t) => {
  const { dir, image } = await fixture(t),
    root = path.join(dir, 'projects');
  let studio = await startServer({ dataDir: root, account: new TestAccount() });
  t.after(() => studio.close());
  const headers = { 'X-Tutor-Token': studio.token, 'Content-Type': 'application/json' };
  const post = async (url, data) => {
    const res = await fetch(studio.url + url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
    return { status: res.status, body: await res.json() };
  };
  const upload = await fetch(studio.url + '/api/uploads/frame-background?name=brand.png', {
    method: 'POST',
    headers: { 'X-Tutor-Token': studio.token },
    body: await fs.readFile(image),
  });
  assert.equal(upload.status, 200);
  const uploaded = await upload.json();
  const saved = await post('/api/frame-templates', {
    name: '上亮下暗',
    frame: { preset: 'custom', path: uploaded.path },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.frame.blur, 24);
  assert.equal(saved.body.frame.name, '上亮下暗');
  await fs.rm(uploaded.path);
  const libraryFrame = saved.body.frame;
  const source = path.join(dir, 'source.mp4');
  await run(FFMPEG, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=640x360:r=24:d=1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    source,
  ]);
  const p = await studio.store.create(source, '', '模板验证');
  await studio.engine.saveScript(p.id, {
    title: '模板验证',
    chapters: ['核对'],
    scenes: [
      {
        id: 'a',
        kind: 'action',
        chapter: 0,
        heading: '观察画面',
        source_start: 0,
        source_end: 0.5,
      },
    ],
  });
  await studio.engine.confirm(p.id, scriptHash(p.script));
  const previousRevision = p.revision;
  const applied = await post('/api/projects/' + p.id + '/branding', {
    revision: previousRevision,
    branding: { frame: libraryFrame },
  });
  assert.equal(applied.status, 200);
  assert.equal(p.approval, null);
  assert.notEqual(p.branding.frame.path, libraryFrame.path);
  assert.equal(p.branding.frame.name, '上亮下暗');
  assert.equal(
    (
      await post('/api/projects/' + p.id + '/branding', {
        revision: previousRevision,
        branding: {},
      })
    ).status,
    400,
  );
  assert.equal(
    (await post('/api/frame-templates', { action: 'delete', id: saved.body.id })).status,
    200,
  );
  await verifyBranding(p.branding);
  const preview = await post('/api/export/preview', {
    projectId: p.id,
    kind: 'content',
    exportOptions: { aspect: '9:16' },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.canvas.height, 1920);
  const current = structuredClone(p.branding);
  studio.close();
  studio = await startServer({ dataDir: root, account: new TestAccount() });
  assert.deepEqual(studio.store.get(p.id).branding, current);
  await fs.writeFile(current.frame.path, 'changed');
  await assert.rejects(verifyBranding(current), /框架背景文件已变更/);
  const invalidUpload = await fetch(studio.url + '/api/uploads/frame-background?name=broken.png', {
    method: 'POST',
    headers: { 'X-Tutor-Token': studio.token },
    body: 'invalid image',
  });
  assert.equal(invalidUpload.status, 400);
});

test(
  'real original-layout and portrait renders retain the image background through subtitles and clocks',
  { timeout: 60000 },
  async (t) => {
    const { dir, image } = await fixture(t),
      source = path.join(dir, 'source.mp4');
    await run(FFMPEG, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=640x360:r=24:d=1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      source,
    ]);
    const info = await probe(source),
      branding = await importBranding({ frame: { preset: 'custom', path: image } }, dir);
    const script = normalizeScript(
      {
        title: '自定义框架',
        chapters: ['核对背景'],
        scenes: [
          {
            id: 'title',
            kind: 'title',
            chapter: 0,
            heading: '上下区域自动配色',
            min_view_seconds: 0.6,
          },
          {
            id: 'a',
            kind: 'action',
            chapter: 0,
            heading: '录屏保持清晰',
            source_start: 0,
            source_end: 0.6,
            min_view_seconds: 0.6,
          },
        ],
      },
      info.duration,
    );
    for (const aspect of ['auto', '9:16']) {
      const outputDir = path.join(dir, aspect.replace(':', '-'));
      await fs.mkdir(outputDir);
      const result = await render({
        source,
        info,
        script,
        branding,
        audio: [null, null],
        exportOptions: { aspect, shortEdge: 720 },
        config: { ...DEFAULTS, style: { ...DEFAULTS.style, width: 800, fps: 24 } },
        dir: outputDir,
      });
      assert.equal(result.verification.passed, true);
      const output = path.join(outputDir, 'decoded.png');
      await frame(result.output, result.plan.scenes[1].offset + 0.3, output);
      const decoded = await loadImage(output),
        c = createCanvas(decoded.width, decoded.height),
        ctx = c.getContext('2d');
      ctx.drawImage(decoded, 0, 0);
      const top = ctx.getImageData(decoded.width - 4, 5, 1, 1).data;
      const bottom = ctx.getImageData(decoded.width - 4, decoded.height - 25, 1, 1).data;
      assert(
        top[0] > 180 && bottom[0] < 40,
        'encoded background keeps separate light and dark regions',
      );
      const preview = await framePreview({
        info,
        style: { ...DEFAULTS.style, width: 800 },
        exportOptions: { aspect, shortEdge: 720 },
        frame: branding.frame,
      });
      assert.equal(preview.contrast.top.light, false);
      assert.equal(preview.contrast.bottom.light, true);
    }
  },
);
