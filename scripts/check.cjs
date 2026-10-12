const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const f of [...files('src'),...files('scripts'),...files('test')].filter(f=>/\.(cjs|js)$/.test(f))){const r=spawnSync(process.execPath,['--check',f],{stdio:'inherit'});if(r.status!==0)process.exit(r.status);}
console.log('All JavaScript syntax checks passed');
