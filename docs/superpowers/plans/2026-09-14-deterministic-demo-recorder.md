# Deterministic demo recorder — stage 1 (sim purity) and stage 3 (record / replay) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the game sim a pure function of (seed, inputs, fixed dt) so two runs of the same inputs produce the same census and frame, then record a live play session as a `.dem` input log that any bench or gate can replay headlessly.

**Architecture:** Stage 1 removes the last wall-clock and unseeded-random reads from the gameplay path (visibility cull dwell on sim time, named seeded RNG streams, animation phase from sim time, bake swap on a recorded frame index) and proves it with an identical-census gate over the existing scripted scenario. Stage 3 adds an input recorder in the page (per fixed-step frame: held keys, mouse deltas, fire/reload events, the demo seed and the boot query) saved through the lab server like telemetry, and a replay driver that feeds those frames into the same input handler under `step()` with the render lock off; `sdf-game-bench.mjs` gains a `BENCH_DEMO=<file>` scene so a leg measures the recording, and `sdf-demo-hash.mjs` gains `record`/`verify` over a `.dem`. Predecessor plan: `docs/superpowers/plans/2026-09-10-deterministic-demo-recordings.md` (stage 2, the frame hash, shipped).

**Tech Stack:** TypeScript, three WebGPU, vitest, lab scripts (bash `scripts/lab-servers.sh`, `scripts/sdf-game-bench.mjs`, `scripts/sdf-demo-hash.mjs`, `scripts/census-diff.mjs`).

---

## Conventions

