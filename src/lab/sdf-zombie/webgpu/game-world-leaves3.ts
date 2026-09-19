// src/lab/sdf-zombie/webgpu/game-world-leaves3.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { woundEmitAnchorAndNormal } from '../bleed-registry'
import { spawnImpactGout, type Droplet } from '../blood-sim'
import { type Wound } from '../damage'
import { detachGutChain, pinGutChain, stepGutChain } from '../entrails'
import { type Vec3 } from '../types'
import { type ZombieActor } from './game-actor'
import { spillVerdict } from './game-vfx-leaves'
import { woundStreamId } from './game-world-leaves2'
import { impactSplashProfiles } from './impact-splash-profiles'
import { rngStreams } from './rng'


/** Per-frame rope sim, BEFORE the bleed block (so stepBlood sees the same
 *  frame it does): pin to the wound's current emit point — the anchor is
 *  recomputed from the CURRENT posed prims, which is what makes the rope
 *  ride the gait — step the chain, then copy node positions into the
 *  rope's persistent 'gut' droplets. Uses only the actor's already-posed
 *  prims; never re-poses. Runs regardless of bleedEnabled: a hanging gut
 *  is body state, not spray, and stepping spends no RNG. */
export function stepGutRopes(ctx: GameContext, dt: number): void {
  for (const a of ctx.world.actors) {
    let entry = ctx.vfx.gutRopes.get(a.id);
    if (!entry) continue;
    // Body down (falling or settled) → the rope tears free. It keeps its
    // verlet momentum, falls, settles, freezes (entrails.ts).
    if (entry.chain.attached && a.debug().phase !== 'standing') {
      entry = { ...entry, chain: detachGutChain(entry.chain) };
      ctx.vfx.gutRopes.set(a.id, entry);
    }
    if (entry.chain.attached) {
      const { anchor } = woundEmitAnchorAndNormal(a.posed().prims, entry.wound, a.pose().yaw);
      entry = { ...entry, chain: pinGutChain(entry.chain, anchor) };
      ctx.vfx.gutRopes.set(a.id, entry);
    }
    entry = { ...entry, chain: stepGutChain(entry.chain, dt) };
    ctx.vfx.gutRopes.set(a.id, entry);

    // Keep the rope's droplets in the sim. They are created once and then
    // MOVED (Droplet.pos is mutable by contract; stepBlood skips 'gut'),
    // unless particle pressure evicted them (MAX_DROPLETS shift) — then
    // rebuild at the nodes' current positions.
    const nodes = entry.chain.nodes;
    const live = entry.droplets.length === nodes.length
      && entry.droplets[0] !== undefined
      && ctx.vfx.bloodSim.droplets.includes(entry.droplets[0]);
    if (!live) {
      const fresh: Droplet[] = nodes.map(n => ({
        pos: [...n.pos] as [number, number, number],
        vel: [0, 0, 0] as [number, number, number],
        age: 0, life: Infinity,
        size: ctx.vfx.woundTuning.gutSize,
        kind: 'gut',
        // The rope belongs to the wound that spilled it: reuse that wound's
        // stable stream id so the gut nodes are attributed like every other
        // emitter rather than falling through as untagged.
        stream: woundStreamId(ctx, entry!.wound),
      }));
      for (const d of fresh) ctx.vfx.bloodSim.droplets.push(d);
      entry = { ...entry, droplets: fresh };
      ctx.vfx.gutRopes.set(a.id, entry);
    } else {
      const invDt = dt > 1e-6 ? 1 / dt : 0;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        const d = entry.droplets[i]!;
        // Honest velocity — the goo stretch follows node motion, so a
        // swinging rope smears, a settled one doesn't.
        d.vel[0] = (n.pos[0] - n.prev[0]) * invDt;
        d.vel[1] = (n.pos[1] - n.prev[1]) * invDt;
        d.vel[2] = (n.pos[2] - n.prev[2]) * invDt;
        d.pos[0] = n.pos[0];
        d.pos[1] = n.pos[1];
        d.pos[2] = n.pos[2];
      }
    }
  }
}

export function registerBleed(ctx: GameContext, 
  a: ZombieActor, wound: Wound, kind: 'pellet' | 'slug' | 'stump',
  contact?: { point: Vec3; incoming: Vec3 },
): void {
  if (!ctx.vfx.bleedEnabled) return;
  ctx.vfx.bleed.register(a.id, wound, kind, ctx.vfx.bleedClock);
  // IMPACT GOUT (blood-viscosity spec §a) — the dense one-tick pulse, at
  // the wound's own anchor so it leaves the body where the hole is. Fired
  // here rather than at each call site because both the impact path and
  // the sever path already funnel through this function, and two copies
  // would drift. Uses the SAME bleedRng, so setBleed(false) freezes gouts
  // and the trickle together and captures stay deterministic.
  const { anchor, normal } = woundEmitAnchorAndNormal(a.posed().prims, wound, a.pose().yaw);
  // The gout sprays back along the incoming shot; spawnImpactGout negates
  // what it is handed, and the wound normal already points OUT of the
  // body, so pass the inward direction. The wound's stable stream id tags
  // the gout so it fuses with this wound's per-frame droplets and no
  // other emitter's.
  const streamId = woundStreamId(ctx, wound);
  spawnImpactGout(ctx.vfx.bloodSim, kind, anchor, [-normal[0], -normal[1], -normal[2]], rngStreams.bleed, streamId);
  // SUPPLEMENTARY entry splash (opt-in, ?impactsplash=1). Projectile hits
  // use the contact and incoming shot below; stumps use their outward
  // wound normal. The seed is
  // derived from the wound's stable stream id, NOT from bleedRng, so it
  // draws no random numbers and leaves the shipped gout/bleed stream
  // bit-identical.
  const shotgunShot = wound.shot?.weapon === 'shotgun' ? wound.shot.shotId : undefined;
  const repeatedPellet = shotgunShot !== undefined && ctx.vfx.lastSplashShot.get(a) === shotgunShot;
  if (ctx.panels.impactSplashEnabled && ctx.panels.impactSplashLayer && !repeatedPellet) {
    if (shotgunShot !== undefined) ctx.vfx.lastSplashShot.set(a, shotgunShot);
    // An immediate entry splash belongs to the projectile's actual surface
    // contact, not the wound's reconstructed/carved anchor. Send it back
    // toward the incoming shot and start just outside the contacted skin.
    // Stumps have no projectile contact and retain their wound-normal path.
    const splashDirection: Vec3 = contact
      ? [-contact.incoming[0], -contact.incoming[1], -contact.incoming[2]]
      : normal;
    const splashOrigin: Vec3 = contact
      ? [contact.point[0] + splashDirection[0] * 0.035,
         contact.point[1] + splashDirection[1] * 0.035,
         contact.point[2] + splashDirection[2] * 0.035]
      : anchor;
    ctx.panels.impactSplashLayer.emit(splashOrigin, splashDirection, (streamId * 2654435761) >>> 0, { profile: impactSplashProfiles[kind] });
  }
  // Gut-rope decision for this stamped wound — placed BELOW the
  // !bleedEnabled guard on purpose: the roll spends bleedRng, and the
  // invariant above (OFF mid-stream = ON-stream-paused) only holds if
  // nothing advances the stream while bleed is frozen. The capture twins
  // (stampWoundAt/explode) call spillVerdict directly instead.
  spillVerdict(ctx, a, wound);
}
