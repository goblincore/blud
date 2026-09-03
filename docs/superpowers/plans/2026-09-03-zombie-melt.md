# Zombie Melt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The zombie melts where it stands — flesh sags into a wide goo puddle, the skeleton falls out of it, the puddle freezes and stays.

**Architecture:** CPU-side animation of the prim table. A pure `melt.ts` module transforms flesh primitives per frame (per-endpoint sag, lateral spread, `blendK` fuse) before they reach `view.update`. Bone prims are never melted — they are revealed by the receding flesh and then released as ~11 rigid groups into the existing chunk stepper. One small shader addition ramps flesh albedo toward wet dark red.

**Tech Stack:** TypeScript, Three.js + WebGPU SDF raymarcher (`march.wgsl.ts`), vitest, Node 22 CDP capture scripts.

**Spec:** [docs/superpowers/specs/2026-09-03-zombie-melt-design.md](../specs/2026-09-03-zombie-melt-design.md) — read it before Task 1.

---

## Ground rules for every task

1. **Run the full suite before committing.** `npx vitest run` must be green and `npx tsc --noEmit` clean. The suite is 2929 tests across 180 files (measured 2026-09-03 by melt-task-1); a red suite is a failed task.
2. **`melt.ts` is pure.** No `Date.now`, no `Math.random`, no imports from `webgpu/`. Same `(state, dt)` in, same state out, always. The capture gate depends on this.
3. **Never touch bone prims in `applyMelt`.** Bones live in `BuildResult.bonePrims`, flesh in `BuildResult.prims`. `applyMelt` reads and writes `prims` only.
4. **TRAP — do not "fix" bone containment.** `validate.ts`'s `checkBoneContainment` enforces a 4 mm flesh-over-bone margin. Melt violates it deliberately — bones breaching flesh IS the effect. Never run that check on melted prims, and never adjust the melt to satisfy it. If you see containment errors on a melted body, that is the feature working.
5. **Do not cherry-pick `c52b05b` wholesale.** Take `scripts/melt-capture.mjs` and the lab seam pattern only. Its `mapBody` change widens `noiseAmp: f32` → `noiseCfg: vec4` and the body-sheet work builds on that signature — importing it creates a collision for a term this plan does not use.

## File structure

| File | Responsibility |
|---|---|
| `src/lab/sdf-zombie/melt.ts` (new) | The whole melt model: state, ramp, per-endpoint sag, prim transform, bone-group release schedule. Pure. |
| `src/lab/sdf-zombie/melt.test.ts` (new) | Unit tests for the above. |
| `src/lab/sdf-zombie/melt-bones.ts` (new, Task 5) | Bone-group partition + release → `Chunk` handoff. Pure. |
| `src/lab/sdf-zombie/melt-bones.test.ts` (new, Task 5) | Tests for the above. |
| `src/lab/sdf-zombie/melt-gate.test.ts` (new, Task 4) | Gate A — the shorter/wider/lower assertion, measured on the real `zombie.blob`. |
| `src/lab/sdf-zombie/webgpu/lab-main.ts` | Lab wiring: keys, `__sdfLab` seams, intercepting `view.update`. |
| `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` | `setMelt(progress)` on the view → `meltCfg` uniform. |
| `src/lab/sdf-zombie/webgpu/march.wgsl.ts` | `meltCfg` uniform + flesh albedo/gloss ramp. |
| `scripts/melt-capture.mjs` | Gate B — deterministic ramp capture, silhouette metrics, visual judgement. |

## Key facts about this codebase (verified, do not re-derive)

- **`Primitive`** (`src/lab/sdf-zombie/types.ts:218`) has `a: Vec3`, `b: Vec3`, `radius: number`, `radiusB?: number`, `scale: Vec3`, `blendK: number`, `limb: LimbId`, `cluster: number`, `bone?: string`, `bend?: Vec3`, `op?: string`.
- **`BuiltBody`** (`types.ts:315`) has `prims` (flesh, sorted by cluster — **never reorder**), `bonePrims` (bone + organ, kept out of `prims` on purpose), `clusters`, `bones` (the rig skeleton map, a different thing).
- **`BuildResult`** (`build-body.ts:33`) = `BuiltBody` + `errors: string[]`.
- **The single frame integration point is `lab-main.ts:2479`**: `view.update(posed, current)`. `posed` is the rigged body, `current` the authored rest body. Melt intercepts exactly this line.
- **`view.update(body, rest?)`** (`zombie-gpu.ts:60`, impl `:1311`) uploads prims into a data texture each call. Rest rows anchor the surface noise.
- **Chunk physics** is `makeChunk` / `stepChunk` in `gib-chunks.ts:78,97`, `CHUNK_TUNING` restitution 0.55 / floorFriction 0.72. The severed-limb precedent that spawns one is `lab-main.ts:2112` (`spawnChunk`).
- **Bones fold with a hard `min` after flesh** (`march.wgsl.ts:1041` `APPLY_BONES`), which is why bone exposure needs no new code.

---

### Task 1: The melt state machine

Pure progress model. No prims yet — this task is numbers only, so it can be tested without a body.

**Files:**
- Create: `src/lab/sdf-zombie/melt.ts`
- Create: `src/lab/sdf-zombie/melt.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lab/sdf-zombie/melt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MELT_TUNING, meltInit, stepMelt, endpointProgress } from './melt';

const REST_Y = [0.02, 0.45, 0.95, 1.55]; // foot, knee, chest, crown

describe('melt state machine', () => {
  it('starts at zero progress with nothing melted', () => {
    const s = meltInit(REST_Y, 0);
    expect(s.t).toBe(0);
    for (let i = 0; i < REST_Y.length; i++) {
      expect(endpointProgress(s, i)).toBe(0);
    }
  });

  it('advances progress at the tuned rate', () => {
    const s = stepMelt(meltInit(REST_Y, 0), 1);
    expect(s.t).toBeCloseTo(MELT_TUNING.rate, 6);
  });

  it('freezes at 1 and is idempotent past it', () => {
    let s = meltInit(REST_Y, 0);
    for (let i = 0; i < 600; i++) s = stepMelt(s, 1 / 60);
    expect(s.t).toBe(1);
    const frozen = stepMelt(s, 1 / 60);
    expect(frozen.t).toBe(1);
    expect(frozen).toEqual(s);
  });

  it('melts low endpoints before high ones', () => {
    let s = meltInit(REST_Y, 0);
    for (let i = 0; i < 20; i++) s = stepMelt(s, 1 / 60);
    const u = REST_Y.map((_, i) => endpointProgress(s, i));
    for (let i = 1; i < u.length; i++) expect(u[i]!).toBeLessThanOrEqual(u[i - 1]!);
    expect(u[0]!).toBeGreaterThan(u[3]!); // foot strictly ahead of crown
  });

  it('brings every endpoint to full melt by progress 1', () => {
    let s = meltInit(REST_Y, 0);
    for (let i = 0; i < 600; i++) s = stepMelt(s, 1 / 60);
    for (let i = 0; i < REST_Y.length; i++) {
      expect(endpointProgress(s, i)).toBeCloseTo(1, 6);
    }
  });

  it('endpoint progress never decreases', () => {
    let s = meltInit(REST_Y, 0);
    let prev = REST_Y.map((_, i) => endpointProgress(s, i));
    for (let f = 0; f < 200; f++) {
      s = stepMelt(s, 1 / 60);
      const now = REST_Y.map((_, i) => endpointProgress(s, i));
      for (let i = 0; i < now.length; i++) expect(now[i]!).toBeGreaterThanOrEqual(prev[i]!);
      prev = now;
    }
  });

  it('is deterministic — identical dt sequences give identical states', () => {
    const run = () => {
      let s = meltInit(REST_Y, 0);
      for (let i = 0; i < 100; i++) s = stepMelt(s, 1 / 60);
      return s;
    };
    expect(run()).toEqual(run());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/melt.test.ts`
