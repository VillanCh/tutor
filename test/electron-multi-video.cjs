// Real Electron/Chromium smoke test: disk-backed Files cross the production preload bridge.
// Models are stubbed; no credentials or paid APIs are used.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { startServer } = require('../src/server.cjs');
const { FFMPEG, run, wav, frame } = require('../src/media.cjs');

app.setName('Tutor Multi Video Test');
app.on('window-all-closed', () => {});
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'build/generated/multi-video-smoke');
let studio, window, temp;
let stage = 'startup';
const checkpoint = (label) => {
  stage = label;
  console.log('Desktop smoke: ' + label);
};
const watchdog = setTimeout(() => {
  console.error('Desktop smoke timed out at ' + stage);
  app.exit(1);
}, 90000);
const evaluate = (code) => window.webContents.executeJavaScript(code);
async function capture(name) {
  // Chromium may not have submitted the frame immediately after a React update.
  await new Promise((resolve) => setTimeout(resolve, 180));
  await fs.writeFile(path.join(artifacts, name), (await window.webContents.capturePage()).toPNG());
}
async function waitFor(predicate, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error('Timed out: ' + label);
}
async function ui(predicate, label) {
  await waitFor(() => evaluate(predicate), label);
}
async function setField(selector, value) {
  await evaluate(
    `(() => { const field = document.querySelector(${JSON.stringify(selector)}); const proto = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('input', {bubbles:true})); })()`,
  );
}

