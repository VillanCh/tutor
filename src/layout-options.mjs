// Distances use reference pixels: 1080 on the short edge, or 1440 wide in auto mode.
export const LAYOUT_DEFAULTS = {
  showHeader: true,
  showTimer: true,
  showCaptions: true,
  showTimeline: true,
  timelineLabels: true,
  margin: 24,
  topPadding: 16,
  bottomPadding: 16,
  contentGap: 12,
  borderWidth: 1,
  headerHeight: 72,
  headerFont: 24,
  captionFont: 28,
  captionLineHeight: 1.35,
  captionLines: 2,
  captionPadding: 8,
  titleFont: 72,
  chapterFont: 16,
  chapterGap: 12,
  railHeight: 6,
  videoAlign: 'center',
};

export const LAYOUT_RANGES = {
  margin: [0, 120, 1],
  topPadding: [0, 80, 1],
  bottomPadding: [0, 80, 1],
  contentGap: [0, 48, 1],
  borderWidth: [0, 12, 1],
  headerHeight: [48, 200, 1],
  headerFont: [16, 48, 1],
  captionFont: [14, 54, 1],
  captionLineHeight: [1, 2, 0.05],
  captionLines: [1, 3, 1],
  captionPadding: [0, 24, 1],
  titleFont: [32, 100, 1],
  chapterFont: [12, 28, 1],
  chapterGap: [0, 32, 1],
  railHeight: [2, 12, 1],
};

export function normalizeLayout(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('排版设置格式无效');
  const result = { ...LAYOUT_DEFAULTS };
  for (const key of Object.keys(result)) if (value[key] !== undefined) result[key] = value[key];
  for (const key of ['showHeader', 'showTimer', 'showCaptions', 'showTimeline', 'timelineLabels'])
    if (typeof result[key] !== 'boolean') throw Error('排版显示开关无效');
  for (const [key, [min, max, step]] of Object.entries(LAYOUT_RANGES)) {
    const n = result[key];
    if (!Number.isFinite(n) || n < min || n > max || (step === 1 && !Number.isInteger(n)))
      throw Error('排版参数超出范围：' + key);
    result[key] = Math.round(n * 100) / 100;
  }
  if (!['top', 'center', 'bottom'].includes(result.videoAlign)) throw Error('录屏对齐方式无效');
  return result;
}

export const LAYOUT_PRESETS = [
  {
    id: 'compact',
    name: '紧凑 · 录屏优先',
    description: '去掉顶部，压紧底部，放大录屏',
    value: normalizeLayout({
      showHeader: false,
      showTimer: false,
      timelineLabels: false,
      margin: 12,
      topPadding: 8,
      bottomPadding: 8,
      contentGap: 6,
      borderWidth: 0,
      captionFont: 26,
      captionLineHeight: 1.15,
      captionPadding: 4,
      railHeight: 4,
    }),
  },
  {
    id: 'balanced',
    name: '均衡排版',
    description: '保留标题、字幕和章节信息',
    value: normalizeLayout(),
  },
  {
    id: 'spacious',
    name: '舒展 · 大字阅读',
    description: '更大字号、行高与留白',
    value: normalizeLayout({
      margin: 40,
      topPadding: 24,
      bottomPadding: 24,
      contentGap: 20,
      headerHeight: 104,
      headerFont: 30,
      captionFont: 34,
      captionLineHeight: 1.6,
      captionPadding: 14,
      chapterFont: 20,
      chapterGap: 20,
    }),
  },
  {
    id: 'clean',
    name: '纯录屏',
    description: '关闭上下栏、字幕和边框',
    value: normalizeLayout({
      showHeader: false,
      showTimer: false,
      showCaptions: false,
      showTimeline: false,
      margin: 0,
      topPadding: 0,
      bottomPadding: 0,
      contentGap: 0,
      borderWidth: 0,
    }),
  },
];

export function layoutMetrics(layout, unit) {
  const l = normalizeLayout(layout),
    px = (n) => Math.round(n * unit);
  const captionSize = Math.max(10, px(l.captionFont));
  const lineHeight = Math.max(captionSize + 2, Math.ceil(captionSize * l.captionLineHeight));
  const padding = px(l.captionPadding);
  return {
    value: l,
    margin: px(l.margin),
    topPadding: px(l.topPadding),
    bottomPadding: px(l.bottomPadding),
    gap: px(l.contentGap),
    border: px(l.borderWidth),
    header: l.showHeader
      ? Math.ceil(Math.max(l.headerHeight * unit, l.headerFont * unit * 2.3 + 12 * unit))
      : 0,
    captionSize,
    lineHeight,
    padding,
    caption: l.showCaptions ? Math.ceil(lineHeight * l.captionLines + padding * 2) : 0,
    labels:
      l.showTimeline && l.timelineLabels ? Math.ceil(l.chapterFont * unit * 1.4 + 6 * unit) : 0,
    rail: Math.max(2, px(l.railHeight)),
    get timeline() {
      return l.showTimeline ? this.labels + this.rail : 0;
    },
    get footer() {
      return this.caption + this.timeline + (this.caption && this.timeline ? this.gap : 0);
    },
  };
}
