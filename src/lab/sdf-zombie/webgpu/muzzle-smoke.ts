// MUZZLE SMOKE: soft grey puffs in the WORLD, for an enemy's gun (the tallow's arm-cannons, game-spawn.ts). Owner,
// 2026-11-15: the muzzle blast (a small explosion-VFX burst) had too much flame; the shot should leave "just smoke".
// The player's own smoke (game-main.ts SMOKE) lives on the gun rig in camera space; this is the same billboard pool
// with the same texture (flash-sprite.ts smokePixels), but its puffs sit in the world and turn to face the camera
// every step. Drawn in the effects overlay like the tracers, so a body in front hides them and one behind does not.
// One pool per game, made on the first puff. The same pool draws the TRAIL a volley rocket leaves (game-tick.ts):
// smaller, shorter-lived puffs dropped along its path.
import * as THREE from 'three';
import { type GameContext } from './game-context';
import { smokePixels } from './flash-sprite';
import { rngStreams } from './rng';
import type { Vec3 } from '../types';

export const MUZZLE_SMOKE = {
  /** Pooled puffs: four shots of `perShot` each, with room for the previous volley still fading. */
  pool: 112,
  perShot: 7,
  /** A puff's life, s, and its size (m) at birth and at death. */
  lifeSec: 1.6,
  size0: 0.28,
  size1: 1.10,
  /** Peak opacity, reached quickly and then fading out. */
  opacity: 0.85,
  /** Launch speed along the shot (m/s, randomised up to +60%), lift (m/s per s) and drag (per s). */
  speed: 1.4,
  lift: 0.35,
  drag: 2.2,
  colour: 0xb4ada6,
} as const;

/** How one puff grows and fades. */
export interface PuffLook { lifeSec: number; size0: number; size1: number; opacity: number }

/** A rocket's smoke trail (owner, 2026-11-15: the shots should be "more like rockets"): a puff every `everySec` of
 *  flight, small and thin, hanging where it was dropped and drifting up. */
export const TRAIL_SMOKE = {
  everySec: 0.03,
  lifeSec: 0.9,
  size0: 0.10,
  size1: 0.42,
  opacity: 0.55,
} as const;

/** A puff's size and opacity at age `u` of its life (0..1): it swells fast then slows, and fades in over the first
 *  tenth and out over the rest. Pure. */
export function puffEnvelope(u: number, look: PuffLook = MUZZLE_SMOKE): { size: number; opacity: number } {
  const t = Math.min(1, Math.max(0, u));
  const grow = 1 - (1 - t) * (1 - t);
  const fadeIn = Math.min(1, t / 0.1);
  return {
    size: look.size0 + (look.size1 - look.size0) * grow,
    opacity: look.opacity * fadeIn * (1 - t) * (1 - t * 0.4),
  };
}

interface Puff { mesh: THREE.Mesh; age: number; vel: THREE.Vector3; roll: number; spin: number; look: PuffLook }
const pools = new WeakMap<GameContext, Puff[]>();

function poolOf(ctx: GameContext): Puff[] {
  let pool = pools.get(ctx);
  if (pool) return pool;
  const tex = new THREE.DataTexture(smokePixels(128, 7), 128, 128, THREE.RGBAFormat);
  tex.needsUpdate = true;
  const geo = new THREE.PlaneGeometry(1, 1);
  pool = [];
  for (let i = 0; i < MUZZLE_SMOKE.pool; i++) {
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0, depthWrite: false, color: MUZZLE_SMOKE.colour,
    }));
    mesh.visible = false;
    mesh.frustumCulled = false;
    // The overlay scene does not walk matrices (the tracers set theirs by hand): stepMuzzleSmoke updates each puff's.
    mesh.matrixAutoUpdate = false;
    ctx.vfx.characterEffects.scene.add(mesh);
    pool.push({ mesh, age: Infinity, vel: new THREE.Vector3(), roll: 0, spin: 0, look: MUZZLE_SMOKE });
  }
  pools.set(ctx, pool);
  return pool;
}

