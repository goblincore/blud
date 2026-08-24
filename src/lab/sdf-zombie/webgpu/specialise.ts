// src/lab/sdf-zombie/webgpu/specialise.ts
//
// PARTIAL EVALUATION of the field, after Chevalier-Boisvert's post on
// optimising ray marching. His proposal specialises per frustum quadrant as
// the camera moves, and he is openly unsure that recompiling on every camera
// move is viable — it is not, for us. Specialising on the body's STRUCTURE is,
// because structure barely changes.
//
// The generic mapBody is an interpreter. Per march step, per primitive, it:
//
//   - reads three texels to find out what the primitive IS,
//   - checks a dynamic loop bound,
//   - branches on whether the primitive is a carve or additive,
//   - and indirects through a cluster range to know where the run ends.
//
// All four are decided by the body's structure, which changes only when the
// body is REBUILT — a panel edit. It does not change when the rig jiggles
// (that moves endpoint VALUES, still read from the texture) and it does not
// change on a whole-limb sever, because the alive flag is still read at
// runtime below. A per-prim dead flag (mid-limb sever) DOES regenerate — the
// fold calls are literals here, so the prim must be baked out.
// So the loops unroll, the bounds vanish, the carve branch is decided at
// generation time, and the blend constants become literals.
//
// FOLD ORDER IS THE WHOLE CORRECTNESS ARGUMENT. smin is not associative, so
// the emitted order must match the generic version exactly: clusters in id
// order, primitives in array order, additive fold complete before any carve.
// Reordering here would silently change the surface everywhere.

import type { BuildResult } from '../build-body';
import { ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE } from './march.wgsl';

/** WGSL float literal with enough digits to round-trip an f32. */
function f(n: number): string {
  return Number.isFinite(n) ? n.toPrecision(9) : '0.0';
}

/**
 * Emits a specialised `mapBody` for one body's structure.
 *
 * Signature and semantics match the generic MAP_BODY exactly, so the two are
 * interchangeable and can be measured against each other. `counts` is still a
 * parameter even though its values are baked — keeping the signature identical
 * means the entry point does not need a second variant.
 */
