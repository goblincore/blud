// src/lab/sdf-zombie/soldier-brain.ts
//
// One soldier's decision layer, as a named state machine. Pure — no clock, no
// RNG, no THREE — so every transition is unit-testable against hand-worked
// geometry. The sibling of brain.ts, which is the ZOMBIE's.
//
// WHY IT IS A SEPARATE FILE. The zombie's whole geometry is "collapse the
// distance": pursue, encircle, engage, swing. A rifleman's is the opposite —
// hold a distance, and back off when it closes. No state in that machine
// wants what this one wants. brain.ts is also pinned (brain.test.ts plus
// scripts/sdf-game-crowd-gate.mjs) and its own header records that it was
// rewritten specifically to escape mode-branching; adding a ranged mode
// walks that back. The cost is ~30 duplicated lines of perception and
// stagger preamble, which is the price of learning what is ACTUALLY common
// from two real brains rather than guessing from one. Extract a shared
// perception.ts when a third enemy arrives, from evidence.
//
// IT DOES NOT DRIVE LOCOMOTION. Same rule as brain.ts: there is exactly one
// walker (wander.ts, through motion.ts). The machine emits a TARGET, a HALT
// flag and a FACE HEADING; the actor writes them into the wander.
//
// HEADING CONVENTION (wander.ts): yaw 0 faces +z, positive is clockwise seen
// from above. The bearing to a point is atan2(dx, dz).
//
// ROOM-BOUND, DELIBERATELY, exactly as brain.ts is. stepWander clamps every
// body to its own room's bounds — which is also why CORNERING IS EMERGENT:
// a soldier backed into a wall simply stops retreating and keeps firing from
// where he stands. No bounds query in here, and no cornered state.
import type { Vec3 } from './types';
import { wrapPi } from './wander';

export type SoldierState =
  | 'idle' | 'advance' | 'retreat' | 'standoff'
  | 'aim' | 'fire' | 'recover' | 'stagger';

export interface SoldierBrain {
  state: SoldierState;
  /** Has noticed the player and not yet forgotten him. */
  alert: boolean;
  /** Seconds the player has been out of this brain's room (0 while in it). */
  lostFor: number;
  /** Seconds elapsed in the current aim or recover phase. */
  phaseT: number;
  /** Seconds until another firing opportunity may be rolled. */
  cooldown: number;
  /** Seconds of blast hold remaining. */
  holdSecs: number;
  /** Tangential strafe sign, re-rolled on each decision tick. */
  drift: -1 | 1;
  /** Seconds until the next decision tick. */
  driftT: number;
}

export interface SoldierSelf { x: number; z: number; yaw: number; room: number }
export interface SoldierPlayer { x: number; z: number; room: number }

export interface SoldierInput {
  dt: number;
  self: SoldierSelf;
  /** null when the player is somewhere with no room id (a tunnel, the void). */
  player: SoldierPlayer | null;
  /** A shot was fired in this brain's room since the last step. */
  alerted: boolean;
  /** A fresh 0..1 value each frame. Consumed ONLY on a decision tick, to roll
   *  whether to take a firing opportunity. It lives in the input rather than
   *  as an injected generator so this module stays a pure function of its
   *  arguments — the same reason wander.ts takes an Rng. */
  roll: number;
  /** A SECOND, independent 0..1 value, for the strafe sign. It must not be
   *  the same number as `roll`: one value serving both decisions correlates
   *  them, so "fires" and "strafes left" would become the same event. */
  rollDrift: number;
}

export interface SoldierOutput {
  brain: SoldierBrain;
  /** Wander-target override (world ground point); null = leave it alone. */
  target: Vec3 | null;
  /** True = locomotion off this frame (the actor's cfg.wander gate). */
  halt: boolean;
  /** True on EXACTLY the frame the shot goes off. */
  fire: boolean;
  /** Bearing to hold while halted, written into wander.heading by the actor;
   *  null = leave the heading alone. A halted body cannot otherwise turn:
   *  stepWander owns wander.heading and is skipped when cfg.wander is false,
   *  so without this he would aim at wherever he last happened to face. */
  faceHeading: number | null;
  /** 0..1 telegraph progress while aiming, else 0. Drives no geometry in this
   *  phase — it is the debug HUD's read and the seam a visible tell hangs off
   *  in phase 3. In the output rather than reconstructed by a consumer from a
   *  timer it does not own. */
  aimT: number;
}

