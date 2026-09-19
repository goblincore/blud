// src/lab/sdf-zombie/webgpu/march/fields/volume.wgsl.ts
//
// Phase-1 split of march.wgsl.ts (2026-09-18): baked hand-volume sample.
// MOVE-ONLY: the WGSL text below is byte-identical to the original
// file; see docs/dev-notes/2026-09-18-march-split/.

// BAKED HAND VOLUME (X1.26): world-space distance from one anisotropic R16F
// 3D texture, baked offline from a posed CC-BY hand mesh (see
// hand-volume.ts for the loader/manifest contract and scripts/bake_hand_sdf.py
// for the bake). Everything here is metric and conservative:
//
//   - world -> local is translate by the volume centre (volumePose0.xyz) then
//     rotate by the CONJUGATE of the local-to-world quaternion (volumePose1) —
//     the same Rodrigues-in-quat form as sdPrimO/qRot above;
//   - the distal warp (Verlet residue as domain warp) subtracts a CPU-clamped
//     (<= 12 mm) local-space offset, ramped by smoothstep(0.15, 0.9, uv.y) so
//     the wrist stays pinned and only the digits lag;
//   - OUTSIDE the AABB the sample is the clamped boundary value PLUS the true
//     metric distance to the box: clamp-to-edge alone would repeat the
//     boundary slab out to infinity and extrude a phantom hand;
//   - the eight textureLoads are explicit because the baker's lattice is
//     ENDPOINT-INCLUSIVE (texel 0 sits exactly on boundsMin, texel n-1 on
//     boundsMax), so texel coords are uv * (dims - 1). A normalized sampler
//      would sample at texel centres (uv * dims - 0.5) and shift the whole
//     field half a voxel; nearest filtering keeps every load exact and the
//     nested mix is the only interpolation.
export const SAMPLE_VOLUME = /* wgsl */ `fn sampleHandVolumeFrame(q: vec3<f32>, frameIndex: i32, volumeTex: texture_3d<f32>, volumeClip: vec4<f32>) -> f32 {
  // X1.27: slab-local trilinear over ONE frame of the depth-packed atlas.
  // volumeClip.w is the frame depth (never 0 — max(1, ...) guarantees a live
  // slab and no 0-depth sentinel exists anywhere in WGSL); the z indices are
  // frame-local and offset by frame * frameDepth, with the z clamp ending at
  // zOffset + frameDepth - 1 so a slab can never bleed into its neighbour.
  let atlasDims = vec3<i32>(textureDimensions(volumeTex, 0));
  let depth = max(1, i32(volumeClip.w));
  let dimsI = vec3<i32>(atlasDims.x, atlasDims.y, depth);
  let frame = clamp(frameIndex, 0, atlasDims.z / depth - 1);
  let zBase = frame * depth;
  let i0 = vec3<i32>(floor(q));
  let i1 = min(i0 + vec3<i32>(1, 1, 1), dimsI - vec3<i32>(1, 1, 1));
  let a0 = vec3<i32>(i0.x, i0.y, i0.z + zBase);
  let a1 = vec3<i32>(i1.x, i1.y, i1.z + zBase);
  let fr = q - floor(q);
  let s000 = textureLoad(volumeTex, a0, 0).r;
  let s100 = textureLoad(volumeTex, vec3<i32>(a1.x, a0.y, a0.z), 0).r;
  let s010 = textureLoad(volumeTex, vec3<i32>(a0.x, a1.y, a0.z), 0).r;
  let s110 = textureLoad(volumeTex, vec3<i32>(a1.x, a1.y, a0.z), 0).r;
  let s001 = textureLoad(volumeTex, vec3<i32>(a0.x, a0.y, a1.z), 0).r;
  let s101 = textureLoad(volumeTex, vec3<i32>(a1.x, a0.y, a1.z), 0).r;
  let s011 = textureLoad(volumeTex, vec3<i32>(a0.x, a1.y, a1.z), 0).r;
  let s111 = textureLoad(volumeTex, a1, 0).r;
  return mix(
    mix(mix(s000, s100, fr.x), mix(s010, s110, fr.x), fr.y),
    mix(mix(s001, s101, fr.x), mix(s011, s111, fr.x), fr.y),
    fr.z);
}

fn sampleHandVolume(pWorld: vec3<f32>, volumeTex: texture_3d<f32>, volumePose0: vec4<f32>, volumePose1: vec4<f32>, volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>, volumeClip: vec4<f32>) -> f32 {
  let pl = pWorld - volumePose0.xyz;
  let cq = vec4<f32>(-volumePose1.xyz, volumePose1.w);
  let tq = 2.0 * cross(cq.xyz, pl);
  let local0 = pl + tq * cq.w + cross(cq.xyz, tq);
  let extent = vec3<f32>(1.0, 1.0, 1.0) / volumeInvExtent;
  let uv0 = (local0 - volumeMin) * volumeInvExtent;
  let distal = smoothstep(0.15, 0.9, uv0.y);
  let local = local0 - volumeWarp.xyz * distal;
  let uv = (local - volumeMin) * volumeInvExtent;
  let diffMin = volumeMin - local;
  let diffMax = local - (volumeMin + extent);
  let outside = length(max(max(diffMin, diffMax), vec3<f32>(0.0, 0.0, 0.0)));
  // World-to-local, warp, uv and the outside-box distance are computed ONCE
  // here; only the frame pair is sampled twice and mixed (X1.27). Static v1
  // views bind volumeClip = [0, 0, 0, nz]: frame0 == frame1 == slab 0 and
  // alpha 0, so the mix degenerates to exactly the v1 sample. The fallback
  // binds [0, 0, 0, 1]: a 1-deep slab of one texel.
  //
  // textureDimensions is vec3<u32>: WGSL has no u32-minus-i32 overload, so
  // the clamps narrow through explicit i32/f32 conversions (a mixed-type
  // arithmetic here once failed pipeline compilation and froze the whole
  // canvas — invisible to the string-level tests).
  let atlasDims = vec3<i32>(textureDimensions(volumeTex, 0));
  let depth = max(1, i32(volumeClip.w));
  let dimsF = vec3<f32>(f32(atlasDims.x), f32(atlasDims.y), f32(depth));
  let q = clamp(uv * (dimsF - vec3<f32>(1.0, 1.0, 1.0)), vec3<f32>(0.0, 0.0, 0.0), dimsF - vec3<f32>(1.0, 1.0, 1.0));
  let d0 = sampleHandVolumeFrame(q, i32(volumeClip.x), volumeTex, volumeClip);
  let d1 = sampleHandVolumeFrame(q, i32(volumeClip.y), volumeTex, volumeClip);
  return mix(d0, d1, clamp(volumeClip.z, 0.0, 1.0)) + outside;
}

// PERF INSTRUMENTATION COUNTERS (raymarcher-perf task 2). Private-scope
// globals, so mapBody's signature — and every caller threading values
// outward through it — stays untouched; counting per march STEP at the
// call site would fork the fold, which the plan forbids. Declared at the
// tail of the LAST helper before MAP_BODY because WGSL requires declaration
// before use; MARCH_BODY and CALC_NORMAL see them transitively through the
// includes chain. Fragment invocations each start with zeroed private
// globals, so there is no cross-pixel bleed; the march entry re-zeroes
// them under the debug guard anyway. gDebugMode mirrors debugCfg.x for
// mapBody, which takes no debugCfg parameter by design.
var<private> gDebugMode: f32 = 0.0;
var<private> gDebugPrims: f32 = 0.0;
var<private> gDebugSteps: f32 = 0.0;
/** Bone-capsule evaluations this ray (gore r3 refinement 3). The bone fold
 *  has no spatial cull, so this is the number the cull has to move — and a
 *  counter is honest where a 0.0% timing delta under a 4% spread is not. */
var<private> gDebugBones: f32 = 0.0;
var<private> gDebugVolumeSamples: f32 = 0.0;
var<private> gDebugVolumeFallbacks: f32 = 0.0;
// NOTE: these live at the tail of SAMPLE_VOLUME's source rather than in
// their own HELPERS entry because three's wgslFn parser is ^-anchored on
// "fn" — a var-declaration source would fail its parse contract.`;
