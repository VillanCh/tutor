const http = require('node:http'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { createReadStream } = require('node:fs'),
  { Store } = require('./store.cjs'),
  { Engine } = require('./engine.cjs');
const { findSource } = require('./sources.cjs');
const { YakcoolAccount } = require('./yakcool.cjs');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
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
async function startServer({ dataDir, account = new YakcoolAccount(), port = 0 } = {}) {
  const store = new Store(dataDir, account);
  await store.init();
  const engine = new Engine(store),
    token = crypto.randomBytes(24).toString('hex'),
    listeners = new Set();
  const previewFrames = new Map();
  engine.on('project', (p) => {
    if (account.public().authenticated)
      for (const res of listeners) res.write('data: ' + JSON.stringify(p) + '\n\n');
  });
  const accountChanged = (state) => {
    if (!state.authenticated) {
      for (const controller of engine.controllers.values()) controller.abort();
      for (const res of listeners) res.end();
      listeners.clear();
    }
  };
  account.on('change', accountChanged);
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
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(data));
      };
      if (url.pathname === '/api/account' && req.method === 'GET') return json(account.public());
      if (url.pathname === '/api/account/refresh' && req.method === 'POST')
        return json(await account.refresh());
      if (url.pathname === '/api/account/logout' && req.method === 'POST')
        return json(await account.logout());
      if (url.pathname === '/api/guide' && req.method === 'GET') return json(store.guideState);
      if (url.pathname === '/api/guide' && req.method === 'POST') {
        const d = await readJson(req);
        return json(await store.markGuideSeen(d.version));
      }
      if (parts[0] === 'api') await account.requireLogin();
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
          return json(await store.settings(d.config, d.keys, d.confirmModelUpdate === true));
        }
        return json(store.publicConfig());
      }
      if (url.pathname === '/api/projects') {
        if (req.method === 'POST') {
          const d = await readJson(req);
          if ((d.knowledge || '').length > store.config.limits.maxKnowledgeChars)
            throw Error('知识内容过长');
          return json(
            store.public(
              await store.create(d.sources ?? d.source, d.knowledge, d.title, d.branding),
            ),
          );
        }
        return json([...store.projects.values()].map((p) => store.public(p)));
      }
      if (url.pathname === '/api/import/inspect' && req.method === 'POST') {
        const d = await readJson(req);
        const controller = new AbortController();
        res.once('close', () => controller.abort());
        return json(await store.inspectSources(d.sources, controller.signal));
      }
      if (url.pathname === '/api/branding/preview' && req.method === 'POST') {
        const d = await readJson(req);
        const { normalizeBranding, brandingPreview } = require('./branding.cjs');
        const watermark = normalizeBranding({ watermark: d.watermark }).watermark;
        let background, info, heading, caption;
        if (d.projectId) {
          const project = store.get(d.projectId);
          const scene = project.script?.scenes.find((item) => item.kind !== 'title');
          const source = findSource(project, scene?.source_id);
          info = project.info;
          heading = scene?.heading;
          caption = scene?.narration;
          const time = Math.max(
            0,
            Math.min(
              scene?.freeze_at ?? scene?.hold_at ?? scene?.source_start ?? 0,
              source.info.duration - 0.04,
            ),
          );
          background = path.join(
            store.dir(project.id),
            'branding-preview-' + source.id + '-' + Math.round(time * 1000) + '.png',
          );
          if (!previewFrames.has(background)) {
            const task = (async () => {
              try {
                await fs.access(background);
              } catch {
                await require('./media.cjs').frame(source.path, time, background);
              }
            })();
            previewFrames.set(background, task);
            task.catch(() => previewFrames.delete(background));
          }
          await previewFrames.get(background);
        }
        return json(
          await brandingPreview({
            watermark,
            background,
            info,
            heading,
            caption,
            style: store.config.style,
          }),
        );
      }
      if (parts[0] === 'api' && parts[1] === 'drafts' && parts.length === 3) {
        if (req.method === 'GET') return json(await store.readDraft(parts[2]));
        if (req.method === 'POST') {
          const d = await readJson(req);
          await store.saveDraft(parts[2], d.draft ?? null);
          return json({ saved: true });
        }
      }
      if (parts[0] === 'api' && parts[1] === 'projects' && parts[2]) {
        const p = store.get(parts[2]),
          action = parts[3];
        if (req.method === 'GET') {
          if (!action) return json(store.public(p));
          if (action === 'source')
            return await streamFile(req, res, findSource(p, url.searchParams.get('source')).path);
          if (action === 'output') {
            if (!p.output) throw Error('尚未生成视频');
            const allowed = [
              'tutorial.mp4',
              'subtitles.srt',
              'script.json',
              'edit-plan.json',
              'verification.json',
              'approval.json',
              'narration.wav',
            ];
            const name = url.searchParams.get('file') || 'tutorial.mp4';
            if (!allowed.includes(name)) throw Error('文件不可访问');
            if (name === 'edit-plan.json') {
              const plan = JSON.parse(await fs.readFile(path.join(p.output.dir, name), 'utf8'));
              delete plan.models;
              return json(plan);
            }
            return await streamFile(req, res, path.join(p.output.dir, name));
          }
          if (action === 'frame') {
            const source = findSource(p, url.searchParams.get('source'));
            const t = Number(url.searchParams.get('t'));
            if (!Number.isFinite(t) || t < 0 || t >= source.info.duration) throw Error('时间无效');
            const file = path.join(
              store.dir(p.id),
              'thumb-' + source.id + '-' + Math.round(t * 10) + '.png',
            );
            try {
              await fs.access(file);
            } catch {
              await require('./media.cjs').frame(source.path, t, file);
            }
            return await streamFile(req, res, file);
          }
        }
        if (req.method === 'POST') {
          const d = await readJson(req);
          if (action === 'prepare' || action === 'edit' || action === 'render') {
            store.requireModelConfirmation();
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
          if (action === 'branding')
            return json(store.public(await engine.saveBranding(p.id, d.branding, d.revision)));
          if (action === 'approve')
            return json(
              store.public(await engine.confirm(p.id, d.hash, d.revision, d.brandingHash)),
            );
          if (action === 'resolve-issue')
            return json(store.public(await engine.resolveIssue(p.id, d.index, d.hash)));
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
      res.writeHead([401, 409].includes(e.status) ? e.status : 400, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify({ error: engine.redact(e.message) }));
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  account.init().catch(() => {});
  return {
    server,
    store,
    engine,
    url: 'http://127.0.0.1:' + server.address().port,
    token,
    close: () => {
      account.off('change', accountChanged);
      for (const r of listeners) r.end();
      server.close();
    },
  };
}
module.exports = { startServer };
