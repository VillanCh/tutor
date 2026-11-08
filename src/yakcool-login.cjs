const { BrowserWindow, session, shell } = require('electron');
const crypto = require('node:crypto');
const { ORIGIN, COOKIE, validCookie, loginURLAllowed } = require('./yakcool.cjs');

function createLoginLauncher(account, parent, { visible = true } = {}) {
  let loginWindow,
    loadFailed = false;
  return async function openLogin() {
    if (loginWindow && !loginWindow.isDestroyed()) {
      if (visible) {
        loginWindow.show();
        loginWindow.focus();
      }
      if (loadFailed) {
        loadFailed = false;
        await loginWindow.loadURL(ORIGIN + '/login');
      }
      return;
    }
    const isolated = session.fromPartition('tutor-yakcool-' + crypto.randomUUID());
    isolated.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    isolated.on('will-download', (event) => event.preventDefault());
    // The login renderer never receives the account's API-key responses.
    isolated.webRequest.onBeforeRequest(
      { urls: [ORIGIN + '/api/user/api-keys*'] },
      (_details, callback) => callback({ cancel: true }),
    );
    const window = new BrowserWindow({
      parent,
      show: false,
      width: 880,
      height: 820,
      minWidth: 680,
      minHeight: 550,
      title: 'Tutor · YAKCOOL 官方扫码登录',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        session: isolated,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: false,
      },
    });
    loginWindow = window;
    loadFailed = false;
    account.signingIn();
    let timer,
      checking = false,
      rejected = '',
      retryAfter = 0;
    const inspect = async () => {
      if (checking || window.isDestroyed()) return;
      checking = true;
      try {
        const cookies = await isolated.cookies.get({ url: ORIGIN, name: COOKIE });
        const cookie = cookies.find(validCookie);
        if (!cookie || (cookie.value === rejected && Date.now() < retryAfter)) return;
        try {
          await account.login(cookie);
          if (!window.isDestroyed()) window.close();
        } catch {
          rejected = cookie.value;
          retryAfter = Date.now() + 8000;
        }
      } finally {
        checking = false;
      }
    };
    window.webContents.on('will-navigate', (event, url) => {
      if (!loginURLAllowed(url)) event.preventDefault();
    });
    window.webContents.on('will-redirect', (event, url) => {
      if (!loginURLAllowed(url)) event.preventDefault();
    });
    window.webContents.on('context-menu', (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url === ORIGIN + '/user-agreement') {
        shell.openExternal(url).catch(() => {});
        return { action: 'deny' };
      }
      if (loginURLAllowed(url)) window.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });
    window.webContents.on('did-finish-load', () => inspect().catch(() => {}));
    window.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame) loadFailed = true;
    });
    window.on('closed', () => {
      clearInterval(timer);
      loginWindow = null;
      account.cancelLogin();
      isolated.clearStorageData().catch(() => {});
    });
    timer = setInterval(() => inspect().catch(() => {}), 1000);
    if (visible) window.show();
    await window.loadURL(ORIGIN + '/login');
  };
}
module.exports = { createLoginLauncher };
