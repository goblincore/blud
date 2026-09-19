// src/lab/sdf-zombie/webgpu/march/primitives.wgsl.ts
//
// SDF primitives, fold operators and the detail field — split out of
// march.wgsl.ts (phase 1, move-only). Data-texture row constants come
// from ./layout.

import { ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_PRIM_STRAND, ROW_PRIM_BEND, ROW_PRIM_QUAT } from './layout';

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
