import assert from 'node:assert/strict';
import test from 'node:test';
import { pairLoadFailure, collectNormalPairs, summarizeNormalPairs } from './normal-gradient-verdict.mjs';

const leg = (mode, extra = {}) => ({ mode, loadStart: 5, loadEnd: 6, valid: true, hiddenSteps: 0, frames: 240, chunkFrames: 10, samples: Array(24).fill(mode ? 12 : 10), state: 'matched', ...extra });
test('both endpoints and absolute drift reject a complete pair', () => {
  assert.equal(pairLoadFailure([leg(0),leg(1)]), null);
  for (const bad of [{loadStart:13,loadEnd:10},{loadStart:10,loadEnd:5},{loadStart:5,loadEnd:13},{loadStart:NaN}]) assert.ok(pairLoadFailure([leg(0),leg(1,bad)]));
});
test('pair rejection discards the good sibling, alternates order, caps three replacements', async () => {
  const calls=[];
  const result=await collectNormalPairs(async(mode,attempt)=>{calls.push([attempt,mode]);return leg(mode,attempt<2&&mode===1?{loadEnd:13}:{});});
  assert.equal(result.accepted.length,5); assert.equal(result.rejected.length,2);
  assert.deepEqual(calls.slice(0,4),[[0,0],[0,1],[1,1],[1,0]]);
  const blocked=await collectNormalPairs(async(mode)=>leg(mode,{loadEnd:13}));
  assert.equal(blocked.accepted.length,0);assert.equal(blocked.rejected.length,8);assert.equal(blocked.status,'deferred');
});
test('invalid samples, hidden frames and unmatched fixtures never become timing evidence', async () => {
  for(const bad of [{hiddenSteps:1},{frames:239},{samples:Array(24).fill(0)},{state:'different'},{valid:false}]) {
    const result=await collectNormalPairs(async mode=>leg(mode,mode?bad:{}));assert.equal(result.accepted.length,0);
  }
});
test('summary retains pooled chunk percentiles and each paired difference; insufficient pairs cannot pass', () => {
  const pairs=Array.from({length:5},(_,attempt)=>({attempt,legs:[leg(0),leg(1)]}));
  const s=summarizeNormalPairs(pairs);assert.equal(s.hybrid.p99,12);assert.equal(s.legacy.p50,10);
  assert.equal(s.paired.length,5);assert.equal(s.paired[0].meanPercent,20);assert.equal(s.clearRegression,true);
  assert.equal(summarizeNormalPairs(pairs.slice(0,4)).clearRegression,false);
});
