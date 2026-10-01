# Early-Z for the SDF march (conservative depth), stage 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Behind a default-off `?earlyz=1` flag, crowd-type march draws keep hardware early-Z: a front-face proxy with
`@builtin(frag_depth, greater)`, a camera-inside fallback on the shipped material, a level-depth seed in the march
target and near-to-far draw order. The image stays unchanged and the frame cost is measured on real scenes.

**Spec:** `docs/superpowers/specs/2026-10-01-sdf-march-early-z-design.md` — read it first. It is APPROVED. Its D7 was
amended by this plan: back batches draw before front batches (the reason is in the spec).
Probe evidence: `docs/dev-notes/2026-10-01-earlyz-probe/NOTES.md`. Chrome 154 / Metal: plain `frag_depth` 116 ms,
`frag_depth, greater` 0.057 ms for 16 hidden layers.

**Architecture:**
- **Pure modules under `src/lab/sdf-zombie/webgpu/earlyz/`:** the flag, the camera-inside split, the draw-order ranks,
  and CPU twins of the two WGSL helpers.
- **One renderer-facing patch module:** it wraps three's `WGSLNodeBuilder.getFragDepth` per material and holds the
  compile-based detection.
- **The march body's WGSL is not edited.** The front material passes the analytic box exit through the existing
  `rays.worldPos` override, the pattern `hull-refine-view.ts` uses. That is why the flag-off golden text cannot move.
- **The seed is one depth-only quad** in the march target, written by hand-written WGSL.

**Tech Stack:** TypeScript, three.js 0.186 WebGPU + TSL, WGSL string modules, Vitest, headless-Chrome capture scripts
(`scripts/*.mjs`, `scripts/lab-servers.sh`).

## Rules for every task

- **Port-ready by construction (release is a Rust + wgpu port — production
  scope §4.6):**
  - Game logic goes in a **pure, renderer-free module with its own tests**
    (no `three` import; plain data in, plain data out — the `burn-state`,
    `burn-behaviour`, `burn-room-light` pattern). The renderer-facing module
    only reads that logic's output and writes uniforms/objects.
  - Rendering that matters goes in **hand-written WGSL** (`*.wgsl.ts` string
    modules). TSL node graphs are for thin glue (binding, blending), not for
    the effect itself.
  - State lives on `ctx` (`GameContext` slices) or inside a feature module —
    never as new `main()` bindings (`npm test -- game-context-coverage`).
  - Keep the simulation deterministic (seeded RNG, sim-time clocks, no
    wall-clock in logic) and console/capture seams in plain data.
- Work ONLY in your dispatch worktree. Never `git stash`. `node_modules` is
  symlinked — do not reinstall.
- **Targeted tests only** (`npm test -- <names>`) plus `npx tsc --noEmit`.
  Never the bare full suite.
- **Headless capture only** — the in-app browser pane loses the WebGPU device.
  Capture scripts require `window.__warmGate.phase === 'ready'` and fail on
  renderer pipeline errors.
- **Prove visual and performance claims with a number** (crop luminance,
  frame-to-frame change, GPU ms, boot time) and look at the images yourself.
- **Boot time is a gate:** a change that touches shaders or materials reports
  cold-boot `drawOnce` against the base branch (fresh profile each run).
- WebGPU: alpha in `colorNode.w`, never `alphaHash`/`alphaTest`. Never toggle a
  light's `.visible`. Never sample the render target you are writing. In
  `march.wgsl.ts`'s positional uniform lists never put a `:` inside a comment.
- Kill anything you start outside a capture script in the same step.
- Extracted Blood assets are dev placeholders — never commit them.

**Plan-specific rules:**
- **Flag off must be byte-identical:**
  - Never add a `mapBody(` call site (each one costs cold-compile seconds; see the 2026-09-21 cold-compile notes).
  - Never edit `march/body/**` or `march.wgsl.ts` in this plan.
  - `march-golden.test.ts` and `scripts/march-hash.mjs` (default mode) must pass unchanged after EVERY task.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **`march-hash.mjs` needs servers up** (it does not start its own); always run it as
  `bash -c 'export LAB_VITE_PORT=5323 LAB_CDP_PORT=9323 LAB_TMP=.lab-tmp; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/march-hash.mjs'`.
  It is bistable under CPU load (its own header, 2026-09-20): if it reports a different hash, check `uptime`,
  wait for load < 4 and re-run before calling it a regression.
- Browser scripts run through `scripts/earlyz-run.sh` (Task 11). It owns its own vite and Chrome and stops only what
  it started.

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `src/lab/sdf-zombie/webgpu/earlyz/flag.ts` | create | `EARLYZ_FLAG`, read once from `?earlyz=1` (pure) |
| `src/lab/sdf-zombie/webgpu/earlyz/batch-split.ts` | create | camera-inside test + front/back split (pure) |
| `src/lab/sdf-zombie/webgpu/earlyz/type-order.ts` | create | renderOrder ranks for seed / back / front batches (pure) |
| `src/lab/sdf-zombie/webgpu/earlyz/box-exit.wgsl.ts` | create | WGSL analytic box exit point + CPU twin `boxExitT` |
| `src/lab/sdf-zombie/webgpu/earlyz/seed-depth.wgsl.ts` | create | WGSL seed (farthest level depth per march texel) + CPU twin `seedBlock` |
| `src/lab/sdf-zombie/webgpu/earlyz/conservative-depth-patch.ts` | create | three r186 `getFragDepth` wrapper, hit counter, `detectConservativeDepth` |
| `src/lab/sdf-zombie/webgpu/earlyz/conservative-depth-material.ts` | create | `applyConservativeDepth(material)`: depth clamp + opt-in property |
| `src/lab/sdf-zombie/webgpu/earlyz/earlyz-boot.ts` | create | `bootEarlyz(ctx)`, `applyEarlyzRenderOrder(types)` (glue) |
| `src/lab/sdf-zombie/webgpu/game-seams-earlyz.ts` | create | `__sdfGame.earlyzInfo()` |
| `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` | modify | `createCrowdMaterial(..., earlyz?)` front variant |
| `src/lab/sdf-zombie/webgpu/crowd-type.ts` | modify | `opts.earlyz`, `frontMesh`, split in `sync()`, `earlyzBatches()` |
| `src/lab/sdf-zombie/webgpu/sdf-layer.ts` | modify | seed quad, `setEarlyzSeed`, `earlyzSeedInfo` |
| `src/lab/sdf-zombie/webgpu/game-state-crowd.ts` | modify | `CrowdState.earlyz` |
| `src/lab/sdf-zombie/webgpu/game-crowd-leaves.ts` | modify | pass `earlyz`, add/register `frontMesh` |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | modify | boot hook, seed hook, background compile, hide, render order, seam registration |
| `src/lab/sdf-zombie/webgpu/game-seams-world.ts` | modify | `tunnelDefs` seam (doorway scene) |
| `scripts/lib/earlyz-scenes.mjs` | create | shared staging: pack / doorway / melee / far / train-doorway |
| `scripts/earlyz-run.sh` | create | servers + runs `earlyz-smoke.mjs` or `earlyz-parity.mjs` |
| `scripts/earlyz-smoke.mjs` | create | boot smoke under the flag |
| `scripts/earlyz-parity.mjs` | create | flag off/on parity + owner look sheet |
| `scripts/sdf-game-bench.mjs` | modify | per-leg `_query`, `earlyz` legs, `BENCH_SCENE=doorway` |
| `docs/dev-notes/2026-10-01-earlyz-stage-1/NOTES.md` | create | results of record |

---

## Task 0: Record the baselines the flag-off path must hold

**Files:** notes only, `docs/dev-notes/2026-10-01-earlyz-stage-1/NOTES.md` (create).

- [ ] **Step 1: Golden text and crowd unit tests pass before any change**

Run: `npm test -- march-golden crowd-type game-context`
Expected: all PASS. Copy the pass counts into the notes.

- [ ] **Step 2: March hash (default mode) before any change**

Run: `bash -c 'export LAB_VITE_PORT=5323 LAB_CDP_PORT=9323 LAB_TMP=.lab-tmp; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/march-hash.mjs'`
Expected: `PASS` against the pinned default (`d7392d52…` as of 2026-10-01; if the script pins something else, the
script is the truth). Record the hash line in the notes.

- [ ] **Step 3: Write the notes skeleton**

```markdown
# Early-Z stage 1 — results of record (2026-10-01)

Plan: `docs/superpowers/plans/2026-10-01-sdf-march-early-z-stage-1.md` · Spec: `docs/superpowers/specs/2026-10-01-sdf-march-early-z-design.md`

## Baselines (before Task 1)
- `npm test -- march-golden crowd-type game-context`: <counts>
- `node scripts/march-hash.mjs`: <hash line>
```

- [ ] **Step 4: Commit**

```bash
git add docs/dev-notes/2026-10-01-earlyz-stage-1/NOTES.md
git commit -m "earlyz: record flag-off baselines before stage 1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 1: The compile-time flag

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/earlyz/flag.ts`
- Test: `src/lab/sdf-zombie/webgpu/earlyz/flag.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/earlyz/flag.test.ts
import { describe, it, expect } from 'vitest';
import { readEarlyzFlag, EARLYZ_FLAG } from './flag';

describe('earlyz flag (spec D1)', () => {
  it('is on only for earlyz=1', () => {
    expect(readEarlyzFlag('?earlyz=1')).toBe(true);
    expect(readEarlyzFlag('?level=night-train&earlyz=1')).toBe(true);
    expect(readEarlyzFlag('?earlyz=0')).toBe(false);
    expect(readEarlyzFlag('?earlyz')).toBe(false);
    expect(readEarlyzFlag('')).toBe(false);
  });
  it('reads false under vitest, so the golden text sees the shipped shaders', () => {
    expect(EARLYZ_FLAG).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- earlyz/flag`
Expected: FAIL, `Cannot find module './flag'`.

- [ ] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/webgpu/earlyz/flag.ts
//
// COMPILE-TIME switch for the early-Z march (spec 2026-10-01 D1), read ONCE at
// module load in the `march/limbs-flag.ts` pattern. With the flag off nothing in
// this directory builds a material, a mesh or a byte of WGSL, so march-golden and
// march-hash cannot move. Under Vitest there is no page query: false.
export function readEarlyzFlag(search?: string): boolean {
  try {
    const s = search ?? (globalThis as { location?: { search?: string } }).location?.search ?? '';
    return new URLSearchParams(s).get('earlyz') === '1';
  } catch {
    return false;
  }
}

export const EARLYZ_FLAG: boolean = readEarlyzFlag();
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm test -- earlyz/flag`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/earlyz/flag.ts src/lab/sdf-zombie/webgpu/earlyz/flag.test.ts
git commit -m "earlyz: compile-time ?earlyz=1 flag (spec D1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Camera-inside split (pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/earlyz/batch-split.ts`
- Test: `src/lab/sdf-zombie/webgpu/earlyz/batch-split.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/earlyz/batch-split.test.ts
import { describe, it, expect } from 'vitest';
import { boxContainsPoint, splitInstances, NEAR_GUARD_M } from './batch-split';

const box = (c: [number, number, number], h: [number, number, number], id = 0) => ({ centre: c, half: h, id });

describe('camera-inside test (spec D5)', () => {
  it('counts the guard band as inside', () => {
    const b = box([0, 0, -4], [0.5, 1, 0.5]);
    expect(boxContainsPoint(b, [0, 0, -4], NEAR_GUARD_M)).toBe(true);
    expect(boxContainsPoint(b, [0, 0, -3.26], 0.25)).toBe(true);   // 0.24 m past the +z face
    expect(boxContainsPoint(b, [0, 0, -3.24], 0.25)).toBe(false);  // 0.26 m past it
    expect(boxContainsPoint(b, [0.76, 0, -4], 0.25)).toBe(false);
  });
});

describe('splitInstances', () => {
  it('sends camera-inside boxes to back and keeps the input order in both lists', () => {
    const list = [box([0, 0, -1], [0.5, 1, 0.5], 0), box([2, 0, -4], [0.5, 1, 0.5], 1), box([0.1, 0, -0.9], [0.5, 1, 0.5], 2), box([-3, 0, -6], [0.5, 1, 0.5], 3)];
    const { front, back } = splitInstances(list, [0, 0, -0.8]);
    expect(back.map((b) => b.id)).toEqual([0, 2]);
    expect(front.map((b) => b.id)).toEqual([1, 3]);
  });
  it('an empty list splits into two empty lists', () => {
    expect(splitInstances([], [0, 0, 0])).toEqual({ front: [], back: [] });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- earlyz/batch-split`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/webgpu/earlyz/batch-split.ts
