// src/sim/dude.ts
//
// The deterministic sim's first AI entity: the shotgun cultist. This module
// declares the shared types, tuning constants, the aicult.cpp state table, and
// the spawn entry point. Movers/targeting/thinkers/fire/state-machine stepping
// are added by later tasks (Plan 4 tasks 3–6); Task 1 defines only the data.
//
// Determinism firewall: this module imports ONLY sibling sim modules
// (./fp, ./trig, ./units) — never three, Rapier, or src/game.
import { fpFromMeters, metersPerSecToFp, mulfp, approxDist, FP_PER_BU } from './fp';
import { bcos, bsin, yawRotate, getangle } from './trig';
import { TICS_PER_SEC } from './units';
import { losClear, segmentEnterT, type SimAABB } from './geometry';
import { chance, nextU32, type SimRng } from './rng';
import type { PlayerState } from './player';
import type { SimEvent } from './types';

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
  alertChance: 0x8000,                       // per-tic Idle alert probability (dude.cpp:1559)
  fireRange: fpFromMeters(12),               // SHOTGUN_CULTIST.fireRangeM (Blood 0x3200)
  fireAngle: 28,                             // |Δang| firing cone, Blood-angle units (aicult.cpp:572)
  throwMin: fpFromMeters(6), throwMax: fpFromMeters(11), // SThrow band (Blood 0x1400..0x2c00)
  eyeHeight: fpFromMeters(1.2),              // shoot/see from this height above feet
  radius: fpFromMeters(0.25),                // horizontal clip radius (matches legacy capsule)
} as const;

