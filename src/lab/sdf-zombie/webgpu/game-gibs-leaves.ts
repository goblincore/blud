// src/lab/sdf-zombie/webgpu/game-gibs-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { gibTierPlan } from '../gib-parts'
import { type Primitive, type Vec3 } from '../types'
import { type ZombieActor } from './game-actor'
import { type ChunkGpuView } from './zombie-gpu'


/** The archetype whose committed set an actor uses. */
export function gibAssetArchetypeOf(ctx: GameContext, a: ZombieActor): string {
  return a.kind === 'soldier' ? 'soldier' : 'zombie';
}

/** Kick off (or join) the load for the archetypes the assets path can use. */
export function ensureGibAssets(ctx: GameContext): Promise<unknown> {
  return Promise.all([
    ctx.gibs.assetRuntime.ensure('zombie'),
    ctx.gibs.assetRuntime.ensure('soldier'),
  ]);
}

/** True once at least one archetype's committed set is loaded and usable. */
export function gibAssetArmed(ctx: GameContext): boolean {
  return ctx.gibs.assetRuntime.archetypeState('zombie') === 'ready'
    || ctx.gibs.assetRuntime.archetypeState('soldier') === 'ready';
}

/**
 * The two per-view uniforms a chunk's KIND decides, written on EVERY spawn.
 *
 * MEAT AND BONE DO NOT SHADE ALIKE. march.wgsl.ts's pale-bone branch only
 * runs while `meltCfg.x > 0` (it was written for the melt, where the skeleton
 * emerges from thinning flesh), and the chunk view's own torn-meat gore mask
 * and face projection are decided in `reset` from whether the FLESH list is
 * empty. A released ribcage left at meltCfg.x = 0 marches, folds and shades
 * as a meat-coloured cage — the shape would finally be there and still not
 * read as bone, which is half of what the owner asked for.
 *
 * BOTH ARE WRITTEN FOR EVERY KIND, not just for bone. Chunk views are
 * RECYCLED at the maxChunks cap, so a view that was a ribcage last blast
 * keeps meltCfg.x = 1 into its next life as an arm — and a flesh piece
 * rendered through the melt ramp is a pale, matte, wrong-coloured limb. The
 * lab's spawnChunk has carried the same "every spawn, not just bone ones"
 * comment since the melt shipped; this is that rule, not a new one.
 */
export function applyChunkKindLook(ctx: GameContext, view: ChunkGpuView, kind: 'limb' | 'gob' | 'bone'): void {
  view.uniforms.meltCfg.value.x = kind === 'bone' ? 1 : 0;
}

