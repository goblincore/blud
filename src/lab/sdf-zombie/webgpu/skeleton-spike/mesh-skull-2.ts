// src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-skull-2.ts
//
// The second sculpt of the head's bone: the authored bone carved toward a human skull (brow, angular orbits, pear nose, cheek hollows, parted jaws).

import type { BoneFieldSource, Point3 } from './contract';

// THE SECOND SCULPT of the head's bone: the same authored bone as the first (mesh-skull.ts), carved toward a human
// skull. It keeps the first's frame and its landmarks (head-rigid AABB coordinates, -1..1 on each axis, +z the face;
// the eye line at y 0.22, the eyes at x +-0.36, the bite near y -0.38), so the seated eyes (mesh-eyes.ts) and either
// paint sit where they did.
//
// Nearly everything here REMOVES bone: an erosion sinks the authored surface inward by a few millimetres, a cut takes
// a region out. The zombie's sculpt only removes, so every surviving point of it is inside the authored bone. The
// soldier's authored bone is a ball over a small jaw with a crease between them where the upper teeth belong; his
// sculpt first ADDS an upper jaw there and raises the brow and the cheekbones a few millimetres (SKULL2_SOLDIER.add,
// .raise), where his flesh is 10 to 37 mm thick. mesh-skull-2.test.ts holds every extracted vertex of both skulls at
// least 3 mm under the intact flesh.
//
// What is carved, top to bottom:
//   the forehead sinks behind a brow ridge left standing over the orbits;
//   the orbits are rounded quadrilaterals, wider than tall, drooping at the outer corners;
//   the temples are hollowed behind the orbit's outer rim, above the cheekbone;
//   the nasal aperture is a pear: narrow under the nasal bones, two lobes at the bottom;
//   the face sinks under the orbits and beside the nose, leaving the cheekbones and the tooth-bearing arch proud;
//   below the cheekbone the side of the face is cut away, so the upper jaw is an arch that stands forward of the
//     lower jaw's rising branch (the ramus);
//   the jaws are parted: a gap between the upper and the lower teeth, closed only by the ramus at the back;
//   the lower jaw is an arch with a chin: its arms part toward the jaw's corners, a groove sits under the lower
//     teeth, and its underside is hollow between the two arms.

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** 1 inside a..b with `soft` wide shoulders, 0 outside. */
const band = (a: number, b: number, soft: number, v: number) => smoothstep(a - soft, a + soft, v) * (1 - smoothstep(b - soft, b + soft, v));
const sup = (a: number, b: number, p: number) => Math.pow(Math.pow(Math.abs(a), p) + Math.pow(Math.abs(b), p), 1 / p);

/** THE FACE both characters share, in the head's normalized coordinates. The second paint reads the same table
 *  (sculpt-paint.ts), so paint and bone agree. Depths (`sink`, `round`) are metres. */
export const SKULL2_FACE = {
  orbit: { x: 0.36, y: 0.22, halfW: 0.27, halfH: 0.20, droop: 0.26, power: 2.5, floor: 0.34 },
  // The brow ridge's upper edge at the middle, and how fast it falls toward the temple; above it the forehead sinks.
  brow: { top: 0.56, droop: 0.24, sink: 0.005, rise: 0.06, fade: 0.42, thick: 0.10 },
  temple: { z: 0.22, y: 0.26, halfZ: 0.40, halfY: 0.25, minX: 0.42, sink: 0.007 },
  nose: { top: 0.10, topHalfW: 0.035, flare: 0.30, lobeX: 0.075, lobeY: -0.11, lobeR: 0.078, floor: 0.30 },
  // The face's sunk part under the orbit, beside the nose; the cheekbone's raised part outside it.
  cheek: { y: -0.10, halfY: 0.11, x0: 0.15, x1: 0.46, sink: 0.004 },
  malar: { x: 0.54, y: -0.06, halfW: 0.20, halfH: 0.12 },
  // The upper jaw's arch from above: half-width at the back, where it starts (z) and how far forward it reaches; how
  // much it narrows per unit of height from the teeth toward the nose.
  arch: { halfW: 0.32, back: 0.30, reach: 0.68, power: 2.5, narrow: 0.35 },
  // The cheekbone's lower border: its height beside the arch, and how fast it rises toward the ear.
  zygoma: { y: -0.26, rise: 0.5 },
  teeth: { upperRoot: -0.195, upperTip: -0.345, lowerTip: -0.415, lowerRoot: -0.58 },
  groove: { y: -0.66, halfY: 0.06, halfW: 0.34, sink: 0.006 },
  // The lower jaw's hollow underside: its half-width, its middle and half-length in z, its roof.
  under: { halfW: 0.24, z: 0.18, halfZ: 0.44, top: -0.66 },
  /** The radius (m) the lower face's cuts are rounded with. */
  round: 0.004,
} as const;

/** An added ellipsoid: centre and radii, normalized. A centre off the middle (x != 0) is mirrored. */
export interface SkullEllipsoid { c: readonly [number, number, number]; r: readonly [number, number, number] }

