// src/sim/dude.ts
//
// The deterministic sim's first AI entity: the shotgun cultist. This module
// declares the shared types, tuning constants, the aicult.cpp state table, and
// the spawn entry point. Movers/targeting/thinkers/fire/state-machine stepping
// are added by later tasks (Plan 4 tasks 3–6); Task 1 defines only the data.
//
// Determinism firewall: this module imports ONLY sibling sim modules
// (./fp, ./trig, ./units) — never three, Rapier, or src/game.
import { fpFromMeters, metersPerSecToFp, mulfp, approxDist } from './fp';
import { bcos, bsin, yawRotate } from './trig';
import { TICS_PER_SEC } from './units';

/**
 * AI states — a 1:1 mirror of aicult.cpp's AISTATE table (Idle/Chase/Dodge/
 * Goto/Search/SThrow/SFire/Recoil).
 *
 * NOTE: the design plan spells this `export const enum DudeAi`, but `const enum`
 * cannot be used under this project's `isolatedModules: true` tsconfig setting
 * (TS errors) nor reliably inlined across files by the esbuild/vite test runner.
 * We use the standard isolatedModules-safe replacement — a `const ... as const`
 * object with a derived union type — which preserves every value AND the
 * `DudeAi.Idle` member-access pattern exactly. The numeric values are identical
 * to the planned const enum.
 */
export const DudeAi = {
  Idle: 0, Chase: 1, Dodge: 2, Goto: 3, Search: 4, SThrow: 5, SFire: 6, Recoil: 7,
} as const;
export type DudeAi = (typeof DudeAi)[keyof typeof DudeAi];

/**
 * The sim's first AI entity. `dudes: DudeState[]` is added to `SimState` (Task 7).
 * Position/velocity are 16.16 fp Build units; the cultist is ground-only (y = feet;
 * floor = 0). Mirrors NotBlood's `Dude` extra + per-state scratch fields.
 */
export interface DudeState {
  x: number; y: number; z: number;     // fp position (y = feet; floor = 0)
  vx: number; vz: number;              // fp/tic horizontal velocity (cultist is ground-only)
  ang: number;                         // facing, Blood angle [0, 2048)
  goalAng: number;                     // desired facing (toward target)
  health: number;                      // integer HP (death when <= 0)
  ai: DudeAi;                          // current AI state
  stateTics: number;                   // tics remaining for a timed state (0 = untimed/continuous)
  hasTarget: boolean;                  // currently sees/knows the player
  targetX: number; targetZ: number;    // last-known player position (fp) for Goto/Search
  dodgeDir: number;                    // -1 | 0 | +1
  fired: boolean;                      // one-shot guard so an SFire visit fires exactly once
}

// Cultist tuning as sim constants (mirror SHOTGUN_CULTIST + SHOTGUN_BLAST; the
// BU/angle ones come from aicult.cpp/dudeInfo and may need feel-calibration like
// the head kick — note any change in the commit).
export const CULTIST = {
  health: 40,
  walkSpeed: metersPerSecToFp(2.3),          // frontSpeed (forward accel/tic; clamp via friction)
  sideSpeed: metersPerSecToFp(2.3),          // dodge strafe speed
  turnRate: 96,                              // Blood-angle units/tic toward goalAng (~aiMoveForward nTurnRange)
  seeDist: fpFromMeters(18),                 // sight radius (SHOTGUN_CULTIST.aggroRadiusM)
  hearDist: fpFromMeters(9),                 // hear radius (acquire outside FOV when close)
  periphery: 512,                            // half-FOV in Blood-angle units (512 = 90°)
  fireRange: fpFromMeters(12),               // SHOTGUN_CULTIST.fireRangeM (Blood 0x3200)
  fireAngle: 28,                             // |Δang| firing cone, Blood-angle units (aicult.cpp:572)
  throwMin: fpFromMeters(6), throwMax: fpFromMeters(11), // SThrow band (Blood 0x1400..0x2c00)
  eyeHeight: fpFromMeters(1.2),              // shoot/see from this height above feet
  radius: fpFromMeters(0.25),                // horizontal clip radius (matches legacy capsule)
} as const;

