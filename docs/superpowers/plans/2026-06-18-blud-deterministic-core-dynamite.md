# Deterministic Core — Dynamite on the Sim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the thrown dynamite onto the deterministic `src/sim/` core as a generic deterministic **`kThing`** (Blood `MoveThing` port: fp velocity, gravity, floor/wall bounce, fuse, impact detonation), emit the explosion as a deterministic `SimEvent`, and make explosion-vs-**player** damage deterministic. The decorative gib spray + enemy AOE stay on the legacy `GibSystem` (driven by the event) until enemies migrate. The `kThing` mover built here is the shared substrate the **kickable head** (plan 3.5) reuses.

**Architecture:** A new `src/sim/thing.ts` provides `ThingState` + `stepThing` — a deterministic moving-thing integrator (integer fp, gravity, floor bounce w/ elastic, wall-clip + bounce via the plan-2 sim-geometry), returning whether it contacted geometry this tic. Dynamite becomes a `ProjectileState` (a `ThingState` + fuse tics + impact flag) held in `SimState.projectiles`, advanced inside `stepSim`. On detonation `stepSim` pushes an `{ kind: 'explosion', … }` `SimEvent`; the render/integration layer drains events → legacy `gibs.spawnExplosion` (VFX + enemy AOE + cosmetic spray, unchanged) AND deterministic explosion-vs-player damage. The legacy `Dynamite` weapon FSM stays, but on release it spawns a *sim* projectile instead of a Rapier one; the Rapier projectile path is removed.

**Tech Stack:** TypeScript, Vitest, Three.js (render boundary only). `src/sim/` stays free of three/Rapier/`src/game` imports.

**Spec:** `docs/superpowers/specs/2026-06-18-blud-deterministic-core-design.md` (§9 dynamite + kThing mover; §1 sim/cosmetic split — head=sim, spray=cosmetic; extends §8 harness with the first in-step RNG if the explosion decision draws RNG).

**Plan series:** 1 (foundation) ✅ · 2 (player) ✅ · **3 (dynamite) ← this** · 3.5 (kickable head, reuses the kThing mover) · 4 (shotgun cultist).

---

## Locked design decisions (rationale)

