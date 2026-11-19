export const COVER_DEFAULTS = {
  mode: 'generated',
  title: '',
  subtitle: '',
  showSubtitle: true,
  theme: 'auto',
  align: 'left',
  path: '',
  fit: 'contain',
  overlayTitle: false,
  embed: true,
};

export function normalizeCover(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('封面设置格式无效');
  const c = { ...COVER_DEFAULTS, ...value };
  for (const [key, choices] of Object.entries({
    mode: ['generated', 'image', 'none'],
    theme: ['auto', 'light', 'dark'],
    align: ['left', 'center'],
    fit: ['contain', 'cover'],
  }))
    if (!choices.includes(c[key])) throw Error('封面选项无效：' + key);
  for (const key of ['showSubtitle', 'overlayTitle', 'embed'])
    if (typeof c[key] !== 'boolean') throw Error('封面显示开关无效');
  for (const [key, max] of [
    ['title', 160],
    ['subtitle', 240],
  ]) {
    if (
      typeof c[key] !== 'string' ||
      [...c[key]].length > max ||
      /[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(c[key])
    )
      throw Error('封面标题最多 160 字，副标题最多 240 字');
    c[key] = c[key].trim();
  }
  if (typeof c.path !== 'string') throw Error('封面图片路径无效');
  c.path = c.path.trim();
  if (c.mode === 'image' && !/\.(png|jpe?g|webp)$/i.test(c.path))
    throw Error('请上传 PNG、JPG 或 WebP 封面图片');
  return Object.fromEntries(Object.keys(COVER_DEFAULTS).map((k) => [k, c[k]]));
}
