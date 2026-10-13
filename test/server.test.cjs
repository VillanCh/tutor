const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { startServer } = require('../src/server.cjs'),
  { scriptHash } = require('../src/script.cjs');
test('HTTP rejects unauthenticated mutation and unconfirmed rendering', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-server-')),
    s = await startServer({ dataDir });
  try {
    assert.equal(
      (await fetch(s.url + '/api/settings', { method: 'POST', body: '{}' })).status,
      400,
    );
    const id = '11111111-1111-1111-1111-111111111111',
      p = {
        id,
        title: 'test',
        source: 'none',
        info: { duration: 10 },
        script: { title: 't', chapters: ['c'], scenes: [] },
        revision: 1,
        approval: null,
        status: 'review',
        usage: [],
        progress: {},
        job: null,
        history: [],
        knowledge: '',
      };
    s.store.projects.set(id, p);
    const headers = { 'Content-Type': 'application/json', 'X-Tutor-Token': s.token };
    const response = await fetch(s.url + '/api/projects/' + id + '/render', {
      method: 'POST',
      headers,
      body: '{}',
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /人工确认/);
    const missingSource = await fetch(s.url + '/api/projects/' + id + '/source');
    assert.equal(missingSource.status, 400);
    const approved = await fetch(s.url + '/api/projects/' + id + '/approve', {
      method: 'POST',
      headers,
      body: JSON.stringify({ hash: scriptHash(p.script) }),
    });
    assert.equal(approved.status, 200);
    await fetch(s.url + '/api/projects/' + id + '/knowledge', {
      method: 'POST',
      headers,
      body: '{"knowledge":"changed"}',
    });
    assert.equal(p.approval, null);
    const settings = await (await fetch(s.url + '/api/settings')).json();
    assert(!JSON.stringify(settings).includes('Bearer'));
    assert(!settings.apiKey);
  } finally {
    s.close();
  }
});
