import { loadavg } from 'node:os';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { connectGame, CLOSEUP_LADDER, sleep } from './sdf-closeup-stage.mjs';
import { stageNormalCloseup, readNormalRaw, withNormalBodyMask, normalAnatomyCoverage, settleNormalLegacy } from './normal-gradient-intact.mjs';
import { collectNormalPairs } from './normal-gradient-verdict.mjs';

const STATIC_SCENES=['intact-torso','wounded-torso','intact-head','wounded-head','unsupported-control'];
export const VERDICT_SCENES=['intact-torso','wounded-torso','intact-head','wounded-head','two-body-close-up-with-surrounding-actors','walking-and-flashlight-motion','impact-stagger-sever-sequence','unsupported-control'];
const SEED=20260905;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=message=>{throw new Error(message);};

// Capture the renderer's actual device before its first request; restore browser
// methods immediately after acquisition. No reliance on timestamp-query support.
const install=`(() => {
  window.__ngNativeNow=performance.now.bind(performance);
  let seed=${SEED};Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const gpu=navigator.gpu,requestAdapter=gpu.requestAdapter;
  gpu.requestAdapter=async function(...args){
    const adapter=await requestAdapter.apply(this,args);if(!adapter)return adapter;
    const requestDevice=adapter.requestDevice;
    adapter.requestDevice=async function(...deviceArgs){
      const device=await requestDevice.apply(this,deviceArgs);
      window.__ngDevice=device;window.__ngQueue=device.queue;window.__ngGpuErrors=[];
      device.addEventListener('uncapturederror',event=>window.__ngGpuErrors.push(String(event.error?.message??event.error)));
      device.lost.then(info=>window.__ngGpuErrors.push('device lost: '+info.message));
      adapter.requestDevice=requestDevice;gpu.requestAdapter=requestAdapter;
      return device;
    };return adapter;
  };
})()`;

async function census(evaluate) {
  return evaluate(`(() => {
    __sdfGame.setLoopRunning(false);
    const pieces=__sdfGame.normalGradientPieces();
    return {camera:__sdfGame.pose(),target:__sdfGame.sdfTarget,visibleBodies:__sdfGame.bodiesOnScreen,
      actors:__sdfGame.zombies(),chunks:__sdfGame.chunkStats(),bake:__sdfGame.chunkBake,
      settings:{hullExitBound:__sdfGame.hullExitBound,woundEarlyOut:__sdfGame.woundEarlyOut,woundStep:__sdfGame.woundStep,
        sdfScale:__sdfGame.sdfScale,cone:__sdfGame.cone,fxaa:__sdfGame.fxaa,smear:__sdfGame.smear,woundTuning:__sdfGame.woundTuning},
      flags:pieces.map(p=>({key:p.key,counts:__sdfGame.normalGradientPiece(p.key).uniforms.counts.value.toArray(),counts2:__sdfGame.normalGradientPiece(p.key).uniforms.counts2.value.toArray()}))};
  })()`);
}

async function fixture(evaluate,scene) {
  const head=scene.includes('head');
  const stage=await stageNormalCloseup(evaluate,{aimY:head?1.65:1.15,ladder:CLOSEUP_LADDER});
  if(scene.startsWith('wounded')) {
    const wound=await evaluate(`(() => {
      const p=__sdfGame.predictSlugHit();
      if(p.actorId!==${stage.body}||!p.hit)throw new Error('wound ray missed staged actor');
      const hit=__sdfGame.stampWoundAt(...p.origin,...p.dir,'slug',${stage.body});
      __sdfGame.step(30,0);return {hit,wounds:__sdfGame.debugWounds(${stage.body})};
    })()`);
    if(!wound.hit||!wound.wounds.length)fail('wounded fixture contains no wound');
    stage.wound=wound;
  }
  if(scene==='unsupported-control')await evaluate(`__sdfGame.zombie(${stage.body}).view.uniforms.counts2.value.y=1`);
  await evaluate('__sdfGame.setLoopRunning(false);__sdfGame.step(20,0)');
  const occ=await evaluate('__sdfGame.occupancy()');
  await evaluate('__sdfGame.setLoopRunning(false)');
  stage.occupancy=occ;
  if(!(occ.hits>0)||!(occ.targetW>0)||!(occ.targetH>0))fail('empty fixture/target');
  stage.coverage=occ.hits/(occ.targetW*occ.targetH);
  if(stage.coverage<.35&&scene!=='unsupported-control')fail(`closeup coverage ${stage.coverage} below explicit 35% target`);
  return stage;
}

