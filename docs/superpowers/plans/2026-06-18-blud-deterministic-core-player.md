# Deterministic Core — Player on the Sim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the player (movement, look, jump/gravity, wall collision) into the deterministic `src/sim/` core built in plan 1 — preserving Blud's current player *feel*, re-expressed in integer fixed-point Build units — and drive the Three camera from the interpolated sim state. Other systems (enemies, weapons) stay on the legacy 60 Hz path during this strangler step.

**Architecture:** The player becomes a plain record in `SimState`, advanced by a pure per-tic `stepPlayer` inside `stepSim`. Movement uses an integer Blood-angle trig table; collision uses integer axis-separated AABB wall-slide against a sim-geometry that mirrors the arena colliders; vertical motion is gravity + jump with a floor clamp. The render layer interpolates between the previous and current tic and writes the camera transform — the single BU→meters / Blood-angle→radians conversion boundary. A 120 Hz sim accumulator runs alongside the existing 60 Hz legacy loop; `player.position()` becomes a thin adapter over the sim player so legacy AI/weapons keep working. The Rapier kinematic player capsule + character controller are removed.

**Tech Stack:** TypeScript, Vitest, Three.js (render boundary only). No new deps. `src/sim/` stays free of `three`/Rapier/`src/game` imports (the render-lerp helper returns plain numbers; main.ts applies them to the camera).

**Spec:** `docs/superpowers/specs/2026-06-18-blud-deterministic-core-design.md` (implements §5 input model, §7 deterministic geometry, §9 player slice; extends §2 with the fixed-point scheme and §8 harness).

**Plan series:** 1 (foundation+harness) ✅ DONE → **2 (player) ← this** → 3 (dynamite) → 4 (shotgun cultist).

---

## Locked design decisions (rationale)

1. **Player feel = Blud's current feel, re-expressed deterministically.** The player is Blud's own (not a Blood enemy), so we do NOT port Blood's `MoveDude`. We preserve the current constants from `src/game/player.ts`: WALK 6 m/s, RUN 9 m/s (sprint), JUMP 8.5 m/s, GRAVITY 25 m/s², mouse sensitivity 0.0022, EYE_HEIGHT 1.75 m, body radius 0.3 m, pitch limit π/2−0.05. Horizontal velocity is instant (no accel/friction), matching today.
2. **Fixed-point scheme = 16.16 over Build units ("fp").** `value_fp = BU * 65536`; `1 m = 256 BU = 16,777,216 fp`. Position and velocity are integer fp (sub-BU-per-tic velocity needs fractions: 6 m/s = 12.8 BU/tic). One conversion boundary at render. This extends the foundation's integer rule (the foundation's `KinematicBody` used whole-BU integers; the player needs fp — both are integers, just different scales; documented per-field).
3. **Trig = integer Blood-angle table.** Angles in Blood units (2048 = 360°). A 2048-entry cos table scaled to 16.16 (`bcos`/`bsin`), built once at module load by rounding `Math.cos`/`Math.sin` to integers. Rounding makes the table identical across peers in practice (this is what Blood does). NOTE for future cross-platform netcode: if a desync ever traces to trig, bake the table via codegen instead of load-time `Math.cos`.
4. **Aim is input, not physics.** Mouse look is accumulated by the (cosmetic) input sampler into absolute `aimYaw`/`aimPitch` Blood-angle ints inside the per-tic `InputCommand`; the sim just copies them onto the player and uses `yaw` for movement direction. Pitch is clamped in the sampler.
5. **Geometry = integer axis-separated AABB wall-slide.** Sim-geometry mirrors the arena's wall + obstacle colliders as XZ AABBs (floor is a y-clamp at 0). Player is a circle of `BODY_RADIUS`. This replaces the Rapier character controller for the player. Autostep/slope are dropped (the arena is flat with vertical walls/boxes — YAGNI; revisit if levels add ramps).
6. **Two clocks during the strangler step.** Sim player runs at 120 tic/s; legacy enemies/weapons stay on the existing 60 Hz `scheduler`/`fixedStep`. The camera and `player.position()` read the interpolated sim player.

---

## File Structure

New under `src/sim/` (firewall: no `three`/Rapier/`src/game` imports):
- Create `src/sim/fp.ts` — 16.16 fixed-point Build-unit helpers (`mulfp`, conversions to/from BU, meters, m/s).
- Create `src/sim/trig.ts` — Blood-angle trig table (`bcos`, `bsin`, `BANGLE_*`).
- Create `src/sim/geometry.ts` — `SimAABB`, arena sim-geometry builder, `clipMoveXZ` (axis-separated slide with radius).
- Create `src/sim/player.ts` — `PlayerState`, `createPlayerState`, `stepPlayer` (pure).
- Create `src/sim/render.ts` — `renderPlayer(prev, cur, alpha)` → plain camera transform numbers (meters + radians).
- Modify `src/sim/types.ts` — extend `InputCommand` (`aimYaw`, `aimPitch`, add `BTN_JUMP`, `BTN_SPRINT`).
- Modify `src/sim/state.ts` — add `player: PlayerState` to `SimState`.
- Modify `src/sim/step.ts` — call `stepPlayer` from `stepSim`.
- Modify `src/sim/hash.ts` — mix the player fields.
- Modify `src/sim/snapshot.ts` — clone the player.
- Modify `src/sim/determinism.test.ts` — drive the player through a recorded input stream.

App integration (Task 8):
- Modify `src/main.ts` — build sim with a player, 120 Hz sim accumulator, input→`InputCommand` sampler, camera from `renderPlayer`, `player.position()` adapter; remove the Rapier player.
- Delete/retire `src/game/player.ts` (replaced) — keep `src/game/player-motion.ts`? No (superseded by `trig`-based movement); remove its now-dead usage. (Confirm no other importers first.)

**Reusable constant:** `const FP_PER_BU = 65536`, `const BU_PER_METER = 256` (from `units.ts`), so `FP_PER_METER = 16_777_216`, and `metersPerSecToFp(mps) = Math.round(mps * FP_PER_METER / TICS_PER_SEC)`.

---

## Task 1: Fixed-point (16.16 BU) helpers

