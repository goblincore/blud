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
//   row 4  clusterRange x = start, y = count, z = alive, w = oriented-cluster
//   row 5  wound        xyz = world position, w = radius
//   row 6  woundMeta    x = type (0 pellet, 1 blast, 2 burn), y = age
//   row 7  primQuat     xyzw = per-prim orientation (identity = 0,0,0,1)
//   row 8  restA        xyz = REST endpoint A, w = radius (0 = unwritten)
//   row 9  restB        xyz = REST endpoint B, w = blendK
//   row 10 primShape    x = radius at endpoint B (NEGATIVE = untapered),
//                       y = fold profile (0 round, 1 chamfer,
//                       2 round+BENT, 3 chamfer+BENT), zw spare
//   row 11 primBend     xyz = quadratic Bezier control point (world space),
//                       w spare
//
// DIVERGENCE NOTE (2026-08-17, motion-polish task 3): row 7 / per-prim
// orientation exists ONLY here. The GLSL twin (march.glsl.ts) is FROZEN per
// owner decision and keeps world-axis ellipsoid squash — its lab renders a
// posed head with the old detached-visor artefact. Do not port this back.
// Rows 8-9 (task 6, rest-space noise) diverge the same way, same reason.
//
// Wounds ride the SAME texture rather than a uniform array, which the GLSL
// path had to use. MAX_WOUNDS (16) is comfortably under MAX_PRIMS (48), so
// they fit in two more rows and the whole per-body payload stays one upload.
//
// TRANSLATION TRAPS, all of which bite silently:
//   - `a ? b : c` becomes `select(c, b, a)` — the ARGUMENT ORDER FLIPS.
//   - GLSL's two-argument `atan(y, x)` is `atan2(y, x)` in WGSL; one-argument
//     `atan` keeps its name, so a mis-port compiles and returns nonsense.
//   - No implicit int/float conversion; loop bounds need explicit casts.
//   - WGSL has no `discard` expression, only the statement.
//   - WGSL RESERVES a long list of ordinary-looking identifiers that GLSL is
//     happy with: `meta`, `type`, `filter`, `set`, `shared`, `sample`, `mut`,
//     `ref`, `match`, `pass`, `line`, `precise`... `let meta = ...` cost a
//     blank page here. RESERVED_WORDS in march.wgsl.test.ts now fails the
//     build for any of them, so this is a test failure rather than a
//     pipeline-creation error nobody reads.

export const DATA_ROWS = 16;
export const ROW_PRIM_A = 0;
export const ROW_PRIM_B = 1;
export const ROW_PRIM_SCALE = 2;
export const ROW_CLUSTER_BOUNDS = 3;
export const ROW_CLUSTER_RANGE = 4;
export const ROW_WOUND = 5;
export const ROW_WOUND_META = 6;
export const ROW_PRIM_QUAT = 7;
export const ROW_REST_A = 8;
export const ROW_REST_B = 9;
export const ROW_PRIM_SHAPE = 10;
export const ROW_PRIM_BEND = 11;
/** xyz linear albedo, w = 1 + gloss; w = 0 means "flesh". See pack.ts. */
export const ROW_PRIM_COLOR = 12;
/** Bound groups (pack.ts boundGroups): the fold's cull unit, finer than a
 *  cluster. BOUNDS xyz centre, w radius; RANGE x start, y count (0 = end of
 *  list), z alive, w flag bitfield as ROW_CLUSTER_RANGE.w. */
export const ROW_GROUP_BOUNDS = 13;
export const ROW_GROUP_RANGE = 14;
/** Group list capacity = one per prim at worst; the texture is MAX_PRIMS wide. */
export const MAX_GROUPS = 128;
/** Per-cluster span into the group list: x = first group, y = group count. */
export const ROW_CLUSTER_GROUPS = 15;


// iq quadratic polynomial smooth-min: rigid, and conservative (never
// overestimates, which would punch holes during sphere tracing). NOT
// associative, so the cluster fold order is fixed and must stay that way.
// The k <= 0 short-circuit is load-bearing rather than a guard: blendK 0 is how
// face features get a HARD crisp edge instead of a smear, and hard min/max ARE
// associative, so zero-blend features are exempt from the ordering constraint.
// Chamfer union — a flat 45-degree bevel where smin gives a fillet. The only
// alternative to a fillet used to be blendK 0, a hard boolean seam, so there
// was nothing between "smeared" and "cut". Mirrors sminChamfer in validate.ts.
export const SMIN = /* wgsl */ `fn smin(a: f32, b: f32, kIn: f32) -> f32 {
  let k = kIn * 4.0;
  if (k <= 0.0) { return min(a, b); }
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}`;

export const SMIN_CHAMFER = /* wgsl */ `fn sminChamfer(a: f32, b: f32, kIn: f32) -> f32 {
  let k = kIn * 4.0;
  if (k <= 0.0) { return min(a, b); }
  return min(min(a, b), (a - k + b) * 0.70710678);
}`;

// Carpenter's groove — cuts a channel of width rb and depth ra into surface a,
// along the line where cutting surface b crosses it. The mirror of sdGroove in
// validate.ts, which explains why the band gate is there and hg_sdf's original
// does not have it (short version: the ungated form lifts the whole INTERIOR
// by the groove depth, which a renderer never notices and every interior query
// in this project does). Not a blend profile and could not be
// one: a blend combines two solids, this removes material from one along the
// other's zero-set, so it lives in the carve pass.
export const SD_GROOVE = /* wgsl */ `fn sdGroove(a: f32, b: f32, ra: f32, rb: f32) -> f32 {
  let inBand = rb - abs(b);
  if (inBand <= 0.0) { return a; }
  return max(a, min(a + ra, inBand));
}`;

export const SMAX = /* wgsl */ `fn smax(a: f32, b: f32, k: f32) -> f32 {
  return -smin(-a, -b, k);
}`;

// Ellipsoid capsule OR round cone, world-axis squash. Mirrors the
// identity-orient path of sdPrimitive() in validate.ts exactly; edit both in
// the same commit or click-to-shoot drifts from what is drawn.
//
// `r2` is the radius at endpoint B, and NEGATIVE means untapered — which takes
// the plain capsule branch, the exact expression this shader has always run.
// That branch is not an optimisation: with r1 == r2 the round cone is
// mathematically identical but not bit-identical, and characters/
// zombie-blob.test.ts pins the shipped zombie to 0.1 mm. The taper's value is
// the case a capsule cannot express at all — r2 = 0 is a TRUE POINT, where
// smooth-min rounds every tip it touches.
export const CONE_CAP = /* wgsl */ `fn coneCap(q: vec3<f32>, a: vec3<f32>, b: vec3<f32>, r1: f32, r2: f32, minScale: f32) -> f32 {
  if (r2 < 0.0) {
    let ab = b - a;
    let ap = q - a;
    let ab2 = dot(ab, ab);
    let t = select(clamp(dot(ap, ab) / ab2, 0.0, 1.0), 0.0, ab2 == 0.0);
    return (length(q - (a + ab * t)) - r1) * minScale;
  }
  let ba = b - a;
  let l2 = dot(ba, ba);
  if (l2 < 1e-12) { return (length(q - a) - max(r1, r2)) * minScale; }
  let rr = r1 - r2;
  let a2 = l2 - rr * rr;
  let il2 = 1.0 / l2;
  let pa = q - a;
  let y = dot(pa, ba);
  let z = y - l2;
  let x = pa * l2 - ba * y;
  let x2 = dot(x, x);
  let y2 = y * y * l2;
  let z2 = z * z * l2;
  let k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) { return (sqrt(x2 + z2) * il2 - r2) * minScale; }
  if (sign(y) * a2 * y2 < k) { return (sqrt(x2 + y2) * il2 - r1) * minScale; }
  return ((sqrt(x2 * a2 * il2) + y * rr) * il2 - r1) * minScale;
}`;

// Closest-point parameters of a quadratic Bezier to p — ALL clamped cubic
// roots, packed xyz with the count in w. iq's exact construction (shadertoy
// MlKcDD): the closest point of the curve solves a cubic, here in depressed
// form, by Cardano's discriminant (one real root) or the trigonometric
// method (three). Mirrors sdBezierTs in validate.ts; that field backs
// click-to-shoot, so edit both in the same commit.
export const SD_BEZIER_T = /* wgsl */ `fn sdBezierT(p: vec3<f32>, A: vec3<f32>, B: vec3<f32>, C: vec3<f32>) -> vec4<f32> {
  let a = B - A;
  let bv = A - 2.0 * B + C;
  let dv = A - p;

  let kk = 1.0 / dot(bv, bv);
  let kx = kk * dot(a, bv);
  let ky = kk * (2.0 * dot(a, a) + dot(dv, bv)) / 3.0;
  let kz = kk * dot(dv, a);

  // Depressed cubic u^3 + pp*u + qq = 0, with t = u - kx.
  let pp = ky - kx * kx;
  let qq = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  let h = qq * qq + 4.0 * pp * pp * pp;

  if (h >= 0.0) {
    // One real root: the squared distance is monotone either side of it, so
    // the clamped root covers the interior. The |pp| ~ 0 branch is iq's
    // numerical-stability fix — there (plus/minus sqrt(h) - q)/2 cancels
    // catastrophically.
    let h2 = sqrt(h);
    var x1 = (h2 - qq) * 0.5;
    var x2 = (-h2 - qq) * 0.5;
    if (abs(pp) < 1e-4 && qq != 0.0) {
      let k = pp * pp * pp / qq;
      x1 = k;
      x2 = -k - qq;
    }
    let u1 = sign(x1) * pow(abs(x1), 1.0 / 3.0);
    let u2 = sign(x2) * pow(abs(x2), 1.0 / 3.0);
    return vec4<f32>(clamp(u1 + u2 - kx, 0.0, 1.0), 0.0, 0.0, 1.0);
  }
  // Three real roots.
  let z = sqrt(-pp);
  let v = acos(clamp(qq / (pp * z * 2.0), -1.0, 1.0)) / 3.0;
  let m = cos(v);
  let n = sin(v) * 1.7320508;
  return vec4<f32>(
    clamp((m + n) * z - kx, 0.0, 1.0),
    clamp(-(m + n) * z - kx, 0.0, 1.0),
    clamp((n - m) * z - kx, 0.0, 1.0),
    3.0);
}`;

