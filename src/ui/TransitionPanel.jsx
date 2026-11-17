import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, RotateCcw, Save, Trash2 } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { transitionDefaults, TRANSITION_RANGES } from '../transition-options.mjs';
import { api, basename } from './workbench';
import './frame-template.css';
import './transition.css';

export default function TransitionPanel({ value, setValue, frame, project, disabled }) {
  const id = useId(),
    input = useRef(null);
  const t = transitionDefaults(
    value || { fontSize: project?.exportOptions?.layout?.titleFont || 72 },
  );
  const scenes = project?.script?.scenes.filter((s) => s.kind === 'title') || [];
  const [scope, setScope] = useState('all'),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [templates, setTemplates] = useState([]),
    [name, setName] = useState('');
  const [preview, setPreview] = useState(null),
    [loading, setLoading] = useState(true);
  const card = t.cards.find((c) => c.id === scope);
  const selected = scenes.find((s) => s.id === scope) || scenes[0];
  const content = card || { id: scope, mode: t.mode, path: t.path, heading: '', subtitle: '' };
  const update = (patch) => {
    setValue({ ...t, enabled: true, ...patch });
    setMessage('');
  };
  const updateCard = (patch) => {
    const next = { ...content, ...patch };
    update({ cards: [...t.cards.filter((c) => c.id !== scope), next] });
  };
  useEffect(() => {
    api('/api/transition-templates')
      .then(setTemplates)
      .catch((e) => setError(e.message));
  }, []);
  const request = JSON.stringify({
    projectId: project?.id,
    revision: project?.revision,
    kind: 'title',
    sceneId: selected?.id,
    frame,
    transition: value || t,
  });
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    const timer = setTimeout(
      () =>
        api('/api/branding/preview', JSON.parse(request), { signal: controller.signal })
          .then((result) => {
            if (alive) {
              setPreview(result);
              setLoading(false);
              setError('');
            }
          })
          .catch((e) => {
            if (alive) {
              setLoading(false);
              setError(e.message);
            }
          }),
      180,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [request]);
  const asset = (path, name) => {
    if (scope !== 'all') updateCard({ mode: 'image', path, name, hash: null, info: null });
    else
      update({
        path,
        name,
        hash: null,
        info: null,
        ...(t.mode === 'text' ? { background: 'custom' } : { showChrome: false }),
      });
  };
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
        { method: 'POST', headers: { 'X-Tutor-Token': token }, body: file },
      );
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '上传失败');
      asset(result.path, result.name);
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
      const paths = await window.tutorDesktop.pickBranding('transition');
      const path = Array.isArray(paths) ? paths[0] : paths;
      if (path) asset(path, basename(path));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const field = (key, label, suffix = '') => {
    const [min, max, step] = TRANSITION_RANGES[key];
    return (
      <label className="frame-control" htmlFor={id + key} key={key}>
        <span>
          {label}
          <strong>
            {t[key]}
            {suffix}
          </strong>
        </span>
        <input
          id={id + key}
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          value={t[key]}
          onChange={(e) => update({ [key]: Number(e.target.value) })}
        />
      </label>
    );
  };
  const select = (key, label, options) => (
    <label className="frame-control" htmlFor={id + key}>
      <span>{label}</span>
      <select
        id={id + key}
        aria-label={label}
        value={t[key]}
        onChange={(e) => update({ [key]: e.target.value })}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const saved = await api('/api/transition-templates', { name, transition: t });
      setTemplates((items) => [saved, ...items]);
      setName('');
      setMessage('过场背景与文字样式已保存到本机预设库。');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="frame-template-panel transition-panel" aria-label="章节过场设置">
      <div className="frame-template-heading">
        <div>
          <strong>章节过场</strong>
          <p>默认让整个文字组居中；可沿用正文背景、上传专用背景，或用设计好的整张图片替换过场。</p>
        </div>
        <span>独立背景与内容</span>
      </div>
      <div className="frame-template-workspace">
        <fieldset className="frame-template-controls" disabled={disabled || busy}>
          <legend className="sr-only">过场背景、文字与内容</legend>
          <div className="transition-mode" role="group" aria-label="统一过场内容方式">
            {[
              ['text', '背景 + 可编辑文字'],
              ['image', '整张图片替换'],
            ].map(([mode, label]) => (
              <button
                type="button"
                key={mode}
                aria-pressed={t.mode === mode}
                onClick={() => {
                  setScope('all');
                  update({ mode, ...(mode === 'image' ? { showChrome: false } : {}) });
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="frame-control" htmlFor={id + 'scope'}>
            <span>预览与单独替换章节</span>
            <select
              id={id + 'scope'}
              aria-label="预览与单独替换章节"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="all">统一样式 · 全部章节</option>
              {scenes.map((s, i) => (
                <option key={s.id} value={s.id}>
                  {i + 1}. {s.heading}
                </option>
              ))}
            </select>
          </label>
          {scope !== 'all' && (
            <div className="transition-card-content">
              <label className="frame-control">
                <span>本章节内容方式</span>
                <select
                  aria-label="本章节内容方式"
                  value={content.mode}
                  onChange={(e) => updateCard({ mode: e.target.value })}
                >
                  <option value="text">显示章节文字</option>
                  <option value="image">替换为专属整图</option>
                </select>
              </label>
              {content.mode === 'text' && (
                <>
                  <label className="frame-control">
                    <span>过场显示标题</span>
                    <Textarea
                      aria-label="过场显示标题"
                      rows={2}
                      maxLength={300}
                      placeholder={selected?.heading}
                      value={card?.heading || ''}
                      onChange={(e) => updateCard({ heading: e.target.value })}
                    />
                  </label>
                  <label className="frame-control">
                    <span>过场副标题</span>
                    <Input
                      aria-label="过场副标题"
                      maxLength={300}
                      placeholder={
                        selected?.subtitle || project?.script?.title || '留空沿用教程标题'
                      }
                      value={card?.subtitle || ''}
                      onChange={(e) => updateCard({ subtitle: e.target.value })}
                    />
                  </label>
                  <small>只替换本章节的画面文字，分镜标题与旁白保持可独立编辑。</small>
                </>
              )}
              {card && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => update({ cards: t.cards.filter((c) => c.id !== scope) })}
                >
                  <RotateCcw size={12} /> 恢复本章节默认内容
                </Button>
              )}
            </div>
          )}
          {scope === 'all' &&
            t.mode === 'text' &&
            select('background', '过场背景来源', [
              ['inherit', '沿用正文背景'],
              ['custom', '独立上传过场背景'],
            ])}
          {(scope !== 'all'
            ? content.mode === 'image'
            : t.mode === 'image' || t.background === 'custom') && (
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
                {(scope === 'all'
                  ? t.name || basename(t.path)
                  : content.name || basename(content.path)) || '上传自己的过场图片'}
              </strong>
              <span>PNG / JPG / WebP · 最大 20 MB</span>
              <input
                ref={input}
                type="file"
                accept=".png,.jpg,.jpeg,.webp"
                aria-label="上传过场图片"
                hidden
                onChange={(e) => accept(e.target.files[0])}
              />
              <Button type="button" variant="outline" size="sm" onClick={choose}>
                {scope !== 'all' || t.mode === 'image' ? '上传完整过场图' : '上传过场背景'}
              </Button>
            </div>
          )}
          {(t.mode === 'image' || content.mode === 'image') && (
            <>
              {select('fit', '整图适配方式', [
                ['contain', '完整显示 · 保留设计内容'],
                ['cover', '等比铺满 · 会裁切边缘'],
              ])}
              <p className="frame-template-help">
                整图保留清晰度，不叠加系统标题、字幕、计时器和章节条；旁白与 SRT 仍会保留。
              </p>
            </>
          )}
          {scope === 'all' && t.background === 'custom' && t.mode === 'text' && (
            <div className="transition-fields">
              {field('blur', '过场背景模糊')}
              {field('dim', '过场背景压暗', '%')}
              {field('saturation', '过场背景饱和度', '%')}
            </div>
          )}
          <details className="transition-group" open>
            <summary>整套过场文字布局</summary>
            <div className="transition-fields">
              {select('align', '过场水平对齐', [
                ['left', '靠左'],
                ['center', '居中'],
                ['right', '靠右'],
              ])}
              {select('verticalAlign', '过场垂直对齐', [
                ['top', '靠上'],
                ['center', '居中'],
                ['bottom', '靠下'],
              ])}
              {field('fontSize', '过场标题字号')}
              {field('lineHeight', '过场标题行高', ' 倍')}
              {field('letterSpacing', '过场标题字间距')}
              {field('margin', '过场安全边距')}
              {field('offsetX', '过场水平偏移')}
              {field('offsetY', '过场垂直偏移')}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                update({ align: 'center', verticalAlign: 'center', offsetX: 0, offsetY: 0 })
              }
            >
              <RotateCcw size={12} /> 恢复文字组居中
            </Button>
          </details>
          <details className="transition-group">
            <summary>编号、副标题与信息栏</summary>
            <div className="transition-toggles">
              {[
                ['showNumber', '显示章节编号'],
                ['showSubtitle', '显示过场副标题'],
                ['showChrome', '文字过场保留顶部与底部信息栏'],
              ].map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={t[key]}
                    onChange={(e) => update({ [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="transition-fields">
              {field('numberSize', '过场编号字号')}
              {field('numberGap', '编号与标题间距')}
              {field('subtitleSize', '过场副标题字号')}
              {field('subtitleGap', '标题与副标题间距')}
              {select('contrast', '过场文字配色', [
                ['auto', '自动适配背景'],
                ['light', '浅色文字'],
                ['dark', '深色文字'],
              ])}
            </div>
          </details>
          {!!t.cards.length && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setScope('all');
                update({ cards: [] });
              }}
            >
              清除 {t.cards.length} 个章节单独设置，统一使用当前样式
            </Button>
          )}
          <div className="frame-library">
            <label htmlFor={id + 'name'}>保存整套过场样式为预设</label>
            <div>
              <Input
                id={id + 'name'}
                aria-label="过场预设名称"
                value={name}
                maxLength={40}
                placeholder="例如：品牌课程 · 居中过场"
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
                保存过场预设
              </Button>
            </div>
            <small>保存独立背景、整图与文字布局；章节单独内容留在当前项目。</small>
            {templates.map((item) => (
              <div className="frame-library-item" key={item.id}>
                <button
                  type="button"
                  onClick={() => update({ ...item.transition, cards: t.cards })}
                >
                  {item.name}
                </button>
                <button
                  type="button"
                  aria-label={'删除过场预设 ' + item.name}
                  disabled={!!t.path && t.path === item.transition.path}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api('/api/transition-templates', { action: 'delete', id: item.id });
                      setTemplates((items) => items.filter((x) => x.id !== item.id));
                    } catch (e) {
                      setError(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </fieldset>
        <div className="frame-template-preview transition-preview">
          <strong>章节过场实时预览</strong>
          <div className="frame-preview-screen" aria-busy={loading}>
            {preview && <img src={preview.image} alt="章节过场背景与文字实时预览" />}
            {loading && (
              <span>
                <LoaderCircle size={16} className="animate-spin" />
                正在更新过场
              </span>
            )}
          </div>
          <p>{selected?.heading || '预览示例章节'} · 预览与最终成片共用同一套布局。</p>
          <p>
            编号、标题与副标题按整组定位，长标题自动换行并适配可用空间；背景与正文可统一，也可独立设置。
          </p>
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
