// src/lab/sdf-zombie/motion-profile.ts
//
// Per-character MOTION PROFILE: which gait(s) a body walks with, how fast it
// wanders, how it carries a weapon. Selected by character name by the lab
// (and, later, by the game's spawn table). Pure data; THREE-free — the prop
// is a URL and a grip spec, the view loads it.
import { SHAMBLE, MARCH, RUN, STOMP, GLIDE_CARRY, STALK, type ArmStyle, type GaitProfile } from './gait';
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
  /** The held prop, if any. `gripReach` (m, default 0) seats the prop's grip
   *  that far PAST the wrist along the forearm — the rig's hand joint is the
   *  WRIST (forearm tail), so a character whose fist is a long hand bone (the
   *  ogre's 0.15 m, fist centred at its midpoint) otherwise holds the handle
   *  inside its forearm. The soldier's short hand never showed it. */
  prop?: { url: string; scale?: number; gripReach?: number;
    /** The hand bone lies along the forearm while the prop is held (motion.ts
     *  carry block) instead of keeping its rest hang: a two-handed hilt held
     *  HIGH needs the fist round the grip, not dangling off the wrist. Absent
     *  = the rest hang every gun carry was tuned with. */
    fistOnGrip?: boolean };
  /** A RANGED enemy: the game gives it the soldier's shooting brain
   *  (enemy-mind.ts makeSoldierMind) with this weapon's tuning, and its
   *  onFire spawns enemy rounds. Absent = melee. A prop alone does not make a
   *  shooter — the ogre's chainsaw is a prop with carries. */
  gunner?: { weapon: 'shotgun' | 'smg' };
  /** A MELEE-WEAPON enemy: the game gives it that weapon's mind
   *  (enemy-mind.ts makeSwordMind) and motion.ts drives the held prop through
   *  the swing (sword-swing.ts). Absent = the zombie's unarmed swing. */
  melee?: { kind: 'sword' };
  /** A SOFT target: any bullet or blast hit kills it outright (the game
   *  forces the collapse on the first hit). The cultist is soft; the zombie
   *  and soldier soak hits and exist to show off the gore. Burns do not count
   *  (owner playtest 2026-09-24). */
  soft?: boolean;
  /** Hit reactions: 'soldier' = the soldier's stagger (arms thrown open,
   *  full flail, the hunch; soldier-stagger.ts) instead of the zombie's
   *  lurch/shudder. The soldier always has it. */
  staggerStyle?: 'soldier';
  /** The FULL flail's shape and timing (soldier-stagger fullOpen). Absent =
   *  the soldier's, exactly (SOLDIER_FLAIL). Angles in radians, body-local. */
  flail?: FlailTuning;
}

export interface FlailTuning {
  /** Arm swing out to the side. */
  abduct: number;
  /** Rotation about the body's side axis per arm: + swings the hand BACK. */
  liftL: number;
  liftR: number;
  /** Where the hand ends up around the body (yaw from forward): 1.3 is out to
   *  the side, > pi/2 is behind the shoulder. */
  yawOut: number;
  /** The left arm follows the right after a beat (the soldier's). */
  lagL: boolean;
  /** Seconds to full throw, and the whole reaction. */
  riseSec: number;
  durationSec: number;
  /** Chest/neck/head thrown back this far at full throw (m); head x1.6. */
  arch: number;
}

/** The soldier's full flail — the numbers motion.ts shipped with. */
export const SOLDIER_FLAIL: FlailTuning = {
  abduct: 0.55, liftL: 0, liftR: -0.35, yawOut: 1.30, lagL: true, riseSec: 0.25, durationSec: 1.35, arch: 0,
};

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
  gunner: { weapon: 'shotgun' },
  prop: { url: '/assets/lab/soldier-shotgun.glb', scale: 1.2 },
};

/** The ogre: a heavy stomp, DRAGGING his chainsaw behind him one-handed (the
 *  Quake ogre's walk). The saw is a held PROP on the soldier's carry
 *  machinery (carry.ts): the right arm is rotated into the `drag` carry and
 *  the prop's grip locator seats on the right hand; `drag` is one-handed, so
 *  the left arm hangs free and swings. make-ogre-chainsaw.py builds the .glb
 *  on the shared GUN_GRIP locators. */
