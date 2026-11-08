const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('../src/server.cjs');
const { Store } = require('../src/store.cjs');
const { TestAccount } = require('./helpers/account.cjs');
const { GUIDE_VERSION } = require('../src/guide-content.mjs');

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
  } finally {
    server.close();
  }
});
