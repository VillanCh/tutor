const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const {
  EXPORT_ASPECTS,
  normalizeExportOptions,
  exportDimensions,
} = require('../src/export-options.mjs');
const { frameLayout, exportHash } = require('../src/frame-layout.cjs');
const { DEFAULTS } = require('../src/config.cjs');
const { approve, requireApproval, scriptHash, normalizeScript } = require('../src/script.cjs');
const { FFMPEG, run, probe, frame, wav } = require('../src/media.cjs');
const { render } = require('../src/render.cjs');
const { startServer } = require('../src/server.cjs');
const { TestAccount, confirmModels } = require('./helpers/account.cjs');

test('common export ratios have exact even dimensions and keep picture, captions and chapter rails separated', () => {
  assert.deepEqual(normalizeExportOptions(), { aspect: 'auto', shortEdge: 1080 });
  for (const bad of [{ aspect: 'stretch' }, { shortEdge: 900 }, [], '16:9'])
    assert.throws(() => normalizeExportOptions(bad));
  for (const preset of EXPORT_ASPECTS.filter((p) => p.id !== 'auto'))
    for (const shortEdge of [720, 1080])
      for (const info of [
        { width: 1600, height: 900 },
        { width: 900, height: 1600 },
        { width: 1024, height: 768 },
      ]) {
        const value = { aspect: preset.id, shortEdge },
          layout = frameLayout(info, DEFAULTS.style, value);
        assert.equal(layout.width / layout.height, preset.width / preset.height);
        assert.equal(Math.min(layout.width, layout.height), shortEdge);
        assert.equal(layout.width % 2, 0);
        assert.equal(layout.height % 2, 0);
        assert(layout.video_x >= 0 && layout.video_y >= layout.headerHeight);
        assert(layout.video_x + layout.video_width <= layout.width);
        assert(layout.video_y + layout.video_height < layout.caption.y);
        assert(
          layout.caption.y + layout.caption.height + 15 * layout.unit <
            layout.timeline.labelBaseline,
        );
        assert(layout.timeline.y + layout.timeline.height < layout.height);
        assert(
          Math.abs(layout.video_width / layout.video_height / (info.width / info.height) - 1) <
            0.006,
        );
      }
  assert.deepEqual(exportDimensions({ aspect: '16:9' }), { width: 1920, height: 1080 });
  assert.deepEqual(exportDimensions({ aspect: '9:16' }), { width: 1080, height: 1920 });
});

test('canvas settings bind human approval and preserve approvals from the original automatic layout', () => {
  const p = { revision: 1, script: { title: 't', chapters: ['c'], scenes: [] } };
  approve(p, scriptHash(p.script));
  delete p.approval.exportHash;
  requireApproval(p);
  p.exportOptions = { aspect: '9:16', shortEdge: 1080 };
  assert.throws(() => requireApproval(p), /导出比例/);
  approve(p, scriptHash(p.script));
  requireApproval(p);
  p.exportOptions.shortEdge = 720;
  assert.throws(() => requireApproval(p), /清晰度/);
  assert.equal(exportHash(), exportHash({ aspect: 'auto', shortEdge: 720 }));
});