**Files:**
- Create: `src/sim/fp.ts`
- Test: `src/sim/fp.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/sim/fp.test.ts
import { describe, it, expect } from 'vitest';
import {
  FP_PER_BU, FP_PER_METER,
  fpFromBU, fpToBU, fpFromMeters, fpToMeters, metersPerSecToFp, mulfp,
} from './fp';

describe('fp — 16.16 fixed-point Build units', () => {
  it('scale constants', () => {
    expect(FP_PER_BU).toBe(65536);
    expect(FP_PER_METER).toBe(256 * 65536); // 16,777,216
  });
  it('BU <-> fp', () => {
    expect(fpFromBU(1)).toBe(65536);
    expect(fpToBU(65536)).toBe(1);
    expect(fpToBU(98304)).toBe(1); // 1.5 BU floors to 1 BU
  });
  it('meters <-> fp', () => {
    expect(fpFromMeters(1)).toBe(16_777_216);
    expect(fpToMeters(16_777_216)).toBeCloseTo(1, 9);
    expect(fpToMeters(fpFromMeters(2.5))).toBeCloseTo(2.5, 6);
  });
  it('metersPerSecToFp: 6 m/s ≈ 12.8 BU/tic', () => {
    // 6 m/s * 16,777,216 fp/m / 120 tic = 838860.8 → 838861 fp/tic
    expect(metersPerSecToFp(6)).toBe(838861);
  });
  it('mulfp(a,b) = floor(a*b / 65536) (16.16 multiply, floor not >>)', () => {
    expect(mulfp(fpFromBU(2), fpFromBU(3))).toBe(fpFromBU(6)); // 2*3 = 6 BU
    expect(mulfp(65536, -1)).toBe(-1);                          // floor(-1/1)
    expect(mulfp(-3, 32768)).toBe(-2);                          // floor(-3*0.5)= -1.5 → -2
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/fp.test.ts`
Expected: FAIL — `Cannot find module './fp'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/sim/fp.ts
import { BU_PER_METER, TICS_PER_SEC } from './units';

/** 16.16 fixed-point over Build units: value_fp = BU * 65536. Sim position and
 *  velocity use this so sub-BU-per-tic speeds stay exact integers. Converted to
 *  meters only at the render boundary. Magnitudes stay < 2^31 (arena ≤ ~10240
 *  BU → ~6.7e8 fp), so 32-bit-safe; products use Math.floor div, never `>>`. */
export const FP_PER_BU = 65536;
export const FP_PER_METER = BU_PER_METER * FP_PER_BU; // 16,777,216

export function fpFromBU(bu: number): number { return Math.round(bu * FP_PER_BU); }
export function fpToBU(fp: number): number { return Math.floor(fp / FP_PER_BU); }
export function fpFromMeters(m: number): number { return Math.round(m * FP_PER_METER); }
export function fpToMeters(fp: number): number { return fp / FP_PER_METER; }

/** Convert a real-world m/s speed into fp-per-tic (the sim's velocity unit). */
export function metersPerSecToFp(mps: number): number {
  return Math.round((mps * FP_PER_METER) / TICS_PER_SEC);
}

/** 16.16 multiply: floor(a*b / 2^16). Use for fp×fp (e.g. velocity × cos). */
export function mulfp(a: number, b: number): number {
  return Math.floor((a * b) / FP_PER_BU);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/fp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/fp.ts src/sim/fp.test.ts
git commit -m "feat(sim): 16.16 fixed-point Build-unit helpers (sub-BU velocity)"
```

---

## Task 2: Blood-angle trig table

**Files:**
- Create: `src/sim/trig.ts`
- Test: `src/sim/trig.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/sim/trig.test.ts
import { describe, it, expect } from 'vitest';
import { BANGLE_FULL, BANGLE_QUARTER, bcos, bsin } from './trig';
import { FP_PER_BU } from './fp';

describe('trig — Blood-angle table (2048 units = 360°), 16.16 output', () => {
  it('angle constants', () => {
    expect(BANGLE_FULL).toBe(2048);
    expect(BANGLE_QUARTER).toBe(512);
  });
  it('bcos(0)=1.0, bsin(0)=0', () => {
    expect(bcos(0)).toBe(FP_PER_BU);   // 65536 == 1.0 in 16.16
    expect(bsin(0)).toBe(0);
  });
  it('bcos(quarter)≈0, bsin(quarter)≈1.0', () => {
    expect(Math.abs(bcos(BANGLE_QUARTER))).toBeLessThan(4); // ~0 within rounding
    expect(Math.abs(bsin(BANGLE_QUARTER) - FP_PER_BU)).toBeLessThan(4);
  });
  it('wraps the angle (negative and >2048)', () => {
    expect(bcos(-BANGLE_FULL)).toBe(bcos(0));
    expect(bsin(BANGLE_FULL + BANGLE_QUARTER)).toBe(bsin(BANGLE_QUARTER));
  });
  it('matches Math.cos/sin within rounding tolerance across the circle', () => {
    for (let a = 0; a < 2048; a += 17) {
      const rad = (a / 2048) * Math.PI * 2;
      expect(bcos(a) / FP_PER_BU).toBeCloseTo(Math.cos(rad), 3);
      expect(bsin(a) / FP_PER_BU).toBeCloseTo(Math.sin(rad), 3);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/trig.test.ts`
Expected: FAIL — `Cannot find module './trig'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/sim/trig.ts
import { FP_PER_BU } from './fp';

/** Blood angle units: a full turn is 2048. */
export const BANGLE_FULL = 2048;
export const BANGLE_QUARTER = 512;

/**
 * cos/sin tables in 16.16 fixed-point (65536 = 1.0), indexed by Blood angle.
 * Built once at load by rounding Math.cos/sin to integers — the rounding makes
 * the table identical across peers in practice (this is what Blood does). If a
 * future cross-platform desync ever traces here, bake the table via codegen.
 */
const COS: Int32Array = (() => {
  const t = new Int32Array(BANGLE_FULL);
  for (let i = 0; i < BANGLE_FULL; i++) {
    t[i] = Math.round(Math.cos((i / BANGLE_FULL) * Math.PI * 2) * FP_PER_BU);
  }
  return t;
})();

function wrap(a: number): number {
  return ((a % BANGLE_FULL) + BANGLE_FULL) % BANGLE_FULL;
}

/** cos(angle) in 16.16. */
export function bcos(angle: number): number { return COS[wrap(angle)]!; }
/** sin(angle) in 16.16 — sin(a) = cos(a - 90°) = cos(a - 512). */
export function bsin(angle: number): number { return COS[wrap(angle - BANGLE_QUARTER)]!; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/trig.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/trig.ts src/sim/trig.test.ts
git commit -m "feat(sim): Blood-angle trig table (bcos/bsin, 16.16 output)"
```