export const SHOTGUN = {
  pellets: 7,                                // SHOTGUN_BLAST.pelletCount
  pelletDamage: 12,                          // SHOTGUN_BLAST.pelletDamage
  spreadAng: Math.round((14 / 360) * 2048),  // 14° cone half-angle in Blood-angle units
  maxRange: fpFromMeters(25),                // SHOTGUN_BLAST.pelletMaxRangeM
  sfireFireTic: 18,                          // tic into SFire (60-tic state) when the blast goes off
} as const;

// State table — duration (tics; 0 = continuous), and the next state on expiry.
// move/think are dispatched in stepDude by `ai`; this table carries durations + transitions.
export const DUDE_STATES = {
  [DudeAi.Idle]:   { tics: 0,    next: DudeAi.Idle },
  [DudeAi.Chase]:  { tics: 0,    next: DudeAi.Chase },
  [DudeAi.Dodge]:  { tics: 90,   next: DudeAi.Chase },
  [DudeAi.Goto]:   { tics: 600,  next: DudeAi.Idle },
  [DudeAi.Search]: { tics: 1800, next: DudeAi.Idle },
  [DudeAi.SThrow]: { tics: 30,   next: DudeAi.SFire },
  [DudeAi.SFire]:  { tics: 60,   next: DudeAi.Chase },
  [DudeAi.Recoil]: { tics: 0,    next: DudeAi.Dodge },
} as const;

/** Spawn a shotgun cultist at (x,z) on the floor, facing `ang` (Blood angle).
 *  `_yUnused` is accepted for signature symmetry with other sim spawn APIs
 *  (the cultist is ground-only; feet always start at y=0). */
export function spawnDude(dudes: DudeState[], x: number, z: number, _yUnused: number, ang: number): void {
  dudes.push({
    x, y: 0, z, vx: 0, vz: 0, ang, goalAng: ang,
    health: CULTIST.health, ai: DudeAi.Idle, stateTics: 0,
    hasTarget: false, targetX: 0, targetZ: 0, dodgeDir: 0, fired: false,
  });
}

// ——— Movers (Plan 4, Task 3) ————————————————————————————————
// Port of NotBlood ai.cpp:311-358 (aiMoveForward / aiMoveTurn / aiMoveDodge).
// Angles are Blood units (full turn = 2048); velocity is fp/tic. The cultist is
// ground-only, so these only touch horizontal (x,z) velocity + facing; gravity
// is not applied (y is clamped to 0 in moveDude).
//
// Calibration note (like the head kick): Blood's frontSpeed/sideSpeed/angSpeed
// are in Blood units at Blood's tic rate and do NOT map 1:1 to the sim. Here
// CULTIST.walkSpeed/sideSpeed are sim cruise speeds (m/s → fp/tic) and the
// forward/right velocity components are CLAMPED to them so velocity stays
// bounded (Blood instead accumulates frontSpeed/tic and lets MoveDude damp it).
// Friction is a constant per-tic clip (same idea as the grounded head) so a
// coasting dude halts to exactly zero — determinism-friendly.

/** Blood's forward-thrust gate: aiMoveForward only thrusts once |Δang| ≤ 341
 *  (ai.cpp:316 `if (klabs(nAng) > 341) return;`). 341/2048 ≈ 60°. */
const THRUST_ANG_GATE = 341;

/** Per-tic horizontal speed bleed (Coulomb-style, like the grounded head).
 *  ~0.33 m/s shed per tic → a 2.3 m/s coasting cultist halts in ~7 tics. */
const DUDE_FRICTION_CLIP = metersPerSecToFp(40 / TICS_PER_SEC);

/** Blood angle wrap to [0,2048). */
function wrapAng(a: number): number {
  return ((a % 2048) + 2048) % 2048;
}

/** Signed shortest turn from `from` to `to`, in [-1024, 1023] (Blood units).
 *  Mirrors `((goalAng+1024-ang)&2047)-1024` from ai.cpp. */
function shortestArc(from: number, to: number): number {
  return ((to + 1024 - from) & 2047) - 1024;
}

/** Rotate `d.ang` toward `goalAng` by at most CULTIST.turnRate (shortest arc),
 *  and return the PRE-turn signed delta (used by the movers' thrust gate, which
 *  — like Blood — tests the angle before this tic's turn). */
