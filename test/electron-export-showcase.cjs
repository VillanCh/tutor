const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { startServer } = require('../src/server.cjs');
const { framePreview } = require('../src/frame-layout.cjs');
const { EXPORT_ASPECTS } = require('../src/export-options.mjs');
const { DEFAULTS } = require('../src/config.cjs');
const { TestAccount, confirmModels } = require('./helpers/account.cjs');
const { demoSource } = require('./helpers/aspect-demo.cjs');
const { frame, probe, wav } = require('../src/media.cjs');
const { font, brandFont } = require('../src/fonts.cjs');
const { speechCacheRole } = require('../src/model-sources.mjs');
const { GUIDE_VERSION } = require('../src/guide-content.mjs');
const root = path.resolve(__dirname, '..'),
  out = path.join(root, 'build/generated/aspect-showcase');
let window,
  studio,
  stage = 'startup';
const watchdog = setTimeout(() => {
  console.error('Export showcase timed out: ' + stage);
  app.exit(1);
}, 240000);
app.on('window-all-closed', () => {});
const evaluate = (code) => window.webContents.executeJavaScript(code);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(code, label) {
  stage = label;
  for (let i = 0; i < 500; i++) {
    if (await evaluate(code)) return;
    await pause(60);
  }
  throw Error('Timed out: ' + label);
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await pause(120);
}
async function capture(name, selector) {
  await evaluate('document.fonts.ready.then(()=>true)');
  window.webContents.invalidate();
  await pause(160);
  const rect = selector
    ? await evaluate(
        `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`,
      )
    : undefined;
  await fs.writeFile(path.join(out, name), (await window.webContents.capturePage(rect)).toPNG());
}
async function contactSheet(items, kind) {
  const W = 1680,
    H = 1560,
    c = createCanvas(W, H),
    ctx = c.getContext('2d');
  ctx.fillStyle = '#0e1015';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#e8ebf0';
  ctx.font = font(38);
  ctx.fillText(kind === 'title' ? '章节过场，也随画布重新排版' : '一段录屏，适配六种画布', 40, 31);
  ctx.fillStyle = '#b0b9c8';
  ctx.font = font(21);
  ctx.fillText('同一段 16:9 示例录屏 · 框架自适应 · 原画面等比完整显示', 42, 92);
  for (const [i, item] of items.entries()) {
    const x = 32 + (i % 3) * 548,
      y = 150 + Math.floor(i / 3) * 696;
    ctx.fillStyle = '#181b23';
    ctx.beginPath();
    ctx.roundRect(x, y, 520, 672, 16);
    ctx.fill();
    ctx.strokeStyle = '#353b46';
    ctx.stroke();
    ctx.font = brandFont(27);
    ctx.fillStyle = '#dcc4ed';
    ctx.fillText(item.aspect, x + 22, y + 22);
    ctx.font = font(18);
    ctx.fillStyle = '#b0b9c8';
    ctx.fillText(item.width + ' × ' + item.height, x + 22, y + 63);
    const image = await loadImage(path.join(out, item.key + '-' + kind + '.png'));
    const scale = Math.min(474 / image.width, 526 / image.height),
      w = image.width * scale,
      h = image.height * scale;
    ctx.drawImage(image, x + (520 - w) / 2, y + 118 + (526 - h) / 2, w, h);
  }
  await fs.writeFile(
    path.join(out, kind === 'title' ? 'transitions-comparison.png' : 'ratios-comparison.png'),
    c.toBuffer('image/png'),
  );
}

