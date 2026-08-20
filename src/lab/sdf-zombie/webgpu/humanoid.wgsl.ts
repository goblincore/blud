// src/lab/sdf-zombie/webgpu/humanoid.wgsl.ts
//
// Task 5 — the clustered bone-atlas marcher. A SECOND marcher beside
// march.wgsl.ts, deliberately isolated: the humanoid's field is baked bone
// bricks, not authored ellipsoid primitives, so it marches a different
// distance field (bind-local trilinear R16F atlases) and shades a different
// material (baked source colour in linear space). None of the production
// prim/cluster/face/wound plumbing is reused here.
//
// THE FIELD. Each retained bone owns a bind-local signed-distance brick plus a
// matching RGBA8 colour brick, both packed into one 3D atlas per channel. A
// cluster (spine, left-leg, …) samples at most four bricks. For a world point
// the fold, per bone:
//
//   1. transforms world -> bind-local by the CONJUGATE of the bone's posed
//      quaternion (the same Rodrigues form sampleHandVolume uses);
//   2. trilinearly samples the eight R16F texels at `brick.offset + uv*(dims-1)`
//      on the baker's endpoint-inclusive lattice, then adds the true metric
//      distance to the brick AABB when the point is outside it — clamp-to-edge
//      alone would extrude a phantom limb to infinity (X1.26's lesson);
//   3. adds a BOUNDED bone-local `surfaceWarp` only inside a four-amplitude
//      shell of the surface (softness-driven; zero at softness 0);
//   4. folds bones with HARD min, except an adjacent parent/child pair inside
//      its declared 30 mm planar joint band, which folds with a conservative
//      iq smooth-min whose k is gated by `jointBlendWeight`;
//   5. keeps the TWO dominant samples and blends their colours with the
//      identical joint/proximity weight, so colour and distance never disagree
//      about which bone owns a surface point.
//
// THE ENTRY writes real WebGPU depth exactly as zombie-gpu.ts does (clip.z /
// clip.w, no GLSL remap), starts from the existing latex lighting constants,
// and multiplies the exterior albedo by the baked colour decoded to linear.
// mapHumanoidCut applies the complementary irregular cut mask (cutNoise + the
// manifest plane/seed) and tornCapMaterial shades the layered cap ramp — both
// are Task 6's; cutMode 0 collapses them to identity, which is why uncut
// clusters still parse but never change a frame.
//
// ============================ HOW wgslFn PARSES =============================
// Same two hard constraints as march.wgsl.ts (see its header):
//   1. Each source string must BEGIN with `fn` — no leading comment, not even
//      a blank first line. Every comment lives OUTSIDE the template strings.
//   2. Helpers go through wgslFn's `includes` in DEPENDENCY order — WGSL
//      requires declaration before use, and three emits includes as given.
// Comments inside a template string must not contain backticks.

export const HUMANOID_DATA_ROWS = 8;
export const ROW_POSE_POS = 0;
export const ROW_POSE_QUAT = 1;
export const ROW_BRICK_OFFSET = 2;
export const ROW_BRICK_DIMS = 3;
export const ROW_BOUNDS_MIN = 4;
export const ROW_BOUNDS_INV = 5;
export const ROW_JOINT = 6;
export const ROW_JOINT_AXIS = 7;

/** Data-texture width (columns) — the retained bone array is 22, padded. */
export const HUMANOID_MAX_BONES = 24;
/** A cluster samples at most four bricks (primaries + direct joint helpers). */
export const HUMANOID_MAX_CLUSTER_BONES = 4;
/** Smooth-min blend radius at a joint (metres), scaled by jointBlendWeight. */
export const HUMANOID_JOINT_SMIN_K = 0.01;
/** Peak surface-warp amplitude (metres) at softness 1. Softness 0 = no warp. */
export const HUMANOID_SURFACE_WARP_AMP = 0.008;
/** Pinned sever constants — consumed from manifest.rightArm, never invented. */
export const HUMANOID_CUT_SEED = 12648430;
export const HUMANOID_CUT_IRREGULARITY_M = 0.004;
/** The cut plane's torn rim band (metres) — manifest.rightArm.rimWidthM. */
export const HUMANOID_CUT_RIM_WIDTH_M = 0.008;
/** Radial depth scale (metres) the cap ramp maps skin -> meat -> deep over. */
export const HUMANOID_CAP_DEPTH_M = 0.03;

