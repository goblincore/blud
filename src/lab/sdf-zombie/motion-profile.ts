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
  /** Body turn rate (rad/s); absent preserves the heavy zombie turn. */
  turnRate?: number;
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
  //   soldier-run (helmeted reference): freq 1.500 Hz, duty 0.28, travel 0.557 m → implied speed 2.97 m/s
  // The blend reaches the run near its measured speed.
  runBand: { from: 1.32, to: 3.02 },
  // CRUISE IS THE WALK CLIP'S SPEED, NOT THE RUN CLIP'S (fixed 2026-09-06).
  //
  // It was 3.2 — the RUN clip's implied speed, taken because both numbers came
  // out of the same clip sampling. But those are two different quantities:
  // runBand calibrates the walk->run BLEND, while cruise is what stepWander
  // actually MOVES the body at. Setting the wander speed from the run clip
  // made the soldier sprint everywhere at 2.8x the zombie's 1.15 m/s.
  //
  // Nothing in the lab could show it: the lab's hero is a treadmill driven by
  // forceSpeed and never wanders. In the GAME it was immediately obvious —
  // stepWander's arriveRadius is 0.4 m, which he crossed in 0.125 s, so he
  // overshot every target: past the standoff point into retreat range,
  // reverse, past it into advance range, reverse. The owner's description was
  // "running around the room like a chicken with his head cut off until he
  // gets stuck in a wall".
  //
  // 1.25, not the walk clip's own 1.12: motion-profile.test.ts pins
  // cruise > WANDER_TUNING.speed (1.15) — "a soldier moves faster than a
  // shambling zombie" — which is real design intent that the absurd 3.2
  // happened to satisfy. 1.25 keeps it, stays below runBand.from (1.32) so he
  // MARCHES rather than blending toward the run, and crosses the 1.5 m
  // standoff band in 1.2 s instead of half a second.
  cruise: 1.25,
  armStyle: 'carry',
  carries: { walk: 'low', run: 'chest', fire: 'aim' },
  turnRate: 5.5,
  prop: { url: '/assets/lab/soldier-shotgun.glb' },
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

/** Lab speed controls are animation bands, independent of patrol cruise. */
export function speedForBand(profile: MotionProfile, band: 'walk' | 'run'): number {
  return band === 'run' && Number.isFinite(profile.runBand.to)
    ? Math.max(profile.cruise, profile.runBand.to + 0.2)
    : Math.min(profile.cruise, profile.runBand.from * 0.75);
}
