// src/lab/sdf-zombie/blood-sim.ts
//
// Pure droplet simulation for the lab's gib blood: FX_13-style burst at the
// gib instant, FX_27-style trails behind flying chunks, splat stamps on
// settle, and heavy scrap hunks riding the same sim (gobs-and-goo §1). All
// tuning comes from the GAME's playtested constants — imported, never
// copied, so the lab and game cannot drift (X1 follow-up: converge the
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
  /** 'drop' = mist bead (burst/trails); 'scrap' = heavy amorphous hunk. */
  kind: 'drop' | 'scrap';
}

// Scrap feel knobs (gobs-and-goo §1): scraps are the amorphous meat bits
// makeGobs emits at a full gib. They share the droplet sim but must read as
// heavy and SLOW — half the launch band, double the drag, brief arcs, and a
// floor pool wider than a bead's because a hunk of meat squashes wider.
export const SCRAP_TUNING = {
  /** Seconds a scrap arcs before it settles/expires. */
  lifetimeSec: 6,
  /** Airdrag multiplier vs a droplet — chunky things shed speed fast. */
  dragMul: 2,
  /** Splat size multiplier — scraps stamp wider floor pools. */
  splatScale: 2.2,
  /** Launch band as a fraction of the GIB_BURST speed band. */
  speedBandScale: 0.5,
} as const;

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
      // Small beads, not orbs: the lab camera sits close and burst drops
      // read half-size vs the game's distances (playtest 2026-08-16).
      size: 0.03 + rng() * 0.03,
      kind: 'drop',
    });
  }
}

/** A scrap spawn from gobs.ts — kept structural so gobs.ts need not import. */
export interface ScrapSpawn { pos: Vec3; size: number }

/**
 * Launches gobs' scraps as heavy slow particles: each flies radially AWAY
 * from the body centre at half the burst speed band with the burst up-bias,
 * living SCRAP_TUNING.lifetimeSec under double drag — they arc out and plop
 * into the spray rather than jetting like the mist.
 */
export function addScraps(
  sim: BloodSim, scraps: ScrapSpawn[], origin: Vec3, rng: () => number,
): void {
  for (const s of scraps) {
    const dx = s.pos[0] - origin[0];
    const dz = s.pos[2] - origin[2];
    const hl = Math.hypot(dx, dz);
    // Radial-away in the horizontal plane; a scrap sitting on the centre
    // axis falls back to a random azimuth (the burst's own direction shape).
    const theta = rng() * Math.PI * 2;
    const dirX = hl > 1e-6 ? dx / hl : Math.cos(theta);
    const dirZ = hl > 1e-6 ? dz / hl : Math.sin(theta);
    const speed = SCRAP_TUNING.speedBandScale
      * (GIB_BURST.speedMin + rng() * (GIB_BURST.speedMax - GIB_BURST.speedMin));
    const up = 0.4 + rng() * 0.8;
    push(sim, {
      pos: [s.pos[0], s.pos[1], s.pos[2]],
      vel: [dirX * speed, up * speed * 0.6, dirZ * speed],
      age: 0,
      life: SCRAP_TUNING.lifetimeSec,
      size: s.size,
      kind: 'scrap',
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
        kind: 'drop',
      });
    }
    sim.clocks[s.id] = clock;
  }
  for (const key of Object.keys(sim.clocks)) {
    if (!live.has(Number(key))) delete sim.clocks[Number(key)];
  }
}

function stamp(sim: BloodSim, at: Vec3, rng: () => number, kind: 'drop' | 'scrap' = 'drop'): void {
  const scale = kind === 'scrap' ? SCRAP_TUNING.splatScale : 1;
  const ox = (rng() - 0.5) * 2 * BLOOD_SPLAT.spreadM;
  const oz = (rng() - 0.5) * 2 * BLOOD_SPLAT.spreadM;
  sim.splats.push({ pos: [at[0] + ox, 0, at[2] + oz], size: (0.12 + rng() * 0.18) * scale, yaw: rng() * Math.PI * 2 });
  // Raised second-pool chance, same knob the game uses (0xB000 / 0x10000).
  if (rng() < BLOOD_SPLAT.secondChance / 0x10000) {
    sim.splats.push({
      pos: [at[0] - ox * 0.6, 0, at[2] - oz * 0.6],
      size: (0.1 + rng() * 0.12) * scale, yaw: rng() * Math.PI * 2,
    });
  }
  while (sim.splats.length > MAX_SPLATS) sim.splats.shift();
}

/** Integrate droplets; floor hits and expiry both stamp splats (cascade). */
export function stepBlood(sim: BloodSim, dt: number, rng: () => number): void {
  for (let i = sim.droplets.length - 1; i >= 0; i--) {
    const d = sim.droplets[i]!;
    // Scraps are chunky — they feel double the airdrag of a mist bead.
    const drag = Math.max(0, 1 - BLOOD_TRAIL.airdrag
      * (d.kind === 'scrap' ? SCRAP_TUNING.dragMul : 1) * dt);
    d.vel[1] -= BLOOD_TRAIL.gravity * dt;
    d.vel[0] *= drag; d.vel[1] *= drag; d.vel[2] *= drag;
    d.pos[0] += d.vel[0] * dt; d.pos[1] += d.vel[1] * dt; d.pos[2] += d.vel[2] * dt;
    d.age += dt;
    if (d.pos[1] <= 0.01 || d.age >= d.life) {
      stamp(sim, d.pos, rng, d.kind);
      sim.droplets.splice(i, 1);
    }
  }
}