// iq quadratic polynomial smooth-min. Conservative (never overestimates, so
// sphere tracing stays safe) and non-associative, hence the fixed fold order
// below. k <= 0 short-circuits to a hard min — that is exactly how a joint
// band with zero weight falls back to the union.
export const SMIN = /* wgsl */ `fn smin(a: f32, b: f32, kIn: f32) -> f32 {
  let k = kIn * 4.0;
  if (k <= 0.0) { return min(a, b); }
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}`;

export const HASH13 = /* wgsl */ `fn hash13(pIn: vec3<f32>) -> f32 {
  var p = fract(pIn * 0.1031);
  p = p + dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}`;

export const NOISE3 = /* wgsl */ `fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  let n = mix(
    mix(mix(hash13(i + vec3<f32>(0.0, 0.0, 0.0)), hash13(i + vec3<f32>(1.0, 0.0, 0.0)), f.x),
        mix(hash13(i + vec3<f32>(0.0, 1.0, 0.0)), hash13(i + vec3<f32>(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash13(i + vec3<f32>(0.0, 0.0, 1.0)), hash13(i + vec3<f32>(1.0, 0.0, 1.0)), f.x),
        mix(hash13(i + vec3<f32>(0.0, 1.0, 1.0)), hash13(i + vec3<f32>(1.0, 1.0, 1.0)), f.x), f.y), f.z);
  return n * 2.0 - 1.0;
}`;

/** sRGB -> linear, so the baked RGBA8 source colour multiplies the latex
 *  albedo in LINEAR space (the plan's "multiply exterior albedo by the baked
 *  colour in linear space"). */
export const SRGB_TO_LINEAR = /* wgsl */ `fn srgbToLinear(c: vec3<f32>) -> vec3<f32> {
  let lo = c / 12.92;
  let hi = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  return select(hi, lo, c <= vec3<f32>(0.04045));
}`;

/** World -> bind-local rotation by the CONJUGATE of a local->world unit
 *  quaternion (v' = v + 2w(u x v) + 2(u x (u x v)) with u = -q.xyz), matching
 *  qRotate(qConj(q), v) in vec.ts and sampleHandVolume's conjugate form. */
export const ROTATE_CONJ = /* wgsl */ `fn rotateConj(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let cq = vec4<f32>(-q.xyz, q.w);
  let t = 2.0 * cross(cq.xyz, v);
  return v + t * cq.w + cross(cq.xyz, t);
}`;

/** Manual trilinear of the R16F distance atlas at a brick-local uv (0..1).
 *  Eight explicit textureLoads on the baker's ENDPOINT-INCLUSIVE lattice —
 *  texel coords are uv * (dims - 1), never a normalised sampler's centre
 *  convention, which would shift the whole field half a voxel. The caller
 *  adds the outside-box metric distance; this function clamps uv for sampling
 *  so a point outside the brick reads the boundary slab, not a neighbour's. */
