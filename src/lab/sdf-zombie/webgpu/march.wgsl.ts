// src/lab/sdf-zombie/webgpu/march.wgsl.ts
//
// WGSL port of march.glsl.ts. Kept as a near line-for-line translation on
// purpose — the WebGPU spec argues for raw WGSL over a TSL node graph
// specifically so this stays diffable against the GLSL original AND against
// validate.ts's CPU mirror. Nothing here checks that mirror automatically, and
// it backs click-to-shoot raycasting, so a human has to be able to read the
// two side by side.
//
// ============================ HOW wgslFn PARSES =============================
// Two hard constraints, both discovered the painful way, both presenting as
// the single unhelpful error "FunctionNode: Function is not a WGSL code."
//
//   1. Each source string must BEGIN with `fn`. three's declarationRegexp is
//      ^-anchored (see WGSLNodeFunction.js), so a leading comment — even a
//      blank first line — makes the parse fail outright. Every comment in this
//      file therefore sits OUTSIDE the template strings, or inside a body.
//
//   2. Helpers cannot simply be concatenated ahead of the entry point, because
//      of (1), nor after it, because WGSL requires declaration before use.
//      They are passed through wgslFn's second argument, `includes`, which is
//      the mechanism three provides for exactly this. See buildMarchFn().
// ============================================================================
//
// PRIMITIVE DATA ARRIVES AS A FLOAT TEXTURE, not uniform arrays. That is the
// substantive win of the migration: uniforms capped the body near 48
// primitives against a 224-vec4 floor, whereas a texture has no such ceiling
// (this device reports a 4 GB storage limit). Layout, MAX_PRIMS wide:
//
//   row 0  primA        xyz = endpoint A, w = radius
//   row 1  primB        xyz = endpoint B, w = blendK
//   row 2  primScale    xyz = ellipsoid scale, w = 1 when this is a carve
//   row 3  clusterBnds  xyz = centre, w = radius
//   row 4  clusterRange x = start, y = count, z = alive
//
// TRANSLATION TRAPS, all of which bite silently:
//   - `a ? b : c` becomes `select(c, b, a)` — the ARGUMENT ORDER FLIPS.
//   - No implicit int/float conversion; loop bounds need explicit casts.
//   - WGSL has no `discard` expression, only the statement.

export const DATA_ROWS = 5;
export const ROW_PRIM_A = 0;
export const ROW_PRIM_B = 1;
export const ROW_PRIM_SCALE = 2;
export const ROW_CLUSTER_BOUNDS = 3;
export const ROW_CLUSTER_RANGE = 4;

// iq quadratic polynomial smooth-min: rigid, and conservative (never
// overestimates, which would punch holes during sphere tracing). NOT
// associative, so the cluster fold order is fixed and must stay that way.
// The k <= 0 short-circuit is load-bearing rather than a guard: blendK 0 is how
// face features get a HARD crisp edge instead of a smear, and hard min/max ARE
// associative, so zero-blend features are exempt from the ordering constraint.
export const SMIN = /* wgsl */ `fn smin(a: f32, b: f32, kIn: f32) -> f32 {
  let k = kIn * 4.0;
  if (k <= 0.0) { return min(a, b); }
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}`;

export const SMAX = /* wgsl */ `fn smax(a: f32, b: f32, k: f32) -> f32 {
  return -smin(-a, -b, k);
}`;

