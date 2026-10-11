// src/lab/sdf-zombie/webgpu/screen-emergence.wgsl.ts
//
// THE SCREEN EMERGENCE's march and shading (spec docs/superpowers/specs/2026-10-11-screen-emergence-lab-spike-design.md section 4; plan
// Task 6, round one: the sheet, the lip, the egg and the picture). Hand-written WGSL, one fn per string (wgslFn takes one), constants built
// from emergence-field.ts's tables with the same f()/v3() helpers egg.wgsl.ts uses: this is that module's twin.
//
// FRAME: everything runs in the screen's frame (origin at the glass centre, +z out of the glass toward the room, metres), which is the proxy
// box's LOCAL space: the host brings the eye and the fragment into it with modelWorldMatrixInverse, so the CRT may be turned any way.
//
// THE FIELD (mapScr, materials 1 sheet, 2 lip, 3 egg, 4 goo, 5 the tear's rim):
//   * the SHEET is a thin shell, |inside| - thickness, round a solid "sac": the dome (the field's domeZ, clipped to the opening) smooth-
//     unioned with the egg grown by the skin, floored a little behind the glass: the field module's sacSolid (its twin). The blend is
//     sacBlend's: narrow round the egg's front cap, WIDE (SAC_BLEND.tent) behind its equator, so the wall curves from the equator back under
//     the egg and out along the dome to the lip, a balloon on its neck. (Round one swept the egg's silhouette straight back to the glass:
//     a rigid tube.) The solid's top seen from the front is sacZ (tested), so the picture, the thickness and the goo's anchors still read
//     the heightfield. The dome's own distance is first-order, (z - h) / sqrt(1 + |grad h|^2), with the gradient analytic.
//   * the LIP is a flared sleeve of rounded-rectangle section (the glass's shape, spec "a rounded rectangular rim"), from the bevel's foot
//     at the glass plane out to the bowed rim at lipZ, rounded at the top. At rest it is a gasket hidden under the CRT mesh's bevel.
//   * the EGG is iq's approximate ellipsoid distance.
//   * THE TEAR (plan Task 7) cuts the sheet with a ragged SPHERE round the tip (the field's tearTip: the sheet's apex on the axis (x, y) =
//     (0, 0)), radius tearRadius's at the angle round the axis (the field's TEAR_RAG harmonics, built in): seen from the front a circular-ish
//     opening, and as it widens it runs back down the sac's walls like a tear in a membrane (a cylinder along z grazed the walls in long
//     slivers; the page's look check, round two). It stops above TEAR_FLOOR: the floor sheet (the glass's backing) stays, so through the tear, once the egg has
//     gone, the eye meets the backing, not the tube. Within TEAR_RIM.band of the edge the sheet is material 5, thickened and rolled outward.
//   * THE GOO (plan Task 7): strands (tapered capsules between consecutive points), beads (spheres) and drips (round cones), read from a
//     64 x 1 RGBA32F row (goo-strands.ts's gooTexels) with textureLoad, smooth-unioned among themselves and then into the sheet, the egg and
//     the lip with a WIDE blend (GOO_K.scene) so they web and neck; skipped outside a bounding sphere the page uploads (goo.w <= 0: none).
// The sheet's opening (its clip) is the sleeve's inner face, so the sheet meets the lip exactly.
//
// THE PASS (scrShade): ray-box clip, a march of MAX_STEPS from the box entry; if the first hit is the sheet, shade it and march again from
// just past the skin WITHOUT the sheet for what lies behind (the egg, the lip, else the CRT's dark tube or the room), and composite by the
// sheet's opacity. Materials above 1.5 are opaque (scrSurface: 2 lip, 3 egg, 4 goo, 5 the tear's rim). Returns (straight colour, packed): packed = floor(t * DEPTH_Q) + alpha (alpha < 1), so ONE call carries the first hit's
// distance for depthNode and the coverage; 0 on a miss.
import { DOME_EXP, EGG, GLASS, PICTURE_TABLE_N, RIPPLE, SAC_BLEND, SAC_MAX, SKIN, TEAR_R_MAX, TEAR_RAG, THICK0 } from './emergence-field';
import { GOO_BOUND0, N_BEADS, N_DRIPS, N_STRANDS, STRAND_POINTS } from './goo-strands';

const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const v3 = (v: readonly number[]) => `vec3<f32>(${f(v[0]!)}, ${f(v[1]!)}, ${f(v[2]!)})`;

/** The proxy box in the screen frame: the glass, the sac's whole reach (0.73 m) and the slumped egg on the desk. */
export const SCREEN_PROXY = { min: [-0.5, -0.5, -0.1], max: [0.5, 0.5, 0.95] } as const;
/** The march's step budget (spec: a fixed 64 and an early-out on the box). */
export const MAX_STEPS = 64;
/** The sac solid ends this far behind the glass plane (inside the tube, behind the bevel). */
export const SHEET_FLOOR = -0.03;
/** The sheet's opening runs this far past the glass edge (under the bevel's foot). */
export const OPEN_PAD = 0.002;
/** The lip sleeve's tube radius; its core runs this far outside the opening. */
export const LIP_R = 0.01;
/** The packed distance's quantum: the hit distance in 1/DEPTH_Q m (about a millimetre), the coverage in the fraction. */
export const DEPTH_Q = 1024;
/** The picture's emission gain over the texture (the scanlines take a fifth of it back on average). */
export const PIC_GAIN = 1.25;