export const SAMPLE_DISTANCE_BRICK = /* wgsl */ `fn sampleDistanceBrick(uv: vec3<f32>, offset: vec3<f32>, dims: vec3<f32>, distAtlas: texture_3d<f32>) -> f32 {
  let hi = offset + dims - vec3<f32>(1.0, 1.0, 1.0);
  let q = offset + clamp(uv, vec3<f32>(0.0), vec3<f32>(1.0)) * (dims - vec3<f32>(1.0, 1.0, 1.0));
  let i0 = vec3<i32>(floor(q));
  let i1 = min(i0 + vec3<i32>(1, 1, 1), vec3<i32>(floor(hi)));
  let fr = q - floor(q);
  let s000 = textureLoad(distAtlas, i0, 0).r;
  let s100 = textureLoad(distAtlas, vec3<i32>(i1.x, i0.y, i0.z), 0).r;
  let s010 = textureLoad(distAtlas, vec3<i32>(i0.x, i1.y, i0.z), 0).r;
  let s110 = textureLoad(distAtlas, vec3<i32>(i1.x, i1.y, i0.z), 0).r;
  let s001 = textureLoad(distAtlas, vec3<i32>(i0.x, i0.y, i1.z), 0).r;
  let s101 = textureLoad(distAtlas, vec3<i32>(i1.x, i0.y, i1.z), 0).r;
  let s011 = textureLoad(distAtlas, vec3<i32>(i0.x, i1.y, i1.z), 0).r;
  let s111 = textureLoad(distAtlas, i1, 0).r;
  return mix(
    mix(mix(s000, s100, fr.x), mix(s010, s110, fr.x), fr.y),
    mix(mix(s001, s101, fr.x), mix(s011, s111, fr.x), fr.y),
    fr.z);
}`;

/** The colour twin — same eight taps, RGBA8 returned as vec4. */
export const SAMPLE_COLOR_BRICK = /* wgsl */ `fn sampleColorBrick(uv: vec3<f32>, offset: vec3<f32>, dims: vec3<f32>, colorAtlas: texture_3d<f32>) -> vec4<f32> {
  let hi = offset + dims - vec3<f32>(1.0, 1.0, 1.0);
  let q = offset + clamp(uv, vec3<f32>(0.0), vec3<f32>(1.0)) * (dims - vec3<f32>(1.0, 1.0, 1.0));
  let i0 = vec3<i32>(floor(q));
  let i1 = min(i0 + vec3<i32>(1, 1, 1), vec3<i32>(floor(hi)));
  let fr = q - floor(q);
  let c000 = textureLoad(colorAtlas, i0, 0);
  let c100 = textureLoad(colorAtlas, vec3<i32>(i1.x, i0.y, i0.z), 0);
  let c010 = textureLoad(colorAtlas, vec3<i32>(i0.x, i1.y, i0.z), 0);
  let c110 = textureLoad(colorAtlas, vec3<i32>(i1.x, i1.y, i0.z), 0);
  let c001 = textureLoad(colorAtlas, vec3<i32>(i0.x, i0.y, i1.z), 0);
  let c101 = textureLoad(colorAtlas, vec3<i32>(i1.x, i0.y, i1.z), 0);
  let c011 = textureLoad(colorAtlas, vec3<i32>(i0.x, i1.y, i1.z), 0);
  let c111 = textureLoad(colorAtlas, i1, 0);
  return mix(
    mix(mix(c000, c100, fr.x), mix(c010, c110, fr.x), fr.y),
    mix(mix(c001, c101, fr.x), mix(c011, c111, fr.x), fr.y),
    fr.z);
}`;

/** The planar joint-band weight: 1 at the band centre, easing to 0 at the
 *  band edges, 0 for a root (halfWidth <= 0). Drives the smooth-min k so a
 *  joint smooths ONLY inside its declared band and is a hard union outside. */
export const JOINT_BLEND_WEIGHT = /* wgsl */ `fn jointBlendWeight(local: vec3<f32>, center: vec3<f32>, axis: vec3<f32>, halfWidth: f32) -> f32 {
  if (halfWidth <= 0.0) { return 0.0; }
  let s = abs(dot(axis, local - center));
  return 1.0 - smoothstep(halfWidth * 0.5, halfWidth, s);
}`;

/** Bounded bone-local surface warp: softness-scaled noise, nonzero only
 *  inside a FOUR-amplitude shell of the surface (the amplitude is the max
 *  displacement, so 4x is the reach of the smooth field it rides on). Zero at
 *  softness 0, so the undisplaced field is bit-identical. */
export const SURFACE_WARP = /* wgsl */ `fn surfaceWarp(local: vec3<f32>, timeSec: f32, softness01: f32, baseD: f32) -> f32 {
  let amp = softness01 * ${HUMANOID_SURFACE_WARP_AMP};
  if (amp <= 0.0 || abs(baseD) >= amp * 4.0) { return 0.0; }
  let n = noise3(local * 6.0 + vec3<f32>(0.0, timeSec * 1.5, 0.0));
  return n * amp;
}`;

