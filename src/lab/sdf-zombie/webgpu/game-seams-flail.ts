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
      /** Off for deterministic frame counts in gates: no hit-stop AND no slow tail. */
      setHitStop: (on: boolean) => { ctx.weapon.flail?.setHitStop(on); },
      /** Off for gates that measure pixels: no camera kick, judder, roll, FOV punch, rig kick, chain relax
       *  or head snap (flail-impact.ts). On by default. */
      setImpactFx: (on: boolean) => { ctx.weapon.flail?.setImpactFx(on); },
      /** Torn lips (v1.5b) on the flail's craters: off = stock craters, for A/B. Returns the state. */
      setTear: (on: boolean) => ctx.weapon.flail?.setTear(on) ?? null,
      /** Flying flesh bits (v1.5b, flesh-bits.ts) on body and head hits: off keeps a gate's chunk counts the
       *  pre-flesh ones. On by default. Returns the state. */
      setFleshBits: (on: boolean) => ctx.weapon.flail?.setFleshBits(on) ?? null,
      /** Live chunk census by tag (flesh bits, eyes, the rest) and the view pool. */
      chunkTags: () => {
        const live = ctx.bake.liveChunks;
        return {
          flesh: live.filter(c => c.tag === 'flesh').length, eye: live.filter(c => c.tag === 'eye').length,
          other: live.filter(c => !c.tag).length, baked: ctx.bake.chunks.length,
          views: ctx.bake.views.length, spare: ctx.bake.spareViews.length, max: ctx.bake.maxChunks,
          /** The live flesh bits' positions and whether their views draw. */
          fleshAt: live.filter(c => c.tag === 'flesh').map(c => ({ pos: [...c.state.pos], visible: c.view.object.visible })),
        };
      },
      /** The swing's shutter blur on the ball and chain (flail-blur.ts, spec §14.1 item 6). On by default;
       *  state().blur reads it back. */
      setBlur: (on: boolean, look?: { ball?: number; chain?: number; spin?: boolean }) => { ctx.weapon.flail?.setBlur(on, look); },
      /** Blood on the flail (flail-blood.ts, spec §14.1 item 7): set the level 0..1 (clamped); it keeps drying
       *  from there. A fresh flail is at 0; state().blood reads it back. Pixel gates can set 0. */
      setBlood: (level: number) => { ctx.weapon.flail?.setBlood(level); },
      /** The impact feel's live channels (flail-impact.ts; the gate's "impact" section). */
      impactDebug: () => ctx.weapon.flail?.impactDebug() ?? null,
      state: () => ctx.weapon.flail?.debug() ?? null,
      /** A world point → screen NDC through the fisheye lens (null behind the camera). */
      toScreen: (x: number, y: number, z: number) => ctx.weapon.flail?.toScreen(x, y, z) ?? null,
      /** Live (not dead, not carve) prims on one limb of an actor — a sever readback. -1 = no actor.
       *  Counts only prims of a LIVE cluster: a full-limb sever (sever.ts severLimb) marks the
       *  CLUSTER dead and leaves its prims' own `dead` flags alone. */
      limbAlive: (id: number, limb: string) => {
        const a = ctx.world.actors.find(q => q.id === id);
        if (!a) return -1;
        // The CURRENT body, not drawnBody(): a sever's detach() swaps `current`
        // without re-posing, and a frozen actor does not step, so the posed
        // (drawn) body still shows the limb until the next blast re-poses it.
        const b = a.body;
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
