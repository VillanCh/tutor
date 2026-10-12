const fs=require('node:fs/promises'),path=require('node:path');
const {createCanvas,GlobalFonts}=require('@napi-rs/canvas');
const {FFMPEG,run,frame,pcm,wav,probe}=require('./media.cjs');
const {schedule}=require('./script.cjs');
const fontFiles=[['C:/Windows/Fonts/msyh.ttc','Tutor Sans'],['C:/Windows/Fonts/simsun.ttc','Tutor Serif'],['C:/Windows/Fonts/consola.ttf','Tutor Mono']];
for(const [file,name]of fontFiles){try{GlobalFonts.registerFromPath(file,name);}catch{}}
function drawText(ctx,s,x,y,size,color,family='Tutor Sans'){ctx.font=size+'px "'+family+'", "Noto Sans CJK SC", sans-serif';ctx.fillStyle=color;ctx.textBaseline='top';ctx.fillText(s,x,y);}
function wrap(ctx,s,size,width,family='Tutor Sans'){
  ctx.font=size+'px "'+family+'", sans-serif';const lines=[];let current='';
  for(const token of s.match(/[A-Za-z0-9./:_+-]+|./gu)||[]){if(ctx.measureText(current+token).width>width&&current){lines.push(current);current=token;}else current+=token;}
  if(current)lines.push(current);return lines;
}
async function png(file,w,h,paint){const c=createCanvas(w,h),ctx=c.getContext('2d');paint(ctx);await fs.writeFile(file,c.toBuffer('image/png'));}
function stamp(t){const ms=Math.round(t*1000);return String(Math.floor(ms/3600000)).padStart(2,'0')+':'+String(Math.floor(ms/60000)%60).padStart(2,'0')+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+','+String(ms%1000).padStart(3,'0');}
function clock(t){return String(Math.floor(t/60)).padStart(2,'0')+':'+String(Math.floor(t)%60).padStart(2,'0');}
async function render({source,info,script,audio,config,dir,signal,progress}) {
  const style=config.style,FPS=style.fps,W=style.width,VW=W-32,VH=Math.round(Math.min(1400,VW*info.height/info.width)/2)*2,H=52+VH+108,VX=16,VY=52,Y=VY+VH;
  const BG=style.background,INK=style.ink,ACC=style.accent,TERRA=style.secondary_accent,MUTED='#81786D',LINE='#DED6C9';
  const plan=schedule(script,audio.map(a=>a?.duration||0),style);
  plan.canvas={width:W,height:H,video_x:VX,video_y:VY,video_width:VW,video_height:VH};plan.source=source;plan.models=config.roles;plan.speech=config.speech;
  const assets=path.join(dir,'assets'),segments=path.join(dir,'segments');await fs.mkdir(assets,{recursive:true});await fs.mkdir(segments,{recursive:true});
  const output=path.join(dir,'tutorial.mp4');let subtitles=[];
  const fit='scale='+VW+':'+VH+':force_original_aspect_ratio=decrease,pad='+VW+':'+VH+':(ow-iw)/2:(oh-ih)/2:color='+BG+',setsar=1,pad='+W+':'+H+':'+VX+':'+VY+':color='+BG;
  for(let i=0;i<plan.scenes.length;i++){
    const s=plan.scenes[i],dur=s.duration,mode=s.motion_mode,title=s.kind==='title',overlay=path.join(assets,'overlay-'+i+'.png'),hold=path.join(assets,'hold-'+i+'.png');
    if(!title)await frame(source,mode==='freeze'?Math.min(s.freeze_at,info.duration-1/FPS):s.hold_at,hold,signal);
    await png(overlay,W,H,ctx=>{
      if(title){
        ctx.fillStyle=BG;ctx.fillRect(0,0,W,H);ctx.strokeStyle=LINE;ctx.lineWidth=2;
        for(let k=0;k<6;k++){ctx.beginPath();ctx.ellipse(W*.92+k*34,H*.4,350+k*34,H*.7,0,.7,4.5);ctx.stroke();}
        drawText(ctx,'TUTOR / PRACTICAL GUIDE',74,H*.21,21,TERRA,'Tutor Mono');
        drawText(ctx,String(s.chapter+1).padStart(2,'0')+'.',70,H*.285,90,ACC,'Tutor Mono');
        wrap(ctx,s.heading,82,W-140,'Tutor Serif').slice(0,3).forEach((l,n)=>drawText(ctx,l,70,H*.43+n*102,82,INK,'Tutor Serif'));
        drawText(ctx,script.title,76,H*.77,27,MUTED);
      }else{ctx.fillStyle=BG;ctx.fillRect(0,0,W,VY);ctx.fillRect(0,VY,16,VH);ctx.fillRect(W-16,VY,16,VH);ctx.fillRect(0,Y,W,H-Y);ctx.strokeStyle=LINE;ctx.strokeRect(15,51,VW+1,VH+1);}
      drawText(ctx,'YAK',16,10,26,ACC,'Tutor Mono');drawText(ctx,String(s.chapter+1).padStart(2,'0')+' / '+s.heading,96,10,23,INK);
      ctx.fillStyle=BG;ctx.fillRect(0,Y+2,W,H-Y-2);
      for(let ch=0;ch<plan.chapters_timed.length;ch++){
        const c=plan.chapters_timed[ch],x=16+VW*c.start/plan.total_duration,next=16+VW*c.end/plan.total_duration;
        const label=String(ch+1).padStart(2,'0')+' / '+c.title;
        drawText(ctx,wrap(ctx,label,18,Math.max(80,next-x-10))[0]||'',x+5,H-40,18,ch===s.chapter?TERRA:MUTED);
      }
      ctx.fillStyle=LINE;ctx.fillRect(16,H-12,VW,6);
    });
    s.captions=[];let pos=s.voice_lead;
    if(s.narration){
      const chunks=s.narration.split(/(?<=[。！？；])/u).filter(x=>x.trim()),weights=chunks.map(c=>Math.max(1,c.replace(/[A-Za-z0-9./]+/g,'aa').length)),sum=weights.reduce((a,b)=>a+b,0);
      for(let j=0;j<chunks.length;j++){
        const span=s.voice_duration*weights[j]/sum,file=path.join(assets,'caption-'+i+'-'+j+'.png');
        await png(file,W,67,ctx=>{ctx.fillStyle=BG;ctx.fillRect(0,0,W,67);wrap(ctx,chunks[j],27,W-80).slice(0,2).forEach((line,k)=>{ctx.font='27px "Tutor Sans"';drawText(ctx,line,(W-ctx.measureText(line).width)/2,4+k*32,27,INK);});});
        s.captions.push({file,start:pos,end:pos+span,text:chunks[j]});subtitles.push(String(subtitles.length+1)+'\n'+stamp(s.offset+pos)+' --> '+stamp(s.offset+pos+span)+'\n'+chunks[j]+'\n');pos+=span;
      }
    }
    const status=path.join(assets,'status-'+i+'.png');
    await png(status,190,38,ctx=>{ctx.fillStyle=BG;ctx.fillRect(0,0,190,38);drawText(ctx,mode==='freeze'?'定格讲解':'无声观察',10,5,18,MUTED);});
    const args=['-hide_banner','-v','error','-y','-filter_complex_threads','1'];let vf='';
    if(title){args.push('-f','lavfi','-i','color=c='+BG+':s='+W+'x'+H+':r='+FPS+':d='+dur,'-loop','1','-framerate',String(FPS),'-i',overlay);vf='[0:v]setpts=PTS-STARTPTS[base];';}
    else if(mode==='freeze'){args.push('-loop','1','-framerate',String(FPS),'-i',hold,'-loop','1','-framerate',String(FPS),'-i',hold);vf='[0:v]'+fit+'[base];';}
    else{
      const srcdur=s.source_end-s.source_start;args.push('-ss',String(s.source_start),'-t',String(srcdur),'-i',source,'-loop','1','-framerate',String(FPS),'-i',hold);
      const extra=s.hold_extra,before=s.hold_before,after=srcdur-before;
      if(mode==='compress')vf='[0:v]setpts='+s.motion_duration/srcdur+'*(PTS-STARTPTS),fps='+FPS+'[content];';
      else if(extra>.02&&before>.02&&after>.04)vf='[0:v]split=2[p0][p1];[p0]trim=duration='+before+',setpts=PTS-STARTPTS,fps='+FPS+',format=yuv420p[a];[1:v]trim=duration='+extra+',setpts=PTS-STARTPTS,format=yuv420p[h];[p1]trim=start='+before+',setpts=PTS-STARTPTS,fps='+FPS+',format=yuv420p[b];[a][h][b]concat=n=3:v=1:a=0[content];';
      else if(extra>.02)vf='[0:v]setpts=PTS-STARTPTS,fps='+FPS+',format=yuv420p[a];[1:v]trim=duration='+extra+',setpts=PTS-STARTPTS,format=yuv420p[h];[a][h]concat=n=2:v=1:a=0[content];';
      else vf='[0:v]setpts=PTS-STARTPTS,fps='+FPS+'[content];';
      vf+='[content]'+fit+',tpad=stop_mode=clone:stop_duration='+dur+'[base];';
    }
    args.push('-loop','1','-framerate',String(FPS),'-i',overlay);
    vf+='[base][2:v]overlay=0:0[decor];';let prev='decor',idx=3;
    for(let j=0;j<s.captions.length;j++){const c=s.captions[j];args.push('-loop','1','-framerate',String(FPS),'-i',c.file);const next='cap'+j;vf+='['+prev+']['+idx+':v]overlay=0:'+(Y+2)+":enable='between(t,"+c.start+','+c.end+")'["+next+'];';prev=next;idx++;}
    args.push('-loop','1','-framerate',String(FPS),'-i',status);
    vf+='['+prev+']['+idx+':v]overlay='+(W-400)+":6:enable='gte(t,"+(s.voice_lead+s.voice_duration)+")'[quiet];";
    const rgb=ACC.match(/\w\w/g).map(x=>parseInt(x,16));
    vf+='color=c='+ACC+':s='+VW+'x6:r='+FPS+':d='+dur+",format=rgba,geq=r="+rgb[0]+':g='+rgb[1]+':b='+rgb[2]+":a='if(lte(X,"+VW+'*(T+'+s.offset+')/'+plan.total_duration+"),255,0)'[progress];[quiet][progress]overlay=16:"+(H-12)+':shortest=1[comp];';
    vf+=s.transition==='fade'?'[comp]fade=t=in:st=0:d=0.35:color='+BG+',fade=t=out:st='+Math.max(0,dur-.35)+':d=0.35:color='+BG+',format=yuv420p[v]':'[comp]format=yuv420p[v]';
    args.push('-filter_complex',vf,'-map','[v]','-an','-t',String(dur),'-r',String(FPS),'-fps_mode','cfr','-enc_time_base','1:'+FPS,'-video_track_timescale','15360','-c:v','libx264','-preset','fast','-crf','18','-threads','4','-progress','pipe:1',path.join(segments,'segment-'+i+'.mp4'));
    await run(FFMPEG,args,{signal,duration:dur,onProgress:r=>progress?.(.8*(i+r)/plan.scenes.length,'渲染场景 '+(i+1)+' / '+plan.scenes.length)});
  }
  const track=Buffer.alloc(Math.round(plan.total_duration*48000)*2);
  for(let i=0;i<plan.scenes.length;i++){const s=plan.scenes[i];if(!s.voice_duration)continue;const data=audio[i].pcm||await pcm(audio[i].file,signal);data.copy(track,Math.round(s.audio_start*48000)*2);}
  await fs.writeFile(path.join(dir,'narration.wav'),wav(track));
  await fs.writeFile(path.join(dir,'subtitles.srt'),'\uFEFF'+subtitles.join('\n'));
  const concat=path.join(segments,'concat.txt');await fs.writeFile(concat,plan.scenes.map((s,i)=>"file 'segment-"+i+".mp4'\nduration "+s.duration.toFixed(9)).join('\n'));
  const meta=path.join(dir,'chapters.ffmeta');await fs.writeFile(meta,';FFMETADATA1\ntitle='+script.title.replace(/[=;\n#\\]/g,' ')+'\n'+plan.chapters_timed.map(c=>'[CHAPTER]\nTIMEBASE=1/1000\nSTART='+Math.round(c.start*1000)+'\nEND='+Math.round(c.end*1000)+'\ntitle='+c.title.replace(/[=;\n#\\]/g,' ')+'\n').join(''));
  await run(FFMPEG,['-hide_banner','-v','error','-y','-f','concat','-safe','0','-i',concat,'-f','ffmetadata','-i',meta,'-map_metadata','1','-map_chapters','1','-c','copy',path.join(dir,'assembled.mp4')],{signal});
  const timer=path.join(assets,'clock');await fs.mkdir(timer,{recursive:true});
  for(let t=0;t<=Math.ceil(plan.total_duration);t++)await png(path.join(timer,String(t).padStart(3,'0')+'.png'),192,36,ctx=>{ctx.fillStyle=BG;ctx.fillRect(0,0,192,36);drawText(ctx,clock(t)+' / '+clock(Math.round(plan.total_duration)),4,7,19,MUTED,'Tutor Mono');});
  await run(FFMPEG,['-hide_banner','-v','error','-y','-filter_complex_threads','1','-i',path.join(dir,'assembled.mp4'),'-framerate','1','-i',path.join(timer,'%03d.png'),'-i',path.join(dir,'narration.wav'),'-filter_complex','[0:v]fps='+FPS+'[x];[x][1:v]overlay='+(W-210)+':6:eof_action=repeat[v]','-map','[v]','-map','2:a:0','-map_metadata','0','-map_chapters','0','-t',String(plan.total_duration),'-c:v','libx264','-crf','18','-preset','fast','-threads','4','-c:a','aac','-b:a','160k','-movflags','+faststart','-progress','pipe:1',output],{signal,duration:plan.total_duration,onProgress:r=>progress?.(.8+r*.15,'合成完整视频')});
  await fs.writeFile(path.join(dir,'edit-plan.json'),JSON.stringify(plan,null,2));
  progress?.(.96,'验证音画与配音间隔');await run(FFMPEG,['-hide_banner','-v','error','-i',output,'-f','null','-'],{signal});
  const actual=await pcm(output,signal,24000),spoken=plan.scenes.filter(s=>s.voice_duration),gaps=[];
  for(let i=1;i<spoken.length;i++){
    const mid=(spoken[i-1].audio_end+spoken[i].audio_start)/2,start=Math.round((mid-.06)*24000),end=Math.round((mid+.06)*24000);let energy=0;
    for(let n=start;n<end;n++)energy+=(actual.readInt16LE(n*2)/32768)**2;
    const rms=Math.sqrt(energy/(end-start));if(rms>.005)throw Error('成片静音间隔验证失败');
    gaps.push({after:spoken[i-1].id,before:spoken[i].id,seconds:spoken[i].audio_start-spoken[i-1].audio_end,rms});
  }
  const headers=[];
  for(let i=0;i<plan.scenes.length;i++){
    const s=plan.scenes[i],local=Math.min(1.5,s.duration/2),samples=[];
    for(const [file,t]of [[path.join(segments,'segment-'+i+'.mp4'),local],[output,s.offset+local]]){
      const r=await run(FFMPEG,['-hide_banner','-v','error','-ss',String(t),'-i',file,'-frames:v','1','-vf','crop='+Math.min(W-220,900)+':40:16:4','-f','rawvideo','-pix_fmt','rgb24','-'],{signal});samples.push(r.stdout);
    }
    if(samples[0].length!==samples[1].length)throw Error('场景画面验证失败：'+s.id);
    let difference=0;for(let n=0;n<samples[0].length;n++)difference+=Math.abs(samples[0][n]-samples[1][n]);
    const mae=difference/samples[0].length;if(mae>4)throw Error('成片章节位置不匹配：'+s.id);headers.push({scene:s.id,mae});
  }
  const result={passed:true,duration:(await probe(output,signal)).duration,canvas:plan.canvas,sceneCount:plan.scenes.length,voiceCount:spoken.length,decodedSpeechGaps:gaps,sceneHeaderChecks:headers};
  await fs.writeFile(path.join(dir,'verification.json'),JSON.stringify(result,null,2));progress?.(1,'视频已完成');return {plan,verification:result,output};
}
module.exports={render,stamp};
