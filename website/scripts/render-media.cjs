// Optional asset authoring on macOS; never runs in the deployment workflow.
// TUTOR_APP_DIR points to a built Tutor checkout (v0.3.1+).
// PUPPETEER_MODULE may point to an existing puppeteer-core installation.
// Uses only authored demo data, the local system voice and Tutor's renderer.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

const assets = path.resolve(__dirname, '../assets');
const appRoot = path.resolve(process.env.TUTOR_APP_DIR || path.join(__dirname, '../..'));
const appRequire = createRequire(path.join(appRoot, 'package.json'));
const { createCanvas, loadImage } = appRequire('@napi-rs/canvas');
const { font, ensureFonts } = appRequire('./src/fonts.cjs');
const { FFMPEG, run, probe, pcm, wav, frame } = appRequire('./src/media.cjs');
const { render } = appRequire('./src/render.cjs');
const { normalizeScript } = appRequire('./src/script.cjs');
const { DEFAULTS } = appRequire('./src/config.cjs');
const { startServer } = appRequire('./src/server.cjs');
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer-core');

function round(ctx, x, y, w, h, radius, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
function text(ctx, value, x, y, size, color = '#23334e') {
  ctx.font = font(size);
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.fillText(value, x, y);
}
function paintSource(index) {
  const canvas = createCanvas(1280, 720),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f6f8fc';
  ctx.fillRect(0, 0, 1280, 720);
  ctx.fillStyle = '#18263f';
  ctx.fillRect(0, 0, 228, 720);
  round(ctx, 25, 28, 32, 32, 10, '#4f87ed');
  text(ctx, 'K', 34, 32, 23, '#fff');
  text(ctx, 'Knowledge', 70, 31, 23, '#fff');
  text(ctx, '团队知识空间', 26, 89, 12, '#8a9bb7');
  ['工作概览', '我的知识库', '最近浏览', '团队成员'].forEach((label, i) => {
    if (i === 1) round(ctx, 14, 137 + i * 49, 200, 40, 9, '#2b405f');
    round(ctx, 28, 149 + i * 49, 13, 13, 4, i === 1 ? '#79abff' : '#667b9c');
    text(ctx, label, 55, 145 + i * 49, 14, i === 1 ? '#e5edfa' : '#9dacc4');
  });
  text(ctx, 'DEMO WORKSPACE', 27, 663, 10, '#7387a6');
  ctx.fillStyle = '#fff';
  ctx.fillRect(228, 0, 1052, 74);
  text(ctx, '我的知识库', 267, 28, 15, '#78869b');
  text(ctx, '⌕  搜索知识、文档与笔记', 827, 29, 13, '#9aa7b9');
  round(ctx, 1208, 23, 30, 30, 15, '#e5edfa');
  text(ctx, 'Y', 1217, 27, 17, '#5f7caa');
  text(ctx, index === 2 ? '产品使用指南' : '把知识整理在一起', 274, 111, 31);
  text(
    ctx,
    index === 2 ? '产品操作流程与团队上手资料' : '为你的经验留一个位置，让团队随时找到答案。',
    275,
    161,
    14,
    '#8a96a9',
  );
  round(ctx, 1077, 112, 154, 42, 10, '#3d7ee7');
  text(ctx, index === 2 ? '+  导入文档' : '+  新建知识库', 1094, 124, 14, '#fff');
  if (index < 2) {
    ['产品使用指南', '团队协作规范', '我的学习笔记'].forEach((title, i) => {
      const x = 274 + i * 325;
      round(ctx, x, 220, 301, 253, 15, '#fff', '#e3e8f1');
      round(ctx, x + 23, 244, 45, 45, 11, ['#e4edff', '#e5f0ed', '#f5ebdc'][i]);
      text(ctx, ['▤', '◈', '▱'][i], x + 34, 248, 27, ['#5086d9', '#70a391', '#b89868'][i]);
      text(ctx, title, x + 23, 311, 18);
      text(
        ctx,
        ['产品流程与上手文档', '一起工作的共同约定', '每一点积累都算数'][i],
        x + 23,
        350,
        13,
        '#8c98ab',
      );
      text(ctx, `${[12, 8, 24][i]} 篇文档`, x + 23, 422, 12, '#96a2b5');
      text(ctx, '↗', x + 262, 418, 18, '#92a8c7');
    });
    text(ctx, '最近更新', 275, 523, 18);
    ['知识库创建与管理', '文档导入规范'].forEach((title, i) => {
      round(ctx, 274, 564 + i * 58, 957, 48, 9, '#fff', '#e9edf4');
      text(ctx, title, 296, 578 + i * 58, 13, '#62738d');
      text(ctx, '刚刚更新', 1134, 578 + i * 58, 11, '#a3adba');
    });
  } else {
    ['全部文档', '创建知识库.md', '导入与管理文档.md', '团队共享指南.md'].forEach((title, i) => {
      round(ctx, 274, 221 + i * 91, 957, 72, 12, '#fff', '#e2e8f2');
      round(ctx, 295, 239 + i * 91, 36, 36, 8, '#e8effa');
      text(ctx, '▤', 304, 242 + i * 91, 22, '#6b94cc');
      text(ctx, title, 348, 236 + i * 91, 16);
      text(ctx, i ? '已导入 · 团队可查阅' : '3 篇文档已集中归档', 348, 263 + i * 91, 11, '#94a1b4');
      text(ctx, i ? '查看文档 ↗' : '导入完成 ✓', 1105, 247 + i * 91, 12, '#6f91bf');
    });
  }
  if (index === 1) {
    ctx.fillStyle = '#17263f55';
    ctx.fillRect(228, 74, 1052, 646);
    ctx.shadowColor = '#15223d26';
    ctx.shadowBlur = 35;
    round(ctx, 486, 166, 542, 422, 20, '#fff');
    ctx.shadowBlur = 0;
    text(ctx, '新建知识库', 520, 199, 24);
    text(ctx, '为这份知识，起一个容易找到的名字。', 520, 242, 13, '#8995a7');
    text(ctx, '知识库名称', 520, 291, 12, '#6d7e95');
    round(ctx, 520, 318, 473, 46, 8, '#f8faff', '#a4bfe8');
    text(ctx, '产品使用指南', 536, 331, 15);
    text(ctx, '简介', 520, 389, 12, '#6d7e95');
    round(ctx, 520, 416, 473, 65, 8, '#fbfcfe', '#e0e6ee');
    text(ctx, '记录产品操作流程，让每位同事都能快速上手。', 536, 432, 13, '#7b8ba3');
    round(ctx, 840, 516, 153, 42, 9, '#3d7ee7');
    text(ctx, '创建知识库', 878, 528, 14, '#fff');
    text(ctx, '取消', 782, 528, 13, '#8290a4');
  }
  const cursor = [
    [1150, 143],
    [922, 543],
    [1152, 443],
  ][index];
  ctx.save();
  ctx.translate(...cursor);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 29);
  ctx.lineTo(8, 22);
  ctx.lineTo(14, 35);
  ctx.lineTo(20, 32);
  ctx.lineTo(14, 20);
  ctx.lineTo(25, 20);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = '#263b60';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();
  return canvas;
}

