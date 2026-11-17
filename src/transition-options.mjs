export const TRANSITION_DEFAULTS = {
  enabled: true,
  mode: 'text',
  background: 'inherit',
  path: '',
  fit: 'contain',
  blur: 16,
  dim: 18,
  saturation: 65,
  contrast: 'auto',
  align: 'center',
  verticalAlign: 'center',
  fontSize: 72,
  lineHeight: 1.3,
  letterSpacing: 0,
  margin: 64,
  offsetX: 0,
  offsetY: 0,
  showNumber: true,
  numberSize: 46,
  numberGap: 24,
  showSubtitle: true,
  subtitleSize: 24,
  subtitleGap: 24,
  showChrome: true,
};
export const TRANSITION_RANGES = {
  fontSize: [24, 140, 1],
  lineHeight: [1, 2, 0.05],
  letterSpacing: [0, 12, 1],
  margin: [0, 200, 1],
  offsetX: [-200, 200, 1],
  offsetY: [-200, 200, 1],
  numberSize: [20, 100, 1],
  numberGap: [0, 100, 1],
  subtitleSize: [14, 60, 1],
  subtitleGap: [0, 100, 1],
  blur: [0, 60, 1],
  dim: [0, 70, 1],
  saturation: [0, 100, 1],
};
export function transitionDefaults(value) {
  return { ...TRANSITION_DEFAULTS, ...value, cards: value?.cards ?? [] };
}
export function normalizeTransition(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('过场设置格式无效');
  const t = transitionDefaults(value);
  for (const key of ['enabled', 'showNumber', 'showSubtitle', 'showChrome'])
    if (typeof t[key] !== 'boolean') throw Error('过场显示开关无效');
  for (const [key, values] of Object.entries({
    mode: ['text', 'image'],
    background: ['inherit', 'custom'],
    fit: ['contain', 'cover'],
    contrast: ['auto', 'light', 'dark'],
    align: ['left', 'center', 'right'],
    verticalAlign: ['top', 'center', 'bottom'],
  }))
    if (!values.includes(t[key])) throw Error('过场选项无效：' + key);
  for (const [key, [min, max, step]] of Object.entries(TRANSITION_RANGES)) {
    if (
      !Number.isFinite(t[key]) ||
      t[key] < min ||
      t[key] > max ||
      (step === 1 && !Number.isInteger(t[key]))
    )
      throw Error('过场参数超出范围：' + key);
    t[key] = Math.round(t[key] * 100) / 100;
  }
  if (typeof t.path !== 'string') throw Error('过场图片路径无效');
  const image = (p) => /\.(png|jpe?g|webp)$/i.test(p);
  t.path = t.path.trim();
  if (t.enabled && (t.mode === 'image' || t.background === 'custom') && !image(t.path))
    throw Error('请上传 PNG、JPG 或 WebP 过场图片');
  if (!Array.isArray(t.cards) || t.cards.length > 100) throw Error('章节过场内容无效');
  const ids = new Set();
  const cards = t.cards.map((c) => {
    if (!c || typeof c.id !== 'string' || !c.id || c.id.length > 200 || ids.has(c.id))
      throw Error('章节过场标识无效');
    ids.add(c.id);
    if (!['text', 'image'].includes(c.mode)) throw Error('章节过场类型无效');
    for (const key of ['heading', 'subtitle', 'path'])
      if (typeof c[key] !== 'string') throw Error('章节过场内容格式无效');
    if (c.heading.length > 300 || c.subtitle.length > 300) throw Error('过场文字最多 300 字');
    if (t.enabled && c.mode === 'image' && !image(c.path)) throw Error('请上传本章节的过场图片');
    return {
      id: c.id,
      mode: c.mode,
      heading: c.heading.trim(),
      subtitle: c.subtitle.trim(),
      path: c.mode === 'image' ? c.path.trim() : '',
    };
  });
  return { ...Object.fromEntries(Object.keys(TRANSITION_DEFAULTS).map((k) => [k, t[k]])), cards };
}
export function resolveTransition(value, scene, titleFont) {
  const t = value?.enabled === false ? transitionDefaults() : transitionDefaults(value);
  if (!value && titleFont) t.fontSize = titleFont;
  const card = t.cards.find((c) => c.id === scene.id);
  return {
    ...t,
    ...(card || {}),
    heading: card?.heading || scene.heading,
    subtitle: card?.subtitle || scene.subtitle,
    showChrome: (card?.mode || t.mode) === 'image' ? false : t.showChrome,
  };
}
