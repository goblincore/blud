// Real WebGPU smoke check for structural soldier falls, leg loss, and rear collar.
// Run against the lab/CDP ports managed by scripts/lab-servers.sh.
import { writeFileSync } from 'node:fs';
const port=process.env.LAB_CDP_PORT ?? '9226';
const vite=process.env.LAB_VITE_PORT ?? '5184';
const tab=await (await fetch(`http://localhost:${port}/json/new?${encodeURIComponent('about:blank')}`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let id=0;const pending=new Map();const browserErrors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown'){browserErrors.push(JSON.stringify(m.params));console.error('BROWSER_EXCEPTION',JSON.stringify(m.params));}if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error'){const error=m.params.args.map(a=>a.value??a.description).join(' ');browserErrors.push(error);console.error('BROWSER_ERROR',error.slice(0,1800));}if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}};
const send=(method,params={})=>new Promise(resolve=>{const n=++id;pending.set(n,resolve);ws.send(JSON.stringify({id:n,method,params}));});
const evaluate=async expression=>{
  const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(r.result?.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
let shot;
try {
  await send('Runtime.enable');
  await send('Page.navigate',{url:`http://localhost:${vite}/sdf-lab-webgpu.html?character=soldier`});
  await evaluate(`(async()=>{const start=Date.now();while(!window.__sdfLab?.holdPose){if(Date.now()-start>60000)throw new Error('lab boot timeout');await new Promise(r=>setTimeout(r,100));}})()`);
  for (const direction of [-1, 1]) {
    await evaluate(`window.__sdfLab.respawn();window.__sdfLab.setMotionEnabled(true);window.__sdfLab.forceCollapse([${direction},0,0]);`);
    await evaluate(`(async()=>{const start=Date.now();while(window.__sdfLab.motion.phase!=='settled'){if(Date.now()-start>15000)throw new Error('side fall did not settle');await new Promise(r=>setTimeout(r,100));}})()`);
    await evaluate(`window.__sdfLab.focusBody();window.__sdfLab.setCam(.5,.25,2.1,.18);`);
    await new Promise(r=>setTimeout(r,200));
    shot=await send('Page.captureScreenshot',{format:'png'});
    writeFileSync(`/tmp/soldier-side-fall-${direction}.png`,Buffer.from(shot.result.data,'base64'));
  }
  await evaluate(`window.__sdfLab.respawn();`);
  await evaluate(`window.__sdfLab.setWander(false);window.__sdfLab.setMotionEnabled(true);window.__sdfLab.setCam(1.25,.60,1.8,.3);window.__sdfLab.post.setSmear(0);window.__sdfLab.forceCollapse();`);
  await evaluate(`(async()=>{const start=Date.now();while(window.__sdfLab.motion.phase!=='settled'){if(Date.now()-start>15000)throw new Error('fall did not settle');await new Promise(r=>setTimeout(r,100));}})()`);
  await evaluate(`window.__sdfLab.focusBody();window.__sdfLab.setCam(1.25,.65,2.1,.3);`);
  await new Promise(r=>setTimeout(r,100));
  const frame=await evaluate(`({motion:window.__sdfLab.motion, body:window.__sdfLab.heroPosed().prims.filter(p=>!p.dead).map(p=>({a:p.a,b:p.b}))})`);
  if(frame.motion.phase==='standing')throw new Error('soldier did not fall');
  console.log(JSON.stringify(frame.motion));
  shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync('/tmp/soldier-structural-fall.png',Buffer.from(shot.result.data,'base64'));
  await evaluate(`window.__sdfLab.respawn();window.__sdfLab.setWander(false);window.__sdfLab.setMotionEnabled(true);window.__sdfLab.setCam(3.14,.08,1.3,1.35);`);
  await new Promise(r=>setTimeout(r,500));
  shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync('/tmp/soldier-rear-collar.png',Buffer.from(shot.result.data,'base64'));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'5',code:'Digit5',windowsVirtualKeyCode:53});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'5',code:'Digit5',windowsVirtualKeyCode:53});
  await evaluate(`window.__sdfLab.setCam(1.25,.60,1.8,.3);`);
  await evaluate(`(async()=>{const start=Date.now();while(window.__sdfLab.motion.phase!=='settled'){if(Date.now()-start>15000)throw new Error('fall did not settle');await new Promise(r=>setTimeout(r,100));}})()`);
  shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync('/tmp/soldier-downed-leg.png',Buffer.from(shot.result.data,'base64'));
  console.log(JSON.stringify(await evaluate(`window.__sdfLab.motion`)));
  await evaluate(`window.__sdfLab.respawn();window.__sdfLab.holdPose('aim');`);
  if((await evaluate(`window.__sdfLab.motion.phase`))!=='standing')throw new Error('respawn retained injury state');
  await evaluate(`window.__sdfLab.respawn();window.__sdfLab.setMotionEnabled(true);`);
  for (const key of ['3','4']) {
    await send('Input.dispatchKeyEvent',{type:'keyDown',key,code:`Digit${key}`,windowsVirtualKeyCode:48+Number(key)});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:`Digit${key}`,windowsVirtualKeyCode:48+Number(key)});
    await evaluate(`(async()=>{const start=Date.now();while(window.__sdfLab.motion.phase!=='settled'){if(Date.now()-start>15000)throw new Error('arm loss did not settle');await new Promise(r=>setTimeout(r,100));}})()`);
    await evaluate(`window.__sdfLab.focusBody();window.__sdfLab.setCam(1.25,.65,2.1,.3);`);
    await new Promise(r=>setTimeout(r,200));
    shot=await send('Page.captureScreenshot',{format:'png'});
    writeFileSync(`/tmp/soldier-downed-arm-${key}.png`,Buffer.from(shot.result.data,'base64'));
  }
  await evaluate(`window.__sdfLab.respawn();window.__sdfLab.holdPose('aim');`);
  if((await evaluate(`window.__sdfLab.motion.phase`))!=='standing')throw new Error('respawn retained arm injury state');
  if(browserErrors.length)throw new Error(browserErrors.join('\n'));
  console.log('Structural fall and rear collar rendered with no browser errors');
} finally {ws.close();await fetch(`http://localhost:${port}/json/close/${tab.id}`);}
