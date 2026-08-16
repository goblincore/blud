// src/lab/sdf-zombie/face.ts
// The head: one smooth ellipsoid, parameterised. The face is TEXTURE.
//
// HOW THIS ENDED UP SO SMALL. Earlier versions built the face from geometry —
// carved eye sockets, a mouth, temples and cheekbones, then a nose, a brow, a
// chin, jaw corners, and additive eyeballs under drooping lids. Every one was
// tried on screen. None read as a face, and each attempt taught something:
//
// 1. SMOOTH carves cannot make small features. smin scales k by 4, so even a
//    0.0035 blend constant smears across ~1.4 cm — wider than an eye socket
//    itself. Adjacent sockets fused into one dark band across the face.
// 2. HARD carves (blendK 0) fix that completely: smin short-circuits to a
//    plain min, so a feature holds a crisp edge at any size. Hard min/max are
//    also associative, making zero-blend features the one place in this design
//    exempt from the fold-order constraint. This worked, and is worth keeping
//    for wounds, stumps, and the skeleton field.
// 3. But crisp geometry still did not make a FACE, because every primitive
//    shares one albedo. A geometric eyeball is flesh-coloured and reads only
//    through shading. Faces are mostly colour, not shape.
// 4. And a protruding nose actively BREAKS a planar face projection: it sticks
//    through the projection plane and stays untextured.
//
// So the head is one oval and the texture does the work — which is what PSX-era
// characters actually did. It is also far cheaper: a primitive costs
// prims x steps x pixels and mapBody runs ~100 times per pixel, whereas a
// texture costs one sample at the hit point.
//
// The carving machinery all still exists and is still used, by wounds and by
// the skeleton follow-up that needs max(flesh, -bone). It is just the wrong
// tool for a face.

import type { PrimDef, Vec3 } from './types';

/**
 * Which way the zombie faces, in world axes. The forearms angle +z
 * (`foreArm dir: [0.05, -1, 0.1]`) and the feet drift +z, and a camera at
 * yaw 0 (i.e. on +z) looks at the face — so +z is the front.
 */
export const FACE_FORWARD = 1;

/** Normalised position of the head along the `skull` bone. */
const HEAD_AT = 0.45;

export interface FaceParams {
  /** Overall size of the cranium, in metres. */
  headRadius: number;
  /**
   * Ellipsoid scales. Keep headHeight near 1: raising it SHARPENS the crown
   * rather than doming it, because an ellipsoid's pole curvature goes as
   * a^2/b. Height belongs in jawDrop, not here.
   */
  headWidth: number;
  headHeight: number;
  headDepth: number;
  /**
   * The jaw: a second, narrower mass below the cranium. One ellipsoid cannot
   * taper, and the Blud zombie's skull is an egg — widest at the cranium,
   * narrowing to a gaunt chin. Two primitives are the cheapest way to get that
   * silhouette, and silhouette is the one thing the face texture cannot supply.
   */
  jawWidth: number;
  jawHeight: number;
  /** How far the jaw hangs below the cranium centre, in metres. */
  jawDrop: number;
  /** Forward offset of the jaw — a small positive value juts the chin. */
  jawJut: number;
  /**
   * How far the nose projects beyond the face, in metres.
   *
   * Purely for the PROFILE: head-on it adds almost nothing the painted nose
   * does not already give, but in profile the skull is otherwise a smooth
   * curve with no break in it. Keep it SMALL. A planar face projection derives
   * uv from x/y alone, so a modest nose picks up the painted nose region
   * behind it, while a large one juts past the projection plane and reads as
   * an untextured lump — which is exactly how the earlier geometric nose
   * failed. 0 removes it entirely.
   */
  noseLength: number;
  noseWidth: number;
  /** How far below the head centre the nose sits. */
  noseDrop: number;
  /**
   * Smooth-min strength against the neck. Kept small: smin scales k by 4, so
   * the old 0.0125 fused head into neck across 5 cm and the silhouette lost
   * its jaw entirely.
   */
  headBlend: number;
}

/** A clean oval, a little taller than wide. */
export const DEFAULT_FACE: FaceParams = {
  // Tuned by hand in the panel, then baked. Keep headHeight near 1: raising it
  // SHARPENS the crown rather than doming it, so the height and the gaunt
  // taper both come from the jaw below.
  headRadius: 0.118,
  headWidth: 0.85,
  headHeight: 1.06,
  headDepth: 0.894,
  jawWidth: 0.748,
  jawHeight: 0.86,
  jawDrop: 0.076,
  jawJut: 0.03,
  noseLength: 0.016,
  noseWidth: 0.62,
  noseDrop: 0.012,
  headBlend: 0.006,
};

/** A head primitive, tagged so tests and the panel can find it by name. */
export interface FacePrim extends PrimDef {
  tag: string;
}

export function facePrims(f: FaceParams): FacePrim[] {
  const HEAD = { bone: 'skull', limb: 'head', at: HEAD_AT } as const;
  return [
    {
      ...HEAD, tag: 'head',
      radius: f.headRadius,
      scale: [f.headWidth, f.headHeight, f.headDepth],
      blendK: f.headBlend,
    },
    {
      ...HEAD, tag: 'jaw',
      // Narrower and lower, so the pair reads as a tapered skull rather than a
      // ball. Blended at the same k as the cranium: the crease between them is
      // the jaw line, and it only survives while k stays small — smin scales k
      // by 4, so anything much above 0.006 fuses the two back into an egg.
      radius: f.headRadius * 0.78,
      scale: [f.jawWidth, f.jawHeight, f.headDepth * 0.96],
      blendK: f.headBlend,
      offset: [0, -f.jawDrop, f.jawJut * FACE_FORWARD],
    },
    // The nose. Blended softly, because it is a large smooth form that should
    // melt into the face rather than sit on it as a separate bead.
    ...(f.noseLength > 0.0005 ? [{
      ...HEAD, tag: 'nose',
      radius: f.headRadius * 0.19,
      scale: [f.noseWidth, 0.85, 1.45] as Vec3,
      blendK: f.headBlend * 1.2,
      offset: [
        0,
        -f.noseDrop,
        (f.headRadius * f.headDepth * 0.80 + f.noseLength) * FACE_FORWARD,
      ] as Vec3,
    }] : []),
  ];
}