/** The tear's wet rim: `band` (m) outside the hole's edge is material 5; the sheet there thickens by 1 + `thicken` * band; the rim rolls
 *  outward by `roll` * tear over `rollW`; `round` rounds the cut's edge (a smooth max). */
export const TEAR_RIM = { band: 0.012, thicken: 1.6, roll: 0.02, rollW: 0.035, round: 0.005 } as const;
/** The sheet tears only above this depth: the floor sheet behind the glass (the backing) stays whole. */
export const TEAR_FLOOR = -0.012;
/** The goo's blends: among its own strands, beads and drips, and into the sheet, the egg and the lip (wide: it webs and necks), the
 *  latter at full width from a piece of radius `fullW` up (a strand's own radius) and narrower below it. */
export const GOO_K = { self: 0.012, scene: 0.04, fullW: 0.006 } as const;
/** The goo row's layout (gooTexels): the strands' points, then the beads, then each drip's top and tip. */
export const GOO_BEAD0 = N_STRANDS * STRAND_POINTS;
export const GOO_DRIP0 = GOO_BEAD0 + N_BEADS;

const EGG_R = v3([EGG.rx, EGG.ry, EGG.rz]);
const RAG = TEAR_RAG.map(([a, k, ph]) => `${f(a)} * sin(${f(k)} * th + ${f(ph)})`).join(' + ');
const DRAG = TEAR_RAG.map(([a, k, ph]) => `${f(a * k)} * cos(${f(k)} * th + ${f(ph)})`).join(' + ');
const RAG_MIN = 1 - TEAR_RAG.reduce((s, [a]) => s + a, 0);

/** Polynomial smooth maximum (iq), as smax in emergence-field.ts. */
export const SCR_SMAX = /* wgsl */ `fn scrSmax(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return max(a, b) + h * h * k * 0.25;
}`;

/** Polynomial smooth minimum (iq), the same form. */
export const SCR_SMIN = /* wgsl */ `fn scrSmin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}`;

/**
 * THE SHEET's heights at (x, y), the twin of sacZ in emergence-field.ts. p0 = (ripple, push, thin, lipBow), p1 = (tear, slump, heal, glow),
 * d = (sacExtent, eggCz, eggCy, lipZ) and lip = (hw, hh, smooth(lipBow), the tear tip's z: tearTip), computed on the CPU each frame from the field module so this
 * never re-derives eggCentre. Returns (sacZ, the dome plus the ripple, |grad| of that, q).
 * Includes: scrSmax.
 */
export const SCR_SAC = /* wgsl */ `fn sacZ(x: f32, y: f32, p0: vec4<f32>, p1: vec4<f32>, d: vec4<f32>, lip: vec4<f32>, tm: f32) -> vec4<f32> {
  let mx = x / lip.x;
  let my = y / lip.y;
  let q = max(length(vec2<f32>(mx, my)), 0.00001);
  let qc = min(q, 1.0);
  let rise = max(0.0, d.x - d.w);
  let u = 1.0 - qc;
  let s = u * u * (3.0 - 2.0 * u);
  var prof = 0.0;
  var dprof = 0.0;
  if (q < 1.0 && s > 0.0) {
    prof = pow(s, ${f(DOME_EXP)});
    dprof = ${f(-DOME_EXP)} * pow(max(s, 0.000001), ${f(DOME_EXP - 1)}) * 6.0 * u * (1.0 - u);
  }
  let ph = ${f(RIPPLE.freq)} * qc - ${f(RIPPLE.speed)} * tm;
  let ra = p0.x * ${f(RIPPLE.amp)};
  let rip = ra * sin(ph) * (1.0 - qc);
  var drip = 0.0;
  if (q < 1.0) { drip = ra * (${f(RIPPLE.freq)} * cos(ph) * (1.0 - qc) - sin(ph)); }
  let dome = d.w + rise * prof;
  let gq = length(vec2<f32>(mx / lip.x, my / lip.y)) / q;
  let slope = abs(rise * dprof + drip) * gq;
  let ex = x / ${f(EGG.rx)};
  let ey = (y - d.z) / ${f(EGG.ry)};
  let qe = ex * ex + ey * ey;
  var wrapped = dome;
  if (qe < 1.0) { wrapped = scrSmax(dome, d.y + ${f(EGG.rz)} * sqrt(1.0 - qe) + ${f(SKIN)}, ${f(SAC_BLEND.cap)}); }
  return vec4<f32>(wrapped + rip, dome + rip, slope, q);
}`;

/** iq's approximate ellipsoid distance, centred at the origin, semi-axes r. */
export const SCR_ELLIPSOID = /* wgsl */ `fn scrEllipsoid(p: vec3<f32>, r: vec3<f32>) -> f32 {
  let k0 = length(p / r);
  let k1 = length(p / (r * r));
  if (k1 < 0.000001) { return -min(r.x, min(r.y, r.z)); }
  return k0 * (k0 - 1.0) / k1;
}`;

/** A rounded rectangle's signed distance in the plane: half extents b, corner radius r. */
export const SCR_ROUNDRECT = /* wgsl */ `fn scrRoundRect(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
  let q = abs(p) - b + vec2<f32>(r);
  return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}`;

