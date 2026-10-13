const http = require('node:http'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { createReadStream } = require('node:fs'),
  { Store } = require('./store.cjs'),
  { Engine } = require('./engine.cjs');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
  '.json': 'application/json; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
async function readJson(req) {
  let data = '',
    size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw Error('请求内容过大');
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
        if (req.method === 'GET') {
          if (!action) return json(store.public(p));
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
          const d = await readJson(req);
          if (action === 'prepare' || action === 'edit' || action === 'render') {
            if (p.job) throw Error('项目任务尚未结束');
            if (action === 'render') require('./script.cjs').requireApproval(p);
            const job =
              action === 'prepare'
                ? engine.prepare(p.id)
                : action === 'edit'
                  ? engine.edit(p.id, String(d.message || ''))
                  : engine.generate(p.id);
            job.catch(() => {});
            return json({ started: true });
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
      const isAsset = /^assets\/[A-Za-z0-9_.-]+\.(js|css|woff2|svg|png)$/.test(name);
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
      res.end(JSON.stringify({ error: engine.redact(e.message) }));
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
