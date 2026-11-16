import { useEffect, useId, useState } from 'react';
import { RotateCcw, Save, Trash2 } from 'lucide-react';
import { LAYOUT_PRESETS, LAYOUT_RANGES, normalizeLayout } from '../layout-options.mjs';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { api } from './workbench';

export default function LayoutPanel({ value, setValue, disabled }) {
  const id = useId(),
    l = normalizeLayout(value);
  const [presets, setPresets] = useState([]),
    [name, setName] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  useEffect(() => {
    api('/api/layout-presets')
      .then(setPresets)
      .catch((e) => setError(e.message));
  }, []);
  const change = (patch) => {
    setValue({ ...l, ...patch });
    setMessage('');
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      setPresets(await api('/api/layout-presets', { name, layout: l }));
      setName('');
      setMessage('排版预设已保存，新项目也可直接选用。');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (preset) => {
    setBusy(true);
    setError('');
    try {
      setPresets(await api('/api/layout-presets', { action: 'delete', id: preset.id }));
      setMessage('已移除预设，项目当前排版保持不变。');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const field = (key, label, suffix = '') => {
    const [min, max, step] = LAYOUT_RANGES[key];
    const inactive =
      (key.startsWith('caption') && !l.showCaptions) ||
      (key.startsWith('header') && !l.showHeader) ||
      (['chapterFont', 'chapterGap', 'railHeight'].includes(key) && !l.showTimeline);
    return (
      <label className="layout-field" key={key} htmlFor={id + '-' + key}>
        <span>
          {label}
          <strong>
            {l[key]}
            {suffix}
          </strong>
        </span>
        <input
          id={id + '-' + key}
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          disabled={inactive}
          value={l[key]}
          onChange={(e) => change({ [key]: Number(e.target.value) })}
        />
      </label>
    );
  };
  return (
    <section className="layout-panel" aria-label="自定义视频排版">
      <div className="export-section-heading">
        <span>排版与信息密度</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || busy || !value}
          onClick={() => setValue(undefined)}
        >
          <RotateCcw size={12} /> 恢复原布局
        </Button>
      </div>
      <fieldset disabled={disabled || busy}>
        <legend className="sr-only">视频排版设置</legend>
        <div className="layout-presets" role="group" aria-label="排版密度预设">
          {LAYOUT_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.id}
              data-layout-preset={preset.id}
              aria-pressed={!!value && JSON.stringify(l) === JSON.stringify(preset.value)}
              onClick={() => setValue(preset.value)}
            >
              <strong>{preset.name}</strong>
              <small>{preset.description}</small>
            </button>
          ))}
        </div>
        {!value && (
          <p className="layout-help">当前沿用原版排版。选择预设或调整下方参数，开始自定义。</p>
        )}
        <div className="layout-toggles">
          {[
            ['showHeader', '顶部信息栏'],
            ['showTimer', '顶部计时器'],
            ['showCaptions', '画面字幕'],
            ['showTimeline', '章节进度条'],
            ['timelineLabels', '章节名称'],
          ].map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={l[key]}
                disabled={
                  (key === 'showTimer' && !l.showHeader) ||
                  (key === 'timelineLabels' && !l.showTimeline)
                }
                onChange={(e) => change({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
        <details className="layout-group" open>
          <summary>边缘、边框与区域间距</summary>
          <div className="layout-fields">
            {field('margin', '左右边距')}
            {field('topPadding', '顶部边缘')}
            {field('bottomPadding', '底部边缘')}
            {field('contentGap', '区域间距')}
            {field('borderWidth', '录屏边框宽度')}
            <label className="layout-field">
              <span>录屏垂直位置</span>
              <select
                aria-label="录屏垂直位置"
                value={l.videoAlign}
                onChange={(e) => change({ videoAlign: e.target.value })}
              >
                <option value="top">靠上</option>
                <option value="center">居中</option>
                <option value="bottom">靠下</option>
              </select>
            </label>
          </div>
        </details>
        <details className="layout-group" open>
          <summary>字幕字号、行高与留白</summary>
          <div className="layout-fields">
            {field('captionFont', '字幕字号')}
            {field('captionLineHeight', '字幕行高', ' 倍')}
            {field('captionLines', '每屏字幕行数', ' 行')}
            {field('captionPadding', '字幕上下留白')}
          </div>
          <p className="layout-help">
            行高和留白会同步调整底部区域高度。关闭画面字幕后，SRT 字幕文件仍会保留。
          </p>
        </details>
        <details className="layout-group">
          <summary>顶部、章节与过场文字</summary>
          <div className="layout-fields">
            {field('headerHeight', '顶部栏高度')}
            {field('headerFont', '顶部标题字号')}
            {field('titleFont', '章节过场字号')}
            {field('chapterFont', '章节名称字号')}
            {field('chapterGap', '章节分段间距')}
            {field('railHeight', '进度条粗细')}
          </div>
        </details>
        <div className="layout-library">
          <label htmlFor={id + '-preset-name'}>保存为我的排版预设</label>
          <div className="layout-save">
            <Input
              id={id + '-preset-name'}
              placeholder="例如：紧凑字幕 · 无顶部"
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
              <Save size={12} />
              保存
            </Button>
          </div>
          {presets.map((preset) => (
            <div className="layout-library-item" key={preset.id}>
              <button type="button" onClick={() => setValue(preset.layout)}>
                {preset.name}
              </button>
              <button
                type="button"
                aria-label={'删除排版预设 ' + preset.name}
                onClick={() => remove(preset)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </fieldset>
      {message && (
        <p className="layout-success" role="status">
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
