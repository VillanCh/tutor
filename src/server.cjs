const http = require('node:http'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { createReadStream } = require('node:fs'),
  { Store } = require('./store.cjs'),
  { Engine } = require('./engine.cjs');
const { parseReferences } = require('./references.cjs');
const { VIDEO_EXTENSIONS, VIDEO_UPLOAD_BYTES } = require('./file-policy.mjs');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
  '.json': 'application/json; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
};
async function readJson(req, maxBytes = 2 * 1024 * 1024) {
  let data = '',
    size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Error('请求内容过大');
    data += chunk;
  }
  return JSON.parse(data || '{}');
}
async function streamFile(req, res, file) {
  const stat = await fs.stat(file);
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  if (req.headers.range) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    if (!m) {
      res.writeHead(416);
      res.end();
      return;
    }
    const start = Number(m[1]),
      end = Math.min(stat.size - 1, m[2] ? Number(m[2]) : stat.size - 1);
    if (start > end) {
      res.writeHead(416);
      res.end();
      return;
    }
    res.writeHead(206, {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
      'Content-Length': end - start + 1,
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
  });
  createReadStream(file).pipe(res);
}
async function startServer({ dataDir, credentialIO, port = 0 } = {}) {
  const store = new Store(dataDir, credentialIO);
  await store.init();
  const engine = new Engine(store),
    token = crypto.randomBytes(24).toString('hex'),
    listeners = new Set();
  engine.on('project', (p) => {
    for (const res of listeners) res.write('data: ' + JSON.stringify(p) + '\n\n');
  });
  const server = http.createServer(async (req, res) => {
    let affectedProject;
    try {
      const host = '127.0.0.1:' + server.address().port;
      if (req.headers.host !== host) throw Error('请求来源无效');
      const url = new URL(req.url, 'http://' + host),
        parts = url.pathname.split('/').filter(Boolean);
      if (req.method === 'POST') {
        if (req.headers['x-tutor-token'] !== token) throw Error('会话已失效，请刷新');
        if (req.headers.origin && req.headers.origin !== 'http://' + host)
          throw Error('请求来源无效');
      }
      const json = (data) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
      };
      if (url.pathname === '/api/uploads/video' && req.method === 'POST') {
        const ext = path.extname(url.searchParams.get('name') || '').toLowerCase();
        if (!VIDEO_EXTENSIONS.includes(ext)) throw Error('视频仅支持 MP4、MOV、MKV、WebM 和 AVI');
        if (Number(req.headers['content-length']) > VIDEO_UPLOAD_BYTES)
          throw Error('上传视频不能超过 1 GB');
        const dir = path.join(store.root, 'uploads');
        await fs.mkdir(dir, { recursive: true });
        const file = path.join(dir, crypto.randomUUID() + ext);
        const handle = await fs.open(file, 'wx');
        let size = 0;
        try {
          for await (const chunk of req) {
            size += chunk.length;
            if (size > VIDEO_UPLOAD_BYTES) throw Error('上传视频不能超过 1 GB');
            await handle.writeFile(chunk);
          }
          if (!size) throw Error('视频文件为空');
          await handle.close();
          const info = await require('./media.cjs').probe(file);
          if (!info.width || !info.height || !Number.isFinite(info.duration) || info.duration <= 0)
            throw Error('无法读取视频文件');
          if (info.duration > store.config.limits.maxDuration) throw Error('视频不能超过 10 分钟');
          return json({ source: file });
        } catch (error) {
          await handle.close().catch(() => {});
          await fs.rm(file, { force: true });
          throw error;
        }
      }
      if (url.pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(': tutor\n\n');
        listeners.add(res);
        req.on('close', () => listeners.delete(res));
        return;
      }
      if (url.pathname === '/api/models' && req.method === 'POST') {
        const d = await readJson(req);
        const source = d.source;
        if (!source?.chatBaseUrl || !source?.credential) throw Error('请补充源接口和凭据名称');
        return json({
          models: await require('./models.cjs').listModels(
            source,
            d.key || store.credentials[source.credential],
          ),
        });
      }
      if (url.pathname === '/api/settings') {
        if (req.method === 'POST') {
          const d = await readJson(req);
          return json(await store.settings(d.config, d.keys));
        }
        return json(store.publicConfig());
      }
      if (url.pathname === '/api/projects') {
        if (req.method === 'POST') {
          const d = await readJson(req);
          if ((d.knowledge || '').length > store.config.limits.maxKnowledgeChars)
            throw Error('知识内容过长');
          return json(store.public(await store.create(d.source, d.knowledge, d.title)));
        }
        return json([...store.projects.values()].map((p) => store.public(p)));
      }
      if (parts[0] === 'api' && parts[1] === 'projects' && parts[2]) {
        const p = store.get(parts[2]),
          action = parts[3];
        affectedProject = p;
        if (req.method === 'GET') {
          if (!action) return json(store.public(p));
          if (action === 'reference') {
            const id = parts[4];
            const attachment = p.chat
              ?.flatMap((message) => message.attachments || [])
              .find((a) => a.id === id);
            if (!attachment || !/^reference-[a-f0-9-]{36}\.(png|jpg|webp)$/.test(attachment.file))
              throw Error('参考图片不存在');
            return await streamFile(req, res, path.join(store.dir(p.id), attachment.file));
          }
          if (action === 'source') return await streamFile(req, res, p.source);
          if (action === 'output') {
            if (!p.output) throw Error('尚未生成视频');
            const allowed = [
              'tutorial.mp4',
              'subtitles.srt',
              'script.json',
              'edit-plan.json',
              'cost.json',
              'verification.json',
              'config.json',
              'approval.json',
              'narration.wav',
            ];
            const name = url.searchParams.get('file') || 'tutorial.mp4';
            if (!allowed.includes(name)) throw Error('文件不可访问');
            return await streamFile(req, res, path.join(p.output.dir, name));
          }
          if (action === 'frame') {
            const t = Number(url.searchParams.get('t'));
            if (!Number.isFinite(t) || t < 0 || t >= p.info.duration) throw Error('时间无效');
            const file = path.join(store.dir(p.id), 'thumb-' + Math.round(t * 10) + '.png');
            try {
              await fs.access(file);
            } catch {
              await require('./media.cjs').frame(p.source, t, file);
            }
            return await streamFile(req, res, file);
          }
        }
        if (req.method === 'POST') {
          const d = await readJson(req, action === 'edit' ? 18 * 1024 * 1024 : undefined);
          if (action === 'prepare' || action === 'edit' || action === 'render') {
            if (p.job) throw Error('项目任务尚未结束');
            if (action === 'render') {
              require('./script.cjs').requireApproval(p);
              if (d.hash && d.hash !== require('./script.cjs').scriptHash(p.script))
                throw Error('剧本已更新，请刷新后确认当前版本');
            }
            if (action === 'edit') {
              parseReferences(d.images);
              if (!String(d.message || '').trim() && !d.images?.length)
                throw Error('请输入修改要求或添加参考图片');
            }
            const job =
              action === 'prepare'
                ? engine.prepare(p.id)
                : action === 'edit'
                  ? engine.edit(p.id, String(d.message || ''), d.images)
                  : engine.generate(p.id);
            job.catch(() => {});
            return json({ started: true, project: store.public(p) });
          }
          if (action === 'script')
            return json(store.public(await engine.saveScript(p.id, d.script)));
          if (action === 'approve') return json(store.public(await engine.confirm(p.id, d.hash)));
          if (action === 'cancel') {
            engine.cancel(p.id);
            return json({ cancelled: true });
          }
          if (action === 'knowledge') {
            if (p.job) throw Error('任务正在运行');
            const knowledge = String(d.knowledge || '');
            if (knowledge.length > store.config.limits.maxKnowledgeChars)
              throw Error('知识内容过长');
            p.knowledge = knowledge;
            p.approval = null;
            p.status = p.script ? 'review' : 'draft';
            await store.save(p);
            engine.publish(p);
            return json(store.public(p));
          }
        }
      }
      if (req.method !== 'GET') throw Error('不支持的请求');
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const isAsset = /^assets\/[A-Za-z0-9_.-]+\.(js|css|woff2|otf|ttf|svg|png)$/.test(name);
      if (name !== 'index.html' && !isAsset) {
        res.writeHead(404);
        res.end();
        return;
      }
      const builtUI = path.resolve(__dirname, '../dist/ui');
      let file = path.join(builtUI, name);
      if (name === 'index.html') {
        try {
          await fs.access(file);
        } catch {
          file = path.join(__dirname, 'ui', name);
        }
      }
      let body = await fs.readFile(file);
      if (name === 'index.html')
        body = Buffer.from(body.toString().replace('__TUTOR_TOKEN__', token));
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(name)],
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      res.end(body);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          error: engine.redact(e.message),
          ...(affectedProject ? { project: store.public(affectedProject) } : {}),
        }),
      );
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    server,
    store,
    engine,
    url: 'http://127.0.0.1:' + server.address().port,
    token,
    close: () => {
      for (const r of listeners) r.end();
      server.close();
    },
  };
}
module.exports = { startServer };
