const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  YakcoolAccount,
  ORIGIN,
  GATEWAY,
  COOKIE,
  validCookie,
  loginURLAllowed,
  trustedGateway,
} = require('../src/yakcool.cjs');
const { managedConfig } = require('../src/managed-config.cjs');
const { DEFAULTS } = require('../src/config.cjs');
const { startServer } = require('../src/server.cjs');
const { Engine } = require('../src/engine.cjs');
const { Store } = require('../src/store.cjs');

const cookie = {
  name: COOKIE,
  value: 'test-public-session-secret',
  domain: 'yakcool.com',
  secure: true,
  expirationDate: Date.now() / 1000 + 3600,
};
const keyValue = 'unit-test-hidden-business-key';
function fixture(overrides = {}) {
  const calls = [],
    saved = [];
  const routes = {
    '/api/auth/me': { user: { id: 7, display_name: '测试用户' }, staff_session: false },
    '/api/user/dashboard': {
      user: { id: 7 },
      gateway_url: GATEWAY,
      ai_service_credit: {
        token_remaining: 123450000,
        weighted_tokens_per_rmb: 10000000,
        token_used: 678900000,
      },
    },
    '/api/user/api-keys': { keys: [{ id: 1, label: 'Tutor', active: true, api_key: keyValue }] },
    '/api/user/models': { models: [{ model_id: 'deepseek-v4.1-flash', display_name: 'DeepSeek' }] },
    '/api/auth/logout': { ok: true },
    ...overrides,
  };
  const io = {
    load: async () => null,
    save: async (data) => saved.push(structuredClone(data)),
    clear: async () => saved.push(null),
  };
  const request = async (url, options) => {
    assert.equal(new URL(url).origin, ORIGIN);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Cookie, COOKIE + '=' + cookie.value);
    calls.push({ route: new URL(url).pathname, method: options.method, body: options.body });
    const result = routes[new URL(url).pathname];
    if (typeof result === 'function') return result(options);
    return new Response(JSON.stringify(result ?? {}), { status: 200 });
  };
  return {
    account: new YakcoolAccount({ sessionIO: io, request }),
    calls,
    saved,
    io,
    request,
    routes,
  };
}
async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-yakcool-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('YAKCOOL login obtains a backend-only service credential and exposes only balance and identity', async () => {
  const { account, calls, saved } = fixture();
  await account.login(cookie);
  assert.equal(account.public().authenticated, true);
  assert.equal(account.public().balance, 12.345);
  assert.deepEqual(account.public().user, { id: '7', name: '测试用户' });
  assert.equal(account.credentials().yakcool, keyValue);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].value, cookie.value);
  assert(!JSON.stringify(saved).includes(keyValue));
  const publicData = JSON.stringify(account.public());
  for (const forbidden of [
    cookie.value,
    keyValue,
    'token_used',
    'token_remaining',
    'usage',
    'cost',
    'api_key',
  ])
    assert(!publicData.includes(forbidden));
  assert(!calls.some((call) => call.route.includes('usage') || call.method !== 'GET'));
  assert.equal(account.redact(cookie.value + ' / ' + keyValue), '[REDACTED] / [REDACTED]');
});

test('missing account balance stays unknown instead of becoming zero', async () => {
  const { account } = fixture({
    '/api/user/dashboard': { user: { id: 7 }, ai_service_credit: { status: 'uninitialized' } },
  });
  await account.login(cookie);
  assert.equal(account.public().balance, null);
});

test('a dedicated Tutor credential is provisioned only when the account has no active key', async () => {
  let created = 0;
  const data = fixture({
    '/api/user/api-keys': (options) => {
      if (options.method === 'GET') return new Response(JSON.stringify({ keys: [] }));
      created++;
      assert.deepEqual(JSON.parse(options.body), { label: 'Tutor' });
      return new Response(JSON.stringify({ key: { api_key: keyValue } }));
    },
  });
  await data.account.login(cookie);
  assert.equal(created, 1);
  assert.equal(data.account.credentials().yakcool, keyValue);
  assert(!JSON.stringify(data.account.public()).includes(keyValue));
});

