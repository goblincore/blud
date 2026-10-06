// Own servers with scripts/lab-servers.sh; this driver owns and closes its CDP tab.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const [vite='5448',cdp='9448',out='docs/dev-notes/2026-10-06-anatomical-skull'] = process.argv.slice(2);
mkdirSync(out,{recursive:true});
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
const tab = await (await fetch(`http://localhost:${cdp}/json/new?about:blank`,{method:'PUT'})).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail;});
let sequence=0;
const pending=new Map(), errors=[];
ws.onmessage=event=> {
  const m=JSON.parse(event.data);
  if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);p.ok(m);}return;}
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
  if(m.method==='Runtime.consoleAPICalled' && m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '));
};
const send=(method,params={})=>new Promise((ok,fail)=> {
  const id=++sequence;
  const timer=setTimeout(()=>{pending.delete(id);fail(new Error(`CDP timeout ${method}`));},60000);
  pending.set(id,{ok,fail,timer});ws.send(JSON.stringify({id,method,params}));
});
const evaluate=async expression=> {
  const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,timeout:59000});
  if(r.error||r.result?.exceptionDetails)throw new Error(JSON.stringify(r.error??r.result.exceptionDetails));
  return r.result.result.value;
};
const evidence={runs:[],errors};
const save=()=>writeFileSync(`${out}/game-validation.json`,JSON.stringify(evidence,null,2)+'\n');
const shot=async name=> {
  await evaluate('__sdfGame.step(3,1/60); __sdfGame.resolveGpu()');
  const r=await send('Page.captureScreenshot',{format:'png'});
  writeFileSync(`${out}/${name}.png`,Buffer.from(r.result.data,'base64'));
};
try {
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:960,height:720,deviceScaleFactor:1,mobile:false});
  for(const skull of ['sculpt','anatomical']) {
    await send('Page.navigate',{url:`http://localhost:${vite}/sdf-game.html?frozen=1&seed=20261006&skeleton=mesh&skull=${skull}&crowd=0`});
    const until=Date.now()+180000;
    let ready=false;
    while(Date.now()<until) {
      if(errors.length)throw new Error(JSON.stringify(errors).slice(0,1800));
      ready=await evaluate('window.__warmGate?.phase === "ready" && !!window.__sdfGame');
      if(ready)break;
      await sleep(500);
    }
    assert.ok(ready,'warm gate did not become ready');
    // Let the ready overlay auto-hide and the first asynchronous draw settle.
    await sleep(2000);
    const run={skull,boot:await evaluate('window.__warmDone'),diagnostic:await evaluate('__sdfGame.skeletonDiagnostics()')};
    evidence.runs.push(run);save();
    assert.equal(run.diagnostic.skull,skull);
    run.actor=await evaluate(`(() => {
      const g=__sdfGame;g.setLoopRunning(false);g.freeze(true);g.setAdaptive(false);
      g.woundPanel(false);g.gooPanel(false);g.vhsPanel?.(false);g.dynamitePanel(false);
      g.teleport(1);g.setLightClockFrozen(true);g.setLightTime(0);
      const z=g.zombies().find(z=>z.room===1);if(!z)throw new Error('no room 1 actor');
      const f=[-Math.sin(z.yaw),Math.cos(z.yaw)],x=z.pos[0]+f[0]*.68,p=z.pos[2]+f[1]*.68;
      g.setPose(x,p,Math.atan2(z.pos[0]-x,-(z.pos[2]-p)),.03,0);g.step(2,1/60);
      return z;
    })()`);
    await shot(`${skull}-skin`);
    // Torso wound only enables bone-exposure culling, leaving the skull whole.
    run.wound=await evaluate(`(() => {
      const g=__sdfGame,z=g.zombies().find(z=>z.id===${run.actor.id});
      const sp=g.screenPosOf(z.pos[0],1.1,z.pos[2]),o=g.cameraWorld(),r=g.screenRayToWorld(sp.x,sp.y,2);
      const d=r.map((v,i)=>v-o[i]),l=Math.hypot(...d);return g.stampWoundAt(...o,...d.map(v=>v/l),'slug',z.id);
    })()`);
    assert.ok(run.wound,'torso exposure fixture missed');
    await evaluate('__sdfGame.zombies().forEach(z=>{const a=__sdfGame.zombie(z.id);if(a)a.view.object.visible=false;});__sdfGame.step(2,1/60)');
    await shot(`${skull}-bones`);
    run.hit=await evaluate(`__sdfGame.hitMeshSkull(${run.actor.id})`);
    await shot(`${skull}-hit`);
    run.fracture=await evaluate(`__sdfGame.skullState(${run.actor.id})`);
    if(skull==='anatomical') {
      assert.ok(run.fracture.missing,'actual skull slug must detach a piece');
      run.exploded=await evaluate(`__sdfGame.explodeMeshSkull(${run.actor.id})`);
      assert.equal(run.exploded,13,'explosion must detach thirteen remaining pieces');
      await evaluate('__sdfGame.step(8,1/60)');await shot('anatomical-explosion');
      run.afterExplosion=await evaluate(`__sdfGame.skullState(${run.actor.id})`);
      assert.equal(run.afterExplosion.pieces.length,14);
    }
    assert.equal(errors.length,0,'renderer pipeline or console errors');save();
    console.log('PASS',skull,JSON.stringify(run.fracture));
  }
} finally {
  save();ws.close();
  await fetch(`http://localhost:${cdp}/json/close/${tab.id}`).catch(()=>{});
}
