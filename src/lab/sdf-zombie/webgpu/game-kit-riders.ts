// src/lab/sdf-zombie/webgpu/game-kit-riders.ts
//
// The game side of kit-sever.ts: a severed piece takes the actor's kit on the bones it took flesh off (the zombie's
// hand and wrist shackle go with its forearm), and a round through a polygon HAND takes the hand off at the wrist
// (CharacterEntry.kitHands; owner, 2026-10-26: "you should be able to shoot the hand off, no individual fingers,
// just the whole hand").
//
// And a round that meets a BREAKABLE kit piece (CharacterEntry.kitBreakables: the belt, an iron shackle) before any
// flesh knocks it off whole: cut out of the actor's kit as for a sever, thrown as a mesh gib (game-mesh-gibs.ts) along
// the shot.
//
// Riders live on ctx.gibs.kitRiders, each naming the chunk it rides. Rather than thread them through every way a
// chunk ends (a bake, an eviction, a flesh bit's expiry, a piece shot apart, a reset), stepKitRiders looks the chunk
// up each frame, live or baked, poses the rider from it, and drops the rider once the chunk is gone.
import type { DetachedPiece, ZombieActor } from './game-actor';
import type { GameContext } from './game-context';
import type { Projectile } from './game-weapon';
import type { Vec3 } from '../types';
import { cutKitBone, disposeKitRider, kitPieceHit, kitTakenBy, poseKitRider, type KitRider } from './kit-sever';

/** Cut what `piece` takes of `a`'s kit out of it and set it riding chunk `chunkId`. */
export function spawnKitRiders(ctx: GameContext, a: ZombieActor, piece: Pick<DetachedPiece, 'origin' | 'prims'>, chunkId: number | undefined): void {
  const kit = a.character?.kit;
  if (!kit || chunkId === undefined || a.character?.entry?.armoured) return;   // an armoured kit sheds by itself (kit-damage.ts)
  const hands = a.character?.entry?.kitHands;
  for (const take of kitTakenBy(piece.prims, hands ? new Set(hands.materials) : null)) {
    const object = cutKitBone(kit.object, take.bone, piece.origin, take.materials);
    if (!object) continue;
    const rider: KitRider = { object, chunkId };
    ctx.boot.handle.scene.add(object);
    ctx.boot.deferredApi?.router.register(object, 'mesh', 'level-only');
    ctx.gibs.kitRiders.push(rider);
  }
  stepKitRiders(ctx);
}

/** Pose every rider from its chunk; drop the riders whose chunk is gone. */
export function stepKitRiders(ctx: GameContext): void {
  const riders = ctx.gibs.kitRiders;
  for (let i = riders.length - 1; i >= 0; i--) {
    const r = riders[i]!;
    const c = ctx.bake.liveChunks.find(q => q.id === r.chunkId) ?? ctx.bake.chunks.find(q => q.id === r.chunkId);
    if (!c) { removeRider(ctx, r); riders.splice(i, 1); continue; }
    poseKitRider(r, c.state);
  }
}

/** Take every rider out of the scene (a cast rebuild / level reset). */
export function clearKitRiders(ctx: GameContext): void {
  for (const r of ctx.gibs.kitRiders) removeRider(ctx, r);
  ctx.gibs.kitRiders.length = 0;
}

function removeRider(ctx: GameContext, r: KitRider): void {
  ctx.boot.deferredApi?.router.unregister(r.object);
  disposeKitRider(r);
}

/**
 * A round's step `from`..p.pos through a polygon hand (ZombieActor.handSpheres) that meets the palm before any flesh
 * (`fleshDist`, the nearest flesh hit on the step, Infinity for none) takes that hand off. True when it did (the
 * round is spent there).
 */
export function handShot(ctx: GameContext, p: Projectile, from: Vec3, fleshDist: number): boolean {
  const d: Vec3 = [p.pos[0] - from[0], p.pos[1] - from[1], p.pos[2] - from[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return false;
  const u: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
  let best: { a: ZombieActor; bone: string; t: number } | null = null;
  for (const a of ctx.world.actors) {
    if (!a.character?.entry?.kitHands) continue;
    for (const h of a.handSpheres()) {
      // ray-sphere: the nearer root along the step
      const oc: Vec3 = [from[0] - h.centre[0], from[1] - h.centre[1], from[2] - h.centre[2]];
      const b = oc[0] * u[0] + oc[1] * u[1] + oc[2] * u[2];
      const c = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - h.radius * h.radius;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > len || t >= fleshDist) continue;
      if (!best || t < best.t) best = { a, bone: h.bone, t };
    }
  }
  if (!best) return false;
  ctx.telemetry.telemetry.event('hand-shot', { actor: best.a.id, bone: best.bone, kind: p.kind });
  return best.a.severHand(best.bone);
}

/**
 * A round's step `from`..p.pos that meets a breakable kit piece (CharacterEntry.kitBreakables) before any flesh
 * (`fleshDist`, as handShot) knocks the piece off: the nearest one goes, as a mesh gib thrown along the shot. True when
 * it did (the round is spent on it).
 */
export function kitPieceShot(ctx: GameContext, p: Projectile, from: Vec3, fleshDist: number): boolean {
  const len = Math.hypot(p.pos[0] - from[0], p.pos[1] - from[1], p.pos[2] - from[2]);
  if (len < 1e-6) return false;
  let best: { a: ZombieActor; bone: string; materials: ReadonlySet<string>; d: number } | null = null;
  for (const a of ctx.world.actors) {
    const pieces = a.character?.entry?.kitBreakables, kit = a.character?.kit;
    if (!pieces || !kit) continue;
    for (const piece of pieces) {
      const materials = new Set(piece.materials);
      const s = kitPieceHit(kit.object, piece.bone, materials, from, p.pos);
      if (s === null) continue;
      const d = s * len;
      if (d < fleshDist && (!best || d < best.d)) best = { a, bone: piece.bone, materials, d };
    }
  }
  if (!best) return false;
  const u: Vec3 = [(p.pos[0] - from[0]) / len, (p.pos[1] - from[1]) / len, (p.pos[2] - from[2]) / len];
  const at: Vec3 = [from[0] + u[0] * best.d, from[1] + u[1] * best.d, from[2] + u[2] * best.d];
  const object = cutKitBone(best.a.character!.kit!.object, best.bone, at, best.materials);
  if (!object) return false;
  // Off along the shot with a hop, spinning about a horizontal axis across it (a belt flips, a shackle tumbles).
  const vel: Vec3 = [u[0] * 3.2, 1.8 + u[1] * 3.2, u[2] * 3.2];
  const spin: Vec3 = [u[2] * 9, 0, -u[0] * 9];
  ctx.boot.spawnMeshGib?.(object, at, vel, spin, 0.04, { tag: 'mesh' });
  ctx.telemetry.telemetry.event('kit-piece-shot', { actor: best.a.id, bone: best.bone, materials: [...best.materials], kind: p.kind });
  return true;
}
