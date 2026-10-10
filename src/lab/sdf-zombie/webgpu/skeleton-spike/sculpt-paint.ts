// THE SECOND PAINT of the sculpted skull (sculpt-variant.ts: `paint`, `full-1cm`, `full`, the default). The first paint (mesh-appearance.ts)
// draws round dark sockets, a nose ellipse and two rows of square teeth. This one draws the face a human skull has,
// from the second sculpt's own landmark table (mesh-skull-2.ts SKULL2_FACE), so it sits on the second sculpt's bone
// (`full`) and stands in for that bone's shapes on the first sculpt (`paint`). It is drawn on the characters it is
// fitted to (sculpt-variant.ts sculptPaintOf); the others keep the first paint. What it draws:
//   orbits with the sculpt's drooping outline, darker with depth, and a stained halo outside the rim;
//   the pear-shaped nasal aperture;
//   long separate teeth: crowns that narrow toward the gum, dark wedges between them, a dark gum line, root ridges
//     above it, and a pointed canine; the parting of the jaws dark between the two rows;
//   shade in the temples and under the cheekbones;
//   a few bold dark lines: the coronal and sagittal sutures, and four cracks.
// The same fields give a HEIGHT (metres), and its gradient tilts the shading normal, so light catches the teeth, the
// orbit rims and the ridges. On the first sculpt the height also carries the brow ridge, the cheekbones and the
// hollows the bone there lacks (`relief`).
//
// What the game draws at fighting distance is a head some 40 pixels tall. Detail finer than a pixel turns to
// crawling dots there, so the tooth pattern and the tilt both fade with the pixel's footprint on the surface (`foot`,
// metres per pixel): far away the teeth are one light band over one dark one.
//
// Every WGSL function below has a TypeScript twin of the same name, and they must stay in lockstep. The WGSL is
// written from the layout by sculptPaintWgsl, so a number changed in a table changes both.
import type { Vec3 } from '../../types';
import { boneHash3, boneNoise3 } from './mesh-appearance';
import { SKULL2_FACE, skull2Nose, skull2Orbit, skull2Raise } from './mesh-skull-2';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const band = (a: number, b: number, soft: number, v: number) => smoothstep(a - soft, a + soft, v) * (1 - smoothstep(b - soft, b + soft, v));

/** Most teeth a row has on one side (the WGSL arrays' length less one). */
export const SCULPT_TEETH_MAX = 8;

export interface SculptPaintLayout {
  /** The teeth's lines (normalized y): the tips of each row, and the line its roots fade out at. */
  upperTip: number; upperRoot: number; lowerTip: number; lowerRoot: number;
  /** Each row's tooth boundaries along the arch coordinate, from the middle outward: `count` + 1 values. */
  upper: readonly number[]; lower: readonly number[]; count: number;
  /** The tooth (index from the middle) that is the pointed canine. */
  fang: number;
  /** The arch coordinate is |x| + wrap x max(0, turn - z): on the second sculpt the arch turns back at `turn` and the
   *  side teeth are counted along z. 0: a flat face. */
  wrap: number; turn: number;
  /** How far out (arch coordinate) the dark parting between the rows runs. */
  mouthHalfW: number;
  /** The painted brow, cheekbone and hollows' share of the height: 1 where the bone lacks them, 0 where it has them. */
  relief: number;
}

/** The first sculpt's bone: a flat face, the slit between y -0.342 and -0.418, a tooth shelf under it. */
export const SCULPT_PAINT_SHAPE1: SculptPaintLayout = {
  upperTip: -0.342, upperRoot: -0.19, lowerTip: -0.418, lowerRoot: -0.53,
  upper: [0, 0.09, 0.175, 0.26, 0.34, 0.415, 0.485, 0.485, 0.485], lower: [0, 0.075, 0.15, 0.235, 0.32, 0.40, 0.475, 0.475, 0.475], count: 6,
  fang: 2, wrap: 0, turn: 0, mouthHalfW: 0.49, relief: 1,
};
/** The second sculpt's bone: the teeth on its arches, the side teeth counted back along the arch. */
export const SCULPT_PAINT_SHAPE2: SculptPaintLayout = {
  upperTip: SKULL2_FACE.teeth.upperTip, upperRoot: SKULL2_FACE.teeth.upperRoot, lowerTip: SKULL2_FACE.teeth.lowerTip, lowerRoot: SKULL2_FACE.teeth.lowerRoot,
  upper: [0, 0.085, 0.165, 0.235, 0.285, 0.33, 0.40, 0.475, 0.55], lower: [0, 0.07, 0.14, 0.215, 0.275, 0.33, 0.40, 0.475, 0.55], count: 8,
  fang: 2, wrap: 0.6, turn: 0.72, mouthHalfW: 0.62, relief: 0,
};

/** The tooth's numbers: the crown's share of a row's height, how far a crown and a root ridge stand proud (m), and
 *  the footprint (m per pixel) over which the pattern fades to a plain band. */
export const SCULPT_TOOTH = { crown: 0.62, proud: 0.0014, ridge: 0.0006, fadeFrom: 0.004, fadeTo: 0.009 } as const;
/** The height's other parts (m): the orbit's rim, a line's groove, the painted brow, cheekbone and hollows. */
export const SCULPT_HEIGHT = { rim: 0.0008, groove: 0.0008, brow: 0.0025, malar: 0.002, temple: 0.003, underCheek: 0.003 } as const;
/** The tilt fades between these footprints (m per pixel), and is scaled by `gain`. */
export const SCULPT_BUMP = { fadeFrom: 0.0025, fadeTo: 0.007, gain: 1.0, eps: 0.004 } as const;

/** One row's teeth at the normalized point: [crown, root ridge, dark, height (m)]. `crown` is 1 on enamel; `dark` 1
 *  in the wedges between crowns, in the notches between tips and on the gum line; the ridge is the root's swell above
 *  the gum line. */
