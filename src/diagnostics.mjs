export function safeEndpoint(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

// Old projects only saved an error string. Keep those failures inspectable too.
export function errorInfo(message = '', details = {}) {
  let body;
  try {
    body = JSON.parse(message.slice(message.indexOf('{')));
  } catch {}
  const httpStatus = details.httpStatus || Number(message.match(/模型请求 (\d{3})/)?.[1]) || null;
  const code = details.code || body?.error?.code || body?.code || '';
  const requestId =
    details.requestId || body?.request_id || body?.error?.request_id || body?.error?.id || '';
  let summary = body?.error?.message || body?.message || message;
  let hint = '查看下面的原始错误与失败调用；调整对应配置后再重试。';
  if (httpStatus === 401 || /invalid_api_key/i.test(code)) {
    summary = 'API Key 验证失败，模型服务拒绝了请求。';
    hint = '检查失败模型所选源的 Key 是否有效，以及接口地址、业务空间和区域是否与该 Key 对应。';
  } else if (httpStatus === 403) {
    hint = '检查该 Key 所属账号或业务空间是否有此模型的调用权限。';
  } else if (httpStatus === 429) {
    hint = '检查服务端返回的是限流还是额度不足；限流可稍后重试，额度不足需检查账号配额。';
  } else if (httpStatus === 404) {
    hint = '检查模型名称与接口地址是否正确，以及当前源是否提供该模型。';
  } else if (httpStatus >= 500) {
    hint = '模型服务返回了服务端错误，可稍后重试；持续失败时向服务商提供请求 ID。';
  } else if (/fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|timeout/i.test(message + code)) {
    hint = '检查接口域名、网络或代理连接；超时可稍后重试。底层连接错误保留在原始错误中。';
  }
  return {
    summary,
    hint,
    httpStatus,
    code,
    requestId,
    raw: body ? JSON.stringify(body, null, 2) : message,
  };
}

export function projectFailure(project) {
  if (!project?.error || project.job) return null;
  const cancelled = project.failure?.cancelled ?? project.progress?.stage === '已取消';
  const record = [...(project.usage || [])].reverse().find((r) => r.error);
  // Do not attach an older failed request to a later local validation failure.
  const relevant = record && record.error === project.error ? record : null;
  const details = project.failure?.details || relevant?.error_details || {};
  return {
    ...errorInfo(project.error, details),
    message: project.error,
    cancelled,
    stage: project.failure?.stage || relevant?.stage || '未记录',
    task: project.failure?.task || '',
    model: details.model || relevant?.model || '',
    source: details.source || '',
    endpoint: safeEndpoint(details.endpoint),
    at: project.failure?.at || relevant?.at || '',
  };
}
