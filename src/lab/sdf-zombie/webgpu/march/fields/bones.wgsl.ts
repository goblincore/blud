// src/lab/sdf-zombie/webgpu/march/fields/bones.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): bone fold and bone application.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.
import { BONE_SEG_MAX, MAX_CLUSTERS, MAX_PRIMS } from '../../../validate';
import { ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE, ROW_PRIM_BEND, ROW_PRIM_SHAPE } from '../layout';

// Folds bone into the field, AFTER wounds have been carved.
//
// A hard `min`, never `smin`: meat meeting bone should crease, because they
// are different materials. A smooth-min here produces a fillet of half-bone
// half-meat that reads as neither.
//
// Bone prims are authored strictly inside the flesh (enforced by
// checkBoneContainment in validate.ts), so `min(flesh, bone) === flesh`
// wherever the flesh is intact. That is what lets mapBody gate this whole
// call on nearWound and have the gate be an EXACT IDENTITY rather than a
// tolerance — undamaged bodies skip it and are bit-identical either way. If
// the containment validator is ever weakened, this gate stops being sound
// and bone fragments will pop in and out as the gate flips.
//
// The loop is BOUNDED, never filtered: it walks the inside-flesh array —
// ORGANS, plus bones only when packBones is on (the shipped default until
// bone tubes ship) — the contiguous rows [counts.x, counts.x + boneCount).
// pack.ts appends them after the flesh and outside every cluster/group run,
// which is also why foldGroup and applyCarves cannot see a row in this range
// even by accident, and no existing consumer had to learn about them.
// boneCount itself rides counts2.x, a uniform added for the purpose: counts
// was already full and woundCfg2.w is the volume hit-epsilon override, NOT
// spare.
//
// Winning the min also claims gFoldBestIdx: shading reads the dominant
// prim's primScale.w and compares to W_ORGAN (5) for the viscera tint.
// foldGroup and applyCarves skip this range entirely, so nothing else can
// have claimed a row in it.
//
// Lives between FOLD_GROUP and MAP_BODY, not next to APPLY_WOUNDS as first
// drafted: it assigns gFoldBestIdx, which is declared at FOLD_GROUP's tail,
// and WGSL wants declaration before use.
// The per-bone fold, extracted OUT of applyBones so the cluster-cull path
// and the flat fallback share ONE loop body (a cull fix or an smin change
// lands in one place). Used to exist inline in applyBones; the plan's
// exactness argument is that the sphere cull is a hard-min no-op, so both
// paths must produce the identical field when the fold reaches the same
// rows. start/count are ABSOLUTE packed indices [start, start+count).
export const FOLD_BONE_RANGE = /* wgsl */ `fn foldBoneRange(dIn: f32, p: vec3<f32>, data: texture_2d<f32>, start: i32, count: i32, band: i32) -> f32 {
  var d = dIn;
  var end = start + count;
  for (var i = start; i < end; i = i + 1) {
    if (i >= ${MAX_PRIMS}) { break; }
    // SHAPE AND BEND, read exactly as foldGroup reads them.
    //
    // These were hard-coded to -1.0 / 0.0 / vec3(0) — no taper, no profile,
    // no bend — so every bone rendered as a straight untapered capsule while
    // the packer faithfully wrote its shape and bend rows. zombie.blob's six
    // rib pairs author bend= up to 0.162; the GPU drew none of it, and two
    // rounds of owner feedback ("horizontal sticks rather than a cage", then
    // "the ribs are still just straight") were tuning curvature that could
    // not reach the screen.
    //
    // Bones sit outside every cluster/group run, so there is no shaped
    // group flag to hoist the decision onto: the shape row is read for every
    // bone, and the bend row only when the profile bit says bent — the same
    // rule foldGroup applies per prim.
    let T = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SHAPE} + band), 0);
    let r2 = T.x;
    let prof = T.y;
    var cpos = vec3<f32>(0.0, 0.0, 0.0);
    if ((i32(prof) & 2) != 0) {
      cpos = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_BEND} + band), 0).xyz;
    }
    if (gDebugMode > 0.5) { gDebugBones = gDebugBones + 1.0; }
    let sd = sdPrim(p, i, data, r2, prof, cpos, band);
    // A hard min, never smin — meat meeting bone should crease. Winning the
    // min claims gFoldBestIdx so shading reads a bone prim's primScale.w.
    if (sd < d) { gFoldBestIdx = f32(i); }
    d = min(d, sd);
  }
  return d;
}`;