test('staff sessions, foreign cookies and cross-origin gateways are rejected', async () => {
  assert(!validCookie({ ...cookie, name: 'yakcool_staff_session' }));
  assert(!validCookie({ ...cookie, domain: 'yakcool.com.evil.test' }));
  assert(!validCookie({ ...cookie, secure: false }));
  assert(!validCookie({ ...cookie, value: 'value; injected=yes' }));
  assert(!validCookie({ ...cookie, expirationDate: 1 }));
  const staff = fixture({ '/api/auth/me': { user: { id: 7 }, staff_session: true } });
  await assert.rejects(staff.account.login(cookie), /公开用户/);
  assert.equal(staff.account.public().authenticated, false);
  const foreign = fixture({
    '/api/user/dashboard': { user: { id: 7 }, gateway_url: 'https://evil.test' },
  });
  await assert.rejects(foreign.account.login(cookie), /不受信任/);
  assert.throws(() => foreign.account.credentials(), /登录/);
});

test('login navigation permits official QR providers and blocks credential tricks and download origins', () => {
  for (const url of [
    'https://yakcool.com/login',
    'https://open.weixin.qq.com/connect/qrconnect',
    'https://aibalance.yaklang.com/',
  ])
    assert(loginURLAllowed(url));
  for (const url of [
    'http://yakcool.com/login',
    'https://yakcool.com.evil.test/',
    'https://user:pass@yakcool.com/',
    'file:///tmp/key',
    'https://yakcool.com:8443/',
  ])
    assert(!loginURLAllowed(url));
  assert.equal(trustedGateway(GATEWAY), GATEWAY);
  assert.throws(() => trustedGateway(GATEWAY + '/v1?key=secret'));
});

test('expired sessions remove credentials and cannot fall back to manually configured keys', async () => {
  const data = fixture();
  await data.account.login(cookie);
  data.routes['/api/auth/me'] = () => new Response('{}', { status: 401 });
  data.account.verifiedAt = 1;
  await assert.rejects(data.account.requireLogin({ fresh: true }), /过期/);
  assert.equal(data.account.public().authenticated, false);
  assert.equal(data.saved.at(-1), null);
  assert.throws(() => data.account.credentials(), /登录/);
});

test('transient restore failures preserve the encrypted session for retry', async () => {
  const data = fixture();
  data.io.load = async () => cookie;
  data.routes['/api/auth/me'] = () => new Response('{}', { status: 503 });
  await data.account.init();
  assert.equal(data.account.public().status, 'unavailable');
  assert.equal(data.saved.length, 0);
  await assert.rejects(data.account.requireLogin(), /登录/);
  data.routes['/api/auth/me'] = { user: { id: 7 }, staff_session: false };
  await data.account.refresh();
  assert.equal(data.account.public().authenticated, true);
});

test('temporary balance refresh failures retain an existing login without silently showing a fresh balance', async () => {
  const data = fixture();
  await data.account.login(cookie);
  data.routes['/api/user/dashboard'] = () => new Response('{}', { status: 503 });
  await assert.rejects(data.account.refresh(), /暂时不可用/);
  assert.equal(data.account.public().authenticated, true);
  assert.equal(data.account.public().balanceStale, true);
  await data.account.requireLogin();
  assert.equal(data.account.credentials().yakcool, keyValue);
});

test('logout wins against an in-flight refresh and never restores a stale credential', async () => {
  const data = fixture();
  await data.account.login(cookie);
  let release;
  data.routes['/api/user/dashboard'] = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const refreshing = data.account.refresh();
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  await data.account.logout();
  release(new Response(JSON.stringify({ user: { id: 7 }, gateway_url: GATEWAY })));
  await refreshing;
  assert.equal(data.account.public().authenticated, false);
  assert.throws(() => data.account.credentials(), /登录/);
  assert.equal(data.saved.at(-1), null);
});

