export const MODEL_POLICY_VERSION = 1;
export const MODEL_DEFAULTS = Object.freeze({
  vision: 'qwen3.8-omni-flash',
  editor: 'deepseek-v4.1-flash',
  speech: 'qwen-audio-3.1-tts-flash',
});
export function isBlockedModel(model) {
  return typeof model === 'string' && model.toLowerCase().includes('qwen3.8-max');
}
export function assertModelAllowed(model) {
  if (isBlockedModel(model))
    throw Error('qwen3.8-max 已停用，请选择 deepseek-v4.1-flash 或其他可用的剧本模型。');
}
export function editorModelOptions(models = []) {
  const options = new Map([
    [
      MODEL_DEFAULTS.editor,
      { id: MODEL_DEFAULTS.editor, name: 'DeepSeek V4.1 Flash', recommended: true },
    ],
  ]);
  for (const model of models) {
    if (
      !model ||
      typeof model.id !== 'string' ||
      isBlockedModel(model.id) ||
      [MODEL_DEFAULTS.vision, MODEL_DEFAULTS.speech].includes(model.id) ||
      /(?:^|[\/_-])(?:tts|asr|speech|audio|embedding|embed|rerank|image|video)(?:[\/_.-]|$)/i.test(
        model.id,
      )
    )
      continue;
    if (!options.has(model.id))
      options.set(model.id, {
        id: model.id,
        name: String(model.name || model.id),
        recommended: false,
      });
  }
  return [...options.values()];
}