Expected: FAIL — `Failed to resolve import "./melt"`.

- [ ] **Step 3: Write the implementation**

Create `src/lab/sdf-zombie/melt.ts`:

```ts
// src/lab/sdf-zombie/melt.ts
//
// MELT — the zombie liquefies where it stands. Pure: no Date.now, no
// Math.random; identical (state, dt) sequences produce identical states,
// because scripts/melt-capture.mjs steps this frame by frame and its gate
// compares runs.
//
// THE MODEL, and why it is shaped this way (spec
// docs/superpowers/specs/2026-09-03-zombie-melt-design.md):
//
// SAG IS PER-ENDPOINT, NOT PER-PRIM. Every prim is a capsule with two
// endpoints. Giving each endpoint its own progress makes capsules STRETCH as
// the lower end drops away from the upper — arms draw out into strands, the
// torso elongates as the pelvis goes first. Sagging whole prims instead
// slides a rigid body downward, which is a different and much worse effect.
//
// DESCENT IS PACED BY HEIGHT, NOT BY LIMB. A "melt front" rises through the
// body; an endpoint melts as the front reaches it. That is what makes this a
// candle (the feet liquefy and the torso settles onto the puddle) rather than
// a lift (the whole body descending together). The front leads past 1 so the
// crown still reaches full melt by progress 1.
//
// This module owns the SCHEDULE. The prim transform is applyMelt (task 2) and
// the bone release is melt-bones.ts (task 5); both read endpointProgress.

export interface MeltTuning {
  /** Progress per second. 0.625 ≈ 1.6s to full — the spec's timing. */
  rate: number;
  /**
   * How far past the top of the body the melt front travels by progress 1.
   * Must exceed 1 + softness or the crown never finishes: the front has to
   * clear the tallest endpoint by a full softness band.
   */
  frontLead: number;
  /**
   * Height band, in normalised body heights, over which an endpoint goes from
   * untouched to fully melted. Wide (0.45) fuses neighbours into one flowing
   * mass; narrow reads as a hard scan line moving up the body.
   */
  softness: number;
}

export const MELT_TUNING: MeltTuning = {
  rate: 0.625,
  frontLead: 1.55,
  softness: 0.45,
};

export interface MeltState {
  /** Overall progress 0..1. Frozen at exactly 1. */
  t: number;
  /** Normalised rest height (0 = floor, 1 = tallest endpoint) per endpoint. */
  heights: readonly number[];
  tuning: MeltTuning;
}

/**
 * @param restY   World-space rest Y of every endpoint, in the index order the
 *                caller will use for the rest of the melt.
 * @param floorY  The floor the body melts onto.
 */
export function meltInit(
  restY: readonly number[],
  floorY: number,
  tuning: MeltTuning = MELT_TUNING,
): MeltState {
  let top = 0;
  for (const y of restY) top = Math.max(top, y - floorY);
  // A zero-height body would divide by zero; 1 makes every height 0, i.e. the
  // whole body melts at once, which is the only sane degenerate answer.
  const span = top > 1e-6 ? top : 1;
  return {
    t: 0,
    heights: restY.map(y => (y - floorY) / span),
    tuning,
  };
}

export function stepMelt(s: MeltState, dt: number): MeltState {
  if (s.t >= 1) return s; // frozen — idempotent, per the spec's freeze
  const t = Math.min(1, s.t + s.tuning.rate * dt);
  return { ...s, t };
}

/** 0..1 melt of one endpoint. Monotonic in t; low endpoints lead high ones. */
export function endpointProgress(s: MeltState, index: number): number {
  const h = s.heights[index] ?? 0;
  const front = s.t * s.tuning.frontLead;
  const u = (front - h) / s.tuning.softness;
  return smoothstep(clamp01(u));
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Hermite ease. Zero slope at both ends, so the melt starts and stops soft. */
export function smoothstep(x: number): number {
  return x * x * (3 - 2 * x);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/melt.test.ts`
Expected: PASS, 7 tests.

If "brings every endpoint to full melt by progress 1" fails, `frontLead` is too small — it must be at least `1 + softness`. Fix the tuning, not the test.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: suite green, tsc silent.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/melt.ts src/lab/sdf-zombie/melt.test.ts
git commit -m "melt: the state machine — a front that rises through the body

Per-endpoint progress, not per-prim: the two ends of a capsule melt on
different schedules so the capsule stretches, which is where the stringy
dough read comes from. Descent is paced by height rather than by limb so it
reads as a candle. Pure and deterministic — the capture gate compares runs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `applyMelt` — the prim transform

Turns the schedule into geometry: sag, spread, crush, fuse.

**Files:**
- Modify: `src/lab/sdf-zombie/melt.ts`
- Modify: `src/lab/sdf-zombie/melt.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lab/sdf-zombie/melt.test.ts`:

```ts
import { meltInitBody, applyMelt, endpointHeights } from './melt';
import type { Primitive } from './types';

function prim(a: [number, number, number], b: [number, number, number]): Primitive {
  return {
    a, b, radius: 0.08, scale: [1, 1, 1], blendK: 0.02, limb: 'leg', cluster: 0,
  } as Primitive;
}

const BODY: Primitive[] = [
  prim([0.1, 0.02, 0], [0.1, 0.45, 0]),   // shin
  prim([0.1, 0.45, 0], [0.1, 0.90, 0]),   // thigh
  prim([0, 0.90, 0], [0, 1.35, 0]),       // torso
  prim([0, 1.35, 0], [0, 1.55, 0]),       // head
];

function meltedAt(t: number): Primitive[] {
  let s = meltInitBody(BODY, 0);
  const step = 1 / 240;
  while (s.t < t - 1e-9) s = stepMelt(s, step);
  return applyMelt(BODY, s);
}

describe('applyMelt', () => {
  it('is the identity at progress zero', () => {
    const out = applyMelt(BODY, meltInitBody(BODY, 0));
    expect(out).toEqual(BODY);
  });

  it('never raises an endpoint', () => {
    let prev = BODY;
    for (let i = 1; i <= 20; i++) {
      const now = meltedAt(i / 20);
      for (let p = 0; p < now.length; p++) {
        expect(now[p]!.a[1]).toBeLessThanOrEqual(prev[p]!.a[1] + 1e-9);
        expect(now[p]!.b[1]).toBeLessThanOrEqual(prev[p]!.b[1] + 1e-9);
      }
      prev = now;
    }
  });

  it('conserves r^2 * yScale within 25% — volume goes sideways, not away', () => {
    for (let i = 0; i <= 10; i++) {
      const out = meltedAt(i / 10);
      for (let p = 0; p < out.length; p++) {
        const rest = BODY[p]!;
        const now = out[p]!;
        const v0 = rest.radius ** 2 * rest.scale[1];
        const v1 = now.radius ** 2 * now.scale[1];
        expect(v1 / v0).toBeGreaterThan(0.75);
        expect(v1 / v0).toBeLessThan(1.25);
      }
    }
  });

  it('crushes yScale and grows radius as it melts', () => {
    const end = meltedAt(1)[0]!;
    expect(end.scale[1]).toBeLessThan(0.3);
    expect(end.radius).toBeGreaterThan(BODY[0]!.radius * 1.5);
  });

  it('ramps blendK monotonically up to the fuse value', () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const k = meltedAt(i / 20)[0]!.blendK;
      expect(k).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = k;
    }
    expect(prev).toBeCloseTo(MELT_TUNING_BODY.fuseK, 3);
  });

  it('stretches capsules — the head prim gets longer before it pools', () => {
    // 0.75 is chosen, not arbitrary: the head prim spans normalised heights
    // 0.87..1.0, and the front (t * frontLead) has to sit BETWEEN those two
    // endpoints' softness bands for the capsule to be mid-stretch. At 0.75 the
    // lower end is ~0.72 melted and the upper end ~0.28 — maximum draw.
    const len = (p: Primitive) => Math.abs(p.b[1] - p.a[1]);
    const rest = len(BODY[3]!);
    const mid = len(meltedAt(0.75)[3]!);
    expect(mid).toBeGreaterThan(rest * 2);
  });

  it('ends with everything within the pool height', () => {
    const out = meltedAt(1);
    for (const p of out) {
      expect(p.a[1]).toBeLessThan(MELT_TUNING_BODY.poolHeight + 1e-6);
      expect(p.b[1]).toBeLessThan(MELT_TUNING_BODY.poolHeight + 1e-6);
    }
  });

  it('spreads outward — the puddle is wider than the body was', () => {
    const width = (ps: Primitive[]) => {
      let w = 0;
      for (const p of ps) w = Math.max(w, Math.abs(p.a[0]), Math.abs(p.b[0]));
      return w;
    };
    expect(width(meltedAt(1))).toBeGreaterThan(width(BODY) * 1.5);
  });

  it('does not mutate the input prims', () => {
    const copy = JSON.parse(JSON.stringify(BODY));
    meltedAt(0.7);
    expect(BODY).toEqual(copy);
  });
});

describe('endpointHeights', () => {
  it('emits two entries per prim, a then b', () => {
    const h = endpointHeights(BODY);
    expect(h).toHaveLength(BODY.length * 2);
    expect(h[0]).toBe(BODY[0]!.a[1]);
    expect(h[1]).toBe(BODY[0]!.b[1]);
  });
});
```

Add `MELT_TUNING_BODY` to the existing import from `./melt`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/melt.test.ts`
Expected: FAIL — `meltInitBody`, `applyMelt`, `endpointHeights`, `MELT_TUNING_BODY` are not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lab/sdf-zombie/melt.ts`:

```ts
import type { Primitive, Vec3 } from './types';

export interface MeltBodyTuning {
  /** Y the pooled goo settles at. A puddle has depth; zero reads as a decal. */
  poolHeight: number;
  /** yScale at full melt. 0.25 is a disc that still has a top surface. */
  crush: number;
  /** Metres pushed outward from the body's vertical axis at full melt. */
  spread: number;
  /**
   * blendK at full melt. The authored flesh runs 0.007–0.02; 0.11 is well
   * past the point where neighbouring limbs stop being separable, which is
   * what makes the puddle ONE surface instead of a heap of sausages.
   */
  fuseK: number;
}

export const MELT_TUNING_BODY: MeltBodyTuning = {
  poolHeight: 0.085,
  crush: 0.25,
  spread: 0.16,
  fuseK: 0.11,
};

/** Endpoint Y in the canonical order: prim i contributes 2i (a), 2i+1 (b). */
export function endpointHeights(prims: readonly Primitive[]): number[] {
  const out: number[] = [];
  for (const p of prims) { out.push(p.a[1]); out.push(p.b[1]); }
  return out;
}

/** meltInit for a real body — canonical endpoint order comes from the prims. */
export function meltInitBody(
  prims: readonly Primitive[],
  floorY: number,
  tuning: MeltTuning = MELT_TUNING,
): MeltState {
  return meltInit(endpointHeights(prims), floorY, tuning);
}

/**
 * Rest flesh prims in, melted flesh prims out. Never mutates the input, never
 * reorders (the fold order is load-bearing — see BuiltBody.prims), and never
 * sees a bone prim: bones live in BuiltBody.bonePrims and are handled by
 * melt-bones.ts.
 *
 * Scalar quantities (radius, scale, blendK) use the prim's MEAN endpoint
 * progress, while positions use each endpoint's OWN progress. That split is
 * what produces the stretch: a prim whose lower end has melted and whose
 * upper end has not gets pulled long while it is still only half-fused.
 */
export function applyMelt(
  prims: readonly Primitive[],
  s: MeltState,
  body: MeltBodyTuning = MELT_TUNING_BODY,
): Primitive[] {
  if (s.t <= 0) return prims.map(p => p);
  return prims.map((p, i) => {
    const ua = endpointProgress(s, i * 2);
    const ub = endpointProgress(s, i * 2 + 1);
    const u = (ua + ub) / 2;
    const yScale = lerp(p.scale[1], p.scale[1] * body.crush, u);
    // r ∝ 1/sqrt(yScale) keeps r² · yScale constant — the crushed disc gets
    // wider by exactly what it lost in height. This is the whole reason the
    // puddle ends up broader than the body: the volume has to go somewhere.
    const shrink = yScale / (p.scale[1] || 1);
    return {
      ...p,
      a: meltPoint(p.a, ua, body),
      b: meltPoint(p.b, ub, body),
      radius: p.radius / Math.sqrt(shrink || 1),
      ...(p.radiusB !== undefined ? { radiusB: p.radiusB / Math.sqrt(shrink || 1) } : {}),
      scale: [p.scale[0], yScale, p.scale[2]] as Vec3,
      blendK: lerp(p.blendK, body.fuseK, u),
    };
  });
}

/** Drop one endpoint toward the pool and push it out from the body axis. */
function meltPoint(p: Vec3, u: number, body: MeltBodyTuning): Vec3 {
  const y = lerp(p[1], body.poolHeight, u);
  // Outward from the vertical axis through the origin (the body's own root).
  // A point exactly on the axis has no direction to go, so it stays — which
  // is correct: the spine should pool where it stood.
  const r = Math.hypot(p[0], p[2]);
  const push = r > 1e-6 ? (body.spread * u) / r : 0;
  return [p[0] * (1 + push), y, p[2] * (1 + push)];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/melt.test.ts`
