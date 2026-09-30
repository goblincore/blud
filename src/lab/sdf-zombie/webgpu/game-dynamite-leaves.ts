// src/lab/sdf-zombie/webgpu/game-dynamite-leaves.ts
//
// Extracted from game-main.ts's main() closure. Each function takes the
// GameContext explicitly instead of capturing main()'s scope.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md


import { type GameContext } from './game-context';
import { type StickProp } from './fpv-view';
import * as THREE from 'three/webgpu';
import { type Vec3 } from '../types';
import { type ZombieActor } from './game-actor';
import { eyeOf } from './game-player';
import { makeFlight } from '../dynamite-flight';
import { throwDirection } from '../fpv';
import { aimDir } from './game-weapon-leaves';

/** Take a prop for a bundle that is leaving the hand: the held one if it is
 *  there, else a spare, else the OLDEST flying bundle's (its state keeps
 *  flying — only the drawing of it is recycled, so the sim never desyncs). */
export function takePropForThrow(ctx: GameContext): StickProp | null {
  if (ctx.weapon.heldProp) {
    const p = ctx.weapon.heldProp;
    ctx.weapon.heldProp = null;
    ctx.bake.bundleRig.remove(p.object);
    ctx.boot.handle.scene.add(p.object);
    return p;
  }
  const spare = ctx.bake.spareBundles.pop();
  if (spare) return spare;
  const oldest = ctx.bake.liveBundles.find(b => b.prop);
  if (!oldest || !oldest.prop) return null;
  const p = oldest.prop;
  oldest.prop = null;
  return p;
}

export const EXPLOSION_LIGHTS = 3;
// WEAPON SLOT 3 — DYNAMITE (2026-09-10).
//
// The purpose is TUNING: a bundle you can throw at zombies and soldiers so
// the blast radius, the gib decision and the cost of a full-body gib can be
// judged in play rather than argued about. So the wiring is deliberately thin
// and every number that matters is a seam (see DYN_PARAMS above).
//
// The pure modules do all the work: fpv.ts owns the COOK state machine and
// the charge→speed band, dynamite-flight.ts owns the ballistic arc — flown
// here against the REAL level (game-level.ts's levelColliders() plus the room
// ceiling), not the lab's arena rect — explosion-aoe.ts owns the AOE, and
// sever.ts owns the gib. This block only routes between them and the THREE
// scene, exactly as the lab's wiring does, with the one difference that here
// the bodies are ACTORS with GPU views, brains and collapse clocks.
// -----------------------------------------------------------------------

/** The bundle's contact radius in the body test, m: a zombie is ~0.45 m
 *  across at the chest. The bundle's OWN 0.08 m radius lives in the flight
 *  module, so this is the body half-width only. */
export const BUNDLE_BODY_RADIUS_M = 0.45;
/** THE EXPLOSION'S OWN LIGHT. A blast is the brightest thing in this game and
 *  it has to READ as one: near-instant spike, then a fast fall — the same
 *  shape the muzzle flash uses, scaled up and outlasted by the fireball. */
export const EXPLOSION_LIGHT = {
  /** Seconds of light, longer than the muzzle flash's 0.14 s by a lot: a
   *  detonation is not an instantaneous event and the room has to have time to
   *  visibly return to dark. */
  lifeSec: 0.5,
  /** Mesh-side peak, in the accents' units (a brazier is 9-13).
   *
   *  320 is measured, not chosen: at 26 the light was DETECTABLY on and
   *  visually nothing — the arena's whole-frame mean rose +0.96 with it
   *  against +0.10 without (the particles alone), i.e. about one level out of
   *  255 spread over the room. A brazier sustains 9-13 and the eye adapts to
   *  it; a half-second flash has to DOMINATE the room it is in to read as one,
   *  so it starts an order of magnitude above the braziers rather than beside
   *  them. `?fxlight=` scales this and the gather peak together. */
  meshPeak: 320,
  /** Gather-side peak. The muzzle flash pushes 35 x probeFlashBoost, and an
   *  explosion is bigger and further away, so a comparable number lands it in
   *  the same range as a firefight's flashes. */
  gatherPeak: 220,
  /** Attached this far above the detonation, so a ground burst lights the room
   *  rather than a disc of floor. */
  liftM: 0.5,
} as const;
/** World position of a prop, or the eye when there is none. */
export const _propPos = new THREE.Vector3();

