import { useEffect, useState } from 'react';
import { Check, Clapperboard, Eye, LoaderCircle, ShieldCheck } from 'lucide-react';
import { api } from './workbench';
import { WATERMARK_DENSITIES, WATERMARK_POSITIONS } from '../branding-options.mjs';

export default function WatermarkPreview({ branding, project }) {
  const [before, setBefore] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const w = branding.watermark;
  const placeholder = w.enabled && (w.type === 'image' ? !w.path.trim() : !w.text.trim());
  const value = JSON.stringify({
    projectId: project?.id,
    exportOptions: project?.exportOptions,
    watermark: {
      ...w,
      enabled: w.enabled && !before,
      ...(placeholder
        ? { type: 'text', text: w.type === 'image' ? 'YOUR LOGO' : '品牌名称 · 课程名称' }
        : {}),
    },
  });
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      api('/api/branding/preview', JSON.parse(value), { signal: controller.signal })
        .then((next) => {
          if (alive) {
            setPreview(next);
            setLoading(false);
          }
        })
        .catch((error) => {
          if (alive) {
            setError(error.message);
            setLoading(false);
          }
        });
    }, 160);
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);
  return (
    <aside className="watermark-preview-panel" aria-label="水印效果预览" aria-busy={loading}>
      <div className="watermark-preview-heading">
        <span>
          <Eye size={15} />
          <strong>画面预览</strong>
        </span>
        <small>
          {loading ? (
            <>
              <LoaderCircle size={11} className="animate-spin" /> 正在更新
            </>
          ) : (
            <>
              <span className="watermark-live-dot" /> 实时同步
            </>
          )}
        </small>
      </div>
      <div className="watermark-compare" aria-label="对比水印效果">
        <button
          type="button"
          aria-pressed={before}
          className={before ? 'active' : ''}
          onClick={() => setBefore(true)}
        >
          原始画面
        </button>
        <button
          type="button"
          aria-pressed={!before}
          className={!before ? 'active' : ''}
          onClick={() => setBefore(false)}
        >
          水印预览
        </button>
      </div>
      <div className="watermark-preview-screen">
        {preview ? (
          <img
            src={preview.image}
            alt={
              before ? '原始画面' : w.layout === 'tiled' ? '全屏半透明平铺水印预览' : '四角水印预览'
            }
          />
        ) : (
          <div className="watermark-preview-loading">
            <Clapperboard size={28} />
            <span>正在准备预览画面</span>
          </div>
        )}
        {error && (
          <div className="watermark-preview-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <p className="watermark-preview-caption">
        {placeholder
          ? '当前为占位示意，补充内容后显示实际水印。'
          : preview?.sample
            ? '示例教学画面 · 水印与导出共用同一套排版。'
            : '取自当前素材的静帧 · 水印与导出共用同一套排版。'}
      </p>
      <div className="watermark-preview-specs">
        <div>
          <span>呈现方式</span>
          <strong>
            {!w.enabled
              ? '暂未开启'
              : w.layout === 'tiled'
                ? '全屏平铺 · ' + WATERMARK_DENSITIES[w.density]
                : WATERMARK_POSITIONS[w.position]}
          </strong>
        </div>
        <div>
          <span>不透明度</span>
          <strong>
            {w.opacity}% <small>· 透明度 {100 - w.opacity}%</small>
          </strong>
        </div>
        {w.layout === 'tiled' && (
          <div>
            <span>旋转角度</span>
            <strong>{w.angle}°</strong>
          </div>
        )}
      </div>
      <div className="watermark-preview-note">
        <ShieldCheck size={15} />
        <div>
          <strong>
            {w.layout === 'tiled' && w.protectSubtitles ? '字幕区域保持清晰' : '品牌标识全程生效'}
          </strong>
          <p>
            {w.layout === 'tiled' && w.protectSubtitles
              ? '平铺水印避开底部字幕带，保留讲解内容的可读性。'
              : '片头、教程正文与片尾沿用相同的水印设置。'}
          </p>
        </div>
      </div>
      <div className="watermark-preview-scope">
        <Check size={12} /> 保存设置后，审核并重新制作即可应用。
      </div>
    </aside>
  );
}
