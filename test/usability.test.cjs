const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { startServer } = require('../src/server.cjs');
const { normalizeScript, scriptHash, approve, requireApproval } = require('../src/script.cjs');
const { FFMPEG, run, probe, wav, frame } = require('../src/media.cjs');
const { render, captionChunks } = require('../src/render.cjs');
const { DEFAULTS } = require('../src/config.cjs');
const { Store } = require('../src/store.cjs');
const { Engine } = require('../src/engine.cjs');

async function workspace(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-usability-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}
function sampleScript() {
  return normalizeScript(
    {
      title: '测试',
      chapters: ['操作'],
      scenes: [{ id: 's01', chapter: 0, kind: 'action', source_start: 0, source_end: 1 }],
    },
    3,
  );
}

test('human issue resolution is bound to the current script and still requires final approval', async (t) => {
  const server = await startServer({ dataDir: await workspace(t) });
  t.after(() => server.close());
  const p = {
    id: '11111111-1111-1111-1111-111111111111',
    script: sampleScript(),
    revision: 1,
    knowledge: '',
    status: 'review',
    sourceHash: 'original',
    review: { issues: [{ scene: 's01', severity: 'blocking', message: '核对画面' }] },
    progress: {},
    usage: [],
    job: null,
  };
  server.store.projects.set(p.id, p);
  await server.store.save(p);
  assert.throws(() => approve(p, scriptHash(p.script)), /阻断/);
  const endpoint = server.url + '/api/projects/' + p.id + '/resolve-issue';
  assert.equal((await fetch(endpoint, { method: 'POST', body: '{}' })).status, 400);
  const headers = { 'Content-Type': 'application/json', 'X-Tutor-Token': server.token };
  const resolve = (index, hash = scriptHash(p.script)) =>
    fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ index, hash }) });
  assert.equal((await resolve(0, 'stale')).status, 400);
  assert.equal((await resolve(-1)).status, 400);
  p.job = { label: 'working' };
  assert.equal((await resolve(0)).status, 400);
  p.job = null;
  assert.equal((await resolve(0)).status, 200);
  assert.equal(p.review.issues[0].resolvedBy, 'human');
  assert.equal(p.revision, 1);
  assert.equal(p.approval, null);
  assert.throws(() => requireApproval(p), /人工确认/);
  approve(p, scriptHash(p.script));
  requireApproval(p);
});

test('local drafts survive fresh server sessions, serialize overlapping saves and never approve a script', async (t) => {
  const dir = await workspace(t);
  let server = await startServer({ dataDir: dir });
  const p = {
    id: '22222222-2222-2222-2222-222222222222',
    script: sampleScript(),
    revision: 1,
    knowledge: '',
    status: 'review',
    info: { duration: 3 },
    source: 'unavailable',
    sourceHash: 'hash',
    usage: [],
    job: null,
  };
  server.store.projects.set(p.id, p);
  await server.store.save(p);
  const originalHash = scriptHash(p.script);
  const draft = {
    baseHash: originalHash,
    script: { ...p.script, title: '尚未提交的草稿' },
    json: '{unfinished',
  };
  const headers = { 'Content-Type': 'application/json', 'X-Tutor-Token': server.token };
  assert.equal(
    (await fetch(server.url + '/api/drafts/' + p.id, { method: 'POST', body: '{}' })).status,
    400,
  );
  const saved = await fetch(server.url + '/api/drafts/' + p.id, {
    method: 'POST',
    headers,
    body: JSON.stringify({ draft }),
  });
  assert.equal(saved.status, 200);
  await Promise.all([
    server.store.saveDraft('import', { source: 'first.mp4' }),
    server.store.saveDraft('import', { source: 'second.mp4' }),
  ]);
  assert.equal((await server.store.readDraft('import')).source, 'second.mp4');
  assert.equal(scriptHash(p.script), originalHash);
  assert.equal(p.revision, 1);
  server.close();
  server = await startServer({ dataDir: dir });
  t.after(() => server.close());
  assert.deepEqual(await (await fetch(server.url + '/api/drafts/' + p.id)).json(), draft);
  assert.equal((await server.store.readDraft('import')).source, 'second.mp4');
  assert.equal(scriptHash(server.store.get(p.id).script), originalHash);
  assert.equal((await fetch(server.url + '/api/drafts/unknown')).status, 400);
});

test('long subtitles retain all Chinese text and long tokens instead of silently clipping two lines', () => {
  const text =
    '没有句号的长解说应当分屏显示并且完整保留所有文字'.repeat(12) +
    ' https://example.com/' +
    'long-path-'.repeat(12);
  const chunks = captionChunks(text, 560);
  assert(chunks.length > 3);
  assert.equal(chunks.join('').replace(/\s+/g, ''), text.replace(/\s+/g, ''));
  assert(chunks.every((chunk) => chunk.length > 0));
});