/** The opening at height p.z (positive outside): the glass's rounded rectangle at the glass plane, flaring to the bowed lip's opening
 *  (lip.xy) at lipZ, its corners rounding out with the bow (lip.z). Includes: scrRoundRect. */
export const SCR_OPENING = /* wgsl */ `fn scrOpening(p: vec3<f32>, lip: vec4<f32>, lipZ: f32) -> f32 {
  let s = clamp(p.z / max(lipZ, 0.0001), 0.0, 1.0);
  let b = mix(vec2<f32>(${f(GLASS.hw)}, ${f(GLASS.hh)}), lip.xy, s) + vec2<f32>(${f(OPEN_PAD)});
  let r = 0.008 + 0.04 * lip.z * s;
  return scrRoundRect(p.xy, b, r);
}`;

/** THE LIP: the sleeve from behind the glass plane to the bowed rim at lipZ, a tube of radius LIP_R just outside the opening, rounded at
 *  its ends. Unbowed, its top sits at the glass plane, under the CRT mesh's bevel (hidden); bowed, its rim rides at lipZ + LIP_R. The
 *  opening's flare tilts the field (slope up to about 0.8), so the distance is scaled by 0.8. Includes: scrOpening. */
export const SCR_LIP = /* wgsl */ `fn scrLip(p: vec3<f32>, lip: vec4<f32>, lipZ: f32) -> f32 {
  let d2 = scrOpening(p, lip, lipZ);
  let dw = abs(d2 - ${f(LIP_R)});
  let za = ${f(-1.5 * LIP_R)};
  let zb = lipZ - ${f(LIP_R)} * (1.0 - lip.z);
  let dz = abs(p.z - 0.5 * (za + zb)) - 0.5 * (zb - za);
  let e = vec2<f32>(dw, dz);
  return (length(max(e, vec2<f32>(0.0))) + min(max(e.x, e.y), 0.0) - ${f(LIP_R)}) * 0.8;
}`;

/**
 * THE TEAR at p: (the signed distance to the hole's ragged edge, positive outside the hole, the hole's radius there): a sphere round the tip
 * (0, 0, tipZ), its radius tearRadius's twin (TEAR_RAG's harmonics in the angle round the axis, grown by smooth(tear)). The radius's slope
 * in that angle is divided out (first order), and deep in the hole the distance is at least the smallest radius's, so rays through the
 * middle of the hole take long steps. (1000, 0) when closed.
 */
export const SCR_TEAR = /* wgsl */ `fn scrTear(p: vec3<f32>, tear: f32, tipZ: f32) -> vec2<f32> {
  let s = smoothstep(0.0, 1.0, tear);
  if (s <= 0.0) { return vec2<f32>(1000.0, 0.0); }
  let rho = length(vec3<f32>(p.xy, p.z - tipZ));
  let rxy = max(length(p.xy), 0.00001);
  let th = atan2(p.y, p.x);
  let tr = ${f(TEAR_R_MAX)} * s * (1.0 + ${RAG});
  let dtr = ${f(TEAR_R_MAX)} * s * (${DRAG});
  let q = dtr / rxy;
  var hd = (rho - tr) / sqrt(1.0 + q * q);
  hd = min(hd, rho - ${f(TEAR_R_MAX * RAG_MIN)} * s);
  return vec2<f32>(hd, tr);
}`;

/** A capsule tapering from radius ra at a to rb at b (the strands' segments; the taper is first order). */
export const SCR_CAPSULE = /* wgsl */ `fn scrCapsule(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, ra: f32, rb: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0000001), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}`;

/** iq's round cone between two spheres (a, r1) and (b, r2): the drips. Degenerate (one sphere inside the other): the two spheres. */
export const SCR_ROUNDCONE = /* wgsl */ `fn scrRoundCone(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, r1: f32, r2: f32) -> f32 {
  let ba = b - a;
  let l2 = dot(ba, ba);
  let rr = r1 - r2;
  let a2 = l2 - rr * rr;
  if (a2 < 0.0000001) { return min(length(p - a) - r1, length(p - b) - r2); }
  let il2 = 1.0 / l2;
  let pa = p - a;
  let y = dot(pa, ba);
  let z = y - l2;
  let xv = pa * l2 - ba * y;
  let x2 = dot(xv, xv);
  let y2 = y * y * l2;
  let z2 = z * z * l2;
  let k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) { return sqrt(x2 + z2) * il2 - r2; }
  if (sign(y) * a2 * y2 < k) { return sqrt(x2 + y2) * il2 - r1; }
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}`;

/**
 * THE GOO's distance at p, where it can matter: the strands' tapered capsules between consecutive live points (radius from w), the beads
 * (spheres), the drips (round cones, top to tip), smooth-unioned with GOO_K.self. Texels with w = 0 are skipped, and so is every group (a
 * strand, the beads, the drips) whose bounding sphere (gooTexels' bounds from GOO_BOUND0) is further than the nearer of what is found so far
 * (plus the self blend) and `cut` (mapScr's: the scene's distance plus the scene blend; nothing beyond it changes the field). Returns
 * (distance, the radius of the nearest piece): mapScr scales the scene blend by it, so a strand thickening in from nothing does not pop in
 * as a full-width fillet.
 * Includes: scrCapsule, scrRoundCone, scrSmin.
 */
