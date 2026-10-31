const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { startServer } = require('../src/server.cjs');
const { normalizeScript } = require('../src/script.cjs');
const { parseReferences } = require('../src/references.cjs');
const { FFMPEG, run } = require('../src/media.cjs');
const png = createCanvas(16, 12).toBuffer('image/png');
const reference = { name: '截图.png', dataUrl: 'data:image/png;base64,' + png.toString('base64') };
function project() {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    title: '附件验收',
    source: 'none',
    sourceHash: 'test',
    info: { duration: 2, width: 64, height: 64 },
    knowledge: '',
    createdAt: new Date().toISOString(),
    status: 'review',
    revision: 1,
    approval: { revision: 1 },
    history: [],
    usage: [],
    chat: [],
    progress: {},
    job: null,
    script: normalizeScript(
      {
        title: '附件验收',
        chapters: ['演示'],
        scenes: [
          {
            id: 's1',
            kind: 'action',
            chapter: 0,
            heading: '演示',
            source_start: 0,
            source_end: 1,
            narration: '演示操作。',
            min_view_seconds: 1,
            silent_tail_seconds: 0.7,
          },
        ],
      },
      2,
    ),
  };
}
async function studio(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-files-test-'));
  const s = await startServer({ dataDir: dir });
  t.after(async () => {
    s.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return s;
}
test('reference validation rejects unsupported formats, corrupted signatures and excessive counts', () => {
  assert.equal(parseReferences([reference])[0].buffer.length, png.length);
  assert.throws(() => parseReferences(Array(5).fill(reference)), /最多/);
  assert.throws(
    () => parseReferences([{ dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }]),
    /仅支持/,
  );
  assert.throws(
    () => parseReferences([{ dataUrl: 'data:image/png;base64,SGVsbG8=' }]),
    /内容与格式/,
  );
});
test('image-only edits pass screenshots to vision, their interpretation to editing, and preserve accessible image history', async (t) => {
  const s = await studio(t),
    p = project(),
    calls = [];
  s.store.projects.set(p.id, p);
  await s.store.save(p);
  s.engine.videoContent = async () => ({
    type: 'video_url',
    video_url: { url: 'data:video/mp4;base64,AA==' },
  });
  s.engine.provider = () => ({
    json: async (role, stage, messages) => {
      calls.push({ role, stage, messages });
      return {
        value:
          stage === '参考图片理解'
            ? { summary: '附图指出按钮位置需要修正', changes: ['修正按钮位置'] }
            : { ...p.script, issues: [], summary: '已复核' },
      };
    },
  });
  await s.engine.edit(p.id, '', [reference]);
  assert.equal(p.approval, null);
  assert.equal(p.revision, 2);
  assert.equal(calls[0].role, 'vision');
  assert.equal(calls[0].messages[0].content[1].image_url.url, reference.dataUrl);
  assert.equal(calls[1].role, 'editor');
  assert.match(calls[1].messages[0].content, /按钮位置需要修正/);
  assert(calls[2].messages[1].content.some((part) => part.image_url?.url === reference.dataUrl));
  const image = p.chat[0].attachments[0];
  const response = await fetch(s.url + '/api/projects/' + p.id + '/reference/' + image.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  const saved = JSON.parse(await fs.readFile(path.join(s.store.dir(p.id), 'project.json'), 'utf8'));
  assert.equal(saved.chat[0].attachments[0].name, '截图.png');
  assert(!JSON.stringify(saved).includes(reference.dataUrl));
  assert.equal(
    (await fetch(s.url + '/api/projects/' + p.id + '/reference/not-an-image')).status,
    400,
  );
});
test('HTTP rejects malformed attachments before starting a model job', async (t) => {
  const s = await studio(t),
    p = project();
  s.store.projects.set(p.id, p);
  let started = false;
  s.engine.edit = () => {
    started = true;
  };
  const response = await fetch(s.url + '/api/projects/' + p.id + '/edit', {
    method: 'POST',
    headers: { 'X-Tutor-Token': s.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '修改', images: [{ dataUrl: 'not-an-image' }] }),
  });
  assert.equal(response.status, 400);
  assert.equal(started, false);
});
test('video uploads require authorization, validate actual video bytes and preserve the full file', async (t) => {
  const s = await studio(t);
  const file = path.join(s.store.root, 'fixture.mp4');
  await run(FFMPEG, [
    '-hide_banner',
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=64x64:rate=10:duration=0.5',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    file,
  ]);
  const bytes = await fs.readFile(file);
  const url = s.url + '/api/uploads/video?name=' + encodeURIComponent('录屏.mp4');
  assert.equal((await fetch(url, { method: 'POST', body: bytes })).status, 400);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'X-Tutor-Token': s.token },
    body: bytes,
  });
  assert.equal(response.status, 200);
  const { source } = await response.json();
  assert.deepEqual(await fs.readFile(source), bytes);
  const invalid = await fetch(url, {
    method: 'POST',
    headers: { 'X-Tutor-Token': s.token },
    body: 'not video data',
  });
  assert.equal(invalid.status, 400);
  assert.equal((await fs.readdir(path.join(s.store.root, 'uploads'))).length, 1);
});
