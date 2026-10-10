// src/lab/sdf-zombie/webgpu/game-dynamite-step.ts
//
// The dynamite per-tick step: fuse and flight, overcooking in the hand, and detonateAt (blast damage, kick, gibs, light).
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import { blastRefractionBirthRadiusM, blastRefractionStrength } from '../blast-refraction';
import { FLIGHT_TUNING, detonated as flightDetonated, stepFlight } from '../dynamite-flight';
import { EXPLOSION_PROFILE, resolveExplosion, type ExplosionBody } from '../explosion-aoe';
import { chargeFraction, stepCook, type CookSignal } from '../fpv';
import { type Vec3 } from '../types';
import { EXPLOSION_LIGHT, bundleHitsBody, explosionLightEnv, igniteExplosionLight, propWorld, throwBundle } from './game-dynamite-throw';
import { gibActor } from './game-gib-actor';
import { gibAllowance, gibBudget, gibDebit, newBlastProfile, reacquireHeldProp, scheduleGib } from './game-gib-spawn';
import { ceilingAt } from './game-hit-trace';
import { eyeOf } from './game-player';
import { spawnBurstStandIn, stepBursts } from './game-weapon-rig';
import { slotReady } from './game-weapon-slots';
import { scaleBurstVisual, spillVerdict } from './game-wound-vfx';

/** Radians of view pitch per unit of the resolver's cameraKick magnitude. The
 *  magnitude is ~4 at the epicentre, so this is ~3.4° of punch point-blank
 *  and proportionally less with distance. */
export const BLAST_KICK_RAD_PER_UNIT = 0.015;

/** The bundle that never left the hand: an overcook, or a fuse that burned
 *  out while held. Detonates AT the player. */
export function overcookInHand(ctx: GameContext): void {
  const at = propWorld(ctx, ctx.weapon.heldProp);
  ctx.telemetry.telemetry.event('dynamite-overcook', { x: at[0], y: at[1], z: at[2] });
  detonateAt(ctx, at, true);
}

