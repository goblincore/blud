// Focused real-browser worker lifecycle check. Does not claim GPU timing.
// node scripts/sdf-chunk-worker-check.mjs [vitePort=5173] [cdpPort=9263]
import { connectGame, sleep } from './lib/sdf-closeup-stage.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const vite=Number(process.argv[2] ?? 5173), cdp=Number(process.argv[3] ?? 9263);
const out=process.env.GATE_OUT ?? '/tmp/blud-chunk-worker';mkdirSync(out,{recursive:true});
const c=await connectGame({vite,cdp,onFail:m=>{throw Error(m)}});
const errors=[];
const monitor=new WebSocket(c.tab.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{monitor.onopen=resolve;monitor.onerror=reject;});
monitor.send(JSON.stringify({id:1,method:'Runtime.enable'}));
monitor.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);});
await c.send('Page.addScriptToEvaluateOnNewDocument',{source:`const nativePost=Worker.prototype.postMessage; Worker.prototype.postMessage=function(...args){if(window.__delayChunkBakeMs)setTimeout(()=>nativePost.apply(this,args),window.__delayChunkBakeMs);else nativePost.apply(this,args);};`});
await c.send('Page.navigate',{url:`http://127.0.0.1:${vite}/sdf-game.html?slug&frozen`});
for(let i=0;i<120;i++){await sleep(500);if(await c.evaluate('!!window.__sdfGame?.chunkStats'))break;}
const assert=(condition,message)=>{if(!condition)throw Error(message);};
assert(await c.evaluate('__sdfGame.chunkStats().bakeThread === "worker"'),'worker code not loaded');
await c.evaluate('__sdfGame.freeze(true);__sdfGame.teleport(3);__sdfGame.step(2);{const z=__sdfGame.zombies().find(z=>z.room===3);__sdfGame.spawnTestChunk(z.pos[0]+1,.02,z.pos[2]+.6,.16)}');
let pending;
for(let i=0;i<100;i++){
  pending=await c.evaluate('__sdfGame.step(4);__sdfGame.chunkStats()');
  if(pending.pendingBake!==null)break;
}
assert(pending.pendingBake!==null,'no submitted bake');
assert(pending.livePieces.some(p=>p.id===pending.pendingBake),'pending piece disappeared');
let finished;
const deadline=Date.now()+30000;
while(Date.now()<deadline){
  await sleep(30);finished=await c.evaluate('__sdfGame.step(1);__sdfGame.chunkStats()');
  assert(!finished.bakeError,finished.bakeError);
  if(finished.baked>0)break;
}
assert(finished.baked===1 && finished.live===0,'worker did not swap one piece');
const first=finished.pieces[0];
assert(first.radius>0 && Number.isFinite(first.radius),'bad projectile bound');
await c.evaluate('{const z=__sdfGame.zombies().find(z=>z.room===3);__sdfGame.spawnTestChunk(z.pos[0]-.9,.02,z.pos[2]-.5,.16)}');
let cancelled;
for(let i=0;i<100;i++){
  cancelled=await c.evaluate('__sdfGame.step(4);(()=>{const before=__sdfGame.chunkStats();if(before.pendingBake!==null)__sdfGame.setChunkBake(false);return before})()');
  if(cancelled.pendingBake!==null)break;
}
assert(cancelled.pendingBake!==null,'no cancellation candidate');
await sleep(200);
const afterCancel=await c.evaluate('__sdfGame.step(2);__sdfGame.chunkStats()');
assert(afterCancel.baked===1 && afterCancel.pendingBake===null,'cancelled job replaced a piece');
assert(afterCancel.livePieces.some(p=>p.id===cancelled.pendingBake),'cancelled piece disappeared');
await c.evaluate('__sdfGame.setChunkBake(true)');
let resumed;
for(let i=0;i<200;i++){
  await sleep(30);resumed=await c.evaluate('__sdfGame.step(2);__sdfGame.chunkStats()');
  assert(!resumed.bakeError,resumed.bakeError);
  if(resumed.baked===2)break;
}
assert(resumed.baked===2,'baking did not resume');
const pendingHit=await c.evaluate(`(()=>{
  window.__delayChunkBakeMs=5000;
  {const z=__sdfGame.zombies().find(z=>z.room===3);__sdfGame.spawnTestChunk(z.pos[0]+1,.02,z.pos[2]+.6,.16);}
  let s;
  for(let i=0;i<100;i++){__sdfGame.step(4);s=__sdfGame.chunkStats();if(s.pendingBake!==null)break;}
  const target=s.livePieces.find(p=>p.id===s.pendingBake);
  if(!target)return {error:'no pending target',s};
  let x=target.centre[0],z=target.centre[2]+.3;
  for(let i=0;i<6;i++){
    __sdfGame.setPose(x,z,0,-1.56);__sdfGame.step(2);
    const ray=__sdfGame.slugRay();const t=(target.centre[1]-ray.origin[1])/ray.dir[1];x+=target.centre[0]-(ray.origin[0]+ray.dir[0]*t);z+=target.centre[2]-(ray.origin[2]+ray.dir[2]*t);
  }
  __sdfGame.setPose(x,z,0,-1.56);__sdfGame.step(2);
  const ray=__sdfGame.slugRay();const fired=__sdfGame.fireSlug();const frames=[];for(let i=0;i<6;i++){__sdfGame.step(1);frames.push(__sdfGame.pelletsDebug());}
  const after=__sdfGame.chunkStats();window.__delayChunkBakeMs=0;
  return {target:target.id,targetCentre:target.centre,ray,frames,fired,after};
})()`);
writeFileSync(out+'/pending-hit.json',JSON.stringify(pendingHit,null,2));
assert(pendingHit.fired && !pendingHit.after.livePieces.some(p=>p.id===pendingHit.target),'shot passed through pending piece');
assert(pendingHit.after.pendingBake!==pendingHit.target,'shot did not cancel obsolete bake');
assert(pendingHit.after.views<=12,'chunk views grew beyond ring budget');
assert(errors.length===0,JSON.stringify(errors));
const report={pending,finished,afterCancel,resumed,pendingHit,errors};
writeFileSync(out+'/report.json',JSON.stringify(report,null,2));
const shot=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(out+'/baked.png',Buffer.from(shot.result.data,'base64'));
console.log(JSON.stringify({pass:true,workerMs:finished.lastBakeMs,requestMs:finished.lastBakeRequestMs,swapMs:finished.lastBakeSwapMs,afterResume:resumed.totalBakes,output:out}));
process.exit(0);