export const SCR_GOO = /* wgsl */ `fn scrGoo(p: vec3<f32>, gooTex: texture_2d<f32>, cut: f32) -> vec2<f32> {
  var d = 1000.0;
  var wn = 0.0;
  for (var s = 0; s < ${N_STRANDS}; s = s + 1) {
    let bs = textureLoad(gooTex, vec2<i32>(${GOO_BOUND0} + s, 0), 0);
    if (bs.w <= 0.0 || length(p - bs.xyz) - bs.w > min(d + ${f(GOO_K.self)}, cut)) { continue; }
    var a = textureLoad(gooTex, vec2<i32>(s * ${STRAND_POINTS}, 0), 0);
    if (a.w <= 0.0) { continue; }
    for (var k = 1; k < ${STRAND_POINTS}; k = k + 1) {
      let b = textureLoad(gooTex, vec2<i32>(s * ${STRAND_POINTS} + k, 0), 0);
      if (b.w > 0.0) {
        let e = scrCapsule(p, a.xyz, b.xyz, a.w, b.w);
        if (e < d) { wn = max(a.w, b.w); }
        d = scrSmin(d, e, ${f(GOO_K.self)});
      }
      a = b;
    }
  }
  let bb = textureLoad(gooTex, vec2<i32>(${GOO_BOUND0 + N_STRANDS}, 0), 0);
  let beadsOn = bb.w > 0.0 && length(p - bb.xyz) - bb.w <= min(d + ${f(GOO_K.self)}, cut);
  for (var i = 0; i < ${N_BEADS}; i = i + 1) {
    if (!beadsOn) { break; }
    let b = textureLoad(gooTex, vec2<i32>(${GOO_BEAD0} + i, 0), 0);
    if (b.w > 0.0) {
      let e = length(p - b.xyz) - b.w;
      if (e < d) { wn = b.w; }
      d = scrSmin(d, e, ${f(GOO_K.self)});
    }
  }
  let bd = textureLoad(gooTex, vec2<i32>(${GOO_BOUND0 + N_STRANDS + 1}, 0), 0);
  let dripsOn = bd.w > 0.0 && length(p - bd.xyz) - bd.w <= min(d + ${f(GOO_K.self)}, cut);
  for (var i = 0; i < ${N_DRIPS}; i = i + 1) {
    if (!dripsOn) { break; }
    let top = textureLoad(gooTex, vec2<i32>(${GOO_DRIP0} + 2 * i, 0), 0);
    if (top.w <= 0.0) { continue; }
    let tip = textureLoad(gooTex, vec2<i32>(${GOO_DRIP0} + 2 * i + 1, 0), 0);
    let e = scrRoundCone(p, top.xyz, tip.xyz, top.w, tip.w);
    if (e < d) { wn = max(top.w, tip.w); }
    d = scrSmin(d, e, ${f(GOO_K.self)});
  }
  return vec2<f32>(d, wn);
}`;

/**
 * THE FIELD: (distance, material) at p. Materials: 1 the sheet, 2 the lip, 3 the egg, 4 the goo, 5 the tear's rim. `sheetOn` 0 leaves the
 * sheet out (the march behind the skin). The sheet's half-thickness is sheetThickness's twin (thinner with the stretch and `thin`), thicker
 * on the tear's rim. goo = the goo's bounding sphere (centre, radius; radius <= 0: no goo), gooTex its row of texels.
 * Includes: sacZ, scrOpening, scrLip, scrEllipsoid, scrSmin, scrSmax, scrTear, scrGoo.
 */