// A capsule swept along a quadratic Bezier from a through control point c to
// b, radius lerping r1 to r2 along the curve parameter. Mirrors sdBentCone in
// validate.ts.
//
// APPROXIMATE, deliberately and openly: the exact SDF of a variable-radius
// sweep is the min over t of (dist(t) - r(t)), whose stationary points differ
// from the pure-distance ones solved above. Evaluating at those candidates
// plus both ends bounds the error by how much the radius moves between
// neighbouring candidates — small for the gentle tapers characters author —
// and errs toward OVERestimating distance outside, never toward swallowing
// the solid. The march absorbs the residual: its relaxed tracer detects and
// retracts overshoots, and steps inside the silhouette shell are under-
// relaxed. Do not tighten this into "exact" without solving G's own cubic.
export const CONE_BEND = /* wgsl */ `fn coneBend(q: vec3<f32>, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, r1: f32, r2: f32, minScale: f32) -> f32 {
  // DEGENERATE GUARD, before the division it protects — same class as the
  // l2 < 1e-12 guard coneCap carries for coincident endpoints. With a
  // collinear control point the curve coefficient bv below is the zero
  // vector, kk = 1/dot(bv,bv) is infinity, and the whole thing returns NaN —
  // and ONE NaN in a smooth-min fold takes the entire body with it. There
  // the straight round cone IS the exact answer, so the fallback costs
  // nothing but the test.
  let bb = a - 2.0 * c + b;
  if (dot(bb, bb) < 1e-12) { return coneCap(q, a, b, r1, r2, minScale); }
  if (dot(b - a, b - a) < 1e-12) { return coneCap(q, a, b, r1, r2, minScale); }
  // UNTAPERED SENTINEL. sdPrim passes r2 = -1 for a prim with no r2=, and
  // coneCap has always branched on it. This function did not: -1 went
  // straight into r1 + (r2 - r1) * t, so an untapered BENT prim's radius ran
  // to minus one metre along its curve and only the start end existed. It
  // hid for as long as every bent prim happened to be tapered; the mouse's
  // sunglass lens — a plain bent capsule — rendered as a single sphere at
  // its inner end. The CPU mirror never saw it because sdPrimitive
  // substitutes radiusB-or-radius before calling sdBentCone.
  let rb = select(r2, r1, r2 < 0.0);
  let cand = sdBezierT(q, a, c, b);
  // dist(t) - r(t) at every root AND both ends, keeping the minimum. The
  // radius term moves the objective's minimiser off the geometric closest
  // point where the taper is steep, so evaluating only the closest t could
  // overestimate — and an overestimated distance steps through surfaces.
  // Passes 2-3 refine locally around the best so far (steps 1/8 then 1/32);
  // monotone, the min can only improve. Mirrors sdBentCone in validate.ts.
  let e1 = (c - a) * 2.0;
  var best = 1e9;
  var bestT = 0.0;
  var ts = array<f32, 9>(cand.x, cand.y, cand.z, 0.0, 0.25, 0.5, 0.75, 1.0, 1.0);
  for (var i = 0; i < 9; i = i + 1) {
    if (f32(i) >= cand.w && i < 3) { continue; }
    let t = ts[i];
    let pt = a + e1 * t + bb * (t * t);
    let v = length(q - pt) - (r1 + (rb - r1) * t);
    if (v < best) { best = v; bestT = t; }
  }
  for (var round = 0; round < 2; round = round + 1) {
    let step = select(0.125, 0.03125, round >= 1);
    for (var s = -1; s <= 1; s = s + 1) {
      let t = clamp(bestT + f32(s) * step, 0.0, 1.0);
      let pt = a + e1 * t + bb * (t * t);
      let v = length(q - pt) - (r1 + (rb - r1) * t);
      if (v < best) { best = v; bestT = t; }
    }
  }
  return best * minScale;
}`;

export const SD_PRIM = /* wgsl */ `fn sdPrim(p: vec3<f32>, i: i32, data: texture_2d<f32>, r2: f32, prof: f32, cpos: vec3<f32>) -> f32 {
  let A = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_A}), 0);
  let B = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_B}), 0);
  let S = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SCALE}), 0);
  let inv = 1.0 / S.xyz;
  let minScale = min(S.x, min(S.y, S.z));
  // Bent above tapered above plain: prof encodes profile + bend (0 round,
  // 1 chamfer, 2 round+bent, 3 chamfer+bent), so > 1.5 means the Bezier
  // path and every straight prim keeps the exact expression it has always
  // run — bit-identical, which is what the zombie pin demands.
  if (prof > 1.5) {
    return coneBend(p * inv, A.xyz * inv, B.xyz * inv, cpos * inv, A.w, r2, minScale);
  }
  return coneCap(p * inv, A.xyz * inv, B.xyz * inv, A.w, r2, minScale);
}`;

