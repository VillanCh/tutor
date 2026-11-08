const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store.cjs');
const { Engine } = require('../src/engine.cjs');
const { Provider } = require('../src/provider.cjs');
const { DEFAULTS, validateConfig } = require('../src/config.cjs');
const { managedConfig } = require('../src/managed-config.cjs');
const { startServer } = require('../src/server.cjs');
const { MODEL_DEFAULTS, editorModelOptions } = require('../src/model-policy.mjs');
const { TestAccount, confirmModels } = require('./helpers/account.cjs');
async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-model-policy-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}
const modelIds = (config) =>
  Object.fromEntries(Object.entries(config.roles).map(([role, entry]) => [role, entry.model]));

test('new workspaces use the requested three models and require explicit one-time confirmation', async (t) => {
  const store = new Store(await temporary(t), new TestAccount());
  await store.init();
  assert.deepEqual(modelIds(store.config), MODEL_DEFAULTS);
  assert.equal(store.publicConfig().modelPolicy.requiresConfirmation, true);
  await assert.rejects(store.settings(store.publicConfig().config), /请先确认/);
  assert.equal(store.modelPolicy.confirmed, false);
  await confirmModels(store);
  assert.equal(store.publicConfig().modelPolicy.requiresConfirmation, false);
});

test('legacy and previously customized models migrate once, preserve speech settings and persist confirmation', async (t) => {
  const dir = await temporary(t);
  const old = structuredClone(DEFAULTS);
  old.roles.vision.model = 'old-vision';
  old.roles.editor.model = 'QWEN3.8-MAX';
  old.roles.speech.model = 'old-speech';
  old.speech.voice = 'xuyanchu_v3.1';
  old.speech.rate = 1.15;
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify(old));
  const store = new Store(dir, new TestAccount());
  await store.init();
  assert.deepEqual(modelIds(store.config), MODEL_DEFAULTS);
  assert.equal(store.config.speech.voice, old.speech.voice);
  assert.equal(store.config.speech.rate, old.speech.rate);
  const beforeConfirmation = new Store(dir, new TestAccount());
  await beforeConfirmation.init();
  assert.equal(beforeConfirmation.modelPolicy.confirmed, false);
  await confirmModels(store);
  const changed = store.publicConfig().config;
  changed.roles.editor.model = 'qwen3.8-flash';
  await store.settings(changed);
  const reloaded = new Store(dir, new TestAccount());
  await reloaded.init();
  assert.equal(reloaded.modelPolicy.confirmed, true);
  assert.equal(reloaded.config.roles.editor.model, 'qwen3.8-flash');
});

test('blocked aliases and case variants are rejected in every role before any model request', async () => {
  for (const name of ['qwen3.8-max', 'QWEN3.8-MAX', 'vendor/qwen3.8-max', 'qwen3.8-max-latest']) {
    for (const role of ['vision', 'editor', 'speech']) {
      const config = structuredClone(DEFAULTS);
      config.roles[role].model = name;
      assert.throws(() => validateConfig(config), /已停用/);
      assert.throws(() => managedConfig(config), /已停用/);
      const provider = new Provider(config, {}, () => assert.fail('No request may be recorded'));
      await assert.rejects(
        provider.request(config.roles[role], 'blocked', { model: name }),
        /已停用/,
      );
    }
  }
});

test('model tasks are blocked by both the HTTP endpoint and engine before confirmation', async (t) => {
  const server = await startServer({ dataDir: await temporary(t), account: new TestAccount() });
  t.after(() => server.close());
  const id = '11111111-1111-1111-1111-111111111111';
  server.store.projects.set(id, { id, job: null });
  server.engine.provider = () => assert.fail('A provider must not be constructed');
  const response = await fetch(server.url + '/api/projects/' + id + '/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tutor-Token': server.token },
    body: '{}',
  });
  assert.equal(response.status, 409);
  await assert.rejects(new Engine(server.store).prepare(id), /请先确认/);
});

test('autocomplete lists only distinct usable models and never offers the blocked model', () => {
  const options = editorModelOptions([
    { id: 'qwen3.8-max' },
    { id: 'vendor/QWEN3.8-MAX' },
    { id: MODEL_DEFAULTS.vision },
    { id: MODEL_DEFAULTS.speech },
    { id: MODEL_DEFAULTS.editor },
    { id: 'text-embedding-3' },
    { id: 'qwen3.8-flash', name: 'Flash' },
    { id: 'qwen3.8-flash' },
  ]);
  assert.deepEqual(
    options.map((model) => model.id),
    [MODEL_DEFAULTS.editor, 'qwen3.8-flash'],
  );
  assert.equal(options[0].recommended, true);
});

test('settings accept catalogue selections, reject arbitrary IDs and keep vision and speech fixed', async (t) => {
  const store = new Store(await temporary(t), new TestAccount());
  await store.init();
  const config = store.publicConfig().config;
  config.roles.editor.model = 'invented-model';
  await assert.rejects(store.settings(config, undefined, true), /账户目录/);
  config.roles.editor.model = 'qwen3.8-max';
  await assert.rejects(store.settings(config, undefined, true), /已停用/);
  config.roles.editor.model = 'qwen3.8-flash';
  config.roles.vision.model = 'custom-vision';
  config.roles.speech.model = 'custom-speech';
  await store.settings(config, undefined, true);
  assert.equal(store.config.roles.vision.model, MODEL_DEFAULTS.vision);
  assert.equal(store.config.roles.speech.model, MODEL_DEFAULTS.speech);
  assert.equal(store.config.roles.editor.model, 'qwen3.8-flash');
});

test('reintroduced blocked local settings are migrated again and require a new confirmation', async (t) => {
  const dir = await temporary(t),
    store = new Store(dir, new TestAccount());
  await store.init();
  await confirmModels(store);
  const saved = JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'));
  saved.roles.editor.model = 'qwen3.8-max';
  await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify(saved));
  const restored = new Store(dir, new TestAccount());
  await restored.init();
  assert.equal(restored.config.roles.editor.model, MODEL_DEFAULTS.editor);
  assert.equal(restored.modelPolicy.confirmed, false);
});

test('DeepSeek rewriting disables thinking with its own parameters and Qwen keeps its protocol', async () => {
  const config = managedConfig(),
    provider = new Provider(config, {}, () => {});
  const requests = [];
  provider.request = async (_role, _stage, payload) => {
    requests.push(payload);
    return '{"ok":true}';
  };
  await provider.json('editor', 'script', []);
  assert.deepEqual(requests[0].thinking, { type: 'disabled' });
  assert(!('enable_thinking' in requests[0]));
  assert(!('reasoning_effort' in requests[0]));
  await provider.json('vision', 'video', []);
  assert.equal(requests[1].enable_thinking, false);
});
