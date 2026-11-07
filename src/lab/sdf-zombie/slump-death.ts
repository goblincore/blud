// src/lab/sdf-zombie/slump-death.ts
//
// THE FORWARD SLUMP (owner playtest 2026-11-03: "it's not possible for the zombie to die like his knees bend and he
// falls over, back bent, rear in the air, slumped over"). The free ragdoll's corpses nearly always went over
// BACKWARD: the hips passed behind the feet, the legs were pulled straight and lay flat, whatever held the feet (a
// foot plant alone was tried and reverted: knees folded mid-fall, then straightened). A body only ends kneeling and
// slumped if it falls FORWARD over its knees, so a share of the physics deaths that are not blown away start that
// way: every joint is given a velocity forward and down that grows with its height (the feet none, the knees a
// little, the head most), and the feet are planted for that death (collapse.ts plantFeet), so the knees buckle
// forward over them and the top pitches down. Forward is the way the knees bend (the caller reads it off the knee
// hinge), so it cannot come out backward on a body that turned.
//
// Pure: randomness comes in as a function; no clock.
import type { RigPoint } from './rig';
import type { Vec3 } from './types';

/** Tuning (wound panel `slump` sets `chance`). Speeds in m/s at the body's highest joint, before jitter. */
export const SLUMP = {
  /** Share of physics deaths not blown away that slump forward. */
  chance: 0.4,
  /** Forward at the top. */
  tilt: 1.7,
  /** Down at the top (the knees give way). */
  drop: 1.1,
  /** Spin about the vertical (rad/s), either way: a slump that twists as it goes. */
  spin: 0.8,
};

export function setSlump(k: Partial<typeof SLUMP>): void { Object.assign(SLUMP, k); }

export interface SlumpPlan { tilt: number; drop: number; spin: number; }

/** Rolls the slump: null for no slump. `rand` returns [0, 1) and is called a fixed number of times. */
export function planSlump(rand: () => number, t: typeof SLUMP = SLUMP): SlumpPlan | null {
  const roll = rand(), j1 = rand(), j2 = rand(), s = rand();
  if (roll >= t.chance) return null;
  return { tilt: t.tilt * (0.75 + 0.5 * j1), drop: t.drop * (0.75 + 0.5 * j2), spin: (s - 0.5) * 2 * t.spin };
}

/** Per-point velocities: forward (horizontal, unit) and down, scaled by height in the body (0 at the lowest joint,
 *  1 at the highest), so the feet stay where they stand. */
export function slumpVelocities(points: readonly RigPoint[], forward: Vec3, plan: SlumpPlan): Vec3[] {
  let lo = Infinity, hi = -Infinity;
  for (const p of points) { lo = Math.min(lo, p.pos[1]); hi = Math.max(hi, p.pos[1]); }
  const span = hi - lo > 1e-6 ? hi - lo : 1;
  return points.map(p => {
    const h = (p.pos[1] - lo) / span;
    return [forward[0] * plan.tilt * h, -plan.drop * h, forward[2] * plan.tilt * h];
  });
}
