import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStaticNormalScenes,persistNormalEligibility } from './normal-gradient-performance.mjs';

test('both primary timing sets checkpoint before either eligibility capture',async()=>{
  const scenes=['intact-torso','wounded-torso','intact-head'].map(name=>({name,status:'unmeasured'}));
  const events=[];
  const result=await runStaticNormalScenes(scenes,{
    measure:async scene=>{events.push('timing '+scene.name);return {status:'measured',summary:{clearRegression:true}};},
    capture:async scene=>{events.push('coverage '+scene.name);return {pixels:123};},
    save:()=>{events.push('checkpoint '+scenes.filter(s=>s.status==='measured').map(s=>s.name).join(','));},
  });
  const firstCoverage=events.findIndex(x=>x.startsWith('coverage'));
  assert.ok(events.indexOf('timing wounded-torso')<firstCoverage);
  assert.ok(events.indexOf('checkpoint intact-torso,wounded-torso')<firstCoverage);
  assert.deepEqual(events.filter(x=>x.startsWith('coverage')),['coverage intact-torso','coverage wounded-torso']);
  assert.equal(result.status,'no-go');assert.equal(scenes[2].status,'unmeasured');
});

test('zero and sub-threshold eligibility retain raw bytes and actual metrics before rejecting',()=>{
  const dir=mkdtempSync(join(tmpdir(),'normal-coverage-evidence-'));
  try {
    for(const hits of [0,1]) {
      const data=new Float32Array(4*4);if(hits)data.set([1,0,0,.5]);
      const bytes=Buffer.from(data.buffer),scene='intact-torso';
      assert.throws(()=>persistNormalEligibility({w:2,h:2,rgba32f:bytes.toString('base64')},{scene,body:1,outDir:dir,ownerLimbs:['torso'],parity:{depthChanged:0}}),/eligibility|coverage/);
      assert.deepEqual(readFileSync(join(dir,scene+'-eligibility.rgba32f')),bytes);
      const record=JSON.parse(readFileSync(join(dir,scene+'-eligibility.json'),'utf8'));
      assert.deepEqual(record.target,{width:2,height:2});assert.equal(record.pixels,hits);assert.equal(record.targetCoverage,hits/4);
      assert.equal(record.reasons[0],hits);assert.equal(record.validation,'fail');assert.ok(record.reason);
      assert.equal(record.wholeBody.analyticFraction,hits?1:null);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
