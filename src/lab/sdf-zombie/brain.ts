// src/lab/sdf-zombie/brain.ts
//
// One zombie's decision layer, as a named state machine. Pure — no clock, no
// RNG, no THREE — so every transition is unit-testable against hand-worked
// geometry.
//
// WHY IT IS A MACHINE NOW. The first version had three modes and three
// ad-hoc overrides doing the same job three different ways: a hysteresis
// latch for "close enough to swing", an early return for "a committed swing
// always finishes", and a blast hold that was not even in this file — it was
// a holdSecs timer in game-actor.ts gating cfg.wander from outside. All three
// are states here, which is the whole point: the transitions are a table you
// can read in one place instead of conditionals across two files.
//
// IT DOES NOT DRIVE LOCOMOTION. There is exactly one walker (wander.ts,
// through motion.ts) and a second would mean two sets of turn rates drifting
// apart. The machine emits a TARGET and a HALT flag; the actor writes them
// into the wander.
//
// IT DOES NOT DECIDE WHO SWINGS. That is crowd-level and lives in
// melee-ring.ts; `hasToken` and `drift` arrive as input. This file only says
// what one body does with the answer.
//
// HEADING CONVENTION (wander.ts): yaw 0 faces +z, positive is clockwise seen
// from above. The bearing to a point is atan2(dx, dz).
//
// ROOM-BOUND, DELIBERATELY. stepWander clamps every body to its own room's
// bounds, so a chaser stops at the doorway. Cross-room pursuit needs
// navigation and is a separate spec.
import type { SwingVariant } from './attack';
import type { Vec3 } from './types';
import { wrapPi } from './wander';

export type BrainState =
  | 'idle' | 'pursue' | 'encircle' | 'engage' | 'attack' | 'recover' | 'stagger';

export interface Brain {
  state: BrainState;
  /** Has noticed the player and not yet forgotten him. */
  alert: boolean;
  /** Seconds the player has been out of this brain's room (0 while in it). */
  lostFor: number;
  /** Swing progress 0..1 while state === 'attack', else 0. */
  swingT: number;
  /** Seconds until another swing may start. */
  cooldown: number;
  /** Seconds of blast hold remaining. */
  holdSecs: number;
  /** The swing the NEXT attack throws. The arm alternates every swing so a
   *  stalled pack does not metronome; the variant is rolled at swing start. */
  swing: { side: 'L' | 'R'; variant: SwingVariant };
}

export interface BrainSelf { x: number; z: number; yaw: number; room: number }
export interface BrainPlayer { x: number; z: number; room: number }

export interface BrainInput {
  dt: number;
  self: BrainSelf;
  /** null when the player is somewhere with no room id (a tunnel, the void). */
  player: BrainPlayer | null;
  /** A shot was fired in this brain's room since the last step. */
  alerted: boolean;
  /** This body holds a melee token this frame (melee-ring.ts). */
  hasToken: boolean;
  /** Tangential shuffle direction while waiting (melee-ring.ts). */
  drift: -1 | 0 | 1;
  /** A blast-profile hit landed this frame. Outranks every other transition. */
  blasted: boolean;
  /** A fresh 0..1 value each frame from the actor's own RNG. Consumed ONLY on
   *  the frame a swing starts, to roll its variant. It lives in the input
   *  rather than as an injected generator so this module stays a pure
   *  function of its arguments — the same reason wander.ts takes an Rng. */
  roll: number;
}

export interface BrainOutput {
  brain: Brain;
  /** Wander-target override (world ground point); null = leave it alone. */
  target: Vec3 | null;
  /** True = locomotion off this frame (the actor's cfg.wander gate). */
  halt: boolean;
  /** The swing to compose, or null. */
  attack: { phase: number; side: 'L' | 'R'; variant: SwingVariant } | null;
  /** True while this body is IN the melee ring at all — attacking, closing,
   *  recovering or waiting — and so should be separated at the wider engaged
   *  radius. Waiters count: see the encircle branch. */
  engaged: boolean;
  /** True while the ring may NOT revoke this body's token. */
  committed: boolean;
}

