// src/sim/dude.ts
//
// The deterministic sim's first AI entity: the shotgun cultist. This module
// declares the shared types, tuning constants, the aicult.cpp state table, and
// the spawn entry point. Movers/targeting/thinkers/fire/state-machine stepping
// are added by later tasks (Plan 4 tasks 3–6); Task 1 defines only the data.
//
// Determinism firewall: this module imports ONLY sibling sim modules (./fp).
import { fpFromMeters, metersPerSecToFp } from './fp';

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
