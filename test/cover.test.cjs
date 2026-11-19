const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { normalizeCover } = require('../src/cover-options.mjs');
const { coverImage, probeStreams, verifyCover } = require('../src/cover.cjs');
const { DEFAULTS } = require('../src/config.cjs');
const { FFMPEG, FFPROBE, run, probe, frame } = require('../src/media.cjs');
const { render } = require('../src/render.cjs');
const { normalizeScript, scriptHash, requireApproval } = require('../src/script.cjs');
const { startServer } = require('../src/server.cjs');
const { TestAccount, confirmModels } = require('./helpers/account.cjs');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

test('cover options reject invalid assets and values; title covers adapt to every aspect with complete long titles', async () => {
  for (const value of [
    null,
    [],
    { mode: 'intro' },
    { title: 'x'.repeat(161) },
    { subtitle: 'a\u202e' },
    { embed: 1 },
    { mode: 'image', path: 'x.mp4' },
    { align: 'right' },
  ])
    assert.throws(() => normalizeCover(value));
  assert.equal(normalizeCover().mode, 'generated');
  assert.equal((await coverImage({ value: { mode: 'none' } })).image, null);
  const title = '从请求构造到响应验证：用清晰步骤理解复杂操作，以及如何完成最后的检查'.repeat(3);
  for (const aspect of ['16:9', '9:16', '1:1', '4:5', '4:3', '3:4', 'auto']) {
    const result = await coverImage({
      value: { title, theme: 'light' },
      script: { title: 'default', chapters: ['构造请求', '核对响应'] },
      info: { width: 1600, height: 900 },
      style: DEFAULTS.style,
      exportOptions: { aspect, shortEdge: 720 },
    });
    const image = await loadImage(result.bytes);
    assert.equal(image.width, result.width);
    assert.equal(image.height, result.height);
    assert.equal(result.title, title);
    assert(result.bytes.length > 20000);
  }
});

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-cover-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const images = {};
  for (const [name, color] of [
    ['intro', '#db392c'],
    ['outro', '#2a9f64'],
    ['custom', '#1461e0'],
  ]) {
    const c = createCanvas(640, 360),
      x = c.getContext('2d');
    x.fillStyle = color;
    x.fillRect(0, 0, 640, 360);
    const file = path.join(dir, name + '.png');
    await fs.writeFile(file, c.toBuffer('image/png'));
    images[name] = file;
  }
  const source = path.join(dir, 'source.mp4');
  await run(FFMPEG, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=640x360:r=24',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    source,
  ]);
  return { dir, source, images, info: await probe(source) };
}
async function packets(file, type) {
  const data = JSON.parse(
    (
      await run(FFPROBE, [
        '-v',
        'error',
        '-select_streams',
        type,
        '-show_packets',
        '-show_entries',
        'packet=pts_time,dts_time,duration_time,data_hash',
        '-show_data_hash',
        'sha256',
        '-of',
        'json',
        file,
      ])
    ).stdout,
  );
  return data.packets;
}

test('cover settings work before rendering, preserve approval and hold the project lock through persistence', async (t) => {
  const f = await fixture(t);
  const studio = await startServer({
    dataDir: path.join(f.dir, 'new-projects'),
    account: new TestAccount(),
  });
  t.after(() => studio.close());
  await confirmModels(studio.store);
  const p = await studio.store.create(f.source, '', '先选封面');
  const script = {
    title: '先选封面再制作',
    chapters: ['检查'],
    scenes: [
      { id: 'a', kind: 'action', chapter: 0, heading: '检查', source_start: 0, source_end: 1 },
    ],
  };
  await studio.engine.saveScript(p.id, script);
  await studio.engine.confirm(p.id, scriptHash(p.script));
  let release, entered;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    waiting = new Promise((resolve) => {
      entered = resolve;
    });
  const originalSave = studio.store.save.bind(studio.store);
  studio.store.save = async (value) => {
    if (value.coverRevision === 1) {
      entered();
      await gate;
    }
    return originalSave(value);
  };
  const operation = studio.engine.saveCover(
    p.id,
    { title: '我选择的标题', theme: 'light' },
    p.revision,
    0,
  );
  await waiting;
  try {
    assert.equal(p.job.label, '更新视频封面');
    await assert.rejects(studio.engine.saveScript(p.id, script), /等待/);
    await assert.rejects(studio.engine.saveCover(p.id, {}, p.revision, 0), /等待/);
  } finally {
    release();
  }
  await operation;
  assert.equal(p.cover.title, '我选择的标题');
  assert.equal(p.coverRevision, 1);
  assert.equal(p.job, null);
  assert.equal(p.output, undefined);
  requireApproval(p);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(studio.store.dir(p.id), 'project.json'))).job,
    null,
  );
  await assert.rejects(
    studio.engine.saveCover(
      p.id,
      { mode: 'image', path: path.join(f.dir, 'missing.png') },
      p.revision,
      1,
    ),
  );
  assert.equal(p.coverRevision, 1);
  assert.equal(p.job, null);
  requireApproval(p);
});

