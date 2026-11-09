import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowDown,
  ArrowUp,
  ArrowRight,
  AudioLines,
  BookOpen,
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
  LogOut,
  Maximize2,
  MessageSquare,
  Mic2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  Video,
  Wallet,
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import Conversation from './vendor/tutor/ai-chat-2';
import Shell from './vendor/tutor/app-shell-9';
import Workflow from './vendor/tutor/wizard-1';
import Approval from './vendor/tutor/agent-approval-1';
import Activity from './vendor/tutor/agent-activity-1';
import SettingsPanel from './SettingsPanel';
import BrandingPanel from './BrandingPanel';
import ExportPanel, { ExportPreview } from './ExportPanel';
import { normalizeExportOptions, exportSummary } from '../export-options.mjs';
import { brandingDefaults, brandingSummary } from '../branding-options.mjs';
import StreamOutput from './StreamOutput';
import { balanceText, YakcoolAccountCard } from './YakcoolAccount';
import { readLocal, writeLocal, loadProjectDraft } from './drafts.mjs';
import { useGuide } from './GuideProvider';
import FailurePanel from './FailurePanel';
import { projectFailure } from '../diagnostics.mjs';
import { safePercent } from '../progress.mjs';
import {
  IMAGE_TYPES,
  REFERENCE_LIMITS,
  VIDEO_EXTENSIONS,
  VIDEO_UPLOAD_BYTES,
} from '../file-policy.mjs';
import ReferenceImages from './ReferenceImages';
import {
  activitySteps,
  api,
  basename,
  clock,
  endpoint,
  frameTime,
  kind,
  parseVideoPaths,
  parseScriptJson,
  mergeProjects,
  phase,
  projectSources,
  sceneSource,
  sourceEndpoint,
  status,
  uploadVideo,
  voiceName,
} from './workbench';

const STEPS = ['导入素材', '对话改稿', '审核制作', '导出成片'];
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
  dropVideos,
  chooseKnowledge,
  branding,
  setBranding,
  create,
  pending,
  hasKey,
  openSettings,
  acceptVideoFiles,
  sourceName,
  setSourceName,
  uploadingVideo,
  maxDuration = 600,
  inspection,
}) {
  const files = parseVideoPaths(source);
  const { openGuide } = useGuide();
  const [dragging, setDragging] = useState(false);
  const [pathsOpen, setPathsOpen] = useState(!window.tutorDesktop);
  const inspecting = !!files.length && (inspection?.source !== source || inspection.loading);
  const invalid =
    !!inspection?.error || inspection?.overLimit || inspection?.files?.some((file) => file.error);
  const move = (index, offset) => {
    const next = [...files];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setSource(next.join('\n'));
  };
  const depth = useRef(0);
  return (
    <div
      className="import-panel"
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        if (!pending) {
          event.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!pending) dropVideos(Array.from(event.dataTransfer.files));
      }}
    >
      <Badge variant="outline" className="intro-badge">
        <Clapperboard size={12} /> 新的教程
      </Badge>
      <h2>
        把操作录像，<span>整理成清晰的教程。</span>
      </h2>
      <p className="intro-copy">
        拖入一个或多个视频和必要的知识。我会综合所有素材生成剪辑脚本，我们一起完善，再由你确认制作。
      </p>
      <button type="button" className="import-guide-link" onClick={() => openGuide('import')}>
        <BookOpen size={13} /> 第一次制作？查看导入步骤 <ArrowRight size={12} />
      </button>
      <button
        className={
          'video-dropzone ' + (files.length ? 'has-source ' : '') + (dragging ? 'is-dragging' : '')
        }
        onClick={chooseVideo}
        disabled={pending || uploadingVideo}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            event.stopPropagation();
            depth.current++;
            setDragging(true);
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = pending || uploadingVideo ? 'none' : 'copy';
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (--depth.current <= 0) {
            depth.current = 0;
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          depth.current = 0;
          setDragging(false);
          if (!pending && !uploadingVideo) acceptVideoFiles([...event.dataTransfer.files]);
        }}
      >
        <span className="drop-icon">
          {files.length ? <Video size={27} /> : <Upload size={27} />}
        </span>
        <strong>
          {dragging
            ? '松开以添加这些视频'
            : files.length
              ? '已选择 ' + files.length + ' 个视频 · 继续添加'
              : '拖入多个视频，或点击选择'}
        </strong>
        <span>MP4、MOV、MKV、WebM、AVI、M4V · 总时长最多 {clock(maxDuration)}</span>
      </button>
      {!!files.length && (
        <div
          className={'import-summary ' + (invalid ? 'has-error' : '')}
          role="status"
          aria-live="polite"
        >
          <span>
            {inspecting ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : invalid ? (
              <Eye size={13} />
            ) : (
              <CheckCircle2 size={13} />
            )}
            {inspecting
              ? '正在检查素材…'
              : inspection?.overLimit
                ? '总时长超出限制，请移除部分视频'
                : inspection?.files?.some((file) => file.error)
                  ? '部分素材需要重新选择'
                  : files.length + ' 个视频 · 共 ' + clock(inspection?.totalDuration)}
          </span>
          <small>上限 {clock(maxDuration)}</small>
        </div>
      )}
      {inspection?.error && (
        <p className="import-error" role="alert">
          {inspection.error}
        </p>
      )}
      {!!files.length && (
        <ol className="video-import-list" aria-label="待导入的视频素材">
          {files.map((file, index) => (
            <li key={index}>
              <span className="video-import-number">{String(index + 1).padStart(2, '0')}</span>
              <div className="video-import-detail">
                <span className="video-import-name" title={file}>
                  {basename(file)}
                </span>
                {(() => {
                  const item = inspection?.files?.find(
                    (item) => item.path === file || item.input === file,
                  );
                  return item?.error ? (
                    <small className="import-error">{item.error}</small>
                  ) : item?.info ? (
                    <small>
                      {clock(item.info.duration)} · {item.info.width} × {item.info.height} ·{' '}
                      {item.info.width >= item.info.height ? '横屏' : '竖屏'}
                    </small>
                  ) : (
                    <small>等待检查</small>
                  );
                })()}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={'上移 ' + basename(file)}
                disabled={pending || index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={13} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={'下移 ' + basename(file)}
                disabled={pending || index === files.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={13} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={'移除 ' + basename(file)}
                disabled={pending}
                onClick={() => setSource(files.filter((_, i) => i !== index).join('\n'))}
              >
                <X size={13} />
              </Button>
            </li>
          ))}
        </ol>
      )}
      <details
        className="path-field"
        open={pathsOpen}
        onToggle={(event) => setPathsOpen(event.currentTarget.open)}
      >
        <summary>粘贴文件路径</summary>
        <Textarea
          aria-label="视频文件路径，每行一个"
          placeholder="也可以粘贴本地视频完整路径，每行一个"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          disabled={pending}
          rows={2}
        />
      </details>
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
      <BrandingPanel value={branding} setValue={setBranding} disabled={pending} collapsible />
      {!hasKey && (
        <button className="setup-notice" onClick={openSettings}>
          <Settings2 size={16} />
          <span>可以先导入素材，配置画面理解与改稿模型后生成脚本。</span>
          <ArrowRight size={15} />
        </button>
      )}
      <Button
        className="start-button"
        onClick={create}
        disabled={!files.length || pending || uploadingVideo || inspecting || invalid}
      >
        {pending ? <LoaderCircle className="animate-spin" /> : <WandSparkles />}{' '}
        {pending ? '正在导入素材…' : hasKey ? '生成剪辑脚本' : '先导入素材'} <ArrowRight />
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
  const source = sceneSource(project, scene);
  const seek = () => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = frameTime(scene, project);
  };
  useEffect(seek, [scene?.id, scene?.source_id, scene?.source_start, scene?.freeze_at, project.id]);
  if (
    scene?.kind === 'title' &&
    project.exportOptions?.aspect &&
    project.exportOptions.aspect !== 'auto'
  )
    return (
      <div className="scene-media title-export-media">
        <ExportPreview
          project={project}
          value={project.exportOptions}
          kind="title"
          sceneId={scene.id}
        />
      </div>
    );
  if (scene?.kind === 'title')
    return (
      <div className="scene-media title-media">
        <span className="yak-mark">YAK / TUTORIAL</span>
        <span className="title-chapter">CHAPTER {String(scene.chapter + 1).padStart(2, '0')}</span>
        <h3 title={scene.heading}>{scene.heading}</h3>
        <span className="title-caption">章节标题卡 · 成片沿用 Yak 风格</span>
      </div>
    );
  return (
    <div className="scene-media">
      <video
        ref={videoRef}
        key={source.id}
        src={sourceEndpoint(project, scene)}
        controls
        preload="auto"
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
      <span className="source-label">
        {source.id} · {source.name} · {clock(frameTime(scene, project))}
      </span>
    </div>
  );
}

