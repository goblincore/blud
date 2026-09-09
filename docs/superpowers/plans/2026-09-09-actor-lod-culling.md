# Actor LOD and Visibility Culling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop paying to march, pose and mesh actors nobody can see, without weakening the cross-room aggression the owner deliberately added.

**Architecture:** A pure `actor-lod.ts` controller decides one of three tiers per actor per frame from frustum, line-of-sight and distance. `game-main` calls it once and filters each consumer by the result. Suspended actors keep converging via a new cheap `stepCoarse` on the actor that slides along the cached nav route with no motion, rig, kit or view work.

**Tech Stack:** TypeScript, vitest (no GPU needed for any test in this plan), three.js only at the `game-main` wiring layer.

**Prerequisite:** `docs/superpowers/plans/2026-09-09-phase0-restore-measurement.md` must be complete and its baseline committed. If Phase 0 found the mesh path and the encounter director to be cheap, **stop and report** — this plan's premise is that they are not.

**Spec:** `docs/superpowers/specs/2026-09-09-actor-lod-culling-design.md`

---

## Background you need

**The problem.** Nothing in the frame is gated by visibility.
`game-main.ts:912` hands `sdfLayer.setBodies()` every actor in the level; the
SDF proxy boxes are `frustumCulled = false` (`zombie-gpu.ts:1759` — "the proxy
IS the bound; don't double-cull") so three culls nothing; the occluder pre-pass
has been off since 2026-09-01. `bodiesOnScreen()` (`game-main.ts:3248`) already
computes a per-actor frustum test every frame **for the HUD only** and throws
the answer away.

**Why not the GPU occluder.** It was disabled for a measured reason: its
rasterised distance under-reports past ~3 m and shredded distant bodies. Do not
revive it. Actor-level culling only needs "can the camera see this torso", and
`clearSight(a, b, boxes)` — exported from
`src/lab/sdf-zombie/webgpu/encounter-director.ts:25` — is already an exact
ray/AABB slab test the AI already trusts.

**Why the module must stay `three`-free.** Every pure controller in this repo
(`adaptive-scale.ts`, `crowd.ts`, `encounter-director.ts`) takes plain numbers
so vitest can import it with no GPU. `actor-lod.ts` follows that: **the caller
computes the frustum booleans and passes them in.**

**Vec3** is `[number, number, number]` from `src/lab/sdf-zombie/types.ts`.
**Aabb** is `{ min: Vec3; max: Vec3 }` from `webgpu/game-level.ts` — import it
with `import type`, the way `encounter-director.ts` does.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/actor-lod.ts` (new) | Pure tier decision. No three, no DOM. |
| `src/lab/sdf-zombie/webgpu/actor-lod.test.ts` (new) | Its tests. |
| `src/lab/sdf-zombie/webgpu/game-actor.ts` (modify) | `stepCoarse` + `resume`. |
| `src/lab/sdf-zombie/webgpu/game-actor-lod.test.ts` (new) | Coarse-step and promotion tests. |
| `src/lab/sdf-zombie/webgpu/game-main.ts` (modify) | Wiring, seam, HUD, census. |
| `scripts/sdf-game-bench.mjs` (modify) | The `actor-lod-off` A/B leg. |

---

### Task 1: The room adjacency helper

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/actor-lod.ts`
- Test: `src/lab/sdf-zombie/webgpu/actor-lod.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/actor-lod.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { roomAdjacency } from './actor-lod';
import { TUNNELS } from './game-level';

describe('roomAdjacency', () => {
  it('is symmetric', () => {
    const adj = roomAdjacency([{ a: 1, b: 2 }, { a: 2, b: 5 }]);
    expect([...adj.get(1)!]).toEqual([2]);
    expect([...adj.get(2)!].sort()).toEqual([1, 5]);
    expect([...adj.get(5)!]).toEqual([2]);
  });

  it('gives an empty set for a room with no tunnels', () => {
    const adj = roomAdjacency([{ a: 1, b: 2 }]);
    expect(adj.get(3)).toBeUndefined();
  });

  it('matches the real level: room 2 touches 1, 3 and 5', () => {
    const adj = roomAdjacency(TUNNELS);
    expect([...adj.get(2)!].sort()).toEqual([1, 3, 5]);
    // Room 5 is the annex — it hangs off room 2 alone.
    expect([...adj.get(5)!]).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/actor-lod.test.ts`
Expected: FAIL — `Failed to resolve import "./actor-lod"`.

- [ ] **Step 3: Create the module with just this helper**

Create `src/lab/sdf-zombie/webgpu/actor-lod.ts`:

```ts
// src/lab/sdf-zombie/webgpu/actor-lod.ts
//
// WHICH ACTORS ARE WORTH PAYING FOR THIS FRAME.
//
// Nothing in the game's frame was gated by visibility before this module: the
// SDF proxy boxes ship frustumCulled=false ("the proxy IS the bound"), the
// occluder pre-pass has been off since 2026-09-01, and setBodies took every
// actor in the level. Meanwhile the owner made enemies pursue across rooms, so
// the player's room now holds more bodies than it spawns (bench census: room 3
// spawns 3, showed 8).
//
// PURE ON PURPOSE, and three-free: every controller in this repo that decides
// something (adaptive-scale, crowd, encounter-director) takes plain numbers so
// vitest can pin its behaviour with no GPU. The caller owns THREE and passes
// the frustum verdict in as a boolean.
//
// THE TIERS ARE NOT A QUALITY LADDER, they are a "who pays" ladder:
//   active     — drawn. Pays everything, exactly as before this module.
//   near       — invisible but close. Full AI, motion and rig; no rendering.
//   suspended  — far. Slides along its cached route and nothing else.
//
// Suspended is NOT a freeze. Cross-room convergence is behaviour the owner
// added deliberately, so a suspended actor still arrives — it just stops
// paying for the parts nobody can see. See ZombieActor.stepCoarse.
import type { Vec3 } from '../types';

/** One tunnel's endpoints. Structural on purpose so this module never has to
 *  import game-level at runtime. */
export interface RoomLink { a: number; b: number }

/** roomId -> rooms one tunnel hop away. Rooms with no tunnel are absent. */
export function roomAdjacency(links: readonly RoomLink[]): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>();
  const link = (from: number, to: number) => {
    let set = adj.get(from);
    if (!set) { set = new Set(); adj.set(from, set); }
    set.add(to);
  };
  for (const l of links) { link(l.a, l.b); link(l.b, l.a); }
  return adj;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/actor-lod.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/actor-lod.ts src/lab/sdf-zombie/webgpu/actor-lod.test.ts
git commit -m "feat(actor-lod): room adjacency from the tunnel graph"
```

---

### Task 2: Tier classification, without hysteresis

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/actor-lod.ts`
- Test: `src/lab/sdf-zombie/webgpu/actor-lod.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lab/sdf-zombie/webgpu/actor-lod.test.ts`:

```ts
import { classifyActors, initialActorLodState, type ActorLodSnapshot } from './actor-lod';
import type { Aabb } from './game-level';

const NO_BOXES: Aabb[] = [];
const snap = (id: number, x: number, z: number, room = 1): ActorLodSnapshot =>
  ({ id, pos: [x, 0, z], torso: [x, 1.1, z], room });

/** One frame with no walls, everything in the player's room. */
const run = (snapshots: ActorLodSnapshot[], inFrustum: boolean[], over: Partial<Parameters<typeof classifyActors>[1]> = {}) =>
  classifyActors(initialActorLodState(), {
    nowMs: 0, eye: [0, 1.6, 0], playerRoom: 1,
    snapshots, inFrustum, colliders: NO_BOXES,
    adjacency: roomAdjacency([]), ...over,
  });

describe('classifyActors — tiers', () => {
  it('an actor in frustum with clear sight is active', () => {
    expect(run([snap(1, 0, 5)], [true]).tiers).toEqual(['active']);
  });

  it('an actor out of frustum but close is near, not suspended', () => {
    expect(run([snap(1, 0, 5)], [false]).tiers).toEqual(['near']);
  });

  it('an actor in frustum but behind a wall is near', () => {
    const wall: Aabb[] = [{ min: [-5, 0, 2], max: [5, 3, 2.5] }];
    expect(run([snap(1, 0, 5)], [true], { colliders: wall }).tiers).toEqual(['near']);
  });

  it('an actor beyond the suspend radius is suspended even when in frustum', () => {
    expect(run([snap(1, 0, 25)], [true]).tiers).toEqual(['suspended']);
  });

  it('a far actor in a non-adjacent room is suspended without any sight test', () => {
    expect(run([snap(1, 0, 16, 4)], [false], { adjacency: roomAdjacency([{ a: 1, b: 2 }]) }).tiers)
      .toEqual(['suspended']);
  });

  it('counts each tier', () => {
    const r = run([snap(1, 0, 5), snap(2, 0, 6), snap(3, 0, 25)], [true, false, false]);
    expect(r.counts).toEqual({ active: 1, near: 1, suspended: 1 });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/actor-lod.test.ts`
Expected: FAIL — `classifyActors is not exported` / not defined.

- [ ] **Step 3: Implement**

Append to `src/lab/sdf-zombie/webgpu/actor-lod.ts`:

```ts
import { clearSight } from './encounter-director';
import type { Aabb } from './game-level';

export type ActorTier = 'active' | 'near' | 'suspended';

export interface ActorLodSnapshot {
  id: number;
  /** Ground position — what the distance tests read. */
  pos: Vec3;
  /** Torso centre — what the sight test aims at. */
  torso: Vec3;
  /** Room the actor is CURRENTLY in (nav.roomAt), never its home room. */
  room: number;
}

export interface ActorLodInput {
  nowMs: number;
  /** Camera eye. */
  eye: Vec3;
  /** Player's current room; 0 when in no known room (then rooms never gate). */
  playerRoom: number;
  snapshots: readonly ActorLodSnapshot[];
  /** Parallel to `snapshots`: torso sphere inside the view frustum. The caller
   *  owns THREE, so it owns this test. */
  inFrustum: readonly boolean[];
  colliders: readonly Aabb[];
  adjacency: ReadonlyMap<number, ReadonlySet<number>>;
}

export interface ActorLodState {
  /** Keyed by actor ID, never by array index — actors are spawned, gibbed and
   *  recycled, and an index-keyed dwell timer would silently transfer from one
   *  actor to another. */
  entries: Map<number, { tier: ActorTier; sinceMs: number }>;
}

export interface ActorLodResult {
  tiers: ActorTier[];
  state: ActorLodState;
  counts: { active: number; near: number; suspended: number };
}

/**
 * Radii in METRES, anchored to the encounter director's own ranges rather than
 * fitted to the current greybox — that level is ~27 x 17 m with no doors and is
 * an explicit test fixture, so anything tuned to it would not transfer.
 *
 * SUSPEND at 18 m and PROMOTE at 14 m. 14 is past the director's 10 m sight cap
 * AND its 12 m hearing cap, so an actor is only ever suspended once it is
 * outside every range at which it could perceive the player at all. The 4 m gap
 * is the hysteresis band — wider than an actor covers in one coarse tick.
 */
export const PROMOTE_RADIUS_M = 14;
export const SUSPEND_RADIUS_M = 18;

export function initialActorLodState(): ActorLodState {
  return { entries: new Map() };
}

function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

export function classifyActors(state: ActorLodState, input: ActorLodInput): ActorLodResult {
  const { snapshots, inFrustum, colliders, adjacency, eye, playerRoom, nowMs } = input;
  const entries = new Map<number, { tier: ActorTier; sinceMs: number }>();
  const tiers: ActorTier[] = [];
  const counts = { active: 0, near: 0, suspended: 0 };

  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i]!;
    const prev = state.entries.get(s.id);
    const d = horizontalDistance(eye, s.pos);
    // playerRoom 0 means "in no known room" (a tunnel mouth the roomAt ladder
    // could not name) — never gate on topology then, or an actor blinks off.
    const roomNear = playerRoom === 0 || s.room === playerRoom
      || (adjacency.get(playerRoom)?.has(s.room) ?? false);

    // The sight test is the expensive half, so topology and distance reject
    // first. `visible()` is only ever called for an actor that survived both.
    const visible = () =>
      (inFrustum[i] ?? false) && clearSight(eye, s.torso, colliders) ? 'active' : 'near';

    const want: ActorTier = prev?.tier === 'suspended'
      // Leaving suspension needs the TIGHTER radius, which is the hysteresis.
      ? (d <= PROMOTE_RADIUS_M && roomNear ? visible() : 'suspended')
      : (d > SUSPEND_RADIUS_M || (!roomNear && d > PROMOTE_RADIUS_M) ? 'suspended' : visible());

    entries.set(s.id, { tier: want, sinceMs: prev && prev.tier === want ? prev.sinceMs : nowMs });
    tiers.push(want);
    counts[want]++;
  }

  return { tiers, state: { entries }, counts };
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/actor-lod.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/actor-lod.ts src/lab/sdf-zombie/webgpu/actor-lod.test.ts
git commit -m "feat(actor-lod): classify actors into active/near/suspended"
```

---

### Task 3: Hysteresis — demotion waits, promotion does not

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/actor-lod.ts`
- Test: `src/lab/sdf-zombie/webgpu/actor-lod.test.ts`

The asymmetry is the whole point and is a safety decision, not a tuning one:
**a mis-culled visible actor is a visible bug, an over-drawn actor is only a
cost.** So becoming `active` applies instantly; every other change must wait
out a dwell.

- [ ] **Step 1: Write the failing tests**

Append to `src/lab/sdf-zombie/webgpu/actor-lod.test.ts`:

```ts
import { MIN_DWELL_MS, type ActorLodState } from './actor-lod';

describe('classifyActors — hysteresis', () => {
  const step = (state: ActorLodState, nowMs: number, inFrustum: boolean) =>
    classifyActors(state, {
      nowMs, eye: [0, 1.6, 0], playerRoom: 1,
      snapshots: [snap(1, 0, 5)], inFrustum: [inFrustum],
      colliders: NO_BOXES, adjacency: roomAdjacency([]),
    });

  it('promotes to active immediately, without waiting out the dwell', () => {
    let r = step(initialActorLodState(), 0, false);
    expect(r.tiers).toEqual(['near']);
    r = step(r.state, 1, true); // 1 ms later — far inside the dwell
    expect(r.tiers).toEqual(['active']);
  });

  it('holds active through a brief sight flicker', () => {
    let r = step(initialActorLodState(), 0, true);
    expect(r.tiers).toEqual(['active']);
    r = step(r.state, 100, false); // occluded for 100 ms — a doorway transit
    expect(r.tiers).toEqual(['active']);
  });

  it('demotes once the dwell has elapsed', () => {
    let r = step(initialActorLodState(), 0, true);
    r = step(r.state, MIN_DWELL_MS + 1, false);
    expect(r.tiers).toEqual(['near']);
  });

  it('does not transfer a dwell timer between actors when one is removed', () => {
    const both = classifyActors(initialActorLodState(), {
      nowMs: 0, eye: [0, 1.6, 0], playerRoom: 1,
      snapshots: [snap(7, 0, 5), snap(9, 0, 6)], inFrustum: [true, true],
      colliders: NO_BOXES, adjacency: roomAdjacency([]),
    });
    expect(both.tiers).toEqual(['active', 'active']);
    // Actor 7 is gibbed; actor 9 keeps its own identity at index 0.
    const after = classifyActors(both.state, {
      nowMs: 10, eye: [0, 1.6, 0], playerRoom: 1,
      snapshots: [snap(9, 0, 6)], inFrustum: [true],
      colliders: NO_BOXES, adjacency: roomAdjacency([]),
    });
    expect(after.state.entries.has(7)).toBe(false);
    expect(after.state.entries.get(9)!.sinceMs).toBe(0); // unchanged, not reset
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/actor-lod.test.ts`
Expected: FAIL — `MIN_DWELL_MS` is not exported, and "holds active through a
brief sight flicker" fails because nothing rate-limits demotion yet.

- [ ] **Step 3: Implement**

In `src/lab/sdf-zombie/webgpu/actor-lod.ts`, add this constant next to the radii:

```ts
/**
 * Floor on how long a tier lasts before it may DEMOTE. 0.5 s is longer than a
 * doorway transit, which is exactly where clearSight flips and where an
 * ungated controller would oscillate — and the oscillation costs more than the
 * cull saves, because every flip re-adds meshes to the scene graph.
 *
 * Promotion to `active` deliberately ignores this. A mis-culled visible actor
 * is a visible bug; an over-drawn one is only a cost.
 */
export const MIN_DWELL_MS = 500;
```

Then replace the `entries.set(...)` / `tiers.push(want)` / `counts[want]++`
lines in `classifyActors` with:

```ts
    // Promotion to active is immediate; every other change waits out the dwell.
    const settled: ActorTier = prev === undefined || want === 'active'
        || want === prev.tier || nowMs - prev.sinceMs >= MIN_DWELL_MS
      ? want
      : prev.tier;

    entries.set(s.id, {
      tier: settled,
      sinceMs: prev && prev.tier === settled ? prev.sinceMs : nowMs,
    });
    tiers.push(settled);
    counts[settled]++;
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/actor-lod.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/actor-lod.ts src/lab/sdf-zombie/webgpu/actor-lod.test.ts
git commit -m "feat(actor-lod): rate-limit demotion, promote to active instantly"
```

---

### Task 4: `stepCoarse` and `resume` on the actor

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-actor.ts`
- Test: `src/lab/sdf-zombie/webgpu/game-actor-lod.test.ts`

**THE TRAP IN THIS TASK.** The rig is **Verlet** — `RigPoint` is
`{ pos, prev, pinned }` (`src/lab/sdf-zombie/rig.ts:5`) and velocity is implied
by `pos - prev`. When you translate the rig after a suspended traverse you must
move **both `pos` and `prev`** by the same delta. Translating only `pos` makes
the implied velocity equal to the entire traverse in one step, and the body
explodes on the first visible frame. `restPose` needs no fixup: `stepMotion`
regenerates it in world space from `state.wander.pos` every frame
(`motion.ts:437` — "Rest targets per rig point, world space").

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/game-actor-lod.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseBlob } from '../blob-parse';
import { compileBlob } from '../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../build-body';
import { bindRig } from '../rig-bind';
import zombieSrc from '../characters/zombie.blob?raw';

// The actor factory needs a GPU view, so these tests exercise the two new
// methods through the same construction path game-actor.test.ts already uses.
// Follow whatever fixture that file uses — do NOT invent a second one.
import { makeTestActor } from './game-actor.test-helpers';

describe('stepCoarse', () => {
  it('moves the actor toward its encounter move target', () => {
    const a = makeTestActor();
    a.setEncounterOrder({ mode: 'combat', player: null, visible: false, fireAllowed: false, moveTarget: [5, 0, 0], halt: false });
    const before = a.pose().pos[0];
    for (let i = 0; i < 30; i++) a.stepCoarse(1 / 5);
    expect(a.pose().pos[0]).toBeGreaterThan(before + 1);
  });

  it('does not run the motion solve', () => {
    const a = makeTestActor();
    a.setEncounterOrder({ mode: 'combat', player: null, visible: false, fireAllowed: false, moveTarget: [5, 0, 0], halt: false });
    a.stepCoarse(1 / 5);
    expect(a.motionFrame()).toBeNull(); // step() would have produced one
  });

  it('does nothing without a move target', () => {
    const a = makeTestActor();
    const before = [...a.pose().pos];
    a.stepCoarse(1 / 5);
    expect(a.pose().pos).toEqual(before);
  });
});

describe('resume', () => {
  it('carries the rig with the body after a long suspended traverse', () => {
    const a = makeTestActor();
    a.setEncounterOrder({ mode: 'combat', player: null, visible: false, fireAllowed: false, moveTarget: [12, 0, 0], halt: false });
    for (let i = 0; i < 60; i++) a.stepCoarse(1 / 5);
    a.resume();
    const centre = a.pose().pos;
    for (const p of a.boundRig().rig.points) {
      expect(Math.hypot(p.pos[0] - centre[0], p.pos[2] - centre[2])).toBeLessThan(1.0);
    }
  });

  it('leaves no implied velocity — pos and prev move together', () => {
    const a = makeTestActor();
    a.setEncounterOrder({ mode: 'combat', player: null, visible: false, fireAllowed: false, moveTarget: [12, 0, 0], halt: false });
    const before = a.boundRig().rig.points.map(p => [p.pos[0] - p.prev[0], p.pos[2] - p.prev[2]] as const);
    for (let i = 0; i < 60; i++) a.stepCoarse(1 / 5);
    a.resume();
    const after = a.boundRig().rig.points.map(p => [p.pos[0] - p.prev[0], p.pos[2] - p.prev[2]] as const);
    after.forEach((v, i) => {
      expect(Math.abs(v[0] - before[i]![0])).toBeLessThan(1e-6);
      expect(Math.abs(v[1] - before[i]![1])).toBeLessThan(1e-6);
    });
  });

  it('is idempotent — a second resume with no traverse changes nothing', () => {
    const a = makeTestActor();
    a.resume();
    const snapshot = a.boundRig().rig.points.map(p => [...p.pos]);
    a.resume();
    a.boundRig().rig.points.forEach((p, i) => expect([...p.pos]).toEqual(snapshot[i]));
  });
});
```

**Where `makeTestActor` comes from.** There is no shared fixture:
`game-actor.test.ts` defines its own local `makeActor(id)` twice (lines 155 and
280) and they differ. **Copy the construction at `game-actor.test.ts:155-186`
verbatim into the top of your new test file** as `makeTestActor()`, dropping
the parts your tests do not read, and delete the `makeTestActor` import above.

**Do NOT refactor the existing suite into a shared helper.** That touches a
3,500-test file for no benefit to this plan, and a fixture that silently drifts
from the one the assertions were written against is exactly how this repo
previously shipped green tests against the wrong body.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-actor-lod.test.ts`
Expected: FAIL — `stepCoarse is not a function`.

- [ ] **Step 3: Add the state and the two methods**

In `src/lab/sdf-zombie/webgpu/game-actor.ts`, next to
`let routeCache` (~line 480), add:

```ts
  /** Ground translation accumulated while SUSPENDED (actor-lod). The rig is
   *  not stepped in that tier, so this is what resume() must carry it by. */
  let coarseDelta: Vec3 = [0, 0, 0];
```

Then add both functions near `function step(dt: number)` (~line 669):

```ts
  /**
   * The SUSPENDED tier's whole per-tick cost (actor-lod.ts). Slides the ground
   * position along the cached nav route and updates facing — no stepMotion, no
   * stepRig, no kit, no view. The actor still converges on the player, which is
   * the point: cross-room aggression is deliberate behaviour, and freezing
   * distant actors would quietly undo it.
   *
   * pose().pos must stay truthful here, because the encounter director's sight
   * and hearing tests and actor-lod's own radii all read it.
   */
  function stepCoarse(dt: number) {
    if (bakePaused) return;
    const goal = encounterOrder?.moveTarget;
    if (!goal) return;
    const next = routeGoal(goal, dt);
    if (!next) return;
    const w = state.wander;
    const dx = next[0] - w.pos[0], dz = next[2] - w.pos[2];
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-4) return;
    const travel = Math.min(dist, opts.profile.cruise * dt);
    const nx = w.pos[0] + (dx / dist) * travel;
    const nz = w.pos[2] + (dz / dist) * travel;
    // Same wall rule the full step uses — a coarse tick must not walk through
    // geometry just because nobody is watching.
    if (opts.navigation && !opts.navigation.canTravel(w.pos, [nx, 0, nz] as Vec3)) return;
    coarseDelta = [coarseDelta[0] + (nx - w.pos[0]), 0, coarseDelta[2] + (nz - w.pos[2])];
    state = { ...state, wander: { ...w, pos: [nx, 0, nz] as Vec3 } };
    bodyYaw = Math.atan2(dx, dz);
  }

  /**
   * Leaving the SUSPENDED tier. Carries the rig by the ground translation the
   * coarse ticks accumulated.
   *
   * VERLET: pos AND prev both move. Velocity here is implied by (pos - prev),
   * so translating pos alone would make the implied velocity the entire
   * traverse in a single step and blow the body apart on its first visible
   * frame. restPose needs nothing — stepMotion rewrites it in world space from
   * state.wander.pos every frame.
   */
  function resume() {
    const dx = coarseDelta[0], dz = coarseDelta[2];
    if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return;
    bound = {
      ...bound,
      rig: {
        ...bound.rig,
        points: bound.rig.points.map(p => ({
          ...p,
          pos: [p.pos[0] + dx, p.pos[1], p.pos[2] + dz] as Vec3,
          prev: [p.prev[0] + dx, p.prev[1], p.prev[2] + dz] as Vec3,
        })),
      },
    };
    coarseDelta = [0, 0, 0];
    posed = applyRig(current, bound, bodyYaw);
  }
```

Add both to the `ZombieActor` interface (near `step(dt: number): void;`, ~line 298):

```ts
  /** SUSPENDED tier tick — route slide only. See actor-lod.ts. */
  stepCoarse(dt: number): void;
  /** Called on the frame an actor leaves the SUSPENDED tier. */
  resume(): void;
```

and to the returned object (near `step,`, ~line 1170):

```ts
    stepCoarse,
    resume,
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-actor-lod.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Check nothing else broke**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/`
Expected: all green. `npx tsc --noEmit` exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-actor.ts src/lab/sdf-zombie/webgpu/game-actor-lod.test.ts src/lab/sdf-zombie/webgpu/game-actor.test-helpers.ts
git commit -m "feat(actor): coarse suspended step and rig-carrying resume"
```

---

### Task 5: Wire it into `game-main` behind a seam

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`

**Ship it ON, but with the seam.** Every perf change in this repo ships with a
`__sdfGame.setX()` so the bench can A/B it — the project has been burned by
shipping unmeasured changes, which is the whole reason this plan exists.

- [ ] **Step 1: Add imports and state**

Add near the other `./actor-lod`-adjacent imports at the top:

```ts
import {
  classifyActors, initialActorLodState, roomAdjacency, type ActorTier,
} from './actor-lod';
```

Next to `let adaptiveEnabled = false;` (~line 672) add:

```ts
  // Actor LOD (2026-09-09). SHIPS ON: before it, setBodies took every actor in
  // the level and the SDF proxy boxes are frustumCulled=false, so an enemy
  // behind you was marched like any other. __sdfGame.setActorLod(false) is the
  // A/B seam and the bench's `actor-lod-off` leg.
  let actorLodEnabled = true;
  let actorLodState = initialActorLodState();
  const roomLinks = roomAdjacency(TUNNELS);
  let actorTiers: ActorTier[] = [];
  let coarsePhase = 0;
  const actorLodCounts = { active: 0, near: 0, suspended: 0 };
  const tierOf = (i: number): ActorTier => actorLodEnabled ? (actorTiers[i] ?? 'active') : 'active';
```

Confirm `TUNNELS` is already imported from `./game-level`; add it to that
import if not.

- [ ] **Step 2: Classify once per frame, before the actors step**

Immediately **before** the `const bodyTiming = telemetry.begin();` line
(~3437, added by Phase 0's neighbours), insert:

```ts
      // Actor LOD before the step, so this frame's step/stepCoarse split and
      // this frame's render filter agree. The frustum test is the one
      // bodiesOnScreen() has always computed and thrown away.
      {
        const lodTiming = telemetry.begin();
        projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(projScreen);
        const snaps = actors.map(a => {
          const p = a.pose().pos;
          const torso = a.posed().clusters.find(c => c.limb === 'torso');
          return { id: a.id, pos: p, torso: (torso?.center ?? [p[0], 1.1, p[2]]) as Vec3, room: a.room };
        });
        const inFrustum = snaps.map(s => {
          bodySphere.center.set(s.torso[0], s.torso[1], s.torso[2]);
          return frustum.intersectsSphere(bodySphere);
        });
        const r = classifyActors(actorLodState, {
          nowMs: performance.now(),
          eye: [camera.position.x, camera.position.y, camera.position.z] as Vec3,
          playerRoom: encounterNav.roomAt(player.pos),
          snapshots: snaps, inFrustum, colliders, adjacency: roomLinks,
        });
        // resume() BEFORE the step: an actor promoted this frame must have its
        // rig carried across before stepMotion writes a restPose at the new
        // position, or the first visible frame is a spring from the old one.
        actors.forEach((a, i) => {
          if (actorTiers[i] === 'suspended' && r.tiers[i] !== 'suspended') a.resume();
        });
        actorTiers = r.tiers;
        actorLodState = r.state;
        Object.assign(actorLodCounts, r.counts);
        coarsePhase = (coarsePhase + 1) % 6;
        telemetry.end('actor-lod', lodTiming);
      }
```

- [ ] **Step 3: Split the step loop**

Replace exactly this line:

```ts
      for (const a of actors) a.step(dt);
```

with:

```ts
      // Suspended actors tick at 5 Hz on a staggered slot (id % 6), so N of
      // them never re-route on the same frame — routing is ~1 ms a call.
      actors.forEach((a, i) => {
        if (tierOf(i) !== 'suspended') a.step(dt);
        else if (a.id % 6 === coarsePhase) a.stepCoarse(dt * 6);
      });
```

- [ ] **Step 4: Filter every render consumer**

`setBodies` (~line 912) — replace:

```ts
    sdfLayer.setBodies(actors.map(a => a.view.object), chunkObjects());
```

with:

```ts
    sdfLayer.setBodies(actors.filter((_, i) => tierOf(i) === 'active').map(a => a.view.object), chunkObjects());
```

Mesh renderer (~line 781) — replace:

```ts
      segMeshRenderer.update(actors.map(a => {
```

with:

```ts
      const meshActors = actors.filter((_, i) => tierOf(i) === 'active');
      segMeshRenderer.update(meshActors.map(a => {
```

and replace the closing `}), actors);` with `}), meshActors);`.

**`entries` and `owners` must be the SAME filtered list.** They are positional
parallel arrays; filtering one and not the other silently binds actor A's
meshes to actor B's slot.

Bone instancer (~line 767) — replace:

```ts
      boneInstancer.update([
        ...actors.map(a => { const p = a.posed(); return { prims: p.bonePrims ?? [], alive: p.clusters.map(c => c.alive) }; }),
```

with:

```ts
      boneInstancer.update([
        ...actors.filter((_, i) => tierOf(i) === 'active').map(a => { const p = a.posed(); return { prims: p.bonePrims ?? [], alive: p.clusters.map(c => c.alive) }; }),
```

This path is dormant today (`boneMesh` ships `false`, bone tubes are off for
look), but leaving one consumer unfiltered is how a seam rots — the next person
to flip `setBoneMesh(true)` would get a silently uncelled path.

Kit/head/view loop (~line 3454) — replace:

```ts
      for (const a of actors) {
        if (!a.character) continue;
```

with:

```ts
      actors.forEach((a, i) => {
        if (!a.character || tierOf(i) !== 'active') return;
```

and change that block's closing `}` to `});`. Do the same for the
`a.view.setTime(now)` / `headShape` loop that follows it.

- [ ] **Step 5: Add the seam and the diagnostics**

In the `__sdfGame` object next to `setAdaptive` (~line 6617):

```ts
    setActorLod(on: boolean) {
      actorLodEnabled = on;
      if (!on) { actorTiers = []; actorLodState = initialActorLodState(); }
    },
    actorLod: () => ({ enabled: actorLodEnabled, ...actorLodCounts }),
```

In `updateHud` (~line 3265), replace:

```ts
      `${frameEma.toFixed(1)} ms · bodies ${bodiesOnScreen()}/${actors.length}` +
```

with:

```ts
      `${frameEma.toFixed(1)} ms · bodies ${actorLodCounts.active}a/${actorLodCounts.near}n/${actorLodCounts.suspended}s of ${actors.length}` +
```

**`bodiesOnScreen()` has a SECOND caller** — `game-main.ts:5904` feeds it to
the bench census as `bodies`. Repoint that before deleting anything. Replace:

```ts
          census: () => ({
            bodies: bodiesOnScreen(),
```

with:

```ts
          census: () => ({
            bodies: actorLodCounts.active,
            lodNear: actorLodCounts.near,
            lodSuspended: actorLodCounts.suspended,
```

and widen `SceneCensus` in `src/lab/sdf-zombie/webgpu/game-bench.ts:71` with:

```ts
  /** Actors held at the `near` tier — simulated, not drawn. */
  lodNear?: number;
  /** Actors held at the `suspended` tier — route slide only. */
  lodSuspended?: number;
```

A cull's cost column is unreadable without knowing how much it culled; the
census section of `bench.md` exists for exactly that reason.

Only now is `bodiesOnScreen()` dead — delete it. Its frustum test moved into
the LOD block, and keeping a second, drifting copy is exactly the bug class
this repo's notes keep warning about.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` — expected: exits 0.
Run: `npx vitest run` — expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "feat(game): gate marching, meshes and posing by actor LOD tier"
```

---

### Task 6: The bench A/B leg

**Files:**
- Modify: `scripts/sdf-game-bench.mjs`

- [ ] **Step 1: Add the leg**

In `ALL_LEGS` (~line 145), after the `'occluder-off'` entry, add:

```js
  // Actor LOD (2026-09-09) SHIPS ON, so baseline includes it; this leg is the
  // "before" column. The delta between them IS the feature's win — read it
  // against each leg's own repeat spread, and read the census tier counts to
  // know how many bodies it actually culled.
  'actor-lod-off': { setActorLod: false },
```

- [ ] **Step 2: Pin the ship default in `applyLeg`**

`applyLeg` applies leg overrides generically
(`for (const [fn, arg] of Object.entries(overrides))`, line ~278), so the leg
itself needs nothing more. But it first pins every ship default explicitly so
**legs cannot contaminate each other** — a leg that ran earlier would otherwise
leave the LOD off for every later leg.

In that pinned block, after `__sdfGame.setBoneCullMode('segment');`, add:

```js
    // Actor LOD ships ON (2026-09-09); the 'actor-lod-off' leg is the A/B.
    __sdfGame.setActorLod(true);
```

- [ ] **Step 3: Verify the harness parses**

Run: `node --check scripts/sdf-game-bench.mjs`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/sdf-game-bench.mjs
git commit -m "bench: add the actor-lod-off A/B leg"
```

---

### Task 7: Measure it, and say what it actually bought

**Files:**
- Create: `docs/dev-notes/2026-09-09-perf-spikes/actor-lod-result.md`

- [ ] **Step 1: Confirm the machine is quiet**

Run: `uptime && ps aux | sort -k3 -rn | head -5`

Expected: 1-minute load below 5; no `dsh`, no other bench, no `sqlite3 ...
dualmem`. **STOP if it is not** — see the same warning in the Phase 0 plan.

- [ ] **Step 2: Run the A/B**

Run:
```bash
BENCH_LEGS=baseline,actor-lod-off BENCH_ROOMS=3,4,5 BENCH_REPEATS=3 \
  LAB_VITE_PORT=5299 LAB_CDP_PORT=9299 scripts/sdf-game-bench.sh
```

Expected: exit 0, writes `/tmp/sdf-game-bench/bench.md`.

- [ ] **Step 3: Write it up honestly**

Copy `bench.md` into `docs/dev-notes/2026-09-09-perf-spikes/` and write
`actor-lod-result.md` with:

- the `uptime` from Step 1, verbatim
- the baseline vs `actor-lod-off` deltas per room and per segment
- **each leg's own repeat spread**, and an explicit statement of whether the
  delta exceeds it. A delta smaller than either leg's spread is UNRESOLVED, not
  zero — say so in those words if that is what happened
- the census tier counts: how many bodies were actually culled

**Do not claim a win the spread does not support**, and do not quietly widen
the repeats until it looks good. Reporting "unresolved on this machine" is a
correct outcome.

- [ ] **Step 4: Owner gate — cross-room pursuit still works**

This cannot be automated and must not be skipped. Run `npm run dev`, teleport
between rooms (`__sdfGame.teleport(2)`, then `(5)`), and confirm enemies from
other rooms still arrive, and that no enemy pops into existence in view.

Report what you saw. If enemies stopped converging, `stepCoarse` is not
running — check the `id % 6 === coarsePhase` stagger and that
`setEncounterOrder` is still called for suspended actors (Task 5 Step 3 leaves
`encounter.update` covering all actors on purpose).

- [ ] **Step 5: Commit**

```bash
git add docs/dev-notes/2026-09-09-perf-spikes/
git commit -m "perf: record the actor-LOD A/B result"
```

---

## Done when

- `npx tsc --noEmit` clean; `npx vitest run` fully green.
- `__sdfGame.setActorLod(false)` restores the old behaviour exactly.
- The HUD reads `Na/Nn/Ns of M` and the numbers move as you turn around.
- `actor-lod-result.md` states the delta **and** whether it beats the spread.
- The owner's cross-room pursuit check is reported, pass or fail.
