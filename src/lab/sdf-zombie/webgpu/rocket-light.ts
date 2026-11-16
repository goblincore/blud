// ROCKET LIGHT: a volley rocket (the tallow, rocket-view.ts) lights the level as it flies (owner, 2026-11-16: "make the
// rockets light the level as they fly"; deferred from the rocket look pass). Its impact already flashes the room
// (game-tick's fireball bursts call igniteExplosionLight); this is the light in FLIGHT, a hot orange point riding at
// the nozzle. It reaches the three places the explosion's light does, so walls, bodies and bounce agree:
//   mesh    a small pool of PERMANENT PointLights (walls, floor, kit meshes). Never .visible-toggled (that re-keys
//           the scene's LightsNode and recompiles every lit material); an idle slot sits at intensity 0
//   gather  the player's room's probe bounce (game-main's gather list, after the explosions)
//   body    the direct flashes the SDF bodies key on (the light list; the old bodyFlash path)
// A volley is four rockets but the pool is two: each frame the two nearest the eye get the lights (the far ones are
// lighting walls the player is not looking at). The pure part (picking, flicker) is tested; the rest writes three.
import * as THREE from 'three/webgpu';
import type { GameContext } from './game-context';
import type { Vec3 } from '../types';

export const ROCKET_LIGHT = {
  /** Mesh-side point lights. Every one costs a term on every lit wall pixel, so few. */
  pool: 2,
  /** Mesh-side intensity, the accents' units: a brazier sustains 9-13, a burning body 40, a blast spikes 320. */
  meshPeak: 70,
  /** Probe-gather intensity (a burning body 120, a blast 220). */
  gatherPeak: 90,
  /** Direct-flash intensity for the bodies (an enemy muzzle flash is 35 at its peak). */
  flashPeak: 30,
  /** Exhaust orange. */
  colour: [1.0, 0.62, 0.30] as const,
  /** Behind the rocket's centre, m: at the nozzle, where the flame is (rocket-view bodyLen / 2 + a little). */
  backM: 0.32,
  /** Flicker depth (0 = steady): a motor's burn, not a lamp. */
  flicker: 0.22,
  /** Ramp in over the first part of the flight, s, so the light grows out of the muzzle flash, not on top of it. */
  rampSec: 0.06,
} as const;

/** `?rocketlight=` scales every path (0 = off, for an A/B against the muzzle flash's light). Read once. */
export function rocketLightGainFrom(search: string): number {
  const v = new URLSearchParams(search).get('rocketlight');
  if (v === null) return 1;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 4) : 1;
}
const GAIN = typeof location === 'undefined' ? 1 : rocketLightGainFrom(location.search);

/** A live rocket as the light needs it. */
export interface RocketLightSource { pos: Vec3; vel: Vec3; ageSec: number; phase: number }

/** The light's point: behind the centre, along the flight. Pure. */
export function nozzleOf(pos: Vec3, vel: Vec3): Vec3 {
  const sp = Math.hypot(vel[0], vel[1], vel[2]);
  if (!(sp > 1e-6)) return [pos[0], pos[1], pos[2]];
  const k = ROCKET_LIGHT.backM / sp;
  return [pos[0] - vel[0] * k, pos[1] - vel[1] * k, pos[2] - vel[2] * k];
}

/** The light's level, 0..1: a quick ramp off the muzzle, then a motor flicker around (1 - depth/2). Pure. */
export function rocketLightLevel(ageSec: number, phase: number, depth: number = ROCKET_LIGHT.flicker): number {
  if (!(ageSec >= 0)) return 0;
  const ramp = Math.min(1, ageSec / ROCKET_LIGHT.rampSec);
  // Two incommensurate sines: no visible period at a rocket's ~1 s of flight.
  const w = 0.5 + 0.25 * Math.sin(ageSec * 61 + phase) + 0.25 * Math.sin(ageSec * 37.3 + phase * 2.1);
  return ramp * (1 - depth * w);
}

/** The `n` sources nearest `eye`, nearest first. Pure; does not reorder its input. */
export function nearestRockets<T extends { pos: Vec3 }>(sources: readonly T[], eye: Vec3, n: number): T[] {
  return [...sources].sort((a, b) => d2(a.pos, eye) - d2(b.pos, eye)).slice(0, n);
}
function d2(a: Vec3, b: Vec3): number {
  const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
  return x * x + y * y + z * z;
}

/** A lit rocket this frame: where its light is and how strong (0..1, before each path's peak). */
export interface RocketLit { pos: Vec3; level: number }

/** Every live volley rocket's light this frame (all of them: the gather and the bodies take more than the pool). */
export function liveRocketLights(ctx: GameContext): RocketLit[] {
  const out: RocketLit[] = [];
  const fb = ctx.weapon.fireballs;
  for (let i = 0; i < fb.length; i++) {
    const b = fb[i]!;
    if (b.look !== 'rocket') continue;
    // A per-rocket phase from its horizontal velocity (constant in flight; the droop is vertical), so a volley's
    // four do not flicker in step and a rocket keeps its phase when an earlier one bursts and the list shifts.
    const phase = b.vel[0] * 3.1 + b.vel[2] * 1.7;
    const level = rocketLightLevel(b.ageSec, phase) * GAIN;
    if (level <= 0) continue;
    out.push({ pos: nozzleOf(b.pos, b.vel), level });
  }
  return out;
}

const pools = new WeakMap<GameContext, THREE.PointLight[]>();

/** Build the mesh-side pool under `parent` (the accent group, with the explosion pool), at boot before the pipelines
 *  compile. Idempotent: a second pool would re-key the LightsNode mid-game. */
export function createRocketLightPool(ctx: GameContext, parent: THREE.Object3D): void {
  if (pools.has(ctx)) return;
  const pool: THREE.PointLight[] = [];
  const [r, g, b] = ROCKET_LIGHT.colour;
  for (let i = 0; i < ROCKET_LIGHT.pool; i++) {
    const pl = new THREE.PointLight(new THREE.Color(r, g, b), 0, 0, 2);
    pl.name = `rocket-light-${i}`;
    pl.visible = true;
    parent.add(pl);
    pool.push(pl);
  }
  pools.set(ctx, pool);
}

/** Write the pool for this frame: the nearest rockets to the eye get the lights, the rest of the pool goes dark. */
export function updateRocketLightPool(ctx: GameContext, lit: readonly RocketLit[], eye: Vec3): void {
  const pool = pools.get(ctx);
  if (!pool) return;
  const near = nearestRockets(lit, eye, pool.length);
  const scale = ctx.lighting.fxLightScale;
  for (let i = 0; i < pool.length; i++) {
    const pl = pool[i]!, s = near[i];
    if (!s) { pl.intensity = 0; continue; }
    pl.position.set(s.pos[0], s.pos[1], s.pos[2]);
    pl.intensity = ROCKET_LIGHT.meshPeak * s.level * scale;
  }
}

/** The pool's live state (the debug seam `__sdfGame.rocketLights`). */
export function rocketLightPoolView(ctx: GameContext): { pos: Vec3; intensity: number }[] {
  return (pools.get(ctx) ?? []).map(pl => ({ pos: [pl.position.x, pl.position.y, pl.position.z] as Vec3, intensity: pl.intensity }));
}
