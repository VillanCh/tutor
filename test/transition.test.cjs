const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { DEFAULTS } = require('../src/config.cjs');
const { normalizeTransition, resolveTransition } = require('../src/transition-options.mjs');
const { LAYOUT_PRESETS } = require('../src/layout-options.mjs');
const { EXPORT_ASPECTS } = require('../src/export-options.mjs');
const { frameLayout, framePreview } = require('../src/frame-layout.cjs');
const { transitionGeometry } = require('../src/transition.cjs');
const { brandingHash, importBranding, verifyBranding } = require('../src/branding.cjs');
const { normalizeScript, approve, requireApproval, scriptHash } = require('../src/script.cjs');
const { startServer } = require('../src/server.cjs');
const { TestAccount, confirmModels } = require('./helpers/account.cjs');
const { FFMPEG, run, probe, frame, wav } = require('../src/media.cjs');
const { render } = require('../src/render.cjs');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-transition-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const canvas = createCanvas(640, 360),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e52b25';
  ctx.fillRect(0, 0, 640, 360);
  ctx.fillStyle = '#1f4fe5';
  ctx.fillRect(160, 90, 320, 180);
  const image = path.join(dir, 'card.png');
  await fs.writeFile(image, canvas.toBuffer('image/png'));
  const source = path.join(dir, 'source.mp4');
  await run(FFMPEG, [
    '-v',
    'error',
    '-y',
    '-loop',
    '1',
    '-i',
    image,
    '-t',
    '1',
    '-r',
    '24',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    source,
  ]);
  return { dir, image, source, info: await probe(source) };
}

test('transition settings validate content and spacing, bind approval, and preserve approvals without an override', () => {
  for (const value of [
    null,
    [],
    { fontSize: '72' },
    { lineHeight: 0.5 },
    { margin: -1 },
    { align: 'justify' },
    { showChrome: 1 },
    { mode: 'image', path: 'x.svg' },
    { cards: [{ id: 'x', mode: 'image', heading: '', subtitle: '', path: '' }] },
  ])
    assert.throws(() => normalizeTransition(value));
  const base = brandingHash();
  assert.equal(brandingHash({ transition: { enabled: false } }), base);
  const p = { revision: 1, script: { title: '课程', chapters: ['章'], scenes: [] } };
  approve(p, scriptHash(p.script));
  requireApproval(p);
  p.branding = { transition: normalizeTransition({ lineHeight: 1.5 }) };
  assert.throws(() => requireApproval(p), /水印|品牌|广告|框架/);
  assert.notEqual(brandingHash(p.branding), base);
  const hash = brandingHash(p.branding);
  p.branding.transition.cards = [
    { id: 'title', mode: 'text', heading: '替换标题', subtitle: '替换副标题', path: '' },
  ];
  assert.notEqual(brandingHash(p.branding), hash);
});

test('the whole number/title/subtitle block is vertically centered and remains inside safe bounds at every canvas ratio', () => {
  const ctx = createCanvas(1, 1).getContext('2d');
  for (const aspect of EXPORT_ASPECTS.map((x) => x.id))
    for (const preset of [null, ...LAYOUT_PRESETS]) {
      const layout = frameLayout({ width: 1600, height: 900 }, DEFAULTS.style, {
        aspect,
        shortEdge: 720,
        ...(preset ? { layout: preset.value } : {}),
      });
      for (const heading of [
        '章节标题',
        '这是一个很长的章节标题，需要在不同画布上完整换行并保留居中的整体视觉关系。'.repeat(4),
      ]) {
        const scene = { id: 't', chapter: 0, heading },
          plan = { title: '课程名称与副标题' };
        const options = resolveTransition(
          normalizeTransition({
            fontSize: 100,
            letterSpacing: 3,
            lineHeight: 1.6,
            numberGap: 48,
            subtitleGap: 40,
          }),
          scene,
        );
        const g = transitionGeometry(ctx, layout, scene, plan, options);
        assert(Math.abs((g.top + g.bottom) / 2 - (g.box.y + g.box.height / 2)) < 1);
        assert(g.top >= g.box.y - 0.01 && g.bottom <= g.box.y + g.box.height + 0.01);
        for (const b of g.blocks)
          for (const line of b.positions)
            assert(line.x >= g.box.x - 0.01 && line.x + line.width <= g.box.x + g.box.width + 0.01);
        const offset = transitionGeometry(ctx, layout, scene, plan, {
          ...options,
          offsetY: 200,
          offsetX: -200,
          verticalAlign: 'bottom',
        });
        assert(offset.bottom <= offset.box.y + offset.box.height + 0.01);
      }
    }
});

