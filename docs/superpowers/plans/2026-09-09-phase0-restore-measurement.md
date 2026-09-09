# Phase 0: Restore Measurement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two largest additions since the last frame attribution — the mesh-skeleton renderer and the encounter director — visible to telemetry and to the bench, so the actor-LOD work can be measured against a real baseline.

**Architecture:** Two `telemetry.begin()`/`telemetry.end()` spans in the `game-main` frame loop, following the exact idiom already used by `body-step` and `wound-flush`; one default change in the bench harness. No behaviour changes.

**Tech Stack:** TypeScript, vitest, the existing `GameTelemetry` class (`src/lab/sdf-zombie/webgpu/game-telemetry.ts`).

---

## Background you need

`GameTelemetry` records named CPU phases. The idiom, copied verbatim from
`game-main.ts:3437-3445`:

```ts
const bodyTiming = telemetry.begin();
soldierCorpses?.update(actors,dt);
for (const a of actors) a.step(dt);
telemetry.end('body-step', bodyTiming);
```

`begin()` returns `undefined` when telemetry is inactive, and `end()` is a
no-op on an undefined token, so wrapping code costs nothing when recording is
off. Phases are drained per frame into `CaptureFrame.phases`.

**Why this matters:** `segMeshRenderer.update()` and `encounter.update()` are
currently inside no phase at all. An F8 capture attributes their cost to
nothing, which is why the 2026-09-09 investigation could not say how much of
the regression they own.

**Trap:** do NOT widen an existing phase to cover new work. The comment at
`game-main.ts:3439-3444` explains why — every previously recorded figure
becomes incomparable. Add new phases; leave `body-step` exactly as it is.

---

### Task 1: Add the `skeleton-mesh` telemetry phase

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts:774-787`

- [ ] **Step 1: Read the current block**

Run: `sed -n '774,788p' src/lab/sdf-zombie/webgpu/game-main.ts`

Expected: a block beginning `if (segMeshRenderer) {` and ending `}` after
`}), actors);`.

- [ ] **Step 2: Wrap it**

Replace exactly this:

```ts
    if (segMeshRenderer) {
      const craters: { pos: Vec3; radius: number }[] = [];
```

with:

```ts
    if (segMeshRenderer) {
      // Its own phase, NOT folded into an existing one: this path shipped as
      // the forward default without a controlled timing result (skeleton
      // wrap-up, 2026-09-08) and no capture could see it until now.
      const meshTiming = telemetry.begin();
      const craters: { pos: Vec3; radius: number }[] = [];
```

and replace exactly this:

```ts
      }), actors);
    }
```

with:

```ts
      }), actors);
      telemetry.end('skeleton-mesh', meshTiming);
    }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0, no output.

- [ ] **Step 4: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "perf(telemetry): give the mesh skeleton path its own phase"
```

---

### Task 2: Add the `encounter` telemetry phase

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts:3386-3391`

- [ ] **Step 1: Read the current block**

Run: `sed -n '3386,3391p' src/lab/sdf-zombie/webgpu/game-main.ts`

Expected: `const snapshots: EncounterAgent[] = actors.map(...)`, then
`const orders=encounter.update(...)`, then `shotAlert = false;`, then
`for (const a of actors) a.setEncounterOrder(orders.get(a.id)!);`

- [ ] **Step 2: Wrap it**

Replace exactly this:

```ts
      const snapshots: EncounterAgent[] = actors.map(a=>({id:a.id,pos:a.pose().pos,yaw:a.pose().yaw,room:a.room,
```

with:

```ts
      // The snapshot build is INSIDE the phase on purpose: it calls pose()
      // per actor and is part of what the director costs per frame.
      const encounterTiming = telemetry.begin();
      const snapshots: EncounterAgent[] = actors.map(a=>({id:a.id,pos:a.pose().pos,yaw:a.pose().yaw,room:a.room,
```

and replace exactly this:

```ts
      for (const a of actors) a.setEncounterOrder(orders.get(a.id)!);
```

with:

```ts
      for (const a of actors) a.setEncounterOrder(orders.get(a.id)!);
      telemetry.end('encounter', encounterTiming);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0, no output.

- [ ] **Step 4: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "perf(telemetry): give the encounter director its own phase"
```

---

### Task 3: Put room 5 in the bench's default matrix

**Files:**
- Modify: `scripts/sdf-game-bench.mjs:29`

- [ ] **Step 1: Read the line**

