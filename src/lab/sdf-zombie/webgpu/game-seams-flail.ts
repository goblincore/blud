// src/lab/sdf-zombie/webgpu/game-seams-flail.ts
//
// Flail automation seams (scripts/flail-gate.mjs): swing without a mouse, read
// the swing and the damage back.
import type { GameContext } from './game-context';

export function createFlailSeams(ctx: GameContext) {
  return {
    flail: {
      /** One click (a mousedown edge; the button is released unless hold(true)). */
      click: () => { ctx.weapon.flail?.click(); },
      hold: (on: boolean) => { ctx.weapon.flail?.hold(on); },
      /** Off for deterministic frame counts in gates. */
      setHitStop: (on: boolean) => { ctx.weapon.flail?.setHitStop(on); },
      state: () => ctx.weapon.flail?.debug() ?? null,
      /** A world point → screen NDC through the fisheye lens (null behind the camera). */
      toScreen: (x: number, y: number, z: number) => ctx.weapon.flail?.toScreen(x, y, z) ?? null,
      /** Live (not dead, not carve) prims on one limb of an actor — a sever readback. -1 = no actor.
       *  Counts only prims of a LIVE cluster: a full-limb sever (sever.ts severLimb) marks the
       *  CLUSTER dead and leaves its prims' own `dead` flags alone. */
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
