# SDF Zombie — Face, Carving, and PSX Surface: Implementation Plan (Phases 0–1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the SDF zombie lab through the game's real post-fx chain, measure what it actually costs, then give the zombie a carved parametric face with live sliders.

**Architecture:** Phase 0 wires the existing `EffectComposer` into the lab and adds instrumentation. Phase 1 adds subtractive primitives (`op: 'sub'`) that carve **after** the complete additive smooth-min fold, plus a pure `face.ts` that turns named parameters into primitive definitions.

**Tech Stack:** TypeScript, Three.js r170, GLSL ES 3.00, Vitest.

**Spec:** [../specs/2026-08-15-sdf-zombie-face-psx-design.md](../specs/2026-08-15-sdf-zombie-face-psx-design.md)

**Scope:** Phase 2 (rest-space coordinates and the three detail stacks) is deliberately **not** planned here. Its design depends on what Phase 0 reveals about how much subtlety the palette snap destroys.

---

## Before you start

**Worktree setup.** `node_modules` is gitignored and absent in a fresh worktree. Symlink it rather than installing:

```bash
ln -s /Users/donny/Projects/blud/node_modules node_modules
```

**Two project-wide traps that will bite you:**

1. **`noUncheckedIndexedAccess: true`** is on. Every indexed access needs `!` or a guard — `u.uPrimA!.value`, `prims[i]!`, `arr[0]!`. Plan snippets below already do this; keep it up in code you add.
2. **Nothing in this toolchain compiles GLSL.** `tsc --noEmit` and the whole vitest suite pass while the fragment shader fails to link and the page renders *nothing*. This has already burned this project through eight consecutive green tasks. **After every task that touches `march.glsl.ts`, load the page and look at it.** The task's own verification step says so explicitly. Do not skip it, and do not treat green tests as evidence.

**Run the lab:** `npm run dev` → `http://localhost:5173/sdf-lab.html` (a `.claude/launch.json` in this worktree pins it to 5183).

**Full verification, run after every task:**

```bash
npm run build && npm test
```

Expect `tsc --noEmit` clean, a successful vite build, and **706 tests passing** at the start of this plan.

---

## File structure

| File | Change | Responsibility |
| --- | --- | --- |
| `src/lab/sdf-zombie/lab-main.ts` | modify | Composer wiring, perf HUD, N-body spawner, face sliders, head-focus camera |
| `src/lab/sdf-zombie/perf-hud.ts` | **create** | Frame-time + GPU-time sampling and its DOM readout. Pure-ish; no lab knowledge |
| `src/lab/sdf-zombie/types.ts` | modify | `op`, `offset`, `mirrorOffset` on `PrimDef`; `op` on `Primitive` |
| `src/lab/sdf-zombie/mirror.ts` | modify | Expand `mirrorOffset` into a ±x pair on a non-mirrored bone |
| `src/lab/sdf-zombie/resolve.ts` | modify | Apply `offset`; carry `op` through placement |
| `src/lab/sdf-zombie/clusters.ts` | modify | Exclude carves from bounding-sphere fitting |
| `src/lab/sdf-zombie/pack.ts` | modify | Encode carve as the sign of packed `blendK` |
| `src/lab/sdf-zombie/validate.ts` | modify | `MAX_PRIMS` 48; carve-aware `sdBody`; `smax`; carve-aware checks |
| `src/lab/sdf-zombie/march.glsl.ts` | modify | Import the shared caps; skip carves in the fold; `applyCarves` after it |
| `src/lab/sdf-zombie/damage.ts` | modify | Never bind a wound to a carve |
| `src/lab/sdf-zombie/sever.ts` | modify | Never anchor a stump to a carve |
| `src/lab/sdf-zombie/zombie.ts` | modify | `chunkExtent` ignores carves |
| `src/lab/sdf-zombie/face.ts` | **create** | `FaceParams → PrimDef[]`. Pure, no Three, no GL |
| `src/lab/sdf-zombie/body.ts` | modify | Split into a base def plus `makeZombie(face)` |
| `src/lab/sdf-zombie/panel.ts` | modify | `faceParams` in the persisted override; face slider spec list |
| `sdf-lab.html` | modify | Mount point for the perf HUD |

Tests are co-located as `*.test.ts` beside each module, matching the existing convention.

---

# PHASE 0 — Presentation and instrumentation

## Task 1: Render the lab through the game's post-fx composer

The lab has never done this. `createRenderer` exposes `setDrawFn` to swap in an `EffectComposer` and only `src/main.ts` calls it, so the lab has been running plain `renderer.render(scene, camera)` — no Bayer dither, no BLOOD.PAL snap, no scanlines. Every aesthetic judgment on record was made through the wrong chain.

**Files:**
- Modify: `src/lab/sdf-zombie/lab-main.ts`

- [ ] **Step 1: Add the composer imports**

At the top of `lab-main.ts`, beside the existing imports:

```ts
import { createPostFxComposer } from '../../vfx/post-fx/composer';
import { PostFxBus } from '../../vfx/post-fx/post-fx-bus';
import { DEFAULT_POST_FX } from '../../vfx/post-fx/config';
```

- [ ] **Step 2: Build the composer and install it as the draw function**

Insert immediately after the `refCube` block (around line 47, before `let override = loadOverride();`):

```ts
// ---------------------------------------------------------------------------
// Post-FX. The lab ran without this until 2026-08-15, so every look judgment
// before then was made in a clean viewport the real game never shows.
// `cfg` is read by the composer every frame, so mutating it live works.
// ---------------------------------------------------------------------------
const postCfg = structuredClone(DEFAULT_POST_FX);
const postBus = new PostFxBus(postCfg.ca.baseline);
const composer = createPostFxComposer(renderer, scene, camera, postBus, postCfg);
let postEnabled = true;

function installDrawFn() {
  handle.setDrawFn(
    postEnabled
      ? () => composer.render(0, performance.now() / 1000)
      : () => renderer.render(scene, camera),
  );
}
installDrawFn();

// createRenderer's own resize handler knows nothing about the composer.
window.addEventListener('resize', () => {
  composer.setSize(renderer.domElement.width, renderer.domElement.height);
});
composer.setSize(renderer.domElement.width, renderer.domElement.height);
```

- [ ] **Step 3: Add the bypass toggle to the panel**

In the `actions` section of the panel (after the existing `reset overrides` button, around line 381), add:

```ts
const postBtn = addButton(actionBox, 'post-fx: on', () => {
  postEnabled = !postEnabled;
  installDrawFn();
  postBtn.textContent = `post-fx: ${postEnabled ? 'on' : 'off'}`;
});
```

`addButton` returns the element, so the handler can relabel its own button — hold the reference in a `const` rather than using an anonymous closure, which cannot see itself.

Without a bypass, debugging a surface bug means guessing whether an artifact came from the shader or the palette snap.

- [ ] **Step 4: Verify the build**

Run: `npm run build && npm test`
Expected: tsc clean, vite build succeeds, 706 tests pass.

- [ ] **Step 5: HUMAN VISUAL CHECK — this is the point of the task**

Load `http://localhost:5183/sdf-lab.html` and confirm all of:

1. The zombie still renders (a black page means the composer broke depth compositing).
2. The image is visibly **dithered and palette-snapped** — colour banding with an ordered dot pattern, not smooth gradients.
3. The `post-fx: on` button toggles between the two looks and relabels itself.
4. **Zero shader-link errors in the console.**
5. Shooting still works and craters still appear (the composer must not eat `gl_FragDepth` compositing).

Write down whether the zombie looks better or worse through the real chain. That observation is the deliverable of Phase 0 and it directly feeds Phase 2's design.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/lab-main.ts
git commit -m "feat(sdf-lab): render through the game's post-fx chain

The lab never called setDrawFn, so it ran plain renderer.render with no
dither, no BLOOD.PAL snap, no scanlines — while the spec claimed otherwise
and warned that a raymarcher judged in a clean viewport would lie about how
it looks in Blud. It did. Adds a bypass toggle so shader bugs can be told
apart from palette-snap artifacts."
```

---

## Task 2: Perf HUD and N-body spawner

Single-body cost is currently unmeasured: the lab reports 16.7 ms median / 17.6 ms p95, pinned at vsync. That is a GPU finishing early and waiting, not a headroom number.

**Files:**
- Create: `src/lab/sdf-zombie/perf-hud.ts`
- Create: `src/lab/sdf-zombie/perf-hud.test.ts`
- Modify: `sdf-lab.html`, `src/lab/sdf-zombie/lab-main.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/perf-hud.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeSampler } from './perf-hud';

