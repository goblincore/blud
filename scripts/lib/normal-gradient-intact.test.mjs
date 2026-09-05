import assert from 'node:assert/strict';
import test from 'node:test';
import { normalAnatomyCoverage, normalOrbitPose, stageNormalCloseup, stampNormalWounds, withNormalBodyMask, normalBeautyFrames, normalCoverageFailure } from './normal-gradient-intact.mjs';

test('anatomy has independent head/torso denominators and excludes foreign-body sentinel, background, arms and unknown owners', () => {
  const pixels = new Float32Array([
    1,0,0,.8, 5,0,0,.8, // target head: 1/2 analytic
    1,0,1,.8, 1,0,1,.8, 6,0,1,.8, // target torso: 2/3 analytic
    1,0,2,.8, // target arm is not head or torso
    -1,-1,-1,.7, // closer foreign actor keeps depth, even if its owner would be 0
    0,0,0,0, 1,0,99,.8, // background and unknown owner
  ]);
  assert.deepEqual(normalAnatomyCoverage(pixels, ['head','torso','armL']), {
    head:{hits:2,analytic:1,fallback:1,analyticFraction:.5},
    torso:{hits:3,analytic:2,fallback:1,analyticFraction:2/3},
  });
});

test('orbit yaw and pitch point at the intended body for either side of orbit', () => {
  for (const angle of [-.4,.4]) {
    const pose = normalOrbitPose([3,0,7],angle,1.8,1.1,1.62);
    const dx=3-pose.x,dz=7-pose.z;
    assert.ok(Math.abs(Math.sin(pose.yaw)-dx/1.8)<1e-12);
    assert.ok(Math.abs(-Math.cos(pose.yaw)-dz/1.8)<1e-12);
    assert.ok(Math.abs(pose.pitch-Math.atan2(-.52,1.8))<1e-12);
  }
});

test('staging failure throws through nested cleanup instead of exiting process', async () => {
  let innerFinally=false,outerFinally=false,recorded;
  try {
    try { await stageNormalCloseup(async()=>({error:'no staged body'})); }
    finally { innerFinally=true; }
  } catch(e) { recorded=e.message; }
  finally { outerFinally=true; }
  assert.equal(recorded,'no staged body');
  assert.equal(innerFinally,true);assert.equal(outerFinally,true);
});

test('wound stamp validation failure throws through driver cleanup', async () => {
  let cleaned=false;
  await assert.rejects(async()=> {
    try { await stampNormalWounds(async()=>({stamped:0}),{minStamped:1}); }
    finally { cleaned=true; }
  }, /only 0 wounds stamped/);
  assert.equal(cleaned,true);
});

test('body mask preserves all original values and restores them when readback fails', async () => {
  const color = (values) => ({ toArray:()=>[...values], setRGB(...v){values.splice(0,3,...v);} });
  const mkView = (rgb,flat) => ({ uniforms:{baseColor:{value:color(rgb)},debugCfg:{value:{y:flat}}} });
  const views = new Map([[7,mkView([.1,.2,.3],0)],[8,mkView([.4,.5,.6],.25)]]);
  const game = {chunkCount:0,zombies:()=>[{id:7},{id:8}],zombie:id=>({view:views.get(id)})};
  const window = {};
  const evaluate = async source => new Function('__sdfGame','window',`return (${source});`)(game,window);
  await assert.rejects(withNormalBodyMask(evaluate,7,async()=> {
    assert.deepEqual(views.get(7).uniforms.baseColor.value.toArray(),[.1,.2,.3]);
    assert.deepEqual(views.get(8).uniforms.baseColor.value.toArray(),[-1,-1,-1]);
    assert.equal(views.get(8).uniforms.debugCfg.value.y,1);
    throw new Error('readback failed');
  }),/readback failed/);
  assert.deepEqual(views.get(8).uniforms.baseColor.value.toArray(),[.4,.5,.6]);
  assert.equal(views.get(8).uniforms.debugCfg.value.y,.25);
  assert.equal(window.__ngBodyMask,undefined);
});

test('shipped temporal history is flushed below diagnostic-color contamination before beauty capture', () => {
  const frames=normalBeautyFrames(.25);
  assert.ok(128 * .25 ** frames < 1e-6);
  assert.throws(()=>normalBeautyFrames(.6),/shipped smear/);
});


test('wounded control requires actual fallback while mixed fixture retains both coverage floors', () => {
  const result={name:'control',total:16477,reasons:{ok:23,'wound-pending':16452},analyticFraction:23/16477};
  assert.equal(normalCoverageFailure(result,{woundControl:true}),null);
  assert.match(normalCoverageFailure({...result,reasons:{ok:16477,'wound-pending':0}},{woundControl:true}),/no wound fallback/);
  assert.match(normalCoverageFailure(result),/10% probe floor/);
  assert.match(normalCoverageFailure({...result,total:200,reasons:{ok:99},analyticFraction:.495}),/10% probe floor/);
  assert.equal(normalCoverageFailure({...result,total:1000,reasons:{ok:100},analyticFraction:.1}),null);
});

test('wound fallback control accepts current explicit boundary/unsupported reasons',()=>{
  assert.equal(normalCoverageFailure({name:'wound',reasons:{ok:900,unsupported:100}},{woundControl:true}),null);
  assert.match(normalCoverageFailure({name:'wound',reasons:{ok:1000}},{woundControl:true}),/no wound fallback/);
});