test('generated cover survives intro/outro; existing exports update or remove covers without changing any video/audio packet, chapters, SRT or approval', async (t) => {
  const f = await fixture(t);
  let studio = await startServer({
    dataDir: path.join(f.dir, 'projects'),
    account: new TestAccount(),
  });
  t.after(() => studio.close());
  await confirmModels(studio.store);
  const p = await studio.store.create(f.source, '', '封面与片头共存', {
    intro: { enabled: true, path: f.images.intro, duration: 1 },
    outro: { enabled: true, path: f.images.outro, duration: 1 },
  });
  const script = normalizeScript(
    {
      title: '请求与响应：一步步完成验证',
      chapters: ['检查请求'],
      scenes: [
        {
          id: 'a',
          kind: 'action',
          chapter: 0,
          heading: '检查请求参数',
          source_start: 0,
          source_end: 1,
          min_view_seconds: 1,
        },
      ],
    },
    f.info.duration,
  );
  await studio.engine.saveScript(p.id, script);
  await studio.engine.confirm(
    p.id,
    scriptHash(p.script),
    p.revision,
    require('../src/branding.cjs').brandingHash(p.branding),
    require('../src/frame-layout.cjs').exportHash(p.exportOptions),
  );
  const dir = path.join(studio.store.dir(p.id), 'output-r' + p.revision);
  await fs.mkdir(dir);
  await fs.writeFile(path.join(dir, 'script.json'), JSON.stringify(p.script));
  await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify(DEFAULTS));
  const result = await render({
    source: p.source,
    info: p.info,
    script: p.script,
    branding: p.branding,
    audio: [null],
    config: { ...DEFAULTS, style: { ...DEFAULTS.style, width: 640, fps: 24 } },
    dir,
  });
  p.output = {
    dir,
    path: result.output,
    revision: p.revision,
    verification: result.verification,
    plan: result.plan,
    completedAt: new Date().toISOString(),
    cover: result.cover,
  };
  p.status = 'done';
  await studio.store.save(p);
  assert.equal(result.cover.title, script.title);
  assert.equal(result.cover.embedded, true);
  const originalPath = p.output.path,
    originalBytes = hash(await fs.readFile(originalPath));
  const before = await probeStreams(originalPath),
    video = await packets(originalPath, 'V:0'),
    audio = await packets(originalPath, 'a:0'),
    srt = await fs.readFile(path.join(dir, 'subtitles.srt'));
  assert.equal(before.streams.filter((s) => s.disposition?.attached_pic).length, 1);
  const first = path.join(f.dir, 'first.png');
  await frame(originalPath, 0.1, first);
  const img = await loadImage(first),
    cv = createCanvas(img.width, img.height),
    x = cv.getContext('2d');
  x.drawImage(img, 0, 0);
  const pixel = x.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data;
  assert(pixel[0] > pixel[1] + 50, 'the intro still plays before the tutorial');
  const post = async (route, body) => {
    const r = await fetch(studio.url + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tutor-Token': studio.token },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  const snapshot = JSON.stringify(p);
  assert.equal(
    (
      await post('/api/cover/preview', {
        projectId: p.id,
        revision: p.revision,
        cover: { title: '预览不修改项目', theme: 'light' },
      })
    ).status,
    200,
  );
  assert.equal(JSON.stringify(p), snapshot);
  const url = '/api/projects/' + p.id + '/cover-settings';
  assert.equal(
    (
      await post(url, {
        revision: p.revision,
        coverRevision: 0,
        cover: { mode: 'image', path: 'bad.svg' },
      })
    ).status,
    400,
  );
  assert.equal(p.output.path, originalPath);
  const updated = await post(url, {
    revision: p.revision,
    coverRevision: 0,
    cover: { mode: 'image', path: f.images.custom, name: '自制封面.png' },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(p.coverRevision, 1);
  assert.equal(p.output.cover.mode, 'image');
  requireApproval(p);
  assert.deepEqual(await packets(p.output.path, 'V:0'), video);
  assert.deepEqual(await packets(p.output.path, 'a:0'), audio);
  assert.deepEqual((await probeStreams(p.output.path)).chapters, before.chapters);
  assert.deepEqual(await fs.readFile(path.join(p.output.dir, 'subtitles.srt')), srt);
  assert.equal(hash(await fs.readFile(originalPath)), originalBytes);
  assert.equal(p.usage.length, 0);
  const imageResponse = await fetch(
    studio.url + '/api/projects/' + p.id + '/output?file=cover.jpg',
  );
  assert.equal(imageResponse.status, 200);
  assert.match(imageResponse.headers.get('content-type'), /image\/jpeg/);
  await fs.rm(f.images.custom);
  await verifyCover(p.cover);
  assert.equal(
    (await post(url, { revision: p.revision, coverRevision: 0, cover: {} })).status,
    400,
    'stale cover writes are rejected',
  );
  await studio.close();
  studio = await startServer({ dataDir: path.join(f.dir, 'projects'), account: new TestAccount() });
  const restored = studio.store.get(p.id);
  assert.equal(restored.coverRevision, 1);
  await verifyCover(restored.cover);
  assert.equal(
    (
      await post(url, {
        revision: restored.revision,
        coverRevision: 1,
        cover: { mode: 'generated', embed: false },
      })
    ).status,
    200,
  );
  assert.equal(restored.output.cover.enabled, true);
  assert.equal(restored.output.cover.embedded, false);
  assert.equal(
    (await probeStreams(restored.output.path)).streams.filter((s) => s.disposition?.attached_pic)
      .length,
    0,
  );
  assert.equal(
    (await post(url, { revision: restored.revision, coverRevision: 2, cover: { mode: 'none' } }))
      .status,
    200,
  );
  assert.equal(restored.output.cover.enabled, false);
  assert.equal(
    (await fetch(studio.url + '/api/projects/' + p.id + '/output?file=cover.jpg')).status,
    400,
  );
  assert.deepEqual(await packets(restored.output.path, 'V:0'), video);
  assert.deepEqual(await packets(restored.output.path, 'a:0'), audio);
  requireApproval(restored);
});
