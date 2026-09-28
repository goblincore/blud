// src/lab/sdf-zombie/webgpu/game-seams-head.ts
//
// Head damage automation seams (melee head damage, game-head-damage.ts): read an actor's head state and
// drive a head hit directly, without swinging (the gates' stage driver). A seam hit is not a flail strike,
// so the flail's own lastStrike.headHits does not count it.
import type { GameContext } from './game-context';
import type { Vec3 } from '../types';
import { FLAIL_FEEL } from './game-flail';
import { sdBody } from '../validate';

export function createHeadSeams(ctx: GameContext) {
  return {
    head: {
      /** The leaf's debug for actor `id` (null before its first head hit). */
      state: (id: number) => ctx.weapon.headDamage?.debug(id) ?? null,
      /** sdBody of actor `id`'s posed body (head deform included; the GPU wound carves are NOT) at world (x, y, z): the
       *  gate's dent and face-change probes. Null when there is no such actor. */
      surfaceAt: (id: number, x: number, y: number, z: number): number | null => {
        const a = ctx.world.actors.find(q => q.id === id);
        return a ? sdBody([x, y, z], a.posed()) : null;
      },
      /** One head hit at world point (x, y, z), blow direction (dx, dy, dz) (normalised here), with the
       *  R swing's feel. False when there is no such actor or no leaf. */
      hit: (id: number, x: number, y: number, z: number, dx: number, dy: number, dz: number): boolean => {
        const a = ctx.world.actors.find(q => q.id === id);
        const leaf = ctx.weapon.headDamage;
        if (!a || !leaf) return false;
        const l = Math.hypot(dx, dy, dz) || 1;
        const dir: Vec3 = [dx / l, dy / l, dz / l];
        const f = FLAIL_FEEL.swing.R;
        leaf.hit(a, [x, y, z], dir, { meterCredit: f.meterCredit, shove: f.shove });
        return true;
      },
    },
  };
}