Run: `sed -n '29p' scripts/sdf-game-bench.mjs`

Expected:
```js
const ROOM_IDS = (process.env.BENCH_ROOMS ?? '1,2,3,4').split(',').map(Number);
```

- [ ] **Step 2: Change the default**

Replace that line with:

```js
// Room 5 (3 soldiers + 2 zombies) joins the default matrix 2026-09-09: it is
// the only room with soldiers and it had NEVER been benched, so every recorded
// figure predates the character whose cost the owner is asking about.
const ROOM_IDS = (process.env.BENCH_ROOMS ?? '1,2,3,4,5').split(',').map(Number);
```

- [ ] **Step 3: Verify the harness still parses**

Run: `node --check scripts/sdf-game-bench.mjs`
Expected: exits 0, no output.

- [ ] **Step 4: Commit**

```bash
git add scripts/sdf-game-bench.mjs
git commit -m "bench: add room 5 to the default room matrix"
```

---

### Task 4: Prove the phases appear in a real capture

This is the only task that needs a GPU and a browser. It is a verification
task: it writes no product code.

**Files:**
- Create: `docs/dev-notes/2026-09-09-perf-spikes/phase0-baseline.md`

- [ ] **Step 1: Confirm the machine is quiet**

Run: `uptime && ps aux | sort -k3 -rn | head -5`

Expected: 1-minute load average **below 5**, and no `dsh`, no
`sdf-game-bench`, no `sqlite3 ... dualmem`, no other Chrome driving a bench.

**STOP if it is not.** The repo's own rule: a run on a loaded machine measures
the load. On 2026-09-09 three identical runs read 41–46 ms at load 43–63 and
had to be labelled CONTAMINATED. Wait for the machine, or say in your report
that you could not get a clean one — do not publish numbers from a busy box.

- [ ] **Step 2: Run the passes bench**

Run:
```bash
BENCH_LEGS=baseline BENCH_PASSES=1 BENCH_ROOMS=3,4,5 BENCH_REPEATS=2 \
  LAB_VITE_PORT=5299 LAB_CDP_PORT=9299 scripts/sdf-game-bench.sh
```

**`BENCH_LEGS=baseline` is load-bearing.** Without it the harness runs its whole
~18-leg ablation matrix across every room and repeat — well over an hour — when
all this task needs is where the frame goes at ship defaults. (Omitted by
mistake on the first run of this plan, 2026-09-09.)

Drop `BENCH_LEGS` only when you deliberately want the full ablation matrix, and
budget the time for it.

Expected: completes with exit 0 and writes `/tmp/sdf-game-bench/passes.md`.

**Note:** `passes.md` is written only after the ENTIRE throughput matrix
finishes. Killing the run partway leaves no report at all — decide before you
start, not halfway through.

- [ ] **Step 3: Confirm both new phases are present**

Run: `grep -E "skeleton-mesh|encounter" /tmp/sdf-game-bench/passes.md`

Expected: both names appear with millisecond values. If either is missing or
reads exactly 0.00 in every row, the wrap in Task 1 or Task 2 did not take —
go back and fix it before continuing.

- [ ] **Step 4: Record the baseline**

Copy `/tmp/sdf-game-bench/passes.md` and `/tmp/sdf-game-bench/bench.md` into
`docs/dev-notes/2026-09-09-perf-spikes/`, and write
`phase0-baseline.md` containing:

- the `uptime` output from Step 1, verbatim, as proof the machine was quiet
- the per-pass table from `passes.md` for rooms 3, 4 and 5
- the `cpu:tick`, `cpu:draw`, `skeleton-mesh` and `encounter` figures
- one sentence naming which phase is largest in each room

State plainly whether the mesh path and the encounter director are large or
small. **Do not editorialise the result toward the actor-LOD plan** — if they
turn out to be cheap, that is the finding, and the LOD plan's premise needs
revisiting before it is executed.

- [ ] **Step 5: Commit**

```bash
git add docs/dev-notes/2026-09-09-perf-spikes/
git commit -m "perf: record the clean Phase 0 baseline with the new phases"
```

---

## Done when

- `npx tsc --noEmit` is clean.
- `npx vitest run` is green (this plan adds no tests; it must break none).
- `passes.md` from a **quiet** machine shows `skeleton-mesh` and `encounter`
  with real values for rooms 3, 4 and 5.
- `phase0-baseline.md` is committed, and it says which phase dominates.
