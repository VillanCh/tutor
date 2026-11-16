const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { LAYOUT_PRESETS, normalizeLayout } = require('../src/layout-options.mjs');
const { EXPORT_ASPECTS, normalizeExportOptions } = require('../src/export-options.mjs');
const { frameLayout, framePreview, exportHash } = require('../src/frame-layout.cjs');
const { DEFAULTS } = require('../src/config.cjs');
const { startServer } = require('../src/server.cjs');
const { TestAccount, confirmModels } = require('./helpers/account.cjs');
const { normalizeScript, scriptHash, approve, requireApproval } = require('../src/script.cjs');
const { FFMPEG, run, probe, frame, wav } = require('../src/media.cjs');
const { render, captionChunks } = require('../src/render.cjs');
const { chapterSegments } = require('../src/tutorial-brand.cjs');
const preset = (id) => LAYOUT_PRESETS.find((p) => p.id === id).value;

test('layout settings bind approval while legacy layouts keep their canonical hash', () => {
  assert.deepEqual(normalizeExportOptions(), { aspect: 'auto', shortEdge: 1080 });
  for (const layout of [
    [],
    'compact',
    { margin: -1 },
    { borderWidth: 13 },
    { showHeader: 1 },
    { captionLines: 4 },
    { captionLineHeight: 0.9 },
    { videoAlign: 'stretch' },
  ])
    assert.throws(() => normalizeExportOptions({ layout }));
  const p = { revision: 1, script: { title: 't', chapters: ['c'], scenes: [] } };
  approve(p, scriptHash(p.script));
  requireApproval(p);
  p.exportOptions = { layout: preset('compact') };
  assert.throws(() => requireApproval(p), /导出/);
  approve(p, scriptHash(p.script));
  requireApproval(p);
  const hash = exportHash(p.exportOptions);
  p.exportOptions.layout = { ...p.exportOptions.layout, captionLineHeight: 1.6 };
  assert.notEqual(exportHash(p.exportOptions), hash);
});

test('compact, spacious and clean layouts preserve source aspect and separate all information regions at every export ratio', () => {
  const info = { width: 1600, height: 900 };
  const legacy = frameLayout(info, DEFAULTS.style, { aspect: '16:9' });
  const compact = frameLayout(info, DEFAULTS.style, { aspect: '16:9', layout: preset('compact') });
  assert.equal(compact.headerBand, 0);
  assert.equal(compact.timer.enabled, false);
  assert(
    compact.video_width * compact.video_height > legacy.video_width * legacy.video_height * 1.2,
  );
  const oldAuto = frameLayout(info, DEFAULTS.style);
  const smallAuto = frameLayout(info, DEFAULTS.style, { layout: preset('compact') });
  assert(smallAuto.height < oldAuto.height);
  for (const aspect of EXPORT_ASPECTS.map((x) => x.id))
    for (const shortEdge of [720, 1080])
      for (const input of [info, { width: 900, height: 1600 }, { width: 1024, height: 768 }])
        for (const { value: layout } of LAYOUT_PRESETS) {
          const c = frameLayout(input, DEFAULTS.style, { aspect, shortEdge, layout });
          assert.equal(c.width % 2, 0);
          assert.equal(c.height % 2, 0);
          assert(c.video_x >= 0 && c.video_y >= c.headerHeight);
          assert(c.video_x + c.video_width <= c.width);
          assert(c.video_y + c.video_height <= c.height);
          assert(
            Math.abs(c.video_width / c.video_height / (input.width / input.height) - 1) < 0.01,
          );
          if (c.caption.enabled) {
            assert(c.video_y + c.video_height <= c.caption.y);
            assert(
              c.caption.baseline + (layout.captionLines - 1) * c.caption.lineHeight <
                c.caption.height,
            );
          }
          if (c.timeline.enabled) {
            assert(c.timeline.y + c.timeline.height <= c.height);
            if (c.caption.enabled)
              assert(
                c.caption.y + c.caption.height <=
                  c.timeline.y - (c.timeline.labels ? c.timeline.fontSize : 0),
              );
          }
        }
  const clean = frameLayout(info, DEFAULTS.style, { layout: preset('clean') });
  assert.deepEqual(
    [clean.video_x, clean.video_y, clean.video_width, clean.video_height],
    [0, 0, 1440, 810],
  );
  assert.equal(clean.height, 810);
  const denseChapters = Array.from({ length: 60 }, (_, i) => ({ start: i, end: i + 1 }));
  for (const width of [480, 720, 1440]) {
    const segments = chapterSegments(denseChapters, 60, width, 32);
    assert(segments.every((segment) => segment.width > 0 && segment.x >= 0));
    const last = segments.at(-1);
    assert(last.x + last.width <= width + 0.001);
  }
  const text = '这是一段较长的中文字幕，用来检查一行、两行和三行配置都能完整保留所有文字。'.repeat(
    5,
  );
  for (const lines of [1, 2, 3]) {
    const chunks = captionChunks(text, 420, 28, lines);
    assert.equal(chunks.join(''), text);
    assert(chunks.every((chunk) => chunk.length > 0));
  }
});

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-layout-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const image = path.join(dir, 'source.png'),
    source = path.join(dir, 'source.mp4');
  const c = createCanvas(640, 360),
    ctx = c.getContext('2d');
  ctx.fillStyle = '#2244bb';
  ctx.fillRect(0, 0, 640, 360);
  ctx.fillStyle = '#f43225';
  for (const [x, y] of [
    [0, 0],
    [620, 0],
    [0, 340],
    [620, 340],
  ])
    ctx.fillRect(x, y, 20, 20);
  await fs.writeFile(image, c.toBuffer('image/png'));
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