export const OGRE_PROFILE: MotionProfile = {
  name: 'ogre',
  // One gait: an ogre does not break into a run (runBand never reached).
  gait: { walk: STOMP, run: STOMP },
  runBand: { from: Infinity, to: Infinity },
  // Slower than the zombie's 1.15 m/s cruise: he closes distance by being
  // unstoppable, not fast.
  cruise: 0.95,
  // Heavier than the soldier's 5.5; a touch under the zombie default feel.
  turnRate: 2.2,
  armStyle: 'carry',
  // `drag` in every state. The two-handed `saw` (belly height, bar across the
  // body) was the first pass; owner, 2026-09-22: "it doesnt make sense to
  // hold the chainsaw like a gun". There is no fire state (he does not shoot),
  // so `fire` only matters if a future attack drives carryOverride — and a
  // swing will want `saw` or its own two-handed raise.
  carries: { walk: 'drag', run: 'drag', fire: 'drag' },
  // 1.6: every prop-local length (and the grip locators) is 1/1.6 of world
  // (make-ogre-chainsaw.py's header). Dragged one-handed, the front hoop no
  // longer has to be in the left arm's reach (that capped the two-handed
  // hold at 1.45), and the longer bar is what lets the nose reach the floor.
  // gripReach 0.075: the fist prim sits at the MIDDLE of his 0.15 m hand bone
  // (ogre.blob `blob arm on hand at=0.50`); at 0 the handle rode inside his
  // forearm (owner, 2026-09-22: "its like in his arm").
  prop: { url: '/assets/lab/ogre-chainsaw.glb', scale: 1.6, gripReach: 0.075 },
};

/** The cultist: the zombie's reach and cruise on a GLIDE (gait.ts) — short
 *  low steps that stay inside his floor-length robe. */
export const CULTIST_PROFILE: MotionProfile = {
  ...ZOMBIE_PROFILE,
  name: 'cultist',
  // Carry-style glide: the tommy gun owns the arms (gait.ts GLIDE_CARRY).
  gait: { walk: GLIDE_CARRY, run: GLIDE_CARRY },
  armStyle: 'carry',
  carries: { walk: 'low', run: 'low', fire: 'aim' },
  // scripts/model-cultist-smg.py -> cultist-smg.glb, on the shared GUN_GRIP
  // locators. gripReach: his fist is authored PAST the wrist (the palm at
  // foreArm 1.06, fingers from 1.12 — cultist.blob), so the grip seats 2 cm on.
  prop: { url: '/assets/lab/cultist-smg.glb', scale: 1.2, gripReach: 0.02 },
  // The tommy gun: the soldier's brain on SMG_TUNING (soldier-brain.ts) —
  // long bursts of single rounds instead of a one-barrel shotgun blast.
  gunner: { weapon: 'smg' },
  // Soft: two trigger pulls kill him, a close slug to the head pops it
  // (owner playtest 2026-09-24, second pass — one hit was too soft).
  soft: true,
  // His first hit staggers him the soldier's way: arms flung out and the aim
  // thrown off, or a hunch (owner, same pass).
  staggerStyle: 'soldier',
  // ...but NOT the soldier's slow opening (owner: "more dramatic — arms thrown
  // out and back"): both arms snap out and behind him in 0.07 s, the chest
  // arches, the head whips back, the gun is flung off target.
  flail: { abduct: 1.45, liftL: 1.2, liftR: 1.2, yawOut: 2.6, lagL: false, riseSec: 0.07, durationSec: 0.85, arch: 0.12 },
};

/** The bride: a slow STALK in a high sword guard; the point trails on the
 *  run. Melee only — the sword mind (enemy-mind.ts) swings it. */
export const BRIDE_PROFILE: MotionProfile = {
  name: 'bride',
  gait: { walk: STALK, run: RUN },
  // She breaks into a run only to close a long gap.
  runBand: { from: 1.6, to: 3.0 },
  cruise: 1.1,
  turnRate: 3.5,
  armStyle: 'carry',
  carries: { walk: 'swordGuard', run: 'swordTrail', fire: 'swordGuard' },
  // Scale 1 (the 1.42 m Blender sword as modelled): the guard's point clears
  // her head by 0.86 m and the trail's rides 0.21 m off the floor, so nothing
  // forces a shrink. fistOnGrip: held HIGH, her fist must close round the
  // grip instead of hanging off the wrist (motion.ts). gripReach 0.04 is the
  // fist centre — the middle of her 0.08 m hand bone, where the fist prim sits
  // (bride.blob `blob arm on hand at=0.45`), with the flesh cuff running on
  // ~13 cm past the wrist into the hilt. Measured fist-to-grip on the rig:
  // 0.03 -> 0.9 / 1.7 cm (guard / trail), 0.04 -> 0.8 / 0.9, 0.05 -> 1.6 / 0.8.
  prop: { url: '/assets/lab/bride-sword.glb', scale: 1, gripReach: 0.04, fistOnGrip: true },
  melee: { kind: 'sword' },
};

const BY_NAME: Record<string, MotionProfile> = {
  zombie: ZOMBIE_PROFILE,
  soldier: SOLDIER_PROFILE,
  ogre: OGRE_PROFILE,
  cultist: CULTIST_PROFILE,
  bride: BRIDE_PROFILE,
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
