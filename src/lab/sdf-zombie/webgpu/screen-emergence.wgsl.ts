// src/lab/sdf-zombie/webgpu/screen-emergence.wgsl.ts
//
// THE SCREEN EMERGENCE's march and shading (spec docs/superpowers/specs/2026-10-11-screen-emergence-lab-spike-design.md section 4; plan
// Task 6, round one: the sheet, the lip, the egg and the picture). Hand-written WGSL, one fn per string (wgslFn takes one), constants built
// from emergence-field.ts's tables with the same f()/v3() helpers egg.wgsl.ts uses: this is that module's twin.
//
// FRAME: everything runs in the screen's frame (origin at the glass centre, +z out of the glass toward the room, metres), which is the proxy
// box's LOCAL space: the host brings the eye and the fragment into it with modelWorldMatrixInverse, so the CRT may be turned any way.
//
// THE FIELD (mapScr, materials 1 sheet, 2 lip, 3 egg; 4 goo and 5 tear rim are Task 7's):
//   * the SHEET is a thin shell, |inside| - thickness, round a solid "sac": the dome (the field's domeZ, clipped to the opening) smooth-
//     unioned with the egg grown by the skin, floored a little behind the glass: the field module's sacSolid (its twin). The blend is
//     sacBlend's: narrow round the egg's front cap, WIDE (SAC_BLEND.tent) behind its equator, so the wall curves from the equator back under
//     the egg and out along the dome to the lip, a balloon on its neck. (Round one swept the egg's silhouette straight back to the glass:
//     a rigid tube.) The solid's top seen from the front is sacZ (tested), so the picture, the thickness and the goo's anchors still read
//     the heightfield. The dome's own distance is first-order, (z - h) / sqrt(1 + |grad h|^2), with the gradient analytic.
//   * the LIP is a flared sleeve of rounded-rectangle section (the glass's shape, spec "a rounded rectangular rim"), from the bevel's foot
//     at the glass plane out to the bowed rim at lipZ, rounded at the top. At rest it is a gasket hidden under the CRT mesh's bevel.
//   * the EGG is iq's approximate ellipsoid distance.
// The sheet's opening (its clip) is the sleeve's inner face, so the sheet meets the lip exactly.
//
// THE PASS (scrShade): ray-box clip, a march of MAX_STEPS from the box entry; if the first hit is the sheet, shade it and march again from
// just past the skin WITHOUT the sheet for what lies behind (the egg, the lip, else the CRT's dark tube or the room), and composite by the
// sheet's opacity. Returns (straight colour, packed): packed = floor(t * DEPTH_Q) + alpha (alpha < 1), so ONE call carries the first hit's
// distance for depthNode and the coverage; 0 on a miss.
import { DOME_EXP, EGG, GLASS, PICTURE_TABLE_N, RIPPLE, SAC_BLEND, SAC_MAX, SKIN, THICK0 } from './emergence-field';

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