test('layout presets survive restart, previews never change the project, and invalid crowded layouts cannot be applied', async (t) => {
  const data = await fixture(t),
    account = new TestAccount(),
    root = path.join(data.dir, 'projects');
  let studio = await startServer({ dataDir: root, account });
  t.after(() => studio.close());
  await confirmModels(studio.store);
  const p = await studio.store.create(data.source, '', '布局核对');
  await studio.engine.saveScript(p.id, {
    title: '布局核对',
    chapters: ['一'],
    scenes: [
      {
        id: 'a',
        kind: 'action',
        chapter: 0,
        heading: '完整录屏',
        source_start: 0,
        source_end: 0.5,
      },
    ],
  });
  await studio.engine.confirm(p.id, scriptHash(p.script));
  p.output = { revision: p.revision, completedAt: 'old' };
  const post = async (route, data) => {
    const r = await fetch(studio.url + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tutor-Token': studio.token },
      body: JSON.stringify(data),
    });
    return { status: r.status, body: await r.json() };
  };
  const before = JSON.stringify(p);
  const preview = await post('/api/export/preview', {
    projectId: p.id,
    exportOptions: { layout: preset('compact') },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.canvas.headerBand, 0);
  assert.equal(JSON.stringify(p), before);
  await Promise.all([
    post('/api/layout-presets', { name: '我的紧凑', layout: preset('compact') }),
    post('/api/layout-presets', { name: '大字', layout: preset('spacious') }),
  ]);
  const crowded = {
    ...preset('spacious'),
    margin: 120,
    topPadding: 80,
    bottomPadding: 80,
    contentGap: 48,
    borderWidth: 12,
    headerHeight: 200,
    captionFont: 54,
    captionLineHeight: 2,
    captionLines: 3,
    captionPadding: 24,
    chapterFont: 28,
  };
  const rejected = await post('/api/projects/' + p.id + '/export-settings', {
    revision: p.revision,
    exportOptions: { aspect: '16:9', shortEdge: 720, layout: crowded },
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /空间不足/);
  assert.equal(JSON.stringify(p), before);
  const applied = await post('/api/projects/' + p.id + '/export-settings', {
    revision: p.revision,
    exportOptions: { layout: preset('compact') },
  });
  assert.equal(applied.status, 200);
  assert.equal(p.approval, null);
  assert.equal(p.output.completedAt, 'old');
  studio.close();
  studio = await startServer({ dataDir: root, account });
  assert.deepEqual(studio.store.get(p.id).exportOptions.layout, preset('compact'));
  const saved = await (await fetch(studio.url + '/api/layout-presets')).json();
  assert.equal(saved.length, 2);
  assert(saved.some((item) => item.name === '我的紧凑' && item.layout.showHeader === false));
});

test(
  'real exports respect hidden bars, compact captions and clean edges; SRT text remains complete',
  { timeout: 90000 },
  async (t) => {
    const data = await fixture(t),
      voice = path.join(data.dir, 'voice.wav'),
      pcm = Buffer.alloc(48000);
    await fs.writeFile(voice, wav(pcm));
    const narration = '保持录屏完整，核对四个角落。';
    const script = normalizeScript(
      {
        title: '自定义排版',
        chapters: ['核对'],
        scenes: [
          {
            id: 't',
            kind: 'title',
            chapter: 0,
            heading: '隐藏顶部，压紧底部',
            min_view_seconds: 0.6,
          },
          {
            id: 'a',
            kind: 'action',
            chapter: 0,
            heading: '四角保留',
            source_start: 0,
            source_end: 0.6,
            narration,
            min_view_seconds: 1.2,
          },
        ],
      },
      data.info.duration,
    );
    for (const [aspect, id] of [
      ['auto', 'clean'],
      ['16:9', 'compact'],
      ['9:16', 'balanced'],
    ]) {
      const dir = path.join(data.dir, id);
      await fs.mkdir(dir);
      const result = await render({
        source: data.source,
        info: data.info,
        script,
        audio: [null, { file: voice, pcm, duration: 0.5 }],
        config: { ...DEFAULTS, style: { ...DEFAULTS.style, width: 800, fps: 24 } },
        exportOptions: { aspect, shortEdge: 720, layout: preset(id) },
        dir,
      });
      assert(result.verification.passed);
      assert.equal(result.plan.canvas.custom, true);
      const c = result.plan.canvas,
        decoded = path.join(dir, 'decoded.png');
      await frame(result.output, result.plan.scenes[1].offset + 0.6, decoded);
      const img = await loadImage(decoded),
        canvas = createCanvas(img.width, img.height),
        ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      for (const [x, y] of [
        [3, 3],
        [c.video_width - 4, 3],
        [3, c.video_height - 4],
        [c.video_width - 4, c.video_height - 4],
      ]) {
        const p = ctx.getImageData(c.video_x + x, c.video_y + y, 1, 1).data;
        assert(p[0] > 150 && p[2] < 140, id + ' retains each source corner');
      }
      if (id === 'clean') assert.equal(c.height, c.video_height);
      assert.match(await fs.readFile(path.join(dir, 'subtitles.srt'), 'utf8'), /保持录屏完整/);
      const preview = await framePreview({
        info: data.info,
        style: { ...DEFAULTS.style, width: 800 },
        exportOptions: { aspect, shortEdge: 720, layout: preset(id) },
        background: data.image,
      });
      assert.equal(preview.canvas.width, c.width);
      assert.equal(preview.canvas.height, c.height);
    }
  },
);