export function detonateAt(ctx: GameContext, at: Vec3, inHand = false): void {
  const t0 = performance.now();
  ctx.dynamite.gibTierLog = [];
  const prof = newBlastProfile(ctx);
  ctx.dynamite.blastProfile = prof;
  EXPLOSION_PROFILE.traceMs = 0; EXPLOSION_PROFILE.woundMs = 0;
  EXPLOSION_PROFILE.cutMs = 0; EXPLOSION_PROFILE.bodiesTraced = 0;
  EXPLOSION_PROFILE.bodiesPruned = 0; EXPLOSION_PROFILE.prunedPrims = 0;
  EXPLOSION_PROFILE.traces = 0;
  ctx.dynamite.detonations++;
  const bodies: ExplosionBody[] = ctx.world.actors.map(a => ({
    id: String(a.id), body: a.posed(), bodyYaw: a.pose().yaw,
  }));
  const tResolve = performance.now();
  const fx = resolveExplosion(at, bodies, {
    eye: eyeOf(ctx.player.player),
    // Floor distance IS the height above y = 0, this level's real floor, so
    // the resolver's air-vs-ground burst choice is exact here without
    // overriding its default.
    floorDistM: Math.max(0, at[1]),
    // A gibbed body's wounds are never read (see `gibWounds` above).
    woundsOnGibbed: ctx.gibs.wounds,
    // THE FOCUS KNOBS, live from the panel. Both are the resolver's own
    // options and both default to the reference (scale 1, floor 0.45), so a
    // page that never touches them resolves exactly as before.
    radiusScale: ctx.vfx.aoeRadiusScale,
    launchFloor: ctx.vfx.aoeLaunchFloor,
    // The hand-splash flourish only makes sense for an in-hand detonation:
    // the resolver measures the FPV hands, and this page's hands are meshes
    // with no prim set to trace, so the band stays empty either way. Left
    // unset rather than passed a fake prim list.
    ...(inHand ? {} : {}),
  });

  prof.resolve = performance.now() - tResolve;
  prof.bodies = fx.perBody.length;
  let gibbed = 0, pieces = 0;
  // THE POOL IS DIVIDED UP FRONT, ACROSS THE BODIES THIS BLAST TAKES. Asking
  // each body in turn for "whatever is left" gives the first one everything
  // and the rest nothing: the arena's 8-body horde ends a 3-body blast with
  // one dramatic corpse and two silent disappearances. Nearest the blast
  // first, so the body the player is looking at is the one that gets the full
  // piece set; the rest degrade by tier inside gibActor.
  const condemned = fx.perBody
    .filter(pb => pb.gibbed && ctx.world.actors.some(q => String(q.id) === pb.bodyId))
    .sort((x, y) => y.falloff - x.falloff);
  // THE BLAST'S WHOLE BUDGET, not just the free slots. A gib may take views
  // that OLDER gore is holding — that is what `spawnChunkPiece`'s
  // oldest-first recycle has always done — so the budget is the pre-existing
  // live pieces PLUS whatever views are still unallocated. Every spawn either
  // recycles a pre-existing chunk or creates a view, so a blast kept inside
  // this number can never recycle a piece it made itself, which is the
  // "pieces jumping into new positions" bug the slice was added for.
  //
  // The budget must NOT be `maxChunks - liveChunks.length` (what it was):
  // in a full pool that is zero, the split gives every body one piece, and a
  // body with one piece is a body that vanished.
  const blastBudget = gibBudget(ctx);
  // GREEDY, NEAREST FIRST, WITH A FLOOR HELD BACK FOR THE REST. An even split
  // spends the pool on equal shares that mostly fall below the cheapest tier,
  // so three bodies in a 24-piece pool all get 8 and all degrade to the same
  // six lumps; letting the nearest body take what it can while reserving one
  // floor's worth per remaining body gives the body the player is looking at
  // the split piece set and the ones behind it the cheap shape. `remaining` is
  // debited by what a body ACTUALLY spawned, not by what it was allowed —
  // tiers are discrete, and an allowance of 13 buys 12.
  let remaining = blastBudget;
  let condemnedLeft = condemned.length;
  for (const pb of fx.perBody) {
    const a = ctx.world.actors.find(q => String(q.id) === pb.bodyId);
    if (!a) continue;
    if (pb.gibbed) {
      const tg = performance.now();
      // SINGLE-HIT RULE: damage ≥ GIB_THRESHOLD skips death entirely. The
      // resolver has already decided, and nothing severs a body that is
      // about to stop existing.
      if (ctx.gibs.tearSec > 0) {
        // The window takes it from here. The TIER IS CHOSEN NOW (task 3) with
        // the same greedy allowance the immediate path uses, and its views
        // are RESERVED out of `gibBudget()` until release, so the preview is
        // the shape that will spawn and a later blast cannot spend its slots.
        const chosen = scheduleGib(ctx, a, at, pb.falloff, gibAllowance(ctx, remaining, condemnedLeft));
        if (chosen) {
          remaining = gibDebit(ctx, remaining, chosen.reserve);
          condemnedLeft = Math.max(0, condemnedLeft - 1);
        }
        prof.gib += performance.now() - tg;
        gibbed++;
        continue;
      }
      const allowance = gibAllowance(ctx, remaining, condemnedLeft);
      const made = gibActor(ctx, a, at, pb.falloff, allowance);
      pieces += made;
      remaining = gibDebit(ctx, remaining, made);
      condemnedLeft = Math.max(0, condemnedLeft - 1);
      prof.gib += performance.now() - tg;
      gibbed++;
      continue;
    }
    // Wounds, meter credit, shove and the sever tail — all owned by the
    // actor's blast() (its doc block carries the meter contract).
    const tw = performance.now();
    a.blast({ wounds: pb.wounds, meterCredit: pb.meterCredit, impulse: pb.rigImpulse });
    // Guts, on the same stamp-time rule the pellet path uses.
    for (const w of pb.wounds) spillVerdict(ctx, a, w);
    prof.wound += performance.now() - tw;
  }
  ctx.dynamite.gibbed += gibbed;
  ctx.dynamite.gibPieces += pieces;

  // Concussion on pieces that already existed (the resolver's list) and on
  // the pieces this blast just made (spawnChunkPiece's ids, patched here).
  for (const ci of fx.chunkImpulses) {
    const c = ctx.bake.liveChunks.find(q => q.id === ci.chunkId);
    if (c) c.state.vel = [ci.vel[0], ci.vel[1], ci.vel[2]];
  }
  // ——— The camera kick. `cameraKick` is the game's quake→magnitude mapping
  //     (quake/40 ≈ 4 at the epicentre, falling off linearly with distance) —
  //     a MAGNITUDE, not radians, so it is scaled into the same `recoilPitch`
  //     channel the gun kick uses and rides that channel's decay. One channel
  //     on purpose: two independent pitch impulses would fight.
  ctx.weapon.recoilPitch += fx.cameraKick * BLAST_KICK_RAD_PER_UNIT;
  // The burst BILLBOARD. Stage 3 replaces this stand-in with the procedural
  // fireball (webgpu/explosion-vfx.ts); until that lands the detonation still
  // has to be VISIBLE, so the tuning pass is not blocked on the art.
  // THE LIGHT, ignited here rather than in the VFX module: the module owns the
  // particles, the wiring owns what the room sees. A blast at the far end of a
  // corridor still gets a light (it does nothing useful, but consistency beats
  // a distance gate nobody can see).
  igniteExplosionLight(ctx, at);
  const burst = scaleBurstVisual(ctx, fx.burst);
  // BLAST REFRACTION (experiment, default OFF): feed the bounded post-aa ring
  // the blast's WORLD position, the shell's birth radius and its peak screen
  // offset. The ring reprojects every frame from its world position and a
  // growing world radius (see blast-refraction.ts and post-aa's render), so a
  // camera that moves during the ~0.55 s life keeps the band on the blast.
  //
  // THE DEFECT THIS FIXES (owner, 2026-09-16: "blastdistort=1 is
  // indistinguishable from off"): the old feed used 0.3 x burst.heightM =
  // 0.25 m, which is INSIDE the ~0.83 m opaque fireball, so the band warped
  // only pixels the fireball covered; and its life was 0.3 s with a squared
  // decay, so it was gone before the fireball cleared. The birth radius is now
  // the fireball's own rendered radius and the band expands past it.
  if (ctx.render.postAa.blastDistort) {
    ctx.render.postAa.pushBlastDistort(
      [at[0], at[1], at[2]],
      blastRefractionBirthRadiusM(burst.heightM),
      // Strength is applied by the post pass, once, including live changes.
      blastRefractionStrength(burst.heightM),
    );
  }
  if (ctx.vfx.explosionVfx) ctx.vfx.explosionVfx.spawn(burst);
  else if (ctx.vfx.burstLayer) ctx.vfx.burstLayer.spawn(burst);
  // ...including the stand-in, which used to get the UNSCALED height and was
  // therefore a third size convention in a three-way branch. It is the
  // control arm of the A/B; a control at a different size compares nothing.
  else spawnBurstStandIn(ctx, burst.at, burst.heightM, burst.kind);
  prof.chunksSpawned = pieces;
  ctx.dynamite.lastRadiusM = fx.radiusM;
  ctx.dynamite.lastBlastMs = performance.now() - t0;
  prof.total = ctx.dynamite.lastBlastMs;
  ctx.dynamite.bloodOrphans += 0;
  ctx.telemetry.telemetry.event('dynamite-detonate', {
    x: at[0], y: at[1], z: at[2], radiusM: fx.radiusM,
    bodies: fx.perBody.length, gibbed, pieces, ms: ctx.dynamite.lastBlastMs,
  });
}