function turnTowardDelta(d: DudeState, goalAng: number): number {
  const da = shortestArc(d.ang, goalAng);
  const step = Math.max(-CULTIST.turnRate, Math.min(CULTIST.turnRate, da));
  d.ang = wrapAng(d.ang + step);
  return da;
}

/** Rotate `d.ang` toward `goalAng` by at most CULTIST.turnRate (shortest arc).
 *  Port of ai.cpp:325-330 (aiMoveTurn) — pure turn, no thrust. */
export function turnToward(d: DudeState, goalAng: number): void {
  turnTowardDelta(d, goalAng);
}

/** Decompose a world-space horizontal velocity into the dude's facing frame.
 *  `fwd` is speed along the facing (local forward = (0,-1) → world (-sin,-cos));
 *  `right` is speed along the right (local (1,0) → world (cos,-sin)). */
function decomposeVel(vx: number, vz: number, ang: number): { fwd: number; right: number } {
  const cos = bcos(ang);
  const sin = bsin(ang);
  return {
    right: mulfp(vx, cos) - mulfp(vz, sin),
    fwd: -(mulfp(vx, sin) + mulfp(vz, cos)),
  };
}

/** Recompose a facing-frame (fwd, right) pair into world-space velocity, using
 *  the shared yawRotate (the single source of "yaw → world direction"). */
function composeVel(fwd: number, right: number, ang: number): { vx: number; vz: number } {
  const w = yawRotate(right, -fwd, ang);
  return { vx: w.x, vz: w.z };
}

/** Per-tic horizontal friction: shed a constant speed clip, stopping dead once
 *  below it (deterministic — reaches exactly zero, no asymptotic creep). */
function applyDudeFriction(d: DudeState): void {
  const speed = approxDist(d.vx, d.vz);
  if (speed <= 0) return;
  if (speed <= DUDE_FRICTION_CLIP) { d.vx = 0; d.vz = 0; return; }
  const remain = speed - DUDE_FRICTION_CLIP;
  d.vx = Math.floor((d.vx * remain) / speed);
  d.vz = Math.floor((d.vz * remain) / speed);
}

/** Port of ai.cpp:316-324 (aiMoveForward): turn toward `goalAng`, then thrust
 *  forward along the facing only when roughly facing the goal (|Δang| ≤ 341).
 *  The forward velocity component is clamped to CULTIST.walkSpeed (accel→cruise). */
export function aiMoveForward(d: DudeState): void {
  const da = turnTowardDelta(d, d.goalAng);
  if (Math.abs(da) > THRUST_ANG_GATE) return; // still turning — no forward thrust
  const v = decomposeVel(d.vx, d.vz, d.ang);
  const fwd = Math.min(v.fwd + CULTIST.walkSpeed, CULTIST.walkSpeed);
  const w = composeVel(fwd, v.right, d.ang);
  d.vx = w.vx;
  d.vz = w.vz;
}

/** Port of ai.cpp:340-358 (aiMoveDodge): turn toward `goalAng`, then add
 *  ±CULTIST.sideSpeed to the perpendicular (right) velocity component in the
 *  facing frame (mirrors Blood's dmulscale30 decomp/recomp), clamped to sideSpeed. */
export function aiMoveDodge(d: DudeState): void {
  turnTowardDelta(d, d.goalAng);
  if (d.dodgeDir === 0) return;
  const v = decomposeVel(d.vx, d.vz, d.ang);
  const dir = d.dodgeDir > 0 ? 1 : -1;
  const right = Math.max(-CULTIST.sideSpeed, Math.min(v.right + dir * CULTIST.sideSpeed, CULTIST.sideSpeed));
  const w = composeVel(v.fwd, right, d.ang);
  d.vx = w.vx;
  d.vz = w.vz;
}

/** Integrate one tic of cultist physics: advance position by velocity, clamp to
 *  the floor (ground-only — no gravity), then apply horizontal friction. This is
 *  the sim-side analog of Blood's MoveDude (move + damp) and is called every tic
 *  regardless of AI state, so a dude whose AI stops thrusting coasts to a halt. */
export function moveDude(d: DudeState): void {
  d.x += d.vx;
  d.z += d.vz;
  d.y = 0; // ground-only: cultist feet always on the floor
  applyDudeFriction(d);
}
