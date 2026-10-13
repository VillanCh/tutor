const fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { DEFAULTS, validateConfig } = require('./config.cjs');
async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of require('node:fs').createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
class Store {
  constructor(root, credentialIO = null) {
    this.root = root;
    this.credentialIO = credentialIO;
    this.credentials = { default: process.env.QWEN_API_KEY || '' };
    this.config = validateConfig(DEFAULTS);
    this.projects = new Map();
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
        if (!p.sourceHash) {
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
    const { probe } = require('./media.cjs'),
      stat = await fs.stat(source);
    if (!stat.isFile()) throw Error('请选择视频文件');
    const info = await probe(source);
    if (!info.width || !info.height || !Number.isFinite(info.duration) || info.duration <= 0)
      throw Error('无法读取视频');
    if (info.duration > this.config.limits.maxDuration)
      throw Error('第一版支持最长 ' + this.config.limits.maxDuration + ' 秒的视频');
    knowledge = String(knowledge || '');
    if (knowledge.length > this.config.limits.maxKnowledgeChars) throw Error('知识内容过长');
    const id = crypto.randomUUID();
    const dir = this.dir(id);
    await fs.mkdir(dir, { recursive: true });
    const imported = path.join(dir, 'source' + path.extname(source).toLowerCase());
    await fs.copyFile(source, imported);
    const p = {
      id,
      title: title || path.basename(source),
      source: imported,
      originalSource: path.resolve(source),
      sourceHash: await hashFile(imported),
      info,
      knowledge: String(knowledge || ''),
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
    this.projects.set(p.id, p);
    await this.save(p);
    return p;
  }
  get(id) {
    const p = this.projects.get(id);
    if (!p) throw Error('项目不存在');
    return p;
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