test('piece mask isolates detached chunks by stable identity and restores foreign body/chunk views', async () => {
  const mkView=()=>({uniforms:{baseColor:{value:{values:[.2,.3,.4],toArray(){return [...this.values]},setRGB(...v){this.values=v}}},debugCfg:{value:{y:0}}}});
  const views=new Map([['body:7',mkView()],['chunk:7',mkView()],['chunk:8',mkView()]]);
  const game={chunkCount:2,normalGradientPieces:()=>[...views.keys()].map(key=>({key})),normalGradientPiece:key=>views.get(key)};
  const window={};const evaluate=async source=>new Function('__sdfGame','window',`return (${source});`)(game,window);
  await withNormalBodyMask(evaluate,'chunk:7',async()=>{
    assert.deepEqual(views.get('chunk:7').uniforms.baseColor.value.toArray(),[.2,.3,.4]);
    assert.deepEqual(views.get('body:7').uniforms.baseColor.value.toArray(),[-1,-1,-1]);
    assert.deepEqual(views.get('chunk:8').uniforms.baseColor.value.toArray(),[-1,-1,-1]);
  });
  for(const view of views.values())assert.deepEqual(view.uniforms.baseColor.value.toArray(),[.2,.3,.4]);
});

import { normalAngularFailure } from './normal-gradient-intact.mjs';
test('reviewed stencil differences require independent gradient and identical owner/noise proofs; p99 remains a gate',()=>{
  const point={analytic:[0,.2,.1,.3],scalar:[0],state:[0,5],epsilons:[{epsilon:.0005,gradient:[.2,.1,.3]}],detailBreakdown:{tetra:Array.from({length:4},()=>({geometric:[0,5],noisy:[0,5]})),geometricTetra:[.21,.09,.31],fullTetra:[.03,.01,.02],noiseOnly:[-.18,-.08,-.29],combined:[.02,.02,.01]}};
  const result={name:'reviewed',angularDegrees:{p99:2,max:40},angularOutliers:1,localized:[point],woundROI:{samples:[{dg:{g:[.2,.1,.3]}}]}};
  assert.match(normalAngularFailure(result),/requires localized/);
  assert.equal(normalAngularFailure(result,{technicalBeautyReviewed:true}),null);
  assert.match(normalAngularFailure({...result,angularDegrees:{p99:6,max:40}},{technicalBeautyReviewed:true}),/p99/);
  const changedOwner=structuredClone(result);changedOwner.localized[0].detailBreakdown.tetra[0].noisy[1]=6;
  assert.match(normalAngularFailure(changedOwner,{technicalBeautyReviewed:true}),/owner/);
  const wrongNoise=structuredClone(result);wrongNoise.localized[0].detailBreakdown.noiseOnly[0]=0;
  assert.match(normalAngularFailure(wrongNoise,{technicalBeautyReviewed:true}),/noise/);
  const wrongGradient=structuredClone(result);wrongGradient.localized[0].analytic[1]=.5;
  assert.match(normalAngularFailure(wrongGradient,{technicalBeautyReviewed:true}),/gradient/);
  assert.match(normalAngularFailure({...result,localized:[]},{technicalBeautyReviewed:true}),/missing/);
});


import { settleNormalLegacy } from './normal-gradient-intact.mjs';
test('bounded legacy settling retains first stale frame and requires two equal reads', async()=>{
  const r=await settleNormalLegacy(async i=>({data:new Float32Array([i===0?0:1])}),async()=>({camera:[1]}));
  assert.equal(r.settling.length,3);assert.equal(r.settling[1].changed,1);assert.equal(r.settling[2].changed,0);
});
test('stable output cannot conceal changing camera or packed geometry', async()=>{
  let state=0;
  await assert.rejects(settleNormalLegacy(async()=>({data:new Float32Array([1])}),async()=>({packed:[state++]})),/four-read cap/);
});
test('legacy settling fails at four reads on persistent drift or nonfinite output',async()=>{
  let reads=0;await assert.rejects(settleNormalLegacy(async()=>({data:new Float32Array([reads++])}),async()=>({})),/four-read cap/);assert.equal(reads,4);
  await assert.rejects(settleNormalLegacy(async()=>({data:new Float32Array([NaN])}),async()=>({})),/four-read cap/);
});

test('raw transport reconstructs exact bytes with bounded CDP slices and rejects truncation', async()=>{
  const { readNormalRaw }=await import('./normal-gradient-intact.mjs');
  const bytes=Buffer.alloc(32);for(let i=0;i<bytes.length;i++)bytes[i]=i*7;
  const rgba32f=bytes.toString('base64');let hash=0x811c9dc5;for(const c of rgba32f)hash=Math.imul(hash^c.charCodeAt(0),0x01000193)>>>0;const calls=[];
  const evaluate=async expression=>{
    calls.push(expression);
    if(expression.startsWith('(async()=>'))return {w:2,h:1,chars:rgba32f.length,hash};
    const [,a,b]=expression.match(/slice\((\d+),(\d+)\)/);return rgba32f.slice(+a,+b);
  };
  const raw=await readNormalRaw(evaluate,8);
  assert.deepEqual(Buffer.from(raw.rgba32f,'base64'),bytes);
  assert.equal(calls.length,1+Math.ceil(rgba32f.length/8));
  await assert.rejects(readNormalRaw(async e=>e.startsWith('(async()=>')?{w:2,h:1,chars:rgba32f.length,hash:0}:rgba32f,262144),/hash/);
  await assert.rejects(readNormalRaw(async expression=>expression.startsWith('(async()=>')?{w:2,h:1,chars:rgba32f.length}:'',8),/incomplete/);
  await assert.rejects(readNormalRaw(async()=>({w:2,h:1,chars:1})),/metadata/);
});
