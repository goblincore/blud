// src/lab/sdf-zombie/charge.ts
//
// The warbull's BULL CHARGE as plain data (spec 2026-09-27-warbull-design.md,
// "Melee"). Pure: no three, no brain imports, no clock of its own. The
// warbull mind (webgpu/enemy-mind.ts makeWarbullMind) layers it over the
// soldier brain: while a charge runs it owns the body, otherwise the brain
// shoots (armed) or brawls (disarmed).
//
//   windup   he stops, squares up to the player and lowers his head: the
//            TELEGRAPH, the only warning, long enough to see and step aside.
//            The line is locked at the END of the windup, not the start, so
//            he aims at where you were when he committed.
//   charge   a straight run along that line, fast (CHARGE.speed, ~3.8x his
//            walk) and uncorrectable. It ends when it has carried him past
//            where you stood, when it times out, or when the path ahead is
//            blocked, which is:
//   stunned  he hit a wall: dazed, halted, open. The PUNISH WINDOW, and the
//            reason the charge is a fair attack: dodge it near a wall and he
//            gives you two seconds.
//   recover  a short beat after a charge that did not hit a wall.
//
// One hit per charge: `contact` goes true on the frame he first reaches the
// player, and never again until the next charge (no double-tap trample).
//
// When he may charge: disarmed (enraged), whenever the player is in the band
// and the cooldown is up; armed, only when the player has closed inside
// armedMaxDist (too close to rocket without catching the blast himself), and
// never mid-volley.

export const CHARGE = {
  /** Range band he charges from, m. Under minDist he brawls instead. */
  minDist: 2.2,
  maxDist: 9,
  /** Armed, he only charges a player this close (rockets at range). */
  armedMaxDist: 4.5,
  /** The telegraph, s. Enraged, it is shorter: the rage makes him readier. */
  windupSec: 0.85,
  enragedWindupSec: 0.6,
  /** Run speed, m/s: fast, but a sidestep at the lock clears his line. */
  speed: 3.2,
  /** Longest run, s, and how far past the player's locked spot he carries. */
  maxSec: 1.8,
  overshoot: 2.0,
  /** He reaches the player at this centre distance, m (his reach + yours). */
  hitRadius: 1.4,
  /** Probe distance ahead for a wall, m: his half-depth and a stride. */
  wallProbe: 0.9,
  stunSec: 2.0,
  recoverSec: 0.7,
  /** Between charges, s, and the chance per frame of taking an eligible one
   *  once it is up (a roll, not a timer: a charge on the dot reads as a
   *  metronome). */
  cooldownSec: 5.0,
  enragedCooldownSec: 2.2,
  chancePerSec: 1.2,
} as const;

export type ChargePhase = 'none' | 'windup' | 'charge' | 'stunned' | 'recover';

export interface ChargeState {
  phase: ChargePhase;
  /** Seconds in the current phase. */
  t: number;
  /** Locked run direction (unit XZ). */
  dir: readonly [number, number];
  /** Seconds until another charge may start. */
  cooldown: number;
  /** Metres run in this charge, and the player's distance at the lock. */
  travelled: number;
  lockDist: number;
  /** This charge already landed its one hit. */
  hit: boolean;
}

export const CHARGE_REST: ChargeState = { phase: 'none', t: 0, dir: [0, 1], cooldown: 0, travelled: 0, lockDist: 0, hit: false };

export interface ChargeInput {
  dt: number;
  self: { x: number; z: number };
  /** null = no player in his room. */
  player: { x: number; z: number } | null;
  /** He can see the player (and is alert to him). */
  visible: boolean;
  /** Launcher gone: charges from the whole band, shorter windup and cooldown. */
  enraged: boolean;
  /** The brain is mid-volley (aim/fire/recover/settle): never interrupt it. */
  busy: boolean;
  /** Fresh 0..1 each frame. */
  roll: number;
  /** Can his body stand at this XZ point (walls, furniture, room bounds)? */
  canStand(x: number, z: number): boolean;
}