Expected: PASS, 16 tests.

If "ends with everything within the pool height" fails at exactly `poolHeight`, an endpoint has not reached `u = 1` — that is Task 1's `frontLead`, not this task's lerp.

- [ ] **Step 5: Full suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/melt.ts src/lab/sdf-zombie/melt.test.ts
git commit -m "melt: applyMelt — sag, spread, crush, fuse

Positions use each endpoint's own progress and scalars use the prim mean, so
a prim whose lower end has gone stretches while its upper end waits. Radius
grows by 1/sqrt(yScale) so r^2*yScale is conserved: the puddle is wide
because the body was tall, rather than the flesh quietly evaporating.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Lab wiring

Make it visible. One intercepted line does the work.

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`

- [ ] **Step 1: Read the seam precedent**

Run: `git show c52b05b -- src/lab/sdf-zombie/webgpu/lab-main.ts`

Copy the SHAPE of its melt block (state vars, `startMelt` / `stopMelt` / per-frame step, `__sdfLab` seams, keys) and nothing else. Its `view.setMelt(amp, freq)` calls are the discarded ridged-noise path — this task calls no view method at all.

- [ ] **Step 2: Add melt state near the other body state**

Insert after the `let forcedCollapse = false;` declaration (around `lab-main.ts:1004`):

```ts
  // ——— MELT (2026-09-03) ————————————————————————————————————————————————
  // The zombie liquefies where it stands: flesh sags into a puddle and the
  // skeleton falls out of it. Spec: docs/superpowers/specs/2026-09-03-zombie-melt-design.md
  //
  // NOTE this deliberately does NOT trigger the death collapse. Melting IS
  // the death — a ragdoll underneath would topple the body, and the whole
  // read is that it goes straight down like a candle.
  let meltState: MeltState | null = null;
  function startMelt() {
    meltState = meltInitBody(current.prims, 0);
  }
  function stopMelt() {
    meltState = null;
  }
  /** Jump straight to a progress value — the capture script's knob. */
  function meltDirect(t: number) {
    if (!meltState) startMelt();
    meltState = { ...meltState!, t: Math.max(0, Math.min(1, t)) };
  }
```

Add to the imports at the top of the file:

```ts
import { applyMelt, meltInitBody, stepMelt, type MeltState } from '../melt';
```

- [ ] **Step 3: Step the melt each frame**

In the main animation loop, immediately before the `const posed = applyRig(...)` line at `lab-main.ts:2473`, add:

```ts
    if (meltState) meltState = stepMelt(meltState, Math.min(dt, 1 / 30));
```

Clamping dt matters: a tab that was backgrounded returns a multi-second delta and would melt the body instantly on the first frame back.

- [ ] **Step 4: Intercept the upload**

Replace `lab-main.ts:2479`:

```ts
    view.update(posed, current);
```

with:

```ts
    // Melt transforms BOTH posed and rest. Rest rows anchor the surface
    // noise; dragging them along is what makes the mottle flow WITH the goo
    // instead of the skin appearing to slide over a ghost of the old body.
    if (meltState) {
      view.update(
        { ...posed, prims: applyMelt(posed.prims, meltState) },
        { ...current, prims: applyMelt(current.prims, meltState) },
      );
    } else {
      view.update(posed, current);
    }
```

- [ ] **Step 5: Add the keys and console seams**

Find the keydown handler (search for `case 'k'` or the existing `forcedCollapse` key) and add:

```ts
      case 'm': startMelt(); break;
      case 'M': stopMelt(); break;
```

Find the `__sdfLab` object literal and add:

```ts
    melt: () => startMelt(),
    meltOff: () => stopMelt(),
    meltDirect: (t: number) => meltDirect(t),
    meltState: () => (meltState ? { t: meltState.t } : null),
```

- [ ] **Step 6: Typecheck and suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both clean.

- [ ] **Step 7: Look at it**

Start the lab dev server, open the zombie, press `m`, and watch. Take a screenshot at roughly half melt and at rest.

**Expected:** the body sinks straight down and widens. **If it does not visibly change, STOP and report that** — do not proceed to Task 4 and do not tune. That is exactly the failure mode of the previous attempt (`c52b05b`), which shipped green tests and zero pixels. The bug will be in the interception, not in `melt.ts`, whose tests already prove the numbers move.

- [ ] **Step 8: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/lab-main.ts
git commit -m "melt: wire it into the lab — one intercepted upload

view.update(posed, current) becomes view.update of the melted pair. Rest is
melted too, so the noise anchor travels with the goo. No collapse: melting IS
the death, and a ragdoll underneath would topple what should go straight down.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The gates — geometric in the suite, visual in captures

The task that decides whether any of this actually happened. **Two gates**, because they catch different failures: the geometric one runs in the suite on every future change and cannot be fooled or forgotten, and the visual one is how a human (or you) judges whether it looks like melting rather than merely measuring smaller.

**Files:**
- Create: `src/lab/sdf-zombie/melt-gate.test.ts`
- Create: `scripts/melt-capture.mjs` (salvaged, then extended)

#### Step 0 — fix what Task 3's captured frames revealed

Task 3 wired the melt in and it IS visible — which is already more than the
previous attempt ever achieved. But its frames show a giant flat-topped
cylinder several metres across, not a puddle. Two causes, both real, and BOTH
must be fixed before either gate means anything.

**0a. `MELT_TUNING_BODY.fuseK` is far too large.** `march.wgsl.ts:878` records
that `smin` scales k by 4 internally — "a cluster still bends the surface from
4x the authored blendK away". Authored flesh blendK runs 0.007–0.02, so the
plan's `fuseK: 0.11` gives ~0.44 m of blend support on every prim and the union
balloons. Drop it to **0.045** as the new starting point (~0.18 m of support,
still several times the authored values, which is what fuses limbs) and tune
from captures.

**0b. `applyMelt` leaves `clusters` stale — this is the flat-topped box.**
`ClusterInfo` (`types.ts:299`) carries `center` and `radius`, and they feed two
things: `fit()` (`zombie-gpu.ts:1270`) sizes the render proxy box from the
cluster spheres, and the march culls prims against them. The Task 3 wiring
passes `{...posed, prims: applyMelt(...)}`, so the prims melt while the
clusters still describe a STANDING zombie. The result is the melted field
clipped by the standing body's bounding box: flat top, straight sides,
polygonal outline. It is not a shading artefact and it will not tune away.

Add to `melt.ts`:

```ts
import type { ClusterInfo } from './types';