// Ellipsoid capsule. Mirrors sdPrimitive() in validate.ts exactly; edit both in
// the same commit or click-to-shoot drifts from what is drawn.
export const SD_PRIM = /* wgsl */ `fn sdPrim(p: vec3<f32>, i: i32, data: texture_2d<f32>) -> f32 {
  let A = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_A}), 0);
  let B = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_B}), 0);
  let S = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SCALE}), 0);
  let inv = 1.0 / S.xyz;
  let q = p * inv;
  let a = A.xyz * inv;
  let b = B.xyz * inv;
  let ab = b - a;
  let ap = q - a;
  let ab2 = dot(ab, ab);
  // select() is (falseValue, trueValue, condition) — reversed from a ternary.
  let t = select(clamp(dot(ap, ab) / ab2, 0.0, 1.0), 0.0, ab2 == 0.0);
  let minScale = min(S.x, min(S.y, S.z));
  return (length(q - (a + ab * t)) - A.w) * minScale;
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

export const FBM = /* wgsl */ `fn fbm(p: vec3<f32>) -> f32 {
  return noise3(p * 4.0) * 0.6 + noise3(p * 9.0) * 0.3;
}`;

// Carves every subtractive primitive out of the assembled field, AFTER the
// complete additive fold and in fixed cluster order — the structure the GLSL
// version uses for wounds. Carving per-cluster would restructure a
// non-associative fold and change the surface everywhere.
export const APPLY_CARVES = /* wgsl */ `fn applyCarves(dIn: f32, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>) -> f32 {
  var d = dIn;
  if (counts.z < 0.5) { return d; }
  let clusterCount = i32(counts.y);
  let primCount = i32(counts.x);
  for (var c = 0; c < 8; c = c + 1) {
    if (c >= clusterCount) { break; }
    let range = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_RANGE}), 0);
    if (range.z < 0.5) { continue; }
    let start = i32(range.x);
    let count = i32(range.y);
    for (var i = 0; i < 64; i = i + 1) {
      if (i >= count) { break; }
      let idx = start + i;
      if (idx >= primCount) { break; }
      let S = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SCALE}), 0);
      if (S.w < 0.5) { continue; }
      let k = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_B}), 0).w;
      d = smax(d, -sdPrim(p, idx, data), k);
    }
  }
  return d;
}`;

// The cull margin's 4.0 matters: smin scales k by 4 internally, so a cluster
// still bends the surface from 4x the authored blendK away. Using the unscaled
// value clips the fillet and shows up as hard creases along cluster edges.
export const MAP_BODY = /* wgsl */ `fn mapBody(p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, noiseAmp: f32) -> f32 {
  var d = 1e9;
  let clusterCount = i32(counts.y);
  let primCount = i32(counts.x);
  for (var c = 0; c < 8; c = c + 1) {
    if (c >= clusterCount) { break; }
    let range = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_RANGE}), 0);
    if (range.z < 0.5) { continue; }
    let bounds = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_BOUNDS}), 0);
    if (length(p - bounds.xyz) - bounds.w > d + counts.w * 4.0) { continue; }
    let start = i32(range.x);
    let count = i32(range.y);
    for (var i = 0; i < 64; i = i + 1) {
      if (i >= count) { break; }
      let idx = start + i;
      if (idx >= primCount) { break; }
      let S = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SCALE}), 0);
      if (S.w > 0.5) { continue; }
      let k = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_B}), 0).w;
      d = smin(d, sdPrim(p, idx, data), k);
    }
  }
  return applyCarves(d, p, data, counts) + fbm(p * 3.0) * noiseAmp;
}`;

// Tetrahedron differences. Epsilon stays SMALL: the prior blendshell experiment
// used 0.02 (2 cm on 6 cm limbs) and smeared normals exactly at the
// high-curvature joints where they matter most.
export const CALC_NORMAL = /* wgsl */ `fn calcNormal(p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, noiseAmp: f32) -> vec3<f32> {
  let e = vec2<f32>(1.0, -1.0) * 0.0015;
  return normalize(
    e.xyy * mapBody(p + e.xyy, data, counts, noiseAmp) +
    e.yyx * mapBody(p + e.yyx, data, counts, noiseAmp) +
    e.yxy * mapBody(p + e.yxy, data, counts, noiseAmp) +
    e.xxx * mapBody(p + e.xxx, data, counts, noiseAmp));
}`;

// Entry point. Returns rgb plus the hit distance in w, so the depth node can
// reconstruct the hit point without marching a second time.
export const MARCH_BODY = /* wgsl */ `fn marchBody(
  worldPos: vec3<f32>,
  camPos: vec3<f32>,
  data: texture_2d<f32>,
  counts: vec4<f32>,
  marchCfg: vec3<f32>,
  baseColor: vec3<f32>,
  deepColor: vec3<f32>,
  lightDir: vec3<f32>,
  keyColor: vec3<f32>,
  lightCfg: vec2<f32>,
  surfCfg: vec4<f32>,
  surfCfg2: vec2<f32>
) -> vec4<f32> {
  let rd = normalize(worldPos - camPos);
  let tMax = length(worldPos - camPos);
  let steps = i32(marchCfg.x);

  var t = 0.0;
  var hit = false;
  for (var i = 0; i < 512; i = i + 1) {
    if (i >= steps) { break; }
    let d = mapBody(camPos + rd * t, data, counts, marchCfg.z);
    if (d < 0.0012) { hit = true; break; }
    t = t + d * marchCfg.y;
    if (t > tMax) { break; }
  }
  if (!hit) { discard; }

  let p = camPos + rd * t;
  var n = calcNormal(p, data, counts, marchCfg.z);
  n = normalize(n + vec3<f32>(
    fbm(p * 22.0), fbm(p * 22.0 + 5.0), fbm(p * 22.0 + 11.0)) * surfCfg2.y);

  let L = normalize(lightDir);
  let V = -rd;
  let H = normalize(L + V);
  let diff = max(dot(n, L), 0.0);
  let shine = pow(max(dot(n, H), 0.0), mix(128.0, 4.0, surfCfg.y));
  let fres = pow(1.0 - max(dot(n, V), 0.0), 4.0) * surfCfg.z;

  let thin = clamp(mapBody(p + L * 0.06, data, counts, marchCfg.z) * -8.0, 0.0, 1.0);
  let scatter = deepColor * thin * surfCfg.w;

  // Cheap AO from the field, so creases and the insides of joints stay dark.
  // Without it a limb dissolves into the torso visually even when the geometry
  // is correctly separated.
  let ao = clamp(mapBody(p + n * 0.06, data, counts, marchCfg.z) / 0.06, 0.35, 1.0);

  let lit = baseColor * (lightCfg.y + diff * lightCfg.x) * keyColor * ao
          + keyColor * (shine * surfCfg.x + fres) * surfCfg2.x
          + scatter;

  return vec4<f32>(lit, t);
}`;

/**
 * Helper sources in DEPENDENCY ORDER — each one may only call those before it,
 * because WGSL requires declaration before use and three emits includes in the
 * order given.
 */
export const HELPERS = [
  SMIN, SMAX, SD_PRIM, HASH13, NOISE3, FBM, APPLY_CARVES, MAP_BODY, CALC_NORMAL,
];