app.whenReady().then(async () => {
  try {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-electron-multi-'));
    await fs.mkdir(artifacts, { recursive: true });
    app.setPath('userData', path.join(artifacts, 'electron-data'));
    const inputs = [];
    for (const [name, size, color] of [
      ['横屏 素材.mp4', '320x180', 'red'],
      ['竖屏 素材.mp4', '180x320', 'blue'],
    ]) {
      const file = path.join(temp, name);
      await run(FFMPEG, [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=${color}:s=${size}:r=30:d=2`,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        file,
      ]);
      inputs.push(file);
    }
    studio = await startServer({ dataDir: path.join(temp, 'projects') });
    checkpoint('local server started');
    studio.store.credentials = {};
    const notes = path.join(temp, '说明.txt'),
      broken = path.join(temp, '损坏视频.mp4');
    await fs.writeFile(notes, '不是视频');
    await fs.writeFile(broken, 'broken video');
    const makeScene = (id, source_id, kind = 'action') => ({
      id,
      kind,
      source_id,
      chapter: 0,
      heading: id === 'red' ? '横屏操作' : '竖屏操作',
      source_start: 0,
      source_end: 1,
      hold_at: 0.5,
      freeze_at: 0.5,
      motion_mode: kind === 'observe' ? 'freeze' : 'normal',
      narration: '',
      min_view_seconds: 1,
      silent_tail_seconds: 0.7,
    });
    const combined = {
      title: '多素材联合教程',
      chapters: ['操作与结果'],
      scenes: [
        { id: 'title', kind: 'title', chapter: 0, heading: '操作与结果', narration: '' },
        makeScene('blue', 'v02'),
        makeScene('red', 'v01'),
        makeScene('freeze', 'v02', 'observe'),
      ],
    };
    let speechCalls = 0,
      holdAnalysis = false;
    const stubProvider = () => ({
      json: async (role, label, _messages, signal) => {
        if (holdAnalysis)
          return new Promise((_resolve, reject) => {
            if (signal.aborted) reject(Error('任务已取消'));
            else
              signal.addEventListener('abort', () => reject(Error('任务已取消')), { once: true });
          });
        if (role === 'editor') return { value: structuredClone(combined) };
        const id = label.split(' · ').at(-1);
        if (label.startsWith('视频分析'))
          return { value: { title: '素材初稿', chapters: ['操作'], scenes: [makeScene(id, id)] } };
        return {
          value: {
            script: { ...combined, scenes: combined.scenes.filter((s) => s.source_id === id) },
            issues:
              id === 'v01'
                ? [
                    {
                      scene: 'red',
                      severity: 'blocking',
                      message: '请人工核对横屏素材中的操作结果。',
                      source_id: 'v01',
                    },
                  ]
                : [],
            summary: '通过',
          },
        };
      },
      speech: async () => {
        speechCalls++;
        if (speechCalls === 1) throw Error('语音服务暂时不可用，请重试');
        const pcm = Buffer.alloc(96000);
        for (let i = 0; i < 48000; i++)
          pcm.writeInt16LE(Math.round(Math.sin((i * Math.PI * 440) / 48000) * 3000), i * 2);
        return wav(pcm);
      },
    });
    studio.engine.provider = stubProvider;
    ipcMain.handle('pick-video', () => inputs);
    window = new BrowserWindow({
      show: false,
      width: 1520,
      height: 1080,
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
    const exceptions = [];
    checkpoint('loading app');
    await window.loadURL(studio.url + '/');
    checkpoint('app loaded');
    window.webContents.debugger.attach('1.3');
    window.webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Runtime.exceptionThrown') exceptions.push(params.exceptionDetails);
    });
    await window.webContents.debugger.sendCommand('Runtime.enable');
    checkpoint('debugger ready');
    await ui(
      "!!document.querySelector('.video-dropzone') && !!window.tutorDesktop",
      'import screen',
    );
    checkpoint('import screen ready');

    await evaluate("document.querySelector('.video-dropzone').click()");
    await ui(
      "document.querySelectorAll('.video-import-list li').length === 2",
      'multiple native picker results',
    );
    checkpoint('native multi-selection passed');
    await evaluate(
      'document.querySelector(\'.video-import-list li:first-child button[aria-label^="下移"]\').click()',
    );
    await ui(
      "document.querySelector('.video-import-name').textContent.includes('竖屏')",
      'move down',
    );
    await evaluate(
      'document.querySelector(\'.video-import-list li:nth-child(2) button[aria-label^="上移"]\').click()',
    );
    await ui(
      "document.querySelector('.video-import-name').textContent.includes('横屏')",
      'move up',
    );
    await evaluate(
      'document.querySelector(\'.video-import-list li:nth-child(2) button[aria-label^="移除"]\').click()',
    );
    await ui("document.querySelectorAll('.video-import-list li').length === 1", 'remove a source');

    await evaluate(
      "(() => { const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.id = 'smoke-files'; input.hidden = true; document.body.append(input); })()",
    );
    const { root: dom } = await window.webContents.debugger.sendCommand('DOM.getDocument');
    const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', {
      nodeId: dom.nodeId,
      selector: '#smoke-files',
    });
    await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
      nodeId,
      files: inputs,
    });
    const drop =
      "(() => { const dataTransfer = new DataTransfer(); for (const file of document.querySelector('#smoke-files').files) dataTransfer.items.add(file); const zone = document.querySelector('.video-dropzone'); zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer })); zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })); })()";
    await evaluate(drop);
    await ui(
      "document.querySelectorAll('.video-import-list li').length === 2",
      'drop real disk-backed files through preload',
    );
    assert.deepEqual(
      await evaluate(
        "document.querySelector('textarea[aria-label=\"视频文件路径，每行一个\"]').value.split('\\n')",
      ),
      inputs,
    );
    await evaluate(drop);
    await ui("!document.querySelector('.video-dropzone').disabled", 'drop completion');
    assert.equal(await evaluate("document.querySelectorAll('.video-import-list li').length"), 2);
    const setDropFiles = async (files) => {
      await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files });
      await evaluate(drop);
    };
    await setDropFiles([inputs[0], notes]);
    assert.equal(await evaluate("document.querySelectorAll('.video-import-list li').length"), 2);
    await setDropFiles([broken]);
    await ui(
      "document.querySelector('.import-summary').textContent.includes('重新选择') && document.querySelector('.start-button').disabled",
      'corrupt source is visible before importing',
    );
    await evaluate(
      'document.querySelector(\'.video-import-list li:nth-child(3) button[aria-label^="移除"]\').click()',
    );
    studio.store.config.limits.maxDuration = 3;
    await evaluate(
      'document.querySelector(\'.video-import-list li:first-child button[aria-label^="下移"]\').click()',
    );
    await ui(
      "document.querySelector('.import-summary').textContent.includes('超出限制') && document.querySelector('.start-button').disabled",
      'aggregate duration preflight',
    );
    studio.store.config.limits.maxDuration = 600;
    await evaluate(
      'document.querySelector(\'.video-import-list li:nth-child(2) button[aria-label^="上移"]\').click()',
    );
    await ui(
      "!document.querySelector('.start-button').disabled && document.querySelectorAll('.video-import-detail small').length === 2",
      'valid source metadata and total duration',
    );
    assert.equal(await evaluate("document.querySelector('.path-field').open"), false);
    await window.webContents.reload();
    await ui(
      "document.querySelectorAll('.video-import-list li').length === 2 && !document.querySelector('.start-button').disabled",
      'import draft survives reload',
    );
    await capture('import.png');
    window.setSize(1080, 720);
    await evaluate(
      "document.querySelector('.import-panel').scrollTop = document.querySelector('.import-panel').scrollHeight",
    );
    await ui(
      "document.documentElement.scrollWidth <= innerWidth && document.querySelector('.start-button').getBoundingClientRect().bottom <= innerHeight",
      'small-window import action remains reachable',
    );
    await capture('import-small-window.png');
    window.setSize(1520, 1080);
    checkpoint('multi-file drag, deduplication and ordering passed');

    await evaluate("document.querySelector('.start-button').click()");
    await waitFor(() => studio.store.projects.size === 1, 'import without model credentials');
    let project = [...studio.store.projects.values()][0];
    assert.equal(project.script, null);
    await ui("!!document.querySelector('[role=dialog]')", 'model setup after local import');
    studio.store.credentials.default = 'test-placeholder';
    await window.webContents.reload();
    await ui(
      "document.querySelector('.next-action button')?.textContent.includes('生成剧本')",
      'generate script from imported project',
    );
    await evaluate("document.querySelector('.next-action button').click()");
    await waitFor(
      () => [...studio.store.projects.values()].some((p) => p.script && !p.job),
      'joint script generation',
    );
    checkpoint('joint script generated');
    project = [...studio.store.projects.values()][0];
    assert.equal(project.sources.length, 2);
    assert.equal(project.status, 'review');
    await ui(
      "!!document.querySelector('.review-notice.needs-review') && document.querySelector('.next-action button').disabled",
      'blocking review explains why production is unavailable',
    );
    await evaluate(
      "[...document.querySelectorAll('.review-issue button')].find(button => button.textContent.includes('查看该分镜')).click()",
    );
    await ui(
      "document.querySelector('.filmstrip button[aria-current=true]')?.textContent.includes('横屏操作')",
      'jump to flagged scene',
    );
    await evaluate(
      "[...document.querySelectorAll('.review-issue button')].find(button => button.textContent.includes('标记解决')).click()",
    );
    await ui(
      "!document.querySelector('.review-notice.needs-review')",
      'human resolution removes the blocker',
    );
    assert.equal(project.approval, null);
    await evaluate(
      "[...document.querySelectorAll('[role=tab]')].find((button) => button.textContent === '剧本').click()",
    );
    await evaluate("document.querySelectorAll('.filmstrip button')[1].click()");
    await ui(
      "document.querySelector('.scene-media video')?.videoWidth === 180",
      'selected portrait source preview',
    );
    assert.match(await evaluate("document.querySelector('.scene-media video').src"), /source=v02/);
    await ui(
      "[...document.querySelectorAll('.filmstrip img')].every((image) => image.naturalWidth > 0)",
      'all source thumbnails',
    );
    await evaluate("document.querySelectorAll('.filmstrip button')[2].click()");
    await ui(
      "document.querySelector('.scene-media video')?.videoWidth === 320",
      'switch to landscape source',
    );
    assert.match(await evaluate("document.querySelector('.scene-media video').src"), /source=v01/);
    await evaluate(
      "[...document.querySelectorAll('.text-control')].find((button) => button.textContent.includes('时序')).click()",
    );
    await ui(
      "document.querySelector('.scene-source-select')?.options.length === 2",
      'scene source editor',
    );
    await capture('storyboard.png');
    window.setSize(1080, 720);
    await ui(
      "document.documentElement.scrollWidth <= innerWidth && document.querySelector('.next-action button').getBoundingClientRect().right <= innerWidth",
      'small-window editor does not overflow',
    );
    await capture('storyboard-small-window.png');
    window.setSize(1520, 1080);

    const draftNarration = '这是在本机保留、稍后保存的操作解说。';
    await setField('textarea[aria-label="当前分镜解说词"]', draftNarration);
    await ui(
      "document.querySelector('.next-action button').textContent.includes('保存修改')",
      'primary action saves the draft',
    );
    await waitFor(
      async () =>
        (await studio.store.readDraft(project.id))?.script.scenes[2].narration === draftNarration,
      'project draft is saved to disk',
    );
    assert.equal(project.revision, 1);
    await evaluate("document.querySelector('.new-project-button').click()");
    await ui("!!document.querySelector('.video-dropzone')", 'navigate away from draft');
    await evaluate("document.querySelector('.project-list button').click()");
    await ui("!!document.querySelector('.filmstrip')", 'return to project');
    await evaluate("document.querySelectorAll('.filmstrip button')[2].click()");
    await ui(
      `document.querySelector('textarea[aria-label="当前分镜解说词"]').value === ${JSON.stringify(draftNarration)}`,
      'draft survives project navigation',
    );
    const oldId = project.id;
    await Promise.all(studio.store.draftWrites.values());
    studio.close();
    studio = await startServer({ dataDir: path.join(temp, 'projects') });
    studio.store.credentials.default = 'test-placeholder';
    studio.engine.provider = stubProvider;
    await window.loadURL(studio.url + '/');
    project = studio.store.get(oldId);
    await ui(
      "!!document.querySelector('.filmstrip')",
      'project restored on a different local port',
    );
    await evaluate("document.querySelectorAll('.filmstrip button')[2].click()");
    await ui(
      `document.querySelector('textarea[aria-label="当前分镜解说词"]').value === ${JSON.stringify(draftNarration)}`,
      'draft survives app/server restart',
    );
    await evaluate(
      "window.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}))",
    );
    await waitFor(() => project.revision === 2, 'keyboard save persists the script');
    await ui(
      "document.querySelector('.revision-label')?.textContent.includes('v2') && !document.querySelector('.next-action button').textContent.includes('保存修改')",
      'saved revision reaches the UI',
    );
    await ui(
      "document.querySelector('.filmstrip button[aria-current=true]')?.textContent.includes('横屏操作')",
      'save keeps the selected scene',
    );
    assert.equal(project.script.scenes[2].narration, draftNarration);
    await evaluate(
      "[...document.querySelectorAll('[role=tab]')].find(button => button.textContent === 'JSON').click()",
    );
    await setField('.json-editor', '{invalid json');
    await ui(
      "document.querySelector('.next-action button')?.textContent.includes('保存修改')",
      'invalid JSON is retained as a local draft',
    );
    await evaluate(
      "window.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}))",
    );
    await ui(
      "document.body.innerText.includes('JSON 格式不正确')",
      'invalid JSON is explained without losing the draft',
    );
    assert.equal(project.revision, 2);
    await setField('.json-editor', JSON.stringify(project.script, null, 2));

    await evaluate(
      "[...document.querySelectorAll('[role=tab]')].find((button) => button.textContent === '视频').click()",
    );
    await ui(
      "document.querySelector('.large-video video')?.videoWidth === 320",
      'video panel initial source',
    );
    await evaluate(
      "(() => { const select = document.querySelector('select[aria-label=\"预览视频素材\"]'); select.value = 'v02'; select.dispatchEvent(new Event('change', { bubbles: true })); })()",
    );
    await ui(
      "document.querySelector('.large-video video')?.videoWidth === 180",
      'video panel source selection',
    );
    assert.match(await evaluate("document.querySelector('.large-video video').src"), /source=v02/);
    await evaluate("document.querySelector('.next-action button').click()");
    await ui("!!document.querySelector('.approval-dialog')", 'human approval is still required');
    await evaluate(
      "[...document.querySelectorAll('.approval-dialog button')].find(button => button.textContent.includes('我确认')).click()",
    );
    await ui(
      "!!document.querySelector('.task-error') && document.body.innerText.includes('语音服务暂时不可用')",
      'speech failure has an actionable retry',
    );
    assert.equal(project.approval.revision, 2);
    await evaluate("document.querySelector('.task-error button').click()");
    await waitFor(
      () => project.status === 'done' && !project.job,
      'retry completes real video export',
    );
    assert.equal(speechCalls, 2);
    assert.equal(project.output.verification.passed, true);
    await fs.copyFile(project.output.path, path.join(artifacts, 'tutorial.mp4'));
    await frame(
      project.output.path,
      project.output.plan.scenes[2].offset + 0.5,
      path.join(artifacts, 'rendered-frame.png'),
    );
    await evaluate(
      "[...document.querySelectorAll('[role=tab]')].find(button => button.textContent === '视频').click()",
    );
    await ui("!!document.querySelector('.export-area')", 'successful output offers export files');
    await evaluate(
      "(() => { const video = document.querySelector('.large-video video'); video.muted = true; video.currentTime = 0; return video.play(); })()",
    );
    await ui(
      "document.querySelector('.large-video video').currentTime > 0.2 && document.querySelector('.large-video video').readyState >= 2",
      'exported video actually plays in Chromium',
    );
    await evaluate("document.querySelector('.large-video video').pause()");
    await capture('export.png');
    await evaluate("document.querySelector('.new-project-button').click()");
    await ui("!!document.querySelector('.video-dropzone')", 'prepare another project');
    await evaluate("document.querySelector('.video-dropzone').click()");
    await ui("!document.querySelector('.start-button').disabled", 'second import preflight');
    holdAnalysis = true;
    await evaluate("document.querySelector('.start-button').click()");
    await ui(
      "document.querySelector('.next-action button')?.textContent.includes('停止任务')",
      'running preparation can be stopped',
    );
    await evaluate("document.querySelector('.next-action button').click()");
    await ui(
      "document.querySelector('.task-error')?.textContent.includes('任务已停止')",
      'cancelled task can continue',
    );
    holdAnalysis = false;
    await evaluate("document.querySelector('.task-error button').click()");
    await waitFor(
      () => [...studio.store.projects.values()].filter((p) => p.script && !p.job).length === 2,
      'resume cancelled preparation',
    );
    assert.deepEqual(exceptions, []);
    const report = {
      passed: true,
      platform: process.platform,
      checks: [
        'multi-select',
        'disk-backed multi-file drop',
        'deduplication',
        'reorder/remove',
        'joint script',
        'source-specific thumbnails',
        'scene preview',
        'video source picker',
        'corrupt files and mixed drops',
        'duration preflight',
        'import without credentials',
        'human review resolution',
        'project draft recovery across local ports',
        'keyboard save',
        'invalid JSON recovery',
        'failed speech retry',
        'real video export',
        'cancel and resume',
        'small-window import and editing',
        'export playback in Chromium',
      ],
      projectSources: project.sources.length,
      screenshots: artifacts,
      exportedDuration: project.output.verification.duration,
    };
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error.stack);
    if (window && !window.isDestroyed()) {
      console.error(await evaluate('document.body.innerText.slice(-3000)'));
      await fs.writeFile(
        path.join(artifacts, 'failure.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
    }
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    window?.destroy();
    studio?.close();
    try {
      if (temp && path.dirname(path.resolve(temp)) === path.resolve(os.tmpdir()))
        await fs.rm(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      console.error('Temporary fixture cleanup: ' + error.code);
    } finally {
      app.exit(process.exitCode || 0);
    }
  }
});