/**
 * Re-fit each cluster's bounding sphere to the MELTED prims it owns.
 *
 * Clusters are not decoration: fit() sizes the render proxy box from these
 * spheres and the march culls prims against them, so a melted body carrying
 * rest-pose clusters is marched inside a box shaped like the body it used to
 * be — which is exactly the flat-topped cylinder Task 3 captured. id, limb,
 * start, count and alive are carried through untouched; only the sphere moves.
 */
export function remeltClusters(
  clusters: readonly ClusterInfo[],
  prims: readonly Primitive[],
): ClusterInfo[] {
  return clusters.map(c => {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity;
    let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = c.start; i < c.start + c.count; i++) {
      const p = prims[i];
      if (!p) continue;
      const r = p.radius * Math.max(p.scale[0], p.scale[1], p.scale[2]);
      for (const e of [p.a, p.b]) {
        x0 = Math.min(x0, e[0] - r); x1 = Math.max(x1, e[0] + r);
        y0 = Math.min(y0, e[1] - r); y1 = Math.max(y1, e[1] + r);
        z0 = Math.min(z0, e[2] - r); z1 = Math.max(z1, e[2] + r);
      }
    }
    if (x1 < x0) return c; // empty cluster — leave it exactly as it was
    const centre: Vec3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    // The sphere must CONTAIN the box, so it is the half-diagonal, not the
    // half-width: a half-width sphere leaves the box corners outside it and
    // the march culls the very prims that moved furthest.
    const radius = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2;
    return { ...c, center: centre, radius };
  });
}
```

Tests for it: the sphere contains every melted endpoint of its own cluster;
`id`/`limb`/`start`/`count`/`alive` survive unchanged; an empty cluster is
returned untouched.

Then change the Task 3 wiring in `lab-main.ts` so both bodies carry re-fitted
clusters:

```ts
    if (meltState) {
      const pp = applyMelt(posed.prims, meltState);
      const cp = applyMelt(current.prims, meltState);
      view.update(
        { ...posed, prims: pp, clusters: remeltClusters(posed.clusters, pp) },
        { ...current, prims: cp, clusters: remeltClusters(current.clusters, cp) },
      );
    } else {
      view.update(posed, current);
    }
```

Re-capture after 0a and 0b before touching either gate. Report what changed.

#### Gate A — geometric, in the suite

- [ ] **Step A1: Write the gate test against the REAL zombie**

Create `src/lab/sdf-zombie/melt-gate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import { buildBody } from './build-body';
import { applyMelt, meltInitBody, stepMelt } from './melt';
import type { Primitive } from './types';

/** World AABB of a prim set, radius and per-axis scale included. */
function aabb(prims: readonly Primitive[]) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const p of prims) {
    const rx = p.radius * p.scale[0];
    const ry = p.radius * p.scale[1];
    const rz = p.radius * p.scale[2];
    for (const e of [p.a, p.b]) {
      x0 = Math.min(x0, e[0] - rx); x1 = Math.max(x1, e[0] + rx);
      y0 = Math.min(y0, e[1] - ry); y1 = Math.max(y1, e[1] + ry);
      z0 = Math.min(z0, e[2] - rz); z1 = Math.max(z1, e[2] + rz);
    }
  }
  return {
    height: y1 - y0,
    width: Math.max(x1 - x0, z1 - z0),
    centroid: prims.reduce((s, p) => s + (p.a[1] + p.b[1]) / 2, 0) / prims.length - y0,
  };
}

function zombie() {
  const src = readFileSync('src/lab/sdf-zombie/characters/zombie.blob', 'utf8');
  return buildBody(compileBlob(parseBlob(src)));
}

describe('MELT GATE — the end state must be shorter, wider and lower', () => {
  it('sinks, spreads and drops its centroid by progress 1', () => {
    const body = zombie();
    const rest = aabb(body.prims);

    let s = meltInitBody(body.prims, 0);
    for (let i = 0; i < 600; i++) s = stepMelt(s, 1 / 60);
    const end = aabb(applyMelt(body.prims, s));

    const h = end.height / rest.height;
    const w = end.width / rest.width;
    const c = end.centroid / rest.centroid;
    // Printed so a failure says WHICH property is missing, not just "false".
    console.log(`melt gate: height ${h.toFixed(2)}x  width ${w.toFixed(2)}x  centroid ${c.toFixed(2)}x`);

    expect(h).toBeLessThanOrEqual(0.40);
    expect(w).toBeGreaterThanOrEqual(1.50);
    // UPPER bound too. Task 3's frames showed a melt that passed every
    // lower bound by turning the zombie into a flat disc several metres
    // across — "wider" is only right up to a point, and a gate with no
    // ceiling calls that a success.
    expect(w).toBeLessThanOrEqual(3.00);
    expect(c).toBeLessThanOrEqual(0.25);
  });

  it('never grows taller at any point in the ramp', () => {
    const body = zombie();
    let s = meltInitBody(body.prims, 0);
    let prev = aabb(body.prims).height;
    for (let i = 0; i < 600; i++) {
      s = stepMelt(s, 1 / 60);
      const now = aabb(applyMelt(body.prims, s)).height;
      expect(now).toBeLessThanOrEqual(prev + 1e-6);
      prev = now;
    }
  });
});
```

Check the exact `compileBlob` / `parseBlob` import path and call shape against an existing test that loads a character (grep for `zombie.blob` in `*.test.ts`) and match it — do not guess the API.

- [ ] **Step A2: Run it**

Run: `npx vitest run src/lab/sdf-zombie/melt-gate.test.ts`

If a ratio misses, tune `MELT_TUNING_BODY` — `crush` drives height, `spread` drives width, `poolHeight` drives centroid. **Do not relax the thresholds.** They are the definition of the effect: `c52b05b` shipped green tests and changed zero pixels, and this test is what would have caught it.

- [ ] **Step A3: Commit**

```bash
git add src/lab/sdf-zombie/melt-gate.test.ts
git commit -m "melt: the gate — shorter, wider, lower, or it is not a melt

