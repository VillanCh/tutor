import { useEffect, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { COVER_DEFAULTS } from '../cover-options.mjs';
import { api, basename } from './workbench';
import './cover.css';

export default function CoverPanel({ project, value, setValue, disabled, onBusy }) {
  const c = { ...COVER_DEFAULTS, ...value };
  const input = useRef(null);
  const [preview, setPreview] = useState(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [uploading, setUploading] = useState(false);
  const request = JSON.stringify({ projectId: project.id, revision: project.revision, cover: c });
  useEffect(() => {
    onBusy?.(uploading);
  }, [uploading, onBusy]);
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    setError('');
    const timer = setTimeout(
      () =>
        api('/api/cover/preview', JSON.parse(request), { signal: controller.signal })
          .then((result) => {
            if (alive) {
              setPreview(result);
              setLoading(false);
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
  const update = (patch) => setValue({ ...c, ...patch });
  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      if (!/\.(png|jpe?g|webp)$/i.test(file.name) || file.size > 20 * 1024 * 1024)
        throw Error('请选择 20 MB 以内的 PNG、JPG 或 WebP');
      const token = document.querySelector('meta[name="tutor-token"]').content;
      const response = await fetch(
        '/api/uploads/frame-background?name=' + encodeURIComponent(file.name),
        { method: 'POST', headers: { 'X-Tutor-Token': token }, body: file },
      );
      const asset = await response.json();
      if (!response.ok) throw Error(asset.error);
      update({ mode: 'image', path: asset.path, name: file.name, hash: null });
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };
  const choose = async () => {
    if (!window.tutorDesktop?.pickBranding) return input.current?.click();
    setUploading(true);
    try {
      const selected = await window.tutorDesktop.pickBranding('cover'),
        path = Array.isArray(selected) ? selected[0] : selected;
      if (path) update({ mode: 'image', path, name: basename(path), hash: null });
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="cover-panel">
      <div className="cover-controls">
        <fieldset disabled={disabled || uploading}>
          <legend>选择封面来源</legend>
          <div className="cover-modes" role="group" aria-label="封面来源">
            {[
              ['generated', '自动标题封面', '跟随教程标题与品牌'],
              ['image', '上传自制封面', '使用自己的图片'],
              ['none', '不使用封面', '保留视频本身的缩略图'],
            ].map(([mode, label, detail]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={c.mode === mode}
                onClick={() => update({ mode })}
              >
                <strong>{label}</strong>
                <small>{detail}</small>
              </button>
            ))}
          </div>
          {c.mode === 'image' && (
            <div className="cover-upload">
              <input
                ref={input}
                type="file"
                accept=".png,.jpg,.jpeg,.webp"
                hidden
                onChange={(event) => {
                  upload(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <Button type="button" variant="outline" onClick={choose}>
                <ImagePlus size={15} />
                {c.path ? '更换封面图片' : '上传封面图片'}
              </Button>
              <small>
                {value?.name || (c.path ? basename(c.path) : 'PNG / JPG / WebP · 最大 20 MB')}
              </small>
              <label>
                图片适配
                <select
                  aria-label="封面图片适配"
                  value={c.fit}
                  onChange={(e) => update({ fit: e.target.value })}
                >
                  <option value="contain">完整显示 · 等比留边</option>
                  <option value="cover">铺满画布 · 等比裁切</option>
                </select>
              </label>
              <label className="cover-check">
                <input
                  type="checkbox"
                  checked={c.overlayTitle}
                  onChange={(e) => update({ overlayTitle: e.target.checked })}
                />
                在图片上叠加教程标题
              </label>
            </div>
          )}
          {(c.mode === 'generated' || (c.mode === 'image' && c.overlayTitle)) && (
            <div className="cover-text-fields">
              <label>
                封面标题
                <Input
                  aria-label="封面标题"
                  value={c.title}
                  maxLength={160}
                  placeholder="留空自动使用教程标题"
                  onChange={(e) => update({ title: e.target.value })}
                />
              </label>
              <label className="cover-check">
                <input
                  type="checkbox"
                  checked={c.showSubtitle}
                  onChange={(e) => update({ showSubtitle: e.target.checked })}
                />
                显示副标题
              </label>
              {c.showSubtitle && (
                <label>
                  封面副标题
                  <Input
                    aria-label="封面副标题"
                    value={c.subtitle}
                    maxLength={240}
                    placeholder="留空自动使用章节名称"
                    onChange={(e) => update({ subtitle: e.target.value })}
                  />
                </label>
              )}
              <div className="cover-row">
                <label>
                  亮暗样式
                  <select
                    aria-label="封面亮暗样式"
                    value={c.theme}
                    onChange={(e) => update({ theme: e.target.value })}
                  >
                    <option value="auto">自动适配</option>
                    <option value="dark">暗色</option>
                    <option value="light">亮色</option>
                  </select>
                </label>
                <label>
                  文字对齐
                  <select
                    aria-label="封面文字对齐"
                    value={c.align}
                    onChange={(e) => update({ align: e.target.value })}
                  >
                    <option value="left">左对齐</option>
                    <option value="center">居中</option>
                  </select>
                </label>
              </div>
            </div>
          )}
          {c.mode !== 'none' && (
            <label className="cover-check">
              <input
                type="checkbox"
                checked={c.embed}
                onChange={(e) => update({ embed: e.target.checked })}
              />
              同时写入 MP4 封面
            </label>
          )}
        </fieldset>
        <p className="cover-note">
          封面独立于片头片尾，不增加时长、不移动字幕或章节。已有成片可直接更新，无需重新配音制作。
        </p>
        {c.mode !== 'none' && (
          <p className="cover-note">
            同时导出
            cover.jpg，方便发布平台单独上传。部分播放器会自行截取缩略图，可使用这张图片设置平台封面。
          </p>
        )}
        {project.output && project.output.revision !== project.revision && (
          <p className="cover-note">当前更新的是已保存的历史成片，自动标题沿用该成片的剧本。</p>
        )}
        {error && (
          <p className="cover-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="cover-preview" aria-busy={loading}>
        <div className="cover-preview-heading">
          <strong>封面预览</strong>
          <span>{preview?.width ? preview.width + ' × ' + preview.height : '随成片比例适配'}</span>
        </div>
        <div className="cover-preview-image">
          {c.mode === 'none' ? (
            <div className="cover-empty">
              <ImagePlus size={32} />
              <strong>不添加独立封面</strong>
              <span>保存后移除 MP4 内嵌封面与导出的封面图片</span>
            </div>
          ) : preview?.image ? (
            <img src={preview.image} alt="视频封面实时预览" />
          ) : (
            <div className="cover-empty">
              <ImagePlus size={32} />
              <span>选择图片或生成标题封面</span>
            </div>
          )}
          {loading && (
            <span className="cover-loading">
              <LoaderCircle size={16} className="animate-spin" />
              更新预览
            </span>
          )}
        </div>
        <p className="cover-note">
          自动封面采用当前教程背景和品牌，长标题自动换行适配。上传整图时可保持原图，也可叠加标题。
        </p>
      </div>
    </div>
  );
}
