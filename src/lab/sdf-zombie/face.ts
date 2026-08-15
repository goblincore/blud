// src/lab/sdf-zombie/face.ts
// Parametric face: named parameters in, primitive definitions out.
//
// DIVISION OF LABOUR, and worth defending: geometry carries FORM, texture
// carries SURFACE. At the resolution this renders at, a nose painted into a
// texture reads as a smudge and an eye socket painted as a dark ellipse reads
// as a sticker. So the whole face is primitives — added for the parts that
// stick out, carved for the parts that go in.
//
// Every feature rides the `skull` bone and lands in the `head` cluster, so the
// fixed fold order is untouched and a severed head takes its face with it.
//
// PLACEMENT MODEL — the thing that went wrong the first time. Features are NOT
// spread along the bone with `at`. The skull bone is 0.16 m long while the head
// it carries is a ~0.24 m ellipsoid, so an `at` range wide enough to reach the
// chin still bunches everything into the middle of the face. Instead every
// primitive sits at HEAD_AT (the cranium's own centre) and is positioned purely
// by an offset in METRES from there, measured against the cranium's real
// half-extents below. That makes the numbers mean something: "sockets 4.5 cm
// apart, 1.5 cm up, 9.5 cm forward" is a face, and is checkable by hand.

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
const HEAD_RY = 0.124;

export interface FaceParams {
  /** How far the nose projects beyond the face, in metres. */
  noseLength: number;
  noseWidth: number;
  /** How far the tip hangs below the bridge. */
  noseDroop: number;
  /** How far the bridge bows forward before the tip — the hook. */
  noseHook: number;
  browHeavy: number;
  socketDepth: number;
  socketSpacing: number;
  /** Height of the sockets above the cranium centre. */
  socketRise: number;
  cheekJut: number;
  templeSink: number;
  mouthWidth: number;
  mouthHeight: number;
  mouthOpen: number;
}

/**
 * A big hooked drooping nose, a heavy brow, and deep-set eyes.
 *
 * The nose gets four parameters to everything else's one because at this
 * resolution it is the single largest contributor to a readable silhouette.
 */
export const DEFAULT_FACE: FaceParams = {
  noseLength: 0.045,
  noseWidth: 0.85,
  noseDroop: 0.028,
  noseHook: 0.012,
  browHeavy: 0.032,
  socketDepth: 0.024,
  socketSpacing: 0.052,
  socketRise: 0.020,
  cheekJut: 0.014,
  templeSink: 0.022,
  mouthWidth: 0.026,
  mouthHeight: 0.011,
  mouthOpen: 0.010,
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
  const browY = f.socketRise + 0.026;
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
    {
      ...HEAD, tag: 'cheek', radius: 0.026, blendK: 0.012,
      // Cheekbones sit BESIDE and UNDER the eyes, set well back from the nose.
      // Forward of that they stop reading as cheeks and build a muzzle, which
      // turns the whole head into a snout.
      scale: [1.15, 0.65, 0.7], mirrorOffset: true,
      offset: off(0.064, -0.018, noseBaseZ - 0.072 + f.cheekJut),
    },

    // --- Carved: the parts that go in ---------------------------------------
    // Sockets sit just inside the front surface so they scoop a dish rather
    // than bore a hole. Small blendK keeps the rim crisp: smax scales k by 4,
    // so 0.005 is already a 2 cm blend on a 3 cm socket.
    {
      ...HEAD, tag: 'eye-socket', radius: f.socketDepth, blendK: 0.0035,
      // Kept NARROW in x. Two sockets a socketSpacing apart must not have their
      // blend zones overlap, or they fuse into a single dark band across the
      // face — smax scales k by 4, so the gap has to clear 4*blendK as well as
      // the two half-axes.
      scale: [0.95, 0.95, 0.80], op: 'sub', mirrorOffset: true,
      offset: off(f.socketSpacing, f.socketRise, HEAD_RZ + 0.006),
    },
    {
      ...HEAD, tag: 'nostril', radius: 0.007, blendK: 0.003,
      scale: [1.0, 1.4, 1.0], op: 'sub', mirrorOffset: true,
      offset: off(0.011, browY - 0.036 - f.noseDroop, noseBaseZ + f.noseLength + 0.014),
    },
    {
      ...HEAD, tag: 'mouth', radius: f.mouthHeight, blendK: 0.005,
      // Wide, flat and shallow. mouthOpen stretches it vertically.
      scale: [f.mouthWidth / f.mouthHeight, 1.0 + f.mouthOpen * 25, 0.8],
      op: 'sub',
      offset: off(0, -HEAD_RY * 0.66, noseBaseZ - 0.010),
    },
    {
      ...HEAD, tag: 'temple', radius: f.templeSink, blendK: 0.008,
      // At the SIDE of the skull, well back from the brow — hollowing the
      // temples, not slotting the crown.
      scale: [0.8, 1.3, 1.1], op: 'sub', mirrorOffset: true,
      offset: off(0.108, f.socketRise + 0.012, noseBaseZ - 0.075),
    },
  ];
}
