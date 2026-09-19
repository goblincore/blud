// src/lab/sdf-zombie/webgpu/march/fields/carves.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): carve/noise anchor helpers.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.
import { ROW_CLUSTER_RANGE, ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_BEND, ROW_PRIM_QUAT, ROW_PRIM_SCALE, ROW_PRIM_SHAPE, ROW_REST_A, ROW_REST_B } from '../layout';

// REST-SPACE NOISE ANCHOR (motion-polish task 6). Maps a world point into the
// DOMINANT primitive's rest frame — translation between capsule midpoints,
// rotation = shortest arc from the posed axis to the rest axis. Where the
// prim carries an orient quat (rig-posed skull prims, ROW_PRIM_QUAT) its
// CONJUGATE is composed UNDER the axis swing: the conjugate is the exact
// local frame (applyRig rotates those prims' endpoints by that same quat, so
// the residual swing is the identity) and the swing keeps the mapping honest
// for every other prim.
//
// ROLL about the capsule axis is unresolved by design — a shortest-arc swing
// picks any roll — and that is fine: the fbm is statistical, so a consistent
// but arbitrary roll reads as the same flesh. Seams where the DOMINANT prim
// flips between neighbours are the accepted cost (owner sign-off); they were
// checked in the browser and are not visually loud.
//
// Fallbacks: best < 0 (no live prim — gibbed corpse) or restA.w <= 0 (rest
// rows never written — the FPV hands view packs its own field) return the
// caller's fallback, which is the old noiseLocal anchor. Degenerate capsules
// (a == b point prims, e.g. the nose ball) skip the swing and map by
// translation plus the orient frame alone.
export const REST_POINT = /* wgsl */ `fn restPoint(p: vec3<f32>, data: texture_2d<f32>, best: i32, fallback: vec3<f32>, band: i32) -> vec3<f32> {
  if (best < 0) { return fallback; }
  let ra = textureLoad(data, vec2<i32>(best, ${ROW_REST_A} + band), 0);
  if (ra.w <= 0.0) { return fallback; }
  let rb = textureLoad(data, vec2<i32>(best, ${ROW_REST_B} + band), 0);
  let pa = textureLoad(data, vec2<i32>(best, ${ROW_PRIM_A} + band), 0).xyz;
  let pb = textureLoad(data, vec2<i32>(best, ${ROW_PRIM_B} + band), 0).xyz;
  let midP = (pa + pb) * 0.5;
  let midR = (ra.xyz + rb.xyz) * 0.5;
  // The exact local frame first: the conjugate of the packed orient. A zero
  // or identity quat leaves q identity (qRot by it is the identity anyway).
  var q = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  let O = textureLoad(data, vec2<i32>(best, ${ROW_PRIM_QUAT} + band), 0);
  if (abs(1.0 - O.w) > 1e-6) { q = vec4<f32>(-O.xyz, O.w); }
  let axisP = pb - pa;
  let axisR = rb.xyz - ra.xyz;
  let lenP = length(axisP);
  let lenR = length(axisR);
  if (lenP > 1e-6 && lenR > 1e-6) {
    // Swing AFTER the orient frame: qMulQ(swing, q) applies q first.
    q = qMulQ(qFromToV(qRot(q, axisP / lenP), axisR / lenR), q);
  }
  return midR + qRot(q, p - midP);
}`;

// Carves every subtractive primitive out of the assembled field, AFTER the
// complete additive fold and in fixed cluster order — the structure the GLSL
// version uses for wounds. Carving per-cluster would restructure a
// non-associative fold and change the surface everywhere.
export const APPLY_CARVES = /* wgsl */ `fn applyCarves(dIn: f32, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, band: i32) -> f32 {
  var d = dIn;
  if (counts.z < 0.5) { return d; }
  let clusterCount = i32(counts.y);
  let primCount = i32(counts.x);
  for (var c = 0; c < 8; c = c + 1) {
    if (c >= clusterCount) { break; }
    let range = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_RANGE} + band), 0);
    if (range.z < 0.5) { continue; }
    let start = i32(range.x);
    let count = i32(range.y);
    // w: oriented-cluster flag (motion-polish task 3). Hoisting the quat
    // branch to cluster granularity is the measured win — see sdPrimO. The
    // two calls agree bit-for-bit on identity quats, so the CPU mirror
    // (validate.sdBody) branches per prim and stays exact for both.
    let flags = i32(range.w + 0.5);
    let ori = (flags & 1) != 0;
    let shaped = (flags & 2) != 0;
    for (var i = 0; i < 64; i = i + 1) {
      if (i >= count) { break; }
      let idx = start + i;
      if (idx >= primCount) { break; }
      let S = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SCALE} + band), 0);
      // S.w: 0 add, 1 carve, 2 dead (severed mid-limb). Dead prims stop
      // carving too — a severed hand must not keep biting the field it left.
      // 1 = carve, 3 = groove. 0 (additive) and 2 (dead) are skipped.
      let isCarve = S.w > 0.5 && S.w < 1.5;
      // BOUNDED on both sides: W_BONE (4) is greater than the groove code (3),
      // so an open-ended '> 2.5' would carve every bone prim into the flesh as
      // a groove. Bone is folded separately, after wounds — see applyBones.
      let isGroove = S.w > 2.5 && S.w < 3.5;
      if (!isCarve && !isGroove) { continue; }
      let k = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_B} + band), 0).w;
      // The shape row is read on the CARVE path too, not only in mapBody.
      // Skipping it would make a tapered carve a plain capsule in the shader
      // while validate.ts's carve loop honoured the taper: the two fields would
      // disagree, and this one backs click-to-shoot, so shots would land where
      // nothing is drawn.
      //
      // The PROFILE is deliberately not read here. Carving folds through smax,
      // and a chamfered subtraction is a different operator with its own
      // sign conventions — worth having, but not worth guessing at. A
      // chamfer on a carve is rejected at authoring time instead
      // (blob-compile.ts), so this cannot silently do the wrong thing.
      var r2 = -1.0;
      var gr = vec2<f32>(0.0, 0.0);
      var prof = 0.0;
      var cpos = vec3<f32>(0.0, 0.0, 0.0);
      if (shaped) {
        let T = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SHAPE} + band), 0);
        r2 = T.x;
        prof = T.y;
        gr = T.zw;
        // Only genuinely-bent prims pay for the bend row; bit 1 (value 2)
        // encodes bend so a straight SHELL (prof 4) skips it. Keeps every
        // "> 0.5 means chamfer" consumer working unchanged.
        if ((i32(prof) & 2) != 0) {
          cpos = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_BEND} + band), 0).xyz;
        }
      }
      let sd = select(sdPrim(p, idx, data, r2, prof, cpos, band), sdPrimO(p, idx, data, r2, prof, cpos, band), ori);
      if (isGroove) { d = sdGroove(d, sd, gr.x, gr.y); } else { d = smax(d, -sd, k); }
    }
  }
  return d;
}`;