test('phone-style rotation metadata is measured in the orientation users actually see', async (t) => {
  const dir = await workspace(t),
    original = path.join(dir, 'landscape.mp4'),
    rotated = path.join(dir, '手机竖屏.mov');
  await run(FFMPEG, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=30:d=1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    original,
  ]);
  await run(FFMPEG, [
    '-v',
    'error',
    '-y',
    '-display_rotation',
    '90',
    '-i',
    original,
    '-c',
    'copy',
    rotated,
  ]);
  const info = await probe(rotated);
  assert.equal(info.width, 180);
  assert.equal(info.height, 320);
  const snapshot = path.join(dir, 'actual.png');
  await frame(rotated, 0, snapshot);
  const { loadImage } = require('@napi-rs/canvas');
  const image = await loadImage(snapshot);
  assert.equal(info.width, image.width);
  assert.equal(info.height, image.height);
});

test('model review cannot mark its own blocking issues as resolved by a human', async (t) => {
  const store = new Store(await workspace(t));
  await store.init();
  const p = {
    id: '33333333-3333-3333-3333-333333333333',
    script: sampleScript(),
    source: 'not-read',
    sourceHash: 'hash',
    info: { duration: 3 },
    revision: 1,
    knowledge: '',
    history: [],
    usage: [],
    progress: {},
    review: null,
  };
  store.projects.set(p.id, p);
  await store.save(p);
  const engine = new Engine(store);
  engine.videoContent = async () => ({ type: 'video_url', video_url: { url: 'test-only' } });
  await engine.audit(
    p,
    {
      json: async () => ({
        value: {
          script: sampleScript(),
          issues: [
            {
              scene: 's01',
              severity: 'blocking',
              message: '仍需人工核对',
              resolved: true,
              resolvedBy: 'human',
            },
          ],
        },
      }),
    },
    p.script,
  );
  assert.notEqual(p.review.issues[0].resolved, true);
  assert.throws(() => approve(p, scriptHash(p.script)), /阻断/);
});

test(
  'real render holds the intended source frame, resumes the action and exports every subtitle',
  { timeout: 120000 },
  async (t) => {
    const dir = await workspace(t),
      source = path.join(dir, '变化的画面.mp4');
    await run(FFMPEG, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=320x180:r=30:d=1',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=320x180:r=30:d=1',
      '-f',
      'lavfi',
      '-i',
      'color=c=lime:s=320x180:r=30:d=1',
      '-filter_complex',
      '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
      '-map',
      '[v]',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      source,
    ]);
    const narration =
      '这是一段较长的操作说明，需要完整显示每一个字，不能只保留字幕开头'.repeat(5) +
      ' https://example.com/' +
      'long-path-'.repeat(8);
    const script = normalizeScript(
      {
        title: '画面停顿和字幕完整性',
        chapters: ['操作'],
        scenes: [
          {
            id: 's01',
            chapter: 0,
            kind: 'action',
            heading: '这是一个较长的操作标题，需要避让右侧计时与状态标记',
            source_start: 0.5,
            source_end: 2.5,
            hold_at: 0.75,
            narration,
            min_view_seconds: 2,
          },
        ],
      },
      3,
    );
    const config = structuredClone(DEFAULTS);
    config.style.width = 640;
    const pcm = Buffer.alloc(48000 * 2 * 4);
    for (let i = 0; i < pcm.length / 2; i++)
      pcm.writeInt16LE(Math.round(Math.sin((i * Math.PI * 440) / 48000) * 3000), i * 2);
    const voice = path.join(dir, 'voice.wav');
    await fs.writeFile(voice, wav(pcm));
    const result = await render({
      source,
      info: await probe(source),
      script,
      audio: [{ file: voice, pcm, duration: 4 }],
      config,
      dir,
    });
    assert.equal(result.verification.passed, true);
    const scene = result.plan.scenes[0];
    assert.equal(scene.hold_before, 0.25);
    assert.equal(scene.hold_extra, 2.25);
    assert.equal(
      scene.captions
        .map((c) => c.text)
        .join('')
        .replace(/\s+/g, ''),
      narration.replace(/\s+/g, ''),
    );
    assert(scene.captions.length > 3);
    assert(Math.abs(scene.captions.at(-1).end - scene.audio_end) < 0.001);
    const colors = [];
    for (const [seconds, expectedChannel] of [
      [0.1, 0],
      [2, 0],
      [3.2, 2],
      [3.9, 1],
    ]) {
      const { stdout } = await run(FFMPEG, [
        '-v',
        'error',
        '-ss',
        String(seconds),
        '-i',
        result.output,
        '-frames:v',
        '1',
        '-vf',
        'crop=2:2:320:220,scale=1:1',
        '-pix_fmt',
        'rgb24',
        '-f',
        'rawvideo',
        '-',
      ]);
      assert.equal(stdout.length, 3);
      assert(stdout[expectedChannel] > 180, 'wrong motion/hold frame at ' + seconds);
      colors.push({ seconds, rgb: [...stdout] });
    }
    const artifacts = path.join(__dirname, '../build/generated/quality-check');
    await fs.mkdir(artifacts, { recursive: true });
    await frame(result.output, 2, path.join(artifacts, 'held-frame.png'));
    await fs.writeFile(
      path.join(artifacts, 'report.json'),
      JSON.stringify(
        {
          passed: true,
          colors,
          captionCount: scene.captions.length,
          narrationPreserved: true,
          duration: result.verification.duration,
        },
        null,
        2,
      ),
    );
  },
);
