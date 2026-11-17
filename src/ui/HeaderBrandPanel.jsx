import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Save, Trash2 } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { headerDefaults, HEADER_RANGES, SURFACE_DEFAULTS } from '../header-options.mjs';
import { api, basename } from './workbench';
import './frame-template.css';
import './header-brand.css';

export default function HeaderBrandPanel({
  value,
  frame,
  transition,
  onChange,
  project,
  disabled,
}) {
  const id = useId(),
    input = useRef(null);
  const [brand, setBrand] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [presets, setPresets] = useState([]),
    [name, setName] = useState(''),
    [preview, setPreview] = useState(null),
    [loading, setLoading] = useState(true),
    [kind, setKind] = useState('content');
  const h = headerDefaults(value, brand),
    s = { ...SURFACE_DEFAULTS, ...frame.surfaces };
  useEffect(() => {
    api('/api/settings')
      .then((result) => setBrand(result.config?.style?.brand))
      .catch((e) => setError(e.message));
    api('/api/header-presets')
      .then(setPresets)
      .catch((e) => setError(e.message));
  }, []);
  const update = (patch) => {
    onChange({ header: { ...h, enabled: true, ensureVisible: true, ...patch } });
    setMessage('');
  };
  const surface = (patch) => {
    onChange({ frame: { ...frame, surfaces: { ...s, ...patch } } });
    setMessage('');
  };
  const request = JSON.stringify({
    projectId: project?.id,
    revision: project?.revision,
    kind,
    header: value,
    frame,
    transition,
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
              setError(e.message);
              setLoading(false);
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
  const setAsset = (path, name) =>
    update({ logoEnabled: true, path, name, hash: null, info: null });
  const accept = async (file) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size > 20 * 1024 * 1024)
        throw Error('请选择 20 MB 以内的 PNG、JPG 或 WebP Logo');
      const token = document.querySelector('meta[name="tutor-token"]').content;
      const response = await fetch(
        '/api/uploads/frame-background?name=' + encodeURIComponent(file.name),
        { method: 'POST', headers: { 'X-Tutor-Token': token }, body: file },
      );
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Logo 上传失败');
      setAsset(result.path, result.name);
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
      const files = await window.tutorDesktop.pickBranding('header');
      const path = Array.isArray(files) ? files[0] : files;
      if (path) setAsset(path, basename(path));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const field = (key, label, suffix = '') => {
    const [min, max, step] = HEADER_RANGES[key];
    return (
      <label className="frame-control" htmlFor={id + key} key={key}>
        <span>
          {label}
          <strong>
            {h[key]}
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
          value={h[key]}
          onChange={(e) => update({ [key]: Number(e.target.value) })}
        />
      </label>
    );
  };
  const check = (key, label) => (
    <label className="header-check" key={key}>
      <input
        type="checkbox"
        checked={h[key]}
        onChange={(e) => update({ [key]: e.target.checked })}
      />
      {label}
    </label>
  );
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const p = await api('/api/header-presets', { name, header: h, surfaces: s });
      setPresets((items) => [p, ...items]);
      setName('');
      setMessage('Logo、品牌文字和上下栏透明度已保存到本机品牌预设。');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="frame-template-panel header-brand-panel" aria-label="品牌与上下栏设置">
      <div className="frame-template-heading">
        <div>
          <strong>品牌与半透明上下栏</strong>
          <p>
            Header 与 Footer 透出同一张背景图，分别调节底色不透明度；左上角可展示品牌文字、Logo 或
            Icon。
          </p>
        </div>
        <span>品牌露出</span>
      </div>
      <div className="frame-template-workspace">
        <fieldset disabled={disabled || busy} className="frame-template-controls">
          <legend className="sr-only">品牌、Logo 与透明度</legend>
          <div className="header-mode" role="group" aria-label="Header 内容模式">
            {[
              ['full', '品牌与章节'],
              ['brand', '仅展示品牌'],
              ['logo', '仅展示 Logo'],
              ['hidden', '隐藏 Header'],
            ].map(([mode, label]) => (
              <button
                type="button"
                key={mode}
                aria-pressed={h.mode === mode}
                onClick={() =>
                  update({
                    mode,
                    ...(mode === 'brand' || mode === 'logo' ? { showFooterChapters: false } : {}),
                    ...(mode === 'logo' ? { logoEnabled: true } : {}),
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
          <p className="header-help">
            “仅展示品牌”与“仅展示
            Logo”会隐藏顶部的分镜标题、章节和计时。底部字幕与进度条可继续保留，区域高度可在“比例与排版”调整。
          </p>
          {project?.exportOptions?.layout?.showHeader === false && !value?.ensureVisible && (
            <p className="header-help">
              当前排版已关闭 Header。选择展示模式、修改品牌或上传 Logo 后保存，会启用顶部区域。
            </p>
          )}
          <details className="header-group" open>
            <summary>Header / Footer 半透明底色</summary>
            <div className="header-surface-presets" role="group" aria-label="上下栏底色预设">
              {[
                ['自动保护文字', { headerMode: 'auto', footerMode: 'auto' }],
                [
                  '半透明',
                  {
                    headerMode: 'custom',
                    headerOpacity: 25,
                    footerMode: 'custom',
                    footerOpacity: 25,
                  },
                ],
                [
                  '完全通透',
                  {
                    headerMode: 'custom',
                    headerOpacity: 0,
                    footerMode: 'custom',
                    footerOpacity: 0,
                  },
                ],
              ].map(([label, patch]) => (
                <button type="button" key={label} onClick={() => surface(patch)}>
                  {label}
                </button>
              ))}
            </div>
            {['header', 'footer'].map((key) => (
              <div className="header-surface" key={key}>
                <label className="frame-control">
                  <span>{key === 'header' ? 'Header 顶部底色' : 'Footer 底部底色'}</span>
                  <select
                    aria-label={key === 'header' ? 'Header 底色模式' : 'Footer 底色模式'}
                    value={s[key + 'Mode']}
                    onChange={(e) => surface({ [key + 'Mode']: e.target.value })}
                  >
                    <option value="auto">自动 · 优先文字清晰</option>
                    <option value="custom">自定义不透明度</option>
                  </select>
                </label>
                <label className="frame-control" htmlFor={id + key + 'Opacity'}>
                  <span>
                    底色不透明度
                    <strong>
                      {s[key + 'Mode'] === 'auto' ? '自动' : s[key + 'Opacity'] + '%'}
                    </strong>
                  </span>
                  <input
                    id={id + key + 'Opacity'}
                    aria-label={key === 'header' ? 'Header 底色不透明度' : 'Footer 底色不透明度'}
                    type="range"
                    min="0"
                    max="100"
                    value={s[key + 'Opacity']}
                    onChange={(e) =>
                      surface({
                        [key + 'Mode']: 'custom',
                        [key + 'Opacity']: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
            ))}
            <p className="header-help">
              0% 直接展示背景，100% 使用完整遮罩。深浅文字随背景匹配；通透底色下会用细描边帮助阅读。
            </p>
          </details>
          {check('showFooterChapters', 'Footer 显示章节名称')}
          <p className="header-help">
            章节名称显示在底部进度区域；可在“比例与排版”开启章节进度条。
          </p>
          {h.mode !== 'hidden' && (
            <>
              <details className="header-group" open>
                <summary>左上角 Header Logo / Icon</summary>
                {h.mode !== 'logo' && check('logoEnabled', '展示 Header Logo / Icon')}
                {(h.logoEnabled || h.mode === 'logo') && (
                  <>
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
                        {h.path ? value?.name || basename(h.path) : '上传品牌 Logo 或 Icon'}
                      </strong>
                      <span>推荐透明 PNG · 也支持 JPG / WebP · 最大 20 MB</span>
                      <input
                        ref={input}
                        hidden
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp"
                        aria-label="上传 Header Logo"
                        onChange={(e) => accept(e.target.files[0])}
                      />
                      <Button type="button" variant="outline" size="sm" onClick={choose}>
                        上传 Header Logo / Icon
                      </Button>
                    </div>
                    <div className="header-fields">
                      {field('logoHeight', 'Logo 高度')}
                      {field('logoMaxWidth', 'Logo 最大宽度')}
                      {field('logoGap', 'Logo 与文字间距')}
                      <label className="frame-control">
                        <span>Logo 配色</span>
                        <select
                          aria-label="Logo 配色"
                          value={h.logoTone}
                          onChange={(e) => update({ logoTone: e.target.value })}
                        >
                          <option value="original">保留原始颜色</option>
                          <option value="auto">自动 · 跟随文字深浅</option>
                          <option value="light">统一浅色</option>
                          <option value="dark">统一深色</option>
                        </select>
                      </label>
                    </div>
                    <p className="header-help">
                      Logo 等比完整显示，并适配 Header 栏高。自动配色适合透明 PNG 图标。
                    </p>
                  </>
                )}
              </details>
              {h.mode !== 'logo' && (
                <details className="header-group" open>
                  <summary>品牌名称与副标题</summary>
                  {check('inheritBrand', '沿用全局品牌文字')}
                  <div className="header-fields">
                    <label className="frame-control">
                      <span>品牌名称</span>
                      <Input
                        aria-label="Header 品牌名称"
                        disabled={h.inheritBrand}
                        value={h.inheritBrand ? (brand?.name ?? h.brandName) : h.brandName}
                        maxLength={48}
                        onChange={(e) => update({ brandName: e.target.value })}
                      />
                    </label>
                    <label className="frame-control">
                      <span>品牌副标题</span>
                      <Input
                        aria-label="Header 品牌副标题"
                        disabled={h.inheritBrand}
                        value={h.inheritBrand ? (brand?.tagline ?? h.brandTagline) : h.brandTagline}
                        maxLength={100}
                        onChange={(e) => update({ brandTagline: e.target.value })}
                      />
                    </label>
                  </div>
                  <div className="header-toggles">
                    {check('showName', '显示品牌名称')}
                    {check('showTagline', '显示品牌副标题')}
                  </div>
                  <div className="header-fields">
                    {field('fontSize', '品牌名称字号')}
                    {field('taglineSize', '品牌副标题字号')}
                    {field('textGap', '品牌文字行间距')}
                  </div>
                </details>
              )}
              <details className="header-group">
                <summary>位置、露出强度与章节内容</summary>
                <div className="header-fields">
                  {field('opacity', '品牌露出不透明度', '%')}
                  {field('offsetX', '品牌水平偏移')}
                  {field('offsetY', '品牌垂直偏移')}
                </div>
                <div className="header-toggles">
                  {h.mode === 'full' && (
                    <>
                      {check('showSceneTitle', 'Header 显示分镜标题')}
                      {check('showChapter', 'Header 显示章节名称')}
                      {check('showTimer', 'Header 显示计时器')}
                    </>
                  )}
                </div>
              </details>
            </>
          )}
          <div className="frame-library">
            <label htmlFor={id + 'preset'}>保存品牌预设</label>
            <div>
              <Input
                id={id + 'preset'}
                aria-label="品牌预设名称"
                placeholder="例如：品牌 Logo · 通透框架"
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
                保存品牌预设
              </Button>
            </div>
            <small className="header-help">
              预设包含 Logo、品牌文字与上下栏透明度，可与不同背景组合使用。
            </small>
            {presets.map((item) => (
              <div className="frame-library-item" key={item.id}>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      header: { ...item.header, ensureVisible: true },
                      frame: { ...frame, surfaces: item.surfaces },
                    })
                  }
                >
                  {item.name}
                </button>
                <button
                  type="button"
                  aria-label={'删除品牌预设 ' + item.name}
                  disabled={!!h.path && h.path === item.header?.path}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api('/api/header-presets', { action: 'delete', id: item.id });
                      setPresets((items) => items.filter((x) => x.id !== item.id));
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
        <div className="frame-template-preview header-brand-preview">
          <div className="frame-preview-tabs" role="group" aria-label="品牌预览内容">
            {[
              ['content', '录屏与字幕'],
              ['title', '章节过场'],
            ].map(([key, label]) => (
              <button
                type="button"
                key={key}
                aria-pressed={kind === key}
                onClick={() => setKind(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="frame-preview-screen" aria-busy={loading}>
            {preview && <img src={preview.image} alt="半透明上下栏与 Header 品牌实时预览" />}
            {loading && (
              <span>
                <LoaderCircle size={16} className="animate-spin" />
                正在更新品牌预览
              </span>
            )}
          </div>
          <p>
            Logo、文字和透明度与最终成片共用渲染。Logo 保持等比；顶部位置在 Header 区域内自动适配。
          </p>
          <p>保存项目设置后，重新审核制作即可应用。</p>
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
