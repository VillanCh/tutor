// Loads the real official login entry without accepting terms or signing in.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { YakcoolAccount } = require('../src/yakcool.cjs');
const { createLoginLauncher } = require('../src/yakcool-login.cjs');
const artifacts = path.resolve(__dirname, '../build/generated/yakcool-login-smoke');
app.setName('Tutor YAKCOOL Login Check');
app.on('window-all-closed', () => {});
const watchdog = setTimeout(() => {
  console.error('YAKCOOL public login page timed out');
  app.exit(1);
}, 35000);
app.whenReady().then(async () => {
  let code = 0;
  try {
    await fs.mkdir(artifacts, { recursive: true });
    app.setPath('userData', path.join(artifacts, 'electron-data'));
    const parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    const account = new YakcoolAccount();
    await account.init();
    await createLoginLauncher(account, parent, { visible: false })();
    const login = BrowserWindow.getAllWindows().find((window) => window !== parent);
    assert(login);
    let ready;
    for (let i = 0; i < 40; i++) {
      ready = await login.webContents.executeJavaScript(
        "({title:document.title,qr:!!document.querySelector('#wx-login-container iframe,iframe[src*=weixin]'),consent:!!document.querySelector('input[type=checkbox],[role=checkbox]')&&document.body.innerText.includes('用户协议'),isLogin:location.pathname.includes('login')})",
      );
      if (ready.qr || ready.consent) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!ready.qr && !ready.consent) {
      console.error(
        await login.webContents.executeJavaScript(
          "JSON.stringify({url:location.origin+location.pathname,title:document.title,text:document.body.innerText.slice(0,4000),frames:[...document.querySelectorAll('iframe')].map(f=>f.src),scripts:[...document.scripts].filter(s=>s.src).map(s=>s.src)})",
        ),
      );
      await fs.writeFile(
        path.join(artifacts, 'failure.png'),
        (await login.webContents.capturePage()).toPNG(),
      );
    }
    assert.equal(ready.isLogin, true);
    assert(ready.qr || ready.consent, 'Official login entry did not load');
    assert.equal(account.public().authenticated, false);
    const preferences = login.webContents.getLastWebPreferences();
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.contextIsolation, true);
    login.webContents.openDevTools({ mode: 'detach' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(login.webContents.isDevToolsOpened(), false);
    assert(!preferences.preload);
    assert.equal(login.webContents.session.isPersistent(), false);
    const report = {
      passed: true,
      officialLoginPage: 'https://yakcool.com/login',
      loginEntryLoaded: true,
      qrFrameLoaded: ready.qr,
      agreementRequired: ready.consent,
      isolatedEphemeralSession: true,
      nodeIntegration: false,
      authenticated: false,
    };
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    code = 1;
    console.error(error.stack);
  } finally {
    clearTimeout(watchdog);
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    app.exit(code);
  }
});
