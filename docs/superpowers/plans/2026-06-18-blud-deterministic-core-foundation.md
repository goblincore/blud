# Deterministic Core — Foundation & Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the deterministic simulation substrate — integer Build-unit math, a plain-data `SimState`, a pure `stepSim()`, a seeded RNG that lives inside the state, plus an automated determinism harness (state hash + recorded-input replay) — proven on a generic integer-integrated body. No gameplay is migrated in this plan; this is the spine everything else plugs into.

**Architecture:** A new isolated `src/sim/` module holds the deterministic core, kept separate from the legacy `src/game/` systems during the strangler migration. The core is pure data + pure functions: `stepSim(state, input)` advances one 120 Hz tic over plain-object state with no floats-in-state, no `Math.random`, no `performance.now`, no Rapier. Determinism is enforced by a test that runs two states on the same seed + input stream and asserts an identical state hash every tic.

**Tech Stack:** TypeScript, Vitest (co-located `*.test.ts`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-18-blud-deterministic-core-design.md` (sections 2, 3, 4, 6, 8 are implemented here; 5/7/9 land in plans 2–4).

**Plan series (this is plan 1 of 4):**
1. **Foundation & harness** ← this document
2. Player on the sim (deterministic movement/look/collision + render interpolation at the boundary) — written after this lands
3. Dynamite on the sim (throw/fuse/explosion decision; gib chunks stay cosmetic) — written after plan 2
4. Shotgun cultist on the sim (full NotBlood AI + deterministic integer LOS) — written after plan 3

---

## File Structure

All new files live under `src/sim/` (the deterministic core; no imports from `src/game/` or `three`/`@dimforge/rapier3d-compat` are allowed in this directory — the core must stay engine-free and serializable).

- Create `src/sim/units.ts` — integer Build-unit constants, fixed-point `mulscale`/`dmulscale`, and the render-boundary conversions (BU↔m, tic↔s, blood-angle↔rad). Pure number math.
- Create `src/sim/rng.ts` — `SimRng` (explicit serializable state) + `nextU32`/`random`/`chance`/`randomInt`. Same algorithm as `src/game/rng.ts` but with the state as data so it can live in `SimState` and be cloned/hashed.
- Create `src/sim/types.ts` — core data types: `KinematicBody`, `InputCommand` (+ `EMPTY_INPUT`, button bit constants), `SimEvent`.
- Create `src/sim/state.ts` — `SimState` interface + `createSimState(seed)`.
- Create `src/sim/step.ts` — pure `stepSim(state, input): SimEvent[]` (advance tic, integrate bodies).
- Create `src/sim/hash.ts` — `hashSimState(state): number`, a stable order-deterministic 32-bit hash.
- Create `src/sim/snapshot.ts` — `cloneSimState(state): SimState`, deep copy of the plain data (rollback-ready + used by the harness).
- Create `src/sim/determinism.test.ts` — the harness: dual-run identical-hash-per-tic, recorded-input replay, snapshot fidelity, different-seed sanity.

Each other file gets its own co-located `*.test.ts`.

**Magnitude note (applies to `mulscale`):** JS numbers are exact integers only up to 2^53. Our products stay far below that (positions < ~2^20 BU, velocities < ~2^16 BU/tic), so plain `Number` math is safe — but we must use `Math.floor(product / 2**shift)` for the scale-down, **never** the `>>` operator (which truncates to 32-bit and would overflow). `Math.floor` rounds toward −∞, matching Blood's arithmetic right-shift for negatives.

---

## Task 1: Units & fixed-point math

**Files:**
- Create: `src/sim/units.ts`
- Test: `src/sim/units.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/sim/units.test.ts
import { describe, it, expect } from 'vitest';
import {
  BU_PER_METER, TICS_PER_SEC, BLOOD_ANGLE_UNITS,
  mulscale, dmulscale,
  buToMeters, metersToBu, ticsToSeconds, bloodAngleToRadians,
} from './units';

describe('sim units — constants', () => {
  it('anchors match Blood-native scale', () => {
    expect(BU_PER_METER).toBe(256);
    expect(TICS_PER_SEC).toBe(120);
    expect(BLOOD_ANGLE_UNITS).toBe(2048);
  });
});

describe('mulscale / dmulscale (fixed-point)', () => {
  it('mulscale(a,b,16) = floor(a*b / 2^16)', () => {
    expect(mulscale(0x10000, 5, 16)).toBe(5);          // 1.0 * 5
    expect(mulscale(0x8000, 10, 16)).toBe(5);          // 0.5 * 10
    expect(mulscale(3, 3, 16)).toBe(0);                // tiny → 0
  });
  it('rounds toward -inf for negatives (matches arithmetic >>)', () => {
    expect(mulscale(-1, 1, 1)).toBe(-1);               // floor(-1/2) = -1
    expect(mulscale(-3, 1, 1)).toBe(-2);               // floor(-3/2) = -2
  });
  it('dmulscale(a,b,c,d,n) = floor((a*b + c*d) / 2^n)', () => {
    expect(dmulscale(0x10000, 3, 0x10000, 4, 16)).toBe(7);
  });
});

describe('render-boundary conversions', () => {
  it('BU <-> meters', () => {
    expect(buToMeters(256)).toBeCloseTo(1, 9);
    expect(metersToBu(1)).toBe(256);
    expect(metersToBu(1.5)).toBe(384);
  });
  it('tics -> seconds', () => {
    expect(ticsToSeconds(120)).toBeCloseTo(1, 9);
  });
  it('blood angle -> radians', () => {
    expect(bloodAngleToRadians(1024)).toBeCloseTo(Math.PI, 9);
    expect(bloodAngleToRadians(2048)).toBeCloseTo(Math.PI * 2, 9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/units.test.ts`
Expected: FAIL — `Cannot find module './units'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/sim/units.ts
/**
 * Integer Build-unit space for the deterministic sim. The sim runs entirely in
 * these units (no floats in state); conversions to meters/seconds/radians happen
 * ONLY at the render boundary (see the render-side interpolation in plan 2).
 */

export const BU_PER_METER = 256;      // 256 Build units = 1 meter
export const TICS_PER_SEC = 120;      // fixed sim rate
export const BLOOD_ANGLE_UNITS = 2048; // a full turn in Blood angle units

/**
 * Fixed-point multiply-then-scale, mirroring Blood's `mulscale(a, b, n)`.
 * Returns floor(a*b / 2^n). Use Math.floor (NOT `>>`, which is 32-bit) — our
 * magnitudes are < 2^53 so the multiply is exact; floor matches arithmetic
 * shift rounding (toward -inf) for negatives.
 */
export function mulscale(a: number, b: number, shift: number): number {
  return Math.floor((a * b) / 2 ** shift);
}

/** Blood's `dmulscale(a, b, c, d, n)` = floor((a*b + c*d) / 2^n). */
export function dmulscale(a: number, b: number, c: number, d: number, shift: number): number {
  return Math.floor((a * b + c * d) / 2 ** shift);
}

// ——— Render-boundary conversions (NEVER used inside sim logic) ———
export function buToMeters(bu: number): number { return bu / BU_PER_METER; }
export function metersToBu(m: number): number { return Math.round(m * BU_PER_METER); }
export function ticsToSeconds(tics: number): number { return tics / TICS_PER_SEC; }
export function bloodAngleToRadians(a: number): number {
  return (a / BLOOD_ANGLE_UNITS) * Math.PI * 2;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/units.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/sim/units.ts src/sim/units.test.ts
git commit -m "feat(sim): integer Build-unit math + render-boundary conversions"
```

---

## Task 2: Deterministic RNG with serializable state

**Files:**
- Create: `src/sim/rng.ts`
- Test: `src/sim/rng.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/sim/rng.test.ts
import { describe, it, expect } from 'vitest';
import { createRng, nextU32, random, chance, randomInt } from './rng';

describe('sim rng — determinism & serializable state', () => {
  it('same seed → same sequence', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    for (let i = 0; i < 100; i++) expect(nextU32(a)).toBe(nextU32(b));
  });

  it('different seed → different sequence', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(nextU32(a)).not.toBe(nextU32(b));
  });

  it('state is plain serializable data and can be resumed', () => {
    const r = createRng(99);
    nextU32(r); nextU32(r);
    const resumed = { a: r.a };          // snapshot the state
    const a1 = nextU32(r);
    const a2 = nextU32(resumed);
    expect(a2).toBe(a1);                 // resuming the snapshot reproduces
  });

  it('random() is in [0, 1)', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = random(r);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('chance(0) is never true, chance(0x10000) is always true', () => {
    const r = createRng(7);
    for (let i = 0; i < 50; i++) {
      expect(chance(r, 0)).toBe(false);
      expect(chance(r, 0x10000)).toBe(true);
    }
  });

  it('randomInt(n) is in [0, n)', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = randomInt(r, 6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/rng.test.ts`
Expected: FAIL — `Cannot find module './rng'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/sim/rng.ts
/**
 * Deterministic PRNG for the sim. Same mulberry32 algorithm as
 * src/game/rng.ts, but the state is a plain object so it can live inside
 * SimState — cloned for rollback and hashed by the determinism harness.
 * The sim NEVER calls Math.random; all sim randomness flows through here.
 */
export interface SimRng {
  a: number; // 32-bit state; advanced by every draw
}

export function createRng(seed: number): SimRng {
  return { a: seed >>> 0 };
}

/** Advance the state and return a uint32. */
export function nextU32(r: SimRng): number {
  r.a = (r.a + 0x6d2b79f5) | 0;
  let t = Math.imul(r.a ^ (r.a >>> 15), 1 | r.a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}

/** Float in [0, 1). For sim use only where a float ratio is acceptable; prefer
 *  chance()/randomInt() for branch/range decisions that must stay integer. */
export function random(r: SimRng): number {
  return nextU32(r) / 4294967296;
}

/** Blood's Chance(n): n is 16.16 fixed-point (0x10000 = 100%). */
export function chance(r: SimRng, fixed16: number): boolean {
  return random(r) < fixed16 / 0x10000;
}

/** Uniform integer in [0, n). Requires n > 0. */
export function randomInt(r: SimRng, n: number): number {
  return nextU32(r) % n;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/rng.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/rng.ts src/sim/rng.test.ts
git commit -m "feat(sim): seeded RNG with serializable state (lives in SimState)"
```

---

## Task 3: Core data types

**Files:**
- Create: `src/sim/types.ts`
- Test: `src/sim/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/sim/types.test.ts
import { describe, it, expect } from 'vitest';
import { EMPTY_INPUT, BTN_FIRE, BTN_SWITCH, type InputCommand, type KinematicBody } from './types';

describe('sim core types', () => {
  it('EMPTY_INPUT is all-zero / neutral', () => {
    expect(EMPTY_INPUT).toEqual({ moveForward: 0, moveStrafe: 0, aimAngle: 0, buttons: 0 });
  });

  it('button bits are distinct powers of two', () => {
    expect(BTN_FIRE).toBe(1);
    expect(BTN_SWITCH).toBe(2);
    expect(BTN_FIRE & BTN_SWITCH).toBe(0);
  });

  it('a KinematicBody is plain integer data', () => {
    const b: KinematicBody = { x: 10, y: 0, z: -5, vx: 1, vy: 0, vz: 2 };
    expect(b.x + b.vx).toBe(11);
  });

  it('an InputCommand carries movement, aim, and buttons', () => {
    const cmd: InputCommand = { moveForward: 1, moveStrafe: -1, aimAngle: 512, buttons: BTN_FIRE };
    expect(cmd.aimAngle).toBe(512);
    expect((cmd.buttons & BTN_FIRE) !== 0).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/types.test.ts`
Expected: FAIL — `Cannot find module './types'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/sim/types.ts
/** Generic integer kinematic body: position (BU) + velocity (BU/tic). Player,
 *  projectiles, and dudes compose this in later plans. */
export interface KinematicBody {
  x: number; y: number; z: number;    // position, Build units (integer)
  vx: number; vy: number; vz: number; // velocity, BU/tic (integer)
}

/** Per-tic input — the ONLY thing a future lockstep transport sends. Aim is an
 *  absolute Blood angle [0, 2048). Sampled at render rate, quantized per tic. */
export interface InputCommand {
  moveForward: number; // -1 | 0 | 1 (scaled to BU/tic in the player plan)
  moveStrafe: number;  // -1 | 0 | 1
  aimAngle: number;    // absolute Blood angle units [0, 2048)
  buttons: number;     // bitfield of BTN_*
}

export const BTN_FIRE = 1 << 0;
export const BTN_SWITCH = 1 << 1;

export const EMPTY_INPUT: InputCommand = {
  moveForward: 0, moveStrafe: 0, aimAngle: 0, buttons: 0,
};

/** Sim → cosmetic notifications. Discriminated union; later plans add variants
 *  (e.g. { kind: 'explosion'; x; y; z }, { kind: 'gib'; ... }). The cosmetic
 *  layer consumes these; the sim never reads them back. */
export type SimEvent =
  | { kind: 'noop' };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/types.ts src/sim/types.test.ts
git commit -m "feat(sim): core data types (KinematicBody, InputCommand, SimEvent)"
```

---

## Task 4: SimState + pure step

**Files:**
- Create: `src/sim/state.ts`
- Create: `src/sim/step.ts`
- Test: `src/sim/step.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/sim/step.test.ts
import { describe, it, expect } from 'vitest';
import { createSimState } from './state';
import { stepSim } from './step';
import { EMPTY_INPUT } from './types';

describe('createSimState', () => {
  it('starts at tic 0 with a seeded rng and no bodies', () => {
    const s = createSimState(42);
    expect(s.tic).toBe(0);
    expect(s.rng.a).toBe(42);
    expect(s.bodies).toEqual([]);
  });
});

describe('stepSim', () => {
  it('advances the tic counter by one', () => {
    const s = createSimState(1);
    stepSim(s, EMPTY_INPUT);
    expect(s.tic).toBe(1);
    stepSim(s, EMPTY_INPUT);
    expect(s.tic).toBe(2);
  });

  it('integrates each body by its velocity (BU/tic)', () => {
    const s = createSimState(1);
    s.bodies.push({ x: 0, y: 100, z: 0, vx: 3, vy: -2, vz: 5 });
    stepSim(s, EMPTY_INPUT);
    expect(s.bodies[0]).toEqual({ x: 3, y: 98, z: 5, vx: 3, vy: -2, vz: 5 });
    stepSim(s, EMPTY_INPUT);
    expect(s.bodies[0]).toEqual({ x: 6, y: 96, z: 10, vx: 3, vy: -2, vz: 5 });
  });

  it('returns an array of events (empty in the foundation)', () => {
    const s = createSimState(1);
    const events = stepSim(s, EMPTY_INPUT);
    expect(Array.isArray(events)).toBe(true);
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/step.test.ts`
Expected: FAIL — `Cannot find module './state'`.

- [ ] **Step 3: Write the implementations**

```typescript
// src/sim/state.ts
import { createRng, type SimRng } from './rng';
import type { KinematicBody } from './types';

/** The entire deterministic simulation state. Plain serializable data only —
 *  no class instances, no Rapier handles, no closures — so it can be hashed and
 *  cloned (rollback-ready). Later plans add typed entity collections
 *  (player, dudes, projectiles); the foundation carries a generic body list. */
export interface SimState {
  tic: number;
  rng: SimRng;
  bodies: KinematicBody[];
}

export function createSimState(seed: number): SimState {
  return { tic: 0, rng: createRng(seed), bodies: [] };
}
```

```typescript
// src/sim/step.ts
import type { SimState } from './state';
import type { InputCommand, SimEvent } from './types';

/**
 * Advance the simulation by exactly one 120 Hz tic. PURE with respect to the
 * outside world: no Math.random, no Date/performance.now, no Rapier, no DOM.
 * Mutates `state` in place (cheap; rollback uses cloneSimState to snapshot) and
 * returns the cosmetic events produced this tic.
 *
 * `input` is consumed starting in the player plan (movement/aim/buttons).
 */
export function stepSim(state: SimState, input: InputCommand): SimEvent[] {
  void input; // applied to the player in plan 2
  state.tic++;

  // Integer kinematic integration (BU/tic). Order is array order → stable.
  for (const b of state.bodies) {
    b.x += b.vx;
    b.y += b.vy;
    b.z += b.vz;
  }

  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/step.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/state.ts src/sim/step.ts src/sim/step.test.ts
git commit -m "feat(sim): SimState + pure stepSim (tic advance + integer integration)"
```

---

## Task 5: Stable state hash

**Files:**
- Create: `src/sim/hash.ts`
- Test: `src/sim/hash.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/sim/hash.test.ts
import { describe, it, expect } from 'vitest';
import { createSimState } from './state';
import { stepSim } from './step';
import { hashSimState } from './hash';
import { EMPTY_INPUT } from './types';

describe('hashSimState', () => {
  it('is stable for identical states', () => {
    const a = createSimState(5);
    const b = createSimState(5);
    expect(hashSimState(a)).toBe(hashSimState(b));
  });

  it('changes when the tic advances', () => {
    const s = createSimState(5);
    const before = hashSimState(s);
    stepSim(s, EMPTY_INPUT);
    expect(hashSimState(s)).not.toBe(before);
  });

  it('changes when a body position differs', () => {
    const a = createSimState(5);
    const b = createSimState(5);
    a.bodies.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    b.bodies.push({ x: 1, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    expect(hashSimState(a)).not.toBe(hashSimState(b));
  });

  it('returns an unsigned 32-bit integer', () => {
    const h = hashSimState(createSimState(5));
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/hash.test.ts`
Expected: FAIL — `Cannot find module './hash'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/sim/hash.ts
import type { SimState } from './state';

/**
 * Stable FNV-1a-style 32-bit hash of the serializable sim state. Field order is
 * fixed and array iteration is in index order, so the hash is deterministic
 * across runs/peers. This is the determinism harness's fingerprint; extend it
 * field-for-field as SimState grows in later plans.
 */
export function hashSimState(s: SimState): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h ^= v | 0;
    h = Math.imul(h, 0x01000193);
  };

  mix(s.tic);
  mix(s.rng.a);
  for (const b of s.bodies) {
    mix(b.x); mix(b.y); mix(b.z);
    mix(b.vx); mix(b.vy); mix(b.vz);
  }

  return h >>> 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/hash.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/hash.ts src/sim/hash.test.ts
git commit -m "feat(sim): stable SimState hash for the determinism harness"
```

---

## Task 6: State snapshot (clone)

**Files:**
- Create: `src/sim/snapshot.ts`
- Test: `src/sim/snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/sim/snapshot.test.ts
import { describe, it, expect } from 'vitest';
import { createSimState } from './state';
import { stepSim } from './step';
import { cloneSimState } from './snapshot';
import { hashSimState } from './hash';
import { EMPTY_INPUT } from './types';

describe('cloneSimState', () => {
  it('produces an equal-but-independent copy', () => {
    const s = createSimState(3);
    s.bodies.push({ x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: 6 });
    const c = cloneSimState(s);
    expect(hashSimState(c)).toBe(hashSimState(s));
    // Mutating the clone must NOT affect the original (deep copy).
    c.bodies[0]!.x = 999;
    c.rng.a = 777;
    expect(s.bodies[0]!.x).toBe(1);
    expect(s.rng.a).toBe(3);
  });

  it('snapshot fidelity: clone then step both → identical hash', () => {
    const s = createSimState(11);
    s.bodies.push({ x: 0, y: 0, z: 0, vx: 7, vy: -3, vz: 2 });
    const c = cloneSimState(s);
    for (let i = 0; i < 50; i++) {
      stepSim(s, EMPTY_INPUT);
      stepSim(c, EMPTY_INPUT);
    }
    expect(hashSimState(c)).toBe(hashSimState(s));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/snapshot.test.ts`
Expected: FAIL — `Cannot find module './snapshot'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/sim/snapshot.ts
import type { SimState } from './state';

/**
 * Deep copy of the (plain-data) sim state. Explicit field-by-field copy — not
 * structuredClone — so it stays fast and obvious as state grows. This is what a
 * future rollback netcode saves/restores per tic; for now the harness uses it
 * to prove snapshot fidelity. Extend alongside SimState in later plans.
 */
export function cloneSimState(s: SimState): SimState {
  return {
    tic: s.tic,
    rng: { a: s.rng.a },
    bodies: s.bodies.map((b) => ({ ...b })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/sim/snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/snapshot.ts src/sim/snapshot.test.ts
git commit -m "feat(sim): cloneSimState snapshot (rollback-ready, harness fidelity)"
```

---

## Task 7: Determinism harness

**Files:**
- Create: `src/sim/determinism.test.ts`

This task is the payoff: an automated proof that the core is deterministic. It uses a small recorded-input stream that exercises the RNG and integer integration, runs two independent `SimState`s through it, and asserts the hash matches at **every** tic. This test is the CI guard that fails the instant any nondeterminism (a stray `Math.random`, float creep, unstable iteration order) is introduced in later plans.

- [ ] **Step 1: Write the harness test**

```typescript
// src/sim/determinism.test.ts
import { describe, it, expect } from 'vitest';
import { createSimState, type SimState } from './state';
import { stepSim } from './step';
import { hashSimState } from './hash';
import { cloneSimState } from './snapshot';
import { randomInt } from './rng';
import type { InputCommand } from './types';

/** A deterministic recorded input stream (varied movement/aim/buttons). */
function recordedInputs(n: number): InputCommand[] {
  const out: InputCommand[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      moveForward: (i % 3) - 1,
      moveStrafe: (i % 2) === 0 ? 1 : -1,
      aimAngle: (i * 37) % 2048,
      buttons: i % 5 === 0 ? 1 : 0,
    });
  }
  return out;
}

/** Seed a state with a few bodies + draw some rng so the hash is non-trivial. */
function seededState(seed: number): SimState {
  const s = createSimState(seed);
  for (let i = 0; i < 4; i++) {
    s.bodies.push({
      x: i * 100, y: 1000, z: -i * 50,
      vx: randomInt(s.rng, 7) - 3,
      vy: -randomInt(s.rng, 4),
      vz: randomInt(s.rng, 7) - 3,
    });
  }
  return s;
}

describe('determinism harness', () => {
  it('two independent states on the same seed + inputs hash-match every tic', () => {
    const inputs = recordedInputs(300);
    const a = seededState(2026);
    const b = seededState(2026);
    expect(hashSimState(a)).toBe(hashSimState(b)); // identical seeding
    for (let t = 0; t < inputs.length; t++) {
      stepSim(a, inputs[t]!);
      stepSim(b, inputs[t]!);
      expect(hashSimState(a)).toBe(hashSimState(b)); // identical EVERY tic
    }
  });

  it('recorded-input replay reproduces the exact final hash', () => {
    const inputs = recordedInputs(300);
    const run = (): number => {
      const s = seededState(2026);
      for (const cmd of inputs) stepSim(s, cmd);
      return hashSimState(s);
    };
    expect(run()).toBe(run());
  });

  it('mid-run snapshot + resume reproduces the same final hash', () => {
    const inputs = recordedInputs(200);
    const live = seededState(7);
    for (let t = 0; t < 100; t++) stepSim(live, inputs[t]!);
    const snap = cloneSimState(live);              // save at tic 100
    for (let t = 100; t < 200; t++) stepSim(live, inputs[t]!);
    const liveHash = hashSimState(live);
    for (let t = 100; t < 200; t++) stepSim(snap, inputs[t]!); // resume from snapshot
    expect(hashSimState(snap)).toBe(liveHash);
  });

  it('a different seed diverges (sanity: the hash actually depends on sim)', () => {
    const inputs = recordedInputs(50);
    const a = seededState(1);
    const b = seededState(2);
    for (const cmd of inputs) { stepSim(a, cmd); stepSim(b, cmd); }
    expect(hashSimState(a)).not.toBe(hashSimState(b));
  });
});
```

- [ ] **Step 2: Run the harness**

Run: `npx vitest run src/sim/determinism.test.ts`
Expected: PASS — all four cases green. If "hash-match every tic" fails, there is nondeterminism in `stepSim`/`rng`; do not paper over it — find the float/`Math.random`/ordering source.

- [ ] **Step 3: Run the full suite + typecheck (no regressions)**

Run: `npx tsc --noEmit && npx vitest run --exclude '**/.claude/**'`
Expected: tsc exit 0; all prior tests still pass plus the new `src/sim/*` tests.

- [ ] **Step 4: Commit**

```bash
git add src/sim/determinism.test.ts
git commit -m "test(sim): determinism harness — identical hash per tic + replay + snapshot resume"
```

---

## Self-Review (completed during plan authoring)

- **Spec coverage (this plan's slice):** §2 integer units → Task 1; §6 seeded RNG in state → Task 2; §3 fixed-tic pure step → Task 4; §4 plain-data SimState + snapshot → Tasks 4/6; §8 determinism harness (hash + replay) → Tasks 5/7. §5 (input transport), §7 (integer geometry/LOS), §9 (player/dynamite/cultist migration) are explicitly deferred to plans 2–4.
- **Placeholder scan:** none — every step has full code and exact commands. The one deliberate "show the mistake then fix it" step (Task 7 Step 2) is intentional and self-correcting.
- **Type consistency:** `SimRng.a`, `KinematicBody.{x,y,z,vx,vy,vz}`, `InputCommand.{moveForward,moveStrafe,aimAngle,buttons}`, `createSimState(seed)`, `stepSim(state, input)`, `hashSimState(state)`, `cloneSimState(state)` are used identically across all tasks.
- **Boundary rule:** no file under `src/sim/` imports `three`, `@dimforge/rapier3d-compat`, or anything from `src/game/` — enforce this in review (it's the determinism firewall).

---

## Done criteria

- `npx tsc --noEmit` clean.
- `npx vitest run --exclude '**/.claude/**'` green, including the new `src/sim/*` suites.
- The determinism harness asserts identical hashes per tic, on replay, and across a snapshot/resume.
- `src/sim/` imports nothing from `three`, Rapier, or `src/game/`.

When this lands, ping to write **Plan 2 (player on the sim)** — its shapes (the player record, deterministic wall-clip geometry, render interpolation at the boundary) build directly on this foundation.
