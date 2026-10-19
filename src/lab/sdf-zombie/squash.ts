// src/lab/sdf-zombie/squash.ts
//
// HEAD SQUASH AND STRETCH (goblin expressions Task 18; owner on PR #48: "make his face distort more, like when he grins it should
// be a bit cartoonish and exaggerated"). The cartoon grin's head goes WIDER AND SHORTER as a whole; a surprised one NARROWER AND
// TALLER. Per-prim morphs (morph.ts) move single features; this moves every prim of the rigid head at once by one affine map
//
//     x  ->  c + S (x - c),      S = diag(1 + gx w, 1 + gy w, 1 + gz w)
//
// about a head centre c, in the head's REST frame (rig-bind's pivot-relative frame, before the jaw opens and the head turns). The
// expression channel `squash` (expression.ts, -1..1) is w.
//
// WHY IT IS EXACT, not an approximation: a prim's field is evaluated in its own frame with the query point DIVIDED BY ITS SCALE
// (validate.ts sdPrimitive, the WGSL's sdPrim/sdPrimO), so moving its endpoints by the map and multiplying its scale by S gives a
// prim whose surface is precisely the affine image of the old one (the map's translation part is a constant shift in the divided
// frame). A bend is a displacement, so it scales by S. Radius, blend and taper stay. A shell's clip plane maps as a plane does
// (n -> S^-1 n, renormalised). The field's distance is the usual min-scale underestimate, as for any anisotropic prim.
//
// Pure: plain data in, plain data out, no renderer. rig-bind.ts applyRig (the prims), kitFrames (the kit's rigid teeth ride along
// by the squash's move at the mouth) and morphedRest (the skin noise's anchor) are the consumers.
//
// THE NEUTRAL GUARANTEE: squashAxes returns null at weight 0 (or no weight, or a non-finite one), and a null result means the caller
// takes its old path untouched, so every body without a squash weight poses and packs bit-identically.
import type { ShellParams, Vec3 } from './types';

/** Per-axis gain at weight 1: +1 is 15% wider, 8% shorter, 5% deeper (wide/tall/deep, the head's rest axes). A volume-ish
 *  preserving cartoon squash; negative weights stretch (narrower, taller, shallower). */
export const SQUASH_GAIN: Readonly<Vec3> = [0.15, -0.08, 0.05];

/** Where the head squashes about: this fraction of the way from the skull pivot to its tip (0.5 = the skull bone's middle, about
 *  the eyes' height on the goblin). Points above it drop and points below it rise as the head shortens, so the mouth closes on the
 *  eyes and the chin rises, the cartoon's crunch. */
export const SQUASH_CENTRE_AT = 0.5;

/** The squash's axes S at weight w, or null when nothing should move (w 0, absent or not finite). Floors each axis at 0.2. */
export function squashAxes(w: number | undefined, gain: Readonly<Vec3> = SQUASH_GAIN): Vec3 | null {
  if (w === undefined || w === 0 || !Number.isFinite(w)) return null;
  return [Math.max(0.2, 1 + gain[0] * w), Math.max(0.2, 1 + gain[1] * w), Math.max(0.2, 1 + gain[2] * w)];
}

/** x -> c + S (x - c). */
export function squashPoint(p: Vec3, c: Vec3, s: Vec3): Vec3 {
  return [c[0] + s[0] * (p[0] - c[0]), c[1] + s[1] * (p[1] - c[1]), c[2] + s[2] * (p[2] - c[2])];
}

/** The squash's move at x: (S - I)(x - c). */
export function squashMove(p: Vec3, c: Vec3, s: Vec3): Vec3 {
  return [(s[0] - 1) * (p[0] - c[0]), (s[1] - 1) * (p[1] - c[1]), (s[2] - 1) * (p[2] - c[2])];
}

/** A clip plane {x : n.x = d} under the map: n' = S^-1 n / |S^-1 n|, d' = (d - n.c + (S^-1 n).c) / |S^-1 n|. */
export function squashPlane(normal: Vec3, offset: number, c: Vec3, s: Vec3): { normal: Vec3; offset: number } {
  const m: Vec3 = [normal[0] / s[0], normal[1] / s[1], normal[2] / s[2]];
  const l = Math.hypot(m[0], m[1], m[2]);
  const nc = normal[0] * c[0] + normal[1] * c[1] + normal[2] * c[2];
  const mc = m[0] * c[0] + m[1] * c[1] + m[2] * c[2];
  return { normal: [m[0] / l, m[1] / l, m[2] / l], offset: (offset - nc + mc) / l };
}

/** A prim's shape under the squash: scale times S, bend times S. Endpoints are the caller's (they live in different frames for the
 *  posed head and the rest body). Untouched otherwise: an unbent prim stays unbent. */
export function squashShape<P extends { scale: Vec3; bend?: Vec3 }>(p: P, s: Vec3): P {
  return {
    ...p,
    scale: [p.scale[0] * s[0], p.scale[1] * s[1], p.scale[2] * s[2]],
    ...(p.bend ? { bend: [p.bend[0] * s[0], p.bend[1] * s[1], p.bend[2] * s[2]] as Vec3 } : {}),
  };
}

/** A REST-frame prim (world rest coordinates, centre `c` in the same frame) wholly squashed: endpoints, shape and clip plane. */
export function squashRestPrim<P extends { a: Vec3; b: Vec3; scale: Vec3; bend?: Vec3; shell?: ShellParams }>(
  p: P, c: Vec3, s: Vec3,
): P {
  const out = squashShape({ ...p, a: squashPoint(p.a, c, s), b: squashPoint(p.b, c, s) }, s);
  if (p.shell) {
    const pl = squashPlane(p.shell.clipNormal, p.shell.clipOffset, c, s);
    out.shell = { ...p.shell, clipNormal: pl.normal, clipOffset: pl.offset };
  }
  return out;
}
