// Frozen real-game shutter cost, alternating modes in one boot.
// Servers are owned by scripts/lab-servers.sh; this script owns only its tab.
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { connectGame, bootCloseupPage } from './lib/sdf-closeup-stage.mjs';

const vite = Number(process.env.LAB_VITE_PORT ?? 5492);
const cdp = Number(process.env.LAB_CDP_PORT ?? 9492);
const out = process.env.SHUTTER_OUT ?? '/tmp/blud-shutter-perf';
const repeats = Number(process.env.SHUTTER_REPEATS ?? 5);
const frames = Number(process.env.SHUTTER_FRAMES ?? 80);
mkdirSync(out, { recursive: true });
const { send, evaluate } = await connectGame({ vite, cdp, width: 1280, height: 800 });
const errors = [];
// The library installs its response handler; collect events on a separate
// browser-side error seam without replacing that handler.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__perfErrors = [];
  window.addEventListener('error', e => window.__perfErrors.push(e.message));
  const originalError = console.error;
  console.error = (...args) => { window.__perfErrors.push(args.map(String).join(' ')); originalError(...args); };
` });
await bootCloseupPage({ send, evaluate, url: `http://localhost:${vite}/sdf-game.html?simidle=1&seed=20260917&res=800` });
await evaluate(`(() => {
  const g = __sdfGame;
  g.setLoopRunning(false); g.setRenderLock(false);
  g.setDemoHold(true); g.setLightClockFrozen(true);
  for (const fn of ['shutterPanel','gooPanel','vhsPanel','dynamitePanel','woundPanel','gibPanel']) g[fn]?.(false);
  return g.upscaleInfo();
})()`);
const setup = await evaluate(`(() => {
  const g = __sdfGame, zs = g.zombies();
  let best = zs[0], count = -1;
  for (const a of zs) {
    const n = zs.filter(b => b.room === a.room && Math.hypot(a.pos[0]-b.pos[0], a.pos[2]-b.pos[2]) < 3.5).length;
    if (n > count) { best = a; count = n; }
  }
  const c = g.actorLimbCenter(best.id, 'torso') ?? best.pos;
  const p = g.playerPos(), dx = p[0]-c[0], dz = p[2]-c[2], len = Math.hypot(dx,dz) || 1;
  g.placePlayer({x:c[0]+dx/len*5, z:c[2]+dz/len*5, yaw:Math.atan2(-dx,dz), pitch:Math.atan2(c[1]-1.62,5)});
  g.step(6);
  const blast = g.detonate(c[0],c[1]+0.4,c[2]);
  return { actor: best.id, room: best.room, neighbours: count, blast };
})()`);
let bestScore = -1, peakFrame = 0;
for (let frame = 0; frame < 70; frame++) {
  const d = await evaluate(`(() => { const g=__sdfGame; g.step(1); return {g:g.gibBlur, b:g.bloodBlur}; })()`);
  const score = d.g.stamps * 2 + d.b.last.stamps;
  if (score > bestScore) { bestScore = score; peakFrame = frame; }
  if (bestScore > 0 && frame - peakFrame >= 6) break;
}
const census = await evaluate(`({gib:__sdfGame.gibBlur,blood:__sdfGame.bloodBlur,pieces:__sdfGame.chunkStates(),upscale:__sdfGame.upscaleInfo(),probes:__sdfGame.probeCostSplit})`);
if (!(census.gib.selectedPieces > 0 && census.blood.last.stamps > 0)) throw new Error('No combined blur work staged');
console.log('staged', JSON.stringify({setup,gibs:census.gib.selectedPieces,gibStamps:census.gib.stamps,bloodStamps:census.blood.last.stamps}));
const modes = process.env.SHUTTER_AB ? [
  {id:'reference',blood:true,gib:true,upload:false,probe:false},
  {id:'candidate',blood:true,gib:true,upload:process.env.SHUTTER_AB==='uploads',probe:process.env.SHUTTER_AB==='probes'},
] : [
  {id:'sharp',blood:false,gib:false}, {id:'blood',blood:true,gib:false},
  {id:'gib',blood:false,gib:true}, {id:'both',blood:true,gib:true},
];
const rows = [];
// Warm both choices before measuring: the first full-size readback/timing
// resolve otherwise makes the first leg systematically slower.
for (const mode of modes) {
  await evaluate(`(async()=>{
    const g=__sdfGame;
    g.setBloodBlur(${mode.blood}); g.setGibBlur(${mode.gib});
    g.setGooUploadOptimization(${mode.upload ?? true}); g.setProbeOptimization(${mode.probe ?? true});
    g.step(100,0); await g.resolveGpu(); await g.passTimings();
  })()`);
}
for (let rep = 0; rep < repeats; rep++) {
  for (const mode of rep % 2 ? [...modes].reverse() : modes) {
    const row = await evaluate(`(async () => {
      const g=__sdfGame;
      g.setGooUploadOptimization(${mode.upload ?? true});
      g.setProbeOptimization(${mode.probe ?? true});
      g.setBloodBlur(${mode.blood}); g.setGibBlur(${mode.gib});
      g.setBloodBlurExposure(44.44444444444444);
      g.step(16,0); await g.resolveGpu(); await g.passTimings();
      const times=[], gib=[], blood=[];
      for(let i=0;i<${frames};i++) {
        const t=performance.now(); g.step(1,0); await g.resolveGpu(); times.push(performance.now()-t);
        gib.push(g.gibBlur.last.buildMs); blood.push(g.bloodBlur.last.buildMs);
      }
      const passes=await g.passTimings();
      return {times,gib,blood,passes,hidden:document.hidden,census:{g:g.gibBlur.selectedPieces,b:g.bloodBlur.selectedDroplets},errors:window.__perfErrors};
    })()`);
    if(row.hidden || row.errors.length) throw new Error(JSON.stringify(row.errors));
    const pct=(a,p)=>[...a].sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*p))];
    rows.push({rep,mode:mode.id,...row,p50:pct(row.times,.5),p95:pct(row.times,.95)});
    console.log(`rep${rep} ${mode.id}: ${rows.at(-1).p50.toFixed(2)} ms p95 ${rows.at(-1).p95.toFixed(2)}`);
    writeFileSync(`${out}/cost.json`,JSON.stringify({git:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),setup,census,rows,errors},null,2));
  }
}
await evaluate('__sdfGame.setBloodBlur(true); __sdfGame.setGibBlur(true); __sdfGame.step(8,0)');
const shot=await send('Page.captureScreenshot',{format:'png'});
writeFileSync(`${out}/combined.png`,Buffer.from(shot.result.data,'base64'));
if (process.env.SHUTTER_AB === 'uploads') {
  await evaluate('__sdfGame.setVhs(null)');
  for (const [name, enabled] of [['reference',false],['reference-repeat',false],['candidate',true],['reference-again',false]]) {
    await evaluate(`(async()=>{ __sdfGame.setGooUploadOptimization(${enabled}); __sdfGame.step(120,0); await __sdfGame.resolveGpu(); })()`);
    const s=await send('Page.captureScreenshot',{format:'png'});
    writeFileSync(`${out}/${name}.png`,Buffer.from(s.result.data,'base64'));
  }
}
if (process.env.SHUTTER_PARITY === '1') {
  const parity = await evaluate(`(async()=>{
    const g=__sdfGame, results=[];
    g.setRenderLock(true); g.setProbeBlend(1); g.setProbeFall(1);
    for(const rays of [0,1,2,3,5,8,16,31,32,47,64]) {
      g.setProbeRays(rays);
      const variants=[];
      for(const optimized of [false,true,false,true]) {
        g.setProbeOptimization(optimized); g.step(4,0);
        const data=await g.probeDynReadback();
        variants.push(Array.from(new Uint32Array(data.buffer,data.byteOffset,data.length)));
      }
      const identical=variants.every(a=>a.every((v,i)=>v===variants[0][i]));
      results.push({rays,identical,gates:g.probeDynamic.gates,...(!identical?{variants}:{})});
    }
    return results;
  })()`);
  writeFileSync(out+'/probe-parity.json',JSON.stringify(parity,null,2));
  if(parity.some(r=>!r.identical))throw new Error('Probe output differs in blast fixture');
  console.log('blast probe parity: all 11 ray counts bit-identical');
}
const finalErrors=await evaluate('window.__perfErrors');
if(finalErrors.length)throw new Error(JSON.stringify(finalErrors));
writeFileSync(out+'/complete.json',JSON.stringify({complete:true,errors:finalErrors,rows:rows.length}));
process.exit(0);
