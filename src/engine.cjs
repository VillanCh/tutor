const fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  { EventEmitter } = require('node:events');
const { Provider } = require('./provider.cjs'),
  media = require('./media.cjs'),
  { normalizeScript, revise, approve, requireApproval, scriptHash } = require('./script.cjs'),
  prompts = require('./prompts.cjs'),
  { render } = require('./render.cjs');
const { parseReferences, saveReferences } = require('./references.cjs');
const { advancePercent } = require('./progress.mjs');
class Engine extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.controllers = new Map();
  }
  publish(p, patch = {}) {
    const percent = advancePercent(patch.percent, p.progress?.percent);
    p.progress = { ...p.progress, ...patch, percent };
    p.stateVersion = (p.stateVersion || 0) + 1;
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
      this.store.credentials,
      (r) => this.record(p, r),
      (patch) => this.publish(p, patch),
    );
  }
  async task(id, label, fn) {
    const p = this.store.get(id);
    if (p.job) throw Error('该项目已有任务在运行');
    const controller = new AbortController(),
      config = structuredClone(this.store.config),
      startedAt = new Date().toISOString();
    const taskId = crypto.randomUUID();
    p.job = { id: taskId, label, startedAt };
    p.status = 'working';
    p.error = null;
    p.failure = null;
    p.progress = { taskId, stage: label, percent: 0, streamText: '', streamEstimate: 0 };
    if (label === '生成并校对剧本' || label === '按要求修改剧本') p.approval = null;
    this.controllers.set(id, controller);
    this.publish(p);
    try {
      await this.store.save(p);
      await fn(p, config, controller.signal);
      p.job = null;
      this.publish(p);
      await this.store.save(p);
    } catch (error) {
      p.failure = {
        task: label,
        stage: p.progress.stage,
        startedAt,
        at: new Date().toISOString(),
        cancelled: controller.signal.aborted,
        details: error.details ? JSON.parse(this.redact(JSON.stringify(error.details))) : null,
      };
      p.job = null;
      p.error = this.redact(error.message);
      p.status = p.script ? 'review' : 'draft';
      if (label === '生成旁白与视频') {
        try {
          requireApproval(p);
          p.status = 'approved';
        } catch {}
      }
      p.progress.stage = controller.signal.aborted ? '已取消' : '任务失败';
      this.publish(p);
      await this.store.save(p);
      throw Error(p.error);
    } finally {
      this.controllers.delete(id);
    }
    return p;
  }
  redact(text) {
    for (const value of Object.values(this.store.credentials))
      if (value) text = String(text).replaceAll(value, '[REDACTED]');
    return text;
  }
  cancel(id) {
    this.controllers.get(id)?.abort();
  }
  async videoContent(p, signal) {
    const dir = this.store.dir(p.id),
      file = path.join(dir, 'analysis.mp4');
    let bytes;
    try {
      bytes = await fs.readFile(file);
    } catch {
      bytes = await media.analysisVideo(p.source, file, signal, (r) =>
        this.publish(p, { percent: r * 12, stage: '压缩分析视频' }),
      );
    }
    if (bytes.length > this.store.config.limits.maxAnalysisBytes)
      throw Error('分析视频过大，请缩短素材后重试');
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
  async audit(p, provider, script, video, signal, images = []) {
    this.publish(p, { percent: 72, stage: 'Omni 对照视频校对', streamText: '', streamEstimate: 0 });
    const result = await provider.json(
      'vision',
      '剧本视觉校对',
      [
        { role: 'system', content: prompts.RULES || '只根据可验证的画面和知识修订剧本。' },
        {
          role: 'user',
          content: [
            video,
            { type: 'text', text: prompts.reviewPrompt(script, p.info, p.knowledge) },
            ...images.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
            ...(images.length
              ? [
                  {
                    type: 'text',
                    text: '附图是用户的修改参考。原片操作与时间范围仍以录像为准，不要根据附图虚构原片中没有发生的操作。',
                  },
                ]
              : []),
          ],
        },
      ],
      signal,
    );
    const corrected = normalizeScript(result.value, p.info.duration);
    p.review = {
      issues: Array.isArray(result.value.issues) ? result.value.issues : [],
      corrections: Array.isArray(result.value.corrections) ? result.value.corrections : [],
      summary: String(result.value.summary || '完成视觉校对'),
      at: new Date().toISOString(),
    };
    await this.keepVersion(p, 'audit', result.value);
    return corrected;
  }
  async prepare(id) {
    return this.task(id, '生成并校对剧本', async (p, config, signal) => {
      p.approval = null;
      const provider = this.provider(p, config),
        video = await this.videoContent(p, signal);
      this.publish(p, {
        percent: 16,
        stage: 'Omni 生成初版 JSON',
        streamText: '',
        streamEstimate: 0,
      });
      const draft = await provider.json(
        'vision',
        '视频分析与初稿',
        [
          {
            role: 'user',
            content: [video, { type: 'text', text: prompts.draftPrompt(p.info, p.knowledge) }],
          },
        ],
        signal,
      );
      const initial = draft.value.script || draft.value;
      await this.keepVersion(p, 'initial', initial);
      this.publish(p, {
        percent: 43,
        stage: '改稿模型修订表达与知识问题',
        streamText: '',
        streamEstimate: 0,
      });
      const edited = await provider.json(
        'editor',
        '剧本修订',
        [
          {
            role: 'user',
            content: prompts.editPrompt(
              initial,
              p.knowledge,
              '纠正初稿错误、知识问题和不严谨的描述，保持实际操作范围。',
              p.info,
            ),
          },
        ],
        signal,
      );
      const revised = normalizeScript(edited.value, p.info.duration);
      await this.keepVersion(p, 'max', revised);
      const final = await this.audit(p, provider, revised, video, signal);
      revise(p, final);
      p.title = final.title;
      p.chat.push({
        role: 'assistant',
        text: '初稿、改稿模型修订和 Omni 视频校对已完成。请检查右侧剧本，确认后再生成视频。',
        at: new Date().toISOString(),
      });
      await fs.writeFile(
        path.join(this.store.dir(p.id), 'script.json'),
        JSON.stringify(final, null, 2),
      );
      this.publish(p, { percent: 100, stage: '等待人工确认', streamText: '', streamEstimate: 0 });
    });
  }
  async edit(id, request, input = []) {
    const p = this.store.get(id);
    if (!p.script) throw Error('请先生成剧本');
    const images = parseReferences(input);
    request = String(request || '').trim();
    if (!request && !images.length) throw Error('请输入修改要求或添加参考图片');
    request ||= '请参考附图检查并修改当前剧本，保持实际操作与时间范围准确。';
    return this.task(id, '按要求修改剧本', async (p, config, signal) => {
      p.approval = null;
      const attachments = await saveReferences(this.store.dir(p.id), images);
      p.chat.push({ role: 'user', text: request, attachments, at: new Date().toISOString() });
      const provider = this.provider(p, config),
        video = await this.videoContent(p, signal);
      let instruction = request;
      if (images.length) {
        this.publish(p, {
          percent: 12,
          stage: 'Omni 理解修改参考图',
          streamText: '',
          streamEstimate: 0,
        });
        const reference = await provider.json(
          'vision',
          '参考图片理解',
          [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    '用户修改要求：' +
                    request +
                    '\n请理解附图中的修改参考，以 JSON 返回 summary（图片内容摘要）和 changes（与修改要求相关的建议数组）。不要虚构视频中没有发生的操作。',
                },
                ...images.map((image) => ({
                  type: 'image_url',
                  image_url: { url: image.dataUrl },
                })),
              ],
            },
          ],
          signal,
        );
        instruction += '\nOmni 对参考图片的理解：\n' + JSON.stringify(reference.value);
      }
      this.publish(p, {
        percent: 20,
        stage: '改稿模型按你的要求改写',
        streamText: '',
        streamEstimate: 0,
      });
      const edited = await provider.json(
        'editor',
        '对话修改剧本',
        [{ role: 'user', content: prompts.editPrompt(p.script, p.knowledge, instruction, p.info) }],
        signal,
      );
      const revised = normalizeScript(edited.value, p.info.duration);
      await this.keepVersion(p, 'max-edit', revised);
      const final = await this.audit(p, provider, revised, video, signal, images);
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
    const script = normalizeScript(input, p.info.duration);
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
  async confirm(id, hash) {
    const p = this.store.get(id);
    approve(p, hash);
    await this.store.save(p);
    this.publish(p, { stage: '脚本已人工确认' });
    return p;
  }
  async generate(id) {
    requireApproval(this.store.get(id));
    return this.task(id, '生成旁白与视频', async (p, config, signal) => {
      requireApproval(p);
      if (p.sourceHash && (await require('./store.cjs').hashFile(p.source)) !== p.sourceHash) {
        p.approval = null;
        throw Error('原始素材已变更，请重新导入和确认');
      }
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
        info: p.info,
        script: p.script,
        audio,
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
      const { totals } = require('./store.cjs');
      await fs.writeFile(
        path.join(dir, 'cost.json'),
        JSON.stringify(
          {
            records: p.usage,
            totals: totals(p.usage),
            pricingSource: config.pricingSource,
            basis:
              '公开参考单价乘接口实际用量，未抵扣免费额度；未返回用量的调用标记为未知。流量为 API 请求与响应载荷字节。',
          },
          null,
          2,
        ),
      );
      this.publish(p, { percent: 100, stage: '视频和文件已保存' });
    });
  }
}
module.exports = { Engine };
