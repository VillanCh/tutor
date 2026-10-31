const { resolveSources } = require('./model-sources.mjs');
const HOST = process.env.QWEN_BASE_ORIGIN || 'https://dashscope.aliyuncs.com';
const instruction =
  '请用普通话，以产品教程说明的方式朗读。保持情绪中性、语调平直、字音清晰、中等语速。减少音高起伏和夸张重音，句间自然停顿，避免广告腔、讲故事腔、撒娇、热情和煽情。只朗读输入文本。';
const DEFAULTS = {
  provider: 'bailian',
  roles: {
    vision: {
      model: 'qwen3.8-omni-flash',
      protocol: 'openai-chat',
      baseUrl: HOST + '/compatible-mode/v1',
      credential: 'default',
      inputPrice: 0.8,
      outputPrice: 2.7,
      cachedPrice: 0.1,
    },
    editor: {
      model: 'deepseek-v4.1-flash',
      protocol: 'openai-chat',
      baseUrl: 'https://aibalance.yaklang.com/v1',
      credential: 'aibalance',
      inputPrice: 0,
      outputPrice: 0,
      cachedPrice: 0,
      pricingKnown: false,
    },
    speech: {
      model: 'qwen-audio-3.1-tts-flash',
      protocol: 'dashscope-tts',
      baseUrl: HOST + '/api/v1/services/audio/tts/SpeechSynthesizer',
      credential: 'default',
      inputPrice: 1.5,
      outputPrice: 12,
      cachedPrice: 1.5,
    },
  },
  speech: {
    voice: 'longanlang_v3.1',
    alternateVoice: 'xuyanchu_v3.1',
    format: 'wav',
    sample_rate: 48000,
    rate: 1,
    language_hints: ['zh'],
    instruction,
  },
  style: {
    name: 'Yak paper',
    background: '#F9F6EF',
    ink: '#353639',
    accent: '#F28C18',
    secondary_accent: '#B86A4B',
    width: 1440,
    fps: 30,
    lead: 0.25,
    titleLead: 0.6,
    gap: 0.7,
    brand: { enabled: true, name: 'YAK', tagline: 'TUTORIAL STUDIO' },
    chapterGap: 12,
  },
  limits: { maxDuration: 600, maxAnalysisBytes: 24 * 1024 * 1024, maxKnowledgeChars: 50000 },
  pricingSource: 'https://help.aliyun.com/zh/model-studio/model-pricing',
};
function validateConfig(value) {
  for (const name of ['vision', 'editor', 'speech']) {
    if (!value?.roles?.[name]?.model) throw Error('模型配置不完整：' + name);
  }
  const c = resolveSources(value, true);
  c.style = {
    ...c.style,
    brand: { ...DEFAULTS.style.brand, ...c.style?.brand },
    chapterGap: c.style?.chapterGap ?? DEFAULTS.style.chapterGap,
  };
  if (typeof c.style.brand.enabled !== 'boolean') throw Error('品牌显示设置无效');
  for (const [key, max] of [
    ['name', 24],
    ['tagline', 48],
  ]) {
    const text = c.style.brand[key];
    if (
      typeof text !== 'string' ||
      [...text].length > max ||
      /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(text)
    )
      throw Error(
        '品牌' + (key === 'name' ? '名称' : '副标题') + '必须为单行文字，最多 ' + max + ' 字',
      );
    c.style.brand[key] = text.trim();
  }
  if (c.style.brand.enabled && !c.style.brand.name) throw Error('请输入品牌名称，或关闭品牌显示');
  if (!Number.isFinite(c.style.chapterGap) || c.style.chapterGap < 6 || c.style.chapterGap > 24)
    throw Error('章节分段间距必须为 6 到 24 像素');
  for (const name of ['vision', 'editor', 'speech']) {
    const r = c.roles?.[name];
    if (!r?.model || !r.baseUrl || !r.credential) throw Error('模型配置不完整：' + name);
    const url = new URL(r.baseUrl);
    if (!['https:', 'http:'].includes(url.protocol)) throw Error('模型接口必须是 HTTP 或 HTTPS');
    if (!['openai-chat', 'dashscope-tts', 'openai-speech'].includes(r.protocol))
      throw Error('不支持的接口协议');
    if (name !== 'speech' && r.protocol !== 'openai-chat')
      throw Error('视觉和编辑模型使用 OpenAI Chat 接口');
    if (name === 'speech' && !['dashscope-tts', 'openai-speech'].includes(r.protocol))
      throw Error('配音模型使用原生 TTS 或 OpenAI Speech 接口');
    for (const key of ['inputPrice', 'outputPrice', 'cachedPrice']) {
      if (!Number.isFinite(Number(r[key])) || Number(r[key]) < 0) throw Error('价格必须是非负数');
      r[key] = Number(r[key]);
    }
  }
  if (
    !c.speech?.voice ||
    !Number.isFinite(c.speech.rate) ||
    c.speech.rate < 0.5 ||
    c.speech.rate > 2
  )
    throw Error('配音参数无效');
  for (const key of ['background', 'ink', 'accent', 'secondary_accent'])
    if (!/^#[0-9a-f]{6}$/i.test(c.style?.[key])) throw Error('风格颜色无效：' + key);
  if (
    !Number.isInteger(c.style.width) ||
    c.style.width < 640 ||
    c.style.width > 3840 ||
    c.style.width % 2 ||
    ![24, 25, 30, 60].includes(c.style.fps)
  )
    throw Error('输出尺寸或帧率无效');
  for (const key of ['lead', 'titleLead', 'gap'])
    if (!Number.isFinite(c.style[key]) || c.style[key] < 0 || c.style[key] > 10)
      throw Error('停顿参数无效');
  if (c.style.gap < 0.5) throw Error('旁白间隔至少 0.5 秒');
  if (
    !Number.isFinite(c.limits?.maxDuration) ||
    c.limits.maxDuration < 1 ||
    c.limits.maxDuration > 3600 ||
    !Number.isFinite(c.limits.maxAnalysisBytes) ||
    !Number.isFinite(c.limits.maxKnowledgeChars)
  )
    throw Error('素材限制无效');
  return c;
}
module.exports = { DEFAULTS, validateConfig };