Measured on the real zombie.blob, in the suite, so it runs on every future
change instead of living in a script someone remembers to run. Three ratios
against the rest body: height <=40%, width >=150%, centroid <=25%. Thresholds
are the definition of the effect and are not to be relaxed to pass.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

#### Gate B — visual capture

- [ ] **Step 1: Salvage the script**

```bash
git show c52b05b:scripts/melt-capture.mjs > scripts/melt-capture.mjs
```

Read it. It is a CDP capture with a hard-won prologue: `__sdfLab.setCam(yaw, pitch, dist)` is the only camera knob that survives the render loop, and motion/wander must be frozen or the pose drifts between runs.

- [ ] **Step 2: Drive the ramp by progress, not by time**

Replace its `MELT_PEAK` / `MELT_FREQ` / `MELT_COLLAPSE` env handling and its `__sdfLab.melt()` time-based ramp with a fixed progress sweep:

```js
const PROGRESS = [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1.0];
```

and for each value, evaluate `__sdfLab.meltDirect(<t>)` in the page, wait two animation frames, then capture. Time-driven capture is not reproducible; `meltDirect` is.

- [ ] **Step 3: Add silhouette metrics to the captures**

Reuse the repo's own tooling rather than writing a segmenter:

- `decodePng` from `src/lab/sdf-zombie/png-decode` (precedent: `scripts/blob-measure.ts:48`)
- `maskFromRgba` and `subjectBounds` from `src/lab/sdf-zombie/silhouette.ts` (`:110`, `:768`) — `maskFromRgba` already segments a subject from a flat backdrop and `subjectBounds` returns inclusive `{x0,y0,x1,y1}`

**Do NOT use `maskFromBody` for this.** It auto-frames the raster to the body's own bounds (`BodyMaskOpts.pad` is a fraction of the body's height), so a shrinking body keeps filling the frame and every ratio comes out ~1.0. A capture's camera is fixed, which is exactly what makes its pixels comparable — that is why Gate A measures a world-space AABB and this gate measures a fixed-camera image.

Per frame record `height` (`y1-y0`), `width` (`x1-x0`), `area` (set bits) and `centroid` (mean set-bit row, expressed as rows above `y1`). Write `<outDir>/metrics.json` keyed by progress value and print a table.

- [ ] **Step 4: Print the same three ratios**

Compare progress 1.0 against progress 0, print each ratio against its threshold, and exit non-zero if any fails:

```
melt gate (pixels):
  height   0.31 x  (<= 0.40)  PASS
  width    1.72 x  (1.50 - 3.00)  PASS
  centroid 0.19 x  (<= 0.25)  PASS
```

Same thresholds as Gate A, measured through the renderer instead of the field — so a DISAGREEMENT between the two gates is itself the finding: the geometry melted and the picture did not, which is the `c52b05b` failure exactly.

- [ ] **Step 4b: Add a runner script**

Create `scripts/melt-shot.sh` as a near-copy of `scripts/blob-shot.sh` — it sources `scripts/lab-servers.sh`, brings up Vite and Chrome only if they are not already listening, runs `melt-capture.mjs`, and stops only what it started. Add an `npm run melt:shot` entry beside `blob:shot` in `package.json`. Do not hand-roll server management; `lab-servers.sh` already owns the ports, the reuse rule and the WebGPU health probe.

- [ ] **Step 5: Run it**

Run `npm run melt:shot` against the lab. **Read the captured frames yourself** and say what you see at each progress value, then report the gate table.

**This is the moment the feature is real or not.** If the gate fails, tune `MELT_TUNING_BODY` (`crush`, `spread`, `poolHeight`) and re-run — those three knobs map directly onto the three checks. If the gate passes but the frames look wrong, say so plainly; the numbers are a floor, not a verdict.

- [ ] **Step 6: Commit**

```bash
git add scripts/melt-capture.mjs
git commit -m "melt: capture the ramp by progress, and gate it on the silhouette

meltDirect drives fixed progress values so two runs shoot the same frames.
The script now measures silhouette height, width, area and centroid and FAILS
unless the end state is <=40% as tall, >=150% as wide and its centroid <=25%
as high. c52b05b shipped green tests and changed zero pixels; any one of these
three would have caught it on the first capture.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Bones fall out

**Files:**
- Create: `src/lab/sdf-zombie/melt-bones.ts`
- Create: `src/lab/sdf-zombie/melt-bones.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lab/sdf-zombie/melt-bones.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupOf, partitionBones, releaseOrder, BONE_GROUPS } from './melt-bones';
import type { Primitive } from './types';

function bone(name: string, y: number): Primitive {
  return {
    a: [0, y, 0], b: [0, y + 0.1, 0], radius: 0.02, scale: [1, 1, 1],
    blendK: 0, limb: 'torso', cluster: 0, bone: name, op: 'bone',
  } as Primitive;
}