/** The ONE deterministic low-frequency cut noise, shared by both cut signs
 *  so the proximal and distal masks read the same q = planeD + cutNoise *
 *  irregularityM — their contours coincide by construction. */
export const CUT_NOISE = /* wgsl */ `fn cutNoise(local: vec3<f32>, seed: f32) -> f32 {
  return noise3(local * 90.0 + vec3<f32>(seed, seed * 1.7, seed * 2.3));
}`;

/** The complementary cut mask. cutMode: 0 none, 1 proximal (keeps q <= 0),
 *  2 distal (keeps q >= 0). One shared perturbed distance q = planeD +
 *  cutNoise(local, seed) * irregularityM, so `max(bodyD, q)` and
 *  `max(bodyD, -q)` are complementary by construction. */
export const CUT_FIELD = /* wgsl */ `fn cutField(bodyD: f32, local: vec3<f32>, cutPlane: vec4<f32>, cutMode: f32, seed: f32, irregularityM: f32) -> f32 {
  if (cutMode < 0.5) { return bodyD; }
  let planeD = dot(cutPlane.xyz, local) + cutPlane.w;
  let jagged = cutNoise(local, seed) * irregularityM;
  let q = planeD + jagged;
  if (cutMode < 1.5) { return max(bodyD, q); }
  return max(bodyD, -q);
}`;

/** Normalised radial depth of a point INTO the cut cross-section: 0 at the
 *  original exterior (skin edge), 1 at the cap centre. Gated by cutMode so
 *  uncut clusters contribute nothing. */
export const CAP_DEPTH = /* wgsl */ `fn capDepth(bodyD: f32, cutMode: f32) -> f32 {
  return clamp(-bodyD / ${HUMANOID_CAP_DEPTH_M}, 0.0, 1.0) * min(cutMode, 1.0);
}`;

/** The layered cap ramp: exterior skin edge (albedo) -> wet red tissue ->
 *  dark centre, driven by capDepth. The rim band (rimWidth / capDepth) is the
 *  skin -> meat transition width; the baked exterior albedo is DISABLED on the
 *  cap because the caller passes the un-baked lit skin colour as `albedo`. */
export const TORN_CAP_MATERIAL = /* wgsl */ `fn tornCapMaterial(albedo: vec3<f32>, depth: f32, cutMode: f32, meatColor: vec3<f32>, deepColor: vec3<f32>) -> vec3<f32> {
  let d = clamp(depth, 0.0, 1.0) * min(cutMode, 1.0);
  let rimRatio = ${HUMANOID_CUT_RIM_WIDTH_M} / ${HUMANOID_CAP_DEPTH_M};
  let meat = mix(albedo, meatColor, smoothstep(0.0, rimRatio, d));
  return mix(meat, deepColor, smoothstep(rimRatio, 1.0, d));
}`;

/** The baked colour at a hit, for ONE bone index: world -> bind-local, then
 *  the colour trilinear. Shared by the entry's two-dominant blend. */
export const SAMPLE_BONE_COLOR = /* wgsl */ `fn sampleBoneColor(p: vec3<f32>, bi: i32, data: texture_2d<f32>, colorAtlas: texture_3d<f32>) -> vec3<f32> {
  let posePos = textureLoad(data, vec2<i32>(bi, ${ROW_POSE_POS}), 0);
  let quat = textureLoad(data, vec2<i32>(bi, ${ROW_POSE_QUAT}), 0);
  let offset = textureLoad(data, vec2<i32>(bi, ${ROW_BRICK_OFFSET}), 0);
  let dims = textureLoad(data, vec2<i32>(bi, ${ROW_BRICK_DIMS}), 0);
  let bmin = textureLoad(data, vec2<i32>(bi, ${ROW_BOUNDS_MIN}), 0);
  let invExt = textureLoad(data, vec2<i32>(bi, ${ROW_BOUNDS_INV}), 0);
  let local = rotateConj(quat, p - posePos.xyz);
  let uv = (local - bmin.xyz) * invExt.xyz;
  return sampleColorBrick(uv, offset.xyz, dims.xyz, colorAtlas).rgb;
}`;

