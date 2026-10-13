import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Check,
  CheckCircle2,
  ChevronDown,
  Clapperboard,
  Code2,
  Copy,
  Eye,
  FileText,
  FolderOpen,
  History,
  LayoutList,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  Mic2,
  Play,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  Video,
  WandSparkles,
  X,
} from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from './components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import Conversation from './vendor/tutor/ai-chat-2';
import Shell from './vendor/tutor/app-shell-9';
import Workflow from './vendor/tutor/wizard-1';
import Approval from './vendor/tutor/agent-approval-1';
import Activity from './vendor/tutor/agent-activity-1';
import Usage from './vendor/tutor/ai-usage-1';
import SettingsPanel from './SettingsPanel';
import StreamOutput from './StreamOutput';
import {
  activitySteps,
  api,
  basename,
  clock,
  compact,
  endpoint,
  frameTime,
  kind,
  money,
  phase,
  status,
  voiceName,
} from './workbench';

const STEPS = ['导入素材', '对话改稿', '审核制作', '导出成片'];
const EMPTY_TOTALS = { input: 0, output: 0, sent: 0, received: 0, cost: 0, calls: 0, unpriced: 0 };
const VIEWS = [
  ['script', '剧本', LayoutList],
  ['video', '视频', Video],
  ['json', 'JSON', Code2],
  ['activity', '制作记录', History],
];
function Hint({ label, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
function SectionLabel({ children, trailing }) {
  return (
    <div className="section-label">
      <span>{children}</span>
      {trailing}
    </div>
  );
}
function ModelList({ config, openSettings }) {
  return (
    <div className="model-list">
      {[
        ['vision', '画面理解与校对', Eye],
        ['editor', '剧本改写', Sparkles],
        ['speech', '教程配音', AudioLines],
      ].map(([role, label, Icon]) => (
        <button className="model-row" key={role} onClick={openSettings}>
          <Icon size={15} />
          <span>
            <strong>{label}</strong>
            <small>{config?.roles[role].model || '待配置'}</small>
          </span>
          <span className="model-dot" />
        </button>
      ))}
    </div>
  );
}
function ImportPanel({
  source,
  setSource,
  title,
  setTitle,
  knowledge,
  setKnowledge,
  chooseVideo,
  chooseKnowledge,
  create,
  pending,
  hasKey,
  openSettings,
}) {
  return (
    <div className="import-panel">
      <Badge variant="outline" className="intro-badge">
        <Clapperboard size={12} /> 新的教程
      </Badge>
      <h2>
        把操作录像，<span>整理成清晰的教程。</span>
      </h2>
      <p className="intro-copy">
        先给我一段视频和必要的知识。我们一起完善剧本，你确认后再生成配音与成片。
      </p>
      <button
        className={'video-dropzone ' + (source ? 'has-source' : '')}
        onClick={chooseVideo}
        disabled={pending}
      >
        <span className="drop-icon">{source ? <Video size={27} /> : <Upload size={27} />}</span>
        <strong>{source ? basename(source) : '选择你的操作录像'}</strong>
        <span>{source ? '视频已选择 · 点击更换' : 'MP4、MOV、MKV、WebM · 最长 10 分钟'}</span>
      </button>
      <div className="path-field">
        <Input
          aria-label="视频文件路径"
          placeholder="也可以粘贴本地视频的完整路径"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
      </div>
      <div className="import-field">
        <label htmlFor="tutorial-title">
          教程名称 <span>可选</span>
        </label>
        <Input
          id="tutorial-title"
          placeholder="例如：Yakit 抓包与 Web Fuzzer 入门"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="import-field">
        <label htmlFor="tutorial-knowledge">
          补充知识 <span>可选，能帮助模型纠正术语与事实</span>
        </label>
        <Textarea
          id="tutorial-knowledge"
          placeholder="说明产品术语、教学目标、注意事项，以及哪些内容不能推断……"
          value={knowledge}
          onChange={(e) => setKnowledge(e.target.value)}
          rows={4}
        />
        <div className="field-actions">
          <Button variant="ghost" size="sm" onClick={chooseKnowledge}>
            <Plus size={14} /> 导入知识文件
          </Button>
          <span>TXT / Markdown / JSON / DOCX</span>
        </div>
      </div>
      {!hasKey && (
        <button className="setup-notice" onClick={openSettings}>
          <Settings2 size={16} />
          <span>先配置百炼 API Key，三个模型会共用它。</span>
          <ArrowRight size={15} />
        </button>
      )}
      <Button className="start-button" onClick={create} disabled={!source.trim() || pending}>
        {pending ? <LoaderCircle className="animate-spin" /> : <WandSparkles />} 导入并生成剧本{' '}
        <ArrowRight />
      </Button>
      <div className="import-assurance">
        <ShieldCheck size={14} />
        <span>剧本先由你审核，确认后才进行配音和渲染。</span>
      </div>
    </div>
  );
}

function ScenePreview({ project, scene, onExpand }) {
  const videoRef = useRef(null);
  const seek = () => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = frameTime(scene, project);
  };
  useEffect(seek, [scene?.id, scene?.source_start, scene?.freeze_at, project.id]);
  if (scene?.kind === 'title')
    return (
      <div className="scene-media title-media">
        <span className="yak-mark">YAK / TUTORIAL</span>
        <span className="title-chapter">CHAPTER {String(scene.chapter + 1).padStart(2, '0')}</span>
        <h3>{scene.heading}</h3>
        <span className="title-caption">章节标题卡 · 成片沿用 Yak 风格</span>
      </div>
    );
  return (
    <div className="scene-media">
      <video
        ref={videoRef}
        src={endpoint(project, 'source')}
        controls
        preload="metadata"
        onLoadedMetadata={seek}
        onTimeUpdate={() => {
          const video = videoRef.current;
          if (scene?.source_end != null && video?.currentTime >= scene.source_end && !video.paused)
            video.pause();
        }}
      />
      <Hint label="放大查看原片">
        <Button
          variant="secondary"
          size="icon"
          className="expand-preview"
          aria-label="放大查看原片"
          onClick={onExpand}
        >
          <Maximize2 size={14} />
        </Button>
      </Hint>
      <span className="source-label">原片 {clock(frameTime(scene, project))}</span>
    </div>
  );
}

function Storyboard({
  project,
  script,
  selected,
  setSelected,
  updateScene,
  offerEdit,
  dirty,
  saveScript,
  pending,
  openVideo,
  voice,
}) {
  const scene = script.scenes[selected] || script.scenes[0];
  const [advanced, setAdvanced] = useState(false);
  const filmRef = useRef(null);
  useEffect(() => {
    filmRef.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [selected]);
  return (
    <div className="storyboard">
      <div className="chapter-nav">
        {script.chapters.map((chapter, i) => (
          <button
            key={i}
            className={scene.chapter === i ? 'active' : ''}
            onClick={() => setSelected(script.scenes.findIndex((s) => s.chapter === i))}
          >
            <span>{String(i + 1).padStart(2, '0')}</span>
            <span>{chapter}</span>
          </button>
        ))}
      </div>
      <ScenePreview project={project} scene={scene} onExpand={openVideo} />
      <div className="filmstrip" ref={filmRef} aria-label="分镜时间轴">
        {script.scenes.map((s, i) => (
          <button
            key={s.id}
            aria-label={'分镜 ' + (i + 1) + '：' + s.heading}
            aria-current={selected === i ? 'true' : undefined}
            onClick={() => setSelected(i)}
          >
            <div className={'film-image ' + (s.kind === 'title' ? 'is-title' : '')}>
              {s.kind === 'title' ? (
                <>
                  <Clapperboard size={17} />
                  <span>章节 {s.chapter + 1}</span>
                </>
              ) : (
                <img
                  src={endpoint(project, 'frame') + '?t=' + frameTime(s, project)}
                  loading="lazy"
                  alt=""
                />
              )}
              <span className="film-number">{String(i + 1).padStart(2, '0')}</span>
            </div>
            <span className="film-heading">{s.heading}</span>
            <small>
              {s.kind === 'title'
                ? '标题卡'
                : s.kind === 'observe'
                  ? clock(s.freeze_at) + ' 定格'
                  : clock(s.source_start) + '–' + clock(s.source_end)}
            </small>
          </button>
        ))}
      </div>
      <div className="scene-editor">
        <div className="scene-heading-row">
          <Badge variant="outline">{kind(scene)}</Badge>
          <span>
            {selected + 1} / {script.scenes.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() =>
              offerEdit('把第 ' + (selected + 1) + ' 段「' + scene.heading + '」的解说改成：')
            }
          >
            <MessageSquare size={13} /> 让 AI 改这一段
          </Button>
        </div>
        <Input
          className="scene-title-input"
          aria-label="当前分镜标题"
          value={scene.heading}
          disabled={!!project.job}
          onChange={(e) => updateScene(selected, 'heading', e.target.value)}
        />
        <SectionLabel
          trailing={
            <span className="voice-chip">
              <Mic2 size={12} /> {voice} · 教程播报
            </span>
          }
        >
          解说词
        </SectionLabel>
        <Textarea
          aria-label="当前分镜解说词"
          value={scene.narration}
          disabled={!!project.job}
          onChange={(e) => updateScene(selected, 'narration', e.target.value)}
          rows={3}
          placeholder="留空则保留为无声观察片段"
        />
        <div className="scene-editor-actions">
          <button
            className="text-control"
            aria-expanded={advanced}
            onClick={() => setAdvanced(!advanced)}
          >
            <ChevronDown size={13} className={advanced ? 'rotate-180' : ''} /> 时序与画面依据
          </button>
          {dirty && (
            <Button variant="secondary" size="sm" onClick={saveScript} disabled={pending}>
              <Save size={13} /> 保存修改
            </Button>
          )}
        </div>
        {advanced && (
          <div className="advanced-scene">
            <p>{scene.evidence || scene.keep_reason || '章节引导'}</p>
            {scene.uncertainty && <p className="warning-text">{scene.uncertainty}</p>}
            <div className="timing-fields">
              {(scene.source_start != null
                ? ['source_start', 'source_end', 'hold_at']
                : scene.freeze_at != null
                  ? ['freeze_at']
                  : []
              ).map((field) => (
                <label key={field}>
                  {
                    {
                      source_start: '原片开始',
                      source_end: '原片结束',
                      hold_at: '讲解停顿位置',
                      freeze_at: '定格位置',
                    }[field]
                  }
                  <Input
                    type="number"
                    min="0"
                    max={project.info.duration}
                    step="0.1"
                    value={scene[field] ?? ''}
                    onChange={(e) =>
                      updateScene(
                        selected,
                        field,
                        e.target.value === '' ? null : Number(e.target.value),
                      )
                    }
                    disabled={!!project.job}
                  />
                </label>
              ))}
              <label>
                无声尾段（秒）
                <Input
                  type="number"
                  min="0"
                  max="30"
                  step="0.1"
                  value={scene.silent_tail_seconds}
                  disabled={!!project.job}
                  onChange={(e) =>
                    updateScene(selected, 'silent_tail_seconds', Number(e.target.value))
                  }
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function VideoPanel({
  project,
  output,
  setOutput,
  onSave,
  onReveal,
  sourceTime = 0,
  outputTime = 0,
}) {
  const ref = useRef(null);
  const [time, setTime] = useState(0);
  const plan = project.output?.plan;
  const finishedCurrent = project.output?.revision === project.revision;
  return (
    <div className="video-panel">
      <div className="video-toolbar">
        <div className="segmented">
          <button className={!output ? 'active' : ''} onClick={() => setOutput(false)}>
            原始录像 <span>{clock(project.info.duration)}</span>
          </button>
          <button
            className={output ? 'active' : ''}
            disabled={!project.output}
            onClick={() => setOutput(true)}
          >
            教学成片 <span>{clock(plan?.total_duration)}</span>
          </button>
        </div>
        <span className="video-quality">
          {output
            ? project.output?.verification?.canvas?.width +
              ' × ' +
              project.output?.verification?.canvas?.height +
              ' · ' +
              (finishedCurrent ? '当前版本' : '历史版本')
            : project.info.width + ' × ' + project.info.height}
        </span>
      </div>
      <div className="large-video">
        <video
          key={output ? 'output' : 'source'}
          ref={ref}
          src={endpoint(project, output ? 'output' : 'source')}
          controls
          preload="metadata"
          onLoadedMetadata={() => {
            ref.current.currentTime = output ? outputTime : sourceTime;
          }}
          onTimeUpdate={() => setTime(ref.current?.currentTime || 0)}
        />
      </div>
      {output && plan && (
        <div className="output-timeline" aria-label="成片章节时间轴">
          {plan.chapters_timed.map((chapter, i) => (
            <button
              key={i}
              style={{ flexGrow: chapter.end - chapter.start }}
              className={time >= chapter.start && time < chapter.end ? 'active' : ''}
              onClick={() => {
                ref.current.currentTime = chapter.start;
              }}
            >
              <span>
                {String(i + 1).padStart(2, '0')} · {chapter.title}
              </span>
              <small>
                {clock(chapter.start)} — {clock(chapter.end)}
              </small>
            </button>
          ))}
        </div>
      )}
      {project.output && output && (
        <div className="export-area">
          <div className="export-heading">
            <span>
              <CheckCircle2 size={15} /> {finishedCurrent ? '你的教程已完成' : '已保存的历史成片'}
            </span>
            <Button size="sm" onClick={onSave}>
              <ArrowDownToLine size={14} /> 保存视频
            </Button>
          </div>
          <div className="export-files">
            {[
              ['subtitles.srt', '字幕', 'SRT'],
              ['script.json', '剧本', 'JSON'],
              ['cost.json', '成本记录', 'JSON'],
              ['edit-plan.json', '剪辑时间表', 'JSON'],
            ].map(([file, label, extension]) => (
              <a key={file} href={endpoint(project, 'output') + '?file=' + file} download={file}>
                <FileText size={14} />
                <span>
                  {label}
                  <small>{extension}</small>
                </span>
                <ArrowDownToLine size={13} />
              </a>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={onReveal}>
            <FolderOpen size={14} /> 打开全部输出文件
          </Button>
        </div>
      )}
    </div>
  );
}

function JsonPanel({ value, setValue, save, disabled, pending }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="json-panel">
      <div className="json-toolbar">
        <span>
          <Code2 size={14} /> script.json
        </span>
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              try {
                setValue(JSON.stringify(JSON.parse(value), null, 2));
              } catch {
                toast.error('JSON 格式有误，请检查括号和逗号。');
              }
            }}
          >
            格式化
          </Button>
          <Hint label="复制 JSON">
            <Button
              variant="ghost"
              size="icon"
              aria-label="复制剧本 JSON"
              onClick={async () => {
                await navigator.clipboard.writeText(value);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </Button>
          </Hint>
          <Button size="sm" disabled={disabled || pending} onClick={save}>
            <Save size={13} /> 保存剧本
          </Button>
        </div>
      </div>
      <Textarea
        className="json-editor"
        aria-label="剧本 JSON 编辑器"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
      />
      <p className="json-note">保存会检查片段时间和剧本结构，并重新进入人工审核。</p>
    </div>
  );
}

export default function App() {
  const [projects, setProjects] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [settings, setSettings] = useState(null);
  const [configDraft, setConfigDraft] = useState(null);
  const [view, setView] = useState('script');
  const [source, setSource] = useState('');
  const [title, setTitle] = useState('');
  const [knowledge, setKnowledge] = useState('');
  const [knowledgeDraft, setKnowledgeDraft] = useState('');
  const [scriptDraft, setScriptDraft] = useState(null);
  const [json, setJson] = useState('');
  const [selected, setSelected] = useState(0);
  const [draftOffer, setDraftOffer] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [output, setOutput] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [connection, setConnection] = useState('连接中');
  const [loadError, setLoadError] = useState('');
  const [mobilePane, setMobilePane] = useState('preview');
  const project = projects.find((p) => p.id === activeId) || null;
  const totals = project?.totals || EMPTY_TOTALS;
  const busy = Boolean(project?.job);
  const dirty =
    !!project?.script &&
    !!scriptDraft &&
    JSON.stringify(scriptDraft) !== JSON.stringify(project.script);
  const jsonDirty = !!project?.script && json !== JSON.stringify(scriptDraft, null, 2);
  const finished = phase(project) === 3;
  const hasKey =
    settings &&
    ['vision', 'editor', 'speech'].every(
      (role) => settings.credentialStatus[settings.config.roles[role].credential],
    );
  const voice = voiceName(settings?.config.speech.voice);
  const updateProject = (p) => setProjects((all) => [p, ...all.filter((item) => item.id !== p.id)]);
  const perform = async (fn) => {
    setPending(true);
    try {
      return await fn();
    } catch (error) {
      toast.error(error.message);
      return null;
    } finally {
      setPending(false);
    }
  };
  const openSettings = () => {
    if (!settings) return;
    setConfigDraft(structuredClone(settings.config));
    setSettingsOpen(true);
  };
  const selectProject = (id) => {
    setActiveId(id);
    localStorage.setItem('tutor-project', id);
    setView('script');
    setSelected(0);
    setMobilePane('preview');
  };
  useEffect(() => {
    let alive = true;
    Promise.all([api('/api/projects'), api('/api/settings')])
      .then(([all, value]) => {
        if (!alive) return;
        all.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        setProjects(all);
        setSettings(value);
        const remembered = localStorage.getItem('tutor-project');
        setActiveId(all.some((p) => p.id === remembered) ? remembered : all[0]?.id || null);
      })
      .catch((error) => setLoadError(error.message));
    const events = new EventSource('/api/events');
    events.onopen = () => setConnection('本地已连接');
    events.onerror = () => setConnection('正在重连');
    events.onmessage = (event) => {
      try {
        const p = JSON.parse(event.data);
        if (alive) updateProject(p);
      } catch {}
    };
    return () => {
      alive = false;
      events.close();
    };
  }, []);
  useEffect(() => {
    setScriptDraft(project?.script ? structuredClone(project.script) : null);
    setJson(project?.script ? JSON.stringify(project.script, null, 2) : '');
    setSelected(
      Math.max(0, project?.script?.scenes.findIndex((scene) => scene.kind !== 'title') ?? 0),
    );
    setApproveOpen(false);
  }, [project?.id, project?.revision]);
  useEffect(() => {
    if (!project?.job) {
      setElapsed(0);
      return;
    }
    const start = Date.parse(project.job.startedAt);
    const timer = setInterval(() => setElapsed(Math.max(0, (Date.now() - start) / 1000)), 250);
    return () => clearInterval(timer);
  }, [project?.job?.startedAt]);
  useEffect(() => {
    if (project?.status === 'done') setOutput(true);
  }, [project?.status]);
  useEffect(() => {
    const keydown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector('textarea[aria-label="修改剧本要求"]')?.focus();
        setMobilePane('chat');
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
  const chooseVideo = () =>
    perform(async () => {
      if (!window.tutorDesktop) {
        document.querySelector('input[aria-label="视频文件路径"]')?.focus();
        toast('浏览器模式可粘贴本地视频路径；桌面应用支持选择文件。');
        return;
      }
      const file = await window.tutorDesktop.pickVideo();
      if (file) setSource(file);
    });
  const chooseKnowledge = () =>
    perform(async () => {
      if (!window.tutorDesktop) {
        toast('请直接粘贴知识内容，或在桌面应用中导入文件。');
        return;
      }
      const text = await window.tutorDesktop.pickKnowledge();
      if (text) {
        if (knowledgeOpen) setKnowledgeDraft((old) => old + '\n' + text);
        else setKnowledge((old) => old + '\n' + text);
      }
    });
  const create = () =>
    perform(async () => {
      if (!hasKey) {
        openSettings();
        toast('先保存模型 API Key，素材会保留在这里。');
        return;
      }
      const p = await api('/api/projects', { source: source.trim(), knowledge, title });
      updateProject(p);
      selectProject(p.id);
      setView('activity');
      await api(endpoint(p, 'prepare'), {});
    });
  const saveScript = () =>
    perform(async () => {
      const p = await api(endpoint(project, 'script'), { script: scriptDraft });
      updateProject(p);
      toast.success('剧本已保存，需要重新确认当前版本。');
    });
  const saveJson = () =>
    perform(async () => {
      const p = await api(endpoint(project, 'script'), { script: JSON.parse(json) });
      updateProject(p);
      toast.success('JSON 剧本已保存。');
    });
  const updateScene = (index, field, value) => {
    const next = structuredClone(scriptDraft);
    next.scenes[index][field] = value;
    if (field === 'heading' && next.scenes[index].kind === 'title')
      next.chapters[next.scenes[index].chapter] = value;
    setScriptDraft(next);
    setJson(JSON.stringify(next, null, 2));
  };
  const send = (message) =>
    perform(async () => {
      if (dirty || jsonDirty) {
        toast('先保存右侧的修改，再让 AI 基于最新剧本改写。');
        return;
      }
      await api(endpoint(project, 'edit'), { message });
    });
  const offerEdit = (text) => {
    setDraftOffer({ text, id: Date.now() });
    setMobilePane('chat');
  };
  const cancel = () => perform(() => api(endpoint(project, 'cancel'), {}));
  const prepare = () =>
    perform(async () => {
      if (!hasKey) {
        openSettings();
        return;
      }
      await api(endpoint(project, 'prepare'), {});
      setView('activity');
    });
  const confirmRender = () =>
    perform(async () => {
      if (dirty || jsonDirty || busy)
        throw new Error('请先保存当前修改，并等待正在运行的任务结束。');
      const confirmed = await api(endpoint(project, 'approve'), { hash: project.scriptHash });
      updateProject(confirmed);
      await api(endpoint(confirmed, 'render'), {});
      setApproveOpen(false);
      setView('activity');
    });
  const saveSettings = (config, keys) =>
    perform(async () => {
      const value = await api('/api/settings', { config, keys });
      setSettings(value);
      setSettingsOpen(false);
      toast.success('三模型配置已保存。');
    });
  const reveal = () =>
    perform(async () => {
      if (window.tutorDesktop) await window.tutorDesktop.revealOutput(project.id);
      else toast(project.output?.dir || '可通过下载按钮保存导出文件。', { duration: 6000 });
    });
  const saveVideo = () =>
    perform(async () => {
      if (window.tutorDesktop) await window.tutorDesktop.saveVideo(project.id);
      else {
        const a = document.createElement('a');
        a.href = endpoint(project, 'output') + '?file=tutorial.mp4';
        a.download = 'tutorial.mp4';
        a.click();
      }
    });
  const showKnowledge = () => {
    setKnowledgeDraft(project?.knowledge || knowledge);
    setKnowledgeOpen(true);
  };
  const messages = useMemo(() => {
    if (!project) return [];
    const all = (project.chat || []).map((message, i) => ({
      ...message,
      id: 'message-' + i,
      file:
        message.role === 'assistant' && project.script
          ? 'script.json · v' + project.revision
          : undefined,
    }));
    if (busy) all.push({ id: 'live', role: 'assistant', text: project.progress.stage });
    if (finished)
      all.push({
        id: 'complete',
        role: 'assistant',
        text:
          '教程已生成。共 ' +
          project.output.plan.scenes.length +
          ' 个分镜，时长 ' +
          clock(project.output.verification.duration) +
          '。右侧可以预览成片，下载视频、字幕和剧本。',
      });
    return all;
  }, [project?.chat, busy, project?.progress.stage, finished, project?.revision]);
  const newProject = () => {
    setActiveId(null);
    setSource('');
    setKnowledge('');
    setTitle('');
    setView('script');
    setMobilePane('preview');
  };
  const sidebar = (
    <div className="project-sidebar">
      <div className="brand">
        <span className="brand-symbol">
          <Clapperboard size={19} />
        </span>
        <div>
          <strong>
            Tutor<span>studio</span>
          </strong>
          <small>把操作，变成教程。</small>
        </div>
      </div>
      <Button variant="secondary" className="new-project-button" onClick={newProject}>
        <Plus size={15} /> 新建教程 <kbd>+</kbd>
      </Button>
      <SectionLabel>
        最近的教程 <span className="count">{projects.length}</span>
      </SectionLabel>
      <div className="project-list">
        {projects.length ? (
          projects.map((p) => (
            <button
              key={p.id}
              className={p.id === activeId ? 'active' : ''}
              onClick={() => selectProject(p.id)}
            >
              <span className="project-icon">
                <Video size={15} />
              </span>
              <span>
                <strong>{p.title}</strong>
                <small>
                  {status(p)} · {clock(p.info.duration)} 原片
                </small>
              </span>
              {p.status === 'done' && <Check size={13} className="project-check" />}
            </button>
          ))
        ) : (
          <p className="sidebar-empty">导入第一段视频后，项目会保存在这里。</p>
        )}
      </div>
      <div className="sidebar-bottom">
        <SectionLabel>创作模型</SectionLabel>
        <ModelList config={settings?.config} openSettings={openSettings} />
        <button className="sidebar-settings" onClick={openSettings}>
          <Settings2 size={15} /> 模型与制作设置 <span>↗</span>
        </button>
        <div className="local-state">
          <span className={connection === '本地已连接' ? 'online-dot' : 'offline-dot'} />
          {connection}
          <span>v{__TUTOR_VERSION__}</span>
        </div>
      </div>
    </div>
  );
  const header = (
    <header className="workspace-header">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="打开教程项目菜单">
            <Clapperboard size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={newProject}>
            <Plus size={14} /> 新建教程
          </DropdownMenuItem>
          {projects.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => selectProject(p.id)}>
              <Video size={14} /> {p.title}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="workspace-title">
        <span>创作工作台</span>
        <ChevronDown size={13} />
        <i>/</i>
        <strong>{project?.title || '新教程'}</strong>
      </div>
      <div className="header-actions">
        <Badge variant="outline" className={finished ? 'success-badge' : ''}>
          {finished ? (
            <CheckCircle2 size={12} />
          ) : (
            <span className={busy ? 'busy-dot' : 'status-dot'} />
          )}
          {status(project)}
        </Badge>
        <Hint label="模型与制作设置">
          <Button variant="ghost" size="icon" aria-label="模型与制作设置" onClick={openSettings}>
            <Settings2 size={16} />
          </Button>
        </Hint>
      </div>
    </header>
  );
  const assistantHeader = (
    <div className="assistant-header">
      <span className="assistant-icon">
        <Sparkles size={17} />
      </span>
      <div>
        <h2>创作助手</h2>
        <p>{settings?.config.roles.editor.model || 'Qwen Max'} · 改稿与知识纠正</p>
      </div>
      <kbd>⌃ K</kbd>
    </div>
  );
  const welcome = (
    <div className="assistant-welcome">
      {!project ? (
        <>
          <h3>这次，想教会大家什么？</h3>
          <p>从右侧导入录像开始。我会整理操作顺序、补上标题与解说，给你一份可以逐段修改的剧本。</p>
          <div className="assistant-guide">
            <span>
              <Video size={15} />
              <strong>给我视频</strong>
              <small>补充术语或教学目标</small>
            </span>
            <span>
              <MessageSquare size={15} />
              <strong>一起改稿</strong>
              <small>点选分镜，直接说修改要求</small>
            </span>
            <span>
              <CheckCircle2 size={15} />
              <strong>确认后制作</strong>
              <small>自动剪辑、配音和字幕</small>
            </span>
          </div>
        </>
      ) : (
        <div className="context-card">
          <div>
            <Video size={16} />
            <span>{basename(project.originalSource || project.source)}</span>
            <Badge variant="secondary">{clock(project.info.duration)}</Badge>
          </div>
          <p>
            {project.script
              ? project.script.chapters.length +
                ' 个章节 · ' +
                project.script.scenes.length +
                ' 个分镜 · 第 ' +
                project.revision +
                ' 版'
              : '正在把录像整理成可审核的教程剧本'}
          </p>
          <button onClick={showKnowledge}>
            <FileText size={12} />
            {project.knowledge ? '已添加知识资料 · 查看与编辑' : '补充知识与教学目标'}
            <ArrowRight size={12} />
          </button>
        </div>
      )}
    </div>
  );
  const quickPrompts =
    project?.script && !busy ? (
      <div className="quick-prompts">
        <span>可以这样修改</span>
        {['解说再简短一些，保持术语准确', '多留一点无声观察时间', '检查是否有画面未展示的推断'].map(
          (text) => (
            <button key={text} onClick={() => offerEdit(text)}>
              {text}
              <ArrowRight size={12} />
            </button>
          ),
        )}
      </div>
    ) : null;
  return (
    <div className="app-root rb-theme-scope">
      <Shell sidebar={sidebar} header={header}>
        <Workflow
          steps={STEPS}
          step={phase(project)}
          onStep={(step) => {
            if (!project) return;
            if (step === 0) showKnowledge();
            if (step === 1) setView('script');
            if (step === 2) project.script && !busy ? setApproveOpen(true) : setView('activity');
            if (step === 3 && project.output) {
              setView('video');
              setOutput(true);
            }
          }}
        />
        {loadError && (
          <div className="load-error" role="alert">
            {loadError}
          </div>
        )}
        <div className="mobile-view-switch">
          <button
            className={mobilePane === 'chat' ? 'active' : ''}
            onClick={() => setMobilePane('chat')}
          >
            <MessageSquare size={14} /> 对话
          </button>
          <button
            className={mobilePane === 'preview' ? 'active' : ''}
            onClick={() => setMobilePane('preview')}
          >
            <LayoutList size={14} /> 预览与制作
          </button>
          <select
            aria-label="切换教程项目"
            value={activeId || ''}
            onChange={(e) => (e.target.value ? selectProject(e.target.value) : newProject())}
          >
            <option value="">新教程</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
        <div className={'workbench-columns show-' + mobilePane}>
          <section className="conversation-pane" aria-label="AI 创作对话">
            <Conversation
              key={project?.id || 'new'}
              messages={messages}
              busy={busy}
              liveContent={
                project?.progress.streamText ? (
                  <StreamOutput
                    text={project.progress.streamText}
                    stage={project.progress.stage}
                    estimate={project.progress.streamEstimate}
                  />
                ) : (
                  <p className="task-status">{project?.progress.stage || '正在处理…'}</p>
                )
              }
              header={assistantHeader}
              welcome={
                <>
                  {welcome}
                  {quickPrompts}
                </>
              }
              placeholder={
                project?.script ? '告诉我想改哪一段、怎么改…' : '导入视频后，就可以在这里一起改稿'
              }
              disabled={!project?.script || pending}
              onSend={send}
              onCancel={cancel}
              onAttach={showKnowledge}
              onArtifact={() => {
                setView('script');
                setMobilePane('preview');
              }}
              draftOffer={draftOffer}
            />
            <div className="composer-footnote">
              <ShieldCheck size={11} />
              {busy
                ? '任务运行中，你可以停止生成'
                : 'Enter 发送 · Shift + Enter 换行 · 你确认后才生成视频'}
            </div>
          </section>
          <section className="preview-pane" aria-label="剧本与视频预览">
            {!project ? (
              <ImportPanel
                {...{
                  source,
                  setSource,
                  title,
                  setTitle,
                  knowledge,
                  setKnowledge,
                  chooseVideo,
                  chooseKnowledge,
                  create,
                  pending,
                  hasKey,
                  openSettings,
                }}
              />
            ) : (
              <>
                <div className="preview-topbar">
                  <div className="preview-tabs" role="tablist" aria-label="预览内容">
                    {VIEWS.map(([id, label, Icon]) => (
                      <button
                        key={id}
                        role="tab"
                        aria-selected={view === id}
                        className={view === id ? 'active' : ''}
                        onClick={() => setView(id)}
                      >
                        <Icon size={14} />
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="revision-label">
                    v{project.revision || '—'}
                    {dirty || jsonDirty ? ' · 未保存' : project.script ? ' · 已保存' : ''}
                  </span>
                </div>
                <div className="preview-content">
                  {view === 'script' && scriptDraft && (
                    <Storyboard
                      {...{
                        project,
                        selected,
                        setSelected,
                        updateScene,
                        offerEdit,
                        dirty,
                        saveScript,
                        pending,
                        voice,
                      }}
                      script={scriptDraft}
                      openVideo={() => {
                        setOutput(false);
                        setFullscreenOpen(true);
                      }}
                    />
                  )}
                  {view === 'script' && !scriptDraft && (
                    <div className="waiting-script">
                      <WandSparkles size={30} />
                      <h3>{busy ? '正在把录像整理成教程' : '素材已准备好'}</h3>
                      <p>
                        {busy
                          ? 'Omni 读画面，Max 改写，再由 Omni 对照原片复核。完成后剧本会出现在这里。'
                          : '先生成剧本，再逐段调整解说与画面。'}
                      </p>
                      {!busy && (
                        <Button onClick={prepare} disabled={pending}>
                          <Sparkles size={14} /> 生成并校对剧本
                        </Button>
                      )}
                    </div>
                  )}
                  {view === 'video' && (
                    <VideoPanel
                      {...{ project, output, setOutput }}
                      sourceTime={frameTime(scriptDraft?.scenes[selected], project)}
                      outputTime={
                        project.output?.plan.scenes.find(
                          (s) => s.id === scriptDraft?.scenes[selected]?.id,
                        )?.offset || 0
                      }
                      onSave={saveVideo}
                      onReveal={reveal}
                    />
                  )}
                  {view === 'json' && (
                    <JsonPanel
                      value={json}
                      setValue={setJson}
                      save={saveJson}
                      disabled={busy || !project.script}
                      pending={pending}
                    />
                  )}
                  {view === 'activity' && (
                    <div className="activity-panel">
                      <div className="activity-widget">
                        <Activity
                          steps={activitySteps(project)}
                          busy={busy}
                          elapsed={elapsed}
                          title={project.job?.label || project.progress.stage}
                          onCancel={cancel}
                        />
                      </div>
                      <div className="usage-widget">
                        <Usage records={project.usage} totals={totals} />
                      </div>
                      {project.progress.streamText && (
                        <details className="stream-details">
                          <summary>
                            查看模型的实时输出 · 约 {project.progress.streamEstimate} Token
                          </summary>
                          <StreamOutput
                            text={project.progress.streamText}
                            stage={project.progress.stage}
                            estimate={project.progress.streamEstimate}
                          />
                        </details>
                      )}
                      {project.review && (
                        <div className="review-report">
                          <ShieldCheck size={17} />
                          <div>
                            <strong>Omni 复核意见</strong>
                            <p>{project.review.summary}</p>
                            {project.review.issues.map((issue, i) => (
                              <p
                                key={i}
                                className={issue.severity === 'blocking' ? 'warning-text' : ''}
                              >
                                {issue.scene} · {issue.message}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="next-action">
                  <div>
                    <span>
                      {busy ? (
                        <LoaderCircle size={15} className="animate-spin" />
                      ) : finished ? (
                        <CheckCircle2 size={15} />
                      ) : (
                        <ShieldCheck size={15} />
                      )}
                    </span>
                    <p>
                      <strong>
                        {busy
                          ? project.progress.stage
                          : dirty || jsonDirty
                            ? '保存修改后，审核当前剧本'
                            : finished
                              ? '教程已完成，可以预览与保存'
                              : project.script
                                ? '剧本已准备好，下一步由你审核'
                                : '从剧本开始制作'}
                      </strong>
                      <small>
                        {busy
                          ? Math.round(project.progress.percent) +
                            '% · 约 ' +
                            (project.progress.streamEstimate || 0) +
                            ' 生成 Token'
                          : finished
                            ? '字幕、剧本、时间表和成本记录均已保存'
                            : project.script
                              ? '配音不重叠 · 长解说自动停顿 · 保留无声观察'
                              : '先分析画面，再纠正表达与知识问题'}
                      </small>
                    </p>
                  </div>
                  {busy ? (
                    <Button variant="outline" size="sm" onClick={cancel} disabled={pending}>
                      停止任务
                    </Button>
                  ) : finished ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setView('video');
                        setOutput(true);
                      }}
                    >
                      <Play size={14} /> 查看成片
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => (project.script ? setApproveOpen(true) : prepare())}
                      disabled={
                        pending ||
                        dirty ||
                        jsonDirty ||
                        project.review?.issues.some((i) => i.severity === 'blocking')
                      }
                    >
                      <Check size={14} />
                      {project.script ? '审核并制作' : '生成剧本'}
                    </Button>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
        <footer className="usage-statusbar">
          <span>
            <span className="online-dot" />
            {connection}
          </span>
          <span>
            <Sparkles size={12} />
            {compact(totals.input)} 输入 / {compact(totals.output)} 输出
          </span>
          <span>{totals.calls} 次调用</span>
          <span>
            ↑ {(totals.sent / 1048576).toFixed(2)} MB · ↓ {(totals.received / 1048576).toFixed(2)}{' '}
            MB
          </span>
          <span className="statusbar-cost">
            估算 {money(totals.cost)}
            {totals.unpriced > 0 && ' + ' + totals.unpriced + ' 次用量未知'}
          </span>
        </footer>
      </Shell>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="model-dialog">
          <DialogHeader>
            <DialogTitle>模型与制作设置</DialogTitle>
            <DialogDescription>先配置百炼或自定义源，再为三个模型选择源与音色。</DialogDescription>
          </DialogHeader>
          {configDraft && (
            <SettingsPanel
              value={configDraft}
              setValue={setConfigDraft}
              credentials={settings.credentialStatus}
              save={saveSettings}
              pending={pending}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={knowledgeOpen} onOpenChange={setKnowledgeOpen}>
        <DialogContent className="knowledge-dialog">
          <DialogHeader>
            <DialogTitle>知识与教学目标</DialogTitle>
            <DialogDescription>
              补充术语、产品说明和事实边界。更新知识后，剧本需要重新确认。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="项目知识资料"
            value={knowledgeDraft}
            onChange={(e) => setKnowledgeDraft(e.target.value)}
            rows={12}
            disabled={busy}
          />
          <div className="dialog-footer">
            <Button variant="outline" onClick={chooseKnowledge} disabled={busy}>
              <Plus size={14} /> 导入文件
            </Button>
            <Button
              disabled={busy || pending}
              onClick={() =>
                perform(async () => {
                  if (project)
                    updateProject(
                      await api(endpoint(project, 'knowledge'), { knowledge: knowledgeDraft }),
                    );
                  else setKnowledge(knowledgeDraft);
                  setKnowledgeOpen(false);
                  toast.success('知识资料已保存。');
                })
              }
            >
              <Save size={14} /> 保存知识
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="approval-dialog">
          <DialogHeader>
            <DialogTitle>最后看一遍，再交给我制作</DialogTitle>
            <DialogDescription>
              确认只针对当前版本。之后的剧本修改会进入新的审核。
            </DialogDescription>
          </DialogHeader>
          {project?.script && (
            <Approval
              title={'确认第 ' + project.revision + ' 版剧本'}
              description={
                project.script.chapters.length +
                ' 个章节、' +
                project.script.scenes.length +
                ' 个分镜。将使用' +
                voice +
                '合成教程旁白，沿用 Yak 风格，自动剪辑停顿并生成字幕与时间轴。'
              }
              request={JSON.stringify(
                {
                  revision: project.revision,
                  hash: project.scriptHash,
                  voice: settings?.config.speech.voice,
                  models: Object.fromEntries(
                    Object.entries(settings?.config.roles || {}).map(([name, role]) => [
                      name,
                      role.model,
                    ]),
                  ),
                  outputs: ['视频', '字幕', '剧本', '剪辑时间表', '成本记录'],
                },
                null,
                2,
              )}
              busy={
                pending ||
                busy ||
                dirty ||
                jsonDirty ||
                project.review?.issues.some((i) => i.severity === 'blocking')
              }
              onBack={() => {
                setApproveOpen(false);
                setView('script');
              }}
              onApprove={confirmRender}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent className="video-dialog">
          <DialogHeader>
            <DialogTitle>{project?.title}</DialogTitle>
            <DialogDescription>完整画面预览</DialogDescription>
          </DialogHeader>
          {project && (
            <VideoPanel
              {...{ project, output, setOutput }}
              sourceTime={frameTime(scriptDraft?.scenes[selected], project)}
              outputTime={
                project.output?.plan.scenes.find((s) => s.id === scriptDraft?.scenes[selected]?.id)
                  ?.offset || 0
              }
              onSave={saveVideo}
              onReveal={reveal}
            />
          )}
        </DialogContent>
      </Dialog>
      <Toaster theme="dark" position="bottom-center" richColors closeButton offset={48} />
    </div>
  );
}
