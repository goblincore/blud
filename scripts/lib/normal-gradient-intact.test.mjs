import assert from 'node:assert/strict';
import test from 'node:test';
import { normalAnatomyCoverage, normalOrbitPose, stageNormalCloseup, stampNormalWounds, withNormalBodyMask, normalBeautyFrames } from './normal-gradient-intact.mjs';

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
