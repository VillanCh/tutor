const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { startServer } = require('../src/server.cjs');
const { Store } = require('../src/store.cjs');
const { scriptHash } = require('../src/script.cjs');
test('a confirmed render publishes a working snapshot and retains approval after failure and restart', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-state-test-'));
  const s = await startServer({ dataDir: dir });
  t.after(async () => {
    s.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const p = {
    id: '00000000-0000-4000-8000-000000000003',
    title: '状态验收',
    source: 'none',
    sourceHash: 'source-id',
    knowledge: '',
    script: { title: 't', chapters: ['c'], scenes: [] },
    revision: 2,
    status: 'review',
    progress: {},
    usage: [],
    history: [],
    chat: [],
    job: null,
  };
  s.store.projects.set(p.id, p);
  const headers = { 'X-Tutor-Token': s.token, 'Content-Type': 'application/json' };
  const confirmed = await (
    await fetch(s.url + '/api/projects/' + p.id + '/approve', {
      method: 'POST',
      headers,
      body: JSON.stringify({ hash: scriptHash(p.script) }),
    })
  ).json();
  s.engine.generate = () =>
    s.engine.task(p.id, '生成旁白与视频', async (value) => {
      s.engine.publish(value, { stage: '配音 1 / 2', percent: 4 });
      throw Error('配音请求失败：连接重置');
    });
  const completed = new Promise((resolve) =>
    s.engine.on('project', (value) => {
      if (value.error) resolve(value);
    }),
  );
  const started = await (
    await fetch(s.url + '/api/projects/' + p.id + '/render', {
      method: 'POST',
      headers,
      body: JSON.stringify({ hash: confirmed.scriptHash }),
    })
  ).json();
  assert.equal(started.started, true);
  assert(started.project.job);
  assert.equal(started.project.status, 'working');
  assert(started.project.stateVersion > confirmed.stateVersion);
  const failed = await completed;
  assert.equal(failed.status, 'approved');
  assert.equal(failed.approvalValid, true);
  assert.equal(failed.job, null);
  assert.match(failed.error, /连接重置/);
  assert.equal(failed.failure.stage, '配音 1 / 2');
  assert.equal(failed.approval.confirmedAt, confirmed.approval.confirmedAt);
  await s.store.writes.get(p.id);
  const reloaded = new Store(dir);
  await reloaded.init();
  assert.equal(reloaded.public(reloaded.get(p.id)).approvalValid, true);
  const { mergeProjects, phase } = await import('../src/ui/workbench.js');
  assert.equal(mergeProjects([failed], [confirmed])[0].error, failed.error);
  assert.equal(mergeProjects([started.project], [failed])[0].status, 'approved');
  assert.equal(phase(failed), 2);
  const stale = await fetch(s.url + '/api/projects/' + p.id + '/render', {
    method: 'POST',
    headers,
    body: JSON.stringify({ hash: 'stale-hash' }),
  });
  assert.equal(stale.status, 400);
  const rejected = await stale.json();
  assert.match(rejected.error, /剧本已更新/);
  assert.equal(rejected.project.approvalValid, true);
});
test('concurrent project saves persist the latest snapshot without temporary-file collisions', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-save-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  const p = { id: '00000000-0000-4000-8000-000000000004' };
  const pending = [];
  for (let i = 1; i <= 25; i++) {
    p.stateVersion = i;
    pending.push(store.save(p));
  }
  await Promise.all(pending);
  const saved = JSON.parse(await fs.readFile(path.join(store.dir(p.id), 'project.json'), 'utf8'));
  assert.equal(saved.stateVersion, 25);
  assert.deepEqual(await fs.readdir(store.dir(p.id)), ['project.json']);
});

test('reopening an interrupted render explains the interruption and preserves the confirmed revision', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-interrupted-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  const p = {
    id: '00000000-0000-4000-8000-000000000006',
    script: { title: '已确认剧本', chapters: ['c'], scenes: [] },
    revision: 2,
    sourceHash: 'source-id',
    knowledge: '',
    status: 'review',
    progress: { stage: '旁白 2 / 3', percent: 12 },
    usage: [],
    stateVersion: 4,
  };
  require('../src/script.cjs').approve(p, scriptHash(p.script));
  const approval = structuredClone(p.approval);
  p.status = 'working';
  p.job = { label: '生成旁白与视频', startedAt: new Date().toISOString() };
  await store.save(p);
  const reopened = new Store(dir);
  await reopened.init();
  const current = reopened.public(reopened.get(p.id));
  assert.equal(current.job, null);
  assert.equal(current.status, 'approved');
  assert.equal(current.approvalValid, true);
  assert.deepEqual(current.approval, approval);
  assert.match(current.error, /进程中断/);
  assert.equal(current.failure.stage, '旁白 2 / 3');
  assert.equal(current.failure.details.code, 'PROCESS_INTERRUPTED');
  const again = new Store(dir);
  await again.init();
  assert.equal(again.get(p.id).failure.at, current.failure.at);
});
