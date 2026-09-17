// Exact-input dense/culled GPU comparison plus alternating frozen full frames.
// Own the browser through scripts/lab-servers.sh. Default graphics, tracked model.
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectGame, bootCloseupPage, sleep } from './lib/sdf-closeup-stage.mjs';
const vite = Number(process.env.LAB_VITE_PORT ?? 5492), cdp = Number(process.env.LAB_CDP_PORT ?? 9493);
const profiling = process.env.UPSCALE_CULL_PROFILE === '1';
const out = process.env.UPSCALE_CULL_OUT ?? '/tmp/blud-upscale-culling';
mkdirSync(out, { recursive: true });
setTimeout(()=>{console.error('watchdog: 15 minutes');process.exit(1)},15*60_000).unref();
const { send, evaluate } = await connectGame({ vite, cdp });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__perfErrors=[]; const e=console.error; console.error=(...a)=>{window.__perfErrors.push(a.map(String).join(' '));e(...a)};` });
await bootCloseupPage({ send, evaluate, url: `http://localhost:${vite}/sdf-game.html?simidle=1&seed=20260917&res=800` });
for(let i=0;i<240;i++){if(await evaluate('!!window.__warmDone && __sdfGame.roomProbesReady()'))break;if(i===239)throw Error('Boot warm-up did not finish');await sleep(500)}
const initial = await evaluate(`(()=>{const g=__sdfGame;g.setLoopRunning(false);g.setRenderLock(false);g.setDemoHold(true);g.setLightClockFrozen(true);g.setVhs(null);g.freeze(true);return g.upscaleInfo()})()`);
if (initial.inSize.width !== 400 || initial.inSize.height !== 300 || initial.model !== 't16' || initial.sharpen !== .5) throw Error(JSON.stringify(initial));
console.log('boot', JSON.stringify(initial));
const bootErrors=await evaluate('window.__perfErrors');if(bootErrors.length)throw Error(JSON.stringify(bootErrors));
const errorPoll=setInterval(async()=>{try{const errors=await evaluate('window.__perfErrors');if(errors?.length){console.error(errors);process.exit(1)}}catch{}},3000);errorPoll.unref();
const reports = [];
const names = process.env.UPSCALE_CULL_QUICK ? ['medium'] : ['medium', 'close', 'crowd'];
for (const name of names) {
  const staged = await evaluate(`(()=>{
    const g=__sdfGame;g.setRenderLock(false);
    g.teleport(${name === 'crowd' ? 2 : 1});
    const z=g.zombies().find(z=>z.room===${name === 'crowd' ? 2 : 1});
    if(!z)throw Error('No actor');
    const c=g.actorLimbCenter(z.id,'torso') ?? z.pos, d=${name === 'close' ? 0.8 : name === 'crowd' ? 4.5 : 2.5};
    g.setPose(c[0],c[2]+d,0,Math.atan2(c[1]-1.62,d),0);
    g.step(60);g.setRenderLock(true);
    return {actor:z.id,room:z.room,c,d,zombies:g.zombies().length,pose:g.pose(),camera:g.cameraWorld(),screen:g.screenPosOf(...c),bodies:g.bodiesOnScreen()};
  })()`);
  // Give asynchronous first-use pipelines time to land; synchronous step(60)
  // can still render only the mesh skeleton while a flesh pipeline is pending.
  for(let i=0;i<120;i++){const r=await evaluate('(async()=>{__sdfGame.step(4,0);await __sdfGame.resolveGpu();const r=await __sdfGameDebug.readMarchTarget();const a=new Float32Array(Uint8Array.from(atob(r.rgba32f),c=>c.charCodeAt(0)).buffer);let hits=0;for(let k=3;k<a.length;k+=4)if(a[k]<1)hits++;return {hits}})()');if(r.hits>250)break;if(i===119)throw Error('Flesh pipeline never rendered');await sleep(500)}
  console.log('staged',JSON.stringify(staged));
  const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(shot.result.data,'base64'));
  const micro = await evaluate(`__sdfGameDebug.upscaleCullingCheck({frames:${profiling ? 0 : 32},repeats:4,synthetic:${!profiling && name === 'medium'}})`,600000);
  writeFileSync(`${out}/${name}-micro.json`,JSON.stringify({initial,staged,micro},null,2));
  const parity = micro.results.map(r=>({fixture:r.fixture,different:r.different,maxAbs:r.maxAbs,coverageMismatch:r.coverageMismatch,depthMismatch:r.depthMismatch,staleBackgroundMismatch:r.staleBackgroundMismatch,covered:r.covered,active:r.activeTiles,total:r.totalTiles}));
  console.log(name, 'parity',JSON.stringify(parity));
  if(micro.results[0].covered<1000)throw Error('Gameplay fixture has no visible subject');
  if(micro.results.some(r=>r.different || r.nonfinite || r.staleBackgroundMismatch)) throw Error('Dense/culled outputs differ');
  if(process.env.UPSCALE_CULL_QUICK)break;
  const rows=[];
  for(const enabled of [false,true])await evaluate(`(async()=>{const g=__sdfGame;__sdfGameDebug.setUpscaleCullingPipeline(${enabled});for(let i=0;i<120;i++){g.step(1,0);await g.resolveGpu()}await g.passTimings()})()`);
  for(let rep=0;rep<(profiling ? 2 : 6);rep++)for(const enabled of rep%2?[true,false]:[false,true]) {
    const row=await evaluate(`(async()=>{
      const g=__sdfGame;const {beginPassFrame}=await import('/src/lab/sdf-zombie/webgpu/gpu-pass-timing.ts');
      __sdfGameDebug.setUpscaleCullingPipeline(${enabled});
      for(let i=0;i<90;i++){g.step(1,0);await g.resolveGpu()}await g.passTimings();
      const times=[];
      for(let i=0;i<${profiling ? 32 : 60};i++){beginPassFrame();const t=performance.now();g.step(1,0);await g.resolveGpu();times.push(performance.now()-t)}
      // The raw query buffer is overwritten on each fence. Drain it each
      // profiling frame, separately from the primary fenced timing loop.
      await g.passTimings();const samples=[];
      for(let i=0;i<16;i++){beginPassFrame();g.step(1,0);await g.resolveGpu();samples.push(...(await g.passTimings()).samples)}
      return {times,marchHash:await __sdfGameDebug.hashMarchTarget(),passes:{installed:true,samples},errors:window.__perfErrors,hidden:document.hidden};
    })()`);
    if(row.errors.length || row.hidden)throw Error(JSON.stringify(row));
    const sorted=[...row.times].sort((a,b)=>a-b),p50=sorted[Math.floor(sorted.length/2)];
    rows.push({rep,enabled,p50,...row});
    console.log(name,rep,enabled,p50.toFixed(2));
    writeFileSync(`${out}/${name}-frames.json`,JSON.stringify({initial,staged,rows},null,2));
  }
  reports.push({name,staged,parity,rows:rows.map(({rep,enabled,p50})=>({rep,enabled,p50}))});
}
const errors=await evaluate('window.__perfErrors');
if(errors.length)throw Error(JSON.stringify(errors));
writeFileSync(`${out}/complete.json`,JSON.stringify({initial,reports,errors},null,2));
process.exit(0);