function ReviewNotice({ project, chooseScene, resolveIssue, pending, dirty }) {
  const issues = project.review?.issues || [];
  const blocking = issues
    .map((issue, index) => ({ ...issue, index }))
    .filter((issue) => issue.severity === 'blocking' && issue.resolved !== true);
  if (!issues.length) return null;
  return (
    <div className={'review-notice ' + (blocking.length ? 'needs-review' : '')}>
      {blocking.length ? (
        <>
          <strong>
            <ShieldCheck size={15} /> 有 {blocking.length} 处需要你核对，解决后即可制作
          </strong>
          {blocking.map((issue) => (
            <div className="review-issue" key={issue.index}>
              <p>
                {issue.source_id && <span>{issue.source_id} · </span>}
                {issue.message}
              </p>
              <div>
                <Button variant="outline" size="sm" onClick={() => chooseScene(issue.scene)}>
                  查看该分镜
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending || dirty || !!project.job}
                  onClick={() => resolveIssue(issue.index)}
                >
                  我已核对，标记解决
                </Button>
              </div>
            </div>
          ))}
        </>
      ) : (
        <details>
          <summary>
            <CheckCircle2 size={14} /> 画面复核完成 ·{' '}
            {issues.filter((issue) => issue.resolved).length
              ? '问题已核对'
              : issues.length + ' 条提示'}
          </summary>
          {issues.map((issue, index) => (
            <p key={index}>
              {issue.resolved ? '已核对 · ' : ''}
              {issue.message}
            </p>
          ))}
        </details>
      )}
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
                  src={sourceEndpoint(project, s, 'frame') + '&t=' + frameTime(s, project)}
                  loading="lazy"
                  alt=""
                />
              )}
              <span className="film-number">{String(i + 1).padStart(2, '0')}</span>
            </div>
            <span className="film-heading">{s.heading}</span>
            <small>
              {s.kind !== 'title' && sceneSource(project, s).id + ' · '}
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
          disabled={!!project.job || pending}
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
          disabled={!!project.job || pending}
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
              {scene.kind !== 'title' && (
                <label>
                  视频素材（时间为片内秒数）
                  <select
                    className="scene-source-select"
                    aria-label="当前分镜视频素材"
                    value={sceneSource(project, scene).id}
                    disabled={!!project.job || pending}
                    onChange={(event) => updateScene(selected, 'source_id', event.target.value)}
                  >
                    {projectSources(project).map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.id} · {source.name} ({clock(source.info.duration)})
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
                    max={sceneSource(project, scene).info.duration}
                    step="0.1"
                    value={scene[field] ?? ''}
                    onChange={(e) =>
                      updateScene(
                        selected,
                        field,
                        e.target.value === '' ? null : Number(e.target.value),
                      )
                    }
                    disabled={!!project.job || pending}
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
                  disabled={!!project.job || pending}
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
  onExportOptions,
  sourceTime = 0,
  sourceId,
  outputTime = 0,
}) {
  const ref = useRef(null);
  const [time, setTime] = useState(0);
  const [selectedSource, setSelectedSource] = useState(sourceId || projectSources(project)[0].id);
  useEffect(() => {
    setSelectedSource(sourceId || projectSources(project)[0].id);
  }, [project.id, sourceId]);
  const source = sceneSource(project, { source_id: selectedSource });
  const plan = project.output?.plan;
  const finishedCurrent = project.output?.revision === project.revision;
  return (
    <div className="video-panel">
      <div className="video-toolbar">
        <div className="segmented">
          <button className={!output ? 'active' : ''} onClick={() => setOutput(false)}>
            原始录像 <span>{clock(source.info.duration)}</span>
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
            : source.info.width + ' × ' + source.info.height}
        </span>
      </div>
      {!output && projectSources(project).length > 1 && (
        <label className="video-source-picker">
          原始素材
          <select
            aria-label="预览视频素材"
            value={source.id}
            onChange={(event) => setSelectedSource(event.target.value)}
          >
            {projectSources(project).map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} · {item.name} · {clock(item.info.duration)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="large-video">
        <video
          key={
            project.id +
            (output
              ? 'output-' + (project.output?.completedAt || project.output?.revision)
              : source.id)
          }
          ref={ref}
          src={
            output
              ? endpoint(project, 'output') +
                '?v=' +
                encodeURIComponent(project.output?.completedAt || project.output?.revision)
              : sourceEndpoint(project, { source_id: source.id })
          }
          controls
          preload="auto"
          onLoadedMetadata={() => {
            ref.current.currentTime = output
              ? outputTime
              : source.id === sourceId
                ? Math.min(sourceTime, source.info.duration - 0.04)
                : 0;
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
            <div className="export-save-actions">
              {onExportOptions && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onExportOptions}
                  disabled={!!project.job}
                >
                  <Maximize2 size={14} />
                  调整导出比例
                </Button>
              )}
              <Button size="sm" onClick={onSave}>
                <ArrowDownToLine size={14} /> 保存视频
              </Button>
            </div>
          </div>
          <div className="export-files">
            {[
              ['subtitles.srt', '字幕', 'SRT'],
              ['script.json', '剧本', 'JSON'],
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
        disabled={disabled || pending}
      />
      <p className="json-note">保存会检查片段时间和剧本结构，并重新进入人工审核。</p>
    </div>
  );
}

export default function App({ account, refreshAccount, logout, accountPending }) {
  const { openGuide, intent: guideIntent, consumeIntent } = useGuide();
  const [projects, setProjects] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [settings, setSettings] = useState(null);
  const [configDraft, setConfigDraft] = useState(null);
  const [view, setView] = useState('script');
  const [source, setSource] = useState(() => readLocal('tutor-import')?.source || '');
  const [title, setTitle] = useState(() => readLocal('tutor-import')?.title || '');
  const [knowledge, setKnowledge] = useState(() => readLocal('tutor-import')?.knowledge || '');
  const [branding, setBranding] = useState(() =>
    brandingDefaults(readLocal('tutor-import')?.branding),
  );
  const [brandingDraft, setBrandingDraft] = useState(null);
  const [brandingOpen, setBrandingOpen] = useState(false);
  const [exportDraft, setExportDraft] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [inspection, setInspection] = useState(null);
  const [importDraftReady, setImportDraftReady] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const videoInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const [referenceImages, setReferenceImages] = useState([]);
  const referenceImagesRef = useRef([]);
  const [readingImages, setReadingImages] = useState(false);
  const imageReadingRef = useRef(false);
  const attachmentEpoch = useRef(0);
  const [imageDragging, setImageDragging] = useState(false);
  const imageDragDepth = useRef(0);
  const [referencePreview, setReferencePreview] = useState(null);
  const [knowledgeDraft, setKnowledgeDraft] = useState('');
  const [scriptDraft, setScriptDraft] = useState(null);
  const [json, setJson] = useState('');
  const [draftOwner, setDraftOwner] = useState(null);
  const previousProject = useRef(null);
  const [selected, setSelected] = useState(0);
  const [draftOffer, setDraftOffer] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [output, setOutput] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [connection, setConnection] = useState('连接中');
  const [loadError, setLoadError] = useState('');
  const [requestError, setRequestError] = useState(null);
  const [mobilePane, setMobilePane] = useState('preview');
  const project = projects.find((p) => p.id === activeId) || null;
  const busy = Boolean(project?.job);
  const failure = projectFailure(project);
  const taskError =
    requestError &&
    project &&
    requestError.projectId === project.id &&
    !(project.stateVersion > requestError.stateVersion && (project.job || project.failure))
      ? requestError
      : null;
  const canRender = !!project?.approvalValid;
  const dirty =
    !!project?.script &&
    !!scriptDraft &&
    JSON.stringify(scriptDraft) !== JSON.stringify(project.script);
  const jsonDirty = !!project?.script && json !== JSON.stringify(scriptDraft, null, 2);
  const finished = phase(project) === 3;
  const hasKey = !!account.authenticated;
  const voice = voiceName(settings?.config.speech.voice);
  const updateProject = (p) => setProjects((all) => mergeProjects(all, [p]));
  const perform = async (fn) => {
    setPending(true);
    try {
      return await fn();
    } catch (error) {
      if (error.project) updateProject(error.project);
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
    setOutput(false);
    setMobilePane('preview');
  };
  useEffect(() => {
    let alive = true;
    Promise.all([api('/api/projects'), api('/api/settings')])
      .then(([all, value]) => {
        if (!alive) return;
        all.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        setProjects((current) => mergeProjects(current, all));
        setSettings(value);
        if (value.modelPolicy?.requiresConfirmation) {
          setConfigDraft(structuredClone(value.config));
          setSettingsOpen(true);
        }
        setLoadError('');
        const remembered = localStorage.getItem('tutor-project');
        setActiveId(
          remembered === 'new'
            ? null
            : all.some((p) => p.id === remembered)
              ? remembered
              : all[0]?.id || null,
        );
      })
      .catch((error) => setLoadError(error.message));
    const events = new EventSource('/api/events');
    events.onopen = () => {
      setConnection('本地已连接');
      api('/api/projects')
        .then((all) => {
          if (alive) {
            setProjects((current) => mergeProjects(current, all));
            setLoadError('');
          }
        })
        .catch((error) => {
          if (alive) setLoadError(error.message);
        });
    };
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
    let alive = true;
    api('/api/drafts/import')
      .then((draft) => {
        if (!alive) return;
        if (draft && !readLocal('tutor-import')) {
          setSource(draft.source || '');
          setTitle(draft.title || '');
          setKnowledge(draft.knowledge || '');
          setBranding(brandingDefaults(draft.branding));
        }
        setImportDraftReady(true);
      })
      .catch(() => {
        if (alive) setImportDraftReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const draft =
      source || title || knowledge || Object.values(branding).some((item) => item.enabled)
        ? { source, title, knowledge, branding }
        : null;
    writeLocal('tutor-import', draft);
    if (importDraftReady) api('/api/drafts/import', { draft }).catch(() => {});
  }, [source, title, knowledge, branding, importDraftReady]);
  useEffect(() => {
    if (project || !parseVideoPaths(source).length) {
      setInspection(null);
      return;
    }
    let alive = true;
    const controller = new AbortController();
    setInspection((old) => ({ ...old, source, loading: true, error: null }));
    const timer = setTimeout(() => {
      api(
        '/api/import/inspect',
        { sources: parseVideoPaths(source) },
        { signal: controller.signal },
      )
        .then((value) => {
          if (alive) setInspection({ ...value, source, loading: false });
        })
        .catch((error) => {
          if (alive) setInspection({ source, loading: false, error: error.message });
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [source, project?.id, settings?.config.limits.maxDuration]);
  useEffect(() => {
    const preventFileNavigation = (event) => {
      if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
    };
  }, []);
  useEffect(() => {
    const draft = project?.script ? loadProjectDraft(project) : null;
    setScriptDraft(draft?.script || (project?.script ? structuredClone(project.script) : null));
    setJson(draft?.json ?? (project?.script ? JSON.stringify(project.script, null, 2) : ''));
    setDraftOwner(
      project
        ? { id: project.id, baseHash: project.scriptHash, ready: !!draft || !project.script }
        : null,
    );
    if (previousProject.current !== project?.id)
      setSelected(
        Math.max(0, project?.script?.scenes.findIndex((scene) => scene.kind !== 'title') ?? 0),
      );
    previousProject.current = project?.id;
    setApproveOpen(false);
    let alive = true;
    if (project?.script && !draft) {
      api('/api/drafts/' + project.id)
        .then((saved) => {
          if (!alive) return;
          if (
            !loadProjectDraft(project) &&
            saved?.baseHash === project.scriptHash &&
            Array.isArray(saved.script?.scenes)
          ) {
            setScriptDraft(saved.script);
            setJson(saved.json ?? JSON.stringify(saved.script, null, 2));
          }
          setDraftOwner({ id: project.id, baseHash: project.scriptHash, ready: true });
        })
        .catch(() => {
          if (alive) setDraftOwner({ id: project.id, baseHash: project.scriptHash, ready: true });
        });
    }
    return () => {
      alive = false;
    };
  }, [project?.id, project?.scriptHash]);
  useEffect(() => {
    if (
      !project?.script ||
      draftOwner?.id !== project.id ||
      draftOwner.baseHash !== project.scriptHash
    )
      return;
    const draft =
      dirty || jsonDirty ? { baseHash: project.scriptHash, script: scriptDraft, json } : null;
    writeLocal('tutor-draft:' + project.id, draft);
    if (draftOwner.ready) api('/api/drafts/' + project.id, { draft }).catch(() => {});
  }, [project?.id, project?.scriptHash, draftOwner, scriptDraft, json, dirty, jsonDirty]);
  useEffect(() => {
    setRequestError(null);
  }, [project?.id]);
  useEffect(() => {
    attachmentEpoch.current++;
    referenceImagesRef.current = [];
    setReferenceImages([]);
    setImageDragging(false);
  }, [project?.id]);
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
    if (project?.error) {
      setMobilePane('preview');
      setApproveOpen(false);
      setView('activity');
      requestAnimationFrame(() => document.querySelector('.preview-content')?.scrollTo({ top: 0 }));
    }
  }, [project?.id, project?.error, project?.failure?.at]);
  useEffect(() => {
    const keydown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!project?.script || busy || pending) return;
        if (jsonDirty) saveJson();
        else if (dirty) saveScript();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector('textarea[aria-label="修改剧本要求"]')?.focus();
        setMobilePane('chat');
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [project?.id, busy, pending, dirty, jsonDirty, scriptDraft, json]);
  const addVideos = (files) => {
    if (!files.length) return;
    const videos = files.filter((file) => /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file));
    if (!videos.length)
      throw new Error('没有找到视频，请选择 MP4、MOV、MKV、WebM、AVI 或 M4V 文件。');
    const before = parseVideoPaths(source);
    const normalizePath = (file) =>
      window.tutorDesktop?.platform === 'win32' ? file.toLowerCase() : file;
    const previous = new Set(before.map(normalizePath));
    const added = new Set(videos.map(normalizePath).filter((file) => !previous.has(file))).size;
    if (files.length > videos.length)
      toast('已忽略 ' + (files.length - videos.length) + ' 个非视频文件');
    else if (!added) toast('这些视频已经添加过了');
    setSource((previous) => {
      const unique = new Map();
      for (const file of [...parseVideoPaths(previous), ...videos]) {
        const key = normalizePath(file);
        if (!unique.has(key)) unique.set(key, file);
      }
      return [...unique.values()].join('\n');
    });
  };
  const dropVideos = (files) =>
    perform(async () => {
      if (!files.length) return;
      if (!window.tutorDesktop?.getPathForFile)
        throw new Error(
          '浏览器无法读取本地文件完整路径，请在下方每行粘贴一个路径，或使用桌面应用拖入。',
        );
      const paths = files.map((file) => window.tutorDesktop.getPathForFile(file));
      if (paths.some((file) => !file))
        throw new Error('无法读取拖入文件，请从系统文件管理器拖入视频文件。');
      addVideos(paths);
    });
  const chooseVideo = () =>
    perform(async () => {
      if (!window.tutorDesktop) {
        videoInputRef.current?.click();
        return;
      }
      const files = await window.tutorDesktop.pickVideo();
      if (files) addVideos(Array.isArray(files) ? files : [files]);
    });
  const acceptVideoFiles = async (files) => {
    if (!files.length || uploadingVideo) return;
    setUploadingVideo(true);
    try {
      const paths = [];
      for (const file of files) {
        if (!VIDEO_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) continue;
        const local = window.tutorDesktop?.getPathForFile(file);
        if (!local && file.size > VIDEO_UPLOAD_BYTES)
          throw new Error('浏览器上传的视频不能超过 1 GB');
        paths.push(local || (await uploadVideo(file)));
      }
      if (paths.length !== files.length)
        toast('已忽略 ' + (files.length - paths.length) + ' 个非视频文件');
      addVideos(paths);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setUploadingVideo(false);
    }
  };
  const setImages = (images) => {
    referenceImagesRef.current = images;
    setReferenceImages(images);
  };
  const addReferenceImages = async (files) => {
    if (!project?.script || busy || pending) {
      toast('请先生成剧本，并等待当前任务结束后再添加参考图。');
      return;
    }
    if (imageReadingRef.current) {
      toast('正在读取图片，请稍后再添加。');
      return;
    }
    if (!files.length) return;
    const epoch = attachmentEpoch.current;
    imageReadingRef.current = true;
    setReadingImages(true);
    try {
      if (referenceImagesRef.current.length + files.length > REFERENCE_LIMITS.count)
        throw new Error('最多添加 4 张参考图片');
      const images = [];
      for (const file of files) {
        if (!IMAGE_TYPES.includes(file.type)) throw new Error('参考图片仅支持 PNG、JPEG 和 WebP');
        if (file.size > REFERENCE_LIMITS.fileBytes) throw new Error('每张参考图片不能超过 5 MB');
        const bitmap = await createImageBitmap(file);
        const pixels = bitmap.width * bitmap.height;
        bitmap.close();
        if (pixels > 40000000) throw new Error('参考图片尺寸过大，请缩小后重试');
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('图片读取失败'));
          reader.readAsDataURL(file);
        });
        images.push({
          id: crypto.randomUUID(),
          name: file.name || '粘贴截图.png',
          size: file.size,
          dataUrl,
        });
      }
      if (epoch !== attachmentEpoch.current) return;
      const combined = [...referenceImagesRef.current, ...images];
      if (combined.reduce((sum, image) => sum + image.size, 0) > REFERENCE_LIMITS.totalBytes)
        throw new Error('参考图片总大小不能超过 12 MB');
      setImages(combined);
    } catch (error) {
      toast.error(error.message);
    } finally {
      imageReadingRef.current = false;
      setReadingImages(false);
    }
  };
  const pasteReferences = (event) => {
    const files = [...(event.clipboardData?.items || [])]
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (files.length) {
      event.preventDefault();
      event.stopPropagation();
      addReferenceImages(files);
    }
  };
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
      const p = await api('/api/projects', {
        sources: parseVideoPaths(source),
        knowledge,
        title,
        branding,
      });
      updateProject(p);
      selectProject(p.id);
      setSource('');
      setTitle('');
      setKnowledge('');
      setBranding(brandingDefaults());
      if (!hasKey) {
        toast.success('素材已保存在本机，配置模型后即可生成脚本。');
        openSettings();
        return;
      }
      setView('activity');
      await startTask('prepare', {}, p);
    });
  const persistScript = async () => {
    const input = jsonDirty ? parseScriptJson(json) : scriptDraft;
    const p = await api(endpoint(project, 'script'), { script: input });
    updateProject(p);
    return p;
  };
  const saveScript = () =>
    perform(async () => {
      const p = await api(endpoint(project, 'script'), { script: scriptDraft });
      updateProject(p);
      toast.success('剧本已保存，需要重新确认当前版本。');
    });
  const saveJson = () =>
    perform(async () => {
      const p = await api(endpoint(project, 'script'), { script: parseScriptJson(json) });
      updateProject(p);
      toast.success('JSON 剧本已保存。');
    });
  const updateScene = (index, field, value) => {
    if (jsonDirty) {
      toast('先保存 JSON 中的修改，再编辑分镜。');
      setView('json');
      return;
    }
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
        await persistScript();
      }
      const result = await startTask('edit', {
        message,
        images: referenceImages.map(({ name, dataUrl }) => ({ name, dataUrl })),
      });
      setImages([]);
      return result;
    });
  const offerEdit = (text) => {
    setDraftOffer({ text, id: Date.now() });
    setMobilePane('chat');
  };
  const cancel = () => perform(() => api(endpoint(project, 'cancel'), {}));
  const startTask = async (action, data = {}, target = project) => {
    setRequestError(null);
    setView('activity');
    setMobilePane('preview');
    if (action === 'render') setApproveOpen(false);
    try {
      const result = await api(
        endpoint(target, action),
        action === 'render' ? { ...data, hash: target.scriptHash } : data,
      );
      if (result.project) updateProject(result.project);
      return result;
    } catch (error) {
      if (error.project) updateProject(error.project);
      setRequestError({
        projectId: target.id,
        stateVersion: (error.project || target).stateVersion || 0,
        title: '任务未能启动',
        message: error.message,
        stage: { render: '提交制作请求', edit: '提交改稿请求', prepare: '提交剧本生成请求' }[
          action
        ],
        at: new Date().toISOString(),
        httpStatus: error.httpStatus,
      });
      setApproveOpen(false);
      requestAnimationFrame(() => document.querySelector('.preview-content')?.scrollTo({ top: 0 }));
      throw error;
    }
  };
  const retryRender = () => perform(() => startTask('render'));
  const prepare = () =>
    perform(async () => {
      if (!hasKey) {
        openSettings();
        return;
      }
      setView('activity');
      await startTask('prepare');
    });
  const confirmRender = () =>
    perform(async () => {
      if (dirty || jsonDirty || busy)
        throw new Error('请先保存当前修改，并等待正在运行的任务结束。');
      try {
        const confirmed = await api(endpoint(project, 'approve'), {
          hash: project.scriptHash,
          revision: project.revision,
          brandingHash: project.brandingHash,
          exportHash: project.exportHash,
        });
        updateProject(confirmed);
        await startTask('render', {}, confirmed);
      } catch (error) {
        setApproveOpen(false);
        setView('activity');
        setRequestError({
          projectId: project.id,
          title: '制作请求未能启动',
          message: error.message,
          stage: '确认并启动制作',
          at: new Date().toISOString(),
          httpStatus: error.httpStatus,
        });
        throw error;
      }
    });
  const resolveIssue = (index) =>
    perform(async () => {
      const p = await api(endpoint(project, 'resolve-issue'), { index, hash: project.scriptHash });
      updateProject(p);
      toast.success('已标记为核对完成，仍需确认当前剧本后再制作。');
    });
  const retryTask = () =>
    perform(async () => {
      const action = project.failedTask?.action || (project.script ? 'render' : 'prepare');
      if (dirty || jsonDirty) {
        await persistScript();
        if (action === 'render') {
          setView('script');
          return;
        }
      }
      await startTask(action, action === 'edit' ? { message: project.failedTask.message } : {});
    });
  const saveSettings = (config) =>
    perform(async () => {
      const value = await api('/api/settings', {
        config,
        confirmModelUpdate: !!settings?.modelPolicy?.requiresConfirmation,
      });
      setSettings(value);
      setSettingsOpen(false);
      toast.success('模型配置已保存。');
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
  const showBranding = () => {
    setBrandingDraft({
      id: project.id,
      revision: project.revision,
      value: brandingDefaults(project.branding),
    });
    setBrandingOpen(true);
  };
  const showExportOptions = (returnToApproval = false) => {
    setExportDraft({
      id: project.id,
      revision: project.revision,
      value: normalizeExportOptions(project.exportOptions),
      returnToApproval,
      restoreApproval: approveOpen,
    });
    setApproveOpen(false);
    setExportOpen(true);
  };
  const saveExportOptions = () =>
    perform(async () => {
      const p = await api(endpoint({ id: exportDraft.id }, 'export-settings'), {
        revision: exportDraft.revision,
        exportOptions: exportDraft.value,
      });
      updateProject(p);
      setExportOpen(false);
      if (exportDraft.returnToApproval && p.output?.revision !== p.revision) setApproveOpen(true);
      toast.success(
        p.revision === exportDraft.revision
          ? '已保留当前画布设置。'
          : '导出画布已应用，审核后制作所选比例的成片。',
      );
    });
  const saveBranding = () =>
    perform(async () => {
      const p = await api(endpoint({ id: brandingDraft.id }, 'branding'), {
        branding: brandingDraft.value,
        revision: brandingDraft.revision,
      });
      updateProject(p);
      setBrandingOpen(false);
      toast.success('广告与水印已保存，审核后重新制作即可生效。');
    });
  const messages = useMemo(() => {
    if (!project) return [];
    const all = (project.chat || []).map((message, i) => ({
      ...message,
      referenceContent: message.attachments?.length ? (
        <ReferenceImages
          images={message.attachments.map((image) => ({
            ...image,
            src: endpoint(project, 'reference/' + image.id),
          }))}
          onPreview={setReferencePreview}
        />
      ) : null,
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
    localStorage.setItem('tutor-project', 'new');
    setOutput(false);
    setSource('');
    setSourceName('');
    setKnowledge('');
    setTitle('');
    setView('script');
    setMobilePane('preview');
  };
  useEffect(() => {
    if (!guideIntent || !settings || settings.modelPolicy?.requiresConfirmation) return;
    consumeIntent();
    setExportOpen(false);
    const focus = (selector) =>
      requestAnimationFrame(() => document.querySelector(selector)?.focus());
    if (guideIntent.feature === 'import') {
      newProject();
      focus('.video-dropzone');
    }
    if (guideIntent.feature === 'knowledge') {
      if (project) showKnowledge();
      else {
        newProject();
        focus('#tutorial-knowledge');
      }
    }
    if (guideIntent.feature === 'branding') {
      if (project) showBranding();
      else {
        newProject();
        requestAnimationFrame(() => {
          const details = document.querySelector('.import-panel .branding-panel details');
          if (details) {
            details.open = true;
            details.querySelector('summary')?.focus();
            details.scrollIntoView({ block: 'nearest' });
          }
        });
      }
    }
    if (guideIntent.feature === 'chat') {
      if (project?.script) {
        setView('script');
        setMobilePane('chat');
        if (guideIntent.message) offerEdit(guideIntent.message);
        focus('textarea[aria-label="修改剧本要求"]');
      } else if (busy) {
        setView('activity');
        setMobilePane('preview');
        toast('剧本生成后即可开始改稿。');
      } else {
        newProject();
        focus('.video-dropzone');
        toast('先导入视频并生成剧本，再开始改稿。');
      }
    }
    if (guideIntent.feature === 'review') {
      setMobilePane('preview');
      if (busy) setView('activity');
      else if (project?.script) {
        setView('script');
        if (
          !dirty &&
          !jsonDirty &&
          !project.review?.issues.some(
            (issue) => issue.severity === 'blocking' && issue.resolved !== true,
          )
        )
          setApproveOpen(true);
        else toast('先保存修改并处理复核提示，再确认当前版本。');
      } else {
        newProject();
        focus('.video-dropzone');
        toast('先导入素材并生成剧本，之后再审核制作。');
      }
    }
    if (guideIntent.feature === 'export') {
      setMobilePane('preview');
      if (project?.output) {
        setView('video');
        setOutput(true);
      } else if (project?.script && !busy) {
        showExportOptions();
      } else {
        setView(project?.script ? 'script' : 'activity');
        toast('完成制作后，即可预览和保存视频。');
      }
    }
    if (guideIntent.feature === 'recovery') {
      if (project) {
        setView('activity');
        setMobilePane('preview');
      } else if (projects.length) selectProject(projects[0].id);
      else {
        newProject();
        focus('.video-dropzone');
      }
    }
  }, [guideIntent?.id, settings?.modelPolicy?.requiresConfirmation, !!settings]);
  const sidebar = (
    <div className="project-sidebar">
      <div className="brand">
        <span className="brand-symbol">
          <img src={new URL('../../build/tutor.svg', import.meta.url).href} alt="" />
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
        <button className="sidebar-guide" onClick={() => openGuide()}>
          <BookOpen size={15} />
          <span>
            功能导览<small>查看功能与具体用法</small>
          </span>
          <span>F1</span>
        </button>
        <YakcoolAccountCard {...{ account, refreshAccount, logout, accountPending }} />
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
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="打开教程与账户菜单">
            <Clapperboard size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="project-menu" align="start">
          <DropdownMenuLabel className="project-menu-account">
            <span title={account.user.name}>YAKCOOL · {account.user.name}</span>
            <strong>
              <Wallet size={13} /> 余额 {balanceText(account.balance)}
            </strong>
            {account.balanceStale && <small>余额刷新失败，可稍后重试</small>}
          </DropdownMenuLabel>
          <DropdownMenuItem
            disabled={accountPending}
            onSelect={(event) => {
              event.preventDefault();
              refreshAccount();
            }}
          >
            <RefreshCw size={14} /> 刷新账户余额
          </DropdownMenuItem>
          <DropdownMenuItem disabled={accountPending} onSelect={logout}>
            <LogOut size={14} /> 退出 YAKCOOL 账户
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openGuide()}>
            <BookOpen size={14} /> 功能导览与使用步骤
          </DropdownMenuItem>
          <DropdownMenuItem onClick={newProject}>
            <Plus size={14} /> 新建教程
          </DropdownMenuItem>
          {projects.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => selectProject(p.id)}>
              <Video size={14} /> <span className="project-menu-title">{p.title}</span>
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
        <Hint label="功能导览与使用步骤 · F1">
          <Button variant="ghost" size="sm" aria-label="功能导览" onClick={() => openGuide()}>
            <BookOpen size={15} />
            <span className="guide-open-label">功能导览</span>
          </Button>
        </Hint>
        <Badge
          variant="outline"
          className={
            failure && !failure.cancelled ? 'failure-badge' : finished ? 'success-badge' : ''
          }
        >
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
        <p>{settings?.config.roles.editor.model || 'deepseek-v4.1-flash'} · 改稿与知识纠正</p>
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
            <span
              title={projectSources(project)
                .map((source) => source.name)
                .join('\n')}
            >
              {projectSources(project).length > 1
                ? projectSources(project).length + ' 个视频素材'
                : projectSources(project)[0].name}
            </span>
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
              : failure
                ? failure.cancelled
                  ? '任务已取消，可重新开始'
                  : '剧本生成失败，请查看右侧错误详情'
                : busy
                  ? '正在把录像整理成可审核的教程剧本'
                  : '素材已准备好，等待生成剧本'}
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
      <input
        ref={videoInputRef}
        type="file"
        hidden
        multiple
        accept={VIDEO_EXTENSIONS.join(',')}
        aria-label="选择视频文件"
        onChange={(event) => {
          acceptVideoFiles([...event.target.files]);
          event.target.value = '';
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        hidden
        multiple
        accept={IMAGE_TYPES.join(',')}
        aria-label="选择参考图片"
        onChange={(event) => {
          addReferenceImages([...event.target.files]);
          event.target.value = '';
        }}
      />
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
              disabled={!project?.script || pending || readingImages}
              onSend={send}
              onCancel={cancel}
              onAttach={() => imageInputRef.current?.click()}
              hasAttachments={referenceImages.length > 0}
              composerAccessory={
                <ReferenceImages
                  images={referenceImages}
                  onRemove={(id) => setImages(referenceImages.filter((image) => image.id !== id))}
                  onPreview={setReferencePreview}
                  disabled={busy || pending || readingImages}
                  hint={!!project?.script}
                />
              }
              onPaste={pasteReferences}
              dragging={imageDragging}
              onDragEnter={(event) => {
                if (event.dataTransfer.types.includes('Files')) {
                  event.preventDefault();
                  event.stopPropagation();
                  imageDragDepth.current++;
                  setImageDragging(true);
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect =
                  busy || pending || !project?.script ? 'none' : 'copy';
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (--imageDragDepth.current <= 0) {
                  imageDragDepth.current = 0;
                  setImageDragging(false);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                imageDragDepth.current = 0;
                setImageDragging(false);
                addReferenceImages([...event.dataTransfer.files]);
              }}
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
                  dropVideos,
                  chooseKnowledge,
                  branding,
                  setBranding,
                  create,
                  pending,
                  hasKey,
                  openSettings,
                  inspection,
                  acceptVideoFiles,
                  sourceName,
                  setSourceName,
                  uploadingVideo,
                }}
                maxDuration={settings?.config.limits.maxDuration}
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
                    {dirty || jsonDirty ? ' · 本机草稿已保留' : project.script ? ' · 已保存' : ''}
                  </span>
                </div>
                <div className="preview-content">
                  <div className="guide-context-help">
                    <BookOpen size={14} />
                    <span>
                      {busy
                        ? '任务进行中，可随时查看功能用法。'
                        : finished
                          ? '先预览成片，再保存视频、字幕和剧本。'
                          : dirty || jsonDirty
                            ? '修改保存在本机，保存后再审核制作。'
                            : project.script
                              ? '逐段核对画面和解说，再确认当前版本。'
                              : '素材已就绪，下一步生成并核对剧本。'}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        openGuide(
                          busy
                            ? 'recovery'
                            : finished
                              ? 'export'
                              : dirty || jsonDirty
                                ? 'chat'
                                : project.script
                                  ? 'review'
                                  : 'import',
                        )
                      }
                    >
                      查看这一步怎么用
                      <ArrowRight size={12} />
                    </button>
                  </div>
                  <div className="branding-project-bar">
                    <span>
                      <Clapperboard size={14} />
                      <span>{brandingSummary(project.branding)}</span>
                    </span>
                    <div className="branding-project-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={showBranding}
                        disabled={busy || pending}
                      >
                        广告与水印 <Settings2 size={13} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || pending}
                        onClick={() => showExportOptions()}
                        aria-label="导出比例与画布"
                      >
                        <Maximize2 size={13} />
                        {project.exportOptions?.aspect && project.exportOptions.aspect !== 'auto'
                          ? project.exportOptions.aspect
                          : '导出比例'}
                      </Button>
                    </div>
                  </div>
                  <FailurePanel
                    project={project}
                    requestError={taskError}
                    retryTask={retryTask}
                    pending={pending}
                    openSettings={openSettings}
                    showActivity={() => {
                      setView('activity');
                      requestAnimationFrame(() =>
                        document
                          .querySelector('.request-failures')
                          ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
                      );
                    }}
                  />
                  <ReviewNotice
                    project={project}
                    pending={pending}
                    dirty={dirty || jsonDirty}
                    resolveIssue={resolveIssue}
                    chooseScene={(id) => {
                      const index = scriptDraft?.scenes.findIndex((scene) => scene.id === id);
                      if (index >= 0) {
                        setSelected(index);
                        setView('script');
                      }
                    }}
                  />
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
                  {view === 'script' && !scriptDraft && !failure && (
                    <div className="waiting-script">
                      <WandSparkles size={30} />
                      <h3>{busy ? '正在把录像整理成教程' : '素材已准备好'}</h3>
                      <p>
                        {busy
                          ? 'Omni 读画面，剧本模型改写，再由 Omni 对照原片复核。完成后剧本会出现在这里。'
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
                      sourceId={sceneSource(project, scriptDraft?.scenes[selected]).id}
                      outputTime={
                        project.output?.plan.scenes.find(
                          (s) => s.id === scriptDraft?.scenes[selected]?.id,
                        )?.offset || 0
                      }
                      onSave={saveVideo}
                      onReveal={reveal}
                      onExportOptions={() => showExportOptions(true)}
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
                          failed={!!failure && !failure.cancelled}
                          cancelled={!!failure?.cancelled}
                          onCancel={cancel}
                        />
                      </div>
                      {project.progress.streamText && (
                        <details className="stream-details">
                          <summary>查看模型的实时输出</summary>
                          <StreamOutput
                            text={project.progress.streamText}
                            stage={project.progress.stage}
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
                          : taskError
                            ? '任务未能启动，请检查上方原因'
                            : failure
                              ? failure.cancelled
                                ? '任务已取消，可重新开始'
                                : '任务失败，请先检查上方错误'
                              : project.review?.issues.some(
                                    (issue) =>
                                      issue.severity === 'blocking' && issue.resolved !== true,
                                  )
                                ? '先核对上方提示，再审核制作'
                                : dirty || jsonDirty
                                  ? '修改已保留在本机，保存后即可审核'
                                  : finished
                                    ? '教程已完成，可以预览与保存'
                                    : project.script
                                      ? '剧本已准备好，下一步由你审核'
                                      : '从剧本开始制作'}
                      </strong>
                      <small>
                        {busy
                          ? Math.round(safePercent(project.progress.percent)) + '%'
                          : taskError
                            ? taskError.stage
                            : failure
                              ? '失败阶段：' + failure.stage
                              : finished
                                ? '字幕、剧本和剪辑时间表均已保存'
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
                  ) : dirty || jsonDirty ? (
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={jsonDirty ? saveJson : saveScript}
                    >
                      <Save size={14} /> 保存修改
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
                      onClick={() =>
                        canRender
                          ? retryRender()
                          : project.script
                            ? setApproveOpen(true)
                            : prepare()
                      }
                      disabled={
                        pending ||
                        dirty ||
                        jsonDirty ||
                        project.review?.issues.some(
                          (i) => i.severity === 'blocking' && i.resolved !== true,
                        )
                      }
                    >
                      <Check size={14} />
                      {canRender
                        ? failure || taskError
                          ? '重试制作'
                          : '开始制作'
                        : project.script
                          ? '审核并制作'
                          : failure || taskError
                            ? '重试生成剧本'
                            : '生成剧本'}
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
          <span title={account.user.name}>YAKCOOL · {account.user.name}</span>
        </footer>
      </Shell>
      <Dialog
        open={settingsOpen}
        onOpenChange={(open) => {
          if (!open && settings?.modelPolicy?.requiresConfirmation) return;
          setSettingsOpen(open);
        }}
      >
        <DialogContent
          className="model-dialog"
          showCloseButton={!settings?.modelPolicy?.requiresConfirmation}
          onEscapeKeyDown={(event) => {
            const picker = event.target
              ?.closest?.('.model-picker')
              ?.querySelector('[role="combobox"]');
            // Radix handles Escape at document capture, before the picker closes its list.
            if (
              settings?.modelPolicy?.requiresConfirmation ||
              picker?.getAttribute('aria-expanded') === 'true'
            )
              event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (settings?.modelPolicy?.requiresConfirmation) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {settings?.modelPolicy?.requiresConfirmation ? '确认新的模型配置' : '模型与制作设置'}
            </DialogTitle>
            <DialogDescription>
              YAKCOOL 已自动连接，可搜索选择剧本改写模型，画面理解与配音保持固定。
            </DialogDescription>
          </DialogHeader>
          {configDraft && (
            <SettingsPanel
              value={configDraft}
              setValue={setConfigDraft}
              models={account.models}
              save={saveSettings}
              pending={pending}
              requiredUpdate={!!settings?.modelPolicy?.requiresConfirmation}
              logout={logout}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={brandingOpen} onOpenChange={setBrandingOpen}>
        <DialogContent className="branding-dialog">
          <DialogHeader>
            <DialogTitle>品牌广告与视频水印</DialogTitle>
            <DialogDescription>
              统一设置片头、片尾与全程水印。预览品牌呈现效果，保存后重新审核制作。
            </DialogDescription>
          </DialogHeader>
          <div className="branding-dialog-body">
            {brandingDraft && (
              <BrandingPanel
                value={brandingDraft.value}
                setValue={(value) => setBrandingDraft((draft) => ({ ...draft, value }))}
                disabled={busy || pending}
                project={project}
              />
            )}
          </div>
          <div className="dialog-footer">
            <Button variant="outline" onClick={() => setBrandingOpen(false)} disabled={pending}>
              取消
            </Button>
            <Button onClick={saveBranding} disabled={busy || pending}>
              <Save size={14} /> {pending ? '正在保存…' : '保存广告与水印'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={exportOpen}
        onOpenChange={(open) => {
          setExportOpen(open);
          if (!open && exportDraft?.restoreApproval) setApproveOpen(true);
        }}
      >
        <DialogContent className="export-dialog">
          <DialogHeader>
            <DialogTitle>导出画布与比例</DialogTitle>
            <DialogDescription>
              选择发布尺寸，预览框架与过场。录屏保持等比，字幕独立排版。
            </DialogDescription>
          </DialogHeader>
          {exportDraft && project && (
            <ExportPanel
              project={project}
              value={exportDraft.value}
              setValue={(value) => setExportDraft((draft) => ({ ...draft, value }))}
              disabled={busy || pending}
            />
          )}
          <div className="dialog-footer">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                setExportOpen(false);
                if (exportDraft?.restoreApproval) setApproveOpen(true);
              }}
            >
              取消
            </Button>
            <Button disabled={busy || pending} onClick={saveExportOptions}>
              <Save size={14} />
              {pending ? '正在应用…' : '应用画布比例'}
            </Button>
          </div>
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
            <div className="approval-branding">
              <span>{brandingSummary(project.branding)}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || pending}
                onClick={() => {
                  setApproveOpen(false);
                  showBranding();
                }}
              >
                调整广告与水印
              </Button>
            </div>
          )}
          {project?.script && (
            <div className="approval-export">
              <span>
                <Maximize2 size={15} />
                {exportSummary(project.exportOptions, project.info, settings?.config.style)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || pending}
                onClick={() => showExportOptions(true)}
              >
                调整导出比例
              </Button>
            </div>
          )}
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
                  branding: brandingSummary(project.branding),
                  canvas: exportSummary(
                    project.exportOptions,
                    project.info,
                    settings?.config.style,
                  ),
                  models: Object.fromEntries(
                    Object.entries(settings?.config.roles || {}).map(([name, role]) => [
                      name,
                      role.model,
                    ]),
                  ),
                  outputs: ['视频', '字幕', '剧本', '剪辑时间表'],
                },
                null,
                2,
              )}
              busy={
                pending ||
                busy ||
                dirty ||
                jsonDirty ||
                project.review?.issues.some((i) => i.severity === 'blocking' && i.resolved !== true)
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
              sourceId={sceneSource(project, scriptDraft?.scenes[selected]).id}
              outputTime={
                project.output?.plan.scenes.find((s) => s.id === scriptDraft?.scenes[selected]?.id)
                  ?.offset || 0
              }
              onSave={saveVideo}
              onReveal={reveal}
              onExportOptions={() => {
                setFullscreenOpen(false);
                showExportOptions(true);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!referencePreview} onOpenChange={(open) => !open && setReferencePreview(null)}>
        <DialogContent className="reference-image-dialog">
          <DialogHeader>
            <DialogTitle>{referencePreview?.name || '参考图片'}</DialogTitle>
            <DialogDescription>改稿时使用的图片参考</DialogDescription>
          </DialogHeader>
          {referencePreview && (
            <img
              src={referencePreview.dataUrl || referencePreview.src}
              alt={referencePreview.name}
            />
          )}
        </DialogContent>
      </Dialog>
      <Toaster theme="dark" position="bottom-center" richColors closeButton offset={48} />
    </div>
  );
}