/** The cluster fold. Returns vec4(d, bestIdx, secondIdx, blendW) — the field
 *  distance plus the two dominant bone indices and the colour blend weight
 *  (joint weight x proximity), so the entry re-derives colour with the
 *  IDENTICAL weight the distance fold used. */
export const MAP_HUMANOID_FIELD = /* wgsl */ `fn mapHumanoidField(p: vec3<f32>, data: texture_2d<f32>, distAtlas: texture_3d<f32>, boneIdx: vec4<f32>, clusterCfg: vec4<f32>, timeSec: f32) -> vec4<f32> {
  let n = i32(clusterCfg.x);
  var best = 1e9;
  var bestIdx = -1.0;
  var second = 1e9;
  var secondIdx = -1.0;
  var blendW = 0.0;
  var bestSlot = -1;
  var secondSlot = -1;
  var bestLocal = vec3<f32>(0.0);
  var secondLocal = vec3<f32>(0.0);
  for (var i = 0; i < ${HUMANOID_MAX_CLUSTER_BONES}; i = i + 1) {
    if (i >= n) { break; }
    let bi = i32(boneIdx[i]);
    let posePos = textureLoad(data, vec2<i32>(bi, ${ROW_POSE_POS}), 0);
    if (posePos.w < 0.5) { continue; }
    let quat = textureLoad(data, vec2<i32>(bi, ${ROW_POSE_QUAT}), 0);
    let offset = textureLoad(data, vec2<i32>(bi, ${ROW_BRICK_OFFSET}), 0);
    let dims = textureLoad(data, vec2<i32>(bi, ${ROW_BRICK_DIMS}), 0);
    let bmin = textureLoad(data, vec2<i32>(bi, ${ROW_BOUNDS_MIN}), 0);
    let invExt = textureLoad(data, vec2<i32>(bi, ${ROW_BOUNDS_INV}), 0);
    let local = rotateConj(quat, p - posePos.xyz);
    let uv = (local - bmin.xyz) * invExt.xyz;
    let sd = sampleDistanceBrick(uv, offset.xyz, dims.xyz, distAtlas);
    let extent = vec3<f32>(1.0) / invExt.xyz;
    let diffMin = bmin.xyz - local;
    let diffMax = local - (bmin.xyz + extent);
    let outside = length(max(max(diffMin, diffMax), vec3<f32>(0.0)));
    let sw = surfaceWarp(local, timeSec, clusterCfg.z, sd);
    let sdd = sd + sw + outside;
    if (sdd < best) {
      second = best; secondIdx = bestIdx; secondSlot = bestSlot; secondLocal = bestLocal;
      best = sdd; bestIdx = f32(bi); bestSlot = i; bestLocal = local;
    } else if (sdd < second) {
      second = sdd; secondIdx = f32(bi); secondSlot = i; secondLocal = local;
    }
  }
  var d = best;
  if (secondIdx >= 0.0 && abs(f32(bestSlot) - f32(secondSlot)) == 1.0) {
    let childSlot = max(bestSlot, secondSlot);
    let childBi = i32(boneIdx[childSlot]);
    let jnt = textureLoad(data, vec2<i32>(childBi, ${ROW_JOINT}), 0);
    let jax = textureLoad(data, vec2<i32>(childBi, ${ROW_JOINT_AXIS}), 0);
    let childLocal = select(secondLocal, bestLocal, bestSlot == childSlot);
    let bandW = jointBlendWeight(childLocal, jnt.xyz, jax.xyz, jnt.w);
    let kBand = ${HUMANOID_JOINT_SMIN_K} * bandW;
    let gap = second - best;
    let proximity = clamp(1.0 - gap / max(kBand * 4.0, 1e-5), 0.0, 1.0);
    blendW = bandW * proximity * 0.5;
    d = smin(best, second, kBand);
  }
  return vec4<f32>(d, bestIdx, secondIdx, blendW);
}`;