export function sculptTeeth(L: SculptPaintLayout, q: Vec3): [number, number, number, number] {
  const s = Math.abs(q[0]) + L.wrap * Math.max(0, L.turn - q[2]);
  const upper = q[1] > (L.upperTip + L.lowerTip) * 0.5;
  const tip = upper ? L.upperTip : L.lowerTip, root = upper ? L.upperRoot : L.lowerRoot;
  // 0 at the tips, 1 where the roots fade out; negative in the parting.
  const t = (q[1] - tip) / (root - tip);
  let crown = 0, ridge = 0, dark = 0, height = 0;
  if (t > -0.05 && t < 1.05) {
    for (let i = 0; i < L.count; i++) {
      const e0 = upper ? L.upper[i]! : L.lower[i]!, e1 = upper ? L.upper[i + 1]! : L.lower[i + 1]!;
      if (s < e0 || s >= e1) continue;
      const au = Math.abs((s - (e0 + e1) * 0.5) / Math.max((e1 - e0) * 0.5, 1e-4));
      const fang = i === L.fang ? 1 : 0;
      const r = boneHash3([i, upper ? 1 : 0, 7]);
      const cf = SCULPT_TOOTH.crown + 0.10 * fang + (r - 0.5) * 0.06;
      const tc = t / cf;
      // The tip's edge: slightly round, a point on the canine, a little uneven from tooth to tooth.
      const tipLine = (0.10 + 0.45 * fang) * au * au + (r - 0.5) * 0.06 + 0.03;
      // The crown narrows from the tip to the gum, where its top is an arch.
      const w = mix(0.92, 0.60, clamp01(tc));
      const gum = 1 - 0.16 * au * au;
      crown = (1 - smoothstep(w - 0.10, w, au)) * smoothstep(tipLine - 0.03, tipLine + 0.03, tc) * (1 - smoothstep(gum - 0.04, gum + 0.04, tc));
      ridge = smoothstep(gum - 0.02, gum + 0.06, tc) * (1 - au * au) * (1 - smoothstep(cf + (1 - cf) * 0.3, 1, t));
      // Dark between the crowns and along the gum line, and a stain over the roots that the ridges stand out of.
      const stained = smoothstep(gum, gum + 0.10, tc) * (1 - smoothstep(cf + (1 - cf) * 0.5, 1, t)) * (1 - ridge) * 0.45;
      dark = Math.max(smoothstep(-0.02, 0.03, tc) * (1 - smoothstep(gum, gum + 0.10, tc)) * (1 - crown), stained);
      height = SCULPT_TOOTH.proud * Math.sqrt(Math.max(0, 1 - (au / w) * (au / w))) * crown + SCULPT_TOOTH.ridge * ridge;
    }
  }
  return [crown, ridge, dark, height];
}

/** The bold dark lines at the normalized point, 0..1: four cracks on the face (over the left brow with a fork to the
 *  temple, across the right cheekbone, down the lower jaw) and the coronal and sagittal sutures. */
export function sculptLines(q: Vec3): number {
  const [x, y, z] = q;
  const wy = boneNoise3([y * 9 + 3.1, 1.7, 5.3]) - 0.5;
  const wx = boneNoise3([x * 9 + 7.7, 4.1, 2.9]) - 0.5;
  const wz = boneNoise3([z * 14 + 1.3, 8.2, 6.4]) - 0.5;
  const line = (dist: number, w: number) => 1 - smoothstep(w, w * 2.2, Math.abs(dist));
  const face = smoothstep(0.2, 0.35, z);
  const brow = line(x - (-0.30 + 0.50 * (y - 0.56) + 0.07 * wy), 0.012) * band(0.56, 0.96, 0.02, y);
  const fork = line(y - (0.76 - 0.30 * (x + 0.20) + 0.05 * wx), 0.010) * band(-0.55, -0.20, 0.02, x);
  const cheek = line(x - (0.52 - 0.45 * y + 0.05 * wy), 0.010) * band(-0.26, 0.0, 0.02, y);
  const jaw = line(x - (-0.13 + 0.15 * (y + 0.56) + 0.04 * wy), 0.010) * band(-0.84, -0.56, 0.02, y);
  const coronalZ = 0.10 + 0.30 * (1 - y);
  const coronal = line(z - (coronalZ + 0.06 * (wx + wy)), 0.010) * smoothstep(0.28, 0.36, y);
  const sagittal = line(x - 0.05 * wz, 0.010) * smoothstep(0.50, 0.58, y) * (1 - smoothstep(coronalZ - 0.04, coronalZ, z));
  return Math.max(Math.max(brow, fork) * face, Math.max(cheek, jaw) * face, coronal, sagittal);
}

/** The relief's masks at the normalized point, each 0..1: [brow ridge, cheekbone, temple hollow, the hollow under
 *  the cheekbone]. The second sculpt has these in its bone; they shade both, and tilt the first sculpt's normals. */
export function sculptRelief(q: Vec3): [number, number, number, number] {
  const ax = Math.abs(q[0]), y = q[1], z = q[2];
  const { temple, zygoma, arch } = SKULL2_FACE;
  const up = skull2Raise(q[0], y, z);
  const t = Math.hypot((z - temple.z) / temple.halfZ, (y - temple.y) / temple.halfY);
  const hollow = (1 - smoothstep(0.55, 1, t)) * smoothstep(temple.minX, temple.minX + 0.12, ax);
  const under = smoothstep(0, 0.06, zygoma.y + zygoma.rise * Math.max(0, ax - arch.halfW) - y)
    * smoothstep(arch.halfW - 0.02, arch.halfW + 0.08, ax) * smoothstep(-0.50, -0.44, y) * smoothstep(0.0, 0.2, z);
  return [up.brow, up.malar, hollow, under];
}

/** The face's dark cavities at the normalized point: [orbit, nasal aperture, the parting of the jaws, the stained
 *  halo outside the orbit's and the aperture's rims]. Front of a head only. Orbit and aperture darken with depth. */
