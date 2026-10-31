const fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { DEFAULTS, validateConfig } = require('./config.cjs');
const { projectSources } = require('./sources.cjs');
async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of require('node:fs').createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
class Store {
  constructor(root, credentialIO = null) {
    this.root = path.resolve(root);
    this.credentialIO = credentialIO;
    this.credentials = { default: process.env.QWEN_API_KEY || '' };
    this.config = validateConfig(DEFAULTS);
    this.projects = new Map();
    this.draftWrites = new Map();
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    try {
      this.config = validateConfig(
        JSON.parse(await fs.readFile(path.join(this.root, 'settings.json'), 'utf8')),
      );
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (this.credentialIO) Object.assign(this.credentials, await this.credentialIO.load());
    for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const p = JSON.parse(
          await fs.readFile(path.join(this.root, entry.name, 'project.json'), 'utf8'),
        );
        p.job = null;
        if (p.status === 'working') p.status = p.script ? 'review' : 'draft';
        if (!p.sources && !p.sourceHash) {
          try {
            const imported = path.join(
              this.dir(p.id),
              'source' + path.extname(p.source).toLowerCase(),
            );
            p.originalSource = p.originalSource || p.source;
            if (path.resolve(imported) !== path.resolve(p.source))
              await fs.copyFile(p.source, imported);
            p.source = imported;
            p.sourceHash = await hashFile(imported);
            await this.save(p);
          } catch {
            p.warning = '原始素材暂时不可读取，已有导出文件仍可使用。';
          }
        }
        if (!p.sources) {
          p.sources = projectSources(p);
          await this.save(p);
        }
        this.projects.set(p.id, p);
      } catch {}
    }
  }
  dir(id) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw Error('项目 ID 无效');
    return path.join(this.root, id);
  }
  async save(p) {
    const dir = this.dir(p.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'project.json.tmp'), JSON.stringify(p, null, 2));
    await fs.rename(path.join(dir, 'project.json.tmp'), path.join(dir, 'project.json'));
  }
  async create(source, knowledge, title) {
    const inspection = await this.inspectSources(source);
    if (inspection.files.some((file) => file.error))
      throw Error(inspection.files.find((file) => file.error).error);
    if (inspection.overLimit)
      throw Error('视频素材总时长不能超过 ' + this.config.limits.maxDuration + ' 秒');
    const files = inspection.files.map((file) => ({ file: file.path, info: file.info }));
    const duration = inspection.totalDuration;
    knowledge = String(knowledge || '');
    if (knowledge.length > this.config.limits.maxKnowledgeChars) throw Error('知识内容过长');
    const id = crypto.randomUUID();
    const dir = this.dir(id);
    await fs.mkdir(dir, { recursive: true });
    try {
      const sources = [];
      for (const [index, { file, info }] of files.entries()) {
        const sourceId = 'v' + String(index + 1).padStart(2, '0');
        const imported = path.join(dir, 'source-' + sourceId + path.extname(file).toLowerCase());
        await fs.copyFile(file, imported);
        sources.push({
          id: sourceId,
          name: path.basename(file),
          path: imported,
          originalPath: file,
          hash: await hashFile(imported),
          info,
        });
      }
      const first = sources[0];
      const p = {
        id,
        title:
          title ||
          (sources.length === 1 ? first.name : first.name + ' 等 ' + sources.length + ' 段素材'),
        sources,
        source: first.path,
        originalSource: first.originalPath,
        sourceHash: first.hash,
        info: { ...first.info, duration, bytes: sources.reduce((sum, s) => sum + s.info.bytes, 0) },
        knowledge,
        createdAt: new Date().toISOString(),
        status: 'draft',
        revision: 0,
        script: null,
        approval: null,
        review: null,
        history: [],
        usage: [],
        chat: [],
        progress: { stage: '待生成剧本', percent: 0 },
        job: null,
      };
      await this.save(p);
      this.projects.set(p.id, p);
      return p;
    } catch (error) {
      // Only remove the new UUID directory owned by this import.
      if (path.dirname(path.resolve(dir)) === this.root)
        await fs.rm(dir, { recursive: true, force: true });
      throw error;
    }
  }
  async inspectSources(source, signal) {
    const { probe } = require('./media.cjs');
    const inputs = Array.isArray(source) ? source : [source];
    if (!inputs.length || inputs.some((file) => typeof file !== 'string' || !file.trim()))
      throw Error('请至少选择一个视频文件');
    const files = [],
      seen = new Set();
    for (const input of inputs) {
      const file = path.resolve(input);
      const key = process.platform === 'win32' ? file.toLowerCase() : file;
      if (seen.has(key)) continue;
      seen.add(key);
      const item = { input, path: file, name: path.basename(file) };
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile()) throw Error('请选择视频文件：' + item.name);
        const info = await probe(file, signal);
        if (!info.width || !info.height || !Number.isFinite(info.duration) || info.duration <= 0)
          throw Error('无法读取视频：' + item.name);
        item.info = info;
      } catch (error) {
        if (signal?.aborted) throw error;
        item.error =
          error.code === 'ENOENT'
            ? '找不到视频文件，请重新选择：' + item.name
            : error.message.startsWith('请选择视频文件')
              ? error.message
              : '无法读取视频，文件可能已损坏或格式不支持：' + item.name;
      }
      files.push(item);
    }
    const totalDuration = files.reduce((sum, item) => sum + (item.info?.duration || 0), 0);
    return {
      files,
      totalDuration,
      maxDuration: this.config.limits.maxDuration,
      overLimit: totalDuration > this.config.limits.maxDuration,
    };
  }
  get(id) {
    const p = this.projects.get(id);
    if (!p) throw Error('项目不存在');
    return p;
  }
  draftFile(key) {
    if (key === 'import') return path.join(this.root, 'import-draft.json');
    this.get(key);
    return path.join(this.dir(key), 'local-draft.json');
  }
  async readDraft(key) {
    try {
      return JSON.parse(await fs.readFile(this.draftFile(key), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }
  async saveDraft(key, value) {
    const file = this.draftFile(key);
    if (value !== null && (!value || typeof value !== 'object' || Array.isArray(value)))
      throw Error('草稿格式无效');
    const pending = (this.draftWrites.get(file) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await fs.writeFile(file + '.tmp', JSON.stringify(value));
        await fs.rename(file + '.tmp', file);
      });
    this.draftWrites.set(file, pending);
    try {
      await pending;
    } finally {
      if (this.draftWrites.get(file) === pending) this.draftWrites.delete(file);
    }
  }
  public(p) {
    return {
      ...p,
      scriptHash: p.script ? require('./script.cjs').scriptHash(p.script) : null,
      totals: totals(p.usage),
    };
  }
  async settings(config, keys) {
    this.config = validateConfig(config);
    for (const [name, value] of Object.entries(keys || {}))
      if (value) this.credentials[name] = value;
    if (this.credentialIO) await this.credentialIO.save(this.credentials);
    await fs.writeFile(path.join(this.root, 'settings.json'), JSON.stringify(this.config, null, 2));
    return this.publicConfig();
  }
  publicConfig() {
    return {
      config: this.config,
      credentialStatus: Object.fromEntries(
        Object.entries(this.credentials).map(([k, v]) => [k, Boolean(v)]),
      ),
      persistentCredentials: Boolean(this.credentialIO),
    };
  }
}
function totals(usage) {
  return usage.reduce(
    (a, u) => ({
      input: a.input + (u.input_tokens || 0),
      output: a.output + (u.output_tokens || 0),
      sent: a.sent + (u.sent_bytes || 0),
      received: a.received + (u.received_bytes || 0),
      cost: a.cost + (u.estimated_cny || 0),
      unpriced: a.unpriced + (u.estimated_cny === null ? 1 : 0),
      calls: a.calls + (u.type === 'download' ? 0 : 1),
    }),
    { input: 0, output: 0, sent: 0, received: 0, cost: 0, unpriced: 0, calls: 0 },
  );
}
module.exports = { Store, totals, hashFile };