app.whenReady().then(async () => {
  let code = 0;
  try {
    await fs.mkdir(out, { recursive: true });
    app.setPath('userData', path.join(out, 'electron-session'));
    const source = await demoSource(out);
    studio = await startServer({
      dataDir: path.join(out, 'demo-projects'),
      account: new TestAccount(),
    });
    await confirmModels(studio.store);
    await studio.store.markGuideSeen(GUIDE_VERSION);
    const p = await studio.store.create(
      source.video,
      '检查请求方法、路径、响应码与返回字段。',
      'HTTP 请求与响应核对',
    );
    await studio.engine.saveScript(p.id, {
      title: 'HTTP 请求与响应核对',
      chapters: ['构造请求', '核对响应'],
      scenes: [
        {
          id: 'chapter',
          kind: 'title',
          chapter: 0,
          heading: '构造请求，核对响应',
          min_view_seconds: 1.4,
          transition: 'fade',
        },
        {
          id: 'request',
          kind: 'action',
          chapter: 0,
          heading: '构造请求，检查参数与路径',
          source_start: 0,
          source_end: 1.8,
          hold_at: 0.8,
          narration: '先检查请求方法、路径与请求头，再发送请求。',
          min_view_seconds: 1.8,
          silent_tail_seconds: 0.7,
          transition: 'fade',
        },
        {
          id: 'response',
          kind: 'observe',
          chapter: 1,
          heading: '观察响应，确认实际结果',
          freeze_at: 2.4,
          motion_mode: 'freeze',
          narration: '对照响应码和返回字段，确认操作符合预期。',
          min_view_seconds: 1.5,
          silent_tail_seconds: 0.7,
          transition: 'fade',
        },
      ],
    });
    const config = structuredClone(studio.store.config);
    config.style.fps = 24;
    studio.store.config = config;
    const voices = path.join(studio.store.dir(p.id), 'voices');
    await fs.mkdir(voices, { recursive: true });
    for (const scene of p.script.scenes.filter((s) => s.narration)) {
      const key = crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            text: scene.narration,
            role: speechCacheRole(config.roles.speech),
            speech: config.speech,
          }),
        )
        .digest('hex');
      await fs.writeFile(path.join(voices, key + '.wav'), wav(Buffer.alloc(48000 * 2)));
    }
    let modelCalls = 0;
    studio.engine.provider = () => ({
      speech: async () => {
        modelCalls++;
        throw Error('Unexpected model call');
      },
    });
    window = new BrowserWindow({
      show: false,
      width: 1600,
      height: 1140,
      backgroundColor: '#14161c',
      webPreferences: {
        preload: path.join(root, 'src/preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        offscreen: true,
        backgroundThrottling: false,
      },
    });
    await window.loadURL(studio.url + '/');
    await waitFor('!!document.querySelector(".branding-project-bar")', 'load project');
    await click('button[aria-label="导出比例与画布"]');
    await waitFor('!!document.querySelector(".export-dialog")', 'export settings');
    const items = [];
    for (const preset of EXPORT_ASPECTS.filter((x) => x.id !== 'auto')) {
      const aspect = preset.id,
        key = aspect.replace(':', '-');
      console.log('Export showcase: ' + aspect);
      stage = aspect;
      await click(`[data-export-aspect="${aspect}"]`);
      await waitFor(
        'document.querySelector(".export-preview-screen")?.getAttribute("aria-busy")==="false" && !!document.querySelector(".export-preview-screen img")',
        'preview ' + aspect,
      );
      if (aspect === '9:16') {
        await capture('export-dialog-portrait.png', '.export-dialog');
        await click('.export-preview-tabs button:last-child');
        await waitFor(
          'document.querySelector(".export-preview-screen")?.getAttribute("aria-busy")==="false"',
          'title preview',
        );
        await capture('export-dialog-transition.png', '.export-dialog');
        await click('.export-preview-tabs button:first-child');
      }
      if (aspect === '16:9') await capture('export-dialog-landscape.png', '.export-dialog');
      await click('.export-dialog .dialog-footer button:last-child');
      await waitFor('!document.querySelector(".export-dialog")', 'apply ' + aspect);
      assert.equal(p.exportOptions.aspect, aspect);
      if (!process.argv.includes('--previews-only')) {
        await studio.engine.confirm(
          p.id,
          require('../src/script.cjs').scriptHash(p.script),
          p.revision,
          undefined,
          require('../src/frame-layout.cjs').exportHash(p.exportOptions),
        );
        await studio.engine.generate(p.id);
        const target = path.join(out, key + '.mp4');
        await fs.copyFile(p.output.path, target);
        const video = await probe(target);
        assert.equal(video.width / video.height, preset.width / preset.height);
        const action = p.output.plan.scenes.find((s) => s.kind !== 'title');
        await frame(target, action.offset + 0.85, path.join(out, key + '-content.png'));
        await frame(target, 0.7, path.join(out, key + '-title.png'));
        await evaluate(
          `[...document.querySelectorAll('[role=tab]')].find(el=>el.textContent==='视频').click()`,
        );
        await waitFor(
          `(() => { const video=document.querySelector('.large-video video');return video&&video.readyState>=2&&video.videoWidth===${video.width}&&video.videoHeight===${video.height}; })()`,
          'Chromium playback ' + aspect,
        );
        await evaluate(
          `(async()=>{const video=document.querySelector('.large-video video');video.muted=true;await video.play();video.pause();return true;})()`,
        );
        items.push({
          aspect,
          key,
          width: video.width,
          height: video.height,
          duration: video.duration,
        });
      } else {
        for (const title of [false, true]) {
          const result = await framePreview({
            info: p.info,
            style: config.style,
            exportOptions: p.exportOptions,
            background: source.image,
            scene: p.script.scenes.find((s) => (s.kind === 'title') === title),
            script: p.script,
            title,
          });
          await fs.writeFile(
            path.join(out, key + '-' + (title ? 'title' : 'content') + '.png'),
            Buffer.from(result.image.split(',')[1], 'base64'),
          );
          if (!title)
            items.push({ aspect, key, width: result.canvas.width, height: result.canvas.height });
        }
      }
      await click('button[aria-label="导出比例与画布"]');
    }
    await contactSheet(items, 'content');
    await contactSheet(items, 'title');
    assert.equal(modelCalls, 0);
    await fs.writeFile(
      path.join(out, 'index.html'),
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tutor · 导出比例模板</title><style>
      *{box-sizing:border-box}body{margin:0;padding:32px;background:#101216;color:#e8ebf0;font:15px/1.7 'Segoe UI','Microsoft YaHei',sans-serif}main{max-width:1300px;margin:auto}h1{font-size:32px;margin:0 0 8px}p{color:#b0b9c8}nav,.modes{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}button,a{font:inherit;color:inherit}button{padding:9px 17px;border:1px solid #353b46;border-radius:7px;background:#1b1e26;cursor:pointer}button[aria-pressed=true]{border-color:#bb90d6;color:#dec5ed}section{border:1px solid #353b46;border-radius:12px;padding:22px;margin-top:22px;background:#15181f}figure{margin:0;height:66vh;min-height:360px;display:flex;justify-content:center;align-items:center;background:#0a0c10;border-radius:8px}figure img,video{width:100%;height:100%;object-fit:contain}video{display:none}a{color:#d4b1eb}small{font-size:13px}.spec{font-size:22px;color:#dac0ec;margin:12px 0}.comparison{width:100%;height:auto;display:block;margin-top:24px}footer{margin:24px 0;color:#b0b9c8}
      </style><main><h1>一段录屏，适配常见画布</h1><p>框架、字幕与章节过场按画布重新排版。录屏等比完整显示。下方为实际导出的 1080p 示例，视频仅展示画布与动画，无配音。</p><nav id="ratios"></nav><section><div class="modes"><button data-mode="content" aria-pressed="true">录屏与字幕</button><button data-mode="title">章节过场</button><button data-mode="video">播放动态样片</button></div><div class="spec" id="spec"></div><figure><img id="preview" alt="模板预览"><video id="movie" controls muted loop playsinline></video></figure><p><a id="download" download>下载此比例 MP4</a> · <a href="export-dialog-portrait.png">查看应用中的比例设置</a></p></section><img class="comparison" src="ratios-comparison.png" alt="六种常见比例的录屏框架对比"><img class="comparison" src="transitions-comparison.png" alt="六种常见比例的过场对比"><footer>六种比例：16:9、9:16、1:1、4:5、4:3、3:4。标准 1080p，也可在应用内选择 720p。</footer></main><script>
      const items=${JSON.stringify(items)},nav=document.querySelector('#ratios');let index=0,mode='content';
      items.forEach((item,i)=>{const b=document.createElement('button');b.textContent=item.aspect;b.onclick=()=>{index=i;draw()};nav.append(b)});
      function draw(){const item=items[index];[...nav.children].forEach((b,i)=>b.setAttribute('aria-pressed',i===index));document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.mode===mode));document.querySelector('#spec').textContent=item.aspect+' · '+item.width+' × '+item.height;const image=document.querySelector('#preview'),movie=document.querySelector('#movie');image.style.display=mode==='video'?'none':'block';movie.style.display=mode==='video'?'block':'none';movie.pause();if(mode==='video')movie.src=item.key+'.mp4';else image.src=item.key+'-'+mode+'.png';document.querySelector('#download').href=item.key+'.mp4'}
      document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;draw()});draw();
      </script></html>`,
    );
    await fs.writeFile(
      path.join(out, 'report.json'),
      JSON.stringify({ passed: true, modelCalls, visualPreviewAudio: 'silent', items }, null, 2),
    );
    console.log(JSON.stringify({ passed: true, modelCalls, templates: items.length, out }));
  } catch (error) {
    code = 1;
    console.error(stage + ': ' + error.stack);
    if (window && !window.isDestroyed()) await capture('failure.png');
  } finally {
    clearTimeout(watchdog);
    window?.destroy();
    studio?.close();
    app.exit(code);
  }
});
