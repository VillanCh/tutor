const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
module.exports = async function smoke(reportFile, version) {
  const { FFMPEG, FFPROBE, run, probe, wav } = require('./media.cjs');
  const { render } = require('./render.cjs');
  const { normalizeScript } = require('./script.cjs');
  const { DEFAULTS } = require('./config.cjs');
  const { startServer } = require('./server.cjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-release-check-'));
  let server, playbackWindow;
  try {
    const source = path.join(dir, 'source.mp4');
    await run(FFMPEG, [
      '-hide_banner',
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=30:duration=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      source,
    ]);
    const script = normalizeScript(
      {
        title: '发行包渲染验证',
        chapters: ['测试'],
        scenes: [
          {
            kind: 'action',
            chapter: 0,
            heading: '操作演示',
            source_start: 0,
            source_end: 1,
            hold_at: 0.5,
            narration: '测试解说',
            min_view_seconds: 1,
            silent_tail_seconds: 0.7,
          },
          {
            kind: 'observe',
            chapter: 0,
            heading: '定格观察',
            freeze_at: 1,
            motion_mode: 'freeze',
            narration: '观察画面',
            min_view_seconds: 1,
            silent_tail_seconds: 0.7,
          },
        ],
      },
      2,
    );
    const audio = [];
    for (let i = 0; i < 2; i++) {
      const pcm = Buffer.alloc(48000);
      for (let n = 0; n < 24000; n++)
        pcm.writeInt16LE(Math.round(Math.sin((n * Math.PI * 440) / 48000) * 2000), n * 2);
      const file = path.join(dir, 'voice-' + i + '.wav');
      await fs.writeFile(file, wav(pcm));
      audio.push({ file, pcm, duration: 0.5 });
    }
    const result = await render({
      source,
      info: await probe(source),
      script,
      audio,
      config: DEFAULTS,
      dir,
      progress: () => {},
    });
    if (!result.verification.passed) throw Error('Packaged video verification failed');
    server = await startServer({ dataDir: path.join(dir, 'projects') });
    const playbackProject = await server.store.create(result.output, '', '成片播放检查');
    const { BrowserWindow } = require('electron');
    playbackWindow = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    await playbackWindow.loadURL(server.url + '/');
    const playback = await playbackWindow.webContents
      .executeJavaScript(`new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      const timer = setTimeout(() => reject(Error('Desktop video decoding timed out')), 15000);
      video.onloadeddata = () => { clearTimeout(timer); resolve({ width: video.videoWidth, height: video.videoHeight, readyState: video.readyState }); video.remove(); };
      video.onerror = () => { clearTimeout(timer); reject(Error('Desktop video decoding failed: ' + video.error?.code + ' ' + video.error?.message)); video.remove(); };
      video.src = ${JSON.stringify(server.url + '/api/projects/' + playbackProject.id + '/source')};
      document.body.appendChild(video);
    })`);
    if (!playback.width || playback.readyState < 2) throw Error('Desktop video did not decode');
    playbackWindow.destroy();
    playbackWindow = null;
    const htmlResponse = await fetch(server.url + '/');
    const html = await htmlResponse.text();
    if (!htmlResponse.ok || !html.includes('assets/') || html.includes('__TUTOR_TOKEN__'))
      throw Error('Packaged frontend did not load');
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(
      (match) => match[1],
    );
    for (const asset of assets)
      if (!(await fetch(server.url + asset)).ok) throw Error('Missing UI asset: ' + asset);
    for (const asset of assets.filter((name) => name.endsWith('.css'))) {
      const css = await (await fetch(server.url + asset)).text();
      const fonts = [
        ...css.matchAll(/url\(["']?(\/assets\/[^)"']+\.(?:otf|ttf|woff2))["']?\)/g),
      ].map((match) => match[1]);
      if (!fonts.some((name) => name.endsWith('.otf')))
        throw Error('Bundled Chinese UI font is missing');
      if (!fonts.some((name) => name.endsWith('.ttf')))
        throw Error('Bundled brand UI font is missing');
      for (const file of fonts)
        if (!(await fetch(server.url + file)).ok) throw Error('Missing bundled UI font: ' + file);
    }
    if (typeof require('mammoth').extractRawText !== 'function')
      throw Error('Document import module unavailable');
    const report = {
      version,
      platform: process.platform,
      arch: process.arch,
      passed: true,
      checkedAt: new Date().toISOString(),
      modelsCalled: 0,
      checks: {
        nativeCanvas: true,
        bundledChineseFont: true,
        ffmpeg: true,
        ffprobe: true,
        videoDecode: true,
        desktopVideoPlayback: true,
        silentNarrationGap: true,
        frontendAssets: assets.length,
        documentImportModule: true,
      },
      media: { ffmpeg: path.basename(FFMPEG), ffprobe: path.basename(FFPROBE) },
      video: { width: result.plan.canvas.width, height: result.plan.canvas.height },
    };
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
  } finally {
    playbackWindow?.destroy();
    server?.close();
    if (
      path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith('tutor-release-check-')
    )
      throw Error('Unexpected temporary cleanup path');
    await fs.rm(dir, { recursive: true, force: true });
  }
};
