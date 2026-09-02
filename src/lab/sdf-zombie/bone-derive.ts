// src/lab/sdf-zombie/bone-derive.ts
import type { PrimDef, ShellParams, Vec3 } from './types';

/**
 * Bone radius as a fraction of the flesh prim it sits inside.
 *
 * Deliberately conservative. Too fat and every pellet scratch reaches bone,
 * which stops it meaning anything; the spec records that as an explicit
 * on-screen judgement call rather than a number this file can settle.
 */
export const DEFAULT_BONE_RATIO = 0.38;

/**
 * A prim is STRUCTURAL MASS (and so grows a bone) when its radius is at least
 * this fraction of the fattest additive prim on the same bone. Relative rather
 * than absolute so it means the same thing on a mouse and on an ogre.
 */
const MASS_FRACTION = 0.5;

/**
 * The fields derivation reads or copies. Generic over the prim flavour so the
 * same function derives from AUTHORED defs (PrimDef, Task 3's unit tests) and
 * from EXPANDED defs with concrete limbs (buildBody's call), each output
 * keeping its input's full shape.
 */
type BoneSource = {
  bone?: string;
  radius: number;
  radiusB?: number;
  scale: Vec3;
  blendK: number;
  op?: 'add' | 'sub' | 'groove' | 'bone';
  shell?: ShellParams;
  core?: boolean;
  color?: Vec3;
  gloss?: number;
};

/**
 * Auto-derives bone primitives from a body's flesh primitives.
 *
 * A femur genuinely IS a thinner capsule inside the thigh capsule on the same
 * bone, so this is the correct answer for limbs rather than a fallback. The
 * torso and skull are the two places players actually shoot and both want an
 * authored shape instead — the `bones` block overrides per cluster (Task 4).
 *
 * Shaping is dropped on purpose: `wide`/`tall`/`deep` describe a fleshy mass,
 * and inheriting them would give a ribcage-shaped femur.
 */
export function deriveBones<T extends BoneSource>(prims: T[], ratio: number): T[] {
  if (ratio <= 0) return [];

  // Fattest additive prim per bone — the mass yardstick everything on that
  // bone is measured against.
  const fattest = new Map<string, number>();
  for (const p of prims) {
    if (p.op === 'sub' || p.op === 'groove' || p.op === 'bone') continue;
    if (!p.bone) continue;
    fattest.set(p.bone, Math.max(fattest.get(p.bone) ?? 0, p.radius));
  }

  const out: T[] = [];
  for (const p of prims) {
    if (p.op === 'sub' || p.op === 'groove' || p.op === 'bone') continue;
    if (!p.bone) continue;
    // Shell prims are cloth, not mass — a coat does not have a bone in it.
    if (p.shell) continue;
    const mass = fattest.get(p.bone) ?? 0;
    if (p.radius < mass * MASS_FRACTION) continue;

    out.push({
      ...p,
      op: 'bone',
      radius: p.radius * ratio,
      // A tapered flesh prim keeps its taper, scaled — a femur narrows where
      // the thigh does. Absent stays absent.
      radiusB: p.radiusB === undefined ? undefined : p.radiusB * ratio,
      scale: [1, 1, 1],
      // Hard-edged: bone meeting bone should crease, not smear.
      blendK: 0,
      // Colour and gloss belong to the flesh prim that carried them (a shoe, a
      // lens). Bone has its own material and must not inherit them.
      color: undefined,
      gloss: undefined,
      // Never the cluster's structural core — that is the flesh's job, and a
      // bone winning the fuse probe would change severing behaviour.
      core: false,
    });
  }
  return out;
}