export const SHOTGUN = {
  // aicult.cpp:187 — `for (int i = 0; i < 8; i++)`: the cultist fires 8 vectors.
  // (This is the CULTIST's hardcoded count; the PLAYER's SHOTGUN_BLAST.pelletCount
  // is 7 — a different weapon. Plan's draft constant said 7 via that comment;
  // corrected to 8 to stay faithful to ShotSeqCallback's loop.)
  pellets: 8,
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

// ——— Targeting + chase brain + state-machine driver (Plan 4, Task 4) ————————
// Port of NotBlood ai.cpp:1325-1362 (aiThinkTarget) and aicult.cpp:411-540
// (thinkChase, the kDudeCultistShotgun branch). The only target is the sim
// PlayerState. Every RNG draw comes from `rng` (SimRng) and is documented with
// its source line. Angles are Blood units; distances are fp (16.16). The fire
// ACTION is Task 5 (here we only set the SFire/SThrow transition CONDITIONS);
// Dodge/Goto/Search mover bodies are Task 6 (here we only transition INTO them).
//
// Coordinate convention: the sim's horizontal plane is (x,z) with y vertical,
// and a sprite facing yaw θ moves toward (-sin θ, -cos θ) in (x,z) (see
// yawRotate / the mover tests). Blood's (x,y) horizontal → sim (x,z), so Blood's
// `dy` maps to the sim's `dz`, and `getangle(dx,dz)` (trig.ts) returns the
// sim-convention angle aiming facing θ at (dx,dz) — NOT Blood's raw atan2(y,x).

/** Transition a dude into `newState`, resetting its state timer from the
 *  DUDE_STATES table, and clearing one-shot guards on entry to SFire. Mirrors
 *  Blood's aiNewState (which resets the AISTATE offset/timer). */
function enterState(d: DudeState, newState: DudeAi): void {
  d.ai = newState;
  d.stateTics = DUDE_STATES[newState].tics;
  if (newState === DudeAi.SFire) d.fired = false; // one-shot guard (Task 5 fires once)
}

/** Aim + mark the player as the current target, then enter Chase. Port of
 *  aiSetTarget + aiActivateDude (→ cultistChase) from ai.cpp. */
function acquireTarget(d: DudeState, player: PlayerState): void {
  d.hasTarget = true;
  d.targetX = player.x;
  d.targetZ = player.z;
  d.goalAng = getangle(player.x - d.x, player.z - d.z);
  enterState(d, DudeAi.Chase);
}

/** Port of ai.cpp:1325-1362 (aiThinkTarget). Called every tic while Idle: with
 *  probability `alertChance`, scan for the player; acquire if within sight
 *  radius+LOS+periphery (sight) OR within hear radius+LOS (hear).
 *
 *  RNG draw (documented): `chance(rng, CULTIST.alertChance)` — ai.cpp:1329
 *  `if (Chance(pDudeInfo->alertChance))`. No other draws in this function. */
function aiThinkTarget(d: DudeState, player: PlayerState, geo: SimAABB[], rng: SimRng): void {
  // ai.cpp:1329 — alert gate (one RNG draw per Idle tic).
  if (!chance(rng, CULTIST.alertChance)) return;
  if (player.hp <= 0) return; // dead players can't be targeted (Blood: health==0 skip)

  const dx = player.x - d.x;
  const dz = player.z - d.z;
  const nDist = approxDist(dx, dz);

  // ai.cpp:1343 — too far to see OR hear → skip.
  if (nDist > CULTIST.seeDist && nDist > CULTIST.hearDist) return;

  // ai.cpp:1345 — geometric line-of-sight (cansee). The sim uses losClear
  // (Task 2); eye/target heights are passed for API parity but arena AABBs are
  // full-height columns, so losClear drops Y.
  if (!losClear(d.x, CULTIST.eyeHeight, d.z, player.x, player.y + CULTIST.eyeHeight, player.z, geo)) return;

  // ai.cpp:1347 — delta angle to the player (Blood: ((getangle(dx,dy)+1024-ang)&2047)-1024).
  const nDeltaAngle = shortestArc(d.ang, getangle(dx, dz));

  // ai.cpp:1348 — sight acquire: in sight radius AND within periphery FOV.
  if (nDist < CULTIST.seeDist && Math.abs(nDeltaAngle) <= CULTIST.periphery) {
    acquireTarget(d, player);
    return;
  }
  // ai.cpp:1354 — hear acquire: close enough to hear (outside FOV is OK).
  if (nDist < CULTIST.hearDist) {
    acquireTarget(d, player);
    return;
  }
}

/** Port of aicult.cpp:411-540 (thinkChase, kDudeCultistShotgun branch). Called
 *  every tic while Chase: face the player, refresh last-known, and either keep
 *  chasing or transition to SFire/SThrow (conditions only — fire is Task 5) or,
 *  if the target is lost (out of range / no LOS / outside periphery / dead),
 *  record last-known and go to Goto (→ investigate) / Search.
 *
 *  RNG draw (documented): `chance(rng, CULTIST.alertChance)` on the SThrow
 *  branch — aicult.cpp:566 `&& Chance(0x8000)`. SFire has no RNG draw. */
function thinkChase(d: DudeState, player: PlayerState, geo: SimAABB[], rng: SimRng): void {
  // aicult.cpp:412 — no target → Goto (investigate last-known).
  if (!d.hasTarget) { enterState(d, DudeAi.Goto); return; }

  const dx = player.x - d.x;
  const dz = player.z - d.z;
  // aicult.cpp:421 — aiChooseDirection: face the movement angle toward the target.
  d.goalAng = getangle(dx, dz);

  // aicult.cpp:425 — target dead → Search (give up the chase).
  if (player.hp <= 0) { enterState(d, DudeAi.Search); d.hasTarget = false; return; }

  const nDist = approxDist(dx, dz);

  // aicult.cpp:447 — only act when the target is within sight radius.
  if (nDist <= CULTIST.seeDist) {
    const nDeltaAngle = shortestArc(d.ang, getangle(dx, dz));
    // aicult.cpp:452 — cansee (line-of-sight) gate.
    if (losClear(d.x, CULTIST.eyeHeight, d.z, player.x, player.y + CULTIST.eyeHeight, player.z, geo)) {
      // aicult.cpp:453 — in sight AND within periphery → keep the target fresh.
      if (nDist < CULTIST.seeDist && Math.abs(nDeltaAngle) <= CULTIST.periphery) {
        // aiSetTarget: refresh last-known position (used by Goto/Search later).
        d.targetX = player.x;
        d.targetZ = player.z;

        // aicult.cpp:565 (SThrow condition, kDudeCultistShotgun): throw band +
        //   Chance(0x8000). SIMPLIFIED for the single-player milestone: Blood
        //   also gates on TargetNearExplosion, (target.flags&2), nDifficulty>=2,
        //   IsPlayerSprite && !isRunning — none of which map to the sim. The RNG
        //   draw is chance(CULTIST.alertChance) == Chance(0x8000); note the
        //   short-circuit means it only fires inside the throw band.
        if (nDist > CULTIST.throwMin && nDist < CULTIST.throwMax && chance(rng, CULTIST.alertChance)) {
          enterState(d, DudeAi.SThrow);
          return;
        }
        // aicult.cpp:572 (SFire condition): nDist < 0x3200 (fireRange) &&
        //   |nDeltaAngle| < 28 (fireAngle). (Blood also HitScans first to confirm
        //   a clear shot + Dodges if blocked by a same-type cultist; the clear-
        //   shot is redundant with the cansee above, and same-type-Dodge is T6.)
        if (nDist < CULTIST.fireRange && Math.abs(nDeltaAngle) < CULTIST.fireAngle) {
          enterState(d, DudeAi.SFire);
          return;
        }
        // else: target visible but not in a fire/throw window → keep chasing.
        return;
      }
    }
  }

  // aicult.cpp:805 (fall-through) — target lost: go investigate last-known, then
  //   drop the target. (Blood: aiNewState(&cultistGoto); pXSprite->target = -1.)
  enterState(d, DudeAi.Goto);
  d.hasTarget = false;
}

// ——— Shotgun fire — deterministic hitscan + player-as-target damage (Plan 4, Task 5) —
// Port of NotBlood aicult.cpp:159-207 (ShotSeqCallback). Blood fires the cultist's
// blast as 8 `kVectorShell` HITSCANS via actFireVector; the sim has no Blood
// sectors/hitscan engine, so each pellet is a deterministic segment raycast vs
// the arena geometry AND the player AABB. Damage folds into the sim-authoritative
// `player.hp`; a single `cultistFire` SimEvent is emitted for the cosmetic
// tracer/muzzle/SFX (the damage already happened in-sim).
//
// RNG FAITHFULNESS: the NUMBER and ORDER of draws mirrors ShotSeqCallback exactly
// — 3 `Random2` base-spread draws (aicult.cpp:168-170) then, per pellet,
// `Random3(500)`/`Random3(1000)`/`Random3(1000)` (aicult.cpp:189-191, 2 draws each).
// `Random2`/`Random3` are ported onto `SimRng` (Blood uses the engine's signed
// `wrand()`; the sim uses unsigned `nextU32`), preserving each function's draw
// count (1 / 2) and signed-spread shape. The SFX `Chance(0x8000)` roll at
// aicult.cpp:202 is OMITTED in-sim (cosmetic-only; the cultistFire event selects
// the SFX in the cosmetic layer) — documented so the draw count is auditable.
//
// CALIBRATION (like the head kick): Blood's spread magnitudes are in its own
// z/vector units and do NOT map 1:1 to sim fp. The cone fractions below are the
// sim-scale feel-calibration of that spread (start values; note tweaks in the
// commit). What MUST stay stable for the determinism harness is the draw count.

/** Player horizontal hit radius (fp) — the AABB half-extent around player.x/z. */
const PLAYER_HIT_RADIUS = fpFromMeters(0.3);

/** Blood difficulty-3 ShotSeqCallback spread arguments (gGameOptions.nDifficulty=3).
 *  (5-3)*1000-500 = 1500 (xy); (5-3)*500 = 1000 (z); pellet args 1000/500. */
const BASE_SPREAD_XY = 1500;
const BASE_SPREAD_Z = 1000;
const PELLET_SPREAD_XY = 1000;
const PELLET_SPREAD_Z = 500;

/** Sim-scale cone feel-calibration. The pellet's horizontal direction is the
 *  facing unit plus up to `CONE_FRACTION` of a unit of spread (then renormalized
 *  to unit) → a cone of half-angle atan(CONE_FRACTION) ≈ 5.7°. `SLOPE_FRACTION` is
 *  the vertical analogue (fraction of a 45° slope). Start values; tune in playtest. */
const CONE_FRACTION = 0.10;
const SLOPE_FRACTION = 0.10;

/** Port of common_game.h:843 `Random2(a1) = mulscale14(wrand(), a1) - a1`.
 *  Blood's `wrand()` is a signed 16-bit value; we map one `nextU32` draw to the
 *  same [-1,1) normalized factor `s` and apply `floor(2*s*a1 - a1)`, which has the
 *  same [-3*a1, a1) range and -a1 mean as the original. ONE RNG draw. */
function random2(rng: SimRng, a1: number): number {
  const s = nextU32(rng) / 2147483648 - 1; // [-1, 1) — wrand()/32768 analogue
  return Math.floor(2 * s * a1 - a1);
}

/** Port of common_game.h:848 `Random3(a1) = mulscale15(wrand()+wrand(), a1) - a1`.
 *  Two `wrand()` draws (triangular); we use TWO `nextU32` draws, each mapped to
 *  [-1,1), sum them to [-2,2), and apply `floor(sum*a1 - a1)` → same [-3*a1, a1)
 *  range and triangular concentration as the original. TWO RNG draws. */
function random3(rng: SimRng, a1: number): number {
  const s1 = nextU32(rng) / 2147483648 - 1;
  const s2 = nextU32(rng) / 2147483648 - 1;
  return Math.floor((s1 + s2) * a1 - a1);
}

/** Map a Blood spread draw back to its SYMMETRIC [-1,1) underlying factor.
 *  `random2(a)=floor(2*s*a - a)` and `random3(a)=floor(sum*a - a)` both encode a
 *  symmetric factor (s∈[-1,1), sum∈[-2,2)); `draw + a` recovers ≈ that factor×a
 *  (resp. ×2a), so `(draw + a)/(2*a)` ∈ [-1,1) is the symmetric spread factor.
 *  We do NOT use Blood's raw [-3a,a) asymmetric value here — the asymmetry is an
 *  artifact of Blood's `mulscale - a` formula, not a desired cone shape. Clamped
 *  for safety. (The RNG DRAW COUNT is what's faithful; the magnitude mapping is a
 *  sim feel-calibration — see CONE_FRACTION.) */
function spreadFrac(draw: number, a1: number): number {
  const f = (draw + a1) / (2 * a1);
  return f < -1 ? -1 : f > 1 ? 1 : f;
}

/** Does the pellet segment (eye→endpoint) strike the player before any geometry?
 *  The player is an XZ AABB of half-extent PLAYER_HIT_RADIUS around player.x/z,
 *  with a vertical span of feet→eye (player.y .. player.y + CULTIST.eyeHeight).
 *  Geometry AABBs are full-height columns, so occlusion is an XZ entry-parameter
 *  ordering: if any AABB is entered strictly before the player box, the pellet
 *  hits the wall first and is blocked. The pellet's height at the player's XZ
 *  crossing must lie within the player's vertical span. */
function rayHitsPlayer(
  eyeX: number, eyeY: number, eyeZ: number,
  endX: number, endY: number, endZ: number,
  player: PlayerState, geo: SimAABB[],
): boolean {
  const box: SimAABB = {
    minX: player.x - PLAYER_HIT_RADIUS, maxX: player.x + PLAYER_HIT_RADIUS,
    minZ: player.z - PLAYER_HIT_RADIUS, maxZ: player.z + PLAYER_HIT_RADIUS,
  };
  const tPlayer = segmentEnterT(eyeX, eyeZ, endX, endZ, box);
  if (tPlayer === Infinity) return false; // pellet misses the player's XZ footprint

  // Geometry occlusion: a wall entered before the player blocks the pellet.
  for (const a of geo) {
    const tg = segmentEnterT(eyeX, eyeZ, endX, endZ, a);
    if (tg < tPlayer) return false;
  }

  // Vertical gate: the pellet's height where it crosses the player's XZ box must
  // be within feet→eye (so a pellet sailing over/under the player misses).
  const yAt = eyeY + (endY - eyeY) * tPlayer;
  return yAt >= player.y && yAt <= player.y + CULTIST.eyeHeight;
}

/** Fire the cultist shotgun once: 8 deterministic pellet raycasts from the
 *  dude's eye toward the player (yaw from d.ang, slope from the eye-height delta
 *  over distance — the sim analogue of gDudeSlope = divscale10(dz, dist)). Each
 *  pellet reaching the player does SHOTGUN.pelletDamage; one cultistFire event
 *  is emitted for the cosmetic layer. Port of aicult.cpp:159-207. */
function fireShotgun(
  d: DudeState, player: PlayerState, geo: SimAABB[], rng: SimRng, out: SimEvent[],
): void {
  const eyeX = d.x;
  const eyeY = CULTIST.eyeHeight; // dude feet at y=0; shoots from eye height
  const eyeZ = d.z;

  const dx = player.x - d.x;
  const dz = player.z - d.z;
  const dist = approxDist(dx, dz); // fp horizontal distance

  // Slope (vertical rise per horizontal unit), 16.16 — sim analogue of Blood's
  // gDudeSlope = divscale10(pTarget->z - pSprite->z, nDist) (aicult.cpp:478). Aim at
  // the player's vertical CENTER (mid-body), not its eye: the hit AABB spans
  // feet→eye (see rayHitsPlayer), so a center aim keeps vertical spread in-box.
  // (CULTIST.eyeHeight is the sim's proxy for the player's body height — there is
  // no separate player-height constant; noted as a feel-calibration value.)
  const aimY = player.y + (CULTIST.eyeHeight >> 1);
  const baseSlope = dist > 0 ? Math.floor(((aimY - eyeY) * FP_PER_BU) / dist) : 0;

  // Base horizontal facing unit (16.16): yawRotate(0, -FP_PER_BU, ang) = (-sin,-cos).
  const baseX = -bsin(d.ang);
  const baseZ = -bcos(d.ang);

  // aicult.cpp:166-170 — base direction (Cos/Sin>>16) + 3 Random2 base-spread draws.
  const bjx = random2(rng, BASE_SPREAD_XY);
  const bjy = random2(rng, BASE_SPREAD_XY);
  const bjz = random2(rng, BASE_SPREAD_Z);
  const bfx = spreadFrac(bjx, BASE_SPREAD_XY);
  const bfz = spreadFrac(bjy, BASE_SPREAD_XY);
  const bfy = spreadFrac(bjz, BASE_SPREAD_Z);

  for (let i = 0; i < SHOTGUN.pellets; i++) {
    // aicult.cpp:189-191 — per-pellet Random3 spread (r1=vertical, r2/r3=horizontal).
    const r1 = random3(rng, PELLET_SPREAD_Z);
    const r2 = random3(rng, PELLET_SPREAD_XY);
    const r3 = random3(rng, PELLET_SPREAD_XY);

    // Horizontal direction = facing unit + (base+pellet) spread, renormalized to unit.
    const fx = spreadFrac(r3, PELLET_SPREAD_XY) + bfx;
    const fz = spreadFrac(r2, PELLET_SPREAD_XY) + bfz;
    let hx = baseX + Math.round(fx * CONE_FRACTION * FP_PER_BU);
    let hz = baseZ + Math.round(fz * CONE_FRACTION * FP_PER_BU);
    const hlen = approxDist(hx, hz);
    if (hlen > 0) {
      hx = Math.floor((hx * FP_PER_BU) / hlen);
      hz = Math.floor((hz * FP_PER_BU) / hlen);
    }

    // Vertical slope = base slope + (base+pellet) vertical spread.
    const fy = spreadFrac(r1, PELLET_SPREAD_Z) + bfy;
    const slope = baseSlope + Math.round(fy * SLOPE_FRACTION * FP_PER_BU);

    // Pellet endpoint at SHOTGUN.maxRange horizontal distance along the direction.
    const endX = eyeX + mulfp(hx, SHOTGUN.maxRange);
    const endZ = eyeZ + mulfp(hz, SHOTGUN.maxRange);
    const endY = eyeY + mulfp(slope, SHOTGUN.maxRange);

    // aicult.cpp:193 — actFireVector(... kVectorShell): hitscan. Apply damage in-sim.
    if (rayHitsPlayer(eyeX, eyeY, eyeZ, endX, endY, endZ, player, geo)) {
      player.hp -= SHOTGUN.pelletDamage;
    }
  }

  // Signed Blood-angle pitch from the aim slope (atan2 of eye-delta over dist),
  // for the cosmetic tracer/muzzle. ang is the dude's facing yaw.
  const pitch = dist > 0
    ? Math.round((Math.atan2(aimY - eyeY, dist) / (Math.PI * 2)) * 2048)
    : 0;
  out.push({ kind: 'cultistFire', x: eyeX, y: eyeY, z: eyeZ, ang: d.ang, pitch });
}

/** SFire thinker (Plan 4, Task 5): once the SFire state has elapsed
 *  SHOTGUN.sfireFireTic tics and the dude hasn't fired this visit, fire once.
 *  `d.fired` is reset to false on SFire ENTRY (enterState), so each SFire visit
 *  fires exactly once. */
function thinkSFire(
  d: DudeState, player: PlayerState, geo: SimAABB[], rng: SimRng, out: SimEvent[],
): void {
  if (d.fired) return;
  // stateTics counts DOWN from DUDE_STATES[SFire].tics (60); the blast goes off
  // once SHOTGUN.sfireFireTic (18) tics have elapsed, i.e. stateTics <= 60-18.
  const fireAt = DUDE_STATES[DudeAi.SFire].tics - SHOTGUN.sfireFireTic;
  if (d.stateTics > fireAt) return;
  fireShotgun(d, player, geo, rng, out);
  d.fired = true;
}

/**
 * Advance all dudes one tic — the state-machine driver. Per dude (skipping the
 * dead): run the thinker for the current AI state (sets goalAng, may transition
 * states), run the mover for the (possibly new) state, integrate physics
 * (always, so a coasting dude halts via friction), then decrement the state
 * timer and transition to DUDE_STATES[ai].next on expiry.
 *
 * `tic` (absolute SimState.tic) and `out` (event sink) are part of the signature
 * for Task 5 (cultistFire) / Task 7 (SimState wiring); unused in Task 4.
 */
export function stepDudes(
  dudes: DudeState[],
  player: PlayerState,
  geo: SimAABB[],
  rng: SimRng,
  tic: number,
  out: SimEvent[],
): void {
  void tic;
  for (const d of dudes) {
    if (d.health <= 0) continue; // dead dudes don't think or move

    // 1. Thinker — sets goalAng, may transition the AI state.
    switch (d.ai) {
      case DudeAi.Idle: aiThinkTarget(d, player, geo, rng); break;
      case DudeAi.Chase: thinkChase(d, player, geo, rng); break;
      case DudeAi.SFire: thinkSFire(d, player, geo, rng, out); break;
      // Goto/Search/Dodge/SThrow/Recoil thinkers: Task 6.
      default: break;
    }

    // 2. Mover — movement for the current (possibly just-transitioned) state.
    switch (d.ai) {
      case DudeAi.Chase: aiMoveForward(d); break;
      // Dodge/Goto movers: Task 6. Idle/SFire/SThrow/Search/Recoil: stand still.
      default: break;
    }

    // 3. Integrate physics (position += velocity; ground clamp; friction).
    moveDude(d);

    // 4. State timer — decrement and transition to `next` on expiry.
    if (d.stateTics > 0) {
      d.stateTics -= 1;
      if (d.stateTics === 0) enterState(d, DUDE_STATES[d.ai].next);
    }
  }
}
