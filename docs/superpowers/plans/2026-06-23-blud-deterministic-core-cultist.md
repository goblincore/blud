# Shotgun Cultist on the Deterministic Sim (Plan 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the shotgun cultist's full NotBlood ground AI onto the deterministic sim — a new `dudes[]` entity that idles, acquires the player by real line-of-sight, chases, dodges, searches, and fires a deterministic 8-pellet shotgun hitscan that damages the sim-authoritative player — and fold in the deferred player-as-target damage unification.

**Architecture:** A new `src/sim/dude.ts` defines `DudeState` (the sim's first AI entity) and a data-driven state machine mirroring `aicult.cpp`'s `AISTATE` table (Idle→Chase→{SFire/SThrow/Dodge/Goto/Search}→Recoil). Movement (`aiMoveForward`/`aiMoveDodge`), targeting (`aiThinkTarget`), and the chase brain (`thinkChase`) are ported as pure integer-fp functions. Line-of-sight is a deterministic **segment-vs-AABB** raycast against `buildArenaGeometry` (the sim has no Blood sectors). Firing is **deterministic hitscan** (Blood's default `kVectorShell`) computed in-sim against the player AABB + geometry; it applies damage to `player.hp` and emits a `cultistFire` `SimEvent` for the cosmetic tracer/muzzle/SFX. The cosmetic `ShotgunCultist` billboard/animation/flares stay legacy, now **driven by `sim.dudeRenders()`** (the same strangler pattern as the kickable head). Player-as-target damage (pellet hitscan + `applyExplosionToPlayer`) becomes sim-authoritative, and the player is excluded from the legacy explosion AOE to avoid double-counting.

**Tech Stack:** TypeScript, Vitest. The deterministic sim (`src/sim/**`) is Three/Rapier-free, 16.16 fixed-point Build-unit integer math at 120 tic/s.

**NotBlood source (read it — agents are expected to investigate it for exact integer math):**
`/Users/donny/Documents/Raze/NotBlood/source/blood/src/` — key files/symbols:
- `aicult.cpp`: state table (lines 60–98), `thinkChase` (411–813), `ShotSeqCallback` fire (159–207).
- `ai.cpp`: `aiMoveForward`/`aiMoveDodge`/`aiMoveTurn` (311–358), `aiThinkTarget` (1325–1362), `aiChooseDirection` (~290–310), `thinkGoto`/`thinkSearch`.
- `ai.h`: `AISTATE` struct (30–39). `common_game.h`: `Chance`/`Random2`/`Random3` (833–861), `approxDist` (905), `kDudeCultistShotgun = 202` (353).

**Determinism firewall (do not violate):** `src/sim/**` must NOT import `three`, Rapier, or `src/game/**`. The cultist's tuning values below are restated as sim constants precisely because the firewall blocks importing `src/game/gibs/tuning.ts`.

---

## Shared types & constants (defined in Task 1; every later task imports these)

```typescript
// src/sim/dude.ts — DudeState is the sim's first AI entity.
export const enum DudeAi {
  Idle = 0, Chase = 1, Dodge = 2, Goto = 3, Search = 4, SThrow = 5, SFire = 6, Recoil = 7,
}

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
```

Cultist tuning as sim constants (mirror `SHOTGUN_CULTIST` + `SHOTGUN_BLAST`; the BU/angle ones come from `aicult.cpp`/`dudeInfo` and may need feel-calibration like the head kick — note any change in the commit):

```typescript
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
```

`SimEvent` gains a fire variant (Task 5) for cosmetics:

```typescript
| { kind: 'cultistFire'; x: number; y: number; z: number; ang: number; pitch: number } // muzzle fp + aim
| { kind: 'dudeDeath'; x: number; y: number; z: number }                                // cosmetic death/gibs cue
```

**Boundary decisions (single-player milestone; stated so reviewers see the seams):**
- The sim dude is **authoritative for AI, movement, firing, and cultist→player damage**.
- **Player→dude damage stays legacy-driven for now** (dynamite AOE/flare hit the cosmetic `ShotgunCultist`); the cosmetic layer reports kills to the sim via `runner.killDude(idx)`. Deterministic player-weapon→dude damage is a later milestone (same precedent as the dynamite throw hook using the live camera).
- Cosmetic billboard/animation/flares/gibs stay legacy, driven from `sim.dudeRenders()` + drained `SimEvent`s.

---

## File Structure

| File | Responsibility |
| ---- | -------------- |
| `src/sim/dude.ts` (new) | `DudeState`, `DudeAi`, `CULTIST`/`SHOTGUN`/`DUDE_STATES`, `spawnDude`, movers, targeting, `thinkChase`/`thinkGoto`/`thinkSearch`, `stepDudes`, fire hitscan. |
| `src/sim/dude.test.ts` (new) | Unit tests for movers, targeting, state machine, fire. |
| `src/sim/geometry.ts` (mod) | `segmentHitsAABB` + `losClear` (deterministic segment-vs-AABB raycast). |
| `src/sim/geometry.test.ts` (mod) | LOS tests. |
| `src/sim/types.ts` (mod) | `SimEvent` += `cultistFire`, `dudeDeath`. |
| `src/sim/state.ts` (mod) | `SimState.dudes: DudeState[]`. |
| `src/sim/step.ts` (mod) | `stepDudes` + `applyExplosionToPlayer` wiring. |
| `src/sim/explosion.ts` (mod) | (already has `applyExplosionToPlayer`) — apply to dudes too if in scope; otherwise unchanged. |
| `src/sim/hash.ts`, `src/sim/snapshot.ts` (mod) | Hash + clone dudes. |
| `src/sim/determinism.test.ts` (mod) | Seed a dude in the harness. |
| `src/sim/render.ts` (mod) | `DudeRender` + `renderDudes` (meters/radians + ai state for anim). |
| `src/sim/runner.ts` (mod) | `spawnDude`, `dudeRenders`, `killDude`, `playerHp`. |
| `src/sim/player.ts` (mod) | clamp `hp` at 0 / expose death (if needed). |
| `src/game/enemy/shotgun-cultist.ts`, `src/game/enemy/cultist-ai.ts` (mod) | Retire the legacy AI movement/fire; keep cosmetic anim/flares, driven by the sim. |
| `src/main.ts` (mod) | Spawn a sim dude per cultist; drive billboard/anim from `sim.dudeRenders()`; `cultistFire`→tracer/SFX; remove legacy pellet path; HUD hp from `sim.playerHp()`; exclude player from legacy AOE. |
| `TASKS.md` (mod) | Mark `F2.cultist.*` + plan 4 done. |

**Dispatch note:** serial chain — every task builds on the prior (shared `src/sim/dude.ts` + `SimState`).

---

### Task 1: Dude module — types, constants, spawn, state table

**Files:**
- Create: `src/sim/dude.ts`
- Test: `src/sim/dude.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/sim/dude.test.ts
import { describe, it, expect } from 'vitest';
import { spawnDude, DudeAi, CULTIST, type DudeState } from './dude';
import { fpFromMeters } from './fp';

describe('dude spawn', () => {
  it('spawns a cultist idle, full health, facing its initial angle', () => {
    const dudes: DudeState[] = [];
    spawnDude(dudes, fpFromMeters(3), 0, fpFromMeters(-2), 512);
    expect(dudes).toHaveLength(1);
    const d = dudes[0]!;
    expect(d.ai).toBe(DudeAi.Idle);
    expect(d.health).toBe(CULTIST.health);
    expect(d.ang).toBe(512);
    expect(d.hasTarget).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module './dude'`). Run: `npx vitest run src/sim/dude.test.ts`

- [ ] **Step 3: Implement** `src/sim/dude.ts` with the `DudeAi` enum, `DudeState` interface, `CULTIST`/`SHOTGUN`/`DUDE_STATES` constants (all exactly as in the "Shared types & constants" section above — copy them verbatim), and:

```typescript
import { fpFromMeters, metersPerSecToFp } from './fp';
// ...constants above...

/** Spawn a shotgun cultist at (x,z) on the floor, facing `ang` (Blood angle). */
export function spawnDude(dudes: DudeState[], x: number, z: number, _yUnused: number, ang: number): void {
  dudes.push({
    x, y: 0, z, vx: 0, vz: 0, ang, goalAng: ang,
    health: CULTIST.health, ai: DudeAi.Idle, stateTics: 0,
    hasTarget: false, targetX: 0, targetZ: 0, dodgeDir: 0, fired: false,
  });
}
```

(`stepDudes`, movers, thinkers, and fire are added in later tasks. Define a placeholder `export function stepDudes() {}` is NOT allowed — leave them out until their task.)

- [ ] **Step 4: Run it — expect PASS.** `npx vitest run src/sim/dude.test.ts`
- [ ] **Step 5: Commit.** `git add src/sim/dude.ts src/sim/dude.test.ts && git commit -m "feat(sim): cultist DudeState + AI state table + spawn"`

---

### Task 2: Deterministic line-of-sight (segment-vs-AABB)

**Files:**
- Modify: `src/sim/geometry.ts`
- Test: `src/sim/geometry.test.ts`

NotBlood uses `cansee()` (sector traversal). The sim has only `buildArenaGeometry()` AABBs, so LOS = "does the segment from the cultist's eye to the player's chest miss every solid AABB?" Port a standard **slab-method** segment-vs-AABB test (deterministic integer; clamp params in fp). Reference: any ray-AABB slab method; here all inputs are fp integers and the test is a boolean (no division-by-zero — guard zero direction components per axis).

- [ ] **Step 1: Write the failing test** in `src/sim/geometry.test.ts` (it already imports `buildArenaGeometry`):

```typescript
import { losClear } from './geometry';
import { fpFromMeters } from './fp';

it('LOS is clear across open floor but blocked by an obstacle', () => {
  const geo = buildArenaGeometry();
  // Two points with open space between them (pick coords away from the 3 obstacles).
  const ax = fpFromMeters(-6), az = fpFromMeters(-6);
  const bx = fpFromMeters(-6), bz = fpFromMeters(-4);
  const y = fpFromMeters(1.2);
  expect(losClear(ax, y, az, bx, y, bz, geo)).toBe(true);
  // A point on the far side of a known central obstacle is blocked (use the obstacle
  // coords from buildArenaGeometry — see geometry.ts; pick a segment that passes through one).
  const cx = fpFromMeters(0), cz = fpFromMeters(-8);
  const dx = fpFromMeters(0), dz = fpFromMeters(8);
  expect(losClear(cx, y, cz, dx, y, dz, geo)).toBe(false);
});
```

(Adjust the blocked-segment coordinates to actually cross one of `buildArenaGeometry`'s obstacle AABBs — read `geometry.ts` for the obstacle extents first.)

- [ ] **Step 2: Run — expect FAIL** (`losClear` not exported).
- [ ] **Step 3: Implement** in `src/sim/geometry.ts`: a `segmentHitsAABB(x0,y0,z0, x1,y1,z1, aabb)` slab test over X/Z (and Y if the AABBs are full-height; arena walls/obstacles are full-height columns, so an XZ slab test against each AABB's x/z extents is sufficient — confirm against `SimAABB`'s fields), and:

```typescript
/** True if the eye→target segment is unobstructed by any solid geometry AABB. */
export function losClear(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  geo: SimAABB[],
): boolean {
  for (const a of geo) {
    if (segmentHitsAABB(x0, z0, x1, z1, a)) return false;
  }
  return true;
}
```

Port the slab test carefully (handle axis-aligned zero-direction by treating the segment as parallel — inside-slab passes, outside-slab misses). Keep it integer-deterministic (fp). Read `SimAABB` in `geometry.ts` for the exact field names (min/max x/z).

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(sim): deterministic segment-vs-AABB line-of-sight (losClear)"`

---

### Task 3: Movers — aiMoveForward, aiMoveDodge, turn-toward, dude friction

**Files:**
- Modify: `src/sim/dude.ts`
- Test: `src/sim/dude.test.ts`

Port from `ai.cpp:311–358`. Adapt to sim units: angles in Blood-angle units via `trig.ts` (`bcos`/`bsin`/`yawRotate`); velocity in fp/tic; speeds from `CULTIST`. Apply a per-tic horizontal friction/clamp so the dude doesn't accelerate unbounded (Blood `MoveDude` damps velocity; reuse the head's linear-friction idea or a simple `mulfp(v, DAMP)` toward `walkSpeed`). The cultist is ground-only (no gravity needed; clamp `y=0`).

- `turnToward(d, goalAng)`: rotate `d.ang` toward `goalAng` by at most `CULTIST.turnRate` (shortest arc, wrap at 2048 — reuse the `lerpAngle`/shortest-arc idiom from `render.ts`).
- `aiMoveForward(d)`: `turnToward(d, d.goalAng)`; if `|Δang|` small, add `walkSpeed` along `d.ang` (`bcos`/`bsin`); then clamp horizontal speed to `walkSpeed` (so accel→cruise) and apply friction when no accel.
- `aiMoveDodge(d)`: `turnToward`; add `±sideSpeed` perpendicular to facing per `d.dodgeDir` (rotate velocity into facing-frame, add to the perpendicular component, rotate back — mirror `aiMoveDodge`'s `dmulscale30` exactly).

- [ ] **Step 1: Write failing tests** (turn-toward converges; forward moves along facing; dodge strafes sideways; friction halts a coasting dude). Use `metersPerSecToFp`/`fpFromMeters` for thresholds.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the movers in `dude.ts` (port `ai.cpp:311–358`; cite it in a comment).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(sim): cultist movers (aiMoveForward/aiMoveDodge/turn + friction)"`

---

### Task 4: Targeting + chase brain + state-machine driver

**Files:**
- Modify: `src/sim/dude.ts`
- Test: `src/sim/dude.test.ts`

Port `aiThinkTarget` (`ai.cpp:1325`) and the core of `thinkChase` (`aicult.cpp:411`, the shotgun branch). The only target is the sim player (`PlayerState`). Use `approxDist` (fp) + `losClear` (Task 2) + `getDeltaAngle` (`((getangle(dx,dz)+1024-ang)&2047)-1024`) vs `CULTIST.periphery`. Add a `getangle(dx,dz)` helper to `trig.ts` if absent (deterministic integer atan2 over the Blood costable, or port Blood's `getangle`). Add `stepDudes(dudes, player, geo, rng, tic, out)` that, per dude: dispatches the mover + thinker for `d.ai`, decrements `stateTics`, and on expiry transitions to `DUDE_STATES[d.ai].next`.

This task implements: **Idle** (`aiThinkTarget` → acquire → Chase), **Chase** (`aiMoveForward` + set `goalAng` toward player; if target lost → record last-known pos, → Goto), and the **fire/throw decision stubs** transition into SFire/SThrow (the actual fire is Task 5; Dodge/Goto/Search bodies are Task 6). Use the RNG (`SimRng`) for `aiThinkTarget`'s `alertChance` and any `Chance` — every draw must come from `state.rng` (deterministic). Document each RNG draw with its `aicult.cpp` reference.

- [ ] **Step 1: Failing tests** — Idle dude with player in range+LOS+FOV → Chase (and `hasTarget`); Chase moves toward player + faces it; player breaks LOS → dude → Goto with `targetX/targetZ` = last-known.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** `aiThinkTarget`, `thinkChase` (acquire/chase/lose paths + SFire/SThrow transition conditions), and `stepDudes` driver. Cite source lines.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(sim): cultist targeting + chase brain + state-machine driver"`

---

### Task 5: Shotgun fire — deterministic hitscan + player-as-target damage + SimEvent

**Files:**
- Modify: `src/sim/dude.ts`, `src/sim/types.ts`
- Test: `src/sim/dude.test.ts`

In `types.ts`, add the `cultistFire` and `dudeDeath` `SimEvent` variants (as in the shared-types section). In `dude.ts`, when a dude in **SFire** reaches `SHOTGUN.sfireFireTic` and `!d.fired`, fire once: compute aim toward the player (yaw = `d.ang` snapped to the player, pitch/slope = `divscale`-style `(playerEyeZ - dudeEyeZ)/dist`), then for each of `SHOTGUN.pellets` pellets draw spread from `state.rng` (port `ShotSeqCallback`'s `Random2`/`Random3` sequence — **same number of draws, same order** as `aicult.cpp:159` so it stays faithful), raycast each pellet (`losClear`-style segment vs geometry AND vs the player AABB out to `SHOTGUN.maxRange`); if it reaches the player, `player.hp -= SHOTGUN.pelletDamage`. Set `d.fired = true`. Emit one `{ kind:'cultistFire', x,y,z: muzzle, ang, pitch }`. Reset `d.fired=false` when leaving SFire.

Player AABB: a vertical capsule approximated as an AABB around `player.x/z` (radius ~0.3 m) spanning feet→eye; a pellet "hits the player" if its ray crosses that AABB before any geometry. Add a `rayHitsPlayer(...)` helper.

- [ ] **Step 1: Failing tests** — cultist in SFire at the fire tic with a clear shot at a player directly ahead reduces `player.hp` by `pellets×pelletDamage` worst-case (or ≥1 pellet on a centered target); fires exactly once per SFire visit; RNG-spread is deterministic (same seed → same `player.hp`); a wall between them → no damage.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** the fire + hitscan + `cultistFire` event. Cite `aicult.cpp:159–207`.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(sim): cultist shotgun hitscan + player-as-target damage + cultistFire event"`

---

### Task 6: Tactical states — Dodge, Goto, Search, SThrow, Recoil

**Files:**
- Modify: `src/sim/dude.ts`
- Test: `src/sim/dude.test.ts`

Complete the state machine: **Dodge** (90 tics, `aiMoveDodge`, `dodgeDir` chosen once via `state.rng` `Chance` per `aiChooseDirection`; → Chase), **Goto** (600 tics, `aiMoveForward` toward `targetX/targetZ`; reacquire LOS → Chase; reached/expire → Idle), **Search** (1800 tics, wander/turn; see target → Chase; expire → Idle), **SThrow** (windup → SFire), **Recoil** (→ Dodge). Wire the dodge/throw transitions from `thinkChase` (Task 4 left them as conditions): throw when `throwMin < dist < throwMax` and a `Chance` roll; dodge on the same-type-blocked / post-recoil path. Add an exported `recoilDude(d)` the runner calls when the cosmetic layer reports the cultist was hit (→ Recoil → Dodge), mirroring `cultistRecoil`.

- [ ] **Step 1: Failing tests** — Dodge lasts 90 tics then → Chase; `dodgeDir` deterministic from seed; Goto walks toward last-known then → Idle on expiry; Search → Idle after 1800; `recoilDude` → Recoil→Dodge.
- [ ] **Step 2–4: FAIL → implement (cite `aicult.cpp`/`ai.cpp`) → PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(sim): cultist tactical states (dodge/goto/search/throw/recoil)"`

---

### Task 7: Wire dudes into SimState / step / hash / snapshot / determinism

**Files:**
- Modify: `src/sim/state.ts`, `src/sim/step.ts`, `src/sim/hash.ts`, `src/sim/snapshot.ts`
- Test: `src/sim/step.test.ts`, `src/sim/hash.test.ts`, `src/sim/snapshot.test.ts`, `src/sim/determinism.test.ts`

Mirror exactly how `heads`/`projectiles` were wired (Plan 3/3.5):
- `state.ts`: add `dudes: DudeState[]` to `SimState` + `dudes: []` in `createSimState`.
- `step.ts`: call `stepDudes(state.dudes, state.player, geo, state.rng, state.tic, events)` (after projectiles/heads).
- `hash.ts`: mix every `DudeState` field (x,y,z,vx,vz,ang,goalAng,health,ai,stateTics,hasTarget?1:0,targetX,targetZ,dodgeDir,fired?1:0).
- `snapshot.ts`: `dudes: s.dudes.map((d) => ({ ...d }))`.
- `determinism.test.ts`: in `seededState`, `spawnDude(s.dudes, ...)` so replay/snapshot/divergence cover a dude (and set the player near it so the AI actually runs).

- [ ] **Step 1–4: failing tests (`heads` exists on SimState? mirror those tests for `dudes`) → implement → all `npx vitest run src/sim` green.**
- [ ] **Step 5: Commit.** `git commit -m "feat(sim): wire dudes into SimState/step/hash/snapshot + determinism harness"`

---

### Task 8: Player-as-target explosion damage (fold the deferred unification)

**Files:**
- Modify: `src/sim/step.ts`, `src/sim/player.ts`
- Test: `src/sim/step.test.ts`, `src/sim/player.test.ts`

The dynamite explosion is already a `SimEvent` produced inside `stepProjectiles`. Wire `applyExplosionToPlayer` (already in `explosion.ts`) into `stepSim`: for each explosion event produced this tic, call `applyExplosionToPlayer(state.player, ev.x, ev.y, ev.z, state.rng)`. Clamp `player.hp` at 0 in `player.ts` (and expose deadness if a death/respawn flow is wanted — out of scope; just clamp). This makes explosion-vs-player deterministic; the legacy AOE player-exclusion happens in Task 10 (main.ts drops the `PlayerGibAdapter` registration) so the two don't double-count.

- [ ] **Step 1: Failing test** — a projectile detonating next to the player reduces `player.hp` deterministically; far away → no change; hp clamps at 0.
- [ ] **Step 2–4: FAIL → implement → PASS.**
- [ ] **Step 5: Commit.** `git commit -m "feat(sim): deterministic explosion-vs-player damage (player.hp authoritative)"`

---

### Task 9: Render boundary + runner API

**Files:**
- Modify: `src/sim/render.ts`, `src/sim/runner.ts`
- Test: `src/sim/render.test.ts`, `src/sim/runner.test.ts`

- `render.ts`: `DudeRender { xMeters, yMeters, zMeters, yawRad, ai, health }` + `renderDudes(prev, cur, alpha)` (interpolate position; `lerpAngle` the facing; pass `ai`/`health` from `cur` for the cosmetic anim-state + health bar). Match-by-index (append-only + removed-on-death), same convention as heads.
- `runner.ts`: `spawnDude(xM, zM, angBlood)`, `dudeRenders()`, `killDude(index)` (sets health 0 / removes — the cosmetic layer calls this when a player weapon kills the cultist), `recoilDude(index)`, and `playerHp(): number` (reads `state.player.hp` for the HUD).

- [ ] **Step 1: Failing tests** — `renderDudes` interpolates to meters + lerps angle; `SimRunner.spawnDude` + `advance` + `dudeRenders()` returns the dude; `playerHp()` reflects damage.
- [ ] **Step 2–4: FAIL → implement → PASS** (`npx vitest run src/sim && npx tsc --noEmit`).
- [ ] **Step 5: Commit.** `git commit -m "feat(sim): dude render interpolation + SimRunner spawnDude/dudeRenders/playerHp"`

---

### Task 10: main.ts cosmetic wiring — sim-driven cultist, fire VFX, player damage, HUD

**Files:**
- Modify: `src/main.ts`, `src/game/enemy/shotgun-cultist.ts`, `src/game/enemy/cultist-ai.ts`

Cosmetic layer (Three/Rapier) — verified by `tsc` + build + playtest, no unit tests. The sim now owns cultist AI/movement/fire/aggro; the legacy `CultistBrain` movement/fire/LOS is retired (keep only the cosmetic anim-state mapping + flare visuals).

- [ ] **Step 1:** When a cultist spawns (the `spawn` hook in `main.ts` ~line 508, and `ZombieCluster.spawnOne`), also `sim.spawnDude(pos.x, pos.z, angle)` and keep the returned dude index alongside the cosmetic `ShotgunCultist`. Stop driving its position from `brain.desiredVelocity()` / the Rapier kinematic body — instead set the cosmetic billboard transform from `sim.dudeRenders()[idx]` each frame (position + facing), and map `DudeRender.ai` → animation (`Idle`→idle, `Chase`/`Goto`/`Search`→chase walk, `SFire`→fire, `Recoil`→recoil, `Dodge`→chase). Mirror the head-billboard sync pattern.
- [ ] **Step 2:** Drain `cultistFire` events → cosmetic muzzle flash + tracer pellets (reuse the existing pellet/tracer VFX as **visual-only**; the damage already happened in-sim) + cultist shotgun SFX. Drain `dudeDeath` → existing death anim + gib spawn. **Remove** the legacy `spawnPellets`/`pelletRegistry` gameplay path and the `onFire`→`spawnPellets` hook (pellets are now sim hitscan; keep only a cosmetic tracer if desired).
- [ ] **Step 3:** Player damage: delete the `playerBody = null` pellet hack (sim hitscan replaces it). HUD: drive the player health display from `sim.playerHp()`. **Exclude the player from the legacy AOE** — drop the `PlayerGibAdapter` `gibs.registerDude` registration (explosion-vs-player is now sim-side via Task 8) so damage isn't double-counted.
- [ ] **Step 4:** When a player weapon kills a cultist (the existing `gibs.spawnExplosion`/flare path calls the cosmetic `ShotgunCultist.takeDamage`), bridge it to the sim: on death call `sim.killDude(idx)`; on a non-lethal hit call `sim.recoilDude(idx)` so the AI reacts (Recoil→Dodge).
- [ ] **Step 5: Verify** — `npx tsc --noEmit`; `npx vitest run src`; `npm run build`. All green.
- [ ] **Step 6: Commit.** `git commit -m "feat(cultist): sim-driven shotgun cultist (AI/fire/aggro) + sim-authoritative player damage"`

---

### Task 11: Playtest gate + docs

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Manual playtest (user).** `npm run dev`. Verify: cultist idles, then **notices you only with real line-of-sight** (hide behind an obstacle → it loses you, goes to your last-known spot, then searches); **chases**; **strafes/dodges**; **fires the shotgun and actually damages you** (HUD health drops); breaking LOS makes it search then give up. Kill it with dynamite → it dies/gibs and the AI stops.
- [ ] **Step 2: Update `TASKS.md`** — flip plan 4 to `✅ DONE (playtest-confirmed)` in the plan-series line; mark `F2.cultist.dodge`, `F2.cultist.search`, `F2.cultist.los` `[x]` (folded into plan 4); note the player-as-target unification landed (remove the "Deferred to restore" caveat for pellet/explosion-vs-player). Leave `F2.cultist.sfx`/`F2.cultist.gibs` open.
- [ ] **Step 3: Commit.** `git commit -m "docs(tasks): plan 4 (shotgun cultist on sim) landed — playtest-confirmed"`

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-06-18-blud-deterministic-core-design.md` §"Shotgun cultist — full NotBlood AI"):
- `Idle → Chase → Dodge → Goto → Search → Fire → Recoil(→Dodge)` → Tasks 4 + 6. ✅
- Real deterministic LOS → Task 2 (`losClear`). ✅
- Movers `aiMoveForward`/`aiMoveDodge`/`aiMoveTurn`; thinkers `thinkChase`/`thinkGoto`/`thinkSearch`/`aiThinkTarget` → Tasks 3 + 4 + 6. ✅
- State durations Dodge 90 / Goto 600 / Search 1800 / SFire 60 → `DUDE_STATES` (Task 1). ✅
- Folds `F2.cultist.*` (dodge/search/los) → Tasks 2/4/6 + Task 11. ✅
- Folds the deferred player-as-target unification (pellet-vs-player + `applyExplosionToPlayer` + legacy AOE player-exclusion) → Tasks 5 + 8 + 10. ✅

**Type consistency:** `DudeState` fields are identical across `dude.ts`, `hash.ts`, `snapshot.ts`, `render.ts`, and tests. `spawnDude(dudes, x, z, _y, ang)` and `runner.spawnDude(xM, zM, angBlood)` signatures are stated once and reused. `stepDudes(dudes, player, geo, rng, tic, out)` is the single driver signature. `cultistFire`/`dudeDeath` event shapes are defined once.

**Placeholder honesty:** the porting-heavy tasks (2/3/4/5/6) intentionally cite exact NotBlood `file:line` and give the algorithm + sim-unit adaptation rather than full line-by-line code — the implementing agent is expected to read the cited source and port it (per this session's directive to exercise the model on the source). All **structural** code (types, constants, SimState/hash/snapshot/render/runner wiring, test scaffolds) is concrete. If an agent is unsure of a value, the `CULTIST`/`SHOTGUN` constants are the calibrated starting point — adjust for feel and note it.

**Risk / watch-items:** (1) Blood movement/turn speeds are in Blood units at Blood's tic rate — like the head kick, calibrate `walkSpeed`/`turnRate`/`sideSpeed` in sim m/s and note deviations from raw `dudeInfo`. (2) LOS Y-axis: arena AABBs are full-height columns, so an XZ slab test suffices; if any obstacle is short, extend to a 3D slab test. (3) Keep the RNG draw count/order in `ShotSeqCallback` faithful so the determinism harness fingerprint is stable.

---

## Execution Handoff

Plan complete and saved. Per this session's decision it ships as **one** plan, executed via **dispatch UI on `zai/glm-5.2:xhigh`** (the dispatching-plans skill converts these 11 tasks into a serial dispatch chain), with each porting task pointing the agent at the NotBlood source for the exact integer math. After dispatch lands, the user playtests (Task 11 gate).