export const APPLY_BONES = /* wgsl */ `fn applyBones(dIn: f32, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, boneCount: f32, band: i32, segVolumeAtlas: texture_3d<f32>, segVolumeMeta: texture_2d<f32>) -> f32 {
  var d = dIn;
  let first = i32(counts.x);
  // Data-driven gate (packBoneClusters): the packer writes the bone-cluster
  // texels into the free columns of ROW_CLUSTER_BOUNDS / ROW_CLUSTER_RANGE,
  // and sets the TAIL texel's .w to 1 as an enabled flag. Zeros = the old
  // flat loop, byte-identical. Off, the whole cull is a no-op.
  let tail = textureLoad(data, vec2<i32>(${2 * MAX_CLUSTERS}, ${ROW_CLUSTER_RANGE} + band), 0);
  if (tail.w > 1.5) {
    // MODE 2 — per-SEGMENT spheres (bone-segment spheres): one bound sphere
    // per rigid segment the rig poses bones by (skull, one axial BoneFrame
    // per spine/pelvis segment, one limb bone per bind-point pair, one for
    // the organs), packed at columns 2*MAX_CLUSTERS+1.. of the same two
    // rows. Same EXACT hard-min no-op as the cluster path: bones fold with
    // a hard min against d, the WOUNDED running field, so a segment whose
    // sphere is farther than d * distort can never win the min.
    for (var s = 0; s < ${BONE_SEG_MAX}; s = s + 1) {
      if (s >= i32(tail.z)) { break; }
      let sr = textureLoad(data, vec2<i32>(${2 * MAX_CLUSTERS + 1} + s, ${ROW_CLUSTER_RANGE} + band), 0);
      let sb = textureLoad(data, vec2<i32>(${2 * MAX_CLUSTERS + 1} + s, ${ROW_CLUSTER_BOUNDS} + band), 0);
      if (length(p - sb.xyz) - sb.w > d * sr.z) { continue; }
      let segId = i32(sr.w);
      let gridMeta = textureLoad(segVolumeMeta, vec2<i32>(segId, 0), 0);
      let dimsMeta = textureLoad(segVolumeMeta, vec2<i32>(segId, 1), 0);
      let quatMeta = textureLoad(segVolumeMeta, vec2<i32>(segId, 2), 0);
      let poseMeta = textureLoad(segVolumeMeta, vec2<i32>(segId, 3), 0);
      let sampled = segVolumeDistance(p, gridMeta, dimsMeta, quatMeta, poseMeta, segVolumeAtlas);
      if (sampled.y > 0.5) {
        if (gDebugMode > 0.5) { gDebugVolumeSamples = gDebugVolumeSamples + 1.0; }
        if (sampled.x < d) { gFoldBestIdx = sr.x; }
        d = min(d, sampled.x);
      } else {
        if (gDebugMode > 0.5) { gDebugVolumeFallbacks = gDebugVolumeFallbacks + 1.0; }
        d = foldBoneRange(d, p, data, i32(sr.x), i32(sr.y), band);
      }
    }
    // The tail (overflow segments) folds unconditionally.
    d = foldBoneRange(d, p, data, i32(tail.x), i32(tail.y), band);
  } else if (tail.w > 0.5) {
    // MODE 1 — enabled path: one sphere per flesh cluster's bone range. The cull is
    // the EXACT hard-min no-op — bones fold with a hard min, so a bone whose
    // sphere is farther than the running field d can never win. d here is
    // the WOUNDED field (the call site passes dmg), which is exactly what
    // the exactness argument needs: a far limb's bones must not be culled
    // from a pixel whose flesh is already dragged toward them by a wound.
    for (var c = 0; c < ${MAX_CLUSTERS}; c = c + 1) {
      let cr = textureLoad(data, vec2<i32>(${MAX_CLUSTERS} + c, ${ROW_CLUSTER_RANGE} + band), 0);
      if (cr.y < 0.5) { continue; }
      let cb = textureLoad(data, vec2<i32>(${MAX_CLUSTERS} + c, ${ROW_CLUSTER_BOUNDS} + band), 0);
      if (length(p - cb.xyz) - cb.w > d * cr.z) { continue; }
      d = foldBoneRange(d, p, data, i32(cr.x), i32(cr.y), band);
    }
    // The tail (organs and limb-less bones) folds unconditionally — it is
    // the fallback for viscera, which rides no cluster sphere.
    d = foldBoneRange(d, p, data, i32(tail.x), i32(tail.y), band);
  } else {
    // Flat fallback — the pre-cull loop over the whole contiguous span
    // [counts.x, counts.x + boneCount). Byte-identical to the shipped
    // shader: pack wrote zero bone-cluster texels.
    d = foldBoneRange(d, p, data, first, i32(boneCount), band);
  }
  return d;
}`;
