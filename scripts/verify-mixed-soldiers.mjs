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
  await evaluate(`(async()=>{const start=Date.now();while(!window.__sdfGame?.encounter){if(Date.now()-start>60000)throw new Error('boot timeout');await new Promise(r=>setTimeout(r,100));}})()`);
  console.log('CAST',JSON.stringify(await evaluate(`window.__sdfGame.brains().map(a=>({id:a.id,room:a.room,kind:a.kind}))`)));
  await evaluate(`window.__sdfGame.setPose(12.5,-4.8,Math.PI/2,0)`);
  const fired=new Set();
  const start=Date.now();
  while(Date.now()-start<45000){
    const state=await evaluate(`window.__sdfGame.brains().filter(a=>a.kind==='soldier')`);
    for(const a of state)if(a.sinceFire!==null&&a.sinceFire<.6)fired.add(a.id);
    if(Date.now()-start>12000&&fired.size>=2)break;
    await new Promise(r=>setTimeout(r,200));
  }
  console.log('FIRED',JSON.stringify([...fired]));
  console.log('BRAINS',JSON.stringify(await evaluate(`window.__sdfGame.brains().filter(a=>a.room===5)`)));
  const shells=await evaluate(`(()=>{const g=window.__sdfGame;let scene=g.zombie(g.brains()[0].id).view.object;while(scene.parent)scene=scene.parent;const counts=[];scene.traverse(o=>{if(o.name==='spent-shotgun-shells')counts.push(o.children[0].count)});return counts;})()`);
  console.log('SHELLS',JSON.stringify(shells));
  const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync('/tmp/mixed-soldiers.png',Buffer.from(shot.result.data,'base64'));
  if(fired.size<2)throw new Error('fewer than two soldiers fired');
  if(!shells.some(n=>n>0))throw new Error('no ejected shells');
  const floorShells=await evaluate(`(()=>{const g=window.__sdfGame;let scene=g.zombie(g.brains()[0].id).view.object;while(scene.parent)scene=scene.parent;const shells=[];scene.traverse(o=>{if(o.name==='spent-shotgun-shells'){const m=o.children[0];for(let i=0;i<m.count;i++)shells.push(Array.from(m.instanceMatrix.array.slice(i*16+12,i*16+15)))}});return shells;})()`);
  if(!floorShells.some(p=>Math.abs(p[1]-.012)<.001))throw new Error('no settled floor shells');
  console.log('FLOOR_SHELLS',JSON.stringify(floorShells));
  await evaluate(`window.__sdfGame.setPose(7,-4.8,0,1.2);window.__sdfGame.fire(1)`);
  const chaseStart=Date.now();let chasers=[];
  while(Date.now()-chaseStart<30000){
    chasers=await evaluate(`window.__sdfGame.brains().filter(a=>a.id>=11&&a.room===2).map(a=>a.id)`);
    if(chasers.length)break;
    await new Promise(r=>setTimeout(r,300));
  }
  if(!chasers.length)throw new Error('no new-room enemy pursued through the doorway');
  console.log('CROSS_ROOM_CHASERS',JSON.stringify(chasers));
  if(browserErrors.length)throw new Error(browserErrors.join('\n'));
  console.log('Mixed encounter and shell ejection passed without browser errors');
} finally {ws.close();await fetch(`http://localhost:${port}/json/close/${tab.id}`);}