async function boot(conn,vite,mode,scene) {
  const {send,evaluate}=conn;
  await evaluate('if(window.__ngDevice)window.__ngDevice.destroy()');
  await send('Page.navigate',{url:'about:blank'});
  await send('Page.navigate',{url:`http://localhost:${vite}/sdf-game.html?frozen=1`});
  let ready=false;
  for(let i=0;i<120;i++) {
    await sleep(250);
    ready=await evaluate('window.__sdfGame?.backend === "webgpu"');if(ready)break;
  }
  if(!ready)fail('WebGPU game did not boot');
  const device=await evaluate(`(async()=>{
    __sdfGame.setLoopRunning(false);__sdfGame.freeze(true);__sdfGame.installDebugProbe();
    if(!window.__ngQueue?.onSubmittedWorkDone)throw new Error('actual renderer GPU queue was not captured');
    await __ngQueue.onSubmittedWorkDone();
    if(!__sdfGame.chunkBake||!__sdfGame.hullExitBound)throw new Error('current-main bake/hull defaults missing');
    if(__sdfGame.normalGradientStatus().mode!==1)throw new Error('candidate does not default to hybrid normals');
    __sdfGame.setNormalGradient(${mode});__sdfGame.setNormalGradientDebug(0);
    return {queueCompletion:true,clockNative:performance.now.toString().includes('[native code]'),bake:__sdfGame.chunkBake};
  })()`);
  if(!device.clockNative)fail('performance.now is not native realtime');
  const staging=await fixture(evaluate,scene);
  return {device,staging};
}

async function measure(conn,fixtureInfo,mode,scene) {
  const {evaluate}=conn;
  // All imports/readbacks/census and 120 warmed frames are outside timing.
  await evaluate(`window.__ngRunBench=(await import('/src/lab/sdf-zombie/webgpu/game-bench.ts')).runBench;
    __sdfGame.setNormalGradient(${mode});__sdfGame.setNormalGradientDebug(0);
    __sdfGame.setLoopRunning(false);__sdfGame.step(120,0);await __ngQueue.onSubmittedWorkDone()`);
  const before=await census(evaluate);
  const packed=await evaluate('__sdfGameDebug.normalCaptureState()');
  const loadStart=loadavg()[0];
  if(loadStart>12)throw new Error(`timing deferred before leg: load1 ${loadStart} >12`);
  const bench=await evaluate(`(async()=>{
    if(performance.now.toString().indexOf('[native code]')<0)throw new Error('timing clock pinned');
    const samples=[];let start=null,fences=0;
    const result=await __ngRunBench({
      step:()=>__sdfGame.step(1,0),
      resolveGpu:async()=>{await __ngQueue.onSubmittedWorkDone();fences++;},
      now:()=>{const t=__ngNativeNow();if(start===null)start=t;else{samples.push((t-start)/10);start=null;}return t;},
      hidden:()=>document.hidden,perform:()=>{},
      census:()=>({bodies:__sdfGame.bodiesOnScreen,wounds:__sdfGame.zombies().reduce((n,a)=>n+__sdfGame.debugWounds(a.id).length,0),chunks:__sdfGame.chunkCount})
    },{frames:240,steps:[],segments:[{name:'closeup',from:0,to:240}]},
      {mode:'throughput',warmup:0,chunkFrames:10,dtSec:0,label:${JSON.stringify(scene+' mode '+mode)}});
    __sdfGame.setLoopRunning(false);
    return {...result,samples,fences,clock:'native performance.now',fence:'actual GPUQueue.onSubmittedWorkDone'};
  })()`,180000);
  const loadEnd=loadavg()[0];
  const gpuErrors=await evaluate('window.__ngGpuErrors');
  if(gpuErrors?.length)fail('GPU errors: '+gpuErrors.join('; '));
  const after=await census(evaluate);
  if(!before.bake||!after.bake)fail('baking changed during bench');
  if(before.visibleBodies<1||after.visibleBodies<1)fail('no visible actor');
  return {mode,loadStart,loadEnd,...bench,before,after,staging:fixtureInfo.staging,
    state:digest({packed,staging:fixtureInfo.staging,camera:before.camera,settings:before.settings,target:before.target}),
    stateScope:'exact packed geometry/config/camera and seeded static fixture; realtime dungeon fire flicker intentionally remains live'};
}

