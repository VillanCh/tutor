import { Eye, Mic2, Save, Sparkles } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import ModelPicker from './ModelPicker';
const ROLES = [
  ['vision', '画面理解与复核', Eye],
  ['editor', '剧本改写', Sparkles],
  ['speech', '教程配音', Mic2],
];
export default function SettingsPanel({
  value,
  setValue,
  save,
  pending,
  models = [],
  requiredUpdate = false,
  logout,
}) {
  const brand = { enabled: true, name: 'YAK', tagline: 'TUTORIAL STUDIO', ...value.style.brand };
  const changeBrand = (field, input) =>
    setValue((previous) => ({
      ...previous,
      style: {
        ...previous.style,
        brand: {
          enabled: true,
          name: 'YAK',
          tagline: 'TUTORIAL STUDIO',
          ...previous.style.brand,
          [field]: input,
        },
      },
    }));
  const changeStyle = (field, input) =>
    setValue((previous) => ({ ...previous, style: { ...previous.style, [field]: input } }));
  const updateRole = (role, model) =>
    setValue({ ...value, roles: { ...value.roles, [role]: { model } } });
  return (
    <div className="settings-panel managed-settings">
      <p className="managed-connection">
        <span className="online-dot" /> 已通过 YAKCOOL 账户连接，登录凭据由 Tutor 自动管理。
      </p>
      {requiredUpdate && (
        <div className="model-update-notice" role="status">
          <strong>模型配置已更新，请确认一次</strong>
          <p>
            默认剧本模型已切换为 deepseek-v4.1-flash。qwen3.8-max 已停用，确认后才能开始制作或改写。
          </p>
        </div>
      )}
      <div className="managed-models">
        {ROLES.map(([role, label, Icon]) => (
          <div
            key={role}
            className={role === 'editor' ? 'editor-model-field' : 'fixed-model-field'}
          >
            <label htmlFor={'model-' + role}>
              <Icon size={15} /> {label}
              {role !== 'editor' && <small>固定模型</small>}
            </label>
            {role === 'editor' ? (
              <ModelPicker
                id="model-editor"
                value={value.roles.editor.model}
                models={models}
                disabled={pending}
                onChange={(model) => updateRole('editor', model)}
              />
            ) : (
              <Input
                id={'model-' + role}
                aria-label={label + '模型'}
                value={value.roles[role].model}
                readOnly
              />
            )}
            {role === 'editor' && (
              <p className="model-field-help">
                可搜索账户中的模型，点击或按 Enter 选定。未选定的搜索内容不会保存。
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="managed-speech">
        <label>
          教程音色
          <select
            aria-label="教程音色"
            disabled={pending}
            value={value.speech.voice}
            onChange={(event) =>
              setValue({ ...value, speech: { ...value.speech, voice: event.target.value } })
            }
          >
            <option value="longanlang_v3.1">沉稳男声</option>
            <option value="xuyanchu_v3.1">解说女声</option>
            {!['longanlang_v3.1', 'xuyanchu_v3.1'].includes(value.speech.voice) && (
              <option value={value.speech.voice}>{value.speech.voice}</option>
            )}
          </select>
        </label>
        <label>
          语速
          <Input
            type="number"
            aria-label="配音语速"
            min="0.5"
            max="2"
            step="0.05"
            disabled={pending}
            value={value.speech.rate}
            onChange={(event) =>
              setValue({ ...value, speech: { ...value.speech, rate: Number(event.target.value) } })
            }
          />
        </label>
      </div>
      <div className="settings-section-title brand-section-title">
        <strong>成片品牌与章节</strong>
        <span>内置字体，离线可用 · 保存后用于下次制作</span>
      </div>
      <fieldset disabled={pending} className="brand-settings">
        <div
          style={{
            '--brand-paper': value.style.background,
            '--brand-ink': value.style.ink,
            '--brand-accent': value.style.accent,
            '--brand-gap': (value.style.chapterGap ?? 12) + 'px',
          }}
        >
          <div className="brand-preview" aria-label="成片商标预览">
            {brand.enabled && (
              <div className="brand-preview-wordmark">
                <div className="brand-preview-name">
                  <span>{brand.name || '品牌名称'}</span>
                  <i />
                </div>
                {brand.tagline && <div className="brand-preview-tagline">{brand.tagline}</div>}
              </div>
            )}
            <div className="brand-preview-step">
              <strong>教程步骤预览</strong>
              <small>02 / 03 · 当前章节</small>
            </div>
          </div>
          <div className="brand-preview-track" aria-label="章节分段预览">
            <span />
            <span />
            <span />
          </div>
        </div>
        <label className="brand-enabled">
          <input
            type="checkbox"
            checked={brand.enabled}
            onChange={(e) => changeBrand('enabled', e.target.checked)}
          />
          显示左上角品牌
        </label>
        <div className="brand-fields">
          <label>
            品牌名称
            <Input
              aria-label="成片品牌名称"
              disabled={!brand.enabled}
              maxLength={24}
              value={brand.name}
              onChange={(e) => changeBrand('name', e.target.value)}
            />
          </label>
          <label>
            品牌副标题
            <Input
              aria-label="成片品牌副标题"
              disabled={!brand.enabled}
              maxLength={48}
              placeholder="可留空"
              value={brand.tagline}
              onChange={(e) => changeBrand('tagline', e.target.value)}
            />
          </label>
          <label>
            品牌与进度条点缀色
            <input
              aria-label="成片点缀色"
              type="color"
              value={value.style.accent}
              onChange={(e) => changeStyle('accent', e.target.value)}
            />
          </label>
          <label>
            章节分段间距（像素）
            <Input
              aria-label="章节分段间距"
              type="number"
              min="6"
              max="24"
              step="1"
              value={value.style.chapterGap ?? 12}
              onChange={(e) => changeStyle('chapterGap', Number(e.target.value))}
            />
          </label>
        </div>
      </fieldset>
      <div className="settings-footer">
        <p>模型使用账户可用服务，余额支持随时手动刷新。</p>
        <div className="settings-footer-actions">
          {requiredUpdate && (
            <Button variant="ghost" disabled={pending} onClick={logout}>
              退出账户
            </Button>
          )}
          <Button disabled={pending} onClick={() => save(value)}>
            <Save size={14} /> {requiredUpdate ? '确认更新并继续' : '保存设置'}
          </Button>
        </div>
      </div>
    </div>
  );
}
