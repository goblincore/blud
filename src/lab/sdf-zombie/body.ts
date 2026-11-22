// src/lab/sdf-zombie/body.ts
//
// The frozen hand-authored reference zombie BodyDef, with makeZombie to rebuild it for a given face.

import type { BodyDef } from './types';
import { DEFAULT_FACE, facePrims, type FaceParams } from './face';

/**
 * The lab zombie — authored as discrete, named, relative, symmetric decisions.
 * Only the left side is written; `mirror: true` generates the right.
 *
 * Proportions are deliberately wrong in a B-movie way: long arms hanging past
 * the hip line, head pitched forward of the spine, heavy gut.
 *
 * FROZEN REFERENCE — not what the lab renders any more. As of Task 6 the lab
 * builds the zombie from `characters/zombie.blob`; this stays only as the
 * value the `.blob` language is pinned against by the anchor test
 * (`characters/zombie-blob.test.ts`), which fails loudly if the two diverge.
 * Tune `zombie.blob`, not this — a change here with no matching `.blob`
 * change just breaks that test instead of changing anything the game or lab
 * shows.
 */
const ZOMBIE_BASE: BodyDef = {
  name: 'zombie',
  root: [0, 0.92, 0], // pelvis height in metres

  bones: [
    { name: 'pelvis',   parent: null,     dir: [0, 1, 0],       length: 0.14 },
    // The upper body hunches FORWARD, i.e. +z.
    //
    // These three used to lean -z while the forearms angle +z
    // (`foreArm dir: [0.05, -1, 0.1]`) and the feet drift +z. The body faced
    // one way and the head tipped the other, so in profile the occiput jutted
    // out where the face should be and the head read as being on backwards —
    // while the face texture, projected onto +z, landed on the side you never
    // look at. The comment below always claimed "head pitched forward of the
    // spine"; the numbers just did the opposite.
    { name: 'spine',    parent: 'pelvis', dir: [0, 1, 0.12],    length: 0.34 },
    { name: 'neck',     parent: 'spine',  dir: [0, 1, 0.35],    length: 0.16 },
    { name: 'skull',    parent: 'neck',   dir: [0, 1, 0.18],    length: 0.16 },
    { name: 'clavicle', parent: 'spine',  dir: [1, 0, 0],       length: 0.20, side: 0,    mirror: true },
    { name: 'upperArm', parent: 'clavicle', dir: [0.30, -1, 0], length: 0.30, side: 0,    mirror: true },
    { name: 'foreArm',  parent: 'upperArm', dir: [0.05, -1, 0.1], length: 0.30, side: 0,  mirror: true },
    // Feet on the floor (2026-09-29): legs +0.06 / +0.08 and a foot bone; see zombie.blob.
    { name: 'thigh',    parent: 'pelvis', dir: [0, -1, 0],      length: 0.46, side: 0.10, mirror: true },
    { name: 'shin',     parent: 'thigh',  dir: [0, -1, 0.05],   length: 0.50, side: 0,    mirror: true },
    { name: 'foot',     parent: 'shin',   dir: [0, 0, 1],       length: 0.16, side: 0,    mirror: true },
  ],

  prims: [
    // Head — just the neck here. The skull itself is a single parameterised
    // ellipsoid emitted by face.ts, so it can be tuned live in the panel.
    { bone: 'neck',  at: 0.05, capTo: 1.0, radius: 0.045, scale: [1, 1, 1], blendK: 0.007, limb: 'head' },

    // Torso — ribcage tapering into a sagging gut.
    { bone: 'spine',  at: 0.80, radius: 0.150, scale: [1.28, 1, 0.78], blendK: 0.014, limb: 'torso' },
    { bone: 'spine',  at: 0.50, radius: 0.150, scale: [1.15, 1, 0.80], blendK: 0.02, limb: 'torso' },
    { bone: 'spine',  at: 0.15, radius: 0.142, scale: [1.02, 1, 0.95], blendK: 0.02, limb: 'torso' },
    { bone: 'pelvis', at: 0.40, radius: 0.145, scale: [1.10, 0.9, 0.92], blendK: 0.02, limb: 'torso' },
    // The flanks over the hip bones, which the thigh tops used to cover (2026-11-05; see zombie.blob).
    { bone: 'pelvis', at: 0.95, radius: 0.070, scale: [1, 1, 1], blendK: 0.03, limb: 'torso', offset: [0.11, 0, 0], rigid: true },
    { bone: 'pelvis', at: 0.95, radius: 0.070, scale: [1, 1, 1], blendK: 0.03, limb: 'torso', offset: [-0.11, 0, 0], rigid: true },

    // Arms — shoulder blob, then upper and forearm capsules, then a hand. Blended wide, so the shoulder reads as one
    // mound with the arm and torso (2026-11-05; see zombie.blob). The HANDS (2026-11-22; zombie.blob's HANDS block): a
    // tapered wrist, a palm, a knuckle ridge, four hooked fingers and a thumb, all on foreArm past its tail.
    { bone: 'clavicle', at: 0.90, radius: 0.072, scale: [1, 1, 1], blendK: 0.030, limb: 'arm', mirror: true },
    { bone: 'upperArm', at: 0.02, capTo: 0.95, radius: 0.055, scale: [1, 1, 1], blendK: 0.015, limb: 'arm', mirror: true },
    { bone: 'foreArm',  at: 0.05, capTo: 0.90, radius: 0.048, radiusB: 0.034, scale: [1, 1, 1], blendK: 0.007, limb: 'arm', mirror: true },
    { bone: 'foreArm',  at: 1.14, radius: 0.04, scale: [1.22, 1.2, 0.5], blendK: 0.0125, limb: 'arm', mirror: true },
    { bone: 'foreArm',  at: 1.27, capTo: 1.55, radius: 0.012, radiusB: 0.008, scale: [1, 1, 1], blendK: 0.004, limb: 'arm', mirror: true, offset: [-0.0307, -0.0046, 0.0003], tip: [-0.0189, 0.0157, -0.0348], bend: [-0.0015, -0.0156, 0.0168], lod: 'near' },
    { bone: 'foreArm',  at: 1.27, capTo: 1.57, radius: 0.0125, radiusB: 0.0085, scale: [1, 1, 1], blendK: 0.004, limb: 'arm', mirror: true, offset: [-0.0089, -0.0013, 0.0001], tip: [-0.0072, 0.0183, -0.0379], bend: [0.0016, -0.0161, 0.0178], lod: 'near' },
    { bone: 'foreArm',  at: 1.27, capTo: 1.55, radius: 0.012, radiusB: 0.008, scale: [1, 1, 1], blendK: 0.004, limb: 'arm', mirror: true, offset: [0.0129, 0.0019, -0.0001], tip: [0.0048, 0.0192, -0.036], bend: [0.0044, -0.0147, 0.0167], lod: 'near' },
    { bone: 'foreArm',  at: 1.25, capTo: 1.47, radius: 0.0105, radiusB: 0.0072, scale: [1, 1, 1], blendK: 0.004, limb: 'arm', mirror: true, offset: [0.0336, 0.005, -0.0003], tip: [0.0154, 0.0171, -0.0289], bend: [0.0059, -0.0116, 0.0136], lod: 'near' },
    { bone: 'foreArm',  at: 1.06, capTo: 1.3, radius: 0.0145, radiusB: 0.0095, scale: [1, 1, 1], blendK: 0.006, limb: 'arm', mirror: true, offset: [-0.0455, -0.0074, -0.0115], tip: [-0.0117, 0.0091, -0.0265], bend: [-0.0047, -0.0084, 0.0084], lod: 'near' },
    // The far LOD stand-ins (zombie.blob DISTANCE LOD): built dead, drawn only on a body small on screen.
    { bone: 'foreArm',  at: 1.27, capTo: 1.6, radius: 0.015, radiusB: 0.0134, scale: [3.4, 1, 0.9], blendK: 0.006, limb: 'arm', mirror: true, offset: [0.0018, 0.0013, -0.0001], tip: [-0.0011, 0.0209, -0.0419], lod: 'far' },
    { bone: 'foreArm',  at: 1.06, capTo: 1.35, radius: 0.0174, radiusB: 0.0114, scale: [1, 1, 1], blendK: 0.006, limb: 'arm', mirror: true, offset: [-0.0455, -0.0074, -0.0115], tip: [-0.014, 0.0109, -0.0318], lod: 'far' },

    // Legs — thigh, shin, ankle, foot (heel + sole down to the floor; see zombie.blob).
    // The thigh starts 0.18 down and tapers (2026-11-05; see zombie.blob): no flesh ball left at the hip.
    { bone: 'thigh', at: 0.18, capTo: 0.95, radius: 0.082, radiusB: 0.072, scale: [1, 1, 1], blendK: 0.03, limb: 'leg', mirror: true },
    { bone: 'shin',  at: 0.05, capTo: 0.92, radius: 0.062, scale: [1, 1, 1], blendK: 0.015, limb: 'leg', mirror: true },
    { bone: 'shin',  at: 1.00, radius: 0.058, scale: [1, 1, 1], blendK: 0.0125, limb: 'leg', mirror: true },
    { bone: 'foot',  at: 0.00, radius: 0.058, scale: [1.05, 0.95, 1.05], blendK: 0.012, limb: 'leg', mirror: true, offset: [0, -0.041, -0.010] },
    { bone: 'foot',  at: 0.00, capTo: 1.00, radius: 0.052, radiusB: 0.046, scale: [1.15, 1, 1], blendK: 0.014, limb: 'leg', mirror: true, offset: [0, -0.045, 0] },
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