(async () => {
  ensureFonts();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-website-media-'));
  await fs.mkdir(assets, { recursive: true });
  await fs.copyFile(path.join(appRoot, 'build/tutor.png'), path.join(assets, 'tutor.png'));
  for (let i = 0; i < 3; i++)
    await fs.writeFile(path.join(temp, `source-${i}.png`), paintSource(i).toBuffer('image/png'));
  const source = path.join(temp, 'source.mp4');
  await run(FFMPEG, [
    '-v',
    'error',
    '-y',
    '-framerate',
    '1/4',
    '-start_number',
    '0',
    '-i',
    path.join(temp, 'source-%d.png'),
    '-r',
    '30',
    '-t',
    '12',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    source,
  ]);
  const script = normalizeScript(
    {
      title: '三步，建立你的知识库',
      chapters: ['新建知识库', '填写基本信息', '导入你的资料'],
      scenes: [
        {
          kind: 'title',
          chapter: 0,
          heading: '建立你的知识库',
          narration: '三步，建立你的知识库。',
          min_view_seconds: 2.5,
        },
        {
          kind: 'action',
          chapter: 0,
          heading: '新建知识库',
          source_start: 0,
          source_end: 4,
          hold_at: 1,
          narration: '首先，点击新建知识库，为你的资料准备一个清晰的归属。',
        },
        {
          kind: 'action',
          chapter: 1,
          heading: '填写名称与简介',
          source_start: 4,
          source_end: 8,
          hold_at: 5,
          narration: '填写名称与简介，让团队快速理解这个知识库的用途。',
        },
        {
          kind: 'action',
          chapter: 2,
          heading: '导入操作文档',
          source_start: 8,
          source_end: 12,
          hold_at: 9,
          narration: '导入操作文档，资料便能集中管理，随时查阅。',
        },
      ],
    },
    12,
  );
  const audio = [];
  for (const [i, scene] of script.scenes.entries()) {
    const aiff = path.join(temp, `voice-${i}.aiff`);
    execFileSync('/usr/bin/say', ['-v', 'Tingting', '-r', '215', '-o', aiff, scene.narration]);
    const data = await pcm(aiff),
      file = path.join(temp, `voice-${i}.wav`);
    await fs.writeFile(file, wav(data));
    audio.push({ file, pcm: data, duration: data.length / 96000 });
  }
  const config = structuredClone(DEFAULTS);
  config.style.brand = { enabled: true, name: 'Tutor', tagline: 'KNOWLEDGE, SHARED.' };
  const result = await render({
    source,
    info: await probe(source),
    script,
    audio,
    config,
    dir: path.join(temp, 'render'),
    progress: (_, label) => console.log(label),
  });
  await run(FFMPEG, [
    '-v',
    'error',
    '-y',
    '-i',
    result.output,
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '24',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-movflags',
    '+faststart',
    path.join(assets, 'tutorial-demo.mp4'),
  ]);
  const poster = path.join(temp, 'poster.png');
  await frame(result.output, result.plan.scenes[1].offset + 2, poster);
  const posterImage = await loadImage(poster);
  const posterCanvas = createCanvas(posterImage.width, posterImage.height);
  posterCanvas.getContext('2d').drawImage(posterImage, 0, 0);
  await fs.writeFile(
    path.join(assets, 'demo-poster.webp'),
    posterCanvas.toBuffer('image/webp', 88),
  );
  const srt = await fs.readFile(path.join(temp, 'render/subtitles.srt'), 'utf8');
  await fs.writeFile(
    path.join(assets, 'tutorial-demo.vtt'),
    `WEBVTT\n\n${srt.replace(/(\d\d:\d\d:\d\d),(\d{3})/g, '$1.$2')}`,
  );
  await fs.writeFile(
    path.join(assets, 'media.json'),
    JSON.stringify(
      {
        source: 'Original website demo, rendered with Tutor',
        narration: 'macOS Tingting local system voice; not a model voice sample',
        generatorVersion: JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'))
          .version,
        duration: result.verification.duration,
        verificationPassed: result.verification.passed,
      },
      null,
      2,
    ) + '\n',
  );

  const studio = await startServer({ dataDir: path.join(temp, 'projects') });
  let browser;
  try {
    const project = await studio.store.create(
      source,
      '官网演示项目。演示内容：创建知识库、填写基本信息、导入资料。未调用任何模型接口。',
      '三步，建立你的知识库',
    );
    project.script = script;
    project.revision = 2;
    project.status = 'review';
    project.review = { issues: [], summary: '官网演示剧本，等待人工确认。' };
    project.progress = { stage: '等待审核当前版本', percent: 100 };
    project.chat = [
      { role: 'user', text: '把知识库创建流程整理成三步教程，保留操作细节。' },
      {
        role: 'assistant',
        text: '这份演示剧本包含三个章节：新建知识库、填写基本信息、导入资料。\n\n每段解说都对应原片时间点，可以在右侧逐段核对，调整讲解与停留时间。\n\n确认当前版本后，再进行配音和视频制作。',
      },
    ];
    await studio.store.save(project);
    browser = await puppeteer.launch({
      executablePath:
        process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
      defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
      args: ['--hide-scrollbars'],
    });
    const page = await browser.newPage();
    page.on('pageerror', (error) => console.error('Screenshot UI error:', error.message));
    await page.goto(studio.url, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.scene-media');
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      const scene = buttons.find(
        (button) =>
          button.textContent.includes('操作演示') && button.textContent.includes('新建知识库'),
      );
      scene?.click();
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    await page.screenshot({ path: path.join(assets, 'workbench.webp'), type: 'webp', quality: 90 });

    const social = createCanvas(1200, 630),
      ctx = social.getContext('2d');
    ctx.fillStyle = '#f5f3ee';
    ctx.fillRect(0, 0, 1200, 630);
    ctx.fillStyle = '#e0e9f6';
    ctx.fillRect(620, 0, 580, 630);
    const icon = await loadImage(path.join(assets, 'tutor.png'));
    ctx.drawImage(icon, 66, 63, 65, 65);
    text(ctx, 'Tutor.', 151, 78, 39);
    text(ctx, '让每一次操作，', 66, 216, 53);
    text(ctx, '都讲得清楚。', 66, 290, 53, '#265fae');
    text(ctx, '从一段录屏，到一堂好课。', 70, 405, 23, '#66758a');
    text(ctx, '免费桌面软件 · macOS / Windows', 70, 525, 17, '#6c7d96');
    const shot = await loadImage(path.join(assets, 'workbench.webp'));
    ctx.save();
    ctx.translate(662, 134);
    ctx.rotate(-0.045);
    ctx.shadowBlur = 35;
    ctx.shadowColor = '#233d6440';
    ctx.drawImage(shot, 0, 0, 685, 428);
    ctx.restore();
    await fs.writeFile(path.join(assets, 'social-card.jpg'), social.toBuffer('image/jpeg', 90));
  } finally {
    await browser?.close();
    studio.close();
  }
  console.log(
    JSON.stringify({
      assets,
      duration: result.verification.duration,
      passed: result.verification.passed,
      temporarySources: temp,
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
