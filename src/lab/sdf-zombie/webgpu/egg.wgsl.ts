// src/lab/sdf-zombie/webgpu/egg.wgsl.ts
//
// The control room's egg (spec 2026-09-30-night-train-egg-ending-design.md §2), hand-written WGSL.
// One proxy box per egg; per pixel the view ray is intersected analytically with three nested
// ellipsoids and composed front to back in a fixed order, so the egg needs no transparency sorting
// while the player walks round it:
//   outer shell front (veins, fresnel) -> inner egg front (milk, spots) -> inside the inner egg
//   (milk volume, the core glow, the soft figure) -> inner egg back (spots) -> outer shell back.
// The figure and the glow are Gaussians integrated in closed form along the ray, so there is no
// marching. Output is premultiplied colour with alpha = 1 - transmittance. Twin: egg-look.ts; its
// tables (EGG, FIGURE) build the constants here. One fn per string (wgslFn takes one).

import { EGG, FIGURE } from './egg-look';

const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const v3 = (v: readonly number[]) => `vec3<f32>(${f(v[0]!)}, ${f(v[1]!)}, ${f(v[2]!)})`;

/** Ray vs ellipsoid: (t0, t1), or (1, -1) when it misses or lies behind. */
export const EGG_RAY = /* wgsl */ `fn eggRay(o: vec3<f32>, d: vec3<f32>, c: vec3<f32>, r: vec3<f32>) -> vec2<f32> {
  let oq = (o - c) / r;
  let dq = d / r;
  let a = dot(dq, dq);
  let b = dot(oq, dq);
  let cc = dot(oq, oq) - 1.0;
  let disc = b * b - a * cc;
  if (disc < 0.0) { return vec2<f32>(1.0, -1.0); }
  let s = sqrt(disc);
  let t1 = (-b + s) / a;
  if (t1 < 0.0) { return vec2<f32>(1.0, -1.0); }
  return vec2<f32>((-b - s) / a, t1);
}`;

/** Closed-form line integral of exp(-|(p - c) / s|^2) along the ray, and the t of closest approach. */
export const EGG_GAUSS = /* wgsl */ `fn eggGauss(o: vec3<f32>, d: vec3<f32>, c: vec3<f32>, s: vec3<f32>) -> vec2<f32> {
  let oq = (o - c) / s;
  let dq = d / s;
  let dd = dot(dq, dq);
  let t = -dot(oq, dq) / dd;
  let h = oq + dq * t;
  return vec2<f32>(1.7724539 / sqrt(dd) * exp(-dot(h, h)), t);
}`;

/** Spot coverage 0..1 at a unit direction on the inner egg: golden-spiral centres, radii 0.10 to 0.31 rad. */
export const EGG_SPOTS = /* wgsl */ `fn eggSpots(u: vec3<f32>) -> f32 {
  var best = 0.0;
  for (var i = 0; i < ${EGG.spots}; i = i + 1) {
    let fi = f32(i);
    let y = 1.0 - 2.0 * (fi + 0.5) / ${f(EGG.spots)};
    let r = sqrt(max(0.0, 1.0 - y * y));
    let phi = fi * ${String(Math.PI * (3 - Math.sqrt(5)))};
    let dir = vec3<f32>(cos(phi) * r, y, sin(phi) * r);
    let rad = 0.1 + 0.035 * f32((i * 5) % 7);
    let ang = acos(clamp(dot(u, dir), -1.0, 1.0));
    best = max(best, 1.0 - smoothstep(rad * 0.75, rad, ang));
  }
  return best;
}`;

/** Red veins on the outer shell: nine wobbling meridians that thin out towards the poles. 0..1. */
export const EGG_VEINS = /* wgsl */ `fn eggVeins(u: vec3<f32>) -> f32 {
  let th = acos(clamp(u.y, -1.0, 1.0));
  let ph = atan2(u.z, u.x);
  var v = 0.0;
  for (var i = 0; i < 9; i = i + 1) {
    let fi = f32(i);
    let base = 6.2831853 * fi / 9.0 + 0.3 * sin(fi * 2.3);
    var dph = ph - base - 0.25 * sin(th * 3.2 + fi * 1.7);
    dph = dph - 6.2831853 * floor(dph / 6.2831853 + 0.5);
    let dist = abs(dph) * sin(th);
    v = max(v, exp(-(dist * dist) / 0.0009));
  }
  return v;
}`;

const FIG_POS = FIGURE.map(b => v3(b.pos)).join(', ');
const FIG_SC = FIGURE.map(b => v3(b.sc)).join(', ');

/**
 * The egg's rgba for a proxy-box fragment. axes: x outer horizontal semi-axis, y outer vertical,
 * z inner scale, w the inner centre's drop. look: x pulse 0..1, y resolve 0..1, z sim time.
 * milk: x extinction per metre, y inner front alpha, z shell alpha, w the figure's strength.
 * Includes: eggRay, eggGauss, eggSpots, eggVeins.
 */
