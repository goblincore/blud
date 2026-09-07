import {writeFileSync} from 'node:fs';
import {connectGame} from '../../../scripts/lib/sdf-closeup-stage.mjs';
const vite=Number(process.env.LAB_VITE_PORT),cdp=Number(process.env.LAB_CDP_PORT);
const c=await connectGame({vite,cdp,width:1050,height:760,onFail:m=>{throw Error(m)}});
const report={scope:'Standalone bounded torso comparison; no gameplay or timing claim',frames:[]};
const save=(name,value)=>writeFileSync(new URL(name,import.meta.url),value);
try{
 await c.send('Page.navigate',{url:`http://localhost:${vite}/shared-wounds-probe.html`});
 for(let i=0;i<120;i++){if(await c.evaluate('Boolean(window.__sharedWoundProbe||window.__sharedWoundError)'))break;await new Promise(r=>setTimeout(r,250));}
 const error=await c.evaluate('window.__sharedWoundError');if(error)throw Error(error);
 if(!await c.evaluate('Boolean(window.__sharedWoundProbe)'))throw Error('probe failed to boot');
 report.info=await c.evaluate('__sharedWoundProbe.info()');
 for(const yaw of [0,.5])for(const stage of [0,1,2]){
  await c.evaluate(`__sharedWoundProbe.setView(${yaw});__sharedWoundProbe.setStage(${stage});__sharedWoundProbe.setDiagnostic(true)`);
  const raw=await c.evaluate('__sharedWoundProbe.read()');if(raw.errors.length)throw Error(raw.errors.join(';'));
  const bytes=Buffer.from(raw.rgba,'base64'),half=raw.width/2,stats=[];
  for(let side=0;side<2;side++){
   let hits=0,cavity=0,steps=0,exhausted=0;
   for(let y=0;y<raw.height;y++)for(let x=side*half;x<(side+1)*half;x++){
    const i=(y*raw.width+x)*4;
    if(bytes[i+2]>127){hits++;steps+=bytes[i];}
    if(bytes[i+1]>127)cavity++;
    if(bytes[i]>=160&&bytes[i+2]<128)exhausted++;
   }
   stats.push({hits,cavity,meanHitSteps:steps/hits,exhausted});
  }
  const [a,b]=stats;
  if(!a.hits||!b.hits)throw Error('empty torso');
  if(stage===0&&(a.cavity||b.cavity))throw Error('intact cavity');
  if(stage>0&&(!a.cavity||!b.cavity))throw Error('missing damage');
  if(a.exhausted||b.exhausted)throw Error('exhausted rays '+JSON.stringify({stage,yaw,stats}));
  const hitDelta=Math.abs(a.hits-b.hits)/a.hits;
  if(hitDelta>.01)throw Error('large silhouette difference');
  report.frames.push({yaw,stage,analytic:a,sampled:b,hitDelta});
  await c.evaluate('__sharedWoundProbe.setDiagnostic(false)');
  const shot=await c.send('Page.captureScreenshot',{format:'png'});save(`stage-${stage}-yaw-${yaw}.png`,Buffer.from(shot.result.data,'base64'));
 }
 for(const t of [0,40,80,120,160]){
  await c.evaluate(`__sharedWoundProbe.setView(0);__sharedWoundProbe.setTransition(0,1,${t});__sharedWoundProbe.setDiagnostic(true)`);
  const raw=await c.evaluate('__sharedWoundProbe.read()');if(raw.errors.length)throw Error(raw.errors.join(';'));
  const b=Buffer.from(raw.rgba,'base64');let hits=0,exhausted=0;for(let i=0;i<b.length;i+=4){if(b[i+2]>127)hits++;if(b[i]>=160&&b[i+2]<128)exhausted++;}
  if(!hits||exhausted)throw Error('transition missing/exhausted');
  report.frames.push({transitionMs:t,hits,exhausted});
 }
 await c.evaluate(`__sharedWoundProbe.setDiagnostic(false);__sharedWoundProbe.setStage(0);document.querySelector('#hit').click();document.querySelector('#reset').click();document.querySelector('#hit').click()`);
 await new Promise(r=>setTimeout(r,400));
 const afterReset=await c.evaluate('__sharedWoundProbe.info()');
 if(afterReset.state.current!==1||afterReset.state.target!==1)throw Error('hit after reset did not animate');
 report.resetDuringPlayback=true;
 report.passed=true;save('report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){report.failure=String(error.stack??error);save('failed-report.json',JSON.stringify(report,null,2)+'\n');throw error;}finally{await fetch(`http://localhost:${cdp}/json/close/${c.tab.id}`).catch(()=>{});}
process.exit();