---

## Task 3: Extend InputCommand (aim + jump/sprint)

**Files:**
- Modify: `src/sim/types.ts`
- Test: `src/sim/types.test.ts` (extend)

- [ ] **Step 1: Extend the failing test**

Add these cases inside the existing `describe('sim core types', ...)` block in `src/sim/types.test.ts`:

```typescript
  it('EMPTY_INPUT includes neutral aim and no buttons', () => {
    expect(EMPTY_INPUT).toEqual({
      moveForward: 0, moveStrafe: 0, aimYaw: 0, aimPitch: 0, buttons: 0,
    });
  });
  it('jump and sprint button bits are distinct', () => {
    expect(BTN_JUMP).toBe(4);
    expect(BTN_SPRINT).toBe(8);
    expect(BTN_FIRE & BTN_JUMP & BTN_SPRINT).toBe(0);
  });
```

Update the existing `EMPTY_INPUT` assertion test (the one currently expecting `{moveForward,moveStrafe,aimAngle,buttons}`) and the `InputCommand` example test to use `aimYaw`/`aimPitch` instead of `aimAngle`. Also add the import of `BTN_JUMP, BTN_SPRINT` at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/types.test.ts`
Expected: FAIL — `aimYaw`/`BTN_JUMP` not exported / shape mismatch.

- [ ] **Step 3: Update the implementation**

In `src/sim/types.ts`, replace the `InputCommand` interface, `EMPTY_INPUT`, and button constants with:

```typescript
/** Per-tic input — the ONLY thing a future lockstep transport sends. Aim is
 *  absolute Blood angle [0, 2048); the input sampler accumulates mouse delta and
 *  clamps pitch before quantizing into these per-tic values. */
export interface InputCommand {
  moveForward: number; // -1 | 0 | 1
  moveStrafe: number;  // -1 | 0 | 1
  aimYaw: number;      // absolute Blood angle units [0, 2048)
  aimPitch: number;    // absolute Blood angle units, clamped to the pitch limit
  buttons: number;     // bitfield of BTN_*
}

export const BTN_FIRE = 1 << 0;
export const BTN_SWITCH = 1 << 1;
export const BTN_JUMP = 1 << 2;
export const BTN_SPRINT = 1 << 3;

export const EMPTY_INPUT: InputCommand = {
  moveForward: 0, moveStrafe: 0, aimYaw: 0, aimPitch: 0, buttons: 0,
};
```

Leave `KinematicBody` and `SimEvent` unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/types.ts src/sim/types.test.ts
git commit -m "feat(sim): extend InputCommand with aimYaw/aimPitch + jump/sprint"
```

---

## Task 4: Sim geometry + integer wall-slide

**Files:**
- Create: `src/sim/geometry.ts`
- Test: `src/sim/geometry.test.ts`

Background: the arena (`src/game/arena.ts`) has, in METERS: a 40×40 floor (top at y=0), four perimeter walls (thickness 0.5, centered at x=±20 and z=±20, length 40+0.5), and an obstacle list. The sim-geometry mirrors the wall + obstacle colliders as XZ AABBs (full height ⇒ ignore Y for the wall test); the floor is handled as a y-clamp in the player step, not here.

- [ ] **Step 1: Write the failing test**