test('uploaded transition presets survive restart and project assets survive deletion of the original and preset', async (t) => {
  const f = await fixture(t),
    root = path.join(f.dir, 'projects');
  let studio = await startServer({ dataDir: root, account: new TestAccount() });
  t.after(() => studio.close());
  await confirmModels(studio.store);
  const post = async (route, data) => {
    const response = await fetch(studio.url + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tutor-Token': studio.token },
      body: JSON.stringify(data),
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  const response = await fetch(studio.url + '/api/uploads/frame-background?name=transition.png', {
    method: 'POST',
    headers: { 'X-Tutor-Token': studio.token },
    body: await fs.readFile(f.image),
  });
  const uploaded = await response.json();
  assert.equal(response.status, 200);
  const template = await post('/api/transition-templates', {
    name: '品牌居中过场',
    transition: { background: 'custom', path: uploaded.path, fontSize: 88, numberGap: 40 },
  });
  const p = await studio.store.create(f.source, '', '课程');
  await studio.engine.saveScript(p.id, {
    title: '课程',
    chapters: ['章节'],
    scenes: [{ id: 't', kind: 'title', chapter: 0, heading: '章节', min_view_seconds: 0.5 }],
  });
  await studio.engine.confirm(p.id, scriptHash(p.script));
  const before = JSON.stringify(p);
  const preview = await post('/api/branding/preview', {
    projectId: p.id,
    kind: 'title',
    transition: template.transition,
  });
  assert(preview.image.startsWith('data:image/png;base64,'));
  assert.equal(JSON.stringify(p), before);
  await studio.engine.saveBranding(p.id, { transition: template.transition }, p.revision);
  assert.equal(p.approval, null);
  await fs.rm(uploaded.path);
  await fs.rm(f.image);
  await post('/api/transition-templates', { action: 'delete', id: template.id });
  await verifyBranding(p.branding);
  const saved = await post('/api/transition-templates', {
    name: '重启保留',
    transition: p.branding.transition,
  });
  await studio.close();
  studio = await startServer({ dataDir: root, account: new TestAccount() });
  const list = await (await fetch(studio.url + '/api/transition-templates')).json();
  assert.equal(list[0].id, saved.id);
  assert.equal(list[0].transition.fontSize, 88);
  const imported = await importBranding(
    {
      transition: {
        mode: 'text',
        cards: [{ id: 't', mode: 'image', path: saved.transition.path, heading: '', subtitle: '' }],
      },
    },
    path.join(f.dir, 'copy'),
  );
  await verifyBranding(imported);
  await fs.writeFile(imported.transition.cards[0].path, 'changed');
  await assert.rejects(verifyBranding(imported), /过场图片文件已变更/);
});

test('per-chapter text and full-image replacements use the same preview and actual render, preserve SRT, and hide all system chrome on images', async (t) => {
  const f = await fixture(t);
  const script = normalizeScript(
    {
      title: '课程',
      chapters: ['第一章', '第二章'],
      scenes: [
        {
          id: 't1',
          kind: 'title',
          chapter: 0,
          heading: '原始标题',
          narration: '图片过场的旁白仍保留字幕文件。',
          min_view_seconds: 1,
        },
        { id: 'a', kind: 'action', chapter: 0, heading: '正文', source_start: 0, source_end: 0.5 },
        { id: 't2', kind: 'title', chapter: 1, heading: '第二章标题', min_view_seconds: 0.5 },
      ],
    },
    f.info.duration,
  );
  const branding = await importBranding(
    {
      transition: {
        background: 'custom',
        path: f.image,
        blur: 20,
        showChrome: false,
        cards: [
          { id: 't1', mode: 'image', path: f.image, heading: '', subtitle: '' },
          {
            id: 't2',
            mode: 'text',
            path: '',
            heading: '替换后的章节标题',
            subtitle: '可替换副标题',
          },
        ],
      },
    },
    path.join(f.dir, 'project'),
  );
  const frameOptions = { aspect: '16:9', shortEdge: 720 };
  const preview = await framePreview({
    info: f.info,
    style: DEFAULTS.style,
    exportOptions: frameOptions,
    frame: { preset: 'mist' },
    transition: branding.transition,
    scene: script.scenes[0],
    script,
    title: true,
  });
  const picture = await loadImage(Buffer.from(preview.image.split(',')[1], 'base64'));
  const c = createCanvas(picture.width, picture.height);
  c.getContext('2d').drawImage(picture, 0, 0);
  assert(c.getContext('2d').getImageData(4, 4, 1, 1).data[0] > 200);
  const pcm = Buffer.alloc(48000 * 2 * 0.5),
    voice = path.join(f.dir, 'voice.wav');
  await fs.writeFile(voice, wav(pcm));
  const result = await render({
    source: f.source,
    info: f.info,
    script,
    branding,
    exportOptions: frameOptions,
    config: { ...DEFAULTS, style: { ...DEFAULTS.style, fps: 24 } },
    audio: [{ file: voice, pcm, duration: 0.5 }, null, null],
    dir: path.join(f.dir, 'output'),
  });
  assert.equal(result.plan.scenes[0].transitionChrome, false);
  assert.equal(result.plan.scenes[1].transitionChrome, true);
  const decoded = path.join(f.dir, 'decoded.png');
  await frame(result.output, 0.3, decoded);
  const image = await loadImage(decoded),
    encoded = createCanvas(image.width, image.height),
    ctx = encoded.getContext('2d');
  ctx.drawImage(image, 0, 0);
  for (const [x, y] of [
    [5, 5],
    [image.width - 10, 5],
    [5, image.height - 10],
    [image.width - 10, image.height - 10],
  ]) {
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    assert(pixel[0] > 190 && pixel[1] < 70 && pixel[2] < 70);
  }
  for (const y of [25, image.height - 25]) {
    const pixels = ctx.getImageData(0, y, image.width, 1).data;
    for (let i = 0; i < pixels.length; i += 4)
      assert(pixels[i] > 190 && pixels[i + 1] < 70 && pixels[i + 2] < 70);
  }
  assert(
    (await fs.readFile(path.join(f.dir, 'output', 'subtitles.srt'), 'utf8')).includes(
      '图片过场的旁白',
    ),
  );
  const rendered = await loadImage(path.join(f.dir, 'output/assets/overlay-2.png'));
  assert(rendered.width > 0);
  const textPreview = await framePreview({
    info: f.info,
    style: DEFAULTS.style,
    exportOptions: frameOptions,
    frame: branding.frame,
    transition: branding.transition,
    scene: script.scenes[2],
    script,
    title: true,
  });
  assert.notEqual(textPreview.image, preview.image);
});
