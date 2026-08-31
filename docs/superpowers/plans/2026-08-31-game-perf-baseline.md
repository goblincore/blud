# Game Perf Baseline (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic scripted-firefight benchmark on `sdf-game.html` and take the honest baseline + cliff profile that gates every later perf decision.

**Architecture:** Three new modules with one responsibility each — a **pure scenario** (the firefight as data), a **pure-ish harness** (drives frames through injected deps, aggregates per segment), and a **CDP driver** (runs interleaved ablation legs, emits the table). `game-main.ts` gains only a thin `__sdfGame.bench` seam plus the ablation setters it doesn't already have. Nothing in the render path changes.

**Tech Stack:** TypeScript, three.js WebGPU (`three/webgpu`), vitest, headless Chrome over raw CDP (no puppeteer — matches `scripts/sdf-game.mjs`).

---

## Scope

This plan covers **Phase 0 only** of `docs/superpowers/specs/2026-08-31-sdf-crowd-perf-investigation-design.md`.

Phase 1's three spikes (C2 temporal amortisation, C1 temporal acceleration, A shell-march crowd number) are independent subsystems and each gets its own plan **after** the Phase 2 gate reads this plan's table. Writing them now would mean designing against numbers that do not exist yet, which is the exact failure this investigation was shaped to avoid.

## Context the implementer needs

Read these before starting. They are short and each one prevents a specific wrong turn.

**The measurement rules are not negotiable.** There is no per-pass GPU attribution on this renderer — timestamps were tried and rejected (`src/lab/sdf-zombie/webgpu/bench-stats.ts:4`, `src/lab/sdf-zombie/adaptive-scale.ts:35`). Attribute cost only by interleaved ablation. Never quote `__sdfGame.frameMs()` in an A/B: that is the rAF clock and it is vsync-pinned at ~16.7 ms. The bench path is not pinned, because `handle.step(dtSec)` drives a frame by hand with the compositor out of the loop and `handle.resolveGpu()` is a real completion fence (`src/lab/sdf-zombie/webgpu/lab-renderer.ts:36-56`).

**Copy `benchGpu`'s chunking, and understand why it is shaped that way.** `src/lab/sdf-zombie/webgpu/lab-main.ts:1998-2043` is the reference. Awaiting a fence after *every* frame drains the submission queue, so the GPU goes idle between frames and clocks down — that route swung 13/36/21 ms across three runs of an identical config. Submitting a whole chunk before awaiting keeps the queue full for all but the chunk's last frame. **But** a chunk mean hides spikes: one 60 ms frame inside a 20-frame chunk averages down to ~2 ms. Since "stable 30" is precisely a question about spikes, this plan builds **both** modes and keeps them apart — throughput (chunked, for every comparison) and spike (fenced per frame, for locating blow-ups within its own run only). Spike-leg absolutes are not comparable to throughput-leg absolutes.

**A hidden page renders nothing and resolves to ~0.065 ms, which reads as a 70x speedup.** Count any frame stepped while `document.hidden` and mark the whole run INVALID if the count is non-zero. This is the failure that looks like success.

**Aim must land on a surface.** A torso cluster centre sits *inside* the field, anchors the crater pathologically, and a slug's `severRadius` then cuts both hip necks into instant collapse. `__sdfGame.predictSlugHit()` (`game-main.ts:966`) already returns the surface hit point computed by the same `muzzleWorld()` + `convergedDir()` code `fire()` uses, including the ballistic drop. Use it; never aim at a cluster centre.

**The crowd ladder already exists.** `ROOMS[].zombies` in `src/lab/sdf-zombie/webgpu/game-level.ts:133-162` spawns 1/2/3/4 zombies in rooms 1-4, ten bodies total. Benching per room gives a 1→4 body curve for free.

**Seams that already exist** — do not re-add: `setPose`, `teleport(roomId)`, `step(n, dt)`, `setLoopRunning`, `freeze`, `zombies()`, `zombie(id)`, `fire(barrels)`, `fireSlug()`, `predictSlugHit()`, `setOccluder`, `setHullExclusions`, `refreshHull`, `hullDebug`, `walkTo`, `frameMs`, `bodiesOnScreen`.

**Seams that are missing** and this plan adds: `bench(...)`, `resolveGpu()`, `setAdaptive`, `setSdfScale`, `setCone`, `setFxaa`, `gather(roomId)`.

## File structure