test('all private HTTP routes require account login even with a valid local CSRF token', async (t) => {
  const server = await startServer({ dataDir: await temporary(t) });
  t.after(() => server.close());
  for (const route of ['/api/projects', '/api/settings', '/api/drafts/import', '/api/events'])
    assert.equal((await fetch(server.url + route)).status, 401);
  const headers = { 'Content-Type': 'application/json', 'X-Tutor-Token': server.token };
  const response = await fetch(server.url + '/api/settings', {
    method: 'POST',
    headers,
    body: JSON.stringify({ keys: { yakcool: 'manual-key' }, config: DEFAULTS }),
  });
  assert.equal(response.status, 401);
  assert.equal((await fetch(server.url + '/')).status, 200);
  assert.equal((await (await fetch(server.url + '/api/account')).json()).authenticated, false);
});

test('account settings cannot redirect credentials or enable key downloads and cost telemetry', async (t) => {
  const data = fixture();
  await data.account.login(cookie);
  const server = await startServer({ dataDir: await temporary(t), account: data.account });
  t.after(() => server.close());
  const headers = { 'Content-Type': 'application/json', 'X-Tutor-Token': server.token };
  let result = await fetch(server.url + '/api/settings', {
    method: 'POST',
    headers,
    body: JSON.stringify({ keys: { yakcool: 'manual' }, config: DEFAULTS }),
  });
  assert.equal(result.status, 400);
  const malicious = structuredClone(DEFAULTS);
  malicious.roles.vision.baseUrl = 'https://evil.test';
  malicious.sources = [{ id: 'evil', chatBaseUrl: 'https://evil.test' }];
  malicious.apiKey = 'injected';
  result = await fetch(server.url + '/api/settings', {
    method: 'POST',
    headers,
    body: JSON.stringify({ config: malicious, confirmModelUpdate: true }),
  });
  assert.equal(result.status, 200);
  const publicSettings = JSON.stringify(await result.json());
  for (const forbidden of [
    'evil.test',
    keyValue,
    cookie.value,
    'injected',
    'credentialStatus',
    'inputPrice',
  ])
    assert(!publicSettings.includes(forbidden));
  assert.equal(server.store.config.roles.vision.baseUrl, GATEWAY + '/v1');
  const id = '44444444-4444-4444-4444-444444444444';
  const p = {
    id,
    usage: [{ estimated_cny: 100, input_tokens: 2000 }],
    progress: { streamEstimate: 123 },
    script: null,
    output: { dir: server.store.dir(id), plan: { models: { secret: keyValue }, scenes: [] } },
  };
  server.store.projects.set(id, p);
  const publicProject = await (await fetch(server.url + '/api/projects/' + id)).json();
  assert(!('usage' in publicProject));
  assert(!('totals' in publicProject));
  assert(!('streamEstimate' in publicProject.progress));
  assert(!('models' in publicProject.output.plan));
  for (const file of ['cost.json', 'config.json'])
    assert.equal(
      (await fetch(server.url + '/api/projects/' + id + '/output?file=' + file)).status,
      400,
    );
  assert.equal((await fetch(server.url + '/api/user/api-keys')).status, 404);
});

test('direct engine tasks also enforce login and managed model endpoints', async (t) => {
  const store = new Store(await temporary(t));
  await store.init();
  const engine = new Engine(store);
  await assert.rejects(engine.prepare('not-a-project'), /登录 YAKCOOL/);
  const config = managedConfig({ ...DEFAULTS, sources: [], apiKey: 'never-used' });
  for (const role of Object.values(config.roles))
    assert.equal(new URL(role.baseUrl).origin, GATEWAY);
  assert.equal(config.roles.speech.protocol, 'dashscope-tts');
});
