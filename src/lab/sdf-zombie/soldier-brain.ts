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
// Room-bound tactical moves use injected bounds and swept clearance. If no
// candidate is reachable, hold position and keep looking for a firing chance.
import type { Vec3 } from './types';
import { wrapPi, type WanderBounds } from './wander';

export type SoldierState =
  | 'idle' | 'engage' | 'aim' | 'fire' | 'recover' | 'settle' | 'stagger';

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
  /** Shots fired SO FAR in the current burst — a running count, not a
   *  remaining-count. It has to count UP: a decrementing "follow-ups owed"
   *  counter is re-armed by the next shot before the cap is ever tested, so
   *  the burst runs forever (caught by the settle test, which never saw the
   *  state). Reset to 0 when the burst ends. */
  burstShots: number;
  /** True when the shot that just landed earned a follow-up. */
  burstLeft: number;
  /** Seconds of held, facing, weapon-up beat after the last shot of a burst,
   *  before he is allowed to move again. Without it `recover` ends and he is
   *  already strafing on the next frame, which is what made the shot read as
   *  "muzzle flash, then straight back to wandering". */
  settleT: number;
  /** Fixed endpoint and timeout for one short tactical move. */
  moveGoal: Vec3 | null;
  moveT: number;
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
  lineOfSight?: boolean;
  bounds?: WanderBounds;
  /** Actor-owned swept-body clearance query; deterministic for this scene. */
  canMoveTo?: (point: Vec3) => boolean;
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
  /** Weapon UP — raise the gun into the fire carry. True through the whole
   *  aim -> fire -> recover -> settle beat, not just on the shot frame.
   *
   *  WITHOUT IT THERE IS NO TELEGRAPH AT ALL. The carry only swapped to the
   *  fire pose on the frame MotionSignals.fire went high, so the owner saw a
   *  muzzle flash out of a walking body and nothing before it: "he doesn't
   *  really aim at me or raise the weapon, i just see the muzzle flash". A
   *  wind-up you cannot see is not a wind-up. */
  weaponUp: boolean;
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
  aimTolerance: 0.12,
  moveSec: 1.4,
  moveDistance: 1.1,
  arriveRadius: 0.3,
  /** Half-angle of the notice cone (rad). The zombie's value. */
  noticeCone: (70 * Math.PI) / 180,
  /** Alert survives this long after the player leaves the room (s). */
  loseGrace: 4,
  /** He will shoot from anywhere inside this (m).
   *
   *  DECOUPLED FROM MOVEMENT, deliberately, and this is the whole point of the
   *  2026-09-06 rewrite. The first design gated firing on being in a
   *  `standoff` STATE, reached only after the advance/retreat branches fell
   *  through — and the decision tick that rolls for a shot lived inside that
   *  same branch, so the tick only advanced while he was already settled. To
   *  fire he had to hold standoff for up to repositionSec AND win the roll,
   *  which against a player who moves at all essentially never happened. He
   *  chased his own band and never attacked. Owner: "he still doesn't seem to
   *  settle and attack."
   *
   *  Now range and movement are independent: if you are inside this, he can
   *  shoot, wherever his feet happen to be. */
  fireRange: 6.0,
  /** Where he would RATHER stand (m). A preference his movement drifts
   *  toward, not a gate on anything. */
  preferredRange: 3.0,
  /** Inside this he backs off while shooting (m). Just outside the zombie's
   *  meleeRadius (1.25) — he gives ground rather than being shoved. */
  tooClose: 2.0,
  /** Slack around preferredRange before he bothers closing (m). Stops a
   *  half-metre drift from starting a walk. */
  rangeSlack: 1.0,
  /** Chance of a follow-up shot when one lands (rolled per shot, so a burst
   *  is usually 1-2 and occasionally 3). Doom's sergeant is not a metronome
   *  of single taps. */
  burstChance: 0.45,
  /** Hard cap on follow-ups, so a burst is at most burstMax+1 shots.
   *
   *  WITHOUT IT THE BURST NEVER ENDS. The follow-up is rolled per shot, so a
   *  caller whose roll keeps winning re-arms it forever and he never reaches
   *  the settle beat -- he just fires until the player leaves range. Caught by
   *  the settle test, which never saw the state at all. */
  burstMax: 2,
  /** Held, facing, weapon-up beat after the LAST shot of a burst, before he
   *  may move again (s). The pause is the read: without it he flashes and is
   *  instantly strafing, which looks like a twitch rather than an attack. */
  settleSec: 0.45,
  /** The telegraph (s). Doom's shotgun guy has a distinct pre-fire frame and
   *  it is the only reason a sergeant is dodgeable; this is that frame. If
   *  the playtest says the soldier is unreadable, this is the first knob. */
  aimSec: 0.7,
  /** Recoil hold after the shot (s). Sits under FIRE.holdSec (0.85) so the
   *  carry is still in the fire pose when he resumes. */
  recoverSec: 0.35,
  /** Floor between shots (s). */
  minCooldownSec: 1.0,
  /** Chance to take an ELIGIBLE firing opportunity, rolled on a decision
   *  tick. Doom monsters roll for the attack rather than running a timer; a
   *  fixed cooldown metronomes, and metronoming is the fastest way to make an
   *  enemy read as a machine. */
  refireRoll: 0.5,
  /** The decision tick (s) — see the comment on the tick itself. */
  repositionSec: 1.5,
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
    burstShots: 0, burstLeft: 0, settleT: 0, moveGoal: null, moveT: 0,
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
  return { ...brain, state: 'stagger', phaseT: 0, holdSecs: tuning.blastHoldSec, moveGoal: null, moveT: 0, burstLeft: 0, burstShots: 0 };
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

  let { state, alert, lostFor, phaseT, cooldown, holdSecs, drift, driftT,
    burstShots, burstLeft, settleT, moveGoal, moveT } = brain;
  cooldown = Math.max(0, cooldown - dt);
  holdSecs = Math.max(0, holdSecs - dt);

  const sameRoom = player !== null && player.room === self.room;
  lostFor = sameRoom ? 0 : lostFor + dt;

  const dx = player ? player.x - self.x : 0;
  const dz = player ? player.z - self.z : 0;
  const dist = player ? Math.hypot(dx, dz) : Infinity;

  // --- notice, then lock (brain.ts's rule verbatim) ------------------------
  const visible = sameRoom && input.lineOfSight !== false;
  if (!alert && sameRoom) {
    if (input.alerted) {
      alert = true;                              // a gunshot bypasses the cone
    } else if (visible && dist <= tuning.noticeRange) {
      const bearing = Math.atan2(dx, dz);
      if (Math.abs(wrapPi(bearing - self.yaw)) <= tuning.noticeCone) alert = true;
    }
  }
  if (alert && lostFor > tuning.loseGrace) alert = false;

  const pack = (over: Partial<SoldierOutput> = {}): SoldierOutput => ({
    brain: { state, alert, lostFor, phaseT, cooldown, holdSecs, drift, driftT,
      burstShots, burstLeft, settleT, moveGoal, moveT },
    target: null, halt: false, fire: false, faceHeading: null,
    weaponUp: false, aimT: 0,
    ...over,
  });

  const idle = (): SoldierOutput => {
    state = 'idle'; phaseT = 0; moveGoal = null; moveT = 0;
    burstLeft = 0; burstShots = 0;
    return pack({ halt: alert });
  };

  // --- stagger outranks everything ----------------------------------------
  // Entered by staggerSoldierNow() AT THE MOMENT OF THE HIT, not by a flag
  // consumed on the next step: a body lurches on the frame it is shot. See
  // brain.ts's staggerNow for what a one-step deferral actually cost.
  if (state === 'stagger') {
    if (holdSecs > 0) return pack({ halt: true });
    state = alert && player ? 'engage' : 'idle';
    phaseT = 0;
  }

  if (!alert || !player || !sameRoom) return idle();

  /** Where he must LOOK: from himself toward the player. */
  const faceBearing = Math.atan2(dx, dz);
  // Hold the telegraph through small range changes, but cancel when sight
  // breaks or the player leaves effective weapon range. Facing must settle
  // before release; a completed timer alone cannot authorize the shot.
  if (state === 'aim' && (!visible || dist > tuning.fireRange + tuning.rangeSlack)) {
    state = 'engage'; phaseT = 0; burstLeft = 0; burstShots = 0;
    driftT = Math.min(driftT, 0.35);
  }
  if (state === 'aim') {
    phaseT = Math.min(tuning.aimSec, phaseT + dt);
    if (phaseT < tuning.aimSec || Math.abs(wrapPi(faceBearing - self.yaw)) > tuning.aimTolerance) {
      return pack({
        halt: true, faceHeading: faceBearing, weaponUp: true,
        aimT: tuning.aimSec > 0 ? phaseT / tuning.aimSec : 1,
      });
    }
    // The telegraph is done: THIS frame is the shot.
    state = 'fire'; phaseT = 0;
    // Roll the follow-up HERE, as the shot lands, so a burst is decided by the
    // same event that fired it rather than by the next decision tick.
    burstShots += 1;
    burstLeft = (burstShots <= tuning.burstMax && input.roll < tuning.burstChance) ? 1 : 0;
    return pack({
      halt: true, faceHeading: faceBearing, weaponUp: true, fire: true, aimT: 1,
    });
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
      return pack({ halt: true, faceHeading: faceBearing, weaponUp: true });
    }
    phaseT = 0;
    // A follow-up shot skips the decision tick entirely: the burst is one
    // action, not two independent opportunities.
    if (burstLeft > 0 && visible && dist <= tuning.fireRange) {
      burstLeft = 0;
      state = 'aim';
      return pack({ halt: true, faceHeading: faceBearing, weaponUp: true, aimT: 0 });
    }
    // Burst over: hold the beat before moving. Still halted, still facing,
    // still weapon-up.
    burstLeft = 0;
    burstShots = 0;
    settleT = tuning.settleSec;
    state = 'settle';
  }

  // The beat after the last shot. Its OWN state, not a reused `recover`:
  // reusing recover would re-enter that block on the next frame and loop the
  // recoil forever.
  if (state === 'settle') {
    settleT = Math.max(0, settleT - dt);
    if (settleT > 0) {
      return pack({ halt: true, faceHeading: faceBearing, weaponUp: true });
    }
    state = 'engage'; moveGoal = null; moveT = 0;
    driftT = Math.max(driftT, 0.65);
  }

  // --- the decision tick -------------------------------------------------
  // IT ALWAYS ADVANCES. In the first design this lived inside the standoff
  // branch, below the advance/retreat early returns, so it only ticked while
  // he was already settled — and a settled soldier is exactly the state a
  // moving player denies him. Firing became unreachable. Now the tick is
  // unconditional and the shot is gated on RANGE, not on a movement state.
  //
  // Rolling every frame would still be wrong: at 60 Hz a refireRoll of 0.5
  // fires on the first eligible frame every time, which is a fixed cooldown
  // wearing a costume. Doom rolls when a monster FINISHES A MOVE, and that
  // cadence is the whole source of the irregular rhythm.
  driftT -= dt;
  const decision = driftT <= 0;
  if (decision) {
    driftT = tuning.repositionSec;
    drift = input.rollDrift < 0.5 ? -1 : 1;
    if (visible && dist <= tuning.fireRange && cooldown <= 0 && input.roll < tuning.refireRoll) {
      state = 'aim'; phaseT = 0; moveGoal = null; moveT = 0;
      return pack({ halt: true, faceHeading: faceBearing, weaponUp: true, aimT: 0 });
    }
  }

  state = 'engage';
  // Arrival, collision, and a time limit all end a move. The endpoint never
  // follows the actor around an orbit, and a blocked move cannot run forever.
  if (moveGoal) {
    moveT -= dt;
    if (moveT <= 0 || Math.hypot(moveGoal[0] - self.x, moveGoal[2] - self.z) < tuning.arriveRadius
      || (input.canMoveTo && !input.canMoveTo(moveGoal))) {
      moveGoal = null; moveT = 0;
      driftT = Math.max(driftT, 0.65);
      return pack({ halt: true, faceHeading: faceBearing });
    }
    return pack({ target: moveGoal, faceHeading: faceBearing });
  }

  const crowded = dist < tuning.tooClose;
  const far = dist > tuning.preferredRange + tuning.rangeSlack;
  // Comfortable soldiers can hold a good firing position. A move is a
  // decision, not the default every frame between shots.
  if (!decision && !crowded && !far) return pack({ halt: true, faceHeading: faceBearing });

  const candidate = (side: number): Vec3 => {
    const radial = crowded ? -1 : far ? 1 : 0;
    const ux = dx / (dist || 1), uz = dz / (dist || 1);
    const distance = radial ? Math.min(tuning.moveDistance, Math.abs(dist - tuning.preferredRange)) : tuning.moveDistance;
    let x = self.x + (radial * ux + side * uz) * distance;
    let z = self.z + (radial * uz - side * ux) * distance;
    if (input.bounds) {
      x = clamp(x, input.bounds.minX + 0.1, input.bounds.maxX - 0.1);
      z = clamp(z, input.bounds.minZ + 0.1, input.bounds.maxZ - 0.1);
    }
    return [x, 0, z];
  };
  // Try the preferred radial move, then either sidestep around the blocker.
  // Swept clearance rejects walls/crates before any walking starts.
  const sides = crowded || far ? [0, drift, -drift] : [drift, -drift];
  for (const side of sides) {
    const point = candidate(side);
    if (Math.hypot(point[0] - self.x, point[2] - self.z) < tuning.arriveRadius + 0.05) continue;
    if (input.canMoveTo && !input.canMoveTo(point)) continue;
    moveGoal = point; moveT = tuning.moveSec;
    return pack({ target: moveGoal, faceHeading: faceBearing });
  }
  return pack({ halt: true, faceHeading: faceBearing });
}
