const { DEFAULTS, validateConfig } = require('./config.cjs');
const { GATEWAY, trustedGateway } = require('./yakcool.cjs');
const { MODEL_DEFAULTS, assertModelAllowed } = require('./model-policy.mjs');
function managedConfig(input = DEFAULTS, gateway = GATEWAY) {
  const c = structuredClone(DEFAULTS),
    origin = trustedGateway(gateway);
  for (const group of ['speech', 'style', 'limits']) {
    for (const name of Object.keys(c[group]))
      if (input[group]?.[name] !== undefined) c[group][name] = structuredClone(input[group][name]);
  }
  c.provider = 'yakcool';
  c.sources = [
    {
      id: 'yakcool',
      name: 'YAKCOOL',
      kind: 'custom',
      credential: 'yakcool',
      chatBaseUrl: origin + '/v1',
      speechProtocol: 'dashscope-tts',
      speechBaseUrl: origin + '/api/v1/services/audio/tts/SpeechSynthesizer',
    },
  ];
  for (const role of ['vision', 'editor', 'speech']) {
    assertModelAllowed(input.roles?.[role]?.model);
    const model =
      role === 'editor'
        ? input.roles?.[role]?.model || MODEL_DEFAULTS.editor
        : MODEL_DEFAULTS[role];
    if (typeof model !== 'string' || !/^[a-z0-9_./:-]{1,200}$/i.test(model))
      throw Error('模型名称无效');
    c.roles[role] = { ...c.roles[role], model, sourceId: 'yakcool', credential: 'yakcool' };
  }
  return validateConfig(c);
}
function publicConfig(config) {
  return {
    roles: Object.fromEntries(
      Object.entries(config.roles).map(([name, role]) => [name, { model: role.model }]),
    ),
    speech: config.speech,
    style: config.style,
    limits: config.limits,
  };
}
module.exports = { managedConfig, publicConfig };