export function sculptCavity(L: SculptPaintLayout, q: Vec3, headFlag: number): [number, number, number, number] {
  const ax = Math.abs(q[0]), y = q[1], z = q[2];
  const front = smoothstep(0.05, 0.23, z) * headFlag;
  const o = skull2Orbit(ax, y), n = skull2Nose(ax, y);
  const orbit = (1 - smoothstep(-0.02, 0.012, o)) * mix(0.70, 1, 1 - smoothstep(0.50, 0.86, z)) * front;
  const nose = (1 - smoothstep(-0.015, 0.010, n)) * mix(0.75, 1, 1 - smoothstep(0.45, 0.80, z)) * front;
  const s = ax + L.wrap * Math.max(0, L.turn - z);
  const mouth = band(L.lowerTip, L.upperTip, 0.008, y) * (1 - smoothstep(L.mouthHalfW - 0.03, L.mouthHalfW + 0.02, s)) * front;
  const halo = Math.max(1 - smoothstep(0, 0.09, o), 1 - smoothstep(0, 0.06, n)) * front;
  return [orbit, nose, mouth, halo];
}

/** FLESH LEFT CLINGING TO EXPOSED BONE (2026-10-08, the owner's playtest: a face shot off showed clean ivory, "it should be
 *  dirtier and messier"). Ragged patches of torn tissue on a head's bone, where a wound's exposure reaches it: a two-octave
 *  noise thresholded into chunky islands, more of them the closer the wound and in the places flesh holds (the orbits, the
 *  nasal aperture and the stained halo round their rims). `cover` is the noise level at which a patch begins on plain bone
 *  with no wound near, lowered by `byExpo` at a wound's heart and by `byCavity` in the hollows; `soft` is the patch edge's
 *  width. Not a head, and not the soldier's (steel and his own stain): none. */
export const SCULPT_CLING = { cover: 0.62, byExpo: 0.12, byCavity: 0.22, soft: 0.04, from: 0.12, to: 0.4 } as const;

/** The share of the point that is torn flesh stuck to the bone (0..1): the patches' mask. `expo` the wound exposure
 *  there (after its smoothstep). */
export function sculptCling(L: SculptPaintLayout, pLocal: Vec3, q: Vec3, w: number, expo: number): number {
  const headFlag = Math.min(w, 1), soldierHead = w >= 1.5 ? 1 : 0;
  const n = boneNoise3([pLocal[0] * 22 + 8.3, pLocal[1] * 22 + 2.9, pLocal[2] * 22 + 14.1]) * 0.66
    + boneNoise3([pLocal[0] * 61 + 3.3, pLocal[1] * 61 + 19.7, pLocal[2] * 61 + 6.1]) * 0.34;
  const cav = sculptCavity(L, q, headFlag);
  const hold = Math.max(cav[0], cav[1], cav[3]);
  const t = SCULPT_CLING.cover - SCULPT_CLING.byExpo * expo - SCULPT_CLING.byCavity * hold;
  return smoothstep(t, t + SCULPT_CLING.soft, n) * smoothstep(SCULPT_CLING.from, SCULPT_CLING.to, expo) * headFlag * (1 - soldierHead);
}

/** The painted height (m) at the normalized point: the teeth's crowns and root ridges, a lip on the orbit's rim, a
 *  groove in every line, and, by the layout's `relief`, the brow ridge, the cheekbones and the hollows. */
export function sculptHeight(L: SculptPaintLayout, q: Vec3, headFlag: number): number {
  const front = smoothstep(0.05, 0.23, q[2]) * headFlag;
  const o = skull2Orbit(Math.abs(q[0]), q[1]);
  const rim = smoothstep(-0.01, 0.015, o) * (1 - smoothstep(0.02, 0.07, o));
  const rel = sculptRelief(q);
  const H = SCULPT_HEIGHT;
  return front * (sculptTeeth(L, q)[3] + H.rim * rim)
    + L.relief * headFlag * (H.brow * rel[0] + H.malar * rel[1] - H.temple * rel[2] - H.underCheek * rel[3])
    - H.groove * sculptLines(q) * headFlag;
}

/** The height's gradient in the normalized frame (m per unit of each axis), by forward differences. */
export function sculptHeightGrad(L: SculptPaintLayout, q: Vec3, headFlag: number): Vec3 {
  const e = SCULPT_BUMP.eps, h = sculptHeight(L, q, headFlag);
  return [
    (sculptHeight(L, [q[0] + e, q[1], q[2]], headFlag) - h) / e,
    (sculptHeight(L, [q[0], q[1] + e, q[2]], headFlag) - h) / e,
    (sculptHeight(L, [q[0], q[1], q[2] + e], headFlag) - h) / e,
  ];
}

/** The shading normal tilted by the painted height, and the pixel's footprint: [nx, ny, nz, foot]. `sigmaX`,
 *  `sigmaY` are the world position's change per pixel across and down the screen, `dqdx`, `dqdy` the normalized
 *  point's. The height's change per pixel is its gradient along those; the tilt is the surface gradient built from
 *  the two (no tangents needed). It fades out as the footprint grows past what the detail can stand. */
export function sculptPaintNormal(
  L: SculptPaintLayout, n: Vec3, sigmaX: Vec3, sigmaY: Vec3, dqdx: Vec3, dqdy: Vec3, q: Vec3, headFlag: number,
): [number, number, number, number] {
  const foot = Math.max(Math.hypot(...sigmaX), Math.hypot(...sigmaY));
  const fade = (1 - smoothstep(SCULPT_BUMP.fadeFrom, SCULPT_BUMP.fadeTo, foot)) * SCULPT_BUMP.gain * headFlag;
  if (fade <= 0) return [n[0], n[1], n[2], foot];
  const g = sculptHeightGrad(L, q, headFlag);
  const dhdx = g[0] * dqdx[0] + g[1] * dqdx[1] + g[2] * dqdx[2];
  const dhdy = g[0] * dqdy[0] + g[1] * dqdy[1] + g[2] * dqdy[2];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const r1 = cross(sigmaY, n), r2 = cross(n, sigmaX);
  const det = sigmaX[0] * r1[0] + sigmaX[1] * r1[1] + sigmaX[2] * r1[2];
  const sg = det < 0 ? -1 : 1;
  const tilt = (k: 0 | 1 | 2) => Math.abs(det) * n[k] - sg * fade * (dhdx * r1[k] + dhdy * r2[k]);
  const out: Vec3 = [tilt(0), tilt(1), tilt(2)];
  const l = Math.hypot(...out);
  if (!(l > 1e-20)) return [n[0], n[1], n[2], foot];
  return [out[0] / l, out[1] / l, out[2] / l, foot];
}

