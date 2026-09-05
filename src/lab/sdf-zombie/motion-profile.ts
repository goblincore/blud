// src/lab/sdf-zombie/motion-profile.ts
//
// Per-character MOTION PROFILE: which gait(s) a body walks with, how fast it
// wanders, how it carries a weapon. Selected by character name by the lab
// (and, later, by the game's spawn table). Pure data; THREE-free — the prop
// is a URL and a grip spec, the view loads it.
import { SHAMBLE, MARCH, RUN, type ArmStyle, type GaitProfile } from './gait';
import type { CarryName } from './carry';
import { WANDER_TUNING } from './wander';

export interface MotionProfile {
  name: string;
  /** walk and run gaits. A single-gait character passes the same profile
   *  twice and runWeight is 0 everywhere. */
  gait: { walk: GaitProfile; run: GaitProfile };
  /** Wander speed band (m/s) over which walk blends to run. */
  runBand: { from: number; to: number };
  /** Wander cruise speed (m/s). */
  cruise: number;
  /** Arm style when the gait profile does not say 'carry'. */
  armStyle: ArmStyle;
  /** Which carry each locomotion state uses; absent = no held weapon. */
  carries?: { walk: CarryName; run: CarryName; fire: CarryName };
  /** The held prop, if any. */
  prop?: { url: string };
}

export const ZOMBIE_PROFILE: MotionProfile = {
  name: 'zombie',
  gait: { walk: SHAMBLE, run: SHAMBLE },
  runBand: { from: Infinity, to: Infinity },
  cruise: WANDER_TUNING.speed,
  armStyle: 'reach',
};

export const SOLDIER_PROFILE: MotionProfile = {
  name: 'soldier',
  gait: { walk: MARCH, run: RUN },
  runBand: { from: 1.6, to: 3.0 },
  cruise: 3.4,
  armStyle: 'carry',
  carries: { walk: 'low', run: 'chest', fire: 'hip' },
  prop: { url: '/assets/lab/shorty-double.glb' },
};

const BY_NAME: Record<string, MotionProfile> = {
  zombie: ZOMBIE_PROFILE,
  soldier: SOLDIER_PROFILE,
};

/** The profile for a character name; anything unlisted moves like the zombie. */
export function motionProfileFor(character: string): MotionProfile {
  return BY_NAME[character] ?? ZOMBIE_PROFILE;
}

/** walk→run blend weight in [0,1] for a wander speed. */
export function runWeight(p: MotionProfile, speed: number): number {
  const { from, to } = p.runBand;
  if (!(speed > from)) return 0;
  if (speed >= to) return 1;
  return (speed - from) / (to - from);
}
