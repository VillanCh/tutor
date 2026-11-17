const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('../src/server.cjs');
const { Store } = require('../src/store.cjs');
const { TestAccount } = require('./helpers/account.cjs');
const {
  GUIDE_VERSION,
  GUIDE_FEATURES,
  GUIDE_TARGETS,
  GUIDE_GROUPS,
} = require('../src/guide-content.mjs');

test('customization Bento covers real entry points and complete save/review workflows with valid navigation targets', () => {
  const ids = new Set(GUIDE_FEATURES.map((f) => f.id)),
    groups = new Set(GUIDE_GROUPS.map((g) => g[0]));
  assert.equal(ids.size, GUIDE_FEATURES.length);
  for (const f of GUIDE_FEATURES) {
    assert(ids.has(f.next));
    assert(groups.has(f.group));
    assert(f.steps.length >= 3);
  }
  for (const id of ['background', 'layout', 'transition', 'header']) {
    const f = GUIDE_FEATURES.find((x) => x.id === id);
    assert.equal(f.group, 'customize');
    assert.equal(f.target, GUIDE_TARGETS[id]);
    assert(f.entry && f.action && f.examples.length);
    const instructions = f.steps.flat().join(' ');
    assert(instructions.includes('保存') || instructions.includes('应用'));
    assert(instructions.includes('审核'));
    assert(instructions.includes('制作'));
  }
  assert.equal(GUIDE_TARGETS.background.section, 'frame');
  assert.equal(GUIDE_TARGETS.transition.section, 'transition');
  assert.equal(GUIDE_TARGETS.header.section, 'header');
  assert.equal(GUIDE_TARGETS.branding.section, 'ads');
  assert.equal(GUIDE_TARGETS.layout.requiresProject, true);
});

test('first-launch guide is available before login, persists across local ports and cannot bypass project permissions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-guide-'));
  const account = new TestAccount(false);
  const server = await startServer({ dataDir: root, account });
  try {
    assert.deepEqual(await (await fetch(server.url + '/api/guide')).json(), {
      version: GUIDE_VERSION,
      seen: false,
    });
    assert.equal((await fetch(server.url + '/api/projects')).status, 401);
    assert.equal(
      (await fetch(server.url + '/api/guide', { method: 'POST', body: '{}' })).status,
      400,
    );
    const dismiss = (version) =>
      fetch(server.url + '/api/guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tutor-Token': server.token },
        body: JSON.stringify({ version }),
      });
    assert.equal((await dismiss(-1)).status, 400);
    assert.equal(server.store.guideState.seen, false);
    const responses = await Promise.all([
      dismiss(GUIDE_VERSION),
      dismiss(GUIDE_VERSION),
      dismiss(GUIDE_VERSION),
    ]);
    assert(responses.every((response) => response.status === 200));
    const fresh = new Store(root, account);
    await fresh.init();
    assert.deepEqual(fresh.guideState, { version: GUIDE_VERSION, seen: true });
    assert.equal((await fetch(server.url + '/api/projects')).status, 401);
    assert.equal(account.authenticated, false);
    await fs.writeFile(
      path.join(root, 'guide-state.json'),
      JSON.stringify({ version: GUIDE_VERSION - 1, seen: true }),
    );
    const upgraded = new Store(root, account);
    await upgraded.init();
    assert.equal(upgraded.guideState.seen, false, 'a new guide version can be shown again');
    assert.equal(
      upgraded.guideState.updated,
      true,
      'returning users see the customization update while keeping their workspace',
    );
  } finally {
    server.close();
  }
});
