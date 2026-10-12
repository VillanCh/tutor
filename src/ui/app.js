const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const token=$('meta[name=tutor-token]').content,welcomeHtml=$('#script-content').innerHTML;let projects=[],current=null,configState=null,displayRevision='',selectedVideo='source';
async function api(url,data){const res=await fetch(url,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Tutor-Token':token},body:JSON.stringify(data)}),j=await res.json();if(!res.ok)throw Error(j.error||'请求失败');return j;}
function error(e){$('#error').hidden=false;$('#error').textContent=e.message||e;if($('#settings').open)$('#settings-result').textContent=e.message||e;}
function perform(fn){return async()=>{try{$('#error').hidden=true;await fn();}catch(e){error(e);}};}
function endpoint(action){if(!current)throw Error('请先创建项目');return '/api/projects/'+current.id+'/'+action;}
function clock(t){return String(Math.floor(t/60)).padStart(2,'0')+':'+String(Math.floor(t)%60).padStart(2,'0');}
function status(p){return p.job?'进行中':({draft:'等待初稿',review:'等待人工确认',approved:'已确认',done:'已完成'}[p.status]||p.status);}
function showProject(p){
  const changed=current?.id!==p.id,wasRendering=current?.job?.label==='生成旁白与视频';current=p;
  if(wasRendering&&p.status==='done')selectedVideo='output';
  if(changed){$('#source').value=p.source;$('#knowledge').value=p.knowledge;displayRevision='';$('#human-check').checked=false;selectedVideo='source';}
  $('#project-title').textContent=p.title;$('#status').textContent=status(p);
  $('#tokens-in').textContent=p.totals.input.toLocaleString();$('#tokens-out').textContent=p.totals.output.toLocaleString();
  $('#stream-count').textContent=p.job&&p.progress.streamEstimate?'当前生成约 '+p.progress.streamEstimate+' Token（估计）':'';
  $('#traffic').textContent=(p.totals.sent/1048576).toFixed(2)+' / '+(p.totals.received/1048576).toFixed(2)+' MB';
  $('#cost').textContent='¥'+p.totals.cost.toFixed(4);$('#unpriced').textContent=p.totals.unpriced?p.totals.unpriced+' 次调用用量未知':'';
  $('#stage').textContent=p.progress.stage;$('#progress').value=p.progress.percent;$('#progress-value').textContent=Math.round(p.progress.percent)+'%';
  $('#stream').textContent=p.progress.streamText||'模型开始生成后，内容会实时显示在这里。';
  $('#chat').innerHTML=p.chat.map(c=>'<div class="bubble '+esc(c.role)+'"><div class="role">'+(c.role==='user'?'你':'TUTOR')+'</div>'+esc(c.text)+'</div>').join('')||'<p class="empty">初稿生成后，在这里提出修改要求。</p>';
  const key=p.id+':'+p.revision;
  if(displayRevision!==key){displayRevision=key;$('#human-check').checked=false;renderScript();$('#json-editor').value=p.script?JSON.stringify(p.script,null,2):'';}
  const doneStages=new Set(p.history.map(x=>x.stage.split('-')[0]));
  for(const [id,done]of [['draft',doneStages.has('initial')],['max',doneStages.has('max')],['audit',doneStages.has('audit')],['human',Boolean(p.approval)],['render',p.status==='done']])$('#step-'+id).className=done?'done':'';
  $('#approve-render').disabled=!p.script||Boolean(p.job)||!$('#human-check').checked||p.review?.issues?.some(i=>i.severity==='blocking');
  $('#approval-state').textContent=p.approval?'当前版本已确认':'第 '+p.revision+' 版尚未确认';
  for(const id of ['prepare','edit','save-script','save-json','save-knowledge'])$('#'+id).disabled=Boolean(p.job)||(id!=='prepare'&&id!=='save-knowledge'&&!p.script);
  $('#cancel').disabled=!p.job;$('#show-output').disabled=!p.output;
  if(p.error)error(p.error);
  $('#usage').innerHTML=p.usage.map(u=>'<tr><td>'+esc(u.stage)+'<small>'+esc(u.model)+'</small></td><td>'+u.input_tokens+'</td><td>'+u.output_tokens+'</td><td>'+((u.sent_bytes+u.received_bytes)/1048576).toFixed(3)+'</td><td>'+(u.estimated_cny==null?'未知':u.estimated_cny.toFixed(5))+'</td></tr>').join('');
  renderExports();videoUrl();
}
function renderScript(){
  const p=current;$('#revision').textContent='第 '+p.revision+' 版 · '+(p.script?.scenes.length||0)+' 个分镜';
  $('#review').innerHTML=p.review?'<p class="review-summary">'+esc(p.review.summary)+'</p>'+(p.review.issues||[]).map(i=>'<div class="review-issue">'+esc(i.scene)+' · '+esc(i.message)+'</div>').join(''):'';
  if(!p.script)return;
  $('#script-content').innerHTML=p.script.scenes.map((s,i)=>{
    const t=s.source_start??s.freeze_at,thumb=t==null?'<div class="thumb"></div>':'<img class="thumb" data-seek="'+t+'" src="/api/projects/'+p.id+'/frame?t='+Math.min(t,p.info.duration-.04)+'" loading="lazy">';
    const timing=s.source_start!=null?'<div class="time-row">源片段 <input data-index="'+i+'" data-field="source_start" type="number" min="0" max="'+p.info.duration+'" step=".1" value="'+s.source_start+'">—<input data-index="'+i+'" data-field="source_end" type="number" min="0" max="'+p.info.duration+'" step=".1" value="'+s.source_end+'"> 秒</div>':s.freeze_at!=null?'<div class="time-row">定格 <input data-index="'+i+'" data-field="freeze_at" type="number" min="0" max="'+p.info.duration+'" step=".1" value="'+s.freeze_at+'"> 秒</div>':'<div class="time-row">章节标题卡</div>';
    return '<div class="scene '+s.kind+'"><div>'+thumb+'<div class="kind">'+esc(s.id)+' / '+({title:'章节标题',action:'教程操作',observe:'观察与讲解'}[s.kind])+'</div></div><div><input class="heading" data-index="'+i+'" data-field="heading" value="'+esc(s.heading)+'">'+timing+'<textarea data-index="'+i+'" data-field="narration" placeholder="留空表示无声观察">'+esc(s.narration)+'</textarea><div class="evidence">'+esc(s.evidence||s.keep_reason)+'</div>'+(s.uncertainty?'<div class="review-issue">'+esc(s.uncertainty)+'</div>':'')+'</div></div>';
  }).join('');
  document.querySelectorAll('[data-seek]').forEach(el=>el.onclick=()=>{selectedVideo='source';selectTab('video');videoUrl();$('#video').currentTime=Number(el.dataset.seek);});
}
function renderExports(){
  if(!current.output)return;
  const files=[['tutorial.mp4','完整教学视频','MP4'],['subtitles.srt','教学字幕','SRT'],['script.json','定稿剧本','JSON'],['edit-plan.json','实际剪辑时间表','JSON'],['cost.json','调用与费用记录','JSON'],['verification.json','成片验证','JSON']];
  $('#exports').innerHTML=files.map(([file,label,type])=>'<a href="/api/projects/'+current.id+'/output?file='+file+'" download="'+file+'">'+label+'<small>'+type+'</small></a>').join('')+'<button id="open-output">打开输出文件夹</button><button id="save-video">另存为视频</button>';
  $('#open-output').onclick=perform(async()=>window.tutorDesktop?window.tutorDesktop.revealOutput(current.id):alert(current.output.dir));
  $('#save-video').onclick=perform(async()=>window.tutorDesktop?window.tutorDesktop.saveVideo(current.id):$('#exports a').click());
}
function videoUrl(){
  if(!current)return;const url='/api/projects/'+current.id+'/'+selectedVideo;
  if($('#video').getAttribute('src')!==url)$('#video').src=url;
  $('#video-caption').textContent=selectedVideo==='source'?'原始 '+clock(current.info.duration):'成片 '+clock(current.output?.verification.duration||0);
  $('#video-chapters').innerHTML=selectedVideo==='output'&&current.output?current.output.plan.chapters_timed.map(c=>'<button data-final-seek="'+c.start+'">'+esc(c.title)+'</button>').join(''):'';
  document.querySelectorAll('[data-final-seek]').forEach(b=>b.onclick=()=>{$('#video').currentTime=Number(b.dataset.finalSeek);});
}
function selectTab(name){document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id==='tab-'+name));}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>selectTab(b.dataset.tab));
function updateSelector(){const id=current?.id;$('#project-select').innerHTML='<option value="">选择创作项目</option>'+projects.map(p=>'<option value="'+p.id+'">'+esc(p.title)+'</option>').join('');$('#project-select').value=id||'';}
$('#project-select').onchange=()=>{const p=projects.find(p=>p.id===$('#project-select').value);if(p)showProject(p);};
$('#new-project').onclick=()=>{current=null;displayRevision='';$('#source').value='';$('#knowledge').value='';$('#project-title').textContent='新的教程创作';$('#script-content').innerHTML=welcomeHtml;$('#json-editor').value='';$('#review').innerHTML='';$('#human-check').checked=false;$('#approve-render').disabled=true;$('#project-select').value='';$('#source').focus();};
$('#choose-video').onclick=perform(async()=>{if(!window.tutorDesktop)throw Error('浏览器预览请填写本地视频路径；桌面应用支持文件选择');const file=await window.tutorDesktop.pickVideo();if(file){if(current&&file!==current.source)$('#new-project').click();$('#source').value=file;}});
$('#choose-knowledge').onclick=perform(async()=>{if(!window.tutorDesktop)throw Error('请直接粘贴知识文本');const text=await window.tutorDesktop.pickKnowledge();if(text)$('#knowledge').value+=text;});
$('#prepare').onclick=perform(async()=>{if(!current){current=await api('/api/projects',{source:$('#source').value,knowledge:$('#knowledge').value});projects.push(current);updateSelector();showProject(current);}else await api(endpoint('knowledge'),{knowledge:$('#knowledge').value});await api(endpoint('prepare'),{});});
$('#save-knowledge').onclick=perform(async()=>showProject(await api(endpoint('knowledge'),{knowledge:$('#knowledge').value})));
$('#edit').onclick=perform(async()=>{const message=$('#message').value.trim();if(!message)throw Error('请输入修改要求');await api(endpoint('edit'),{message});$('#message').value='';});
$('#cancel').onclick=perform(()=>api(endpoint('cancel'),{}));
$('#save-script').onclick=perform(async()=>{const s=structuredClone(current.script);document.querySelectorAll('[data-field]').forEach(el=>{s.scenes[Number(el.dataset.index)][el.dataset.field]=el.type==='number'?Number(el.value):el.value;});showProject(await api(endpoint('script'),{script:s}));});
$('#save-json').onclick=perform(async()=>showProject(await api(endpoint('script'),{script:JSON.parse($('#json-editor').value)})));
$('#copy-json').onclick=perform(()=>navigator.clipboard.writeText($('#json-editor').value));
$('#download-json').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([$('#json-editor').value],{type:'application/json'}));a.download='script.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
$('#human-check').onchange=()=>current&&showProject(current);
$('#approve-render').onclick=perform(async()=>{if(!$('#human-check').checked)throw Error('请先检查并确认剧本');await api(endpoint('approve'),{hash:current.scriptHash});await api(endpoint('render'),{});selectedVideo='source';selectTab('video');});
$('#show-source').onclick=()=>{selectedVideo='source';videoUrl();};$('#show-output').onclick=()=>{selectedVideo='output';videoUrl();};
$('#settings-open').onclick=perform(async()=>{
  configState=await api('/api/settings');const c=configState.config;$('#provider').value=c.provider;$('#api-key').value='';$('#key-state').textContent=configState.credentialStatus.default?'共享 Key 已配置':'共享 Key 尚未配置';
  $('#voice').value=c.speech.voice;$('#voice-rate').value=c.speech.rate;$('#voice-instruction').value=c.speech.instruction;
  $('#roles-settings').innerHTML=Object.entries(c.roles).map(([name,r])=>'<section class="role-settings" data-role="'+name+'"><h3>'+({vision:'01 视觉理解与校对',editor:'02 剧本改写与知识修订',speech:'03 旁白生成'}[name])+'</h3><div class="settings-grid"><label>模型 ID<input data-setting="model" value="'+esc(r.model)+'"></label><label>接口协议<select data-setting="protocol"><option value="openai-chat">OpenAI Chat</option><option value="dashscope-tts">百炼原生 TTS</option><option value="openai-speech">OpenAI Speech</option></select></label></div><label>接口地址<input data-setting="baseUrl" value="'+esc(r.baseUrl)+'"></label><div class="key-row"><label>Key 来源<select data-setting="credential"><option value="default">共享 Key</option><option value="'+name+'">独立 Key</option></select></label><label>独立 Key<input type="password" data-key="'+name+'" placeholder="留空保持已保存的值"></label></div><div class="price-row"><label>输入 元/百万 Token<input data-setting="inputPrice" type="number" step=".01" value="'+r.inputPrice+'"></label><label>输出 元/百万 Token<input data-setting="outputPrice" type="number" step=".01" value="'+r.outputPrice+'"></label><label>缓存输入 元/百万<input data-setting="cachedPrice" type="number" step=".01" value="'+r.cachedPrice+'"></label></div></section>').join('');
  for(const [name,r]of Object.entries(c.roles)){const el=$('[data-role="'+name+'"]');el.querySelector('[data-setting=protocol]').value=r.protocol;el.querySelector('[data-setting=credential]').value=r.credential;}
  $('#settings-result').textContent='';$('#settings').showModal();
});
$('#settings-close').onclick=()=>$('#settings').close();
$('#settings-save').onclick=perform(async()=>{
  const c=structuredClone(configState.config),keys={default:$('#api-key').value};c.provider=$('#provider').value;
  document.querySelectorAll('[data-role]').forEach(el=>{const name=el.dataset.role;el.querySelectorAll('[data-setting]').forEach(input=>{c.roles[name][input.dataset.setting]=input.type==='number'?Number(input.value):input.value;});keys[name]=el.querySelector('[data-key]').value;});
  c.speech.voice=$('#voice').value;c.speech.rate=Number($('#voice-rate').value);c.speech.instruction=$('#voice-instruction').value;
  configState=await api('/api/settings',{config:c,keys});$('#api-key').value='';document.querySelectorAll('[data-key]').forEach(el=>el.value='');$('#settings-result').textContent='已保存';$('#key-state').textContent=configState.credentialStatus.default?'共享 Key 已配置':'共享 Key 尚未配置';
});
$('#divider').onpointerdown=e=>{const el=e.target;el.setPointerCapture(e.pointerId);el.onpointermove=ev=>document.documentElement.style.setProperty('--left',Math.max(280,Math.min(560,ev.clientX))+'px');el.onpointerup=()=>{el.onpointermove=null;};};
const events=new EventSource('/api/events');events.onmessage=e=>{const p=JSON.parse(e.data),i=projects.findIndex(x=>x.id===p.id);if(i>=0)projects[i]=p;else projects.push(p);if(current?.id===p.id)showProject(p);updateSelector();};
perform(async()=>{projects=await api('/api/projects');updateSelector();if(projects.length)showProject(projects.at(-1));})();