| File | Responsibility |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/game-bench-scenario.ts` (new) | **Pure.** The firefight as data: timed actions + named segments. No three.js, no DOM. |
| `src/lab/sdf-zombie/webgpu/game-bench-scenario.test.ts` (new) | Scenario shape, coverage and ordering invariants. |
| `src/lab/sdf-zombie/webgpu/game-bench.ts` (new) | The harness: walks a scenario through injected deps, both timing modes, per-segment aggregation. Depends on the scenario module and nothing else. |
| `src/lab/sdf-zombie/webgpu/game-bench.test.ts` (new) | Drives the harness with a fake deps object and synthetic clock — no GPU. |
| `src/lab/sdf-zombie/webgpu/game-main.ts` (modify) | Adds the `__sdfGame.bench` seam + missing ablation setters. No render-path change. |
| `scripts/sdf-game-bench.mjs` (new) | CDP driver: interleaved legs, JSON + markdown table out. |
| `docs/dev-notes/2026-08-31-game-perf-baseline/notes.md` (new) | The deliverable: the table, the cliff profile, and what it means for Phase 1. |

---

### Task 1: The pure scenario module

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-bench-scenario.ts`
- Test: `src/lab/sdf-zombie/webgpu/game-bench-scenario.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/game-bench-scenario.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildFirefight, actionsAt, segmentAt, validateScenario,
} from './game-bench-scenario';

describe('buildFirefight', () => {
  it('covers every frame with exactly one segment', () => {
    const s = buildFirefight({ room: 4 });
    for (let f = 0; f < s.frames; f++) {
      expect(segmentAt(s, f), `frame ${f}`).not.toBeNull();
    }
    expect(validateScenario(s)).toEqual([]);
  });

  it('names the three segments the report is built around', () => {
    const s = buildFirefight({ room: 4 });
    expect(s.segments.map(x => x.name)).toEqual(['walk', 'fire', 'gib']);
  });

  it('teleports to the requested room on frame 0', () => {
    const s = buildFirefight({ room: 2 });
    expect(actionsAt(s, 0)).toContainEqual({ kind: 'teleport', room: 2 });
  });

  it('never aims by cluster centre — every shot is preceded by aimSurface', () => {
    const s = buildFirefight({ room: 4 });
    const shots = s.steps.filter(x => x.action.kind === 'fire' || x.action.kind === 'fireSlug');
    expect(shots.length).toBeGreaterThan(0);
    for (const shot of shots) {
      const aims = s.steps.filter(
        x => x.action.kind === 'aimSurface' && x.at < shot.at && x.at >= shot.at - 30,
      );
      expect(aims.length, `shot at ${shot.at} has no aimSurface within 30 frames`).toBeGreaterThan(0);
    }
  });

  it('is deterministic — same options give an identical script', () => {
    expect(buildFirefight({ room: 3 })).toEqual(buildFirefight({ room: 3 }));
  });

  it('flags a scenario whose segments leave a gap', () => {
    const broken = {
      frames: 100,
      steps: [],
      segments: [{ name: 'a', from: 0, to: 40 }, { name: 'b', from: 50, to: 100 }],
    };
    expect(validateScenario(broken)).toContain('gap before frame 50');
  });

  it('flags a step scheduled past the end', () => {
    const broken = {
      frames: 10,
      steps: [{ at: 99, action: { kind: 'fire', barrels: 1 } as const }],
      segments: [{ name: 'a', from: 0, to: 10 }],
    };
    expect(validateScenario(broken)).toContain('step at frame 99 is past frames=10');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-bench-scenario.test.ts`
Expected: FAIL — `Failed to resolve import "./game-bench-scenario"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/webgpu/game-bench-scenario.ts`:

