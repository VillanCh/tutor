export const HEADER_DEFAULTS = {
  enabled: true,
  mode: 'full',
  inheritBrand: true,
  brandName: 'YAK',
  brandTagline: 'TUTORIAL STUDIO',
  showName: true,
  showTagline: true,
  logoEnabled: false,
  path: '',
  logoHeight: 48,
  logoMaxWidth: 200,
  logoGap: 16,
  logoTone: 'original',
  fontSize: 30,
  taglineSize: 12,
  textGap: 8,
  opacity: 100,
  offsetX: 0,
  offsetY: 0,
  showSceneTitle: true,
  showChapter: true,
  showTimer: true,
  showFooterChapters: true,
};
export const HEADER_RANGES = {
  logoHeight: [16, 120, 1],
  logoMaxWidth: [32, 400, 1],
  logoGap: [0, 64, 1],
  fontSize: [14, 64, 1],
  taglineSize: [8, 32, 1],
  textGap: [0, 32, 1],
  opacity: [5, 100, 1],
  offsetX: [0, 160, 1],
  offsetY: [0, 80, 1],
};
export const SURFACE_DEFAULTS = {
  headerMode: 'auto',
  headerOpacity: 25,
  footerMode: 'auto',
  footerOpacity: 25,
};
export function headerDefaults(value, brand) {
  return {
    ...HEADER_DEFAULTS,
    ...(brand ? { brandName: brand.name, brandTagline: brand.tagline } : {}),
    ...value,
  };
}
export function normalizeHeader(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('品牌栏设置格式无效');
  const h = headerDefaults(value);
  for (const key of [
    'enabled',
    'inheritBrand',
    'showName',
    'showTagline',
    'logoEnabled',
    'showSceneTitle',
    'showChapter',
    'showTimer',
    'showFooterChapters',
  ])
    if (typeof h[key] !== 'boolean') throw Error('品牌栏显示开关无效');
  if (!['full', 'brand', 'logo', 'hidden'].includes(h.mode)) throw Error('品牌栏内容模式无效');
  if (!['original', 'auto', 'light', 'dark'].includes(h.logoTone)) throw Error('Logo 配色无效');
  for (const [key, [min, max]] of Object.entries(HEADER_RANGES))
    if (!Number.isInteger(h[key]) || h[key] < min || h[key] > max)
      throw Error('品牌栏参数超出范围：' + key);
  for (const [key, max] of [
    ['brandName', 48],
    ['brandTagline', 100],
  ]) {
    if (
      typeof h[key] !== 'string' ||
      [...h[key]].length > max ||
      /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(h[key])
    )
      throw Error('品牌文字必须为单行，名称最多 48 字，副标题最多 100 字');
    h[key] = h[key].trim();
  }
  if (typeof h.path !== 'string') throw Error('Header Logo 路径无效');
  h.path = h.path.trim();
  if (
    h.enabled &&
    h.mode !== 'hidden' &&
    (h.logoEnabled || h.mode === 'logo') &&
    !/\.(png|jpe?g|webp)$/i.test(h.path)
  )
    throw Error('请上传 PNG、JPG 或 WebP Header Logo，推荐透明 PNG');
  return Object.fromEntries(Object.keys(HEADER_DEFAULTS).map((k) => [k, h[k]]));
}
export function normalizeSurfaces(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('上下栏透明度设置无效');
  const result = { ...SURFACE_DEFAULTS, ...value };
  for (const key of ['headerMode', 'footerMode'])
    if (!['auto', 'custom'].includes(result[key])) throw Error('上下栏底色模式无效');
  for (const key of ['headerOpacity', 'footerOpacity'])
    if (!Number.isFinite(result[key]) || result[key] < 0 || result[key] > 100)
      throw Error('上下栏底色不透明度需为 0%–100%');
  return Object.fromEntries(Object.keys(SURFACE_DEFAULTS).map((k) => [k, result[k]]));
}

// A draft-only request: persist the layout change, never an override of later layout choices.
export function applyHeaderVisibility(options, header) {
  if (header?.ensureVisible !== true || header.enabled === false || !options?.layout)
    return options;
  return {
    ...options,
    layout: {
      ...options.layout,
      showHeader: header.mode !== 'hidden',
      ...(typeof header.showTimer === 'boolean'
        ? { showTimer: header.mode === 'full' && header.showTimer }
        : {}),
      ...(typeof header.showFooterChapters === 'boolean'
        ? { timelineLabels: header.showFooterChapters }
        : {}),
    },
  };
}
