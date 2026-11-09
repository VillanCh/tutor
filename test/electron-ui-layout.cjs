// Layout checks run in real Chromium with isolated projects and no model calls.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { startServer } = require('../src/server.cjs');
const { TestAccount } = require('./helpers/account.cjs');
const { FFMPEG, run } = require('../src/media.cjs');
const { normalizeScript, revise, schedule } = require('../src/script.cjs');

app.setName('Tutor UI Layout Check');
app.on('window-all-closed', () => {});
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'build/generated/ui-layout');
let window,
  studio,
  temp,
  stage = 'startup';
const results = [];
const failures = [];
const exceptions = [];
const evaluate = (code) => window.webContents.executeJavaScript(code);
const pause = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
const watchdog = setTimeout(() => {
  console.error('UI layout timed out: ' + stage);
  app.exit(1);
}, 180000);
async function waitFor(predicate, label) {
  for (let i = 0; i < 120; i++) {
    if (await evaluate(predicate)) return;
    await pause(50);
  }
  throw Error('Timed out: ' + label);
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await pause();
}
async function setField(selector, value) {
  await evaluate(
    `(() => { const el=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); })()`,
  );
  await pause();
}
async function viewport(width, height, zoom = 1) {
  window.setContentSize(width, height);
  window.webContents.setZoomFactor(zoom);
  await pause(140);
}
async function capture(name) {
  await fs.writeFile(
    path.join(artifacts, name + '.png'),
    (await window.webContents.capturePage()).toPNG(),
  );
}
async function audit(name, screenshot = false) {
  stage = name;
  await evaluate('document.fonts.ready.then(() => true)');
  await pause();
  const measured = await evaluate(`(() => {
    const issues=[];
    const describe=el=>el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\\s+/).slice(0,3).join('.'):'');
    if(document.documentElement.scrollWidth>innerWidth+2) issues.push('page wider than viewport');
    for(const el of document.querySelectorAll('body *')) {
      if(['SCRIPT','STYLE','SVG','PATH','INPUT','TEXTAREA','SELECT','OPTION'].includes(el.tagName.toUpperCase())||el.matches('.sr-only,[data-sonner-toast] [data-icon]')||(el.children.length===1&&el.firstElementChild.matches('svg.animate-spin'))) continue;
      const r=el.getBoundingClientRect(), s=getComputedStyle(el);
      if(!el.clientWidth||r.width<1||r.height<1||r.right<0||r.left>innerWidth||r.bottom<0||r.top>innerHeight||s.display==='inline') continue;
      if(el.scrollWidth>el.clientWidth+2 && !el.matches('pre,code,.filmstrip,.chapter-nav') && !(s.overflowX==='hidden'&&(s.textOverflow==='ellipsis'||s.webkitLineClamp!=='none'))) {
        issues.push(describe(el)+' horizontally overflows by '+(el.scrollWidth-el.clientWidth)+'px ('+s.overflowX+')');
      }
    }
    const dialog=document.querySelector('[data-slot=dialog-content]');
    if(dialog) {
      const r=dialog.getBoundingClientRect();
      if(r.left<8||r.top<8||r.right>innerWidth-8||r.bottom>innerHeight-8) issues.push('dialog escapes viewport');
      for(const el of dialog.querySelectorAll('section,pre')) {
        const c=el.getBoundingClientRect();
        if(c.left<r.left||c.right>r.right) issues.push(describe(el)+' escapes dialog');
      }
    }
    for(const el of document.querySelectorAll('.title-media,.workspace-header,.next-action,.settings-footer')) {
      const r=el.getBoundingClientRect();
      if(r.width&&r.height&&r.top<innerHeight&&r.bottom>0&&el.scrollHeight>el.clientHeight+2) issues.push(describe(el)+' clips content vertically');
    }
    const menu=document.querySelector('[data-slot=dropdown-menu-content]');
    if(menu) {
      const r=menu.getBoundingClientRect();
      if(r.left<0||r.top<0||r.right>innerWidth||r.bottom>innerHeight) issues.push('project menu escapes viewport');
    }
    const text=document.body.innerText;
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    const smallText=[];
    while(walker.nextNode()) {
      const node=walker.currentNode, el=node.parentElement;
      if(!node.textContent.trim()||!el||el.closest('script,style,svg,[aria-hidden=true],.sr-only,[disabled]')) continue;
      if(!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) continue;
      const range=document.createRange();range.selectNodeContents(node);
      const visible=[...range.getClientRects()].some(r=>r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth);
      if(visible&&parseFloat(getComputedStyle(el).fontSize)<11.95) smallText.push(describe(el)+' '+node.textContent.trim().slice(0,35)+' ('+getComputedStyle(el).fontSize+')');
    }
    for(const item of [...new Set(smallText)]) issues.push('text below 12px: '+item);
    if(/yakcool/i.test(text.replaceAll('YAKCOOL',''))) issues.push('brand is not uppercase');
    return {viewport:[innerWidth,innerHeight],issues:[...new Set(issues)]};
  })()`);
  results.push({ name, ...measured });
  if (measured.issues.length) {
    failures.push({ name, ...measured });
    console.error(name + ': ' + measured.issues.slice(0, 8).join('; '));
    await capture('failure-' + name);
  } else if (screenshot) await capture(name);
}
async function closeDialog() {
  await click('[data-slot=dialog-content] [data-slot=dialog-close]');
  await waitFor('!document.querySelector("[data-slot=dialog-content]")', 'close dialog');
}
async function reachable(selector) {
  await evaluate(
    `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`,
  );
  await pause();
  assert(
    await evaluate(`(() => {
    const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();
    const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&(top===el||el.contains(top));
  })()`),
    stage + ': control is not reachable: ' + selector,
  );
}
async function tab(label) {
  await evaluate(
    `[...document.querySelectorAll('[role=tab]')].find(el=>el.textContent===${JSON.stringify(label)}).click()`,
  );
  await pause();
}