// The oriented twin (motion-polish task 3): same ellipsoid capsule, but the
// sample AND the endpoints are first rotated into the prim's local frame —
// the CONJUGATE of the prim's packed quat about the prim midpoint — so an
// anisotropic ellipsoid (the brow is [1.55, 0.42, 0.80]) turns with the head
// instead of staying world-aligned as a detached visor. With an identity quat
// this runs the identical op sequence as sdPrim (bit-identical), which is
// what lets validate.ts's per-prim branch mirror BOTH call sites: mapBody
// hoists the choice to the cluster flag (clusterRange.w), because paying this
// fourth textureLoad for EVERY prim measured +10-18% frame time (1 body:
// 2.41 -> 2.84 ms median; 10 bodies cone+occluder: 14.24 -> 15.75 ms,
// 2026-08-17, benchGpu 240 frames, hiddenSteps 0). Only a turned head cluster
// sets the flag; a rest head's quat is the exact identity, so statues and
// every limb pay nothing.
export const SD_PRIM_ORIENTED = /* wgsl */ `fn sdPrimO(p: vec3<f32>, i: i32, data: texture_2d<f32>, r2: f32, prof: f32, cpos: vec3<f32>) -> f32 {
  let A = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_A}), 0);
  let B = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_B}), 0);
  let S = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SCALE}), 0);
  var qq = p;
  var a = A.xyz;
  var b = B.xyz;
  // The control point rides the same conjugate as the endpoints — the curve
  // is defined in the prim's frame exactly as they are.
  var c = cpos;
  let O = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_QUAT}), 0);
  if (abs(1.0 - O.w) > 1e-6) {
    let mid = (A.xyz + B.xyz) * 0.5;
    // Conjugate of O: vector part negated, w unchanged. Rodrigues-in-quat
    // form: v' = v + 2*w*(u x v) + 2*(u x (u x v)), matching qRotate in vec.ts.
    let u = -O.xyz;
    let vq = qq - mid;
    let tq = 2.0 * cross(u, vq);
    qq = mid + vq + tq * O.w + cross(u, tq);
    let va = a - mid;
    let ta = 2.0 * cross(u, va);
    a = mid + va + ta * O.w + cross(u, ta);
    let vb = b - mid;
    let tb = 2.0 * cross(u, vb);
    b = mid + vb + tb * O.w + cross(u, tb);
    let vc = c - mid;
    let tc = 2.0 * cross(u, vc);
    c = mid + vc + tc * O.w + cross(u, tc);
  }
  let inv = 1.0 / S.xyz;
  qq = qq * inv;
  a = a * inv;
  b = b * inv;
  let minScale = min(S.x, min(S.y, S.z));
  if (prof > 1.5) { return coneBend(qq, a, b, c * inv, A.w, r2, minScale); }
  return coneCap(qq, a, b, A.w, r2, minScale);
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

// Body-local noise frame (motion-polish): translate by the root shift, then
// UNDO the body's applied yaw (packed into ns.y — the y shift is structurally
// zero, see setRootShift) so the noise field wraps the character and turns
// with it instead of the body rotating under a world-fixed texture.
export const NOISE_LOCAL = /* wgsl */ `fn noiseLocal(p: vec3<f32>, ns: vec3<f32>) -> vec3<f32> {
  let dp = vec3<f32>(p.x - ns.x, p.y, p.z - ns.z);
  let ch = cos(ns.y);
  let sh = sin(ns.y);
  return vec3<f32>(dp.x * ch - dp.z * sh, dp.y, dp.x * sh + dp.z * ch);
}`;

// Quaternion triple for the REST-FRAME noise anchor (motion-polish task 6).
// qRot mirrors qRotate in vec.ts (v + 2w(u x v) + 2(u x (u x v))); qMulQ is
// the Hamilton product with vec.qMul's convention — qMulQ(a, b) applies b
// FIRST. qFromToV is the shortest-arc quat taking unit vector u onto v in the
// cheap half-angle form (cross, 1+d) — the same ROTATION as vec.qFromTo's
// acos form, cheaper; the CPU mirror (validate.restSpacePoint) uses this form
// too so the two stay in step.
export const Q_ROT = /* wgsl */ `fn qRot(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + t * q.w + cross(q.xyz, t);
}`;

export const Q_MUL = /* wgsl */ `fn qMulQ(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z);
}`;

export const Q_FROM_TO = /* wgsl */ `fn qFromToV(u: vec3<f32>, v: vec3<f32>) -> vec4<f32> {
  let d = clamp(dot(u, v), -1.0, 1.0);
  if (d >= 0.999999) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  if (d <= -0.999999) {
    // Anti-parallel: any perpendicular axis gives the half turn.
    var seed = vec3<f32>(1.0, 0.0, 0.0);
    if (abs(u.x) >= 0.9) { seed = vec3<f32>(0.0, 1.0, 0.0); }
    return vec4<f32>(normalize(cross(u, seed)), 0.0);
  }
  return normalize(vec4<f32>(cross(u, v), 1.0 + d));
}`;

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
export const REST_POINT = /* wgsl */ `fn restPoint(p: vec3<f32>, data: texture_2d<f32>, best: i32, fallback: vec3<f32>) -> vec3<f32> {
  if (best < 0) { return fallback; }
  let ra = textureLoad(data, vec2<i32>(best, ${ROW_REST_A}), 0);
  if (ra.w <= 0.0) { return fallback; }
  let rb = textureLoad(data, vec2<i32>(best, ${ROW_REST_B}), 0);
  let pa = textureLoad(data, vec2<i32>(best, ${ROW_PRIM_A}), 0).xyz;
  let pb = textureLoad(data, vec2<i32>(best, ${ROW_PRIM_B}), 0).xyz;
  let midP = (pa + pb) * 0.5;
  let midR = (ra.xyz + rb.xyz) * 0.5;
  // The exact local frame first: the conjugate of the packed orient. A zero
  // or identity quat leaves q identity (qRot by it is the identity anyway).
  var q = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  let O = textureLoad(data, vec2<i32>(best, ${ROW_PRIM_QUAT}), 0);
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
      let S = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SCALE}), 0);
      // S.w: 0 add, 1 carve, 2 dead (severed mid-limb). Dead prims stop
      // carving too — a severed hand must not keep biting the field it left.
      // 1 = carve, 3 = groove. 0 (additive) and 2 (dead) are skipped.
      let isCarve = S.w > 0.5 && S.w < 1.5;
      let isGroove = S.w > 2.5;
      if (!isCarve && !isGroove) { continue; }
      let k = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_B}), 0).w;
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
        let T = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SHAPE}), 0);
        r2 = T.x;
        prof = T.y;
        gr = T.zw;
        // Only genuinely-bent prims pay for the bend row; the +2 encoding
        // keeps every "> 0.5 means chamfer" consumer working unchanged.
        if (prof > 1.5) {
          cpos = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_BEND}), 0).xyz;
        }
      }
      let sd = select(sdPrim(p, idx, data, r2, prof, cpos), sdPrimO(p, idx, data, r2, prof, cpos), ori);
      if (isGroove) { d = sdGroove(d, sd, gr.x, gr.y); } else { d = smax(d, -sd, k); }
    }
  }
  return d;
}`;

// Carves every wound out of the field. Burns barely subtract; they char.
//
// woundCfg  = (count, blendK, rimSplay, rimOffset)
// woundCfg2 = (rimWidth, relax, shellAmp, spare) — y and z are consumed by
//             MARCH_BODY, not here; see the woundCfg2 note at the entry point.
// Returns (field, nearWound). nearWound is 1 within twice a wound's radius —
// crater, lip and a margin — where the field is NOT a distance bound (the
// smax fillet overstates distance, the smin saddle and the lip understate
// it), so the relaxed march must step plain there or its overshoot test
// misfires and the crater floor comes out in depth bands (the dark streaks
// across the cyclops's craters, 2026-08-23: gone at relax 1.0, back at 1.4).
export const APPLY_WOUNDS = /* wgsl */ `fn applyWounds(dIn: f32, p: vec3<f32>, data: texture_2d<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>) -> vec2<f32> {
  let n = i32(woundCfg.x);
  var near = 0.0;
  // ONE cavity, not n cuts (overlapping craters, cyclops 2026-08-23). Each
  // wound used to be subtracted in turn — smax(d, -(r - depth)) per wound —
  // which fillets every crater against the FLESH but never against the
  // other craters, so where two blasts overlap their spheres meet in a sharp
  // ridge that draws as a dark streak across the floor. The carves are now
  // unioned with a smooth min first (a saddle between neighbours) and taken
  // out of the flesh once. The lips stay per wound and are summed.
  var carve = 1e9;
  var bump = 0.0;
  for (var i = 0; i < 16; i = i + 1) {
    if (i >= n) { break; }
    let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND}), 0);
    let wMeta = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_META}), 0);
    let isBurn = wMeta.x > 1.5;
    // A burn only opens up as it cooks; a pellet/blast subtracts immediately.
    let depth = select(w.w, w.w * 0.35 * clamp(wMeta.y, 0.0, 1.0), isBurn);
    let r = length(p - w.xyz);
    // Saddle width between neighbouring craters: a quarter of this wound's
    // radius, so two blasts blend over ~3 cm and a pellet pair over ~1.5 cm.
    carve = smin(carve, r - depth, depth * 0.25);
    if (r < depth * 2.0) { near = 1.0; }

    // Everted rim. A plain smooth subtraction leaves a clean dish; real flesh
    // (and the T-1000 taking a shotgun round) PEELS — the displaced material
    // splays outward into a raised lip around the mouth.
    //
    // Modelled as a Gaussian ring just outside the crater. Subtracting from d
    // means "more material here", so this adds a bulge rather than a dent.
    // Burns evert far less: they char and contract instead of tearing open.
    let x = (r - depth * woundCfg.w * wMeta.w) / max(depth * woundCfg2.x, 1e-4);
    let amp = depth * woundCfg.z * wMeta.z * select(1.0, 0.25, isBurn);
    // Surface locality: a bulge of amplitude amp can only displace flesh that
    // was already within ~amp of the pre-wound surface. Ungated, the shell
    // adds material in EMPTY space and welds separate limbs together.
    // OUTER REACH 0.35*amp, NOT 0.7 (floating rims, cyclops 2026-08-23). The
    // lip may only exist within 0.35*amp of the ORIGINAL skin: at 0.7 a blast
    // on the cyclops's hand put 36% of its rim material in empty space
    // (shells bridging the gaps between claws), drawn as a glossy ball from
    // one angle and a ring from another as the marcher caught or missed the
    // shell; at 0.35 it is 12%, at 0.2 4%. 0.35 keeps a visible lip. The
    // ramp spans a full amp (-0.65..0.35): a 0.35..0.7 ramp had ~4x a distance
    // field's gradient and drew as hard bands around the lip (rim banding,
    // 2026-08-22).
    let rimLocal = 1.0 - smoothstep(-amp * 0.65, amp * 0.35, dIn);
    bump = bump + exp(-x * x) * amp * rimLocal;
  }
  if (n <= 0) { return vec2<f32>(dIn, 0.0); }
  return vec2<f32>(smax(dIn, -carve, woundCfg.y) - bump, near);
}`

// 0 at the surface far from wounds, 1 deep inside one. Drives the wet interior.
// Two radii, because two things key on it. x (1.25x the radius) is the
// COLOURING mask — wet red, the deep-colour mix, the wet boost, the cavity
// shading — and stops at the lip's inner edge so the everted lip stays skin
// (a red glossed lip read as a ball from the side, cyclops 2026-08-23).
// y (1.6x) is the FRESNEL fade: rim light must stay off across the whole
// lip, or its grazing-heavy crest clips to a flat white band (X1.17 again —
// it came straight back the day the single mask was pulled in to 1.25x).
export const WOUND_MASK = /* wgsl */ `fn woundMask(p: vec3<f32>, nrm: vec3<f32>, data: texture_2d<f32>, woundCfg: vec4<f32>) -> vec2<f32> {
  var m = vec2<f32>(0.0, 0.0);
  let n = i32(woundCfg.x);
  for (var i = 0; i < 16; i = i + 1) {
    if (i >= n) { break; }
    let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND}), 0);
    let toC = w.xyz - p;
    let r = length(toC);
    // FACING gate. The mask is a sphere around the wound centre, and a blast
    // (r 0.13) stamped on the front of a ~0.2 m torso pokes its sphere out
    // through the BACK: the intact far-side skin fell inside it and drew as
    // wet white sheets when the camera came round (owner, 2026-08-23). What
    // separates cavity from far side is the NORMAL: a cavity wall faces the
    // wound centre (dot ~ +1), the far-side skin faces dead away (~ -1), and
    // the everted lip's crest is only mildly averted (~ -0.2). Colouring
    // gates on near zero. The FRESNEL fade is deliberately NOT gated: a
    // first cut gated it off for strongly-averted surfaces to give far-side
    // skin its rim light back, and the cavity rim seen from BEHIND (averted
    // too) lit up as a white fresnel crescent — the fade must hold at every
    // facing, and skin near a through-wound just goes without rim light.
    let face = dot(nrm, toC / max(r, 1e-5));
    let gCol = smoothstep(-0.25, 0.15, face);
    m.x = max(m.x, (1.0 - smoothstep(0.0, w.w * 1.25, r)) * gCol);
    // FULL fade out to 1.3x, gone by 2x — not a 0..1.6x ramp. The ramp from
    // the CENTRE left only ~60% fade at the cavity wall (r ~= w.w), and the
    // surviving grazing fresnel clipped to flat white slabs hanging over the
    // crater at oblique yaws (owner, 2026-08-23 — X1.17's mechanism escaping
    // the mask; reproduced with the lip amp at zero, vanished with
    // fresnelBoost at zero). The cavity and lip must sit entirely inside the
    // flat region; healthy skin regains rim light past 2x.
    m.y = max(m.y, 1.0 - smoothstep(w.w * 1.3, w.w * 2.0, r));
  }
  return m;
}`

// 0 unburned, 1 fully charred.
export const CHAR_MASK = /* wgsl */ `fn charMask(p: vec3<f32>, data: texture_2d<f32>, woundCfg: vec4<f32>) -> f32 {
  var m = 0.0;
  let n = i32(woundCfg.x);
  for (var i = 0; i < 16; i = i + 1) {
    if (i >= n) { break; }
    let wMeta = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_META}), 0);
    if (wMeta.x < 1.5) { continue; }
    let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND}), 0);
    m = max(m, (1.0 - smoothstep(0.0, w.w * 2.2, length(p - w.xyz))) * clamp(wMeta.y, 0.0, 1.0));
  }
  return m;
}`;

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
}`;