export interface SculptPaintSurface {
  albedo: Vec3;
  /** The darkest of the three cavities here. */
  cavity: number;
  /** Enamel here, after the footprint's fade. */
  crown: number;
}

/** The albedo at a point of a bone: `pLocal` its place in the segment, `q` and `w` the vertex feature
 *  (normalized place; 0 not a head, 1 a head, 2 the soldier's), `expo` the wound exposure there (0..1, after its
 *  smoothstep) and `foot` the pixel's footprint (m). Not a head: the first paint's tissue. A head: aged ivory with
 *  fewer blood blotches than the first paint, shaded hollows, stained rims, the lines, the teeth and the cavities. */
export function sculptPaintSurface(
  L: SculptPaintLayout, pLocal: Vec3, q: Vec3, w: number, boneColor: Vec3, deepColor: Vec3, expo: number, foot = 0,
): SculptPaintSurface {
  const headFlag = Math.min(w, 1), soldierHead = w >= 1.5 ? 1 : 0;
  const noise = (s: number, o: Vec3) => boneNoise3([pLocal[0] * s + o[0], pLocal[1] * s + o[1], pLocal[2] * s + o[2]]);
  const blotch = noise(20, [4.2, 17.7, 2.9]), warp = noise(6, [11.5, 1.7, 23.3]);
  const weave = noise(44, [7.1, 3.3, 9.7]), grain = noise(110, [2, 5, 1]);
  const blood = smoothstep(0.50, 0.60, blotch * 0.72 + warp * 0.28);
  const connect = smoothstep(0.34, 0.48, weave * 0.68 + warp * 0.32) * (1 - blood * 0.85);
  const ivory = smoothstep(0.53, 0.65, blotch * 0.5 + grain * 0.5) * (1 - blood * 0.85) * (1 - headFlag);
  const bloodCol = mix3([0.055, 0.004, 0.008], [deepColor[0] * 0.55, deepColor[1] * 0.55, deepColor[2] * 0.55], 0.35);
  const mul = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
  const boneBase = mul(boneColor, [0.84, 0.76, 0.56]);
  let albedo = mix3([0.30, 0.085, 0.075], boneBase, headFlag);
  albedo = mix3(albedo, [0.62, 0.19, 0.19], connect * (1 - headFlag));
  albedo = mix3(albedo, bloodCol, blood * mix(1, 0.40, headFlag));
  albedo = mix3(albedo, mul(boneColor, [0.86, 0.74, 0.62]), ivory * 0.8);
  // Old bone: broad brown mottling, no fine speckle.
  albedo = mix3(albedo, mul(boneColor, [0.52, 0.40, 0.26]), headFlag * smoothstep(0.42, 0.70, warp) * 0.45);

  const cav = sculptCavity(L, q, headFlag);
  const rel = sculptRelief(q);
  const shade = headFlag * Math.max(rel[2] * 0.40, rel[3] * 0.62);
  albedo = [albedo[0] * (1 - shade), albedo[1] * (1 - shade), albedo[2] * (1 - shade)];
  albedo = mix3(albedo, [0.16, 0.04, 0.03], cav[3] * 0.55);
  albedo = mix3(albedo, [0.05, 0.016, 0.012], sculptLines(q) * headFlag * 0.9);

  // The teeth. Far away the crowns and the wedges between them average to a band: enamel thinned by the wedges'
  // share, with no dark of their own.
  const front = smoothstep(0.05, 0.23, q[2]) * headFlag;
  const te = sculptTeeth(L, q);
  const far = smoothstep(SCULPT_TOOTH.fadeFrom, SCULPT_TOOTH.fadeTo, foot);
  const zone = Math.max(te[0], te[2]);
  const crown = mix(te[0], zone * 0.72, far) * front;
  const toothDark = te[2] * (1 - far) * front;
  const stain = boneNoise3([q[0] * 23, q[1] * 9, q[2] * 23]);
  const toothCol = mix3(mul(boneColor, [1.0, 0.98, 0.86]), [0.50, 0.36, 0.16], 0.04 + 0.22 * stain);
  albedo = mix3(albedo, mul(boneColor, [0.80, 0.70, 0.52]), te[1] * front * 0.5);
  albedo = mix3(albedo, [0.045, 0.012, 0.010], toothDark * 0.92);
  albedo = mix3(albedo, toothCol, crown * 0.95);

  const cavity = Math.max(cav[0], cav[1], cav[2] * (1 - crown));
  const steelFront = smoothstep(0.08, 0.42, q[2]);
  const ell = (cx: number, cy: number, rx: number, ry: number) => 1 - smoothstep(0.72, 1, Math.hypot((q[0] - cx) / rx, (q[1] - cy) / ry));
  const steel = Math.max(ell(-0.48, 0.08, 0.30, 0.42), ell(-0.24, 0.30, 0.42, 0.16)) * steelFront * soldierHead * (1 - cavity);
  albedo = mix3(albedo, [0.13, 0.16, 0.17], steel * 0.82);
  albedo = mix3(albedo, [deepColor[0] * 0.05, deepColor[1] * 0.05, deepColor[2] * 0.05], cavity * 0.94);

  const stainW = smoothstep(0.18, 0.85, expo) * (0.55 + 0.45 * grain);
  const stainStrength = mix(mix(0.55, 0.38, headFlag), 0.55, soldierHead);
  albedo = mix3(albedo, mix3([deepColor[0] * 0.45, deepColor[1] * 0.45, deepColor[2] * 0.45], [0.28, 0.012, 0.02], grain), stainW * stainStrength);
  albedo = mix3(albedo, [0.42, 0.004, 0.008], soldierHead * stainW * 0.55);
  // Torn flesh stuck to the bone: raw red, clotted dark where the grain says, a darker seam where a patch ends.
  const cling = sculptCling(L, pLocal, q, w, expo) * (1 - crown * 0.9);
  const meat = mix3([0.46, 0.035, 0.04], [0.15, 0.012, 0.018], smoothstep(0.35, 0.85, grain) * 0.7);
  albedo = mix3(albedo, meat, cling * 0.92);
  albedo = mix3(albedo, [0.08, 0.004, 0.006], cling * (1 - cling) * 2.4);
  return { albedo, cavity, crown };
}

