import { stageCloseUp, stampFacingWounds } from './sdf-closeup-stage.mjs';

// These wrappers must never inherit the staging library's process.exit
// default: thrown errors reach the driver's clock cleanup and JSON/tab finally.
const throwStageFailure = message => { throw new Error(message); };
export const stageNormalCloseup = (evaluate, options = {}) => stageCloseUp(evaluate, options, throwStageFailure);
export const stampNormalWounds = (evaluate, options = {}) => stampFacingWounds(evaluate, options, throwStageFailure);

/** Explicit anatomy masks from the staged body's uploaded primitive ownership.
 * Only reason-coded target hits enter these counts; foreign-body sentinel RGB
 * and zero background are excluded. Unknown/internal owner rows are not flesh. */
export function normalAnatomyCoverage(rgba, ownerLimbs) {
  const regions = {
    head:{hits:0,analytic:0,fallback:0,analyticFraction:0},
    torso:{hits:0,analytic:0,fallback:0,analyticFraction:0},
  };
  for (let i=0; i<rgba.length; i+=4) {
    const reason=rgba[i],owner=rgba[i+2];
    if (!Number.isInteger(reason)||reason<1||reason>8||!Number.isInteger(owner)||owner<0) continue;
    const region=regions[ownerLimbs[owner]];
    if (!region) continue;
    region.hits++;
    if(reason===1) region.analytic++; else region.fallback++;
  }
  for(const region of Object.values(regions)) region.analyticFraction=region.hits ? region.analytic/region.hits : 0;
  return regions;
}

export function normalOrbitPose(bodyPos, angle, distance, aimY, eyeY) {
  const x=bodyPos[0]+Math.sin(angle)*distance;
  const z=bodyPos[2]+Math.cos(angle)*distance;
  const dx=bodyPos[0]-x,dz=bodyPos[2]-z;
  return {x,z,yaw:Math.atan2(dx,-dz),pitch:Math.atan2(aimY-eyeY,Math.hypot(dx,dz))};
}

/** Keep other actors' geometry and occlusion intact while making their RGB
 * unambiguously outside the eligibility reason range. This uses the existing
 * flat-albedo seam, changes only the eligibility pass, and restores exact values.
 * Body and detached-piece keys are distinct even when numeric ids coincide. */
export async function withNormalBodyMask(evaluate, bodyId, readFrame) {
  const key=Number.isInteger(bodyId)?`body:${bodyId}`:bodyId;
  if(typeof key!=='string'||!/^(body|chunk):[0-9]+$/.test(key))throw new Error('missing staged piece identity');
  try {
    await evaluate(`(() => {
      const modern=typeof __sdfGame.normalGradientPieces==='function';
      if(!modern&&__sdfGame.chunkCount!==0)throw new Error('chunk identity API required');
      const pieces=modern?__sdfGame.normalGradientPieces():__sdfGame.zombies().map(b=>({key:'body:'+b.id,id:b.id}));
      const key=${JSON.stringify(key)};
      if(!pieces.some(p=>p.key===key))throw new Error('staged piece does not exist');
      window.__ngBodyMask=[];
      for (const piece of pieces) {
        if(piece.key===key)continue;
        const u=(modern?__sdfGame.normalGradientPiece(piece.key):__sdfGame.zombie(piece.id).view).uniforms;
        window.__ngBodyMask.push({u,color:u.baseColor.value.toArray(),flat:u.debugCfg.value.y});
        u.baseColor.value.setRGB(-1,-1,-1);u.debugCfg.value.y=1;
      }
      return true;
    })()`);
    return await readFrame();
  } finally {
    await evaluate(`(() => {
      for(const s of window.__ngBodyMask??[]) {s.u.baseColor.value.setRGB(...s.color);s.u.debugCfg.value.y=s.flat;}
      delete window.__ngBodyMask;
      return true;
    })()`);
  }
}