async function coverage(conn,body,scene,outDir) {
  const original=await conn.evaluate(`(() => {window.__ngCaptureNow=performance.now;window.__ngCaptureTime=10000;performance.now=()=>window.__ngCaptureTime;return true;})()`);
  try { return await captureCoverage(conn,body,scene,outDir); }
  finally {if(original)await conn.evaluate('performance.now=window.__ngCaptureNow;delete window.__ngCaptureNow;delete window.__ngCaptureTime');}
}
async function captureCoverage(conn,body,scene,outDir) {
  const {evaluate,send}=conn;
  await evaluate('__sdfGame.setLoopRunning(false);__sdfGame.setNormalGradient(1);__sdfGame.setNormalGradientDebug(2)');
  const read=async(mode,diagnostic)=>{
    await evaluate(`__sdfGame.setNormalGradient(${mode});__sdfGame.setNormalGradientDebug(${diagnostic})`);
    const r=await readNormalRaw(evaluate),bytes=Buffer.from(r.rgba32f,'base64');
    return {...r,data:new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4)};
  };
  const settled=await settleNormalLegacy(()=>read(0,1),()=>evaluate('__sdfGameDebug.normalCaptureState()'));
  const hybrid=await read(1,1),hybridState=await evaluate('__sdfGameDebug.normalCaptureState()');
  if(JSON.stringify(settled.state)!==JSON.stringify(hybridState))fail('capture geometry/camera/config changed between modes');
  await evaluate('__sdfGame.setNormalGradient(1);__sdfGame.setNormalGradientDebug(2)');
  const raw=await withNormalBodyMask(evaluate,body,()=>readNormalRaw(evaluate));
  const bytes=Buffer.from(raw.rgba32f,'base64'),data=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
  const ownerLimbs=await evaluate(`__sdfGame.normalGradientPieces().find(p=>p.key==='body:${body}').ownerLimbs`);
  const parity={depthChanged:0,depthMax:0,fallbackMax:0,nonFinite:0,legacySettling:settled.settling,packedStateMatched:true};
  for(let i=0;i<data.length;i+=4){
    const a=settled.frame.data,b=hybrid.data;
    for(let c=0;c<4;c++)if(!Number.isFinite(a[i+c])||!Number.isFinite(b[i+c]))parity.nonFinite++;
    const d=Math.abs(a[i+3]-b[i+3]);if(d>0){parity.depthChanged++;parity.depthMax=Math.max(parity.depthMax,d);}
    if(Number.isInteger(data[i])&&data[i]>1&&data[i]<=8)for(let c=0;c<3;c++)parity.fallbackMax=Math.max(parity.fallbackMax,Math.abs(a[i+c]-b[i+c]));
  }
  for(const [mode,frame] of [['legacy',settled.frame],['hybrid',hybrid]])writeFileSync(resolve(outDir,`${scene}-${mode}-normal.rgba32f`),Buffer.from(frame.rgba32f,'base64'));
  // Write raw eligibility and its measured coverage before any acceptance
  // assertion, so an empty/weak target remains inspectable after failure.
  const record=persistNormalEligibility(raw,{scene,body,outDir,ownerLimbs,parity});
  if(parity.depthChanged||parity.fallbackMax||parity.nonFinite)fail('fresh capture depth/fallback parity failed: '+JSON.stringify(parity));
  const wound=scene.startsWith('wounded')?await evaluate(`__sdfGameDebug.normalWoundCoverage(${body},window.__ngRawTransfer.rgba32f,${raw.w},${raw.h})`):null;
  record.woundRegions=wound?.regions??null;
  writeFileSync(record.metrics,JSON.stringify(record,null,2)+'\n');
  await evaluate('__sdfGame.setNormalGradientDebug(0);__sdfGame.step(20,0);await __ngQueue.onSubmittedWorkDone()');
  const shot=await send('Page.captureScreenshot',{format:'png'});
  record.image=resolve(outDir,`${scene}-beauty.png`);writeFileSync(record.image,Buffer.from(shot.result.data,'base64'));
  writeFileSync(record.metrics,JSON.stringify(record,null,2)+'\n');
  return record;
}