- Gates on every task: `npx tsc --noEmit -p .`; `node scripts/march-hash.mjs` unchanged (canonical crowd `a350361d6a223946a4cb8aac9bc2a3a70ee15bfd` on the flip branch, per-body `a8ab4e…` via `MARCH_HASH_PERBODY=1`; on `main` the canonical is still `a8ab4e…`); the vitest files named per task.
- Browser scripts: bash only, inside `scripts/lab-servers.sh`, own port pair per concurrent chain. `BENCH_FRAME_CAP_MS=250` stays on.
- Names fixed here: `sim-clock.ts` (`simTimeMs`), `rng.ts` (`createRngStreams(seed)` → `{ bleed, fx, reload, misc }`), `demo-recorder.ts` (`DemoFrame`, `DemoFile`, `createDemoRecorder`, `createDemoPlayer`), seams `__sdfGame.demoRecord(start|stop)`, `__sdfGame.demoReplay(file, opts)`, `__sdfGame.demoInfo()`, key **F7** (record toggle; F8/F9 are telemetry), lab endpoint `/__lab/save-demo`, files under `docs/dev-notes/demos/<name>.dem.json`, env `BENCH_DEMO`, `DEMO_HASH_DEM`.
- Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File map

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/sim-clock.ts` (new) | `simTimeMs` accumulator owned by `tick(dt)` |
| `src/lab/sdf-zombie/webgpu/rng.ts` (new) | named seeded streams from one demo seed (`mulberry32`) |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | cull dwell on sim time; `view.setTime(simTime)`; gameplay `Math.random()` → streams; bake swap on frame index; recorder/player wiring; seams; F7 |
| `src/lab/sdf-zombie/webgpu/demo-recorder.ts` (new) | `DemoFrame`/`DemoFile`, recorder (captures the frame's input snapshot), player (feeds it back) |
| `src/lab/sdf-zombie/webgpu/demo-recorder.test.ts` (new) | round-trip, frame count, seed, version |
| `scripts/lab-server.mjs` (or wherever `/__lab/save-telemetry` lives) | `/__lab/save-demo` |
| `scripts/sdf-game-bench.mjs` | `BENCH_DEMO=<path>`: the leg replays the recording instead of the scripted scenario |
| `scripts/sdf-demo-hash.mjs` | `DEMO_HASH_DEM=<path>` record/verify over a recording |
| `scripts/census-diff.mjs` | unchanged; used as the stage-1 gate |
| `docs/dev-notes/2026-09-10-deterministic-demo-recordings.md` → new section | results |

---

## Task D1: Stage 1 — the sim is a pure function of (seed, inputs, dt)

**Files:** `sim-clock.ts`, `rng.ts`, `game-main.ts`, `rng.test.ts`, `census-diff.mjs` (gate)

- [x] **Step 1: Failing RNG test.** `rng.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createRngStreams } from './rng';
describe('seeded rng streams', () => {
  it('is reproducible per seed and independent per stream', () => {
    const a = createRngStreams(1234), b = createRngStreams(1234), c = createRngStreams(1235);
    const seqA = [a.fx(), a.fx(), a.reload(), a.bleed()];
    const seqB = [b.fx(), b.fx(), b.reload(), b.bleed()];
    expect(seqA).toEqual(seqB);
    expect([c.fx(), c.fx()]).not.toEqual(seqA.slice(0, 2));
    // draining one stream does not move another
    const d = createRngStreams(1234); for (let i = 0; i < 100; i++) d.fx();
    expect(d.reload()).toBe(seqA[2]);
  });
});
```

- [x] **Step 2: `rng.ts`.** `mulberry32` is already in the codebase (grep `mulberry32`); build four streams from one seed by hashing the seed with a per-stream salt: `bleed = mulberry32(seed ^ 0x9e3779b9)`, `fx = mulberry32(seed ^ 0x85ebca6b)`, `reload = mulberry32(seed ^ 0xc2b2ae35)`, `misc = mulberry32(seed ^ 0x27d4eb2f)`. Export `createRngStreams(seed)` and a module-level `rngStreams` the game sets once at boot from `?seed=` (default: `Date.now() & 0x7fffffff`, logged, and reported in `demoInfo().seed`). Run the test: PASS.

- [x] **Step 3: Replace gameplay `Math.random()`.** `grep -n "Math.random()" src/lab/sdf-zombie/webgpu/game-main.ts src/lab/sdf-zombie/webgpu/game-actor.ts src/lab/sdf-zombie/webgpu/game-weapon.ts src/lab/sdf-zombie/*.ts` — for each site decide: sim-affecting (reload seed when `pinnedReloadSeed` is absent → `rngStreams.reload()`; muzzle puff offsets that move light positions → `rngStreams.fx()`; anything in wander/AI → `misc`) or purely cosmetic and never fed back into the sim (may stay, but prefer `fx`). Existing `bleedRng` becomes `rngStreams.bleed`. Leave test files and the retired game alone.

- [x] **Step 4: Sim clock.** `sim-clock.ts` exports `{ simTimeMs, advance(dtSeconds) }`; `tick(dt)` calls `advance(dt)` first. In `updateVisibleActors` replace `performance.now()` with `simTimeMs` for `lastSeenMs` and the `CULL_DWELL_MS` comparison (grep all 26 `performance.now()` sites in game-main; only the ones that feed a decision the sim or the draw list depends on move to sim time: cull dwell, any cooldown/timer inside `tick`, `view.setTime(...)` animation phase). Telemetry, bench timing and UI stay on the wall clock.

- [x] **Step 5: Bake swap on a frame index.** `soldier-corpse-bake.ts` / `corpse-bake.ts` completion: instead of swapping when the worker returns, queue the result and apply it in `tick` on the first frame `>= recordedFrame + 1` where `recordedFrame` = the frame index at submit — so a replay swaps on the same frame regardless of worker speed. Record the swap frame in `corpseInfo()`.

- [x] **Step 6: The gate — identical census twice.** Inside lab-servers (own ports):

```bash
BENCH_PASSES=1 BENCH_REPEATS=3 BENCH_ROOMS=2 BENCH_LEGS=baseline BENCH_QUERY='seed=4242' node scripts/sdf-game-bench.mjs <vite> <cdp>
node scripts/census-diff.mjs docs/dev-notes/<out>/bench.json
```

Expected: `census-diff` exit 0 — every census field (`bodies`, `wounds`, `chunks`, `droplets`, `goo quads`) identical across the three repeats of the same leg. If a field still drifts, `git grep` its producer for the remaining wall-clock or unseeded read and fix it; do not accept a drifting field. Then the frozen gates: `node scripts/march-hash.mjs` twice unchanged.

- [x] **Step 7: Commit** — `feat(demo): stage 1 — sim time cull dwell, seeded rng streams, sim-time animation phase, frame-pinned bake swap; census identical across repeats`.

---

## Task D3: Stage 3 — record a live run, replay it anywhere

**Files:** `demo-recorder.ts`, `demo-recorder.test.ts`, `game-main.ts`, lab server, `sdf-game-bench.mjs`, `sdf-demo-hash.mjs`

- [ ] **Step 1: Failing round-trip test.** `demo-recorder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createDemoRecorder, createDemoPlayer, DEMO_VERSION, type DemoFrame } from './demo-recorder';
describe('demo recorder', () => {
  it('round-trips frames and header', () => {
    const rec = createDemoRecorder({ seed: 7, query: 'crowd=1', room: 2, dt: 1 / 60 });
    const f: DemoFrame = { keys: ['KeyW', 'ShiftLeft'], dx: 3.5, dy: -1, fire: 2, reload: false, look: [0.4, -0.05] };
    rec.push(f); rec.push({ ...f, keys: [], fire: 0 });
    const file = rec.stop();
    expect(file.version).toBe(DEMO_VERSION); expect(file.seed).toBe(7); expect(file.frames.length).toBe(2);
    const p = createDemoPlayer(file);
    expect(p.next()).toEqual(f); expect(p.next()!.fire).toBe(0); expect(p.next()).toBeNull(); expect(p.done).toBe(true);
  });
});
```

- [ ] **Step 2: `demo-recorder.ts`.** `DemoFrame = { keys: string[]; dx: number; dy: number; fire: 0|1|2; reload: boolean; look: [yaw, pitch] }` (look is the absolute pose after the frame's mouse delta, so a replay can re-pin drift); `DemoFile = { version, seed, query, room, dt, startedAt, frames: DemoFrame[], meta }`; `createDemoRecorder(header)` with `push(frame)`/`stop()`; `createDemoPlayer(file)` with `next()`/`done`/`frame`.

- [ ] **Step 3: Capture at the input seam.** In `game-main.ts` the per-frame input is the `keys` Set (keydown/keyup listeners near the `pointerlockchange` handler) plus the mouse delta applied on `mousemove` and the fire/reload actions. Introduce one function `readInputFrame(): DemoFrame` that snapshots those for the frame about to tick, and one `applyInputFrame(f)` that the tick consumes (both the live path and the player go through `applyInputFrame`; live builds it from the listeners, replay from `player.next()`). While recording, each `tick` pushes the frame it consumed. While replaying, the listeners are ignored (`replayActive`).

- [ ] **Step 4: Seams and key.** `__sdfGame.demoRecord('start' | 'stop')` (stop returns the `DemoFile`; also `POST /__lab/save-demo` it like telemetry, to `docs/dev-notes/demos/<startedAt>-<room>.dem.json`); **F7** toggles it with a HUD status line (`REC ●  frames: n`) next to the telemetry controls; `__sdfGame.demoReplay(file | path, { hold?: boolean })` boots the recording: applies `file.query` flags that matter (crowd, scale), sets the seed via the stream reset, teleports to `file.room`, then steps `file.frames.length` fixed frames feeding the player (render lock OFF, exactly as `demoScenario` does), and resolves with `{ frames, census }`; `__sdfGame.demoInfo()` = `{ recording, replaying, frame, seed }`.

- [ ] **Step 5: Bench and hash hooks.** `sdf-game-bench.mjs`: `BENCH_DEMO=<path>` replaces the scripted scenario for every leg with `demoReplay(path)` and segments the recording into thirds (`walk/fire/gib` labels become `t0/t1/t2`) — the per-pass timers are unchanged; the census per segment is reported as now. `sdf-demo-hash.mjs`: `DEMO_HASH_DEM=<path>` makes `record`/`verify`/`ab` hash the replay instead of the scripted scenario.

- [ ] **Step 6: Gates.** Round-trip test PASS; tsc clean; `march-hash.mjs` unchanged; then the real proof, inside lab-servers: record a 10-second run by driving the page (the executor cannot play by hand — use `demoScenario`'s firefight steps fed through `applyInputFrame` as a synthetic recording, save it as `docs/dev-notes/demos/synthetic-firefight-room2.dem.json`), then `DEMO_HASH_DEM=<that> node scripts/sdf-demo-hash.mjs ab <vite> <cdp>` → clean; `BENCH_DEMO=<that> BENCH_REPEATS=3 BENCH_ROOMS=2 BENCH_LEGS=baseline,crowd-off node scripts/sdf-game-bench.mjs <vite> <cdp>` → `census-diff.mjs` exit 0 across repeats AND identical census between the two legs (the whole point: both legs play the same fight).

- [ ] **Step 7: Note + TASKS + commit.** Append `## Stage 1 + 3 results (2026-09-14)` to the demo plan's dev note (or `docs/dev-notes/2026-09-14-demo-recorder.md`): how to record (F7 in play, or the seam), where files go, how a bench leg replays one, the census-identity proof. `TASKS.md`: mark stages 1 and 3 done and point the crowd flip's fire/gib verdict at `BENCH_DEMO`. Commit `feat(demo): stage 3 — F7 input recorder, .dem files, headless replay; BENCH_DEMO and DEMO_HASH_DEM`.

## Self-review notes

- D1 is the gate D3 needs (stage 3 cannot be exact while the cull dwell reads wall time); D1 alone already fixes the unequal-workload bench that stalled the crowd flip.
- Names consistent: `simTimeMs`, `createRngStreams`, `readInputFrame`/`applyInputFrame`, `demoRecord`/`demoReplay`/`demoInfo`, F7, `BENCH_DEMO`, `DEMO_HASH_DEM`.
- Deliberately out: recording world state (Quake model records inputs only), a demo browser UI, and screen-level hashing under interlaced field styles (stage 2's known limit).
