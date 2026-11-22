// src/lab/sdf-zombie/webgpu/game-gore-spread.ts
//
// GORE SPREAD in the game: a gun hit's gore queued to the next tick, and the boot warm that runs the first blood's
// code and draws once behind the loader (gore spread pass, 2026-10-29; `?gorespread=0` restores the old paths).
//
//  1. queueGunGore / drainGunGore: a gun hit's gore (registerBleed's impact gout + bleed emitter + gut-rope verdict,
//     throwGunFlesh's torn meat) leaves the hit frame. The hit frame stamps and flushes the wounds as before (they show
//     that frame); the gore is queued and the NEXT tick spawns it, GORE_SPREAD_BUDGET jobs a tick, before that tick's
//     own hits. The job reads the body as it is then — the per-frame wound emitters do the same — so the gout leaves the
//     wound where it is drawn. World time throughout: it is a tick later, never a dt later.
//  2. warmGore: the FIRST blood of a session paid its cold start in the hit frame — measured 2026-10-29 (telemetry,
//     first volley vs a second one on the same page): the shutter seed raster 2.3 vs 0.4 ms, its stamp planner 0.9-1.1
//     vs 0.1, the goo sync 0.8 vs 0.3, the bleed/gout spawns 0.9-1.4 vs 0.3, the blood step 0.7-1.9 vs 0.2-0.3. That is
//     JS that had never run (lazy compile, no type feedback) and GPU objects first used at that draw. The boot warm's ONE
//     REAL FRAME (game-main warmPipelines, loader up, loop paused) now draws a scratch blood sim: spawned, stepped and
//     synced through the live code, with the live sim swapped out for the frame and every view re-synced from the live
//     sim afterwards. Its own rng (gore-spread.ts warmRng): the shared streams never move.

import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import type { Vec3 } from '../types';
import type { Wound } from '../damage';
import type { GunHitKind } from '../gore-tuning';
import type { ZombieActor } from './game-actor';
import { createBloodSim, spawnImpactGout, spawnWoundDroplets, stepBlood } from '../blood-sim';
import { createGoreQueue, goreSpreadEnabled, warmRng, GORE_SPREAD_BUDGET, type GoreQueue } from '../gore-spread';
import { registerBleed, throwGunFlesh } from './game-bleed';

/** One gun hit's gore, as the hit loop had it. */
export interface GunGoreJob {
  actor: ZombieActor;
  wound: Wound;
  kind: GunHitKind;
  /** The round's contact point and direction at the hit (registerBleed's contact, throwGunFlesh's incoming). */
  point: Vec3;
  dir: Vec3;
}

const queues = new WeakMap<GameContext, GoreQueue<GunGoreJob>>();
function queueOf(ctx: GameContext): GoreQueue<GunGoreJob> {
  let q = queues.get(ctx);
  if (!q) { q = createGoreQueue<GunGoreJob>(); queues.set(ctx, q); }
  return q;
}

/** The hit's gore, now (the old path) or queued for the next tick (`?gorespread` on, the default). */
export function gunGore(ctx: GameContext, job: GunGoreJob): void {
  if (goreSpreadEnabled()) { queueOf(ctx).push(ctx.demo.simFrame, job); return; }
  runGunGore(ctx, job);
}

function runGunGore(ctx: GameContext, job: GunGoreJob): void {
  registerBleed(ctx, job.actor, job.wound, job.kind, { point: job.point, incoming: job.dir });
  throwGunFlesh(ctx, job.actor, job.wound, job.kind, job.dir);
}

/** The earlier ticks' gore, oldest first, GORE_SPREAD_BUDGET of it. A body that left the world since is skipped.
 *  Returns how many jobs ran. */
export function drainGunGore(ctx: GameContext): number {
  const q = queues.get(ctx);
  if (!q || q.size === 0) return 0;
  return q.drain(ctx.demo.simFrame, GORE_SPREAD_BUDGET, (job) => {
    if (!ctx.world.actors.includes(job.actor)) return;
    runGunGore(ctx, job);
  });
}

/** Jobs waiting (a gate's oracle). */
export function pendingGunGore(ctx: GameContext): number {
  return queues.get(ctx)?.size ?? 0;
}

/**
 * The boot warm's scratch blood (see the header), for the ONE REAL FRAME: call before drawOnce, call the returned undo
 * after it. Does nothing (and the undo nothing) with `?gorespread=0`, or before the blood view exists.
 */
export function warmGore(ctx: GameContext, camera: THREE.PerspectiveCamera): () => void {
  if (!goreSpreadEnabled() || !ctx.vfx.bloodSim || !ctx.vfx.bloodView) return () => {};
  const live = ctx.vfx.bloodSim;
  const scratch = createBloodSim();
  const rng = warmRng(0x9e37);
  camera.updateMatrixWorld();
  const eye = camera.getWorldPosition(new THREE.Vector3());
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  // 1.6 m ahead of the eye: in view, close enough that the beads cross the goo threshold and the shutter stamps them.
  const at = (ahead: number, up: number): Vec3 => [eye.x + fwd.x * ahead, eye.y + fwd.y * ahead + up, eye.z + fwd.z * ahead];
  const back: Vec3 = [-fwd.x, -fwd.y, -fwd.z];
  const spawn = (): void => {
    for (let i = 0; i < 4; i++) spawnImpactGout(scratch, 'pellet', at(1.6, -0.1 * i), back, rng, 1 + i);
    spawnImpactGout(scratch, 'slug', at(1.8, 0), back, rng, 9);
    spawnWoundDroplets(scratch, 'pellet', 0.1, at(1.6, 0.1), [0, 1, 0], 1 / 30, 0, rng, 1);
  };
  // A first batch that lands (the splat path), then a fresh one in the air (the airborne goo and the shutter's
  // stamps: a bead needs an age for its sweep).
  spawn();
  for (let i = 0; i < 30; i++) stepBlood(scratch, 1 / 30, rng);
  spawn();
  for (let i = 0; i < 2; i++) stepBlood(scratch, 1 / 60, rng);
  const sync = (sim: typeof live): void => {
    ctx.vfx.bloodView.sync(sim, camera);
    ctx.panels.shutterGame?.poseSharp();
    ctx.goo.layer?.sync(sim, camera);
  };
  // The capture stage reads ctx.vfx.bloodSim at draw time: the scratch sim, for this frame only.
  ctx.vfx.bloodSim = scratch;
  sync(scratch);
  return () => {
    ctx.vfx.bloodSim = live;
    sync(live);
  };
}