export const BRAIN_TUNING = {
  /** Beyond this the player goes unnoticed (m). */
  noticeRange: 9,
  /** Half-angle of the notice cone (rad). */
  noticeCone: (70 * Math.PI) / 180,
  /** Alert survives this long after the player leaves the room (s). */
  loseGrace: 4,
  /** Where a token holder stands (m).
   *
   *  IT MUST CLEAR THE SEPARATION EQUILIBRIUM. game-main submits a body in
   *  the ring at ENGAGED_RADIUS (0.70) and the player as an immobile 0.32 m
   *  anchor, so separation parks an engaged body 1.02 m from him. At the
   *  original 1.0 m this radius sat INSIDE that equilibrium: the body was
   *  pushed to 1.02, `dist <= meleeRadius` never held, and it stood in
   *  `engage` forever without ever swinging (caught by a 12 s hand probe,
   *  2026-09-05 — zombie 10 pinned at 0.99 m in `engage` for ten seconds).
   *  1.25 clears 1.02 with real margin, and widens the 90-degree holder
   *  spacing from 1.41 m to 1.77 m as a bonus. */
  meleeRadius: 1.25,
  /** Where a waiter holds (m). */
  outerRadius: 1.8,
  /** pursue -> the ring states (m). */
  engageRange: 2.6,
  /** Back to pursue — hysteresis against engageRange (m). */
  releaseRange: 3.2,
  /** Tangential step applied to an encircling body's target (rad). */
  driftStep: 0.6,
  /** One swing, wind-up through recovery (s). */
  swingSec: 0.7,
  /** Gap before the next swing may start (s). */
  cooldownSec: 1.1,
  /** Blast hold — moved here from game-actor.ts's BLAST_HOLD_SEC (s). */
  blastHoldSec: 0.55,
} as const;

export type BrainTuning = typeof BRAIN_TUNING;

export function makeBrain(): Brain {
  return {
    state: 'idle', alert: false, lostFor: 0,
    swingT: 0, cooldown: 0, holdSecs: 0, swing: { side: 'R', variant: 'hook' },
  };
}

/** A point `radius` from the player, on `bearing`. */
function ringPoint(player: BrainPlayer, bearing: number, radius: number): Vec3 {
  return [player.x + Math.sin(bearing) * radius, 0, player.z + Math.cos(bearing) * radius];
}