async function fixture(t, { sar = 1, portrait = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-export-'));
  t.after(async () => {
    if (path.dirname(path.resolve(dir)) === path.resolve(os.tmpdir()))
      await fs.rm(dir, { recursive: true, force: true });
  });
  const W = portrait ? 360 : 640,
    H = portrait ? 640 : 360;
  const canvas = createCanvas(W, H),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1d4ed8';
  ctx.beginPath();
  ctx.ellipse(W / 2, H / 2, 80 / sar, 80, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#eb4b25';
  for (const [x, y] of [
    [8, 8],
    [W - 24, 8],
    [8, H - 24],
    [W - 24, H - 24],
  ])
    ctx.fillRect(x, y, 16, 16);
  const image = path.join(dir, 'source.png'),
    source = path.join(dir, 'source.mp4');
  await fs.writeFile(image, canvas.toBuffer('image/png'));
  await run(FFMPEG, [
    '-v',
    'error',
    '-y',
    '-loop',
    '1',
    '-i',
    image,
    '-vf',
    'setsar=' + sar,
    '-t',
    '2',
    '-r',
    '24',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    source,
  ]);
  return { dir, source, info: await probe(source) };
}

test('preview is read-only; changing export settings revokes approval, persists and preserves older output', async (t) => {
  const data = await fixture(t),
    account = new TestAccount();
  let studio = await startServer({ dataDir: path.join(data.dir, 'projects'), account });
  t.after(() => studio.close());
  await confirmModels(studio.store);
  const p = await studio.store.create(data.source, '', '画布核对');
  await studio.engine.saveScript(p.id, {
    title: '画布核对',
    chapters: ['测试'],
    scenes: [
      {
        id: 's1',
        kind: 'action',
        chapter: 0,
        heading: '保留完整画面',
        source_start: 0,
        source_end: 1,
        narration: '检查圆形与四角。',
      },
    ],
  });
  await studio.engine.confirm(p.id, scriptHash(p.script));
  p.output = { revision: p.revision, dir: 'previous-output', completedAt: 'previous' };
  const before = JSON.stringify(p);
  const headers = { 'Content-Type': 'application/json', 'X-Tutor-Token': studio.token };
  const request = async (route, body) => {
    const res = await fetch(studio.url + route, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const preview = await request('/api/export/preview', {
    projectId: p.id,
    exportOptions: { aspect: '9:16' },
    kind: 'content',
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.canvas.width, 1080);
  assert.equal(preview.body.canvas.height, 1920);
  assert.equal(JSON.stringify(p), before);
  const url = '/api/projects/' + p.id + '/export-settings';
  assert.equal(
    (await request(url, { revision: p.revision - 1, exportOptions: { aspect: '9:16' } })).status,
    400,
  );
  const saved = await request(url, {
    revision: p.revision,
    exportOptions: { aspect: '9:16', shortEdge: 720 },
  });
  assert.equal(saved.status, 200);
  assert.equal(p.approval, null);
  assert.equal(p.output.completedAt, 'previous');
  await assert.rejects(
    studio.engine.confirm(p.id, scriptHash(p.script), p.revision),
    /导出画布已更新/,
  );
  await studio.engine.confirm(
    p.id,
    scriptHash(p.script),
    p.revision,
    undefined,
    saved.body.exportHash,
  );
  requireApproval(p);
  const savedOptions = structuredClone(p.exportOptions),
    revision = p.revision;
  await studio.engine.saveExportOptions(p.id, savedOptions, revision);
  assert.equal(p.revision, revision);
  requireApproval(p);
  studio.close();
  studio = await startServer({ dataDir: path.join(data.dir, 'projects'), account });
  assert.deepEqual(studio.store.get(p.id).exportOptions, savedOptions);
  assert.equal(studio.store.get(p.id).revision, revision);
  requireApproval(studio.store.get(p.id));
});

test(
  'real landscape and portrait exports preserve circles and all four corners through motion, freeze and fades',
  { timeout: 120000 },
  async (t) => {
    let data = await fixture(t);
    const script = normalizeScript(
      {
        title: '比例核对',
        chapters: ['完整画面'],
        scenes: [
          {
            id: 'title',
            kind: 'title',
            chapter: 0,
            heading: '保持真实画面比例',
            min_view_seconds: 0.8,
            transition: 'fade',
          },
          {
            id: 'motion',
            kind: 'action',
            chapter: 0,
            heading: '检查圆形与四角',
            source_start: 0,
            source_end: 1,
            hold_at: 0.4,
            narration: '画面保持完整。',
            min_view_seconds: 1.2,
            silent_tail_seconds: 0.7,
            transition: 'fade',
          },
          {
            id: 'freeze',
            kind: 'observe',
            chapter: 0,
            heading: '定格也保持原比例',
            freeze_at: 0.6,
            motion_mode: 'freeze',
            narration: '',
            min_view_seconds: 1,
            transition: 'fade',
          },
        ],
      },
      data.info.duration,
    );
    const voice = Buffer.alloc(48000),
      voiceFile = path.join(data.dir, 'voice.wav');
    await fs.writeFile(voiceFile, wav(voice));
    const audio = [null, { file: voiceFile, pcm: voice, duration: 0.5 }, null];
    for (const [aspect, options] of [
      ['16:9', {}],
      ['9:16', {}],
      ['9:16', { sar: 2 }],
      ['16:9', { portrait: true }],
    ]) {
      if (options.sar || options.portrait) data = await fixture(t, options);
      const dir = path.join(data.dir, aspect.replace(':', '-'));
      await fs.mkdir(dir);
      const result = await render({
        source: data.source,
        info: data.info,
        script,
        audio,
        config: { ...DEFAULTS, style: { ...DEFAULTS.style, fps: 24 } },
        exportOptions: { aspect, shortEdge: 720 },
        dir,
      });
      assert.equal(result.verification.passed, true);
      const encoded = await probe(result.output);
      const expected = exportDimensions({ aspect, shortEdge: 720 });
      assert.equal(encoded.width, expected.width);
      assert.equal(encoded.height, expected.height);
      assert.equal(encoded.sampleAspectRatio, 1);
      for (const scene of result.plan.scenes.filter((s) => s.kind !== 'title')) {
        const file = path.join(dir, scene.id + '.png');
        await frame(result.output, scene.offset + 0.5, file);
        const image = await loadImage(file),
          ctx = createCanvas(image.width, image.height).getContext('2d');
        ctx.drawImage(image, 0, 0);
        const c = result.plan.canvas,
          pixels = ctx.getImageData(c.video_x, c.video_y, c.video_width, c.video_height).data;
        let minX = Infinity,
          maxX = 0,
          minY = Infinity,
          maxY = 0,
          corners = [0, 0, 0, 0];
        for (let y = 0; y < c.video_height; y++)
          for (let x = 0; x < c.video_width; x++) {
            const i = (y * c.video_width + x) * 4,
              r = pixels[i],
              g = pixels[i + 1],
              b = pixels[i + 2];
            if (b > 150 && r < 75 && g < 130) {
              minX = Math.min(minX, x);
              maxX = Math.max(maxX, x);
              minY = Math.min(minY, y);
              maxY = Math.max(maxY, y);
            }
            if (r > 170 && g < 140 && b < 110)
              corners[(y > c.video_height / 2 ? 2 : 0) + (x > c.video_width / 2 ? 1 : 0)]++;
          }
        assert(
          Math.abs((maxX - minX) / (maxY - minY) - 1) < 0.025,
          aspect + ' ' + scene.id + ' circle stretched',
        );
        assert(
          corners.every((count) => count > 10),
          aspect + ' ' + scene.id + ' cropped a corner',
        );
      }
      assert.match(await fs.readFile(path.join(dir, 'subtitles.srt'), 'utf8'), /画面保持完整/);
    }
  },
);
