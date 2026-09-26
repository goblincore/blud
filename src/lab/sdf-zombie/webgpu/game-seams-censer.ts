// src/lab/sdf-zombie/webgpu/game-seams-censer.ts
//
// Censer automation seams (scripts/censer-gate.mjs): drive the swing without a
// mouse, park the weapon in the dead zone, read the swing and the damage back.
import type { GameContext } from './game-context';
import { FREE_AIM } from './free-aim';

export function createCenserSeams(ctx: GameContext) {
  return {
    censer: {
      /** Hold / let go of the attack button. */
      press: () => { ctx.weapon.censer?.press(); },
      release: () => { ctx.weapon.censer?.release(); },
      /** Park the weapon in the dead zone: x, y in dead-zone units (±1 = its edge). */
      setAim: (x: number, y: number) => {
        ctx.weapon.aim = { x: x * FREE_AIM.deadzoneX, y: y * FREE_AIM.deadzoneY };
      },
      /** Off for deterministic frame counts in gates. */
      setHitStop: (on: boolean) => { ctx.weapon.censer?.setHitStop(on); },
      state: () => ctx.weapon.censer?.debug() ?? null,
      /** Capture A/B: hide 'all' (the whole censer), 'hand', 'smoke', or null. */
      hide: (part: 'all' | 'hand' | 'smoke' | null) => { ctx.weapon.censer?.debugHide(part); },
      /** A world point as the player sees it: screen NDC through the fisheye (y up). */
      toScreen: (x: number, y: number, z: number) => ctx.weapon.censer?.screenNdc([x, y, z]) ?? null,
      /** Live (not dead, not carve) prims on one limb of an actor — a sever readback. -1 = no actor.
       *  Counts only prims of a LIVE cluster: a full-limb sever (sever.ts severLimb — a
       *  decapitation, an arm off at the shoulder) marks the CLUSTER dead and leaves its
       *  prims' own `dead` flags alone (only a distal cut marks prims), so counting prims
       *  alone read a severed head as 5 of 5 alive. */
      limbAlive: (id: number, limb: string) => {
        const a = ctx.world.actors.find(q => q.id === id);
        if (!a) return -1;
        const b = a.drawnBody();
        let n = 0;
        for (const c of b.clusters) {
          if (c.limb !== limb || !c.alive) continue;
          for (let i = c.start; i < c.start + c.count; i++) {
            const p = b.prims[i]!;
            if (!p.dead && p.op !== 'sub') n++;
          }
        }
        return n;
      },
    },
  };
}