/**
 * One frame of dynamite: the cook machine, the flights, and the hand state.
 *
 * `stepCook` (fpv.ts) is the authority on WHEN a bundle leaves the hand and
 * on the overcook — this only routes its one-shot signal to the throw or to
 * the in-hand detonation, so the timing rules have exactly one home.
 */
export function stepDynamite(ctx: GameContext, dt: number): void {
  ctx.dynamite.now += dt;
  const liveDyn = ctx.weapon.slotState.live === 'dynamite' && slotReady(ctx.weapon.slotState);
  const { state: nextCook, signal } = stepCook(
    ctx.vfx.cook, { press: ctx.dynamite.press && liveDyn, release: ctx.dynamite.release && liveDyn }, ctx.dynamite.now,
  );
  ctx.vfx.cook = nextCook;
  ctx.dynamite.press = false;
  ctx.dynamite.release = false;
  const sig: CookSignal | null = signal;
  if (sig?.kind === 'throw') throwBundle(ctx, sig.speedMps);
  else if (sig?.kind === 'overcook') overcookInHand(ctx);
  ctx.dynamite.charge = chargeFraction(ctx.dynamite.now - ctx.vfx.cook.cookStart) * (ctx.vfx.cook.phase === 'cooking' ? 1 : 0);
  reacquireHeldProp(ctx);

  // ——— The flights. Stepped at the flight module's own 120 Hz so the body
  //     contact test is as fine as the bounces are; a bundle that hits a body
  //     detonates there, which is what makes the thing aimable at all.
  for (let i = ctx.bake.liveBundles.length - 1; i >= 0; i--) {
    const b = ctx.bake.liveBundles[i]!;
    // The ceiling is resolved per bundle PER FRAME, from where the bundle is:
    // see ceilingAt. One frame of lag across a doorway is invisible (the wall
    // boxes catch that frame), and a 5-entry lookup per bundle per frame is
    // nothing next to getting the roof wrong.
    const world = { colliders: ctx.world.colliders, ceilM: ceilingAt(ctx, b.state.pos[0], b.state.pos[2]) };
    let remaining = Math.min(dt, 0.25);
    let boom: Vec3 | null = null;
    while (remaining > 1e-9 && !flightDetonated(b.state)) {
      const sub = Math.min(remaining, FLIGHT_TUNING.subStepSec);
      remaining -= sub;
      const from = b.state.pos;
      // bounds: null — the dungeon has no arena rect; `colliders` is its
      // real solid geometry and `ceilM` its ceiling.
      b.state = stepFlight(b.state, sub, null, world);
      if (bundleHitsBody(ctx, from, b.state.pos)) { boom = b.state.pos; break; }
    }
    if (!boom && flightDetonated(b.state)) boom = b.state.pos;
    if (boom) {
      // Hand the prop back BEFORE the blast so the very next cook has one.
      if (b.prop) { b.prop.object.visible = false; ctx.bake.spareBundles.push(b.prop); }
      ctx.bake.liveBundles.splice(i, 1);
      detonateAt(ctx, boom);
      continue;
    }
    b.prop?.pose({ mode: 'flight', pos: b.state.pos, spin: b.state.spin, fuseBurning: true });
  }
  stepBursts(ctx, dt);
  ctx.vfx.explosionVfx?.update(dt, ctx.boot.handle.camera);
  ctx.vfx.burstLayer?.update(dt, ctx.boot.handle.camera);

  // THE MESH-SIDE LIGHT. Aged and written every frame. The pool is
  // PERMANENTLY VISIBLE (see its construction comment): `visible` is never
  // toggled, because that re-keys the scene's LightsNode and recompiles the
  // light variant of every lit material mid-frame. An idle slot is left at
  // intensity 0, which contributes no light.
  for (let i = ctx.vfx.explosionLights.length - 1; i >= 0; i--) {
    const e = ctx.vfx.explosionLights[i]!;
    e.age += dt;
    if (e.age >= EXPLOSION_LIGHT.lifeSec) ctx.vfx.explosionLights.splice(i, 1);
  }
  for (let i = 0; i < ctx.vfx.explosionLightPool.length; i++) {
    const pl = ctx.vfx.explosionLightPool[i]!;
    const e = ctx.vfx.explosionLights[i];
    if (!e) { pl.intensity = 0; continue; }
    const k = explosionLightEnv(ctx, e.age);
    pl.position.set(e.pos[0], e.pos[1], e.pos[2]);
    pl.intensity = EXPLOSION_LIGHT.meshPeak * k * ctx.lighting.fxLightScale;
  }
  // THE FIRE-SIDE MESH LIGHTS, beside the explosion pool writer for the same
  // reason. These four permanent PointLights are the SHIPPED room light for
  // fire: they have no shadow test, while the gather path self-shadows on the
  // burner's own capsules (see pushGatherLights). Zeroes only on the no-fire
  // transition.
  ctx.vfx.burning.updateFireLightPool(ctx.player.player.pos);
}