//
// EARLY-Z BATCH SPLIT (spec 2026-10-01 D5). A front-face proxy rasterises nothing
// when the camera is inside its box (or the front face is clipped by the 0.1 m near
// plane), so those instances keep the SHIPPED back-face, plain-depth material.
// Pure: plain arrays in, plain arrays out, input order kept (crowd sync() sorts
// nearest-first and the draw order depends on it).

/** Inflation of each box before the camera test: covers the 0.1 m near plane
 *  with margin, so a front face is never clipped into a hole. */
export const NEAR_GUARD_M = 0.25;

export interface BatchBox {
  centre: ArrayLike<number>;
  half: ArrayLike<number>;
}

export function boxContainsPoint(box: BatchBox, p: ArrayLike<number>, guard: number): boolean {
  for (let i = 0; i < 3; i++) {
    if (Math.abs(p[i]! - box.centre[i]!) > box.half[i]! + guard) return false;
  }
  return true;
}

export function splitInstances<T extends BatchBox>(
  list: readonly T[],
  camera: ArrayLike<number>,
  guard: number = NEAR_GUARD_M,
): { front: T[]; back: T[] } {
  const front: T[] = [];
  const back: T[] = [];
  for (const b of list) (boxContainsPoint(b, camera, guard) ? back : front).push(b);
  return { front, back };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm test -- earlyz/batch-split`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/earlyz/batch-split.ts src/lab/sdf-zombie/webgpu/earlyz/batch-split.test.ts
git commit -m "earlyz: camera-inside front/back batch split (spec D5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Draw-order ranks (pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/earlyz/type-order.ts`
- Test: `src/lab/sdf-zombie/webgpu/earlyz/type-order.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/earlyz/type-order.test.ts
import { describe, it, expect } from 'vitest';
import { typeRenderOrder, SEED_RENDER_ORDER, BACK_BATCH_BASE, FRONT_BATCH_BASE } from './type-order';

describe('typeRenderOrder (spec D7, amended)', () => {
  it('seed < every back batch < every front batch', () => {
    expect(SEED_RENDER_ORDER).toBeLessThan(BACK_BATCH_BASE);
    expect(BACK_BATCH_BASE + 64).toBeLessThan(FRONT_BATCH_BASE);
  });
  it('ranks each batch kind near-to-far independently; empty batches (Infinity) last', () => {
    const o = typeRenderOrder([
      { key: 'a', nearestBack: Infinity, nearestFront: 6 },
      { key: 'b', nearestBack: 0.3, nearestFront: 2 },
      { key: 'c', nearestBack: Infinity, nearestFront: Infinity },
    ]);
    expect(o.get('b')!.back).toBe(BACK_BATCH_BASE);
    expect(o.get('b')!.front).toBe(FRONT_BATCH_BASE);
    expect(o.get('a')!.front).toBe(FRONT_BATCH_BASE + 1);
    expect(o.get('c')!.front).toBe(FRONT_BATCH_BASE + 2);
  });
  it('ties keep the input order (stable)', () => {
    const o = typeRenderOrder([
      { key: 'x', nearestBack: Infinity, nearestFront: 3 },
      { key: 'y', nearestBack: Infinity, nearestFront: 3 },
    ]);
    expect(o.get('x')!.front).toBeLessThan(o.get('y')!.front);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- earlyz/type-order`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/webgpu/earlyz/type-order.ts
//
// EARLY-Z DRAW ORDER (spec 2026-10-01 D7, amended by the plan). Every crowd mesh sits at
// the world origin, so three's z sort ties them; renderOrder decides instead:
//   1. the level-depth seed;
//   2. the BACK batches (camera-inside = nearest bodies: plain frag_depth, but their
//      depth lands first and occludes everything after);
//   3. the FRONT batches near-to-far (frag_depth greater: early-Z rejects what 1-2 hide).
// Negative ranks keep every other SDF_LAYER object (renderOrder 0) after the crowd.
// Pure: plain data in, plain data out.

export const SEED_RENDER_ORDER = -1_000_000;
export const BACK_BATCH_BASE = -20_000;
export const FRONT_BATCH_BASE = -10_000;

export interface TypeDistance {
  key: string;
  /** Distance to the batch's nearest drawn instance; Infinity when empty. */
  nearestBack: number;
  nearestFront: number;
}

export function typeRenderOrder(types: readonly TypeDistance[]): Map<string, { back: number; front: number }> {
  const out = new Map<string, { back: number; front: number }>();
  for (const t of types) out.set(t.key, { back: 0, front: 0 });
  // Array.prototype.sort is stable, so ties keep the input order.
  [...types].sort((a, b) => a.nearestBack - b.nearestBack || 0)
    .forEach((t, i) => { out.get(t.key)!.back = BACK_BATCH_BASE + i; });
  [...types].sort((a, b) => a.nearestFront - b.nearestFront || 0)
    .forEach((t, i) => { out.get(t.key)!.front = FRONT_BATCH_BASE + i; });
  return out;
}
```

Note: `Infinity - Infinity` is `NaN`; `NaN || 0` is `0`, which keeps empty batches stable at the end.

- [ ] **Step 4: Run it to see it pass**

Run: `npm test -- earlyz/type-order`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/earlyz/type-order.ts src/lab/sdf-zombie/webgpu/earlyz/type-order.test.ts
git commit -m "earlyz: seed/back/front render-order ranks (spec D7 amended)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Analytic box exit (WGSL + CPU twin)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/earlyz/box-exit.wgsl.ts`
- Test: `src/lab/sdf-zombie/webgpu/earlyz/box-exit.wgsl.test.ts`

The front material hands the march `worldPos = camPos + rd · tExit`. `ray-window`'s
`tMaxBox = length(worldPos - camPos)` then equals the exit distance the back face used to give it (spec D4), and the
march body text does not change.

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/earlyz/box-exit.wgsl.test.ts
import { describe, it, expect } from 'vitest';
import { EARLYZ_BOX_EXIT_WGSL, boxExitT } from './box-exit.wgsl';
import { RAY_WINDOW_BLOCK } from '../march/body/blocks/setup/ray-window.wgsl';

describe('analytic box exit (spec D4)', () => {
  it('exit along the axis is the far face', () => {
    expect(boxExitT([0, 0, 0], [0, 0, -1], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(4.5, 6);
  });
  it('an oblique ray leaves through the nearest far slab', () => {
    const d = Math.SQRT1_2;
    // box x in [-0.5, 0.5], z in [-4.5, -3.5]; ray (d, 0, -d): x leaves at t = 0.5/d
    expect(boxExitT([0, 0, -4], [d, 0, -d], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(0.5 / d, 6);
  });
  it('a camera inside the box still exits forward (never negative)', () => {
    expect(boxExitT([0, 0, -4], [0, 0, -1], [0, 0, -4], [0.5, 1, 0.5])).toBeCloseTo(0.5, 6);
  });
  it('the WGSL uses the same slab algebra and parallel-axis guard as ray-window', () => {
    expect(RAY_WINDOW_BLOCK).toContain('let invRd = select(vec3<f32>(1e9), 1.0 / rd, abs(rd) > vec3<f32>(1e-8));');
    expect(EARLYZ_BOX_EXIT_WGSL).toContain('let invRd = select(vec3<f32>(1e9), 1.0 / rd, abs(rd) > vec3<f32>(1e-8));');
    expect(EARLYZ_BOX_EXIT_WGSL).toContain('let tExit = min(min(max(lo.x, hi.x), max(lo.y, hi.y)), max(lo.z, hi.z));');
    expect(EARLYZ_BOX_EXIT_WGSL).toMatch(/^fn earlyzBoxExitPoint\(camPos: vec3<f32>, rd: vec3<f32>, centre: vec3<f32>, halfExt: vec3<f32>\) -> vec3<f32> \{/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- earlyz/box-exit`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/webgpu/earlyz/box-exit.wgsl.ts
//
// EARLY-Z ANALYTIC EXIT (spec 2026-10-01 D4). The shipped proxy draws BACK faces and
// ray-window reads the exit as length(worldPos - camPos). A FRONT-face proxy's
// worldPos is the ENTRY, so the front material passes this point instead: the far
// root of the same slab test ray-window uses for boxEntry (same parallel-axis guard).
// `halfExt`, not `half`: avoid any reserved-word ambiguity in WGSL.
export const EARLYZ_BOX_EXIT_WGSL = /* wgsl */ `fn earlyzBoxExitPoint(camPos: vec3<f32>, rd: vec3<f32>, centre: vec3<f32>, halfExt: vec3<f32>) -> vec3<f32> {
  let invRd = select(vec3<f32>(1e9), 1.0 / rd, abs(rd) > vec3<f32>(1e-8));
  let lo = (centre - halfExt - camPos) * invRd;
  let hi = (centre + halfExt - camPos) * invRd;
  let tExit = min(min(max(lo.x, hi.x), max(lo.y, hi.y)), max(lo.z, hi.z));
  return camPos + rd * max(tExit, 0.0);
}`;

/** CPU twin of the WGSL above: the exit distance along `rd` (unit length). */
export function boxExitT(
  camPos: ArrayLike<number>, rd: ArrayLike<number>, centre: ArrayLike<number>, half: ArrayLike<number>,
): number {
  let tExit = Infinity;
  for (let i = 0; i < 3; i++) {
    const inv = Math.abs(rd[i]!) > 1e-8 ? 1 / rd[i]! : 1e9;
    const lo = (centre[i]! - half[i]! - camPos[i]!) * inv;
    const hi = (centre[i]! + half[i]! - camPos[i]!) * inv;
    tExit = Math.min(tExit, Math.max(lo, hi));
  }
  return Math.max(tExit, 0);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm test -- earlyz/box-exit`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/earlyz/box-exit.wgsl.ts src/lab/sdf-zombie/webgpu/earlyz/box-exit.wgsl.test.ts
git commit -m "earlyz: analytic proxy-box exit WGSL + CPU twin (spec D4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Level-depth seed shader (WGSL + CPU twin)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/earlyz/seed-depth.wgsl.ts`
- Test: `src/lab/sdf-zombie/webgpu/earlyz/seed-depth.wgsl.test.ts`

Each march texel takes the **farthest** level depth of the output pixels it covers (spec D6). It is pre-occluded only
when every covered pixel has level geometry nearer than the body.

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/earlyz/seed-depth.wgsl.test.ts
import { describe, it, expect } from 'vitest';
import { EARLYZ_SEED_WGSL, seedBlock, seedDepthCpu } from './seed-depth.wgsl';

describe('seed block (spec D6)', () => {
  it('upscaler boot: a 400x300 texel covers a 2x2 block of the 800x600 level depth', () => {
    expect(seedBlock([0, 0], [400, 300], [800, 600])).toEqual({ lo: [0, 0], hi: [1, 1] });
    expect(seedBlock([399, 299], [400, 300], [800, 600])).toEqual({ lo: [798, 598], hi: [799, 599] });
  });
  it('native scale covers exactly one pixel', () => {
    expect(seedBlock([5, 7], [800, 600], [800, 600])).toEqual({ lo: [5, 7], hi: [5, 7] });
  });
  it('a non-integer ratio covers every touched pixel', () => {
    // 3 texels over 8 pixels: texel 1 spans [2.67, 5.33) -> pixels 2..5
    expect(seedBlock([1, 0], [3, 1], [8, 1])).toEqual({ lo: [2, 0], hi: [5, 0] });
  });
});

describe('seed depth', () => {
  it('takes the farthest depth of the block (conservative)', () => {
    const W = 4, H = 2;
    const d = new Float32Array([0.2, 0.9, 0.3, 0.3,
                                0.2, 0.2, 0.3, 0.3]);
    expect(seedDepthCpu(d, W, H, [0, 0], [2, 1])).toBeCloseTo(0.9, 6);
    expect(seedDepthCpu(d, W, H, [1, 0], [2, 1])).toBeCloseTo(0.3, 6);
  });
  it('the WGSL caps the block at 4x4 and clamps to the texture', () => {
    expect(EARLYZ_SEED_WGSL).toMatch(/^fn earlyzSeedDepth\(levelDepth: texture_depth_2d, uv: vec2<f32>, marchSize: vec2<f32>\) -> f32 \{/);
    expect(EARLYZ_SEED_WGSL).toContain('for (var y = 0; y < 4; y++) {');
    expect(EARLYZ_SEED_WGSL).toContain('d = max(d, textureLoad(levelDepth, clamp(p, vec2<i32>(0), maxI), 0));');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- earlyz/seed-depth`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/webgpu/earlyz/seed-depth.wgsl.ts
//
// EARLY-Z LEVEL-DEPTH SEED (spec 2026-10-01 D6). A depth-only full-screen pass
// draws first in the march target and writes, per march texel, the FARTHEST level
// depth of the output pixels the texel covers. Conservative: a texel is pre-occluded
// only when ALL its pixels have level geometry nearer than the body, so the composite's
// per-pixel depth test still owns every edge. Covers ratios up to 4x (0.25 scale).
// `uv` is three's screenUV: render-target space, origin top-left like textureLoad.
// IF Task 9's doorway parity shows bodies vanishing in a vertically mirrored band, the
// uv origin is flipped on this path; fix with `st.y = 1.0 - st.y` as post-sscs.ts does.
export const EARLYZ_SEED_WGSL = /* wgsl */ `fn earlyzSeedDepth(levelDepth: texture_depth_2d, uv: vec2<f32>, marchSize: vec2<f32>) -> f32 {
  let dims = vec2<f32>(textureDimensions(levelDepth, 0));
  let texel = floor(uv * marchSize);
  let k = dims / max(marchSize, vec2<f32>(1.0));
  let lo = vec2<i32>(floor(texel * k));
  let hi = vec2<i32>(ceil((texel + vec2<f32>(1.0)) * k)) - vec2<i32>(1);
  let maxI = vec2<i32>(dims) - vec2<i32>(1);
  var d = 0.0;
  for (var y = 0; y < 4; y++) {
    for (var x = 0; x < 4; x++) {
      let p = lo + vec2<i32>(x, y);
      if (p.x > hi.x || p.y > hi.y) { continue; }
      d = max(d, textureLoad(levelDepth, clamp(p, vec2<i32>(0), maxI), 0));
    }
  }
  return d;
}`;

/** CPU twin of the block maths: inclusive pixel range a march texel covers. */
export function seedBlock(
  texel: [number, number], marchSize: [number, number], dims: [number, number],
): { lo: [number, number]; hi: [number, number] } {
  const kx = dims[0] / Math.max(marchSize[0], 1), ky = dims[1] / Math.max(marchSize[1], 1);
  return {
    lo: [Math.floor(texel[0] * kx), Math.floor(texel[1] * ky)],
    hi: [Math.ceil((texel[0] + 1) * kx) - 1, Math.ceil((texel[1] + 1) * ky) - 1],
  };
}

/** CPU twin of the whole seed: farthest depth over the block (row-major `depth`). */
export function seedDepthCpu(
  depth: Float32Array, w: number, h: number, texel: [number, number], marchSize: [number, number],
): number {
  const { lo, hi } = seedBlock(texel, marchSize, [w, h]);
  let d = 0;
  for (let y = lo[1]; y <= Math.min(hi[1], lo[1] + 3); y++) {
    for (let x = lo[0]; x <= Math.min(hi[0], lo[0] + 3); x++) {
      const cx = Math.min(Math.max(x, 0), w - 1), cy = Math.min(Math.max(y, 0), h - 1);
      d = Math.max(d, depth[cy * w + cx]!);
    }
  }
  return d;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm test -- earlyz/seed-depth`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/earlyz/seed-depth.wgsl.ts src/lab/sdf-zombie/webgpu/earlyz/seed-depth.wgsl.test.ts
git commit -m "earlyz: level-depth seed WGSL + CPU twin (spec D6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: The three r186 patch and compile-based detection

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/earlyz/conservative-depth-patch.ts`
- Create: `src/lab/sdf-zombie/webgpu/earlyz/conservative-depth-material.ts`
- Test: `src/lab/sdf-zombie/webgpu/earlyz/conservative-depth-patch.test.ts`

Facts this relies on, all checked in three 0.186:
- `WGSLNodeBuilder.getFragDepth()` returns `'output.' + this.getBuiltin('frag_depth', 'depth', 'f32', 'output')`
  (`WGSLNodeBuilder.js:1648`).
- `getBuiltin` keys by name and stores it verbatim (`:1453`).
- `getBuiltins` prints `@builtin( ${name} ) ${property} : ${type}` (`:1777`).
- A material's own string property enters the render-object cache key (`RenderObject.js:743`).

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/earlyz/conservative-depth-patch.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { WGSLNodeBuilder } from 'three/webgpu';
import {
  installConservativeDepthPatch, conservativeDepthPatchHits, detectConservativeDepth,
  CONSERVATIVE_DEPTH_BUILTIN,
} from './conservative-depth-patch';
import { applyConservativeDepth } from './conservative-depth-material';

function fakeProto() {
  return {
    material: null as null | Record<string, unknown>,
    calls: [] as string[],
    getBuiltin(name: string, property: string) { this.calls.push(name); return property; },
    getFragDepth() { return 'output.' + this.getBuiltin('frag_depth', 'depth', 'f32', 'output'); },
  };
}

describe('conservative depth patch (spec §4 A)', () => {
  it('emits the greater builtin only for an opted-in material', () => {
    const p = fakeProto();
    expect(installConservativeDepthPatch(p as never, '186')).toEqual({ installed: true, reason: null });
    const before = conservativeDepthPatchHits();
    p.material = { conservativeDepth: 'greater' };
    expect(p.getFragDepth()).toBe('output.depth');
    expect(p.calls.at(-1)).toBe(CONSERVATIVE_DEPTH_BUILTIN);
    expect(conservativeDepthPatchHits()).toBe(before + 1);
    p.material = {};
    p.getFragDepth();
    expect(p.calls.at(-1)).toBe('frag_depth');
  });
  it('refuses any three revision but 186', () => {
    expect(installConservativeDepthPatch(fakeProto() as never, '187')).toEqual({
      installed: false, reason: 'three r187; the patch is written for r186',
    });
  });
  it('is idempotent', () => {
    const p = fakeProto();
    installConservativeDepthPatch(p as never, '186');
    installConservativeDepthPatch(p as never, '186');
    p.material = { conservativeDepth: 'greater' };
    p.getFragDepth();
    expect(p.calls.filter((c) => c === CONSERVATIVE_DEPTH_BUILTIN).length).toBe(1);
  });
  it('against the real r186 builder the struct member reads @builtin( frag_depth, greater )', () => {
    expect(THREE.REVISION).toBe('186');
    expect(installConservativeDepthPatch().installed).toBe(true);
    const b = Object.create(WGSLNodeBuilder.prototype) as {
      builtins: Record<string, Map<string, unknown>>; shaderStage: string; material: unknown;
      getFragDepth(): string; getBuiltins(stage: string): string;
    };
    b.builtins = {};
    b.shaderStage = 'fragment';
    b.material = { conservativeDepth: 'greater' };
    expect(b.getFragDepth()).toBe('output.depth');
    expect(b.getBuiltins('output')).toBe('@builtin( frag_depth, greater ) depth : f32');
  });
});

describe('applyConservativeDepth', () => {
  it('refuses a material without a depth node (the wrapped node is pinned by Task 7)', () => {
    expect(() => applyConservativeDepth(new THREE.MeshBasicNodeMaterial())).toThrow(/no depthNode/);
  });
});

function fakeDevice(o: { compileErr?: string; pipelineThrows?: string; scopeErr?: string }) {
  return {
    pushErrorScope() { /* scope opened */ },
    popErrorScope: async () => (o.scopeErr ? { message: o.scopeErr } : null),
    createShaderModule: () => ({
      getCompilationInfo: async () => ({ messages: o.compileErr ? [{ type: 'error', message: o.compileErr }] : [] }),
    }),
    createRenderPipelineAsync: async () => { if (o.pipelineThrows) throw new Error(o.pipelineThrows); return {}; },
  };
}

describe('detectConservativeDepth (spec D8)', () => {
  it('ok when the probe compiles and the pipeline builds', async () => {
    expect(await detectConservativeDepth(fakeDevice({}))).toEqual({ ok: true, reason: null });
  });
  it('reports a compile error', async () => {
    expect(await detectConservativeDepth(fakeDevice({ compileErr: 'unknown builtin' }))).toEqual({ ok: false, reason: 'compile: unknown builtin' });
  });
  it('reports a pipeline rejection', async () => {
    expect(await detectConservativeDepth(fakeDevice({ pipelineThrows: 'bad depth' }))).toEqual({ ok: false, reason: 'pipeline: bad depth' });
  });
  it('reports a validation-scope error', async () => {
    expect(await detectConservativeDepth(fakeDevice({ scopeErr: 'invalid' }))).toEqual({ ok: false, reason: 'validation: invalid' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- earlyz/conservative-depth-patch`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the patch module**

```ts
// src/lab/sdf-zombie/webgpu/earlyz/conservative-depth-patch.ts
//
// CONSERVATIVE DEPTH FOR THREE r186 (spec 2026-10-01 §4 A, D8). three emits every
// depthNode as plain `@builtin(frag_depth)`, which disables hardware early-Z. This
// wraps WGSLNodeBuilder.getFragDepth so a material that opts in with the OWN property
// `conservativeDepth = 'greater'` (own properties enter three's render-object cache key;
// userData does not) registers the builtin as 'frag_depth, greater'. getBuiltins prints
// the name verbatim. No `requires fragment_depth;`: three's fragment template has no
// directive slot and Chrome 154 accepts the qualifier without it (probe 2026-10-01).
// Installed only under ?earlyz=1, and only on the revision it was written against.
import { WGSLNodeBuilder, REVISION } from 'three/webgpu';

export const CONSERVATIVE_DEPTH_BUILTIN = 'frag_depth, greater';
export const PATCHED_THREE_REVISION = '186';

interface BuilderLike {
  material?: { conservativeDepth?: unknown } | null;
  getBuiltin(name: string, property: string, type: string, stage?: string): string;
  getFragDepth(): string;
  __earlyzPatched?: boolean;
}

let hits = 0;

export function installConservativeDepthPatch(
  proto: BuilderLike = WGSLNodeBuilder.prototype as unknown as BuilderLike,
  revision: string = REVISION,
): { installed: boolean; reason: string | null } {
  if (revision !== PATCHED_THREE_REVISION) {
    return { installed: false, reason: `three r${revision}; the patch is written for r${PATCHED_THREE_REVISION}` };
  }
  if (proto.__earlyzPatched) return { installed: true, reason: null };
  const original = proto.getFragDepth;
  proto.getFragDepth = function patchedGetFragDepth(this: BuilderLike): string {
    if (this.material?.conservativeDepth === 'greater') {
      hits++;
      return 'output.' + this.getBuiltin(CONSERVATIVE_DEPTH_BUILTIN, 'depth', 'f32', 'output');
    }
    return original.call(this);
  };
  proto.__earlyzPatched = true;
  return { installed: true, reason: null };
}

/** How many fragment shaders the patch has emitted `frag_depth, greater` into. */
export function conservativeDepthPatchHits(): number {
  return hits;
}

/** The exact syntax the patch emits, as a one-pipeline probe. */
export const EARLYZ_DETECT_WGSL = /* wgsl */ `@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  return vec4<f32>(0.0, 0.0, 0.5, 1.0);
}
struct EarlyzProbeOut { @location(0) c: vec4<f32>, @builtin(frag_depth, greater) d: f32 }
@fragment fn fs() -> EarlyzProbeOut {
  var o: EarlyzProbeOut;
  o.c = vec4<f32>(1.0);
  o.d = 0.75;
  return o;
}`;

interface DeviceLike {
  pushErrorScope(filter: 'validation'): void;
  popErrorScope(): Promise<{ message: string } | null>;
  createShaderModule(d: { code: string; label?: string }): {
    getCompilationInfo(): Promise<{ messages: readonly { type: string; message: string }[] }>;
  };
  createRenderPipelineAsync(d: unknown): Promise<unknown>;
}

/** D8: feature detection by COMPILING, not by wgslLanguageFeatures (Chrome 154 does
 *  not list `fragment_depth` but accepts the syntax). */
export async function detectConservativeDepth(device: DeviceLike): Promise<{ ok: boolean; reason: string | null }> {
  try {
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ code: EARLYZ_DETECT_WGSL, label: 'earlyz-detect' });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error');
    let pipelineError: string | null = null;
    if (errors.length === 0) {
      try {
        await device.createRenderPipelineAsync({
          label: 'earlyz-detect', layout: 'auto',
          vertex: { module, entryPoint: 'vs' },
          fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
        });
      } catch (e) {
        pipelineError = String((e as Error)?.message ?? e);
      }
    }
    const scoped = await device.popErrorScope();
    if (errors.length > 0) return { ok: false, reason: `compile: ${errors[0]!.message}` };
    if (pipelineError !== null) return { ok: false, reason: `pipeline: ${pipelineError}` };
    if (scoped) return { ok: false, reason: `validation: ${scoped.message}` };
    return { ok: true, reason: null };
  } catch (e) {
    return { ok: false, reason: `threw: ${String(e)}` };
  }
}
```

- [ ] **Step 4: Implement the material helper**

```ts
// src/lab/sdf-zombie/webgpu/earlyz/conservative-depth-material.ts
//
// D3: a `frag_depth, greater` shader PROMISES the written depth is at or beyond the
// fragment's raster depth; breaking it is undefined behaviour. The written depth is
// therefore max(marched, raster). `depth` is three's interpolated perspective depth of
// the FRONT face (ViewportDepthNode.DEPTH). The proxy box is padded by maxBlendK*4 + 5 cm
// per side, so a real hit sits centimetres behind it and the clamp bites only on rounding.
import { max, depth } from 'three/tsl';
import type { MeshBasicNodeMaterial } from 'three/webgpu';

export function applyConservativeDepth(material: MeshBasicNodeMaterial): void {
  if (material.depthNode == null) {
    throw new Error('[earlyz] applyConservativeDepth: material has no depthNode');
  }
  material.depthNode = max(material.depthNode as never, depth) as never;
  (material as unknown as { conservativeDepth: string }).conservativeDepth = 'greater';
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npm test -- earlyz/conservative-depth-patch`
Expected: PASS (9 tests). Then `npx tsc --noEmit`: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/earlyz/conservative-depth-patch.ts src/lab/sdf-zombie/webgpu/earlyz/conservative-depth-material.ts src/lab/sdf-zombie/webgpu/earlyz/conservative-depth-patch.test.ts
git commit -m "earlyz: per-material frag_depth greater patch for three r186 + compile detection (spec §4 A, D3, D8)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: The front-face crowd material

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (imports; `createCrowdMaterial` signature and body, ~line 1756)
- Test: `src/lab/sdf-zombie/webgpu/earlyz/front-material.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/lab/sdf-zombie/webgpu/earlyz/front-material.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createCrowdMaterial, defaultUniforms, blankFaceTexture } from '../zombie-gpu';
import { createCrowdRecords } from '../crowd-records';
import { createComputeTileBinding } from '../tile-bin-compute';

const renderer = { compute() { /* GPU dispatch stub, as crowd-type.test.ts */ } } as unknown as THREE.WebGPURenderer;
const make = (dispatch: 'boxes' | 'quad', earlyz?: { front: boolean }) => {
  const tex = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  const rec = createCrowdRecords();
  return createCrowdMaterial(
    tex, defaultUniforms(blankFaceTexture()),
    { inst: rec.node, instCfg: uniform(new THREE.Vector4(0, 1, 0, 0)) },
    createComputeTileBinding(renderer, 256, 256), undefined, dispatch, undefined, earlyz,
  ).material as THREE.MeshBasicNodeMaterial & { conservativeDepth?: string };
};

describe('front-face crowd material (spec D2-D4)', () => {
  it('the shipped call is unchanged: BackSide, no opt-in property', () => {
    const m = make('boxes');
    expect(m.side).toBe(THREE.BackSide);
    expect('conservativeDepth' in m).toBe(false);
  });
  it('earlyz front: FrontSide + conservativeDepth greater + a depth node', () => {
    const m = make('boxes', { front: true });
    expect(m.side).toBe(THREE.FrontSide);
    expect(m.conservativeDepth).toBe('greater');
    expect(m.depthNode).not.toBeNull();
    expect(m.depthWrite).toBe(true);
  });
  it('the quad dispatch never takes the front path', () => {
    const m = make('quad', { front: true });
    expect('conservativeDepth' in m).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- earlyz/front-material`
Expected: FAIL. The 8th argument is ignored, so the front case reads `BackSide`.

- [ ] **Step 3: Add the imports to `zombie-gpu.ts`**

After the existing `import { sdfSurfaceMarch, sdfSurfaceMrtNodes } from './deferred-sdf';` line add:

```ts
import { EARLYZ_BOX_EXIT_WGSL } from './earlyz/box-exit.wgsl';
import { applyConservativeDepth } from './earlyz/conservative-depth-material';
```

At module scope (next to `export const marchBurnRead = wgslFn(...)`, ~line 247) add:

```ts
/** EARLY-Z (spec 2026-10-01 D4): the analytic proxy exit the front material hands the march as worldPos. */
const earlyzBoxExitPoint = wgslFn(EARLYZ_BOX_EXIT_WGSL);
```

- [ ] **Step 4: Extend `createCrowdMaterial`**

Change the signature's tail from

```ts
  sharedLevelShadowTex?: ReturnType<typeof texture>,
): CrowdMaterialHandles {
  const quad = dispatch === 'quad';
```

to

```ts
  sharedLevelShadowTex?: ReturnType<typeof texture>,
  // EARLY-Z (spec 2026-10-01 D2-D4), POSITIONALLY LAST. `front: true` builds the
  // front-face, conservative-depth twin of the boxes material. Omitted: unchanged.
  earlyz?: { front: boolean },
): CrowdMaterialHandles {
  const quad = dispatch === 'quad';
  const earlyzFront = earlyz?.front === true && !quad;
```

After `const quadNodes = quad ? crowdRayNodes() : undefined;` add:

```ts
  // The march body is NOT edited: the override hands it the ANALYTIC box exit as
  // worldPos, so ray-window's tMaxBox = length(worldPos - camPos) is the exit the back
  // face used to give it (the hull-refine-view.ts pattern). startT 0 and the type's own
  // marchCfg are exactly what the boxes path passes when `rays` is undefined (no cone).
  const frontRays: MarchRayOverride | undefined = earlyzFront
    ? {
        worldPos: earlyzBoxExitPoint({
          camPos: cameraPosition,
          rd: normalize(sub(positionWorld, cameraPosition)),
          centre: instCentre,
          halfExt: instHalf,
        }),
        startT: float(0),
        marchCfg: u.marchCfg,
        side: THREE.FrontSide,
      }
    : undefined;
```

In the `createMarchMaterial(...)` call change the rays argument from

```ts
    quadNodes
      ? {
          worldPos: quadNodes.worldPos,
          rayDir: quadNodes.rayDir,
          startT: float(0),
          marchCfg: u.marchCfg,
          side: THREE.DoubleSide,
        }
      : undefined,
```

to

```ts
    quadNodes
      ? {
          worldPos: quadNodes.worldPos,
          rayDir: quadNodes.rayDir,
          startT: float(0),
          marchCfg: u.marchCfg,
          side: THREE.DoubleSide,
        }
      : frontRays,
```

After the `if (quad) { ... } else { material.positionNode = positionNode as never; }` block add:

```ts
  // D3: front material only. The clamp keeps the `greater` promise; the property is
  // what the r186 builder patch keys on (earlyz/conservative-depth-patch.ts).
  if (earlyzFront) applyConservativeDepth(material);
```

`MarchRayOverride` is declared in the same file (~line 1220), so no import is needed.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npm test -- earlyz/front-material march-golden crowd-type`
Expected: PASS. `march-golden` must be unchanged: nothing in the march text moved.
Then `npx tsc --noEmit`: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/zombie-gpu.ts src/lab/sdf-zombie/webgpu/earlyz/front-material.test.ts
git commit -m "earlyz: front-face conservative-depth crowd material via the rays override (spec D2-D4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Crowd type front/back batches

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/crowd-type.ts`
- Test: `src/lab/sdf-zombie/webgpu/crowd-type.test.ts` (append a `describe`)

- [ ] **Step 1: Write the failing test** (append to `crowd-type.test.ts`; it reuses the file's `stubView`/`groupFor`)

```ts
describe('crowd type early-Z batches (earlyz stage 1)', () => {
  const renderer = { compute() { /* GPU dispatch stub */ } } as unknown as THREE.WebGPURenderer;
  const grid = { tilesX: 16, tilesY: 16, tilePx: TILE_SIZE_PX };
  const cam = (z: number) => {
    const c = new THREE.PerspectiveCamera(90, 1, 0.01, 100);
    c.position.set(0, 0, z);
    c.updateMatrixWorld();
    c.matrixWorldInverse.copy(c.matrixWorld).invert();
    return c;
  };
  const slotOf = (m: THREE.Mesh, row: number) =>
    ((m.geometry as THREE.InstancedBufferGeometry).getAttribute('iSlot') as THREE.InterleavedBufferAttribute).getX(row);

  it('without the option: no front mesh, every instance in the shipped batch', () => {
    const t = createCrowdType(renderer, 'zombie', defaultUniforms(blankFaceTexture()), 256, 256);
    expect(t.frontMesh).toBeNull();
    t.attach(stubView(0, [groupFor(0)]));
    t.sync(cam(0), grid, new Set([0]));
    expect((t.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(1);
  });

  it('camera-inside instances stay in the back (shipped) batch; the rest draw front faces', () => {
    const t = createCrowdType(renderer, 'zombie', defaultUniforms(blankFaceTexture()), 256, 256, undefined, { earlyz: true });
    t.attach(stubView(0, [groupFor(0)])); // centre (0,0,-4), half (0.5,1,0.5)
    t.attach(stubView(1, [groupFor(1)])); // centre (1,0,-4)
    t.sync(cam(-4.2), grid, new Set([0, 1])); // inside slot 0's box, outside slot 1's (x 0 < 1 - 0.5 - 0.25)
    expect((t.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(1);
    expect((t.frontMesh!.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(1);
    expect(slotOf(t.mesh, 0)).toBe(0);
    expect(slotOf(t.frontMesh!, 0)).toBe(1);
    const b = t.earlyzBatches();
    expect(b.back).toBe(1);
    expect(b.front).toBe(1);
    expect(b.nearestBack).toBeCloseTo(0.2, 6);
    expect(b.nearestFront).toBeCloseTo(Math.hypot(1, 0.2), 6);
  });

  it('front material is FrontSide + greater; the back mesh keeps the shipped BackSide material', () => {
    const t = createCrowdType(renderer, 'zombie', defaultUniforms(blankFaceTexture()), 256, 256, undefined, { earlyz: true });
    expect((t.frontMesh!.material as THREE.Material).side).toBe(THREE.FrontSide);
    expect((t.frontMesh!.material as unknown as { conservativeDepth: string }).conservativeDepth).toBe('greater');
    expect((t.mesh.material as THREE.Material).side).toBe(THREE.BackSide);
  });

  it('the quad dispatch hides the front mesh and zeroes its batch', () => {
    const t = createCrowdType(renderer, 'zombie', defaultUniforms(blankFaceTexture()), 256, 256, undefined, { earlyz: true });
    t.attach(stubView(1, [groupFor(1)]));
    t.setDispatch('quad');
    t.sync(cam(0), grid, new Set([0]));
    expect(t.frontMesh!.visible).toBe(false);
    expect((t.frontMesh!.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- crowd-type`
Expected: FAIL, `t.frontMesh` is undefined (TypeScript also flags the unknown `earlyz` option).

- [ ] **Step 3: Implement in `crowd-type.ts`**

Imports, after the `import type { GameTelemetry } ...` line:

```ts
import { splitInstances } from './earlyz/batch-split';
```

Types, after `export interface InstanceAttrSource { ... }`:

```ts
/** EARLY-Z (spec 2026-10-01 D5): the last sync's two batches. Infinity = empty. */
export interface EarlyzBatches {
  front: number;
  back: number;
  nearestFront: number;
  nearestBack: number;
}

/** Distance to the first VISIBLE item; `items` keeps sync()'s nearest-first order. */
function nearestVisible(items: readonly InstanceAttrSource[], cam: THREE.Vector3): number {
  for (const i of items) {
    if (i.visible) return Math.hypot(i.centre[0]! - cam.x, i.centre[1]! - cam.y, i.centre[2]! - cam.z);
  }
  return Infinity;
}
```

`CrowdType` interface, after `readonly depthPreMesh: THREE.Mesh;`:

```ts
  /** EARLY-Z (spec 2026-10-01 D2/D5): the front-face, conservative-depth twin of
   *  `mesh`. null unless created with `opts.earlyz`. When it exists, `mesh` draws
   *  only the camera-inside instances (the shipped back-face material). */
  readonly frontMesh: THREE.Mesh | null;
  /** The last sync's batch counts and nearest distances (zeros/Infinity without earlyz). */
  earlyzBatches(): EarlyzBatches;
```

`createCrowdType` options type, after `stride?: number;`:

```ts
    /** EARLY-Z (spec 2026-10-01): build the front-face batch. Boxes dispatch only. */
    earlyz?: boolean;
```

After `geo.instanceCount = 0;` (the boxes geometry block) add:

```ts
  // EARLY-Z FRONT BATCH (spec D2/D5): its own instance buffer and the front material.
  // Shares the atlas, the records, instCfg, the tile binding and the level-shadow node,
  // so one sync() feeds both batches.
  const front = opts?.earlyz === true ? (() => {
    const fgeo = new THREE.InstancedBufferGeometry().copy(
      new THREE.BoxGeometry(2, 2, 2) as unknown as THREE.InstancedBufferGeometry,
    );
    const fib = new THREE.InstancedInterleavedBuffer(
      new Float32Array(MAX_CROWD_INSTANCES * INST_FLOATS), INST_FLOATS,
    );
    fib.setUsage(THREE.DynamicDrawUsage);
    fgeo.setAttribute('iCentre', new THREE.InterleavedBufferAttribute(fib, 3, 0));
    fgeo.setAttribute('iHalf', new THREE.InterleavedBufferAttribute(fib, 3, 3));
    fgeo.setAttribute('iSlot', new THREE.InterleavedBufferAttribute(fib, 1, 6));
    fgeo.instanceCount = 0;
    return { geo: fgeo, ib: fib, out: fib.array as Float32Array };
  })() : null;
```

After `const quadHandles = createCrowdMaterial(...)` add:

```ts
  const frontHandles = front ? createCrowdMaterial(
    atlas.texture, uniforms, { inst: records.node, instCfg }, tiles, sources, 'boxes',
    (handles.material as unknown as { levelShadowTex: ReturnType<typeof texture> }).levelShadowTex,
    { front: true },
  ) : null;
```

After `depthPreMesh.frustumCulled = false;` add:

```ts
  const frontMesh = front && frontHandles ? new THREE.Mesh(front.geo, frontHandles.material) : null;
  if (frontMesh) frontMesh.frustumCulled = false;
  let lastBatches: EarlyzBatches = { front: 0, back: 0, nearestFront: Infinity, nearestBack: Infinity };
```

In the returned object's first line, add `frontMesh` after `depthPreMesh`:

```ts
    name, atlas, records, uniforms, mesh, depthPreMesh, frontMesh, levelShadowTex, tiles, instCfg, quadRect,
```

In `sync()`, in the quad branch of the rect block, after `depthPreMesh.visible = true;` in the `if (rect)` arm and
after `depthPreMesh.visible = false;` in the `else` arm, add the same line to both arms:

```ts
          if (frontMesh) frontMesh.visible = false;
```

In the boxes `else` arm (where `mesh.visible = true; depthPreMesh.visible = true;`) add:

```ts
        if (frontMesh) frontMesh.visible = true;
```

Replace the BOX DISPATCH pack block

```ts
      if (dispatch === 'boxes') {
        const n = packInstanceAttrs(list, instOut);
        geo.instanceCount = n;
        ib.needsUpdate = true;
      } else {
        geo.instanceCount = 0;
      }
```

with

```ts
      if (dispatch === 'boxes' && front) {
        // EARLY-Z (spec D5): camera-inside instances keep the shipped back-face batch;
        // the rest draw front faces with conservative depth. Order is kept, so both
        // packs stay nearest-first.
        const split = splitInstances(list, [cam.x, cam.y, cam.z]);
        geo.instanceCount = packInstanceAttrs(split.back, instOut);
        front.geo.instanceCount = packInstanceAttrs(split.front, front.out);
        ib.needsUpdate = true;
        front.ib.needsUpdate = true;
        lastBatches = {
          back: geo.instanceCount, front: front.geo.instanceCount,
          nearestBack: nearestVisible(split.back, cam), nearestFront: nearestVisible(split.front, cam),
        };
      } else if (dispatch === 'boxes') {
        const n = packInstanceAttrs(list, instOut);
        geo.instanceCount = n;
        ib.needsUpdate = true;
      } else {
        geo.instanceCount = 0;
        if (front) {
          front.geo.instanceCount = 0;
          lastBatches = { front: 0, back: 0, nearestFront: Infinity, nearestBack: Infinity };
        }
      }
```

In `setSkeletonVolume`, after `quadHandles.setSkeletonVolume(atlasTex, meta);`:

```ts
      frontHandles?.setSkeletonVolume(atlasTex, meta);
```

In `setDispatch`, after `depthPreMesh.material = activeHandles().depthPreMaterial;`:

```ts
      if (frontMesh && front && mode === 'quad') {
        frontMesh.visible = false;
        front.geo.instanceCount = 0;
      }
```

Add the method next to `binInputs()`:

```ts
    earlyzBatches() { return { ...lastBatches }; },
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test -- crowd-type earlyz march-golden`
Expected: PASS, with the new `describe` at 4 tests and every older crowd-type test unchanged.
Then `npx tsc --noEmit`: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/crowd-type.ts src/lab/sdf-zombie/webgpu/crowd-type.test.ts
git commit -m "earlyz: crowd type front/back batches split on camera-inside (spec D5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: The level-depth seed pass in `sdf-layer.ts`

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/sdf-layer.ts`

There is no unit seam here (it needs a WebGPU target); Task 11's smoke and Task 12's parity verify it in the browser.

- [ ] **Step 1: Imports**

Change the TSL import line

```ts
import { wgslFn, texture, uv, vec4, uniform, mrt, output, cameraViewMatrix, mat3, mul, mix, perspectiveDepthToViewZ, smoothstep, float } from 'three/tsl';
```

to

```ts
import { wgslFn, texture, uv, vec4, uniform, mrt, output, cameraViewMatrix, mat3, mul, mix, perspectiveDepthToViewZ, smoothstep, float, screenUV, positionGeometry } from 'three/tsl';
```

and add after the `./upscale/upscale-model` import:

```ts
import { EARLYZ_SEED_WGSL, seedScaleSupported } from './earlyz/seed-depth.wgsl';
import { SEED_RENDER_ORDER } from './earlyz/type-order';
```

- [ ] **Step 2: Interface**

In the `SdfLayer` interface, after `setOutputTarget(t: THREE.RenderTarget | null): void;` add:

```ts
  /** EARLY-Z SEED (spec 2026-10-01 D6): adds the depth-only level-depth seed quad to
   *  `scene` once the post-aa capture depth exists. Never called with the flag off. */
  setEarlyzSeed(scene: THREE.Scene): void;
  /** Whether the seed drew on the last march, and why not when it did not. */
  earlyzSeedInfo(): { built: boolean; on: boolean; reason: string | null };
```

- [ ] **Step 3: State and builder**

Immediately after `let outputTarget: THREE.RenderTarget | null = null;` add:

```ts
  // ---- early-Z level-depth seed (spec 2026-10-01 D6) -----------------------
  // Built lazily the first time setEarlyzSeed has a scene AND the post-aa capture
  // target exists (FXAA on). Draws first in the march target (renderOrder), depth-only,
  // LessEqual against the clear, so repeating it in a later render of the same target
  // never overwrites a nearer body depth.
  let seedScene: THREE.Scene | null = null;
  let seed: {
    mesh: THREE.Mesh;
    tex: ReturnType<typeof texture>;
    marchSize: { value: THREE.Vector2 };
  } | null = null;
  let seedOnLast = false;
  let seedReasonLast: string | null = 'not requested';
  // Task 5 review (GPU-measured): the seed's 4x4 block cap is exact only when
  // seedScaleSupported() holds for (level depth size, march size). Cached by size.
  let seedScaleKey = '';
  let seedScaleOk = false;
  const seedFn = wgslFn(EARLYZ_SEED_WGSL);
  const ensureSeed = (): void => {
    if (seed || !seedScene) return;
    const depthTex = outputTarget?.depthTexture;
    if (!depthTex) return;
    const tex = texture(depthTex);
    const marchSize = uniform(new THREE.Vector2(1, 1));
    const mat = new MeshBasicNodeMaterial();
    mat.colorWrite = false;
    mat.depthTest = true;
    mat.depthWrite = true;
    mat.side = THREE.DoubleSide;
    mat.vertexNode = vec4(positionGeometry.x, positionGeometry.y, 0.5, 1.0) as never;
    mat.depthNode = seedFn({ levelDepth: tex, uv: screenUV, marchSize }) as never;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    mesh.name = 'earlyz-seed';
    mesh.frustumCulled = false;
    mesh.renderOrder = SEED_RENDER_ORDER;
    mesh.layers.set(SDF_LAYER);
    mesh.visible = false;
    seedScene.add(mesh);
    seed = { mesh, tex, marchSize: marchSize as unknown as { value: THREE.Vector2 } };
  };
  /** null = the seed may draw this frame; otherwise why it may not. */
  const seedBlockReason = (): string | null => {
    if (!seedScene) return 'not requested';
    if (!outputTarget?.depthTexture) return 'no sampleable level depth (post-aa capture off)';
    if (fieldStyle !== 'off') return `field style '${fieldStyle}'`;
    const scaleKey = `${outputTarget.width}x${outputTarget.height}/${target.width}x${target.height}`;
    if (scaleKey !== seedScaleKey) {
      seedScaleKey = scaleKey;
      seedScaleOk = seedScaleSupported([outputTarget.width, outputTarget.height], [target.width, target.height]);
    }
    if (!seedScaleOk) return `march ${target.width}x${target.height} over ${outputTarget.width}x${outputTarget.height}: seed block wider than 4 px`;
    if (target.textures.length !== 1) return 'march MRT boot';
    if (accumOn) return 'temporal accumulation (jittered march)';
    if (marchJitter) return 'capture jitter';
    return null;
  };
```

`target` (~line 1677), `fieldStyle` (~1531), `accumOn` (~1638) and `marchJitter` (~1654) are closure variables
declared above `outputTarget` (~2050), so the block can read them.

- [ ] **Step 4: Use it around the ship march**

In `render()`, find the march pass block that begins

```ts
      camera.layers.set(SDF_LAYER);
      setPassLabel('sdf:march');
      if (prevUniforms.enabled.value > 0.5 && bodies.length > 0) {
```

Insert before `if (prevUniforms.enabled.value > 0.5 && bodies.length > 0) {`:

```ts
      // EARLY-Z SEED (spec D6): drawn only in the single-render branches below. The
      // per-body front-to-back branch (ships off) clears and re-renders per body, and
      // is left exactly as it is.
      ensureSeed();
      seedReasonLast = seedBlockReason();
      if (seedReasonLast === null && prevUniforms.enabled.value > 0.5 && bodies.length > 0) {
        seedReasonLast = 'per-body depth-gate passes';
      }
      seedOnLast = seed !== null && seedReasonLast === null;
      if (seed) {
        seed.mesh.visible = seedOnLast;
        if (seedOnLast) {
          seed.tex.value = outputTarget!.depthTexture!;
          seed.marchSize.value.set(target.width, target.height);
        }
      }
```

After the whole `if (prevUniforms...) { ... } else if (chunkPass !== 'merged' && chunks.length > 0) { ... } else { ... }`
chain closes (just before the `// DISTANCE SPLIT FAR PASS` comment) add:

```ts
      if (seed) seed.mesh.visible = false;
```

- [ ] **Step 5: Precompile**

In `precompilePasses`, find `camera.layers.set(SDF_LAYER);` followed by `await compile('march', scene, camera, target, marchMrt);`.
Change it to:

```ts
        camera.layers.set(SDF_LAYER);
        ensureSeed();
        if (seed) seed.mesh.visible = true;
        await compile('march', scene, camera, target, marchMrt);
        if (seed) seed.mesh.visible = false;
```

- [ ] **Step 6: The two methods**

In the returned object, next to `setOutputTarget(t) { outputTarget = t; },` add:

```ts
    setEarlyzSeed(scene) { seedScene = scene; ensureSeed(); },
    earlyzSeedInfo() { return { built: seed !== null, on: seedOnLast, reason: seedReasonLast }; },
```

- [ ] **Step 7: Check that nothing moved with the flag off**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test -- march-golden crowd-type earlyz`
Expected: PASS.

Run: `bash -c 'export LAB_VITE_PORT=5323 LAB_CDP_PORT=9323 LAB_TMP=.lab-tmp; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/march-hash.mjs'`
Expected: the same PASS line as Task 0. `setEarlyzSeed` is never called with the flag off, so no mesh exists.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/sdf-layer.ts
git commit -m "earlyz: depth-only level-depth seed in the march target (spec D6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 10: Game wiring, `earlyzInfo` and `tunnelDefs`

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-state-crowd.ts`
- Create: `src/lab/sdf-zombie/webgpu/earlyz/earlyz-boot.ts`
- Create: `src/lab/sdf-zombie/webgpu/game-seams-earlyz.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-crowd-leaves.ts`, `src/lab/sdf-zombie/webgpu/game-main.ts`, `src/lab/sdf-zombie/webgpu/game-seams-world.ts`
- Test: `src/lab/sdf-zombie/webgpu/earlyz/earlyz-boot.test.ts`

- [ ] **Step 1: Crowd state**

In `game-state-crowd.ts`, before `export interface CrowdState {` add:

```ts
/** EARLY-Z state for the boot (spec 2026-10-01). All false/empty with the flag off. */
export interface EarlyzState {
  /** `?earlyz=1` was on the URL (compile-time, D1). */
  flag: boolean;
  /** The r186 patch installed AND the browser compiled `frag_depth, greater` (D8). */
  on: boolean;
  /** Why it is off; null when on or not requested. */
  reason: string | null;
  /** Uncaptured WebGPU errors seen since boot under the flag (first 20). */
  gpuErrors: string[];
}
```

Inside `CrowdState`, after `refineWarned`'s declaration, add:

```ts
  /** Early-Z (spec 2026-10-01): set once at boot by bootEarlyz. */
  earlyz: EarlyzState;
```

In `makeCrowdState()`, after `refineWarned: false,` add:

```ts
    earlyz: { flag: false, on: false, reason: null, gpuErrors: [] },
```

Run: `npm test -- game-context`
Expected: PASS. If a coverage test lists slice keys, add `earlyz` to that list in the same step.

- [ ] **Step 2: Write the failing glue test**

```ts
// src/lab/sdf-zombie/webgpu/earlyz/earlyz-boot.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { applyEarlyzRenderOrder } from './earlyz-boot';
import { BACK_BATCH_BASE, FRONT_BATCH_BASE } from './type-order';

const fake = (nearestBack: number, nearestFront: number, front = true) => ({
  mesh: new THREE.Mesh(),
  frontMesh: front ? new THREE.Mesh() : null,
  earlyzBatches: () => ({ front: 1, back: 1, nearestBack, nearestFront }),
});

describe('applyEarlyzRenderOrder', () => {
  it('writes the ranks onto the back and front meshes', () => {
    const a = fake(Infinity, 5), b = fake(0.3, 2);
    applyEarlyzRenderOrder(new Map([['a', a], ['b', b]]) as never);
    expect(b.mesh.renderOrder).toBe(BACK_BATCH_BASE);
    expect(b.frontMesh!.renderOrder).toBe(FRONT_BATCH_BASE);
    expect(a.frontMesh!.renderOrder).toBe(FRONT_BATCH_BASE + 1);
  });
});
```

Run: `npm test -- earlyz/earlyz-boot`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the glue**

```ts
// src/lab/sdf-zombie/webgpu/earlyz/earlyz-boot.ts
//
// EARLY-Z boot + per-frame glue (spec 2026-10-01). bootEarlyz runs right after the
// renderer exists and BEFORE any crowd material is built: install the r186 builder
// patch, then prove the browser compiles `frag_depth, greater` (D8). Failure leaves
// ctx.crowd.earlyz.on false and the boot is the shipped boot.
import type { GameContext } from '../game-context';
import type { CrowdType } from '../crowd-type';
import { installConservativeDepthPatch, detectConservativeDepth } from './conservative-depth-patch';
import { typeRenderOrder, type TypeDistance } from './type-order';

/** Structural slice of GPUDevice: tsconfig's lib does not promise the WebGPU types. */
type EarlyzDevice = Parameters<typeof detectConservativeDepth>[0] & {
  addEventListener(type: 'uncapturederror', f: (e: { error: { message: string } }) => void): void;
};

export async function bootEarlyz(ctx: GameContext): Promise<void> {
  const state = ctx.crowd.earlyz;
  state.flag = true;
  const patch = installConservativeDepthPatch();
  if (!patch.installed) {
    state.on = false;
    state.reason = patch.reason;
    console.warn(`[earlyz] off for this boot: ${patch.reason}`);
    return;
  }
  const device = (ctx.boot.handle.renderer.backend as unknown as { device?: EarlyzDevice }).device;
  if (!device) {
    state.on = false;
    state.reason = 'no GPUDevice on the renderer backend';
    console.warn(`[earlyz] off for this boot: ${state.reason}`);
    return;
  }
  device.addEventListener('uncapturederror', (e) => {
    if (state.gpuErrors.length < 20) state.gpuErrors.push(String(e.error.message));
  });
  const det = await detectConservativeDepth(device);
  state.on = det.ok;
  state.reason = det.reason;
  if (det.ok) console.info('[earlyz] on: front-face crowd proxies + frag_depth greater + level-depth seed');
  else console.warn(`[earlyz] off for this boot: ${det.reason}`);
}

type OrderedType = Pick<CrowdType, 'mesh' | 'frontMesh' | 'earlyzBatches'>;

/** D7 (amended): seed, then back batches, then front batches, each near-to-far. */
export function applyEarlyzRenderOrder(types: ReadonlyMap<string, OrderedType>): void {
  const rows: TypeDistance[] = [];
  for (const [key, t] of types) {
    const b = t.earlyzBatches();
    rows.push({ key, nearestBack: b.nearestBack, nearestFront: b.nearestFront });
  }
  const order = typeRenderOrder(rows);
  for (const [key, t] of types) {
    const o = order.get(key)!;
    t.mesh.renderOrder = o.back;
    if (t.frontMesh) t.frontMesh.renderOrder = o.front;
  }
}
```

Run: `npm test -- earlyz/earlyz-boot` and `npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 4: The `earlyzInfo` seam**

```ts
// src/lab/sdf-zombie/webgpu/game-seams-earlyz.ts
//
// EARLY-Z console/capture seam (spec 2026-10-01): plain data only.
import type { GameContext } from './game-context';
import { conservativeDepthPatchHits } from './earlyz/conservative-depth-patch';

export function createEarlyzSeams(ctx: GameContext) {
  return {
    earlyzInfo() {
      const batches: Record<string, { front: number; back: number }> = {};
      for (const [key, t] of ctx.crowd.types) {
        const b = t.earlyzBatches();
        batches[key] = { front: b.front, back: b.back };
      }
      return {
        ...ctx.crowd.earlyz,
        gpuErrors: [...ctx.crowd.earlyz.gpuErrors],
        patchHits: conservativeDepthPatchHits(),
        seed: ctx.render.sdfLayer.earlyzSeedInfo(),
        batches,
      };
    },
  };
}
```

- [ ] **Step 5: Wire `game-main.ts`** (anchors are exact strings; line numbers drift)

5a. Imports, next to `import { createMarchDebugSeams } from './game-seams-march-debug';`:

```ts
import { createEarlyzSeams } from './game-seams-earlyz';
import { EARLYZ_FLAG } from './earlyz/flag';
import { bootEarlyz, applyEarlyzRenderOrder } from './earlyz/earlyz-boot';
```

5b. After `ctx.boot.handle = await createLabRenderer(ctx.boot.mount, RES_RUNGS[ctx.boot.resKey]);` add:

```ts
  // EARLY-Z (spec 2026-10-01): patch + detect BEFORE any crowd material is built.
  // Flag off: nothing runs; the boot is byte-for-byte the shipped boot.
  if (EARLYZ_FLAG) await bootEarlyz(ctx);
```

5c. After the line that begins `ctx.render.sdfLayer = createSdfLayer(ctx.boot.handle.renderer,` add:

```ts
  if (ctx.crowd.earlyz.on) ctx.render.sdfLayer.setEarlyzSeed(ctx.boot.handle.scene);
```

5d. In `compileCrowdInBackground`, replace the loop body

```ts
    for (const t of ctx.crowd.types.values()) {
      t.mesh.visible = true;
      const p = ctx.render.sdfLayer.precompileInBackground(
        t.mesh, scene, camera, { timeoutMs: PRECOMPILE_COLD_PASS_TIMEOUT_MS },
      );
      // The prologue (which projects the object into the render context) has
      // already run synchronously; visibility no longer matters, and keeping it
      // hidden is what lets the live draw skip the pending pipeline safely.
      t.mesh.visible = false;
      const r = await p;
      ok = ok && r;
      if (!ok) break;
    }
```

with

```ts
    for (const t of ctx.crowd.types.values()) {
      // EARLY-Z: the front-face twin is a second program per type; it compiles in the
      // same job so the crowd stays on the fallback until BOTH are ready.
      for (const m of [t.mesh, t.frontMesh]) {
        if (!m) continue;
        m.visible = true;
        const p = ctx.render.sdfLayer.precompileInBackground(
          m, scene, camera, { timeoutMs: PRECOMPILE_COLD_PASS_TIMEOUT_MS },
        );
        // The prologue (which projects the object into the render context) has
        // already run synchronously; visibility no longer matters, and keeping it
        // hidden is what lets the live draw skip the pending pipeline safely.
        m.visible = false;
        const r = await p;
        ok = ok && r;
        if (!ok) break;
      }
      if (!ok) break;
    }
```

5e. Replace

```ts
        for (const t of ctx.crowd.types.values()) { t.mesh.visible = false; t.depthPreMesh.visible = false; }
```

with

```ts
        for (const t of ctx.crowd.types.values()) {
          t.mesh.visible = false; t.depthPreMesh.visible = false;
          if (t.frontMesh) t.frontMesh.visible = false;
        }
```

5f. After `ctx.telemetry.telemetry.end('crowd-sync', crowdTiming);` add:

```ts
      if (ctx.crowd.earlyz.on) applyEarlyzRenderOrder(ctx.crowd.types);
```

5g. In the seams list, after `createMarchDebugSeams(ctx),` add:

```ts
    createEarlyzSeams(ctx),
```

- [ ] **Step 6: `game-crowd-leaves.ts`**

In `crowdTypeFor`'s `createCrowdType(...)` options object, change

```ts
    { dispatch: ctx.crowd.dispatch, telemetry: ctx.telemetry.telemetry, stride },
```

to

```ts
    { dispatch: ctx.crowd.dispatch, telemetry: ctx.telemetry.telemetry, stride, earlyz: ctx.crowd.earlyz.on },
```

After `ctx.boot.deferredApi?.router.register(t.depthPreMesh, 'exclude');` add:

```ts
  if (t.frontMesh) {
    t.frontMesh.layers.set(SDF_LAYER);
    ctx.boot.handle.scene.add(t.frontMesh);
    ctx.boot.deferredApi?.router.register(t.frontMesh, 'sdf');
  }
```

- [ ] **Step 7: `tunnelDefs` seam** (for the doorway scene)

In `game-seams-world.ts`, after `tunnels: ctx.world.level.tunnels.map(t => t.name),` add:

```ts
    /** Tunnel rects + axis (early-Z doorway scene, 2026-10-01). */
    tunnelDefs: ctx.world.level.tunnels.map(t => ({
      name: t.name, a: t.a, b: t.b, minX: t.minX, maxX: t.maxX, minZ: t.minZ, maxZ: t.maxZ, axis: t.axis,
    })),
```

- [ ] **Step 8: Gates**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test -- earlyz crowd-type march-golden game-context`
Expected: PASS.

Run: `bash -c 'export LAB_VITE_PORT=5323 LAB_CDP_PORT=9323 LAB_TMP=.lab-tmp; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/march-hash.mjs'`
Expected: unchanged PASS line.

- [ ] **Step 9: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-state-crowd.ts src/lab/sdf-zombie/webgpu/earlyz/earlyz-boot.ts src/lab/sdf-zombie/webgpu/earlyz/earlyz-boot.test.ts src/lab/sdf-zombie/webgpu/game-seams-earlyz.ts src/lab/sdf-zombie/webgpu/game-crowd-leaves.ts src/lab/sdf-zombie/webgpu/game-main.ts src/lab/sdf-zombie/webgpu/game-seams-world.ts
git commit -m "earlyz: boot detection, crowd wiring, render order, earlyzInfo + tunnelDefs seams

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11: Browser smoke under the flag

**Files:**
- Create: `scripts/lib/earlyz-scenes.mjs`, `scripts/earlyz-run.sh`, `scripts/earlyz-smoke.mjs`
- Notes: append to `docs/dev-notes/2026-10-01-earlyz-stage-1/NOTES.md`

- [ ] **Step 1: Shared scenes**

```js
// scripts/lib/earlyz-scenes.mjs — staging shared by earlyz-smoke, earlyz-parity and the bench's
// BENCH_SCENE=doorway (plan 2026-10-01). Each prelude is an in-page JS string; evaluate() runs it.
import { stageCloseUp } from './sdf-closeup-stage.mjs';

/** Player in room 1, 2.5 m back from the mouth of the first tunnel that touches room 1,
 *  1.2 m off its centre line, looking at the mouth; `n` zombies in the far room. Part of
 *  the far room is behind the wall beside the opening: that is the level-occlusion case. */
export function doorwayPrelude(n, spacing = 0.9) {
  return `(() => {
    const t = __sdfGame.tunnelDefs.find(x => x.a === 1 || x.b === 1);
    if (!t) throw new Error('doorway: no tunnel touches room 1');
    const farId = t.a === 1 ? t.b : t.a;
    const r1 = __sdfGame.rooms.find(x => x.id === 1).bounds;
    const rf = __sdfGame.rooms.find(x => x.id === farId).bounds;
    const c1 = [(r1.minX + r1.maxX) / 2, (r1.minZ + r1.maxZ) / 2];
    const cf = [(rf.minX + rf.maxX) / 2, (rf.minZ + rf.maxZ) / 2];
    const tc = [(t.minX + t.maxX) / 2, (t.minZ + t.maxZ) / 2];
    let px, pz;
    if (t.axis === 'x') { const s = Math.sign(cf[0] - c1[0]); px = (s > 0 ? r1.maxX : r1.minX) - s * 2.5; pz = tc[1] + 1.2; }
    else { const s = Math.sign(cf[1] - c1[1]); pz = (s > 0 ? r1.maxZ : r1.minZ) - s * 2.5; px = tc[0] + 1.2; }
    const yaw = Math.atan2(tc[0] - px, -(tc[1] - pz));
    __sdfGame.teleport(1);
    __sdfGame.placePlayer({ x: px, z: pz, yaw, pitch: 0 });
    __sdfGame.freeze(true);
    const region = { minX: rf.minX + 0.5, maxX: rf.maxX - 0.5, minZ: rf.minZ + 0.5, maxZ: rf.maxZ - 0.5 };
    const r = __sdfGame.spawnCrowd('zombie', ${n}, { spacing: ${spacing}, region });
    return { tunnel: t.name, farId, player: [px, pz], spawned: r.ok };
  })()`;
}

/** Room-1 near corner looking down the diagonal (the bench's distance scene). */
export function cornerPrelude(n, region) {
  return `(() => {
    const b = __sdfGame.rooms.find(x => x.id === 1).bounds;
    const px = b.minX + 0.6, pz = b.minZ + 0.6;
    const yaw = Math.atan2(b.maxX - px, -(b.maxZ - pz));
    __sdfGame.teleport(1);
    __sdfGame.placePlayer({ x: px, z: pz, yaw, pitch: 0 });
    __sdfGame.freeze(true);
    const R = ${region};
    const r = __sdfGame.spawnCrowd('zombie', ${n}, { spacing: 0.7, region: R(b) });
    return { spawned: r.ok };
  })()`;
}

/** Run a prelude and bring its result back as plain data whatever evaluate()'s return mode is. */
const json = async (ev, prelude) => JSON.parse(await ev(`JSON.stringify(${prelude})`));

export const STAGES = {
  /** 6 bodies packed 0.7 m apart, ~3 m ahead: body-behind-body. */
  pack: { query: '', stage: (ev) => json(ev, cornerPrelude(6, '(b) => ({ minX: b.minX + 2.2, maxX: b.minX + 3.6, minZ: b.minZ + 2.2, maxZ: b.minZ + 3.6 })')) },
  /** 16 bodies in the far half: the distance crowd. */
  far: { query: '', stage: (ev) => json(ev, cornerPrelude(16, '(b) => ({ minX: (b.minX + b.maxX) / 2, maxX: b.maxX - 0.5, minZ: b.minZ + 0.5, maxZ: b.maxZ - 0.5 })')) },
  /** Ring testbed doorway: body-behind-wall. */
  doorway: { query: '', stage: (ev) => json(ev, doorwayPrelude(12)) },
  /** Night Train guards-van -> third-class door. */
  'train-doorway': { query: 'level=night-train', stage: (ev) => json(ev, doorwayPrelude(12)) },
  /** Melee range: the camera inside the proxy box (back batch). */
  melee: { query: '', stage: (ev) => stageCloseUp(ev, { room: 1, ladder: [0.4], settleTries: 2400 }) },
};
```

- [ ] **Step 2: Runner**

```bash
#!/usr/bin/env bash
# scripts/earlyz-run.sh <smoke|parity> [args...] — owns its own vite + headless Chrome.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WHAT="${1:?usage: scripts/earlyz-run.sh <smoke|parity> [args]}"; shift
export LAB_VITE_PORT="${LAB_VITE_PORT:-5401}" LAB_CDP_PORT="${LAB_CDP_PORT:-9401}"
export LAB_TMP="${LAB_TMP:-.lab-tmp}"
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node "scripts/earlyz-$WHAT.mjs" "$LAB_VITE_PORT" "$LAB_CDP_PORT" "$@"
```

Run: `chmod +x scripts/earlyz-run.sh`

- [ ] **Step 3: Smoke script**

```js
// scripts/earlyz-smoke.mjs — early-Z stage 1 boot smoke (plan 2026-10-01 Task 11). NOT a perf gate.
// Usage: scripts/earlyz-run.sh smoke
import { connectGame, bootCloseupPage, applyShipDefaults, sleep, failHard as fail } from './lib/sdf-closeup-stage.mjs';
import { STAGES } from './lib/earlyz-scenes.mjs';

const [, , VITE, CDP] = process.argv;
const { send, evaluate } = await connectGame({ vite: Number(VITE), cdp: Number(CDP), width: 1280, height: 800 });
await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?frozen=1&earlyz=1` });
for (let i = 0; ; i++) {
  const s = JSON.parse(await evaluate(`JSON.stringify({ gate: window.__warmGate?.phase ?? null, bg: __sdfGame.warmBackground?.() ?? null })`));
  if (s.gate === 'ready' && s.bg?.crowd === 'ready') break;
  if (s.bg?.crowd === 'failed') fail('crowd warm job failed under ?earlyz=1');
  if (i > 1440) fail(`not ready after 12 min: ${JSON.stringify(s)}`); // first boot pays the cold march compile
  await sleep(500);
}
await applyShipDefaults(evaluate);
console.log('staged', JSON.stringify(await STAGES.pack.stage(evaluate)));
await evaluate('(() => { __sdfGame.step(6); return 1; })()');
await sleep(300);
const info = JSON.parse(await evaluate('JSON.stringify(__sdfGame.earlyzInfo())'));
console.log('earlyzInfo', JSON.stringify(info));
const checks = [
  ['flag on', info.flag === true],
  ['patched + detected', info.on === true],
  ['patch emitted frag_depth greater', info.patchHits > 0],
  ['seed drew', info.seed.on === true],
  ['a front batch drew', Object.values(info.batches).some((b) => b.front > 0)],
  ['no uncaptured GPU errors', info.gpuErrors.length === 0],
];
let bad = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) bad++; }
process.exit(bad ? 1 : 0);
```

- [ ] **Step 4: Run it**

Run: `scripts/earlyz-run.sh smoke`
Expected: six `PASS` lines, exit 0. The first run after Task 7 pays a cold compile for the new front program (minutes
are possible; the 12-minute bound covers it).
- If `seed drew` fails, read `info.seed.reason`.
- If `a front batch drew` fails with every body in `back`, print `__sdfGame.crowdInfo()` and the camera position; the
  guard or the box half extents are wrong.

- [ ] **Step 5: Notes + commit**

Append the `earlyzInfo` line and the six results to the notes under `## Smoke (Task 11)`.

```bash
git add scripts/lib/earlyz-scenes.mjs scripts/earlyz-run.sh scripts/earlyz-smoke.mjs docs/dev-notes/2026-10-01-earlyz-stage-1/NOTES.md
git commit -m "earlyz: boot smoke + shared staging (pack, far, doorway, train-doorway, melee)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 12: Parity and the owner look sheet

**Files:**
- Create: `scripts/earlyz-parity.mjs`
- Notes: append; images under `docs/dev-notes/2026-10-01-earlyz-stage-1/look/`

- [ ] **Step 1: Parity script**

```js
// scripts/earlyz-parity.mjs — early-Z stage 1 parity + owner look sheet (plan 2026-10-01 Task 12).
// Per scene: boot flag OFF, stage, capture; boot flag ON, same stage, capture; diff the
// presented frames. Plus one OFF-vs-OFF pair (pack) as the determinism noise floor.
// Usage: scripts/earlyz-run.sh parity [outDir]   (EARLYZ_SCENES=pack,doorway to subset)
import { writeFileSync, mkdirSync } from 'node:fs';
import { connectGame, bootCloseupPage, applyShipDefaults, sleep, failHard as fail } from './lib/sdf-closeup-stage.mjs';
import { decodePng } from './lib/demo-presented.mjs';
import { writePng } from './lib/png-write.mjs';
import { STAGES } from './lib/earlyz-scenes.mjs';

const [, , VITE, CDP, OUT = 'docs/dev-notes/2026-10-01-earlyz-stage-1/look'] = process.argv;
mkdirSync(OUT, { recursive: true });
const SCENES = (process.env.EARLYZ_SCENES ?? 'pack,doorway,train-doorway,melee,far').split(',');
const DIFF_LEVEL = 8;
const { send, evaluate } = await connectGame({ vite: Number(VITE), cdp: Number(CDP), width: 1280, height: 800 });

async function waitReady() {
  for (let i = 0; ; i++) {
    const s = JSON.parse(await evaluate(`JSON.stringify({ gate: window.__warmGate?.phase ?? null, bg: __sdfGame.warmBackground?.() ?? null })`));
    if (s.gate === 'ready' && s.bg?.crowd === 'ready') return;
    if (s.bg?.crowd === 'failed') fail('crowd warm job failed');
    if (i > 1440) fail(`not ready: ${JSON.stringify(s)}`);
    await sleep(500);
  }
}

async function capture(scene, flagOn) {
  const s = STAGES[scene];
  const q = ['frozen=1', 'vhs=off', 'seed=20260918', s.query, flagOn ? 'earlyz=1' : ''].filter(Boolean).join('&');
  await bootCloseupPage({ send, evaluate, url: `http://localhost:${VITE}/sdf-game.html?${q}` });
  await waitReady();
  await applyShipDefaults(evaluate);
  const staged = await s.stage(evaluate);
  await evaluate('(() => { __sdfGame.step(6); return 1; })()');
  await sleep(300);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const info = flagOn ? JSON.parse(await evaluate('JSON.stringify(__sdfGame.earlyzInfo())')) : null;
  return { img: decodePng(Buffer.from(shot.result.data, 'base64')), staged, info };
}

function diff(a, b) {
  if (a.w !== b.w || a.h !== b.h) fail(`size mismatch ${a.w}x${a.h} vs ${b.w}x${b.h}`);
  const { w, h } = a;
  const out = new Uint8Array(w * h * 4);
  let px = 0, max = 0;
  for (let i = 0; i < w * h; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.data[i * a.ch + c] - b.data[i * b.ch + c]));
    if (d > DIFF_LEVEL) px++;
    if (d > max) max = d;
    const g = a.data[i * a.ch] >> 2;
    out.set(d > DIFF_LEVEL ? [255, 0, 0, 255] : [g, g, g, 255], i * 4);
  }
  return { px, frac: px / (w * h), max, image: out };
}

function sheet(a, b, d) {
  const { w, h } = a;
  const out = new Uint8Array(w * 3 * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (const [k, src, ch] of [[0, a.data, a.ch], [1, b.data, b.ch]]) {
        const s = (y * w + x) * ch, o = (y * w * 3 + k * w + x) * 4;
        out[o] = src[s]; out[o + 1] = src[s + 1]; out[o + 2] = src[s + 2]; out[o + 3] = 255;
      }
      const s = (y * w + x) * 4, o = (y * w * 3 + 2 * w + x) * 4;
      out.set(d.image.subarray(s, s + 4), o);
    }
  }
  return writePng(w * 3, h, out);
}

const report = { diffLevel: DIFF_LEVEL, scenes: {} };
{
  const a = await capture('pack', false), b = await capture('pack', false);
  const d = diff(a.img, b.img);
  report.noiseFloor = { px: d.px, frac: d.frac, max: d.max };
  console.log('noise floor (pack off vs off)', JSON.stringify(report.noiseFloor));
}
for (const scene of SCENES) {
  const off = await capture(scene, false);
  const on = await capture(scene, true);
  const d = diff(off.img, on.img);
  writeFileSync(`${OUT}/${scene}-off-on-diff.png`, sheet(off.img, on.img, d));
  report.scenes[scene] = { px: d.px, frac: d.frac, max: d.max, staged: on.staged, earlyz: on.info };
  console.log(scene.padEnd(14), 'diff px', d.px, `(${(d.frac * 100).toFixed(3)} %)`, 'max', d.max,
    'seed', on.info?.seed?.on, on.info?.seed?.reason ?? '', 'batches', JSON.stringify(on.info?.batches));
}
writeFileSync(`${OUT}/parity.json`, JSON.stringify(report, null, 2));
// Gate: every scene but the two doorways within 2x the noise floor (min 0.1 % of pixels).
// The doorways are REPORTED, not gated: the upscaler edge fringe is the owner's look call (spec §7).
const floor = Math.max(2 * report.noiseFloor.px, 0.001 * 1280 * 800);
let bad = 0;
for (const [scene, r] of Object.entries(report.scenes)) {
  const gated = !scene.includes('doorway');
  const ok = !gated || r.px <= floor;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${scene}${gated ? '' : ' (reported only)'}  ${r.px} px vs floor ${floor}`);
  if (!ok) bad++;
}
process.exit(bad ? 1 : 0);
```

- [ ] **Step 2: Run it and LOOK at every sheet**

Run: `scripts/earlyz-run.sh parity`
Expected:
- `PASS` for `pack`, `melee` and `far`.
- Both doorway scenes reported, with their diff pixels confined to occlusion edges.

Open each `look/*-off-on-diff.png` (off | on | red diff) and check:
- Red only along wall/door edges in the doorway scenes. Any red inside the open doorway or on a fully visible body
  is a bug.
- A vertically mirrored band of missing bodies means the seed's uv is flipped. Apply the fix noted in
  `seed-depth.wgsl.ts` and re-run.
- `melee`: `batches` shows the near body in `back`.

- [ ] **Step 3: Notes + commit**

Append under `## Parity and look (Task 12)`: the noise floor, the per-scene table (px, %, max, seed on/reason,
batches) and a sentence per sheet saying what you saw.

```bash
git add scripts/earlyz-parity.mjs docs/dev-notes/2026-10-01-earlyz-stage-1/
git commit -m "earlyz: flag off/on parity + owner look sheets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 13: Bench legs, the doorway scene and the cost run

**Files:**
- Modify: `scripts/sdf-game-bench.mjs`
- Notes: append

- [ ] **Step 1: Per-leg query**

Import (after the `census-diff.mjs` import):

```js
import { doorwayPrelude } from './lib/earlyz-scenes.mjs';
```

Replace `legUrl`:

```js
function legUrl(name) {
  const leg = LEGS[name] ?? ALL_LEGS[name] ?? {};
  let u = leg.setCrowd === undefined ? url : `${url}&crowd=${leg.setCrowd ? 1 : 0}`;
  // `_query` (early-Z, 2026-10-01): a COMPILE-TIME page flag the leg needs at boot.
  // Underscore keys are never called as __sdfGame setters (applyLeg skips them).
  if (leg._query) u += `&${leg._query}`;
  return u;
}
```

In `applyLeg`'s override loop, make the first line of the loop body:

```js
    if (fn.startsWith('_')) continue;
```

- [ ] **Step 2: Legs**

In `ALL_LEGS`, after `'upscale-ship'` add:

```js
  // EARLY-Z stage 1 (plan 2026-10-01). `earlyz` runs the harness's pinned native/field
  // state (seed OFF there: field style), so it measures body-behind-body only; its control
  // is `baseline`. `earlyz-upscale-ship` is the shipped upscaler boot with the seed ON;
  // its control is `upscale-ship`.
  earlyz: { _query: 'earlyz=1' },
  'earlyz-upscale-ship': { _query: 'earlyz=1', setUpscale: { trained: 't16-rgb-v32' }, setUpscaleSharpen: 0.5 },
```

- [ ] **Step 2b: Log `earlyzInfo` per leg**

In `applyLeg`, right after the line

```js
  console.log(`  [${name}] upscaleInfo().on=${JSON.parse(infoNote).up} refineInfo().on=${JSON.parse(infoNote).refine}`);
```

add

```js
  if (String((LEGS[name] ?? ALL_LEGS[name] ?? {})._query ?? '').includes('earlyz=1')) {
    console.log(`  [${name}] earlyzInfo=${await evaluate('JSON.stringify(__sdfGame.earlyzInfo ? __sdfGame.earlyzInfo() : null)')}`);
  }
```

- [ ] **Step 3: The doorway scene**

Replace

```js
const CROWD_PRELUDE = CROWD > 0
  ? (SCENE === 'distance'
    ? buildDistancePrelude()
    : `__sdfGame.spawnCrowd('zombie', ${CROWD}, { spacing: ${CROWD_SPACING} })`)
  : '';
```

with

```js
const CROWD_PRELUDE = CROWD > 0
  ? (SCENE === 'distance'
    ? buildDistancePrelude()
    : SCENE === 'doorway'
      // Early-Z (2026-10-01): through the first tunnel touching room 1; with
      // BENCH_QUERY=level=night-train that is the guards-van -> third-class door.
      ? doorwayPrelude(CROWD)
      : `__sdfGame.spawnCrowd('zombie', ${CROWD}, { spacing: ${CROWD_SPACING} })`)
  : '';
```

- [ ] **Step 4: Check the harness still parses**

Run: `node --check scripts/sdf-game-bench.mjs`
Expected: no output (exit 0).

- [ ] **Step 5: The cost run** (quiet machine: record `uptime` before each; reject a run whose load is above 4)

Run each line below on its own. `scripts/sdf-game-bench.sh` owns the vite + Chrome lifecycle (the `.mjs` alone
expects servers already up); environment variables pass through.

```bash
BENCH_LEGS=upscale-ship,earlyz-upscale-ship BENCH_PASSES=1 BENCH_REPEATS=3 scripts/sdf-game-bench.sh
```

```bash
BENCH_LEGS=upscale-ship,earlyz-upscale-ship BENCH_PASSES=1 BENCH_REPEATS=3 BENCH_CROWD=12 BENCH_SCENE=doorway scripts/sdf-game-bench.sh
```

```bash
BENCH_LEGS=upscale-ship,earlyz-upscale-ship BENCH_PASSES=1 BENCH_REPEATS=3 BENCH_CROWD=12 BENCH_SCENE=doorway BENCH_QUERY=level=night-train scripts/sdf-game-bench.sh
```

```bash
BENCH_LEGS=upscale-ship,earlyz-upscale-ship BENCH_PASSES=1 BENCH_REPEATS=3 BENCH_CROWD=16 scripts/sdf-game-bench.sh
```

```bash
BENCH_LEGS=upscale-ship,earlyz-upscale-ship BENCH_PASSES=1 BENCH_REPEATS=3 BENCH_CROWD=16 BENCH_SCENE=distance scripts/sdf-game-bench.sh
```

```bash
BENCH_DEMO=docs/dev-notes/demos/2026-09-14T21-02-05-669Z-room1.dem.json BENCH_LEGS=upscale-ship,earlyz-upscale-ship BENCH_PASSES=1 BENCH_REPEATS=3 scripts/sdf-game-bench.sh
```

```bash
BENCH_LEGS=baseline,earlyz BENCH_PASSES=1 BENCH_REPEATS=3 BENCH_CROWD=16 scripts/sdf-game-bench.sh
```

If the harness's flags differ from these (`BENCH_REPEATS`, `BENCH_DEMO` path), read its header block. Keep the
legs, scenes and controls exactly as listed.

Expected: each run writes its passes report (`passes.md` / `passes.json` in the harness's output dir). Record for
each scene:
- `sdf:march` p50 and fenced frame p50, control vs earlyz, and the delta;
- the leg's `earlyzInfo`, logged by the line Step 2b adds.

- [ ] **Step 6: Notes + commit**

Append under `## Cost (Task 13)`: one table, scene × {control, earlyz, Δ} for `sdf:march` and frame p50, with the
`uptime` load of each run.

```bash
git add scripts/sdf-game-bench.mjs docs/dev-notes/2026-10-01-earlyz-stage-1/NOTES.md
git commit -m "earlyz: bench legs (per-leg compile-time query), doorway scene, stage-1 cost run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 14: Boot time, flag-off gates, verdict and the task board

**Files:**
- Notes: append; modify `docs/tasks/rendering.md` and `TASKS.md`

- [ ] **Step 1: Cold boot, flag off vs on** (twice each, fresh profile per run, as `boot-time.mjs` does itself)

```bash
node scripts/boot-time.mjs 5391 9391 'seed=20260918'
```

```bash
node scripts/boot-time.mjs 5391 9391 'seed=20260918&earlyz=1'
```

Expected: flag-off `drawOnce` within run-to-run noise of the base branch. Flag-on `warmMs` may rise (one more march
program per crowd type, compiled in the background job). Record all four lines.

- [ ] **Step 2: Flag-off gates, final**

Run: `npm test -- march-golden crowd-type earlyz game-context` then `bash -c 'export LAB_VITE_PORT=5323 LAB_CDP_PORT=9323 LAB_TMP=.lab-tmp; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/march-hash.mjs'`
Expected: PASS; the hash line identical to Task 0.

- [ ] **Step 3: Verdict against spec §8**

Write `## Verdict` in the notes. Answer each criterion with its number:
- parity (only the edge fringe);
- `sdf:march` ≥ 1 ms p50 better on at least one ordinary scene (a room recording or a doorway), no regression above
  noise elsewhere;
- no melee hitch (`melee` look + bench);
- cold-compile increase recorded.

Then the stage-2 gate. Only if stage 1 holds AND the passes report shows the remaining cost is empty-box pixels or
`sdf:shell-hull` (~3.7 ms), write "stage 2 (built-once hull): OPEN, needs the occupancy reader fix first
(PASSOFF-2 §2.1)". Otherwise write "stage 2: NOT OPENED" with the reason.

- [ ] **Step 4: Task board**

In `docs/tasks/rendering.md`, add at the top (newest-first):

```markdown
## Early-Z for the SDF march (conservative depth), stage 1 — <status> <date>

- [x] Spec `docs/superpowers/specs/2026-10-01-sdf-march-early-z-design.md`, plan `docs/superpowers/plans/2026-10-01-sdf-march-early-z-stage-1.md`.
- [x] Behind `?earlyz=1` (default OFF): front-face crowd proxies + `frag_depth, greater`, camera-inside back batch,
  level-depth seed, near-to-far order. Results: `docs/dev-notes/2026-10-01-earlyz-stage-1/NOTES.md`.
- [ ] Owner look at `look/*.png` (doorway edge fringe) and the default decision.
- [ ] Stage 2 (built-once hull): <OPEN / NOT OPENED> per the verdict.
```

In `TASKS.md`'s **Elsewhere** list, extend the Rendering bullet with one clause: `early-Z stage 1 behind ?earlyz=1
(owner look pending)`.

- [ ] **Step 5: Commit**

```bash
git add docs/dev-notes/2026-10-01-earlyz-stage-1/NOTES.md docs/tasks/rendering.md TASKS.md
git commit -m "earlyz: stage-1 boot time, final gates, verdict + task board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (done while writing; kept for the executor)

- **Spec coverage:**

  | Spec item | Task |
  | --- | --- |
  | D1 | 1 |
  | D2–D4 | 4, 7 |
  | D3 clamp | 6, 7 |
  | D5 | 2, 8 |
  | D6 | 5, 9 |
  | D7 (amended) | 3, 10 |
  | D8 | 6, 10 |
  | §5 seams | 10 |
  | warm-up | 9 (precompile), 10 (background job) |
  | §7 tests | 1–8 unit; 11 smoke; 12 parity + look; 13 cost |
  | §8 verdict and gate | 14 |
  | §2 non-goals | kept: per-body path, chunks, refine, far pass and field-mode seed untouched |

- **Flag-off byte identity:**
  - every new material, mesh and WGSL is created only through `opts.earlyz`, `{ front: true }` or `setEarlyzSeed`;
  - all three are reached only when `ctx.crowd.earlyz.on`;
  - the march body text is never edited;
  - Tasks 7, 9, 10 and 14 re-run the golden test and the hash.
- **Names used across tasks:** `EARLYZ_FLAG`, `splitInstances`, `NEAR_GUARD_M`, `typeRenderOrder`,
  `SEED_RENDER_ORDER`, `BACK_BATCH_BASE`, `FRONT_BATCH_BASE`, `EARLYZ_BOX_EXIT_WGSL`, `boxExitT`, `EARLYZ_SEED_WGSL`,
  `seedBlock`, `seedDepthCpu`, `installConservativeDepthPatch`, `conservativeDepthPatchHits`,
  `detectConservativeDepth`, `applyConservativeDepth`, `CrowdType.frontMesh`, `CrowdType.earlyzBatches`,
  `EarlyzBatches`, `SdfLayer.setEarlyzSeed`, `SdfLayer.earlyzSeedInfo`, `CrowdState.earlyz`, `bootEarlyz`,
  `applyEarlyzRenderOrder`, `createEarlyzSeams`, `__sdfGame.earlyzInfo`, `__sdfGame.tunnelDefs`, `doorwayPrelude`,
  `cornerPrelude`, `STAGES`.