export const SCR_MAP = /* wgsl */ `fn mapScr(p: vec3<f32>, p0: vec4<f32>, p1: vec4<f32>, d: vec4<f32>, lip: vec4<f32>, tm: f32, sheetOn: f32, gooTex: texture_2d<f32>, goo: vec4<f32>) -> vec2<f32> {
  let c = vec3<f32>(0.0, d.z, d.y);
  var best = vec2<f32>(scrEllipsoid(p - c, ${EGG_R}), 3.0);
  let lipD = scrLip(p, lip, d.w);
  if (lipD < best.x) { best = vec2<f32>(lipD, 2.0); }
  if (sheetOn > 0.5) {
    let h = sacZ(p.x, p.y, p0, p1, d, lip, tm);
    let dome = (p.z - h.y) / sqrt(1.0 + h.z * h.z);
    let foot = scrOpening(p, lip, d.w) * 0.8;
    var inside = max(dome, foot);
    let behind = smoothstep(0.0, 1.0, (c.z - p.z) / ${f(SAC_BLEND.run)});
    let tent = mix(${f(SAC_BLEND.rest)}, ${f(SAC_BLEND.tent)}, smoothstep(0.0, 1.0, p0.y));
    inside = scrSmin(inside, scrEllipsoid(p - c, ${EGG_R}) - ${f(SKIN)}, mix(${f(SAC_BLEND.cap)}, tent, behind));
    inside = max(inside, ${f(SHEET_FLOOR)} - p.z);
    // The tear: a ragged cylinder round the apex axis, above TEAR_FLOOR; its rim band thickens and rolls outward with the tear.
    let tr = scrTear(p, p1.x, lip.w);
    let above = smoothstep(${f(TEAR_FLOOR)}, ${f(TEAR_FLOOR + 0.01)}, p.z);
    let hd = max(tr.x, 0.0);
    let band = (1.0 - smoothstep(0.0, ${f(TEAR_RIM.band)}, hd)) * above;
    let rollF = (1.0 - smoothstep(0.0, ${f(TEAR_RIM.rollW)}, hd)) * above;
    let roll = ${f(TEAR_RIM.roll)} * smoothstep(0.0, 1.0, p1.x) * rollF * rollF;
    let stretch = clamp(h.x / ${f(SAC_MAX)}, 0.0, 1.0) * (1.0 - min(h.w, 1.0) * 0.5);
    let thick = (${f(THICK0)} * (1.0 - 0.8 * max(stretch, smoothstep(0.0, 1.0, p0.z) * 0.6)) + 0.0006) * (1.0 + ${f(TEAR_RIM.thicken)} * band);
    var sheet = (abs(inside - roll) - thick) * mix(0.9, 0.7, rollF);
    sheet = scrSmax(sheet, min(-tr.x, p.z - ${f(TEAR_FLOOR)}), ${f(TEAR_RIM.round)});
    if (sheet < best.x) { best = vec2<f32>(sheet, select(1.0, 5.0, band > 0.001)); }
  }
  // The goo: outside its bounding sphere only a conservative bound (the blend cannot reach the surfaces there); inside, smooth-unioned
  // into whatever is nearest with the wide blend, the fillet milky (material 4) on the goo's side.
  if (goo.w > 0.0) {
    let gb = length(p - goo.xyz) - goo.w;
    if (gb > 0.0) {
      best.x = min(best.x, gb + ${f(0.75 * GOO_K.scene)});
    } else {
      let gw = scrGoo(p, gooTex, best.x + ${f(GOO_K.scene)});
      let g = gw.x;
      let kg = ${f(GOO_K.scene)} * clamp(gw.y / ${f(GOO_K.fullW)}, 0.0, 1.0) + 0.0001;
      if (g < best.x + kg) {
        best = vec2<f32>(scrSmin(best.x, g, kg), select(best.y, 4.0, g < best.x + 0.3 * kg));
      }
    }
  }
  return best;
}`;

/** The field's normal (the tetrahedron form, four mapScr calls). Includes: mapScr. */
export const SCR_NORMAL = /* wgsl */ `fn scrNormal(p: vec3<f32>, p0: vec4<f32>, p1: vec4<f32>, d: vec4<f32>, lip: vec4<f32>, tm: f32, sheetOn: f32, gooTex: texture_2d<f32>, goo: vec4<f32>) -> vec3<f32> {
  let e = vec2<f32>(1.0, -1.0) * 0.0007;
  return normalize(
    e.xyy * mapScr(p + e.xyy, p0, p1, d, lip, tm, sheetOn, gooTex, goo).x +
    e.yyx * mapScr(p + e.yyx, p0, p1, d, lip, tm, sheetOn, gooTex, goo).x +
    e.yxy * mapScr(p + e.yxy, p0, p1, d, lip, tm, sheetOn, gooTex, goo).x +
    e.xxx * mapScr(p + e.xxx, p0, p1, d, lip, tm, sheetOn, gooTex, goo).x);
}`;

/** The march from t0 to t1: (t, material, steps) of the first hit, or (-1, 0, steps). The hit tolerance grows with the pixel footprint
 *  (pix = the pixel's angular size). Includes: mapScr. */
export const SCR_MARCH = /* wgsl */ `fn scrMarch(ro: vec3<f32>, rd: vec3<f32>, t0: f32, t1: f32, p0: vec4<f32>, p1: vec4<f32>, d: vec4<f32>, lip: vec4<f32>, tm: f32, sheetOn: f32, pix: f32, gooTex: texture_2d<f32>, goo: vec4<f32>) -> vec3<f32> {
  var t = t0;
  for (var i = 0; i < ${MAX_STEPS}; i = i + 1) {
    if (t > t1) { return vec3<f32>(-1.0, 0.0, f32(i)); }
    let m = mapScr(ro + rd * t, p0, p1, d, lip, tm, sheetOn, gooTex, goo);
    if (m.x < max(0.0004, t * pix * 0.5)) { return vec3<f32>(t, m.y, f32(i)); }
    t = t + m.x;
  }
  return vec3<f32>(-1.0, 0.0, ${f(MAX_STEPS)});
}`;

/** Veins, 0..1, from 2D coordinates on the skin (metres): a few wandering sine ridges and a fine net. */
export const SCR_VEINS = /* wgsl */ `fn scrVeins(v: vec2<f32>) -> f32 {
  let a = sin(v.x * 31.0 + 2.3 * sin(v.y * 17.0 + 1.7));
  let b = sin(v.y * 27.0 + 2.1 * sin(v.x * 13.0 - 0.6));
  let fine = sin(v.x * 83.0 + 3.0 * sin(v.y * 61.0));
  let v1 = 1.0 - smoothstep(0.0, 0.09, abs(a));
  let v2 = 1.0 - smoothstep(0.0, 0.07, abs(b));
  let v3 = 1.0 - smoothstep(0.0, 0.05, abs(fine));
  return clamp(max(v1, v2 * 0.8) + v3 * 0.35, 0.0, 1.0);
}`;

