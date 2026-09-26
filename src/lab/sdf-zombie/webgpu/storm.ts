// src/lab/sdf-zombie/webgpu/storm.ts
//
// THE STORM OUTSIDE (Night Train dynamic light spec §2.2-2.4, §3). Pure: a seeded schedule of
// lightning bolts and passing-light sweeps, and the light that comes through the windows at a
// time: a cold blue-white spike per bolt from its side of the train, a warm sweep swinging from
// ahead to behind. The window glass draws the same bolts (TRAIN_STORM reads `flash` and the bolt).

import { hash01 } from './lamp-moods';

export type Vec3 = [number, number, number];

export const STORM = {
  /** Seconds between bolts, and between sweeps. */
  boltGap: [3, 9] as const,
  sweepGap: [14, 26] as const,
  /** A sweep's length, seconds. */
  sweepS: 1.5,
  boltColor: [0.72, 0.82, 1.0] as Vec3,
  boltPeak: 16,
  sweepColor: [1.0, 0.68, 0.38] as Vec3,
  sweepPeak: 2.4,
  /** The lightning's direction toward the light, for side +1 (x flips with the side). Low, so it
   *  reaches across the aisle through the windows. */
  boltDir: [0.9, 0.3, 0.15] as Vec3,
  /** Ambient bounce added per unit of window-light intensity (the flash fills the room a little). */
  bounce: 0.05,
  /** A bolt's life, seconds. */
  boltLife: 0.6,
} as const;

export interface Bolt { t: number; side: 1 | -1; z: number; seed: number }
export interface Sweep { t: number; side: 1 | -1 }
export interface StormSchedule { bolts: Bolt[]; sweeps: Sweep[] }

export function stormSchedule(seed: number, until: number): StormSchedule {
  const bolts: Bolt[] = [], sweeps: Sweep[] = [];
  const [b0, b1] = STORM.boltGap, [s0, s1] = STORM.sweepGap;
  let t = 2 + hash01(seed, 0) * 3;   // the first bolt comes soon
  for (let i = 1; t <= until; i++) {
    bolts.push({ t, side: hash01(seed, i * 4 + 1) < 0.5 ? 1 : -1, z: (hash01(seed, i * 4 + 2) - 0.5) * 120, seed: Math.floor(hash01(seed, i * 4 + 3) * 1e6) });
    t += b0 + hash01(seed, i * 4) * (b1 - b0);
  }
  t = 8 + hash01(seed + 1, 0) * 6;
  for (let i = 1; t <= until; i++) {
    sweeps.push({ t, side: hash01(seed + 1, i * 2 + 1) < 0.5 ? 1 : -1 });
    t += s0 + hash01(seed + 1, i * 2) * (s1 - s0);
  }
  return { bolts, sweeps };
}

/** 0..1 brightness of a bolt `age` seconds after it strikes: spike, dip, second spike, decay. */
export function boltEnvelope(age: number, seed: number): number {
  if (age < 0 || age > STORM.boltLife) return 0;
  const second = 0.7 + 0.2 * hash01(seed, 99);   // the restrike's strength
  if (age < 0.05) return age / 0.05;
  if (age < 0.13) return 1 - 0.75 * Math.min(1, (age - 0.05) / 0.04);   // down to 0.25 by 0.09
  if (age < 0.19) return second;
  return second * Math.max(0, 1 - (age - 0.19) / (STORM.boltLife - 0.19)) ** 2;
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** The latest event at or before t (the schedule is sorted). */
function latest<T extends { t: number }>(list: readonly T[], t: number): T | null {
  let lo = 0, hi = list.length - 1, best: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.t <= t) { best = list[mid]!; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/** The window light at t: colour × intensity and the direction TOWARD the light (unit). */
export function windowLightAt(s: StormSchedule, t: number):
  { intensity: number; color: Vec3; dir: Vec3; bolt: Bolt | null; flash: number; event: number | null } {
  const b = latest(s.bolts, t);
  const flash = b ? boltEnvelope(t - b.t, b.seed) : 0;
  const sw = latest(s.sweeps, t);
  const k = sw ? (t - sw.t) / STORM.sweepS : -1;
  const sweepI = k >= 0 && k <= 1 ? STORM.sweepPeak * Math.sin(Math.PI * k) : 0;
  const boltI = STORM.boltPeak * flash;
  const intensity = boltI + sweepI;
  const bd = STORM.boltDir;
  if (intensity <= 0) return { intensity: 0, color: [...STORM.boltColor], dir: norm([bd[0], bd[1], bd[2]]), bolt: null, flash: 0, event: null };
  const color: Vec3 = [0, 1, 2].map(i => (STORM.boltColor[i]! * boltI + STORM.sweepColor[i]! * sweepI) / intensity) as Vec3;
  const boltWins = boltI >= sweepI;
  const dir = boltWins
    ? norm([b!.side * bd[0], bd[1], bd[2]])
    : norm([sw!.side * 0.9, 0.18, -1.6 + 3.2 * k]);
  return { intensity, color, dir, bolt: flash > 0 ? b : null, flash, event: boltWins ? b!.t : sw!.t };
}