/** The gloss multiplier: wet in patches as the first paint has it, none in a cavity, and enamel shines. */
export function sculptPaintWet(L: SculptPaintLayout, pLocal: Vec3, q: Vec3, w: number, expo: number): number {
  const headFlag = Math.min(w, 1), soldierHead = w >= 1.5 ? 1 : 0;
  const w1 = boneNoise3([pLocal[0] * 26 + 3.7, pLocal[1] * 26 + 11.2, pLocal[2] * 26 + 5.9]);
  const w2 = boneNoise3([pLocal[0] * 70 + 19.3, pLocal[1] * 70 + 2.1, pLocal[2] * 70 + 27.4]);
  let wet = mix(smoothstep(0.30, 0.68, w1 * 0.62 + w2 * 0.38), 0.9, clamp01(expo) * 0.45);
  wet = mix(wet, 0.98, clamp01(expo) * soldierHead * 0.75);
  // A head's dry bone is duller than a limb's: the sheen belongs to the teeth.
  let gloss = mix(0.05, mix(1, 0.55, headFlag), wet);
  const cav = sculptCavity(L, q, headFlag);
  const crown = sculptTeeth(L, q)[0] * smoothstep(0.05, 0.23, q[2]) * headFlag;
  gloss *= 1 - 0.97 * Math.max(cav[0], cav[1], cav[2] * (1 - crown));
  const cling = sculptCling(L, pLocal, q, w, expo) * (1 - crown * 0.9);
  return Math.max(gloss, crown * 0.85, cling * 0.8);
}

// ---------------------------------------------------------------------------------------------------------------
// WGSL. Dependency order is load-bearing, as in mesh-appearance.ts: the renderer builds each function with every
// earlier one as an include. Order: (hash, noise) -> orbit -> nose -> teeth -> lines -> relief -> cavity -> height
// -> height gradient -> normal -> surface -> wet.
// ---------------------------------------------------------------------------------------------------------------

/** A number as a WGSL f32 literal. */
const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const arr = (v: readonly number[]) => `array<f32, ${SCULPT_TEETH_MAX + 1}>(${Array.from({ length: SCULPT_TEETH_MAX + 1 }, (_, i) => f(v[i] ?? v[v.length - 1]!)).join(', ')})`;

export interface SculptPaintWgsl {
  orbit: string; nose: string; teeth: string; lines: string; relief: string; cavity: string; cling: string;
  height: string; grad: string; normal: string; surface: string; wet: string;
}

