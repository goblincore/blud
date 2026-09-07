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
try {
  await send('Runtime.enable');
  await send('Page.navigate',{url:`http://localhost:${vite}/sdf-game.html`});
  await evaluate(`(async()=>{const start=Date.now();while(!window.__sdfGame?.soldierCorpseBake){if(Date.now()-start>60000)throw new Error('game boot timeout');await new Promise(r=>setTimeout(r,100));}})()`);
  const id=await evaluate(`(()=>{const g=window.__sdfGame;const a=g.brains().find(a=>a.kind==='soldier');return a?.id??g.brains().find(a=>a.room===1)?.id})()`);
  if(id===undefined)throw new Error('missing soldier');
  await evaluate(`(()=>{const z=window.__sdfGame.zombie(${id});for(let i=0;i<4;i++){const p=z.posed().prims.find(p=>p.bone==='shin.l'&&!p.dead);const at=[(p.a[0]+p.b[0])/2,(p.a[1]+p.b[1])/2,(p.a[2]+p.b[2])/2];z.hit(at,[0,0,-1]);}})()`);
  const start=Date.now();
  let state;
  while(Date.now()-start<120000) {
    state=await evaluate(`window.__sdfGame.soldierCorpseBake()`);
    if(state.error)throw new Error(state.error);
    if(state.baked.includes(id))break;
    await new Promise(r=>setTimeout(r,500));
  }
  if(!state.baked.includes(id))throw new Error(`corpse bake timeout: ${JSON.stringify(state)}`);
  console.log('BAKED',JSON.stringify(state));
  await evaluate(`(()=>{const g=window.__sdfGame,z=g.zombie(${id});const p=z.posed().prims.find(p=>p.bone==='chest'&&!p.dead);g.setPose(p.a[0],p.a[2]+2,0,-.6);})()`);
  await new Promise(r=>setTimeout(r,250));
  const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync('/tmp/soldier-corpse-baked.png',Buffer.from(shot.result.data,'base64'));
  await evaluate(`(()=>{const z=window.__sdfGame.zombie(${id});const p=z.posed().prims.find(p=>p.bone==='chest'&&!p.dead);z.hit([(p.a[0]+p.b[0])/2,(p.a[1]+p.b[1])/2,(p.a[2]+p.b[2])/2+p.radius],[0,0,-1]);})()`);
  await new Promise(r=>setTimeout(r,200));
  state=await evaluate(`window.__sdfGame.soldierCorpseBake()`);
  if(state.baked.includes(id))throw new Error('hit did not invalidate corpse bake');
  console.log('RESTORED',JSON.stringify(state));
  const live=await send('Page.captureScreenshot',{format:'png'});writeFileSync('/tmp/soldier-corpse-live.png',Buffer.from(live.result.data,'base64'));
  if(browserErrors.length)throw new Error(browserErrors.join('\n'));
  console.log('Soldier corpse mesh swap and damage restore passed without browser errors');
} finally {ws.close();await fetch(`http://localhost:${port}/json/close/${tab.id}`);}