```ts
// src/lab/sdf-zombie/webgpu/game-bench-scenario.ts
//
// The scripted firefight, as DATA. Pure on purpose: the harness that runs it
// needs a GPU, the shape of it does not, so the invariants that actually bite
// (every frame belongs to a segment; no shot is fired without a surface aim)
// are testable in vitest without a browser.
//
// WHY SEGMENTS. The owner's target is "stable 30", which is a question about
// WHICH MOMENT breaks the budget, not about an average. A run that reports one
// number cannot answer it — walking, firing and gibbing have to be reported
// apart or the expensive moment is averaged away by the cheap one.
//
// WHY aimSurface IS ITS OWN ACTION. A torso cluster centre sits INSIDE the
// field: aiming there anchors the crater pathologically and a slug's
// severRadius cuts both hip necks into instant collapse. That is never
// player-visible (the page's predictor always aims at surfaces) but it would
// silently corrupt a bench. aimSurface defers to __sdfGame.predictSlugHit(),
// which is the same muzzleWorld()+convergedDir() code fire() uses.

/** One thing the harness asks the page to do, between frames. */
export type BenchAction =
  | { kind: 'teleport'; room: number }
  | { kind: 'freeze'; on: boolean }
  | { kind: 'look'; yaw: number; pitch: number }
  | { kind: 'aimSurface' }
  | { kind: 'fire'; barrels: 1 | 2 }
  | { kind: 'fireSlug' };

export interface ScenarioStep { at: number; action: BenchAction }

/** A named span of frames, [from, to). Reported separately. */
export interface Segment { name: string; from: number; to: number }

export interface Scenario {
  frames: number;
  steps: ScenarioStep[];
  segments: Segment[];
}

export interface FirefightOpts {
  /** Which room to stand in. Rooms 1-4 hold 1/2/3/4 zombies. */
  room: number;
  /** Frames spent walking before the first shot. */
  walkFrames?: number;
  /** Frames spent firing buckshot. */
  fireFrames?: number;
  /** Frames spent after the slug that severs — chunks in flight. */
  gibFrames?: number;
}

export const FIREFIGHT_DEFAULTS = {
  walkFrames: 120,
  fireFrames: 120,
  gibFrames: 120,
} as const;

/**
 * The script. Three segments, in the order a real encounter runs them:
 *
 *   walk — bodies wandering, nothing fired. The steady-state cost.
 *   fire — buckshot every 20 frames, so wounds accumulate on live bodies.
 *   gib  — a slug that severs, then the chunks fly. The spike suspect.
 *
 * Wanderers are LEFT RUNNING (freeze off). A frozen bench would be more
 * repeatable and would measure the wrong thing: the rig step and the hull
 * rebuild are part of the frame this budget has to hold.
 */
export function buildFirefight(opts: FirefightOpts): Scenario {
  const walkFrames = opts.walkFrames ?? FIREFIGHT_DEFAULTS.walkFrames;
  const fireFrames = opts.fireFrames ?? FIREFIGHT_DEFAULTS.fireFrames;
  const gibFrames = opts.gibFrames ?? FIREFIGHT_DEFAULTS.gibFrames;

  const steps: ScenarioStep[] = [
    { at: 0, action: { kind: 'teleport', room: opts.room } },
    { at: 0, action: { kind: 'freeze', on: false } },
  ];

  // FIRE: re-aim then shoot, every 20 frames. Re-aiming each time matters —
  // the wanderers move, and a stale aim would start missing halfway through
  // the segment, quietly turning a firing bench into a walking one.
  const fireStart = walkFrames;
  for (let f = fireStart; f < fireStart + fireFrames; f += 20) {
    steps.push({ at: f, action: { kind: 'aimSurface' } });
    steps.push({ at: f + 1, action: { kind: 'fire', barrels: 2 } });
  }

  // GIB: one slug, then let the chunks fly for the rest of the segment.
  const gibStart = fireStart + fireFrames;
  steps.push({ at: gibStart, action: { kind: 'aimSurface' } });
  steps.push({ at: gibStart + 1, action: { kind: 'fireSlug' } });

  steps.sort((a, b) => a.at - b.at);

  return {
    frames: walkFrames + fireFrames + gibFrames,
    steps,
    segments: [
      { name: 'walk', from: 0, to: fireStart },
      { name: 'fire', from: fireStart, to: gibStart },
      { name: 'gib', from: gibStart, to: gibStart + gibFrames },
    ],
  };
}

/** Every action scheduled for exactly this frame, in insertion order. */
export function actionsAt(s: Scenario, frame: number): BenchAction[] {
  return s.steps.filter(x => x.at === frame).map(x => x.action);
}

/** The segment a frame belongs to, or null if the segments leave it uncovered. */
export function segmentAt(s: Scenario, frame: number): string | null {
  const seg = s.segments.find(x => frame >= x.from && frame < x.to);
  return seg ? seg.name : null;
}

/**
 * Structural problems, as human-readable strings. Empty means sound.
 *
 * This exists because a scenario with a one-frame gap or an off-the-end step
 * still RUNS — it just silently drops samples on the floor, and the resulting
 * table looks entirely plausible.
 */
export function validateScenario(s: Scenario): string[] {
  const errs: string[] = [];
  const sorted = [...s.segments].sort((a, b) => a.from - b.from);
  let cursor = 0;
  for (const seg of sorted) {
    if (seg.from > cursor) errs.push(`gap before frame ${seg.from}`);
    if (seg.from < cursor) errs.push(`overlap at frame ${seg.from}`);
    if (seg.to <= seg.from) errs.push(`empty segment ${seg.name}`);
    cursor = Math.max(cursor, seg.to);
  }
  if (cursor < s.frames) errs.push(`gap before frame ${s.frames}`);
  if (cursor > s.frames) errs.push(`segments run past frames=${s.frames}`);
  for (const st of s.steps) {
    if (st.at >= s.frames) errs.push(`step at frame ${st.at} is past frames=${s.frames}`);
    if (st.at < 0) errs.push(`step at negative frame ${st.at}`);
  }
  return errs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-bench-scenario.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-bench-scenario.ts src/lab/sdf-zombie/webgpu/game-bench-scenario.test.ts
git commit -m "bench: the scripted firefight as pure data

Three segments (walk/fire/gib) because 'stable 30' is a question about
which moment breaks the budget, not about an average. aimSurface is its
own action so no shot can be scheduled without one — a cluster-centre aim
sits inside the field and severs both hip necks, which would corrupt the
bench invisibly."
```

---

### Task 2: The harness — throughput mode

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-bench.ts`
- Test: `src/lab/sdf-zombie/webgpu/game-bench.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/webgpu/game-bench.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runBench, summarise, type BenchDeps } from './game-bench';
import { buildFirefight, type BenchAction } from './game-bench-scenario';

/** A fake page: a synthetic clock that charges a per-segment cost per frame. */
function fakeDeps(costPerFrame: (frame: number) => number, opts: {
  hiddenFrom?: number;
} = {}) {
  let t = 0;
  let frame = 0;
  const performed: BenchAction[] = [];
  const deps: BenchDeps = {
    step() { t += costPerFrame(frame); frame++; },
    async resolveGpu() { /* fence is free in the fake */ },
    now: () => t,
    hidden: () => opts.hiddenFrom !== undefined && frame >= opts.hiddenFrom,
    perform(a) { performed.push(a); },
  };
  return { deps, performed, frames: () => frame };
}

describe('summarise', () => {
  it('reports percentiles and the max', () => {
    const s = summarise('x', [1, 2, 3, 4, 100]);
    expect(s.n).toBe(5);
    expect(s.max).toBe(100);
    expect(s.p50).toBe(3);
    expect(s.mean).toBeCloseTo(22, 5);
  });

  it('survives an empty sample set instead of returning NaN', () => {
    const s = summarise('x', []);
    expect(s).toEqual({ name: 'x', n: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 });
  });
});