// The cull margin's 4.0 matters: smin scales k by 4 internally, so a cluster
// still bends the surface from 4x the authored blendK away. Using the unscaled
// value clips the fillet and shows up as hard creases along cluster edges.
//
// Carves come first: they are part of the body's own definition. Wounds are
// damage stamped on top of the finished body.
//
// RETURN PACKING (motion-polish task 6): x is the field value, exactly as
// before; y is the DOMINANT prim's index as an f32 — the additive prim whose
// OWN distance was smallest at p (argmin over the fold, tracked with a
// compare against the sd the fold already computed — no extra sdPrim calls,
// no extra textureLoads) — or -1 when no live additive prim was evaluated.
// The march reuses y to anchor the shell displacement and the hit-pixel
// noise without re-running the fold; the noise term below uses it to sample
// the fbm in the dominant prim's REST frame so the texture rides every limb.
export const MAP_BODY = /* wgsl */ `fn mapBody(p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, noiseAmp: f32, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, noiseShift: vec3<f32>, volumeTex: texture_3d<f32>, volumePose0: vec4<f32>, volumePose1: vec4<f32>, volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>, volumeClip: vec4<f32>) -> vec4<f32> {
  var d = 1e9;
  var best = 1e9;
  var bestIdx = -1;
  // VOLUME BRANCH (X1.26): volumePose0.w is the enable flag. Enabled, the
  // baked texture IS the body — d comes from sampleHandVolume and the whole
  // primitive/cluster fold is skipped (counts are zeroed by the hands view,
  // but the branch, not the counts, is what keeps it dead). bestIdx stays -1
  // — the dominant-prim index has no meaning against a volume, and faking
  // one would point restPoint at an unwritten prim row; -1 is its documented
  // no-live-prim path, so the noise falls back to the world-frame anchor.
  if (volumePose0.w > 0.5) {
    d = sampleHandVolume(p, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip);
  } else {
  let clusterCount = i32(counts.y);
  let primCount = i32(counts.x);
  // TWO-LEVEL CULL. The outer loop is the cluster (limb) sphere it has
  // always been; a cluster that survives walks its own BOUND GROUPS
  // (pack.ts boundGroups) — contiguous runs of two to four prims in fold
  // order, each with a sphere small enough that a hip pixel no longer folds
  // the shin (the schoolgirl folded 42 of 56 prims per step through the fat
  // limb spheres alone). Measured against a FLAT group list: iterating all
  // ~37 groups per step cost more in bound reads than the culled prims
  // saved (zombie 2.6 -> 4.8 ms); nesting them under the surviving clusters
  // keeps the far-limb cost at the old two texels.
  for (var c = 0; c < 8; c = c + 1) {
    if (c >= clusterCount) { break; }
    let crange = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_RANGE}), 0);
    if (crange.z < 0.5) { continue; }
    let cbounds = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_BOUNDS}), 0);
    let gspan = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_GROUPS}), 0);
    // The CLUSTER test carries the factor too. A factor-free test (as
    // always shipped) was tried for speed and TORE THE FIELD inside wound
    // cavities: there the running d is negative, the threshold collapses,
    // and an anisotropic cluster culls while still inside smin support —
    // drawn as thin black crack seams across the flesh around wounds
    // (owner, 2026-08-23). The factor makes a plate-bearing cluster
    // (schoolgirl sole: 22x) nearly uncullable, but its GROUPS still cull
    // soundly below, so the cost is a few texel reads, not a full fold.
    if (length(p - cbounds.xyz) - cbounds.w > (d + counts.w * 4.0) * gspan.z) { continue; }
    let gFirst = i32(gspan.x);
    let gCount = i32(gspan.y);
  for (var gi = 0; gi < 64; gi = gi + 1) {
    if (gi >= gCount) { break; }
    let g = gFirst + gi;
    let range = textureLoad(data, vec2<i32>(g, ${ROW_GROUP_RANGE}), 0);
    let bounds = textureLoad(data, vec2<i32>(g, ${ROW_GROUP_BOUNDS}), 0);
    if (length(p - bounds.xyz) - bounds.w > (d + counts.w * 4.0) * range.z) { continue; }
    let start = i32(range.x);
    let count = i32(range.y);
    // range.w is a BITFIELD, not a bool: 1 = oriented group, 2 = some prim
    // here is tapered or chamfered. Both are per-group hoists of a per-prim
    // decision, for the reason sdPrimO's header measures — paying an extra
    // textureLoad for EVERY prim cost +10-18% frame time. A group with no
    // shaped prims never touches ROW_PRIM_SHAPE at all.
    let flags = i32(range.w + 0.5);
    let ori = (flags & 1) != 0;
    let shaped = (flags & 2) != 0;
    for (var i = 0; i < 64; i = i + 1) {
      if (i >= count) { break; }
      let idx = start + i;
      if (idx >= primCount) { break; }
      let S = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SCALE}), 0);
      // S.w: 0 add, 1 carve, 2 dead (severed mid-limb) — both skip the fold.
      if (S.w > 0.5) { continue; }
      let k = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_B}), 0).w;
      // One sd evaluation feeds BOTH the smin fold and the argmin tracker —
      // a second call would double the texture fetches this loop lives on.
      var r2 = -1.0;
      var prof = 0.0;
      var cpos = vec3<f32>(0.0, 0.0, 0.0);
      if (shaped) {
        let T = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SHAPE}), 0);
        r2 = T.x;
        prof = T.y;
        // Only genuinely-bent prims pay for the bend row; the +2 encoding
        // keeps every "> 0.5 means chamfer" consumer working unchanged.
        if (prof > 1.5) {
          cpos = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_BEND}), 0).xyz;
        }
      }
      var sd = sdPrim(p, idx, data, r2, prof, cpos);
      if (ori) { sd = sdPrimO(p, idx, data, r2, prof, cpos); }
      if (sd < best) { best = sd; bestIdx = idx; }
      // Chamfer is profile bit 0; bend is +2, so the old "prof > 0.5" test
      // would wrongly chamfer a plain-bent prim — bounded above now.
      if (prof > 0.5 && prof < 1.5) { d = sminChamfer(d, sd, k); } else { d = smin(d, sd, k); }
    }
  }
  }
  }
  let carved = applyCarves(d, p, data, counts);
  let dmgRes = applyWounds(carved, p, data, woundCfg, woundCfg2);
  let dmg = dmgRes.x;
  let nearWound = dmgRes.y;
  // Silhouette detail. The MARCH passes 0.0 here and only calcNormal passes a
  // real amplitude, so this term no longer displaces the surface — it survives
  // solely to give calcNormal's tetrahedron differences something to
  // differentiate, which warps the shading normal. See MARCH_BODY.
  //
  // Keeping it expressed as a field displacement rather than as a hand-written
  // gradient is deliberate: calcNormal returns normalize(grad(d + h)), which is
  // EXACTLY the normal the displaced surface had before. So the shading is
  // unchanged to the precision of the differencing, and only the silhouette
  // and the hit position lose the detail — which is the whole trade.
  //
  // The guard stays and now matters more than ever, since the march relies on
  // this call costing nothing: fbm is two 3D value-noise lookups, sixteen
  // hash13 calls, and without the branch a zero amplitude still pays in full.
  if (noiseAmp <= 0.0) { return vec4<f32>(dmg, f32(bestIdx), nearWound, 0.0); }
  // NOISE ANCHOR (motion-polish task 6): the fbm samples the DOMINANT prim's
  // REST frame — the texture is baked into the model, so gait bob, arm raises
  // and jiggle carry their skin instead of sliding through the world-frame
  // field. restPoint falls back to the old root-shift anchor (noiseLocal)
  // when there is no live prim or the rest rows were never written.
  let anchor = restPoint(p, data, bestIdx, noiseLocal(p, noiseShift));
  return vec4<f32>(dmg + fbm(anchor * 3.0) * noiseAmp, f32(bestIdx), nearWound, 0.0);
}`;

