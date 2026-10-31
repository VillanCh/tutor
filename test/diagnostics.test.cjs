const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Provider } = require('../src/provider.cjs');
const { Engine } = require('../src/engine.cjs');
const { DEFAULTS } = require('../src/config.cjs');

test('HTTP failure preserves request context and redacts credentials before saving or throwing', async (t) => {
  const key = 'private-test-key';
  const server = http.createServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { code: 'invalid_api_key', message: key },
        request_id: 'request-401',
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const config = structuredClone(DEFAULTS);
  config.roles.vision.baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1';
  const records = [];
  const provider = new Provider(config, { default: key }, async (r) => records.push(r));
  await assert.rejects(provider.request(config.roles.vision, '视频分析与初稿', {}), (error) => {
    assert.match(error.message, /401/);
    assert.equal(error.details.httpStatus, 401);
    assert.equal(error.details.code, 'invalid_api_key');
    assert.equal(error.details.requestId, 'request-401');
    assert(!JSON.stringify(error.details).includes(key));
    assert(!error.message.includes(key));
    return true;
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].error_details.requestId, 'request-401');
  assert.match(records[0].error_details.endpoint, /\/v1\/chat\/completions$/);
  assert(!JSON.stringify(records).includes(key));
});

test('network errors expose their underlying cause for diagnosis', async (t) => {
  t.mock.method(global, 'fetch', async () => {
    throw new Error('fetch failed', {
      cause: Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }),
    });
  });
  const records = [];
  const provider = new Provider(DEFAULTS, { default: 'test-key' }, async (r) => records.push(r));
  await assert.rejects(provider.request(DEFAULTS.roles.vision, '连接测试', {}), /ECONNREFUSED/);
  assert.equal(records[0].error_details.code, 'ECONNREFUSED');
});

test('streamed model errors keep their raw packet, error code and request ID', async (t) => {
  t.mock.method(
    global,
    'fetch',
    async () =>
      new Response(
        'data: ' +
          JSON.stringify({
            error: { code: 'stream_error', message: 'test-secret' },
            request_id: 'stream-request',
          }) +
          '\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
  );
  const records = [];
  const provider = new Provider(DEFAULTS, { default: 'test-secret' }, async (r) => records.push(r));
  await assert.rejects(
    provider.request(DEFAULTS.roles.vision, '流式请求', {}, undefined, true),
    /REDACTED/,
  );
  assert.equal(records[0].error_details.requestId, 'stream-request');
  assert.equal(records[0].error_details.code, 'stream_error');
  assert.match(records[0].error, /stream-request/);
  assert(!JSON.stringify(records).includes('test-secret'));
});

test('task failures retain their original stage and retries clear the visible failure', async () => {
  const project = {
    id: 'project',
    usage: [],
    progress: {},
    status: 'draft',
    script: null,
    job: null,
  };
  let saved;
  const store = {
    config: DEFAULTS,
    credentials: { default: 'test-secret' },
    get: () => project,
    save: async (p) => {
      saved = structuredClone(p);
    },
    public: (p) => structuredClone(p),
  };
  const engine = new Engine(store);
  await assert.rejects(
    engine.task('project', '生成并校对剧本', async (p) => {
      engine.publish(p, { stage: 'Omni 生成初版 JSON', percent: 16 });
      throw Object.assign(new Error('401 test-secret'), {
        details: { requestId: 'request-id', code: 'test-secret' },
      });
    }),
    /REDACTED/,
  );
  assert.equal(saved.failure.stage, 'Omni 生成初版 JSON');
  assert.equal(saved.failure.task, '生成并校对剧本');
  assert.equal(saved.failure.details.code, '[REDACTED]');
  assert.equal(saved.failure.cancelled, false);
  assert.equal(saved.progress.stage, '任务失败');
  assert.equal(saved.job, null);
  await engine.task('project', '重试', async (p) => {
    assert.equal(p.error, null);
    assert.equal(p.failure, null);
  });
  assert.equal(saved.failure, null);
});

test('legacy failed projects show the actual API error and failed step instead of completion', async () => {
  const { projectFailure, safeEndpoint } = await import('../src/diagnostics.mjs');
  const { status, activitySteps } = await import('../src/ui/workbench.js');
  const error =
    '模型请求 401：' +
    JSON.stringify({
      error: { code: 'invalid_api_key', message: 'Invalid API key' },
      request_id: 'old-request',
    });
  const project = {
    status: 'draft',
    error,
    progress: { percent: 16, stage: '任务失败' },
    job: null,
    usage: [{ error, stage: '视频分析与初稿', model: 'omni', at: '2026-10-13T00:00:00Z' }],
    history: [],
  };
  const failure = projectFailure(project);
  assert.equal(failure.httpStatus, 401);
  assert.equal(failure.requestId, 'old-request');
  assert.equal(failure.stage, '视频分析与初稿');
  assert.match(failure.summary, /API Key/);
  assert.equal(status(project), '任务失败');
  assert.deepEqual(
    activitySteps(project).map((s) => s.state),
    ['done', 'failed', 'queued', 'queued', 'queued'],
  );
  assert.equal(
    safeEndpoint('https://user:secret@example.com/v1?key=secret#secret'),
    'https://example.com/v1',
  );
});

test('failed retries do not show old steps as completed and failed rendering keeps its task steps', async () => {
  const { activitySteps } = await import('../src/ui/workbench.js');
  const project = {
    status: 'review',
    script: {},
    error: 'failed',
    progress: { percent: 16 },
    failure: { task: '生成并校对剧本', startedAt: '2026-10-13T00:00:00Z' },
    history: [
      { stage: 'initial', at: '2026-10-12T00:00:00Z' },
      { stage: 'max', at: '2026-10-12T00:00:00Z' },
    ],
  };
  assert.equal(activitySteps(project)[1].state, 'failed');
  project.failure.task = '生成旁白与视频';
  assert.equal(activitySteps(project)[1].label, '逐段合成旁白');
  assert.equal(activitySteps(project)[1].state, 'failed');
  project.failure.cancelled = true;
  assert.equal(activitySteps(project)[1].state, 'cancelled');
});
