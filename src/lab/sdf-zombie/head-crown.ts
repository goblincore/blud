// src/lab/sdf-zombie/head-crown.ts
//
// SKULL AND BRAIN (spec §7). Pure. The crown is the top of the head on its up axis; the scalp tear is two
// craters across the head's left-right axis; the brain is one whole gob piece (two hemispheres, curled
// gyri, a stem and a cerebellum, all within 0.12 m of its origin) launched up and along the blow, plus
// three bone-coloured skull chips.
import { GORE_COLORS, prim } from './head-pop';
import type { GorePiece } from './head-pop';
import { rotate } from './head-deform';
import type { HeadFrame } from './head-deform';
import type { Primitive, Vec3 } from './types';

export const CROWN = { scalpR: 0.05, scalpSpacing: 0.035, brainR: 0.08, launch: 3.5 } as const;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Above the head on its up axis: the leaf traces down from here to find the crown surface. */
export function crownRayStart(frame: HeadFrame): Vec3 {
  return add(frame.centre, rotate(frame.quat, [0, 1.6 * frame.axes[1], 0]));
}

/** The two scalp craters, spread across the head's left-right axis. */
export function scalpCraterPoints(crown: Vec3, frame: HeadFrame): [Vec3, Vec3] {
  const s = rotate(frame.quat, [CROWN.scalpSpacing / 2, 0, 0]);
  return [add(crown, s), add(crown, scale(s, -1))];
}

/** Blow direction flattened to the horizontal (fallback: forward). */
function flat(d: Vec3): Vec3 {
  const l = Math.hypot(d[0], d[2]);
  return l < 1e-6 ? [0, 0, 1] : [d[0] / l, 0, d[2] / l];
}

/** The whole brain: 9 prims around `crown`, launched up and along the blow with a spin. */
export function brainPiece(crown: Vec3, blowDir: Vec3, rand: () => number): GorePiece {
  const o = crown;
  const at = (x: number, y: number, z: number): Vec3 => [o[0] + x, o[1] + y, o[2] + z];
  const B = GORE_COLORS.brain, gy: Vec3 = scale(B, 0.85), dark: Vec3 = scale(B, 0.5);
  const prims: Primitive[] = [
    // Two hemispheres.
    prim(at(-0.022, 0, 0), at(-0.022, 0, 0), 0.045, B, { scale: [0.9, 0.75, 1.15], gloss: 0.5, blendK: 0.01, op: 'add' }),
    prim(at(0.022, 0, 0), at(0.022, 0, 0), 0.045, B, { scale: [0.9, 0.75, 1.15], gloss: 0.5, blendK: 0.01, op: 'add' }),
    // Curled gyri on top of each hemisphere.
    prim(at(-0.035, 0.022, -0.04), at(-0.035, 0.022, 0.04), 0.014, gy, { bend: [0.012, 0, 0], gloss: 0.5, blendK: 0.008, op: 'add' }),
    prim(at(-0.012, 0.028, -0.04), at(-0.012, 0.028, 0.04), 0.014, gy, { bend: [-0.012, 0, 0], gloss: 0.5, blendK: 0.008, op: 'add' }),
    prim(at(0.012, 0.028, -0.04), at(0.012, 0.028, 0.04), 0.014, gy, { bend: [0.012, 0, 0], gloss: 0.5, blendK: 0.008, op: 'add' }),
    prim(at(0.035, 0.022, -0.04), at(0.035, 0.022, 0.04), 0.014, gy, { bend: [-0.012, 0, 0], gloss: 0.5, blendK: 0.008, op: 'add' }),
    // The darker fissure between the hemispheres.
    prim(at(0, 0.03, -0.05), at(0, 0.03, 0.05), 0.006, dark, { blendK: 0.004, op: 'add' }),
    // Stem and cerebellum.
    prim(at(0, -0.02, -0.02), at(0, -0.06, -0.035), 0.012, B, { radiusB: 0.009, blendK: 0.008, op: 'add' }),
    prim(at(0, -0.03, -0.06), at(0, -0.03, -0.06), 0.022, gy, { scale: [1.3, 0.8, 0.9], blendK: 0.01, op: 'add' }),
  ];
  const s = flat(blowDir);
  const dir = norm([s[0] * 0.6 + (rand() - 0.5) * 0.2, 1 + (rand() - 0.5) * 0.2, s[2] * 0.6 + (rand() - 0.5) * 0.2]);
  return {
    limb: 'head', origin: o, prims, kind: 'gob', tornAt: [], bones: [],
    vel: scale(dir, CROWN.launch),
    angVel: [(rand() - 0.5) * 16, (rand() - 0.5) * 16, (rand() - 0.5) * 16],
  };
}

/** Three small flat bone-coloured chips thrown up and outward at 2-3 m/s. */
export function skullChips(crown: Vec3, blowDir: Vec3, rand: () => number): GorePiece[] {
  const s = flat(blowDir);
  const out: GorePiece[] = [];
  for (let i = 0; i < 3; i++) {
    const th = rand() * Math.PI * 2;
    const dir = norm([Math.cos(th) * 0.7 + s[0] * 0.4, 1, Math.sin(th) * 0.7 + s[2] * 0.4]);
    const o = add(crown, [(rand() - 0.5) * 0.04, 0.005, (rand() - 0.5) * 0.04]);
    out.push({
      limb: 'head', origin: o, kind: 'gob', tornAt: [], bones: [],
      prims: [prim(o, o, 0.018, [0.86, 0.82, 0.7], { scale: [1, 0.35, 0.8], blendK: 0.002, op: 'add' })],
      vel: scale(dir, 2 + rand()),
      angVel: [(rand() - 0.5) * 30, (rand() - 0.5) * 30, (rand() - 0.5) * 30],
    });
  }
  return out;
}
