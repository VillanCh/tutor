export const ROLE_NAMES = ['vision', 'editor', 'speech'];
const TTS_PATH = '/api/v1/services/audio/tts/SpeechSynthesizer';
export const MODEL_OPTIONS = {
  vision: ['qwen3.8-omni-flash'],
  editor: ['deepseek-v4.1-flash'],
  speech: ['qwen-audio-3.1-tts-flash'],
};

export function aibalanceSource() {
  return {
    id: 'aibalance',
    name: 'AIBalance',
    kind: 'custom',
    chatBaseUrl: 'https://aibalance.yaklang.com/v1',
    speechProtocol: 'dashscope-tts',
    speechBaseUrl: 'https://aibalance.yaklang.com' + TTS_PATH,
    credential: 'aibalance',
  };
}

export function selectRoleModel(config, role, model) {
  const previous = config.roles[role];
  return {
    ...config,
    roles: {
      ...config.roles,
      [role]: {
        ...previous,
        model,
        ...(model !== previous.model ? { pricingKnown: false } : {}),
      },
    },
  };
}

export function baseEndpoint(value = '', protocol = 'openai-chat') {
  const suffix = protocol === 'openai-speech' ? '/audio/speech' : '/chat/completions';
  const url = String(value).trim().replace(/\/+$/, '');
  return protocol === 'dashscope-tts'
    ? url
    : url.endsWith(suffix)
      ? url.slice(0, -suffix.length)
      : url;
}

export function bailianSource(origin = 'https://dashscope.aliyuncs.com') {
  return {
    id: 'bailian',
    name: '百炼',
    kind: 'bailian',
    chatBaseUrl: origin.replace(/\/+$/, '') + '/compatible-mode/v1',
    speechProtocol: 'dashscope-tts',
    speechBaseUrl: origin.replace(/\/+$/, '') + TTS_PATH,
    credential: 'default',
  };
}

export function customSource(id, name = '自定义源') {
  return {
    id,
    name,
    kind: 'custom',
    chatBaseUrl: '',
    speechProtocol: 'openai-speech',
    speechBaseUrl: '',
    credential: 'source-' + id,
  };
}

// Upgrade the earlier per-model connection format without changing any URL or key slot.
export function migrateSources(value) {
  const config = structuredClone(value);
  if (Array.isArray(config.sources)) return config;
  const vision = config.roles?.vision;
  if (!vision?.baseUrl) return config;
  const isBailian =
    config.provider === 'bailian' || /(?:dashscope|maas)\.aliyuncs\.com/.test(vision.baseUrl);
  const primary = isBailian
    ? bailianSource(new URL(vision.baseUrl).origin)
    : customSource('custom-legacy', '原有自定义源');
  primary.chatBaseUrl = baseEndpoint(vision.baseUrl);
  primary.credential = vision.credential;
  config.sources = isBailian ? [primary] : [bailianSource(), primary];
  config.roles.vision.sourceId = primary.id;
  const editor = config.roles.editor;
  if (editor) {
    if (
      baseEndpoint(editor.baseUrl) === primary.chatBaseUrl &&
      editor.credential === primary.credential
    ) {
      editor.sourceId = primary.id;
    } else {
      const source = /\/\/aibalance\.yaklang\.com(?:\/|$)/.test(editor.baseUrl)
        ? aibalanceSource()
        : {
            ...customSource('custom-editor', '独立改稿源'),
            chatBaseUrl: baseEndpoint(editor.baseUrl),
            credential: editor.credential,
          };
      config.sources.push(source);
      editor.sourceId = source.id;
    }
  }
  const speech = config.roles.speech;
  if (speech) {
    const sameKey = speech.credential === primary.credential;
    const source = sameKey ? primary : customSource('custom-speech', '独立配音源');
    source.speechProtocol = speech.protocol;
    source.speechBaseUrl = baseEndpoint(speech.baseUrl, speech.protocol);
    source.credential = speech.credential;
    if (!sameKey) config.sources.push(source);
    speech.sourceId = source.id;
  }
  if (!config.sources.some((source) => source.id === 'aibalance'))
    config.sources.push(aibalanceSource());
  return config;
}

// Sources own connection settings; model names and billing rates remain per role.
export function resolveSources(value, strict = false) {
  const config = migrateSources(value);
  const sources = config.sources || [];
  if (strict && (!sources.length || sources.length > 20)) throw Error('至少配置一个源，最多 20 个');
  const ids = new Set();
  for (const source of sources) {
    if (strict) {
      if (!/^[a-z0-9_-]{1,64}$/i.test(source.id) || ids.has(source.id))
        throw Error('源 ID 无效或重复');
      if (!source.name?.trim() || !source.credential?.trim()) throw Error('源名称或凭据名称不完整');
      if (!['bailian', 'custom'].includes(source.kind)) throw Error('不支持的源类型');
      if (!['dashscope-tts', 'openai-speech'].includes(source.speechProtocol))
        throw Error('不支持的语音源协议');
    }
    ids.add(source.id);
    if (strict) {
      source.chatBaseUrl = baseEndpoint(source.chatBaseUrl);
      source.speechBaseUrl = baseEndpoint(source.speechBaseUrl, source.speechProtocol);
      for (const endpoint of [source.chatBaseUrl, source.speechBaseUrl].filter(Boolean)) {
        let url;
        try {
          url = new URL(endpoint);
        } catch {
          throw Error('源接口地址无效：' + source.name);
        }
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        ) {
          throw Error('源接口必须是 HTTP 或 HTTPS 地址，Key 请填在凭据中');
        }
      }
    }
  }
  for (const name of ROLE_NAMES) {
    const role = config.roles?.[name];
    if (!role) continue;
    const source = sources.find((item) => item.id === role.sourceId);
    if (!source) {
      if (strict) throw Error('模型选择的源不存在：' + name);
      continue;
    }
    role.protocol = name === 'speech' ? source.speechProtocol : 'openai-chat';
    role.baseUrl =
      name === 'speech'
        ? source.speechBaseUrl ||
          (source.speechProtocol === 'openai-speech' ? source.chatBaseUrl : '')
        : source.chatBaseUrl;
    role.credential = source.credential;
    if (strict && !role.baseUrl)
      throw Error('所选源缺少' + (name === 'speech' ? '语音' : 'Chat') + '接口：' + source.name);
  }
  return config;
}

export function updateSource(config, id, change) {
  return resolveSources({
    ...config,
    sources: config.sources.map((source) => (source.id === id ? { ...source, ...change } : source)),
  });
}

export function selectRoleSource(config, role, sourceId) {
  return resolveSources({
    ...config,
    roles: {
      ...config.roles,
      [role]: {
        ...config.roles[role],
        sourceId,
        ...(sourceId !== config.roles[role].sourceId ? { pricingKnown: false } : {}),
      },
    },
  });
}

export function requestEndpoint(role) {
  return (
    baseEndpoint(role.baseUrl, role.protocol) +
    (role.protocol === 'openai-chat'
      ? '/chat/completions'
      : role.protocol === 'openai-speech'
        ? '/audio/speech'
        : '')
  );
}

// Connection metadata does not alter audio. Preserve cache identities from v0.2.
export function speechCacheRole(role) {
  const { sourceId, pricingKnown, ...connection } = role;
  return connection;
}
