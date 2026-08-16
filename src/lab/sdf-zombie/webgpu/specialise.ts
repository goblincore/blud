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
// change on a sever, because the alive flag is still read at runtime below.
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
  const maxBlendK = body.prims.reduce((m, p) => Math.max(m, p.blendK), 0);
  const margin = maxBlendK * 4;

  const lines: string[] = [];
  lines.push(
    'fn mapBody(p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, ' +
    'noiseAmp: f32, woundCfg: vec4<f32>, woundCfg2: vec4<f32>) -> f32 {',
  );
  lines.push('  var d = 1e9;');

  // --- additive fold, cluster by cluster ------------------------------------
  body.clusters.forEach((c, ci) => {
    const additive = [];
    for (let i = c.start; i < c.start + c.count; i++) {
      const p = body.prims[i];
      if (p && p.op !== 'sub') additive.push(i);
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
      lines.push(`      d = smin(d, sdPrim(p, ${i}, data), ${f(body.prims[i]!.blendK)});`);
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
      if (p && p.op === 'sub') carves.push(i);
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

  lines.push('  d = applyWounds(d, p, data, woundCfg, woundCfg2);');
  // Same guard as the generic version: the silhouette fbm is the single most
  // expensive term in the shader and must stay branched out at zero amplitude.
  lines.push('  if (noiseAmp <= 0.0) { return d; }');
  lines.push('  return d + fbm(p * 3.0) * noiseAmp;');
  lines.push('}');
  return lines.join('\n');
}

/**
 * A key that changes exactly when the specialised shader would differ.
 *
 * Used to avoid regenerating — and therefore recompiling a pipeline — when
 * nothing structural moved. Deliberately excludes endpoint positions: those
 * change every frame with the rig and are still read from the texture.
 */
export function structureKey(body: BuildResult): string {
  return body.clusters.map(c => `${c.start}:${c.count}`).join(',') + '|' +
    body.prims.map(p => `${p.op === 'sub' ? 's' : 'a'}${p.blendK}`).join(',');
}
