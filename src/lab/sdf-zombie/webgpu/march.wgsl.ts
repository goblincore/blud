import { AMBIENT_AT, WALL_CONTRIBUTION } from './ambient.wgsl';
import { PROBE_GRID_WGSL } from './probe-grid.wgsl';
import { FLASHLIGHT_BOUNCE_WGSL } from './flashlight-bounce.wgsl';
import { PROBE_DYNAMIC_WGSL } from './probe-dynamic.wgsl';
import { SEG_VOLUME_WGSL } from './skeleton-spike/volume.wgsl';
import { TILE_MAX_ENTRIES } from './tile-cull';
import { MAX_PRIMS, MAX_CLUSTERS, BONE_SEG_MAX } from '../validate';

/** Extra metres added to the per-ray tile sphere test (tileCfg.x == 2) so the
 *  off-ray shading probes — calcNormal's 0.0015 eps and the AO probe at
 *  n * 0.06 — still see every group the ray's own march did. */
export const RAY_CULL_SLACK = '0.07';
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
//                       2 round+BENT, 3 chamfer+BENT, +4 SHELL, +8 BOX),
//                       zw = groove depth and width
//   row 11 primBend     xyz = quadratic Bezier control point (world space),
//                       w = a BOX's corner-rounding fraction (see pack.ts;
//                       the two never coexist — bend= on a box is rejected)
//   row 12 primColor    xyz = linear albedo, w = 1 + gloss (w=0: flesh)
//   row 13 groupBnds    xyz = group sphere centre, w = radius
//   row 14 groupRange   x = start, y = count, z = distort, w = flag bitfield
//   row 15 clusterGps   x = first group, y = group count
//   row 16 primShell    x = half-thickness, y = rim, z = clip offset,
//                       w = hasClip (shell-fold prims only)
//   row 17 primClip     xyz = clip plane normal (shell-fold prims only),
//                       w = per-prim glow 0..1 (hard-surface task 3)
//   row 20 primWarp     x = wrinkle amplitude (m), yzw = per-axis wrinkle
//                       frequency (rad/m) (shell-fold prims only)
//   row 21 primStrand   x = strand count, y = wave, z = cycles, w = fat
//                       (hairlock 2026-09-05; zeros = no bundle — the exact
//                       no-op every pre-strand character packs)
//
// DIVERGENCE NOTE (2026-08-17, motion-polish task 3): row 7 / per-prim
// orientation exists ONLY here. The GLSL twin (march.glsl.ts) is FROZEN per
// owner decision and keeps world-axis ellipsoid squash — its lab renders a
// posed head with the old detached-visor artefact. Do not port this back.
// Rows 8-9 (task 6, rest-space noise) diverge the same way, same reason.
//
// Wounds ride the SAME texture rather than a uniform array, which the GLSL
// path had to use. MAX_WOUNDS (16) is comfortably under MAX_PRIMS (128), so
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

export const DATA_ROWS = 22;
export const ROW_PRIM_A = 0;
export const ROW_PRIM_B = 1;
export const ROW_PRIM_SCALE = 2;
export const ROW_CLUSTER_BOUNDS = 3;
export const ROW_CLUSTER_RANGE = 4;
export const ROW_WOUND = 5;
export const ROW_WOUND_META = 6;
/** Wound carve depth-slab (2026-08-27): xyz = INWARD unit normal at the
 *  stamp (prim-local frame rotated out by the uploader), w = max carve depth
 *  below the anchor plane, metres. w <= 0 = uncapped — APPLY_WOUNDS then
 *  carves the plain sphere, bit-identical to the pre-slab field (the max()
 *  with `-1e5` selects the sphere term exactly), which is what keeps the
 *  LAB (which uploads no caps) pixel-stable across this change. */
export const ROW_WOUND_CAP = 18;
/** Per-wound flags (entrails, 2026-09-02): x = 1 when this wound opened a
 *  CAVITY, 0 otherwise; y = owning cluster + 1 (0 = unscoped),
 *  zw = owning flesh primitive span [start, end).
 *
 *  A new row rather than a bit on wMeta because wMeta is full — x type,
 *  y age, z splayScale, w offsetScale — and rather than a new code on
 *  `type`, because the shader tests types with unbounded comparisons
 *  (`isBurn = wMeta.x > 1.5`) that a fourth code would silently break. One
 *  row costs MAX_PRIMS * 16 bytes = 2 KiB per body. */
export const ROW_WOUND_FLAGS = 19;

/** CPU mirror for the damaged Soldier decal's luminance-only shadow mask. */
export function soldierFaceDamageShadow(luma:number,mean:number,woundMask:number,soldier:number):number {
  const clamp=(v:number)=>Math.max(0,Math.min(1,v));
  const t=clamp((woundMask-.02)/.60),w=t*t*(3-2*t);
  return clamp(1-luma/Math.max(mean,1e-3))*w*clamp(soldier);
}
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
/** `shell` construction (2048-08-25): x = half-thickness, y = rim radius,
 *  z = clip offset, w = hasClip (0/1). Read only by prims with a shell fold
 *  (profile bit 2 set — see ROW_PRIM_SHAPE's `prof`). */
export const ROW_PRIM_SHELL = 16;
/** `shell` clip plane: xyz = unit normal; w = per-prim emissive `glow=`
 *  0..1 (hard-surface task 3), packed on BOTH the shell and plain branches —
 *  the glow COLOUR is the prim's own ROW_PRIM_COLOR albedo, so the lane is
 *  inert (w = 0) unless the author writes `glow=`. See ROW_PRIM_SHELL. */
export const ROW_PRIM_CLIP = 17;
/** WRINKLES (shell cloth spike): x = warp amplitude in metres,
 *  yzw = per-axis frequency in radians per metre. Read only by prims with a
 *  shell fold, and only when the amplitude and the frequency are both
 *  non-zero — a shell authored without
 *  `warp=` packs zeros here and takes the untouched branch in sdShell, which
 *  is why every existing character is bit-identical across this row's
 *  arrival.
 *
 *  Its OWN row rather than a lane on ROW_PRIM_SHELL: that row is full
 *  (x thickness, y rim, z clip offset, w hasClip) and w is genuinely read —
 *  `hasClip < 0.5` is an early return in sdShell — even though pack.ts
 *  happens to write 1 there for every shell today. Aliasing a lane that is
 *  constant by accident rather than by contract is how the box/shell profile
 *  bit went wrong. One row costs MAX_PRIMS * 16 bytes = 2 KiB per body, the
 *  same bargain ROW_WOUND_FLAGS took. */
export const ROW_PRIM_WARP = 20;
/** Strand bundle parameters (hairlock, 2026-09-05): x = strand count,
 *  y = wave (wobble amplitude, fraction of cell), z = cycles, w = fat
 *  (strand diameter as a fraction of the cell). Read only where the prim's
 *  profile carries bit 5 (value 32). The CPU mirror of everything this row
 *  drives is strand.ts; see its header for the construction and the
 *  Lipschitz argument.
 *
 *  21, NOT 20: hairlock and the shell cloth spike each added "the next row"
 *  on their own branch and both landed on 20. A textual merge would have
 *  reported success with two names for one row — every warped shell reading
 *  the strand bundle's parameters as its wrinkle frequency. Same class as
 *  the meltCfg collision the noiseCfg comment records. */
export const ROW_PRIM_STRAND = 21;


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

// STRAND BUNDLE (hairlock, 2026-09-05) — the GPU mirror of sdStrand in
// strand.ts, whose header carries the full construction and the Lipschitz
// argument. Edit both in the same commit: the CPU field backs
// click-to-shoot and the render-check mask, so a drift here is a shot that
// lands where no strand is drawn.
//
// One curve evaluation (the exact closest point t*), then a 3x3 jittered
// grid fold of WINDOWED TANGENT CAPSULES in the cross-section plane — iq's
// limited repetition with a per-strand wobble phase. The hashes use SMALL
// COEFFICIENTS ONLY, so f32 (here) and f64 (validate.ts) agree to ~1e-6 and
// the two fields wobble the same strands the same way.
export const STRAND_HASH4 = /* wgsl */ `fn strandHash4(ix: f32, iy: f32) -> vec4<f32> {
  return fract(vec4<f32>(
    0.371 * ix + 0.733 * iy,
    0.531 * ix + 0.297 * iy + 0.41,
    0.617 * ix + 0.173 * iy + 0.73,
    0.229 * ix + 0.859 * iy + 0.19));
}`;

// The conservative Lipschitz bound the strand field is divided by — the GPU
// mirror of strandLipschitz in strand.ts. bent is 1.0 when the prim carries
// a curve (profile bit 1), in which case `c` is the packed control point;
// a straight strand passes c = vec3(0) and must not read it.
export const STRAND_LIPSCHITZ = /* wgsl */ `fn strandLip(a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, r1: f32, r2: f32, bent: f32, st: vec4<f32>) -> f32 {
  let n = st.x;
  let wave = st.y;
  let cycles = st.z;
  let fat = st.w;
  let rb = select(r2, r1, r2 < 0.0);
  var e1 = b - a;
  var bb = vec3<f32>(0.0);
  if (bent > 0.5) {
    e1 = (c - a) * 2.0;
    bb = a - 2.0 * c + b;
    if (dot(bb, bb) < 1e-12) { e1 = b - a; bb = vec3<f32>(0.0); }
  }
  let bbLen = length(bb);
  var spdMin = length(e1);
  if (bbLen >= 1e-9) {
    let dd = 2.0 * bb;
    let tMin = clamp(-dot(e1, dd) / dot(dd, dd), 0.0, 1.0);
    spdMin = length(e1 + dd * tMin);
  }
  // A degenerate (zero-length) strand has no curve to wave along.
  if (spdMin < 1e-9) { return 1.0; }
  let m = ceil(n * 0.5);
  let rMax = max(r1, rb);
  let cellMax = 2.0 * rMax / n;
  let cellRate = 2.0 * abs(rb - r1) / n;
  // STRAND_JITTER: keep in step with strand.ts (0.4 of the wobble).
  let centreMax = m * cellMax + wave * 1.4 * cellMax;
  let rhoMax = centreMax + fat * cellMax * 0.5;
  let kappa = 2.0 * bbLen / (spdMin * spdMin);
  let rate = 1.0 / (spdMin * max(1.0 - rhoMax * kappa, 0.25));
  let dCentre = m * cellRate + wave * 1.4 * cellRate + wave * 6.2831853 * cycles * cellMax;
  let spin = 2.0 * bbLen / spdMin;
  let dSdir = spin + wave * 6.2831853 * cycles * (cellRate + 6.2831853 * cycles * cellMax) / spdMin;
  let win = 2.0 * cellMax;
  let dRad = fat * cellRate * 0.5;
  return 1.0 + rate * (dCentre + spin * centreMax + win * dSdir + dRad);
}`;

// The bundle field itself. Same contract as coneBend: scale-divided sample
// and endpoints, raw radii, minScale applied at the end — PLUS the Lipschitz
// division, which is what makes the folded, wobbling field safe to sphere
// trace (at a step cost). The bound is NEARLY exact rather than exact — the
// strand-grid seams are isolated sub-millimetre jumps — and strand.ts's
// header carries the measurements. The gate is strand-wiring.test.ts, not
// the render check: losing the bundle draws the parent capsule, which is
// MORE material, and render-check only reports holes.
export const CONE_STRAND = /* wgsl */ `fn coneStrand(q: vec3<f32>, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, r1: f32, r2: f32, minScale: f32, bent: f32, st: vec4<f32>, windPhase: f32) -> f32 {
  let n = st.x;
  let wave = st.y;
  let cycles = st.z;
  let fat = st.w;
  let rb = select(r2, r1, r2 < 0.0);
  var e1 = b - a;
  var bb = vec3<f32>(0.0);
  if (bent > 0.5) {
    e1 = (c - a) * 2.0;
    bb = a - 2.0 * c + b;
    if (dot(bb, bb) < 1e-12) { e1 = b - a; bb = vec3<f32>(0.0); }
  }
  // t*: the EXACT closest point on the base curve. Straight: the clamped
  // projection. Bent: the cubic roots are every interior distance extremum,
  // so roots + ends suffice — no quarters, no refinement (those exist in
  // coneBend for the radius term, which the strand fold applies AFTER t*).
  let abLen2 = dot(b - a, b - a);
  var tStar = 0.0;
  if (abLen2 >= 1e-12) {
    if (dot(bb, bb) < 1e-12) {
      tStar = clamp(dot(q - a, b - a) / abLen2, 0.0, 1.0);
    } else {
      let cand = sdBezierT(q, a, c, b);
      var bestD = 1e9;
      var ts = array<f32, 5>(cand.x, cand.y, cand.z, 0.0, 1.0);
      for (var i = 0; i < 5; i = i + 1) {
        if (f32(i) >= cand.w && i < 3) { continue; }
        let t = ts[i];
        let p0 = a + e1 * t + bb * (t * t);
        let dd = dot(q - p0, q - p0);
        if (dd < bestD) { bestD = dd; tStar = t; }
      }
    }
  }
  let pt = a + e1 * tStar + bb * (tStar * tStar);
  let dC = e1 + 2.0 * bb * tStar;
  let spd = max(length(dC), 1e-9);
  let tan = dC / spd;
  // Cross-section basis off the axis LEAST aligned with the tangent.
  let seedAxis = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(tan.y) < 0.9);
  let u = normalize(cross(tan, seedAxis));
  let v = cross(tan, u);
  let rT = r1 + (rb - r1) * tStar;
  let cell = max(2.0 * rT / n, 1e-6);
  let rS = fat * cell * 0.5;
  let m = ceil(n * 0.5);
  let win = 2.0 * cell;
  let rel = q - pt;
  let pl = vec2<f32>(dot(rel, u), dot(rel, v));
  let id0 = round(pl / cell);
  var best = 1e9;
  for (var di = -1; di <= 1; di = di + 1) {
    for (var dj = -1; dj <= 1; dj = dj + 1) {
      let idc = clamp(id0 + vec2<f32>(f32(di), f32(dj)), vec2<f32>(-m), vec2<f32>(m));
      let h = strandHash4(idc.x, idc.y);
      // windPhase rides INSIDE the cycle count: a whole-turn offset that
      // slides the sample along the wave without changing the wave. Mirrors
      // sdStrand in strand.ts; d(phase)/dt is still TAU*cycles, which is
      // what strandLip is built from, so the bound is untouched.
      let phx = 6.2831853 * (cycles * tStar + h.x + windPhase);
      let phy = 6.2831853 * (cycles * tStar + h.y + 0.25 + windPhase);
      let wob = wave * cell;
      let ctr = idc * cell + wob * vec2<f32>(sin(phx), sin(phy)) + 0.4 * wob * (2.0 * h.zw - vec2<f32>(1.0));
      // The strand's local direction: the curve's plus the wobble's slope,
      // so the windowed capsule lies ALONG the wavy strand rather than
      // beading at every sample station.
      let dw = wob * 6.2831853 * cycles * vec2<f32>(cos(phx), cos(phy));
      let sd3 = normalize(dC + dw.x * u + dw.y * v);
      let m3 = pt + ctr.x * u + ctr.y * v;
      let w3 = q - m3;
      let dl = dot(w3, sd3);
      // The window kills the ghost ridge a curve-length tangent line would
      // leave, and never runs past the curve's own ends: a pointed lock
      // ENDS at t = 1.
      let dlc = clamp(dl, max(-win, -tStar * spd), min(win, (1.0 - tStar) * spd));
      let dI = length(w3 - dlc * sd3) - rS;
      best = min(best, dI);
    }
  }
  return best * minScale / strandLip(a, b, c, r1, r2, bent, st);
}`;

// half-extent BEFORE rounding; the caller insets it by `r` so total half-extent
// is unchanged. Edit both in the same commit or click-to-shoot drifts from
// what is drawn.
export const SD_ROUND_BOX = /* wgsl */ `fn sdRoundBox(p: vec3<f32>, e: vec3<f32>, r: f32) -> f32 {
  let q = abs(p) - e;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}`;

export const SD_PRIM = /* wgsl */ `fn sdPrim(p: vec3<f32>, i: i32, data: texture_2d<f32>, r2: f32, prof: f32, cpos: vec3<f32>, band: i32) -> f32 {
  let A = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_A} + band), 0);
  let B = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_B} + band), 0);
  let S = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SCALE} + band), 0);
  let inv = 1.0 / S.xyz;
  let minScale = min(S.x, min(S.y, S.z));
  // STRAND before every other branch, mirroring sdPrimitive in validate.ts:
  // a strand prim is its own field construction, and box/shell are rejected
  // on it at compile time, so it cannot belong to any branch below. The
  // strand row is fetched HERE rather than by the caller — the same
  // on-demand discipline the box branch uses for ROW_PRIM_BEND — so a prim
  // without strands never pays for the fetch.
  //
  // The bent flag selects whether coneStrand reads the control point: a
  // straight strand is passed c = vec3(0) and must not use it. (No backticks
  // in this comment -- it lives inside a TEMPLATE LITERAL, and one would end
  // the WGSL string mid-function.)
  if ((i32(prof) & 32) != 0) {
    let ST = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_STRAND} + band), 0);
    let bent = select(0.0, 1.0, (i32(prof) & 2) != 0);
    // HAIR RIPPLES IN THE SAME WIND THE CLOTH SWAYS IN: cycles of wobble
    // phase per metre of accumulated drift (STRAND_WIND_RIPPLE in
    // strand.ts). Length, not a projection — a bundle has no single
    // facing, and hair ripples whichever way the air is moving.
    let windPhase = length(gWindDrift) * 6.0;
    return coneStrand(p * inv, A.xyz * inv, B.xyz * inv, cpos * inv, A.w, r2, minScale, bent, ST, windPhase);
  }
  // BOX before BENT: bend= is rejected on a box at compile time, so the two
  // never coexist; testing box first means the bend row is never fetched for
  // one, which is what makes sharing primBend.w safe. The bend row is
  // otherwise only fetched by the caller when prof & 2 (see applyCarves and
  // foldGroup), so a box branch here must load ROW_PRIM_BEND itself.
  if ((i32(prof) & 8) != 0) {
    let qq = p * inv;
    let a = A.xyz * inv;
    let b = B.xyz * inv;
    let ab = b - a;
    let ap = qq - a;
    let ab2 = dot(ab, ab);
    let t = select(clamp(dot(ap, ab) / ab2, 0.0, 1.0), 0.0, ab2 == 0.0);
    let closest = a + ab * t;
    let round = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_BEND} + band), 0).w;
    let e = A.w * (1.0 - round);
    return sdRoundBox(qq - closest, vec3<f32>(e), A.w * round) * minScale;
  }
  // Bent above tapered above plain: prof's bit 1 (value 2) means the Bezier
  // path (0 round, 1 chamfer, 2 round+bent, 3 chamfer+bent; 4/6 add shell on
  // top, whose bend flag is the same bit), so the bit test keeps every
  // straight prim — including a straight SHELL (prof 4) — on the exact
  // expression it has always run, while a bent prim takes the curve. Bit 1
  // is the mask (i32(prof) & 2) != 0, equivalent to prof > 1.5 on the 0-3
  // range, and correct for shells on 4/6.
  if ((i32(prof) & 2) != 0) {
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
export const SD_PRIM_ORIENTED = /* wgsl */ `fn sdPrimO(p: vec3<f32>, i: i32, data: texture_2d<f32>, r2: f32, prof: f32, cpos: vec3<f32>, band: i32) -> f32 {
  let A = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_A} + band), 0);
  let B = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_B} + band), 0);
  let S = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_SCALE} + band), 0);
  var qq = p;
  var a = A.xyz;
  var b = B.xyz;
  // The control point rides the same conjugate as the endpoints — the curve
  // is defined in the prim's frame exactly as they are.
  var c = cpos;
  let O = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_QUAT} + band), 0);
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
  // STRAND before every other branch, mirroring sdPrimitive in validate.ts:
  // a strand prim is its own field construction, and box/shell are rejected
  // on it at compile time, so it cannot belong to any branch below. The
  // strand row is fetched HERE rather than by the caller — the same
  // on-demand discipline the box branch uses for ROW_PRIM_BEND — so a prim
  // without strands never pays for the fetch.
  //
  // The bent flag selects whether coneStrand reads the control point: a
  // straight strand is passed c = vec3(0) and must not use it. (No backticks
  // in this comment -- it lives inside a TEMPLATE LITERAL, and one would end
  // the WGSL string mid-function.)
  if ((i32(prof) & 32) != 0) {
    let ST = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_STRAND} + band), 0);
    let bent = select(0.0, 1.0, (i32(prof) & 2) != 0);
    // HAIR RIPPLES IN THE SAME WIND THE CLOTH SWAYS IN: cycles of wobble
    // phase per metre of accumulated drift (STRAND_WIND_RIPPLE in
    // strand.ts). Length, not a projection — a bundle has no single
    // facing, and hair ripples whichever way the air is moving.
    let windPhase = length(gWindDrift) * 6.0;
    return coneStrand(qq, a, b, c * inv, A.w, r2, minScale, bent, ST, windPhase);
  }
  // BOX before BENT — same reasoning as sdPrim: bend= and box never coexist,
  // so testing box first means the bend row is fetched only here, on demand.
  if ((i32(prof) & 8) != 0) {
    let ab = b - a;
    let ap = qq - a;
    let ab2 = dot(ab, ab);
    let t = select(clamp(dot(ap, ab) / ab2, 0.0, 1.0), 0.0, ab2 == 0.0);
    let closest = a + ab * t;
    let round = textureLoad(data, vec2<i32>(i, ${ROW_PRIM_BEND} + band), 0).w;
    let e = A.w * (1.0 - round);
    return sdRoundBox(qq - closest, vec3<f32>(e), A.w * round) * minScale;
  }
  if ((i32(prof) & 2) != 0) { return coneBend(qq, a, b, c * inv, A.w, r2, minScale); }
  return coneCap(qq, a, b, A.w, r2, minScale);
}`;

// Thin clipped sheet with a rounded rim — mirrors sdShellWrap in validate.ts.
// `dBase` is the closed primitive's capsule field (coneCap/coneBend result);
// the sheet is `abs(dBase) - thickness` (half-thickness), clipped against the
// half-space `dot(p, clipN) < clipO` with a rounded edge of radius `rim`.
// A hard `max(sheet, plane)` is the razor edge; `length(vec2(sheet, plane))
// - rim` is the distance to the sheet/plane intersection CURVE, so
// `max(max(sheet, plane), rim - length(...))` rounds that edge — a cloth hem
// instead of a cut. `rim` 0 degenerates to the hard clip.
// WRINKLES (shell cloth spike). Three sines with offset phases displace the
// BASE distance before the sheet is taken, so the whole sheet undulates like
// hanging cloth rather than its two faces getting independently roughened.
//
// The frequency is PER AXIS: zeroing one freezes that sine to a constant, so
// the folds run along it. That is how a pleat is made — a skirt varies around
// the body and not down it — and a scalar frequency can only ever produce an
// egg-carton.
//
// This costs the exactness of the field. Each partial derivative of the warp
// term is at most |A|*|F_axis|, so the gradient magnitude grows to at most
// 1 + |A|*length(F) and the result is divided by exactly that: the field
// stays a conservative distance BOUND, which is all a sphere tracer needs,
// and no plain-step flag is required. Mirrors sdShellWrap in validate.ts —
// the two must agree or the CPU checks pass a body the GPU tears.
//
// The wrinkles are anchored to the BODY, not the world — see the noiseLocal
// call below and gBodyAnchor's declaration.
//
// WIND. `drift` is a world-space offset in metres the fold lattice has
// travelled — the host accumulates wind velocity times time, so the shader
// needs no clock and every path (march, cone pre-pass, normals, AO) reads the
// same uniform and therefore the same surface. Subtracting it inside the
// sines moves the WRINKLES through the world while the sheet and its clip
// plane stay put, which is what a breeze looks like on hanging cloth.
//
// It is free of the pinch cap: d/dx of sin(F*(x - c)) is F*cos(...), so a
// constant offset cannot change the spatial gradient and `lip` is untouched.
//
// With warpA or warpF zero the branch is skipped, `lip` is exactly 1.0, and
// division by 1.0 is exact in IEEE — an unwarped shell is bit-identical to
// before this existed, which shell-warp.test.ts pins.
export const SD_SHELL = /* wgsl */ `fn sdShell(dBase: f32, p: vec3<f32>, thick: f32, rim: f32, clipO: f32, hasClip: f32, clipN: vec3<f32>, warpA: f32, warpF: vec3<f32>, drift: vec3<f32>) -> f32 {
  var base = dBase;
  var lip = 1.0;
  let fLen = length(warpF);
  if (warpA != 0.0 && fLen != 0.0) {
    // BODY-ANCHORED, via the same noiseLocal the body's surface noise uses:
    // at the raw world point the fold lattice is fixed in the world and she
    // turns underneath it, so the folds swim across the cloth as she walks.
    //
    // The drift is subtracted BEFORE the transform. noiseLocal is affine, so
    // local(p - drift) = local(p) - R(-yaw)*drift: the wind gets rotated into
    // her frame for free and a breeze keeps blowing in WORLD directions.
    // Subtracting after would nail the wind to her hips.
    let q = noiseLocal(p - drift, gBodyAnchor);
    base = base + warpA * sin(warpF.x * q.x) * sin(warpF.y * q.y + 1.3) * sin(warpF.z * q.z + 2.6);
    lip = 1.0 + abs(warpA) * fLen;
  }
  let d = abs(base) - thick;
  if (hasClip < 0.5) { return d / lip; }
  let dPlane = dot(p, clipN) - clipO;
  return max(max(d, dPlane), rim - length(vec2(d, dPlane))) / lip;
}`;