// The largest emitted owner index is below 128. At the shipped smear .25,
// 20 identical zero-dt frames attenuate any diagnostic color history below
// 128*.25^20 < 1.2e-10. Other smear settings require a separate capture contract.
export function normalBeautyFrames(smear) {
  if (smear !== .25) throw new Error(`expected shipped smear 0.25, got ${smear}`);
  return 20;
}

export function normalCoverageFailure(result, { woundControl = false } = {}) {
  if(woundControl) return Object.entries(result.reasons).some(([reason,count])=>reason!=='ok'&&count>0) ? null : `${result.name}: no wound fallback pixels`;
  return result.reasons.ok<100||result.analyticFraction<.1 ? `${result.name}: analytic coverage below 10% probe floor` : null;
}

/** Controller-reviewed exception to the legacy-stencil max-angle heuristic.
 * Numeric correctness, full-stencil owner identity and the SAME noise term
 * remain mandatory. This does not record owner look acceptance. */
export function normalAngularFailure(result,{technicalBeautyReviewed=false}={}) {
  if(result.angularDegrees.p99>5)return `${result.name}: legacy normal p99 exceeds 5 degrees`;
  if(result.angularDegrees.max<=25)return null;
  if(!technicalBeautyReviewed)return `${result.name}: >25deg review flag requires localized proof and technical beauty review`;
  if(!result.angularOutliers||result.localized.length<result.angularOutliers)return `${result.name}: missing localized outlier proof`;
  const norm=v=>Math.hypot(...v),delta=(a,b)=>norm(a.map((v,i)=>v-b[i]));
  for(let i=0;i<result.localized.length;i++) {
    const p=result.localized[i],g=p.analytic.slice(1),cpu=result.woundROI?.samples[i]?.dg.g;
    if(p.state[0]!==0||Math.abs(p.analytic[0]-p.scalar[0])>1e-5||!cpu||delta(g,cpu)>2e-3||!p.epsilons.some(e=>e.epsilon<=.0005&&delta(e.gradient,g)<2e-3))return `${result.name}: localized gradient proof failed`;
    const d=p.detailBreakdown;
    if(!d||d.tetra.length!==4||d.tetra.some(t=>t.geometric[1]!==p.state[1]||t.noisy[1]!==p.state[1]))return `${result.name}: localized owner proof failed`;
    if(delta(d.fullTetra,d.geometricTetra.map((v,k)=>v+d.noiseOnly[k]))>5e-4||delta(d.combined,g.map((v,k)=>v+d.noiseOnly[k]))>2e-6)return `${result.name}: localized noise proof failed`;
  }
  return null;
}

/** The first frozen render after an impact may still contain old GPU data.
 * Require two equal raw frames AND exact scene-state equality; never hide an
 * unbounded renderer/state drift behind extra warmup frames. */
export async function settleNormalLegacy(readFrame, readState) {
  const settling=[];let previous=null,previousState=null;
  for(let attempt=0;attempt<4;attempt++) {
    const before=await readState(),raw=await readFrame(attempt),after=await readState();
    const stateStable=JSON.stringify(before)===JSON.stringify(after)&&(!previousState||JSON.stringify(previousState)===JSON.stringify(after));
    let changed=0,max=0;
    if(previous) {
      if(previous.data.length!==raw.data.length)throw new Error('legacy target dimensions changed');
      for(let i=0;i<raw.data.length;i++)if(!Number.isFinite(raw.data[i])||!Object.is(previous.data[i],raw.data[i])){changed++;max=Math.max(max,Math.abs(previous.data[i]-raw.data[i]));}
    }
    settling.push({attempt,stateStable,changed:previous?changed:null,max:previous?max:null});
    if(previous&&stateStable&&changed===0)return {frame:raw,state:after,settling};
    previous=raw;previousState=after;
  }
  throw new Error(`no two identical legacy reads within four-read cap: ${JSON.stringify(settling)}`);
}