/** The fold PLUS the complementary cut: returns (cutD, bestIdx, secondIdx,
 *  blendW) — identical layout to mapHumanoidField except .x is the POST-cut
 *  distance. The cut is evaluated in the CUT bone's bind-local frame (read
 *  from `cutBone`), so for the detached proxy the cut plane tumbles with the
 *  chunk while the attached view keeps it in the posed elbow frame. */
export const MAP_HUMANOID_CUT = /* wgsl */ `fn mapHumanoidCut(p: vec3<f32>, data: texture_2d<f32>, distAtlas: texture_3d<f32>, boneIdx: vec4<f32>, clusterCfg: vec4<f32>, cutPlane: vec4<f32>, cutBone: f32, timeSec: f32) -> vec4<f32> {
  let dres = mapHumanoidField(p, data, distAtlas, boneIdx, clusterCfg, timeSec);
  let bodyD = dres.x;
  let cutMode = clusterCfg.y;
  var cutD = bodyD;
  if (cutMode >= 0.5) {
    let bi = i32(cutBone);
    let cq = textureLoad(data, vec2<i32>(bi, ${ROW_POSE_QUAT}), 0);
    let cp = textureLoad(data, vec2<i32>(bi, ${ROW_POSE_POS}), 0);
    let local = rotateConj(cq, p - cp.xyz);
    cutD = cutField(bodyD, local, cutPlane, cutMode, ${HUMANOID_CUT_SEED}, ${HUMANOID_CUT_IRREGULARITY_M});
  }
  return vec4<f32>(cutD, dres.y, dres.z, dres.w);
}`;

/**
 * The entry point. Returns rgb plus the hit distance in w, so the view's
 * depth node reconstructs the hit point without a second march — the exact
 * contract march.wgsl.ts's marchBody keeps. cutMode 0 (uncut clusters)
 * leaves mapHumanoidCut and tornCapMaterial in identity; cutMode 1/2 carve
 * the complementary proximal/distal masks and shade the layered cap.
 */
