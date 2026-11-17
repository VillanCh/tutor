import { useEffect, useId, useRef, useState } from 'react';
import { Check, ImagePlus, LoaderCircle, Save, Trash2 } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { FRAME_PRESETS, FRAME_DEFAULTS } from '../branding-options.mjs';
import { api, basename } from './workbench';
import './frame-template.css';

export default function FrameTemplatePanel({
  value,
  setValue,
  project,
  disabled,
  transition,
  header,
}) {
  const id = useId(),
    input = useRef(null);
  const [templates, setTemplates] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState('content');
  const update = (change) => {
    setValue({ ...value, ...change });
    setMessage('');
  };
  useEffect(() => {
    api('/api/frame-templates')
      .then(setTemplates)
      .catch((e) => setError(e.message));
  }, []);
  const request = JSON.stringify({
    projectId: project?.id,
    frame: value,
    transition,
    header,
    kind,
    revision: project?.revision,
  });
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api('/api/branding/preview', JSON.parse(request), { signal: controller.signal })
        .then((result) => {
          if (alive) {
            setPreview(result);
            setError('');
            setLoading(false);
          }
        })
        .catch((e) => {
          if (alive) {
            setError(e.message);
            setLoading(false);
          }
        });
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [request]);
  const accept = async (file) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size > 20 * 1024 * 1024)
        throw Error('请选择 20 MB 以内的 PNG、JPG 或 WebP 图片');
      const token = document.querySelector('meta[name="tutor-token"]').content;
      const response = await fetch(
        '/api/uploads/frame-background?name=' + encodeURIComponent(file.name),
        {
          method: 'POST',
          headers: { 'X-Tutor-Token': token },
          body: file,
        },
      );
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '上传失败');
      update({
        enabled: true,
        preset: 'custom',
        blur: FRAME_DEFAULTS.blur,
        dim: FRAME_DEFAULTS.dim,
        saturation: FRAME_DEFAULTS.saturation,
        path: result.path,
        name: result.name,
        hash: null,
        info: null,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const choose = async () => {
    if (!window.tutorDesktop?.pickBranding) return input.current?.click();
    setBusy(true);
    setError('');
    try {
      const selected = await window.tutorDesktop.pickBranding('frame');
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (path)
        update({
          enabled: true,
          preset: 'custom',
          blur: FRAME_DEFAULTS.blur,
          dim: FRAME_DEFAULTS.dim,
          saturation: FRAME_DEFAULTS.saturation,
          path,
          name: basename(path),
          hash: null,
          info: null,
        });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const saved = await api('/api/frame-templates', { name, frame: value });
      setTemplates((items) => [saved, ...items]);
      setName('');
      setMessage('已保存到本机模板库，新项目可直接选用。');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (template) => {
    setBusy(true);
    setError('');
    try {
      await api('/api/frame-templates', { action: 'delete', id: template.id });
      setTemplates((items) => items.filter((item) => item.id !== template.id));
      setMessage('已移除模板，已保存到项目的背景保持可用。');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="frame-template-panel" aria-label="视频框架模板">
      <div className="frame-template-heading">
        <div>
          <strong>视频框架模板</strong>
          <p>为整段教程设置背景，自动适配上下栏、字幕与章节过场。</p>
        </div>
        <span>亮暗自适应</span>
      </div>
      <div className="frame-template-workspace">
        <fieldset disabled={disabled || busy} className="frame-template-controls">
          <legend className="sr-only">背景与模板设置</legend>
          <div className="frame-template-presets" role="group" aria-label="内置框架模板">
            {Object.entries(FRAME_PRESETS)
              .filter(([key]) => key !== 'custom')
              .map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  data-frame-preset={key}
                  aria-pressed={value.enabled && value.preset === key}
                  onClick={() =>
                    update({
                      enabled: true,
                      preset: key,
                      path: '',
                      name: '',
                      hash: null,
                      info: null,
                    })
                  }
                >
                  <i className={'frame-swatch frame-swatch-' + key} />
                  <span>{label}</span>
                  {value.enabled && value.preset === key && <Check size={13} />}
                </button>
              ))}
          </div>
          <div
            className="frame-upload"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!disabled && !busy) accept(e.dataTransfer.files[0]);
            }}
          >
            <ImagePlus size={22} />
            <strong>
              {value.preset === 'custom'
                ? value.name || basename(value.path)
                : '使用自己的品牌背景'}
            </strong>
            <span>拖入图片，或上传 PNG / JPG / WebP · 最大 20 MB</span>
            <input
              ref={input}
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              aria-label="上传框架背景"
              hidden
              onChange={(e) => accept(e.target.files[0])}
            />
            <Button type="button" variant="outline" size="sm" onClick={choose}>
              {busy ? '正在处理…' : '上传背景图片'}
            </Button>
          </div>
          <label className="frame-control" htmlFor={id + '-blur'}>
            <span>
              背景模糊 <strong>{value.blur === 0 ? '关闭' : value.blur}</strong>
            </span>
            <input
              id={id + '-blur'}
              type="range"
              min="0"
              max="60"
              step="1"
              value={value.blur}
              disabled={value.preset !== 'custom'}
              onChange={(e) => update({ blur: Number(e.target.value) })}
            />
            <small>默认模糊、适度压暗并降低饱和度；录屏内容保持清晰。</small>
          </label>
          <div className="frame-focus-presets" role="group" aria-label="背景干扰程度">
            {[
              { label: '柔和 · 推荐', blur: 24, dim: 18, saturation: 65 },
              { label: '更低干扰', blur: 40, dim: 30, saturation: 40 },
              { label: '保留原图', blur: 0, dim: 0, saturation: 100 },
            ].map((preset) => (
              <button
                type="button"
                key={preset.label}
                disabled={value.preset !== 'custom'}
                aria-pressed={
                  value.blur === preset.blur &&
                  value.dim === preset.dim &&
                  value.saturation === preset.saturation
                }
                onClick={() =>
                  update({ blur: preset.blur, dim: preset.dim, saturation: preset.saturation })
                }
              >
                {preset.label}
              </button>
            ))}
          </div>
          {[
            ['dim', '背景压暗', 70],
            ['saturation', '背景饱和度', 100],
          ].map(([key, label, max]) => (
            <label className="frame-control" htmlFor={id + '-' + key} key={key}>
              <span>
                {label}
                <strong>{value[key]}%</strong>
              </span>
              <input
                id={id + '-' + key}
                type="range"
                min="0"
                max={max}
                step="1"
                value={value[key]}
                disabled={value.preset !== 'custom'}
                onChange={(e) => update({ [key]: Number(e.target.value) })}
              />
            </label>
          ))}
          <label className="frame-control" htmlFor={id + '-contrast'}>
            <span>框架文字配色</span>
            <select
              id={id + '-contrast'}
              value={value.contrast}
              onChange={(e) => update({ contrast: e.target.value })}
            >
              <option value="auto">自动 · 上下区域分别匹配</option>
              <option value="light">浅色文字</option>
              <option value="dark">深色文字</option>
            </select>
            <small>复杂背景自动增加局部遮罩，保证标题、字幕和章节清晰。</small>
          </label>
          <div className="frame-library">
            <label htmlFor={id + '-name'}>保存为常用模板</label>
            <div>
              <Input
                id={id + '-name'}
                placeholder="例如：品牌课程 · 暗色"
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!name.trim()}
                onClick={save}
              >
                <Save size={13} /> 保存
              </Button>
            </div>
            {templates.map((template) => (
              <div className="frame-library-item" key={template.id}>
                <button
                  type="button"
                  onClick={() => update({ name: '', hash: null, info: null, ...template.frame })}
                >
                  {template.name}
                </button>
                <button
                  type="button"
                  aria-label={'删除模板 ' + template.name}
                  disabled={value.path === template.frame.path && !!value.path}
                  title="已应用的模板请先切换背景再删除"
                  onClick={() => remove(template)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </fieldset>
        <div className="frame-template-preview">
          <div className="frame-preview-tabs" role="group" aria-label="框架预览内容">
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
          <div className="frame-preview-screen" aria-busy={loading}>
            {preview && <img src={preview.image} alt="视频框架模板实时预览" />}
            {loading && (
              <span>
                <LoaderCircle size={16} className="animate-spin" /> 正在更新预览
              </span>
            )}
          </div>
          <div className="frame-contrast-specs">
            {['top', 'bottom'].map((key) => (
              <span key={key}>
                {key === 'top' ? '顶部标题' : '底部字幕'}
                <strong>{preview?.contrast?.[key]?.light ? '浅色文字' : '深色文字'}</strong>
              </span>
            ))}
          </div>
          <p>背景等比铺满，录屏完整显示。保存项目设置后，重新审核制作即可应用。</p>
        </div>
      </div>
      {message && (
        <p className="frame-template-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="import-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