export interface ChargeOutput {
  state: ChargeState;
  /** True while the charge owns the body (any phase but 'none'). */
  active: boolean;
  /** Locomotion off (windup, stunned, recover). */
  halt: boolean;
  /** Bearing to hold while halted (windup: at the player), else null. */
  faceHeading: number | null;
  /** Where the run is going (the charge phase), else null. */
  target: [number, number, number] | null;
  /** Root speed this frame, m/s (the charge phase), else 0. */
  speed: number;
  /** He reached the player on this frame. */
  contact: boolean;
  /** 0..1 progress of the current phase, for animation. */
  progress: number;
}

const idleOut = (state: ChargeState): ChargeOutput =>
  ({ state, active: false, halt: false, faceHeading: null, target: null, speed: 0, contact: false, progress: 0 });

export function stepCharge(s: ChargeState, input: ChargeInput): ChargeOutput {
  const C = CHARGE;
  const { dt, self, player } = input;
  const cooldown = Math.max(0, s.cooldown - dt);
  const t = s.t + dt;
  const dx = player ? player.x - self.x : 0, dz = player ? player.z - self.z : 0;
  const dist = Math.hypot(dx, dz);

  switch (s.phase) {
    case 'none': {
      const band = input.enraged ? C.maxDist : C.armedMaxDist;
      const eligible = !!player && input.visible && !input.busy && cooldown <= 0
        && dist >= C.minDist && dist <= band && input.roll < C.chancePerSec * dt;
      if (!eligible) return idleOut({ ...s, cooldown, t: 0 });
      const st: ChargeState = { ...s, phase: 'windup', t: 0, cooldown, travelled: 0, hit: false };
      return { ...idleOut(st), active: true, halt: true, faceHeading: Math.atan2(dx, dz) };
    }
    case 'windup': {
      const windup = input.enraged ? C.enragedWindupSec : C.windupSec;
      // Track the player through the telegraph; LOCK at its end.
      if (t < windup || !player || dist < 1e-6) {
        const face = player ? Math.atan2(dx, dz) : null;
        return { ...idleOut({ ...s, t, cooldown }), active: true, halt: true, faceHeading: face, progress: t / windup };
      }
      const dir: [number, number] = [dx / dist, dz / dist];
      return stepCharge({ ...s, phase: 'charge', t: 0, dir, lockDist: dist, cooldown }, { ...input, dt: 0 });
    }
    case 'charge': {
      const step = C.speed * dt;
      const ahead = [self.x + s.dir[0] * (C.wallProbe + step), self.z + s.dir[1] * (C.wallProbe + step)] as const;
      if (!input.canStand(ahead[0], ahead[1])) {
        return { ...idleOut({ ...s, phase: 'stunned', t: 0, cooldown: input.enraged ? C.enragedCooldownSec : C.cooldownSec }), active: true, halt: true };
      }
      const travelled = s.travelled + step;
      const contact = !s.hit && !!player && dist <= C.hitRadius;
      const done = travelled >= s.lockDist + C.overshoot || t >= C.maxSec;
      if (done) {
        return { ...idleOut({ ...s, phase: 'recover', t: 0, travelled, hit: s.hit || contact,
          cooldown: input.enraged ? C.enragedCooldownSec : C.cooldownSec }), active: true, halt: true, contact };
      }
      const far: [number, number, number] = [self.x + s.dir[0] * 20, 0, self.z + s.dir[1] * 20];
      return { state: { ...s, t, travelled, hit: s.hit || contact, cooldown }, active: true, halt: false,
        faceHeading: null, target: far, speed: C.speed, contact, progress: Math.min(1, t / C.maxSec) };
    }
    case 'stunned':
    case 'recover': {
      const len = s.phase === 'stunned' ? C.stunSec : C.recoverSec;
      if (t >= len) return idleOut({ ...s, phase: 'none', t: 0, cooldown });
      return { ...idleOut({ ...s, t, cooldown }), active: true, halt: true, progress: t / len };
    }
  }
}
