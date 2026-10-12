const {app,BrowserWindow,ipcMain,dialog,safeStorage,shell,Menu}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),{startServer}=require('./server.cjs');
let studio,window;
app.setName('Tutor');
app.whenReady().then(async()=>{
  const root=process.env.TUTOR_DATA_DIR||path.join(app.getPath('userData'),'workspaces'),credentialsFile=path.join(app.getPath('userData'),'credentials.bin');
  const credentialIO={
    async load(){try{return JSON.parse(safeStorage.decryptString(await fs.readFile(credentialsFile)));}catch{return {};}},
    async save(keys){if(!safeStorage.isEncryptionAvailable())throw Error('系统加密存储不可用，Key 仅支持当前会话环境变量');await fs.mkdir(path.dirname(credentialsFile),{recursive:true});await fs.writeFile(credentialsFile,safeStorage.encryptString(JSON.stringify(keys)));}
  };
  studio=await startServer({dataDir:root,credentialIO});
  if(process.env.QWEN_API_KEY)await studio.store.settings(studio.store.config,{default:process.env.QWEN_API_KEY});
  delete process.env.QWEN_API_KEY;
  Menu.setApplicationMenu(null);
  window=new BrowserWindow({show:false,width:1520,height:980,minWidth:1080,minHeight:720,title:'Tutor · 教学视频工作台',backgroundColor:'#F9F6EF',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(studio.url+'/'))event.preventDefault();});
  window.webContents.session.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  const local=(event)=>{if(!event.senderFrame.url.startsWith(studio.url+'/'))throw Error('无效调用来源');};
  ipcMain.handle('pick-video',async(event)=>{local(event);const r=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'视频',extensions:['mp4','mov','mkv','webm','avi']}]});return r.canceled?null:r.filePaths[0];});
  ipcMain.handle('pick-knowledge',async(event)=>{
    local(event);const r=await dialog.showOpenDialog(window,{properties:['openFile','multiSelections'],filters:[{name:'知识资料',extensions:['txt','md','json','docx']}]});if(r.canceled)return null;
    let text='';
    for(const file of r.filePaths){const stat=await fs.stat(file);if(stat.size>5*1024*1024)throw Error('知识文件超过 5 MB');const value=path.extname(file).toLowerCase()==='.docx'?(await require('mammoth').extractRawText({path:file})).value:await fs.readFile(file,'utf8');text+='\n资料 '+path.basename(file)+'\n'+value;}
    if(text.length>studio.store.config.limits.maxKnowledgeChars)throw Error('知识内容过长');return text;
  });
  ipcMain.handle('reveal-output',async(event,id)=>{local(event);const p=studio.store.get(id);await shell.openPath(p.output?.dir||studio.store.dir(id));return true;});
  ipcMain.handle('save-video',async(event,id)=>{local(event);const p=studio.store.get(id);if(!p.output)throw Error('尚未生成视频');const r=await dialog.showSaveDialog(window,{defaultPath:'Tutor_'+p.title+'.mp4',filters:[{name:'MP4 视频',extensions:['mp4']}]});if(r.canceled)return false;await fs.copyFile(p.output.path,r.filePath);return true;});
  await window.loadURL(studio.url+'/');window.show();window.focus();await fs.writeFile(path.join(root,'runtime.json'),JSON.stringify({url:studio.url,pid:process.pid},null,2));
}).catch(error=>{dialog.showErrorBox('Tutor 启动失败',error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());app.on('before-quit',()=>studio?.close());
