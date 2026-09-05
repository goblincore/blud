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
 * Detached chunks have no actor id through this API, so reject that fixture. */
export async function withNormalBodyMask(evaluate, bodyId, readFrame) {
  if (!Number.isInteger(bodyId)) throw new Error('missing staged body identity');
  try {
    await evaluate(`(() => {
      if (__sdfGame.chunkCount !== 0) throw new Error('anatomy fixture must have zero detached chunks');
      const bodies=__sdfGame.zombies();
      if (!bodies.some(b=>b.id===${bodyId})) throw new Error('staged body does not exist');
      window.__ngBodyMask=[];
      for (const b of bodies) {
        if(b.id===${bodyId}) continue;
        const u=__sdfGame.zombie(b.id).view.uniforms;
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
  if(woundControl) return result.reasons['wound-pending']>0 ? null : `${result.name}: no wound fallback pixels`;
  return result.reasons.ok<100||result.analyticFraction<.1 ? `${result.name}: analytic coverage below 10% probe floor` : null;
}