/** The second paint's WGSL for a layout. */
export function sculptPaintWgsl(L: SculptPaintLayout): SculptPaintWgsl {
  const { orbit: O, nose: N, brow: B, malar: M, temple: T, zygoma: Z, arch: A } = SKULL2_FACE;
  const K = SCULPT_TOOTH, H = SCULPT_HEIGHT, U = SCULPT_BUMP;
  const orbit = /* wgsl */ `fn sculptOrbit(ax: f32, y: f32) -> f32 {
  let c = ${f(Math.cos(O.droop))};
  let s = ${f(Math.sin(O.droop))};
  let u = ax - ${f(O.x)};
  let v = y - ${f(O.y)};
  let a = abs((u * c - v * s) / ${f(O.halfW)});
  let b = abs((u * s + v * c) / ${f(O.halfH)});
  return (pow(pow(a, ${f(O.power)}) + pow(b, ${f(O.power)}), ${f(1 / O.power)}) - 1.0) * ${f(O.halfH)};
}`;
  const nose = /* wgsl */ `fn sculptNose(ax: f32, y: f32) -> f32 {
  let wedge = max(max(ax - (${f(N.topHalfW)} + (${f(N.top)} - y) * ${f(N.flare)}), y - ${f(N.top)}), ${f(N.lobeY)} - y);
  let lobe = length(vec2<f32>(ax - ${f(N.lobeX)}, y - ${f(N.lobeY)})) - ${f(N.lobeR)};
  return min(wedge, lobe);
}`;
  const teeth = /* wgsl */ `fn sculptTeeth(q: vec3<f32>) -> vec4<f32> {
  var up = ${arr(L.upper)};
  var lo = ${arr(L.lower)};
  let s = abs(q.x) + ${f(L.wrap)} * max(0.0, ${f(L.turn)} - q.z);
  let upper = q.y > ${f((L.upperTip + L.lowerTip) * 0.5)};
  let tip = select(${f(L.lowerTip)}, ${f(L.upperTip)}, upper);
  let root = select(${f(L.lowerRoot)}, ${f(L.upperRoot)}, upper);
  let t = (q.y - tip) / (root - tip);
  var out = vec4<f32>(0.0);
  if (t > -0.05 && t < 1.05) {
    for (var i = 0; i < ${L.count}; i = i + 1) {
      let e0 = select(lo[i], up[i], upper);
      let e1 = select(lo[i + 1], up[i + 1], upper);
      if (s < e0 || s >= e1) { continue; }
      let au = abs((s - (e0 + e1) * 0.5) / max((e1 - e0) * 0.5, 1e-4));
      let fang = select(0.0, 1.0, i == ${L.fang});
      let r = boneHash(vec3<f32>(f32(i), select(0.0, 1.0, upper), 7.0));
      let cf = ${f(K.crown)} + 0.10 * fang + (r - 0.5) * 0.06;
      let tc = t / cf;
      let tipLine = (0.10 + 0.45 * fang) * au * au + (r - 0.5) * 0.06 + 0.03;
      let w = mix(0.92, 0.60, clamp(tc, 0.0, 1.0));
      let gum = 1.0 - 0.16 * au * au;
      let crown = (1.0 - smoothstep(w - 0.10, w, au)) * smoothstep(tipLine - 0.03, tipLine + 0.03, tc) * (1.0 - smoothstep(gum - 0.04, gum + 0.04, tc));
      let ridge = smoothstep(gum - 0.02, gum + 0.06, tc) * (1.0 - au * au) * (1.0 - smoothstep(cf + (1.0 - cf) * 0.3, 1.0, t));
      let stained = smoothstep(gum, gum + 0.10, tc) * (1.0 - smoothstep(cf + (1.0 - cf) * 0.5, 1.0, t)) * (1.0 - ridge) * 0.45;
      let dark = max(smoothstep(-0.02, 0.03, tc) * (1.0 - smoothstep(gum, gum + 0.10, tc)) * (1.0 - crown), stained);
      let height = ${f(K.proud)} * sqrt(max(0.0, 1.0 - (au / w) * (au / w))) * crown + ${f(K.ridge)} * ridge;
      out = vec4<f32>(crown, ridge, dark, height);
    }
  }
  return out;
}`;
  const lines = /* wgsl */ `fn sculptLines(q: vec3<f32>) -> f32 {
  let wy = boneNoise(vec3<f32>(q.y * 9.0 + 3.1, 1.7, 5.3)) - 0.5;
  let wx = boneNoise(vec3<f32>(q.x * 9.0 + 7.7, 4.1, 2.9)) - 0.5;
  let wz = boneNoise(vec3<f32>(q.z * 14.0 + 1.3, 8.2, 6.4)) - 0.5;
  let face = smoothstep(0.2, 0.35, q.z);
  let brow = (1.0 - smoothstep(0.012, 0.0264, abs(q.x - (-0.30 + 0.50 * (q.y - 0.56) + 0.07 * wy))))
    * smoothstep(0.54, 0.58, q.y) * (1.0 - smoothstep(0.94, 0.98, q.y));
  let fork = (1.0 - smoothstep(0.010, 0.022, abs(q.y - (0.76 - 0.30 * (q.x + 0.20) + 0.05 * wx))))
    * smoothstep(-0.57, -0.53, q.x) * (1.0 - smoothstep(-0.22, -0.18, q.x));
  let cheek = (1.0 - smoothstep(0.010, 0.022, abs(q.x - (0.52 - 0.45 * q.y + 0.05 * wy))))
    * smoothstep(-0.28, -0.24, q.y) * (1.0 - smoothstep(-0.02, 0.02, q.y));
  let jaw = (1.0 - smoothstep(0.010, 0.022, abs(q.x - (-0.13 + 0.15 * (q.y + 0.56) + 0.04 * wy))))
    * smoothstep(-0.86, -0.82, q.y) * (1.0 - smoothstep(-0.58, -0.54, q.y));
  let coronalZ = 0.10 + 0.30 * (1.0 - q.y);
  let coronal = (1.0 - smoothstep(0.010, 0.022, abs(q.z - (coronalZ + 0.06 * (wx + wy))))) * smoothstep(0.28, 0.36, q.y);
  let sagittal = (1.0 - smoothstep(0.010, 0.022, abs(q.x - 0.05 * wz))) * smoothstep(0.50, 0.58, q.y)
    * (1.0 - smoothstep(coronalZ - 0.04, coronalZ, q.z));
  return max(max(max(brow, fork) * face, max(cheek, jaw) * face), max(coronal, sagittal));
}`;
  const relief = /* wgsl */ `fn sculptRelief(q: vec3<f32>) -> vec4<f32> {
  let ax = abs(q.x);
  let top = ${f(B.top)} - ${f(B.droop)} * max(0.0, ax - 0.12);
  let front = smoothstep(0.25, 0.5, q.z);
  let brow = smoothstep(top - ${f(B.thick + 0.025)}, top - ${f(B.thick - 0.025)}, q.y) * (1.0 - smoothstep(top - 0.025, top + 0.025, q.y))
    * (1.0 - smoothstep(0.62, 0.8, ax)) * front;
  let malar = (1.0 - smoothstep(0.5, 1.0, length(vec2<f32>((ax - ${f(M.x)}) / ${f(M.halfW)}, (q.y - ${f(M.y)}) / ${f(M.halfH)})))) * front;
  let t = length(vec2<f32>((q.z - ${f(T.z)}) / ${f(T.halfZ)}, (q.y - ${f(T.y)}) / ${f(T.halfY)}));
  let hollow = (1.0 - smoothstep(0.55, 1.0, t)) * smoothstep(${f(T.minX)}, ${f(T.minX + 0.12)}, ax);
  let under = smoothstep(0.0, 0.06, ${f(Z.y)} + ${f(Z.rise)} * max(0.0, ax - ${f(A.halfW)}) - q.y)
    * smoothstep(${f(A.halfW - 0.02)}, ${f(A.halfW + 0.08)}, ax) * smoothstep(-0.50, -0.44, q.y) * smoothstep(0.0, 0.2, q.z);
  return vec4<f32>(brow, malar, hollow, under);
}`;
  const cavity = /* wgsl */ `fn sculptCavity(q: vec3<f32>, headFlag: f32) -> vec4<f32> {
  let ax = abs(q.x);
  let front = smoothstep(0.05, 0.23, q.z) * headFlag;
  let o = sculptOrbit(ax, q.y);
  let n = sculptNose(ax, q.y);
  let orbit = (1.0 - smoothstep(-0.02, 0.012, o)) * mix(0.70, 1.0, 1.0 - smoothstep(0.50, 0.86, q.z)) * front;
  let nose = (1.0 - smoothstep(-0.015, 0.010, n)) * mix(0.75, 1.0, 1.0 - smoothstep(0.45, 0.80, q.z)) * front;
  let s = ax + ${f(L.wrap)} * max(0.0, ${f(L.turn)} - q.z);
  let mouth = smoothstep(${f(L.lowerTip - 0.008)}, ${f(L.lowerTip + 0.008)}, q.y) * (1.0 - smoothstep(${f(L.upperTip - 0.008)}, ${f(L.upperTip + 0.008)}, q.y))
    * (1.0 - smoothstep(${f(L.mouthHalfW - 0.03)}, ${f(L.mouthHalfW + 0.02)}, s)) * front;
  let halo = max(1.0 - smoothstep(0.0, 0.09, o), 1.0 - smoothstep(0.0, 0.06, n)) * front;
  return vec4<f32>(orbit, nose, mouth, halo);
}`;
  const C = SCULPT_CLING;
  const cling = /* wgsl */ `fn sculptCling(pLocal: vec3<f32>, q: vec3<f32>, headFlag: f32, soldierHead: f32, expo: f32) -> f32 {
  let n = boneNoise(pLocal * 22.0 + vec3<f32>(8.3, 2.9, 14.1)) * 0.66 + boneNoise(pLocal * 61.0 + vec3<f32>(3.3, 19.7, 6.1)) * 0.34;
  let cav = sculptCavity(q, headFlag);
  let hold = max(max(cav.x, cav.y), cav.w);
  let t = ${f(C.cover)} - ${f(C.byExpo)} * expo - ${f(C.byCavity)} * hold;
  return smoothstep(t, t + ${f(C.soft)}, n) * smoothstep(${f(C.from)}, ${f(C.to)}, expo) * headFlag * (1.0 - soldierHead);
}`;
  const height = /* wgsl */ `fn sculptHeight(q: vec3<f32>, headFlag: f32) -> f32 {
  let front = smoothstep(0.05, 0.23, q.z) * headFlag;
  let o = sculptOrbit(abs(q.x), q.y);
  let rim = smoothstep(-0.01, 0.015, o) * (1.0 - smoothstep(0.02, 0.07, o));
  let rel = sculptRelief(q);
  return front * (sculptTeeth(q).w + ${f(H.rim)} * rim)
    + ${f(L.relief)} * headFlag * (${f(H.brow)} * rel.x + ${f(H.malar)} * rel.y - ${f(H.temple)} * rel.z - ${f(H.underCheek)} * rel.w)
    - ${f(H.groove)} * sculptLines(q) * headFlag;
}`;
  const grad = /* wgsl */ `fn sculptHeightGrad(q: vec3<f32>, headFlag: f32) -> vec3<f32> {
  let e = ${f(U.eps)};
  let h = sculptHeight(q, headFlag);
  return vec3<f32>(
    sculptHeight(q + vec3<f32>(e, 0.0, 0.0), headFlag) - h,
    sculptHeight(q + vec3<f32>(0.0, e, 0.0), headFlag) - h,
    sculptHeight(q + vec3<f32>(0.0, 0.0, e), headFlag) - h) / e;
}`;
  // The derivatives are taken first, in uniform control flow: the gradient's branch follows them.
  const normal = /* wgsl */ `fn sculptPaintNormal(p: vec3<f32>, n: vec3<f32>, feature: vec4<f32>) -> vec4<f32> {
  let sigmaX = dpdx(p);
  let sigmaY = dpdy(p);
  let dqdx = dpdx(feature.xyz);
  let dqdy = dpdy(feature.xyz);
  let headFlag = min(feature.w, 1.0);
  let foot = max(length(sigmaX), length(sigmaY));
  let fade = (1.0 - smoothstep(${f(U.fadeFrom)}, ${f(U.fadeTo)}, foot)) * ${f(U.gain)} * headFlag;
  var out = n;
  if (fade > 0.0) {
    let g = sculptHeightGrad(feature.xyz, headFlag);
    let dhdx = dot(g, dqdx);
    let dhdy = dot(g, dqdy);
    let r1 = cross(sigmaY, n);
    let r2 = cross(n, sigmaX);
    let det = dot(sigmaX, r1);
    let sg = select(1.0, -1.0, det < 0.0);
    let tilted = abs(det) * n - sg * fade * (dhdx * r1 + dhdy * r2);
    let l = length(tilted);
    if (l > 1e-20) { out = tilted / l; }
  }
  return vec4<f32>(out, foot);
}`;
  const surface = /* wgsl */ `fn sculptPaintSurface(pWorld: vec3<f32>, pLocal: vec3<f32>, feature: vec4<f32>, boneColor: vec3<f32>, deepColor: vec3<f32>, foot: f32, woundTex: texture_2d<f32>, woundCount: f32) -> vec4<f32> {
  let headFlag = min(feature.w, 1.0);
  let soldierHead = step(1.5, feature.w);
  let q = feature.xyz;
  var expo = 0.0;
  for (var i = 0; i < 64; i = i + 1) {
    if (f32(i) >= woundCount) { break; }
    let w = textureLoad(woundTex, vec2<i32>(i, 0), 0);
    let dist = length(pWorld - w.xyz);
    expo = max(expo, clamp(1.0 - dist / max(w.w * 1.15, 1e-3), 0.0, 1.0));
  }
  expo = smoothstep(0.0, 1.0, expo);

  let blotch = boneNoise(pLocal * 20.0 + vec3<f32>(4.2, 17.7, 2.9));
  let warp = boneNoise(pLocal * 6.0 + vec3<f32>(11.5, 1.7, 23.3));
  let weave = boneNoise(pLocal * 44.0 + vec3<f32>(7.1, 3.3, 9.7));
  let grain = boneNoise(pLocal * 110.0 + vec3<f32>(2.0, 5.0, 1.0));
  let blood = smoothstep(0.50, 0.60, blotch * 0.72 + warp * 0.28);
  let connect = smoothstep(0.34, 0.48, weave * 0.68 + warp * 0.32) * (1.0 - blood * 0.85);
  let ivory = smoothstep(0.53, 0.65, blotch * 0.5 + grain * 0.5) * (1.0 - blood * 0.85) * (1.0 - headFlag);
  let bloodCol = mix(vec3<f32>(0.055, 0.004, 0.008), deepColor * 0.55, 0.35);
  let boneBase = boneColor * vec3<f32>(0.84, 0.76, 0.56);
  var albedo = mix(vec3<f32>(0.30, 0.085, 0.075), boneBase, headFlag);
  albedo = mix(albedo, vec3<f32>(0.62, 0.19, 0.19), connect * (1.0 - headFlag));
  albedo = mix(albedo, bloodCol, blood * mix(1.0, 0.40, headFlag));
  albedo = mix(albedo, boneColor * vec3<f32>(0.86, 0.74, 0.62), ivory * 0.8);
  albedo = mix(albedo, boneColor * vec3<f32>(0.52, 0.40, 0.26), headFlag * smoothstep(0.42, 0.70, warp) * 0.45);

  let cav = sculptCavity(q, headFlag);
  let rel = sculptRelief(q);
  let shade = headFlag * max(rel.z * 0.40, rel.w * 0.62);
  albedo = albedo * (1.0 - shade);
  albedo = mix(albedo, vec3<f32>(0.16, 0.04, 0.03), cav.w * 0.55);
  albedo = mix(albedo, vec3<f32>(0.05, 0.016, 0.012), sculptLines(q) * headFlag * 0.9);

  let front = smoothstep(0.05, 0.23, q.z) * headFlag;
  let te = sculptTeeth(q);
  let far = smoothstep(${f(K.fadeFrom)}, ${f(K.fadeTo)}, foot);
  let zone = max(te.x, te.z);
  let crown = mix(te.x, zone * 0.72, far) * front;
  let toothDark = te.z * (1.0 - far) * front;
  let stain = boneNoise(q * vec3<f32>(23.0, 9.0, 23.0));
  let toothCol = mix(boneColor * vec3<f32>(1.0, 0.98, 0.86), vec3<f32>(0.50, 0.36, 0.16), 0.04 + 0.22 * stain);
  albedo = mix(albedo, boneColor * vec3<f32>(0.80, 0.70, 0.52), te.y * front * 0.5);
  albedo = mix(albedo, vec3<f32>(0.045, 0.012, 0.010), toothDark * 0.92);
  albedo = mix(albedo, toothCol, crown * 0.95);

  let cavity = max(max(cav.x, cav.y), cav.z * (1.0 - crown));
  let steelFront = smoothstep(0.08, 0.42, q.z);
  let steelTemple = 1.0 - smoothstep(0.72, 1.0, length(vec2<f32>((q.x + 0.48) / 0.30, (q.y - 0.08) / 0.42)));
  let steelBrow = 1.0 - smoothstep(0.72, 1.0, length(vec2<f32>((q.x + 0.24) / 0.42, (q.y - 0.30) / 0.16)));
  let steel = max(steelTemple, steelBrow) * steelFront * soldierHead * (1.0 - cavity);
  albedo = mix(albedo, vec3<f32>(0.13, 0.16, 0.17), steel * 0.82);
  albedo = mix(albedo, deepColor * 0.05, cavity * 0.94);

  let stainW = smoothstep(0.18, 0.85, expo) * (0.55 + 0.45 * grain);
  let stainStrength = mix(mix(0.55, 0.38, headFlag), 0.55, soldierHead);
  albedo = mix(albedo, mix(deepColor * 0.45, vec3<f32>(0.28, 0.012, 0.02), grain), stainW * stainStrength);
  albedo = mix(albedo, vec3<f32>(0.42, 0.004, 0.008), soldierHead * stainW * 0.55);
  let cling = sculptCling(pLocal, q, headFlag, soldierHead, expo) * (1.0 - crown * 0.9);
  let meat = mix(vec3<f32>(0.46, 0.035, 0.04), vec3<f32>(0.15, 0.012, 0.018), smoothstep(0.35, 0.85, grain) * 0.7);
  albedo = mix(albedo, meat, cling * 0.92);
  albedo = mix(albedo, vec3<f32>(0.08, 0.004, 0.006), cling * (1.0 - cling) * 2.4);
  return vec4<f32>(albedo, expo);
}`;
  const wet = /* wgsl */ `fn sculptPaintWet(pLocal: vec3<f32>, feature: vec4<f32>, expo: f32) -> f32 {
  let headFlag = min(feature.w, 1.0);
  let soldierHead = step(1.5, feature.w);
  let w1 = boneNoise(pLocal * 26.0 + vec3<f32>(3.7, 11.2, 5.9));
  let w2 = boneNoise(pLocal * 70.0 + vec3<f32>(19.3, 2.1, 27.4));
  var wet = mix(smoothstep(0.30, 0.68, w1 * 0.62 + w2 * 0.38), 0.9, clamp(expo, 0.0, 1.0) * 0.45);
  wet = mix(wet, 0.98, clamp(expo, 0.0, 1.0) * soldierHead * 0.75);
  var gloss = mix(0.05, mix(1.0, 0.55, headFlag), wet);
  let cav = sculptCavity(feature.xyz, headFlag);
  let crown = sculptTeeth(feature.xyz).x * smoothstep(0.05, 0.23, feature.z) * headFlag;
  gloss = gloss * (1.0 - 0.97 * max(max(cav.x, cav.y), cav.z * (1.0 - crown)));
  let cling = sculptCling(pLocal, feature.xyz, headFlag, soldierHead, expo) * (1.0 - crown * 0.9);
  return max(max(gloss, crown * 0.85), cling * 0.8);
}`;
  return { orbit, nose, teeth, lines, relief, cavity, cling, height, grad, normal, surface, wet };
}

/** A layout's functions in dependency order, for the renderer's include chain (after the hash and the noise). */
export function sculptPaintSources(L: SculptPaintLayout): string[] {
  const w = sculptPaintWgsl(L);
  return [w.orbit, w.nose, w.teeth, w.lines, w.relief, w.cavity, w.cling, w.height, w.grad, w.normal, w.surface, w.wet];
}