export function specialiseMapBody(body: BuildResult): string {
  // Per-prim ORIENTATION GUARD (motion-polish task 3): sdPrim reads the quat
  // row from the texture at runtime, so orient is never baked as a literal —
  // but a prim whose quat CHANGES at runtime (rig-posed skull prims) must not
  // be specialised at all: hero bodies are rig-driven and re-uploaded every
  // frame, which is exactly why they are never specialised. Crowd and chunk
  // bodies always have identity/absent orient. ASSERT that assumption rather
  // than silently specialising a body whose field would drift from its pose.
  for (const p of body.prims) {
    if (p.orient && Math.abs(1 - p.orient[3]) > 1e-6)
      throw new Error(
        'specialiseMapBody: non-identity prim orient — rig-posed bodies must use the generic march');
  }
  const maxBlendK = body.prims.reduce((m, p) => Math.max(m, p.blendK), 0);
  const margin = maxBlendK * 4;

  const lines: string[] = [];
  lines.push(
    'fn mapBody(p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, ' +
    'noiseAmp: f32, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, noiseShift: vec3<f32>, ' +
    'volumeTex: texture_3d<f32>, volumePose0: vec4<f32>, volumePose1: vec4<f32>, ' +
    'volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>, ' +
    'volumeClip: vec4<f32>) -> vec4<f32> {',
  );
  lines.push('  var d = 1e9;');
  // Argmin tracking (motion-polish task 6), same contract as the generic
  // version: y of the return carries the dominant prim for the rest-space
  // noise anchor. The REST endpoints are read from the texture at runtime
  // (rows 8/9), exactly like the posed endpoints — nothing structural is
  // baked, so no new guard is needed beyond the orient one above.
  lines.push('  var best = 1e9;');
  lines.push('  var bestIdx = -1;');
  lines.push('  var sd = 0.0;');
  // Volume branch (X1.26), same as the generic version: specialised bodies
  // (crowd/chunks) never enable it, but the emitted shader must still branch
  // on the flag rather than silently marching prims a caller meant to replace
  // with the baked volume.
  lines.push('  if (volumePose0.w > 0.5) {');
  lines.push('    d = sampleHandVolume(p, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip);');
  lines.push('  } else {');

  // --- additive fold, cluster by cluster ------------------------------------
  body.clusters.forEach((c, ci) => {
    const additive = [];
    for (let i = c.start; i < c.start + c.count; i++) {
      const p = body.prims[i];
      if (p && p.op !== 'sub' && !p.dead) additive.push(i);
    }
    if (additive.length === 0) return;

    lines.push(`  {`);
    // Alive is read at RUNTIME, not baked: severing flips it every time a limb
    // comes off, and regenerating a shader per sever would mean a pipeline
    // compile mid-gib.
    lines.push(`    let range = textureLoad(data, vec2<i32>(${ci}, ${ROW_CLUSTER_RANGE}), 0);`);
    lines.push(`    let bounds = textureLoad(data, vec2<i32>(${ci}, ${ROW_CLUSTER_BOUNDS}), 0);`);
    // Same cull as the generic version, including the 4x on maxBlendK: smin
    // scales k by 4 internally, so a cluster still bends the surface from four
    // times the authored blendK away.
    lines.push(
      `    if (range.z >= 0.5 && length(p - bounds.xyz) - bounds.w <= d + ${f(margin)}) {`,
    );
    for (const i of additive) {
      // One sd evaluation feeds BOTH the smin fold and the argmin tracker —
      // the generic version's exact structure, with the index as a literal.
      // The debug prim counter rides along (task 2 parity): a specialised
      // crowd body must count the same work the generic fold counts, or a
      // heatmap taken with ?specialise=1 would lie.
      lines.push(`      if (gDebugMode > 0.5) { gDebugPrims = gDebugPrims + 1.0; }`);
      lines.push(`      sd = sdPrim(p, ${i}, data);`);
      lines.push(`      if (sd < best) { best = sd; bestIdx = ${i}; }`);
      lines.push(`      d = smin(d, sd, ${f(body.prims[i]!.blendK)});`);
    }
    lines.push(`    }`);
    lines.push(`  }`);
  });

  // --- carves, AFTER the complete additive fold -----------------------------
  // Same structure as applyCarves: carving per-cluster would restructure a
  // non-associative fold and change the surface everywhere.
  body.clusters.forEach((c, ci) => {
    const carves = [];
    for (let i = c.start; i < c.start + c.count; i++) {
      const p = body.prims[i];
      if (p && p.op === 'sub' && !p.dead) carves.push(i);
    }
    if (carves.length === 0) return;

    lines.push(`  {`);
    lines.push(`    let range = textureLoad(data, vec2<i32>(${ci}, ${ROW_CLUSTER_RANGE}), 0);`);
    lines.push(`    if (range.z >= 0.5) {`);
    for (const i of carves) {
      lines.push(`      d = smax(d, -sdPrim(p, ${i}, data), ${f(body.prims[i]!.blendK)});`);
    }
    lines.push(`    }`);
    lines.push(`  }`);
  });

  lines.push('  }');
  // applyWounds returns (field, nearWound); the flag rides mapBody.z so the
  // shared march steps plain near wounds on specialised bodies too.
  lines.push('  let dw = applyWounds(d, p, data, woundCfg, woundCfg2);');
  lines.push('  d = dw.x;');
  // Same guard as the generic version: the silhouette fbm is the single most
  // expensive term in the shader and must stay branched out at zero amplitude.
  lines.push('  if (noiseAmp <= 0.0) { return vec4<f32>(d, f32(bestIdx), dw.y, 0.0); }');
  // Same rest-space noise anchor as the generic version — the fbm samples
  // the dominant prim's REST frame, with noiseLocal as the fallback.
  lines.push('  let anchor = restPoint(p, data, bestIdx, noiseLocal(p, noiseShift));');
  lines.push('  return vec4<f32>(d + fbm(anchor * 3.0) * noiseAmp, f32(bestIdx), dw.y, 0.0);');
  lines.push('}');
  return lines.join('\n');
}

/**
 * A key that changes exactly when the specialised shader would differ.
 *
 * Used to avoid regenerating — and therefore recompiling a pipeline — when
 * nothing structural moved. Deliberately excludes endpoint positions: those
 * change every frame with the rig and are still read from the texture. The
 * cluster alive flag is excluded too (read at runtime); the per-prim DEAD
 * flag is NOT — dead prims are baked out of the fold, so a mid-limb sever
 * regenerates, one compile per sever.
 */
export function structureKey(body: BuildResult): string {
  return body.clusters.map(c => `${c.start}:${c.count}`).join(',') + '|' +
    body.prims.map(p =>
      `${p.dead ? (p.op === 'sub' ? 'S' : 'D') : p.op === 'sub' ? 's' : 'a'}${p.blendK}`).join(',');
}