```typescript
// src/sim/geometry.test.ts
import { describe, it, expect } from 'vitest';
import { type SimAABB, clipMoveXZ } from './geometry';
import { fpFromMeters } from './fp';

// A single wall AABB occupying x ∈ [5,6] m (full z range for the test).
function wallAt(minXm: number, maxXm: number, minZm: number, maxZm: number): SimAABB {
  return {
    minX: fpFromMeters(minXm), maxX: fpFromMeters(maxXm),
    minZ: fpFromMeters(minZm), maxZ: fpFromMeters(maxZm),
  };
}

describe('clipMoveXZ — axis-separated wall slide (radius-aware)', () => {
  const r = fpFromMeters(0.3); // player radius
  const wall = [wallAt(5, 6, -10, 10)];

  it('passes through open space unchanged', () => {
    const from = { x: fpFromMeters(0), z: fpFromMeters(0) };
    const out = clipMoveXZ(from, fpFromMeters(1), 0, r, wall);
    expect(out.x).toBe(fpFromMeters(1));
    expect(out.z).toBe(0);
  });

  it('stops at a wall when moving into it on X (blocked, with radius gap)', () => {
    const from = { x: fpFromMeters(4), z: fpFromMeters(0) };
    // try to move +2m in X (to x=6), into the wall at x=5; should stop at 5 - r.
    const out = clipMoveXZ(from, fpFromMeters(2), 0, r, wall);
    expect(out.x).toBe(fpFromMeters(5) - r);
    expect(out.z).toBe(0);
  });

  it('slides along the wall: blocked X, free Z', () => {
    const from = { x: fpFromMeters(4), z: fpFromMeters(0) };
    const out = clipMoveXZ(from, fpFromMeters(2), fpFromMeters(3), r, wall);
    expect(out.x).toBe(fpFromMeters(5) - r); // X blocked
    expect(out.z).toBe(fpFromMeters(3));     // Z slides freely
  });

  it('is deterministic / order-independent across multiple AABBs', () => {
    const walls = [wallAt(5, 6, -10, 10), wallAt(-6, -5, -10, 10)];
    const a = clipMoveXZ({ x: 0, z: 0 }, fpFromMeters(10), 0, r, walls);
    const b = clipMoveXZ({ x: 0, z: 0 }, fpFromMeters(10), 0, r, [...walls].reverse());
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/geometry.test.ts`
Expected: FAIL — `Cannot find module './geometry'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/sim/geometry.ts
import { fpFromMeters } from './fp';

/** XZ-plane axis-aligned box in fp units. Walls/obstacles are full-height, so
 *  only the XZ footprint matters for the player's horizontal clip. */
export interface SimAABB {
  minX: number; maxX: number; minZ: number; maxZ: number;
}

interface PtXZ { x: number; z: number; }

/**
 * Move `from` by (dx, dz) fp, sliding against `boxes` with a circle of `radius`.
 * Axis-separated (Build/Doom-style clipmove): resolve X first, then Z, so a
 * diagonal move into a wall slides along it. Deterministic and order-independent
 * (each axis clamps to the nearest blocking edge). Returns the new fp position.
 *
 * Approximation: treats the player as an AABB of half-extent `radius` (square,
 * not circle). Fine for axis-aligned arena geometry; revisit for diagonal walls.
 */
export function clipMoveXZ(
  from: PtXZ, dx: number, dz: number, radius: number, boxes: SimAABB[],
): PtXZ {
  let x = from.x;
  let z = from.z;

  // — X axis —
  let nx = x + dx;
  for (const b of boxes) {
    // overlap in Z (expanded by radius)?
    if (z + radius <= b.minZ || z - radius >= b.maxZ) continue;
    if (dx > 0 && x + radius <= b.minX && nx + radius > b.minX) nx = b.minX - radius;
    else if (dx < 0 && x - radius >= b.maxX && nx - radius < b.maxX) nx = b.maxX + radius;
  }
  x = nx;

  // — Z axis (using the already-resolved x) —
  let nz = z + dz;
  for (const b of boxes) {
    if (x + radius <= b.minX || x - radius >= b.maxX) continue;
    if (dz > 0 && z + radius <= b.minZ && nz + radius > b.minZ) nz = b.minZ - radius;
    else if (dz < 0 && z - radius >= b.maxZ && nz - radius < b.maxZ) nz = b.maxZ + radius;
  }
  z = nz;

  return { x, z };
}

/**
 * Build the arena sim-geometry (XZ AABBs in fp) mirroring the wall + obstacle
 * colliders in src/game/arena.ts. Keep these values in sync with that file; the
 * floor is NOT included here (handled as a y-clamp in the player step).
 *
 * Arena (meters): floorSize 40, wallThick 0.5, walls centered at ±20.
 */
export function buildArenaGeometry(): SimAABB[] {
  const boxFromCenter = (cx: number, cz: number, sx: number, sz: number): SimAABB => ({
    minX: fpFromMeters(cx - sx / 2), maxX: fpFromMeters(cx + sx / 2),
    minZ: fpFromMeters(cz - sz / 2), maxZ: fpFromMeters(cz + sz / 2),
  });
  const floorSize = 40, wallThick = 0.5;
  const wallLen = floorSize + wallThick;
  return [
    // perimeter walls: [centerX, centerZ, sizeX, sizeZ]
    boxFromCenter(0, -floorSize / 2, wallLen, wallThick),
    boxFromCenter(0,  floorSize / 2, wallLen, wallThick),
    boxFromCenter(-floorSize / 2, 0, wallThick, wallLen),
    boxFromCenter( floorSize / 2, 0, wallThick, wallLen),
    // obstacles — MIRROR the `obstacles` list in src/game/arena.ts (Task note:
    // the implementer must copy the exact obstacle [sx,sz,px,pz] values from
    // arena.ts lines ~104-108 here; see Task 4 Step 3b).
  ];
}
```

- [ ] **Step 3b: Mirror the arena obstacle list**

Open `src/game/arena.ts`, find the `obstacles` array (the `Array<[sx,sy,sz,px,py,pz]>` near line 104). For each obstacle, append a `boxFromCenter(px, pz, sx, sz)` to the return array in `buildArenaGeometry` (use the X/Z size and X/Z position; ignore Y). Add a comment citing the arena.ts line. If the obstacle list is empty, leave only the four walls and note it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/geometry.ts src/sim/geometry.test.ts
git commit -m "feat(sim): integer arena geometry + axis-separated wall-slide clip"
```

---

## Task 5: Player state + pure stepPlayer

**Files:**
- Create: `src/sim/player.ts`
- Modify: `src/sim/state.ts` (add `player`), `src/sim/step.ts` (call `stepPlayer`)
- Test: `src/sim/player.test.ts`

Constants (ported from `src/game/player.ts`, converted to fp via `metersPerSecToFp`):
- WALK 6 m/s, RUN 9 m/s, JUMP 8.5 m/s, GRAVITY 25 m/s² (per-tic Δv = `metersPerSecToFp(25 / TICS_PER_SEC)`), radius 0.3 m, pitch limit handled in the sampler. Diagonal normalization factor = `Math.round(0.70710678 * FP_PER_BU)` = 46341.

- [ ] **Step 1: Write the failing test**

```typescript
// src/sim/player.test.ts
import { describe, it, expect } from 'vitest';
import { createSimState } from './state';
import { stepSim } from './step';
import { buildArenaGeometry } from './geometry';
import { fpToMeters, metersPerSecToFp } from './fp';
import { EMPTY_INPUT, BTN_JUMP, type InputCommand } from './types';
import { BANGLE_QUARTER } from './trig';

const geo = buildArenaGeometry();

function cmd(over: Partial<InputCommand>): InputCommand { return { ...EMPTY_INPUT, ...over }; }

