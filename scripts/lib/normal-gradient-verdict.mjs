/** Task 5 protocol arithmetic. Samples are fenced ten-frame CHUNK MEANS. */
export function pairLoadFailure(legs) {
  for (const leg of legs) {
    if (![leg.loadStart,leg.loadEnd].every(Number.isFinite)) return 'missing finite load endpoint';
    if (Math.max(leg.loadStart,leg.loadEnd)>12) return 'load endpoint exceeds 12';
    if (Math.abs(leg.loadEnd-leg.loadStart)>4) return 'absolute load drift exceeds 4';
  }
  return null;
}
export function summarizeSamples(samples) {
  const s=[...samples].sort((a,b)=>a-b), n=s.length;
  if(!n)return null;
  const at=q=>s[Math.min(n-1,Math.floor(q*n))];
  return {n,p50:at(.5),p95:at(.95),p99:at(.99),mean:s.reduce((a,b)=>a+b,0)/n,min:s[0],max:s[n-1]};
}
export function summarizeNormalPairs(pairs) {
  const samples=mode=>pairs.flatMap(p=>p.legs.find(l=>l.mode===mode).samples);
  const paired=pairs.map(p=>{
    const a=summarizeSamples(p.legs.find(l=>l.mode===0).samples),b=summarizeSamples(p.legs.find(l=>l.mode===1).samples);
    return {attempt:p.attempt,meanMs:b.mean-a.mean,meanPercent:100*(b.mean-a.mean)/a.mean,p50Ms:b.p50-a.p50,p95Ms:b.p95-a.p95,p99Ms:b.p99-a.p99};
  });
  const deltas=paired.map(p=>p.meanMs),delta=summarizeSamples(deltas);
  // Conservative stop signal only, never an automatic shipping approval.
  const clearRegression=pairs.length>=5&&Math.min(...deltas)>0&&paired.every(p=>p.meanPercent>3)&&delta.min>delta.max-delta.min;
  return {legacy:summarizeSamples(samples(0)),hybrid:summarizeSamples(samples(1)),paired,delta,clearRegression};
}
function pairFailure(legs) {
  const load=pairLoadFailure(legs);if(load)return load;
  if(legs.length!==2||new Set(legs.map(l=>l.mode)).size!==2)return 'missing paired modes';
  for(const l of legs) {
    if(!l.valid||l.hiddenSteps!==0)return 'invalid/hidden bench';
    if(l.frames<240||l.chunkFrames!==10||l.samples.length<24||!l.samples.every(x=>Number.isFinite(x)&&x>0))return 'insufficient or nonpositive chunk timing';
  }
  if(legs[0].state!==legs[1].state)return 'unmatched seeded fixture';
  return null;
}
export async function collectNormalPairs(runLeg,onPair=()=>{}) {
  const result={status:'deferred',accepted:[],rejected:[]};
  for(let attempt=0;attempt<8&&result.accepted.length<5;attempt++) {
    const pair={attempt,order:attempt%2?[1,0]:[0,1],legs:[]};
    for(const mode of pair.order)pair.legs.push(await runLeg(mode,attempt));
    pair.reason=pairFailure(pair.legs);
    (pair.reason?result.rejected:result.accepted).push(pair);
    await onPair(pair,result);
  }
  result.status=result.accepted.length>=5?'measured':'deferred';
  result.summary=summarizeNormalPairs(result.accepted);
  return result;
}
