export const WATERMARK_STYLES = {
  tiled: { opacity: 8, width: 14, density: 'relaxed', tone: 'dark' },
  corner: { opacity: 35, width: 14, density: 'balanced', tone: 'light' },
};

export function brandingDefaults(value = {}) {
  const legacyWatermark = value?.watermark && value.watermark.layout == null;
  return {
    intro: { enabled: false, path: '', duration: 5, muted: false, ...value?.intro },
    outro: { enabled: false, path: '', duration: 5, muted: false, ...value?.outro },
    watermark: {
      enabled: false,
      type: 'text',
      text: '',
      path: '',
      position: 'top-right',
      opacity: legacyWatermark ? 65 : WATERMARK_STYLES.tiled.opacity,
      width: legacyWatermark ? 18 : WATERMARK_STYLES.tiled.width,
      layout: legacyWatermark ? 'corner' : 'tiled',
      angle: -24,
      density: legacyWatermark ? 'balanced' : WATERMARK_STYLES.tiled.density,
      tone: legacyWatermark ? 'light' : 'dark',
      protectSubtitles: true,
      ...value?.watermark,
    },
  };
}

export const WATERMARK_POSITIONS = {
  'top-left': '左上角',
  'top-right': '右上角',
  'bottom-left': '左下角',
  'bottom-right': '右下角',
};

export const WATERMARK_DENSITIES = { relaxed: '疏朗', balanced: '适中', dense: '紧凑' };
export const WATERMARK_TONES = { dark: '深墨', light: '纯白', neutral: '柔和灰' };
export const WATERMARK_PRESETS = [
  {
    id: 'subtle',
    name: '轻盈',
    detail: '适合长教程 · 默认',
    opacity: 8,
    width: 14,
    density: 'relaxed',
  },
  {
    id: 'standard',
    name: '标准',
    detail: '品牌与阅读兼顾',
    opacity: 12,
    width: 18,
    density: 'balanced',
  },
  { id: 'strong', name: '醒目', detail: '突出品牌标识', opacity: 20, width: 22, density: 'dense' },
];

export function brandingSummary(value) {
  const b = brandingDefaults(value);
  return (
    [
      b.intro.enabled ? '片头广告' : '',
      b.watermark.enabled
        ? (b.watermark.layout === 'tiled' ? '全屏平铺' : '全程') +
          (b.watermark.type === 'image' ? ' Logo 水印' : '文字水印')
        : '',
      b.outro.enabled ? '片尾广告' : '',
    ]
      .filter(Boolean)
      .join(' · ') || '未添加广告或水印'
  );
}