describe('perf sampler', () => {
  it('reports the median and p95 of the samples it was given', () => {
    const s = makeSampler(8);
    for (const ms of [10, 12, 11, 40, 10, 11, 12, 10]) s.push(ms);
    const r = s.stats();
    expect(r.median).toBeCloseTo(11, 5);
    expect(r.p95).toBeCloseTo(40, 5);
  });

  it('keeps only the most recent `capacity` samples', () => {
    const s = makeSampler(3);
    for (const ms of [100, 100, 100, 5, 5, 5]) s.push(ms);
    expect(s.stats().median).toBeCloseTo(5, 5);
  });

  it('reports zeroes rather than NaN before any sample arrives', () => {
    expect(makeSampler(4).stats()).toEqual({ median: 0, p95: 0, count: 0 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/perf-hud.test.ts`
Expected: FAIL — `Failed to resolve import "./perf-hud"`.

- [ ] **Step 3: Write `perf-hud.ts`**

Create `src/lab/sdf-zombie/perf-hud.ts`:

```ts
// src/lab/sdf-zombie/perf-hud.ts
// Frame-time and GPU-time instrumentation for the lab.
//
// Exists because a vsync-locked frame time is NOT a headroom measurement: if
// p95 == median == the refresh interval, the meter is telling you only that
// you have not yet blown the budget. The N-body spawner in lab-main.ts is the
// real instrument; this module is the readout.

export interface Stats { median: number; p95: number; count: number }

export interface Sampler {
  push(ms: number): void;
  stats(): Stats;
}

/** Fixed-capacity ring of timing samples. */
export function makeSampler(capacity: number): Sampler {
  const buf: number[] = [];
  return {
    push(ms) {
      buf.push(ms);
      if (buf.length > capacity) buf.shift();
    },
    stats() {
      if (buf.length === 0) return { median: 0, p95: 0, count: 0 };
      const s = [...buf].sort((a, b) => a - b);
      const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
      return { median: at(0.5), p95: at(0.95), count: s.length };
    },
  };
}

/**
 * Wraps EXT_disjoint_timer_query_webgl2. Returns null when unavailable, in
 * which case callers fall back to CPU frame time alone.
 *
 * One query is in flight at a time; results arrive a frame or more later, so
 * `poll()` must be called every frame and may return null.
 */
export interface GpuTimer {
  begin(): void;
  end(): void;
  /** Milliseconds of the most recently completed query, or null if none is ready. */
  poll(): number | null;
}

export function makeGpuTimer(gl: WebGL2RenderingContext): GpuTimer | null {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as
    { TIME_ELAPSED_EXT: number } | null;
  if (!ext) return null;

  let active: WebGLQuery | null = null;
  let pending: WebGLQuery | null = null;

  return {
    begin() {
      if (active || pending) return; // one in flight at a time
      active = gl.createQuery();
      if (active) gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
    },
    end() {
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending = active;
      active = null;
    },
    poll() {
      if (!pending) return null;
      const done = gl.getQueryParameter(pending, gl.QUERY_RESULT_AVAILABLE) as boolean;
      const disjoint = gl.getParameter(0x8FBB) as boolean; // GPU_DISJOINT_EXT
      if (!done) return null;
      const ns = disjoint ? null : (gl.getQueryParameter(pending, gl.QUERY_RESULT) as number);
      gl.deleteQuery(pending);
      pending = null;
      return ns === null ? null : ns / 1e6;
    },
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lab/sdf-zombie/perf-hud.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Add the HUD element to the page**

In `sdf-lab.html`, add to the `<style>` block:

```css
  #perf {
    position: fixed; top: 8px; left: 8px; z-index: 10;
    background: rgba(0,0,0,0.68); padding: 6px 9px; border: 1px solid #444;
    font-size: 11px; line-height: 1.5; color: #9c9; white-space: pre;
  }
```

And immediately after the `<div id="controls">…</div>` block:

```html
  <div id="perf"></div>
```

- [ ] **Step 6: Wire the HUD and the N-body spawner into `lab-main.ts`**

Add the import beside the others:

```ts
import { makeGpuTimer, makeSampler } from './perf-hud';
```

Add after the composer block from Task 1:

```ts
// ---------------------------------------------------------------------------
// Instrumentation. `extraBodies` exists to push past vsync — that is the only
// way to find out what one zombie actually costs.
// ---------------------------------------------------------------------------
const perfEl = document.getElementById('perf');
const cpuSamples = makeSampler(120);
const gpuSamples = makeSampler(120);
const gpuTimer = makeGpuTimer(renderer.getContext() as WebGL2RenderingContext);
let lastFrameStamp = performance.now();

/** Clones of the body view, purely to measure how cost scales with count. */
const extraBodies: ZombieView[] = [];

function setExtraBodies(n: number) {
  while (extraBodies.length > n) {
    const v = extraBodies.pop();
    if (v) scene.remove(v.object);
  }
  while (extraBodies.length < n) {
    const v = createZombieView(current);
    v.applyMaterial(flesh, LIGHT_PRESETS[light]);
    // Fan them out sideways so they overlap on screen — overlap is the actual
    // scaling hazard, since gl_FragDepth + discard defeat early-Z and every
    // occluded body marches anyway.
    v.object.position.x = (extraBodies.length + 1) * 0.55;
    scene.add(v.object);
    extraBodies.push(v);
  }
}
```

`ZombieView` is already exported from `./zombie`; add it to that import if it is not already named there.

- [ ] **Step 7: Sample every frame**

Inside the existing `handle.setRenderCallback((dt) => { … })`, add at the very top:

```ts
  const now = performance.now();
  cpuSamples.push(now - lastFrameStamp);
  lastFrameStamp = now;
  const gpuMs = gpuTimer?.poll();
  if (gpuMs != null) gpuSamples.push(gpuMs);
  gpuTimer?.begin();
```

and at the very bottom of the same callback:

```ts
  gpuTimer?.end();
  const c = cpuSamples.stats();
  const g = gpuSamples.stats();
  if (perfEl)
    perfEl.textContent =
      `bodies ${1 + extraBodies.length}  chunks ${chunks.length}\n` +
      `cpu  ${c.median.toFixed(1)} / ${c.p95.toFixed(1)} ms (p50/p95)\n` +
      `gpu  ${g.count ? `${g.median.toFixed(2)} / ${g.p95.toFixed(2)} ms` : 'n/a'}`;
```

The extra bodies must also be stepped so they are not static — inside the same callback, after the existing `view.update(posed)`:

```ts
  for (const v of extraBodies) v.update(posed);
```

- [ ] **Step 8: Add the spawner control to the panel**

In the `actions` section:

```ts
addSlider(actionBox, {
  label: 'extra bodies', min: 0, max: 12, step: 1,
  get: () => extraBodies.length,
  set: (v) => setExtraBodies(Math.round(v)),
});
```

- [ ] **Step 9: Verify the build**

Run: `npm run build && npm test`
Expected: tsc clean, build succeeds, **709 tests pass** (706 + 3 new).

- [ ] **Step 10: HUMAN MEASUREMENT — the deliverable**

Load the lab and record, in `docs/dev-notes/`:

1. GPU ms for **one** body (the number nobody has ever had).
2. GPU ms at 2, 4, 8 and 12 bodies. Note where CPU p50 leaves 16.7 ms — that is the real budget.
3. Whether GPU time scales **linearly** with body count or worse. Worse than linear confirms the overlap hazard.
4. Repeat at 12 bodies with them dragged apart so they do **not** overlap on screen. The gap between overlapping and non-overlapping at the same count is the size of the prize `EXT_conservative_depth` is competing for.

- [ ] **Step 11: Commit**

```bash
git add src/lab/sdf-zombie/perf-hud.ts src/lab/sdf-zombie/perf-hud.test.ts sdf-lab.html src/lab/sdf-zombie/lab-main.ts
git commit -m "feat(sdf-lab): perf HUD and N-body spawner

Single-body cost was unmeasured — the lab sat vsync-locked at 59.9fps,
which hides whether one zombie uses 5% or 80% of the frame. Adds CPU frame
time, GPU time via EXT_disjoint_timer_query_webgl2, and a spawner that
pushes past vsync so the cost curve is observable. Extra bodies overlap on
screen by default, since overlap rather than count is the scaling hazard."
```

---

# PHASE 1 — Carving and the face

## Task 3: Single-source the shader caps and raise `MAX_PRIMS` to 48

`MAX_PRIMS` is currently declared **twice** — `validate.ts:6` and `march.glsl.ts:14` — and they must agree or the shader silently reads past the uniform array. The face needs ~13 more primitives on a body that already uses 21, so 32 is not enough.

**Files:**
- Modify: `src/lab/sdf-zombie/validate.ts:6-8`, `src/lab/sdf-zombie/march.glsl.ts:14-15`
- Test: `src/lab/sdf-zombie/validate.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lab/sdf-zombie/validate.test.ts`:

```ts
import { FRAG } from './march.glsl';

describe('shader caps', () => {
  it('bakes the same MAX_PRIMS into the shader that the CPU side enforces', () => {
    expect(FRAG).toContain(`#define MAX_PRIMS ${MAX_PRIMS}`);
    expect(FRAG).toContain(`#define MAX_CLUSTERS ${MAX_CLUSTERS}`);
  });

  it('has room for the body plus a face', () => {
    expect(MAX_PRIMS).toBeGreaterThanOrEqual(40);
  });
});
```

`MAX_PRIMS` and `MAX_CLUSTERS` are already imported at the top of that file; add them to the import if not.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/validate.test.ts`
Expected: FAIL — `MAX_PRIMS` is 32, so the second test fails.

- [ ] **Step 3: Raise the cap in `validate.ts`**

Replace lines 5–8 of `src/lab/sdf-zombie/validate.ts`:

```ts
/**
 * Shader array ceilings. THE canonical declaration — `march.glsl.ts` imports
 * these and bakes them into the GLSL, so the two can never drift apart.
 *
 * 48 fits the 21-primitive body plus a ~13-primitive face with headroom. The
 * cost is uniform space: at 48 the fragment shader uses roughly 300 vec4,
 * against a GLES 3.0 guaranteed minimum of 224. The development machine
 * reports 1024, so this is a portability note rather than a blocker — see the
 * risks section of the spec for the data-texture escape hatch.
 */
export const MAX_PRIMS = 48;
export const MAX_CLUSTERS = 6;
```

- [ ] **Step 4: Make the shader import them**

In `src/lab/sdf-zombie/march.glsl.ts`, delete lines 14–15:

```ts
export const MAX_PRIMS = 32;
export const MAX_CLUSTERS = 6;
```

and replace with a re-export from the canonical source. Add at the top of the file, under the existing header comment:

```ts
import { MAX_CLUSTERS, MAX_PRIMS } from './validate';

// Re-exported so existing importers of march.glsl keep working. `validate.ts`
// is the single source of truth — a second declaration here is exactly how the
// CPU field and the GPU field drift apart.
export { MAX_CLUSTERS, MAX_PRIMS };
```

`validate.ts` does not import `march.glsl.ts`, so this creates no cycle.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npm test`
Expected: PASS — 711 tests (709 + 2 new).

- [ ] **Step 6: HUMAN VISUAL CHECK**

Load the lab. The zombie must render **exactly as before** — this task changes only array sizes. A blank page means the larger uniform arrays broke the link; check the console.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/validate.ts src/lab/sdf-zombie/march.glsl.ts src/lab/sdf-zombie/validate.test.ts
git commit -m "refactor(sdf-lab): single-source the shader caps, raise MAX_PRIMS to 48

MAX_PRIMS was declared in both validate.ts and march.glsl.ts; if they drift
the shader reads past the uniform array. march.glsl.ts now imports and
re-exports the canonical pair. 48 leaves room for a ~13-primitive face on
top of the 21-primitive body."
```

---

## Task 4: `op`, `offset` and `mirrorOffset` on `PrimDef`

Three additions, all needed before a face can exist:

- **`op: 'sub'`** marks a carve.
- **`offset`** displaces a primitive off its bone axis. Every face feature needs this — a nose is not on the skull's centreline.
- **`mirrorOffset`** emits a ±x pair on a **non-mirrored** bone. The existing `mirror: true` requires a *mirrored bone* and throws `mirrored prim references non-mirrored bone "skull"` otherwise, so it cannot make a pair of eye sockets.

**Files:**
- Modify: `src/lab/sdf-zombie/types.ts`, `src/lab/sdf-zombie/mirror.ts`, `src/lab/sdf-zombie/resolve.ts`
- Test: `src/lab/sdf-zombie/mirror.test.ts`, `src/lab/sdf-zombie/resolve.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lab/sdf-zombie/mirror.test.ts`:

```ts
describe('mirrorOffset', () => {
  const base = {
    name: 'test', root: [0, 1, 0] as Vec3,
    bones: [{ name: 'skull', parent: null, dir: [0, 1, 0] as Vec3, length: 0.2 }],
  };

  it('emits a +x and a -x copy on a bone that was never mirrored', () => {
    const out = expandMirror({
      ...base,
      prims: [{
        bone: 'skull', at: 0.5, radius: 0.03, scale: [1, 1, 1], blendK: 0.01,
        limb: 'head', offset: [0.04, 0.01, -0.05], mirrorOffset: true,
      }],
    });
    expect(out.prims).toHaveLength(2);
    expect(out.prims[0]!.offset).toEqual([0.04, 0.01, -0.05]);
    expect(out.prims[1]!.offset).toEqual([-0.04, 0.01, -0.05]);
    // Both stay in the head cluster — fold order must not gain a new cluster.
    expect(out.prims.every(p => p.limb === 'head')).toBe(true);
  });

  it('carries op through expansion', () => {
    const out = expandMirror({
      ...base,
      prims: [{
        bone: 'skull', at: 0.5, radius: 0.03, scale: [1, 1, 1], blendK: 0.01,
        limb: 'head', op: 'sub', offset: [0.04, 0, 0], mirrorOffset: true,
      }],
    });
    expect(out.prims.every(p => p.op === 'sub')).toBe(true);
  });

  it('rejects a prim that asks for both mirror modes', () => {
    expect(() => expandMirror({
      ...base,
      prims: [{
        bone: 'skull', at: 0.5, radius: 0.03, scale: [1, 1, 1], blendK: 0.01,
        limb: 'head', mirror: true, mirrorOffset: true,
      }],
    })).toThrow(/both mirror and mirrorOffset/);
  });
});
```

Append to `src/lab/sdf-zombie/resolve.test.ts`:

```ts
describe('placePrims with offset', () => {
  const bones = new Map([['skull', { head: [0, 1, 0] as Vec3, tail: [0, 1.2, 0] as Vec3 }]]);

  it('displaces both endpoints by the offset', () => {
    const [p] = placePrims([{
      bone: 'skull', at: 0.5, radius: 0.03, scale: [1, 1, 1], blendK: 0.01,
      limb: 'head', offset: [0.05, 0, -0.02],
    }], bones);
    expect(p!.a).toEqual([0.05, 1.1, -0.02]);
    expect(p!.b).toEqual([0.05, 1.1, -0.02]);
  });

  it('defaults op to add and passes sub through', () => {
    const [add] = placePrims([{
      bone: 'skull', at: 0.5, radius: 0.03, scale: [1, 1, 1], blendK: 0.01, limb: 'head',
    }], bones);
    const [sub] = placePrims([{
      bone: 'skull', at: 0.5, radius: 0.03, scale: [1, 1, 1], blendK: 0.01,
      limb: 'head', op: 'sub',
    }], bones);
    expect(add!.op).toBe('add');
    expect(sub!.op).toBe('sub');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lab/sdf-zombie/mirror.test.ts src/lab/sdf-zombie/resolve.test.ts`
Expected: FAIL — TypeScript rejects `offset`/`mirrorOffset`/`op`; `p.op` is undefined.

- [ ] **Step 3: Extend the types**

In `src/lab/sdf-zombie/types.ts`, add to `PrimDef` (after `mirror?: boolean;`):

```ts
  /**
   * 'sub' carves this primitive out of the assembled field instead of adding
   * to it. Carves are applied AFTER the complete additive fold — see the
   * comment on applyCarves in march.glsl.ts for why not per-cluster.
   */
  op?: 'add' | 'sub';
  /**
   * Displacement from the bone-relative placement, in world axes. The body is
   * authored in a rest pose with no rotations, so world axes and bone axes
   * coincide at authoring time.
   */
  offset?: Vec3;
  /**
   * Emits two copies with `offset.x` negated. Use for bilateral features on a
   * bone that is NOT itself mirrored — eye sockets on the skull. Distinct from
   * `mirror`, which requires a mirrored bone and throws without one.
   */
  mirrorOffset?: boolean;
```

And add to `Primitive` (after `cluster: number;`):

```ts
  /**
   * Optional rather than required so the many existing test fixtures that
   * build Primitive literals keep compiling. Absent means 'add'.
   */
  op?: 'add' | 'sub';
```

- [ ] **Step 4: Expand `mirrorOffset` in `mirror.ts`**

Change the `ExpandedPrim` type (line 5):

```ts
export interface ExpandedPrim extends Omit<PrimDef, 'limb' | 'mirror' | 'mirrorOffset'> {
  limb: LimbId;
}
```

Replace the prim loop (lines 66–74) with:

```ts
  const prims: ExpandedPrim[] = [];
  for (const p of def.prims) {
    const { mirror, mirrorOffset, limb, ...rest } = p;

    if (mirror && mirrorOffset)
      throw new Error(`prim on bone "${p.bone}" sets both mirror and mirrorOffset`);

    // Bilateral by OFFSET: one bone, two prims either side of its axis. This is
    // how a face gets two eye sockets, since `skull` is not a mirrored bone and
    // `mirror: true` would throw on it.
    if (mirrorOffset) {
      const off = rest.offset ?? ([0, 0, 0] as const);
      const side = limbFor(limb, null);
      prims.push({ ...rest, offset: [off[0], off[1], off[2]], limb: side });
      prims.push({ ...rest, offset: [-off[0], off[1], off[2]], limb: side });
      continue;
    }

    if (!mirror) { prims.push({ ...rest, limb: limbFor(limb, null) }); continue; }
    if (!mirroredBoneNames.has(p.bone))
      throw new Error(`mirrored prim references non-mirrored bone "${p.bone}"`);
    prims.push({ ...rest, bone: `${p.bone}.l`, limb: limbFor(limb, 'l') });
    prims.push({ ...rest, bone: `${p.bone}.r`, limb: limbFor(limb, 'r') });
  }
```

- [ ] **Step 5: Apply the offset in `resolve.ts`**

Replace the body of `placePrims` (lines 40–52):

```ts
  return prims.map(p => {
    const bone = bones.get(p.bone);
    if (!bone) throw new Error(`prim references unknown bone "${p.bone}"`);
    const off = p.offset ?? ([0, 0, 0] as const);
    const shift = (v: Vec3): Vec3 => [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
    const a = shift(lerp(bone.head, bone.tail, p.at));
    const b = p.capTo === undefined ? a : shift(lerp(bone.head, bone.tail, p.capTo));
    return {
      a, b,
      radius: p.radius,
      scale: p.scale,
      blendK: p.blendK,
      limb: p.limb as LimbId,
      op: p.op ?? 'add',
    };
  });
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npm test`
Expected: PASS — 716 tests (711 + 5 new).

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/types.ts src/lab/sdf-zombie/mirror.ts src/lab/sdf-zombie/resolve.ts src/lab/sdf-zombie/mirror.test.ts src/lab/sdf-zombie/resolve.test.ts
git commit -m "feat(sdf-lab): op, offset and mirrorOffset on PrimDef

A face needs primitives off the bone centreline, carved rather than added,
and bilateral on a bone that is not itself mirrored. The existing mirror
flag requires a mirrored bone and throws on 'skull', so it cannot produce a
pair of eye sockets. Primitive.op is optional so existing fixtures compile."
```

---

## Task 5: Exclude carves from cluster bounding spheres

The shader culls a cluster by its bounding sphere. A carve is a hole; including it inflates the bound and defeats the cull for no benefit.

**Files:**
- Modify: `src/lab/sdf-zombie/clusters.ts:28-40`
- Test: `src/lab/sdf-zombie/clusters.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lab/sdf-zombie/clusters.test.ts`:

```ts
it('fits bounds to solid primitives only, ignoring carves', () => {
  const solid = {
    a: [0, 0, 0] as Vec3, b: [0, 0, 0] as Vec3,
    radius: 0.1, scale: [1, 1, 1] as Vec3, blendK: 0.01, limb: 'head' as const,
  };
  const withoutCarve = assignClusters([solid]);
  const withCarve = assignClusters([
    solid,
    // A carve far off to the side would balloon a naive bound.
    { ...solid, a: [5, 0, 0] as Vec3, b: [5, 0, 0] as Vec3, op: 'sub' as const },
  ]);
  expect(withCarve.clusters[0]!.radius).toBeCloseTo(withoutCarve.clusters[0]!.radius, 6);
  expect(withCarve.clusters[0]!.center).toEqual(withoutCarve.clusters[0]!.center);
  // The carve still belongs to the cluster's contiguous run — fold order intact.
  expect(withCarve.clusters[0]!.count).toBe(2);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/clusters.test.ts`
Expected: FAIL — radius is ~5.1 rather than ~0.1.

- [ ] **Step 3: Fit bounds to solids only**

In `src/lab/sdf-zombie/clusters.ts`, replace lines 28–40:

```ts
    const members = sorted.slice(start, i);
    // Carves are holes, not surface. Including them in the bound inflates it
    // and defeats the shader's cluster cull for no gain. `start`/`count` still
    // span every member, carves included — the fold order requires that run to
    // be contiguous.
    const solid = members.filter(p => p.op !== 'sub');
    const fitTo = solid.length > 0 ? solid : members;

    let sum: Vec3 = [0, 0, 0];
    for (const p of fitTo) sum = add(sum, add(p.a, p.b));
    const center = vscale(sum, 1 / (fitTo.length * 2));

    let radius = 0;
    for (const p of fitTo) {
      const maxScale = Math.max(p.scale[0], p.scale[1], p.scale[2]);
      for (const end of [p.a, p.b])
        radius = Math.max(radius, len(sub(end, center)) + p.radius * maxScale);
    }
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm test`
Expected: PASS — 717 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/clusters.ts src/lab/sdf-zombie/clusters.test.ts
git commit -m "feat(sdf-lab): fit cluster bounds to solid primitives only

A carve is a hole; including it in the bounding sphere inflates the bound
and defeats the shader's cull. start/count still span every member so the
contiguous fold run is unchanged."
```

---

## Task 6: Encode carves as the sign of the packed blend constant

`uPrimB[i].w` carries `blendK`, always positive. Negating it marks a carve at zero extra uniform bandwidth — which matters, because fill rate is the binding cost and every extra uniform array is more per-step traffic.

**Files:**
- Modify: `src/lab/sdf-zombie/pack.ts:26-32`
- Test: `src/lab/sdf-zombie/pack.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lab/sdf-zombie/pack.test.ts`:

```ts
it('packs a carve as a negative blend constant', () => {
  const prim = {
    a: [0, 0, 0] as Vec3, b: [0, 0, 0] as Vec3, radius: 0.1,
    scale: [1, 1, 1] as Vec3, blendK: 0.02, limb: 'head' as const, cluster: 0,
  };
  const packed = packBody({
    prims: [prim, { ...prim, op: 'sub' as const }],
    clusters: [{ id: 0, limb: 'head', start: 0, count: 2, center: [0, 0, 0], radius: 0.1, alive: true }],
    bones: new Map(),
  });
  expect(packed.primB[3]).toBeCloseTo(0.02, 6);   // additive
  expect(packed.primB[7]).toBeCloseTo(-0.02, 6);  // carve
  // The cull margin must stay positive — it is a distance, not a signed blend.
  expect(packed.maxBlendK).toBeCloseTo(0.02, 6);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/pack.test.ts`
Expected: FAIL — `primB[7]` is `0.02`, not `-0.02`.

- [ ] **Step 3: Encode the sign**

In `src/lab/sdf-zombie/pack.ts`, replace the `forEach` body (lines 26–32):

```ts
  let maxBlendK = 0;
  body.prims.forEach((p, i) => {
    const o = i * PRIM_STRIDE;
    // A NEGATIVE packed blendK means "carve this primitive out". The shader
    // reads the sign to split the fold from the carve pass — see mapBody and
    // applyCarves in march.glsl.ts. Encoding it in the sign rather than a
    // fourth uniform array keeps per-step uniform traffic flat, and fill rate
    // is the binding cost of this renderer.
    const k = p.op === 'sub' ? -p.blendK : p.blendK;
    primA.set([p.a[0], p.a[1], p.a[2], p.radius], o);
    primB.set([p.b[0], p.b[1], p.b[2], k], o);
    primScale.set([p.scale[0], p.scale[1], p.scale[2], p.cluster], o);
    // Cull margin is a distance: always the magnitude, never the sign.
    if (p.blendK > maxBlendK) maxBlendK = p.blendK;
  });
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm test`
Expected: PASS — 718 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/pack.ts src/lab/sdf-zombie/pack.test.ts
git commit -m "feat(sdf-lab): pack carves as a negative blend constant

blendK is always positive, so its sign is free carrying capacity for the
add/sub flag. Avoids a fourth per-primitive uniform array, which matters
because this renderer is fill-rate bound and pays for uniform traffic on
every march step."
```

---

## Task 7: Carve in the shader — and mirror it on the CPU

The heart of the feature. Carves fold **after** the complete additive pass, in fixed cluster order, exactly as `applyWounds` already does.

**Files:**
- Modify: `src/lab/sdf-zombie/march.glsl.ts`, `src/lab/sdf-zombie/validate.ts`, `src/lab/sdf-zombie/zombie.ts`
- Test: `src/lab/sdf-zombie/validate.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lab/sdf-zombie/validate.test.ts`:

```ts
Extend that file's existing import to `import { validateBody, sdBody, MAX_PRIMS, MAX_CLUSTERS } from './validate';` — it currently pulls only `validateBody` and `MAX_PRIMS`.

```ts
describe('carving', () => {
  const ball = {
    a: [0, 0, 0] as Vec3, b: [0, 0, 0] as Vec3, radius: 0.2,
    scale: [1, 1, 1] as Vec3, blendK: 0.01, limb: 'head' as const, cluster: 0,
  };
  const cluster = (count: number) =>
    [{ id: 0, limb: 'head' as const, start: 0, count, center: [0, 0, 0] as Vec3, radius: 0.2, alive: true }];

  it('pushes the surface inward where a carve overlaps it', () => {
    const solid = { prims: [ball], clusters: cluster(1) };
    const carved = {
      prims: [ball, { ...ball, a: [0.2, 0, 0] as Vec3, b: [0.2, 0, 0] as Vec3, radius: 0.08, op: 'sub' as const }],
      clusters: cluster(2),
    };
    // A point just inside the sphere, under the carve, must now be OUTSIDE.
    const p: Vec3 = [0.17, 0, 0];
    expect(sdBody(p, solid)).toBeLessThan(0);
    expect(sdBody(p, carved)).toBeGreaterThan(0);
  });

  it('leaves the field untouched far from any carve', () => {
    const solid = { prims: [ball], clusters: cluster(1) };
    const carved = {
      prims: [ball, { ...ball, a: [0.2, 0, 0] as Vec3, b: [0.2, 0, 0] as Vec3, radius: 0.08, op: 'sub' as const }],
      clusters: cluster(2),
    };
    const far: Vec3 = [-0.19, 0, 0];
    expect(sdBody(far, carved)).toBeCloseTo(sdBody(far, solid), 6);
  });

  it('drops a cluster carves and all when it is severed', () => {
    const dead = [{ id: 0, limb: 'head' as const, start: 0, count: 2, center: [0, 0, 0] as Vec3, radius: 0.2, alive: false }];
    const body = {
      prims: [ball, { ...ball, a: [0.2, 0, 0] as Vec3, b: [0.2, 0, 0] as Vec3, radius: 0.08, op: 'sub' as const }],
      clusters: dead,
    };
    expect(sdBody([0, 0, 0], body)).toBeGreaterThan(1e8); // nothing left at all
  });
});

describe('shader/CPU field mirror', () => {
  it('carves in the shader too', () => {
    expect(FRAG).toContain('applyCarves');
    expect(FRAG).toContain('uCarveCount');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/validate.test.ts`
Expected: FAIL — carved and solid fields are identical; `FRAG` has no `applyCarves`.

- [ ] **Step 3: Carve on the CPU side**

In `src/lab/sdf-zombie/validate.ts`, add after `smin` (line 37):

```ts
/** Smooth subtraction. Must match the shader's smax exactly. */
export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}
```

and replace `sdBody` (lines 39–48):

```ts
/**
 * Field value over all live clusters, in fixed fold order.
 *
 * Two passes, and the order is load-bearing. Every ADDITIVE primitive folds
 * first, then every carve is subtracted from the assembled result. Carving
 * per-cluster instead would restructure a non-associative smooth-min fold and
 * change the surface everywhere, forcing a retune of every authored blendK.
 *
 * This mirrors mapBody + applyCarves in march.glsl.ts. It must stay in step:
 * this field also backs click-to-shoot raycasting, so drift means shots land
 * where the body isn't — or inside an eye socket.
 */
export function sdBody(p: Vec3, body: Body): number {
  let d = 1e9;
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (const prim of body.prims.slice(c.start, c.start + c.count)) {
      if (prim.op === 'sub') continue;
      d = smin(d, sdPrimitive(p, prim), prim.blendK);
    }
  }
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (const prim of body.prims.slice(c.start, c.start + c.count)) {
      if (prim.op !== 'sub') continue;
      d = smax(d, -sdPrimitive(p, prim), prim.blendK);
    }
  }
  return d;
}
```

- [ ] **Step 4: Skip carves in the shader's additive fold**

In `src/lab/sdf-zombie/march.glsl.ts`, inside `mapBody`, replace the inner primitive loop:

```glsl
    int start = int(range.x), count = int(range.y);
    for (int i = 0; i < MAX_PRIMS; i++) {
      if (i >= count) break;
      int idx = start + i;
      if (idx >= uPrimCount) break;
      float k = uPrimB[idx].w;
      if (k < 0.0) continue;                   // carve — handled by applyCarves
      d = smin(d, sdPrim(p, idx), k);
    }
```

- [ ] **Step 5: Add `applyCarves` and the carve counter**

Add the uniform declaration beside `uPrimCount` (around line 41):

```glsl
uniform int  uCarveCount;   // 0 lets the whole carve pass be skipped
```

Add `applyCarves` immediately **above** `mapBody`:

```glsl
/**
 * Carves every subtractive primitive out of the assembled field.
 *
 * Runs AFTER the complete additive fold, in fixed cluster order — the same
 * structure applyWounds uses. Carving per-cluster instead would restructure a
 * non-associative smooth-min fold, changing the surface everywhere and forcing
 * a retune of every authored blendK.
 *
 * Consequence worth knowing before authoring: a carve is NOT scoped to its
 * cluster. Geometrically it is safe today because the face carves sit inside
 * the skull and nothing else is within their radius. A future carve near a
 * cluster boundary would silently bite its neighbour.
 */
float applyCarves(float d, vec3 p) {
  if (uCarveCount == 0) return d;   // free when the body has no carves
  for (int c = 0; c < MAX_CLUSTERS; c++) {
    if (c >= uClusterCount) break;
    vec4 range = uClusterRange[c];
    if (range.z < 0.5) continue;              // severed — its carves leave with it
    int start = int(range.x), count = int(range.y);
    for (int i = 0; i < MAX_PRIMS; i++) {
      if (i >= count) break;
      int idx = start + i;
      if (idx >= uPrimCount) break;
      float k = uPrimB[idx].w;
      if (k >= 0.0) continue;                 // additive — already folded
      d = smax(d, -sdPrim(p, idx), -k);       // -k restores the magnitude
    }
  }
  return d;
}
```

And change the last line of `mapBody`:

```glsl
  return applyWounds(applyCarves(d, p), p) + fbm(p * 3.0) * uSilhouetteNoiseAmp;
```

Carves come first because they are part of the body's own definition; wounds are damage stamped on top of it.

- [ ] **Step 6: Feed `uCarveCount` from the packer**

In `src/lab/sdf-zombie/pack.ts`, add to `PackedBody`:

```ts
  /** How many packed primitives are carves. Zero lets the shader skip the pass. */
  carveCount: number;
```

Count it inside the existing `forEach` (add before `primA.set`):

```ts
    if (p.op === 'sub') carveCount++;
```

declaring `let carveCount = 0;` beside `let maxBlendK = 0;`, and add `carveCount` to the returned object.

In `src/lab/sdf-zombie/zombie.ts`, add to the uniforms block (beside `uPrimCount`):

```ts
      uCarveCount: { value: packed.carveCount },
```

and to `update()` (beside `u.uPrimCount!.value = p.primCount;`):

```ts
      u.uCarveCount!.value = p.carveCount;
```

and in `createChunkView`, beside `material.uniforms.uPrimCount`:

```ts
  material.uniforms.uCarveCount = { value: packed.carveCount };
```

A severed head must keep its face, and `createChunkView` already copies every primitive in the cluster — carves included — while `apply()` writes only `xyz` per endpoint, leaving the packed sign in `.w` intact.

- [ ] **Step 7: Run the tests and watch them pass**

Run: `npm test`
Expected: PASS — 722 tests (718 + 4 new).

- [ ] **Step 8: HUMAN VISUAL CHECK — mandatory, this task edits GLSL**

Load the lab. There are no carves authored yet, so:

1. The zombie must render **exactly as before**. Any visible change means the fold changed and the sign test is wrong.
2. **Zero shader-link errors in the console.** A blank page means `applyCarves` failed to compile — check it is declared *above* `mapBody`, since GLSL requires declaration before use.
3. Shooting, severing (`1`/`3`/`4`/`5`/`6`) and `G` all still work.

- [ ] **Step 9: Commit**

```bash
git add src/lab/sdf-zombie/march.glsl.ts src/lab/sdf-zombie/validate.ts src/lab/sdf-zombie/pack.ts src/lab/sdf-zombie/zombie.ts src/lab/sdf-zombie/validate.test.ts
git commit -m "feat(sdf-lab): subtractive primitives carved after the additive fold

Carves apply after the complete union, in fixed cluster order, mirroring
applyWounds. Carving per-cluster would restructure a non-associative
smooth-min fold and force a retune of every authored blendK. uCarveCount
lets the pass be skipped entirely on bodies with no carves, which keeps the
cost at zero for the gib chunks. sdBody mirrors it so click-to-shoot does
not land inside an eye socket."
```

---

## Task 8: Keep carves out of wounds, stumps and chunk extents

Three systems still treat a carve as if it were flesh.

**Files:**
- Modify: `src/lab/sdf-zombie/damage.ts:36-43`, `src/lab/sdf-zombie/sever.ts:41-44`, `src/lab/sdf-zombie/zombie.ts:150-157`
- Test: `src/lab/sdf-zombie/damage.test.ts`, `src/lab/sdf-zombie/sever.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lab/sdf-zombie/damage.test.ts`:

```ts
it('never binds a wound to a carve', () => {
  const solid = {
    a: [0, 0, 0] as Vec3, b: [0, 0, 0] as Vec3, radius: 0.2,
    scale: [1, 1, 1] as Vec3, blendK: 0.01, limb: 'head' as const, cluster: 0,
  };
  // The carve is nearer the hit, so a naive nearest-primitive search picks it.
  const carve = { ...solid, a: [0.5, 0, 0] as Vec3, b: [0.5, 0, 0] as Vec3, op: 'sub' as const };
  const w = worldHitToWound([solid, carve], [0.49, 0, 0], 0.05, 'pellet');
  expect(w.primIdx).toBe(0);
});
```

Append to `src/lab/sdf-zombie/sever.test.ts`:

```ts
it('anchors a stump to solid flesh rather than to a carve', () => {
  const mk = (limb: 'head' | 'torso', x: number, op?: 'sub') => ({
    a: [x, 0, 0] as Vec3, b: [x, 0, 0] as Vec3, radius: 0.1,
    scale: [1, 1, 1] as Vec3, blendK: 0.01, limb, cluster: limb === 'head' ? 0 : 1,
    ...(op ? { op } : {}),
  });
  const body = {
    prims: [mk('head', 0), mk('torso', 1, 'sub'), mk('torso', 2)],
    clusters: [
      { id: 0, limb: 'head' as const, start: 0, count: 1, center: [0, 0, 0] as Vec3, radius: 0.1, alive: true },
      { id: 1, limb: 'torso' as const, start: 1, count: 2, center: [1.5, 0, 0] as Vec3, radius: 0.6, alive: true },
    ],
    bones: new Map(),
    errors: [],
  };
  const { stumpWound } = severLimb(body, 'head');
  expect(stumpWound).not.toBeNull();
  expect(body.prims[stumpWound!.primIdx]!.op).not.toBe('sub');
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lab/sdf-zombie/damage.test.ts src/lab/sdf-zombie/sever.test.ts`
Expected: FAIL — the wound binds to index 1 (the carve); the stump anchors to the carve.

- [ ] **Step 3: Skip carves when binding a wound**

In `src/lab/sdf-zombie/damage.ts`, replace the search in `worldHitToWound` (lines 38–43):

```ts
  let primIdx = -1;
  let best = Infinity;
  prims.forEach((p, i) => {
    // A carve is a hole. A crater riding the inside of an eye socket is
    // meaningless, and it would be transformed by a primitive that carries no
    // surface at all.
    if (p.op === 'sub') return;
    const d = Math.min(len(sub(hit, p.a)), len(sub(hit, p.b)));
    if (d < best) { best = d; primIdx = i; }
  });
  if (primIdx < 0) primIdx = 0; // a body with no solid primitives cannot be hit
```

- [ ] **Step 4: Skip carves when anchoring a stump**

In `src/lab/sdf-zombie/sever.ts`, change the `live` filter (lines 41–43):

```ts
  const live = body.prims
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.op !== 'sub'
      && p.limb !== limb
      && clusters.find(c => c.limb === p.limb)?.alive);
```

- [ ] **Step 5: Skip carves when measuring a chunk's extent**

In `src/lab/sdf-zombie/zombie.ts`, replace `chunkExtent` (lines 149–157):

```ts
/**
 * Furthest reach of a set of primitives from `origin` (same recipe as
 * clusters.ts). Carves are excluded — they are holes, and counting them would
 * inflate both the collision radius and the proxy box.
 */
export function chunkExtent(prims: Primitive[], origin: Vec3): number {
  let r = 0;
  for (const p of prims) {
    if (p.op === 'sub') continue;
    const ms = Math.max(p.scale[0], p.scale[1], p.scale[2]);
    r = Math.max(r, len(sub(p.a, origin)) + p.radius * ms, len(sub(p.b, origin)) + p.radius * ms);
  }
  return r;
}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npm test`
Expected: PASS — 724 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/damage.ts src/lab/sdf-zombie/sever.ts src/lab/sdf-zombie/zombie.ts src/lab/sdf-zombie/damage.test.ts src/lab/sdf-zombie/sever.test.ts
git commit -m "fix(sdf-lab): treat carves as holes, not flesh

Wounds no longer bind to a carve, stumps no longer anchor to one, and
chunkExtent ignores them so a severed head's eye sockets don't inflate its
collision radius and proxy box."
```

---

## Task 9: `validateBody` understands carves

**Files:**
- Modify: `src/lab/sdf-zombie/validate.ts:66-72`
- Test: `src/lab/sdf-zombie/validate.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lab/sdf-zombie/validate.test.ts`:

```ts
describe('validateBody with carves', () => {
  const opts = { silhouetteNoiseAmp: 0.012, stepMultiplier: 0.6 };

  it('does not report a carve as escaping its bounding sphere', () => {
    const solid = {
      a: [0, 0, 0] as Vec3, b: [0, 0, 0] as Vec3, radius: 0.2,
      scale: [1, 1, 1] as Vec3, blendK: 0.01, limb: 'head' as const, cluster: 0,
    };
    const errs = validateBody({
      prims: [solid, { ...solid, a: [0.2, 0, 0] as Vec3, b: [0.2, 0, 0] as Vec3, radius: 0.08, op: 'sub' as const }],
      clusters: [{ id: 0, limb: 'head', start: 0, count: 2, center: [0, 0, 0], radius: 0.2, alive: true }],
    }, opts);
    expect(errs.filter(e => /bounding sphere/.test(e))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/validate.test.ts`
Expected: FAIL — the carve is reported as escaping its bounding sphere, because Task 5 stopped fitting the bound to it.

- [ ] **Step 3: Skip carves in the containment check**

In `src/lab/sdf-zombie/validate.ts`, replace the bounding-sphere loop (lines 66–72):

```ts
  // Bounding spheres must contain their SOLID primitives, or the cull drops
  // real surface. Carves are excluded here for the same reason clusters.ts
  // excludes them from the fit: they carry no surface to lose.
  for (const c of body.clusters)
    for (const prim of body.prims.slice(c.start, c.start + c.count)) {
      if (prim.op === 'sub') continue;
      const maxScale = Math.max(prim.scale[0], prim.scale[1], prim.scale[2]);
      for (const end of [prim.a, prim.b])
        if (len(sub(end, c.center)) + prim.radius * maxScale > c.radius + 1e-6)
          errs.push(`primitive in cluster "${c.limb}" escapes its bounding sphere`);
    }
```

The connectivity check needs no change — it calls `sdBody`, which now carves. That is deliberate: a carve deep enough to sever the head from the neck **should** be reported as a disconnected cluster.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm test`
Expected: PASS — 725 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/validate.ts src/lab/sdf-zombie/validate.test.ts
git commit -m "feat(sdf-lab): carve-aware validateBody

Containment skips carves, matching the bound fit. Connectivity deliberately
does not: it runs on the carved field, so a socket deep enough to detach the
head from the neck is reported."
```

---

## Task 10: `face.ts` — a parametric face

Pure module: named parameters in, `PrimDef[]` out. No Three, no GL.

**Files:**
- Create: `src/lab/sdf-zombie/face.ts`
- Create: `src/lab/sdf-zombie/face.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lab/sdf-zombie/face.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_FACE, facePrims } from './face';
import { MAX_PRIMS } from './validate';

describe('facePrims', () => {
  it('puts every feature in the head cluster on the skull bone', () => {
    for (const p of facePrims(DEFAULT_FACE)) {
      expect(p.limb).toBe('head');
      expect(p.bone).toBe('skull');
    }
  });

  it('emits both carves and additions', () => {
    const prims = facePrims(DEFAULT_FACE);
    expect(prims.some(p => p.op === 'sub')).toBe(true);
    expect(prims.some(p => p.op !== 'sub')).toBe(true);
  });

  it('makes bilateral features by offset, never by bone mirroring', () => {
    // `skull` is not a mirrored bone, so mirror:true would throw in expandMirror.
    for (const p of facePrims(DEFAULT_FACE)) expect(p.mirror).toBeFalsy();
    expect(facePrims(DEFAULT_FACE).some(p => p.mirrorOffset)).toBe(true);
  });

  it('leaves room for the body inside the shader cap', () => {
    // The body is 21 primitives; mirrorOffset doubles some face entries.
    const expanded = facePrims(DEFAULT_FACE)
      .reduce((n, p) => n + (p.mirrorOffset ? 2 : 1), 0);
    expect(21 + expanded).toBeLessThanOrEqual(MAX_PRIMS);
  });

  it('moves the nose tip further out as noseLength grows', () => {
    const tipZ = (len: number) => {
      const tip = facePrims({ ...DEFAULT_FACE, noseLength: len }).find(p => p.tag === 'nose-tip');
      return tip!.offset![2]!;
    };
    // FACE_FORWARD is +z, so a longer nose means a larger z offset.
    expect(tipZ(0.10)).toBeGreaterThan(tipZ(0.04));
  });

  it('deepens the eye sockets as socketDepth grows', () => {
    const socket = (d: number) =>
      facePrims({ ...DEFAULT_FACE, socketDepth: d }).find(p => p.tag === 'eye-socket')!;
    expect(socket(0.05).radius).toBeGreaterThan(socket(0.02).radius);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lab/sdf-zombie/face.test.ts`
Expected: FAIL — `Failed to resolve import "./face"`.

- [ ] **Step 3: Write `face.ts`**

Create `src/lab/sdf-zombie/face.ts`:

```ts
// src/lab/sdf-zombie/face.ts
// Parametric face: named parameters in, primitive definitions out.
//
// DIVISION OF LABOUR (from the spec, and worth defending): geometry carries
// FORM, texture carries SURFACE. At the resolution this renders at, a nose
// painted into a texture reads as a smudge and an eye socket painted as a dark
// ellipse reads as a sticker. So the whole face is primitives — added for the
// bits that stick out, carved for the bits that go in.
//
// Every feature rides the `skull` bone and lands in the `head` cluster, so the
// fixed fold order is untouched and a severed head takes its face with it.

import type { PrimDef, Vec3 } from './types';

/**
 * Which way the zombie faces, in world axes.
 *
 * The arms angle +z (`foreArm dir: [0.05, -1, 0.1]`) and the feet drift +z, so
 * +z is the front. VERIFY THIS ON SCREEN in Task 11: if the nose comes out on
 * the back of the head, flip this to -1 and nothing else needs to change.
 */
export const FACE_FORWARD = 1;

export interface FaceParams {
  /** How far the nose projects forward. */
  noseLength: number;
  noseWidth: number;
  /** How far the tip hangs below the bridge. */
  noseDroop: number;
  /** How much the bridge bows forward before the tip — the hook. */
  noseHook: number;
  browHeavy: number;
  socketDepth: number;
  socketSpacing: number;
  /** Height of the sockets up the skull. */
  socketRise: number;
  cheekJut: number;
  templeSink: number;
  mouthWidth: number;
  mouthHeight: number;
  mouthOpen: number;
}

/**
 * A big hooked drooping nose, a heavy brow, and deep sockets. At this
 * resolution the nose is the single largest contributor to a readable
 * silhouette, which is why it gets four parameters to everything else's one.
 */
export const DEFAULT_FACE: FaceParams = {
  noseLength: 0.075,
  noseWidth: 0.9,
  noseDroop: 0.030,
  noseHook: 0.020,
  browHeavy: 0.030,
  socketDepth: 0.038,
  socketSpacing: 0.042,
  socketRise: 0.030,
  cheekJut: 0.020,
  templeSink: 0.026,
  mouthWidth: 0.055,
  mouthHeight: 0.020,
  mouthOpen: 0.014,
};

/** A face primitive, tagged so tests and the panel can find one by name. */
export interface FacePrim extends PrimDef {
  tag: string;
}

const HEAD = { bone: 'skull', limb: 'head' } as const;

export function facePrims(f: FaceParams): FacePrim[] {
  const fwd = FACE_FORWARD;
  const off = (x: number, y: number, z: number): Vec3 => [x, y, z * fwd];

  return [
    // --- Added: the bits that stick out -------------------------------------
    {
      ...HEAD, tag: 'brow', at: 0.62, radius: 0.030, blendK: 0.010,
      scale: [1.55, 0.62, 0.85],
      offset: off(0, f.browHeavy * 0.35, 0.062),
    },
    {
      ...HEAD, tag: 'nose-bridge', at: 0.52, radius: 0.020, blendK: 0.009,
      scale: [f.noseWidth * 0.72, 1.25, 1.0],
      offset: off(0, 0.004, 0.062 + f.noseHook),
    },
    {
      ...HEAD, tag: 'nose-tip', at: 0.42, radius: 0.026, blendK: 0.009,
      scale: [f.noseWidth, 0.92, 1.18],
      offset: off(0, -f.noseDroop, 0.060 + f.noseLength),
    },
    {
      ...HEAD, tag: 'cheek', at: 0.40, radius: 0.028, blendK: 0.012,
      scale: [1.0, 0.78, 0.92], mirrorOffset: true,
      offset: off(0.048, -0.004, 0.038 + f.cheekJut),
    },

    // --- Carved: the bits that go in ----------------------------------------
    {
      ...HEAD, tag: 'eye-socket', at: 0.56, radius: f.socketDepth, blendK: 0.008,
      scale: [1.18, 1.0, 0.92], op: 'sub', mirrorOffset: true,
      offset: off(f.socketSpacing, f.socketRise, 0.070),
    },
    {
      ...HEAD, tag: 'nostril', at: 0.42, radius: 0.010, blendK: 0.005,
      scale: [1.0, 1.3, 1.0], op: 'sub', mirrorOffset: true,
      offset: off(0.013, -f.noseDroop - 0.004, 0.066 + f.noseLength),
    },
    {
      ...HEAD, tag: 'mouth', at: 0.26, radius: f.mouthHeight, blendK: 0.007,
      scale: [f.mouthWidth / f.mouthHeight, 1.0 + f.mouthOpen * 12, 0.72],
      op: 'sub',
      offset: off(0, -0.012, 0.056),
    },
    {
      ...HEAD, tag: 'temple', at: 0.66, radius: f.templeSink, blendK: 0.012,
      scale: [0.85, 1.25, 1.0], op: 'sub', mirrorOffset: true,
      offset: off(0.070, 0.010, 0.026),
    },
  ];
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/lab/sdf-zombie/face.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/face.ts src/lab/sdf-zombie/face.test.ts
git commit -m "feat(sdf-lab): parametric face as added and carved primitives

Nose, brow and cheeks add; eye sockets, nostrils, mouth and temples carve.
Bilateral features use mirrorOffset because skull is not a mirrored bone.
The nose gets four parameters because at this resolution it is the largest
single contributor to a readable silhouette."
```

---

## Task 11: Put the face on the zombie, with sliders and a head-focus camera

**Files:**
- Modify: `src/lab/sdf-zombie/body.ts`, `src/lab/sdf-zombie/build-body.ts`, `src/lab/sdf-zombie/panel.ts`, `src/lab/sdf-zombie/lab-main.ts`
- Test: `src/lab/sdf-zombie/build-body.test.ts`, `src/lab/sdf-zombie/panel.test.ts`

- [ ] **Step 1: Fix the existing assertion that hard-codes the faceless prim count**

`src/lab/sdf-zombie/build-body.test.ts:21` currently reads:

```ts
    expect(built.prims.length).toBeLessThanOrEqual(32);
```

The faced zombie is ~34 primitives, so this fails. It was hard-coding the old
`MAX_PRIMS` rather than importing it. Replace with:

```ts
    expect(built.prims.length).toBeLessThanOrEqual(MAX_PRIMS);
```

and add `import { MAX_PRIMS } from './validate';` to that file's imports.

Every other existing assertion against `ZOMBIE` is derived from `built` rather
than hard-coded — `pack.test.ts`, `sever.test.ts` and `rig-bind.test.ts` all
survive the face unchanged. This is the only one.

- [ ] **Step 2: Write the failing tests**

Append to `src/lab/sdf-zombie/build-body.test.ts`:

```ts
import { makeZombie } from './body';
import { DEFAULT_FACE } from './face';

describe('makeZombie', () => {
  it('builds a valid body with the face attached', () => {
    const built = buildBody(makeZombie(DEFAULT_FACE), DEFAULT_BUILD_OPTS);
    expect(built.errors).toEqual([]);
  });

  it('puts every face primitive in the head cluster', () => {
    const built = buildBody(makeZombie(DEFAULT_FACE), DEFAULT_BUILD_OPTS);
    const head = built.clusters.find(c => c.limb === 'head')!;
    const carves = built.prims
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.op === 'sub');
    expect(carves.length).toBeGreaterThan(0);
    for (const { i } of carves) {
      expect(i).toBeGreaterThanOrEqual(head.start);
      expect(i).toBeLessThan(head.start + head.count);
    }
  });

  it('stays inside the shader primitive cap', () => {
    const built = buildBody(makeZombie(DEFAULT_FACE), DEFAULT_BUILD_OPTS);
    expect(built.prims.length).toBeLessThanOrEqual(MAX_PRIMS);
  });
});
```

Append to `src/lab/sdf-zombie/panel.test.ts`:

```ts
it('round-trips faceParams through storage', () => {
  saveOverride({ faceParams: { noseLength: 0.099 } });
  expect(loadOverride().faceParams?.noseLength).toBeCloseTo(0.099, 6);
  clearOverride();
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run src/lab/sdf-zombie/build-body.test.ts src/lab/sdf-zombie/panel.test.ts`
Expected: FAIL — no `makeZombie` export; `faceParams` is not on `BodyOverride`.

- [ ] **Step 4: Split `body.ts` into a base and a factory**

In `src/lab/sdf-zombie/body.ts`, add the imports:

```ts
import { DEFAULT_FACE, facePrims, type FaceParams } from './face';
```

Rename the existing `export const ZOMBIE: BodyDef = {…}` to `const ZOMBIE_BASE: BodyDef = {…}` and append at the end of the file:

```ts
/**
 * The zombie with a face attached. Face primitives are generated rather than
 * authored so the tuning panel can drive them live; bake a tuned FaceParams
 * back into DEFAULT_FACE once it lands.
 */
export function makeZombie(face: FaceParams = DEFAULT_FACE): BodyDef {
  return { ...ZOMBIE_BASE, prims: [...ZOMBIE_BASE.prims, ...facePrims(face)] };
}

/** Back-compat for callers that want the default face. */
export const ZOMBIE: BodyDef = makeZombie();
```

- [ ] **Step 5: Add `faceParams` to the override**

In `src/lab/sdf-zombie/build-body.ts`, add to `BodyOverride`:

```ts
  /** Live face tuning. Merged over DEFAULT_FACE by the caller, not by buildBody. */
  faceParams?: Partial<FaceParams>;
```

with `import type { FaceParams } from './face';` at the top.

`buildBody` itself needs **no** change — the caller passes an already-faced `BodyDef`.

- [ ] **Step 6: Add the face slider spec to `panel.ts`**

Append to `src/lab/sdf-zombie/panel.ts`:

```ts
/** Face sliders, mirroring MATERIAL_SLIDERS. Ranges are authoring judgement. */
export const FACE_SLIDERS: { key: keyof FaceParams; min: number; max: number }[] = [
  { key: 'noseLength', min: 0.02, max: 0.16 },
  { key: 'noseWidth', min: 0.4, max: 2.0 },
  { key: 'noseDroop', min: 0, max: 0.08 },
  { key: 'noseHook', min: -0.02, max: 0.06 },
  { key: 'browHeavy', min: 0, max: 0.07 },
  { key: 'socketDepth', min: 0.015, max: 0.065 },
  { key: 'socketSpacing', min: 0.02, max: 0.07 },
  { key: 'socketRise', min: -0.01, max: 0.06 },
  { key: 'cheekJut', min: 0, max: 0.05 },
  { key: 'templeSink', min: 0, max: 0.05 },
  { key: 'mouthWidth', min: 0.02, max: 0.10 },
  { key: 'mouthHeight', min: 0.008, max: 0.04 },
  { key: 'mouthOpen', min: 0, max: 0.05 },
];
```

with `import type { FaceParams } from './face';` at the top.

- [ ] **Step 7: Wire face, sliders and camera into `lab-main.ts`**

Change the body import:

```ts
import { makeZombie } from './body';
import { DEFAULT_FACE, type FaceParams } from './face';
```

Replace the initial build (line 50):

```ts
let override = loadOverride();
let face: FaceParams = { ...DEFAULT_FACE, ...(override.faceParams ?? {}) };
const body = buildBody(makeZombie(face), DEFAULT_BUILD_OPTS, override);
```

Replace `rebuildBody` (lines 309–316):

```ts
function rebuildBody() {
  override = { ...override, faceParams: face };
  saveOverride(override);
  current = buildBody(makeZombie(face), DEFAULT_BUILD_OPTS, override);
  if (errorsEl) errorsEl.textContent = current.errors.join('\n');
  view.update(current);
  refreshWounds();
  rebind();
}
```

Add a face section to the panel, after the existing `body` section:

```ts
const faceBox = addSection(panelEl, 'face');
for (const s of FACE_SLIDERS)
  addSlider(faceBox, {
    label: s.key, min: s.min, max: s.max, step: 0.001,
    get: () => face[s.key],
    set: (v) => { face[s.key] = v; rebuildBody(); },
  });
```

adding `FACE_SLIDERS` to the `./panel` import.

Add the head-focus camera. `camTarget` is a `const THREE.Vector3`, so `.set()` works without changing the declaration:

```ts
/** Locked three-quarter close-up on the skull, so face work needs no orbiting. */
function focusHead() {
  const skull = current.bones.get('skull');
  autoSpin = false;
  camTarget.set(0, skull ? (skull.head[1] + skull.tail[1]) / 2 : 1.55, 0);
  camYaw = 0.62;
  camPitch = 0.06;
  camDist = 0.52;
}

function focusBody() {
  autoSpin = false;
  camTarget.set(0, 1.05, 0);
  camYaw = 0.35;
  camPitch = 0.12;
  camDist = 2.4;
}

addButton(faceBox, 'focus head', focusHead);
addButton(faceBox, 'focus body', focusBody);
```

Expose both on the dev handle by adding to the `__sdfLab` object:

```ts
  focusHead,
  focusBody,
```

- [ ] **Step 8: Run the full suite**

Run: `npm run build && npm test`
Expected: tsc clean, build succeeds, **735 tests pass**.

- [ ] **Step 9: HUMAN VISUAL CHECK — the whole point of the plan**

Load the lab, click **focus head**, and check in order:

1. **The face is on the FRONT of the head.** If the nose is on the back, flip `FACE_FORWARD` in `face.ts` to `-1` and reload. This is the one value that cannot be settled from the code alone.
2. The nose reads as a nose, the sockets read as sockets, the brow casts a shadow over them.
3. **Zero shader-link errors, no validation errors in the red `#errors` box.** A "disconnected" error means a carve is deep enough to detach the head — reduce `socketDepth` or `templeSink`.
4. Every face slider moves what its name says, and the change survives a reload.
5. Click **focus body** and confirm the face still reads at full-body distance, through the post-fx chain. If it does not, that is the finding — geometry has to be bolder, and this is exactly the judgment Phase 2 depends on.
6. Press `1` to sever the head. The flying head must **keep its face** — sockets and all — and leave no floating holes behind.
7. Shoot the face. Craters must land on the visible surface, not inside a socket.

- [ ] **Step 10: Bake the tuned face and commit**

Once the face looks right, click **copy override JSON**, take the `faceParams` block, and paste those values into `DEFAULT_FACE` in `face.ts` so the authored default is the good face rather than the starting guess. Then:

```bash
git add src/lab/sdf-zombie/body.ts src/lab/sdf-zombie/build-body.ts src/lab/sdf-zombie/panel.ts src/lab/sdf-zombie/lab-main.ts src/lab/sdf-zombie/face.ts src/lab/sdf-zombie/build-body.test.ts src/lab/sdf-zombie/panel.test.ts
git commit -m "feat(sdf-lab): give the zombie a face, with live sliders

makeZombie(face) composes generated face primitives onto the base body, so
the panel can drive them live and persist them. Adds a head-focus camera
because face work through a full-body orbit is unworkable. DEFAULT_FACE
carries the tuned values."
```

---

## Definition of done

- [ ] `npm run build` clean and **735 tests passing**.
- [ ] The lab renders through the post-fx chain, with a working bypass toggle.
- [ ] GPU cost of one body is **written down**, along with the curve at 2/4/8/12 bodies and the overlapping-vs-separated comparison.
- [ ] The zombie has a face that reads as a face at full-body distance, through the palette snap.
- [ ] A severed head keeps its face.
- [ ] `DEFAULT_FACE` holds tuned values, not the starting guess.
- [ ] A note in `docs/dev-notes/` recording what the zombie looks like through the real chain and what it costs. Both feed Phase 2's spec.

---

## Notes for whoever plans Phase 2

Phase 2 (rest-space coordinates, three detail stacks) was deliberately left unplanned because its design depends on Phase 0's outcome. Before planning it, answer:

1. **Did the palette snap flatten the material?** If subsurface scatter and wet speculars survive, the detail stacks can be subtle. If they collapse to flat tone, everything must be bolder and lower-frequency — which the parent spec's "palette discipline" section predicted and nobody has ever been able to check.
2. **How much fill rate is there to spend?** The stacks add per-pixel cost on a renderer that is fill-rate bound. Task 2's numbers set that budget.
3. **Does surface-space texel quantization still read after screen-space dither?** Two quantizations stack, and they might fight. If they do, the texel lattice needs to be coarse enough to stay legible under the Bayer pattern.
