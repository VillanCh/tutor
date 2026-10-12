const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Store}=require('./store.cjs'),{Engine}=require('./engine.cjs');
const args=process.argv.slice(2),command=args.shift();
function option(name,fallback=''){const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];}
(async()=>{
  const dataDir=path.resolve(option('data',process.env.TUTOR_DATA_DIR||path.join(os.homedir(),'.tutor')));
  if(command==='studio'){const s=await require('./server.cjs').startServer({dataDir,port:Number(option('port','0'))});console.log(s.url);return;}
  const store=new Store(dataDir);await store.init();const engine=new Engine(store);let printed='';
  engine.on('project',p=>{const text=p.progress.stage+' '+Math.round(p.progress.percent)+'%';if(text!==printed){console.log(text);printed=text;}});
  if(command==='prepare'){
    const source=option('video');if(!source)throw Error('Usage: prepare --video file.mp4 [--knowledge facts.txt] [--data directory]');
    const knowledge=option('knowledge')?await fs.readFile(option('knowledge'),'utf8'):'';
    const p=await store.create(source,knowledge,option('title'));await engine.prepare(p.id);
    console.log(JSON.stringify({id:p.id,script:path.join(store.dir(p.id),'script.json'),hash:require('./script.cjs').scriptHash(p.script),status:'awaiting human approval'},null,2));return;
  }
  const id=option('project');if(!id)throw Error('Please supply --project UUID');
  if(command==='approve'){await engine.confirm(id,option('hash'));console.log('Human approval recorded');return;}
  if(command==='render'){const p=await engine.generate(id);console.log(p.output.path);return;}
  throw Error('Commands: studio, prepare, approve, render');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