1. **Generic `kThing` mover, shared.** `stepThing` is the deterministic `MoveThing` port; dynamite is its first consumer, the kickable head (plan 3.5) is the second. Built once, reused.
2. **Source-faithful throw from aim angles.** Replace the current float `throwVector` (Rodrigues on the camera-forward vector) with an integer build from `aimYaw`/`aimPitch` + the lob, via `bcos`/`bsin`. Horizontal direction from yaw, vertical from (pitch + lob). This is closer to Blood `actFireThing` (`xvel,yvel = nSpeed·cos/sin(ang)`, `zvel = nSpeed·(slope+lob)`) and is deterministic. Speed still from `DYNAMITE_COOK` charge (min 6 / max 28 m/s).
3. **Explosion is a `SimEvent`; AOE split by target locality.** The detonation decision (where, air vs ground) is deterministic in the sim. Damage application: **player** (in the sim) is damaged deterministically; **enemies** (still legacy this slice) are damaged by the legacy `GibSystem` consuming the event (unchanged). Cosmetic VFX + gib spray spawn from the event per-client.
4. **`THING_GRAVITY` must match the OLD Rapier world gravity** so the arc/range feel is preserved (range was tuned against it). The implementer reads the gravity passed to `initPhysics()` (`src/physics/world.ts`) and ports that exact m/s² value via `metersPerSecToFp`. (If they differ, the dynamite range changes — a playtest regression.)
5. **Dual-mode limitation (documented, not fixed here):** primary-fire impact-detonate now fires on **geometry** contact (floor/wall, after the grace gates) + the safety fuse — NOT on direct enemy contact (enemies are legacy float bodies the sim can't query deterministically). A dynamite thrown straight at an enemy detonates on landing / fuse rather than on the enemy. Restored when enemies migrate (plan 4) or via an optional legacy proximity trigger. Same spirit as plan 2's deferred player-damage.
6. **Wall/floor bounce uses Blood `elastic`** (`thingInfo` elastic 24576 ⇒ 0.375 in 16.16) applied to the reflected velocity component, mirroring `actFloorBounceVector`.

---

## File Structure

New/!modified under `src/sim/` (firewall: no three/Rapier/`src/game`):
- Create `src/sim/thing.ts` — `ThingState`, `stepThing` (deterministic MoveThing port) returning a geometry-contact flag.
- Create `src/sim/projectile.ts` — `ProjectileState` (+ `THROW`/`FUSE` constants), `spawnProjectile`, `throwVelocity` (integer, from aim), `stepProjectiles` (advance things, fuse, detonation → push explosion events).
- Create `src/sim/explosion.ts` — explosion `SimEvent` shape, integer air/ground floor query (reuse geometry), deterministic explosion-vs-player damage helper.
- Modify `src/sim/types.ts` — add the `{ kind: 'explosion'; … }` variant to `SimEvent`.
- Modify `src/sim/state.ts` — add `projectiles: ProjectileState[]` and the player-HP field if not present (player damage target).
- Modify `src/sim/step.ts` — call `stepProjectiles`, collect + return explosion events.
- Modify `src/sim/hash.ts` / `snapshot.ts` — cover `projectiles`.
- Create `src/sim/render.ts` additions — `renderProjectiles(prev, cur, alpha)` → billboard transforms (meters).
- Modify `src/sim/determinism.test.ts` — throw + detonate a projectile through the recorded stream (first in-step RNG if explosion draws it).

App integration (Task 7):
- Modify `src/sim/runner.ts` — own projectiles; `spawnProjectile(...)` entry; drain explosion events; expose projectile render list.
- Modify `src/main.ts` — legacy `Dynamite` weapon spawns a *sim* projectile; render billboards from the sim; drain explosion events → `gibs.spawnExplosion` + player damage; remove the Rapier projectile path.
- Retire the Rapier projectile internals in `src/game/weapons/dynamite.ts` (keep the weapon FSM/charge/QAV; replace `spawnProjectile`/`updateProjectiles` Rapier bodies with calls into the sim).

**Player-HP note:** Task 5 of plan 2 created `PlayerState` without HP (movement only). This plan adds `hp` to `PlayerState` (the explosion-vs-player target). Confirm it's not already there; if absent, add `hp: number` (init 100) in `createPlayerState`, and mix it in hash/snapshot.

---

## Task 1: Deterministic kThing mover

**Files:**
- Create: `src/sim/thing.ts`
- Test: `src/sim/thing.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/sim/thing.test.ts
import { describe, it, expect } from 'vitest';
import { type ThingState, stepThing, makeThing } from './thing';
import { buildArenaGeometry } from './geometry';
import { fpFromMeters, fpToMeters, metersPerSecToFp } from './fp';

const GEO = buildArenaGeometry();

describe('stepThing — deterministic MoveThing (gravity, floor/wall bounce)', () => {
  it('integrates velocity and applies gravity (falls)', () => {
    const t = makeThing(0, fpFromMeters(5), 0); // 5 m up, at rest
    const yetc = t.y;
    stepThing(t, GEO);
    expect(t.vy).toBeLessThan(0);     // gravity pulled down
    expect(t.y).toBeLessThan(yetc);   // moved down
  });

  it('bounces off the floor with the elastic coefficient, then comes to rest', () => {
    const t = makeThing(0, fpFromMeters(3), 0);
    let bounced = false;
    for (let i = 0; i < 600; i++) {
      const prevVy = t.vy;
      stepThing(t, GEO);
      if (prevVy < 0 && t.vy > 0) bounced = true; // a bounce happened
    }
    expect(bounced).toBe(true);
    expect(t.y).toBe(0);              // settled on floor
    expect(t.resting).toBe(true);
    expect(t.vy).toBe(0);
  });

  it('reports geometry contact the tic it hits the floor', () => {
    const t = makeThing(0, fpFromMeters(0.02), 0); // just above floor
    t.vy = -metersPerSecToFp(5);
    const hit = stepThing(t, GEO);
    expect(hit).toBe(true);
  });

  it('bounces off a perimeter wall (reflects horizontal velocity)', () => {
    // place near the -X wall (inner face ~ -20 m) moving into it
    const t = makeThing(fpFromMeters(-19.5), fpFromMeters(1), 0);
    t.vx = -metersPerSecToFp(10);
    const hit = stepThing(t, GEO);
    expect(hit).toBe(true);
    expect(t.vx).toBeGreaterThan(0);  // reflected outward
  });

  it('is deterministic (same inputs → same state)', () => {
    const a = makeThing(0, fpFromMeters(2), 0); a.vx = metersPerSecToFp(7);
    const b = makeThing(0, fpFromMeters(2), 0); b.vx = metersPerSecToFp(7);
    for (let i = 0; i < 200; i++) { stepThing(a, GEO); stepThing(b, GEO); }
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/sim/thing.test.ts`
Expected: FAIL — `Cannot find module './thing'`.

- [ ] **Step 3: Implement**

```typescript
// src/sim/thing.ts
import { mulfp, metersPerSecToFp, fpFromMeters } from './fp';
import { clipMoveXZ, type SimAABB } from './geometry';

/** A generic deterministic moving thing (Blood kThing / MoveThing port). Integer
 *  fp position/velocity; gravity on Y; floor + wall bounce by `elastic`. Reused by
 *  the dynamite projectile (plan 3) and the kickable head (plan 3.5). */
export interface ThingState {
  x: number; y: number; z: number;     // fp position (y = feet/bottom; floor = 0)
  vx: number; vy: number; vz: number;  // fp/tic velocity
  radius: number;                       // fp horizontal radius for wall clip
  elastic: number;                      // 16.16 restitution (Blood elastic; 24576 = 0.375)
  resting: boolean;
}

/** THING_GRAVITY must match the OLD Rapier world gravity used by initPhysics so
 *  the dynamite arc/range feel is preserved. CONFIRM the value in
 *  src/physics/world.ts and set the m/s² here. (Common Rapier default is -9.81;
 *  if initPhysics set a different y-gravity, use that magnitude.) */
export const THING_GRAVITY_DV = metersPerSecToFp(9.81 / 120); // Δvy per tic — VERIFY vs world.ts
export const DEFAULT_ELASTIC = 24576; // Blood thingInfo elastic for TNT (0.375 in 16.16)
const REST_VY = metersPerSecToFp(0.5); // below this |vy| on floor contact → rest

export function makeThing(x: number, y: number, z: number): ThingState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, radius: fpFromMeters(0.08), elastic: DEFAULT_ELASTIC, resting: false };
}

/** Advance one tic. Returns true if the thing contacted geometry (floor or wall)
 *  this tic — used for impact-detonation. Pure: mutates `t`. */
export function stepThing(t: ThingState, geo: SimAABB[]): boolean {
  let hit = false;

  // gravity + vertical integrate, with floor bounce
  t.vy -= THING_GRAVITY_DV;
  t.y += t.vy;
  if (t.y <= 0) {
    t.y = 0;
    hit = true;
    if (t.vy < 0) {
      const up = mulfp(-t.vy, t.elastic); // reflect + dampen
      if (up <= REST_VY) { t.vy = 0; t.resting = true; }
      else { t.vy = up; t.resting = false; }
    }
  } else {
    t.resting = false;
  }

  // horizontal move with wall clip + bounce
  const moved = clipMoveXZ({ x: t.x, z: t.z }, t.vx, t.vz, t.radius, geo);
  if (moved.x !== t.x + t.vx) { t.vx = mulfp(-t.vx, t.elastic); hit = true; }
  if (moved.z !== t.z + t.vz) { t.vz = mulfp(-t.vz, t.elastic); hit = true; }
  t.x = moved.x;
  t.z = moved.z;

  return hit;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/sim/thing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/thing.ts src/sim/thing.test.ts
git commit -m "feat(sim): deterministic kThing mover (MoveThing port — gravity, floor/wall bounce)"
```

---

## Task 2: Integer throw velocity from aim

**Files:**
- Create: `src/sim/projectile.ts` (start it — `throwVelocity` + constants)
- Test: `src/sim/projectile.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/sim/projectile.test.ts
import { describe, it, expect } from 'vitest';
import { throwVelocity, THROW } from './projectile';
import { metersPerSecToFp, fpToMeters } from './fp';
import { BANGLE_QUARTER } from './trig';

describe('throwVelocity — deterministic, aim-relative + upward lob', () => {
  const speed = metersPerSecToFp(20);

  it('aiming level + yaw 0 → arcs forward (-Z) and upward (+Y)', () => {
    const v = throwVelocity(0 /*yaw*/, 0 /*pitch*/, speed);
    expect(v.vz).toBeLessThan(0);            // forward is -Z at yaw 0
    expect(Math.abs(v.vx)).toBeLessThan(metersPerSecToFp(1)); // no sideways drift
    expect(v.vy).toBeGreaterThan(0);         // lob gives upward bias even level
  });

  it('yaw quarter rotates the throw into the X axis', () => {
    const v = throwVelocity(BANGLE_QUARTER, 0, speed);
    expect(Math.abs(v.vx)).toBeGreaterThan(Math.abs(v.vz));
  });

  it('aiming up increases the vertical component', () => {
    const level = throwVelocity(0, 0, speed);
    const up = throwVelocity(0, 200 /*pitch up*/, speed);
    expect(up.vy).toBeGreaterThan(level.vy);
  });

  it('is deterministic', () => {
    expect(throwVelocity(123, -45, speed)).toEqual(throwVelocity(123, -45, speed));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/sim/projectile.test.ts`
Expected: FAIL — `Cannot find module './projectile'`.

- [ ] **Step 3: Implement (throwVelocity + constants only for now)**

```typescript
// src/sim/projectile.ts
import { mulfp } from './fp';
import { bcos, bsin, BANGLE_FULL } from './trig';
import { TICS_PER_SEC } from './units';

/** Throw tuning (ports DYNAMITE_COOK; tics instead of seconds). */
export const THROW = {
  lobAngle: Math.round((30 / 360) * BANGLE_FULL), // 30° lob in Blood units (≈171)
  fuseMaxTics: Math.round(1.5 * TICS_PER_SEC),    // 1.5 s (alt-fire / safety)
  impactGraceTics: Math.round(0.05 * TICS_PER_SEC),
  impactSafetyFuseTics: Math.round(5.0 * TICS_PER_SEC),
} as const;

export interface ThrowVel { vx: number; vy: number; vz: number; }

/**
 * Build the launch velocity (fp/tic) from aim, source-faithful to actFireThing:
 * horizontal direction from yaw, vertical from (pitch + upward lob). At yaw 0 the
 * forward axis is -Z (matching the player movement convention); +Y is up.
 * `speed` is the launch speed in fp/tic.
 */
export function throwVelocity(yaw: number, pitch: number, speed: number): ThrowVel {
  const effPitch = pitch + THROW.lobAngle;       // upward lob on top of aim
  const horiz = bcos(effPitch);                  // 16.16 horizontal scale
  const vy = mulfp(speed, bsin(effPitch));       // vertical component
  // forward at yaw 0 is -Z: fx = -sin(yaw)?  Use the movement convention:
  //   world forward = (sin(yaw)·? ) — match player: at yaw 0 forward = -Z.
  // local forward (0,-1) rotated by yaw → ( -(-1)·sin? ). Derive directly:
  //   fwdX =  bsin(yaw),  fwdZ = -bcos(yaw)   (yaw 0 → (0,-1) = -Z; yaw 512 → (1,0) = +X)
  const hs = mulfp(speed, horiz);
  const vx = mulfp(hs, bsin(yaw));
  const vz = mulfp(hs, -bcos(yaw));
  return { vx, vy, vz };
}
```

NOTE (Task 2 author): the forward-axis derivation MUST match the player's movement convention from plan 2 (`src/sim/player.ts` `stepPlayer`: at yaw 0, forward is -Z). The test pins `vz < 0` and `|vx|≈0` at yaw 0, and X-dominant at yaw quarter — if those fail, fix the `bsin(yaw)`/`-bcos(yaw)` mapping to agree with `stepPlayer`, don't just tweak signs blindly. Cross-check against `stepPlayer`'s `wx/wz` rotation.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/sim/projectile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/projectile.ts src/sim/projectile.test.ts
git commit -m "feat(sim): deterministic dynamite throw velocity (aim-relative + lob)"
```

---

## Task 3: Projectile state, fuse, detonation → explosion event

**Files:**
- Modify: `src/sim/projectile.ts` (add `ProjectileState`, `spawnProjectile`, `stepProjectiles`)
- Modify: `src/sim/types.ts` (add explosion `SimEvent` variant), `src/sim/state.ts` (`projectiles` + player `hp`), `src/sim/step.ts` (call `stepProjectiles`)
- Test: `src/sim/projectile.test.ts` (extend)

- [ ] **Step 1: Write the failing test (extend projectile.test.ts)**

```typescript
import { createSimState } from './state';
import { stepSim } from './step';
import { buildArenaGeometry } from './geometry';
import { EMPTY_INPUT } from './types';

const GEO = buildArenaGeometry();

describe('projectiles in the sim — fuse + detonation', () => {
  it('a fuse-mode projectile detonates when its fuse runs out, emitting one explosion event', () => {
    const s = createSimState(1);
    // drop straight down at center with a short fuse, impactMode off
    s.projectiles.push({
      x: 0, y: 5_000_000, z: 0, vx: 0, vy: 0, vz: 0,
      radius: 5242, elastic: 24576, resting: false,
      fuseTics: 3, fuseMaxTics: 3, impactMode: false, spawnTic: 0, spawnX: 0, spawnY: 5_000_000, spawnZ: 0,
    });
    const events: any[] = [];
    for (let i = 0; i < 5; i++) events.push(...stepSim(s, EMPTY_INPUT, GEO));
    const boom = events.filter((e) => e.kind === 'explosion');
    expect(boom).toHaveLength(1);
    expect(s.projectiles).toHaveLength(0); // removed after detonation
  });

  it('an impact-mode projectile detonates on geometry contact after the grace window', () => {
    const s = createSimState(1);
    s.projectiles.push({
      x: 0, y: 200_000, z: 0, vx: 0, vy: -metersPerSecToFp(20), vz: 0,
      radius: 5242, elastic: 24576, resting: false,
      fuseTics: THROW.impactSafetyFuseTics, fuseMaxTics: THROW.impactSafetyFuseTics,
      impactMode: true, spawnTic: 0, spawnX: 0, spawnY: 200_000, spawnZ: 0,
    });
    let boom = 0;
    // advance past the grace window; it falls to the floor and detonates on contact
    for (let i = 0; i < 30; i++) boom += stepSim(s, EMPTY_INPUT, GEO).filter((e: any) => e.kind === 'explosion').length;
    expect(boom).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/sim/projectile.test.ts`
Expected: FAIL — `s.projectiles` undefined / `stepSim` doesn't handle projectiles.

- [ ] **Step 3: Implement**

Add to `src/sim/projectile.ts`:
```typescript
import { stepThing, type ThingState } from './thing';
import type { SimAABB } from './geometry';
import type { SimEvent } from './types';

/** A thrown dynamite: a kThing with a fuse + impact behavior. */
export interface ProjectileState extends ThingState {
  fuseTics: number;
  fuseMaxTics: number;
  impactMode: boolean;          // detonate on geometry contact (after grace) vs pure fuse
  spawnTic: number;
  spawnX: number; spawnY: number; spawnZ: number;
}

const IMPACT_SAFE_DIST_SQ_FP = (() => { const d = 5242 * 134; return d * d; })(); // ~0.7 m in fp, squared — see note

/** Advance all projectiles one tic; detonate (fuse out OR impact) → push explosion
 *  events. `tic` is the current SimState.tic. Returns nothing; mutates `projectiles`. */
export function stepProjectiles(
  projectiles: ProjectileState[], geo: SimAABB[], tic: number, out: SimEvent[],
): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i]!;
    p.fuseTics -= 1;
    const hitGeo = stepThing(p, geo);

    let detonate = p.fuseTics <= 0;
    if (!detonate && p.impactMode && (tic - p.spawnTic) >= THROW.impactGraceTics && hitGeo) {
      const dx = p.x - p.spawnX, dy = p.y - p.spawnY, dz = p.z - p.spawnZ;
      if (dx * dx + dy * dy + dz * dz >= IMPACT_SAFE_DIST_SQ_FP) detonate = true;
    }

    if (detonate) {
      out.push({ kind: 'explosion', x: p.x, y: p.y, z: p.z });
      projectiles.splice(i, 1);
    }
  }
}

/** Spawn a thrown dynamite into the sim. */
export function spawnProjectile(
  projectiles: ProjectileState[], x: number, y: number, z: number,
  vel: ThrowVel, fuseTics: number, impactMode: boolean, tic: number,
): void {
  projectiles.push({
    x, y, z, vx: vel.vx, vy: vel.vy, vz: vel.vz,
    radius: 5242 /* ~0.08 m */, elastic: 24576, resting: false,
    fuseTics, fuseMaxTics: fuseTics, impactMode,
    spawnTic: tic, spawnX: x, spawnY: y, spawnZ: z,
  });
}
```
(NOTE: the `IMPACT_SAFE_DIST_SQ_FP` literal above is a placeholder formula — compute it cleanly as `const safe = fpFromMeters(0.7); IMPACT_SAFE_DIST_SQ_FP = safe*safe;` using `fpFromMeters` imported from `./fp`. Replace the IIFE with that. radius `5242` ≈ `fpFromMeters(0.08)`; prefer `fpFromMeters(0.08)`.)

In `src/sim/types.ts`, extend `SimEvent`:
```typescript
export type SimEvent =
  | { kind: 'noop' }
  | { kind: 'explosion'; x: number; y: number; z: number };
```

In `src/sim/state.ts`: add `projectiles: ProjectileState[]` (init `[]`) and, if `PlayerState` lacks it, `hp` (handled in Task 4). Import `ProjectileState`.

In `src/sim/step.ts`:
```typescript
import { stepProjectiles } from './projectile';
// inside stepSim, after stepPlayer:
const events: SimEvent[] = [];
stepProjectiles(state.projectiles, geo, state.tic, events);
// ...integrate bodies...
return events;
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/sim/projectile.test.ts src/sim/step.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/projectile.ts src/sim/types.ts src/sim/state.ts src/sim/step.ts src/sim/projectile.test.ts
git commit -m "feat(sim): dynamite projectiles in SimState — fuse + impact detonation → explosion event"
```

---

## Task 4: Explosion air/ground + deterministic player damage

**Files:**
- Create: `src/sim/explosion.ts`
- Modify: `src/sim/state.ts` (player `hp`), `src/sim/projectile.ts` (event carries air/ground), `src/sim/types.ts` (event fields)
- Test: `src/sim/explosion.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/sim/explosion.test.ts
import { describe, it, expect } from 'vitest';
import { isAirBurstFp, applyExplosionToPlayer } from './explosion';
import { buildArenaGeometry } from './geometry';
import { createPlayerState } from './player';
import { fpFromMeters } from './fp';
import { createRng } from './rng';

const GEO = buildArenaGeometry();

describe('explosion air/ground (integer floor query)', () => {
  it('a blast on the floor is a ground burst', () => {
    expect(isAirBurstFp(fpFromMeters(2), 0, fpFromMeters(2), GEO)).toBe(false);
  });
  it('a blast high in the air is an air burst', () => {
    expect(isAirBurstFp(fpFromMeters(2), fpFromMeters(3), fpFromMeters(2), GEO)).toBe(true);
  });
});

describe('explosion-vs-player damage (deterministic)', () => {
  it('damages the player within radius, falling off with distance', () => {
    const near = createPlayerState(); near.x = fpFromMeters(1);
    const far = createPlayerState(); far.x = fpFromMeters(4);
    const rng = createRng(1);
    applyExplosionToPlayer(near, fpFromMeters(0), 0, fpFromMeters(0), rng);
    applyExplosionToPlayer(far, fpFromMeters(0), 0, fpFromMeters(0), createRng(1));
    expect(near.hp).toBeLessThan(100);
    expect(far.hp).toBeGreaterThan(near.hp); // less damage farther out
  });
  it('no damage beyond the radius', () => {
    const p = createPlayerState(); p.x = fpFromMeters(50);
    applyExplosionToPlayer(p, 0, 0, 0, createRng(1));
    expect(p.hp).toBe(100);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/sim/explosion.test.ts`
Expected: FAIL — `Cannot find module './explosion'`.

- [ ] **Step 3: Implement**

First ensure `PlayerState` has `hp` (in `src/sim/player.ts`): add `hp: number` to the interface and `hp: 100` in `createPlayerState`; mix `p.hp` in `hashSimState` and copy in `cloneSimState`.

```typescript
// src/sim/explosion.ts
import { mulfp, fpFromMeters, fpToMeters } from './fp';
import { clipMoveXZ, type SimAABB } from './geometry'; // for the downward floor query helper if needed
import type { PlayerState } from './player';
import { type SimRng } from './rng';

// EXPLOSION_STANDARD (ports tuning.ts): radius 150 BU, scaled for spatial feel.
// Mirror the legacy GibSystem: radiusM = (150/256) * RADIUS_SCALE_FACTOR(8) ≈ 4.69 m.
const RADIUS_FP = fpFromMeters((150 / 256) * 8);
const GROUND_THRESHOLD_FP = fpFromMeters(0.6); // matches GROUND_BURST_THRESHOLD_M
const PLAYER_MAX_DAMAGE = 240; // point-blank (matches DAMAGE_TICK_STACK feel)

/** Air vs ground by floor proximity. floorDistFp = blast Y above the floor; the
 *  arena floor is y=0, so for the flat arena this is just the blast's y. (Kept as
 *  a function so a future multi-floor sim-geometry can do a real downward query.) */
export function isAirBurstFp(_x: number, y: number, _z: number, _geo: SimAABB[]): boolean {
  return y > GROUND_THRESHOLD_FP;
}

/** Deterministic explosion damage to the player (the only sim-resident target this
 *  slice). Linear falloff to the radius edge. `rng` reserved for any future
 *  variance roll (kept in the signature so the harness exercises the RNG path). */
export function applyExplosionToPlayer(
  p: PlayerState, ex: number, ey: number, ez: number, rng: SimRng,
): void {
  void rng;
  const dx = fpToMeters(p.x - ex), dy = fpToMeters(p.y - ey), dz = fpToMeters(p.z - ez);
  const dist = Math.hypot(dx, dy, dz);
  const radiusM = fpToMeters(RADIUS_FP);
  if (dist >= radiusM) return;
  const falloff = 1 - dist / radiusM;
  p.hp -= Math.round(PLAYER_MAX_DAMAGE * falloff);
}
```
(NOTE: `applyExplosionToPlayer` uses meters/floats for the falloff *scalar* — this is acceptable ONLY because it's the same on every peer given identical integer inputs (deterministic float from deterministic ints). If you want to be strict, compute the squared distance in fp and the falloff in fixed-point. Keep it simple unless the harness flags divergence. `rng` is currently unused — see the note in the harness task about whether to add a variance roll; if not, you may drop the `rng` param, but keeping it future-proofs the explosion decision as the first RNG-in-step consumer.)

Have `stepProjectiles` (Task 3) compute air/ground at detonation and include it on the event, and apply player damage. Update the event + call:
- `src/sim/types.ts`: `{ kind: 'explosion'; x; y; z; air: boolean }`.
- In `stepProjectiles`, pass the player + rng in (extend its signature to `(projectiles, player, geo, tic, rng, out)`), and on detonation: `const air = isAirBurstFp(p.x, p.y, p.z, geo); applyExplosionToPlayer(player, p.x, p.y, p.z, rng); out.push({ kind: 'explosion', x: p.x, y: p.y, z: p.z, air });`. Update `stepSim` to pass `state.player` and `state.rng`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/sim/explosion.test.ts src/sim/projectile.test.ts src/sim/step.test.ts`
Expected: PASS. Update any earlier projectile test that asserted the event shape to include `air`.

- [ ] **Step 5: Commit**

```bash
git add src/sim/explosion.ts src/sim/player.ts src/sim/projectile.ts src/sim/types.ts src/sim/state.ts src/sim/step.ts src/sim/hash.ts src/sim/snapshot.ts src/sim/explosion.test.ts
git commit -m "feat(sim): explosion air/ground + deterministic explosion-vs-player damage"
```

---

## Task 5: hash/snapshot cover projectiles; render billboards

**Files:**
- Modify: `src/sim/hash.ts`, `src/sim/snapshot.ts`, `src/sim/render.ts`
- Test: extend `src/sim/hash.test.ts`, `src/sim/render.test.ts`

- [ ] **Step 1: Write the failing tests**

In `hash.test.ts` add: a projectile position change alters the hash, and a player `hp` change alters the hash. In `render.test.ts` add: `renderProjectiles(prev, cur, alpha)` returns one `{xMeters,yMeters,zMeters}` per projectile, interpolated.

```typescript
// hash.test.ts additions
  it('changes when a projectile differs', () => {
    const a = createSimState(5); const b = createSimState(5);
    b.projectiles.push({ x: 1, y: 2, z: 3, vx: 0, vy: 0, vz: 0, radius: 1, elastic: 24576, resting: false, fuseTics: 1, fuseMaxTics: 1, impactMode: true, spawnTic: 0, spawnX: 1, spawnY: 2, spawnZ: 3 });
    expect(hashSimState(a)).not.toBe(hashSimState(b));
  });
  it('changes when player hp differs', () => {
    const a = createSimState(5); const b = createSimState(5); b.player.hp = 50;
    expect(hashSimState(a)).not.toBe(hashSimState(b));
  });
```
```typescript
// render.test.ts addition
  it('renderProjectiles interpolates positions to meters', () => {
    const prev = createSimState(1); const cur = createSimState(1);
    const base = { vx:0,vy:0,vz:0,radius:1,elastic:24576,resting:false,fuseTics:1,fuseMaxTics:1,impactMode:true,spawnTic:0,spawnX:0,spawnY:0,spawnZ:0 };
    prev.projectiles.push({ ...base, x: 0, y: fpFromMeters(0), z: 0, spawnX:0,spawnY:0,spawnZ:0 });
    cur.projectiles.push({ ...base, x: fpFromMeters(2), y: 0, z: 0, spawnX:0,spawnY:0,spawnZ:0 });
    const out = renderProjectiles(prev.projectiles, cur.projectiles, 0.5);
    expect(out[0]!.xMeters).toBeCloseTo(1, 6);
  });
```
(Import `createSimState` in render.test.ts, and `fpFromMeters` already imported.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/sim/hash.test.ts src/sim/render.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`hash.ts` — after the player mix, add:
```typescript
  for (const pr of s.projectiles) {
    mix(pr.x); mix(pr.y); mix(pr.z); mix(pr.vx); mix(pr.vy); mix(pr.vz);
    mix(pr.fuseTics); mix(pr.impactMode ? 1 : 0);
  }
```
`snapshot.ts` — add `projectiles: s.projectiles.map((p) => ({ ...p }))` to the returned object (and confirm `player: { ...s.player }` carries `hp`).
`render.ts` — add:
```typescript
export interface ProjectileRender { xMeters: number; yMeters: number; zMeters: number; }
export function renderProjectiles(prev: ProjectileState[], cur: ProjectileState[], alpha: number): ProjectileRender[] {
  // Match by index; a projectile that detonated this tic (in prev, not cur) is dropped.
  const n = Math.min(prev.length, cur.length);
  const out: ProjectileRender[] = [];
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
(Import `ProjectileState` from `./projectile` in render.ts. Index-matching is sufficient because projectiles are append-only within a tic and removed on detonation; the runner uses the same `prev`/`cur` snapshots it already keeps for the player.)

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/sim/hash.test.ts src/sim/render.test.ts src/sim/snapshot.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/hash.ts src/sim/snapshot.ts src/sim/render.ts src/sim/hash.test.ts src/sim/render.test.ts
git commit -m "feat(sim): projectiles in hash/snapshot + renderProjectiles billboards"
```

---

## Task 6: Harness drives a thrown projectile (first in-step RNG, if any)

**Files:**
- Modify: `src/sim/determinism.test.ts`

- [ ] **Step 1: Extend the harness**

Add a projectile to `seededState` (spawn one mid-air with a fuse) so every run throws + detonates during the recorded stream, exercising `stepProjectiles` + `applyExplosionToPlayer`:
```typescript
import { spawnProjectile, throwVelocity } from './projectile';
// inside seededState(seed), after seeding bodies:
spawnProjectile(s.projectiles, 0, 3_000_000, 0, throwVelocity(s.player.yaw, 0, 2_500_000), 90, true, 0);
```
Keep the four existing assertions; they now also cover projectile physics + detonation + player damage. If you added a variance roll drawing from `state.rng` in `applyExplosionToPlayer`, this is the first in-step RNG — confirm the per-tic hash match still holds (it must, since both states share the seed). Update the top comment: `// Harness now covers player + projectiles (throw/bounce/fuse/detonation/explosion-vs-player). RNG-in-step exercised iff the explosion draws it.`

- [ ] **Step 2: Run harness + full gate**

Run: `npx vitest run src/sim/determinism.test.ts`
Expected: PASS (4 cases, now with a detonating projectile).
Run: `npx tsc --noEmit && npx vitest run --exclude '**/.claude/**'`
Expected: tsc clean; all green.

- [ ] **Step 3: Commit**

```bash
git add src/sim/determinism.test.ts
git commit -m "test(sim): harness throws + detonates a projectile (covers explosion-vs-player)"
```

---

## Task 7: Wire sim dynamite into the app (integration + playtest)

**Files:**
- Modify: `src/sim/runner.ts`, `src/main.ts`, `src/game/weapons/dynamite.ts`

Integration glue — verify by manual playtest. The legacy `Dynamite` weapon FSM (charge/QAV/cook) stays; only the *projectile body + detonation* moves to the sim. Read the current `src/game/weapons/dynamite.ts` (`spawnProjectile`, `updateProjectiles`, `Dynamite.onRelease`/`selfExplode`, the `FrameCtx`) before editing.

- [ ] **Step 1: Runner owns projectiles + drains events**

In `src/sim/runner.ts`: keep the explosion events from each `stepSim` call across the frame; add `spawnProjectile(...)` (delegating to the sim) and `projectileRenders()` (via `renderProjectiles(prev, cur, alpha)`), and `drainEvents(): SimEvent[]`.
```typescript
// fields: private events: SimEvent[] = [];
// in advance(), accumulate: this.events.push(...stepSim(this.state, nextInput(), this.geo));
// add:
spawnProjectile(xM: number, yM: number, zM: number, yaw: number, pitch: number, speedMps: number, fuseTics: number, impact: boolean): void {
  spawnProjectile(this.state.projectiles, fpFromMeters(xM), fpFromMeters(yM), fpFromMeters(zM),
    throwVelocity(yaw, pitch, metersPerSecToFp(speedMps)), fuseTics, impact, this.state.tic);
}
projectileRenders(): ProjectileRender[] { return renderProjectiles(this.prev.projectiles, this.state.projectiles, this.accumulator / SIM_DT); }
drainEvents(): SimEvent[] { const e = this.events; this.events = []; return e; }
```

- [ ] **Step 2: Dynamite weapon spawns a SIM projectile**

In `src/main.ts`, where the legacy `Dynamite` weapon detonates/throws (its `onRelease`/`spawnProjectile` path via `FrameCtx`), route the throw to `sim.spawnProjectile(...)` using the player's eye position (`sim.playerRender()`), the current `aimYaw`/`aimPitch`, the charge-derived speed (`throwVelocityMps(chargeFrac)`), the fuse (impact-mode primary fire: `THROW.impactSafetyFuseTics`, impact=true; alt-fire/drop: `fuseMaxTics`, impact=false). Remove the call into the Rapier `spawnProjectile`/`updateProjectiles` from dynamite.ts (delete those Rapier-body functions, keep the pure math `throwVelocityMps`/`chargeFraction`/`fuseFrameIndex` and the weapon FSM). The dynamite billboard sprites now render from `sim.projectileRenders()` each frame in the render callback (create/update/remove THREE meshes to match the list; reuse `projectileFrames` for the fuse-frame texture).

- [ ] **Step 3: Drain explosion events each frame → VFX + AOE + sfx**

In the render callback, after `sim.advance(...)`:
```typescript
for (const ev of sim.drainEvents()) {
  if (ev.kind === 'explosion') {
    sfx.play(SfxEvent.DYNAMITE_BOOM, { x: ev.x_m, y: ev.y_m, z: ev.z_m }); // convert ev fp→m
    gibs.spawnExplosion({ x: ev.x_m, y: ev.y_m, z: ev.z_m }, EXPLOSION_STANDARD, performance.now()/1000);
    // (gibs.spawnExplosion already does air/ground selection via its own raycast;
    //  ev.air is available if you prefer to pass it through and skip the raycast.)
  }
}
```
Convert event fp coords to meters (`fpToMeters`). The legacy `gibs.spawnExplosion` keeps doing enemy AOE + cosmetic spray + the air/ground SEQ. Player damage already happened deterministically in the sim (Task 4) — do NOT double-apply it here.

- [ ] **Step 4: Verify build/typecheck/tests**

Run: `npx tsc --noEmit && npx vitest run --exclude '**/.claude/**'` → clean + green.
Run: `npx vite build` → succeeds. Fix any leftover references to the removed Rapier projectile functions.

- [ ] **Step 5: Manual playtest**

`npx vite`, then verify: throwing dynamite arcs and lands like before (range scales with charge — if the arc is wrong, `THING_GRAVITY_DV` doesn't match the old world gravity, Task 1 decision #4); it bounces off walls/floor; it detonates on landing (and on the safety fuse); explosion VFX + air/ground look right; enemies still take AOE damage (legacy path); the player takes damage from a close self-detonation (deterministic). KNOWN this slice: a dynamite thrown directly at an enemy detonates on landing/fuse, not on the enemy (dual-mode limitation #5).

- [ ] **Step 6: Commit**

```bash
git add src/sim/runner.ts src/main.ts src/game/weapons/dynamite.ts
git commit -m "feat(sim): thrown dynamite runs on the deterministic sim (retire Rapier projectile)"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** §9 kThing mover → Task 1; dynamite throw/fuse/detonation → Tasks 2–3; explosion decision + air/ground + player damage → Task 4; §8 harness extension (first in-step RNG path) → Task 6; render boundary → Task 5; integration → Task 7. Kickable head is explicitly plan 3.5 (reuses Task 1's mover).
- **Placeholder scan:** the two inline NOTEs (Task 3 `IMPACT_SAFE_DIST_SQ_FP` cleanup; Task 4 float-falloff caveat) are explicit cleanups with the exact replacement given, not vague TODOs. Task 1 decision #4 (gravity must match world.ts) and Task 2's forward-axis note are bounded verification steps against cited files.
- **Type consistency:** `ThingState`/`stepThing`, `ProjectileState extends ThingState`, `throwVelocity(yaw,pitch,speed)`, `spawnProjectile`, `stepProjectiles(projectiles, player, geo, tic, rng, out)`, `SimEvent {kind:'explosion',x,y,z,air}`, `isAirBurstFp`, `applyExplosionToPlayer`, `renderProjectiles` are used consistently. `stepSim` stays 3-arg `(state, input, geo)` and now returns the explosion events.
- **Firewall:** all new `src/sim/` files import only `./*`; explosion.ts uses meters floats internally for a falloff scalar (deterministic given integer inputs — noted) but stores results as integer `hp`. `runner.ts` stays three-free.
- **Risk flags:** (a) `THING_GRAVITY` must equal the old Rapier world gravity or the arc changes — Task 1 #4. (b) Forward-axis sign mapping in `throwVelocity` must match `stepPlayer` — Task 2 note + test. (c) Enemy-impact detonation + enemy AOE remain legacy (dual-mode #5). (d) Task 7 is real main.ts/dynamite.ts surgery — implementer reads current code and may surface adaptation questions.

## Done criteria

- `npx tsc --noEmit` clean; `npx vitest run --exclude '**/.claude/**'` green (harness throws + detonates a projectile).
- Determinism harness: identical hashes per tic / replay / snapshot-resume with player + projectiles + explosion-vs-player exercised.
- `src/sim/` imports nothing from three/Rapier/`src/game`.
- Manual playtest: dynamite arc/range/bounce/detonation feel matches; explosion VFX + air/ground correct; enemies take AOE; player takes self-detonation damage.

When this lands, ping for **Plan 3.5 (kickable head)** — it reuses `thing.ts` (the `kThing` mover) for the head's deterministic physics, adds the player kick interaction, a cosmetic billboard view, and wires legacy enemy-death head-pops to spawn a sim head (the shared/interactable object you flagged).