/**
 * THE PICTURE on the sheet point above (x, y): pictureUV's twin through the picture table (a 33-texel row, read with textureLoad and lerped
 * by hand: an r32float texture is not filterable everywhere), then the screen texture (an sRGB texture: the GPU decodes it on sampling, so the
 * value is linear as the placeholder's), scanlines (faded out when a line is under a pixel:
 * `foot` is the pixel's footprint in metres) and a phosphor grain. Returns (colour, 1), or 0 off the picture (the tube's black border).
 */
export const SCR_PICTURE = /* wgsl */ `fn scrPicture(x: f32, y: f32, lip: vec4<f32>, foot: f32, picTab: texture_2d<f32>, scrTex: texture_2d<f32>, scrSamp: sampler) -> vec4<f32> {
  let mx = x / lip.x;
  let my = y / lip.y;
  let q = length(vec2<f32>(mx, my));
  var g = q;
  if (q < 1.0) {
    let fi = q * ${f(PICTURE_TABLE_N - 1)};
    let i = min(i32(floor(fi)), ${PICTURE_TABLE_N - 2});
    let a = textureLoad(picTab, vec2<i32>(i, 0), 0).x;
    let b = textureLoad(picTab, vec2<i32>(i + 1, 0), 0).x;
    g = mix(a, b, fi - f32(i));
  }
  var s = 1.0;
  if (q > 0.00001) { s = g / q; }
  let uv = vec2<f32>(mx * s * lip.x / ${f(GLASS.hw)}, my * s * lip.y / ${f(GLASS.hh)});
  if (abs(uv.x) > 1.0 || abs(uv.y) > 1.0) { return vec4<f32>(0.0); }
  let col = textureSampleLevel(scrTex, scrSamp, vec2<f32>(uv.x * 0.5 + 0.5, 0.5 + uv.y * 0.5), 0.0).rgb;
  let period = 6.2831853 / 600.0 * ${f(GLASS.hh)};
  let contrast = 1.0 - smoothstep(0.3, 0.8, foot / period);
  let scan = mix(0.775, 0.55 + 0.45 * sin(uv.y * 600.0), contrast);
  let grain = fract(sin(dot(floor(uv * vec2<f32>(320.0, 240.0)), vec2<f32>(12.9898, 78.233))) * 43758.5453);
  return vec4<f32>(col * scan * (0.92 + 0.16 * grain) * ${f(PIC_GAIN)}, 1.0);
}`;

/**
 * The lights, 90s ray-traced: the lamp (lamp.xyz in the screen frame, lamp.w its strength; warm), the egg's own light from its centre
 * (eggL.xyz, eggL.w its strength), a dim cool street fill; hard terminators (a narrow smoothstep on n.l) and a clear coat of hard white
 * highlights (coat its strength). base is the diffuse albedo.
 */
export const SCR_LIGHT = /* wgsl */ `fn scrLight(p: vec3<f32>, n: vec3<f32>, rd: vec3<f32>, lamp: vec4<f32>, eggL: vec4<f32>, base: vec3<f32>, coat: f32) -> vec3<f32> {
  let toL = lamp.xyz - p;
  let dL = length(toL);
  let L = toL / dL;
  let lampCol = vec3<f32>(1.0, 0.69, 0.4) * lamp.w / (1.0 + dL * dL * 4.0);
  let toE = eggL.xyz - p;
  let dE = max(length(toE), 0.0001);
  let E = toE / dE;
  let eggCol = vec3<f32>(1.0, 0.45, 0.18) * eggL.w / (1.0 + dE * dE * 8.0);
  let F = normalize(vec3<f32>(0.45, 0.65, 0.6));
  let fillCol = vec3<f32>(0.06, 0.08, 0.13);
  var col = base * (lampCol * smoothstep(0.0, 0.06, dot(n, L)) + eggCol * smoothstep(0.0, 0.06, dot(n, E)) + fillCol * (0.6 + 0.4 * dot(n, F)));
  let r = reflect(rd, n);
  let sL = pow(max(dot(r, L), 0.0), 120.0);
  let sF = pow(max(dot(r, F), 0.0), 60.0);
  let sE = pow(max(dot(r, E), 0.0), 90.0);
  col = col + coat * (smoothstep(0.3, 0.4, sL) * vec3<f32>(1.0, 0.92, 0.8) * (0.6 + 2.0 * lamp.w / (1.0 + dL * dL * 4.0))
    + smoothstep(0.3, 0.4, sF) * vec3<f32>(0.35, 0.45, 0.6)
    + smoothstep(0.3, 0.4, sE) * vec3<f32>(1.0, 0.75, 0.5) * eggL.w * 0.8);
  return col;
}`;

/**
 * An opaque surface (the lip, material 2; the egg, 3; the goo, 4; the tear's rim, 5), straight colour. The egg is candled: an emissive
 * core strongest where it faces the eye, a few faint vessels, a hard rim; the lip is the bezel's grey going to wet flesh-pink as it bows.
 * The GOO is milky, glossy mucus (the look-dev: clear strands read as dark specks against the glowing egg): an opaque off-white-pink base, a
 * wide soft fake subsurface warming it toward the egg, a hard white clear coat. The TEAR'S RIM is wet flesh, pinker at the very edge, lit
 * through from the egg, with the clear coat's hard highlight.
 * Includes: scrLight, scrVeins, scrTear, scrEllipsoid.
 */
