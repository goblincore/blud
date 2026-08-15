// src/lab/sdf-zombie/face.ts
// Parametric face: named parameters in, primitive definitions out.
//
// Every feature rides the `skull` bone and lands in the `head` cluster, so the
// fixed fold order is untouched and a severed head takes its face with it.
//
// WHY THIS IS ONLY A NOSE AND A BROW. Four passes of carved eye sockets, mouths and
// temples produced a snouted creature, never a readable face, and there is a
// structural reason rather than a tuning one: smin scales k by 4, so even a
// 0.0035 blend constant smears over ~1.4 cm. Eye sockets are inherently
// SMALLER than that blend zone, so they cannot hold a crisp edge — they fuse
// into a single dark band or vanish. Meanwhile a 34x32 pixel Blood sprite
// carries a completely legible face. Texture does features at this scale;
// smooth-min does not.
//
// It is also ~100x cheaper. A primitive costs prims x steps x pixels, and
// mapBody runs about a hundred times per pixel; a texture costs ONE sample at
// the hit point. The twelve face primitives also switched on the carve pass,
// which had been returning immediately while uCarveCount was 0.
//
// So the split is now: geometry carries SILHOUETTE (the nose, which changes
// the profile and no texture can fake), texture carries FEATURES (eyes, mouth,
// brow shading, rot). Carving infrastructure stays — wounds use it and the
// skeleton follow-up needs max(flesh, -bone) — it is just wrong for a face.
//
// PLACEMENT MODEL. Features are NOT
// spread along the bone with `at`. The skull bone is 0.16 m long while the head
// it carries is a ~0.24 m ellipsoid, so an `at` range wide enough to reach the
// chin still bunches everything into the middle of the face. Instead every
// primitive sits at HEAD_AT (the cranium's own centre) and is positioned purely
// by an offset in METRES from there, measured against the cranium's real
// half-extents below. That makes the numbers mean something: "brow 2.2 cm up,
// 10 cm forward" is checkable by hand.

import type { PrimDef, Vec3 } from './types';

/**
 * Which way the zombie faces, in world axes. The forearms angle +z
 * (`foreArm dir: [0.05, -1, 0.1]`) and the feet drift +z, and a camera at
 * yaw 0 (i.e. on +z) looks at the face — so +z is the front.
 */
export const FACE_FORWARD = 1;

/**
 * Normalised position of the CRANIUM primitive along the skull bone — see
 * `body.ts`, which places it at `at: 0.45` with radius 0.115 and scale
 * [1, 1.08, 1.05]. Every face offset below is measured from this point.
 */
const HEAD_AT = 0.45;

/**
 * Cranium half-extents in metres: radius x scale, from that same primitive.
 * The front of the face is therefore about +0.121 in z, which is what keeps
 * the carves below from punching clean through the skull.
 */
const HEAD_RZ = 0.121;

export interface FaceParams {
  /** How far the nose projects beyond the face, in metres. */
  noseLength: number;
  noseWidth: number;
  /** How far the tip hangs below the bridge. */
  noseDroop: number;
  /** How far the bridge bows forward before the tip — the hook. */
  noseHook: number;
  browHeavy: number;
  /** Height of the brow ridge above the cranium centre. */
  browRise: number;
}

/**
 * A big hooked drooping nose under a heavy brow.
 *
 * The nose gets four parameters to the brow's two because it is the only
 * feature that meaningfully changes the head's silhouette, and silhouette is
 * the one thing the face texture cannot supply.
 */
export const DEFAULT_FACE: FaceParams = {
  noseLength: 0.045,
  noseWidth: 0.85,
  noseDroop: 0.028,
  noseHook: 0.012,
  browHeavy: 0.030,
  browRise: 0.022,
};

/** A face primitive, tagged so tests and the panel can find one by name. */
export interface FacePrim extends PrimDef {
  tag: string;
}

const HEAD = { bone: 'skull', limb: 'head', at: HEAD_AT } as const;

export function facePrims(f: FaceParams): FacePrim[] {
  /** Offset from the cranium centre, in metres. z is flipped to face front. */
  const off = (x: number, y: number, z: number): Vec3 => [x, y, z * FACE_FORWARD];

  // Where the nose leaves the face, and where its tip ends up.
  const browY = f.browRise + 0.026;
  const noseBaseZ = HEAD_RZ - 0.020;

  return [
    // --- Added: the parts that stick out ------------------------------------
    {
      ...HEAD, tag: 'brow', radius: 0.026, blendK: 0.009,
      // Wide and shallow — a ledge over the eyes, not a second forehead.
      scale: [1.9, 0.55, 0.75],
      offset: off(0, browY, noseBaseZ - 0.012 + f.browHeavy * 0.4),
    },
    {
      ...HEAD, tag: 'nose-bridge', radius: 0.017, blendK: 0.008,
      scale: [f.noseWidth * 0.7, 1.5, 1.0],
      offset: off(0, browY - 0.030, noseBaseZ + f.noseHook),
    },
    {
      ...HEAD, tag: 'nose-tip', radius: 0.021, blendK: 0.008,
      scale: [f.noseWidth, 1.0, 1.1],
      offset: off(0, browY - 0.030 - f.noseDroop, noseBaseZ + f.noseLength),
    },
  ];
}
