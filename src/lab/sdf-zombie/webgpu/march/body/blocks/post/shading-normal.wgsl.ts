// src/lab/sdf-zombie/webgpu/march/body/blocks/post/shading-normal.wgsl.ts
//
// Task-3 split of the march body (2026-09-19): rest-space anchor and the shading normal (post-hit).
// MOVE-ONLY: spliced back into its parent string by interpolation, so the
// joined WGSL is byte-identical. See docs/dev-notes/2026-09-18-march-split/.

export const SHADING_NORMAL_BLOCK = /* wgsl */ `  // Silhouette noise into the normal, scaled by (1 - max(gloss, metal)) at
  // the point of application: a polished or machined prim has no pits. The
  // AO and scatter probes below keep the FULL marchCfg.z — they probe the
  // real displaced field (fbm at frequency 3, features ~0.2 m), not surface
  // detail, and the march loop runs the field smooth regardless. At
  // gloss 0 / metal 0 this argument is exactly what it always was.
  // MERGE (hard-surface task 3, resolving main's melt): calcNormal's amp is
  // now a vec4 — x silhouette, y/z/w the MELT components. Only x carries the
  // gloss/metal kill; melt amplitude is a transient effect the owner drives
  // deliberately, not flesh pore detail, and task 1's contract was noise
  // suppression of the flesh's own texture, so meltCfg passes through
  // untouched. At gloss 0 / metal 0 / melt 0 the vec4 is byte-identical to
  // the pre-both-changes call.
  // The hit pixel's REST-space noise anchor (task 6): every fbm below —
  // micro-detail, gore mottle — samples the dominant prim's rest frame, so
  // the surface texture rides the limb through gait and jiggle. Computed
  // once here; the fallback keeps the old root-shift anchor for bodies with
  // no rest rows (the FPV hands view).
  // HOISTED above the shading normal (close-up task 2) — the forward-
  // difference mode rebuilds its stencil base from this anchor, so the
  // anchor must exist before the normal runs. restPoint and noiseLocal are
  // pure reads, so hoisting them cannot move a pixel, and the mode-0 branch
  // below is byte-for-byte the pre-task-2 call.
  let anchor = restPoint(p, data, hitBest, noiseLocal(p, noiseShift), gBand);
  var n = vec3<f32>(0.0);
  var ngValid = false;
  var ngReason = 7;
  var ngScalar = 0.0;
  // CROWD (2026-09-14): the analytic gradient runs for single- AND multi-slot
  // draws. ngBody no longer reloads a hard-coded slot 0 — that clobbered the
  // hit slot POST pins just above and returned slot 0's field for every other
  // instance (probe: dot(analytic, FD) 1.0 for slot 0, ~ -0.42 otherwise). It
  // now reads whatever slot the caller loaded, so the gradient is the hit
  // instance's own. The finite-difference path below remains the fallback for
  // unsupported fields and as the debug comparison.
  gNgDebugMask = u32(max(normalGradientCfg.z, 0.0));
  if (normalGradientCfg.x > 0.5) {
    let noiseAmplitude = marchCfg.z * (1.0 - max(gloss, metal));
    let ng = ngBody(p, data, vec4<f32>(noiseAmplitude, 0.0, 0.0, 0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, perfCfg, inst, instCfg);
    ngReason = gNgReason;
    ngScalar = ng.x;
    if (ngReason == 0) {
      var candidate = ng.yzw;
      if ((gNgDebugMask & 8u) == 0u) { candidate = candidate + ngDetail(p, data, gNgOwner, noiseShift, noiseAmplitude); }
      let magnitude2 = dot(candidate, candidate);
      // Comparisons reject NaN and infinity as well as a collapsed gradient.
      ngValid = magnitude2 > 1e-12 && magnitude2 < 1e12;
      if (ngValid) { n = normalize(candidate); } else { ngReason = 2; }
    }
  }
  if (!ngValid) {
    n = calcNormal(p, data, vec4<f32>(marchCfg.z * (1.0 - max(gloss, metal)), 0.0, 0.0, 0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg);
  }
  // DEBUG MODE 12 (crowd diagnostics 2026-09-14): slot, analytic reason, dot(analytic n, finite-difference n).
  if (debugCfg.x > 11.5 && debugCfg.x < 12.5) {
    let nFD = calcNormal(p, data, vec4<f32>(marchCfg.z * (1.0 - max(gloss, metal)), 0.0, 0.0, 0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg);
    return vec4<f32>(f32(gHitSlot), f32(ngReason), dot(n, nFD), t);
  }
  // Raw diagnostic RGB bypasses later detail/shading; outputNode still writes
  // the identical clip depth. Eligibility 0 is background, 1 is analytic.
  if (normalGradientCfg.y > 1.5) {
    return vec4<f32>(f32(ngReason + 1), select(0.0, ngScalar - hitField.x, ngValid), f32(hitBest), t);
  }
  if (normalGradientCfg.y > 0.5) { return vec4<f32>(n * 0.5 + 0.5, t); }`;