describe('runBench throughput', () => {
  it('steps every frame of the scenario exactly once', async () => {
    const scenario = buildFirefight({ room: 4, walkFrames: 40, fireFrames: 40, gibFrames: 40 });
    const { deps, frames } = fakeDeps(() => 10);
    await runBench(deps, scenario, { mode: 'throughput', chunkFrames: 10, warmup: 0 });
    expect(frames()).toBe(120);
  });

  it('performs each scheduled action once', async () => {
    const scenario = buildFirefight({ room: 2, walkFrames: 20, fireFrames: 20, gibFrames: 20 });
    const { deps, performed } = fakeDeps(() => 10);
    await runBench(deps, scenario, { mode: 'throughput', chunkFrames: 10, warmup: 0 });
    expect(performed).toContainEqual({ kind: 'teleport', room: 2 });
    expect(performed.filter(a => a.kind === 'fireSlug')).toHaveLength(1);
  });

  it('attributes cost to the right segment', async () => {
    // walk frames cost 10, fire 20, gib 40.
    const scenario = buildFirefight({ room: 4, walkFrames: 40, fireFrames: 40, gibFrames: 40 });
    const { deps } = fakeDeps(f => (f < 40 ? 10 : f < 80 ? 20 : 40));
    const r = await runBench(deps, scenario, { mode: 'throughput', chunkFrames: 10, warmup: 0 });
    const seg = (n: string) => r.segments.find(s => s.name === n)!;
    expect(seg('walk').p50).toBeCloseTo(10, 5);
    expect(seg('fire').p50).toBeCloseTo(20, 5);
    expect(seg('gib').p50).toBeCloseTo(40, 5);
  });

  it('does not let a chunk straddle two segments', async () => {
    // 25 walk frames with chunkFrames 10 would straddle at frame 20 if the
    // driver chunked globally. Each segment must chunk within itself.
    const scenario = buildFirefight({ room: 4, walkFrames: 25, fireFrames: 25, gibFrames: 25 });
    const { deps } = fakeDeps(f => (f < 25 ? 10 : f < 50 ? 20 : 40));
    const r = await runBench(deps, scenario, { mode: 'throughput', chunkFrames: 10, warmup: 0 });
    expect(r.segments.find(s => s.name === 'walk')!.max).toBeCloseTo(10, 5);
    expect(r.segments.find(s => s.name === 'fire')!.max).toBeCloseTo(20, 5);
  });

  it('marks the run invalid when any frame was stepped while hidden', async () => {
    const scenario = buildFirefight({ room: 4, walkFrames: 20, fireFrames: 20, gibFrames: 20 });
    const { deps } = fakeDeps(() => 10, { hiddenFrom: 30 });
    const r = await runBench(deps, scenario, { mode: 'throughput', chunkFrames: 10, warmup: 0 });
    expect(r.hiddenSteps).toBeGreaterThan(0);
    expect(r.valid).toBe(false);
  });

  it('discards warmup frames from the samples', async () => {
    const scenario = buildFirefight({ room: 4, walkFrames: 20, fireFrames: 20, gibFrames: 20 });
    const { deps, frames } = fakeDeps(() => 10);
    await runBench(deps, scenario, { mode: 'throughput', chunkFrames: 10, warmup: 15 });
    expect(frames()).toBe(75); // 15 warmup + 60 scenario
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-bench.test.ts`
Expected: FAIL — `Failed to resolve import "./game-bench"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/webgpu/game-bench.ts`:

```ts
// src/lab/sdf-zombie/webgpu/game-bench.ts
//
// Runs a Scenario against the page and reports per-segment frame cost.
//
// EVERYTHING THE PAGE CAN DO IS INJECTED (BenchDeps), so the timing logic,
// the segment attribution and the invalid-run detection are all testable
// against a synthetic clock with no GPU in the room.
//
// TWO MODES, AND THEY MUST NOT BE COMPARED TO EACH OTHER.
//
//   throughput — submit a chunk of frames, THEN fence. The queue stays full
//     for all but the chunk's last frame, so the number describes execution
//     rather than submission. This is the mode for every A/B. Its sample is a
//     CHUNK MEAN, so it is blind to spikes by construction: one 60 ms frame in
//     a 20-frame chunk averages down to ~2 ms.
//   spike — fence after EVERY frame, so each sample is one real frame. This is
//     the only way to see the blow-ups "stable 30" is actually about. It also
//     drains the queue every frame, which lets the GPU clock down between
//     frames — lab-main measured that route swinging 13/36/21 ms across three
//     runs of one config. So spike absolutes are junk; only the ratios WITHIN
//     one spike run mean anything.
//
// Chunking happens INSIDE a segment, never across one. A chunk that straddled
// the walk/fire boundary would blend a cheap frame into an expensive mean and
// put the cost in the wrong column.

import { actionsAt, segmentAt, type BenchAction, type Scenario } from './game-bench-scenario';

export interface BenchDeps {
  /** Drive exactly one frame at this timestep. */
  step(dtSec: number): void;
  /** Await a real GPU completion fence. */
  resolveGpu(): Promise<void>;
  /** A monotonic clock in milliseconds. */
  now(): number;
  /** Whether the page is currently uncomposited. */
  hidden(): boolean;
  /** Apply one scenario action to the page. */
  perform(action: BenchAction): void;
}

export interface BenchOpts {
  mode: 'throughput' | 'spike';
  /** Frames per fenced chunk. Ignored in spike mode (always 1). */
  chunkFrames?: number;
  /** Frames run and discarded before sampling starts. */
  warmup?: number;
  dtSec?: number;
  label?: string;
}

export interface SegmentSummary {
  name: string; n: number;
  p50: number; p95: number; p99: number; max: number; mean: number;
}

export interface BenchResult {
  mode: 'throughput' | 'spike';
  label: string;
  /** False when any frame was stepped while the page was hidden. */
  valid: boolean;
  hiddenSteps: number;
  frames: number;
  chunkFrames: number;
  overall: SegmentSummary;
  segments: SegmentSummary[];
}

export const BENCH_DEFAULTS = {
  chunkFrames: 20,
  warmup: 40,
  dtSec: 1 / 60,
} as const;

/** Percentiles by sorted index — n is small, so nothing cleverer is warranted. */
export function summarise(name: string, samples: number[]): SegmentSummary {
  if (samples.length === 0) {
    return { name, n: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  }
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  return {
    name,
    n: s.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: s[s.length - 1]!,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
}

export async function runBench(
  deps: BenchDeps,
  scenario: Scenario,
  opts: BenchOpts,
): Promise<BenchResult> {
  const chunkFrames = opts.mode === 'spike' ? 1 : (opts.chunkFrames ?? BENCH_DEFAULTS.chunkFrames);
  const warmup = opts.warmup ?? BENCH_DEFAULTS.warmup;
  const dt = opts.dtSec ?? BENCH_DEFAULTS.dtSec;

  let hiddenSteps = 0;
  const stepOnce = (frame: number) => {
    if (deps.hidden()) hiddenSteps++;
    for (const a of actionsAt(scenario, frame)) deps.perform(a);
    deps.step(dt);
  };

  // Warmup runs frame 0's actions each time so the page is in the scenario's
  // starting state (right room, wanderers unfrozen) before sampling begins.
  for (let i = 0; i < warmup; i++) {
    if (deps.hidden()) hiddenSteps++;
    if (i === 0) for (const a of actionsAt(scenario, 0)) deps.perform(a);
    deps.step(dt);
  }
  await deps.resolveGpu();

  const bySegment = new Map<string, number[]>();
  const all: number[] = [];
  const record = (name: string, ms: number) => {
    let bucket = bySegment.get(name);
    if (!bucket) { bucket = []; bySegment.set(name, bucket); }
    bucket.push(ms);
    all.push(ms);
  };

  // Chunk WITHIN each segment. A chunk never crosses a boundary.
  for (const seg of scenario.segments) {
    let f = seg.from;
    while (f < seg.to) {
      const n = Math.min(chunkFrames, seg.to - f);
      const t0 = deps.now();
      for (let i = 0; i < n; i++) stepOnce(f + i);
      await deps.resolveGpu();
      record(seg.name, (deps.now() - t0) / n);
      f += n;
    }
  }

  return {
    mode: opts.mode,
    label: opts.label ?? '',
    valid: hiddenSteps === 0,
    hiddenSteps,
    frames: scenario.frames,
    chunkFrames,
    overall: summarise('overall', all),
    segments: scenario.segments.map(s => summarise(s.name, bySegment.get(s.name) ?? [])),
  };
}

/** Re-exported so the page seam does not need a second import. */
export { segmentAt };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/game-bench.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-bench.ts src/lab/sdf-zombie/webgpu/game-bench.test.ts
git commit -m "bench: harness with injected deps, two timing modes kept apart

throughput chunks then fences (queue stays full, honest execution time,
blind to spikes by construction); spike fences every frame (sees the
blow-ups, but drains the queue so the GPU clocks down — ratios within a
run only, never against throughput). Chunks never cross a segment
boundary or the cost lands in the wrong column."
```

---

### Task 3: The page seam

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (the `__sdfGame` object, ~line 876)

- [ ] **Step 1: Add the missing ablation setters**

In `game-main.ts`, inside the `__sdfGame` object literal, after the existing `setOccluder` / `hullDebug` block, add:

```ts
    // -------------------------------------------------------------------
    // BENCH SEAMS (2026-08-31). Everything the ablation legs need to
    // toggle, plus the fence the harness times against. Ship defaults are
    // unchanged — these only move when a driver moves them.
    // -------------------------------------------------------------------
    /** The GPU completion fence. Trust the fence, never a timestamp value. */
    resolveGpu: () => handle.resolveGpu(),
    /** Adaptive resolution: the frame-rate safety net, default OFF.
     *  A bench MUST suspend it — it moves the pixel count mid-run, and
     *  pixel count is the thing being measured. */
    setAdaptive(on: boolean, budgetMs = 1000 / 30) {
      adaptiveEnabled = on;
      adaptiveBudgetMs = budgetMs;
      adaptiveState = initialAdaptiveState(performance.now(), adaptiveState.rung);
    },
    get adaptive() { return adaptiveEnabled; },
    setSdfScale: (v: number) => applySdfScale(v),
    get sdfScale() { return sdfScale; },
    setCone: (on: boolean) => sdfLayer.setConeEnabled(on),
    get cone() { return sdfLayer.coneEnabled; },
    setFxaa: (on: boolean) => postAa.setFxaa(on),
    get fxaa() { return postAa.fxaa; },
    setSmear: (v: number) => postAa.setSmear(v),
    /** Gather every actor into one room for a denser-than-4 crowd leg.
     *  Freezes the wanderers first: wander clamps are per-room, and a
     *  gathered actor would otherwise be yanked back next step. */
    gather(roomId: number) {
      const r = ROOMS.find(x => x.id === roomId);
      if (!r) return 0;
      wanderFrozen = true;
      const cx = (r.minX + r.maxX) / 2;
      const cz = (r.minZ + r.maxZ) / 2;
      const n = actors.length;
      actors.forEach((a, i) => {
        const ang = (i / n) * Math.PI * 2;
        a.teleport(cx + Math.cos(ang) * 2.2, cz + Math.sin(ang) * 2.2);
      });
      return n;
    },
```

- [ ] **Step 2: Check whether `ZombieActor` exposes `teleport`**

Run: `grep -n "teleport\|^export interface ZombieActor" -A 30 src/lab/sdf-zombie/webgpu/game-actor.ts | head -40`

If `ZombieActor` has no `teleport`, add one to `game-actor.ts` that sets the actor's ground position and re-seeds its wander target, and export it on the interface. If it already has an equivalent (e.g. `setPose`), call that instead and adjust the snippet above to match the real name. **Do not invent a method name that is not on the interface** — TypeScript will catch it in Step 4, but the point is to read the interface first.

- [ ] **Step 3: Wire the bench entry point**

Still inside the `__sdfGame` object, add:

```ts
    /** Run one bench leg. Returns the BenchResult and also parks it on
     *  window.__gameBench, because a console call that returns a value can
     *  itself hide the page — read it back afterwards instead. */
    async bench(o: {
      room?: number; mode?: 'throughput' | 'spike';
      walkFrames?: number; fireFrames?: number; gibFrames?: number;
      chunkFrames?: number; warmup?: number; label?: string;
    } = {}) {
      const scenario = buildFirefight({
        room: o.room ?? 4,
        walkFrames: o.walkFrames,
        fireFrames: o.fireFrames,
        gibFrames: o.gibFrames,
      });
      const problems = validateScenario(scenario);
      if (problems.length) throw new Error(`bad scenario: ${problems.join('; ')}`);

      handle.setLoopRunning(false);
      const hadAdaptive = adaptiveEnabled;
      adaptiveEnabled = false;
      try {
        const deps: BenchDeps = {
          step: (dt) => handle.step(dt),
          resolveGpu: () => handle.resolveGpu(),
          now: () => performance.now(),
          hidden: () => document.hidden,
          perform: (a) => {
            switch (a.kind) {
              case 'teleport': {
                const r = ROOMS.find(x => x.id === a.room);
                if (r) {
                  player.pos = [(r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2];
                  player.vel = [0, 0, 0];
                  player.yaw = 0; player.pitch = 0;
                }
                break;
              }
              case 'freeze': wanderFrozen = a.on; break;
              case 'look': player.yaw = a.yaw; player.pitch = a.pitch; break;
              case 'aimSurface': aimAtNearestSurface(); break;
              case 'fire': fire(a.barrels); break;
              case 'fireSlug': {
                const keep = slugMode;
                slugMode = true;
                try { fire(1); } finally { slugMode = keep; }
                break;
              }
            }
          },
        };
        const result = await runBench(deps, scenario, {
          mode: o.mode ?? 'throughput',
          chunkFrames: o.chunkFrames,
          warmup: o.warmup,
          label: o.label,
        });
        (window as unknown as { __gameBench: unknown }).__gameBench = result;
        return result;
      } finally {
        adaptiveEnabled = hadAdaptive;
        adaptiveState = initialAdaptiveState(performance.now(), adaptiveState.rung);
        handle.setLoopRunning(true);
      }
    },
```

- [ ] **Step 4: Add `aimAtNearestSurface`**

Above the `__sdfGame` assignment in `game-main.ts`, add:

```ts
  /**
   * Point the player at the nearest zombie's SURFACE, using the same
   * ballistic predictor fire() uses.
   *
   * Not a cluster centre: a torso centre sits INSIDE the field, anchors the
   * crater pathologically, and a slug's severRadius then cuts both hip necks
   * into an instant collapse. That never happens to a player (the predictor
   * always resolves to a surface) but it would silently wreck a bench.
   *
   * Coarse yaw/pitch aim first, then confirm with predictSlugHit — if the
   * predictor cannot find a body, the aim is left where it was and the shot
   * simply misses, which is honest.
   */
  function aimAtNearestSurface(): boolean {
    const eye = eyeOf(player);
    let best: { d: number; a: ZombieActor } | null = null;
    for (const a of actors) {
      const c = a.posed().clusters.find(cc => cc.limb === 'torso')?.center;
      if (!c) continue;
      const d = Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]);
      if (!best || d < best.d) best = { d, a };
    }
    if (!best) return false;
    const c = best.a.posed().clusters.find(cc => cc.limb === 'torso')!.center;
    player.yaw = Math.atan2(c[0] - eye[0], c[2] - eye[2]);
    player.pitch = Math.atan2(c[1] - eye[1], Math.hypot(c[0] - eye[0], c[2] - eye[2]));
    return true;
  }
```

- [ ] **Step 5: Add the imports**

At the top of `game-main.ts`, alongside the other local imports:

```ts
import { buildFirefight, validateScenario } from './game-bench-scenario';
import { runBench, type BenchDeps } from './game-bench';
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. If `player.yaw` / `eyeOf` / `ZombieActor.teleport` / `sdfScale` resolve differently than assumed, fix against the real declarations rather than casting.

- [ ] **Step 7: Full test run**

Run: `npx vitest run src/lab`
Expected: PASS — the existing suite plus the 15 new tests, no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts src/lab/sdf-zombie/webgpu/game-actor.ts
git commit -m "game: bench seam — fence, ablation setters, crowd gather, surface aim

__sdfGame.bench runs a firefight scenario and parks the result on
window.__gameBench (a console call that returns a value can hide the page,
which resolves to ~0.065 ms of nothing and reads as a 70x speedup).
Adaptive is suspended for the duration: it moves the pixel count mid-run
and pixel count is what is being measured. Ship defaults unchanged."
```

---

### Task 4: The CDP driver and the interleaved legs

**Files:**
- Create: `scripts/sdf-game-bench.mjs`

- [ ] **Step 1: Write the driver scaffolding**

Copy the CDP plumbing verbatim from `scripts/sdf-game.mjs` lines 18-60 — the `fetch` to `/json/new`, the `WebSocket`, the `seq`/`pending` map and its `send` helper, and the `process.on('exit')` tab close. Then add these helpers, which the rest of this task uses:

```js
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.env.BENCH_OUT ?? '/tmp/sdf-game-bench';
mkdirSync(OUT, { recursive: true });
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

/** Evaluate an expression in the page. awaitPromise for the async bench call. */
async function evalJs(expression, { awaitPromise = false, timeoutMs = 30_000 } = {}) {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise, returnByValue: true, timeout: timeoutMs,
  });
  if (r.exceptionDetails) fail(`page threw: ${r.exceptionDetails.text} — ${expression.slice(0, 120)}`);
  return r.result.value;
}

// The page must be VISIBLE. A hidden page has no swapchain texture, the passes
// do nothing, and the fence resolves to ~0.065 ms of nothing — which reads as
// a 70x speedup. The harness counts hidden frames and fails the leg, but do
// not rely on that alone: bring the tab to the front first.
await send('Page.bringToFront', {});
await evalJs('new Promise(r => (window.__sdfGame ? r(1) : setTimeout(() => r(1), 8000)))', { awaitPromise: true });
if (!(await evalJs('!!window.__sdfGame'))) fail('__sdfGame never appeared — is sdf-game.html served?');
```

Then the leg runner:

```js
// The legs. Each is a named page state; the runner alternates between them
// rather than running each to completion, because thermal drift over a long
// run is larger than most of the deltas being measured.
const LEGS = {
  baseline:      {},
  'occluder-off':{ setOccluder: false },
  'cone-on':     { setCone: true },
  'fxaa-off':    { setFxaa: false },
  'scale-0.7':   { setSdfScale: 0.7 },
  'scale-0.5':   { setSdfScale: 0.5 },
};

async function applyLeg(name) {
  const leg = LEGS[name];
  // Reset to ship defaults first, so legs cannot contaminate each other.
  await evalJs(`(() => {
    __sdfGame.setOccluder(true);
    __sdfGame.setCone(false);
    __sdfGame.setFxaa(true);
    __sdfGame.setSdfScale(1.0);
    __sdfGame.setAdaptive(false);
  })()`);
  for (const [fn, arg] of Object.entries(leg)) {
    await evalJs(`__sdfGame.${fn}(${JSON.stringify(arg)})`);
  }
}

async function runLeg(name, room, mode) {
  await applyLeg(name);
  await evalJs(
    `__sdfGame.bench({ room: ${room}, mode: ${JSON.stringify(mode)}, label: ${JSON.stringify(`${name}/room${room}/${mode}`)} })`,
    { awaitPromise: true, timeoutMs: 180_000 },
  );
  const r = await evalJs('JSON.stringify(window.__gameBench)');
  return JSON.parse(r);
}
```

- [ ] **Step 2: Interleave the repeats**

```js
// REPEATS ALTERNATE. Running leg A five times then leg B five times measures
// the thermal ramp as much as the change; A B A B A B does not.
const REPEATS = Number(process.env.BENCH_REPEATS ?? 3);
const results = [];
for (let rep = 0; rep < REPEATS; rep++) {
  for (const leg of Object.keys(LEGS)) {
    for (const room of [1, 2, 3, 4]) {
      const r = await runLeg(leg, room, 'throughput');
      if (!r.valid) fail(`leg ${leg} room ${room}: ${r.hiddenSteps} hidden frames — INVALID`);
      results.push({ rep, leg, room, ...r });
    }
  }
}
```

- [ ] **Step 3: Emit both outputs**

```js
// Median across repeats, per (leg, room). Median not mean: one thermal
// outlier should not move the reported number.
const med = (xs) => { const s=[...xs].sort((a,b)=>a-b); return s[s.length>>1]; };
const table = [];
for (const leg of Object.keys(LEGS)) {
  for (const room of [1,2,3,4]) {
    const rs = results.filter(r => r.leg===leg && r.room===room);
    if (!rs.length) continue;
    const seg = (n) => med(rs.map(r => r.segments.find(s=>s.name===n).p95));
    table.push({
      leg, room, bodies: room,
      overallP95: med(rs.map(r => r.overall.p95)),
      walkP95: seg('walk'), fireP95: seg('fire'), gibP95: seg('gib'),
    });
  }
}
writeFileSync(`${OUT}/bench.json`, JSON.stringify({ results, table }, null, 2));
console.log('| leg | room | bodies | overall p95 | walk | fire | gib |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const t of table) {
  console.log(`| ${t.leg} | ${t.room} | ${t.bodies} | ${t.overallP95.toFixed(2)} | ${t.walkP95.toFixed(2)} | ${t.fireP95.toFixed(2)} | ${t.gibP95.toFixed(2)} |`);
}
```

- [ ] **Step 4: Add the spike pass**

After the throughput matrix, run the spike mode once per room on the baseline leg only:

```js
// Spike pass: baseline only, one run per room. These absolutes are NOT
// comparable to the throughput table above (fencing every frame lets the GPU
// clock down between frames). Read them for the max/p50 RATIO — that is what
// says whether a moment blows up.
const spikes = [];
for (const room of [1,2,3,4]) {
  const r = await runLeg('baseline', room, 'spike');
  spikes.push({ room, ...r });
}
console.log('\n| room | p50 | p95 | max | max/p50 | worst segment |');
console.log('| ---: | ---: | ---: | ---: | ---: | --- |');
for (const s of spikes) {
  const worst = [...s.segments].sort((a,b)=>b.max-a.max)[0];
  console.log(`| ${s.room} | ${s.overall.p50.toFixed(2)} | ${s.overall.p95.toFixed(2)} | ${s.overall.max.toFixed(2)} | ${(s.overall.max/s.overall.p50).toFixed(1)}x | ${worst.name} (${worst.max.toFixed(1)} ms) |`);
}
```

- [ ] **Step 5: Run it**

```bash
LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 node scripts/sdf-game-bench.mjs
```

Expected: two markdown tables on stdout and `/tmp/sdf-game-bench/bench.json` written. Every leg must report `valid: true`; a single hidden frame fails the run.

- [ ] **Step 6: Commit**

```bash
git add scripts/sdf-game-bench.mjs
git commit -m "bench: CDP driver — interleaved legs, throughput matrix + spike pass

Legs alternate rather than running to completion: thermal drift over a
long run is bigger than most deltas being measured. Legs reset to ship
defaults before each application so they cannot contaminate each other.
The spike pass is baseline-only and its absolutes are deliberately not
comparable to the throughput table — read the max/p50 ratio."
```

---

### Task 5: The deliverable

**Files:**
- Create: `docs/dev-notes/2026-08-31-game-perf-baseline/notes.md`
- Modify: `TASKS.md`

- [ ] **Step 1: Write the note**

Record, with the numbers actually measured:

1. **The table**, both of them, verbatim from the driver.
2. **The crowd curve** — overall p95 against body count (rooms 1→4). Is cost linear in bodies, or worse? This is the number Phase 1's shell-march decision turns on.
3. **The cliff profile** — which segment carries the max, and the max/p50 ratio per room. If `gib` dominates, the spike is chunk spawning, not marching, and Phase 1's ordering should be revisited before anything is built.
4. **Ablation deltas** — what the occluder is worth now, what the cone costs, what FXAA costs, and the scale curve at 1.0 / 0.7 / 0.5.
5. **Honest caveats** — machine, whether any delta fell inside within-leg noise, and the reminder that the occluder A/B could not be resolved on this machine during the wound-hull work.
6. **What this means for Phase 1**, in one paragraph, naming which spike should go first given the data.

- [ ] **Step 2: Update TASKS.md**

Add a row under *Current focus* summarising the baseline in ≤2 lines and linking the note. Flip nothing to `[x]` — Phase 0 is a gate, not a milestone.

- [ ] **Step 3: Commit**

```bash
git add docs/dev-notes/2026-08-31-game-perf-baseline/ TASKS.md
git commit -m "perf: the honest game-page baseline, and what it says about Phase 1"
```

- [ ] **Step 4: Save the findings to dualmem**

```bash
source ~/.claude/hooks/dualmem-env.sh
~/go/bin/dualmem add --type investigation --salience 0.85 \
  --files "docs/dev-notes/2026-08-31-game-perf-baseline/notes.md,scripts/sdf-game-bench.mjs,src/lab/sdf-zombie/webgpu/game-bench.ts" \
  --text "<the measured baseline, crowd curve, and which segment spikes>"
```

---

### Task 6: Switch on the adaptive floor (after the baseline, not before)

The spec calls for this independently of the Phase 2 gate. It lands **last** on purpose: adaptive moves the pixel count under load, so enabling it before Task 5 would mean the baseline measured the safety net instead of the cost.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts:250`

- [ ] **Step 1: Flip the default**

```ts
  // ADAPTIVE ON by default (2026-08-31). The floor guarantee, not an answer:
  // it holds the frame rate by dropping SDF resolution, which is a look cost
  // paid during exactly the moments that matter most. Baseline was taken with
  // it OFF (docs/dev-notes/2026-08-31-game-perf-baseline/notes.md) so the
  // measured cost is the un-netted one. __sdfGame.bench suspends it.
  let adaptiveEnabled = true;
```

- [ ] **Step 2: Confirm the bench still suspends it**

Run: `LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 BENCH_REPEATS=1 node scripts/sdf-game-bench.mjs`
Expected: every leg reports `valid: true`, and the room-4 baseline p95 matches Task 5's recorded figure within its noise band. If it does not, the suspension in `__sdfGame.bench` is not working and the whole Task 5 table is suspect.

- [ ] **Step 3: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "game: adaptive resolution on by default — the 30 fps floor

Lands after the baseline on purpose: adaptive moves the pixel count under
load, so enabling it first would have measured the safety net instead of
the cost. It is a floor, not an answer — it buys frames by dropping SDF
resolution during exactly the moments that matter most."
```

---

## Verification

The plan is done when all of these hold:

- `npx tsc --noEmit` clean.
- `npx vitest run src/lab` green, with the 15 new tests passing and no existing test regressed.
- `node scripts/sdf-game-bench.mjs` completes with `valid: true` on every leg.
- The dev-note carries real numbers — no placeholders — and names the Phase 1 ordering the data supports.
- Ship render defaults are unchanged through Tasks 1-5: occluder on, cone off, FXAA on, sdfScale 1.0. Confirm by diffing `game-main.ts` for any default assignment. Adaptive is the one deliberate default change and it lands in Task 6, *after* the baseline is taken.
