const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DEFAULTS, validateConfig } = require('../src/config.cjs');
const { Provider } = require('../src/provider.cjs');
const {
  customSource,
  updateSource,
  selectRoleSource,
  speechCacheRole,
  requestEndpoint,
} = require('../src/model-sources.mjs');

test('legacy workspace endpoints, independent credentials and cached speech survive migration', () => {
  const old = structuredClone(DEFAULTS);
  old.roles.vision.baseUrl = 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
  old.roles.editor.baseUrl = 'https://editor.example.com/v1';
  old.roles.editor.credential = 'editor-key';
  old.roles.speech.baseUrl =
    'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';
  const config = validateConfig(old);
  assert.equal(config.sources[0].name, '百炼');
  for (const role of ['vision', 'editor', 'speech']) {
    assert.equal(config.roles[role].baseUrl, old.roles[role].baseUrl);
    assert.equal(config.roles[role].credential, old.roles[role].credential);
    assert.equal(config.roles[role].protocol, old.roles[role].protocol);
  }
  assert.equal(
    JSON.stringify(speechCacheRole(config.roles.speech)),
    JSON.stringify(old.roles.speech),
  );
  assert.deepEqual(validateConfig(config), config);
});

test('source changes propagate to its models and pasted complete routes are normalized', () => {
  let config = validateConfig(DEFAULTS);
  const typing = updateSource(config, 'bailian', { chatBaseUrl: 'https:/' });
  assert.equal(typing.sources[0].chatBaseUrl, 'https:/');
  config = updateSource(config, 'bailian', {
    chatBaseUrl: 'https://example.com/v1/chat/completions/',
  });
  config = validateConfig(config);
  assert.equal(config.roles.vision.baseUrl, 'https://example.com/v1');
  assert.equal(config.roles.editor.baseUrl, 'https://example.com/v1');
  assert.equal(requestEndpoint(config.roles.editor), 'https://example.com/v1/chat/completions');
  assert.equal(config.roles.speech.protocol, 'dashscope-tts');
});

test('unused blank custom sources are allowed; selected sources must be complete and unique', () => {
  const config = validateConfig(DEFAULTS);
  config.sources.push(customSource('custom-empty'));
  validateConfig(config);
  assert.throws(
    () => validateConfig(selectRoleSource(config, 'editor', 'custom-empty')),
    /缺少Chat接口/,
  );
  config.sources.push({ ...config.sources[0] });
  assert.throws(() => validateConfig(config), /重复/);
  config.sources.pop();
  config.roles.editor.sourceId = 'missing';
  assert.throws(() => validateConfig(config), /源不存在/);
});

test('custom source sends chat and speech to actual routes with its own key', async (t) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({
      path: req.url,
      authorization: req.headers.authorization,
      body: JSON.parse(body),
    });
    if (req.url.endsWith('/audio/speech')) {
      res.end(Buffer.from('test-wav-bytes'));
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.end(
      'data: {"choices":[{"delta":{"content":"{\\\"ok\\\":true}"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4}}\n\ndata: [DONE]\n\n',
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1';
  let config = validateConfig(DEFAULTS);
  const source = {
    ...customSource('custom-local', '测试兼容源'),
    chatBaseUrl: baseUrl,
    speechBaseUrl: baseUrl + '/audio/speech',
  };
  config.sources.push(source);
  config = selectRoleSource(config, 'editor', source.id);
  config = selectRoleSource(config, 'speech', source.id);
  config = validateConfig(config);
  const records = [],
    progress = [];
  const provider = new Provider(
    config,
    { default: 'unused', [source.credential]: 'test-local-key' },
    async (record) => records.push(record),
    (event) => progress.push(event),
  );
  assert.equal(
    await provider.request(
      config.roles.editor,
      'edit',
      { model: config.roles.editor.model, stream: true },
      undefined,
      true,
    ),
    '{"ok":true}',
  );
  assert.equal((await provider.speech('教程说明', 'tts')).toString(), 'test-wav-bytes');
  assert.deepEqual(
    requests.map((request) => request.path),
    ['/v1/chat/completions', '/v1/audio/speech'],
  );
  assert(requests.every((request) => request.authorization === 'Bearer test-local-key'));
  assert.equal(requests[1].body.voice, 'longanlang_v3.1');
  assert.equal(records.length, 2);
  assert.equal(progress.at(-1).streamText, '{"ok":true}');
});

test('OpenAI speech records real gateway usage, including already billed delivery failures', async (t) => {
  for (const [name, status, input, output, reported] of [
    ['success', 200, '10', '2', true],
    ['billed download failure', 424, '10', '2', true],
    ['missing usage', 200, null, null, false],
    ['invalid usage', 200, '-1', '2', false],
    ['overflow', 200, '9007199254740991', '2', false],
  ]) {
    await t.test(name, async (t) => {
      const server = http.createServer((req, res) => {
        req.resume();
        if (input !== null) res.setHeader('X-AIBalance-Input-Tokens', input);
        if (output !== null) res.setHeader('X-AIBalance-Output-Tokens', output);
        res.writeHead(status);
        res.end(status === 200 ? 'test-audio' : 'audio_download_failed');
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      t.after(() => new Promise((resolve) => server.close(resolve)));
      const config = validateConfig(DEFAULTS);
      config.roles.speech = {
        ...config.roles.speech,
        protocol: 'openai-speech',
        baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1',
      };
      const records = [];
      const provider = new Provider(
        config,
        { [config.roles.speech.credential]: 'test-key' },
        async (record) => records.push(record),
      );
      if (status === 200)
        assert.equal((await provider.speech('hello', 'tts')).toString(), 'test-audio');
      else await assert.rejects(provider.speech('hello', 'tts'), /424/);
      assert.equal(records.length, 1);
      assert.equal(records[0].usage_reported, reported);
      assert.equal(records[0].input_tokens, reported ? 10 : 0);
      assert.equal(records[0].output_tokens, reported ? 2 : 0);
      if (reported) assert.equal(records[0].total_tokens, 12);
      else assert.equal(records[0].estimated_cny, null);
      assert.equal(Boolean(records[0].error), status !== 200);
    });
  }
});