/** WHAT DIFFERS BETWEEN THE CHARACTERS: the lower jaw, fitted to each one's authored bone, and what is added. */
export interface Skull2Jaw {
  /** The chin's underside, its half-width there and how it flares upward. */
  chin: number; chinHalfW: number; flare: number;
  /** The arms' half-width at the front and at the corners, and the depth (z) from which they part. */
  frontHalfW: number; cornerHalfW: number; partFrom: number;
  /** The top of the arms behind the teeth. */
  armTop: number;
  /** The ramus: its inner face (|x|), its front edge and how far back the hollow inside it goes. An inner face at
   *  the arch's half-width leaves no hollow. */
  ramusInner: number; ramusFront: number; ramusBack: number;
  /** Bone added before anything is carved (smooth union, `blend` m). */
  add: readonly SkullEllipsoid[]; blend: number;
  /** How far (m) the brow ridge and the cheekbones are raised above the authored surface. */
  raise: { brow: number; malar: number };
}
export const SKULL2_ZOMBIE: Skull2Jaw = {
  chin: -0.84, chinHalfW: 0.24, flare: 1.1, frontHalfW: 0.36, cornerHalfW: 0.62, partFrom: 0.75, armTop: -0.445,
  ramusInner: 0.46, ramusFront: 0.38, ramusBack: 0.0,
  add: [], blend: 0.004, raise: { brow: 0, malar: 0 },
};
export const SKULL2_SOLDIER: Skull2Jaw = {
  chin: -0.86, chinHalfW: 0.22, flare: 1.1, frontHalfW: 0.34, cornerHalfW: 0.54, partFrom: 0.75, armTop: -0.445,
  ramusInner: 0.32, ramusFront: 0.34, ramusBack: 0.0,
  // The upper jaw, and a ramus on each side from the jaw's corner up to the cheekbone.
  add: [{ c: [0, -0.24, 0.50], r: [0.36, 0.22, 0.47] }, { c: [0.44, -0.36, 0.16], r: [0.085, 0.30, 0.22] }],
  blend: 0.006, raise: { brow: 0.005, malar: 0.006 },
};

/** The orbit's outline in the face plane: negative inside. A superellipse about the eye, turned so its outer corner
 *  droops; `ax` is the distance from the middle (|x|). Normalized units, of the order of a distance. */
export function skull2Orbit(ax: number, y: number): number {
  const o = SKULL2_FACE.orbit, c = Math.cos(o.droop), s = Math.sin(o.droop);
  const u = ax - o.x, v = y - o.y;
  return (sup((u * c - v * s) / o.halfW, (u * s + v * c) / o.halfH, o.power) - 1) * o.halfH;
}

/** The nasal aperture's outline in the face plane: negative inside. A wedge that widens downward from the nasal
 *  bones, joined to two round lobes; the notch between the lobes is the nasal spine. */
export function skull2Nose(ax: number, y: number): number {
  const n = SKULL2_FACE.nose;
  const wedge = Math.max(ax - (n.topHalfW + (n.top - y) * n.flare), y - n.top, n.lobeY - y);
  const lobe = Math.hypot(ax - n.lobeX, y - n.lobeY) - n.lobeR;
  return Math.min(wedge, lobe);
}

/** The height of the brow ridge's upper edge at |x|: it falls toward the temple with the orbit's upper rim. */
export const skull2BrowTop = (ax: number) => SKULL2_FACE.brow.top - SKULL2_FACE.brow.droop * Math.max(0, ax - 0.12);

/** How far (m) the surface sinks at the normalized point: the forehead behind the brow, the temple, the face under
 *  the orbit and beside the nose, and the groove under the lower teeth. */
export function skull2Erosion(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const { brow, temple, cheek, groove } = SKULL2_FACE;
  const above = y - skull2BrowTop(ax);
  const forehead = brow.sink * smoothstep(0, brow.rise, above) * (1 - smoothstep(brow.fade * 0.5, brow.fade, above)) * smoothstep(0.0, 0.3, z);
  const t = Math.hypot((z - temple.z) / temple.halfZ, (y - temple.y) / temple.halfY);
  const hollow = temple.sink * (1 - smoothstep(0.55, 1, t)) * smoothstep(temple.minX, temple.minX + 0.12, ax);
  const face = cheek.sink * band(cheek.y - cheek.halfY, cheek.y + cheek.halfY, 0.04, y) * band(cheek.x0, cheek.x1, 0.05, ax) * smoothstep(0.2, 0.4, z);
  const chin = groove.sink * band(groove.y - groove.halfY, groove.y + groove.halfY, 0.05, y) * (1 - smoothstep(groove.halfW - 0.08, groove.halfW, ax)) * smoothstep(0.5, 0.7, z);
  return Math.max(forehead, hollow, face, chin);
}

/** Where the surface is raised at the normalized point: 1 on the brow ridge (`brow`) or on the cheekbone (`malar`),
 *  0 away from them; a character's `raise` gives the metres. Front of the head only. */
