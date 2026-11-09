import { useEffect, useState } from 'react';
import { Check, CheckCircle2, Clapperboard, LoaderCircle, Maximize2 } from 'lucide-react';
import { EXPORT_ASPECTS, normalizeExportOptions, exportDimensions } from '../export-options.mjs';
import { api } from './workbench';
import './export.css';

export function ExportPreview({ project, value, kind = 'content', sceneId, onPreview }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = JSON.stringify({
    projectId: project.id,
    exportOptions: value,
    kind,
    sceneId,
    revision: project.revision,
  });
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      api('/api/export/preview', JSON.parse(request), { signal: controller.signal })
        .then((result) => {
          if (alive) {
            setPreview(result);
            onPreview?.(result);
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
  }, [request]);
  return (
    <div className="export-preview-screen" aria-busy={loading} data-preview-kind={kind}>
      {preview ? (
        <img
          src={preview.image}
          alt={kind === 'title' ? '所选比例的章节过场预览' : '所选比例的录屏与字幕预览'}
        />
      ) : (
        <Clapperboard size={32} />
      )}
      {loading && (
        <span className="export-preview-loading">
          <LoaderCircle size={16} className="animate-spin" />
          正在更新画布
        </span>
      )}
      {error && (
        <p className="export-preview-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default function ExportPanel({ project, value, setValue, disabled }) {
  const [kind, setKind] = useState('content');
  const [preview, setPreview] = useState(null);
  const options = normalizeExportOptions(value);
  const dimensions =
    options.aspect === 'auto' && preview?.canvas?.legacy
      ? preview.canvas
      : exportDimensions(options, project.info);
  return (
    <div className="export-panel">
      <div className="export-options">
        <div className="export-section-heading">
          <span>画布比例</span>
          <small>适配不同观看场景</small>
        </div>
        <div className="export-aspects" role="group" aria-label="选择导出画布比例">
          {EXPORT_ASPECTS.map((preset) => {
            const active = options.aspect === preset.id,
              ratio = preset.width / preset.height;
            return (
              <button
                key={preset.id}
                type="button"
                className={'export-aspect' + (active ? ' active' : '')}
                aria-pressed={active}
                data-export-aspect={preset.id}
                disabled={disabled}
                onClick={() => setValue({ ...options, aspect: preset.id })}
              >
                <span className="export-ratio-glyph" aria-hidden="true">
                  <i
                    style={{
                      width: ratio >= 1 ? 40 : 40 * ratio,
                      height: ratio >= 1 ? 40 / ratio : 40,
                    }}
                  />
                </span>
                <span>
                  <strong>
                    {preset.id === 'auto' ? preset.label : preset.id}
                    <small>{preset.id !== 'auto' && preset.label}</small>
                  </strong>
                  <span>{preset.description}</span>
                </span>
                {active && <Check size={15} className="export-selected" />}
              </button>
            );
          })}
        </div>
        <label className="export-quality">
          导出清晰度
          <select
            aria-label="导出清晰度"
            value={options.shortEdge}
            disabled={disabled || options.aspect === 'auto'}
            onChange={(event) => setValue({ ...options, shortEdge: Number(event.target.value) })}
          >
            <option value={1080}>
              {options.aspect === 'auto' ? '沿用当前尺寸' : '1080p · 清晰'}
            </option>
            <option value={720}>720p · 轻量</option>
          </select>
        </label>
        <div className="export-dimensions">
          <Maximize2 size={19} />
          <div>
            <strong>
              {dimensions.width} × {dimensions.height}
            </strong>
            <span>{options.aspect === 'auto' ? '沿用原有录屏框架' : '最终成片画布尺寸'}</span>
          </div>
        </div>
        <div className="export-fit-note">
          <CheckCircle2 size={17} />
          <div>
            <strong>录屏等比完整显示</strong>
            <p>
              根据画布调整外框、字幕和章节过场，完整保留原画面；不同方向的素材也会按比例放入框架。
            </p>
          </div>
        </div>
      </div>
      <div className="export-preview-panel">
        <div className="export-section-heading">
          <span>模板预览</span>
          <small>{options.aspect === 'auto' ? '原布局' : options.aspect}</small>
        </div>
        <div className="export-preview-tabs" role="group" aria-label="预览模板内容">
          <button
            type="button"
            aria-pressed={kind === 'content'}
            onClick={() => setKind('content')}
          >
            录屏与字幕
          </button>
          <button type="button" aria-pressed={kind === 'title'} onClick={() => setKind('title')}>
            章节过场
          </button>
        </div>
        <ExportPreview {...{ project, value: options, kind }} onPreview={setPreview} />
        <p className="export-preview-caption">
          预览使用当前素材静帧，正文、过场和成片按同一画布排版。
        </p>
        <p className="export-apply-note">
          应用后重新审核制作，生成所选比例的成片。已有导出版本会保留。
        </p>
      </div>
    </div>
  );
}