describe('stepPlayer (via stepSim)', () => {
  it('starts at spawn, grounded, not moving', () => {
    const s = createSimState(1);
    expect(s.player.vy).toBe(0);
    expect(s.player.grounded).toBe(true);
  });

  it('moves forward along -Z at WALK speed when yaw=0', () => {
    const s = createSimState(1);
    stepSim(s, cmd({ moveForward: 1, aimYaw: 0 }), geo);
    // yaw 0, forward → local -Z; after one tic, z decreases by ~WALK/tic.
    expect(s.player.z).toBeLessThan(0);
    expect(Math.abs(s.player.x)).toBeLessThan(10); // no X drift
    const perTic = fpToMeters(metersPerSecToFp(6));
    expect(fpToMeters(s.player.z)).toBeCloseTo(-perTic, 4);
  });

  it('yaw rotates the movement direction (yaw=quarter → forward turns to -X or +X)', () => {
    const s = createSimState(1);
    stepSim(s, cmd({ moveForward: 1, aimYaw: BANGLE_QUARTER }), geo);
    expect(Math.abs(s.player.x)).toBeGreaterThan(0); // now moving along X
  });

  it('sprint uses RUN speed', () => {
    const walk = createSimState(1); stepSim(walk, cmd({ moveForward: 1 }), geo);
    const run = createSimState(1); stepSim(run, cmd({ moveForward: 1, buttons: 1 << 3 /*BTN_SPRINT*/ }), geo);
    expect(Math.abs(run.player.z)).toBeGreaterThan(Math.abs(walk.player.z));
  });

  it('gravity pulls down and the floor clamps feet to y=0', () => {
    const s = createSimState(1);
    s.player.y = metersPerSecToFp(0) + 16_777_216 * 3; // start 3 m up (fp meters)
    s.player.grounded = false;
    for (let i = 0; i < 240; i++) stepSim(s, EMPTY_INPUT, geo); // 2 s of fall
    expect(s.player.y).toBe(0);          // clamped to floor
    expect(s.player.vy).toBe(0);
    expect(s.player.grounded).toBe(true);
  });

  it('jump launches up then returns to the floor', () => {
    const s = createSimState(1);
    stepSim(s, cmd({ buttons: BTN_JUMP }), geo); // press jump (edge)
    expect(s.player.vy).toBeGreaterThan(0);
    expect(s.player.grounded).toBe(false);
    for (let i = 0; i < 240; i++) stepSim(s, EMPTY_INPUT, geo);
    expect(s.player.grounded).toBe(true);  // landed
    expect(s.player.y).toBe(0);
  });

  it('cannot move through a perimeter wall (clamped inside the arena)', () => {
    const s = createSimState(1);
    for (let i = 0; i < 600; i++) stepSim(s, cmd({ moveForward: 1, aimYaw: 0 }), geo); // run at -Z wall
    // wall inner face ≈ -20 + wallThick/2; player radius 0.3 keeps it short of it.
    expect(fpToMeters(s.player.z)).toBeGreaterThan(-20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/player.test.ts`
Expected: FAIL — `Cannot find module './player'` / `stepSim` arity.

- [ ] **Step 3: Write `src/sim/player.ts`**

```typescript
// src/sim/player.ts
import { metersPerSecToFp, mulfp, FP_PER_BU } from './fp';
import { bcos, bsin } from './trig';
import { clipMoveXZ, type SimAABB } from './geometry';
import { BTN_JUMP, BTN_SPRINT, type InputCommand } from './types';

/** Plain-data player record inside SimState. Position in fp (16.16 BU); y is the
 *  FEET height (floor = 0). yaw/pitch are absolute Blood angles copied from input. */
export interface PlayerState {
  x: number; y: number; z: number; // fp
  vy: number;                      // fp/tic (vertical only; horizontal is instant)
  yaw: number; pitch: number;      // Blood angle units
  grounded: boolean;
  prevButtons: number;             // for deterministic jump edge-detection
}

export function createPlayerState(): PlayerState {
  return { x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0, grounded: true, prevButtons: 0 };
}

const WALK = metersPerSecToFp(6);
const RUN = metersPerSecToFp(9);
const JUMP_VY = metersPerSecToFp(8.5);
const GRAVITY_DV = metersPerSecToFp(25 / 120); // Δvy per tic (25 m/s² at 120 tic/s)
const RADIUS = Math.round(0.3 * 256 * FP_PER_BU); // 0.3 m in fp
const DIAG = Math.round(0.70710678 * FP_PER_BU);  // 1/√2 in 16.16

/** Advance the player one tic. Pure: mutates `p`, reads `cmd` + `geo`. */
export function stepPlayer(p: PlayerState, cmd: InputCommand, geo: SimAABB[]): void {
  // — Look: aim is input —
  p.yaw = cmd.aimYaw;
  p.pitch = cmd.aimPitch;

  // — Horizontal: instant velocity in the yaw frame —
  // local axes: +X = strafe right, -Z = forward (matches movement-direction conv).
  let lx = cmd.moveStrafe;
  let lz = -cmd.moveForward;
  if (lx !== 0 && lz !== 0) { lx = lx * DIAG; lz = lz * DIAG; } // normalize diagonal (×1/√2, in 16.16)
  else { lx = lx * FP_PER_BU; lz = lz * FP_PER_BU; }            // unit in 16.16
  // rotate (lx, lz) by yaw: world = R(yaw)·local
  const cos = bcos(p.yaw), sin = bsin(p.yaw);
  const wx = mulfp(lx, cos) + mulfp(lz, sin);
  const wz = -mulfp(lx, sin) + mulfp(lz, cos);
  const speed = (cmd.buttons & BTN_SPRINT) ? RUN : WALK;
  const dx = mulfp(wx, speed);
  const dz = mulfp(wz, speed);

  const moved = clipMoveXZ({ x: p.x, z: p.z }, dx, dz, RADIUS, geo);
  p.x = moved.x; p.z = moved.z;

  // — Vertical: jump (edge-triggered) + gravity + floor clamp —
  const jumpPressed = (cmd.buttons & BTN_JUMP) && !(p.prevButtons & BTN_JUMP);
  if (p.grounded && jumpPressed) { p.vy = JUMP_VY; p.grounded = false; }
  p.vy -= GRAVITY_DV;
  p.y += p.vy;
  if (p.y <= 0) { p.y = 0; p.vy = 0; p.grounded = true; }

  p.prevButtons = cmd.buttons;
}
```

- [ ] **Step 3b: Wire `player` into `SimState` and `stepSim`**

In `src/sim/state.ts`:
```typescript
import { createRng, type SimRng } from './rng';
import type { KinematicBody } from './types';
import { createPlayerState, type PlayerState } from './player';

export interface SimState {
  tic: number;
  rng: SimRng;
  bodies: KinematicBody[];
  player: PlayerState;
}

export function createSimState(seed: number): SimState {
  return { tic: 0, rng: createRng(seed), bodies: [], player: createPlayerState() };
}
```

In `src/sim/step.ts` — change the signature to accept geometry and call `stepPlayer`:
```typescript
import type { SimState } from './state';
import type { InputCommand, SimEvent } from './types';
import { stepPlayer } from './player';
import type { SimAABB } from './geometry';

export function stepSim(state: SimState, input: InputCommand, geo: SimAABB[]): SimEvent[] {
  state.tic++;
  stepPlayer(state.player, input, geo);
  for (const b of state.bodies) { b.x += b.vx; b.y += b.vy; b.z += b.vz; }
  return [];
}
```

- [ ] **Step 3c: Fix the existing step.test.ts for the new `stepSim` arity**

`src/sim/step.test.ts` calls `stepSim(s, EMPTY_INPUT)`. Add a geometry arg. At the top: `import { buildArenaGeometry } from './geometry';` and `const GEO = buildArenaGeometry();`, then pass `GEO` as the third arg in every `stepSim(...)` call in that file. (The body-integration assertions still hold — the player starts at origin, grounded; bodies integrate as before. If the "integrates each body" test now also advances the player, that's fine — it asserts on `s.bodies[0]`, not the player.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/player.test.ts src/sim/step.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/sim/player.ts src/sim/state.ts src/sim/step.ts src/sim/step.test.ts src/sim/player.test.ts
git commit -m "feat(sim): deterministic player — move/look/jump/gravity + wall-slide"
```

---

## Task 6: hash + snapshot cover the player; render interpolation

**Files:**
- Modify: `src/sim/hash.ts`, `src/sim/snapshot.ts`
- Create: `src/sim/render.ts`
- Test: `src/sim/render.test.ts`, extend `src/sim/hash.test.ts`

- [ ] **Step 1: Write the failing tests**

Extend `src/sim/hash.test.ts` — add inside `describe('hashSimState', ...)`:
```typescript
  it('changes when the player position differs', () => {
    const a = createSimState(5);
    const b = createSimState(5);
    b.player.x = 1234;
    expect(hashSimState(a)).not.toBe(hashSimState(b));
  });
```

Create `src/sim/render.test.ts`:
```typescript
// src/sim/render.test.ts
import { describe, it, expect } from 'vitest';
import { createPlayerState } from './player';
import { renderPlayer } from './render';
import { fpFromMeters } from './fp';
import { BANGLE_QUARTER } from './trig';

describe('renderPlayer — interpolated camera transform (render boundary)', () => {
  it('lerps position between prev and cur by alpha, in meters', () => {
    const prev = createPlayerState();
    const cur = createPlayerState();
    cur.x = fpFromMeters(2); // moved 2 m in X
    const out = renderPlayer(prev, cur, 0.5);
    expect(out.xMeters).toBeCloseTo(1, 6); // halfway
  });
  it('eye is feet + EYE_HEIGHT', () => {
    const p = createPlayerState(); // feet y = 0
    const out = renderPlayer(p, p, 1);
    expect(out.eyeYMeters).toBeCloseTo(1.75, 6);
  });
  it('converts Blood-angle yaw to radians', () => {
    const prev = createPlayerState();
    const cur = createPlayerState();
    cur.yaw = BANGLE_QUARTER; // 90°
    const out = renderPlayer(cur, cur, 1);
    expect(out.yawRad).toBeCloseTo(Math.PI / 2, 4);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/sim/render.test.ts`
Expected: FAIL — `Cannot find module './render'`.

- [ ] **Step 3: Implement**

`src/sim/render.ts`:
```typescript
// src/sim/render.ts
import { fpToMeters } from './fp';
import { bloodAngleToRadians } from './units';
import type { PlayerState } from './player';

const EYE_HEIGHT_M = 1.75; // eye above feet (matches the legacy player feel)

export interface PlayerRender {
  xMeters: number; zMeters: number; eyeYMeters: number;
  yawRad: number; pitchRad: number;
}

/** Shortest-arc lerp of a Blood angle (handles 2048 wraparound). */
function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + 1024 + 2048) % 2048) - 1024; // [-1024, 1024)
  return a + d * t;
}

/** Interpolate the player between the previous and current tic for smooth
 *  rendering, and convert to meters/radians. This is the sim→render boundary. */
export function renderPlayer(prev: PlayerState, cur: PlayerState, alpha: number): PlayerRender {
  const lx = prev.x + (cur.x - prev.x) * alpha;
  const ly = prev.y + (cur.y - prev.y) * alpha;
  const lz = prev.z + (cur.z - prev.z) * alpha;
  const feetY = fpToMeters(ly);
  return {
    xMeters: fpToMeters(lx),
    zMeters: fpToMeters(lz),
    eyeYMeters: feetY + EYE_HEIGHT_M,
    yawRad: bloodAngleToRadians(lerpAngle(prev.yaw, cur.yaw, alpha)),
    pitchRad: bloodAngleToRadians(lerpAngle(prev.pitch, cur.pitch, alpha)),
  };
}
```

`src/sim/hash.ts` — add player mixing after the bodies loop:
```typescript
  const p = s.player;
  mix(p.x); mix(p.y); mix(p.z); mix(p.vy);
  mix(p.yaw); mix(p.pitch); mix(p.grounded ? 1 : 0); mix(p.prevButtons);
```

`src/sim/snapshot.ts` — clone the player:
```typescript
  return {
    tic: s.tic,
    rng: { a: s.rng.a },
    bodies: s.bodies.map((b) => ({ ...b })),
    player: { ...s.player },
  };
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/sim/render.test.ts src/sim/hash.test.ts src/sim/snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/render.ts src/sim/render.test.ts src/sim/hash.ts src/sim/hash.test.ts src/sim/snapshot.ts
git commit -m "feat(sim): player in hash/snapshot + renderPlayer interpolation boundary"
```

---

## Task 7: Extend the determinism harness to drive the player

**Files:**
- Modify: `src/sim/determinism.test.ts`

- [ ] **Step 1: Update the harness**

In `src/sim/determinism.test.ts`:
- Import `buildArenaGeometry` from `./geometry` and `BTN_JUMP, BTN_SPRINT` from `./types`; build `const GEO = buildArenaGeometry();`.
- Update `recordedInputs` to produce the new `InputCommand` shape AND exercise the player every tic:
```typescript
function recordedInputs(n: number): InputCommand[] {
  const out: InputCommand[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      moveForward: (i % 3) - 1,
      moveStrafe: (i % 5 < 2) ? 1 : -1,
      aimYaw: (i * 37) % 2048,
      aimPitch: ((i * 13) % 400) - 200,
      buttons: (i % 47 === 0 ? BTN_JUMP : 0) | (i % 3 === 0 ? BTN_SPRINT : 0),
    });
  }
  return out;
}
```
- Pass `GEO` as the third arg to every `stepSim(...)` call in the file.
- Remove the now-obsolete RNG-in-step note comment block at the top (the player still doesn't draw RNG, but it now does real input-driven integer movement + collision + jump, so the harness genuinely proves player determinism). Replace it with a one-line note: `// Harness proves player move/look/jump/collision determinism; RNG-in-step arrives with weapons (plan 3) — extend then.`

The four existing assertions (identical-hash-every-tic, replay, snapshot-resume, seed-divergence) stay — they now cover the player.

- [ ] **Step 2: Run the harness + full gate**

Run: `npx vitest run src/sim/determinism.test.ts`
Expected: PASS (4 cases, now driving the player). If "identical hash every tic" fails, there's nondeterminism in the player step (float creep, unstable geometry iteration) — fix it, don't mask it.

Run: `npx tsc --noEmit && npx vitest run --exclude '**/.claude/**'`
Expected: tsc clean; all `src/sim/*` + app suites green.

- [ ] **Step 3: Commit**

```bash
git add src/sim/determinism.test.ts
git commit -m "test(sim): determinism harness drives the player (move/look/jump/collision)"
```

---

## Task 8: Wire the sim player into the app (integration + playtest)

**Files:**
- Modify: `src/main.ts`
- Retire: `src/game/player.ts` (after confirming no remaining importers besides main.ts)

This task replaces the Rapier kinematic player with the sim player and drives the camera from interpolated sim state. It is integration glue — verify by manual playtest (the determinism is already proven by Task 7). Keep the legacy 60 Hz `scheduler`/`fixedStep` for enemies/weapons unchanged.

- [ ] **Step 1: Add a sim player runner module**

Create `src/sim/runner.ts` — a thin, render-side driver that owns the SimState, samples input, steps at 120 Hz, and exposes interpolation. (This file MAY import `three` only for the input/Vector types? No — keep it pure: it returns plain numbers; main.ts touches three.)

```typescript
// src/sim/runner.ts
import { createSimState, type SimState } from './state';
import { stepSim } from './step';
import { cloneSimState } from './snapshot';
import { buildArenaGeometry } from './geometry';
import { renderPlayer, type PlayerRender } from './render';
import { EMPTY_INPUT, type InputCommand } from './types';
import { fpFromMeters } from './fp';
import { TICS_PER_SEC } from './units';

const SIM_DT = 1 / TICS_PER_SEC;

export class SimRunner {
  private state: SimState;
  private prev: SimState;
  private geo = buildArenaGeometry();
  private accumulator = 0;

  constructor(seed: number, spawnXMeters: number, spawnZMeters: number) {
    this.state = createSimState(seed);
    this.state.player.x = fpFromMeters(spawnXMeters);
    this.state.player.z = fpFromMeters(spawnZMeters);
    this.prev = cloneSimState(this.state);
  }

  /** Advance by real elapsed seconds, stepping the sim in fixed 120 Hz ticks.
   *  `nextInput()` is called once per tic to get that tic's command. */
  advance(realDt: number, nextInput: () => InputCommand): void {
    this.accumulator += realDt;
    let steps = 0;
    while (this.accumulator >= SIM_DT && steps < 5) {
      this.prev = cloneSimState(this.state);
      stepSim(this.state, nextInput(), this.geo);
      this.accumulator -= SIM_DT;
      steps++;
    }
    if (steps >= 5) this.accumulator = 0; // avoid spiral of death
  }

  /** Interpolated player transform for the camera (alpha from the accumulator). */
  playerRender(): PlayerRender {
    const alpha = this.accumulator / SIM_DT;
    return renderPlayer(this.prev.player, this.state.player, alpha);
  }
}
```

- [ ] **Step 2: Add an input sampler in main.ts**

In `src/main.ts`, add a function that converts the live `InputState` into a per-tic `InputCommand`, accumulating mouse delta into absolute Blood-angle aim with the pitch clamp. Place near the other input wiring. (`MOUSE_SENSITIVITY` 0.0022 rad/count from player.ts; convert rad→Blood units: `* 2048 / (2π)`.)

```typescript
// near top-level imports
import { SimRunner } from './sim/runner';
import { EMPTY_INPUT, BTN_FIRE, BTN_JUMP, BTN_SPRINT, type InputCommand } from './sim/types';

// after `input` is created:
const RAD_TO_BANGLE = 2048 / (Math.PI * 2);
const MOUSE_SENS_BANGLE = 0.0022 * RAD_TO_BANGLE;
const PITCH_LIMIT_BANGLE = Math.round(((Math.PI / 2 - 0.05) * RAD_TO_BANGLE));
let aimYaw = 0;        // accumulated absolute Blood angle
let aimPitch = 0;
function sampleInput(): InputCommand {
  const { dx, dy } = input.consumeMouseDelta();
  aimYaw = Math.round(((aimYaw - dx * MOUSE_SENS_BANGLE) % 2048 + 2048) % 2048);
  aimPitch = Math.round(aimPitch - dy * MOUSE_SENS_BANGLE);
  if (aimPitch > PITCH_LIMIT_BANGLE) aimPitch = PITCH_LIMIT_BANGLE;
  if (aimPitch < -PITCH_LIMIT_BANGLE) aimPitch = -PITCH_LIMIT_BANGLE;
  let buttons = 0;
  if (input.isDown('Space')) buttons |= BTN_JUMP;
  if (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) buttons |= BTN_SPRINT;
  return {
    moveForward: (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0),
    moveStrafe: (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0),
    aimYaw, aimPitch, buttons,
  };
}
```

NOTE on jump edge-detection: the sim player edge-detects `BTN_JUMP` via `prevButtons`, so holding Space yields one jump per ground contact — correct. Mouse-delta consumption: `consumeMouseDelta()` drains the accumulator; call `sampleInput` exactly once per sim tic. With multiple ticks per frame the 2nd+ ticks see zero mouse delta (fine — aim just doesn't advance further that frame).

- [ ] **Step 3: Replace the player with the sim runner**

In `src/main.ts`:
1. Remove `import { createPlayer } from './game/player';` and the `const player = createPlayer({...})` block (~line 173).
2. Create the runner at the same spot: `const sim = new SimRunner(0xb1d, 0, 0);` (spawn at arena center; the old spawn was `(0,2,0)` — y is feet=0 now).
3. Build a `player` adapter object preserving the `.position()` interface legacy code uses:
```typescript
const player = {
  position(): THREE.Vector3 {
    const r = sim.playerRender();
    return new THREE.Vector3(r.xMeters, r.eyeYMeters, r.zMeters);
  },
};
```
   (Legacy callers use `player.position()` for enemy aim + weapon origin; eye-height position matches what the old `position()` returned closely enough. If any caller needs feet, add a `.feet()` later.)
4. In `fixedStep` (~line 630), remove the `player.update(dt, input)` call (the sim now owns the player). Leave the rest of `fixedStep` (weapons, cluster, flares, pellets, waveRunner) unchanged.
5. In the restart handler (~line 324) replace `player.update(0, input)` with resetting the runner: recreate `sim` (or add a `sim.reset(x,z)` method) so restart returns the player to spawn.
6. In the `setRenderCallback((realDt) => {...})` body (~line 718), BEFORE `scheduler.tick(...)`, advance + apply the sim:
```typescript
sim.advance(realDt, sampleInput);
const pr = sim.playerRender();
camera.position.set(pr.xMeters, pr.eyeYMeters, pr.zMeters);
camera.rotation.order = 'YXZ';
camera.rotation.set(pr.pitchRad, pr.yawRad, 0);
```
   Keep the existing cosmetic updates (particles, chunks, hud, screenshake) — but note the camera is now set from `pr` each frame; if `shake.sampleOffset` is added to the camera afterward, apply it after the `camera.position.set` above (preserve existing screenshake behavior by adding the offset to `pr` values).

- [ ] **Step 4: Verify build + typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run --exclude '**/.claude/**'`
Expected: tsc clean; all tests green. Fix any remaining references to the removed `createPlayer`/`player.update`.

Run: `npx vite build`
Expected: build succeeds.

- [ ] **Step 5: Manual playtest (determinism is already unit-proven; this verifies feel + integration)**

Start the dev server (`npx vite`), open the arena, and confirm:
- WASD moves at the right speed; sprint (Shift) is faster; mouse-look yaw/pitch feels like before; pitch clamps.
- Jump (Space) launches and lands; gravity feels like before.
- You cannot walk through the perimeter walls or obstacles; movement slides along them.
- Camera is smooth (interpolation working — no 120 Hz stutter at 60/144 fps display).
- Enemies still track the player; weapons still fire from the right spot (legacy systems reading `player.position()`).

If feel is off, the knobs are the constants in `src/sim/player.ts` (WALK/RUN/JUMP/GRAVITY) and `MOUSE_SENS_BANGLE`/`PITCH_LIMIT_BANGLE` in main.ts.

- [ ] **Step 6: Commit**

```bash
git add src/sim/runner.ts src/main.ts
git rm src/game/player.ts   # only if no other importers remain (grep first)
git commit -m "feat(sim): drive player+camera from the deterministic sim (retire Rapier player)"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** §5 input model → Tasks 3, 8 (sampler). §7 deterministic geometry/LOS-substrate → Task 4 (player collision; LOS for the cultist is plan 4 on this geometry). §9 player slice → Tasks 5–8. §2 fixed-point → Task 1. §8 harness extension → Task 7.
- **Placeholder scan:** none. The two "mirror the arena obstacle list" / "verify exact line numbers" notes (Task 4 Step 3b, Task 8) are explicit, bounded actions against a cited source file, not vague TODOs.
- **Type consistency:** `PlayerState` fields, `InputCommand` (`aimYaw`/`aimPitch`/`buttons`), `stepSim(state, input, geo)` (new 3-arg signature — Task 5 Step 3c fixes all existing callers), `clipMoveXZ(from, dx, dz, radius, boxes)`, `renderPlayer(prev, cur, alpha)`, `SimRunner.advance/playerRender`, `fp`/`trig` exports are used consistently across tasks.
- **Firewall:** all new `src/sim/` files import only from `./*` and (render.ts) `./units`; none import `three`/Rapier/`src/game`. main.ts (not in src/sim) does the Three camera writes. `runner.ts` stays Three-free.
- **Risk flag:** Task 8 is integration against specific main.ts line numbers that may drift; the implementer must grep/verify and may surface adaptation questions (acceptable per subagent-driven flow). The `stepSim` arity change (Task 5) ripples to step.test.ts + determinism.test.ts — both fixes are specified.

## Done criteria

- `npx tsc --noEmit` clean; `npx vitest run --exclude '**/.claude/**'` green (incl. extended harness driving the player).
- Determinism harness asserts identical hashes per tic / replay / snapshot-resume with the player fully exercised.
- `src/sim/` imports nothing from three/Rapier/`src/game`.
- Manual playtest: movement/look/jump/collision feel matches the old player; camera smooth; enemies/weapons still work; cannot clip through walls.

When this lands, ping to write **Plan 3 (dynamite on the sim)** — it introduces the first in-step RNG (extending the harness) and projectile-vs-geometry hits on this same sim-geometry, with gib chunks staying cosmetic via SimEvents.
