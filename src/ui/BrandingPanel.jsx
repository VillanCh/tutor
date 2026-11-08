import { useId, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  ChevronDown,
  FolderOpen,
  Grid2X2,
  Scan,
  Video,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import {
  brandingDefaults,
  brandingSummary,
  WATERMARK_POSITIONS,
  WATERMARK_DENSITIES,
  WATERMARK_PRESETS,
  WATERMARK_TONES,
  WATERMARK_STYLES,
} from '../branding-options.mjs';
import WatermarkPreview from './WatermarkPreview';
import { basename } from './workbench';

export default function BrandingPanel({ value, setValue, disabled, collapsible = false, project }) {
  const b = brandingDefaults(value);
  const id = useId();
  const [expanded, setExpanded] = useState(Object.values(b).some((item) => item.enabled));
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const [adOpen, setAdOpen] = useState({ intro: !b.intro.path, outro: !b.outro.path });
  const update = (key, change) => setValue({ ...b, [key]: { ...b[key], ...change } });
  const choose = async (key) => {
    setError('');
    if (!window.tutorDesktop?.pickBranding) {
      document.getElementById(id + '-' + key + '-path')?.focus();
      return;
    }
    setPicking(true);
    try {
      const path = await window.tutorDesktop.pickBranding(key);
      if (path) {
        update(key, { path, name: basename(path), info: null, hash: null });
        if (key !== 'watermark') setAdOpen((open) => ({ ...open, [key]: false }));
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setPicking(false);
    }
  };
  const fileInput = (key, label) => (
    <div className="branding-file">
      <label htmlFor={id + '-' + key + '-path'}>{label}</label>
      <div>
        <Input
          id={id + '-' + key + '-path'}
          aria-label={label + '文件路径'}
          placeholder={
            window.tutorDesktop ? '选择文件，或粘贴本地完整路径' : '粘贴本地文件完整路径'
          }
          value={b[key].path}
          title={b[key].path}
          onChange={(event) =>
            update(key, { path: event.target.value, name: '', info: null, hash: null })
          }
        />
        {window.tutorDesktop?.pickBranding && (
          <Button type="button" variant="outline" size="sm" onClick={() => choose(key)}>
            <FolderOpen size={13} /> 选择文件
          </Button>
        )}
      </div>
      {b[key].path && (
        <small className="branding-filename">{b[key].name || basename(b[key].path)}</small>
      )}
    </div>
  );
  const contents = (
    <div className="branding-fields">
      <p className="branding-help">
        按需开启广告素材与水印。片头在正文前播放，片尾用于收尾引导；水印贯穿整条成片。
      </p>
      <div className="branding-workspace">
        <fieldset disabled={disabled || picking}>
          <legend className="sr-only">片头、片尾与全程水印设置</legend>
          {['intro', 'outro'].map((key, index) => {
            const label = key === 'intro' ? '片头广告' : '片尾广告';
            const image = /\.(png|jpe?g|webp)$/i.test(b[key].path);
            return (
              <section className="branding-card" key={key}>
                <label className="branding-toggle" htmlFor={id + '-' + key}>
                  <span className="branding-card-icon">
                    <Video size={15} />
                  </span>
                  <span>
                    <strong>{label}</strong>
                    <small>
                      {index
                        ? '教程结束后，展示品牌或引导关注'
                        : '教程开始前，播放品牌介绍或赞助广告'}
                    </small>
                  </span>
                  <input
                    id={id + '-' + key}
                    type="checkbox"
                    checked={b[key].enabled}
                    onChange={(event) => update(key, { enabled: event.target.checked })}
                  />
                </label>
                {b[key].enabled && b[key].path && (
                  <div className="branding-asset-summary">
                    <span className="branding-asset-icon">
                      <Video size={14} />
                    </span>
                    <span title={b[key].path}>
                      <strong>{b[key].name || basename(b[key].path)}</strong>
                      <small>
                        {image
                          ? b[key].duration + ' 秒 · 静音图片'
                          : '完整视频 · ' + (b[key].muted ? '静音播放' : '保留原声')}
                      </small>
                    </span>
                    <button
                      type="button"
                      onClick={() => setAdOpen((open) => ({ ...open, [key]: !open[key] }))}
                    >
                      {adOpen[key] ? '收起' : '调整'}
                    </button>
                  </div>
                )}
                {b[key].enabled && (adOpen[key] || !b[key].path) && (
                  <div className="branding-card-body">
                    {fileInput(key, label + '素材')}
                    <p className="branding-help">
                      视频支持 MP4 / MOV / MKV / WebM / AVI / M4V，最长 120 秒；图片支持 PNG / JPG /
                      WebP，最大 20 MB。
                    </p>
                    {image ? (
                      <label className="branding-duration" htmlFor={id + '-' + key + '-duration'}>
                        图片展示时长
                        <Input
                          id={id + '-' + key + '-duration'}
                          type="number"
                          min="1"
                          max="60"
                          step="0.5"
                          value={b[key].duration}
                          onChange={(event) =>
                            update(key, { duration: Number(event.target.value) })
                          }
                        />
                        秒 <small>1–60 秒，静音展示</small>
                      </label>
                    ) : (
                      <label className="branding-audio">
                        <input
                          type="checkbox"
                          checked={!b[key].muted}
                          onChange={(event) => update(key, { muted: !event.target.checked })}
                        />
                        保留广告视频原声 <small>按完整时长播放；无音轨时自动静音</small>
                      </label>
                    )}
                  </div>
                )}
              </section>
            );
          })}
          <section className="branding-card">
            <label className="branding-toggle" htmlFor={id + '-watermark'}>
              <span className="branding-card-icon">
                <BadgeCheck size={15} />
              </span>
              <span>
                <strong>全程水印</strong>
                <small>半透明品牌标识，兼顾识别度与内容阅读</small>
              </span>
              <input
                id={id + '-watermark'}
                type="checkbox"
                checked={b.watermark.enabled}
                onChange={(event) => update('watermark', { enabled: event.target.checked })}
              />
            </label>
            {b.watermark.enabled && (
              <div className="branding-card-body">
                <label className="branding-label" htmlFor={id + '-watermark-type'}>
                  水印内容
                </label>
                <select
                  id={id + '-watermark-type'}
                  value={b.watermark.type}
                  onChange={(event) => update('watermark', { type: event.target.value })}
                >
                  <option value="text">文字水印</option>
                  <option value="image">Logo 图片</option>
                </select>
                <div className="watermark-layouts" role="group" aria-label="水印布局">
                  {[
                    ['tiled', '全屏平铺', '斜向重复，覆盖整幅画面', Grid2X2],
                    ['corner', '四角标识', '固定一角，保持画面简洁', Scan],
                  ].map(([layout, title, description, Icon]) => (
                    <button
                      type="button"
                      key={layout}
                      data-layout={layout}
                      aria-pressed={b.watermark.layout === layout}
                      className={b.watermark.layout === layout ? 'active' : ''}
                      onClick={() =>
                        update('watermark', {
                          layout,
                          ...WATERMARK_STYLES[layout],
                        })
                      }
                    >
                      <Icon size={18} />
                      <strong>
                        {title}
                        {layout === 'tiled' && <small>推荐</small>}
                      </strong>
                      <span>{description}</span>
                    </button>
                  ))}
                </div>
                {b.watermark.type === 'text' ? (
                  <div className="branding-file">
                    <label htmlFor={id + '-watermark-text'}>
                      品牌文字 <small>最多 120 字</small>
                    </label>
                    <Input
                      id={id + '-watermark-text'}
                      placeholder="例如：YAKCOOL · yakcool.com"
                      value={b.watermark.text}
                      maxLength={120}
                      onChange={(event) => update('watermark', { text: event.target.value })}
                    />
                    <p className="branding-help">
                      建议填写简短的品牌名、课程标识或网址，例如「YAKCOOL · 实操课堂」。
                    </p>
                  </div>
                ) : (
                  <>
                    {fileInput('watermark', '水印 Logo')}
                    <p className="branding-help">
                      推荐透明背景 PNG；也支持 JPG / WebP，最大 20 MB。
                    </p>
                  </>
                )}
                {b.watermark.layout === 'tiled' && (
                  <div className="watermark-presets" role="group" aria-label="半透明水印预设">
                    {WATERMARK_PRESETS.map((preset) => (
                      <button
                        type="button"
                        key={preset.id}
                        data-preset={preset.id}
                        aria-pressed={
                          b.watermark.opacity === preset.opacity &&
                          b.watermark.width === preset.width &&
                          b.watermark.density === preset.density
                        }
                        onClick={() =>
                          update('watermark', {
                            opacity: preset.opacity,
                            width: preset.width,
                            density: preset.density,
                          })
                        }
                      >
                        <strong>
                          {preset.name}
                          <span>{preset.opacity}%</span>
                        </strong>
                        <small>{preset.detail}</small>
                      </button>
                    ))}
                  </div>
                )}
                <div className="branding-controls">
                  {b.watermark.layout === 'corner' ? (
                    <label htmlFor={id + '-position'}>
                      显示位置
                      <select
                        id={id + '-position'}
                        value={b.watermark.position}
                        onChange={(event) => update('watermark', { position: event.target.value })}
                      >
                        {Object.entries(WATERMARK_POSITIONS).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label htmlFor={id + '-density'}>
                      平铺密度
                      <select
                        id={id + '-density'}
                        aria-label="平铺密度"
                        value={b.watermark.density}
                        onChange={(event) => update('watermark', { density: event.target.value })}
                      >
                        {Object.entries(WATERMARK_DENSITIES).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label htmlFor={id + '-opacity'}>
                    不透明度 <strong>{b.watermark.opacity}%</strong>
                    <input
                      id={id + '-opacity'}
                      type="range"
                      min="5"
                      max="100"
                      step="1"
                      value={b.watermark.opacity}
                      onChange={(event) =>
                        update('watermark', { opacity: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label htmlFor={id + '-width'}>
                    {b.watermark.layout === 'tiled' ? '单个水印宽度' : '水印宽度'}{' '}
                    <strong>{b.watermark.width}%</strong>
                    <input
                      id={id + '-width'}
                      type="range"
                      min="8"
                      max="35"
                      value={b.watermark.width}
                      onChange={(event) =>
                        update('watermark', { width: Number(event.target.value) })
                      }
                    />
                  </label>
                  {b.watermark.layout === 'tiled' && (
                    <label htmlFor={id + '-angle'}>
                      倾斜角度 <strong>{b.watermark.angle}°</strong>
                      <input
                        id={id + '-angle'}
                        aria-label="倾斜角度"
                        type="range"
                        min="-60"
                        max="60"
                        value={b.watermark.angle}
                        onChange={(event) =>
                          update('watermark', { angle: Number(event.target.value) })
                        }
                      />
                    </label>
                  )}
                </div>
                {b.watermark.type === 'text' && (
                  <div className="watermark-tone-field">
                    <span className="branding-label">文字颜色</span>
                    <div role="group" aria-label="水印文字颜色" className="watermark-tones">
                      {Object.entries(WATERMARK_TONES).map(([key, label]) => (
                        <button
                          type="button"
                          key={key}
                          aria-pressed={b.watermark.tone === key}
                          onClick={() => update('watermark', { tone: key })}
                        >
                          <i className={'tone-' + key} />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {b.watermark.layout === 'tiled' && (
                  <label className="watermark-subtitle-protection">
                    <input
                      type="checkbox"
                      checked={b.watermark.protectSubtitles}
                      onChange={(event) =>
                        update('watermark', { protectSubtitles: event.target.checked })
                      }
                    />
                    <span>
                      <strong>保护字幕区域</strong>
                      <small>底部字幕带不叠加水印，讲解文字保持清晰。</small>
                    </span>
                  </label>
                )}
                <p className="branding-help">
                  {b.watermark.layout === 'tiled'
                    ? '默认使用 8% 不透明度与较小的标识，轻轻保留品牌，不影响内容阅读。'
                    : '四角标识保留安全边距，并避开底部字幕区域。'}
                </p>
              </div>
            )}
          </section>
        </fieldset>
        <WatermarkPreview branding={b} project={project} />
      </div>
      <div className="branding-order" aria-label="成片播放顺序">
        {b.intro.enabled && (
          <>
            <span>片头广告</span>
            <ArrowRight size={12} />
          </>
        )}
        <span className="branding-order-content">教程正文</span>
        {b.outro.enabled && (
          <>
            <ArrowRight size={12} />
            <span>片尾广告</span>
          </>
        )}
        {b.watermark.enabled && <small>全程叠加水印</small>}
      </div>
      {error && (
        <p className="import-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
  return (
    <div
      className="branding-panel"
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {collapsible ? (
        <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary>
            <BadgeCheck size={15} />
            <span>
              片头、片尾与水印广告 <small>可选</small>
            </span>
            <ChevronDown size={14} />
          </summary>
          {expanded ? (
            contents
          ) : (
            <p className="branding-collapsed-note">
              {brandingSummary(b)} · 展开设置，统一展示你的品牌
            </p>
          )}
        </details>
      ) : (
        contents
      )}
      {collapsible && !expanded && (
        <p className="branding-collapsed-note">
          支持广告视频、图片及文字 / Logo 水印，点击上方展开。
        </p>
      )}
    </div>
  );
}
