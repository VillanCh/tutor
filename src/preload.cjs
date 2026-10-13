const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('tutorDesktop', {
  platform: process.platform,
  pickVideo: () => ipcRenderer.invoke('pick-video'),
  videoFilePath: (file) => webUtils.getPathForFile(file),
  pickKnowledge: () => ipcRenderer.invoke('pick-knowledge'),
  revealOutput: (id) => ipcRenderer.invoke('reveal-output', String(id)),
  saveVideo: (id) => ipcRenderer.invoke('save-video', String(id)),
});