export const SOLDIER_TUNING = {
  /** Beyond this the player goes unnoticed (m). The zombie's value; the band
   *  sits well inside it, so he notices before he has to decide anything. */
  noticeRange: 9,
  /** Half-angle of the notice cone (rad). The zombie's value. */
  noticeCone: (70 * Math.PI) / 180,
  /** Alert survives this long after the player leaves the room (s). */
  loseGrace: 4,
  /** Closer than this, back off (m). */
  standoffNear: 3.5,
  /** Farther than this, close in (m). */
  standoffFar: 6.0,
  /** Band hysteresis (m). THE EXIT THRESHOLD SITS INSIDE THE BAND: he starts
   *  advancing at dist > standoffFar but does not stop until
   *  dist <= standoffFar - this. An exit threshold OUTSIDE the band would
   *  make advance and retreat overlap and oscillate, which is the opposite
   *  of the intent. At these values he settles in roughly 4.1–5.4 m. */
  bandHysteresis: 0.6,
  /** The telegraph (s). Doom's shotgun guy has a distinct pre-fire frame and
   *  it is the only reason a sergeant is dodgeable; this is that frame. If
   *  the playtest says the soldier is unreadable, this is the first knob. */
  aimSec: 0.5,
  /** Recoil hold after the shot (s). Sits under FIRE.holdSec (0.85) so the
   *  carry is still in the fire pose when he resumes. */
  recoverSec: 0.4,
  /** Floor between shots (s). */
  minCooldownSec: 1.0,
  /** Chance to take an ELIGIBLE firing opportunity, rolled on a decision
   *  tick. Doom monsters roll for the attack rather than running a timer; a
   *  fixed cooldown metronomes, and metronoming is the fastest way to make an
   *  enemy read as a machine. */
  refireRoll: 0.5,
  /** The decision tick (s) — see the comment on the tick itself. */
  repositionSec: 1.5,
  /** Tangential offset applied to the strafe target (rad). */
  strafeStep: 0.5,
  /** Blast hold, matching the zombie's, so a shot soldier lurches for as long
   *  as a shot zombie does (s). */
  blastHoldSec: 0.55,
} as const;

export type SoldierTuning = typeof SOLDIER_TUNING;

export function makeSoldierBrain(): SoldierBrain {
  return {
    state: 'idle', alert: false, lostFor: 0,
    phaseT: 0, cooldown: 0, holdSecs: 0,
    drift: 1, driftT: SOLDIER_TUNING.repositionSec,
  };
}

/**
 * Force the stagger state NOW — called by the wiring the instant a
 * blast-profile hit lands, before any step.
 *
 * IT IS SYNCHRONOUS ON PURPOSE, for the reason brain.ts's staggerNow records:
 * a flag consumed by the NEXT step delays the lurch by one frame, and while
 * sixteen milliseconds is imperceptible on its own, it shifts the whole
 * recovery downstream far enough to change what a displacement measurement a
 * second later reports. A body lurches on the frame it is shot.
 *
 * Cancels any in-flight aim: a staggering soldier must not complete a
 * telegraph he was knocked out of, and must leave no stranded fire pulse
 * behind (the cycle emits its pulse on the aim->fire transition, so clearing
 * phaseT and the state together is what guarantees it).
 *
 * A SEPARATE FUNCTION from brain.ts's staggerNow because that one is typed to
 * Brain. This is part of the duplication the file header accounts for.
 */
export function staggerSoldierNow(
  brain: SoldierBrain,
  tuning: SoldierTuning = SOLDIER_TUNING,
): SoldierBrain {
  return { ...brain, state: 'stagger', phaseT: 0, holdSecs: tuning.blastHoldSec };
}