export function primsLongAxis(ctx: GameContext, prims: Primitive[], origin: Vec3): Vec3 {
  let best: Vec3 = [0, 1, 0];
  let bestLen = 0;
  for (const p of prims) {
    if (p.op === 'sub') continue;
    const d: Vec3 = [p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    if (l > bestLen) { bestLen = l; best = d; }
  }
  return bestLen < 1e-6 ? [0, 1, 0] : [best[0] / bestLen, best[1] / bestLen, best[2] / bestLen];
}

/**
 * Apply every impulse whose delay has run out. A piece whose chunk was
 * recycled out of the pool in the meantime is simply gone — the queue is
 * keyed by chunk id, and ids are never reused.
 *
 * THE DELAY COUNTS DRAINS, NOT FRAMES, and that is deliberate. This drain
 * runs LATER IN THE SAME TICK as the detonation that spawned the pieces
 * (stepDynamite is before the chunk step in `tick`), so a frame-indexed
 * queue either releases the first wave before the first frame is drawn — the
 * explosion's opening frame shows pieces already moving, which is the
 * substitution the staging exists to prevent — or needs an off-by-one
 * "+2" that silently breaks the day someone reorders the tick. Counting
 * drains, a delay of 0 still means "not in the tick the blast happened in",
 * because the drain that could have fired it has already run and decremented.
 */
export function stepPendingGibImpulses(ctx: GameContext): void {
  for (let i = ctx.gibs.pendingGibImpulses.length - 1; i >= 0; i--) {
    const p = ctx.gibs.pendingGibImpulses[i]!;
    if (p.delay > 0) { p.delay--; continue; }
    const c = ctx.bake.liveChunks.find(q => q.id === p.id);
    if (c) c.state.vel = [p.vel[0], p.vel[1], p.vel[2]];
    ctx.gibs.pendingGibImpulses.splice(i, 1);
  }
}

/** Give the hand a bundle again once the throw has RECOVERED.
 *
 *  `cook.phase` must be 'idle', not merely "not cooking": fpv.ts spends
 *  throwRecoverSec (0.4 s) in 'cooldown' after every release, and that beat is
 *  the throw animation — handing the player the next bundle the instant the
 *  last one leaves would put a bundle back in a hand that is still visibly
 *  mid-throw. An overcook returns straight to 'idle', so the replacement is
 *  immediate there, which is right: nothing was thrown. */
export function reacquireHeldProp(ctx: GameContext): void {
  if (ctx.weapon.heldProp || !ctx.bake.bundleReady) return;
  if (ctx.vfx.cook.phase !== 'idle') return;
  const p = ctx.bake.spareBundles.pop() ?? (() => {
    const oldest = ctx.bake.liveBundles.find(b => b.prop);
    if (!oldest || !oldest.prop) return null;
    const q = oldest.prop;
    oldest.prop = null;
    return q;
  })();
  if (!p) return;
  p.object.removeFromParent();
  ctx.bake.bundleRig.add(p.object);
  // RESET THE LOCAL TRANSFORM, and this is the whole bug (owner report
  // 2026-09-10: "after like the first 2 throws i dont see the dynamite").
  //
  // `pose({ mode: 'flight' })` writes the bundle's WORLD position and its
  // tumble quaternion onto the object. Reparenting that object into the rig
  // does not undo any of it, so a re-acquired bundle stayed exactly where it
  // detonated — measured, `local [28.235, 0.097, -12.354]` in a rig that sits
  // 0.42 m in front of the eye. Drawn metres off-screen: the player was
  // holding a bundle they could not see, and the first two throws looked fine
  // only because the first re-acquire happened to draw a prop that had never
  // flown.
  //
  // The rig carries the hold pose (BUNDLE_HOLD), so the prop's own local
  // transform must be the identity. One owner for the hold transform.
  p.object.position.set(0, 0, 0);
  p.object.quaternion.identity();
  p.object.scale.setScalar(1);
  p.object.visible = true;
  ctx.weapon.heldProp = p;
}

// THE DETONATION — one blast, everything it does.
// -----------------------------------------------------------------------
/** Per-phase timings of the LAST detonation, ms. The blast is one frame of
 *  work with four very different costs in it, and "the explosion pauses the
 *  game" is not actionable until the split is known. */
export function newBlastProfile(ctx: GameContext) {
  return { resolve: 0, gib: 0, wound: 0, blood: 0, chunksSpawned: 0, bodies: 0, total: 0 };
}

/**
 * SCHEDULE A GIB — the pre-tear window's entry point (dev-note §3c).
 *
 * With `?gibtear=0` this IS the old path: the body becomes pieces in the frame
 * the bundle goes off. With a window, the body is BENT by the shockwave for
 * `gibTearSec` first and the pieces are spawned when the window closes, which
 * is the owner's own description of what the transition should do — "the SDF
 * flesh ... distort the flesh from the shockwave and jiggle and then rip
 * away".
 *
 * A body already in the window is NOT scheduled twice: a second bundle landing
 * on a doomed body inside 0.1 s finds it mid-tear and leaves it alone, which
 * is also what keeps the piece census honest (one body, one gib).
 */
export function scheduleGib(ctx: GameContext, 
  a: ZombieActor, at: Vec3, falloff: number, allowance: number,
): ReturnType<typeof gibTierPlan> | null {
  if (ctx.gibs.tearSec <= 0) return null; // caller gibs immediately
  if (a.tearing() || ctx.gibs.pendingGibs.some(q => q.actor === a)) return null;
  a.setTearTuning({ sec: ctx.gibs.tearSec, ...ctx.vfx.tearShape });
  // THE PLAN IS PREPARED ONCE, from the clean posed body, and reused for the
  // whole visualization AND the release. `gibParts` would re-derive it at
  // release from a body the rupture has already moved; the plan's own region
  // offsets are what the chunks are spawned with instead (spawnScheduledGibs).
  //
  // THE TIER IS CHOSEN HERE, not at release (task 3). `gibTierPlan` runs the
  // same ladder `gibActor` would, against the allowance this body is handed,
  // and the wiring locks `gibActor` to the result — so a tight pool previews
  // the cheap shape it will actually spawn instead of the full partition.
  // `?gib=pieces` is the one shape with no source indices yet; it keeps the
  // old preview-then-spawn route (see RESULTS.md Task 3 limits).
  const mode = ctx.gibs.mode === 'clusters' ? 'clusters' : 'parts';
  const planned = gibTierPlan(a.posed(), allowance, { bones: ctx.gibs.bones, mode, at });
  a.beginTear(at, falloff, planned.plan);
  ctx.gibs.pendingGibs.push({
    actor: a, at: [at[0], at[1], at[2]], falloff, plan: planned.plan,
    tier: planned.tier, reserve: planned.reserve,
  });
  return planned;
}

/** Take a gibbed actor out of the world: hidden from every pass, out of the
 *  router, out of the roster. The view is retained — see gibActor. */
export function retireActor(ctx: GameContext, a: ZombieActor): void {
  // A burning body leaving the world: burn-down mark + card release.
  ctx.vfx.burning.retire(a);
  // Equipment is a scene sibling of the flesh proxies, not their child.
  // This actor stops ticking here, so its attachments must retire too.
  a.character?.retireEquipment();
  const pi = ctx.gibs.pendingGibs.findIndex(q => q.actor === a);
  if (pi >= 0) ctx.gibs.pendingGibs.splice(pi, 1);
  a.view.object.visible = false;
  a.view.coneObject.visible = false;
  ctx.boot.deferredApi?.router.unregister(a.view.object);
  ctx.boot.deferredApi?.router.unregister(a.view.coneObject);
  a.view.object.removeFromParent();
  a.view.coneObject.removeFromParent();
  const i = ctx.world.actors.indexOf(a);
  if (i >= 0) ctx.world.actors.splice(i, 1);
}
