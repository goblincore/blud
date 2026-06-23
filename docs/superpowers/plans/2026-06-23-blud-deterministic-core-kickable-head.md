# Kickable Head (Deterministic Core — Plan 3.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the severed zombie head a **deterministic, shared, kickable sim object** — it lives on `SimState`, reuses the `kThing` mover (gravity + floor/wall bounce), and the player punts it by walking into it; only the blood spray around it stays cosmetic.

**Architecture:** A new `src/sim/head.ts` defines `HeadState` (extends the existing `ThingState` from `thing.ts`) plus `spawnHead`, `stepHeads`, and a pure `kickHeads(player, heads)` interaction that imparts velocity along the player's facing when the player is in contact with a grounded head. Heads integrate into `SimState`, `stepSim`, the FNV hash, the snapshot clone, and the determinism harness. A render-boundary `renderHeads` interpolates positions to meters; `SimRunner` exposes `spawnHead`/`headRenders`. In `main.ts` (cosmetic layer) the legacy head-pop path is rerouted: `ChunkSystem.spawnHeadChunk` gains a `spawnHeadHook` that — when set — routes every head spawn to `sim.spawnHead` instead of a Rapier body, and a billboard mesh pool follows `sim.headRenders()`. Both head sources (the 25% normal `popHead` and the explosion-launched head) funnel through `spawnHeadChunk`, so one hook captures both.

**Tech Stack:** TypeScript, Vitest (deterministic sim is Three/Rapier-free), Three.js (cosmetic billboard only). 16.16 fixed-point Build-unit integer math at 120 tic/s.

---

## File Structure

| File | Responsibility |
| ---- | -------------- |
| `src/sim/head.ts` (new) | `HeadState`, tuning consts, `spawnHead`, `stepHeads` (gravity/bounce via `stepThing` + cooldown decay + age-despawn), `kickHeads` (player-contact impulse). The deterministic core of the feature. |
| `src/sim/head.test.ts` (new) | Unit tests for head physics + kick. |
| `src/sim/state.ts` (mod) | Add `heads: HeadState[]` to `SimState` + init `[]`. |
| `src/sim/step.ts` (mod) | Call `stepHeads` + `kickHeads` each tic. |
| `src/sim/hash.ts` (mod) | Mix head fields into the determinism fingerprint. |
| `src/sim/snapshot.ts` (mod) | Deep-clone the heads array (rollback fidelity). |
| `src/sim/determinism.test.ts` (mod) | Seed a head so the replay/snapshot/divergence harness covers it. |
| `src/sim/render.ts` (mod) | `HeadRender` + `renderHeads` (interpolated → meters). |
| `src/sim/runner.ts` (mod) | `SimRunner.spawnHead(...)` (m→fp boundary) + `headRenders()`. |
| `src/sim/runner.test.ts` (new) | Spawn-and-render integration coverage (Three-free). |
| `src/game/gibs/chunks.ts` (mod) | `spawnHeadHook` field; `spawnHeadChunk` early-returns through it when set. |
| `src/main.ts` (mod) | Wire the hook → `sim.spawnHead`; billboard mesh pool driven by `sim.headRenders()`. |
| `TASKS.md` (mod) | Flip plan 3.5 status; collapse to a one-liner. |

**Determinism firewall (do not violate):** `src/sim/**` must NOT import `three`, Rapier, or `src/game/**`. `head.ts` imports only from sibling sim modules (`thing`, `fp`, `trig`, `geometry`, `player`).

