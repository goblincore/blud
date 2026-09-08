// src/lab/sdf-zombie/webgpu/skeleton-spike/volume.wgsl.ts
//
// SKELETON REPRESENTATION COMPARISON — Task 3b: GPU atlas sampler for the
// baked segment-local bone distance grids (volume.ts). The atlas uploads as
// ONE r32float 3D texture — NOT filterable in WebGPU — so this module
// reimplements trilinear interpolation with manual index-pair clamping to
// each segment's own dims (precedent: sampleHandVolumeFrame, X1.26).
//
// SEMANTIC PARITY WITH THE CPU PATH IS THE CONTRACT:
//  - segVolumeToLocal mirrors contract.ts toLocal: local = conj(quat) ⊗
//    (world − origin). world = origin + quat ⊗ local.
//  - sampleSegVolume mirrors sampleSegmentGrid: an IN-DOMAIN query
//    trilinearly interpolates the 8 bracketing nodes (clamped index pair at
//    the domain edge — edge NODE values are exact bakes); an OUTSIDE query
//    returns inside=false and the caller MUST fall back to the exact
//    procedural fold (foldBoneRange over the segment's rows) and count it.
//    The CPU lower-bound value is returned for debugging only — hard-min
    // composition cannot tolerate an underestimated NEIGHBOUR segment near
//    a joint (bone would bulge through intact flesh), so the fallback is
//    the only sound use of an outside-domain query.
//  - Organs and any segment without meta (enable=0) stay procedural.
//
// META TEXTURE LAYOUT (host: volume-gpu.ts packSegmentMeta/writeSegmentPose):
// one RGBA32float 2D texture, width BONE_SEG_MAX, 4 rows, row-aligned to
// pack.ts's ascending boneSegment id order (boneSegmentKeyMap):
//   row SEG_META_ROW_GRID:  xyz = grid origin (segment-local), w = spacing
//   row SEG_META_ROW_DIMS:  xyz = grid dims (nx, ny, nz), w = atlas z0 slice
//   row SEG_META_ROW_QUAT:  world-from-local quat [x,y,z,w]   (per frame)
//   row SEG_META_ROW_POSE:  xyz = world origin, w = enable     (per frame)
// enable: 1 = sample the atlas; 0 = procedural fold (organs, missing meta,
// dead/severed segment — isLive()=false clears it the same frame pack.ts
// drops the bone rows).
//
// NOT YET WIRED (2026-09-08): MAP_BODY / APPLY_BONES do not call these
// functions yet; no binding exists in zombie-gpu.ts. The integration point
// is the MODE-2 per-segment loop in APPLY_BONES (march.wgsl.ts): per
// surviving segment, sample the atlas when enable=1, else foldBoneRange;
// outside-domain ⇒ foldBoneRange + bump a fallback counter read back via
// diagnostics. See task-3b.md.

/** WGSL: world → segment-local, exact inverse of contract toWorld. */
export const SEG_VOLUME_TO_LOCAL = /* wgsl */ `fn segVolumeToLocal(p: vec3<f32>, quat: vec4<f32>, origin: vec3<f32>) -> vec3<f32> {
  // local = qRotate(conj(quat), p - origin) — contract.ts toLocal.
  let t = p - origin;
  let u = -quat.xyz;           // conj(quat).xyz
  let s = quat.w;              // conj(quat).w
  // qRotate: v' = 2·dot(u,t)·u + (s² − dot(u,u))·t + 2·s·cross(u,t)
  return 2.0 * dot(u, t) * u + (s * s - dot(u, u)) * t + 2.0 * s * cross(u, t);
}`;

/**
 * WGSL: manual trilinear over the r32float atlas for ONE segment. Returns
 * vec2(d, inside): inside=1 ⇒ d is the interpolated distance; inside=0 ⇒
 * the query lay outside the baked domain and d is the CPU-parity clamp +
 * Lipschitz lower bound (interp(clamp) − |p − clamp| − errorBound) —
 * diagnostic only; the caller must run the procedural fallback instead.
 * errorBound = spacing (declared in volume.ts: theory h·√3/2, rounded up).
 *
 * Atlas addressing (mirrors buildSegmentAtlas, x-fastest):
 *   texel (x, y, z0 + z) of the maxNx × maxNy × totalZ volume.
 * Index pairs clamp to the segment's OWN dims — stacked slices have no
 * halo, so a query must never read a neighbour's texel.
 */