/** Release a shot's puffs at `at`, drifting out along `dir` (any length). Reuses the oldest puffs when all are live. */
export function emitMuzzleSmoke(ctx: GameContext, at: Vec3, dir: Vec3): void {
  if (!ctx.vfx.characterEffects) return;
  const pool = poolOf(ctx);
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d: Vec3 = [dir[0] / l, dir[1] / l, dir[2] / l];
  const rng = rngStreams.fx;
  const free = pool.filter(p => p.age === Infinity);
  const pick = free.length >= MUZZLE_SMOKE.perShot ? free
    : [...free, ...pool.filter(p => p.age !== Infinity).sort((a, b) => b.age - a.age)];
  for (let i = 0; i < MUZZLE_SMOKE.perShot && i < pick.length; i++) {
    const p = pick[i]!;
    p.age = 0;
    p.look = MUZZLE_SMOKE;
    p.roll = rng() * Math.PI * 2;
    p.spin = (rng() - 0.5) * 1.2;
    // Spread along the first 0.25 m of the plume, a little off-axis.
    const along = rng() * 0.25;
    p.mesh.position.set(
      at[0] + d[0] * along + (rng() - 0.5) * 0.08,
      at[1] + d[1] * along + (rng() - 0.5) * 0.08,
      at[2] + d[2] * along + (rng() - 0.5) * 0.08,
    );
    const v = MUZZLE_SMOKE.speed * (1 + 0.6 * rng()) * (1 - 0.6 * i / MUZZLE_SMOKE.perShot);
    p.vel.set(d[0] * v + (rng() - 0.5) * 0.4, d[1] * v + 0.15 + rng() * 0.25, d[2] * v + (rng() - 0.5) * 0.4);
    p.mesh.visible = false;   // shown by the next step, once it faces the camera
  }
}

/** Drop one trail puff at `at` (a rocket's tail), drifting a little back along `vel` and up. */
export function emitTrailPuff(ctx: GameContext, at: Vec3, vel: Vec3): void {
  if (!ctx.vfx.characterEffects) return;
  const pool = poolOf(ctx);
  const rng = rngStreams.fx;
  let p = pool.find(q => q.age === Infinity);
  // All live: take the oldest trail puff (a muzzle cloud is worth more than one more puff of tail).
  if (!p) p = pool.filter(q => q.look === TRAIL_SMOKE).sort((a, b) => b.age - a.age)[0];
  if (!p) return;
  p.age = 0; p.look = TRAIL_SMOKE;
  p.roll = rng() * Math.PI * 2; p.spin = (rng() - 0.5) * 1.6;
  p.mesh.position.set(at[0] + (rng() - 0.5) * 0.03, at[1] + (rng() - 0.5) * 0.03, at[2] + (rng() - 0.5) * 0.03);
  p.vel.set(-vel[0] * 0.04 + (rng() - 0.5) * 0.2, -vel[1] * 0.04 + 0.1 + rng() * 0.15, -vel[2] * 0.04 + (rng() - 0.5) * 0.2);
  p.mesh.visible = false;
}

/** Advance every live puff: drift, rise, swell, fade, face the camera. */
export function stepMuzzleSmoke(ctx: GameContext, dt: number, camera: THREE.Camera): void {
  const pool = pools.get(ctx);
  if (!pool) return;
  for (const p of pool) {
    if (p.age === Infinity) continue;
    p.age += dt;
    const u = p.age / p.look.lifeSec;
    if (u >= 1) { p.age = Infinity; p.mesh.visible = false; continue; }
    p.mesh.position.addScaledVector(p.vel, dt);
    p.vel.multiplyScalar(Math.max(0, 1 - MUZZLE_SMOKE.drag * dt));
    p.vel.y += MUZZLE_SMOKE.lift * dt;
    const e = puffEnvelope(u, p.look);
    p.mesh.quaternion.copy(camera.quaternion);
    p.mesh.rotateZ(p.roll + p.spin * p.age);
    p.mesh.scale.setScalar(e.size);
    (p.mesh.material as THREE.MeshBasicMaterial).opacity = e.opacity;
    p.mesh.updateMatrix();
    p.mesh.updateMatrixWorld();
    p.mesh.visible = true;
  }
}

/** The live puffs (the debug seam `__sdfGame.muzzleSmoke`): world position, size, opacity. */
export function muzzleSmokeLive(ctx: GameContext): { pos: Vec3; size: number; opacity: number }[] {
  return (pools.get(ctx) ?? []).filter(p => p.age !== Infinity && p.mesh.visible).map(p => ({
    pos: [p.mesh.position.x, p.mesh.position.y, p.mesh.position.z] as Vec3,
    size: p.mesh.scale.x, opacity: (p.mesh.material as THREE.MeshBasicMaterial).opacity,
  }));
}