const EGG_R = v3([EGG.rx, EGG.ry, EGG.rz]);

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
 * d = (sacExtent, eggCz, eggCy, lipZ) and lip = (hw, hh, smooth(lipBow), 0), computed on the CPU each frame from the field module so this
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
 * THE FIELD: (distance, material) at p. Materials: 1 the sheet, 2 the lip, 3 the egg (4 goo and 5 the tear's rim: Task 7). `sheetOn` 0
 * leaves the sheet out (the march behind the skin). The sheet's half-thickness is sheetThickness's twin (thinner with the stretch and `thin`).
 * Includes: sacZ, scrOpening, scrLip, scrEllipsoid, scrSmin.
 */
export const SCR_MAP = /* wgsl */ `fn mapScr(p: vec3<f32>, p0: vec4<f32>, p1: vec4<f32>, d: vec4<f32>, lip: vec4<f32>, tm: f32, sheetOn: f32) -> vec2<f32> {
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
    let stretch = clamp(h.x / ${f(SAC_MAX)}, 0.0, 1.0) * (1.0 - min(h.w, 1.0) * 0.5);
    let thick = ${f(THICK0)} * (1.0 - 0.8 * max(stretch, smoothstep(0.0, 1.0, p0.z) * 0.6)) + 0.0006;
    // Task 7's tear: sheet = max(sheet, tearR(theta) - length(p.xy - tip)), material 5 on its rim.
    let sheet = (abs(inside) - thick) * 0.9;
    if (sheet < best.x) { best = vec2<f32>(sheet, 1.0); }
  }
  // Task 7's goo (material 4) smooth-unions here.
  return best;
}`;

/** The field's normal (the tetrahedron form, four mapScr calls). Includes: mapScr. */
export const SCR_NORMAL = /* wgsl */ `fn scrNormal(p: vec3<f32>, p0: vec4<f32>, p1: vec4<f32>, d: vec4<f32>, lip: vec4<f32>, tm: f32, sheetOn: f32) -> vec3<f32> {
  let e = vec2<f32>(1.0, -1.0) * 0.0007;
  return normalize(
    e.xyy * mapScr(p + e.xyy, p0, p1, d, lip, tm, sheetOn).x +
    e.yyx * mapScr(p + e.yyx, p0, p1, d, lip, tm, sheetOn).x +
    e.yxy * mapScr(p + e.yxy, p0, p1, d, lip, tm, sheetOn).x +
    e.xxx * mapScr(p + e.xxx, p0, p1, d, lip, tm, sheetOn).x);
}`;

/** The march from t0 to t1: (t, material, steps) of the first hit, or (-1, 0, steps). The hit tolerance grows with the pixel footprint
 *  (pix = the pixel's angular size). Includes: mapScr. */
export const SCR_MARCH = /* wgsl */ `fn scrMarch(ro: vec3<f32>, rd: vec3<f32>, t0: f32, t1: f32, p0: vec4<f32>, p1: vec4<f32>, d: vec4<f32>, lip: vec4<f32>, tm: f32, sheetOn: f32, pix: f32) -> vec3<f32> {
  var t = t0;
  for (var i = 0; i < ${MAX_STEPS}; i = i + 1) {
    if (t > t1) { return vec3<f32>(-1.0, 0.0, f32(i)); }
    let m = mapScr(ro + rd * t, p0, p1, d, lip, tm, sheetOn);
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
 * An opaque surface (the lip, material 2; the egg, material 3), straight colour. The egg is candled: an emissive core strongest where it
 * faces the eye, a few faint vessels, a hard rim; the lip is the bezel's grey going to wet flesh-pink as it bows.
 * Includes: scrLight, scrVeins.
 */
export const SCR_SURFACE = /* wgsl */ `fn scrSurface(p: vec3<f32>, n: vec3<f32>, rd: vec3<f32>, mat: f32, p1: vec4<f32>, d: vec4<f32>, lip: vec4<f32>, lamp: vec4<f32>) -> vec3<f32> {
  let c = vec3<f32>(0.0, d.z, d.y);
  let glow = p1.w;
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
 * angular size (2 tan(fov / 2) / height). Returns (straight colour, packed hit: floor(t * DEPTH_Q) + alpha, 0 on a miss).
 * Includes: scrMarch, scrNormal, scrSheet, scrSurface, scrOpening.
 */
export const SCR_SHADE = /* wgsl */ `fn scrShade(eye: vec3<f32>, pos: vec3<f32>, p0: vec4<f32>, p1: vec4<f32>, d: vec4<f32>, lip: vec4<f32>, tm: f32, lamp: vec4<f32>, cfg: vec4<f32>, picTab: texture_2d<f32>, scrTex: texture_2d<f32>, scrSamp: sampler) -> vec4<f32> {
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
  let h1 = scrMarch(ro, rd, t0, tf, p0, p1, d, lip, tm, 1.0, cfg.x);
  if (cfg.y > 0.5) {
    // Debug view (cfg.y = 1): red the first march's steps over the budget, green a hit, blue the material over 3; opaque, at the box.
    return vec4<f32>(h1.z / ${f(MAX_STEPS)}, select(0.0, 1.0, h1.x > 0.0), h1.y / 3.0, floor(t0 * ${f(DEPTH_Q)}) + 0.999);
  }
  if (h1.x < 0.0) { return vec4<f32>(0.0); }
  let p = ro + rd * h1.x;
  let foot = h1.x * cfg.x;
  var col = vec3<f32>(0.0);
  var alpha = 1.0;
  if (h1.y < 1.5) {
    let n = scrNormal(p, p0, p1, d, lip, tm, 1.0);
    let sk = scrSheet(p, n, rd, foot, p0, p1, d, lip, tm, lamp, picTab, scrTex, scrSamp);
    var behind = vec4<f32>(0.0);
    if (sk.a < 0.999) {
      let h2 = scrMarch(ro, rd, h1.x + 0.003, tf, p0, p1, d, lip, tm, 0.0, cfg.x);
      if (h2.x > 0.0) {
        let p2 = ro + rd * h2.x;
        let n2 = scrNormal(p2, p0, p1, d, lip, tm, 0.0);
        behind = vec4<f32>(scrSurface(p2, n2, rd, h2.y, p1, d, lip, lamp), 1.0);
      } else if (rd.z < 0.0) {
        let tt = (${f(SHEET_FLOOR)} - ro.z) / rd.z;
        let pf = ro + rd * tt;
        if (tt > h1.x && scrOpening(vec3<f32>(pf.xy, 0.0), lip, d.w) < 0.0) {
          behind = vec4<f32>(vec3<f32>(0.03, 0.012, 0.01) * (0.4 + p1.w), 1.0);
        }
      }
    }
    let pre = sk.rgb * sk.a + behind.rgb * behind.a * (1.0 - sk.a);
    alpha = sk.a + behind.a * (1.0 - sk.a);
    col = pre / max(alpha, 0.0001);
  } else {
    let n = scrNormal(p, p0, p1, d, lip, tm, 1.0);
    col = scrSurface(p, n, rd, h1.y, p1, d, lip, lamp);
  }
  return vec4<f32>(max(col, vec3<f32>(0.0)), floor(h1.x * ${f(DEPTH_Q)}) + clamp(alpha, 0.001, 0.999));
}`;
