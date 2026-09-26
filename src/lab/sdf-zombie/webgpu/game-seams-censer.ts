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
      /** Live (not dead, not carve) prims on one limb of an actor — a sever readback. -1 = no actor. */
      limbAlive: (id: number, limb: string) => {
        const a = ctx.world.actors.find(q => q.id === id);
        return a ? a.drawnBody().prims.filter(p => p.limb === limb && !p.dead && p.op !== 'sub').length : -1;
      },
    },
  };
}
