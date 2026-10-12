const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('tutorDesktop',{
  pickVideo:()=>ipcRenderer.invoke('pick-video'),
  pickKnowledge:()=>ipcRenderer.invoke('pick-knowledge'),
  revealOutput:id=>ipcRenderer.invoke('reveal-output',String(id)),
  saveVideo:id=>ipcRenderer.invoke('save-video',String(id))
});
