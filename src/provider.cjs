const crypto = require('node:crypto');
const { parseJson } = require('./script.cjs');
const { requestEndpoint } = require('./model-sources.mjs');
function usageRecord(role, stage, raw, sent, received, latency, error = null) {
  const u = raw || {},
    input = u.prompt_tokens ?? u.input_tokens ?? 0,
    output = u.completion_tokens ?? u.output_tokens ?? 0;
  const cached =
    u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens ?? 0;
  const hasTokens =
    Boolean(raw) &&
    Number.isFinite(u.prompt_tokens ?? u.input_tokens) &&
    Number.isFinite(u.completion_tokens ?? u.output_tokens);
  return {
    id: crypto.randomUUID(),
    stage,
    model: role.model,
    protocol: role.protocol,
    at: new Date().toISOString(),
    input_tokens: input,
    output_tokens: output,
    cached_tokens: cached,
    total_tokens: input + output,
    usage_reported: hasTokens,
    raw_usage: raw || null,
    sent_bytes: sent,
    received_bytes: received,
    latency_ms: latency,
    estimated_cny: hasTokens
      ? ((input - cached) * role.inputPrice +
          cached * role.cachedPrice +
          output * role.outputPrice) /
        1e6
      : null,
    error,
  };
}
class Provider {
  constructor(config, credentials, record, progress) {
    Object.assign(this, { config, credentials: { ...credentials }, record, progress });
  }
  key(role) {
    const key = this.credentials[role.credential];
    if (!key) throw Error('请配置 API Key：' + role.credential);
    return key;
  }
  async request(role, stage, payload, signal, stream = false) {
    const body = JSON.stringify(payload),
      start = Date.now();
    let bytes = 0,
      reported = null;
    const url = requestEndpoint(role);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + this.key(role), 'Content-Type': 'application/json' },
        body,
        signal,
      });
      if (role.protocol === 'openai-speech') {
        const input = response.headers.get('X-AIBalance-Input-Tokens'),
          output = response.headers.get('X-AIBalance-Output-Tokens');
        if (
          input !== null &&
          output !== null &&
          /^\d+$/.test(input) &&
          /^\d+$/.test(output) &&
          Number.isSafeInteger(Number(input)) &&
          Number.isSafeInteger(Number(output)) &&
          Number.isSafeInteger(Number(input) + Number(output))
        ) {
          reported = {
            input_tokens: Number(input),
            output_tokens: Number(output),
            total_tokens: Number(input) + Number(output),
          };
        }
      }
      if (!response.ok) {
        const message = await response.text();
        bytes = Buffer.byteLength(message);
        throw Error('模型请求 ' + response.status + '：' + message.slice(0, 1000));
      }
      if (stream) {
        let text = '',
          carry = '',
          decoder = new TextDecoder();
        for await (const chunk of response.body) {
          bytes += chunk.length;
          carry += decoder.decode(chunk, { stream: true });
          const lines = carry.split('\n');
          carry = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const value = line.slice(5).trim();
            if (!value || value === '[DONE]') continue;
            const packet = JSON.parse(value);
            if (packet.error) throw Error(packet.error.message || JSON.stringify(packet.error));
            if (packet.usage) reported = packet.usage;
            const part = packet.choices?.[0]?.delta?.content || '';
            text += part;
            this.progress?.({
              streamText: text,
              streamEstimate: Math.ceil(text.length / 3),
              stage,
            });
          }
        }
        if (!text.trim()) throw Error('模型返回了空内容');
        await this.record(
          usageRecord(role, stage, reported, Buffer.byteLength(body), bytes, Date.now() - start),
        );
        return text;
      }
      const data = Buffer.from(await response.arrayBuffer());
      bytes = data.length;
      if (role.protocol === 'openai-speech') {
        await this.record(
          usageRecord(role, stage, reported, Buffer.byteLength(body), bytes, Date.now() - start),
        );
        return data;
      }
      const result = JSON.parse(data.toString());
      reported = result.usage;
      await this.record(
        usageRecord(role, stage, reported, Buffer.byteLength(body), bytes, Date.now() - start),
      );
      return result;
    } catch (error) {
      let message = String(error.message);
      for (const value of Object.values(this.credentials))
        if (value) message = message.replaceAll(value, '[REDACTED]');
      await this.record(
        usageRecord(
          role,
          stage,
          reported,
          Buffer.byteLength(body),
          bytes,
          Date.now() - start,
          message,
        ),
      );
      throw Error(message);
    }
  }
  async json(name, stage, messages, signal) {
    const role = this.config.roles[name];
    const text = await this.request(
      role,
      stage,
      {
        model: role.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        enable_thinking: false,
        reasoning_effort: 'none',
        max_tokens: 10000,
      },
      signal,
      true,
    );
    return { value: parseJson(text), text };
  }
  async speech(text, stage, signal) {
    const role = this.config.roles.speech,
      settings = this.config.speech;
    if (role.protocol === 'openai-speech')
      return this.request(
        role,
        stage,
        {
          model: role.model,
          input: text,
          voice: settings.voice,
          response_format: 'wav',
          speed: settings.rate,
          instructions: settings.instruction,
        },
        signal,
      );
    const result = await this.request(
      role,
      stage,
      { model: role.model, input: { text, ...settings, alternateVoice: undefined } },
      signal,
    );
    const audio = result.output?.audio;
    if (!audio?.url && !audio?.data) throw Error('配音模型没有返回音频');
    if (audio.data) return Buffer.from(audio.data, 'base64');
    const url = new URL(audio.url);
    if (!['https:', 'http:'].includes(url.protocol)) throw Error('音频下载地址无效');
    const start = Date.now(),
      response = await fetch(url, { signal });
    if (!response.ok) throw Error('音频下载失败：' + response.status);
    const data = Buffer.from(await response.arrayBuffer());
    await this.record({
      id: crypto.randomUUID(),
      stage: stage + ' 下载',
      model: role.model,
      at: new Date().toISOString(),
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      usage_reported: true,
      sent_bytes: 0,
      received_bytes: data.length,
      latency_ms: Date.now() - start,
      estimated_cny: 0,
      type: 'download',
    });
    return data;
  }
}
module.exports = { Provider, usageRecord };
