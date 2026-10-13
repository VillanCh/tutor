const crypto = require('node:crypto');
function parseJson(text) {
  const clean = String(text)
    .trim()
    .replace(/^\x60{3}(?:json)?\s*/i, '')
    .replace(/\s*\x60{3}$/, '');
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf('{'),
      end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw Error('模型没有返回有效 JSON');
  }
}
function normalizeScript(input, videoDuration) {
  const d = structuredClone(input.script || input);
  if (typeof d.title !== 'string' || !d.title.trim()) throw Error('缺少教程标题');
  if (
    !Array.isArray(d.chapters) ||
    d.chapters.length < 1 ||
    d.chapters.length > 5 ||
    d.chapters.some((x) => typeof x !== 'string')
  )
    throw Error('章节必须为 1 到 5 个标题');
  if (!Array.isArray(d.scenes) || !d.scenes.length || d.scenes.length > 100)
    throw Error('场景数量无效');
  const ids = new Set();
  let chapter = -1;
  const time = (v, label) => {
    if (!Number.isFinite(v) || v < 0 || v > videoDuration) throw Error(label + ' 超出视频范围');
    return v;
  };
  d.scenes = d.scenes.map((s, i) => {
    if (!['title', 'action', 'observe'].includes(s.kind)) throw Error('场景类型无效');
    if (
      !Number.isInteger(s.chapter) ||
      s.chapter < chapter ||
      s.chapter >= d.chapters.length ||
      s.chapter < 0
    )
      throw Error('章节顺序无效');
    chapter = s.chapter;
    const id = s.id || 's' + String(i + 1).padStart(2, '0');
    if (ids.has(id)) throw Error('场景 ID 重复');
    ids.add(id);
    const mode =
      s.kind === 'title'
        ? 'static'
        : s.motion_mode || (s.source_start == null ? 'freeze' : 'normal');
    if (
      !['static', 'normal', 'compress', 'freeze'].includes(mode) ||
      (mode === 'static' && s.kind !== 'title')
    )
      throw Error('画面运动模式无效');
    let start = null,
      end = null,
      freeze = null,
      hold = null;
    if (mode === 'freeze') {
      freeze = time(s.freeze_at, '定格时间');
      if (freeze >= videoDuration)
        throw Error('场景 ' + id + ' 的定格时间必须早于视频结束：' + freeze + ' 秒');
    }
    if (mode === 'normal' || mode === 'compress') {
      start = time(s.source_start, '片段开始');
      end = time(s.source_end, '片段结束');
      if (end <= start || end - start < 0.1) throw Error('片段结束必须晚于开始');
      hold = s.hold_at == null ? Math.max(start, end - 1 / 30) : time(s.hold_at, '讲解定格时间');
      if (hold < start || hold > end) throw Error('讲解定格点必须位于本片段内');
      hold = Math.min(hold, end - 1 / 30);
    }
    const narration = typeof s.narration === 'string' ? s.narration.trim() : '';
    if (narration.length > 500) throw Error('单段旁白过长，请拆分');
    const min =
        Number(s.min_view_seconds) > 0 ? Number(s.min_view_seconds) : s.kind === 'title' ? 2.5 : 2,
      tail = Number(s.silent_tail_seconds ?? 0.7);
    if (
      !Number.isFinite(min) ||
      min < 0.2 ||
      min > 120 ||
      !Number.isFinite(tail) ||
      tail < 0 ||
      tail > 20
    )
      throw Error('停留时间无效');
    return {
      id,
      kind: s.kind,
      chapter: s.chapter,
      heading: String(s.heading || d.chapters[s.chapter]),
      subtitle: String(s.subtitle || ''),
      narration,
      source_start: start,
      source_end: end,
      freeze_at: freeze,
      hold_at: hold,
      motion_mode: mode,
      min_view_seconds: min,
      silent_tail_seconds: tail,
      transition: s.transition === 'fade' ? 'fade' : 'cut',
      evidence: String(s.evidence || ''),
      keep_reason: String(s.keep_reason || ''),
      uncertainty: String(s.uncertainty || ''),
    };
  });
  if (new Set(d.scenes.map((s) => s.chapter)).size !== d.chapters.length)
    throw Error('有章节没有对应场景');
  return {
    title: d.title.trim(),
    chapters: d.chapters,
    scenes: d.scenes,
    limitations: Array.isArray(d.limitations) ? d.limitations : [],
    review: d.review || null,
  };
}
function scriptHash(script) {
  return crypto.createHash('sha256').update(JSON.stringify(script)).digest('hex');
}
function approve(project, expectedHash) {
  if (!project.script || project.job) throw Error('当前无法确认剧本');
  const hash = scriptHash(project.script);
  if (expectedHash !== hash) throw Error('剧本已更新，请重新阅读后确认');
  if (project.review?.issues?.some((i) => i.severity === 'blocking'))
    throw Error(
      '剧本有待解决的阻断问题：\n' +
        project.review.issues
          .filter((i) => i.severity === 'blocking')
          .map((i) => [i.scene, i.message].filter(Boolean).join('：'))
          .join('\n'),
    );
  project.approval = {
    scriptHash: hash,
    revision: project.revision,
    confirmedAt: new Date().toISOString(),
    source: 'human',
    sourceHash: project.sourceHash || null,
    knowledgeHash: crypto
      .createHash('sha256')
      .update(project.knowledge || '')
      .digest('hex'),
  };
  project.status = 'approved';
  return project.approval;
}
function requireApproval(project) {
  if (
    !project.approval ||
    project.approval.scriptHash !== scriptHash(project.script) ||
    project.approval.revision !== project.revision
  )
    throw Error('请先人工确认当前版本的剧本');
  if (
    project.approval.knowledgeHash !==
    crypto
      .createHash('sha256')
      .update(project.knowledge || '')
      .digest('hex')
  )
    throw Error('知识资料已变更，请重新确认');
  if ((project.approval.sourceHash || null) !== (project.sourceHash || null))
    throw Error('视频素材已变更，请重新确认');
}
function revise(project, script) {
  project.script = script;
  project.revision = (project.revision || 0) + 1;
  project.approval = null;
  project.status = 'review';
}
function schedule(script, durations, style) {
  const d = structuredClone(script);
  let cursor = 0;
  for (let i = 0; i < d.scenes.length; i++) {
    const s = d.scenes[i],
      voice = s.narration ? durations[i] : 0;
    if (s.narration && (!Number.isFinite(voice) || voice <= 0))
      throw Error('旁白音频缺失：' + s.id);
    const lead = voice ? (s.kind === 'title' ? style.titleLead : style.lead) : 0;
    const motion =
      s.motion_mode === 'compress'
        ? s.min_view_seconds
        : s.source_end == null
          ? 0
          : s.source_end - s.source_start;
    const body = Math.max(s.min_view_seconds, motion, lead + voice),
      tail = Math.max(s.silent_tail_seconds, voice ? style.gap : 0);
    const duration = Math.ceil((body + tail) * style.fps) / style.fps;
    Object.assign(s, {
      offset: cursor,
      duration,
      voice_duration: voice,
      voice_lead: lead,
      motion_duration: motion,
      hold_extra: s.motion_mode === 'normal' ? Math.max(0, body - motion) : 0,
      hold_before: s.motion_mode === 'normal' ? s.hold_at - s.source_start : 0,
      audio_start: voice ? cursor + lead : null,
      audio_end: voice ? cursor + lead + voice : null,
    });
    cursor += duration;
  }
  const spoken = d.scenes.filter((s) => s.voice_duration);
  for (let i = 1; i < spoken.length; i++)
    if (spoken[i].audio_start - spoken[i - 1].audio_end < style.gap - 0.01)
      throw Error('检测到配音时间冲突');
  d.total_duration = cursor;
  d.chapters_timed = d.chapters.map((title, chapter) => {
    const s = d.scenes.filter((s) => s.chapter === chapter);
    return { title, start: s[0].offset, end: s.at(-1).offset + s.at(-1).duration };
  });
  return d;
}
module.exports = {
  parseJson,
  normalizeScript,
  scriptHash,
  approve,
  requireApproval,
  revise,
  schedule,
};