export function skull2Raise(x: number, y: number, z: number): { brow: number; malar: number } {
  const ax = Math.abs(x), { brow, malar } = SKULL2_FACE;
  const top = skull2BrowTop(ax), front = smoothstep(0.25, 0.5, z);
  return {
    brow: band(top - brow.thick, top, 0.025, y) * (1 - smoothstep(0.62, 0.8, ax)) * front,
    malar: (1 - smoothstep(0.5, 1, Math.hypot((ax - malar.x) / malar.halfW, (y - malar.y) / malar.halfH))) * front,
  };
}

/** The table of a sculpted character (null: the second sculpt does not carve it). */
export const skull2JawOf = (character: string): Skull2Jaw | null =>
  character === 'zombie' ? SKULL2_ZOMBIE : character === 'soldier' ? SKULL2_SOLDIER : null;

/** The second sculpt of a head source with the lower jaw `jaw`. `revision` is appended to the source's own, as the
 *  first sculpt's is. */
export function sculptSkull2(source: BoneFieldSource, revision: string, jaw: Skull2Jaw): BoneFieldSource {
  const { min, max } = source.bounds;
  const half = max.map((v, i) => (v - min[i]!) * 0.5);
  const scale = Math.min(...half);
  const { orbit, nose, arch, zygoma, teeth, under, round } = SKULL2_FACE;
  return {
    ...source,
    revision: `${source.revision}:${revision}`,
    distance(p: Point3): number {
      const q = p.map((v, i) => (v - min[i]!) / half[i]! - 1);
      const [x, y, z] = q as [number, number, number];
      const ax = Math.abs(x);
      // The authored bone, with the character's added bone joined to it.
      let d = source.distance(p);
      for (const e of jaw.add) {
        const a = (Math.hypot((ax - Math.abs(e.c[0])) / e.r[0], (y - e.c[1]) / e.r[1], (z - e.c[2]) / e.r[2]) - 1) * Math.min(...e.r) * scale;
        const h = Math.max(jaw.blend - Math.abs(d - a), 0) / jaw.blend;
        d = Math.min(d, a) - h * h * jaw.blend * 0.25;
      }
      // The raised and the sunk surfaces.
      if (jaw.raise.brow > 0 || jaw.raise.malar > 0) {
        const up = skull2Raise(x, y, z);
        d -= Math.max(up.brow * jaw.raise.brow, up.malar * jaw.raise.malar);
      }
      d += skull2Erosion(x, y, z);
      // A cut takes out the region whose (normalized) distance is negative; `soft` rounds the edge it leaves.
      const cut = (region: number, soft = 0) => {
        const c = -region * scale;
        if (soft <= 0) { d = Math.max(d, c); return; }
        const h = Math.max(soft - Math.abs(d - c), 0) / soft;
        d = Math.max(d, c) + h * h * soft * 0.25;
      };
      // The orbits and the nasal aperture: pits with a floor.
      cut(Math.max(skull2Orbit(ax, y), orbit.floor - z));
      cut(Math.max(skull2Nose(ax, y), nose.floor - z));
      // The chin's underside, and the chin's sides flaring upward from it.
      cut(y - jaw.chin, round);
      cut(Math.max(jaw.chinHalfW + (y - jaw.chin) * jaw.flare - ax, y - jaw.armTop), round);
      // The upper jaw's arch from above. It narrows upward, from the teeth toward the nose.
      const archW = arch.halfW - arch.narrow * Math.max(0, y - teeth.upperTip);
      const outsideUpper = (sup(ax / archW, Math.max(0, z - arch.back) / arch.reach, arch.power) - 1) * archW;
      // The lower jaw's arch: the same front, with arms that part toward the corners.
      const armW = jaw.frontHalfW + (jaw.cornerHalfW - jaw.frontHalfW) * clamp01((jaw.partFrom - z) / jaw.partFrom);
      const outsideLower = (sup(ax / armW, Math.max(0, z - arch.back) / arch.reach, arch.power) - 1) * armW;
      cut(Math.max(-outsideLower, y - jaw.armTop), round);
      // Under the cheekbone and above the lower jaw's arms, everything outside the upper arch and in front of the
      // ramus goes: the upper jaw stands forward alone. The cheekbone's lower border rises toward the ear.
      const underCheek = y - (zygoma.y + zygoma.rise * Math.max(0, ax - arch.halfW));
      cut(Math.max(-outsideUpper, underCheek, jaw.armTop - y, jaw.ramusFront - z), round);
      // The hollow between the upper jaw and the ramus, behind that.
      cut(Math.max(archW - ax, ax - jaw.ramusInner, underCheek, jaw.armTop - y, jaw.ramusBack - z), round);
      // The parting of the jaws, as far out as the lower jaw's corners.
      cut(Math.max(y - teeth.upperTip, teeth.lowerTip - y, ax - Math.max(jaw.ramusInner, arch.halfW + 0.12), 0.2 - z));
      // The lower jaw's underside, hollow between its two arms.
      cut(Math.max(Math.hypot(ax / under.halfW, (z - under.z) / under.halfZ) - 1, y - under.top) * under.halfW, round);
      return d;
    },
  };
}
