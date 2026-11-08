const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, Menu } = require('electron');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  { startServer } = require('./server.cjs');
const { YakcoolAccount } = require('./yakcool.cjs');
const { createLoginLauncher } = require('./yakcool-login.cjs');
let studio, window;
app.setName('Tutor');
if (process.platform === 'win32') app.setAppUserModelId('com.yaklang.tutor');
app.commandLine.appendSwitch('force-renderer-accessibility');
app
  .whenReady()
  .then(async () => {
    if (process.platform === 'darwin') app.dock.setIcon(path.join(__dirname, '../build/tutor.png'));
    const smokeIndex = process.argv.indexOf('--smoke-test');
    if (smokeIndex !== -1) {
      const reportFile = process.argv[smokeIndex + 1];
      if (!reportFile) throw Error('Smoke test requires a report path');
      try {
        await require('./smoke.cjs')(reportFile, app.getVersion());
        app.exit(0);
      } catch (error) {
        await fs.writeFile(reportFile, JSON.stringify({ passed: false, error: error.message }));
        app.exit(1);
      }
      return;
    }
    const homeFile = path.join(app.getPath('userData'), 'data-location.json');
    let savedRoot;
    try {
      savedRoot = JSON.parse(await fs.readFile(homeFile, 'utf8')).dataDir;
    } catch {}
    const root =
        process.env.TUTOR_DATA_DIR || savedRoot || path.join(app.getPath('userData'), 'workspaces'),
      sessionFile = path.join(app.getPath('userData'), 'yakcool-session.bin');
    let sessionWrites = Promise.resolve();
    const sessionIO = {
      async load() {
        try {
          return JSON.parse(safeStorage.decryptString(await fs.readFile(sessionFile)));
        } catch {
          return {};
        }
      },
      save(cookie) {
        sessionWrites = sessionWrites
          .catch(() => {})
          .then(async () => {
            if (
              !safeStorage.isEncryptionAvailable() ||
              (process.platform === 'linux' &&
                safeStorage.getSelectedStorageBackend() === 'basic_text')
            )
              throw Error('系统安全存储不可用，请启用系统钥匙串后重新登录');
            await fs.mkdir(path.dirname(sessionFile), { recursive: true });
            await fs.writeFile(
              sessionFile + '.tmp',
              safeStorage.encryptString(JSON.stringify(cookie)),
            );
            await fs.rename(sessionFile + '.tmp', sessionFile);
          });
        return sessionWrites;
      },
      clear() {
        sessionWrites = sessionWrites
          .catch(() => {})
          .then(() => fs.rm(sessionFile, { force: true }));
        return sessionWrites;
      },
    };
    const account = new YakcoolAccount({ sessionIO });
    studio = await startServer({ dataDir: root, account });
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(homeFile, JSON.stringify({ dataDir: root }));
    Menu.setApplicationMenu(null);
    window = new BrowserWindow({
      show: false,
      width: 1520,
      height: 980,
      minWidth: 1080,
      minHeight: 720,
      title: 'Tutor · 教学视频工作台',
      icon: path.join(__dirname, '../build/tutor.png'),
      backgroundColor: '#14161c',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#14161c', symbolColor: '#e8ebf0', height: 58 },
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(studio.url + '/')) event.preventDefault();
    });
    window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false),
    );
    const local = (event) => {
      if (!event.senderFrame.url.startsWith(studio.url + '/')) throw Error('无效调用来源');
    };
    const login = createLoginLauncher(account, window);
    ipcMain.handle('yakcool-login', async (event) => {
      local(event);
      login().catch(() => account.cancelLogin('无法加载 YAKCOOL 登录页面，请检查网络后重试。'));
      return { opened: true };
    });
    ipcMain.handle('pick-video', async (event) => {
      local(event);
      await account.requireLogin();
      const r = await dialog.showOpenDialog(window, {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '视频', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }],
      });
      return r.canceled ? null : r.filePaths;
    });
    ipcMain.handle('pick-branding', async (event, kind) => {
      local(event);
      await account.requireLogin();
      if (!['intro', 'outro', 'watermark'].includes(kind)) throw Error('素材类型无效');
      const r = await dialog.showOpenDialog(window, {
        title: { intro: '选择片头广告', outro: '选择片尾广告', watermark: '选择水印 Logo' }[kind],
        properties: ['openFile'],
        filters: [
          {
            name: kind === 'watermark' ? 'Logo 图片' : '广告视频或图片',
            extensions:
              kind === 'watermark'
                ? ['png', 'jpg', 'jpeg', 'webp']
                : ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'png', 'jpg', 'jpeg', 'webp'],
          },
        ],
      });
      return r.canceled ? null : r.filePaths;
    });
    ipcMain.handle('pick-knowledge', async (event) => {
      local(event);
      await account.requireLogin();
      const r = await dialog.showOpenDialog(window, {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '知识资料', extensions: ['txt', 'md', 'json', 'docx'] }],
      });
      if (r.canceled) return null;
      let text = '';
      for (const file of r.filePaths) {
        const stat = await fs.stat(file);
        if (stat.size > 5 * 1024 * 1024) throw Error('知识文件超过 5 MB');
        const value =
          path.extname(file).toLowerCase() === '.docx'
            ? (await require('mammoth').extractRawText({ path: file })).value
            : await fs.readFile(file, 'utf8');
        text += '\n资料 ' + path.basename(file) + '\n' + value;
      }
      if (text.length > studio.store.config.limits.maxKnowledgeChars) throw Error('知识内容过长');
      return text;
    });
    ipcMain.handle('reveal-output', async (event, id) => {
      local(event);
      await account.requireLogin();
      const p = studio.store.get(id);
      await shell.openPath(p.output?.dir || studio.store.dir(id));
      return true;
    });
    ipcMain.handle('save-video', async (event, id) => {
      local(event);
      await account.requireLogin();
      const p = studio.store.get(id);
      if (!p.output) throw Error('尚未生成视频');
      const r = await dialog.showSaveDialog(window, {
        defaultPath: 'Tutor_' + p.title + '.mp4',
        filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
      });
      if (r.canceled) return false;
      await fs.copyFile(p.output.path, r.filePath);
      return true;
    });
    await window.loadURL(studio.url + '/');
    window.show();
    window.focus();
    await fs.writeFile(
      path.join(root, 'runtime.json'),
      JSON.stringify({ url: studio.url, pid: process.pid }, null, 2),
    );
  })
  .catch((error) => {
    dialog.showErrorBox('Tutor 启动失败', error.message);
    app.quit();
  });
app.on('window-all-closed', () => {
  if (!process.argv.includes('--smoke-test')) app.quit();
});
app.on('before-quit', () => studio?.close());
