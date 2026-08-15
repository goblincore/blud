// src/lab/sdf-zombie/body.ts
import type { BodyDef } from './types';
import { DEFAULT_FACE, facePrims, type FaceParams } from './face';

/**
 * The lab zombie — authored as discrete, named, relative, symmetric decisions.
 * Only the left side is written; `mirror: true` generates the right.
 *
 * Proportions are deliberately wrong in a B-movie way: long arms hanging past
 * the hip line, head pitched forward of the spine, heavy gut.
 */
const ZOMBIE_BASE: BodyDef = {
  name: 'zombie',
  root: [0, 0.92, 0], // pelvis height in metres

  bones: [
    { name: 'pelvis',   parent: null,     dir: [0, 1, 0],       length: 0.14 },
    { name: 'spine',    parent: 'pelvis', dir: [0, 1, -0.12],   length: 0.34 },
    { name: 'neck',     parent: 'spine',  dir: [0, 1, -0.35],   length: 0.16 },
    { name: 'skull',    parent: 'neck',   dir: [0, 1, -0.18],   length: 0.16 },
    { name: 'clavicle', parent: 'spine',  dir: [1, 0, 0],       length: 0.20, side: 0,    mirror: true },
    { name: 'upperArm', parent: 'clavicle', dir: [0.30, -1, 0], length: 0.30, side: 0,    mirror: true },
    { name: 'foreArm',  parent: 'upperArm', dir: [0.05, -1, 0.1], length: 0.30, side: 0,  mirror: true },
    { name: 'thigh',    parent: 'pelvis', dir: [0, -1, 0],      length: 0.40, side: 0.10, mirror: true },
    { name: 'shin',     parent: 'thigh',  dir: [0, -1, 0.05],   length: 0.42, side: 0,    mirror: true },
  ],

  prims: [
    // Head — skull plus a heavy jaw that juts forward.
    { bone: 'skull', at: 0.45, radius: 0.115, scale: [1, 1.08, 1.05], blendK: 0.0125, limb: 'head' },
    { bone: 'skull', at: 0.15, radius: 0.075, scale: [0.9, 0.7, 1.25], blendK: 0.0125, limb: 'head' },
    { bone: 'neck',  at: 0.05, capTo: 1.0, radius: 0.045, scale: [1, 1, 1], blendK: 0.007, limb: 'head' },

    // Torso — ribcage tapering into a sagging gut.
    { bone: 'spine',  at: 0.80, radius: 0.150, scale: [1.28, 1, 0.78], blendK: 0.014, limb: 'torso' },
    { bone: 'spine',  at: 0.50, radius: 0.150, scale: [1.15, 1, 0.80], blendK: 0.02, limb: 'torso' },
    { bone: 'spine',  at: 0.15, radius: 0.142, scale: [1.02, 1, 0.95], blendK: 0.02, limb: 'torso' },
    { bone: 'pelvis', at: 0.40, radius: 0.145, scale: [1.10, 0.9, 0.92], blendK: 0.02, limb: 'torso' },

    // Arms — shoulder blob, then upper and forearm capsules, then a fist.
    { bone: 'clavicle', at: 0.90, radius: 0.072, scale: [1, 1, 1], blendK: 0.010, limb: 'arm', mirror: true },
    { bone: 'upperArm', at: 0.02, capTo: 0.95, radius: 0.055, scale: [1, 1, 1], blendK: 0.007, limb: 'arm', mirror: true },
    { bone: 'foreArm',  at: 0.05, capTo: 0.90, radius: 0.048, scale: [1, 1, 1], blendK: 0.007, limb: 'arm', mirror: true },
    { bone: 'foreArm',  at: 1.00, radius: 0.062, scale: [1, 1, 1], blendK: 0.0125, limb: 'arm', mirror: true },

    // Legs — thigh, shin, foot.
    { bone: 'thigh', at: 0.05, capTo: 0.95, radius: 0.082, scale: [1, 1, 1], blendK: 0.0175, limb: 'leg', mirror: true },
    { bone: 'shin',  at: 0.05, capTo: 0.92, radius: 0.062, scale: [1, 1, 1], blendK: 0.015, limb: 'leg', mirror: true },
    { bone: 'shin',  at: 1.00, radius: 0.070, scale: [0.85, 0.6, 1.5], blendK: 0.0125, limb: 'leg', mirror: true },
  ],
};

/**
 * The zombie with a face attached.
 *
 * Face primitives are generated rather than authored inline so the tuning
 * panel can drive them live; bake a tuned FaceParams back into DEFAULT_FACE
 * in face.ts once it lands.
 */
export function makeZombie(face: FaceParams = DEFAULT_FACE): BodyDef {
  return { ...ZOMBIE_BASE, prims: [...ZOMBIE_BASE.prims, ...facePrims(face)] };
}

/** The default-faced zombie. Kept as a const for the existing test importers. */
export const ZOMBIE: BodyDef = makeZombie();