export function stepBrain(
  brain: Brain,
  input: BrainInput,
  tuning: BrainTuning = BRAIN_TUNING,
): BrainOutput {
  const dt = Math.max(0, input.dt);
  const { self, player } = input;

  let { state, alert, lostFor, swingT, cooldown, holdSecs, swing } = brain;
  cooldown = Math.max(0, cooldown - dt);
  holdSecs = Math.max(0, holdSecs - dt);

  const sameRoom = player !== null && player.room === self.room;
  lostFor = sameRoom ? 0 : lostFor + dt;

  const dx = player ? player.x - self.x : 0;
  const dz = player ? player.z - self.z : 0;
  const dist = player ? Math.hypot(dx, dz) : Infinity;

  // --- notice, then lock ---------------------------------------------------
  if (!alert && sameRoom) {
    if (input.alerted) {
      alert = true;                              // a gunshot bypasses the cone
    } else if (dist <= tuning.noticeRange) {
      const bearing = Math.atan2(dx, dz);
      if (Math.abs(wrapPi(bearing - self.yaw)) <= tuning.noticeCone) alert = true;
    }
  }
  if (alert && lostFor > tuning.loseGrace) alert = false;

  const idle = (): BrainOutput => ({
    brain: { state: 'idle', alert, lostFor, swingT: 0, cooldown, holdSecs, swing },
    target: null, halt: false, attack: null, engaged: false, committed: false,
  });

  // --- stagger outranks everything ----------------------------------------
  // A blast-profile hit forces it from any state and DROPS the token: a
  // staggering body must not hold a melee slot it cannot use. The swing is
  // cancelled outright — the lurch is the bigger read.
  if (input.blasted) {
    return {
      brain: { state: 'stagger', alert, lostFor, swingT: 0, cooldown, holdSecs: tuning.blastHoldSec, swing },
      target: null, halt: true, attack: null, engaged: false, committed: false,
    };
  }
  if (state === 'stagger') {
    if (holdSecs > 0) {
      return {
        brain: { state, alert, lostFor, swingT: 0, cooldown, holdSecs, swing },
        target: null, halt: true, attack: null, engaged: false, committed: false,
      };
    }
    state = alert && player ? 'pursue' : 'idle';
  }

  if (!alert || !player) return idle();

  const bearing = Math.atan2(self.x - player.x, self.z - player.z);
  const playerPoint: Vec3 = [player.x, 0, player.z];

  // --- a committed swing runs to the end ----------------------------------
  if (state === 'attack') {
    swingT = tuning.swingSec > 0 ? Math.min(1, swingT + dt / tuning.swingSec) : 1;
    if (swingT < 1) {
      return {
        brain: { state, alert, lostFor, swingT, cooldown, holdSecs, swing },
        target: playerPoint, halt: true,
        attack: { phase: swingT, side: swing.side, variant: swing.variant },
        engaged: true, committed: true,
      };
    }
    swingT = 0;
    cooldown = tuning.cooldownSec;
    // Alternate the arm for the next swing; its variant is rolled when that
    // swing actually starts, not here.
    swing = { side: swing.side === 'R' ? 'L' : 'R', variant: swing.variant };
    state = 'recover';
  }

  // --- pursue <-> ring, with hysteresis ------------------------------------
  const inRing = state === 'encircle' || state === 'engage' || state === 'recover';
  if (inRing && dist > tuning.releaseRange) state = 'pursue';
  else if (!inRing && dist <= tuning.engageRange) state = input.hasToken ? 'engage' : 'encircle';
  else if (state === 'idle') state = 'pursue';   // just noticed, still outside ring range

  if (state === 'pursue') {
    return {
      brain: { state, alert, lostFor, swingT: 0, cooldown, holdSecs, swing },
      // The PLAYER, not a standoff point: stepWander's 0.4 m arrive band on a
      // target at meleeRadius parks the body outside meleeRadius, so it could
      // never engage (the predecessor's defect, found by the crowd gate).
      target: playerPoint, halt: false, attack: null,
      engaged: false, committed: false,
    };
  }

  // Inside the ring. The token decides which side of it this body is on.
  if (!input.hasToken) {
    return {
      brain: { state: 'encircle', alert, lostFor, swingT: 0, cooldown, holdSecs, swing },
      target: ringPoint(player, bearing + input.drift * tuning.driftStep, tuning.outerRadius),
      // ENGAGED, for separation purposes. Measured 2026-09-05: the ring
      // spaces token HOLDERS from each other, but nothing spaced the waiters,
      // so two encirclers converging on the same clear bearing settled at the
      // 0.35 m walking circle's 0.70 m and their arms overlapped — the
      // owner's original defect, moved from the attackers to the queue.
      // minHandGap went to -0.06 m in a 12 s probe with only ONE body at
      // melee radius, which is how it was found.
      halt: false, attack: null, engaged: true, committed: false,
    };
  }

  if (state === 'recover' && cooldown > 0) {
    return {
      brain: { state: 'recover', alert, lostFor, swingT: 0, cooldown, holdSecs, swing },
      target: playerPoint, halt: true, attack: null,
      engaged: true, committed: false,
    };
  }

  if (dist <= tuning.meleeRadius && cooldown <= 0) {
    // Roll the variant HERE, at the one frame the swing begins, and store it
    // so the rest of the swing reads a fixed value — the caller's roll keeps
    // changing every frame and must not re-decide mid-swing.
    const started = {
      side: swing.side,
      variant: (input.roll < 0.5 ? 'hook' : 'overhead') as SwingVariant,
    };
    return {
      brain: { state: 'attack', alert, lostFor, swingT: 0, cooldown, holdSecs, swing: started },
      target: playerPoint, halt: true,
      attack: { phase: 0, side: started.side, variant: started.variant },
      engaged: true, committed: true,
    };
  }

  return {
    brain: { state: 'engage', alert, lostFor, swingT: 0, cooldown, holdSecs, swing },
    target: playerPoint, halt: false, attack: null,
    engaged: true, committed: false,
  };
}