export function persistNormalEligibility(raw,{scene,body,outDir,ownerLimbs,parity}) {
  const bytes=Buffer.from(raw.rgba32f,'base64'),data=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
  const reasons=Array(8).fill(0);
  for(let i=0;i<data.length;i+=4){const r=data[i]-1;if(Number.isInteger(r)&&r>=0&&r<8)reasons[r]++;}
  const pixels=reasons.reduce((a,b)=>a+b,0),targetCoverage=pixels/(raw.w*raw.h);
  const reason=!pixels?'no target actor eligibility pixels':scene!=='unsupported-control'&&targetCoverage<.35?'staged actor eligibility coverage below 35% target':null;
  const record={parity,target:{width:raw.w,height:raw.h},targetBody:body,pixels,targetCoverage,
    wholeBody:{analytic:reasons[0],fallback:pixels-reasons[0],analyticFraction:pixels?reasons[0]/pixels:null},reasons,
    reasonOrder:['ok','unsupported','degenerate','hard-boundary','owner-unstable','wound-pending','sampled-cache','inactive'],
    anatomy:normalAnatomyCoverage(data,ownerLimbs),woundRegions:null,
    raw:resolve(outDir,`${scene}-eligibility.rgba32f`),sha256:createHash('sha256').update(bytes).digest('hex'),
    metrics:resolve(outDir,`${scene}-eligibility.json`),validation:reason?'fail':'pass',reason,
    scope:'untimed live SDF target body; baked meshes excluded'};
  writeFileSync(record.raw,bytes);
  writeFileSync(record.metrics,JSON.stringify(record,null,2)+'\n');
  if(reason)fail(`${reason}; retained metrics: ${record.metrics}`);
  return record;
}

// Keep the primary timing window free of expensive untimed coverage work.
// Exported for an offline sequencing test using the same production loop.
export async function runStaticNormalScenes(scenes,{measure,capture,save}) {
  for(const scene of scenes) {
    if(!STATIC_SCENES.includes(scene.name))continue;
    scene.status='running';save();
    const pairs=await measure(scene);
    scene.pairs=pairs;scene.status=pairs.status;save();
    if(pairs.status!=='measured')return {status:'incomplete',reason:'three replacement attempts exhausted'};
    // The preceding save checkpoints BOTH primary timing sets before the
    // first primary capture, including if capture fails or load rises.
    const captureScenes=scene.name==='intact-torso'?[]:scene.name==='wounded-torso'?scenes.slice(0,2):[scene];
    for(const target of captureScenes){target.coverage=await capture(target);save();}
    if(scene.name==='wounded-torso'&&scenes.slice(0,2).some(s=>s.pairs?.summary?.clearRegression)) {
      return {status:'no-go',reason:'clear repeatable primary runtime regression; remaining scenes explicitly unmeasured'};
    }
  }
  return {status:'incomplete',reason:'remaining dynamic and multi-actor fixtures and direct main control are not measured; no net shipping claim'};
}