export const MARCH_HUMANOID = /* wgsl */ `fn marchHumanoid(
  worldPos: vec3<f32>,
  camPos: vec3<f32>,
  data: texture_2d<f32>,
  distAtlas: texture_3d<f32>,
  colorAtlas: texture_3d<f32>,
  boneIdx: vec4<f32>,
  clusterCfg: vec4<f32>,
  cutPlane: vec4<f32>,
  cutBone: f32,
  timeSec: f32,
  baseColor: vec3<f32>,
  bakedTint: vec3<f32>,
  meatColor: vec3<f32>,
  deepColor: vec3<f32>,
  keyColor: vec3<f32>,
  lightDir: vec3<f32>,
  lightCfg: vec2<f32>,
  surfCfg: vec4<f32>,
  marchCfg: vec3<f32>
) -> vec4<f32> {
  let rd = normalize(worldPos - camPos);
  let tMax = length(worldPos - camPos);
  let steps = i32(marchCfg.x);
  let hitEps = max(0.0015, clusterCfg.w);
  var t = 0.0;
  var hit = false;
  for (var i = 0; i < 512; i = i + 1) {
    if (i >= steps) { break; }
    let d = mapHumanoidCut(camPos + rd * t, data, distAtlas, boneIdx, clusterCfg, cutPlane, cutBone, timeSec).x;
    if (d < hitEps) { hit = true; break; }
    t = t + d * marchCfg.y;
    if (t > tMax) { break; }
  }
  if (!hit) { discard; }
  let p = camPos + rd * t;
  let dres = mapHumanoidCut(p, data, distAtlas, boneIdx, clusterCfg, cutPlane, cutBone, timeSec);
  // Tetrahedron normal on the COMPOSED (post-cut) field, so the cut surface
  // shades its own torn normal rather than the flesh it displaced.
  let e = vec2<f32>(1.0, -1.0) * 0.0015;
  let n = normalize(
    e.xyy * mapHumanoidCut(p + e.xyy, data, distAtlas, boneIdx, clusterCfg, cutPlane, cutBone, timeSec).x +
    e.yyx * mapHumanoidCut(p + e.yyx, data, distAtlas, boneIdx, clusterCfg, cutPlane, cutBone, timeSec).x +
    e.yxy * mapHumanoidCut(p + e.yxy, data, distAtlas, boneIdx, clusterCfg, cutPlane, cutBone, timeSec).x +
    e.xxx * mapHumanoidCut(p + e.xxx, data, distAtlas, boneIdx, clusterCfg, cutPlane, cutBone, timeSec).x);
  // Baked colour: the two dominant bones, blended with the fold's exact
  // weight, decoded to linear, multiplied into the latex albedo.
  var baked = sampleBoneColor(p, i32(dres.y), data, colorAtlas);
  if (dres.z >= 0.0) {
    let c2 = sampleBoneColor(p, i32(dres.z), data, colorAtlas);
    baked = mix(baked, c2, dres.w);
  }
  let L = normalize(lightDir);
  let V = -rd;
  let H = normalize(L + V);
  let diff = max(dot(n, L), 0.0);
  let shine = pow(max(dot(n, H), 0.0), mix(128.0, 4.0, surfCfg.y));
  let fres = pow(1.0 - max(dot(n, V), 0.0), 4.0) * surfCfg.z;
  let diffuseLight = lightCfg.y + diff * lightCfg.x;
  let specLight = keyColor * (shine * surfCfg.x + fres);
  // Two lit variants: the flesh keeps the baked source colour; the cap's
  // skin edge uses the UN-baked latex colour (baked albedo is disabled on
  // the cap) so the ramp owns the cut surface entirely.
  //
  // The baked path is tinted by bakedTint, NOT by baseColor. Multiplying a
  // full-colour authored texture into the pink latex albedo double-counts
  // albedo: pale skin x pink latex reads maroon and the blue-grey trousers go
  // black. That rule was inherited from the FACE (X1.1), where the texture is
  // a flat GREYSCALE map whose whole job is to modulate one latex tone. A
  // full-colour body texture already carries the art, so its tint is neutral
  // and baseColor stays with the cut cap, which has no baked colour of its
  // own. See docs/dev-notes/2026-08-19-humanoid-albedo/notes.md.
  let litSkin = baseColor * diffuseLight * keyColor + specLight;
  let litBaked = bakedTint * srgbToLinear(baked) * diffuseLight * keyColor + specLight;
  let cutMode = clusterCfg.y;
  // The cut is the binding surface wherever the pre-cut field is inside the
  // flesh (bodyD < 0); blend to the cap ramp over the rim band.
  let bodyD = mapHumanoidField(p, data, distAtlas, boneIdx, clusterCfg, timeSec).x;
  let capD = capDepth(bodyD, cutMode);
  let capMask = (1.0 - smoothstep(-${HUMANOID_CUT_RIM_WIDTH_M}, 0.0, bodyD)) * min(cutMode, 1.0);
  let capColor = tornCapMaterial(litSkin, capD, cutMode, meatColor, deepColor);
  let litOut = mix(litBaked, capColor, capMask);
  return vec4<f32>(litOut, t);
}`;

/**
 * Helper sources in DEPENDENCY ORDER — each may only call those before it.
 * Same contract as march.wgsl.ts's HELPERS: wgslFn emits includes as given.
 */
export const HUMANOID_HELPERS = [
  SMIN, HASH13, NOISE3, SRGB_TO_LINEAR, ROTATE_CONJ,
  SAMPLE_DISTANCE_BRICK, SAMPLE_COLOR_BRICK, JOINT_BLEND_WEIGHT, SURFACE_WARP,
  CUT_NOISE, CUT_FIELD, CAP_DEPTH, TORN_CAP_MATERIAL, SAMPLE_BONE_COLOR,
  MAP_HUMANOID_FIELD, MAP_HUMANOID_CUT,
];
