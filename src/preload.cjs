const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('tutorDesktop', {
  platform: process.platform,
  loginYakcool: () => ipcRenderer.invoke('yakcool-login'),
  pickVideo: () => ipcRenderer.invoke('pick-video'),
  pickBranding: (kind) => ipcRenderer.invoke('pick-branding', kind),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  pickKnowledge: () => ipcRenderer.invoke('pick-knowledge'),
  revealOutput: (id) => ipcRenderer.invoke('reveal-output', String(id)),
  saveVideo: (id) => ipcRenderer.invoke('save-video', String(id)),
});