export const SAMPLE_SEG_VOLUME = /* wgsl */ `fn sampleSegVolume(pLocal: vec3<f32>, gridMeta: vec4<f32>, dimsMeta: vec4<f32>, atlas: texture_3d<f32>) -> vec2<f32> {
  let lo = gridMeta.xyz;
  let h = gridMeta.w;
  let nx = i32(dimsMeta.x);
  let ny = i32(dimsMeta.y);
  let nz = i32(dimsMeta.z);
  let zBase = i32(dimsMeta.w);
  let hi = lo + vec3<f32>(f32(nx - 1), f32(ny - 1), f32(nz - 1)) * h;
  var q = pLocal;
  var inside = true;
  if (any(pLocal < lo) || any(pLocal > hi)) {
    q = clamp(pLocal, lo, hi);
    inside = false;
  }
  let f = (q - lo) / h;
  let x0 = clamp(i32(floor(f.x)), 0, nx - 2);
  let y0 = clamp(i32(floor(f.y)), 0, ny - 2);
  let z0 = clamp(i32(floor(f.z)), 0, nz - 2);
  let t = clamp(f - vec3<f32>(f32(x0), f32(y0), f32(z0)), vec3<f32>(0.0), vec3<f32>(1.0));
  let zb = zBase + z0;
  let c000 = textureLoad(atlas, vec3<i32>(x0, y0, zb), 0).x;
  let c100 = textureLoad(atlas, vec3<i32>(x0 + 1, y0, zb), 0).x;
  let c010 = textureLoad(atlas, vec3<i32>(x0, y0 + 1, zb), 0).x;
  let c110 = textureLoad(atlas, vec3<i32>(x0 + 1, y0 + 1, zb), 0).x;
  let c001 = textureLoad(atlas, vec3<i32>(x0, y0, zb + 1), 0).x;
  let c101 = textureLoad(atlas, vec3<i32>(x0 + 1, y0, zb + 1), 0).x;
  let c011 = textureLoad(atlas, vec3<i32>(x0, y0 + 1, zb + 1), 0).x;
  let c111 = textureLoad(atlas, vec3<i32>(x0 + 1, y0 + 1, zb + 1), 0).x;
  let c00 = mix(c000, c100, t.x);
  let c10 = mix(c010, c110, t.x);
  let c01 = mix(c001, c101, t.x);
  let c11 = mix(c011, c111, t.x);
  let d = mix(mix(c00, c10, t.y), mix(c01, c11, t.y), t.z);
  if (inside) { return vec2<f32>(d, 1.0); }
  // Conservative Lipschitz lower bound — volume.ts header. NOT a surface
  // distance: the caller falls back to the procedural fold and counts it.
  return vec2<f32>(d - length(pLocal - q) - h, 0.0);
}`;

/**
 * WGSL: the composition rule, mirroring volume.ts segmentDistance: enable +
 * in-domain ⇒ atlas distance; anything else ⇒ the exact procedural fold.
 * `foldedFallback` is the dIn of the procedural path — the caller adds it
 * to its fallback counter when this returns inside=0.
 */
export const SEG_VOLUME_DISTANCE = /* wgsl */ `// vec2(d, sampled): sampled=1 ⇒ atlas value used; 0 ⇒ caller counts a fallback.
// Requires SEG_VOLUME_TO_LOCAL + SAMPLE_SEG_VOLUME. The procedural fallback
// itself stays in APPLY_BONES (foldBoneRange over the segment's rows) so the
// exact fold and the cull fix live in one place.
fn segVolumeDistance(p: vec3<f32>, gridMeta: vec4<f32>, dimsMeta: vec4<f32>, quatMeta: vec4<f32>, poseMeta: vec4<f32>, atlas: texture_3d<f32>) -> vec2<f32> {
  if (poseMeta.w < 0.5) { return vec2<f32>(0.0, 0.0); }       // disabled: organs / severed / no grid
  let pLocal = segVolumeToLocal(p, quatMeta, poseMeta.xyz);
  return sampleSegVolume(pLocal, gridMeta, dimsMeta, atlas);
}`;

/** All three, in dependency order. */
export const SEG_VOLUME_WGSL = `${SEG_VOLUME_TO_LOCAL}\n${SAMPLE_SEG_VOLUME}\n${SEG_VOLUME_DISTANCE}`;
