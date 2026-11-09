export const EXPORT_ASPECTS = [
  { id: 'auto', label: '原布局', description: '沿用素材与原有框架', width: 16, height: 11 },
  { id: '16:9', label: '横屏', description: '课程、演示与桌面播放', width: 16, height: 9 },
  { id: '9:16', label: '竖屏', description: '手机全屏与短视频', width: 9, height: 16 },
  { id: '1:1', label: '方形', description: '信息流与方形画面', width: 1, height: 1 },
  { id: '4:5', label: '竖版', description: '信息流与图文课程', width: 4, height: 5 },
  { id: '4:3', label: '经典横屏', description: '演示与传统屏幕', width: 4, height: 3 },
  { id: '3:4', label: '经典竖屏', description: '竖版课程与平板', width: 3, height: 4 },
];

export function normalizeExportOptions(value) {
  if (value != null && (typeof value !== 'object' || Array.isArray(value)))
    throw Error('导出画布设置格式无效');
  const result = { aspect: value?.aspect ?? 'auto', shortEdge: value?.shortEdge ?? 1080 };
  if (!EXPORT_ASPECTS.some((item) => item.id === result.aspect)) throw Error('请选择常见画布比例');
  if (![720, 1080].includes(result.shortEdge)) throw Error('导出清晰度支持 720p 或 1080p');
  if (result.aspect === 'auto') result.shortEdge = 1080;
  return result;
}

export function exportDimensions(
  options,
  info = { width: 1280, height: 720 },
  style = { width: 1440 },
) {
  const value = normalizeExportOptions(options);
  if (value.aspect === 'auto') {
    const videoWidth = style.width - 32;
    return {
      width: style.width,
      height: 200 + Math.round(Math.min(1400, (videoWidth * info.height) / info.width) / 2) * 2,
    };
  }
  const preset = EXPORT_ASPECTS.find((item) => item.id === value.aspect);
  const scale = value.shortEdge / Math.min(preset.width, preset.height);
  return { width: Math.round(preset.width * scale), height: Math.round(preset.height * scale) };
}

export function exportSummary(options, info, style) {
  const value = normalizeExportOptions(options);
  const { width, height } = exportDimensions(value, info, style);
  return (value.aspect === 'auto' ? '原布局' : value.aspect) + ' · ' + width + ' × ' + height;
}