app.whenReady().then(async () => {
  let code = 0;
  try {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tutor-ui-layout-'));
    await fs.mkdir(artifacts, { recursive: true });
    app.setPath('userData', path.join(temp, 'electron-data'));
    const file = path.join(
      temp,
      '多个原始视频与很长的素材名称-' + 'long-video-name-'.repeat(8) + '.mp4',
    );
    await run(FFMPEG, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=320x180:r=6:d=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      file,
    ]);
    const secondFile = path.join(temp, '第二个素材.mp4');
    await fs.copyFile(file, secondFile);
    const account = new TestAccount(false);
    const originalPublic = account.public.bind(account);
    account.public = () => {
      const state = originalPublic();
      if (state.user) state.user.name = '账户名称比较长-' + 'long-account-name'.repeat(6);
      return state;
    };
    studio = await startServer({ dataDir: path.join(temp, 'projects'), account });
    const project = await studio.store.create(
      [file, secondFile],
      '知识资料\n' + 'https://example.test/'.repeat(50),
      '很长的教程名称-' + 'very-long-project-title-'.repeat(8),
    );
    const chapters = [
      '章节引导与准备工作',
      '实际操作与长标题演示-' + 'long-chapter-title-'.repeat(6),
      '结果验证与总结',
    ];
    revise(
      project,
      normalizeScript(
        {
          title: project.title,
          chapters,
          scenes: Array.from({ length: 12 }, (_, i) => ({
            id: 'scene-' + i,
            kind: i % 4 === 0 ? 'title' : 'action',
            chapter: Math.floor(i / 4),
            source_id: 'v01',
            heading:
              i % 4 === 0
                ? chapters[Math.floor(i / 4)]
                : '操作步骤-' + 'unbroken-long-heading-'.repeat(8),
            source_start: 0,
            source_end: 1,
            hold_at: 0.5,
            narration: '请检查界面文字与操作结果。'.repeat(8),
            evidence: 'https://example.test/' + 'long-evidence-without-spaces-'.repeat(30),
            min_view_seconds: 1,
            silent_tail_seconds: 0.5,
          })),
        },
        project.sources,
      ),
    );
    project.progress = {
      stage: '等待人工确认',
      percent: 100,
      streamText: JSON.stringify({ analysis: 'very-long-value-'.repeat(100) }, null, 2),
    };
    project.review = {
      summary: '复核提示：' + 'https://example.test/'.repeat(40),
      issues: [
        {
          scene: 'scene-1',
          severity: 'warning',
          message: '请核对：' + 'unbroken-review-message-'.repeat(25),
        },
      ],
    };
    project.chat = [
      { role: 'user', text: 'https://example.test/' + 'u'.repeat(500) },
      { role: 'assistant', text: '已调整脚本。' + 'a'.repeat(500) },
    ];
    await studio.store.save(project);
    ipcMain.handle('yakcool-login', () => {
      account.signIn();
      return { opened: true };
    });
    ipcMain.handle('pick-video', () => [file, secondFile]);
    window = new BrowserWindow({
      show: false,
      width: 1520,
      height: 980,
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
    await window.webContents.debugger.attach('1.3');
    window.webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Runtime.exceptionThrown') exceptions.push(params.exceptionDetails);
    });
    await window.webContents.debugger.sendCommand('Runtime.enable');
    await waitFor('!!document.querySelector(".feature-guide")', 'first-launch feature Bento');
    for (const [w, h, z] of [
      [1520, 980, 1],
      [1080, 720, 1.5],
      [375, 667, 1],
    ]) {
      await viewport(w, h, z);
      await audit('guide-first-' + w + '-' + z, true);
      await reachable('.guide-start');
      await click('[data-guide-feature="import"]');
      await audit('guide-detail-' + w + '-' + z, true);
      await reachable('.guide-feature-action');
      await click('.guide-back');
    }
    await click('.guide-dismiss');
    await waitFor('!!document.querySelector(".yakcool-login-screen")', 'login');
    for (const [w, h, z] of [
      [1520, 980, 1],
      [1080, 720, 1.5],
      [375, 667, 1],
    ]) {
      await viewport(w, h, z);
      await audit('login-' + w + '-' + z, true);
    }
    await click('.yakcool-login-card button');
    await waitFor('!!document.querySelector(".model-update-notice")', 'required model update');
    for (const [w, h, z] of [
      [1520, 980, 1],
      [1080, 720, 1.5],
      [375, 667, 1],
    ]) {
      await viewport(w, h, z);
      await audit('required-model-update-' + w + '-' + z, true);
      await reachable('.settings-footer-actions button:last-child');
    }
    await click('.settings-footer-actions button:last-child');
    await waitFor('!document.querySelector(".model-dialog")', 'confirm model policy');
    await waitFor('!!document.querySelector(".filmstrip")', 'project');
    await click('.branding-project-bar button');
    await waitFor('!!document.querySelector(".branding-dialog")', 'advertising settings');
    await click('.branding-dialog .branding-card:last-child .branding-toggle input');
    await setField('.branding-dialog input[placeholder^="例如：YAKCOOL"]', 'YAKCOOL · example.com');
    await click('.branding-dialog .dialog-footer button:last-child');
    await waitFor('!document.querySelector(".branding-dialog")', 'advertising saved');
    assert.equal(project.branding.watermark.text, 'YAKCOOL · example.com');
    assert.equal(project.branding.watermark.enabled, true);
    assert.equal(project.approval, null);
    const layouts = process.argv.includes('--quick')
      ? [[1520, 980, 1]]
      : [
          [1520, 980, 1],
          [1280, 800, 1],
          [1080, 720, 1],
          [1280, 800, 1.25],
          [1080, 720, 1.5],
          [1920, 720, 1.5],
          [375, 667, 1],
        ];
    for (const [w, h, z] of layouts) {
      const suffix = w + '-' + z;
      console.log('UI layout: ' + suffix);
      await viewport(w, h, z);
      await click('button[aria-label="功能导览"]');
      await audit('guide-reopen-' + suffix, true);
      await click('[data-guide-feature="chat"]');
      await audit('guide-chat-' + suffix);
      await click('.guide-dismiss');
      await waitFor('!document.querySelector(".feature-guide")', 'return to workbench');
      await tab('剧本');
      await click('.filmstrip button:nth-child(5)');
      await audit('title-card-' + suffix, true);
      await click('.filmstrip button:nth-child(2)');
      if (!(await evaluate('!!document.querySelector(".advanced-scene")')))
        await click('.scene-editor-actions .text-control');
      await audit('storyboard-' + suffix, true);
      await click('.branding-project-bar button');
      for (const index of [1, 2])
        await click(
          '.branding-dialog .branding-card:nth-of-type(' + index + ') .branding-toggle input',
        );
      await setField('.branding-dialog input[aria-label="片头广告素材文件路径"]', file);
      await setField(
        '.branding-dialog input[aria-label="片尾广告素材文件路径"]',
        'C:/品牌海报/' + '很长的广告文件名称-'.repeat(20) + '.png',
      );
      await setField(
        '.branding-dialog input[placeholder^="例如：YAKCOOL"]',
        '品牌名称与推广网址 example.com/'.repeat(4),
      );
      await audit('branding-text-' + suffix, true);
      await click('.branding-dialog [data-layout="corner"]');
      await audit('branding-corner-' + suffix);
      await click('.branding-dialog [data-layout="tiled"]');
      await click('.branding-dialog [data-preset="subtle"]');
      await setField('.branding-dialog input[aria-label="倾斜角度"]', '-30');
      await waitFor(
        'document.querySelector(".watermark-preview-panel").getAttribute("aria-busy")==="false"',
        'full-screen watermark preview',
      );
      await audit('branding-tiled-' + suffix, true);
      await evaluate(`(() => {
        const el=document.querySelector('.branding-dialog .branding-card:last-child select');
        el.value='image';el.dispatchEvent(new Event('change',{bubbles:true}));
      })()`);
      await setField(
        '.branding-dialog input[aria-label="水印 Logo文件路径"]',
        'C:/品牌素材/' + 'transparent-logo-'.repeat(20) + '.png',
      );
      await audit('branding-logo-' + suffix);
      await reachable('.branding-dialog .dialog-footer button:last-child');
      await closeDialog();
      await click('button[aria-label="导出比例与画布"]');
      await waitFor('!!document.querySelector(".export-dialog")', 'export canvas');
      await click('[data-export-aspect="16:9"]');
      await waitFor(
        'document.querySelector(".export-preview-screen")?.getAttribute("aria-busy")==="false"',
        'landscape canvas',
      );
      await audit('export-landscape-' + suffix, true);
      await click('[data-export-aspect="9:16"]');
      await waitFor(
        'document.querySelector(".export-preview-screen")?.getAttribute("aria-busy")==="false"',
        'portrait canvas',
      );
      await audit('export-portrait-' + suffix, true);
      await click('.export-preview-tabs button:last-child');
      await waitFor(
        'document.querySelector(".export-preview-screen")?.getAttribute("aria-busy")==="false"',
        'transition canvas',
      );
      await audit('export-transition-' + suffix);
      await click('[data-export-aspect="1:1"]');
      await audit('export-square-' + suffix);
      await reachable('.export-dialog .dialog-footer button:last-child');
      await closeDialog();
      await click('.context-card button');
      await audit('knowledge-' + suffix);
      await reachable('.knowledge-dialog .dialog-footer button:last-child');
      await closeDialog();
      await click('button[aria-label="模型与制作设置"]');
      await audit('settings-' + suffix, true);
      await click('.model-picker-input input');
      await audit('model-picker-' + suffix, true);
      await evaluate(
        'document.querySelector(".model-picker input").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))',
      );
      await pause(220);
      assert(
        await evaluate('!!document.querySelector(".model-dialog")'),
        'Escape closes autocomplete without dismissing settings',
      );
      await reachable('.settings-footer button');
      await audit('settings-footer-' + suffix);
      await closeDialog();
      await tab('JSON');
      await audit('json-' + suffix);
      await setField('.json-editor', JSON.stringify(project.script, null, 2) + ' ');
      await audit('unsaved-json-' + suffix);
      await setField('.json-editor', JSON.stringify(project.script, null, 2));
      await tab('制作记录');
      await evaluate('document.querySelector(".stream-details").open=true');
      await audit('activity-' + suffix);
      project.error = 'https://example.test/' + 'e'.repeat(300);
      studio.engine.publish(project);
      await waitFor('!!document.querySelector(".failure-panel")', 'task error');
      await audit('task-error-' + suffix);
      project.error = null;
      project.review.issues[0].severity = 'blocking';
      studio.engine.publish(project);
      await waitFor('!!document.querySelector(".review-notice.needs-review")', 'blocking review');
      await audit('blocking-review-' + suffix);
      project.review.issues[0].severity = 'warning';
      project.job = { label: '生成初稿', startedAt: new Date().toISOString() };
      project.status = 'working';
      studio.engine.publish(project);
      await waitFor(
        '!!document.querySelector(".conversation-pane .stream-code")',
        'streamed model output',
      );
      await audit('streaming-' + suffix);
      project.job = null;
      project.status = 'review';
      studio.engine.publish(project);
      await waitFor('!document.querySelector(".conversation-pane .stream-code")', 'idle project');
      await tab('视频');
      await audit('source-video-' + suffix);
      await tab('剧本');
      await click('.expand-preview');
      await audit('fullscreen-' + suffix);
      await closeDialog();
      await click('.next-action button');
      await waitFor('!!document.querySelector(".approval-dialog")', 'approval');
      await audit('approval-' + suffix);
      await click('.approval-dialog button[aria-expanded]');
      await audit('approval-expanded-' + suffix, true);
      await evaluate('document.querySelector(".approval-dialog pre").scrollTop=10000');
      await audit('approval-details-scrolled-' + suffix);
      await reachable('.approval-dialog section button:last-child');
      await closeDialog();
      if (
        await evaluate(
          'getComputedStyle(document.querySelector(".mobile-view-switch")).display!=="none"',
        )
      ) {
        await click('.mobile-view-switch button:first-child');
        await audit('chat-' + suffix);
        await click('.mobile-view-switch button:nth-child(2)');
      }
      if (
        await evaluate(
          'getComputedStyle(document.querySelector(\'button[aria-label="打开教程与账户菜单"]\')).display!=="none"',
        )
      ) {
        await evaluate(
          'document.querySelector(\'button[aria-label="打开教程与账户菜单"]\').dispatchEvent(new PointerEvent("pointerdown",{button:0,ctrlKey:false,bubbles:true,pointerType:"mouse"}))',
        );
        await waitFor(
          '!!document.querySelector("[data-slot=dropdown-menu-content]")',
          'project menu',
        );
        await audit('project-menu-' + suffix, true);
        assert(
          await evaluate(
            'document.querySelector(".project-menu").innerText.includes("退出 YAKCOOL 账户")',
          ),
        );
        account.balance = 22.75;
        await evaluate(
          '[...document.querySelectorAll(".project-menu [data-slot=dropdown-menu-item]")].find(el=>el.textContent.includes("刷新账户余额")).click()',
        );
        await waitFor(
          'document.querySelector(".project-menu-account").innerText.includes("¥22.75")',
          'compact account balance refresh',
        );
        account.balance = 12.5;
        await evaluate(
          '[...document.querySelectorAll(".project-menu [data-slot=dropdown-menu-item]")].find(el=>el.textContent.includes("刷新账户余额")).click()',
        );
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await pause();
      }
      await evaluate('document.querySelector(".new-project-button").click()');
      await waitFor('!!document.querySelector(".video-dropzone")', 'import');
      while (
        await evaluate('!!document.querySelector(".video-import-list button[aria-label^=移除]")')
      )
        await click('.video-import-list button[aria-label^=移除]');
      await click('.video-dropzone');
      await waitFor('!!document.querySelector(".video-import-list li")', 'import files');
      await waitFor(
        '!document.querySelector(".import-summary")?.innerText.includes("正在检查")',
        'import preflight',
      );
      await audit('import-' + suffix, true);
      await click('.import-panel .branding-panel summary');
      await waitFor(
        '!!document.querySelector(".import-panel .branding-fields")',
        'optional advertising inputs',
      );
      await audit('import-branding-' + suffix, true);
      await click('.import-panel .branding-panel summary');
      await setField('#tutorial-title', 'long-tutorial-name-'.repeat(30));
      await setField('#tutorial-knowledge', 'https://example.test/' + 'long-note-'.repeat(100));
      await audit('import-long-text-' + suffix);
      await evaluate(
        `document.querySelector('.mobile-view-switch select').value=${JSON.stringify(project.id)};document.querySelector('.mobile-view-switch select').dispatchEvent(new Event('change',{bubbles:true}))`,
      );
      await waitFor('!!document.querySelector(".filmstrip")', 'return project');
    }
    // Export controls use a synthetic output record; real encoding is covered by test:desktop.
    project.output = {
      revision: project.revision,
      path: file,
      dir: temp,
      plan: schedule(project.script, Array(12).fill(1), studio.store.config.style),
      verification: { passed: true, duration: 2, canvas: { width: 320, height: 180 } },
    };
    project.status = 'done';
    await studio.store.save(project);
    studio.engine.publish(project);
    for (const [w, h, z] of [
      [1080, 720, 1],
      [1080, 720, 1.5],
      [375, 667, 1],
    ]) {
      await viewport(w, h, z);
      await tab('视频');
      await click('.segmented button:nth-child(2)');
      await audit('export-' + w + '-' + z, true);
    }
    assert.deepEqual(exceptions, [], 'Renderer exceptions');
    const report = { passed: failures.length === 0, checks: results.length, results, failures };
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        { passed: report.passed, checks: report.checks, failures: failures.length, artifacts },
        null,
        2,
      ),
    );
    assert.equal(failures.length, 0, 'UI layout issues remain; see report.json');
  } catch (error) {
    code = 1;
    console.error(stage + ': ' + error.stack);
    if (window && !window.isDestroyed()) await capture('failure-last');
  } finally {
    clearTimeout(watchdog);
    window?.destroy();
    studio?.close();
    if (temp && path.dirname(path.resolve(temp)) === path.resolve(os.tmpdir()))
      await fs
        .rm(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
        .catch(() => {});
    app.exit(code);
  }
});
