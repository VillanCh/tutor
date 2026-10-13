const test = require('node:test'),
  assert = require('node:assert/strict');
const http = require('node:http');
const { listModels } = require('../src/models.cjs');
const { DEFAULTS } = require('../src/config.cjs');
const { usageRecord } = require('../src/provider.cjs');

test('model discovery authenticates, normalizes pasted chat routes and redacts failures', async (t) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/failed/models') {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: 'invalid test-secret' }));
    }
    res.end(
      JSON.stringify({
        data: [
          { id: 'deepseek-v4.1-flash' },
          { id: 'qwen3.8-omni-flash' },
          { id: 'deepseek-v4.1-flash' },
          {},
        ],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  assert.deepEqual(
    await listModels({ chatBaseUrl: origin + '/v1/chat/completions' }, 'test-secret'),
    ['deepseek-v4.1-flash', 'qwen3.8-omni-flash'],
  );
  assert.deepEqual(requests[0], { url: '/v1/models', authorization: 'Bearer test-secret' });
  await assert.rejects(
    listModels({ chatBaseUrl: origin + '/failed' }, 'test-secret'),
    (error) => error.message.includes('401') && !error.message.includes('test-secret'),
  );
  await assert.rejects(
    listModels({ chatBaseUrl: 'https://user:pass@example.com/v1' }, 'key'),
    /地址无效/,
  );
});

test('the default DeepSeek editor does not inherit old Qwen prices or report unknown prices as free', () => {
  const record = usageRecord(
    DEFAULTS.roles.editor,
    '改稿',
    { prompt_tokens: 100, completion_tokens: 10 },
    1,
    1,
    1,
  );
  assert.equal(record.usage_reported, true);
  assert.equal(record.estimated_cny, null);
});
