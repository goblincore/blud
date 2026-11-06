// src/lab/sdf-zombie/orient-shape.ts
//
// Whether a prim's orient quat changes its FIELD, or only its noise frame.
//
// A point prim (a == b) that is isotropic and carries no box, shell, strand,
// bend or taper is a sphere: rotating it about its own centre (what sdPrimO
// does with the orient) leaves the distance field unchanged. applyRig still
// stamps such a prim's bone rotation as a pose orient (2026-11-05), because
// restPoint (march/fields/carves.wgsl.ts) and its CPU twin restSpacePoint
// (validate.ts) build a point prim's rest frame from the orient alone: without
// it the hand, knee and shoulder balls read their skin noise and body-normal
// map unrotated while the limb turns, and the noise tears into a ring where
// the dominant prim flips to the next capsule.
//
// The orient is therefore NOISE-ONLY on these prims, and the pack keeps their
// cluster off the oriented march path (clusterRange.w bit 1): sdPrimO costs a
// fourth texture load per prim (measured +10-18% frame time), for no change
// to the surface here.

import type { Primitive } from './types';

/** True when rotating `p` about its midpoint changes its distance field. */
export function orientShapesField(p: Primitive): boolean {
  return p.a[0] !== p.b[0] || p.a[1] !== p.b[1] || p.a[2] !== p.b[2]
    || p.scale[0] !== p.scale[1] || p.scale[1] !== p.scale[2]
    || p.box !== undefined || p.shell !== undefined || p.strand !== undefined
    || p.bend !== undefined || p.radiusB !== undefined;
}