// Tetrahedron differences. Epsilon stays SMALL: the prior blendshell experiment
// used 0.02 (2 cm on 6 cm limbs) and smeared normals exactly at the
// high-curvature joints where they matter most.
export const CALC_NORMAL = /* wgsl */ `fn calcNormal(p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, noiseAmp: f32, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, noiseShift: vec3<f32>, volumeTex: texture_3d<f32>, volumePose0: vec4<f32>, volumePose1: vec4<f32>, volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>, volumeClip: vec4<f32>) -> vec3<f32> {
  let e = vec2<f32>(1.0, -1.0) * 0.0015;
  return normalize(
    e.xyy * mapBody(p + e.xyy, data, counts, noiseAmp, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip).x +
    e.yyx * mapBody(p + e.yyx, data, counts, noiseAmp, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip).x +
    e.yxy * mapBody(p + e.yxy, data, counts, noiseAmp, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip).x +
    e.xxx * mapBody(p + e.xxx, data, counts, noiseAmp, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip).x);
}`;

// Nearest-neighbour fetch by uv.
//
// textureLoad rather than textureSample, deliberately: the face sheet is
// authored as chunky NearestFilter art on both paths, so a sampler would buy
// nothing but a second binding to declare — and wgslFn's `sampler` parameter
// has no TSL node to feed it that the data-texture path already proves out.
// Clamp-to-edge is done here by hand, which is what the GLSL sampler's default
// wrap mode was doing implicitly.
export const TEXEL = /* wgsl */ `fn texel(tex: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(tex, 0));
  let c = clamp(vec2<i32>(floor(uv * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  return textureLoad(tex, c, 0);
}`;

// Irregular flicker. Three incommensurate sines rather than one, because a
// single sine reads as a machine pulsing and the eye picks the period out
// immediately; overlapping periods never quite repeat.
export const FLICKER = /* wgsl */ `fn flicker(t: f32, amt: f32) -> f32 {
  let a = sin(t * 11.3) * 0.5 + 0.5;
  let b = sin(t * 23.7 + 1.3) * 0.5 + 0.5;
  let c = sin(t * 3.1 + 0.7) * 0.5 + 0.5;
  let f = a * 0.35 + b * 0.25 + c * 0.40;
  // Biased upward so it mostly burns and only occasionally dips, rather than
  // spending half its time dark.
  return mix(1.0, 0.45 + f * 0.75, amt);
}`;

// CONE MARCH — the coarse pre-pass.
//
// Runs at a fraction of the resolution and answers one question per tile: how
// far can EVERY ray in this tile travel before any of them could possibly hit
// something? The full-resolution march then starts there instead of at the
// camera, skipping the empty space in front of the body.
//
// The cone is what makes it safe. A ray marched at tile centre would report a
// distance valid only for that one ray; a neighbouring ray in the same tile
// might have geometry nearer and would tunnel straight through it. So this
// marches a CONE whose radius grows with distance to cover the tile's whole
// screen footprint, and stops as soon as the field comes within that radius.
// The result is conservative for every ray the tile covers.
//
// `coneK` is the footprint radius per unit distance: tilePixels * tan(fovY/2)
// / viewportHeight. Stepping by (d - r) rather than d is the standard cone
// march step — it is what keeps the cone outside the surface.
//
// LEVELS CHAIN, AND FINER IS WHAT HELPS. A coarser level above the first would
// only cheapen the pre-pass, which is already a fraction of the pixels; it
// would not improve the distance handed to the full march. A FINER level does,
// because coneK shrinks with tile size and a narrower cone travels further
// before it touches. So the chain runs wide to narrow — 8x8, then 2x2 — each
// starting from the last.
//
// Returns the distance, or tMax when the cone never came near anything. tMax
// is the right answer for a miss rather than zero: a cone that missed means
// every ray in the tile misses too, so there is nothing for them to skip past.
export const CONE_MARCH = /* wgsl */ `fn coneMarch(
  worldPos: vec3<f32>,
  camPos: vec3<f32>,
  data: texture_2d<f32>,
  volumeTex: texture_3d<f32>,
  volumePose0: vec4<f32>,
  volumePose1: vec4<f32>,
  volumeMin: vec3<f32>,
  volumeInvExtent: vec3<f32>,
  volumeWarp: vec4<f32>,
  volumeClip: vec4<f32>,
  counts: vec4<f32>,
  marchCfg: vec3<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  coneK: f32,
  startT: f32
) -> f32 {
  let rd = normalize(worldPos - camPos);
  let tMax = length(worldPos - camPos);
  // Chained levels: this cone begins where the coarser one stopped. Safe
  // because a NARROWER cone can only travel further than a wider one before
  // touching — which is the whole reason a second, finer level is worth
  // running at all.
  var t = clamp(startT, 0.0, tMax);
  for (var i = 0; i < 64; i = i + 1) {
    // 0.0 for the noise: it lives on the normal now, not in the field. The
    // pre-pass must see the same field the march does, or the distance it
    // certifies as empty is not a distance the march can trust. The noise
    // shift is irrelevant at amplitude 0 (mapBody short-circuits the fbm), so
    // the zero vector keeps this pass independent of the motion plumbing.
    // The volume block rides along for the same reason (X1.26): a cone that
    // ignored an enabled volume would certify empty space inside the hand.
    let d = mapBody(camPos + rd * t, data, counts, 0.0, woundCfg, woundCfg2, vec3<f32>(0.0, 0.0, 0.0), volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip).x;
    let r = t * coneK;
    // + woundCfg2.z (shell displacement, X1.21.2): the emptiness this pass
    // certifies is measured against the SMOOTH field, but the shell displaces
    // the real surface OUTWARD by up to ~0.9 amp wherever the fbm dips. A
    // bump standing proud of the smooth surface can sit CLOSER to the camera
    // than the distance this pass proved empty, so a march started there
    // skips its crest whole — hard-edged pale tile-shaped patches across
    // shoulders and arms, because the miss is per tile. Stopping one amp
    // early hands that band back to the full march, which walks it
    // conservative and hits the bumps properly. Zero when the shell is off,
    // so the undisplaced behaviour is bit-identical.
    if (d < r + 0.0012 + woundCfg2.z) { return t; }
    t = t + max(d - r, 0.0005) * marchCfg.y;
    if (t > tMax) { return tMax; }
  }
  return t;
}`;