export const SCR_SURFACE = /* wgsl */ `fn scrSurface(p: vec3<f32>, n: vec3<f32>, rd: vec3<f32>, mat: f32, p1: vec4<f32>, d: vec4<f32>, lip: vec4<f32>, lamp: vec4<f32>) -> vec3<f32> {
  let c = vec3<f32>(0.0, d.z, d.y);
  let glow = p1.w;
  let toE = c - p;
  let dE = max(length(toE), 0.0001);
  let E = toE / dE;
  if (mat > 4.5) {
    let edge = 1.0 - smoothstep(0.0, ${f(TEAR_RIM.band)}, max(scrTear(p, p1.x, lip.w).x, 0.0));
    let base = mix(vec3<f32>(0.5, 0.15, 0.14), vec3<f32>(0.86, 0.38, 0.36), edge);
    let through = vec3<f32>(1.0, 0.38, 0.22) * glow * (0.25 + 0.75 * max(dot(-n, E), 0.0)) / (1.0 + dE * dE * 10.0) * (0.4 + 0.6 * edge);
    return scrLight(p, n, rd, lamp, vec4<f32>(c, glow * 0.6), base, 1.6) + through;
  }
  if (mat > 3.5) {
    // The fake subsurface: the goo glows with the egg's light, strongest on it and on the side facing it, and lit through where the egg
    // is behind it from the eye (on the egg its outward side faces away from the centre; without this it reads as dark specks).
    let near = 1.0 / (1.0 + pow(max(scrEllipsoid(p - c, ${EGG_R}), 0.0) / 0.08, 2.0));
    let wrap = 0.5 + 0.5 * dot(n, E);
    let thru = pow(max(dot(rd, E), 0.0), 2.0);
    let sss = vec3<f32>(1.0, 0.66, 0.48) * glow * near * (0.35 + 0.4 * wrap + 0.5 * thru);
    let fres = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);
    let base = vec3<f32>(0.82, 0.74, 0.7);
    return scrLight(p, n, rd, lamp, vec4<f32>(c, glow * 0.6), base, 1.5) + base * sss + vec3<f32>(0.9, 0.88, 0.85) * fres * 0.25;
  }
  if (mat > 2.5) {
    let u = normalize((p - c) / ${EGG_R});
    let facing = max(dot(n, -rd), 0.0);
    let ves = scrVeins(vec2<f32>(atan2(u.x, u.z) * 0.12, u.y * 0.2));
    let core = vec3<f32>(1.0, 0.52, 0.2) * glow * (0.25 + 1.1 * pow(facing, 1.5)) * (1.0 - 0.45 * ves);
    let lit = scrLight(p, n, rd, lamp, vec4<f32>(c, 0.0), vec3<f32>(0.85, 0.62, 0.45) * 0.5, 1.0);
    let rim = smoothstep(0.8, 0.84, 1.0 - facing) * vec3<f32>(1.0, 0.7, 0.45) * (0.25 + 0.6 * glow);
    return core + lit + rim;
  }
  let pink = vec3<f32>(0.5, 0.16, 0.15);
  let grey = vec3<f32>(0.3, 0.31, 0.3);
  return scrLight(p, n, rd, lamp, vec4<f32>(c, glow * 0.5), mix(grey, pink, lip.z), 0.3 + 0.7 * lip.z);
}`;

/**
 * THE SHEET at p (straight colour, opacity): glass showing the stretched picture while `thin` is low, veined translucent flesh lit from
 * behind by the egg as it thins and stretches; more transparent as `thin` rises. Includes: sacZ, scrPicture, scrVeins, scrLight.
 */
export const SCR_SHEET = /* wgsl */ `fn scrSheet(p: vec3<f32>, n: vec3<f32>, rd: vec3<f32>, foot: f32, p0: vec4<f32>, p1: vec4<f32>, d: vec4<f32>, lip: vec4<f32>, tm: f32, lamp: vec4<f32>, picTab: texture_2d<f32>, scrTex: texture_2d<f32>, scrSamp: sampler) -> vec4<f32> {
  let c = vec3<f32>(0.0, d.z, d.y);
  let glow = p1.w;
  let h = sacZ(p.x, p.y, p0, p1, d, lip, tm);
  let th = smoothstep(0.0, 1.0, p0.z);
  let stretch = clamp(h.x / ${f(SAC_MAX)}, 0.0, 1.0);
  let flesh = clamp(max(th, stretch * 0.8), 0.0, 1.0);
  let pic = scrPicture(p.x, p.y, lip, foot, picTab, scrTex, scrSamp);
  let ves = scrVeins(vec2<f32>(p.x / lip.x * ${f(GLASS.hw)}, p.y / lip.y * ${f(GLASS.hh)}) * (1.0 + 0.6 * stretch));
  let fleshCol = mix(vec3<f32>(0.45, 0.13, 0.11), vec3<f32>(0.22, 0.03, 0.04), ves);
  let toE = c - p;
  let dE = max(length(toE), 0.0001);
  let back = max(dot(-n, toE / dE), 0.0);
  let trans = vec3<f32>(1.0, 0.42, 0.16) * glow * (0.5 + 0.8 * back) / (1.0 + dE * dE * 10.0) * (1.0 - 0.7 * ves);
  let emit = pic.rgb * (1.0 - 0.85 * flesh) + trans * flesh;
  let base = mix(vec3<f32>(0.006, 0.007, 0.008), fleshCol, flesh);
  let col = emit + scrLight(p, n, rd, lamp, vec4<f32>(c, 0.0), base, 1.0);
  let a = mix(1.0, mix(0.5, 0.85, ves), th);
  return vec4<f32>(col, a);
}`;

