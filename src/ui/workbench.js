import { safePercent, advancePercent, progressTask } from '../progress.mjs';

export async function api(url, data) {
  const token = document.querySelector('meta[name="tutor-token"]').content;
  const response = await fetch(
    url,
    data === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Tutor-Token': token },
          body: JSON.stringify(data),
        },
  );
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error || '请求失败'), {
      project: result.project,
      httpStatus: response.status,
    });
  return result;
}
export function mergeProjects(current, incoming) {
  const projects = new Map(current.map((p) => [p.id, p]));
  for (const p of incoming) {
    const previous = projects.get(p.id);
    if (!previous || (p.stateVersion || 0) >= (previous.stateVersion || 0)) {
      const sameTask = progressTask(p) && progressTask(p) === progressTask(previous);
      const percent = sameTask
        ? advancePercent(p.progress?.percent, previous.progress?.percent)
        : safePercent(p.progress?.percent);
      projects.set(p.id, { ...p, progress: { ...p.progress, percent } });
    }
  }
  return [...projects.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
export async function uploadVideo(file) {
  const token = document.querySelector('meta[name="tutor-token"]').content;
  const response = await fetch('/api/uploads/video?name=' + encodeURIComponent(file.name), {
    method: 'POST',
    headers: { 'X-Tutor-Token': token, 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '上传视频失败');
  return result.source;
}
export const clock = (seconds = 0) => {
  const value = Math.max(0, Number(seconds) || 0);
  return (
    String(Math.floor(value / 60)).padStart(2, '0') +
    ':' +
    String(Math.floor(value % 60)).padStart(2, '0')
  );
};
export const basename = (value = '') => value.split(/[\\/]/).at(-1);
export const compact = (n = 0) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n.toLocaleString());
export const money = (n = 0) => '¥' + n.toFixed(4);
export const voiceName = (voice) =>
  ({ 'longanlang_v3.1': '沉稳男声', 'xuyanchu_v3.1': '解说女声' })[voice] || voice || '沉稳男声';
export const phase = (project) =>
  !project
    ? 0
    : project.job?.label === '生成旁白与视频'
      ? 2
      : project.status === 'done' && project.output?.revision === project.revision
        ? 3
        : project.approvalValid
          ? 2
          : project.script
            ? 1
            : 0;
export const status = (project) =>
  project?.job
    ? project.progress.stage
    : project?.error
      ? project.failure?.cancelled || project.progress?.stage === '已取消'
        ? '已取消'
        : '任务失败'
      : !project
        ? '新项目'
        : { draft: '待生成剧本', review: '待审核', approved: '已确认', done: '已完成' }[
            project.status
          ] || project.status;
export const kind = (scene) =>
  ({ title: '章节标题', action: '操作演示', observe: '定格讲解' })[scene?.kind] || '分镜';
export const frameTime = (scene, project) =>
  Math.min(scene?.source_start ?? scene?.freeze_at ?? 0, project.info.duration - 0.04);
export const endpoint = (project, action = '') =>
  '/api/projects/' + project.id + (action ? '/' + action : '');

export function activitySteps(project) {
  if (!project) return [];
  const startedAt = project.job?.startedAt || project.failure?.startedAt;
  const history = (project.history || []).filter((item) => !startedAt || item.at >= startedAt);
  const progress = safePercent(project.progress?.percent);
  const task = project.job?.label || project.failure?.task;
  const rendering = task === '生成旁白与视频';
  const active = !!project.job || !!project.error;
  const cancelled = project.failure?.cancelled || project.progress?.stage === '已取消';
  const state = (done, running) =>
    done
      ? 'done'
      : running
        ? project.error && !project.job
          ? cancelled
            ? 'cancelled'
            : 'failed'
          : 'running'
        : 'queued';
  if (rendering || project.status === 'done') {
    return [
      { label: '确认当前剧本版本', state: 'done' },
      {
        label: '逐段合成旁白',
        state: state(project.status === 'done' || progress >= 32, rendering && progress < 32),
      },
      {
        label: '剪辑画面、停顿与衔接',
        state: state(
          project.status === 'done' || progress >= 86.4,
          rendering && progress >= 32 && progress < 86.4,
        ),
      },
      {
        label: '合成字幕与章节时间轴',
        state: state(
          project.status === 'done' || progress >= 97.28,
          rendering && progress >= 86.4 && progress < 97.28,
        ),
      },
      {
        label: '检查画面时长与配音间隔',
        state: state(project.status === 'done', rendering && progress >= 97.28),
      },
    ];
  }
  if (task === '按要求修改剧本') {
    const recent = history;
    const references = project.chat?.findLast((message) => message.role === 'user')?.attachments
      ?.length;
    return [
      { label: '读取当前剧本与修改要求', state: 'done' },
      ...(references
        ? [{ label: 'Omni 理解修改参考图', state: state(progress >= 20, progress < 20) }]
        : []),
      {
        label: '改稿模型改写与知识纠正',
        state: state(
          recent.some((item) => item.stage === 'max-edit'),
          progress < 72 && (!references || progress >= 20),
        ),
      },
      {
        label: 'Omni 对照录像复核修改',
        state: state(
          recent.some((item) => item.stage === 'audit'),
          progress >= 72,
        ),
      },
      { label: '等待你确认新版本', state: 'queued' },
    ];
  }
  return [
    {
      label: '读取视频与知识资料',
      state: state(progress >= 16 || (!!project.script && !active), active && progress < 16),
    },
    {
      label: 'Omni 理解画面，生成初稿',
      state: state(
        history.some((h) => h.stage === 'initial'),
        active && progress >= 16 && progress < 43,
      ),
    },
    {
      label: '改稿模型修订表达与知识问题',
      state: state(
        history.some((h) => h.stage.startsWith('max')),
        active && progress >= 43 && progress < 72,
      ),
    },
    {
      label: 'Omni 对照录像复核',
      state: state(!!project.script && !active, active && progress >= 72),
    },
    { label: '等待你确认剧本', state: project.approval ? 'done' : 'queued' },
  ];
}
