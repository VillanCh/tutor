const { baseEndpoint } = require('./model-sources.mjs');
const { safeEndpoint } = require('./diagnostics.mjs');

async function listModels(source, key) {
  const url = new URL(baseEndpoint(source.chatBaseUrl) + '/models');
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error('模型源接口地址无效');
  if (typeof key !== 'string' || !key.trim() || key.length > 4096)
    throw Error('请先配置此模型源的 API Key');
  try {
    const response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + key },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw Error(
        '加载模型列表失败（HTTP ' +
          response.status +
          '）：' +
          (await response.text()).slice(0, 1500),
      );
    const body = await response.json();
    if (!Array.isArray(body.data)) throw Error('此源没有返回兼容的模型列表，请手动输入模型名称');
    return [
      ...new Set(
        body.data.map((item) => item.id).filter((id) => typeof id === 'string' && id.length <= 200),
      ),
    ].sort();
  } catch (error) {
    throw Error(
      (
        error.message +
        (error.cause?.code ? '：' + error.cause.code : '') +
        '\n' +
        safeEndpoint(url.href)
      ).replaceAll(key, '[REDACTED]'),
    );
  }
}
module.exports = { listModels };
