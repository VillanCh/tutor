// A real Chromium + FFmpeg showcase, using isolated local data and no model calls.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCanvas } = require('@napi-rs/canvas');
const { startServer } = require('../src/server.cjs');
const { TestAccount } = require('./helpers/account.cjs');
const { FFMPEG, run, frame } = require('../src/media.cjs');

app.setName('Tutor Branding Showcase');
app.on('window-all-closed', () => {});
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'build/generated/branding-showcase');
let window,
  studio,
  stage = 'startup';
const watchdog = setTimeout(() => {
  console.error('Branding showcase timed out: ' + stage);
  app.exit(1);
}, 120000);
const evaluate = (code) => window.webContents.executeJavaScript(code);
const pause = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label) {
  stage = label;
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await pause(60);
  }
  throw Error('Timed out: ' + label);
}
const ui = (condition, label) => until(() => evaluate(condition), label);
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await pause();
}
async function setField(selector, value) {
  await evaluate(
    `(() => {const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await pause();
}
async function previewReady() {
  await ui(
    '!!document.querySelector(".watermark-preview-screen img") && document.querySelector(".watermark-preview-panel").getAttribute("aria-busy")==="false" && !document.querySelector(".watermark-preview-error")',
    'live watermark preview',
  );
  await pause(180);
}
async function capture(name, selector) {
  await pause(180);
  let rectangle;
  if (selector)
    rectangle = await evaluate(
      `(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)};})()`,
    );
  await fs.writeFile(
    path.join(artifacts, name),
    (await window.webContents.capturePage(rectangle)).toPNG(),
  );
}

function text(ctx, value, x, y, size = 22, color = '#263247', weight = '400', mono = false) {
  ctx.font =
    weight +
    ' ' +
    size +
    'px "' +
    (mono ? 'Tutor Mono' : 'Tutor Sans') +
    '", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.fillText(value, x, y);
}
function box(ctx, x, y, width, height, color, radius = 12) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}
async function brandCard(file, ending) {
  const canvas = createCanvas(1280, 720),
    ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 1280, 720);
  gradient.addColorStop(0, '#faf8f3');
  gradient.addColorStop(0.7, '#f0edf8');
  gradient.addColorStop(1, '#e1def5');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1280, 720);
  ctx.strokeStyle = '#cbc4df';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(1230, 380, 240 + i * 60, 0, Math.PI * 2);
    ctx.stroke();
  }
  box(ctx, 76, 65, 43, 43, '#665087', 11);
  text(ctx, 'Y', 86, 70, 29, '#ffffff', '600');
  text(ctx, 'YAKCOOL', 135, 68, 30, '#263247', '600');
  text(ctx, 'TUTOR / 实操课堂', 78, 148, 18, '#81758e', '500');
  text(ctx, ending ? '让每一次演示，' : '把经验，讲清楚。', 72, 230, 72, '#263247', '500');
  if (ending) text(ctx, '都值得复用。', 72, 326, 72, '#665087', '500');
  else {
    text(ctx, 'HTTP 请求与响应核对', 77, 338, 37, '#665087', '500');
    text(ctx, '构造请求  /  读取响应  /  核对结果', 80, 410, 22, '#7c8190');
  }
  if (ending) {
    box(ctx, 79, 450, 315, 60, '#263247', 10);
    text(ctx, '了解更多   yakcool.com', 100, 469, 22, '#ffffff', '500');
  }
  ctx.fillStyle = '#c7c3d2';
  ctx.fillRect(78, 594, 1124, 1);
  text(
    ctx,
    ending ? '录屏 · 校对 · 讲解 · 分享' : '从操作录屏，到可复用的知识',
    79,
    623,
    21,
    '#6d7280',
  );
  text(ctx, 'YAKCOOL  /  PRACTICAL GUIDE', 840, 628, 15, '#7f748d', '400', true);
  await fs.writeFile(file, canvas.toBuffer('image/png'));
}
async function tutorialScreen(file) {
  const canvas = createCanvas(1280, 720),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f2f4f8';
  ctx.fillRect(0, 0, 1280, 720);
  ctx.fillStyle = '#202734';
  ctx.fillRect(0, 0, 1280, 62);
  text(ctx, 'Yakit', 26, 16, 26, '#f8f9fc', '600');
  text(ctx, '/  HTTP Fuzzer', 111, 22, 18, '#b3bccd');
  box(ctx, 1084, 15, 166, 32, '#34473f', 7);
  text(ctx, '本地教学示例', 1103, 22, 16, '#b8ddc8');
  ctx.fillStyle = '#e7ebf2';
  ctx.fillRect(0, 62, 194, 658);
  text(ctx, 'WORKSPACE', 24, 92, 13, '#8a94a5', '500', true);
  for (const [i, label] of ['HTTP Fuzzer', '请求历史', '参数管理', '结果导出'].entries()) {
    if (!i) box(ctx, 14, 134 + i * 62, 166, 46, '#d9ddeb', 8);
    text(ctx, label, 28, 147 + i * 62, 18, i ? '#7c8697' : '#665087', i ? '400' : '500');
  }
  text(ctx, '请求与响应核对', 224, 91, 29, '#263247', '500');
  text(ctx, '先确认请求内容，再检查状态与返回数据。', 225, 134, 17, '#7e8797');
  box(ctx, 226, 184, 494, 452, '#ffffff', 10);
  box(ctx, 738, 184, 514, 452, '#ffffff', 10);
  text(ctx, '01 / 构造请求', 247, 207, 19, '#263247', '500');
  text(ctx, '02 / 核对响应', 760, 207, 19, '#263247', '500');
  ctx.fillStyle = '#edf0f5';
  ctx.fillRect(246, 245, 454, 1);
  ctx.fillRect(759, 245, 474, 1);
  const request = [
    'GET /api/tutorials HTTP/1.1',
    'Host: demo.local',
    'Accept: application/json',
    '',
    '// 教学演示 · 本地示例服务',
  ];
  request.forEach((line, i) =>
    text(ctx, line, 247, 277 + i * 39, 19, i === 0 ? '#665087' : '#677285', '400', true),
  );
  const response = [
    'HTTP/1.1 200 OK',
    'Content-Type: application/json',
    '',
    '{',
    '  "success": true,',
    '  "data": [',
    '    { "title": "HTTP 入门" }',
    '  ]',
    '}',
  ];
  response.forEach((line, i) =>
    text(ctx, line, 760, 277 + i * 33, 18, i === 0 ? '#438168' : '#677285', '400', true),
  );
  box(ctx, 246, 549, 454, 64, '#f1eef7', 7);
  text(ctx, '核对路径、请求头与参数', 263, 571, 18, '#79668e');
  for (const [i, label] of ['状态 200', '格式 JSON', '结果已核对'].entries()) {
    box(ctx, 226 + i * 180, 661, 164, 34, '#e4e9f1', 6);
    text(ctx, label, 244 + i * 180, 670, 15, '#718092');
  }
  await fs.writeFile(file, canvas.toBuffer('image/png'));
}

app.whenReady().then(async () => {
  let code = 0;
  try {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-branding-showcase-'));
    app.setPath('userData', path.join(temp, 'electron-data'));
    await fs.mkdir(path.join(artifacts, 'assets'), { recursive: true });
    const intro = path.join(artifacts, 'assets/片头-品牌介绍.png');
    const outro = path.join(artifacts, 'assets/片尾-关注引导.png');
    const screen = path.join(artifacts, 'assets/请求与响应-教学画面.png');
    await brandCard(intro, false);
    await brandCard(outro, true);
    await tutorialScreen(screen);
    const source = path.join(temp, 'HTTP 请求与响应核对.mp4');
    await run(FFMPEG, [
      '-v',
      'error',
      '-y',
      '-loop',
      '1',
      '-framerate',
      '24',
      '-i',
      screen,
      '-t',
      '5',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      source,
    ]);
    studio = await startServer({
      dataDir: path.join(temp, 'projects'),
      account: new TestAccount(),
    });
    const config = studio.store.publicConfig().config;
    Object.assign(config.style, { width: 1280, fps: 24 });
    await studio.store.settings(config, undefined, true);
    const project = await studio.store.create(
      source,
      '教学目标：构造一次 HTTP 请求，对照响应核对结果。',
      'HTTP 请求与响应核对',
      {
        intro: { enabled: true, path: intro, duration: 2 },
        outro: { enabled: true, path: outro, duration: 2.5 },
      },
    );
    await studio.engine.saveScript(project.id, {
      title: 'HTTP 请求与响应核对',
      chapters: ['构造请求', '核对响应'],
      scenes: [
        {
          id: 'title',
          kind: 'title',
          chapter: 0,
          heading: 'HTTP 请求与响应核对',
          min_view_seconds: 1.5,
          silent_tail_seconds: 0,
          transition: 'fade',
        },
        {
          id: 'request',
          kind: 'action',
          source_id: 'v01',
          chapter: 0,
          heading: '构造请求',
          source_start: 0,
          source_end: 2.4,
          hold_at: 1.2,
          min_view_seconds: 2.4,
          silent_tail_seconds: 0.3,
        },
        {
          id: 'response',
          kind: 'action',
          source_id: 'v01',
          chapter: 1,
          heading: '核对响应',
          source_start: 2.4,
          source_end: 4.8,
          hold_at: 3.5,
          min_view_seconds: 2.4,
          silent_tail_seconds: 0.3,
        },
      ],
    });
    let modelCalls = 0;
    studio.engine.provider = () => ({
      json: async () => {
        modelCalls++;
        throw Error('Unexpected model call');
      },
      speech: async () => {
        modelCalls++;
        throw Error('Unexpected model call');
      },
    });
    window = new BrowserWindow({
      show: false,
      width: 1600,
      height: 1440,
      backgroundColor: '#14161c',
      webPreferences: {
        preload: path.join(root, 'src/preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        offscreen: true,
      },
    });
    await window.loadURL(studio.url + '/');
    await ui('!!document.querySelector(".feature-guide")', 'first-launch feature guide');
    await ui(
      '[...document.querySelectorAll(".guide-bento-card")].every(el => Number(getComputedStyle(el).opacity) > 0.995)',
      'feature guide entrance completes',
    );
    await capture('feature-guide-overview.png', '.feature-guide');
    await click('[data-guide-feature="branding"]');
    await ui('!!document.querySelector("[data-guide-detail=branding]")', 'brand usage guide');
    await capture('feature-guide-branding.png', '.feature-guide');
    await click('.guide-dismiss');
    await ui('!!document.querySelector(".filmstrip")', 'showcase project loaded');
    await click('.branding-project-bar button');
    await ui('!!document.querySelector(".branding-dialog")', 'brand settings');
    await click('.branding-dialog .branding-card:last-child .branding-toggle input');
    await setField('.branding-dialog input[placeholder^="例如：YAKCOOL"]', 'YAKCOOL · 实操课堂');
    await previewReady();
    assert.equal(project.revision, 1, 'preview does not change the project');
    const withWatermark = await evaluate(
      'document.querySelector(".watermark-preview-screen img").src',
    );
    await click('.watermark-compare button:first-child');
    await previewReady();
    assert.notEqual(
      await evaluate('document.querySelector(".watermark-preview-screen img").src'),
      withWatermark,
    );
    await click('.watermark-compare button:last-child');
    await previewReady();
    await capture('settings-fullscreen.png', '.branding-dialog');
    await capture('settings-workspace.png');
    await click('.branding-dialog .dialog-footer button:last-child');
    await until(() => project.revision === 2, 'save tiled watermark settings');
    assert.equal(project.branding.watermark.layout, 'tiled');
    assert.equal(project.branding.watermark.opacity, 8);
    assert.equal(project.branding.watermark.width, 14);
    assert.equal(project.approval, null);
    await ui('!document.querySelector(".branding-dialog")', 'saved settings');
    await click('.next-action button');
    await ui(
      'document.querySelector(".approval-branding")?.textContent.includes("全屏平铺文字水印")',
      'review includes full-screen branding',
    );
    await evaluate(
      '[...document.querySelectorAll(".approval-dialog button")].find(button=>button.textContent.includes("我确认")).click()',
    );
    await until(
      () => project.status === 'done' && !project.job,
      'render complete branded tutorial',
    );
    assert.equal(project.output.verification.passed, true);
    assert.equal(project.output.plan.advertisements.length, 2);
    assert.equal(project.output.plan.content_start, 2);
    assert.equal(modelCalls, 0);
    await fs.copyFile(project.output.path, path.join(artifacts, 'tutorial-fullscreen.mp4'));
    const action = project.output.plan.scenes.find((scene) => scene.id === 'request');
    for (const [name, time] of [
      ['frame-intro.png', 0.8],
      ['frame-title.png', 2.7],
      ['frame-tutorial.png', action.offset + 1],
      ['frame-outro.png', project.output.plan.total_duration - 1],
    ])
      await frame(project.output.path, time, path.join(artifacts, name));
    await evaluate(
      '[...document.querySelectorAll("[role=tab]")].find(button=>button.textContent==="视频").click()',
    );
    await ui(
      'document.querySelector(".large-video video")?.readyState>=2',
      'finished video preview',
    );
    await evaluate(
      `(() => {const video=document.querySelector('.large-video video');video.muted=true;video.currentTime=${action.offset + 1};return video.play();})()`,
    );
    await ui(
      `document.querySelector('.large-video video').currentTime > ${action.offset + 1.15}`,
      'branded video plays in Chromium',
    );
    await evaluate('document.querySelector(".large-video video").pause()');
    await capture('workspace-fullscreen.png');
    const report = {
      passed: true,
      modelCalls,
      duration: project.output.verification.duration,
      layout: project.branding.watermark.layout,
      opacity: project.branding.watermark.opacity,
      advertisements: project.output.plan.advertisements.length,
      verification: project.output.verification,
      artifacts,
    };
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        {
          passed: true,
          modelCalls,
          duration: report.duration,
          layout: report.layout,
          opacity: report.opacity,
          advertisements: report.advertisements,
          artifacts,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    code = 1;
    console.error(stage + ': ' + error.stack);
    if (window && !window.isDestroyed()) await capture('failure.png').catch(() => {});
  } finally {
    clearTimeout(watchdog);
    window?.destroy();
    studio?.close();
    app.exit(code);
  }
});
