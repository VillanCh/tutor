const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { DEFAULTS } = require('../src/config.cjs');
const { normalizeHeader, normalizeSurfaces } = require('../src/header-options.mjs');
const {
  prepareHeaderStyle,
  headerGeometry,
  paintProjectHeader,
  headerTimerAllowed,
  footerLabelsAllowed,
} = require('../src/header-brand.cjs');
const { frameLayout, framePreview, exportHash } = require('../src/frame-layout.cjs');
const { prepareFrameBackground } = require('../src/frame-background.cjs');
const { prepareTransition } = require('../src/transition.cjs');
const { EXPORT_ASPECTS } = require('../src/export-options.mjs');
const { LAYOUT_PRESETS } = require('../src/layout-options.mjs');
const {
  normalizeBranding,
  brandingHash,
  importBranding,
  verifyBranding,
} = require('../src/branding.cjs');
const { normalizeScript, scriptHash, approve, requireApproval } = require('../src/script.cjs');
const { startServer } = require('../src/server.cjs');
const { TestAccount, confirmModels } = require('./helpers/account.cjs');
const { FFMPEG, run, probe, frame, wav } = require('../src/media.cjs');
const { render } = require('../src/render.cjs');
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-header-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const c = createCanvas(640, 360),
    ctx = c.getContext('2d'),
    g = ctx.createLinearGradient(0, 0, 640, 360);
  g.addColorStop(0, '#da7648');
  g.addColorStop(1, '#233e75');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 640, 360);
  const background = path.join(dir, 'background.png');
  await fs.writeFile(background, c.toBuffer('image/png'));
  const logo = createCanvas(256, 128),
    lc = logo.getContext('2d');
  lc.fillStyle = '#f52424';
  lc.fillRect(64, 32, 128, 64);
  const image = path.join(dir, 'logo.png');
  await fs.writeFile(image, logo.toBuffer('image/png'));
  const source = path.join(dir, 'source.mp4');
  await run(FFMPEG, [
    '-v',
    'error',
    '-y',
    '-loop',
    '1',
    '-i',
    background,
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
  return { dir, image, background, source, info: await probe(source) };
}
test('optional header and surface settings preserve legacy approvals, validate inputs and bind all new controls to review', () => {
  for (const h of [
    null,
    [],
    { mode: 'custom' },
    { opacity: '25' },
    { logoHeight: 0 },
    { logoTone: 'invert' },
    { showName: 1 },
    { brandName: 'bad\nname' },
    { mode: 'logo', path: 'x.svg' },
  ])
    assert.throws(() => normalizeHeader(h));
  for (const s of [
    null,
    [],
    { headerOpacity: -1 },
    { footerOpacity: 101 },
    { headerMode: 'opaque' },
    { headerOpacity: '25' },
  ])
    assert.throws(() => normalizeSurfaces(s));
  const base = brandingHash();
  assert.equal(brandingHash({ header: { enabled: false } }), base);
  assert.equal(normalizeBranding().header, undefined);
  assert.equal(normalizeBranding().frame.surfaces, undefined);
  const p = { revision: 1, script: { title: '课程', chapters: ['一'], scenes: [] } };
  approve(p, scriptHash(p.script));
  requireApproval(p);
  p.branding = {
    header: normalizeHeader({ mode: 'brand', inheritBrand: false, brandName: 'ACME' }),
  };
  assert.throws(() => requireApproval(p));
  const hash = brandingHash(p.branding);
  p.branding.header.logoGap = 30;
  assert.notEqual(brandingHash(p.branding), hash);
  assert.notEqual(
    brandingHash({ frame: { surfaces: { headerMode: 'custom', headerOpacity: 25 } } }),
    base,
  );
});
test('header and footer opacity exactly blend the same background independently, including transition backgrounds', async (t) => {
  const f = await fixture(t),
    layout = frameLayout(f.info, DEFAULTS.style, { aspect: '16:9', shortEdge: 720 });
  const options = {
    preset: 'custom',
    path: f.background,
    blur: 0,
    dim: 0,
    saturation: 100,
    contrast: 'auto',
  };
  const raw = await prepareFrameBackground(layout, DEFAULTS.style, {
    ...options,
    surfaces: { headerMode: 'custom', headerOpacity: 0, footerMode: 'custom', footerOpacity: 0 },
  });
  const mixed = await prepareFrameBackground(layout, DEFAULTS.style, {
    ...options,
    surfaces: { headerMode: 'custom', headerOpacity: 25, footerMode: 'custom', footerOpacity: 65 },
  });
  assert.equal(raw.top.opacity, 0);
  assert.equal(raw.bottom.opacity, 0);
  assert.equal(mixed.top.opacity, 0.25);
  assert.equal(mixed.bottom.opacity, 0.65);
  for (const [region, y] of [
    ['top', 10],
    ['bottom', layout.height - 10],
  ])
    for (const x of [20, layout.width - 20]) {
      const a = raw.content.getContext('2d').getImageData(x, y, 1, 1).data,
        b = mixed.content.getContext('2d').getImageData(x, y, 1, 1).data,
        theme = mixed[region];
      for (let i = 0; i < 3; i++)
        assert(
          Math.abs(b[i] - (a[i] * (1 - theme.opacity) + (theme.light ? 0 : 255) * theme.opacity)) <=
            2,
        );
    }
  const own = await prepareTransition(
    layout,
    DEFAULTS.style,
    {
      ...options,
      surfaces: { headerMode: 'custom', headerOpacity: 0, footerMode: 'custom', footerOpacity: 0 },
    },
    { background: 'custom', path: f.background, blur: 0, dim: 0, saturation: 100 },
    { id: 't', chapter: 0, heading: '章节' },
  );
  assert.deepEqual(
    [...own.backgroundLayer.getContext('2d').getImageData(20, 10, 1, 1).data],
    [...raw.content.getContext('2d').getImageData(20, 10, 1, 1).data],
  );
});
test('header logo geometry preserves image aspect and stays inside the header at every canvas ratio; brand-only mode hides scene content', async (t) => {
  const f = await fixture(t),
    ctx = createCanvas(1, 1).getContext('2d');
  for (const aspect of EXPORT_ASPECTS.map((x) => x.id))
    for (const preset of [null, ...LAYOUT_PRESETS]) {
      const l = frameLayout(f.info, DEFAULTS.style, {
        aspect,
        shortEdge: 720,
        ...(preset ? { layout: preset.value } : {}),
      });
      if (l.options?.showHeader === false) continue;
      for (const [width, height] of [
        [256, 128],
        [32, 256],
        [500, 30],
      ])
        for (const mode of ['full', 'brand', 'logo']) {
          const h = {
            options: normalizeHeader({
              mode,
              logoEnabled: true,
              path: f.image,
              logoHeight: 120,
              logoMaxWidth: 400,
              fontSize: 64,
              offsetX: 160,
              offsetY: 80,
            }),
            brand: { enabled: true, name: 'ACME · 品牌课程', tagline: 'PRACTICAL GUIDES' },
            image: { width, height },
          };
          const g = headerGeometry(ctx, l, h),
            bottom = l.custom
              ? l.headerTop + l.headerBand
              : Math.min(l.headerHeight, 104 * (l.unit || l.width / 1440));
          assert(g.x >= 0 && g.x + g.width <= l.width + 0.1);
          assert(g.y >= g.top && g.y + g.height <= bottom + 0.1);
          assert(Math.abs(g.logoWidth / g.logoHeight - width / height) < 0.001);
        }
    }
  const l = frameLayout(f.info, DEFAULTS.style, { aspect: '16:9', shortEdge: 720 });
  const style = await prepareHeaderStyle(DEFAULTS.style, {
    mode: 'brand',
    inheritBrand: false,
    brandName: 'ACME',
    brandTagline: '研究课堂',
    showFooterChapters: false,
  });
  const canvas = createCanvas(l.width, l.height),
    c = canvas.getContext('2d'),
    labels = [],
    fill = c.fillText.bind(c);
  c.fillText = (text, ...args) => {
    labels.push(text);
    fill(text, ...args);
  };
  paintProjectHeader(
    c,
    l,
    { heading: '不应出现的标题', chapter: 0 },
    { chapters: ['不应出现的章节'] },
    style,
  );
  assert(labels.includes('ACME'));
  assert(labels.includes('研究课堂'));
  assert(!labels.includes('不应出现的标题'));
  assert(!labels.includes('不应出现的章节'));
  assert.equal(headerTimerAllowed(style), false);
  assert.equal(footerLabelsAllowed(style), false);
});
test('uploaded transparent logos and brand presets survive restart and original deletion without overwriting brand text', async (t) => {
  const f = await fixture(t),
    root = path.join(f.dir, 'projects');
  let studio = await startServer({ dataDir: root, account: new TestAccount() });
  t.after(() => studio.close());
  await confirmModels(studio.store);
  const post = async (route, data) => {
    const r = await fetch(studio.url + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tutor-Token': studio.token },
      body: JSON.stringify(data),
    });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    return body;
  };
  const r = await fetch(studio.url + '/api/uploads/frame-background?name=logo.png', {
    method: 'POST',
    headers: { 'X-Tutor-Token': studio.token },
    body: await fs.readFile(f.image),
  });
  assert.equal(r.status, 200);
  const uploaded = await r.json();
  const h = {
    mode: 'brand',
    inheritBrand: false,
    brandName: 'ACME Lab',
    brandTagline: '品牌课堂',
    logoEnabled: true,
    path: uploaded.path,
    name: uploaded.name,
  };
  const surfaces = {
    headerMode: 'custom',
    headerOpacity: 25,
    footerMode: 'custom',
    footerOpacity: 10,
  };
  const preset = await post('/api/header-presets', { name: 'ACME 半透明', header: h, surfaces });
  assert.equal(preset.header.brandName, 'ACME Lab');
  const p = await studio.store.create(f.source, '', '课程');
  await studio.engine.saveScript(p.id, {
    title: '课程',
    chapters: ['一'],
    scenes: [
      { id: 'a', kind: 'action', chapter: 0, heading: '步骤', source_start: 0, source_end: 0.5 },
    ],
  });
  await studio.engine.saveExportOptions(
    p.id,
    { aspect: '16:9', layout: LAYOUT_PRESETS.find((x) => x.id === 'compact').value },
    p.revision,
  );
  await studio.engine.confirm(
    p.id,
    scriptHash(p.script),
    p.revision,
    brandingHash(p.branding),
    exportHash(p.exportOptions),
  );
  const before = JSON.stringify(p);
  await post('/api/branding/preview', {
    projectId: p.id,
    header: { ...h, ensureVisible: true },
    frame: { preset: 'mist', surfaces },
  });
  assert.equal(JSON.stringify(p), before);
  await studio.engine.saveBranding(
    p.id,
    {
      header: { ...preset.header, ensureVisible: true },
      frame: { preset: 'mist', surfaces: preset.surfaces },
    },
    p.revision,
  );
  assert.equal(p.approval, null);
  assert.equal(p.branding.header.brandName, 'ACME Lab');
  assert.equal(
    p.exportOptions.layout.showHeader,
    true,
    'editing a brand in compact layout enables the header once',
  );
  assert.equal(
    p.branding.header.ensureVisible,
    undefined,
    'draft-only visibility intent is not kept as a permanent override',
  );
  assert.equal(p.exportOptions.layout.showTimer, false, 'brand-only mode disables the timer');
  assert.equal(
    p.exportOptions.layout.timelineLabels,
    true,
    'the Footer chapter control enables labels',
  );
  await studio.engine.saveBranding(
    p.id,
    {
      ...p.branding,
      header: { ...p.branding.header, mode: 'full', ensureVisible: true, showTimer: true },
    },
    p.revision,
  );
  assert.equal(
    p.exportOptions.layout.showTimer,
    true,
    'the Header timer control enables the timer',
  );
  await studio.engine.saveExportOptions(
    p.id,
    { aspect: '16:9', layout: LAYOUT_PRESETS.find((x) => x.id === 'compact').value },
    p.revision,
  );
  assert.equal(
    p.exportOptions.layout.showHeader,
    false,
    'later explicit layout choices remain effective',
  );
  await fs.rm(uploaded.path);
  await fs.rm(f.image);
  await post('/api/header-presets', { action: 'delete', id: preset.id });
  await verifyBranding(p.branding);
  const saved = await post('/api/header-presets', {
    name: '重启保留',
    header: p.branding.header,
    surfaces,
  });
  await studio.close();
  studio = await startServer({ dataDir: root, account: new TestAccount() });
  const items = await (await fetch(studio.url + '/api/header-presets')).json();
  assert.equal(items[0].id, saved.id);
  assert.equal(items[0].surfaces.footerOpacity, 10);
  await fs.writeFile(p.branding.header.path, 'changed');
  await assert.rejects(verifyBranding(p.branding), /Header Logo文件已变更/);
});
test('actual logo-only export keeps transparent logo edges and translucent background, omits header scene text and retains captions/SRT', async (t) => {
  const f = await fixture(t),
    options = { aspect: '16:9', shortEdge: 720 };
  const branding = await importBranding(
    {
      frame: {
        preset: 'custom',
        path: f.background,
        blur: 0,
        dim: 0,
        saturation: 100,
        surfaces: {
          headerMode: 'custom',
          headerOpacity: 25,
          footerMode: 'custom',
          footerOpacity: 15,
        },
      },
      header: {
        mode: 'logo',
        path: f.image,
        logoEnabled: true,
        logoHeight: 48,
        showFooterChapters: false,
      },
    },
    path.join(f.dir, 'project'),
  );
  const script = normalizeScript(
    {
      title: '课程',
      chapters: ['章节'],
      scenes: [
        {
          id: 'a',
          kind: 'action',
          chapter: 0,
          heading: '不应显示在 Header 的标题',
          narration: '半透明底色保留背景细节，正文字幕继续显示。',
          source_start: 0,
          source_end: 0.5,
          min_view_seconds: 1,
        },
        { id: 't', kind: 'title', chapter: 0, heading: '章节过场', min_view_seconds: 0.5 },
      ],
    },
    f.info.duration,
  );
  const pcm = Buffer.alloc(48000 * 2 * 0.5),
    voice = path.join(f.dir, 'voice.wav');
  await fs.writeFile(voice, wav(pcm));
  const result = await render({
    source: f.source,
    info: f.info,
    script,
    branding,
    exportOptions: options,
    config: { ...DEFAULTS, style: { ...DEFAULTS.style, fps: 24 } },
    audio: [{ file: voice, pcm, duration: 0.5 }, null],
    dir: path.join(f.dir, 'output'),
  });
  const target = path.join(f.dir, 'decoded.png');
  await frame(result.output, 0.3, target);
  const image = await loadImage(target),
    canvas = createCanvas(image.width, image.height),
    ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const layout = frameLayout(f.info, DEFAULTS.style, options),
    backdrop = await prepareFrameBackground(layout, DEFAULTS.style, branding.frame);
  for (const [x, y] of [
    [Math.floor(layout.width * 0.5), 20],
    [layout.width - 20, 30],
    [Math.floor(layout.width * 0.5), Math.floor(layout.timeline.labelBaseline) - 4],
  ]) {
    const actual = ctx.getImageData(x, y, 1, 1).data,
      expected = backdrop.content.getContext('2d').getImageData(x, y, 1, 1).data;
    for (let i = 0; i < 3; i++) assert(Math.abs(actual[i] - expected[i]) < 8);
  }
  const prepared = await prepareHeaderStyle(
      DEFAULTS.style,
      branding.header,
      branding.frame.surfaces,
    ),
    g = headerGeometry(ctx, layout, prepared.header);
  const center = ctx.getImageData(
    Math.round(g.x + g.logoWidth / 2),
    Math.round(g.logoY + g.logoHeight / 2),
    1,
    1,
  ).data;
  assert(center[0] > 190 && center[1] < 90);
  assert(
    (await fs.readFile(path.join(f.dir, 'output/subtitles.srt'), 'utf8')).includes('半透明底色'),
  );
  assert(
    (
      await framePreview({
        info: f.info,
        style: DEFAULTS.style,
        exportOptions: options,
        frame: branding.frame,
        header: branding.header,
        scene: script.scenes[0],
        script,
      })
    ).image.startsWith('data:image/png;base64,'),
  );
});
