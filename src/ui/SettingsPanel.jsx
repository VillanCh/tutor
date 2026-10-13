import { useState } from 'react';
import { Code2, Eye, Mic2, Plus, Save, Server, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import {
  customSource,
  requestEndpoint,
  selectRoleSource,
  updateSource,
} from '../model-sources.mjs';

const ROLES = [
  ['vision', '01', '画面理解与复核', Eye],
  ['editor', '02', '剧本改写与知识纠正', Sparkles],
  ['speech', '03', '教程配音', Mic2],
];

export default function SettingsPanel({ value, setValue, credentials, save, pending }) {
  const [keys, setKeys] = useState({});
  const [sourceId, setSourceId] = useState(value.sources[0].id);
  const [advanced, setAdvanced] = useState(false);
  const [raw, setRaw] = useState('');
  const source = value.sources.find((item) => item.id === sourceId) || value.sources[0];
  const changeSource = (field, input) =>
    setValue((previous) => updateSource(previous, source.id, { [field]: input }));
  const setRole = (role, field, input) =>
    setValue((previous) => ({
      ...previous,
      roles: { ...previous.roles, [role]: { ...previous.roles[role], [field]: input } },
    }));
  const addSource = () => {
    const item = customSource('custom-' + crypto.randomUUID());
    setValue({ ...value, sources: [...value.sources, item] });
    setSourceId(item.id);
  };
  const inUse = Object.values(value.roles).some((role) => role.sourceId === source.id);
  return (
    <div className="settings-panel">
      <div className="source-heading">
        <div>
          <Server size={15} />
          <strong>模型源</strong>
          <span>统一管理接口与 API Key</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={addSource}
          disabled={advanced || value.sources.length >= 20}
        >
          <Plus size={13} /> 添加自定义源
        </Button>
      </div>
      <fieldset disabled={advanced || pending} className="source-config">
        <div className="source-list" aria-label="选择模型源">
          {value.sources.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === source.id ? 'active' : ''}
              onClick={() => setSourceId(item.id)}
              aria-pressed={item.id === source.id}
            >
              <Server size={13} />
              <span>{item.name}</span>
              <Badge variant="outline">{item.kind === 'bailian' ? '百炼' : '自定义'}</Badge>
            </button>
          ))}
        </div>
        <div className="source-editor">
          <div className="source-editor-title">
            <strong>{source.kind === 'bailian' ? '百炼源配置' : '自定义源配置'}</strong>
            {source.kind === 'custom' && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="删除此自定义源"
                disabled={inUse}
                title={inUse ? '先将模型切换到其他源' : '删除此源'}
                onClick={() => {
                  setValue({
                    ...value,
                    sources: value.sources.filter((item) => item.id !== source.id),
                  });
                  setSourceId(value.sources[0].id);
                }}
              >
                <Trash2 size={13} />
              </Button>
            )}
          </div>
          <div className="source-fields">
            <label>
              源名称
              <Input
                aria-label="源名称"
                value={source.name}
                onChange={(e) => changeSource('name', e.target.value)}
              />
            </label>
            <label className="settings-key">
              <span>
                API Key{' '}
                <Badge variant="secondary">
                  {credentials[source.credential] ? '已安全保存' : '待配置'}
                </Badge>
              </span>
              <Input
                aria-label={source.name + ' API Key'}
                type="password"
                autoComplete="off"
                placeholder={
                  credentials[source.credential] ? '留空保留现有 Key' : '输入此源的 API Key'
                }
                value={keys[source.credential] || ''}
                onChange={(e) => setKeys({ ...keys, [source.credential]: e.target.value })}
              />
            </label>
            <label className="source-wide">
              Chat 接口地址
              <Input
                aria-label="源 Chat 接口地址"
                placeholder={
                  source.kind === 'bailian'
                    ? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
                    : 'https://api.example.com/v1'
                }
                value={source.chatBaseUrl}
                onChange={(e) => changeSource('chatBaseUrl', e.target.value)}
              />
            </label>
          </div>
          <p className="source-hint">
            画面理解和剧本改写共用此地址，自动请求 <code>/chat/completions</code>。
            {source.kind === 'bailian' && '也支持百炼工作空间专属域名。'}
          </p>
          <details
            className="source-speech"
            open={source.kind === 'bailian' || value.roles.speech.sourceId === source.id}
          >
            <summary>语音接口</summary>
            <div className="source-speech-fields">
              <label>
                语音协议
                <select
                  aria-label="源语音协议"
                  value={source.speechProtocol}
                  onChange={(e) => changeSource('speechProtocol', e.target.value)}
                >
                  <option value="dashscope-tts">百炼原生 TTS</option>
                  <option value="openai-speech">兼容 Audio Speech</option>
                </select>
              </label>
              <label>
                语音接口地址
                <Input
                  aria-label="源语音接口地址"
                  placeholder={
                    source.speechProtocol === 'openai-speech'
                      ? '留空继承 Chat 地址，自动追加 /audio/speech'
                      : '完整的 SpeechSynthesizer 地址'
                  }
                  value={source.speechBaseUrl}
                  onChange={(e) => changeSource('speechBaseUrl', e.target.value)}
                />
              </label>
            </div>
            <p className="source-hint">
              {source.speechProtocol === 'dashscope-tts'
                ? '此 TTS 使用百炼原生接口，与 Chat 模型共享此源的 Key。'
                : '语音源需支持 /audio/speech 及所选模型、音色。Key 继承此源。'}
            </p>
          </details>
        </div>
      </fieldset>
      <div className="settings-section-title">
        <strong>三个模型</strong>
        <span>分别选择源，继承对应地址与 Key</span>
      </div>
      <fieldset disabled={advanced || pending} className="role-cards">
        {ROLES.map(([role, number, label, Icon]) => (
          <section key={role}>
            <h3>
              <span>{number}</span>
              <Icon size={14} /> {label}
            </h3>
            <label>
              模型源
              <select
                aria-label={label + '模型源'}
                value={value.roles[role].sourceId}
                onChange={(e) =>
                  setValue((previous) => selectRoleSource(previous, role, e.target.value))
                }
              >
                {value.sources.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              模型
              <Input
                aria-label={label + '模型'}
                value={value.roles[role].model}
                onChange={(e) => setRole(role, 'model', e.target.value)}
              />
            </label>
            <div className="role-endpoint">
              <span>
                {role === 'speech'
                  ? value.roles[role].protocol === 'dashscope-tts'
                    ? '百炼原生 TTS'
                    : 'Audio Speech'
                  : 'Chat Completions'}
              </span>
              <code>
                {value.roles[role].baseUrl
                  ? requestEndpoint(value.roles[role])
                  : '请补充所选源的接口地址'}
              </code>
            </div>
          </section>
        ))}
      </fieldset>
      <fieldset disabled={advanced || pending} className="speech-settings">
        <label>
          固定音色
          <select
            aria-label="教程音色"
            value={value.speech.voice}
            onChange={(e) =>
              setValue({ ...value, speech: { ...value.speech, voice: e.target.value } })
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
            aria-label="配音语速"
            type="number"
            min="0.5"
            max="2"
            step="0.05"
            value={value.speech.rate}
            onChange={(e) =>
              setValue({ ...value, speech: { ...value.speech, rate: Number(e.target.value) } })
            }
          />
        </label>
      </fieldset>
      <button
        className="text-control"
        onClick={() => {
          if (!advanced) setRaw(JSON.stringify(value, null, 2));
          setAdvanced(!advanced);
        }}
      >
        <Code2 size={13} /> {advanced ? '收起高级配置' : '高级配置：价格、风格与源参数'}
      </button>
      {advanced && (
        <Textarea
          className="settings-json"
          aria-label="高级模型配置 JSON"
          rows={9}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
      )}
      <div className="settings-footer">
        <p>Key 在 Electron 中由系统加密保存。源配置不含 Key；费用按模型单价估算。</p>
        <Button
          disabled={pending}
          onClick={() => {
            try {
              save(advanced ? JSON.parse(raw) : value, keys);
            } catch (error) {
              toast.error(error.message);
            }
          }}
        >
          <Save size={14} /> 保存配置
        </Button>
      </div>
    </div>
  );
}
