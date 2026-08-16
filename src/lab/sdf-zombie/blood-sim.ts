// src/lab/sdf-zombie/blood-sim.ts
//
// Pure droplet simulation for the lab's gib blood: FX_13-style burst at the
// gib instant, FX_27-style trails behind flying chunks, splat stamps on
// settle. All tuning comes from the GAME's playtested constants — imported,
// never copied, so the lab and game cannot drift (X1 follow-up: converge the
// lab on Blud's own gib logic). No three import: renderer views live per path.
import type { Vec3 } from './types';
import { BLOOD_TRAIL, GIB_BURST, BLOOD_SPLAT } from '../../game/gibs/tuning';

const MAX_DROPLETS = 600;
const MAX_SPLATS = 256;

/** Mutable xyz — droplets integrate in place each frame (Vec3 is readonly). */
type MutVec3 = [number, number, number];

export interface Droplet {
  pos: MutVec3;
  vel: MutVec3;
  age: number;
  life: number;
  size: number;
}

export interface Splat { pos: Vec3; size: number; yaw: number }

export interface BloodSim {
  droplets: Droplet[];
  splats: Splat[];
  /** Per-source emission clocks, keyed by chunk id. */
  clocks: Record<number, number>;
}

export function createBloodSim(): BloodSim {
  return { droplets: [], splats: [], clocks: {} };
}

function push(sim: BloodSim, d: Droplet): void {
  sim.droplets.push(d);
  while (sim.droplets.length > MAX_DROPLETS) sim.droplets.shift();
}

/** FX_13-style radial spray at a gib/sever instant. */
export function burst(sim: BloodSim, origin: Vec3, rng: () => number): void {
  for (let i = 0; i < GIB_BURST.count; i++) {
    const theta = rng() * Math.PI * 2;
    const speed = GIB_BURST.speedMin + rng() * (GIB_BURST.speedMax - GIB_BURST.speedMin);
    const up = 0.4 + rng() * 0.8;
    push(sim, {
      pos: [origin[0], origin[1], origin[2]],
      vel: [Math.cos(theta) * speed, up * speed * 0.6, Math.sin(theta) * speed],
      age: 0,
      life: GIB_BURST.lifetimeSec,
      size: 0.05 + rng() * 0.05,
    });
  }
}

export interface TrailSource { id: number; pos: Vec3; vel: Vec3 }

/** FX_27-style droplet trails behind flying chunks: 20 Hz, 1/256 inheritance. */
export function emitTrails(
  sim: BloodSim, sources: TrailSource[], dt: number, rng: () => number,
): void {
  const period = 1 / BLOOD_TRAIL.emitHz;
  // Epsilon guards against float drift: e.g. subtracting period twenty times
  // from 1.0 leaves 0.049999…96, which would silently drop the 20th emission.
  const eps = 1e-9;
  const live = new Set<number>();
  for (const s of sources) {
    live.add(s.id);
    let clock = (sim.clocks[s.id] ?? 0) + dt;
    while (clock >= period - eps) {
      clock -= period;
      push(sim, {
        pos: [s.pos[0], s.pos[1], s.pos[2]],
        vel: [
          s.vel[0] * BLOOD_TRAIL.velScale + (rng() - 0.5) * 0.4,
          s.vel[1] * BLOOD_TRAIL.velScale + (rng() - 0.5) * 0.4,
          s.vel[2] * BLOOD_TRAIL.velScale + (rng() - 0.5) * 0.4,
        ],
        age: 0,
        life: BLOOD_TRAIL.lifetimeSec,
        size: BLOOD_TRAIL.size * (0.7 + rng() * 0.6),
      });
    }
    sim.clocks[s.id] = clock;
  }
  for (const key of Object.keys(sim.clocks)) {
    if (!live.has(Number(key))) delete sim.clocks[Number(key)];
  }
}

function stamp(sim: BloodSim, at: Vec3, rng: () => number): void {
  const ox = (rng() - 0.5) * 2 * BLOOD_SPLAT.spreadM;
  const oz = (rng() - 0.5) * 2 * BLOOD_SPLAT.spreadM;
  sim.splats.push({ pos: [at[0] + ox, 0, at[2] + oz], size: 0.12 + rng() * 0.18, yaw: rng() * Math.PI * 2 });
  // Raised second-pool chance, same knob the game uses (0xB000 / 0x10000).
  if (rng() < BLOOD_SPLAT.secondChance / 0x10000) {
    sim.splats.push({
      pos: [at[0] - ox * 0.6, 0, at[2] - oz * 0.6],
      size: 0.1 + rng() * 0.12, yaw: rng() * Math.PI * 2,
    });
  }
  while (sim.splats.length > MAX_SPLATS) sim.splats.shift();
}

/** Integrate droplets; floor hits and expiry both stamp splats (cascade). */
export function stepBlood(sim: BloodSim, dt: number, rng: () => number): void {
  const drag = Math.max(0, 1 - BLOOD_TRAIL.airdrag * dt);
  for (let i = sim.droplets.length - 1; i >= 0; i--) {
    const d = sim.droplets[i]!;
    d.vel[1] -= BLOOD_TRAIL.gravity * dt;
    d.vel[0] *= drag; d.vel[1] *= drag; d.vel[2] *= drag;
    d.pos[0] += d.vel[0] * dt; d.pos[1] += d.vel[1] * dt; d.pos[2] += d.vel[2] * dt;
    d.age += dt;
    if (d.pos[1] <= 0.01 || d.age >= d.life) {
      stamp(sim, d.pos, rng);
      sim.droplets.splice(i, 1);
    }
  }
}