export const EGG_SHADE = /* wgsl */ `fn eggShade(wpos: vec3<f32>, eye: vec3<f32>, c: vec3<f32>, axes: vec4<f32>, look: vec4<f32>, milk: vec4<f32>) -> vec4<f32> {
  let o = eye;
  let d = normalize(wpos - eye);
  let outerR = vec3<f32>(axes.x, axes.y, axes.x);
  let ro = eggRay(o, d, c, outerR);
  if (ro.x > ro.y) { return vec4<f32>(0.0); }
  let pulse = look.x;
  let blur = mix(${f(EGG.blurFar)}, ${f(EGG.blurNear)}, clamp(look.y, 0.0, 1.0));
  var col = vec3<f32>(0.0);
  var T = 1.0;

  // Outer shell, front face: a thin warm film, brighter at grazing angles, with red veins.
  let pf = o + d * ro.x;
  let nf = normalize((pf - c) / (outerR * outerR));
  let fresF = pow(1.0 - abs(dot(nf, d)), 2.5);
  let aSF = milk.z * (0.35 + 0.65 * fresF);
  let aVF = 0.55 * eggVeins(normalize((pf - c) / outerR));
  let shellF = vec3<f32>(0.95, 0.55, 0.38) * (0.25 + 0.75 * fresF) * (0.6 + 0.6 * pulse);
  let veinCol = vec3<f32>(0.9, 0.08, 0.05) * (0.5 + 1.1 * pulse);
  col = col + T * (shellF * aSF + veinCol * aVF * (1.0 - aSF));
  T = T * (1.0 - aSF) * (1.0 - aVF);

  // Inner egg.
  let k = axes.z;
  let ci = c + vec3<f32>(0.0, axes.w, 0.0);
  let innerR = outerR * k;
  let ri = eggRay(o, d, ci, innerR);
  if (ri.x <= ri.y) {
    let chord = ri.y - ri.x;
    let tm = exp(-milk.x * chord);
    let milkCol = vec3<f32>(0.95, 0.72, 0.55) * (0.22 + 0.4 * pulse);
    let spotCol = vec3<f32>(0.45, 0.85, 0.85) * (0.45 + 0.55 * pulse);

    // Front surface: a little milk and the spots.
    let ui = normalize((o + d * ri.x - ci) / innerR);
    let aMF = milk.y;
    let aSpF = 0.8 * eggSpots(ui);
    col = col + T * (milkCol * aMF + spotCol * aSpF * (1.0 - aMF));
    T = T * (1.0 - aMF) * (1.0 - aSpF);

    // Inside: the core glow, and the figure in front of it (from this side) darkening it.
    let kk = k / ${f(EGG.innerScale)};
    let gc = eggGauss(o, d, ci + ${v3(EGG.coreOffset)} * kk, ${v3(EGG.coreScale)} * kk);
    let fo = ${v3(EGG.figureOffset)};
    var bp = array<vec3<f32>, ${FIGURE.length}>(${FIG_POS});
    var bs = array<vec3<f32>, ${FIGURE.length}>(${FIG_SC});
    var tauFront = 0.0;
    var tauAll = 0.0;
    for (var j = 0; j < ${FIGURE.length}; j = j + 1) {
      let g = eggGauss(o, d, ci + (fo + bp[j]) * kk, bs[j] * kk * blur);
      let tj = milk.w / (blur * blur * blur) * g.x;
      tauAll = tauAll + tj;
      if (g.y < gc.y) { tauFront = tauFront + tj; }
    }
    let coreCol = vec3<f32>(1.0, 0.55, 0.25);
    let emit = coreCol * ${f(EGG.coreGain)} * gc.x * (0.55 + 0.45 * pulse) * exp(-tauFront) * sqrt(tm);
    let scatter = milkCol * (1.0 - tm) * 0.55 * exp(-tauAll * 0.8);
    col = col + T * (emit + scatter);
    T = T * tm * exp(-tauAll * 0.7);

    // Back surface: the spots seen through the milk.
    let ub = normalize((o + d * ri.y - ci) / innerR);
    let aSpB = 0.25 * eggSpots(ub);
    col = col + T * spotCol * aSpB * 0.8;
    T = T * (1.0 - aSpB);
  }

  // Outer shell, back face.
  let pb = o + d * ro.y;
  let nb = normalize((pb - c) / (outerR * outerR));
  let fresB = pow(1.0 - abs(dot(nb, d)), 2.5);
  let aSB = milk.z * (0.3 + 0.7 * fresB);
  let aVB = 0.35 * eggVeins(normalize((pb - c) / outerR));
  let shellB = vec3<f32>(0.95, 0.55, 0.38) * (0.25 + 0.75 * fresB) * (0.6 + 0.6 * pulse);
  col = col + T * (shellB * aSB + veinCol * aVB * (1.0 - aSB));
  T = T * (1.0 - aSB) * (1.0 - aVB);
  return vec4<f32>(col, 1.0 - T);
}`;