// Entry point. Returns rgb plus the hit distance in w, so the depth node can
// reconstruct the hit point without marching a second time.
//
// Parameter groups, all vec4-packed to keep the argument list survivable:
//   volumeTex  the baked hand volume (X1.26); every non-volume view binds
//              the shared 1-cubed fallback and leaves the enable flag 0
//   volumePose0 xyz = volume world centre, w = volume enable (0 = primitive)
//   volumePose1 xyzw = volume local-to-world quaternion
//   volumeMin   metric min corner of the volume AABB (local space)
//   volumeInvExtent 1/(boundsMax - boundsMin), per axis
//   volumeWarp  xyz = distal warp offset in local metres (CPU clamps it to
//               12 mm); zero vector = no warp. w is spare.
//   volumeClip  x/y = adjacent frame indices, z = mix alpha, w = frame
//               depth. Static v1 binds [0,0,0,nz] (slab 0, alpha 0 = the
//               exact v1 sample); the shared fallback binds [0,0,0,1]; a
//               v2 clip binds frameDepth and drives x/y/z per frame.
//   counts     x primCount, y clusterCount, z carveCount, w maxBlendK
//   marchCfg   x steps, y stepMul, z silhouetteNoiseAmp
//   woundCfg   x count, y blendK, z rimSplay, w rimOffset
//   woundCfg2  x rimWidth, y relaxation factor, z shellAmp (silhouette shell)
//   lightCfg   x keyIntensity, y fillIntensity
//   surfCfg    x specIntensity, y specRoughness, z fresnelBoost, w translucency
//   surfCfg2   x wetness, y surfaceNoiseAmp, z mottleAmp, w mottleScale
//   mottleColor  the colour the mottle mixes toward (linear RGB)
//   faceCfg    x enabled, y strength, z forward (+1/-1), w relief
//   faceCfg2   x projMode (0 planar, 1 spherical), y mean, z glowThreshold,
//              w glowStrength
//   faceCfg3   x glowFlicker, y timeSeconds, zw = noise root shift (xz world;
//              the y shift is zero — root translation is ground-plane)
//   faceProj   xy = scale of head-space xy -> uv, zw = uv centre
//   headQuat   xyzw = the rigid head rotation (rig-bind headQuatOf); the face
//              projection un-rotates by its conjugate so the painted face
//              rides the rotating skull. Identity (0,0,0,1) on statues/chunks.
//   faceAtlas  xy = uv scale, zw = uv offset — crops the head out of the sheet
//   lodCfg     x aoEnabled, y legacyGamma, w goreStrength (0 body, 1 chunk views)
//
// LOD NOTE: most quality levers are guarded by their own amplitude reaching
// zero (silhouette noise, surface noise, translucency, face, wounds), so the
// LOD system drives them through uniforms that already existed. AO needs
// lodCfg.x because "no ambient occlusion" has no amplitude to turn down;
// the gore mask took the spare lodCfg.w for the same reason — "no gore"
// has no colour amplitude to fade to.
export const MARCH_BODY = /* wgsl */ `fn marchBody(
  worldPos: vec3<f32>,
  camPos: vec3<f32>,
  data: texture_2d<f32>,
  volumeTex: texture_3d<f32>,
  faceTex: texture_2d<f32>,
  volumePose0: vec4<f32>,
  volumePose1: vec4<f32>,
  volumeMin: vec3<f32>,
  volumeInvExtent: vec3<f32>,
  volumeWarp: vec4<f32>,
  volumeClip: vec4<f32>,
  counts: vec4<f32>,
  marchCfg: vec3<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  baseColor: vec3<f32>,
  deepColor: vec3<f32>,
  charColor: vec3<f32>,
  lightDir: vec3<f32>,
  keyColor: vec3<f32>,
  lightCfg: vec2<f32>,
  surfCfg: vec4<f32>,
  surfCfg2: vec4<f32>,
  mottleColor: vec3<f32>,
  faceCfg: vec4<f32>,
  faceCfg2: vec4<f32>,
  faceCfg3: vec4<f32>,
  faceProj: vec4<f32>,
  faceAtlas: vec4<f32>,
  headCentre: vec3<f32>,
  headAxes: vec3<f32>,
  headQuat: vec4<f32>,
  faceGlowColor: vec3<f32>,
  lodCfg: vec4<f32>,
  startT: f32,
  occT: f32
) -> vec4<f32> {
  let rd = normalize(worldPos - camPos);
  // OCCLUDER PRE-PASS. occT is the distance to the nearest point of a
  // conservative INNER hull of the scene — geometry guaranteed to lie inside
  // the real surface, rasterised depth-only before this pass.
  //
  // Clamping tMax by it is the entire consumption path, and it is safe in the
  // one direction that matters: the hull is INSIDE the body, so any true
  // surface along this ray is NEARER than the hull that covers it. Cutting the
  // ray at the hull can therefore never remove a hit that would have been
  // visible — it only stops the march from grinding through the full step
  // budget in space that something solid already covers.
  //
  // + woundCfg2.z (shell displacement, X1.21.2) buys back the one exception
  // that direction had. The shell can also dent the surface INWARD, and a
  // dent retreats up to ~0.9 amp below the smooth field the hull was sized
  // against; the hull clearance is only (1 - shrink) of the prim radius, so on
  // thin limbs a dent can pass BEHIND the hull sphere along the ray — and a
  // march whose tMax stops at the hull discards the pixel outright. On screen
  // that is dark dropout where the displaced skin should be; A/B with the
  // occluder off and the shell on makes it vanish. Extending the bound by one
  // amp reaches every dent the fbm can cut, while bumps stand PROUD of the
  // hull and were never at risk. Zero when the shell is off, so the
  // undisplaced bound is bit-identical.
  let tMax = min(length(worldPos - camPos), occT + woundCfg2.z);
  let steps = i32(marchCfg.x);
  // HIT EPSILON (X1.26): the primitive literal was 1.2 mm. A trilinear
  // reconstruction of a baked SDF is not exact to the surface, so volume
  // mode raises the threshold through the SPARE woundCfg2.w channel to at
  // least half the largest voxel pitch (set by the hands view). max() keeps
  // the primitive path bit-identical at the default 0.
  let hitEps = max(0.0012, woundCfg2.w);
  // NOISE ANCHOR (motion-polish task 6): every fbm below samples the
  // DOMINANT prim's REST frame via restPoint — the noise is baked into the
  // model. noiseShift (faceCfg3.zw + lodCfg.z, the task-3 root-shift anchor)
  // survives ONLY as restPoint's fallback for bodies without rest rows and
  // for the no-live-prim case. Zero = the pre-motion behaviour there.
  let noiseShift = vec3<f32>(faceCfg3.z, lodCfg.z, faceCfg3.w);

  // RELAXED SPHERE TRACING (Keinert et al. 2014; Balint & Valasek 2018).
  //
  // Plain sphere tracing steps by exactly the unbounding radius. This shader
  // used to step by 0.6 of it — UNDER-relaxation, costing ~1.67x the
  // iterations of the textbook algorithm — because the silhouette fbm added to
  // mapBody broke the Lipschitz bound, so the "distance" could overestimate
  // and a full step could tunnel through the surface.
  //
  // The overshoot test is the whole safety argument: if the new unbounding
  // sphere does not reach back far enough to touch the previous one, the step
  // jumped over a gap the spheres never covered, so it is retracted and the
  // step falls back to the conservative radius.
  // woundCfg2.y carries the relaxation factor so it stays tunable — the win is
  // theory until it is measured, and it cannot be measured against a constant.
  // At or below 1.0 the relaxed path is off and marchCfg.y is back in charge.
  // NORMAL WARPING (Hubert-Brierre et al. 2025) is why this is no longer
  // conditional on the noise amplitude. The silhouette fbm has been taken OUT
  // of the marched field — see the mapBody call below, which passes 0.0 — and
  // survives only in calcNormal, where it perturbs the shading normal at the
  // hit point. The field the tracer sees is therefore an exact CSG of
  // ellipsoid capsules under a conservative smooth-min for EVERY body, not
  // just the distant ones LOD had already stripped, so over-relaxation is
  // always safe and marchCfg.y no longer has to be held under 1.
  //
  // SHELL DISPLACEMENT (gobs-and-goo task 4) is the owner-approved middle
  // path that brings the bumpy outline BACK: the relaxed march runs the
  // smooth field until it is inside a thin shell of the surface, and only
  // there does the fbm displace the stepped distance — see the loop body.
  let relax = woundCfg2.y > 1.0;
  var omega = select(marchCfg.y, woundCfg2.y, relax);
  // Start where the cone pre-pass proved the tile is still empty, rather than
  // at the camera. Clamped to tMax so a stale or over-eager coarse value can
  // never push the ray straight out the back of the proxy box.
  var t = clamp(startT, 0.0, tMax);
  var hit = false;
  var prevRadius = 0.0;
  var stepLen = 0.0;
  var clamped = false;
  // Dominant prim at the last field sample (mapBody.y) — the hit pixel's
  // noise anchor reuses it instead of re-running the fold (task 6).
  var hitBest = -1;
  for (var i = 0; i < 512; i = i + 1) {
    if (i >= steps) { break; }
    // 0.0, not marchCfg.z: the field mapBody returns stays SMOOTH — the fbm
    // still reaches the normal only via calcNormal — but inside a thin shell
    // of the surface the same fbm is added to the REAL stepped distance just
    // below, which is where the silhouette gets its bumps back without
    // paying fbm at every step of the empty approach.
    let dres = mapBody(camPos + rd * t, data, counts, 0.0, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip);
    var d = dres.x;
    hitBest = i32(dres.y);
    // Shell displacement: inside a thin shell of the smooth surface, the
    // silhouette noise displaces the REAL field — bumpy outlines are back —
    // and stepping goes conservative because the noise breaks the Lipschitz
    // bound. Outside the shell the relaxed march is untouched. The fbm
    // samples the dominant prim's REST frame (task 6), glued to the flesh;
    // restPoint's loads are paid only inside the shell band.
    let shellAmp = woundCfg2.z;
    var conservative = false;
    if (shellAmp > 0.0 && abs(d) < shellAmp * 4.0) {
      d = d + fbm(restPoint(camPos + rd * t, data, i32(dres.y), noiseLocal(camPos + rd * t, noiseShift)) * 3.0) * shellAmp;
      conservative = true;
    }
    // Near a wound (mapBody.z) the field is not a distance bound — see
    // applyWounds — so step UNDER-relaxed at 0.6, exactly as the noise shell
    // does, and skip the overshoot test (a retraction there takes back a
    // step that was never relaxed). Plain 1.0 stepping was tried first and
    // still banded: the smax fillet overstates distance, so even an exact
    // sphere step lands past the crater wall.
    let nearWound = dres.z > 0.5;
    let radius = abs(d);
    let overshot = !conservative && !nearWound && omega > 1.0 && (radius + prevRadius) < stepLen;
    if (overshot) {
      // Undo the part of the last step that was not covered by the spheres,
      // and drop to plain sphere tracing for the rest of this ray. Skipped on
      // a displaced sample — the retraction rewinds by the omega excess,
      // which is only the real excess when stepLen was d times omega, and a
      // shell step was already under-relaxed at 0.6 so there is nothing to
      // take back.
      stepLen = stepLen - omega * stepLen;
      omega = 1.0;
    } else {
      if (d < hitEps) { hit = true; break; }
      stepLen = d * select(omega, 0.6, conservative || nearWound);
    }
    prevRadius = radius;
    t = t + stepLen;
    if (t > tMax) {
      // Do NOT break outright on the relaxed path. An over-relaxed step can
      // cross the surface AND tMax together, and the overshoot test cannot
      // fire until the NEXT sample — so breaking here discards a hit the
      // retraction would have recovered. Harmless while tMax was the proxy
      // box's far side; the occluder pre-pass made tMax a bound that can sit
      // millimetres behind the surface, and this break shredded every body
      // whose hull gap was tight (the interpenetrating-crowd holes).
      //
      // Instead, take the pending sample AT tMax: if the step did cross the
      // surface, the overshoot test fires there and the retraction replays
      // the interval at omega 1. One extra visit at most — the clamped flag —
      // so a genuinely empty ray still terminates. The plain path is exempt:
      // at omega <= 1.0 steps are conservative and nothing can be skipped.
      if (omega <= 1.0 || clamped) { break; }
      t = tMax;
      clamped = true;
    }
  }
  if (!hit) { discard; }

  let p = camPos + rd * t;
  var n = calcNormal(p, data, counts, marchCfg.z, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip);
  // The hit pixel's REST-space noise anchor (task 6): every fbm below —
  // micro-detail, gore mottle — samples the dominant prim's rest frame, so
  // the surface texture rides the limb through gait and jiggle. Computed
  // once here; the fallback keeps the old root-shift anchor for bodies with
  // no rest rows (the FPV hands view).
  let anchor = restPoint(p, data, hitBest, noiseLocal(p, noiseShift));
  // Micro-detail perturbs the normal only — costs no march safety. Three more
  // fbm calls though, so it is guarded: once per hit pixel rather than per
  // step, but still six noise lookups a body does not always need.
  if (surfCfg2.y > 0.0) {
    n = normalize(n + vec3<f32>(
      fbm(anchor * 22.0), fbm(anchor * 22.0 + 5.0), fbm(anchor * 22.0 + 11.0)) * surfCfg2.y);
  }

  let wmBoth = woundMask(p, n, data, woundCfg);
  let wm = wmBoth.x;      // colouring / wet / cavity shading
  let wmRim = wmBoth.y;   // fresnel fade, covers the lip
  let cm = charMask(p, data, woundCfg);
  var albedo = mix(baseColor, deepColor, wm);

  // Colour mottle. surfaceNoiseAmp above perturbs the NORMAL, which reads as
  // texture but never as colour — under a broad key the whole creature stays
  // one hue and the silhouette reads as a single object. This is the albedo
  // twin, and it is what stops every .blob character being the same flat
  // sheet of flesh.
  //
  // Sampled off anchor, the REST-space point, exactly like the micro-detail
  // and the gore mottle: blotches then ride a limb through gait instead of
  // swimming across the surface as the body moves. A world-space sample looks
  // fine on a statue and wrong the moment anything walks.
  //
  // Before the wound/gore/face passes, so damage and the face still paint over
  // it — mottle is the flesh's own colour, not a layer on top. Amplitude-
  // guarded like every other quality lever here (see the LOD NOTE above), so a
  // preset that leaves mottleAmp at 0 skips the fbm entirely and shades
  // bit-for-bit as it did before this existed.
  if (surfCfg2.z > 0.0) {
    // smoothstep, NOT the obvious 0.5 + 0.5*fbm remap.
    //
    // fbm here is two octaves of trilinear value noise summed at 0.6/0.3, and
    // like any such sum it concentrates hard around zero — the tails near
    // +/-0.9 are rare. Rescaling the nominal -1..1 range linearly therefore
    // lands almost every pixel near 0.5, which is not mottling at all: it is a
    // uniform half-strength tint toward mottleColor, so the body just goes
    // flatly darker and the amplitude reads as a brightness knob. That is
    // exactly what the first version did on screen.
    //
    // Mapping the range the noise ACTUALLY occupies to the full 0..1 is what
    // produces patches with light flesh between them. The bounds are the
    // working range, not the theoretical one.
    //
    // Note the frequency: fbm multiplies its own input by 4 and 9, so
    // mottleScale is roughly a quarter of the resulting cycles per metre. A
    // scale near 1 gives patches a hand-span across on a human-sized body;
    // by 5 it is already freckles, and past ~10 it aliases into what looks
    // like compression noise rather than skin.
    let blotch = smoothstep(-0.35, 0.35, fbm(anchor * surfCfg2.w));
    albedo = mix(albedo, mottleColor, blotch * surfCfg2.z);
  }

  // Gore mask (gobs-and-goo spec §2): chunks are torn meat, not clean latex.
  // fbm mottling + proximity to the torn wounds; blends toward wet deep red
  // and darker clot, and rides the wet boost so bloody regions glisten.
  // Sits BEFORE the face/char pass so a torn-off head still gets its face
  // and char painted over the gore, and before the wet line, which maxes wm
  // against gore. goreStrength is 0 on the body view, so standing bodies skip
  // the whole block — including its fbm — and shade exactly as before.
  let goreStrength = lodCfg.w;
  var gore = 0.0;
  if (goreStrength > 0.0) {
    let mottle = clamp(fbm(anchor * 6.0) * 0.5 + 0.5, 0.0, 1.0);
    gore = clamp(mottle * 0.55 + wm * 0.65, 0.0, 1.0) * goreStrength;
    let clot = deepColor * 0.55;
    albedo = mix(albedo, mix(deepColor, clot, mottle), gore * 0.85);
  }

  // Emissive mask from the face sheet; added into the lit colour further down.
  var faceGlow = 0.0;
  // Decal coverage at this pixel (facing * alpha, decal mode only): drives
  // the FLAT-LIGHTING blend at fleshLit. A painted PSX face is authored
  // pre-lit; shading it again buries the nose and lips under the fringe
  // shadow and the jaw's diffuse falloff.
  var faceFlat = 0.0;

  // Face texture, before wounds and char so damage still paints over it.
  if (faceCfg.x > 0.5) {
    let forward = faceCfg.z;
    // Head-space position, normalised PER AXIS by the skull's own semi-axes —
    // re-uploaded every frame from the posed primitives, so the projection
    // rides the head as it jiggles without a full rest-space transform. One
    // scalar radius put whichever axis was largest exactly on the head-mask
    // cutoff, and raising headDepth then erased the entire face.
    // Un-rotate into the head's REST frame before projecting (motion-polish):
    // the rigid head pass rotates the skull masses, and a projection that
    // stays axis-aligned paints the face onto whichever side happens to face
    // front — nose mass out the ear, eyes off the brow. Rotation by the
    // CONJUGATE of the head quaternion (v' = v + 2*cross(-q.xyz, cross(-q.xyz, v) + q.w*v)).
    let hql = -headQuat.xyz;
    let hpv = p - headCentre;
    let hrot = hpv + 2.0 * cross(hql, cross(hql, hpv) + headQuat.w * hpv);
    let hs = hrot / max(headAxes, vec3<f32>(1e-4, 1e-4, 1e-4));
    var raw = vec2<f32>(hs.x * forward, hs.y);
    if (faceCfg2.x > 0.5) {
      let dir = normalize(hs);
      // Longitude measured from the front, latitude from the equator. Both
      // normalised to -1..1 so faceProj means the same thing in either mode.
      // NOTE atan2 — GLSL's two-argument atan() renames on this path.
      raw = vec2<f32>(
        atan2(dir.x * forward, dir.z * forward) / 3.14159265,
        asin(clamp(dir.y, -1.0, 1.0)) / 1.57079633);
    }
    let uv = raw * faceProj.xy + faceProj.zw;
    // Fade by how squarely this surface faces the front, so the projection does
    // not smear a second face down the sides and back of the skull. A planar
    // projection derives uv from x/y alone, so as the surface turns away it
    // repeats the same uv column and STREAKS; fading out well before edge-on
    // hides that.
    // The facing axis is the head's rotated forward, not world +z.
    let hfw = vec3<f32>(0.0, 0.0, forward);
    let hfr = hfw + 2.0 * cross(headQuat.xyz, cross(headQuat.xyz, hfw) + headQuat.w * hfw);
    var facing = smoothstep(0.28, 0.66, dot(n, hfr));
    // Confine it to the HEAD. Generous, because the surface now sits at
    // |hs| ~= 1 everywhere and the jaw hangs past that: this is only a backstop
    // against wrapping onto the neck.
    // A DECAL (faceCfg.x == 2) gets half again the reach: hs is normalised by
    // the FATTEST head prim, which on a character with hair is the crown
    // shell, centred well above the face -- the schoolgirl's mouth sat at
    // |hs| 1.55 and faded out at every projection setting. The decal's own
    // alpha and the facing fade bound it instead.
    let decal = select(0.0, 1.0, faceCfg.x > 1.5);
    let reach = 1.0 + 0.5 * decal;
    facing = facing * (1.0 - smoothstep(1.30 * reach, 1.70 * reach, length(hs)));
    if (facing > 0.0 && uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
      let base = uv * faceAtlas.xy + faceAtlas.zw;
      // Not linearised, deliberately: the sheet is sRGB-encoded and so are the
      // hand-tuned flesh colours it blends against, which were authored to
      // compensate for the missing output encode. Revisit both together at the
      // preset retune, not before.
      let tex = texel(faceTex, base);
      faceFlat = facing * tex.a * decal;
      let W = vec3<f32>(0.2126, 0.7152, 0.0722);
      // DECAL mode (faceCfg.x == 2): the sheet is a colour image baked off a
      // reference mesh and pasted on as albedo where its alpha is set, the way
      // a PSX face was painted onto a head. No glow -- a photo is bright in
      // many places that are not eyes -- and no relief, because its luminance
      // edges (hairline, lips) are colour changes, not height.
      faceGlow = smoothstep(faceCfg2.z, 1.0, dot(tex.rgb, W)) * facing * tex.a * (1.0 - decal);

      // Otherwise a MULTIPLIER, not a replacement: the generated sheet carries
      // baked lighting, so pasting it in as albedo and lighting it again
      // double-shades. Dividing by its measured mean keeps the pattern and
      // throws away level.
      let detail = tex.rgb / max(faceCfg2.y, 1e-3);
      // Skip the multiply where it glows: an eye is not tinted flesh, and the
      // emissive term below supplies its colour outright.
      albedo = mix(albedo, mix(albedo * detail, tex.rgb, decal),
                   facing * tex.a * faceCfg.y * (1.0 - faceGlow));

      // Relief. Central differences on luminance give the height gradient; the
      // projection is planar along z, so its tangent basis is just x and y and
      // the bump drops straight into world space with no TBN to build.
      if (faceCfg.w > 0.0 && decal < 0.5) {
        let e = faceAtlas.xy * 0.012;
        let hL = dot(texel(faceTex, base - vec2<f32>(e.x, 0.0)).rgb, W);
        let hR = dot(texel(faceTex, base + vec2<f32>(e.x, 0.0)).rgb, W);
        let hD = dot(texel(faceTex, base - vec2<f32>(0.0, e.y)).rgb, W);
        let hU = dot(texel(faceTex, base + vec2<f32>(0.0, e.y)).rgb, W);
        // Negated: the gradient points UPHILL, and a normal tilts away from
        // rising ground. Without this the sockets would bulge instead of sink.
        let bumpL = vec3<f32>(-(hR - hL) * forward, -(hU - hD), 0.0);
        // The bump lives in the PROJECTION frame (the un-rotated head/hand
        // space the uv was derived in) — rotate it by headQuat into world,
        // the same rotation hfr gets above. Identity for an unrotated head;
        // load-bearing for the hands view, whose frame is a large rotation
        // (Opus hands round 3 — grooves shaded from a skewed direction).
        let bump = bumpL
          + 2.0 * cross(headQuat.xyz, cross(headQuat.xyz, bumpL) + headQuat.w * bumpL);
        // Suppressed where it glows: bright means RAISED to a height map, so
        // without this the eyes bulge out of their sockets.
        n = normalize(n + bump * faceCfg.w * facing * tex.a * (1.0 - faceGlow));
      }
    }
  }

  // PER-PRIMITIVE COLOUR. The fold already reports the nearest primitive at
  // the hit (hitBest, the noise anchor); a painted one replaces the flesh
  // albedo outright, mottle and face sheet included — a lens is not tinted
  // skin. Char still wins below, because burnt is burnt. The eye glow is
  // zeroed on paint for the same reason the sheet is: the painted eyes sit
  // exactly where a pair of sunglasses goes, and they must not shine
  // through the lenses.
  var gloss = 0.0;
  var painted = 0.0;
  if (hitBest >= 0) {
    let PC = textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_COLOR}), 0);
    if (PC.w > 0.0) {
      albedo = PC.xyz;
      gloss = clamp(PC.w - 1.0, 0.0, 1.0);
      painted = 1.0;
    }
  }
  faceGlow = faceGlow * (1.0 - painted);

  albedo = mix(albedo, charColor, cm);

  let L = normalize(lightDir);
  let V = -rd;
  let H = normalize(L + V);
  let diff = max(dot(n, L), 0.0);

  // Wounds are wetter than the surrounding skin; char is dead matte. Gore
  // rides the same boost: bloody chunk regions glisten like open wounds.
  // gloss pulls a painted surface toward a tight, fully wet highlight
  // whatever the flesh preset says: a lens on a matte clay character still
  // has to glint.
  let wet = mix(surfCfg2.x * mix(1.0, 1.6, max(wm, gore)) * (1.0 - cm), 1.0, gloss);
  // Gated by light facing: a Blinn-Phong H highlight fires even where the
  // surface faces AWAY from the key (dot(n,L) < 0, dot(n,H) still positive at
  // grazing). On matte skin it was too dim to see; the 1.6x wound wet boost
  // lifted it into saturated white blobs ringing a crater seen from the dark
  // side (owner, 2026-08-23). Soft ramp, not a step, so the terminator keeps
  // its sheen.
  let specGate = smoothstep(-0.08, 0.12, dot(n, L));
  let shine = pow(max(dot(n, H), 0.0), mix(mix(128.0, 4.0, surfCfg.y), 220.0, gloss)) * specGate;
  // Fresnel fades out INSIDE wounds rather than riding the wet boost: it is
  // environment rim-light, and inside a cavity the "environment" is the wound
  // itself. At full strength it maxes out on the grazing-heavy rim geometry,
  // the 1.6x wound wetness lands on top, and whole patches clip to white and
  // sweep across the cavity as the camera moves (X1.17). The wet glisten a
  // wound SHOULD have is the tight specular term, which keeps the boost.
  let fres = pow(1.0 - max(dot(n, V), 0.0), 4.0) * surfCfg.z * (1.0 - wmRim);

  // Fake backlit scatter: sample the field a little way toward the light.
  // A whole extra mapBody, so it is skipped outright at zero translucency
  // rather than multiplied away afterwards.
  var scatter = vec3<f32>(0.0, 0.0, 0.0);
  if (surfCfg.w > 0.0) {
    let thin = clamp(mapBody(p + L * 0.06, data, counts, marchCfg.z, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip).x * -8.0, 0.0, 1.0);
    scatter = deepColor * thin * surfCfg.w * (1.0 - cm);
  }

  // Cheap AO from the field, so creases and the insides of joints stay dark.
  // Without it a limb dissolves into the torso visually even when the geometry
  // is correctly separated — so this is a LOD lever, not a free win: it is the
  // one guarded by an explicit flag rather than by its own amplitude, because
  // there is no "AO strength" to turn down.
  var ao = 1.0;
  if (lodCfg.x > 0.5) {
    ao = clamp(mapBody(p + n * 0.06, data, counts, marchCfg.z, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip).x / 0.06, 0.35, 1.0);
  }
  // CAVITY OCCLUSION (the dome craters, cyclops 2026-08-23). The 6 cm probe
  // above cannot see a 13 cm crater: from its wall, 6 cm along the normal is
  // still air, so ao reads 1 and the whole dish is lit like open skin. With
  // no occlusion cue a glossy concave dish flips to a convex ball the moment
  // the far wall catches the key — the owner saw a crater from the front and
  // a red sphere from the side, same wound, and a CPU height map proved the
  // geometry was sunk 170 mm the whole time. wm is 0 at the rim and 1 at the
  // floor, so it is the cavity depth for free: darken the floor, keep the lip.
  ao = ao * (1.0 - 0.55 * smoothstep(0.35, 1.0, wm));

  var fleshLit = albedo * (lightCfg.y + diff * lightCfg.x) * keyColor * ao
               + keyColor * (shine * mix(surfCfg.x, 1.5, gloss) + fres * mix(1.0, 2.5, gloss)) * wet
               + scatter;
  // FLAT-LIT decal: where the baked face covers the surface, relight it with
  // a fixed favourable diffuse and no AO/spec/fresnel — the image carries its
  // own shading, and real shading on top drew hard shadow lines from the
  // fringe and killed the mouth on the down-sloping jaw. 0.85 keeps a whisper
  // of real light so the head still turns.
  fleshLit = mix(fleshLit,
                 albedo * (lightCfg.y + 0.52 * lightCfg.x) * keyColor,
                 faceFlat * 0.85);

  // The eye REPLACES the flesh rather than adding to it.
  //
  // This used to be a pure addition, and it could not produce a red eye. Lit
  // flesh is already bright — roughly (1.16, 0.60, 0.62) with the key on it —
  // so adding a red emissive on top gives something like (4.2, 0.62, 0.63).
  // The output sRGB encode then clamps red at 1.0 while lifting the low
  // channels hard (0.62 encodes to 0.81), and the eye lands at RGB(255, 206,
  // 208): a pale cream, with the red only visible where it spilled onto the
  // darker skin around the socket. Exactly the reported symptom.
  //
  // Fading the flesh out under the glow also matches what the GLSL header
  // always claimed — "an eye should not be lit by the key light at all" — a
  // statement the code never actually implemented.
  let glow = faceGlowColor * faceGlow * faceCfg2.w
           * flicker(faceCfg3.y, faceCfg3.x) * (1.0 - cm);
  var lit = fleshLit * (1.0 - faceGlow) + glow;

  // Legacy display look (lodCfg.y). Every flesh preset was hand-tuned in the
  // WebGL lab, which displayed the lit LINEAR value raw — no output sRGB
  // encode. This path encodes correctly, which lifts the low channels and
  // washes those presets out. Applying the sRGB EOTF (decode) here cancels
  // three's output encode exactly, so the marched flesh displays the same
  // linear values the presets were tuned against. Kill switch for the X1.3
  // retune: turn this off, retune presets through the honest chain, delete.
  if (lodCfg.y > 0.5) {
    let c = max(lit, vec3<f32>(0.0));
    let lo = c / 12.92;
    let hi = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    lit = select(hi, lo, c <= vec3<f32>(0.04045));
  }

  return vec4<f32>(lit, t);
}`;

/**
 * Helper sources in DEPENDENCY ORDER — each one may only call those before it,
 * because WGSL requires declaration before use and three emits includes in the
 * order given.
 */
export const HELPERS = [
  // ORDER IS LOAD-BEARING: WGSL requires declaration before use, and wgslFn
  // concatenates this list as-is. CONE_CAP must precede both sdPrim and
  // sdPrimO, which now call it; SMIN_CHAMFER must precede mapBody. Adding a
  // helper and forgetting this list entirely is the quieter failure — the
  // ordering test below only checks what is IN the list, so an omitted helper
  // passes every unit test and fails at pipeline creation with a bare WGSL
  // parse error pointing at the call site.
  SMIN, SMIN_CHAMFER, SMAX, SD_GROOVE, CONE_CAP, SD_BEZIER_T, CONE_BEND, SD_PRIM, SD_PRIM_ORIENTED,
  HASH13, NOISE3, FBM, NOISE_LOCAL,
  Q_ROT, Q_MUL, Q_FROM_TO, REST_POINT,
  APPLY_CARVES, APPLY_WOUNDS, WOUND_MASK, CHAR_MASK, SAMPLE_VOLUME,
  MAP_BODY, CALC_NORMAL, TEXEL, FLICKER,
];