describe('bone grouping', () => {
  it('maps every authored bone name to one of the 11 groups', () => {
    expect(groupOf('skull')).toBe('skull');
    expect(groupOf('neck')).toBe('skull');
    expect(groupOf('spine')).toBe('cage');
    expect(groupOf('clavicle.l')).toBe('cage');
    expect(groupOf('pelvis')).toBe('pelvis');
    expect(groupOf('thigh.l')).toBe('thigh.l');
    expect(groupOf('shin.r')).toBe('shin.r');
    expect(groupOf('upperArm.l')).toBe('upperArm.l');
    expect(groupOf('foreArm.r')).toBe('foreArm.r');
  });

  it('keeps the ribcage as ONE group, not one per rib', () => {
    const ribs = Array.from({ length: 24 }, () => bone('spine', 1.1));
    const parts = partitionBones(ribs);
    expect(parts.size).toBe(1);
    expect(parts.get('cage')).toHaveLength(24);
  });

  it('has exactly 11 groups defined', () => {
    expect(BONE_GROUPS).toHaveLength(11);
  });

  it('releases legs first, cage next, skull last', () => {
    const prims = [
      bone('skull', 1.5), bone('spine', 1.1), bone('pelvis', 0.9),
      bone('thigh.l', 0.6), bone('shin.l', 0.2),
    ];
    const order = releaseOrder(partitionBones(prims));
    expect(order.indexOf('shin.l')).toBeLessThan(order.indexOf('thigh.l'));
    expect(order.indexOf('thigh.l')).toBeLessThan(order.indexOf('pelvis'));
    expect(order.indexOf('cage')).toBeLessThan(order.indexOf('skull'));
    expect(order[order.length - 1]).toBe('skull');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lab/sdf-zombie/melt-bones.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the partition**

Create `src/lab/sdf-zombie/melt-bones.ts`. Requirements:

- `BONE_GROUPS` — the 11 group ids: `'skull'`, `'cage'`, `'pelvis'`, and `upperArm.l/.r`, `foreArm.l/.r`, `thigh.l/.r`, `shin.l/.r`.
- `groupOf(boneName: string): BoneGroup` — strips nothing for limbs (the concrete `thigh.l` IS the group), maps `skull` and `neck` → `'skull'`, `spine` and `clavicle*` → `'cage'`, `pelvis` → `'pelvis'`.
- `partitionBones(bonePrims: readonly Primitive[]): Map<BoneGroup, Primitive[]>` — groups by `groupOf(p.bone)`; a bone prim with no `bone` field goes to `'cage'` (the torso default) rather than being dropped, because a dropped bone prim silently disappears from the render.
- `releaseOrder(parts): BoneGroup[]` — sorted ascending by group centroid height, so the schedule is derived from the body rather than hard-coded. `'skull'` naturally lands last on any upright body.

**Why groups and not tubes:** a ribcage does not disassemble into 24 individual ribs when the flesh goes. ~11 rigid bodies instead of ~45 is also four times cheaper.

- [ ] **Step 4: Verify the tests pass**

Run: `npx vitest run src/lab/sdf-zombie/melt-bones.test.ts`

- [ ] **Step 5: Release the groups in the lab**

Each group releases when the melt front has passed its centroid — reuse `endpointProgress` against the group centroid height, releasing at `u > 0.6`. On release, hand the group to the existing chunk machinery: `makeChunk(limb, centroid, vel, radius, longAxis, rng, 'limb')` from `gib-chunks.ts:78`, stepped with `stepChunk`, rendered through the chunk view path.

**Follow the existing precedent exactly** — `lab-main.ts:2112`'s `spawnChunk(limb, chunk.origin, chunk.prims, undefined, [...])` is the severed-limb case and already carries bone prims through the same path. Do not invent a second one.

`makeChunk` takes an `rng` parameter defaulting to `Math.random`. **Pass a seeded generator**, not the default — the capture gate needs run-to-run reproducibility, and a random tumble breaks it.

- [ ] **Step 6: Capture and look**

Re-run the capture. Confirm the gate still passes (bones falling should not change the flesh silhouette much, but the metrics include them — if `height` regresses because a femur is standing on end, that is real and worth seeing).

Report what the skeleton does. Expected: leg bones drop and clatter outward first, the cage settles, the skull comes off last.

- [ ] **Step 7: Full suite, typecheck, commit**

```bash
git add src/lab/sdf-zombie/melt-bones.ts src/lab/sdf-zombie/melt-bones.test.ts src/lab/sdf-zombie/webgpu/lab-main.ts
git commit -m "melt: the skeleton falls out, in eleven pieces not forty-five

A ribcage does not disassemble into individual ribs, so bones release as
rigid GROUPS — skull, cage, pelvis and the eight long bones — into the chunk
stepper that severed limbs already use. Release order is derived from group
centroid height rather than hard-coded, so legs go first and the skull rolls
off last because that is where they are, not because a table says so. Seeded
rng: the capture gate has to reproduce.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The wet red look

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts`
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`

- [ ] **Step 1: Add the uniform**

Add `meltCfg: vec4<f32>` to the uniform block in `march.wgsl.ts` — `x` = melt progress 0..1, `yzw` spare. Follow the existing uniform-declaration comment style (see the `woundCfg` / `counts2` block comments around `:1350`), which documents each channel.

Expose `setMelt(progress: number)` on the view in `zombie-gpu.ts` beside `setRootShift` (`:1333`), writing `u.meltCfg.value.x`.

- [ ] **Step 2: Ramp albedo and gloss in the flesh branch**

In the flesh shading branch, lerp albedo toward a dark saturated red and raise wetness/gloss with `meltCfg.x`. The anchor comment is at `march.wgsl.ts:2299` — "Bone is matte — wet skin reflects" — that contrast is what sells pale bones sitting in wet goo, so **raise gloss on flesh only** and leave the bone branch alone.

**The reddening leads the sagging.** In the reference the body goes red while still standing, before it visibly sinks — that is what reads as "melt" rather than "fall". Drive the colour from `smoothstep(clamp(meltCfg.x * 2, 0, 1))` so it is essentially complete by the time real height is lost.

- [ ] **Step 3: Call it from the lab**

Beside the melt step added in Task 3:

```ts
    view.setMelt(meltState ? meltState.t : 0);
```

- [ ] **Step 4: Add a shader test**

`march.wgsl.test.ts` already asserts on generated WGSL text. Add a test that the emitted shader declares `meltCfg` and references it in the flesh shading branch — cheap, and it catches a uniform that gets declared and then never read, which is precisely how `c52b05b` failed.

- [ ] **Step 5: Capture and look**

Re-run the capture. Report the colour ramp: is the body clearly red *before* it has visibly shortened? If not, raise the colour ramp's multiplier.

- [ ] **Step 6: Full suite, typecheck, commit**

```bash
git add src/lab/sdf-zombie/webgpu/
git commit -m "melt: the wet red — colour leads the collapse

meltCfg.x ramps flesh albedo to dark saturated red and raises gloss, on flesh
only: bone stays matte, and that contrast is what makes pale bones in wet goo
read. The colour runs at twice the sag rate because the reference goes red
while still standing — that is the frame that says melt rather than fall. The
shader test asserts the uniform is actually READ, which is the exact way the
previous attempt failed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Organs, freeze, and the tuning pass

**Files:**
- Modify: `src/lab/sdf-zombie/melt.ts`, `src/lab/sdf-zombie/melt.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`
- Modify: `TASKS.md`

- [ ] **Step 1: Organs melt at half rate**

The four `organ` prims live in `bonePrims` alongside bone (`build-body.ts:56` — the split key is "inside the flesh", not "bone specifically"). They are soft, so they melt — but at roughly half the sag rate, so they slop out of the collapsing torso and are briefly visible before the goo takes them.

Add `applyMeltOrgans(prims, state, rateScale = 0.5)` to `melt.ts`, tested for: organs lag flesh at the same progress, and organs still reach the pool by progress 1.

- [ ] **Step 2: Verify freeze end-to-end**

Add a test that after the melt reaches 1, `applyMelt` returns identical prims across further steps — the freeze must be observable at the geometry level, not just in `state.t`.

In the lab, confirm that once frozen the puddle stops re-uploading (log the upload count over 60 frames with the melt complete; it should be constant if the guard is right, or note honestly if the existing loop uploads unconditionally — do not restructure the render loop to force it).

- [ ] **Step 3: The tuning pass**

Run the capture. Look at all seven frames. Tune `MELT_TUNING` (`rate`, `frontLead`, `softness`) and `MELT_TUNING_BODY` (`poolHeight`, `crush`, `spread`, `fuseK`) against what you see, re-running the capture after each change.

Target, from the reference: reddens while standing → sinks straight down over ~0.5s with limbs stretching → skeleton emerges → wide glossy puddle with pale bones in it. **It must never topple.**

Record the final numbers and why each moved in `docs/dev-notes/2026-09-03-zombie-melt/notes.md`, with before/after frames.

- [ ] **Step 4: Update the board**

In `TASKS.md`, mark `X5.melt` done, replacing its "PICK UP HERE NEXT SESSION" block with: the mechanism that shipped, the fact that it supersedes the ridged-noise attempt, the gate numbers achieved, and links to the spec, plan and notes.

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
git add -A
git commit -m "melt: organs, freeze, and the numbers the frames actually wanted

Organs melt at half rate so they slop out of the draining torso before the
goo takes them. Freeze is asserted at the GEOMETRY level, not just on the
progress scalar. Final tuning recorded against captured frames with the
before/after that justified each number.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The melting face

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/lab-main.ts`
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts`
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`

The face is not a texture on geometry — it is a UV PROJECTION. `march.wgsl.ts:2126`
takes the surface point into head-local space, divides by `headAxes` (the
skull's semi-axes), and samples the face sheet at those coordinates.
`headShape` (`lab-main.ts:954`) derives that centre and those axes from the
largest head-cluster prim, every frame, so the face tracks the head as it moves.

- [ ] **Step 1: Fix the anchoring bug — this is a defect, not a feature**

`lab-main.ts:2489` calls `headShape(posed)` and `:2492` calls
`uploadWounds(posed.prims)` — both on the UNMELTED body. During a melt the face
projection and every wound therefore stay pinned to where the standing zombie
was, while the zombie liquefies out from under them. This is the same class of
mistake as the stale clusters in Task 4's Step 0.

Hoist the melted prims so the whole frame uses one body:

```ts
    const meltedPosed = meltState
      ? { ...posed, prims: applyMelt(posed.prims, meltState),
          clusters: remeltClusters(posed.clusters, applyMelt(posed.prims, meltState)) }
      : posed;
```

Compute `applyMelt(posed.prims, meltState)` ONCE into a local and reuse it —
the expression above is written out for clarity, not to be pasted twice per
frame. Then feed `meltedPosed` to `view.update`, to `headShape`, and to
`uploadWounds`, replacing the three separate uses of `posed`.

**Level one of the melting face falls out of this for free.** The projection
normalises by `headAxes`, so a head crushed to 0.25 in Y automatically stretches
the face over the flatter shape. Capture before going further — that alone may
be most of the effect.

- [ ] **Step 2: Sag the projection**

In the face block, offset and stretch the UV by `meltCfg.x` (the uniform Task 6
added) so features slide DOWN the front of the skull as the flesh drips:

```wgsl
    // Melt drips the face off the skull. The V offset alone would slide a
    // rigid face downward like a sticker; the paired stretch is what makes
    // the features ELONGATE on the way, which is the part that reads as
    // melting rather than sliding.
    let meltSag = meltCfg.x;
    var uv = raw * faceProj.xy + faceProj.zw;
    uv.y = uv.y - meltSag * FACE_MELT_SAG + (uv.y - faceProj.w) * meltSag * FACE_MELT_STRETCH;
```

Start at `FACE_MELT_SAG = 0.25`, `FACE_MELT_STRETCH = 0.6` and tune from
captures. Both are shader constants — name them, do not inline the numbers.

- [ ] **Step 3: Widen the facing fade as it melts**

The projection fades out by `smoothstep(0.28, 0.66, dot(n, hfr))` so it does not
smear a second face around the skull. A melted head is much flatter, so its
surface turns away from the head's forward axis far sooner and the face fades
out early — the features vanish before they have finished dripping. Widen the
lower bound toward 0 as `meltCfg.x` rises so the face survives onto the
sagging surface, and say in the capture report whether it smears round the
back; if it does, the fade was widened too far.

- [ ] **Step 4: Add a shader test**

Assert the emitted WGSL references `meltCfg` inside the face block, the same way
Task 6 asserts it in the flesh branch. A face-melt uniform that is declared and
never read is the failure this whole plan keeps guarding against.

- [ ] **Step 5: Capture and judge**

Run `npm run melt:shot`. Read the frames. The face must sag and elongate over
the melting skull rather than sliding down it rigidly or vanishing early, and
the skull underneath must be visible through it by the late frames.

Both gates must still pass — the face is shading, so it must not move the
silhouette numbers at all. **If Gate A or B changes, something in Step 1 altered
geometry and that is a bug**, not a tuning question.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/
git commit -m "melt: the face drips off the skull

The projection was anchored to the UNMELTED body — headShape(posed) and
uploadWounds(posed.prims) both pinned the face and every wound to where the
standing zombie was while the zombie liquefied out from under them. Same class
of bug as the stale clusters. One melted body now feeds the whole frame.

That alone stretches the face over the flattened skull, because the projection
normalises by headAxes. On top of it, meltCfg sags the V and stretches it: the
offset alone would slide a rigid face down like a sticker, and the elongation
is the half that reads as melting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done

- `npx vitest run` green, `npx tsc --noEmit` clean
- The capture gate passes: height ≤ 40%, width ≥ 150%, centroid ≤ 25%
- Frames read as: red while standing → straight-down sag with stretch → skeleton emerging → wide wet puddle with bones in it
- The body never topples
- `TASKS.md` `X5.melt` closed with the mechanism change recorded
- The face sags and elongates over the melting skull (Task 8), and the gates are unchanged by it
- Notes in `docs/dev-notes/2026-09-03-zombie-melt/notes.md` with frames