/** Light a blast. Called by BOTH the real detonation and the capture seam —
 *  a seam that drew the particles but not the light made the light look like
 *  it did nothing at all in the differential capture (measured: 15.0% of frame
 *  changed with the light "on" against 15.1% with ?fxlight=0). */
export function igniteExplosionLight(ctx: GameContext, at: Vec3): void {
  ctx.vfx.explosionLights.push({ pos: [at[0], at[1] + EXPLOSION_LIGHT.liftM, at[2]], age: 0 });
  while (ctx.vfx.explosionLights.length > EXPLOSION_LIGHTS) ctx.vfx.explosionLights.shift();
}

/** Spike-then-fall, 1 at ignition and 0 at lifeSec. */
export function explosionLightEnv(ctx: GameContext, age: number): number {
  if (age < 0 || age >= EXPLOSION_LIGHT.lifeSec) return 0;
  const u = age / EXPLOSION_LIGHT.lifeSec;
  // A hard attack (the first frame is the brightest) then an exponential fall
  // — a LINEAR fade reads as a lamp being switched off, not as a blast.
  return Math.exp(-4.2 * u) * (1 - u * u * 0.35);
}

export function propWorld(ctx: GameContext, p: StickProp | null): Vec3 {
  if (!p) return eyeOf(ctx.player.player);
  p.object.getWorldPosition(_propPos);
  return [_propPos.x, _propPos.y, _propPos.z];
}

/** True when a body is within the bundle's contact radius anywhere along the
 *  sub-step's segment. Called at the FLIGHT's own 120 Hz, so a 28 m/s bundle
 *  (0.23 m per sub-step) cannot tunnel through a 0.45 m target. */
export function bundleHitsBody(ctx: GameContext, from: Vec3, to: Vec3): ZombieActor | null {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const l2 = dx * dx + dy * dy + dz * dz || 1;
  for (const a of ctx.world.actors) {
    const p = a.pose();
    const cx = p.pos[0], cy = p.pos[1] + 0.95, cz = p.pos[2];
    const t = Math.max(0, Math.min(1,
      ((cx - from[0]) * dx + (cy - from[1]) * dy + (cz - from[2]) * dz) / l2));
    const qx = from[0] + dx * t - cx, qy = from[1] + dy * t - cy, qz = from[2] + dz * t - cz;
    if (qx * qx + qy * qy + qz * qz <= BUNDLE_BODY_RADIUS_M * BUNDLE_BODY_RADIUS_M) return a;
  }
  return null;
}

/** Release a bundle from the hand along the aim. */
export function throwBundle(ctx: GameContext, speedMps: number): void {
  if (!ctx.bake.bundleReady) return;
  // THE ORIGIN IS READ BEFORE THE REPARENT, and that order is load-bearing:
  // the held prop's world transform IS the hold pose (it rides `bundleRig`,
  // inside the camera), while `takePropForThrow` moves the object to the scene
  // root and leaves its LOCAL transform behind. Reading the position after
  // that hands the flight the scene ORIGIN — a point inside the level's solid
  // centre block — so the bundle was born buried in geometry, pushed out
  // downward, and left sliding along the floor. Caught by the slot gate.
  const origin = propWorld(ctx, ctx.weapon.heldProp);
  const prop = takePropForThrow(ctx);
  // The reticle IS the aim under both schemes (aimDir handles free aim), and
  // fpv.ts's throwDirection applies the game's upward lob on top — the same
  // two rules the lab's throw uses, so a bundle thrown here lands where the
  // lab's does. Deriving yaw/pitch from the aim vector keeps the lob maths
  // in that one function instead of a second copy here.
  const d = aimDir(ctx);
  const yaw = Math.atan2(d[0], -d[2]);
  const pitch = Math.asin(Math.max(-1, Math.min(1, d[1])));
  const dir = throwDirection(yaw, pitch);
  const speed = speedMps * ctx.dynamite.speedScale;
  const state = makeFlight(origin, [dir[0] * speed, dir[1] * speed, dir[2] * speed], { impactMode: true });
  ctx.bake.liveBundles.push({ state, prop });
  prop?.pose({ mode: 'flight', pos: state.pos, spin: state.spin, fuseBurning: true });
  ctx.dynamite.thrown++;
  ctx.telemetry.telemetry.event('dynamite-throw', { speedMps: speed, x: origin[0], y: origin[1], z: origin[2] });
}