export async function runNormalPerformance({vite,cdp,outDir,defer=false,onUpdate=()=>{}}) {
  const rawPath=resolve(outDir,'paired-timings.json');
  const result={version:1,status:'incomplete',browserOpened:false,preflight:{load1:loadavg()[0],at:new Date().toISOString()},seed:SEED,
    protocol:{pairs:5,replacementCap:3,frames:240,warmup:120,chunkFrames:10,coverageTarget:.35,
      clock:'native realtime performance.now; capture clock is separate',fence:'actual renderer GPUQueue.onSubmittedWorkDone; distinct from historical timestamp-resolve bench',
      statistic:'p50/p95/p99 of ten-frame chunk means, not frame spikes',baseline:'runtime legacy/hybrid share candidate shader integrated with main b280709',
      compileCost:'unavailable',normalWorkCounts:'unavailable',shippingShaderOverhead:'unmeasured; no direct current-main control',
      defaults:'fresh current game defaults; no historical applyShipDefaults call; mesh baking and hull exit bound ON; no spill suppression'},
    scenes:VERDICT_SCENES.map(name=>({name,status:'unmeasured',fixture:STATIC_SCENES.includes(name)?'implemented-static; GPU validation pending':'not implemented'})),errors:[],rawPath};
  const save=()=>{writeFileSync(rawPath,JSON.stringify(result,null,2)+'\n');onUpdate(result);};
  save();
  if(defer){result.reason='explicit offline timing checkpoint; no GPU run attempted';save();return result;}
  if(!Number.isFinite(result.preflight.load1)||result.preflight.load1>12){result.reason='load preflight missing or exceeds 12; no browser opened';save();return result;}
  let conn;
  try {
    result.browserOpened=true;save();
    conn=await connectGame({vite,cdp,width:800,height:720,onFail:fail});
    await conn.send('Page.addScriptToEvaluateOnNewDocument',{source:install});
    Object.assign(result,await runStaticNormalScenes(result.scenes,{
      save,
      measure:scene=>collectNormalPairs(async(mode,attempt)=>{
        if(loadavg()[0]>12)throw new Error(`timing deferred before fixture: load1 ${loadavg()[0]} >12`);
        const info=await boot(conn,vite,mode,scene.name);
        const leg=await measure(conn,info,mode,scene.name);
        scene.partialLeg={attempt,leg};save();return leg;
      },(pair,partial)=>{scene.pairs=partial;delete scene.partialLeg;save();console.log(JSON.stringify({scene:scene.name,attempt:pair.attempt,reason:pair.reason,legs:pair.legs.map(l=>({mode:l.mode,loadStart:l.loadStart,loadEnd:l.loadEnd,mean:l.overall.mean,p50:l.overall.p50,p95:l.overall.p95,p99:l.overall.p99}))}));}),
      capture:async scene=>{
        if(loadavg()[0]>12)throw new Error(`eligibility deferred: load1 ${loadavg()[0]} >12`);
        const info=await boot(conn,vite,1,scene.name);
        return coverage(conn,info.staging.body,scene.name,outDir);
      },
    }));
  } catch(error) {result.errors.push(error.message);result.reason=error.message;}
  finally {
    for(const scene of result.scenes)if(scene.status==='running')scene.status='deferred';
    if(conn){try{await conn.evaluate('if(window.__sdfGame)__sdfGame.setLoopRunning(false);if(window.__ngDevice)__ngDevice.destroy()');}catch(error){result.errors.push('cleanup: '+error.message);}
      try{await fetch(`http://localhost:${cdp}/json/close/${conn.tab.id}`);}catch(error){result.errors.push('close: '+error.message);}}
    save();
  }
  return result;
}
