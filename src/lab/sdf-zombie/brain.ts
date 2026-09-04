// src/lab/sdf-zombie/brain.ts
//
// One zombie's decision layer: wander until it notices the player, then walk
// at him and swing when it gets there. Pure — no clock, no RNG, no THREE —
// so the whole behaviour is unit-testable against hand-worked geometry.
//
// IT DOES NOT DRIVE LOCOMOTION. There is exactly one walker in this codebase
// (wander.ts, through motion.ts) and adding a second would mean two sets of
// turn rates, accelerations and gait blends drifting apart. Instead the brain
// emits a STANDOFF TARGET — a point `attackRange` from the player, on the
// zombie's side — and the actor writes it into wander.target. A chasing
// zombie is the same shamble, aimed.
//
// HEADING CONVENTION (wander.ts): yaw 0 faces +z, positive is clockwise seen
// from above. The bearing to a point is therefore atan2(dx, dz).
//
// ROOM-BOUND, DELIBERATELY. stepWander clamps every body to its own room's
// bounds, so a chaser stops at the doorway and will not follow through a
// tunnel. Lifting that clamp without navigation walks bodies into walls; see
// the spec's "Accepted limitation".
import type { Vec3 } from './types';
import { wrapPi } from './wander';

export type BrainMode = 'wander' | 'chase' | 'attack';

export interface BrainState {
  mode: BrainMode;
  /** Seconds the player has been out of this brain's room (0 while in it). */
  lostFor: number;
  /** Has noticed the player and not yet forgotten him. */
  alert: boolean;
  /** Melee hysteresis latch: set at attackRange, cleared past releaseRange.
   *  Without it a body hovering at exactly attackRange flickers between
   *  walking and halting every frame. */
  engaged: boolean;
  /** Swing progress 0..1 while mode === 'attack', else 0. */
  swingT: number;
  /** Seconds until another swing may start. */
  cooldown: number;
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
}

export interface BrainOutput {
  state: BrainState;
  /** Wander-target override (world ground point); null = leave the wander alone. */
  target: Vec3 | null;
  /** True = locomotion off this frame (the actor's cfg.wander gate). */
  halt: boolean;
  /** Swing phase 0..1, or null when not swinging. */
  attack: number | null;
}

export const BRAIN_TUNING = {
  /** Beyond this the player goes unnoticed (m). */
  noticeRange: 9,
  /** Half-angle of the notice cone (rad) — the player must be roughly ahead. */
  noticeCone: (70 * Math.PI) / 180,
  /** Alert survives this long after the player leaves the room (s). */
  loseGrace: 4,
  /** Halt-and-swing distance (m). */
  attackRange: 1.0,
  /** Walk again past this distance — hysteresis against attackRange (m). */
  releaseRange: 1.6,
  /** One swing, wind-up through recovery (s). */
  swingSec: 0.7,
  /** Gap before the next swing may start (s). */
  cooldownSec: 1.1,
} as const;

export type BrainTuning = typeof BRAIN_TUNING;

export function makeBrainState(): BrainState {
  return { mode: 'wander', lostFor: 0, alert: false, engaged: false, swingT: 0, cooldown: 0 };
}

/** The point `range` metres from the player along the player→zombie
 *  direction. Standing exactly on the player is degenerate: back off along
 *  the zombie's own facing instead of dividing by zero. */
function standoffPoint(self: BrainSelf, player: BrainPlayer, range: number): Vec3 {
  const dx = self.x - player.x;
  const dz = self.z - player.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) {
    return [player.x + Math.sin(self.yaw) * range, 0, player.z + Math.cos(self.yaw) * range];
  }
  return [player.x + (dx / d) * range, 0, player.z + (dz / d) * range];
}

export function stepBrain(
  state: BrainState,
  input: BrainInput,
  tuning: BrainTuning = BRAIN_TUNING,
): BrainOutput {
  const dt = Math.max(0, input.dt);
  const { self, player } = input;

  let { mode, lostFor, alert, engaged, swingT, cooldown } = state;
  cooldown = Math.max(0, cooldown - dt);

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
  if (alert && lostFor > tuning.loseGrace) {
    alert = false;
    engaged = false;
  }

  // --- the melee latch -----------------------------------------------------
  // Runs even mid-swing: a player who retreats past releaseRange unlatches
  // the body now, not only once the swing animation has played out.
  if (dist <= tuning.attackRange) engaged = true;
  else if (dist > tuning.releaseRange) engaged = false;

  // --- a swing already in flight ALWAYS finishes ---------------------------
  // An attack that can be cancelled mid-frame reads weightless — the same
  // reasoning behind game-actor's BLAST_HOLD_SEC.
  if (mode === 'attack') {
    swingT = tuning.swingSec > 0 ? Math.min(1, swingT + dt / tuning.swingSec) : 1;
    if (swingT >= 1) {
      swingT = 0;
      cooldown = tuning.cooldownSec;
      mode = alert ? 'chase' : 'wander';
    } else {
      return {
        state: { mode, lostFor, alert, engaged, swingT, cooldown },
        target: alert && player ? standoffPoint(self, player, tuning.attackRange) : null,
        halt: true,
        attack: swingT,
      };
    }
  }

  // --- calm ----------------------------------------------------------------
  if (!alert || !player) {
    return {
      state: { mode: 'wander', lostFor, alert, engaged: false, swingT: 0, cooldown },
      target: null,
      halt: false,
      attack: null,
    };
  }

  const target = standoffPoint(self, player, tuning.attackRange);

  if (engaged && cooldown <= 0) {
    return {
      state: { mode: 'attack', lostFor, alert, engaged, swingT: 0, cooldown },
      target,
      halt: true,
      attack: 0,
    };
  }
  return {
    state: { mode: 'chase', lostFor, alert, engaged, swingT: 0, cooldown },
    target,
    // Engaged but cooling down: stand at range rather than shuffling into him.
    halt: engaged,
    attack: null,
  };
}
