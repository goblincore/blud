// Focused combined analytic-normal / default-on settled-chunk bake lifecycle.
// Synthetic chunks exercise the production spawn/bake/re-gib/view-ring paths;
// they are not evidence of an actual anatomical sever or wound ROI coverage.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyShipDefaults } from './lib/sdf-closeup-stage.mjs';
const cdp=Number(process.env.LAB_CDP_PORT??9251),vite=Number(process.env.LAB_VITE_PORT??5251);
const out=resolve(process.argv[2]??'/tmp/zombie-ng-bake-integration');mkdirSync(out,{recursive:true});
let tab,ws,seq=0;const pending=new Map();
const report={scope:'synthetic chunks through production spawn/bake/re-gib/view recycle; no wound derivative coverage',passed:false,checks:[],failures:[],console:[]};
const send=(method,params={})=>new Promise((ok,no)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);no(Error(`timeout ${method}`));},30000);pending.set(id,{ok:r=>{clearTimeout(timer);ok(r)},no});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result?.result?.value};
const check=(name,value)=>{report.checks.push({name,...value});if(value.pass!==true)report.failures.push(name)};
try {
  tab=await(await fetch(`http://localhost:${cdp}/json/new?about:blank`,{method:'PUT'})).json();
  ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id).ok(m);pending.delete(m.id)}else if(m.method==='Runtime.exceptionThrown'||m.method==='Log.entryAdded')report.console.push(m)};
  await send('Runtime.enable');await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:800,height:720,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`http://localhost:${vite}/sdf-game.html?frozen=1&fixture=normal-bake-integration`});
  for(let i=0;i<120;i++){if(await evaluate('window.__sdfGame?.backend==="webgpu"'))break;await new Promise(r=>setTimeout(r,500))}
  if(!await evaluate('window.__sdfGame?.backend==="webgpu"'))throw Error('WebGPU boot failed');
  await evaluate('__sdfGame.freeze(true);__sdfGame.setLoopRunning(false);__sdfGame.installDebugProbe()');
  await applyShipDefaults(evaluate);
  check('default-on bake and default-off normals',{pass:await evaluate('__sdfGame.chunkBake===true&&__sdfGame.normalGradientStatus().mode===0')});
  report.initial=await evaluate('__sdfGame.chunkStats()');
  const census=()=>evaluate(`({stats:__sdfGame.chunkStats(),mode:__sdfGame.normalGradientStatus(),live:__sdfGame.normalGradientPieces().filter(p=>p.kind==='chunk').map(p=>({key:p.key,cfg:__sdfGame.normalGradientPiece(p.key).uniforms.normalGradientCfg.value.toArray()}))})`);
  await evaluate(`(()=>{const z=__sdfGame.zombies().find(z=>z.room===3);if(!z)throw Error('no room3 actor');window.__ngBakeOrigin=z.pos;window.__ngViews=[];__sdfGame.setNormalGradient(1);__sdfGame.spawnTestChunk(z.pos[0]+1,.02,z.pos[2]+.6);__sdfGame.spawnTestChunk(z.pos[0]-.9,.02,z.pos[2]-.5);for(const p of __sdfGame.normalGradientPieces().filter(p=>p.kind==='chunk'))window.__ngViews.push(__sdfGame.normalGradientPiece(p.key));})()`);
  report.spawned=await census();check('spawn inherits hybrid',{pass:report.spawned.live.length===2&&report.spawned.live.every(p=>p.cfg[0]===1&&p.cfg[1]===0)});
  report.transition=[];
  for(let i=0;i<60;i++){await evaluate('__sdfGame.step(12,1/60)');const s=await census();report.transition.push(s);if(s.stats.baked>=2)break;}
  report.baked=await census();check('default-on live to baked transition',{pass:report.baked.stats.baked>=2&&report.baked.stats.live===0&&report.baked.live.length===0});
  report.bakeViewIds=await evaluate('window.__ngViews.map(v=>v.mesh?.id??null)');
  // Same baked meshes remain outside SDF piece coverage while the live actor
  // and pooled view configs continue receiving both mode values.
  for(const mode of [0,1]){
    await evaluate(`__sdfGame.setNormalGradient(${mode});__sdfGame.setNormalGradientDebug(0);__sdfGame.refreshHull();__sdfGame.step(20,0);`);
    await evaluate('__sdfGameDebug.readMarchTarget().then(r=>({w:r.w,h:r.h}))');
    const state=await census();const pooled=await evaluate('window.__ngViews.map(v=>v.uniforms.normalGradientCfg.value.toArray())');
    check(`baked mesh retained and pooled mode ${mode}`,{pass:state.stats.baked===report.baked.stats.baked&&state.live.length===0&&pooled.every(c=>c[0]===mode&&c[1]===0),state,pooled});
  }
  report.regib={attempts:[]};
  for(const target of report.baked.stats.pieces.slice(0,2)){
    if(report.regib.pass)break;
    let aim=await evaluate(`(()=>{let px=${target.centre[0]},pz=${target.centre[2]}+.3;for(let i=0;i<6;i++){__sdfGame.setPose(px,pz,0,-1.56,0);__sdfGame.step(4);const m=__sdfGame.muzzleWorld();px+=${target.centre[0]}-m[0];pz+=${target.centre[2]}-m[2];}return [px,pz]})()`);
    for(let volley=0;volley<3;volley++){
      const result=await evaluate(`(()=>{__sdfGame.step(95);__sdfGame.setPose(${aim[0]},${aim[1]},0,-1.56,0);__sdfGame.step(2);const before=__sdfGame.chunkStats(),fired=__sdfGame.fire(2);let ox=0,oz=0,n=0;for(let f=0;f<6;f++){__sdfGame.step(1);for(const q of __sdfGame.pelletsDebug()){const w=1/(.05+Math.abs(q.pos[1]-${target.centre[1]}));ox+=(q.pos[0]-${target.centre[0]})*w;oz+=(q.pos[2]-${target.centre[2]})*w;n+=w;}}return {before,after:__sdfGame.chunkStats(),fired,correction:n?[ox/n,oz/n]:[0,0]}})()`);
      const state=await census();report.regib.attempts.push({target:target.id,volley,...result,state});
      if(result.fired&&result.after.baked<result.before.baked&&result.after.live>result.before.live){report.regib.pass=state.live.every(p=>p.cfg[0]===1&&p.cfg[1]===0);break;}
      aim=aim.map((v,i)=>v-result.correction[i]);
    }
  }
  check('real weapon re-gib creates hybrid live pieces',report.regib);
  // Exceed the 12-view ring through the real spawn path without synthetic
  // mutation of renderer state. Record retained view identity across reuse.
  report.recycle=await evaluate(`(()=>{const z=window.__ngBakeOrigin;__sdfGame.setNormalGradient(0);for(let i=0;i<15;i++)__sdfGame.spawnTestChunk(z[0]+(i%3)*.3,2,z[2]+Math.floor(i/3)*.3);const pieces=__sdfGame.normalGradientPieces().filter(p=>p.kind==='chunk');return {stats:__sdfGame.chunkStats(),reused:pieces.filter(p=>window.__ngViews.includes(__sdfGame.normalGradientPiece(p.key))).length,configs:pieces.map(p=>__sdfGame.normalGradientPiece(p.key).uniforms.normalGradientCfg.value.toArray())}})()`);
  check('ring reuse resets inherited legacy mode',{pass:report.recycle.stats.views<=12&&report.recycle.reused>0&&report.recycle.configs.every(c=>c[0]===0&&c[1]===0),...report.recycle});
  await evaluate('__sdfGame.setNormalGradient(1);__sdfGame.setNormalGradientDebug(0)');
  report.final=await census();check('toggle reaches all recycled live pieces',{pass:report.final.live.every(p=>p.cfg[0]===1&&p.cfg[1]===0)});
  await evaluate('__sdfGameDebug.readMarchTarget().then(r=>({w:r.w,h:r.h}))');
  report.passed=report.failures.length===0;
}catch(e){report.failures.push(String(e.stack??e))}finally{
  writeFileSync(resolve(out,'bake-integration.json'),JSON.stringify(report,null,2)+'\n');
  if(tab)await fetch(`http://localhost:${cdp}/json/close/${tab.id}`).catch(()=>{});ws?.close();
}
console.log(JSON.stringify({passed:report.passed,checks:report.checks.map(c=>({name:c.name,pass:c.pass})),failures:report.failures}));
process.exit(report.passed?0:1);