**Dispatch note:** these tasks share the `src/sim/` module and build on each other — run them as a **serial chain** (Task N depends on Task N-1), even where two tasks touch non-overlapping files (e.g. Task 4's `runner.ts` imports `state.heads` added in Task 3).

---

### Task 1: Head sim object + physics

**Files:**
- Create: `src/sim/head.ts`
- Test: `src/sim/head.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/sim/head.test.ts`:

```typescript
// src/sim/head.test.ts
import { describe, it, expect } from 'vitest';
import { spawnHead, stepHeads, HEAD_MAX_AGE_TICS, type HeadState } from './head';
import { buildArenaGeometry } from './geometry';
import { fpFromMeters } from './fp';

const GEO = buildArenaGeometry();

describe('head physics', () => {
  it('falls under gravity and comes to rest on the floor', () => {
    const heads: HeadState[] = [];
    spawnHead(heads, 0, fpFromMeters(5), 0, 0, 0, 0, 0);
    for (let t = 1; t <= 600; t++) stepHeads(heads, GEO, t);
    expect(heads.length).toBe(1);
    expect(heads[0]!.y).toBe(0);
    expect(heads[0]!.resting).toBe(true);
  });

  it('bounces off the floor before resting (elastic > 0)', () => {
    const heads: HeadState[] = [];
    spawnHead(heads, 0, fpFromMeters(3), 0, 0, 0, 0, 0);
    let bounced = false;
    for (let t = 1; t <= 200; t++) {
      const beforeVy = heads[0]!.vy;
      stepHeads(heads, GEO, t);
      if (beforeVy < 0 && heads[0]!.vy > 0) bounced = true; // velocity flipped up at the floor
    }
    expect(bounced).toBe(true);
  });

  it('decrements the kick cooldown each tic', () => {
    const heads: HeadState[] = [];
    spawnHead(heads, 0, 0, 0, 0, 0, 0, 0);
    heads[0]!.kickCooldownTics = 3;
    stepHeads(heads, GEO, 1);
    expect(heads[0]!.kickCooldownTics).toBe(2);
  });

  it('despawns after HEAD_MAX_AGE_TICS', () => {
    const heads: HeadState[] = [];
    spawnHead(heads, 0, fpFromMeters(1), 0, 0, 0, 0, 0);
    for (let t = 1; t <= HEAD_MAX_AGE_TICS; t++) stepHeads(heads, GEO, t);
    expect(heads.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/head.test.ts`
Expected: FAIL — `Cannot find module './head'`.

- [ ] **Step 3: Write the implementation**

Create `src/sim/head.ts`:

```typescript
// src/sim/head.ts
import { fpFromMeters, metersPerSecToFp } from './fp';
import { TICS_PER_SEC } from './units';
import { stepThing, type ThingState } from './thing';
import type { SimAABB } from './geometry';

/** A severed zombie head: a deterministic kThing (gravity + floor/wall bounce)
 *  that the player can kick. Shared/interactable — lives on SimState so co-op
 *  peers see the same head land in the same place. */
export interface HeadState extends ThingState {
  kickCooldownTics: number; // ticks until the head can be kicked again (anti-pin)
  spawnTic: number;         // tic of spawn, for age-despawn
}

export const HEAD_RADIUS = fpFromMeters(0.18);  // matches the old ball collider (0.18 m)
export const HEAD_ELASTIC = 42598;              // 0.65 restitution in 16.16 — lively roll/bounce
export const HEAD_MAX_AGE_TICS = Math.round(30 * TICS_PER_SEC); // 30 s, then despawn

/** Spawn a head into the sim. Position is fp (y = bottom; floor = 0); velocity is fp/tic. */
export function spawnHead(
  heads: HeadState[],
  x: number, y: number, z: number,
  vx: number, vy: number, vz: number,
  tic: number,
): void {
  heads.push({
    x, y, z, vx, vy, vz,
    radius: HEAD_RADIUS, elastic: HEAD_ELASTIC, resting: false,
    kickCooldownTics: 0, spawnTic: tic,
  });
}

/** Advance all heads one tic: decay kick cooldown, integrate physics, age-despawn.
 *  `tic` is the current SimState.tic. Mutates `heads`. */
export function stepHeads(heads: HeadState[], geo: SimAABB[], tic: number): void {
  for (let i = heads.length - 1; i >= 0; i--) {
    const h = heads[i]!;
    if (h.kickCooldownTics > 0) h.kickCooldownTics--;
    stepThing(h, geo);
    if (tic - h.spawnTic >= HEAD_MAX_AGE_TICS) heads.splice(i, 1);
  }
}
```

(Note: `metersPerSecToFp` is imported now so the kick tuning in Task 2 compiles cleanly; if your linter flags it as unused before Task 2, leave it — Task 2 uses it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sim/head.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/head.ts src/sim/head.test.ts
git commit -m "feat(sim): kickable head physics (kThing mover reuse + age-despawn)"
```

---

### Task 2: Player kick interaction

**Files:**
- Modify: `src/sim/head.ts`
- Test: `src/sim/head.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/sim/head.test.ts` (add the import at the top alongside the existing import, and the new `describe` block at the end):

```typescript
// add to the existing import from './head':
//   import { spawnHead, stepHeads, kickHeads, HEAD_MAX_AGE_TICS,
//            KICK_UP, KICK_COOLDOWN_TICS, KICK_MAX_HEIGHT, type HeadState } from './head';
import { createPlayerState } from './player';

describe('head kick', () => {
  it('kicks a nearby grounded head along the player facing', () => {
    const heads: HeadState[] = [];
    spawnHead(heads, fpFromMeters(0.3), 0, 0, 0, 0, 0, 0); // 0.3 m to +X, on the floor
    const player = createPlayerState();
    player.x = 0; player.z = 0; player.yaw = 512; // yaw 512 → forward = +X
    kickHeads(player, heads);
    expect(heads[0]!.vx).toBeGreaterThan(0);          // booted toward +X
    expect(heads[0]!.vy).toBe(KICK_UP);               // pops up
    expect(heads[0]!.kickCooldownTics).toBe(KICK_COOLDOWN_TICS);
  });

  it('does not kick a head out of reach', () => {
    const heads: HeadState[] = [];
    spawnHead(heads, fpFromMeters(2), 0, 0, 0, 0, 0, 0); // 2 m away
    const player = createPlayerState();
    kickHeads(player, heads);
    expect(heads[0]!.vx).toBe(0);
    expect(heads[0]!.kickCooldownTics).toBe(0);
  });

  it('does not kick a head airborne above KICK_MAX_HEIGHT', () => {
    const heads: HeadState[] = [];
    const highY = KICK_MAX_HEIGHT + fpFromMeters(0.5);
    spawnHead(heads, fpFromMeters(0.2), highY, 0, 0, 0, 0, 0);
    const player = createPlayerState();
    kickHeads(player, heads);
    expect(heads[0]!.vx).toBe(0);
  });

  it('respects the kick cooldown (no re-kick while cooling down)', () => {
    const heads: HeadState[] = [];
    spawnHead(heads, fpFromMeters(0.2), 0, 0, 0, 0, 0, 0);
    const player = createPlayerState();
    player.yaw = 512;
    kickHeads(player, heads);                 // first kick sets cooldown
    heads[0]!.vx = 0; heads[0]!.vy = 0;        // pretend the head stopped, cooldown still active
    kickHeads(player, heads);                 // still cooling down → ignored
    expect(heads[0]!.vx).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/head.test.ts`
Expected: FAIL — `kickHeads`, `KICK_UP`, `KICK_COOLDOWN_TICS`, `KICK_MAX_HEIGHT` are not exported.

- [ ] **Step 3: Write the implementation**

Add to `src/sim/head.ts` — extend the imports and append the kick tuning + `kickHeads`:

```typescript
// extend the existing './fp' import to add FP_PER_BU and mulfp:
//   import { fpFromMeters, metersPerSecToFp, FP_PER_BU, mulfp } from './fp';
import { yawRotate } from './trig';
import type { PlayerState } from './player';
```

```typescript
// ——— Kick tuning ———
export const KICK_SPEED = metersPerSecToFp(6);     // horizontal punt speed (fp/tic)
export const KICK_UP = metersPerSecToFp(2.5);      // vertical pop on a kick (fp/tic)
export const KICK_CONTACT_DIST = fpFromMeters(0.65); // player radius (0.3) + head (0.18) + slop
const KICK_CONTACT_DIST_SQ = KICK_CONTACT_DIST * KICK_CONTACT_DIST;
export const KICK_MAX_HEIGHT = fpFromMeters(0.7);  // only boot heads near the floor
export const KICK_COOLDOWN_TICS = 18;              // ~0.15 s between kicks (anti-pin)

/** Punt any grounded head the player is touching: impulse along the player's
 *  facing (you kick the head where you look/walk), plus a small upward pop. Pure;
 *  deterministic (no sqrt — direction is the player yaw forward, same basis as
 *  movement and the dynamite throw). Mutates `heads`. */
export function kickHeads(player: PlayerState, heads: HeadState[]): void {
  // Unit forward in the SAME basis the player moves along (local forward = (0,-1)).
  const fwd = yawRotate(0, -FP_PER_BU, player.yaw);
  for (const h of heads) {
    if (h.kickCooldownTics > 0) continue;
    if (h.y > KICK_MAX_HEIGHT) continue;
    const dx = h.x - player.x;
    const dz = h.z - player.z;
    if (dx * dx + dz * dz > KICK_CONTACT_DIST_SQ) continue;
    h.vx = mulfp(KICK_SPEED, fwd.x);
    h.vz = mulfp(KICK_SPEED, fwd.z);
    h.vy = KICK_UP;
    h.resting = false;
    h.kickCooldownTics = KICK_COOLDOWN_TICS;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sim/head.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/sim/head.ts src/sim/head.test.ts
git commit -m "feat(sim): player kicks a grounded head along facing (anti-pin cooldown)"
```

---

### Task 3: Integrate the head into the deterministic core

**Files:**
- Modify: `src/sim/state.ts`, `src/sim/step.ts`, `src/sim/hash.ts`, `src/sim/snapshot.ts`
- Test: `src/sim/step.test.ts`, `src/sim/hash.test.ts`, `src/sim/snapshot.test.ts`, `src/sim/determinism.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/sim/step.test.ts` (new test; add imports as needed):

```typescript
// imports needed at the top of step.test.ts:
//   import { spawnHead } from './head';
//   import { fpFromMeters } from './fp';
//   import { EMPTY_INPUT } from './types';   // if not already imported
// (createSimState, stepSim, and a GEO = buildArenaGeometry() should already exist in this file)

it('steps and kicks heads inside stepSim', () => {
  const s = createSimState(1);
  spawnHead(s.heads, fpFromMeters(0.3), 0, 0, 0, 0, 0, s.tic);
  s.player.yaw = 512; // forward = +X
  stepSim(s, EMPTY_INPUT, GEO);
  expect(s.heads.length).toBe(1);
  expect(s.heads[0]!.vx).toBeGreaterThan(0); // kicked toward +X this tic
});
```

Add to `src/sim/hash.test.ts`:

```typescript
// imports: import { spawnHead } from './head';  (createSimState, hashSimState already imported)
it('hash reflects head state', () => {
  const a = createSimState(5);
  const b = createSimState(5);
  spawnHead(a.heads, 1000, 2000, 3000, 10, 20, 30, 0);
  expect(hashSimState(a)).not.toBe(hashSimState(b));
});
```

Add to `src/sim/snapshot.test.ts`:

```typescript
// imports: import { spawnHead } from './head';  (createSimState, cloneSimState already imported)
it('clones heads independently', () => {
  const s = createSimState(1);
  spawnHead(s.heads, 1, 2, 3, 4, 5, 6, 0);
  const c = cloneSimState(s);
  c.heads[0]!.x = 999;
  expect(s.heads[0]!.x).toBe(1);
});
```

In `src/sim/determinism.test.ts`, extend `seededState` so the harness exercises heads. Add the import and one spawn call inside `seededState` (just before it returns `s`):

```typescript
// add to imports:
import { spawnHead } from './head';

// inside seededState(seed), after the existing spawnProjectile(...) line and before `return s;`:
//   a head dropped mid-air so it falls/bounces across the recorded run
spawnHead(s.heads, 100_000, 2_000_000, -80_000, 30_000, 120_000, -20_000, 0);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/step.test.ts src/sim/hash.test.ts src/sim/snapshot.test.ts src/sim/determinism.test.ts`
Expected: FAIL — `Property 'heads' does not exist on type 'SimState'` (and `s.heads` undefined).

- [ ] **Step 3: Add `heads` to `SimState`**

In `src/sim/state.ts`:

```typescript
import type { HeadState } from './head';
```

Add the field to the `SimState` interface (after `projectiles`):

```typescript
  projectiles: ProjectileState[];
  heads: HeadState[];
```

And initialise it in `createSimState`:

```typescript
export function createSimState(seed: number): SimState {
  return { tic: 0, rng: createRng(seed), bodies: [], player: createPlayerState(), projectiles: [], heads: [] };
}
```

- [ ] **Step 4: Step heads in `stepSim`**

In `src/sim/step.ts`, add the import and the calls (after `stepProjectiles`, before `return events`):

```typescript
import { stepHeads, kickHeads } from './head';
```

```typescript
  const events: SimEvent[] = [];
  stepProjectiles(state.projectiles, geo, state.tic, events);
  stepHeads(state.heads, geo, state.tic);
  kickHeads(state.player, state.heads);
  return events;
```

- [ ] **Step 5: Hash + clone the heads**

In `src/sim/hash.ts`, after the `projectiles` loop (before `return h >>> 0`):

```typescript
  for (const hd of s.heads) {
    mix(hd.x); mix(hd.y); mix(hd.z); mix(hd.vx); mix(hd.vy); mix(hd.vz);
    mix(hd.radius); mix(hd.elastic); mix(hd.resting ? 1 : 0);
    mix(hd.kickCooldownTics); mix(hd.spawnTic);
  }
```

In `src/sim/snapshot.ts`, add the heads clone to the returned object:

```typescript
    projectiles: s.projectiles.map((p) => ({ ...p })),
    heads: s.heads.map((h) => ({ ...h })),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/sim/step.test.ts src/sim/hash.test.ts src/sim/snapshot.test.ts src/sim/determinism.test.ts`
Expected: PASS — including the existing determinism replay/snapshot-resume/seed-divergence tests, now covering head state.

- [ ] **Step 7: Commit**

```bash
git add src/sim/state.ts src/sim/step.ts src/sim/hash.ts src/sim/snapshot.ts \
        src/sim/step.test.ts src/sim/hash.test.ts src/sim/snapshot.test.ts src/sim/determinism.test.ts
git commit -m "feat(sim): wire heads into SimState/step/hash/snapshot + determinism harness"
```

---

### Task 4: Render boundary + runner API

**Files:**
- Modify: `src/sim/render.ts`, `src/sim/runner.ts`
- Test: `src/sim/render.test.ts`
- Create: `src/sim/runner.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/sim/render.test.ts`:

```typescript
// imports: import { renderHeads } from './render';
//          import { fpFromMeters } from './fp';
//          import type { HeadState } from './head';
it('interpolates head positions to meters', () => {
  const base: HeadState = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    radius: 0, elastic: 0, resting: false, kickCooldownTics: 0, spawnTic: 0,
  };
  const prev: HeadState[] = [{ ...base }];
  const cur: HeadState[] = [{ ...base, x: fpFromMeters(2) }];
  const out = renderHeads(prev, cur, 0.5);
  expect(out).toHaveLength(1);
  expect(out[0]!.xMeters).toBeCloseTo(1, 5); // halfway between 0 and 2 m
});
```

Create `src/sim/runner.test.ts`:

```typescript
// src/sim/runner.test.ts
import { describe, it, expect } from 'vitest';
import { SimRunner } from './runner';
import { EMPTY_INPUT } from './types';

describe('SimRunner heads', () => {
  it('spawns a head and reports interpolated renders that fall under gravity', () => {
    const r = new SimRunner(1, 0, 0);
    r.spawnHead(0, 5, 0, 0, 0, 0); // 5 m up, no initial velocity
    r.advance(1 / 120, () => EMPTY_INPUT);
    const renders = r.headRenders();
    expect(renders).toHaveLength(1);
    expect(renders[0]!.yMeters).toBeLessThan(5); // gravity pulled it down a touch
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sim/render.test.ts src/sim/runner.test.ts`
Expected: FAIL — `renderHeads` not exported; `SimRunner.spawnHead`/`headRenders` not defined.

- [ ] **Step 3: Add `HeadRender` + `renderHeads` to `render.ts`**

In `src/sim/render.ts`:

```typescript
import type { HeadState } from './head';
```

```typescript
export interface HeadRender {
  xMeters: number; yMeters: number; zMeters: number;
}

/** Interpolate head positions between the previous and current tic, in meters.
 *  Match by index (append-only + removed-on-despawn, same convention as projectiles).
 *  Cosmetic only — the billboard always faces the camera, so no orientation is sent. */
export function renderHeads(prev: HeadState[], cur: HeadState[], alpha: number): HeadRender[] {
  const n = Math.min(prev.length, cur.length);
  const out: HeadRender[] = [];
  for (let i = 0; i < n; i++) {
    const a = prev[i]!, b = cur[i]!;
    out.push({
      xMeters: fpToMeters(a.x + (b.x - a.x) * alpha),
      yMeters: fpToMeters(a.y + (b.y - a.y) * alpha),
      zMeters: fpToMeters(a.z + (b.z - a.z) * alpha),
    });
  }
  return out;
}
```

- [ ] **Step 4: Add `spawnHead` + `headRenders` to `runner.ts`**

In `src/sim/runner.ts`, extend the `head`/`render` imports and add the two methods:

```typescript
import { spawnHead as simSpawnHead } from './head';
// extend the existing render import to add renderHeads + HeadRender:
//   import { renderPlayer, renderProjectiles, renderHeads,
//            type PlayerRender, type ProjectileRender, type HeadRender } from './render';
```

Add these methods to the `SimRunner` class (e.g. after `projectileRenders`):

```typescript
  /** Spawn a kickable head into the sim. Converts meters→fp and m/s→fp/tic at the
   *  boundary. Called from main.ts (via the head-pop hook) — never from sim internals. */
  spawnHead(
    xM: number, yM: number, zM: number,
    vxMps: number, vyMps: number, vzMps: number,
  ): void {
    simSpawnHead(
      this.state.heads,
      fpFromMeters(xM), fpFromMeters(yM), fpFromMeters(zM),
      metersPerSecToFp(vxMps), metersPerSecToFp(vyMps), metersPerSecToFp(vzMps),
      this.state.tic,
    );
  }

  /** Interpolated head transforms for billboard rendering (alpha from the accumulator). */
  headRenders(): HeadRender[] {
    const alpha = this.accumulator / SIM_DT;
    return renderHeads(this.prev.heads, this.state.heads, alpha);
  }
```

(`fpFromMeters` and `metersPerSecToFp` are already imported in `runner.ts`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/sim/render.test.ts src/sim/runner.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify the whole sim module is green + firewall intact**

Run: `npx vitest run src/sim && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/sim/render.ts src/sim/runner.ts src/sim/render.test.ts src/sim/runner.test.ts
git commit -m "feat(sim): head render interpolation + SimRunner spawnHead/headRenders"
```

---

### Task 5: Cosmetic wiring — reroute head-pops to the sim + billboard

**Files:**
- Modify: `src/game/gibs/chunks.ts`, `src/main.ts`

This task is the cosmetic layer (Three/Rapier) — it has no unit tests; verify with `tsc`, `build`, and the existing suite, then the user playtests. The deterministic head's initial launch velocity is supplied by the legacy spawn site (meters/sec, with its existing per-spawn `Math.random` jitter) — deterministic from spawn onward, the same precedent as the dynamite throw hook (becomes a true sim input when enemies migrate in plan 4+).

- [ ] **Step 1: Add the `spawnHeadHook` to `ChunkSystem`**

In `src/game/gibs/chunks.ts`, add a public field on the class (next to `private readonly zombieHeadPicnum = 3405;` near line 46):

```typescript
  /** When set, head spawns route to the deterministic sim instead of a cosmetic
   *  Rapier body — the sim owns the kickable head (plan 3.5). The billboard is
   *  driven from sim.headRenders() in main.ts. Both head sources (the 25% normal
   *  popHead and the explosion-launched head) funnel through spawnHeadChunk, so
   *  this single hook captures both. */
  spawnHeadHook: ((origin: Vec3, vel: Vec3) => void) | null = null;
```

Then early-return through it at the top of `spawnHeadChunk` (the very first lines of the method body, before the `RAPIER.RigidBodyDesc...` line):

```typescript
  spawnHeadChunk(origin: Vec3, vel: Vec3, now: number): void {
    if (this.spawnHeadHook) { this.spawnHeadHook(origin, vel); return; }
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      // ... unchanged ...
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Wire the hook + billboard pool in `main.ts`**

In `src/main.ts`, just after the dynamite throw hook block (right after the closing `};` of `dynamite.throwHook = ...`, near line 616), register the head hook:

```typescript
  // ——— Route head-pops into the deterministic sim (plan 3.5: shared kickable head) ———
  // ChunkSystem.spawnHeadChunk funnels BOTH the 25% normal popHead and the
  // explosion-launched head; this hook makes every head a sim object instead of a
  // Rapier body. The blood spray (popHead's emitBurst) stays cosmetic.
  chunks.spawnHeadHook = (origin, vel) => {
    sim.spawnHead(origin.x, origin.y, origin.z, vel.x, vel.y, vel.z);
  };
```

Then add a billboard mesh pool that follows `sim.headRenders()`. Place it next to `syncProjectileBillboards` (after that function, around line 671). It reuses the gib atlas (`gibTextures`) for the zombie head tile 3405 and the same 0.45 m plane the Rapier head used:

```typescript
  // ——— Sim kickable-head billboard registry ————————————————————————
  // Three.js billboards driven by sim.headRenders(). Created/removed to match the
  // sim head list; each faces the camera (lookAt). Tile 3405 = zombie head.
  const ZOMBIE_HEAD_PICNUM = 3405;
  const headMeshes: THREE.Mesh[] = [];

  function syncHeadBillboards(): void {
    const renders = sim.headRenders();
    while (headMeshes.length < renders.length) {
      const geom = new THREE.PlaneGeometry(0.45, 0.45);
      const mat = new THREE.MeshBasicMaterial({
        map: gibTextures!.get(ZOMBIE_HEAD_PICNUM),
        transparent: true,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.frustumCulled = false;
      scene.add(mesh);
      headMeshes.push(mesh);
    }
    while (headMeshes.length > renders.length) {
      const mesh = headMeshes.pop()!;
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    for (let i = 0; i < renders.length; i++) {
      const r = renders[i]!;
      const mesh = headMeshes[i]!;
      mesh.position.set(r.xMeters, r.yMeters, r.zMeters);
      mesh.lookAt(camera.position);
    }
  }
```

- [ ] **Step 4: Call the sync each frame**

In `src/main.ts`, find the existing `syncProjectileBillboards(realDt);` call (around line 861) and add the head sync directly after it:

```typescript
  syncProjectileBillboards(realDt);
  syncHeadBillboards();
```

- [ ] **Step 5: Verify build + full suite (no regressions)**

```bash
npx tsc --noEmit
npx vitest run src
npm run build
```

Expected: `tsc` clean; all `src` tests pass; build succeeds. (Use `npx vitest run src` rather than `npm test` — the repo's `npm test` is polluted by unrelated `docs/dev-notes/model-benchmarks` scratch tests; vitest-config cleanup is a separate pending task.)

- [ ] **Step 6: Commit**

```bash
git add src/game/gibs/chunks.ts src/main.ts
git commit -m "feat(head): reroute enemy-death head-pops to the deterministic sim + billboard"
```

---

### Task 6: Manual playtest gate + docs

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Manual playtest (user-driven)**

Run the dev server and verify in-arena:

```bash
npm run dev
```

Playtest checklist (the human confirms feel — this is the Phase-1 "feel first" gate):
- Kill a zombie until a head pops (25% normal death, or any explosion head-launch).
- The head **falls, bounces, and rolls** with weight (gravity + 0.65 restitution).
- **Walk into the head** → it shoots off **in the direction you're facing**, with a small upward pop, and skitters/rolls away.
- Repeatedly bumping a resting head re-kicks it (after the ~0.15 s cooldown) rather than jittering it in place.
- The head despawns after ~30 s (no unbounded accumulation across a long run).
- No Rapier head body remains (it should move smoothly via the sim, not via the old physics body).

- [ ] **Step 2: Update `TASKS.md`**

In the plan-series line (the bullet listing plans 1–4 + 3.5), flip 3.5 from
`3.5 kickable head (reuses the kThing mover; the shared/interactable object)`
to a `✅ **DONE** (playtest-confirmed)` one-liner noting it lands as a sim `kThing` with a walk-into kick + cosmetic billboard, both head sources rerouted via `chunks.spawnHeadHook`. Leave plan 4 (shotgun cultist) as the next item.

- [ ] **Step 3: Commit**

```bash
git add TASKS.md
git commit -m "docs(tasks): plan 3.5 (kickable head) landed — playtest-confirmed"
```

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-18-blud-deterministic-core-design.md` §"Kickable head"):
- "deterministic sim `kThing` … reusing the `kThing` mover" → Task 1 (`HeadState extends ThingState`, `stepThing`). ✅
- "shared/interactable: co-op peers see the same head and the same kick outcome" → Task 3 (head lives on `SimState`, hashed + snapshotted; determinism harness covers it). ✅
- "plus a player kick interaction" → Task 2 (`kickHeads`). ✅
- "Only the decorative spray around it is cosmetic" → Task 5 (`popHead`'s `emitBurst` blood spray stays; only the physical head moves to the sim). ✅
- Checkpoint: "wire legacy enemy-death head-pops to spawn a sim head" → Task 5 (`spawnHeadHook` captures both `popHead` and the explosion-launched head via the shared `spawnHeadChunk` funnel). ✅

**Placeholder scan:** no TBD/TODO/"add error handling"/"similar to Task N" — every code step is concrete. ✅

**Type consistency:** `HeadState` fields (`kickCooldownTics`, `spawnTic`) are used identically in `head.ts`, `hash.ts`, `snapshot.ts`, `render.ts`, and the tests. `spawnHead(heads, x,y,z, vx,vy,vz, tic)` signature is identical at every call site (tests, runner). `SimRunner.spawnHead(xM,yM,zM, vxMps,vyMps,vzMps)` matches the `chunks.spawnHeadHook` call in Task 5. `renderHeads(prev, cur, alpha)` matches `headRenders()`. ✅

**Known cosmetic deferral:** the old Rapier head emitted a blood **trail** while flying; the sim head's billboard does not (only the spray on pop remains). This is pure garnish and is deferred to avoid coupling the cosmetic `ParticlePool.emitTrail` lifecycle to the sim head pool — note it if feel demands it later.

---

## Execution Handoff

Plan complete. Per this session's decision, it will be executed via **dispatch UI headless agents on `zai/glm-5.2:xhigh`** (the dispatching-plans skill converts these tasks into serial dispatch plan files). After dispatch lands, the user playtests (Task 6 gate) before plan 4 (shotgun cultist) is written.