/** A point `radius` from the player, on `bearing`. */
function ringPoint(player: SoldierPlayer, bearing: number, radius: number): Vec3 {
  return [player.x + Math.sin(bearing) * radius, 0, player.z + Math.cos(bearing) * radius];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function stepSoldierBrain(
  brain: SoldierBrain,
  input: SoldierInput,
  tuning: SoldierTuning = SOLDIER_TUNING,
): SoldierOutput {
  const dt = Math.max(0, input.dt);
  const { self, player } = input;

  let { state, alert, lostFor, phaseT, cooldown, holdSecs, drift, driftT } = brain;
  cooldown = Math.max(0, cooldown - dt);
  holdSecs = Math.max(0, holdSecs - dt);

  const sameRoom = player !== null && player.room === self.room;
  lostFor = sameRoom ? 0 : lostFor + dt;

  const dx = player ? player.x - self.x : 0;
  const dz = player ? player.z - self.z : 0;
  const dist = player ? Math.hypot(dx, dz) : Infinity;

  // --- notice, then lock (brain.ts's rule verbatim) ------------------------
  if (!alert && sameRoom) {
    if (input.alerted) {
      alert = true;                              // a gunshot bypasses the cone
    } else if (dist <= tuning.noticeRange) {
      const bearing = Math.atan2(dx, dz);
      if (Math.abs(wrapPi(bearing - self.yaw)) <= tuning.noticeCone) alert = true;
    }
  }
  if (alert && lostFor > tuning.loseGrace) alert = false;

  const pack = (over: Partial<SoldierOutput> = {}): SoldierOutput => ({
    brain: { state, alert, lostFor, phaseT, cooldown, holdSecs, drift, driftT },
    target: null, halt: false, fire: false, faceHeading: null, aimT: 0,
    ...over,
  });

  const idle = (): SoldierOutput => {
    state = 'idle'; phaseT = 0;
    return pack();
  };

  // --- stagger outranks everything ----------------------------------------
  // Entered by staggerSoldierNow() AT THE MOMENT OF THE HIT, not by a flag
  // consumed on the next step: a body lurches on the frame it is shot. See
  // brain.ts's staggerNow for what a one-step deferral actually cost.
  if (state === 'stagger') {
    if (holdSecs > 0) return pack({ halt: true });
    state = alert && player ? 'advance' : 'idle';
    phaseT = 0;
  }

  if (!alert || !player) return idle();

  /** Where he must LOOK: from himself toward the player. */
  const faceBearing = Math.atan2(dx, dz);
  /** Where he STANDS relative to the player: from the player toward himself.
   *  The retreat and strafe points are placed on this bearing, so he backs
   *  straight away from the player and strafes around him. */
  const standBearing = Math.atan2(self.x - player.x, self.z - player.z);
  const playerPoint: Vec3 = [player.x, 0, player.z];

  // --- the committed firing cycle -----------------------------------------
  // Once aim starts the cycle runs to the end even if the player leaves the
  // band. This is the direct analogue of brain.ts's "a committed swing runs
  // to the end", and it is what makes the telegraph readable: without it,
  // strafing at the band edge makes him flicker in and out of aiming and
  // never commit. All three states halt and hold the face lock.
  if (state === 'aim') {
    phaseT += dt;
    if (phaseT < tuning.aimSec) {
      return pack({
        halt: true, faceHeading: faceBearing,
        aimT: tuning.aimSec > 0 ? phaseT / tuning.aimSec : 1,
      });
    }
    // The telegraph is done: THIS frame is the shot.
    state = 'fire'; phaseT = 0;
    return pack({ halt: true, faceHeading: faceBearing, fire: true, aimT: 1 });
  }

  if (state === 'fire') {
    // 'fire' occupies exactly one frame, and its fire pulse was emitted on
    // the frame it was entered (above). Falling straight through to recover
    // here is what guarantees ONE pulse per cycle.
    state = 'recover'; phaseT = 0;
    cooldown = tuning.minCooldownSec;
  }

  if (state === 'recover') {
    phaseT += dt;
    if (phaseT < tuning.recoverSec) {
      return pack({ halt: true, faceHeading: faceBearing });
    }
    state = 'standoff'; phaseT = 0;
  }

  // --- the band, hysteresis running INWARD --------------------------------
  // See bandHysteresis's comment for why the exit threshold is inside.
  if (state === 'advance') {
    if (dist <= tuning.standoffFar - tuning.bandHysteresis) state = 'standoff';
  } else if (state === 'retreat') {
    if (dist >= tuning.standoffNear + tuning.bandHysteresis) state = 'standoff';
  } else if (dist > tuning.standoffFar) {
    state = 'advance';
  } else if (dist < tuning.standoffNear) {
    state = 'retreat';
  } else if (state === 'idle') {
    state = 'standoff';
  }

  if (state === 'advance') {
    // The PLAYER, not a standoff point: stepWander's arrive band on a target
    // at the band edge would park him outside it. brain.ts's pursue makes the
    // same choice for the same reason (its predecessor's defect, found by the
    // crowd gate).
    return pack({ target: playerPoint });
  }

  if (state === 'retreat') {
    return pack({ target: ringPoint(player, standBearing, tuning.standoffFar) });
  }

  // --- standoff: the decision tick ----------------------------------------
  // ROLLING EVERY FRAME WOULD DEFEAT THE POINT. At 60 Hz a refireRoll of 0.5
  // fires on the first eligible frame every single time, which is a fixed
  // cooldown wearing a costume. Doom rolls when a monster FINISHES A MOVE,
  // not every tic, and that cadence is the whole source of the irregular
  // rhythm. So both rolls are consumed here and nowhere else.
  driftT -= dt;
  if (driftT <= 0) {
    driftT = tuning.repositionSec;
    drift = input.rollDrift < 0.5 ? -1 : 1;
    if (cooldown <= 0 && input.roll < tuning.refireRoll) {
      state = 'aim'; phaseT = 0;
      return pack({ halt: true, faceHeading: faceBearing, aimT: 0 });
    }
  }

  return pack({
    target: ringPoint(
      player,
      standBearing + drift * tuning.strafeStep,
      clamp(dist, tuning.standoffNear, tuning.standoffFar),
    ),
  });
}
