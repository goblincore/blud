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
  /** Overall size of the head, in metres. */
  headRadius: number;
  /** Ellipsoid scales. Raising headHeight gives the taller dome. */
  headWidth: number;
  headHeight: number;
  headDepth: number;
  /**
   * Smooth-min strength against the neck. Kept small: smin scales k by 4, so
   * the old 0.0125 fused head into neck across 5 cm and the silhouette lost
   * its jaw entirely.
   */
  headBlend: number;
}

/** A clean oval, a little taller than wide. */
export const DEFAULT_FACE: FaceParams = {
  headRadius: 0.125,
  headWidth: 1.0,
  headHeight: 1.22,
  headDepth: 1.05,
  headBlend: 0.006,
};

/** A head primitive, tagged so tests and the panel can find it by name. */
export interface FacePrim extends PrimDef {
  tag: string;
}

export function facePrims(f: FaceParams): FacePrim[] {
  const scale: Vec3 = [f.headWidth, f.headHeight, f.headDepth];
  return [
    {
      bone: 'skull', limb: 'head', at: HEAD_AT, tag: 'head',
      radius: f.headRadius, scale, blendK: f.headBlend,
    },
  ];
}
