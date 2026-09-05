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
  // Cruise and the walk→run band come from the reference clips' implied
  // speeds (Task 1's sampling, for a 0.84 m leg):
  //   soldier-walk: freq 0.937 Hz, duty 0.63, travel 0.746 m → implied speed 1.12 m/s
  //   soldier-run:  freq 1.500 Hz, duty 0.31, travel 0.670 m → implied speed 3.22 m/s
  // The band brackets between the two clips (±0.2 inside the implied
  // speeds); cruise is the run clip's implied speed rounded to 0.1.
  runBand: { from: 1.32, to: 3.02 },
  cruise: 3.2,
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