/**
 * THE PASS: eye and pos in the proxy's local (screen) frame; p0, p1, d, lip as sacZ; tm the clock; lamp (xyz, strength); cfg.x the pixel's
 * angular size (2 tan(fov / 2) / height); gooTex and goo as mapScr. Returns (straight colour, packed hit: floor(t * DEPTH_Q) + alpha, 0 on a
 * miss). Behind a translucent sheet with nothing else there, the eye meets the glass's backing: the picture, dim, warmed by the egg's glow
 * (round one's dark tube read as a hole once the tear opened).
 * Includes: scrMarch, scrNormal, scrSheet, scrSurface, scrOpening, scrPicture.
 */
export const SCR_SHADE = /* wgsl */ `fn scrShade(eye: vec3<f32>, pos: vec3<f32>, p0: vec4<f32>, p1: vec4<f32>, d: vec4<f32>, lip: vec4<f32>, tm: f32, lamp: vec4<f32>, cfg: vec4<f32>, picTab: texture_2d<f32>, scrTex: texture_2d<f32>, scrSamp: sampler, gooTex: texture_2d<f32>, goo: vec4<f32>) -> vec4<f32> {
  let ro = eye;
  let rd = normalize(pos - eye);
  let rdn = select(rd, vec3<f32>(0.000001), abs(rd) < vec3<f32>(0.000001));
  let inv = 1.0 / rdn;
  let ta = (${v3(SCREEN_PROXY.min)} - ro) * inv;
  let tb = (${v3(SCREEN_PROXY.max)} - ro) * inv;
  let tn = max(max(min(ta.x, tb.x), min(ta.y, tb.y)), min(ta.z, tb.z));
  let tf = min(min(max(ta.x, tb.x), max(ta.y, tb.y)), max(ta.z, tb.z));
  let t0 = max(tn, 0.0);
  if (tf < t0) { return vec4<f32>(0.0); }
  let h1 = scrMarch(ro, rd, t0, tf, p0, p1, d, lip, tm, 1.0, cfg.x, gooTex, goo);
  if (cfg.y > 0.5) {
    // Debug view (cfg.y = 1): red the first march's steps over the budget, green a hit, blue the material over 5; opaque, at the box.
    return vec4<f32>(h1.z / ${f(MAX_STEPS)}, select(0.0, 1.0, h1.x > 0.0), h1.y / 5.0, floor(t0 * ${f(DEPTH_Q)}) + 0.999);
  }
  if (h1.x < 0.0) { return vec4<f32>(0.0); }
  let p = ro + rd * h1.x;
  let foot = h1.x * cfg.x;
  var col = vec3<f32>(0.0);
  var alpha = 1.0;
  if (h1.y < 1.5) {
    let n = scrNormal(p, p0, p1, d, lip, tm, 1.0, gooTex, goo);
    let sk = scrSheet(p, n, rd, foot, p0, p1, d, lip, tm, lamp, picTab, scrTex, scrSamp);
    var behind = vec4<f32>(0.0);
    if (sk.a < 0.999) {
      let h2 = scrMarch(ro, rd, h1.x + 0.003, tf, p0, p1, d, lip, tm, 0.0, cfg.x, gooTex, goo);
      if (h2.x > 0.0) {
        let p2 = ro + rd * h2.x;
        let n2 = scrNormal(p2, p0, p1, d, lip, tm, 0.0, gooTex, goo);
        behind = vec4<f32>(scrSurface(p2, n2, rd, h2.y, p1, d, lip, lamp), 1.0);
      } else if (rd.z < 0.0) {
        let tt = (${f(SHEET_FLOOR)} - ro.z) / rd.z;
        let pf = ro + rd * tt;
        if (tt > h1.x && scrOpening(vec3<f32>(pf.xy, 0.0), lip, d.w) < 0.0) {
          let back = scrPicture(pf.x, pf.y, lip, foot, picTab, scrTex, scrSamp);
          behind = vec4<f32>(back.rgb * 0.4 + vec3<f32>(0.06, 0.024, 0.016) * (0.4 + p1.w), 1.0);
        }
      }
    }
    let pre = sk.rgb * sk.a + behind.rgb * behind.a * (1.0 - sk.a);
    alpha = sk.a + behind.a * (1.0 - sk.a);
    col = pre / max(alpha, 0.0001);
  } else {
    let n = scrNormal(p, p0, p1, d, lip, tm, 1.0, gooTex, goo);
    col = scrSurface(p, n, rd, h1.y, p1, d, lip, lamp);
  }
  return vec4<f32>(max(col, vec3<f32>(0.0)), floor(h1.x * ${f(DEPTH_Q)}) + clamp(alpha, 0.001, 0.999));
}`;
