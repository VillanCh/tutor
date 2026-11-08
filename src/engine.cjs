const fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  { EventEmitter } = require('node:events');
const { Provider } = require('./provider.cjs'),
  media = require('./media.cjs'),
  { normalizeScript, revise, approve, requireApproval, scriptHash } = require('./script.cjs'),
  prompts = require('./prompts.cjs'),
  { render } = require('./render.cjs');
const { projectSources, sourceManifest } = require('./sources.cjs');
const { managedConfig } = require('./managed-config.cjs');
class Engine extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.controllers = new Map();
  }
  publish(p, patch = {}) {
    Object.assign(p.progress, patch);
    this.emit('project', this.store.public(p));
  }
  async record(p, r) {
    p.usage.push(r);
    await this.store.save(p);
    this.publish(p);
  }
  provider(p, config) {
    return new Provider(
      config,
      this.store.account.credentials(),
      (r) => this.record(p, r),
      (patch) => this.publish(p, patch),
    );
  }
  async task(id, label, fn) {
    await this.store.account.requireLogin({ fresh: true });
    this.store.requireModelConfirmation();
    const p = this.store.get(id);
    if (p.job) throw Error('该项目已有任务在运行');
    const controller = new AbortController(),
      config = managedConfig(this.store.config, this.store.account.gateway);
    p.job = { label, startedAt: new Date().toISOString() };
    p.status = 'working';
    p.error = null;
    p.failedTask = null;
    p.progress = { stage: label, percent: 0, streamText: '', streamEstimate: 0 };
    this.controllers.set(id, controller);
    await this.store.save(p);
    this.publish(p);
    try {
      await fn(p, config, controller.signal);
      p.job = null;
      await this.store.save(p);
      this.publish(p);
    } catch (error) {
      p.job = null;
      p.error = this.redact(error.message);
      p.failedTask = {
        action:
          label === '生成旁白与视频' ? 'render' : label === '按要求修改剧本' ? 'edit' : 'prepare',
        message:
          label === '按要求修改剧本'
            ? p.chat.findLast((message) => message.role === 'user')?.text
            : undefined,
        cancelled: controller.signal.aborted,
      };
      p.status = p.script ? 'review' : 'draft';
      p.progress.stage = controller.signal.aborted ? '已取消' : '任务失败';
      await this.store.save(p);
      this.publish(p);
      throw Error(p.error);
    } finally {
      this.controllers.delete(id);
    }
    return p;
  }
  redact(text) {
    return this.store.account.redact(text);
  }
  cancel(id) {
    this.controllers.get(id)?.abort();
  }
  async videoContent(p, signal, source = projectSources(p)[0], index = 0, count = 1) {
    const dir = this.store.dir(p.id),
      file = path.join(dir, 'analysis-' + source.id + '-' + source.hash + '.mp4');
    let bytes;
    try {
      bytes = await fs.readFile(file);
    } catch {
      const temporary = file + '.tmp.mp4';
      try {
        bytes = await media.analysisVideo(source.path, temporary, signal, (r) =>
          this.publish(p, {
            percent: ((index + r * 0.3) / count) * 43,
            stage: '压缩分析视频 ' + source.name,
          }),
        );
        await fs.rename(temporary, file);
      } catch (error) {
        await fs.rm(temporary, { force: true });
        throw error;
      }
    }
    if (bytes.length > this.store.config.limits.maxAnalysisBytes)
      throw Error('分析视频过大，请缩短素材后重试：' + source.name);
    return {
      type: 'video_url',
      video_url: { url: 'data:video/mp4;base64,' + bytes.toString('base64'), fps: 2 },
    };
  }
  async keepVersion(p, stage, value) {
    const file = stage + '-' + Date.now() + '.json';
    await fs.writeFile(path.join(this.store.dir(p.id), file), JSON.stringify(value, null, 2));
    p.history.push({ stage, file, at: new Date().toISOString(), script: value.script || value });
  }
  async audit(p, provider, script, signal) {
    const sources = projectSources(p);
    const issues = [],
      summaries = [];
    let corrected = script;
    for (const [index, source] of sources.entries()) {
      const scenes = corrected.scenes.filter((s) => s.source_id === source.id);
      if (sources.length > 1 && !scenes.length) continue;
      const video = await this.videoContent(p, signal, source);
      this.publish(p, {
        percent: 72 + (index / sources.length) * 26,
        stage: 'Omni 校对 ' + source.name,
        streamText: '',
        streamEstimate: 0,
      });
      const partial = sources.length > 1 ? { ...corrected, scenes } : corrected;
      const result = await provider.json(
        'vision',
        '剧本视觉校对 · ' + source.id,
        [
          { role: 'system', content: prompts.RULES || '只根据可验证的画面和知识修订剧本。' },
          {
            role: 'user',
            content: [
              video,
              {
                type: 'text',
                text: prompts.reviewPrompt(
                  partial,
                  sourceManifest(p),
                  p.knowledge,
                  source.id,
                  sources.length > 1,
                ),
              },
            ],
          },
        ],
        signal,
      );
      if (sources.length === 1) corrected = normalizeScript(result.value, sources);
      else {
        const reviewed = (result.value.script || result.value).scenes;
        const expected = new Set(scenes.map((s) => s.id));
        if (
          !Array.isArray(reviewed) ||
          reviewed.length !== expected.size ||
          new Set(reviewed.map((s) => s.id)).size !== expected.size ||
          reviewed.some((s) => !expected.has(s.id) || s.source_id !== source.id)
        )
          throw Error('视频校对必须保留当前素材的分镜 ID 和 source_id');
        const replacements = new Map(reviewed.map((s) => [s.id, s]));
        corrected = normalizeScript(
          { ...corrected, scenes: corrected.scenes.map((s) => replacements.get(s.id) || s) },
          sources,
        );
      }
      issues.push(
        ...(Array.isArray(result.value.issues)
          ? result.value.issues.map((issue) => ({
              scene: String(issue?.scene || ''),
              severity: issue?.severity === 'blocking' ? 'blocking' : 'warning',
              message: String(issue?.message || ''),
              source_id: source.id,
            }))
          : []),
      );
      summaries.push(source.name + '：' + String(result.value.summary || '完成视觉校对'));
    }
    p.review = {
      issues,
      summary: summaries.join('\n'),
      at: new Date().toISOString(),
    };
    await this.keepVersion(p, 'audit', { script: corrected, ...p.review });
    return corrected;
  }
  async prepare(id) {
    return this.task(id, '生成并校对剧本', async (p, config, signal) => {
      p.approval = null;
      const provider = this.provider(p, config),
        sources = projectSources(p),
        drafts = [];
      for (const [index, source] of sources.entries()) {
        const video = await this.videoContent(p, signal, source, index, sources.length);
        this.publish(p, {
          percent: ((index + 0.3) / sources.length) * 43,
          stage: 'Omni 分析素材 ' + (index + 1) + ' / ' + sources.length + ' · ' + source.name,
          streamText: '',
          streamEstimate: 0,
        });
        const draft = await provider.json(
          'vision',
          '视频分析与初稿 · ' + source.id,
          [
            {
              role: 'user',
              content: [
                video,
                {
                  type: 'text',
                  text: prompts.draftPrompt(
                    sourceManifest(p).filter((s) => s.source_id === source.id),
                    p.knowledge,
                  ),
                },
              ],
            },
          ],
          signal,
        );
        drafts.push({ source_id: source.id, script: normalizeScript(draft.value, [source]) });
      }
      const initial = sources.length === 1 ? drafts[0].script : { drafts };
      await this.keepVersion(p, 'initial', initial);
      this.publish(p, {
        percent: 43,
        stage: sources.length > 1 ? '剧本模型联合编排多视频剪辑脚本' : '剧本模型修订表达与知识问题',
        streamText: '',
        streamEstimate: 0,
      });
      const edited = await provider.json(
        'editor',
        '剧本模型修订',
        [
          {
            role: 'user',
            content: prompts.editPrompt(
              initial,
              p.knowledge,
              '综合所有素材初稿，纠正知识和表达，组织为一份连贯的教程剪辑脚本。可跨素材选择、重排片段并删除重复步骤，保留各片段的 source_id 和片内时间，不要求用完每段素材。',
              sourceManifest(p),
            ),
          },
        ],
        signal,
      );
      const revised = normalizeScript(edited.value, sources);
      await this.keepVersion(p, 'max', revised);
      const final = await this.audit(p, provider, revised, signal);
      revise(p, final);
      p.title = final.title;
      p.chat.push({
        role: 'assistant',
        text: '初稿、剧本模型修订和 Omni 视频校对已完成。请检查右侧剧本，确认后再生成视频。',
        at: new Date().toISOString(),
      });
      await fs.writeFile(
        path.join(this.store.dir(p.id), 'script.json'),
        JSON.stringify(final, null, 2),
      );
      this.publish(p, { percent: 100, stage: '等待人工确认', streamText: '', streamEstimate: 0 });
    });
  }
  async edit(id, request) {
    const p = this.store.get(id);
    if (!p.script) throw Error('请先生成剧本');
    return this.task(id, '按要求修改剧本', async (p, config, signal) => {
      p.approval = null;
      p.chat.push({ role: 'user', text: request, at: new Date().toISOString() });
      const provider = this.provider(p, config);
      this.publish(p, {
        percent: 20,
        stage: '剧本模型按你的要求改写',
        streamText: '',
        streamEstimate: 0,
      });
      const edited = await provider.json(
        'editor',
        '对话修改剧本',
        [
          {
            role: 'user',
            content: prompts.editPrompt(p.script, p.knowledge, request, sourceManifest(p)),
          },
        ],
        signal,
      );
      const revised = normalizeScript(edited.value, projectSources(p));
      await this.keepVersion(p, 'max-edit', revised);
      const final = await this.audit(p, provider, revised, signal);
      revise(p, final);
      p.title = final.title;
      p.chat.push({
        role: 'assistant',
        text: '已按要求更新，Omni 已对照视频复核。现在是第 ' + p.revision + ' 版，需要重新确认。',
        at: new Date().toISOString(),
      });
      await fs.writeFile(
        path.join(this.store.dir(p.id), 'script.json'),
        JSON.stringify(final, null, 2),
      );
      this.publish(p, { percent: 100, stage: '等待人工确认', streamText: '', streamEstimate: 0 });
    });
  }
  async saveScript(id, input) {
    const p = this.store.get(id);
    if (p.job) throw Error('请等待当前任务结束');
    const script = normalizeScript(input, projectSources(p));
    await this.keepVersion(p, 'manual', script);
    revise(p, script);
    p.title = script.title;
    p.review = {
      issues: [],
      summary: '人工直接编辑，内容需人工确认。',
      at: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(this.store.dir(p.id), 'script.json'),
      JSON.stringify(script, null, 2),
    );
    await this.store.save(p);
    this.publish(p, { stage: '人工编辑已保存，请重新确认' });
    return p;
  }
  async saveBranding(id, value, revision) {
    const p = this.store.get(id);
    if (p.job) throw Error('请等待当前任务结束后修改广告与水印');
    const before = p.revision;
    if (revision != null && revision !== before)
      throw Error('项目已更新，请重新打开广告与水印设置');
    const branding = await require('./branding.cjs').importBranding(value, this.store.dir(id));
    if (p.job || p.revision !== before) throw Error('项目已更新，请重新打开广告与水印设置');
    p.branding = branding;
    p.revision += 1;
    p.approval = null;
    p.status = p.script ? 'review' : 'draft';
    await this.store.save(p);
    this.publish(p, { stage: '广告与水印已保存，请重新审核制作' });
    return p;
  }
  async confirm(id, hash, revision, expectedBrandingHash) {
    const p = this.store.get(id);
    if (revision != null && revision !== p.revision) throw Error('项目已更新，请重新审核当前版本');
    const { brandingHash } = require('./branding.cjs');
    const currentBrandingHash = brandingHash(p.branding);
    if (
      expectedBrandingHash !== currentBrandingHash &&
      (expectedBrandingHash != null || currentBrandingHash !== brandingHash())
    )
      throw Error('广告或水印已更新，请重新打开审核窗口核对');
    approve(p, hash);
    await this.store.save(p);
    this.publish(p, { stage: '脚本已人工确认' });
    return p;
  }
  async resolveIssue(id, index, expectedHash) {
    const p = this.store.get(id);
    if (p.job) throw Error('请等待当前任务结束');
    if (!p.script || scriptHash(p.script) !== expectedHash)
      throw Error('剧本已更新，请重新核对当前版本');
    if (!Number.isInteger(index) || !p.review?.issues?.[index]) throw Error('复核问题不存在');
    Object.assign(p.review.issues[index], {
      resolved: true,
      resolvedAt: new Date().toISOString(),
      resolvedBy: 'human',
    });
    p.approval = null;
    p.status = 'review';
    await this.store.save(p);
    this.publish(p, { stage: '问题已由你核对，确认剧本后即可制作' });
    return p;
  }
  async generate(id) {
    requireApproval(this.store.get(id));
    return this.task(id, '生成旁白与视频', async (p, config, signal) => {
      requireApproval(p);
      const sources = projectSources(p);
      normalizeScript(p.script, sources);
      for (const source of sources)
        if (source.hash && (await require('./store.cjs').hashFile(source.path)) !== source.hash)
          throw Error('原始素材已变更，请重新导入和确认：' + source.name);
      await require('./branding.cjs').verifyBranding(p.branding);
      const dir = path.join(this.store.dir(id), 'output-r' + p.revision);
      await fs.mkdir(dir, { recursive: true });
      const voices = path.join(this.store.dir(id), 'voices');
      await fs.mkdir(voices, { recursive: true });
      const provider = this.provider(p, config),
        audio = [];
      const count = p.script.scenes.filter((s) => s.narration).length;
      let done = 0;
      for (let i = 0; i < p.script.scenes.length; i++) {
        const s = p.script.scenes[i];
        if (!s.narration) {
          audio.push(null);
          continue;
        }
        const key = crypto
            .createHash('sha256')
            .update(
              JSON.stringify({
                text: s.narration,
                role: require('./model-sources.mjs').speechCacheRole(config.roles.speech),
                speech: config.speech,
              }),
            )
            .digest('hex'),
          file = path.join(voices, key + '.wav');
        this.publish(p, {
          percent: (done / count) * 32,
          stage:
            ({ 'longanlang_v3.1': '沉稳男声', 'xuyanchu_v3.1': '解说女声' }[config.speech.voice] ||
              config.speech.voice) +
            '配音 ' +
            (done + 1) +
            ' / ' +
            count,
          streamText: '',
          streamEstimate: 0,
        });
        let a;
        try {
          const data = await media.pcm(file, signal);
          a = { file, duration: data.length / 96000, pcm: data };
        } catch {
          const bytes = await provider.speech(s.narration, '旁白 ' + s.id, signal);
          a = await media.normalizedAudio(bytes, voices, key, signal);
        }
        audio.push(a);
        done++;
      }
      await fs.writeFile(path.join(dir, 'script.json'), JSON.stringify(p.script, null, 2));
      await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
      await fs.writeFile(path.join(dir, 'approval.json'), JSON.stringify(p.approval, null, 2));
      const result = await render({
        source: p.source,
        sources,
        info: p.info,
        script: p.script,
        audio,
        branding: p.branding,
        config,
        dir,
        signal,
        progress: (r, stage) => this.publish(p, { percent: 32 + r * 68, stage }),
      });
      p.output = {
        dir,
        path: result.output,
        revision: p.revision,
        verification: result.verification,
        plan: result.plan,
        completedAt: new Date().toISOString(),
      };
      p.status = 'done';
      this.publish(p, { percent: 100, stage: '视频和文件已保存' });
    });
  }
}
module.exports = { Engine };