/**
 * Run 4 DETAIL PASS (plan 2026-09-12-neural-upscale-run4-relief §2): the march's skin-detail noise —
 * vec3(fbm(a*22), fbm(a*22+5), fbm(a*22+11)), the world-space normal perturbation applied under
 * detailAmp — evaluated at OUTPUT resolution from the marchAnchor attachment. Each output pixel takes
 * its march texel's rest-space anchor and extrapolates sub-texel with SCREEN-SPACE anchor gradients
 * from same-body neighbours (a linear map holds across one texel; a jump larger than jumpMax metres
 * is another body or a fold and contributes no gradient). w = the texel's detail gate.
 */
export const DETAIL_FIELD = /* wgsl */ `fn detailField(
  anchorTex: texture_2d<f32>,
  marchTex: texture_2d<f32>,
  texCoord: vec2<f32>,
  flipY: f32,
  jumpMax: f32
) -> vec4<f32> {
  let dims = vec2<i32>(textureDimensions(anchorTex, 0));
  let maxI = dims - vec2<i32>(1, 1);
  var st = texCoord;
  if (flipY > 0.5) { st.y = 1.0 - st.y; }
  let q = st * vec2<f32>(dims);
  let c = clamp(vec2<i32>(floor(q)), vec2<i32>(0, 0), maxI);
  let f = q - (vec2<f32>(c) + vec2<f32>(0.5, 0.5));
  // Gate on the march HIT (depth alpha < 1) as well as the detail gate: the anchor attachment's
  // cleared background carries the clear colour's alpha, which is not a gate.
  let a0 = textureLoad(anchorTex, c, 0);
  if (a0.w <= 0.0 || textureLoad(marchTex, c, 0).w >= 1.0) { return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  let axp = textureLoad(anchorTex, clamp(c + vec2<i32>(1, 0), vec2<i32>(0, 0), maxI), 0);
  let axm = textureLoad(anchorTex, clamp(c - vec2<i32>(1, 0), vec2<i32>(0, 0), maxI), 0);
  let ayp = textureLoad(anchorTex, clamp(c + vec2<i32>(0, 1), vec2<i32>(0, 0), maxI), 0);
  let aym = textureLoad(anchorTex, clamp(c - vec2<i32>(0, 1), vec2<i32>(0, 0), maxI), 0);
  var dx = vec3<f32>(0.0);
  var dy = vec3<f32>(0.0);
  let dxp = axp.xyz - a0.xyz;
  let dxm = a0.xyz - axm.xyz;
  let okxp = axp.w > 0.0 && textureLoad(marchTex, clamp(c + vec2<i32>(1, 0), vec2<i32>(0, 0), maxI), 0).w < 1.0 && length(dxp) < jumpMax;
  let okxm = axm.w > 0.0 && textureLoad(marchTex, clamp(c - vec2<i32>(1, 0), vec2<i32>(0, 0), maxI), 0).w < 1.0 && length(dxm) < jumpMax;
  if (okxp && okxm) { dx = 0.5 * (dxp + dxm); } else if (okxp) { dx = dxp; } else if (okxm) { dx = dxm; }
  let dyp = ayp.xyz - a0.xyz;
  let dym = a0.xyz - aym.xyz;
  let okyp = ayp.w > 0.0 && textureLoad(marchTex, clamp(c + vec2<i32>(0, 1), vec2<i32>(0, 0), maxI), 0).w < 1.0 && length(dyp) < jumpMax;
  let okym = aym.w > 0.0 && textureLoad(marchTex, clamp(c - vec2<i32>(0, 1), vec2<i32>(0, 0), maxI), 0).w < 1.0 && length(dym) < jumpMax;
  if (okyp && okym) { dy = 0.5 * (dyp + dym); } else if (okyp) { dy = dyp; } else if (okym) { dy = dym; }
  let a = a0.xyz + dx * f.x + dy * f.y;
  let d = vec3<f32>(fbm(a * 22.0), fbm(a * 22.0 + 5.0), fbm(a * 22.0 + 11.0));
  return vec4<f32>(d, a0.w);
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
      // BOUNDED on both sides: W_BONE (4) is greater than the groove code (3),
      // so an open-ended '> 2.5' would carve every bone prim into the flesh as
      // a groove. Bone is folded separately, after wounds — see applyBones.
      let isGroove = S.w > 2.5 && S.w < 3.5;
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
        // Only genuinely-bent prims pay for the bend row; bit 1 (value 2)
        // encodes bend so a straight SHELL (prof 4) skips it. Keeps every
        // "> 0.5 means chamfer" consumer working unchanged.
        if ((i32(prof) & 2) != 0) {
          cpos = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_BEND}), 0).xyz;
        }
      }
      let sd = select(sdPrim(p, idx, data, r2, prof, cpos, 0), sdPrimO(p, idx, data, r2, prof, cpos, 0), ori);
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
// smax fillet overstates distance, the lip understates it), so the relaxed
// march must step plain there or its overshoot test misfires and the crater
// floor comes out in depth bands (the dark streaks across the cyclops's
// craters, 2026-08-23: gone at relax 1.0, back at 1.4).
//
// SEQUENTIAL per-wound smax + bump, the 2026-08-22 form — deliberately
// (owner bisect parity, 2026-08-24). The 2026-08-23 smin-union-then-one-smax
// rework smoothed overlapping craters into one cavity, but the owner-judged
// reference build carves sequentially, and after every other 2026-08-23
// change was walked back this was the last geometric delta standing. If the
// overlap ridge returns as a complaint, re-derive the union against THIS
// baseline with the owner judging, one change at a time.
// WOUND-BOUND CULL (close-up wound-cull task, 2026-09-05): woundBound is the
// bounding sphere of every wound's REACH (xyz centre, w radius), computed on
// the CPU at upload time from the SAME uniforms the reach formula below reads
// (zombie-gpu.ts woundReachBound; w = 1e9 is the no-cull identity the chunk
// and hands views keep). A sample outside it is outside EVERY per-wound reach
// sphere, so every loop iteration would hit the early-out `continue` — the
// early return is bit-identical to running the loop: d unchanged, near 0.
export const APPLY_WOUNDS = /* wgsl */ `fn applyWounds(dIn: f32, p: vec3<f32>, data: texture_2d<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, perfCfg: vec4<f32>, woundBound: vec4<f32>) -> vec2<f32> {
  var d = dIn;
  var near = 0.0;
  // One sphere test before the loop replaces up to 16 wound-row loads plus a
  // length() each, on every mapBody evaluation, for every sample nowhere near
  // a crater. Tested BEFORE the loop (pinned by test): the whole point is
  // that a far sample pays nothing per-wound.
  if (length(p - woundBound.xyz) > woundBound.w) { return vec2<f32>(dIn, 0.0); }
  let n = i32(woundCfg.x);
  // PER-RAY WOUND LIST (counts2.w gate, 2026-09-07): with the gate ON the
  // loop iterates only the preloaded reachable set; with it OFF this is the
  // same iteration sequence as before (k == i, same break on n), so OFF is
  // bit-identical to the shipped shader.
  for (var k = 0; k < 16; k = k + 1) {
    var i = k;
    if (gWoundListOn > 0.5) {
      if (k >= gWoundN) { break; }
      i = gWoundList[k];
    } else {
      if (k >= n) { break; }
    }
    let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND}), 0);
    let r = length(p - w.xyz);
    // Reach of this wound's influence, beyond which the carve, the fillet
    // and the rim bump all contribute exactly nothing (see the test):
    //   crater .......... r < depth <= w.w, and nearWound at 2 depth
    //   smax fillet ..... quadratic smin is exactly min once |a-b| >= 4k;
    //                     a-b here is (r - depth) + d, and d >= -0.25 inside
    //                     any limb this game has
    //   rim bump ........ exp(-x^2) at x >= 3 is 1.2e-4 of amp — sub-micron
    // Skipping here saves the two texel loads below and every op after them
    // for every wound the sample is nowhere near — which, per march step,
    // is all of them but one. (perfCfg.y seam, game page ON; lab default 0
    // keeps its reference bit-identical.)
    let reach = w.w * max(2.0, 2.0 * woundCfg.w + 3.0 * woundCfg2.x) + 4.0 * woundCfg.y + 0.25;
    if (perfCfg.y > 0.5 && r > reach) { continue; }
    let owner = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_FLAGS}), 0).y;
    if (gWoundCluster > 0.0 && owner > 0.0 && owner != gWoundCluster) { continue; }
    if (owner > 0.0) { gWoundOwners = gWoundOwners | (1u << u32(owner)); }
    let wMeta = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_META}), 0);
    // Depth slab (2026-08-27): the sphere stays centred on the uploaded
    // anchor — the lab's deep bowl — and is clipped by a plane through the
    // anchor facing inward, at most wCap.w deep. The carve region is the
    // CONVEX INTERSECTION {inside sphere} ∩ {shallower than the cap}; its
    // inside-positive SDF is -max(sphereSDF, slabSDF) = min(depth - r,
    // capEff - dot). The sign of the dot term matters more than it looks:
    // a dot - capEff term is positive BEYOND the cap, so a max() with that
    // form kept the term positive across the entire half-space behind the
    // kept the term positive across the entire half-space behind the cap
    // plane — every wound silently deleted all flesh deeper than its cap,
    // out to infinity, and a body with wounds from mixed directions (the
    // shotgun) lost whole quadrants of itself while a single wound looked
    // perfect from the front. That regression is why whole zombies went
    // invisible on 2026-08-27. With min(depth - r, capEff - dot) the carve
    // is a bounded bowl: shallow+inside carves, beyond the cap flesh
    // remains, outside the sphere nothing changes. With wCap.w <= 0
    // (uncapped: the lab uploads no caps, old wounds, chunk torn-ends) the
    // 1e5 term loses the min for any real distance, so the carve is
    // BIT-IDENTICAL to the pre-slab sphere — that is what keeps the lab
    // reference stable.
    let wCap = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_CAP}), 0);
    let capEff = select(1.0e5, wCap.w, wCap.w > 0.0);
    // Bounded torso preview: a fixed sphere recipe, with its owner's depth
    // cap. Negative type is upload-only; stock gameplay types remain 0..2.
    if (wMeta.x < -0.5) {
      d = max(d, min(w.w - r, capEff - dot(p - w.xyz, wCap.xyz)));
      if (r < w.w * 2.0) { near = 1.0; }
      continue;
    }
    let isBurn = wMeta.x > 1.5;
    let depth = select(w.w, w.w * 0.35 * clamp(wMeta.y, 0.0, 1.0), isBurn);
    d = smax(d, min(-(r - depth), capEff - dot(p - w.xyz, wCap.xyz)), woundCfg.y);
    if (r < depth * 2.0) { near = 1.0; }
    let x = (r - depth * woundCfg.w * wMeta.w) / max(depth * woundCfg2.x, 1e-4);
    let amp = depth * woundCfg.z * wMeta.z * select(1.0, 0.25, isBurn);
    let rimLocal = 1.0 - smoothstep(-amp * 0.3, amp * 0.7, dIn);
    d = d - exp(-x * x) * amp * rimLocal;
  }
  return vec2<f32>(d, near);
}
// Per-map ownership selection. 0 keeps the original whole-body carve;
// a positive cluster id restricts the independent limb field below.
var<private> gWoundCluster: f32 = 0.0;
var<private> gWoundOwners: u32 = 0u;
// Set only for final surface shading; -1 retains unscoped chunk/volume masks.
var<private> gWoundShadePrim: f32 = -1.0;`

// 0 at the surface far from wounds, 1 deep inside one. ONE mask, shared by
// every wound shading term — the owner-decided shape of this function
// (bisect A/B, 2026-08-24). The 2026-08-23 crater pass split it three ways
// (colouring pulled in to 1.25x + a facing gate, the fresnel fade widened to
// its own 1.3x/2x mask, an AO darkening at a third radius) and THAT was the
// halo the owner chased for two days: each split mask has an edge somewhere
// on healthy skin, and wherever two edges disagree there is an annulus that
// is faded-but-not-coloured (grey ring) or coloured-but-not-faded (white
// crescent), sweeping with the camera because fresnel is view-dependent.
// The unified 1.6x mask has a footprint too — but its fade edge coincides
// with its colour gradient, so it reads as "flesh going wounded", a material
// change, not a ring. A membership-based fade (carve-field derived) was
// built and looked clean in stills, but the owner judged the restored
// unified mask decisively better in motion against every variant.
// The far-side white sheets the 2026-08-23 gates were chasing turned out to
// be the tracer overshoot bug (fixed at the retract guard above): with rays
// no longer landing inside the body, the ungated mask is safe again.
export const WOUND_MASK = /* wgsl */ `fn woundMask(p: vec3<f32>, nrm: vec3<f32>, data: texture_2d<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>) -> vec3<f32> {
  var m = 0.0;
  var cav = 0.0;
  let n = i32(woundCfg.x);
  for (var i = 0; i < 16; i = i + 1) {
    if (i >= n) { break; }
    let flags = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_FLAGS}), 0);
    if (flags.y > 0.0 && gWoundShadePrim >= 0.0 &&
        (gWoundShadePrim < flags.z || gWoundShadePrim >= flags.w)) { continue; }
    let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND}), 0);
    let contribution = 1.0 - smoothstep(0.0, w.w * 1.6, length(p - w.xyz));
    m = max(m, contribution);
    // Cavity-ness (entrails, 2026-09-02): the SAME radial footprint,
    // accumulated only over wounds whose flags row says the hit opened a
    // cavity. Deliberately NOT a second footprint — a second mask edge is
    // how the 2026-08-23 halo happened.
    if (flags.x > 0.5) { cav = max(cav, contribution); }
  }
  return vec3<f32>(m, m, cav);
}`

// Tissue colour by depth beneath the ORIGINAL skin — the signal `carved`
// carries in mapBody's .w.
//
// Keyed to the crater WALL rather than to the impact point, which is the
// difference that makes an oblique hit and a pair of overlapping craters read
// correctly: the radial mask rings the entry wound, this follows the surface
// that was actually opened.
//
// The fat band is the load-bearing stop. It is the cue that says "opened"
// rather than "stained", and a single base->deep lerp has no way to express it.
export const TISSUE_RAMP = /* wgsl */ `fn tissueRamp(depth: f32, baseColor: vec3<f32>, fatColor: vec3<f32>, deepColor: vec3<f32>, fatDepth: f32, muscleDepth: f32, cavity: f32, visceraColor: vec3<f32>, visceraDepth: f32) -> vec3<f32> {
  let dermis = mix(baseColor, deepColor, 0.5);
  let clot = deepColor * 0.45;
  let toFat = smoothstep(0.0, fatDepth, depth);
  let toMuscle = smoothstep(fatDepth, muscleDepth, depth);
  let toClot = smoothstep(muscleDepth, muscleDepth * 2.5, depth);
  var c = mix(dermis, fatColor, toFat);
  c = mix(c, deepColor, toMuscle);
  c = mix(c, clot, toClot);
  // Cavity. Gated on 'cavity' (this pixel is inside a wound that opened one),
  // NOT on depth alone — a deep limb wound is still a wall of meat.
  let toViscera = smoothstep(muscleDepth, visceraDepth, depth) * cavity;
  return mix(c, visceraColor, toViscera);
}`;

// 0 unburned, 1 fully charred.
export const CHAR_MASK = /* wgsl */ `fn charMask(p: vec3<f32>, data: texture_2d<f32>, woundCfg: vec4<f32>) -> f32 {
  var m = 0.0;
  let n = i32(woundCfg.x);
  for (var i = 0; i < 16; i = i + 1) {
    if (i >= n) { break; }
    let flags = textureLoad(data, vec2<i32>(i, ${ROW_WOUND_FLAGS}), 0);
    if (flags.y > 0.0 && gWoundShadePrim >= 0.0 &&
        (gWoundShadePrim < flags.z || gWoundShadePrim >= flags.w)) { continue; }
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
// THE SHARED GROUP FOLD (perf task 5 step 2). The per-group work — sphere
// cull with the distortion factor, then the prim loop — exists ONCE here and
// BOTH fold paths call it: the cluster walk (below) and the tile-list path.
// Extracting it is what keeps them from drifting: a cull fix or an smin
// change lands in one place.
//
// bounds = group bound sphere (xyz centre, w radius); grp = the
// ROW_GROUP_RANGE texel (x start, y count, z DISTORTION factor, w flag
// bitfield). band selects the body's row block in a SHARED multi-body data
// texture (merged pass, task 5 step 4): row = ROW + band. Single-body views
// bind a one-band texture and pass 0 — every emitted load is then identical
// to the pre-band shader.
//
// The argmin tracker rides private globals (gFoldBest/gFoldBestIdx) rather
// than pointer params: three's wgslFn parser has no contract for ptr<function>,
// and mapBody re-initialises both before any fold, so there is no cross-call
// state. gDebugPrims counting moved in here too, so both paths (and only real
// folds) feed the prims heatmap.
export const FOLD_GROUP = /* wgsl */ `fn foldGroup(dIn: f32, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, band: i32, bounds: vec4<f32>, grp: vec4<f32>) -> f32 {
  var d = dIn;
  // Per-step group-sphere cull, WITH the distortion factor — unchanged from
  // the cluster walk (see pack.ts: sd under-reports Euclid by up to this
  // factor; a factor-free test tore black cracks inside wound cavities).
  // Tiles cut the LIST; spheres still cut PER-STEP work.
  if (length(p - bounds.xyz) - bounds.w > (d + counts.w * 4.0) * grp.z) { return d; }
  let start = i32(grp.x);
  let count = i32(grp.y);
  let flags = i32(grp.w + 0.5);
  let ori = (flags & 1) != 0;
  let shaped = (flags & 2) != 0;
  for (var i = 0; i < 64; i = i + 1) {
    if (i >= count) { break; }
    let idx = start + i;
    if (idx >= i32(counts.x)) { break; }
    let S = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SCALE} + band), 0);
    // S.w: 0 add, 1 carve, 2 dead (severed mid-limb) — both skip the fold.
    if (S.w > 0.5) { continue; }
    if (gDebugMode > 0.5) { gDebugPrims = gDebugPrims + 1.0; }
    let k = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_B} + band), 0).w;
    var r2 = -1.0;
    var prof = 0.0;
    var cpos = vec3<f32>(0.0, 0.0, 0.0);
    if (shaped) {
      let T = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SHAPE} + band), 0);
      r2 = T.x;
      prof = T.y;
      // Only genuinely-bent prims pay for the bend row; bit 1 (value 2)
      // encodes bend so a straight SHELL (prof 4) skips it. Keeps every
      // "> 0.5 means chamfer" consumer working unchanged.
      if ((i32(prof) & 2) != 0) {
        cpos = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_BEND} + band), 0).xyz;
      }
    }
    var sd: f32;
    if (ori) { sd = sdPrimO(p, idx, data, r2, prof, cpos, band); }
    else { sd = sdPrim(p, idx, data, r2, prof, cpos, band); }
    // A SHELL (profile bit 2, value 4) thins the closed base field to a
    // sheet and clips it: abs(dBase) - thick, then a rounded-rim clip against
    // the shell plane. Only shell prims read the two extra rows, and only in
    // a shaped group, so additive prims pay nothing.
    //
    // MUST be a mask, not a "prof >= 4" magnitude test: that only ever meant
    // "shell" while bit 2 (shell) was the highest bit anyone set, so nothing
    // outscored it. A BOX sets bit 3 (value 8) with bit 2 clear, and
    // 8 >= 4 is true — a magnitude test would fold every box as a
    // zero-thickness shell (primShell/primClip are all-zero for a box),
    // instead of the plain body it actually is.
    if ((i32(prof) & 4) != 0) {
      let S2 = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_SHELL} + band), 0);
      let C2 = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_CLIP} + band), 0);
      let W2 = textureLoad(data, vec2<i32>(idx, ${ROW_PRIM_WARP} + band), 0);
      sd = sdShell(sd, p, S2.x, S2.y, S2.z, S2.w, C2.xyz, W2.x, W2.yzw, gWindDrift);
    }
    if (sd < gFoldBest) { gFoldBest = sd; gFoldBestIdx = f32(idx); gFoldBestDistort = grp.z; }
    // Chamfer is profile bit 0 (value 1); bend is bit 1 (value 2); shell is
    // bit 2 (value 4); box is bit 3 (value 8); METAL is bit 4 (value 16),
    // packed by pack.ts and read ONLY in the shading block (it is a
    // material, not a shape — the fold must treat a metal prim exactly like
    // the same prim without it, and every mask here does: 16 & 7 == 0 and
    // 16 & 8 == 0). "& 7 == 1" means "bit 0 set, bits 1 and 2 clear" —
    // exactly chamfer-and-nothing-else, which is what the OLD bounded-window
    // test (prof strictly between one half and one and a half) meant back
    // when prof topped out at 6.
    //
    // MUST be a mask, not that bounded window: a BOX sets bit 3 (value 8),
    // so prof is no longer bounded above by 6, and a chamfered box (prof 9)
    // falls outside that old window entirely — the author writes chamfer=,
    // the row packs it (see pack.ts), and the crease silently never
    // appears. "& 7" ignores bit 3 entirely, so box+chamfer (9 & 7 == 1)
    // chamfers exactly as a non-box chamfered prim does, and every existing
    // case (0,1,2,3,4,6) keeps its current answer — verified by
    // enumeration, see pack.test.ts / the task 5 report.
    if ((i32(prof) & 7) == 1) { d = sminChamfer(d, sd, k); } else { d = smin(d, sd, k); }
  }
  return d;
}
// Tile-list state + fold-argmin state, declared at the TAIL of this source
// because three's wgslFn parser is ^-anchored on "fn" — a var-decl source of
// their own would fail the parse contract. MARCH_BODY fills the tile arrays
// ONCE per pixel (before stepping); every later mapBody call in the same
// fragment — march steps, calcNormal, AO/scatter probes, wound shadow — reads
// them through the same gTileActive gate, so shading sees exactly the field
// the march walked. Fragment invocations start zeroed; the cone pre-pass runs
// in its own invocations where gTileActive stays 0 and the cluster walk
// applies.
var<private> gFoldBest: f32 = 1e9;
var<private> gFoldBestIdx: f32 = -1.0;
// The dominant prim's GROUP DISTORTION factor (grp.z), for MARCH_BODY's
// footprint-AA epsilon (perf round 2 task 6): sdPrimitive under-reports
// Euclid by up to this factor, so the epsilon divides by it. Rides a private
// global rather than mapBody's .w return slot — that slot is owned by the
// wound-pass-r2 chain — under the SAME per-invocation contract as the
// argmin: mapBody resets, foldGroup writes at the argmin, MARCH_BODY reads
// straight after its mapBody call. 1.0 default: groups without distortion
// and the volume branch (which never folds) are exact no-ops.
var<private> gFoldBestDistort: f32 = 1.0;
// WIND DRIFT, metres, world space. A private global rather than another
// parameter on foldGroup because foldGroup is reached from mapBody, which has
// TEN call sites — threading a uniform through all of them to serve one
// primitive kind is the churn ROW_PRIM_WARP's own doc warns about. Both entry
// points (marchBody and coneMarch) set it from the same uniform before they
// fold anything, so the cone pre-pass certifies emptiness against exactly the
// surface the march then walks. A path that forgot to set it would see 0,
// which is the no-wind field — wrong, but never a tear.
var<private> gWindDrift: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
// THE BODY'S NOISE FRAME: (rootShiftX, bodyYaw, rootShiftZ), exactly the
// triple noiseLocal takes. Set from ONE uniform at both entry points rather
// than rebuilt from faceCfg3/lodCfg in each, so the march and the cone
// pre-pass cannot end up anchoring to different frames — a divergence there
// certifies emptiness against a surface the march does not have.
var<private> gBodyAnchor: vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);
var<private> gTileActive: f32 = 0.0;
var<private> gTileN: f32 = 0.0;
var<private> gTileBounds: array<vec4<f32>, ${TILE_MAX_ENTRIES}>;
var<private> gTileGrp: array<vec4<f32>, ${TILE_MAX_ENTRIES}>;
var<private> gTileBand: array<f32, ${TILE_MAX_ENTRIES}>;
// PER-RAY WOUND LIST (counts2.w gate, 2026-09-07). Built ONCE per pixel at
// the march entry (see MARCH_BODY) and folded by APPLY_WOUNDS every step
// through the gWoundListOn gate. Private vars are per-invocation and start
// at their INITIALISERS (never at a previous fragment's value), so the
// cone/depth pre-pass chains — separate invocations that never run the
// preload — keep gWoundListOn 0 and fold the full 16-wound loop, which is
// CONSERVATIVE by construction (the cone certifies emptiness against the
// full field, and any correctly-binned list is a subset of it).
var<private> gWoundListOn: f32 = 0.0;
var<private> gWoundN: i32 = 0;
var<private> gWoundList: array<i32, 16>;`;

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

export const MAP_BODY = /* wgsl */ `fn mapBody(p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, counts2: vec4<f32>, noiseCfg: vec4<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, noiseShift: vec3<f32>, volumeTex: texture_3d<f32>, volumePose0: vec4<f32>, volumePose1: vec4<f32>, volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>, volumeClip: vec4<f32>, segVolumeAtlas: texture_3d<f32>, segVolumeMeta: texture_2d<f32>, perfCfg: vec4<f32>, woundBound: vec4<f32>) -> vec4<f32> {
  var d = 1e9;
  // Argmin tracking now lives in private globals shared with foldGroup
  // (above); reset per call — calcNormal calls mapBody four times and each
  // must track its own dominant prim.
  gFoldBest = 1e9;
  gFoldBestIdx = -1.0;
  gFoldBestDistort = 1.0;
  gWoundCluster = 0.0;
  gWoundOwners = 0u;
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
  if (gTileActive > 0.5) {
    // TILE-LIST PATH (perf task 5 step 2). MARCH_BODY preloaded this pixel's
    // tile entries into gTile* ONCE, before any stepping; every march step
    // folds exactly that list through the SAME foldGroup the cluster walk
    // uses, so the two paths cannot drift. No per-step bound texel reads
    // before the prim work — that is the whole economics argument (the
    // flat-list lesson: per-step reads dominate; this list costs one read
    // per pixel).
    for (var e = 0; e < ${TILE_MAX_ENTRIES}; e = e + 1) {
      if (f32(e) >= gTileN) { break; }
      d = foldGroup(d, p, data, counts, i32(gTileBand[e]), gTileBounds[e], gTileGrp[e]);
    }
  } else {
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
    // range.w is a BITFIELD, not a bool: 1 = oriented group, 2 = some prim
    // here is tapered or chamfered. Both are per-group hoists of a per-prim
    // decision, for the reason sdPrimO's header measures — paying an extra
    // textureLoad for EVERY prim cost +10-18% frame time. A group with no
    // shaped prims never touches ROW_PRIM_SHAPE at all. The prim loop,
    // sphere cull and argmin tracking all live in foldGroup (above), shared
    // with the tile-list path.
    d = foldGroup(d, p, data, counts, 0, bounds, range);
  }
  }
  }
  }
  let carved = applyCarves(d, p, data, counts);
  let dmgRes = applyWounds(carved, p, data, woundCfg, woundCfg2, perfCfg, woundBound);
  var dmg = dmgRes.x;
  let nearWound = dmgRes.y;
  // Preserve independently moving limbs under somebody else's wound.
  // Keep the original smooth body/carve fold, then union each threatened
  // limb with only ITS wounds applied. This retains authored blend seams
  // without letting an arm crater erase a nearby jaw when the arm rises.
  // No wounds/unscoped chunk wounds take the original path exactly.
  //
  // counts2.z is the ATTRIBUTION GATE (pass timing, 2026-09-07): 1 skips
  // this re-fold entirely — a WRONG frame on purpose (a raised arm's crater
  // can erase the jaw again) that prices the mechanism. 0, the shipped
  // value, is bit-identical to the pre-gate shader; only the bench's
  // owner-refold-off leg sets it (__sdfGame.setOwnerRefold).
  if ((nearWound > 0.5 || dmg != carved) && gWoundOwners != 0u && volumePose0.w < 0.5 && counts2.z < 0.5) {
    let owners = gWoundOwners;
    for (var c = 0; c < 8; c = c + 1) {
      if (c >= i32(counts.y)) { break; }
      if ((owners & ~(1u << u32(c + 1))) == 0u) { continue; }
      let cr = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_RANGE}), 0);
      if (cr.z < 0.5) { continue; }
      let cb = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_BOUNDS}), 0);
      let gs = textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_GROUPS}), 0);
      if (length(p - cb.xyz) - cb.w > (dmg + counts.w * 4.0) * gs.z) { continue; }
      let savedBest = gFoldBest;
      let savedIdx = gFoldBestIdx;
      let savedDistort = gFoldBestDistort;
      gFoldBest = 1e9;
      gFoldBestIdx = -1.0;
      gFoldBestDistort = 1.0;
      var limb = 1e9;
      for (var gi = 0; gi < 64; gi = gi + 1) {
        if (gi >= i32(gs.y)) { break; }
        let group = i32(gs.x) + gi;
        let range = textureLoad(data, vec2<i32>(group, ${ROW_GROUP_RANGE}), 0);
        let bounds = textureLoad(data, vec2<i32>(group, ${ROW_GROUP_BOUNDS}), 0);
        limb = foldGroup(limb, p, data, counts, 0, bounds, range);
      }
      gWoundCluster = f32(c + 1);
      let limbCarved = applyCarves(limb, p, data, counts);
      let limbDamage = applyWounds(limbCarved, p, data, woundCfg, woundCfg2, perfCfg, woundBound).x;
      if (limbDamage < dmg) {
        dmg = limbDamage;
      } else {
        gFoldBest = savedBest;
        gFoldBestIdx = savedIdx;
        gFoldBestDistort = savedDistort;
      }
    }
    gWoundCluster = 0.0;
  }
  // Inside-flesh rows, gated on nearWound (see APPLY_BONES): ORGANS, plus
  // bones only when packBones is on (the shipped default until bone tubes
  // ship). Outside a wound the call is provably a no-op — the inside-flesh
  // rows are contained inside flesh — so skipping it is exact, not an
  // approximation. counts2.x carries boneCount: counts was already full and
  // woundCfg2.w is the volume hitEps override, not spare. counts2.y is the
  // BARE-BONES bypass (melt task 5): the gate's proof ("bones are contained
  // in flesh") stops holding the moment flesh moves without a wound — a
  // melting body sags off its own skeleton, and a bone-only chunk (a
  // released skeleton group) has no flesh and no wound to be near, so gated
  // it would march an EMPTY field.
  if ((nearWound > 0.5 || counts2.y > 0.5) && counts2.x > 0.0) {
    dmg = applyBones(dmg, p, data, counts, counts2.x, 0, segVolumeAtlas, segVolumeMeta);
  }
  // bestIdx is read AFTER the bone fold so a bone that won the min is the
  // reported dominant prim — shading identifies bone via primScale.w == 4.
  // Kept as the bare f32 global so the returns below stay paren-free.
  let bestIdx = gFoldBestIdx;
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
  if (noiseCfg.x <= 0.0) { return vec4<f32>(dmg, bestIdx, nearWound, carved); }
  // NOISE ANCHOR (motion-polish task 6): the fbm samples the DOMINANT prim's
  // REST frame — the texture is baked into the model, so gait bob, arm raises
  // and jiggle carry their skin instead of sliding through the world-frame
  // field. restPoint falls back to the old root-shift anchor (noiseLocal)
  // when there is no live prim or the rest rows were never written.
  let anchor = restPoint(p, data, i32(bestIdx), noiseLocal(p, noiseShift));
  // Hoisted so the return carries no nested parens — the ramp test lexes the
  // return site for the word 'carved' and a paren would truncate the match.
  let detail = fbm(anchor * 3.0) * noiseCfg.x;
  return vec4<f32>(dmg + detail, bestIdx, nearWound, carved);
}`;

// Tetrahedron differences. Epsilon stays SMALL: the prior blendshell experiment
// used 0.02 (2 cm on 6 cm limbs) and smeared normals exactly at the
// high-curvature joints where they matter most.
export const CALC_NORMAL = /* wgsl */ `fn calcNormal(p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, counts2: vec4<f32>, noiseCfg: vec4<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, noiseShift: vec3<f32>, volumeTex: texture_3d<f32>, volumePose0: vec4<f32>, volumePose1: vec4<f32>, volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>, volumeClip: vec4<f32>, segVolumeAtlas: texture_3d<f32>, segVolumeMeta: texture_2d<f32>, perfCfg: vec4<f32>, woundBound: vec4<f32>) -> vec3<f32> {
  let e = vec2<f32>(1.0, -1.0) * 0.0015;
  return normalize(
    e.xyy * mapBody(p + e.xyy, data, counts, counts2, noiseCfg, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, woundBound).x +
    e.yyx * mapBody(p + e.yyx, data, counts, counts2, noiseCfg, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, woundBound).x +
    e.yxy * mapBody(p + e.yxy, data, counts, counts2, noiseCfg, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, woundBound).x +
    e.xxx * mapBody(p + e.xxx, data, counts, counts2, noiseCfg, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, woundBound).x);
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
export const SOFT_SHOULDER = /* wgsl */ `fn softShoulder(x: f32, knee: f32) -> f32 {
  // Below the knee, identity — the whole midtone range is untouched, so a
  // body out of the beam shades exactly as it always did. Above it, compress
  // [knee, inf) into [knee, 1) with an exponential that is C1 at the join and
  // strictly monotonic, which is the property that matters here: monotonic
  // means two surfaces that differed in brightness still differ afterwards.
  // That is what keeps a wound crater darker than the skin around it when the
  // flashlight is pointed straight at the body, instead of both clipping to
  // white and the damage vanishing at exactly the range you aim from.
  if (x <= knee) { return x; }
  let head = max(1.0 - knee, 1e-4);
  return knee + head * (1.0 - exp(-(x - knee) / head));
}`;

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
  segVolumeAtlas: texture_3d<f32>,
  segVolumeMeta: texture_2d<f32>,
  counts: vec4<f32>,
  counts2: vec4<f32>,
  marchCfg: vec3<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  coneK: f32,
  startT: f32,
  perfCfg: vec4<f32>,
  windDrift: vec3<f32>,
  bodyAnchor: vec3<f32>,
  // Wound union-reach bound (close-up wound-cull task, 2026-09-05), positionally LAST.
  woundBound: vec4<f32>
) -> f32 {
  // The cone pre-pass certifies "empty up to t" for the march that follows.
  // It passes noiseCfg 0 deliberately (the noise lives on the normal), but
  // wind is NOT like the noise: it moves the FIELD. A cone that marched the
  // no-wind surface would certify space the drifted cloth actually occupies
  // and the march would start inside it. Same uniform, same surface.
  gWindDrift = windDrift;
  gBodyAnchor = bodyAnchor;
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
    let d = mapBody(camPos + rd * t, data, counts, counts2, vec4<f32>(0.0), woundCfg, woundCfg2, vec3<f32>(0.0, 0.0, 0.0), volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, woundBound).x;
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

/**
 * Sphere-trace step multiplier inside applyWounds' nearWound zone.
 *
 * The wounded field is NOT a distance bound — the smax fillet overstates, the
 * lip understates, and `rimLocal` ties the lip's amplitude to the pre-wound
 * field so the two move together — and a step of `mul * d` only stays outside
 * the surface while `mul <= 1 / max|grad d|`. Measured (march-step-soundness
 * test, planar flesh, shipped rim constants): a single stock blast wound
 * reaches |grad| 2.06 and a single pellet 2.09, so the largest sound
 * multiplier is ~0.48 — for ONE wound. Overlapping craters compound through
 * the sequential per-wound loop: a blast plus a six-pellet spread measured
 * 3.92, i.e. 0.26.
 *
 * IT STAYS AT 0.6, WHICH IS ABOVE THAT BOUND, AND THAT IS A DECISION — not an
 * oversight, which is what it was until 2026-09-04, when it shared the literal
 * with the shell's under-relaxation and had never been checked against a
 * crater. The owner A/B'd 0.6 against 0.4 on screen (`setWoundStep`, below)
 * and could not tell them apart, so the frame budget wins. Everything below is
 * what that costs, so the next person can re-take the decision with the
 * numbers instead of re-deriving them.
 *
 * WHAT 0.6 LOOKS LIKE, counted over every pixel of a real frame on a torso
 * carrying a blast + a six-pellet spread (game settings: omega 1.0, AA 1.0,
 * outer-hull start, cone off):
 *
 *            mis-shaded px   of hits   normals > 45 deg wrong
 *   1.5 m        10731        4.32%
 *   2.5 m         2903        2.16%            686
 *   4.0 m          649        0.97%
 *
 * "Mis-shaded" = the march accepted a sample further behind the first
 * crossing than the hit epsilon, so the pixel takes its normal from inside
 * the carve blend and its tissue-ramp depth from up to 13.7 mm too deep —
 * far enough to shift a patch a whole band down fat -> muscle -> clot. They
 * are CONTIGUOUS (99% have an affected 4-neighbour), and STABLE: turning the
 * camera 0.23 degrees keeps 2892 of 2903. A stable wrong patch inside a
 * crater reads as "that is what the crater looks like", which is why this sat
 * unreported for as long as it did.
 *
 * ONE WOUND IS FINE at any of these values — a single stock blast produced
 * zero mis-shaded pixels at every range. This is a STACKING artifact; it
 * needs a body someone emptied a shotgun into.
 *
 * WHAT FIXING IT WOULD COST. The zone is large (r < 2 * wound radius), so the
 * ray pays over its whole approach, not just at the lip. Marched pixels only,
 * on that same shotgunned body, against 0.6:
 *
 *          extra march steps (2 m / 4 m / 8 m)   what it removes
 *   0.4          +23% / +18% / +16%              every > 45 deg error, 92% of the pixels
 *   0.3          +45% / +36% / +32%              all of them, at both ranges measured
 *
 * Unwounded bodies are untouched at any value — nothing raises nearWound —
 * and hit counts are unchanged, so nothing drops out of the image. Flip it
 * live with `__sdfGame.setWoundStep(0.4)` / `__sdfLab.setWoundStep(0.4)`
 * (perfCfg.z, see the marchBody loop; 0 = this constant). If it is ever worth
 * paying for, the cheap direction is a SMALLER zone or a per-sample count of
 * overlapping wounds — not a longer step.
 *
 * (Moved ABOVE the depth-prepass fn, close-up task 3: both template literals
 * interpolate it, and a const used before declaration is a TS error.)
 */
export const WOUND_STEP_MUL = 0.6;

// QUARTER-RESOLUTION DEPTH PREPASS (close-up task 3) — the coarse march the
// full-resolution ray starts from. Same construction as coneMarch, at 4x4
// SDF-pixel granularity instead of 8x8 tiles, with the cone radius sized to
// the BLOCK's half-diagonal angular footprint rather than the tile's:
//
// A coarse texel's ray stands in for every full-resolution ray through its
// 4x4 block. Any such ray differs from the coarse ray in direction by at
// most the block's half-diagonal angle, so its point at parameter s lies
// within s * blockK of the coarse ray's point at s. March the coarse ray
// with a cone of EXACTLY that radius (steps of d - r keep the whole cone
// outside the surface) and the first touch t_first is a lower bound on the
// first hit of EVERY ray in the block — if some block ray hit the surface at
// s, its hit point would be within r(s) of the coarse point at s, and the
// cone would have stopped at or before s. Starting there cannot start past
// any block ray's own surface. That proof is why the radius is the
// half-diagonal 2*sqrt(2) SDF pixels, not one coarse texel — the corner
// pixels of the block are that far from the texel centre.
//
// Runs per body on the body's own proxy box (BackSide, like the cone twins),
// into a shared float target whose hardware depth test (frag_depth set to
// the touch distance) resolves OVERLAPPING proxy boxes to the NEAREST touch
// — the one value that is safe for every body whose box covers the pixel.
// The full march then takes max(startT, shellIn, coarseStart) at its ray
// start — the max of three lower bounds is the tightest of them and still a
// lower bound.
//
// Returns the first-touch distance, or -1.0 on a miss (the ray walked out of
// the proxy box or ran out of iterations without touching — the consumer
// reads <= 0 as "no start", which is the conservative identity). The -1
// rather than coneMarch's tMax convention: a miss here must contribute
// NOTHING, where coneMarch's caller wants tMax as the ray's own terminal.
// The shell-displacement amp rides the touch test exactly as coneMarch's
// does (a bump standing proud of the smooth field can sit nearer the camera
// than the proved-empty distance), and the wind drift moves the FIELD so it
// rides too — same reasons, same two uniforms.
export const DEPTH_PREPASS_MARCH = /* wgsl */ `fn depthPrepassMarch(
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
  segVolumeAtlas: texture_3d<f32>,
  segVolumeMeta: texture_2d<f32>,
  counts: vec4<f32>,
  counts2: vec4<f32>,
  marchCfg: vec3<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  depthPreCfg: vec4<f32>,
  perfCfg: vec4<f32>,
  windDrift: vec3<f32>
) -> f32 {
  gWindDrift = windDrift;
  let rd = normalize(worldPos - camPos);
  let tMax = length(worldPos - camPos);
  var t = 0.0;
  for (var i = 0; i < 64; i = i + 1) {
    // The FULL field (noiseCfg 0, full cluster list, no tile binning) — the
    // same conservative choice the cone pre-pass makes. The full march may
    // run a per-pixel TILE list whose field is LARGER than this one (culling
    // a prim from a min-fold can only raise the field), so a distance proven
    // empty against the full field is empty against every tile-listed
    // sub-field too.
    let dres = mapBody(camPos + rd * t, data, counts, counts2, vec4<f32>(0.0), woundCfg, woundCfg2, vec3<f32>(0.0, 0.0, 0.0), volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, woundBound);
    let d = dres.x;
    let r = t * depthPreCfg.y;
    if (d < r + 0.0012 + woundCfg2.z) { return t; }
    // Near a wound the field is not a distance bound (the smax fillet
    // overstates), so the coarse walk uses the SAME step multiplier the full
    // march does near craters — woundMul, with the perfCfg.z override. The
    // shipped game value is 1.0 (owner look verdict, 426b55e); the A/B seam
    // setWoundStep carries over to this pass unchanged.
    let nearWound = dres.z > 0.5;
    let woundMul = select(${WOUND_STEP_MUL}, perfCfg.z, perfCfg.z > 0.0);
    let stepMul = select(marchCfg.y, woundMul, nearWound);
    t = t + max(d - r, 0.0005) * stepMul;
    if (t > tMax) { return -1.0; }
  }
  return -1.0;
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
//   counts2    x boneCount, y bareBones (melt task 5: fold inside-flesh
//              rows WITHOUT a wound - see mapBody), zw spare (wound pass r2;
//              counts was already full and woundCfg2.w is the volume hitEps
//              override, not spare)
//   meltCfg    x melt progress 0..1 (zombie melt task 6) — drives the
//              flesh-only wet-red albedo/gloss ramp below; yzw spare.
//              0 everywhere except a melting body and its released bone
//              chunks, so every other view shades bit-identical
//   marchCfg   x steps, y stepMul, z silhouetteNoiseAmp
//   woundCfg   x count, y blendK, z rimSplay, w rimOffset
//   woundCfg2  x rimWidth, y relaxation factor, z shellAmp (silhouette shell)
//   lightCfg   x keyIntensity, y fillIntensity
//   spotPos    world position of the analytic flashlight (dungeon task 7)
//   spotAxis   normalised beam axis, pointing AWAY from the lamp
//   spotCfg    x intensity (0 disables — lab parity), y cosInner,
//              z cosOuter, w range
//   spotColor  the beam's colour; the KEY blends toward it, the ambient
//              hue basis never moves
//   surfCfg    x specIntensity, y specRoughness, z fresnelBoost, w translucency
//   surfCfg2   x wetness, y surfaceNoiseAmp, z mottleAmp, w mottleScale
//   surfCfg3   x woundDepthAmp (0 = ramp off, shades as before), y fatDepth,
//              z muscleDepth, w visceraAmp (0 = viscera stop off; was SPARE
//              after the torn-fibre pass was cut 2026-09-02)
//   mottleColor  the colour the mottle mixes toward (linear RGB)
//   fatColor   subcutaneous fat for the wound tissue ramp (linear RGB)
//   visceraColor  cavity interior for the viscera stop (linear RGB); darker
//              than deepColor so it separates by VALUE — combat range
//   visceraDepth  depth at which muscle gives way to cavity, metres
//   faceCfg    x enabled, y strength, z forward (+1/-1), w relief
//   faceCfg2   x projMode (0 planar, 1 spherical), y mean, z glowThreshold,
//              w glowStrength
//   faceGlowRedOnly  opt-in bright red mask, also enabled for Replace faces
//   faceCfg3   x glowFlicker, y timeSeconds, zw = noise root shift (xz world;
//              the y shift is zero — root translation is ground-plane)
//   faceProj   xy = scale of head-space xy -> uv, zw = uv centre
//   headQuat   xyzw = the rigid head rotation (rig-bind headQuatOf); the face
//              projection un-rotates by its conjugate so the painted face
//              rides the rotating skull. Identity (0,0,0,1) on statues/chunks.
//   faceAtlas  xy = uv scale, zw = uv offset — crops the head out of the sheet
//   lodCfg     x aoEnabled, y legacyGamma, w goreStrength (0 body, 1 chunk views)
//   aaCfg      x pixelConeK — the ray's footprint RADIUS PER UNIT DISTANCE
//              for ONE pixel (tan(fovY/2) / viewportHeight), the same
//              quantity coneMarch uses at tile granularity; y strength
//              (0 = off, the shipping default)
//   woundShadowCfg  x strength (0 = off — the whole march is skipped),
//                   y softness k (iq's penumbra factor; ~8 hard, ~16 very soft)
//   bounceCfg  x probeWeight (0 = flat fill, bit-identical to pre-bounce),
//              y ambientGain, z ceilingEnabled, w chromaGain
//   tileHdr/tileEnt/tileCfg/screenUV  per-tile fold lists (perf task 5,
//                now compute-binned): tileHdr is a storage array of per-tile
//                (base, count) pairs; tileEnt the linear entry stream of
//                TILE_STRIDE vec4s per entry (bound sphere; the
//                ROW_GROUP_RANGE pack; meta with bodyIndex in x). cfg x
//                enabled / y tilesPerRow / z tile px / w tile rows. ALWAYS
//                bound (a one-element zero fallback when off); screenUV picks
//                this pixel's tile. THE GRID COMES FROM CFG, never from a
//                resource dimension — storage buffers are allocated once at
//                the worst-case size and cannot be resized, so adaptive
//                resolution changes rungs by moving these numbers alone.
//   boxMin/boxMax  the enclosure bounds ambientAt derives wall planes from
//   wallNegX..wallPosZ  the six wall albedos, linear RGB
//
// LOD NOTE: most quality levers are guarded by their own amplitude reaching
// zero (silhouette noise, surface noise, translucency, face, wounds), so the
// LOD system drives them through uniforms that already existed. AO needs
// lodCfg.x because "no ambient occlusion" has no amplitude to turn down;
// the gore mask took the spare lodCfg.w for the same reason — "no gore"
// has no colour amplitude to fade to.
// ——— Face melt (zombie melt task 8) ————————————————————————————————————
// meltCfg.x drives all three. Interpolated into MARCH_BODY below, so a WGSL
// reader sees numbers and a tuner sees these names. SAG slides the SAMPLED
// sheet V upward, which drags the features DOWN the skull: shader-sheet v
// increases up the face (the upload flip in lab-main keeps the face upright
// with a positive faceProj.y), so a surface point must sample HIGHER v to
// show what used to be above it. STRETCH narrows the sampled V window about
// the projection centre, so each feature covers MORE surface as it goes —
// the elongation is what reads as dripping rather than a sticker sliding.
// FADE_LO is where the facing fade's lower bound moves at full melt: a
// flattened head's surface turns away from the forward axis far sooner, and
// the standing-zombie 0.28 cutoff fades the face out before it has finished
// dripping.
export const FACE_MELT_SAG = 0.25;
export const FACE_MELT_STRETCH = 0.6;
export const FACE_MELT_FADE_LO = 0.05;

/**
 * MELT SKIN PATCHES (owner review, 2026-09-03: "some of the pink would still
 * be there like the skin, so some parts are still pink mixed with the red").
 *
 * The first version lerped ALL flesh albedo toward the deep red on one global
 * progress, so every pixel crossed over together and the body took a uniform
 * stain. Skin does not do that — it SLOUGHS, in patches, exposing the meat
 * under it while other patches are still intact.
 *
 * So the crossover threshold is per-point, read off the same rest-space noise
 * anchor the mottle uses: each patch turns at its own progress. FREQ sets the
 * patch size (the mottle beside it runs at 6.0), SOFT the softness of each
 * patch's edge, and KEEP > 1 scales the threshold ABOVE full progress so the
 * highest patches never cross at all — that is what leaves pink skin on the
 * finished puddle instead of converging to one red at t = 1.
 */
export const MELT_SKIN_PATCH_FREQ = 5.0;
export const MELT_SKIN_PATCH_SOFT = 0.16;
export const MELT_SKIN_KEEP = 1.30;
/**
 * Spread of the patch field before it becomes a threshold.
 *
 * NEEDED because fbm does NOT fill 0..1 evenly — it clusters hard around its
 * midpoint, so `fbm * 0.5 + 0.5` puts almost every point near 0.5 and every
 * patch crosses at nearly the same progress. The first version of this had no
 * contrast term and the body still went uniformly red, which looked exactly
 * like the bug it was meant to fix. Multiplying the deviation from the
 * midpoint before the bias is what actually separates early patches from late
 * ones (measured against captures at t = 0.35, where the uncontrasted version
 * had no pink left at all).
 */
export const MELT_SKIN_CONTRAST = 2.8;

// MARCH_BODY is assembled from NAMED SECTIONS (hybrid deferred M1 task 2) so
// the deferred surface entry — MARCH_SURFACE in deferred-sdf.ts — can share
// the trace and the material evaluation VERBATIM instead of copying a
// 600-line marcher:
//
//   `fn <entry>` + MARCH_BODY_PARAMS          one signature, both entries,
//                                             so createMarchMaterial's
//                                             positional bindings serve both
//                + MARCH_BODY_TRACE           ray setup, the march loop, the
//                                             hit, the albedo/normal chain
//                + MARCH_BODY_SURFACE_PREP    light-independent material
//                                             terms (wet, specPow, glow)
//                + MARCH_BODY_LIGHT           legacy only: flashlight through
//                                             display conversion and return
//
// The legacy expansion (MARCH_BODY at the bottom of this block) is the same
// text as before the split with exactly ONE reordering: the wet block and
// the glow term moved above the analytic flashlight. Neither reads L/keyC/
// keyI or any light uniform, so the arithmetic is unchanged; the move is
// what lets the surface entry exit before the first light-dependent term
// while sharing one source of truth. specPow is the legacy shine exponent
// given a name, nothing more.
export const MARCH_BODY_PARAMS = /* wgsl */ `(
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
  segVolumeAtlas: texture_3d<f32>,
  segVolumeMeta: texture_2d<f32>,
  counts: vec4<f32>,
  counts2: vec4<f32>,
  marchCfg: vec3<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  baseColor: vec3<f32>,
  deepColor: vec3<f32>,
  charColor: vec3<f32>,
  lightDir: vec3<f32>,
  keyColor: vec3<f32>,
  lightCfg: vec2<f32>,
  spotPos: vec3<f32>,
  spotAxis: vec3<f32>,
  spotCfg: vec4<f32>,
  spotCfg2: vec4<f32>,
  spotColor: vec3<f32>,
  surfCfg: vec4<f32>,
  surfCfg2: vec4<f32>,
  surfCfg3: vec4<f32>,
  meatCfg: vec4<f32>,
  mottleColor: vec3<f32>,
  fatColor: vec3<f32>,
  boneColor: vec3<f32>,
  organColor: vec3<f32>,
  organAmp: f32,
  visceraColor: vec3<f32>,
  visceraDepth: f32,
  faceCfg: vec4<f32>,
  faceCfg2: vec4<f32>,
  faceGlowRedOnly: f32,
  faceCfg3: vec4<f32>,
  faceProj: vec4<f32>,
  faceAtlas: vec4<f32>,
  headCentre: vec3<f32>,
  headAxes: vec3<f32>,
  headQuat: vec4<f32>,
  faceGlowColor: vec3<f32>,
  lodCfg: vec4<f32>,
  woundShadowCfg: vec2<f32>,
  bounceCfg: vec4<f32>,
  boxMin: vec3<f32>,
  boxMax: vec3<f32>,
  wallNegX: vec3<f32>,
  wallPosX: vec3<f32>,
  wallNegY: vec3<f32>,
  wallPosY: vec3<f32>,
  wallNegZ: vec3<f32>,
  wallPosZ: vec3<f32>,
  aaCfg: vec2<f32>,
  debugCfg: vec2<f32>,
  tileHdr: ptr<storage, array<vec2<u32>>, read>,
  tileEnt: ptr<storage, array<vec4<f32>>, read>,
  tileCfg: vec4<f32>,
  screenUV: vec2<f32>,
  startT: f32,
  occT: f32,
  shellIn: f32,
  shellOut: f32,
  perfCfg: vec4<f32>,
  prevT: f32,
  bodyCentre: vec3<f32>,
  bodyHalf: vec3<f32>,
  // Melt progress in x, yzw spare - zombie melt task 6. Zero everywhere but a
  // melting body and its released bone chunks; the flesh-only wet-red ramp
  // below is bit-identical to the pre-melt shader while it is 0.
  meltCfg: vec4<f32>,
  // Level-only shadow - perf round 2 task 7 — bound positionally LAST to
  // match createMarchMaterial's binding order. The gate is cfg.x — zero
  // keeps the march bit-identical to the pre-task-7 shader.
  // NOTE FOR THE NEXT EDITOR — the wgslFn parser regexes the parameter list
  // for name-colon-type pairs, COMMENTS INCLUDED, so no comment in here may
  // ever contain a colon between two words; a phantom input shifts every
  // binding by one slot and the pipeline dies on a type mismatch.
  levelShadowTex: texture_depth_2d,
  levelShadowMatrix: mat4x4<f32>,
  levelShadowCfg: vec4<f32>,
  windDrift: vec3<f32>,
  bodyAnchor: vec3<f32>,
  // Wound union-reach bound - close-up wound-cull task 2026-09-05. No parens or colons in these comments.
  woundBound: vec4<f32>,
  // Quarter-res depth prepass - close-up task 3. Bound POSITIONALLY LAST,
  // in the same commit as the WGSL input - the meltCfg rule. cfg is
  // x enabled, y the coarse block footprint - radius per unit distance, the
  // 2*sqrt2 SDF-pixel half-diagonal - zw spare. Disabled or untouched, the
  // fetch hands back 0 and the max at the ray start folds it away, so
  // every view that never opts in marches bit-identical.
  // HAZARD - WIDER THAN THE COLON WARNING AT THE TOP OF THIS LIST - three
  // captures the parameter list UP TO THE FIRST CLOSE-PAREN, so a paren in
  // any comment here also truncates the parsed inputs; the missing params
  // then get float 0 substituted at the call, WGSL generation dies with a
  // JoinNode null deref, and every body renders unlit-black behind a
  // console-only error - 2026-09-05. A stray name-colon-type pattern in a
  // comment is the OLDER failure - the phantom input shifts every binding
  // by one slot. NO PARENS and NO COLONS in any comment in this list. Ever.
  depthPreTex: texture_2d<f32>,
  depthPreCfg: vec4<f32>,
  normalGradientCfg: vec4<f32>,
  // Static probe grid - lighting P3 step 1 - bound POSITIONALLY LAST. Five
  // slots. probeCfg x is the weight and 0 keeps the compose bit-identical.
  // NO PARENS and NO COLONS in this comment either.
  probeTex: texture_2d<f32>,
  probeMin: vec3<f32>,
  probeInvExtent: vec3<f32>,
  probeDims: vec4<f32>,
  probeCfg: vec4<f32>,
  // Flashlight bounce spot - lighting P4 step 1 - bound POSITIONALLY LAST.
  // Four slots. bounceSpotCfg x is the gain and 0 keeps the compose bit-identical.
  // NO PARENS and NO COLONS in this comment either.
  bounceSpotPos: vec3<f32>,
  bounceSpotNormal: vec3<f32>,
  bounceSpotRadiance: vec3<f32>,
  bounceSpotCfg: vec4<f32>,
  // GPU probe gather dynamic layer - lighting P3 and P4 - bound POSITIONALLY LAST.
  // Two slots. probeDynCfg x radiance gain, y visibility strength, both 0 keeps
  // the compose bit-identical. NO PARENS and NO COLONS in this comment either.
  probeDyn: ptr<storage, array<vec4<f32>>, read>,
  probeDynCfg: vec4<f32>,
  // Direct muzzle flash on this body - owner 2026-09-09 - bound POSITIONALLY LAST.
  // xyz the burning muzzle in world space, w its intensity and 0 skips the term.
  // NO PARENS and NO COLONS in this comment either.
  bodyFlash: vec4<f32>,
  // Temporal reprojection start - plan 2026-09-10 - bound POSITIONALLY LAST.
  // lastTex is last fresh frame's layer with NDC depth in alpha, lastInvVp the
  // inverse view projection that made it, temporalCfg x enable y margin z slope
  // w max start. x at 0 keeps the march bit-identical.
  // NO PARENS and NO COLONS in this comment either.
  lastTex: texture_2d<f32>,
  lastInvVp: mat4x4<f32>,
  temporalCfg: vec4<f32>
) -> vec4<f32> {
`;

/**
 * SECTION 2 of 4 — the trace: ray setup and pre-pass gates, the march loop,
 * the hit test, and the full post-hit MATERIAL chain (normal evaluation,
 * wound/char masks, tissue ramp, organ/mottle/gore, the face pass, painted
 * prims, char, melt). Everything here is light-independent, so the deferred
 * surface entry reuses this text verbatim. The debug early-returns and the
 * miss discard are part of the trace and behave identically in both entries.
 */
export const MARCH_TRACE_SETUP = /* wgsl */ `  // FIRST STATEMENT, before anything folds. gWindDrift is read inside
  // sdShell, which is reached from foldGroup on every mapBody call in this
  // invocation — the march steps, calcNormal, the AO and scatter probes. Set
  // it late and the normal would be taken against a different surface than
  // the one the march hit.
  gWindDrift = windDrift;
  gBodyAnchor = bodyAnchor;
  let rd = normalize(worldPos - camPos);
  // PERF INSTRUMENTATION (task 2): debugCfg.x 0 = off, 1 = steps-per-pixel
  // heatmap, 2 = prims-per-pixel. Everything below is guarded so the
  // shipping path pays exactly one uniform branch; gDebugMode hands the
  // flag to mapBody's fold without forking its signature.
  if (debugCfg.x > 0.5) { gDebugMode = debugCfg.x; gDebugPrims = 0.0; gDebugSteps = 0.0; gDebugBones = 0.0; gDebugVolumeSamples = 0.0; gDebugVolumeFallbacks = 0.0; }
  // TILE-LIST PRELOAD (perf task 5 step 2). Read ONCE per pixel, here at the
  // march entry — never per step. The entry's groups then ride every mapBody
  // call in this fragment through gTileActive (march steps AND the post-hit
  // normal/AO/scatter probes, so shading sees exactly the field the ray
  // walked). The cone pre-pass is a separate invocation chain and keeps
  // gTileActive 0 — it marches the full cluster field, which is CONSERVATIVE
  // relative to any correctly-binned tile list.
  gTileActive = select(0.0, 1.0, tileCfg.x > 0.5);
  if (tileCfg.x > 0.5) {
    // The grid travels IN THE UNIFORM — deliberately not textureDimensions(),
    // whose inference-from-resource-size is exactly what broke when adaptive
    // resolution moved rungs under the old DataTexture path.
    let gx = max(1, i32(tileCfg.y));
    let gy = max(1, i32(tileCfg.w));
    let tid = clamp(vec2<i32>(floor(screenUV * vec2<f32>(f32(gx), f32(gy)))), vec2<i32>(0, 0), vec2<i32>(gx - 1, gy - 1));
    let head = (*tileHdr)[tid.y * gx + tid.x];
    let n = min(head.y, ${TILE_MAX_ENTRIES}u);
    // PER-RAY SPHERE COMPACTION (prototype, tileCfg.x == 2). The tile list
    // is a 16px-wide frustum's worth of groups, projected at each sphere's
    // NEAREST depth and clamped outward to whole tiles, so a single ray
    // carries groups it never comes near. One ray-vs-sphere test per entry,
    // HERE and never per step, drops those before any marching. The sphere
    // is inflated the way both cull sites already agree on: the binner's
    // blendReach (counts.w * 4) scaled by the group's distortion factor as
    // the per-step foldGroup test scales its threshold, plus RAY_CULL_SLACK
    // for the post-hit probes that leave the ray (calcNormal eps, the AO
    // probe at n * 0.06) — those sample the same gTile list.
    let rayCull = tileCfg.x > 1.5;
    let reach = counts.w * 4.0 + ${RAY_CULL_SLACK};
    var w = 0;
    for (var e = 0; e < ${TILE_MAX_ENTRIES}; e = e + 1) {
      if (e >= i32(n)) { break; }
      // Entry stream: TILE_STRIDE vec4s per entry at base head.x. Same record
      // layout the CPU binner packs; kTileWrite emits it verbatim.
      let lin = (head.x + u32(e)) * 3u;
      let b = (*tileEnt)[lin];
      let g = (*tileEnt)[lin + 1u];
      if (rayCull) {
        let oc = b.xyz - camPos;
        let tc = max(dot(oc, rd), 0.0);
        let rInf = b.w + reach * max(g.z, 1.0);
        if (dot(oc, oc) - tc * tc > rInf * rInf) { continue; }
      }
      gTileBounds[w] = b;
      gTileGrp[w] = g;
      gTileBand[w] = (*tileEnt)[lin + 2u].x * ${DATA_ROWS}.0;
      w = w + 1;
    }
    gTileN = f32(w);
  }
  // PER-RAY WOUND LIST (counts2.w gate, 2026-09-07). Built ONCE per pixel:
  // a wound whose REACH sphere the ray never enters cannot change this
  // ray's field on any step, nor the post-hit probes within RAY_CULL_SLACK
  // of the ray. Same reach formula as applyWounds (pinned by test, + slack
  // for the off-ray probes). The cone/depth pre-pass chains never run this
  // block, so their gWoundListOn stays 0 and they fold every wound —
  // conservative by construction.
  gWoundListOn = select(0.0, 1.0, counts2.w > 0.5);
  if (gWoundListOn > 0.5) {
    gWoundN = 0;
    let nW = min(i32(woundCfg.x), 16);
    for (var i = 0; i < 16; i = i + 1) {
      if (i >= nW) { break; }
      let w = textureLoad(data, vec2<i32>(i, ${ROW_WOUND}), 0);
      let reach = w.w * max(2.0, 2.0 * woundCfg.w + 3.0 * woundCfg2.x) + 4.0 * woundCfg.y + 0.25 + ${RAY_CULL_SLACK};
      let oc = w.xyz - camPos;
      let tc = max(dot(oc, rd), 0.0);
      if (dot(oc, oc) - tc * tc > reach * reach) { continue; }
      gWoundList[gWoundN] = i;
      gWoundN = gWoundN + 1;
    }
  }
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
  // OUTER-HULL BOUNDS (shell-hull-outer.ts). The hull CONTAINS the flesh, so
  // it answers two questions the occluder cannot:
  //
  //   shellOut <= 0 — no hull covers this pixel, therefore no surface can be
  //     here, therefore there is nothing to march. Measured 2026-08-31: that
  //     is 82-92% of every pixel the march rasterises, carrying 63-84% of all
  //     its steps.
  //   shellIn — where the hull's near surface is. No surface exists before it,
  //     so the ray may start there instead of at the proxy box's front.
  //
  // THE return IS NOT REDUNDANT WITH THE discard. In WGSL, discard demotes the
  // invocation to a helper; it does NOT stop execution. Without the return the
  // pixel would still walk its entire budget and only then be thrown away —
  // which is precisely the work this exists to delete.
  // (No backticks in this file: it is one big template literal.)
  //
  // ENTRY AND EXIT ARE SEPARATE for one reason: a camera INSIDE a hull sphere
  // sees no front face, so entry reads 0 there exactly as it does where there
  // is no hull at all. Exit tells them apart — inside the hull it is positive.
  // Collapsing the two would discard flesh at point-blank range.
  //
  // With the shell OFF the fetches hand back shellIn 0 / shellOut 1e9, so both
  // uses below are identities and this path stays bit-identical.
  //
  // shellOut FOLDS INTO tMax ON THE UN-RELAXED PATH, behind perfCfg.x, and
  // there the fold is EXACT: the hull contains the flesh, so no ray can hit
  // anything beyond the hull's back face. Cutting the march there deletes
  // only the empty space a miss ray used to walk between the hull exit and
  // the proxy box's far plane. The game page binds perfCfg.x 1 (see
  // GAME_HULL_EXIT_BOUND); the lab binds zero and stays bit-identical.
  //
  // The relaxed tracer (omega > 1.0) is the exception, and why the fold ships
  // behind a seam at all: X1.15 made that tracer take a CLAMPED FINAL SAMPLE
  // at tMax so an overshoot past tMax could still retract. Clamping tMax to
  // the hull puts that sample ON THE HULL — a surface sitting blendK +
  // shellAmp + chain-inflation OUTSIDE the flesh — and the AA epsilon
  // (t * aaCfg.x, which grows with distance) accepts it as a hit: a bright
  // halo hugging every silhouette and distant ghost outlines, worst far away
  // where the epsilon is largest. Caught by the 2026-08-31 on/off visual
  // gate. The clamped final sample exists only above omega 1.0, so the fold
  // is guarded with !relax and the relaxed path keeps the proxy-box far
  // plane. (History: the fold was first left out entirely as the fix for
  // that halo; perf round 2 re-adds it for the un-relaxed path only.)
  //
  // With the shell OFF the fetch hands back shellOut 1e9, so min() is the
  // identity; with perfCfg.x 0 select() is the identity. Both identities are
  // bit-exact — nothing else about the march changes.
  if (shellOut <= 0.0) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  // THE OCCLUDER NO LONGER BOUNDS tMax, AND IT MUST NOT (2026-09-01).
  //
  // Everything above about the inner hull being safe to clamp against is
  // sound as GEOMETRY, and the hull really is inside the flesh: sampling
  // sdBody at all 300 emitted spheres of the live POSED bodies puts every one
  // of them at least its own radius deep (__sdfGame.hullInsideness). What is
  // not sound is the NUMBER the pre-pass writes for them.
  //
  // Measured with one synthetic sphere of known centre and radius, rasterised
  // alone and read straight back (__sdfGame.syntheticSphereCheck). The value
  // the pre-pass stores tracks the true camera distance only in the near
  // field and then comes apart -- and the error depends on DISTANCE alone,
  // not on the sphere's radius or its size on screen:
  //
  //   true 1.9 -> 1.905    true 2.4 -> 2.405   true 2.9 -> 2.892   (exact)
  //   true 3.9 -> 3.714    true 4.9 -> 4.252   true 5.9 -> 4.447
  //   true 7.9 -> 3.782    true 9.9 -> 2.079   true 11.9 -> 0.367
  //
  // An UNDER-reported occT is the one error this bound cannot survive: tMax
  // lands in front of the surface, the ray gives up before reaching skin, and
  // the fragment discards. On screen that is the owner's report of bodies
  // "full of holes until you get fairly close" -- holes because the clamp
  // bites per pixel wherever the hull covers, and distance-keyed because the
  // encoding is accurate exactly where the player is close. Measured on a
  // single isolated zombie at 4.9 m: 1369 of 1375 lost pixels had tMax IN
  // FRONT of the flesh, worst case 0.68 m short, and the hull's own CPU
  // ray-sphere entry (4.814 m) sat correctly BEHIND the surface (4.757 m)
  // while the pre-pass wrote 4.225 m for the same pixel.
  //
  // The bound bought nothing to weigh against that. Interleaved frame timing
  // with the outer shell hull shipping (room 3, 8 bodies, 6 rounds x 30
  // frames, GPU-fenced): occluder on 14.23 ms mean, off 14.32 ms, against a
  // 13.4-14.9 ms spread WITHIN either leg. That matches what the shell work
  // already recorded -- "the occluder measured as worth nothing anyway".
  //
  // So the clamp goes and the pre-pass ships disabled. Everything else stays:
  // occluder-hull.ts still builds, occFetch still fetches, debug mode 3 still
  // heats occT, and __sdfGame.setOccluder still renders the pass -- so
  // whoever works out why an instanced MeshBasicNodeMaterial writing
  // length(positionWorld - cameraPosition) decays with distance can revive
  // this by putting the term back. Do not put it back before that: the outer
  // hull (shell-hull-outer.ts) writes distance the same way, and is unharmed
  // only because shellIn is a ray START and shellOut a > 0 test, where
  // under-reporting is conservative. Here it is fatal.
  let tMaxBox = length(worldPos - camPos);
  let relax = woundCfg2.y > 1.0;
  let tMaxSel = select(tMaxBox, min(tMaxBox, shellOut), perfCfg.x > 0.5 && !relax);
  // Accumulated-depth gate (perf round 2 task 5): a nearer body already
  // owns this pixel out to prevT — the front-to-back per-body passes blit
  // the accumulated frame state before each pass, and prevFetch decodes its
  // alpha (clip depth) into a ray distance.
  //
  // bodyEntry is the fragment's OWN conservative entry along the ray: its
  // proxy box (centre = the mesh's world origin, half extents = bodyHalf)
  // contains the hull contains the flesh, so nothing of this body can be
  // nearer than the ray-box entry. shellIn is a second lower bound on the
  // same first-possible hit (the SHARED nearest hull entry across ALL
  // bodies — weaker here, but never wrong). The exact discard takes the MAX
  // of the two: the larger of two lower bounds on the first possible hit is
  // still a lower bound on it, and the tighter of the two, so discarding
  // when max(shellIn, bodyEntry) > prevT can never drop a fragment this
  // body would have shaded — while min(shellIn, bodyEntry) <= shellIn <=
  // prevT almost everywhere was inert (task 5 shipped it and measured the
  // counters bit-identical on/off; task 5b proves the max form bites).
  //
  // invRd's 1e9 fallback (parallel axis) keeps the slab algebra finite: a
  // fragment's ray genuinely hits the box, so its fixed coordinate lies
  // inside that slab and the ±1e9 pair cancels in the min/max. The 0 clamp
  // is the camera-inside-the-box case: entry 0 never discards.
  let invRd = select(vec3<f32>(1e9), 1.0 / rd, abs(rd) > vec3<f32>(1e-8));
  let bLo = (bodyCentre - bodyHalf - camPos) * invRd;
  let bHi = (bodyCentre + bodyHalf - camPos) * invRd;
  let bodyEntry = max(max(min(bLo.x, bHi.x), min(bLo.y, bHi.y)), max(min(bLo.z, bHi.z), 0.0));
  if (max(shellIn, bodyEntry) > prevT) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  let tMax = min(tMaxSel, prevT);
  let steps = i32(marchCfg.x);
  // HIT EPSILON (X1.26): the primitive literal was 1.2 mm. A trilinear
  // reconstruction of a baked SDF is not exact to the surface, so volume
  // mode raises the threshold through the SPARE woundCfg2.w channel to at
  // least half the largest voxel pitch (set by the hands view). max() keeps
  // the primitive path bit-identical at the default 0.
  // HIT EPSILON, and the ANTIALIASING lever on top of it.
  //
  // hitEpsBase is the floor: the original 1.2 mm primitive literal, raised
  // by woundCfg2.w in volume mode (see below).
  //
  // aaCfg.y > 0 additionally ends the march once the field is within the RAY'S
  // OWN PIXEL FOOTPRINT, t * aaCfg.x. That prefilters geometry below Nyquist
  // — detail finer than a pixel is smoothed rather than aliased — which is the
  // principled fix for geometric aliasing, versus FXAA guessing edges after
  // the fact. It is also FASTER, because a larger epsilon converges in fewer
  // steps, and the saving grows with distance: biggest exactly where crowds
  // are. Corner rounding is sub-pixel by construction, so invisible; that IS
  // the antialiasing.
  //
  // THREE THINGS TO KNOW BEFORE RAISING THE STRENGTH:
  //  1. mapBody UNDER-REPORTS Euclid distance by the group distortion factor
  //     (up to 22x — the schoolgirl's sole plate), so d < eps can fire when
  //     the TRUE distance is many times eps, stopping the ray short and
  //     reading blobby/detached, non-uniformly, in high-distortion regions.
  //     CORRECTED (perf round 2 task 6): the fold's argmin carries the
  //     dominant group's packed factor in the private global gFoldBestDistort
  //     and the epsilon below divides by it — same per-sample state as the
  //     argmin, so the correction is exact where the hit lands. This is why
  //     the lever can now ship ON.
  //  2. Craters fill in at range as eps approaches wound depth. Arguably
  //     correct LOD, but it is the distance at which a player judges whether
  //     a shot landed — hence the floor, which never shrinks below 1.2 mm.
  //  3. It does nothing for SHADING aliasing, and henenlotter-latex is the
  //     worst case (specIntensity 0.95 / specRoughness 0.12, plus
  //     surfaceNoiseAmp perturbing normals). Geometric prefiltering will not
  //     stop specular scintillation; that wants roughness widening with the
  //     same footprint, separately.
  //
  // Bonus: the footprint tracks the adaptive-resolution ladder for free, since
  // aaCfg.x is derived from the SDF pass height — so AA quality stays
  // consistent at scale 1.0 and at 0.45, where today the low rungs give more
  // aliasing AND more blur at once.
  let hitEpsBase = max(0.0012, woundCfg2.w);
  let aaK = aaCfg.x * aaCfg.y;
  // NOISE ANCHOR (motion-polish task 6): every fbm below samples the
  // DOMINANT prim's REST frame via restPoint — the noise is baked into the
  // model. noiseShift (faceCfg3.zw + lodCfg.z, the task-3 root-shift anchor)
  // survives ONLY as restPoint's fallback for bodies without rest rows and
  // for the no-live-prim case. Zero = the pre-motion behaviour there.
  let noiseShift = vec3<f32>(faceCfg3.z, lodCfg.z, faceCfg3.w);
  // ONLY .x CARRIES MEANING: the silhouette-noise amplitude. y/z/w are dead.
  //
  // They were a parked melt spike's amp/frequency/time (c52b05b), removed in
  // the 2026-09-04 merge because the shipped zombie melt supersedes it. Note
  // what this line read immediately after that merge:
  //   vec4<f32>(marchCfg.z, meltCfg.x, meltCfg.y, meltCfg.z)
  // Both sides had independently named a uniform meltCfg, so git merged the
  // two files with NO conflict marker and quietly fed the zombie melt's
  // PROGRESS into the spike's displacement amplitude — a body that ridges as
  // it melts, from a merge that reported success.
  //
  // The vec4 survives only because hard-surface's gloss/metal kill is written
  // against it (see calcNormal below). Collapsing it back to a plain f32 is a
  // tidy-up worth doing; three permanently-dead lanes on a shared struct is
  // precisely how primClip.w's "spare" comment went stale.
  let noiseCfg = vec4<f32>(marchCfg.z, 0.0, 0.0, 0.0);

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
  // NORMAL WARPING (Hubert-Brierre et al. 2025) took the silhouette fbm OUT
  // of the marched field — see the mapBody call below, which passes 0.0 — so
  // it survives only in calcNormal, where it perturbs the shading normal at
  // the hit point. That made the field an exact CSG of ellipsoid capsules
  // under a conservative smooth-min for EVERY body, not just the distant ones
  // LOD had already stripped.
  //
  // ==> THAT ARGUMENT NO LONGER HOLDS. It was written before wounds existed.
  // applyWounds does NOT return a distance bound (the smax fillet overstates,
  // the lip understates), so the field the tracer sees near a crater is not
  // conservative and over-relaxation is NOT always safe. Relax pinned to 1.0
  // on 2026-08-24 after ω = 1.4 × carved wounds produced the wound-halo
  // "distorted lens": both ω > 1-only paths below step rays BACKWARD at
  // grazing wound angles and fail to reconverge, so whole screen-space
  // circles shade the body from an offset depth. Post-mortem in Obsidian,
  // Claude Notes/Blud/2026-08-24-wound-halo-postmortem.md.
  //
  // DO NOT raise the default above 1.0 until the two retractions below are
  // bounded and provably reconverge — see the "retract-guard reconvergence"
  // lever in docs/superpowers/specs/2026-08-23-raymarcher-performance-design.md.
  // It is worth 1.60× on crowds (X1.10: 10 bodies, 1.0 → 14.89 ms vs
  // 1.4 → 9.31 ms), so it is worth doing properly — but that sweep PREDATES
  // wounds and must be re-run with craters in the scene before 1.4 returns.
  //
  // SHELL DISPLACEMENT (gobs-and-goo task 4) is the owner-approved middle
  // path that brings the bumpy outline BACK: the relaxed march runs the
  // smooth field until it is inside a thin shell of the surface, and only
  // there does the fbm displace the stepped distance — see the loop body.
  var omega = select(marchCfg.y, woundCfg2.y, relax);
  // Near-wound step multiplier, with a live override on perfCfg.z for A/B
  // (__sdfGame.setWoundStep). ZERO IS THE IDENTITY: every view that never
  // writes the lane gets the compiled constant, bit for bit. The lane is on
  // perfCfg and not counts2 because counts2 is re-set on every pack — an
  // override parked there would evaporate on the next body rebuild.
  let woundMul = select(${WOUND_STEP_MUL}, perfCfg.z, perfCfg.z > 0.0);
  // Start where the cone pre-pass proved the tile is still empty, rather than
  // at the camera. Clamped to tMax so a stale or over-eager coarse value can
  // never push the ray straight out the back of the proxy box.
  // max(startT, shellIn): the cone pre-pass proved empty space ahead, and the
  // outer hull proves no surface exists before its own near face. Take
  // whichever reaches further; clamped to tMax so neither can push the ray out
  // the back of the box.
  //
  // QUARTER-RES DEPTH PREPASS (close-up task 3) adds a third lower bound to
  // the max — the coarse pass's first cone-touch distance for this pixel's
  // 4x4 block, provably at or in front of every ray's own first surface
  // (the proof lives on DEPTH_PREPASS_MARCH). The fetch returns 0 for a
  // miss or a disabled pass, and preStart collapses to 0, which is the
  // identity inside the max — the off path is bit-identical.
  //
  // The backoff subtracts three slack terms from the recorded touch. The
  // footprint term (preT * cfg.y) is insurance beyond the cone-radius proof:
  // it would take a depth gradient steeper than one block footprint per
  // block — a grazing silhouette — to put a block ray's own surface nearer
  // than touch minus a footprint, and the proof already covers that case;
  // this term costs one multiply and buys the census a quiet night. The
  // 0.0012 is the coarse touch test's own epsilon (the touch can record up
  // to that far before the field's nearest surface), and shellAmp is the
  // shell displacement the coarse test also stopped short of — the same two
  // slack terms CONE_MARCH's stop carries, handed back to the ray here.
  let preT = depthPreFetch(depthPreTex, screenUV, depthPreCfg);
  let preStart = select(0.0, max(preT - (preT * depthPreCfg.y + 0.0012 + woundCfg2.z), 0.0), preT > 0.0);
  // TEMPORAL REPROJECTION START (plan 2026-09-10). Last fresh frame's hit at
  // this pixel, unprojected with that frame's inverse VP and measured along
  // THIS ray, minus a margin for flesh that moved toward the camera and a
  // slope term - a fourth proven-ahead lower bound. Every off path returns 0,
  // the identity inside the max, so ?tstart=0 is bit-identical. The ndc
  // mapping from screenUV is the layer's own (no flip) - pinned on the GPU by
  // Task 2 step 7.2 of the plan (a wrong flip reads the mirrored row).
  let tempNdc = vec2<f32>(screenUV.x * 2.0 - 1.0, screenUV.y * 2.0 - 1.0);
  let temp = temporalStartFetch(lastTex, tempNdc, lastInvVp, camPos, rd, temporalCfg);
  // OWN-BODY GATE. The layer's depth is the NEAREST body at the pixel, but
  // this pass marches ONE body: if last frame's hit was another body in
  // front, starting there skips this body's own surface (the 2026-09-10
  // see-through - other bodies' silhouettes cut into flesh). Trust the
  // reprojected point only when it lies inside THIS body's proxy box along
  // the ray, margin either side; then confirm the start is OUTSIDE the field
  // with one sample - inside means the surface was skipped, and the
  // recovery probes below rewind to the surface instead of dropping the
  // whole bound.
  var tempStart = 0.0;
  // WINDOW-WIDTH REFUSAL (the holes fix, 2026-09-10 night). On a ray that
  // GRAZES the body, the entry/exit window is razor-thin and the field's
  // convergence dip is narrower than the walk's sampling stride: a temporal
  // start landing at/past the dip can never accept (per-pixel temporalDiag:
  // ~460 broken px at ANY margin; 0.25 -> 607, 1.0 -> 231, cap+slack ->
  // 64-118), and the exit-side accepts cannot recover a walk that skipped
  // its only convergent region. So the temporal start fires only where the
  // window is at least margin + cap + headroom wide — face-on pixels, where
  // the approach-skipping win lives; thin-window silhouette pixels fall
  // back to the safe shellIn walk, which is current-frame and tracks
  // swung limbs.
  if (temp.y > 0.0
      && tMax - shellIn >= temporalCfg.y + 0.18
      && temp.y >= bodyEntry - temporalCfg.y && temp.y <= tMax + temporalCfg.y) {
    // shellAmp backoff: with shell displacement live, the displaced
    // silhouette sticks out up to shellAmp beyond the smooth field the probe
    // below samples — the same slack preStart carries. woundCfg2.z is 0 at
    // the shipping default, so this is the identity there.
    var s = temp.x - woundCfg2.z;
    if (s > 0.0) {
      var dres0 = mapBody(camPos + rd * s, data, counts, counts2, vec4<f32>(0.0), woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, woundBound);
      // ACCEPTANCE: outside the field AND outside a wound's near zone
      // (dres0.z). Near a crater applyWounds' smax fillet OVERSTATES the
      // distance — the field is not a bound there — and a start beside the
      // zone lets the first step land inside the carve: the frozen-scene
      // pixel diff (2026-09-10) showed banded deep-tissue/char striping on
      // the wounded closeup at a 0.05 m adaptive margin, while the shipped
      // 0.25 m margin rendered pixel-identical to tstart off. Clean skin
      // keeps the tight start; wound-adjacent pixels back off below.
      // RECOVERY PROBES. Inside (x <= 0) means the surface reached the
      // start — flesh moved toward the camera, or this pixel sits on a
      // silhouette slope the flat slope term undershoots; rewind by twice
      // the reported penetration (twice: the field under-reports Euclid by
      // the group distortion factor). In-zone (z >= 0.5) rewinds by a fixed
      // 0.15 — the zone reaches ~wound radius + rim beyond the crater, so a
      // couple of steps clear it. Three probes at most, then the bound is
      // dropped (max() below still marches from bodyEntry). A rewind before
      // the box entry always probes positive-and-out-of-zone (every prim of
      // this body lies inside the box; zones only exist around its own
      // wounds), so the loop self-terminates there.
      for (var probe = 0; probe < 3; probe = probe + 1) {
        if (dres0.x > 0.0 && dres0.z < 0.5) { break; }
        let back = select(s + 2.0 * dres0.x, s - 0.15, dres0.z >= 0.5);
        if (back <= 0.0) { break; }
        s = back;
        dres0 = mapBody(camPos + rd * s, data, counts, counts2, vec4<f32>(0.0), woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, woundBound);
      }
      if (dres0.x > 0.0 && dres0.z < 0.5) {
        // HULL-RELATIVE CAP (the holes fix, 2026-09-10 night). The accepted
        // start may tighten at most 6 cm past the CURRENT frame's hull face:
        // shellIn is rebuilt every frame and tracks swung limbs perfectly,
        // while the temporal history is one frame stale — at melee swing
        // tips the surface moves 0.3-0.5 m per frame, and a stale start past
        // the moved surface re-phases the walk into the razor-thin graze
        // window where acceptance falls off its edge (the stacked-corridor
        // holes: ~460-620 broken px at ANY fixed margin; margin sweep 0.25
        // -> 607, 0.6 -> 622, 1.0 -> 231, meanTOn pinned at the box exit).
        // The 6 cm budget is what the temporal start is FOR — tightening
        // the last stretch where the hull is loose — and it bounds the
        // stale-history damage to less than the hull's own inflation.
        s = min(s, shellIn + 0.06);
        tempStart = s;
      }
    }
  }
  // bodyEntry joins the fold as the FIFTH term (startT, shellIn, preStart,
  // tempStart, bodyEntry). The proxy box CONTAINS the hull contains the
  // flesh, so nothing of this body is nearer than the ray-box entry — the
  // same argument the accumulated-depth discard above already rests on. It is a lower bound
  // like every other term: in a crowd it is the tighter bound for a body
  // whose cone/coarse touch sits at the tile's FRONT surface, and it catches
  // the pixels whose temporal gate failed — those used to restart from the
  // shared shellIn and walk their own empty proxy space.
`;
/** Run 5 (plan 2026-09-13-neural-upscale-run5-sdf-refine): the walk alone — from `var t` to the
 *  line before `if (!hit) { discard; }`. REFINE_LOOP replaces exactly this section. */
export const MARCH_TRACE_LOOP = /* wgsl */ `  var t = clamp(max(max(max(max(startT, shellIn), preStart), tempStart), bodyEntry), 0.0, tMax);
  var hit = false;
  var prevRadius = 0.0;
  var stepLen = 0.0;
  var clamped = false;
  // Dominant prim at the last field sample (mapBody.y) — the hit pixel's
  // noise anchor reuses it instead of re-running the fold (task 6).
  var hitBest = -1;
  // The last field sample's full mapBody result (wound-r2 task 6). Re-assigned
  // every iteration exactly like hitBest/hitNearWound so it always describes
  // the sample the loop actually lands on; at the break it is therefore the
  // ACCEPTING sample, whose .w is the pre-wound field carved — depth
  // beneath the original skin, the tissue ramp's signal.
  var hitField = vec4<f32>(0.0);
  // Whether the ACCEPTED hit sample sat in a wound's near zone (mapBody.z).
  // Re-derived every iteration so it always describes the sample the loop
  // actually lands on — retractions and shell steps included. This is the
  // wound-shadow gate: firing iq's soft shadow march only for pixels inside
  // twice a wound's radius keeps its cost proportional to crater screen
  // area instead of screen size.
  var hitNearWound = false;
  for (var i = 0; i < 512; i = i + 1) {
    if (i >= steps) { break; }
    if (debugCfg.x > 0.5) { gDebugSteps = gDebugSteps + 1.0; }
    // 0.0, not marchCfg.z: the field mapBody returns stays SMOOTH — the fbm
    // still reaches the normal only via calcNormal — but inside a thin shell
    // of the surface the same fbm is added to the REAL stepped distance just
    // below, which is where the silhouette gets its bumps back without
    // paying fbm at every step of the empty approach.
    let dres = mapBody(camPos + rd * t, data, counts, counts2, vec4<f32>(0.0), woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, woundBound);
    let distort = max(gFoldBestDistort, 1.0);
    var d = dres.x;
    hitBest = i32(dres.y);
    hitField = dres;
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
    hitNearWound = nearWound;
    let radius = abs(d);
    let overshot = !conservative && !nearWound && omega > 1.0 && (radius + prevRadius) < stepLen;
    if (overshot) {
      // Undo the part of the last step that was not covered by the spheres,
      // and drop to plain sphere tracing for the rest of this ray. Skipped on
      // a displaced sample — the retraction rewinds by the omega excess,
      // which is only the real excess when stepLen was d times omega, and a
      // shell step was already under-relaxed at 0.6 so there is nothing to
      // take back.
      //
      // KNOWN WRONG, dead at the shipping default (relax 1.0) — do not "tidy"
      // this without the gates in the perf spec's retract-reconvergence lever.
      // The last step was d*omega; the excess over a conservative step is
      // d*(omega-1) == stepLen*(omega-1)/omega. This takes back
      // stepLen*(omega-1) instead — at omega 1.4, 0.56*d rather than 0.40*d,
      // a 40% OVER-retraction. It errs conservative (it lands short of the
      // safe point) so it cannot tunnel, but it burns steps and, combined
      // with the unbounded guard below, is half of why wounded rays fail to
      // reconverge. Correct form: stepLen = -stepLen * (omega - 1.0) / omega.
      stepLen = stepLen - omega * stepLen;
      omega = 1.0;
    } else {
      let hitEps = max(hitEpsBase, t * aaK / distort);
      // LAST-STEP SECANT ACCEPT (Claybook, Aaltonen GDC 2018 slide 25; off at
      // perfCfg.w == 0, bit-identical). A sphere trace converges on a
      // geometric series: at a fixed grazing angle each step shrinks d by the
      // same ratio, and the tail from d down to hitEps costs log(d/hitEps)
      // steps that all land on the same planar patch. Assume the surface IS
      // that plane through the last two samples (trilinear/analytic fields
      // are locally linear along the ray) and the remaining distance is the
      // secant root d * stepLen / (dPrev - d). When that root is within
      // perfCfg.w hit-epsilons, jump onto it and accept. The jump is NOT a
      // distance bound, so it fires only where the field is one: never on a
      // displaced (shell) or near-wound sample, only while approaching
      // (dPrev > d, so the ratio is < 1 and the series converges), and only
      // after a forward step (stepLen > 0 — a retraction's previous sample
      // was inside the solid). hitField/hitBest still describe the sample the
      // jump left, which is at most perfCfg.w * hitEps behind the accepted t
      // — the same tolerance the plain accept already grants.
      if (perfCfg.w > 0.0 && !conservative && !nearWound && stepLen > 0.0 && prevRadius > radius) {
        let root = radius * stepLen / (prevRadius - radius);
        if (root < hitEps * perfCfg.w) {
          t = t + root;
          hit = true;
          break;
        }
      }
      if (d < hitEps) {
        // wound-halo r2: an over-relaxed step can cross the skin with
        // radius + prevRadius == stepLen EXACTLY — a perpendicular approach
        // onto near-flat skin makes the sum an equality, not a strict <, so
        // the overshoot test above cannot see it — and the hit then registers
        // up to (omega-1)/omega of the last step INSIDE the solid. Behind the
        // wound grid that landing zone sits in the carve spheres' smax/smin
        // blend, whose gradient contaminates the shading normal: the torso's
        // far side lit up as a red/pale band at wound height (owner,
        // 2026-08-24; instrumented — band hits at z -0.17 vs skin -0.266,
        // normals sideways/up, wm ~ 0). Retract onto the surface and finish
        // the ray at omega 1; the hit is accepted once d is within hitEps.
        // The crossing sample usually sits inside the near-wound zone (the
        // landing is BEHIND the wound spheres even when the crossing is in
        // front of them), so nearWound is NOT a stop signal here — 0.6
        // stepping of the overstated fillet can cross too, and retracting to
        // the wall is strictly more correct than shading a point inside it.
        // Only shell-displaced samples keep the old contract (their retraction
        // assumes the smooth field).
        //
        // KNOWN UNSOUND, dead at the shipping default (relax 1.0). d here is a
        // SCALED-space distance: per the cull-soundness rule sdPrimitive
        // under-reports Euclid by the group's distortion factor (22x on the
        // schoolgirl sole plate), so stepping back by |d| is not guaranteed to
        // leave the solid, and nothing here bounds a retry or caps the
        // back-step to the interval actually travelled. This is the other half
        // of the wounded-ray non-reconvergence. Fixing it needs the packed
        // distortion factor threaded to this site — see the perf spec.
        if (d < -max(hitEpsBase, t * aaK / distort) && omega > 1.0 && !conservative) {
          stepLen = d;
          omega = 1.0;
        } else {
          hit = true;
          break;
        }
      } else {
        // TWO INDEPENDENT REASONS TO UNDER-RELAX, and the stricter one wins.
        // The shell's 0.6 pays for the fbm; the wound zone's own multiplier
        // pays for a field that is not a distance bound (WOUND_STEP_MUL).
        // They used to share the 0.6 literal, which is how the wound side
        // went unexamined for as long as it did — the shell's figure was
        // never measured against a crater.
        //
        // At WOUND_STEP_MUL 0.6 this is the old select() exactly, for every
        // omega the pages ship (all >= 0.6). It differs only BELOW 0.6, where
        // the old form LENGTHENED the step to 0.6 in the very zones that
        // wanted it shortest; min() keeps omega there instead.
        stepLen = d * min(select(omega, 0.6, conservative), select(omega, woundMul, nearWound));
        // CRAWL FLOOR (temporal start): graze rays near the surface step
        // sub-millimetre distances and burn 15-30 samples crossing the last
        // few cm (the gib-segment march cost of the holes fix). A 2 mm floor
        // bounds the crawl to ~window/2mm steps; the graze accept (1 cm) and
        // the eps accept still land hits that the floor steps across.
        stepLen = max(stepLen, select(0.0, 0.002, temporalCfg.x > 0.5));
      }
    }
    prevRadius = radius;
    t = t + stepLen;
    if (t > tMax) {
      // GRAZE ACCEPT (temporal start, 2026-09-10 night). The temporal start
      // re-phases the walk; at silhouette/graze pixels the acceptance window
      // before the exit is razor-thin, and the re-phased crawl (15-30 sub-mm
      // steps) crossed the exit with its last sample a few mm OFF the
      // surface and discarded: the stacked-corridor holes. radius here is
      // the LAST SAMPLE's field value; accept at the crossing when that is
      // within a HARD 1 cm — absolute, deliberately NOT scaled by the AA
      // epsilon (t * aaCfg.x = 2% of distance): the first version multiplied
      // the distance-scaled epsilon by 8 and the band grew to ~1.9 m at
      // 12 m, accepting hits in the air beside distant limbs — white
      // fresnel/spec lint over the whole body (owner report + screenshots,
      // 2026-09-10). 1 cm is sub-visible at every range and still covers
      // the 2-5 mm graze crawls. Scoped to the temporal start so
      // ?tstart=0 stays bit-identical.
      if (temporalCfg.x > 0.5 && radius < 0.01) {
        t = t - stepLen;
        hit = true;
        break;
      }
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
  // OCCUPANCY MODE (debugCfg.x == 4, 2026-08-31). Returns RAW COUNTERS
  // instead of a colour, and — the whole point — returns BEFORE the discard,
  // so pixels that missed still write. Channels:
  //   r = steps this ray took   g = 1 if it hit flesh, else 0
  //   b = 1 always (this fragment was rasterised and marched)
  //   a = t -- BUT DO NOT READ IT BACK AS A DISTANCE. createMarchMaterial's
  //     outputNode replaces alpha with CLIP-SPACE DEPTH, so a readback of
  //     this channel always lands in [0, 1]. (2026-09-01: that silently
  //     collapsed a whole "lost pixels by distance" histogram into the
  //     0-1 m bucket before it was caught.)
  //
  // ONE MORE BIAS, and it matters for the counts below: this returns BEFORE
  // the discard, so a MISSED ray still writes depth -- at the distance it
  // gave up, which for a near body's proxy box is nearer than a far body's
  // real hit. The missed fragment then wins the depth test and the readback
  // reports "no flesh" for a pixel the shipping render draws. Wherever proxy
  // boxes overlap, occupancy()'s hit counts are therefore a LOWER bound for
  // that reason too, on top of the overdraw one below.
  //
  // WHAT IT MEASURES, and what it does not. Summing over the target gives
  // hits/rasterised = the fraction of proxy-box screen area that actually
  // shows flesh. That is the shell march's addressable market: a bounded
  // hull never rasterises the rest. It is a LOWER BOUND on the waste,
  // because depth-testing means only the front-most body writes to a pixel —
  // where several bodies' boxes overlap, the real fragment-invocation count
  // is higher than this can see.
  //
  // Only ever read back; it does not composite to anything meaningful.
  if (debugCfg.x > 3.5 && debugCfg.x < 4.5) {
    return vec4<f32>(gDebugSteps, select(0.0, 1.0, hit), 1.0, t);
  }
  // BONE-EVAL MODE (debugCfg.x == 5, gore r3 refinement 3). Same contract as
  // occupancy above — raw counters, returned BEFORE the discard so missed
  // rays still write, alpha unusable. r = bone capsule evaluations this ray.
  // This is what the bone-fold cull must move; the timing bench could not
  // resolve the fold at all (+0.0% under a 4% spread), so the counter is the
  // measurement and the bench is only a sanity check.
  if (debugCfg.x > 4.5 && debugCfg.x < 5.5) {
    return vec4<f32>(gDebugBones, select(0.0, 1.0, hit), 1.0, t);
  }
  // VOLUME-EVAL MODE (debugCfg.x == 8): r = in-grid segment samples,
  // g = exact procedural fallbacks. Returned before discard so misses count.
  if (debugCfg.x > 7.5 && debugCfg.x < 8.5) {
    return vec4<f32>(gDebugVolumeSamples, gDebugVolumeFallbacks, select(0.0, 1.0, hit), t);
  }
`;
export const MARCH_TRACE_POST = /* wgsl */ `  if (!hit) { discard; }
  // FLAT-ALBEDO SEAM (close-up diagnostics task 1, 2026-09-04). Returns the
  // body's base albedo AT THE HIT and skips the entire post-hit chain —
  // calcNormal (4 field evals), the anchor, the micro-detail fbm, wound/char
  // masks, the tissue ramp, organ/mottle/gore/face albedo, the analytic
  // flashlight, spec/fresnel, the scatter and AO probes, the wound soft
  // shadow, the level shadow and the ambient compose. Nothing about the WALK
  // changes: the loop above ran to the same t with the same stepping, and
  // hitBest/hitNearWound/hitField were still maintained because the tracer
  // itself consumes them.
  //
  // debugCfg.y is the seam's gate because debugCfg.y was the one spare
  // channel on a uniform every march variant already binds — a new input in
  // MARCH_BODY's signature would have to be threaded through the entry
  // literal AND every variant literal in signature order (the meltCfg
  // incident), for a diagnostic that must stay inert. Default 0 = the
  // guarded return never fires and the fragment below is bit-identical to
  // the pre-seam shader; a test pins this file to exactly one debugCfg.y
  // occurrence, placed here.
  //
  // Precedence note: with debugCfg.x ALSO in a heatmap mode (1/2/3) the flat
  // return wins — those modes returned after shading, and this seam exists to
  // skip shading. Modes 4/5 (occupancy/bone counters) still win over it:
  // they return above, before the hit test.
  if (debugCfg.y > 0.5) { return vec4<f32>(baseColor, t); }
  // Snapshot the counters BEFORE the post-hit probes: calcNormal folds
  // four more mapBody calls and the wound shadow up to fourteen, and the
  // heatmap is about RAY cost, not shading cost.
  let debugSteps = gDebugSteps;
  let debugPrims = gDebugPrims;

  let p = camPos + rd * t;
  // PER-PRIMITIVE MATERIAL READ — hoisted above the noise (hard-surface
  // task 1). gloss must be known BEFORE the shading normal exists: both
  // flesh-noise paths below scale by (1 - gloss), because a polished prim
  // has no pores. This is the SAME single texel the per-prim colour block
  // below used to read (hitBest row, ROW_PRIM_COLOR) — hoisted, not
  // repeated, so no hit pixel pays for it twice. hitBest is -1 on the
  // baked-volume path; there gloss stays 0 and every noise term runs at
  // full flesh amplitude exactly as before.
  // METAL (task 2) rides the same hoist: prof bit 4 (16), read off
  // ROW_PRIM_SHAPE only inside the painted branch (metal is parse-gated on
  // color=, so an unpainted pixel can never change the answer — one extra
  // texel load on painted hit pixels only). metal implies the same noise
  // suppression with no gloss set: a machined surface has no pores either,
  // so both sites below take (1 - max(gloss, metal)).
  var gloss = 0.0;
  var painted = 0.0;
  var metal = 0.0;
  var primGlow = 0.0;
  var primAlbedo = vec3<f32>(0.0);
  if (hitBest >= 0) {
    let PC = textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_COLOR}), 0);
    if (PC.w > 0.0) {
      primAlbedo = PC.xyz;
      gloss = clamp(PC.w - 1.0, 0.0, 1.0);
      painted = 1.0;
      let PS = textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_SHAPE}), 0);
      if ((i32(PS.y) & 16) != 0) { metal = 1.0; }
      // GLOW (hard-surface task 3): primClip.w, the lane that was documented
      // spare until now. Loaded ONLY inside the painted branch — glow is
      // parse-gated on color=, so an unpainted pixel can never author one,
      // and this is the third texel a painted hit pixel pays for (colour,
      // shape, clip) and the last.
      primGlow = clamp(textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_CLIP}), 0).w, 0.0, 1.0);
    }
  }
  // Silhouette noise into the normal, scaled by (1 - max(gloss, metal)) at
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
  let anchor = restPoint(p, data, hitBest, noiseLocal(p, noiseShift));
  var n = vec3<f32>(0.0);
  var ngValid = false;
  var ngReason = 7;
  var ngScalar = 0.0;
  if (normalGradientCfg.x > 0.5) {
    let noiseAmplitude = marchCfg.z * (1.0 - max(gloss, metal));
    let ng = ngBody(p, data, counts, counts2, vec4<f32>(noiseAmplitude, 0.0, 0.0, 0.0), woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, perfCfg, woundBound);
    ngReason = gNgReason;
    ngScalar = ng.x;
    if (ngReason == 0) {
      let candidate = ng.yzw + ngDetail(p, data, gNgOwner, noiseShift, noiseAmplitude);
      let magnitude2 = dot(candidate, candidate);
      // Comparisons reject NaN and infinity as well as a collapsed gradient.
      ngValid = magnitude2 > 1e-12 && magnitude2 < 1e12;
      if (ngValid) { n = normalize(candidate); } else { ngReason = 2; }
    }
  }
  if (!ngValid) {
    n = calcNormal(p, data, counts, counts2, vec4<f32>(marchCfg.z * (1.0 - max(gloss, metal)), 0.0, 0.0, 0.0), woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, woundBound);
  }
  // Raw diagnostic RGB bypasses later detail/shading; outputNode still writes
  // the identical clip depth. Eligibility 0 is background, 1 is analytic.
  if (normalGradientCfg.y > 1.5) {
    return vec4<f32>(f32(ngReason + 1), select(0.0, ngScalar - hitField.x, ngValid), f32(hitBest), t);
  }
  if (normalGradientCfg.y > 0.5) { return vec4<f32>(n * 0.5 + 0.5, t); }
  gWoundShadePrim = select(-1.0, f32(hitBest), hitBest >= 0 && hitBest < i32(counts.x));
  let wmBoth = woundMask(p, n, data, woundCfg, woundCfg2);
  let wm = wmBoth.x;      // colouring / wet / cavity shading
  let wmRim = wmBoth.y;   // fresnel fade, covers the lip
  let wmCav = wmBoth.z;   // cavity-ness: only wounds whose flags row opened one
  let cm = charMask(p, data, woundCfg);
  let detailAmp = surfCfg2.y * (1.0 - max(gloss, metal));
  // Run 4: hand the anchor + gate to the output-res detail pass (MARCH_ANCHOR_READ).
  gMarchAnchor = vec4<f32>(anchor, detailAmp);
  if (detailAmp > 0.0) {
    let detailNoise = vec3<f32>(
      fbm(anchor * 22.0), fbm(anchor * 22.0 + 5.0), fbm(anchor * 22.0 + 11.0));
    // Reuse the existing samples: Soldier wounds amplify their response into
    // shallow pits without another noise call or global change.
    let soldierPit = faceGlowRedOnly * smoothstep(0.08, 0.72, wm);
    n = normalize(n + detailNoise * detailAmp * mix(1.0, 1.45, soldierPit));
  }
  // Tissue depth rides mapBody's .w (the PRE-wound field). The ramp chooses
  // WHICH colour the wounded end of the lerp reaches for; wm remains the
  // sole authority on WHETHER this pixel is wounded. That composition is what
  // makes the ramp halo-safe by construction: at wm = 0 nothing it computes
  // can reach the albedo, so it has no edge to disagree with the mask's.
  //
  // surfCfg3 = (woundDepthAmp, fatDepth, muscleDepth, visceraAmp); the
  // select is the amplitude gate — woundDepthAmp 0 shades bit-for-bit as
  // before the ramp existed.
  //
  // Do NOT refactor this into a second mask. The 2026-08-23 crater pass split
  // one mask into three and cost two days to the resulting halo; the note above
  // WOUND_MASK is the record.
  let tissueDepth = max(0.0, -hitField.w) * surfCfg3.x;
  // Viscera (entrails): low-frequency fbm over the rest-space anchor lumps
  // the cavity colour so it reads as organs and not as noise. Lumped only
  // where it can be SEEN: inside a cavity wound, with the stop enabled. The
  // amplitude guard has to wrap the fbm, not just its result — guarding the
  // result leaves the cost on every pixel, which is the mistake that cost
  // the torn-fibre pass its life. 0 leaves the ramp shading bit-for-bit as
  // before entrails.
  var viscera = visceraColor;
  if (surfCfg3.w > 0.0 && wmCav > 0.0) {
    let lump = fbm(anchor * 2.5) * 0.5 + 0.5;
    viscera = visceraColor * mix(0.75, 1.25, lump);
  }
  let tissue = select(deepColor,
    tissueRamp(tissueDepth, baseColor, fatColor, deepColor, surfCfg3.y, surfCfg3.z,
      wmCav * surfCfg3.w, viscera, visceraDepth),
    surfCfg3.x > 0.0);
  var albedo = mix(baseColor, tissue, wm);

  // NO TORN-FIBRE PASS. It shipped in wound pass r2 and was CUT on the
  // owner's playtest verdict (2026-09-02): "rather subtle... just seems to
  // make the texture a little different but not really noticeable or that
  // visibly different from default", judged with the panel slider swept to
  // its ceiling. An fbm per wound-interior pixel that nobody can see is
  // cost without a look, so it is gone rather than defaulted to 0 — a dead
  // knob invites someone to turn it back on and re-litigate this.
  // surfCfg3.w is consequently SPARE; the row map above says so.

  // Inside-flesh material (organs r3). The dominant prim carries the
  // material code in primScale.w — W_ORGAN is 5, and only applyBones can
  // claim bestIdx for an inside-flesh row because foldGroup and applyCarves
  // skip the range entirely — so this is an identity read, not a guess from
  // depth or radius. (Bone tubes: op 'bone' prims no longer reach the field
  // when packBones is off — the bone ALBEDO branch this used to feed is
  // deleted with them; a packed bone row still wins the fold identically
  // under the default packBones-on layout, it just shades as plain meat.)
  // hitBest is -1 on the baked-volume path (no dominant prim), so clamp the
  // row index and gate on it, like the painted-prim read below. Gated on wm
  // (gore r3 refinement 5): an inside-flesh prim can only ever be dominant
  // INSIDE a wound — applyBones runs only where nearWound is set — so on an
  // unwounded pixel this texel load can never change the answer. It ran on
  // every hit pixel of every body before the gate.
  var hitMat = 0.0;
  // The melt reads this too (meltCfg.x > 0): the skeleton EMERGES through
  // thinning flesh with no wound anywhere near it (the bareBones bypass), so
  // the wm gate alone would leave an exposed bone unidentified and it would
  // shade as meat — the exact pale-vs-red contrast the melt lives on lost.
  if ((wm > 0.0 || meltCfg.x > 0.0) && hitBest >= 0) {
    hitMat = textureLoad(data, vec2<i32>(hitBest, ${ROW_PRIM_SCALE}), 0).w;
  }
  let isOrgan = hitMat > 4.5 && hitMat < 5.5;
  // W_BONE is 4 — the dominant row is a packed bone prim (bones still fold
  // under the default packBones-on layout). Only consulted by the melt ramp.
  let isBone = hitMat > 3.5 && hitMat < 4.5;
  if (isOrgan) {
    // Pale, wet, and NOT stained toward the meat: viscera is already wet
    // and already the same family of colour as the flesh around it. organAmp
    // 0 leaves albedo untouched, which is the off-state.
    albedo = mix(albedo, organColor, organAmp);
  }

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
    let uv0 = raw * faceProj.xy + faceProj.zw;
    // Melt drips the face off the skull (task 8): sag drags features DOWN
    // (see the FACE_MELT_SAG comment at the constants for why positive is
    // down), the stretch elongates them as they go. The offset alone would
    // slide a rigid face downward like a sticker.
    let meltSag = meltCfg.x;
    var uv = uv0;
    uv.y = uv0.y + meltSag * ${FACE_MELT_SAG} - (uv0.y - faceProj.w) * meltSag * ${FACE_MELT_STRETCH};
    // Fade by how squarely this surface faces the front, so the projection does
    // not smear a second face down the sides and back of the skull. A planar
    // projection derives uv from x/y alone, so as the surface turns away it
    // repeats the same uv column and STREAKS; fading out well before edge-on
    // hides that.
    // The facing axis is the head's rotated forward, not world +z.
    // The lower bound widens toward FACE_MELT_FADE_LO as the melt flattens
    // the head: a squashed skull's surface turns away from the forward axis
    // far sooner than a round one's, and the un-widened cutoff faded the
    // face out before it had finished dripping.
    let hfw = vec3<f32>(0.0, 0.0, forward);
    let hfr = hfw + 2.0 * cross(headQuat.xyz, cross(headQuat.xyz, hfw) + headQuat.w * hfw);
    var facing = smoothstep(mix(0.28, ${FACE_MELT_FADE_LO}, meltCfg.x), 0.66, dot(n, hfr));
    // Confine it to the HEAD. Generous, because the surface now sits at
    // |hs| ~= 1 everywhere and the jaw hangs past that: this is only a backstop
    // against wrapping onto the neck.
    // A DECAL (faceCfg.x == 2) gets half again the reach: hs is normalised by
    // the FATTEST head prim, which on a character with hair is the crown
    // shell, centred well above the face -- the schoolgirl's mouth sat at
    // |hs| 1.55 and faded out at every projection setting. The decal's own
    // alpha and the facing fade bound it instead.
    // FACE MODE, faceCfg.x: 1 = sheet (MULTIPLY the rgb), 2 = decal (REPLACE
    // the albedo), 3 = LUMA multiply. Mode 3 exists because multiplying two
    // COLOURED values compounds their hue -- a skin-toned bake times skin-toned
    // flesh reads more saturated than either, which the owner spotted as the
    // face looking "more saturated from the surrounding skin". Using the
    // decal's LUMINANCE as a scalar modulates brightness and leaves hue alone.
    // Modes 1 and 2 are untouched and bit-identical.
    let decal = select(0.0, 1.0, abs(faceCfg.x - 2.0) < 0.5);
    let lumaOnly = abs(faceCfg.x - 3.0) < 0.5;
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
      // a PSX face was painted onto a head. No luma glow -- a photo is bright in
      // many places that are not eyes -- and no relief, because its luminance
      // edges (hairline, lips) are colour changes, not height.
      faceGlow = smoothstep(faceCfg2.z, 1.0, dot(tex.rgb, W)) * facing * tex.a * (1.0 - decal);
      // Opt-in painted red eyes: brightness alone would select skin/teeth.
      // Red dominance rejects those, and the brightness gate rejects dark
      // reddish hair/mouth pixels. This mask works with Replace albedo too.
      if (faceGlowRedOnly > 0.5) {
        let redDominance = (tex.r - max(tex.g, tex.b)) / max(tex.r, 0.001);
        let redMask = smoothstep(min(faceCfg2.z, 0.999), 1.0, redDominance)
                    * smoothstep(0.35, 0.70, tex.r);
        faceGlow = redMask * facing * tex.a * clamp(faceCfg.y, 0.0, 1.0)
                 * clamp(faceCfg2.w, 0.0, 1.0);
      }

      // Otherwise a MULTIPLIER, not a replacement: the generated sheet carries
      // baked lighting, so pasting it in as albedo and lighting it again
      // double-shades. Dividing by its measured mean keeps the pattern and
      // throws away level.
      // Luma mode divides by the same mean, so an average texel still
      // multiplies by ~1 and the level is unchanged -- only the hue shift goes.
      let detailSrc = select(tex.rgb, vec3<f32>(dot(tex.rgb, W)), lumaOnly);
      let detail = detailSrc / max(faceCfg2.y, 1e-3);
      // Skip the multiply where it glows: an eye is not tinted flesh, and the
      // emissive term below supplies its colour outright.
      // Soldier uses the otherwise unique red-only face flag. Its Replace
      // decal must yield to the wound mask or it paints pale forehead pixels
      // back over the tissue ramp after the crater was shaded.
      let woundDecalFade = 1.0 - faceGlowRedOnly * smoothstep(0.02, 0.25, wm);
      albedo = mix(albedo, mix(albedo * detail, tex.rgb, decal),
                   facing * tex.a * faceCfg.y * (1.0 - faceGlow) * woundDecalFade);
      // Keep only the decal's dark facial structure over damaged Soldier
      // tissue. This restores sockets/nose/mouth contrast without pasting its
      // intact skin colour back onto the red wound.
      let damagedFace = faceGlowRedOnly * smoothstep(0.02, 0.62, wm) * facing * tex.a;
      let faceShadow = clamp(1.0 - dot(tex.rgb, W) / max(faceCfg2.y, 1e-3), 0.0, 1.0);
      albedo = albedo * (1.0 - faceShadow * damagedFace * 0.78);

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

  // Soldier-only wet blood stain. This uses the existing character flag and
  // the one authoritative wound mask, so it affects head and torso lips while
  // leaving Zombie, panel overrides, carve depth and gameplay untouched.
  let soldierWound = faceGlowRedOnly * smoothstep(0.02, 0.62, wm);
  var gooRed = mix(vec3<f32>(0.52, 0.006, 0.009), vec3<f32>(0.16, 0.001, 0.003), smoothstep(surfCfg3.y, surfCfg3.z * 2.2, tissueDepth));
  // MEAT DETAIL (owner 2026-09-12: the revealed flesh "reads as a smooth blobby red"). The stain
  // above was ONE colour ramp; this breaks it into flesh. Everything keys off anchor (rest space,
  // so nothing swims) and is gated on soldierWound > 0 so unwounded pixels pay nothing — the fbm
  // must sit inside the gate, not just its result (the torn-fibre lesson). Deliberately STRONG:
  // the r2 torn-fibre pass was cut as "rather subtle" at its ceiling; a wound has to read at
  // 400x300 through the upscaler, which averages fine detail away.
  //   clot     high-frequency speckle: sparse near-black clots in the arterial red
  //   fibre    striation along the rest-space Y axis, muscle only (deeper tissue)
  //   crevice  darkening where the carve is deepest (tissueDepth) — the wound reads recessed
  //   glint    a second noise that BREAKS the wet highlight into glints (applied in SURFACE_PREP)
  // meatCfg (wound panel, MEAT group): x amp (0 = the old flat stain), y clot strength, z glint
  // range, w crevice darkening. All 1 = the shipped look.
  let meatAmp = meatCfg.x;
  var woundGlint = 1.0;
  if (soldierWound > 0.0 && meatAmp > 0.0) {
    let muscle = smoothstep(surfCfg3.y, surfCfg3.z * 2.2, tissueDepth);
    let crevice = smoothstep(surfCfg3.z, surfCfg3.z * 3.0, tissueDepth);
    let clot = fbm(anchor * 38.0) * 0.5 + 0.5;
    let clotDark = clamp(smoothstep(0.45, 0.75, clot) * meatAmp * meatCfg.y, 0.0, 1.0);
    let fibre = (fbm(anchor * vec3<f32>(9.0, 64.0, 9.0)) * 0.5 + 0.5) * meatAmp;
    let glintN = fbm(anchor * 57.0 + 3.0) * 0.5 + 0.5;
    // Arterial glaze on the lip (brighter, redder), clotted and striated further in.
    gooRed = gooRed + vec3<f32>(0.16, 0.006, 0.006) * (1.0 - muscle) * (1.0 - clot) * meatAmp;
    gooRed = gooRed * mix(1.0, 0.18, clotDark);
    gooRed = gooRed * mix(1.0, mix(0.55, 1.45, fibre), muscle);
    gooRed = gooRed * (1.0 - clamp(crevice * 0.65 * meatAmp * meatCfg.w, 0.0, 0.95));
    // Wet highlight shattered into glints: 0.25..2.1 of the wound wetness by a fine noise (owner:
    // overdo it), and dull on clots. (specPow itself is pinned to one shared definition, so the
    // tight-vs-broad difference is carried by wetness alone.)
    woundGlint = mix(1.0, mix(1.0 - 0.75 * meatCfg.z, 1.0 + 1.1 * meatCfg.z, smoothstep(0.35, 0.72, glintN)) * mix(1.0, 0.35, clotDark), meatAmp);
  }
  albedo = mix(albedo, gooRed, soldierWound * 0.72);

  // PER-PRIMITIVE COLOUR. The fold already reports the nearest primitive at
  // the hit (hitBest, the noise anchor); a painted one replaces the flesh
  // albedo outright, mottle and face sheet included — a lens is not tinted
  // skin. The gloss/painted VALUES were resolved — and the row read, once —
  // up above calcNormal, where the noise suppression needs them; the
  // OVERWRITE itself stays HERE, after the face pass, because a painted
  // prim replaces everything the flesh passes laid down. Char still wins
  // below, because burnt is burnt.
  //
  // GLOW PRECEDENCE (hard-surface task 3): the eye-glow kill two lines down
  // applies to the FACE glow only — the baked sheet's own emission, which is
  // zeroed on paint for the same reason the sheet is: the painted eyes sit
  // exactly where a pair of sunglasses goes, and they must not shine through
  // the lenses. Per-prim glow (primGlow, primClip.w) is AUTHORED emission on
  // the prim itself, packed per prim, and deliberately SURVIVES this kill:
  // the whole point of glow= is a prim that emits — the minotaur's red eyes
  // — and those prims are painted (glow= is parse-gated on color=). The face
  // sheet under a painted prim contributes exactly what it always did here
  // (zero); the prim's own authored emission is a separate additive term at
  // the composite. Nothing in that kill reads primGlow, so the sunglasses
  // rule is intact BY CONSTRUCTION, not by a second kill that could drift.
  if (painted > 0.0) {
    albedo = primAlbedo;
  }
  faceGlow = faceGlow * (1.0 - painted);

  albedo = mix(albedo, charColor, cm);

  // MELT (2026-09-03, task 6) — the wet red, on flesh ONLY.
  //
  // The colour LEADS the sag: the reference goes red while the body is still
  // standing, before any height is visibly lost, so the ramp runs on
  // smoothstep(clamp(meltCfg.x * 2)) and is essentially complete by half
  // progress. That is the frame that reads as "melt" rather than "fall".
  //
  // A dominant BONE row does the opposite: it goes PALE (boneColor, the
  // wound pass's exposed-bone colour) and stays matte — the wetness boost
  // below skips it. Pale matte bones sitting in wet red goo is the contrast
  // this effect lives on, and before this branch a bone row winning the fold
  // shaded as plain meat (the old bone-albedo branch was deleted with the
  // bone-tubes pack flag), which would have reddened the very skeleton the
  // melt exists to reveal.
  //
  // meltCfg.x is 0 everywhere except a melting body and its released bone
  // chunks, so every other pixel shades bit-identical to before this existed.
  let meltU = smoothstep(0.0, 1.0, clamp(meltCfg.x * 2.0, 0.0, 1.0));
  if (meltU > 0.0) {
    if (isBone) {
      albedo = mix(albedo, boneColor, meltU * 0.9);
    } else {
      // Patchy, not uniform: skin sloughs in pieces. Each point crosses over
      // at its OWN progress, read off the rest-space anchor, and the patches
      // scaled past 1.0 by MELT_SKIN_KEEP never cross at all — so pink skin
      // survives in the finished puddle instead of everything staining red
      // together. See the constants for the owner's brief.
      // NB 'patch' is a RESERVED KEYWORD in WGSL — naming this variable that
      // compiles fine in TypeScript and fails the shader at runtime, which
      // renders the body invisible rather than erroring anywhere a test looks.
      let skinPatch = clamp(fbm(anchor * ${MELT_SKIN_PATCH_FREQ}) * ${MELT_SKIN_CONTRAST} * 0.5 + 0.5, 0.0, 1.0);
      let thresh = skinPatch * ${MELT_SKIN_KEEP};
      let local = smoothstep(thresh - ${MELT_SKIN_PATCH_SOFT}, thresh + ${MELT_SKIN_PATCH_SOFT}, meltU);
      albedo = mix(albedo, deepColor * 0.8, local * 0.8);
    }
  }
`;
export const MARCH_BODY_TRACE = `${MARCH_TRACE_SETUP}${MARCH_TRACE_LOOP}${MARCH_TRACE_POST}`;

/**
 * SECTION 3 of 4 — SURFACE PREP: the light-independent material terms the
 * deferred surface output needs, hoisted ABOVE the analytic flashlight
 * (hybrid deferred M1 task 2). The wet block and the glow term are verbatim
 * moves from the lighting tail; specPow is the legacy shine exponent given a
 * name. Nothing here reads L/keyC/keyI, H, or any light uniform, so the
 * legacy expansion's arithmetic is unchanged by the move.
 */
export const MARCH_BODY_SURFACE_PREP = /* wgsl */ `
  // Wounds are wetter than the surrounding skin; char is dead matte. Gore
  // rides the same boost: bloody chunk regions glisten like open wounds.
  // gloss pulls a painted surface toward a tight, fully wet highlight
  // whatever the flesh preset says: a lens on a matte clay character still
  // has to glint.
  //
  // Wound pass r2: wetness peaks at the fat/muscle boundary — the lip
  // glistens, the floor does not — instead of wetting the whole crater
  // uniformly. At woundDepthAmp 0 tissueDepth is 0, so lip is 1 and
  // wetWound is exactly the old max(wm, gore): the amp-0 guarantee survives
  // this line. Bone is matte — wet skin reflects, wet bone just looks
  // polished.
  let lip = 1.0 - smoothstep(surfCfg3.z, surfCfg3.z * 3.0, tissueDepth);
  let wetWound = max(wm * lip, gore);
  let woundWetBoost = mix(1.6, 2.15, faceGlowRedOnly);
  var wet = mix(surfCfg2.x * mix(1.0, woundWetBoost, wetWound) * (1.0 - cm) * select(1.0, 1.8, isOrgan), 1.0, gloss);
  // Melt wetness (task 6): liquefying flesh goes FULLY wet — the puddle
  // glistens. FLESH ONLY: bone stays matte (the anchor comment above — wet
  // skin reflects, wet bone just looks polished), and that matte-vs-wet
  // contrast is what makes pale bones read inside the red puddle.
  // 1.6, the wound-wetness precedent: 2.2 was the first guess and the
  // near-level capture showed the whole grazing-angle puddle clipping to
  // paper white — wet, yes; blown out, no.
  if (meltU > 0.0) {
    wet = mix(wet, select(1.6, 0.45, isBone), meltU);
  }
  // The legacy shine exponent, named so the lighting tail and the deferred
  // surface output share one definition: the surface's roughness inverts the
  // shared light pass's exponent mapping against exactly this value.
  let specPow = mix(mix(128.0, 4.0, surfCfg.y), 220.0, gloss);

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
           * flicker(faceCfg3.y, faceCfg3.x) * (1.0 - cm)
           // PER-PRIM GLOW (hard-surface task 3): the same two lines keyed
           // off the prim row instead of the face texture. The colour is the
           // prim's OWN albedo (design C — a prim with color=ff2200 glow=0.9
           // glows red because it IS red), the strength is the authored
           // 0..1 from primClip.w. No faceCfg2.w global (the authored value
           // IS the strength) and no flicker (that is the face sheet's
           // heartbeat). Char kills it exactly as it kills the face glow:
           // burnt is burnt.
           + primAlbedo * primGlow * (1.0 - cm);
`;

/**
 * SECTION 4 of 4 — the legacy lighting tail: analytic flashlight, spec/
 * fresnel, scatter/AO probes, wound and level shadows, ambient bounce, the
 * fleshLit compose, the display conversion and the debug heatmaps. None of
 * this exists in the deferred surface entry.
 */
/**
 * NEURAL UPSCALE RUNTIME NORMALS (plan docs/superpowers/plans/2026-09-12-neural-upscale-runtime-normals.md).
 * The lit march leaves its final shading normal (WORLD space, unit, after the face bump — the
 * same `n` the capture's debug mode 9 returns) in a module-scope private, and this read fn hands
 * it to a renderer-level MRT as a second colour attachment. The private-global pattern is
 * deferred-sdf.ts's SDF_SURFACE_STATE: the declaration trails the fn because wgslFn's parser is
 * ^fn-anchored, and a read fn taking the march result as `dep` orders the read after the write.
 * ONE node must carry this source for every chain that includes MARCH_BODY (zombie-gpu.ts
 * `marchNormalRead` seeds buildMarchFn's chain) — a second wgslFn of the same text would
 * redeclare the var and fail every pipeline.
 */
export const MARCH_NORMAL_OUT = /* wgsl */ `fn readMarchNormal(dep: vec4<f32>) -> vec4<f32> {
  return gMarchNormal;
}
var<private> gMarchNormal: vec4<f32>;
var<private> gMarchAnchor: vec4<f32>;
`;

/** Run 4 (plan 2026-09-12-neural-upscale-run4-relief): the rest-space noise anchor of the hit
 *  (xyz) and the skin-detail gate detailAmp (w), for the output-resolution detail pass. Reads the
 *  private declared in MARCH_NORMAL_OUT — include that node, never redeclare the var. */
export const MARCH_ANCHOR_READ = /* wgsl */ `fn readMarchAnchor(dep: vec4<f32>) -> vec4<f32> {
  return gMarchAnchor;
}`;

export const MARCH_BODY_LIGHT = /* wgsl */ `  // Runtime normal out (MARCH_NORMAL_OUT): world-space unit n, before any early return below.
  gMarchNormal = vec4<f32>(normalize(n), 1.0);
  // NORMAL-OUTPUT MODE (debugCfg.x == 9, neural upscale normals capture,
  // 2026-09-12). The final shading normal (after the face bump) in WORLD space,
  // depth in alpha exactly as the lit output, so the same readback and crop
  // apply. Read-back only, like the counters above; the capture script
  // (scripts/upscale-capture-v2.mjs) rotates it into view space. The runtime
  // stage gets normals from an MRT attachment later — this mode is the
  // TRAINING-side source and must compute the same n the lit path shades with.
  if (debugCfg.x > 8.5 && debugCfg.x < 9.5) {
    return vec4<f32>(normalize(n), t);
  }
  // ---- ANALYTIC FLASHLIGHT ----------------------------------------------
  // The world's SpotLight is invisible to the march — SDF bodies are shaded
  // here, not by three — so the beam is re-evaluated analytically per pixel.
  //
  // PER-PIXEL, not per-body, so the cone edge cuts ACROSS a figure instead of
  // the whole zombie popping on at once.
  //
  // ZERO field taps: a normalise, two dots and a divide. This is the
  // constraint that let character self-shadowing be cut rather than paid for.
  //
  // It drives L and keyColor — NOT albedo. ambientAt renormalises bounce to
  // unit luminance, so an albedo boost would change hue and leave brightness
  // untouched. Brightness must ride the key.
  var L = normalize(lightDir);
  var keyC = keyColor;
  var keyI = lightCfg.x;
  var beamAmt = 0.0;
  if (spotCfg.x > 0.0) {
    let toLamp = spotPos - p;
    let dist = length(toLamp);
    let Ls = toLamp / max(dist, 1e-4);
    let cone = dot(-Ls, normalize(spotAxis));
    let coneFall = clamp((cone - spotCfg.z) / max(spotCfg.y - spotCfg.z, 1e-4), 0.0, 1.0);
    let distFall = clamp(1.0 - dist / max(spotCfg.w, 1e-4), 0.0, 1.0);
    let beam = coneFall * coneFall * distFall * distFall * spotCfg.x;
    // Blend the key TOWARD the beam. At beam 0 this is exactly the old key,
    // which keeps the lab and every existing preset bit-identical.
    L = normalize(mix(L, Ls, clamp(beam, 0.0, 1.0)));
    keyC = mix(keyColor, spotColor, clamp(beam, 0.0, 1.0));
    // spotCfg2.x is the beam's KEY GAIN, a live knob. The 2.2 it replaces
    // blew a lit body clean past 1.0 on every channel, and a clipped
    // body has no wound in it: crater, lip and char all saturate to the
    // same white. See the shoulder below.
    // THE BEAM IS THE KEY, NOT A BONUS ON TOP OF IT (spotCfg2.z).
    //
    // This used to be lightCfg.x + beam*gain, which left the preset's own key
    // — 2.4 for practical-hard-key — burning at full strength from a fixed
    // direction that nothing could switch off. So a character standing in an
    // unlit corridor was still brightly lit from nowhere (owner, 2026-09-01:
    // "the unlit characters seem still to be lit ... bright in the darkness
    // without light"). In a dungeon the lamp you carry has to be the reason a
    // body is visible.
    //
    // spotCfg2.z is what survives of the preset key when the beam is off: a
    // floor, not a fill. It is NOT zero on purpose — ambientAt carries hue
    // rather than brightness (bounce is renormalised to unit luminance), so a
    // character lit by nothing but bounce has no level at all and disappears
    // completely rather than reading as a shape in the dark.
    keyI = lightCfg.x * spotCfg2.z + beam * spotCfg2.x;
    beamAmt = beam;
  }
  // ---- END ANALYTIC FLASHLIGHT --------------------------------------------
  let V = -rd;
  let H = normalize(L + V);
  let diff = max(dot(n, L), 0.0);

  // wet, specPow and glow now live ABOVE the flashlight in
  // MARCH_BODY_SURFACE_PREP (the task-2 section split — see its header).
  // shine's exponent IS specPow, the legacy inline mix given a name; the
  // arithmetic is unchanged.
  let shine = pow(max(dot(n, H), 0.0), specPow);
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
    let thin = clamp(mapBody(p + L * 0.06, data, counts, counts2, noiseCfg, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, woundBound).x * -8.0, 0.0, 1.0);
    scatter = deepColor * thin * surfCfg.w * (1.0 - cm);
  }

  // Cheap AO from the field, so creases and the insides of joints stay dark.
  // Without it a limb dissolves into the torso visually even when the geometry
  // is correctly separated — so this is a LOD lever, not a free win: it is the
  // one guarded by an explicit flag rather than by its own amplitude, because
  // there is no "AO strength" to turn down.
  var ao = 1.0;
  if (lodCfg.x > 0.5) {
    ao = clamp(mapBody(p + n * 0.06, data, counts, counts2, noiseCfg, woundCfg, woundCfg2, noiseShift, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, woundBound).x / 0.06, 0.35, 1.0);
  }
  // NO wound-keyed AO darkening, NO analytic key gate, NO spec occlusion —
  // deliberately (owner bisect A/B, 2026-08-24). All three were 2026-08-23/24
  // attempts to mask wound-adjacent brightness, and each carried its own
  // radial or gated edge onto the skin around the crater; the owner judged
  // the plain 2026-08-22 lighting decisively better in motion. The real
  // fixes for what they chased are structural: the tracer retract (rays no
  // longer land inside the body and shade garbage) and the soft shadow below.

  // WOUND SOFT SHADOW — the cast shadow the crater was missing: the wall
  // nearest the key shadowing the floor under it, soft-edged (owner call,
  // "cast shadow vs darker floor" — the shadow won). Gated on hitNearWound:
  // outside the wound zones shadow stays exactly 1.0 and the whole thing
  // costs nothing. Strength mixes toward 1 so the slider scales the effect,
  // never inverts it. Applied to the KEY diffuse and key specular ONLY —
  // fill, ambient and scatter stay untouched or craters go pitch black.
  var wShadow = 1.0;
  if (woundShadowCfg.x > 0.0 && hitNearWound) {
    wShadow = mix(1.0, woundShadow(p, L, abs(woundShadowCfg.y), data, counts, counts2, woundCfg, woundCfg2, volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, woundBound), woundShadowCfg.x);
  }

  // LEVEL SHADOW (perf round 2 task 7). One texture load per hit pixel, ZERO
  // extra field evaluations: the lookup is a projection + 4 depth loads
  // against the twin light's level-only map. At cfg.x = 0 it returns 1.0
  // before touching the texture — the whole feature is inert in the lab and
  // until the game page's seam turns it on. Applied to the KEY diffuse and
  // key specular ONLY — the same discipline as wShadow above: ambient, fill
  // and scatter stay untouched or a shadowed body goes pitch black.
  let lvl = levelShadow(p, n, levelShadowTex, levelShadowMatrix, levelShadowCfg);

  // ENVIRONMENT BOUNCE (lighting P1). Replaces the flat scalar fill with a
  // chromatic ambient derived analytically from the enclosure's six walls.
  //
  // At bounceCfg.x == 0 this returns exactly lightCfg.y * keyColor, which
  // makes the two expressions below algebraically identical to what they
  // were before bounce existed — the parity guarantee the spike rests on,
  // and the reason every preset ships with probeWeight 0.
  //
  // ZERO extra mapBody evaluations: ambientAt is dot products and distance
  // falloff, gated by a test that greps its source for field calls. The
  // post-hit eval budget is unchanged.
  var amb = ambientAt(p, n, boxMin, boxMax, wallNegX, wallPosX, wallNegY, wallPosY, wallNegZ, wallPosZ, bounceCfg, lightCfg.y, keyColor);
  // STATIC PROBE GRID (lighting P3 step 1, lab spike). Replaces the analytic
  // six-wall ambient with irradiance read from a probe grid gathered once on
  // the CPU against the same enclosure — directional, with real level
  // instead of the hue-only P1 tint. probeCfg.x = 0 skips the branch and
  // leaves amb exactly what ambientAt returned - the parity guarantee. Zero
  // field evaluations: three textureLoads per probe, eight probes.
  if (probeCfg.x > 0.0) {
    amb = mix(amb, probeIrradiance(p, n, probeTex, probeMin, probeInvExtent, probeDims) * probeCfg.y, probeCfg.x);
  }
  // FLASHLIGHT BOUNCE SPOT (lighting P4 step 1). The beam's lit patch on the
  // level, found on the CPU each frame, added as one analytic disc light so
  // a body between the lamp and the wall is lit from behind by the glow.
  // The gain gate lives inside the function - at bounceSpotCfg.x = 0 it
  // returns zero and amb is untouched. No field evaluations.
  amb = amb + bounceSpotIrradiance(p, n, bounceSpotPos, bounceSpotNormal, bounceSpotRadiance, bounceSpotCfg);
  // GPU PROBE GATHER dynamic layer. Body VISIBILITY darkens the ambient a
  // body sits in (and its own underside), dynamic RADIANCE adds the level
  // lit by the muzzle flash. Both gains 0 skip the storage read entirely -
  // the parity path. See probe-gather-compute.ts for the writer.
  if (probeDynCfg.x > 0.0 || probeDynCfg.y > 0.0) {
    let dyn = probeDynamic(p, n, probeDyn, probeMin, probeInvExtent, probeDims);
    amb = amb * mix(1.0, dyn.w, probeDynCfg.y) + dyn.xyz * probeDynCfg.x;
  }
  // HIGHLIGHT SHOULDER (spotCfg2.y). A body standing in the beam used to run
  // past 1.0 on every channel and hard-clip, which does not just look blown —
  // it DELETES the wounds: crater, lip, char and clean skin all clamp to the
  // same white, so a shot enemy reads identical to an unshot one exactly when
  // you are close enough to aim. The shoulder compresses [knee, inf) into
  // [knee, 1) monotonically, so those differences survive as differences.
  //
  // Gated on the beam existing at all, so the lab and every stock preset keep
  // their old arithmetic bit-for-bit.
  //
  // METAL (hard-surface task 2), at metal 1:
  //  - the whole diffuse FAMILY (ambient bounce + key diffuse) scales to a
  //    0.45 floor — bounce IS diffuse, and leaving it full would keep the
  //    plate reading as paint. NOT zero: with no environment map the lab
  //    has one key, and a true-zero diffuse goes black wherever the
  //    highlight is not. Rendered curve, 2026-09-03 (12-frame turntable,
  //    front and plate-bearing yaws): 0.25 went BLACK at the front yaw;
  //    0.35 kept the slab forms but the front still read near-black; 0.45
  //    keeps the greave's specular gradient AND a readable front face. 0.45
  //    ships; the owner can pull it darker now that the word exists.
  //  - the specular AND the fresnel rim are tinted by the prim's own
  //    albedo instead of shining the light's colour — the single change
  //    that makes steel differ from white plastic under the same light.
  //    The tint is the albedo's HUE with its luminance renormalised to
  //    steel's F0: multiplying by the RAW albedo (this line's first
  //    version) rendered the minotaur's plates BLACK — 0.17 linear
  //    luminance times the highlight is no highlight (frame-00 A/B,
  //    2026-09-03). Polished steel reflects ~56% at normal incidence
  //    however dark its paint reads (iron F0 = 0.56, standard metals
  //    table), so the scale renormalises luminance, and the min() caps the
  //    blow-up on near-black paint (dark chrome should stay dark).
  //  - wet, scatter and the wound terms are untouched: scope discipline,
  //    and the floor above keeps the plate readable without them.
  // At metal 0 both factors are exactly 1.0 — bit-identical to the old sum
  // (multiplication by 1.0 is exact), so every non-metal character shades
  // byte-for-byte as before.
  // (Task 3's merge removed a STALE duplicate of this block left by task 2's
  // tuning pass — it claimed the 0.25 floor this curve superseded.)
  //
  // THE mix() IS LEAD, NOT TRIM (regression fixed 2026-09-04). The sentence
  // above was the INTENT; for one merge the tint below did not implement it.
  // It shipped as the bare min(), and primAlbedo is vec3(0) on every
  // UNPAINTED pixel — flesh never enters the 'PC.w > 0.0' branch that fills
  // it. So metalTintLum sat on its 1e-3 floor, the tint evaluated to vec3(0),
  // and it multiplied the ENTIRE specular + fresnel line to nothing: every
  // zombie lost its highlight and its rim at once, in the lab and in the
  // game. The diagnostic tell is that the specular slider went dead — surfCfg.x
  // lives inside those parentheses, so nothing it does survives a zero
  // common factor.
  //
  // Gate it the same way the diffuse floor beside it is gated. A PAINTED
  // non-metal wants the untinted white highlight too (polished plastic, not
  // coloured chrome), which 'metal' - not 'painted' - is exactly the flag for.
  let metalTintLum = max(dot(primAlbedo, vec3<f32>(0.2126, 0.7152, 0.0722)), 1e-3);
  let metalTint = mix(vec3<f32>(1.0), min(primAlbedo * (0.56 / metalTintLum), vec3<f32>(1.5)), metal);
  // DIRECT MUZZLE FLASH (owner, 2026-09-09: "the soldier's flash should light
  // them up briefly"). The nearest burning muzzle — this body's own or a
  // neighbour's, the game picks the strongest by I/d² — as a warm point
  // light with a 0.2 m floor on the distance so a muzzle against the flesh
  // does not blow it out. bodyFlash.w = 0 skips it: bit-identical.
  var flashDirect = vec3<f32>(0.0, 0.0, 0.0);
  if (bodyFlash.w > 0.0) {
    let fv = bodyFlash.xyz - p;
    let fd2 = max(dot(fv, fv), 0.04);
    let fl = fv * inverseSqrt(fd2);
    flashDirect = vec3<f32>(1.0, 0.72, 0.45) * (bodyFlash.w * max(dot(n, fl), 0.0) / fd2);
  }
  var fleshLit = albedo * (amb + flashDirect + diff * wShadow * lvl * keyI * keyC) * ao * mix(1.0, 0.45, metal)
               // * woundGlint: MEAT DETAIL (soldierWound block) — the wet highlight broken into glints,
               // soldier wounds only; applied at the consumer so the hoisted wet statement stays pinned.
               + metalTint * keyC * (shine * wShadow * lvl * mix(surfCfg.x, 1.5, gloss) + fres * mix(1.0, 2.5, gloss)) * wet * mix(1.0, woundGlint, soldierWound)
               + scatter;
  // FLAT-LIT decal: where the baked face covers the surface, relight it with
  // a fixed favourable diffuse and no AO/spec/fresnel — the image carries its
  // own shading, and real shading on top drew hard shadow lines from the
  // fringe and killed the mouth on the down-sloping jaw. 0.85 keeps a whisper
  // of real light so the head still turns.
  //
  // The DIFFUSE CONSTANT was 0.52 and is 0.30 (2026-09-04). At 0.52 the decal
  // rendered effectively UNLIT: measured on the soldier, face #cc9f69 --
  // almost exactly his raw atlas skin -- against a correctly-lit body at
  // #954821, a 1.83x mismatch that read as a pale card stuck on the head.
  // 0.30 brings it to 1.22x, about right for a face catching light. The 0.85
  // MIX is deliberately untouched: that is what keeps the fringe shadow off
  // the mouth, which is the failure this comment records. Swept for
  // regressions -- the zombie sits at 1.18x face/torso, contrast sd 41.4.
  fleshLit = mix(fleshLit,
                 albedo * (amb + 0.30 * lightCfg.x * keyColor),
                 faceFlat * 0.85);
  if (spotCfg.x > 0.0 && spotCfg2.y > 0.0) {
    let knee = clamp(1.0 - spotCfg2.y, 0.05, 0.99);
    fleshLit = vec3<f32>(softShoulder(fleshLit.x, knee),
                         softShoulder(fleshLit.y, knee),
                         softShoulder(fleshLit.z, knee));
  }

  // Each emission source fades the lit term by its own amount, mirroring the
  // face path's fleshLit * (1 - faceGlow): a surface that IS the light
  // should not ALSO carry the key's full diffuse on top — that add-then-clamp
  // is exactly how the face glow used to render pale cream (comment above).
  // At primGlow 0 the factor is exactly 1.0 — bit-identical to the old line
  // (multiplication by 1.0 is exact), so every non-glowing pixel everywhere
  // shades byte-for-byte as before.
  var lit = fleshLit * (1.0 - faceGlow) * (1.0 - primGlow) + glow;

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

  // PERF INSTRUMENTATION output (task 2): replace the shaded colour with
  // the counter heatmap — a two-stop blue -> yellow -> red ramp, no
  // texture. Steps normalise by the budget (marchCfg.x, 96); prims by 2000
  // (56 prims x ~35 steps as the red end). After the gamma block so the
  // ramp colours emit raw; depth (t) still goes out, so the composite's
  // depth path runs identically to a shaded frame.
  if (debugCfg.x > 0.5) {
    // MODE 3 (hull-holes diagnosis, 2026-08-27): heat of occT itself — the
    // distance this pixel's march will be clamped by. 0 m = blue, 4 m = red,
    // no hull = white. Shows WHICH hull surface a wounded body's pixels are
    // being cut by. Temporary diagnostic.
    if (debugCfg.x > 2.5 && debugCfg.x < 3.5) {
      let occNorm = clamp(occT / 4.0, 0.0, 1.0);
      var occCol = mix(vec3<f32>(0.05, 0.15, 0.75), vec3<f32>(0.95, 0.85, 0.15), clamp(occNorm * 2.0, 0.0, 1.0));
      occCol = mix(occCol, vec3<f32>(1.0, 1.0, 1.0), select(0.0, 1.0, occT > 3.9));
      return vec4<f32>(occCol, t);
    }
    let heatNorm = select(debugSteps / max(marchCfg.x, 1.0), debugPrims / 2000.0, debugCfg.x > 1.5);
    let rampA = vec3<f32>(0.05, 0.15, 0.75);
    let rampB = vec3<f32>(0.95, 0.85, 0.15);
    let rampC = vec3<f32>(0.85, 0.05, 0.10);
    var heatCol = mix(rampA, rampB, clamp(heatNorm * 2.0, 0.0, 1.0));
    heatCol = mix(heatCol, rampC, clamp((heatNorm - 0.5) * 2.0, 0.0, 1.0));
    return vec4<f32>(heatCol, t);
  }

  return vec4<f32>(lit, t);
}`;

/**
 * The legacy lit entry — the default expansion. Assembled from the sections
 * above; the text is the pre-split shader with the wet/glow hoist described
 * at MARCH_BODY_PARAMS, which is arithmetic-neutral. Every existing variant
 * (body, hands, chunks, hull-refine) keeps binding against exactly this.
 */
export const MARCH_BODY = `fn marchBody${MARCH_BODY_PARAMS}${MARCH_BODY_TRACE}${MARCH_BODY_SURFACE_PREP}${MARCH_BODY_LIGHT}`;

/**
 * Helper sources in DEPENDENCY ORDER — each one may only call those before it,
 * because WGSL requires declaration before use and three emits includes in the
 * order given.
 */
// WOUND SOFT SHADOW (iq's sphere-traced soft shadow,
// <https://iquilezles.org/articles/rsmshadows/>). A crater viewed at many
// angles still reads ambiguously as a BALL because its concave dish casts no
// shadow — the missing cue is occlusion from the crater's own wall (owner
// decision 2026-08-24: "cast shadow vs darker floor"; the shadow won).
//
//   res = min(res, k * h / t)   marched from the surface toward the light
//
// FIRED ONLY NEAR WOUNDS — the caller gates on mapBody's nearWound zone, so
// the cost scales with crater screen area, not screen size. Everywhere else
// the caller keeps shadow = 1 and pays nothing.
//
// Quality budget, chosen for a fill-bound renderer:
//   - 14 steps max (12-16 band), marching mapBody at noiseAmp 0 — same field
//     the tracer sees, no fbm cost.
//   - t starts at 0.02: self-intersection clearance. Right at the everted lip
//     the field is NOT a clean distance bound (see applyWounds' nearWound
//     comment — the smax fillet overstates distance), and an h sampled at t=0
//     would immediately clamp res to 0 everywhere.
//   - tMax 0.4 m: this is LOCAL crater self-shadowing, not global occlusion.
//   - Early-out once res < 0.02: fully shadowed, more samples cannot un-darken.
//   - Step clamp(h, 0.01, 0.06): the floor keeps tiny-h walls from stalling;
//     the ceiling keeps wall detail (which the softness k needs) from being
//     stepped over.
// Softness k ≈ 8-16 arrives as a parameter so the panel can tune it live.
export const WOUND_SHADOW = /* wgsl */ `fn woundShadow(
  p: vec3<f32>,
  L: vec3<f32>,
  k: f32,
  data: texture_2d<f32>,
  counts: vec4<f32>,
  counts2: vec4<f32>,
  woundCfg: vec4<f32>,
  woundCfg2: vec4<f32>,
  volumeTex: texture_3d<f32>,
  volumePose0: vec4<f32>,
  volumePose1: vec4<f32>,
  volumeMin: vec3<f32>,
  volumeInvExtent: vec3<f32>,
  volumeWarp: vec4<f32>,
  volumeClip: vec4<f32>,
  segVolumeAtlas: texture_3d<f32>,
  segVolumeMeta: texture_2d<f32>,
  perfCfg: vec4<f32>,
  woundBound: vec4<f32>
) -> f32 {
  var res = 1.0;
  var t = 0.02;
  // TRIANGULATED coverage (iq's improved estimator, the same article; the
  // Claybook talk's slide 39 reports it as their fix for banding). The
  // single-sample min sees the occluder only where a sample happens to land
  // nearest it, so the penumbra bands at the step spacing. Two consecutive
  // samples h (now) and ph (previous), stepped apart, bound a closest point
  // BETWEEN them: y is that point's offset back along the ray and d its
  // distance off the ray, and k * d / (t - y) is the cone coverage there.
  // Same 14 samples, same field, two extra multiplies; ph starts at 1e10
  // so the first sample degrades to the plain estimator (y -> 0, d -> h).
  var ph = 1e10;
  for (var i = 0; i < 14; i = i + 1) {
    let h = mapBody(p + L * t, data, counts, counts2, vec4<f32>(0.0), woundCfg, woundCfg2, vec3<f32>(0.0, 0.0, 0.0), volumeTex, volumePose0, volumePose1, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, woundBound).x;
    let y = h * h / (2.0 * ph);
    let dd = sqrt(max(h * h - y * y, 0.0));
    res = min(res, k * dd / max(t - y, 1e-4));
    ph = h;
    if (res < 0.02 || t > 0.4) { break; }
    t = t + clamp(h, 0.01, 0.06);
  }
  return clamp(res, 0.0, 1.0);
}`;

// Level-only shadow map lookup (perf round 2 task 7). cfg = (enabled,
// normalBias m, depthBias, spare). The map comes from a twin spotlight that
// renders layer 0 only, so a body never sees its own hull in it. The
// projection is three's `shadow.matrix` (bias * proj * view), whose output
// is [0,1] uv with depth in .z — the same contract three's own ShadowNode
// samples. 4-tap PCF on the texel grid; the owner's PSX look wants soft
// edges, not hard ones.
export const LEVEL_SHADOW = /* wgsl */ `fn levelShadow(p: vec3<f32>, n: vec3<f32>, shadowTex: texture_depth_2d, shadowMat: mat4x4<f32>, cfg: vec4<f32>) -> f32 {
  if (cfg.x < 0.5) { return 1.0; }
  let sp = shadowMat * vec4<f32>(p + n * cfg.y, 1.0);
  let uv = sp.xy / sp.w;
  let z = sp.z / sp.w - cfg.z;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || z > 1.0) { return 1.0; }
  let dims = vec2<f32>(textureDimensions(shadowTex, 0));
  let base = uv * dims - vec2<f32>(0.5, 0.5);
  var lit = 0.0;
  for (var dy = 0; dy < 2; dy = dy + 1) {
    for (var dx = 0; dx < 2; dx = dx + 1) {
      let c = clamp(vec2<i32>(floor(base)) + vec2<i32>(dx, dy), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
      let d = textureLoad(shadowTex, c, 0);
      lit = lit + select(0.0, 1.0, z <= d);
    }
  }
  return lit * 0.25;
}`;

// Quarter-res depth prepass fetch (close-up task 3). NEAREST texel of the
// 4x4 block this SDF pixel falls in — never interpolated, same rule as
// coneFetch — because an average of two block starts is a start neither
// block proved. ZERO is "no start" and covers three cases — pass disabled,
// no coarse ray touched anything in this block, and a recorded touch at or
// below zero — so the consumer's max() folds to the identity on all three.
// Grid size comes from textureDimensions, never a captured uniform (the
// adaptive controller resizes the layer under this pass at runtime).
export const DEPTH_PRE_FETCH = /* wgsl */ `fn depthPreFetch(
  tex: texture_2d<f32>,
  screenUV: vec2<f32>,
  cfg: vec4<f32>
) -> f32 {
  if (cfg.x < 0.5) { return 0.0; }
  let dims = vec2<f32>(textureDimensions(tex, 0));
  let c = clamp(vec2<i32>(floor(screenUV * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  let v = textureLoad(tex, c, 0).x;
  if (v <= 0.0) { return 0.0; }
  return v;
}`;

export const HELPERS = [
  // ORDER IS LOAD-BEARING: WGSL requires declaration before use, and wgslFn
  // concatenates this list as-is. CONE_CAP must precede both sdPrim and
  // sdPrimO, which now call it; SMIN_CHAMFER must precede mapBody. Adding a
  // helper and forgetting this list entirely is the quieter failure — the
  // ordering test below only checks what is IN the list, so an omitted helper
  // passes every unit test and fails at pipeline creation with a bare WGSL
  // parse error pointing at the call site.
  SMIN, SMIN_CHAMFER, SMAX, SD_GROOVE, CONE_CAP, SD_BEZIER_T, CONE_BEND,
  // Strand bundle, BEFORE SD_PRIM because both sdPrim and sdPrimO call
  // coneStrand, and coneStrand itself calls strandHash4 and strandLip — so
  // all three must be declared ahead of it. Omitting a helper from this list
  // is the quiet failure this comment block warns about: it passes every
  // unit test and dies at pipeline creation with a bare WGSL parse error.
  STRAND_HASH4, STRAND_LIPSCHITZ, CONE_STRAND,
  SD_ROUND_BOX, SD_PRIM, SD_PRIM_ORIENTED,
  // NOISE_LOCAL ahead of SD_SHELL: the shell's warp is evaluated in the
  // body frame and calls noiseLocal, and WGSL has no forward declarations at
  // module scope — a helper used before it is declared is a bare parse error
  // at pipeline creation, which is the failure this list's header warns of.
  HASH13, NOISE3, FBM, NOISE_LOCAL,
  SD_SHELL,
  Q_ROT, Q_MUL, Q_FROM_TO, REST_POINT,
  APPLY_CARVES, APPLY_WOUNDS, WOUND_MASK, TISSUE_RAMP, CHAR_MASK, SAMPLE_VOLUME,
  FOLD_GROUP, FOLD_BONE_RANGE, SEG_VOLUME_WGSL, APPLY_BONES, MAP_BODY, CALC_NORMAL, WOUND_SHADOW, TEXEL, FLICKER, SOFT_SHOULDER,
  WALL_CONTRIBUTION, AMBIENT_AT, PROBE_GRID_WGSL, PROBE_DYNAMIC_WGSL, FLASHLIGHT_BOUNCE_WGSL, LEVEL_SHADOW,
  // Quarter-res depth prepass fetch (close-up task 3). No field deps — it is
  // a textureLoad — so it rides last, ahead of MARCH_BODY which calls it.
  DEPTH_PRE_FETCH,
];
