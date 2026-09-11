# Neural Upscale P3a — Capture v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture ~1,000 training pairs weighted to medium and far range. Each pair is a single-ray 400×300 input plus a 16-sample supersampled 800×600 target, with face and wound regions, stored as flesh crops in dataset v2 format.

**Architecture:** Four pieces feed one capture script:
- **Pure helpers, unit-tested:** jitter grid and sample accumulation (TS), and the framing planner and crop/region math (JS libs).
- **Game-side seams (dev-only):** a march jitter hook in `sdf-layer.ts`, plus `__sdfGame` seams for cast reset, limb centres, wounds, screen annotations, ammo, and an in-page supersampled readback.
- **A shared capture library** (boot, readback, G2 checks), which both the old P2 capture and the new `upscale-capture-v2.mjs` use.
- **Capture v2 itself:** stages seeded sequences, guarantees motion, writes crops incrementally, and resumes.

**Tech Stack:** TypeScript, three r185 WebGPU, vitest, Node ESM scripts over CDP (`scripts/lib/sdf-closeup-stage.mjs`), Python + numpy via `uv` (dataset check).

**Read first:** `docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md` — §0 rules and §1 dataset v2. Spec: `docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md` §1.

**Harness:** Tasks 5–7 need Chrome and the GPU, so run them on `pi`, not `dsh`.

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `src/lab/sdf-zombie/webgpu/upscale/supersample.ts` (+ test) | 1 | Centred jitter grid, sample order, accumulation into target + coverage, base64 |
| `src/lab/sdf-zombie/webgpu/sdf-layer.ts` (+ test) | 2 | `setMarchJitter` — sub-pixel view offset around the march only |
| `scripts/lib/upscale-framing.mjs` (+ `.test.ts`) | 3 | Seeded sequence plans, camera pose, split, showcase selection |
| `scripts/lib/upscale-crop.mjs` (+ `.test.ts`) | 4 | Flesh boxes, pair crop, frame crops, mask IoU, crop-local regions |
| `scripts/lib/upscale-capture.mjs` | 5 | Boot + pins, march readback, render-at-scale, staging, G2 checks |
| `scripts/upscale-pairs-capture.mjs` (rewrite) | 5 | P2 capture on the shared library (behaviour unchanged) |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | 6 | Capture seams + `readSupersampledTarget` |
| `scripts/upscale-capture-smoke.mjs` | 6 | GPU smoke for the seams |
| `scripts/upscale-capture-v2.mjs` | 7 | The capture |
| `scripts/upscale-dataset-check.py` | 7 | Dataset v2 validator |
| `docs/dev-notes/2026-09-11-neural-upscale/p3a-capture.md`, `TASKS.md` | 7 | Results |

---

### Task 1: Supersample helpers

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/upscale/supersample.ts`
- Test: `src/lab/sdf-zombie/webgpu/upscale/supersample.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { accumulateSamples, float32ToBase64, jitterGrid, sampleOrder } from './supersample';

describe('supersample helpers (P3 spec §1)', () => {
  it('jitterGrid is a centred stratified grid whose offsets average to zero', () => {
    const g = jitterGrid(4);
    expect(g).toHaveLength(16);
    expect([...new Set(g.map((o) => o[0]))].sort((a, b) => a - b)).toEqual([-0.375, -0.125, 0.125, 0.375]);
    const sum = g.reduce((s, o) => [s[0] + o[0], s[1] + o[1]], [0, 0]);
    expect(sum).toEqual([0, 0]);
    expect(jitterGrid(1)).toEqual([[0, 0]]);
    expect(() => jitterGrid(0)).toThrow(/positive integer/);
  });

  it('sampleOrder puts the centre-most offsets first, deterministically', () => {
    const order = sampleOrder(jitterGrid(4));
    expect(order.slice(0, 4).every((o) => Math.abs(o[0]) === 0.125 && Math.abs(o[1]) === 0.125)).toBe(true);
    expect(order[0]).toEqual([-0.125, -0.125]);
    expect(sampleOrder(jitterGrid(4))).toEqual(order);
    expect(order).toHaveLength(16);
  });

  it('accumulateSamples: majority coverage, mean colour over hits, depth from the first hit', () => {
    const px = (r: number, g: number, b: number, d: number) => [r, g, b, d];
    const miss = [0, 0, 0, 1];
    // 2x1 image, 4 samples. Pixel 0: hits in samples 0, 1, 3. Pixel 1: one hit.
    const samples = [
      new Float32Array([...px(1, 0, 0, 0.3), ...miss]),
      new Float32Array([...px(0, 1, 0, 0.4), ...miss]),
      new Float32Array([...miss, ...miss]),
      new Float32Array([...px(0, 0, 1, 0.5), ...px(1, 1, 1, 0.2)]),
    ];
    const { target, coverage } = accumulateSamples(samples, 2, 1);
    expect(Array.from(target.subarray(0, 3)).map((v) => Number(v.toFixed(6)))).toEqual([0.333333, 0.333333, 0.333333]);
    expect(target[3]).toBe(Math.fround(0.3));
    expect(Array.from(target.subarray(4, 8))).toEqual([0, 0, 0, 1]);
    expect(Array.from(coverage)).toEqual([0.75, 0.25]);
  });

  it('a tie (k = n / 2) counts as covered', () => {
    const hit = new Float32Array([0.5, 0.5, 0.5, 0.6]);
    const miss = new Float32Array([0, 0, 0, 1]);
    const { target, coverage } = accumulateSamples([miss, hit, miss, hit], 1, 1);
    expect(coverage[0]).toBe(0.5);
    expect(target[3]).toBe(Math.fround(0.6));
  });

  it('rejects samples of the wrong size', () => {
    expect(() => accumulateSamples([new Float32Array(4), new Float32Array(8)], 1, 1)).toThrow(/sample 1/);
  });

  it('float32ToBase64 round-trips', () => {
    const data = new Float32Array([1.5, -2, 0.1, 1e-7]);
    const bin = atob(float32ToBase64(data));
    const back = new Float32Array(Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer);
    expect(Array.from(back)).toEqual(Array.from(data));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/upscale/supersample.test.ts`
Expected: FAIL — cannot resolve `./supersample`.

- [ ] **Step 3: Implement**

```ts
/**
 * NEURAL UPSCALE P3 — supersampled training targets
 * (spec docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md §1).
 *
 * The 800x600 target is the mean of grid*grid renders of one frozen state, each with a
 * sub-pixel march jitter. The offsets form a CENTRED stratified grid, so they average to
 * zero and the target stays registered to the 400x300 input. (Not accumJitter: its Halton
 * offsets lie in [0, 1) and average +0.5 px.)
 *
 * Pure TypeScript, so it is unit-testable without a GPU.
 */

/** Centred stratified offsets in output px: (i + 0.5) / n - 0.5 on each axis, row by row. */
export function jitterGrid(n: number): Array<[number, number]> {
  if (!Number.isInteger(n) || n < 1) throw new Error(`jitterGrid: n must be a positive integer, got ${n}`);
  const axis = Array.from({ length: n }, (_, i) => (i + 0.5) / n - 0.5);
  const out: Array<[number, number]> = [];
  for (const y of axis) for (const x of axis) out.push([x, y]);
  return out;
}

/** Centre-most first (by |x| + |y|), ties by y then x. The first hit in this order supplies
 *  the target's depth. */
export function sampleOrder(offsets: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  return offsets
    .map((o) => [o[0], o[1]] as [number, number])
    .sort((a, b) => (Math.abs(a[0]) + Math.abs(a[1])) - (Math.abs(b[0]) + Math.abs(b[1])) || a[1] - b[1] || a[0] - b[0]);
}

export interface SupersampledTarget {
  /** w*h*4. rgb = mean of the hit samples; alpha = clip depth of the first hit in sample
   *  order. Uncovered pixels are (0, 0, 0, 1.0). */
  target: Float32Array;
  /** w*h. Hit fraction k / n. */
  coverage: Float32Array;
}

/**
 * Accumulate `samples` (each w*h*4 RGBA float, alpha >= 1 = no flesh), in sampleOrder order.
 * A pixel is covered iff k >= ceil(n / 2) — majority, with ties counted as covered.
 */
export function accumulateSamples(samples: readonly Float32Array[], w: number, h: number): SupersampledTarget {
  const n = samples.length;
  if (n === 0) throw new Error('accumulateSamples: no samples');
  samples.forEach((s, k) => {
    if (s.length !== w * h * 4) throw new Error(`accumulateSamples: sample ${k} has ${s.length} floats, expected ${w * h * 4}`);
  });
  const need = Math.ceil(n / 2);
  const target = new Float32Array(w * h * 4);
  const coverage = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const o = p * 4;
    let k = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    let depth = 1;
    for (let s = 0; s < n; s++) {
      const d = samples[s]!;
      if (d[o + 3]! < 1) {
        if (k === 0) depth = d[o + 3]!;
        k++;
        r += d[o]!;
        g += d[o + 1]!;
        b += d[o + 2]!;
      }
    }
    coverage[p] = k / n;
    if (k >= need) {
      target[o] = r / k;
      target[o + 1] = g / k;
      target[o + 2] = b / k;
      target[o + 3] = depth;
    } else {
      target[o + 3] = 1;
    }
  }
  return { target, coverage };
}

/** Float32Array -> base64 of its little-endian bytes, chunked so large frames don't
 *  overflow the call stack. */
export function float32ToBase64(data: Float32Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/upscale/supersample.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/upscale/supersample.ts src/lab/sdf-zombie/webgpu/upscale/supersample.test.ts
git commit -m "feat(upscale P3): supersample helpers — centred jitter grid, majority coverage"
```

---

### Task 2: March jitter hook in the SDF layer

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/sdf-layer.ts`
- Test: `src/lab/sdf-zombie/webgpu/sdf-layer.test.ts`

- [ ] **Step 1: Write the failing tests** — append to the end of `sdf-layer.test.ts`:

```ts
describe('capture march jitter (neural upscale P3)', () => {
  function fakeRenderer() {
    const calls: { target: THREE.RenderTarget | null; offset: [number, number] | null }[] = [];
    let currentTarget: THREE.RenderTarget | null = null;
    let clearAlpha = 1;
    const r = {
      autoClear: true,
      getRenderTarget: () => currentTarget,
      setRenderTarget: (t: THREE.RenderTarget | null) => { currentTarget = t; },
      render: (_scene: THREE.Scene, camera: THREE.Camera) => {
        const view = (camera as THREE.PerspectiveCamera).view;
        calls.push({ target: currentTarget, offset: view?.enabled ? [view.offsetX, view.offsetY] : null });
      },
      clear: () => {},
      getClearAlpha: () => clearAlpha,
      setClearAlpha: (a: number) => { clearAlpha = a; },
      getClearColor: (c: THREE.Color) => c,
      setClearColor: vi.fn(),
      getClearDepth: () => 1,
      setClearDepth: vi.fn(),
      copyTextureToTexture: vi.fn(),
      compileAsync: vi.fn(async () => {}),
    };
    return { renderer: r as unknown as THREE.WebGPURenderer, calls };
  }

  it('is off by default: no render sees a view offset', () => {
    const { renderer, calls } = fakeRenderer();
    const layer = createSdfLayer(renderer);
    layer.setSize(800, 600);
    layer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    expect(layer.marchJitter).toBeNull();
    expect(calls.every((c) => c.offset === null)).toBe(true);
    layer.dispose();
  });

  it('offsets the march and nothing after it', () => {
    const { renderer, calls } = fakeRenderer();
    const layer = createSdfLayer(renderer);
    layer.setSize(800, 600);
    expect(layer.setMarchJitter([0.375, -0.125])).toBe(true);
    const camera = new THREE.PerspectiveCamera();
    layer.render(new THREE.Scene(), camera);
    const march = calls.findIndex((c) => c.target === layer.marchTarget);
    expect(march).toBeGreaterThanOrEqual(0);
    expect(calls[march]!.offset).toEqual([0.375, -0.125]);
    expect(calls.slice(0, march).every((c) => c.offset === null)).toBe(true);
    expect(calls.slice(march + 1).filter((c) => c.target !== layer.marchTarget).every((c) => c.offset === null)).toBe(true);
    expect(camera.view?.enabled ?? false).toBe(false);
    layer.dispose();
  });

  it('refuses while fields or accumulation are on, and drops when they turn on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { renderer } = fakeRenderer();
    const layer = createSdfLayer(renderer);
    layer.setSize(800, 600);
    layer.setFieldStyle('bodies');
    expect(layer.setMarchJitter([0.125, 0.125])).toBe(false);
    layer.setFieldStyle('off');
    expect(layer.setMarchJitter([0.125, 0.125])).toBe(true);
    layer.setTemporalAccum(true);
    expect(layer.marchJitter).toBeNull();
    layer.setTemporalAccum(false);
    expect(layer.setMarchJitter([0.125, 0.125])).toBe(true);
    layer.setFieldStyle('bodies');
    expect(layer.marchJitter).toBeNull();
    expect(layer.setMarchJitter(null)).toBe(true);
    warn.mockRestore();
    layer.dispose();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/sdf-layer.test.ts -t "capture march jitter"`
Expected: FAIL — `setMarchJitter` / `marchJitter` do not exist.

- [ ] **Step 3: Implement in `sdf-layer.ts`**

3a. In the `SdfLayer` interface, directly after the line `  readonly compositeSource: 'march' | 'accum' | 'upscale';`, add:

```ts
  /** CAPTURE JITTER (neural upscale P3, spec 2026-09-11-neural-upscale-p3-training-design.md §1):
   *  a fixed sub-pixel view offset in output px, applied around the march only. `null` turns it
   *  off. Refused (returns false) while temporal accumulation or any field style is on — both drive
   *  their own view offset — and dropped if either turns on later. */
  setMarchJitter(offset: readonly [number, number] | null): boolean;
  readonly marchJitter: readonly [number, number] | null;
```

3b. Directly after the line `  let upscale: UpscaleStage | null = null;`, add:

```ts
  /** Capture jitter for supersampled training targets (P3), or null. */
  let marchJitter: [number, number] | null = null;
```

3c. In `render`, replace:

```ts
      if (accumOn) {
        const [jx, jy] = accumJitter(accumFrames);
        camera.setViewOffset(fullW, fullH, jx, jy, fullW, fullH);
      }
```

with:

```ts
      if (accumOn) {
        const [jx, jy] = accumJitter(accumFrames);
        camera.setViewOffset(fullW, fullH, jx, jy, fullW, fullH);
      } else if (marchJitter) {
        // CAPTURE JITTER (neural upscale P3): one fixed sub-pixel offset for supersampled
        // training targets. Around the march only — cleared right after it, below.
        camera.setViewOffset(fullW, fullH, marchJitter[0], marchJitter[1], fullW, fullH);
      }
```

3d. Replace the line `      } // !hold` with:

```ts
      } // !hold
      // Capture jitter is scoped to the march: nothing after it (accumulation, upscale,
      // composite) may see the offset.
      if (marchJitter) camera.clearViewOffset();
```

3e. In `setTemporalAccum(on, alpha) {`, directly before the line `      accumOn = on;`, add:

```ts
      if (on) marchJitter = null;
```

3f. In `setFieldStyle(style) {`, directly after the block that ends:

```ts
        console.warn(`[sdf-layer] field style '${style}' refused while the upscale stage is on (stacking is P5)`);
        return;
      }
```

add:

```ts
      if (style !== 'off') marchJitter = null;
```

3g. Directly after `    get compositeSource() { return upscale ? 'upscale' : accumOn ? 'accum' : 'march'; },`, add:

```ts
    setMarchJitter(offset) {
      if (offset === null) { marchJitter = null; return true; }
      if (accumOn || fieldStyle !== 'off') {
        console.warn('[sdf-layer] march jitter refused while temporal accumulation or a field style is on');
        return false;
      }
      marchJitter = [offset[0], offset[1]];
      return true;
    },
    get marchJitter() { return marchJitter; },
```

- [ ] **Step 4: Run the layer tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/sdf-layer.test.ts`
Expected: PASS — including every pre-existing test, since the default path must not change.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — Expected: no errors.

```bash
git add src/lab/sdf-zombie/webgpu/sdf-layer.ts src/lab/sdf-zombie/webgpu/sdf-layer.test.ts
git commit -m "feat(upscale P3): march jitter hook for supersampled capture targets"
```

---

### Task 3: Framing planner library

**Files:**
- Create: `scripts/lib/upscale-framing.mjs`
- Test: `scripts/lib/upscale-framing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helper without type declarations (same pattern as npy.test.ts).
import { CLASS_SHARES, DISTANCE_M, ORBIT_DEG, SHOWCASE_COUNTS, cameraPose, forwardOf, mulberry32, pickShowcase, planSequence, splitFor } from './upscale-framing.mjs';

const CHARS = ['zombie', 'soldier', 'imp'];
const ROOMS = [1, 2, 3, 4, 5];

describe('upscale framing planner', () => {
  it('planSequence always draws exactly 12 random numbers (so a resume can replay the stream)', () => {
    for (const u of [0.01, 0.5, 0.99]) {
      let n = 0;
      planSequence(() => { n++; return u; }, 0, CHARS, ROOMS);
      expect(n).toBe(12);
    }
  });

  it('class shares, distance, orbit and look-at follow the spec table', () => {
    const rng = mulberry32(1);
    const counts: Record<string, number> = { close: 0, medium: 0, far: 0 };
    for (let i = 0; i < 20000; i++) {
      const p = planSequence(rng, i, CHARS, ROOMS);
      counts[p.class]++;
      const [d0, d1] = DISTANCE_M[p.class];
      expect(p.distance).toBeGreaterThanOrEqual(d0);
      expect(p.distance).toBeLessThanOrEqual(d1);
      expect(Math.abs(p.orbitDeg)).toBeLessThanOrEqual(ORBIT_DEG[p.class]);
      if (p.class === 'far') expect(p.lookAt).not.toBe('wound');
      if (p.class === 'close') { expect(p.eyeHeight).toBeNull(); expect(Math.abs(p.eyeOffset)).toBeLessThanOrEqual(0.2); }
      else { expect(p.eyeOffset).toBeNull(); expect(p.eyeHeight).toBeGreaterThanOrEqual(1.2); expect(p.eyeHeight).toBeLessThanOrEqual(1.8); }
      expect(p.character).toBe(CHARS[i % CHARS.length]);
      expect(ROOMS).toContain(p.room);
    }
    for (const cls of Object.keys(CLASS_SHARES)) expect(Math.abs(counts[cls]! / 20000 - CLASS_SHARES[cls])).toBeLessThan(0.02);
  });

  it('cameraPose stands `distance` out along the orbited facing and looks at the target', () => {
    const target = [1, 1.5, -2];
    for (const [yaw, orbit] of [[0, 0], [0.7, 45], [-2, -120], [3, 180]]) {
      const p = cameraPose(target, yaw, 2.5, orbit, 1.6, 1);
      expect(Math.hypot(p.x - target[0], p.z - target[2])).toBeCloseTo(2.5, 9);
      const f = forwardOf(p.yaw, p.pitch);
      const v = [target[0] - p.x, target[1] - p.eyeY, target[2] - p.z];
      const len = Math.hypot(v[0], v[1], v[2]);
      expect((f[0] * v[0] + f[1] * v[1] + f[2] * v[2]) / len).toBeCloseTo(1, 9);
    }
  });

  it('orbit 0 puts the camera on the facing side; the facing sign flips it', () => {
    const p = cameraPose([0, 1, 0], 0, 2, 0, 1.6, 1);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(-2, 9);
    expect(cameraPose([0, 1, 0], 0, 2, 0, 1.6, -1).z).toBeCloseTo(2, 9);
  });

  it('splitFor holds out about one sequence in ten, deterministically', () => {
    let val = 0;
    for (let i = 0; i < 4000; i++) if (splitFor(1, i) === 'val') val++;
    expect(val / 4000).toBeGreaterThan(0.07);
    expect(val / 4000).toBeLessThan(0.13);
    expect(splitFor(1, 17)).toBe(splitFor(1, 17));
  });

  it('pickShowcase takes 3 close, 5 medium, 4 far validation pairs, preferring heads and wounds', () => {
    const pairs = [];
    for (const cls of ['close', 'medium', 'far']) {
      for (let k = 0; k < 8; k++) {
        pairs.push({ id: `${cls}-${k}`, split: 'val', class: cls, regions: { heads: k % 2 ? [{}] : [], wounds: k % 4 === 1 ? [{}] : [] } });
        pairs.push({ id: `${cls}-t${k}`, split: 'train', class: cls, regions: { heads: [{}], wounds: [{}] } });
      }
    }
    const ids = pickShowcase(pairs);
    expect(ids).toHaveLength(12);
    for (const [cls, n] of Object.entries(SHOWCASE_COUNTS)) expect(ids.filter((id: string) => id.startsWith(cls)).length).toBe(n);
    expect(ids.every((id: string) => !id.includes('-t'))).toBe(true);
    expect(ids).toContain('medium-1');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run scripts/lib/upscale-framing.test.ts`
Expected: FAIL — cannot resolve `./upscale-framing.mjs`.

- [ ] **Step 3: Implement `scripts/lib/upscale-framing.mjs`**

```js
// scripts/lib/upscale-framing.mjs — seeded capture planning for neural upscale P3
// (spec docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md §1;
//  dataset contract docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §1).

export const CLASS_SHARES = { close: 0.2, medium: 0.45, far: 0.35 };
export const LOOK_AT_MIX = {
  close: { head: 0.5, wound: 0.3, torso: 0.2 },
  medium: { head: 0.3, wound: 0.3, torso: 0.4 },
  far: { head: 0.3, wound: 0, torso: 0.7 },
};
export const DISTANCE_M = { close: [0.6, 1.5], medium: [1.5, 3.5], far: [3.5, 7.0] };
export const ORBIT_DEG = { close: 75, medium: 120, far: 180 };
/** close: eye at the look-at height ± 0.2 m; medium and far: an absolute eye height range. */
export const EYE_M = { close: { relative: 0.2 }, medium: { absolute: [1.2, 1.8] }, far: { absolute: [1.3, 1.8] } };
export const WOUNDED_SHARE = 0.5;
export const BLAST_SHARE_OF_WOUNDED = 0.2;
export const VAL_EVERY = 10;
export const SHOWCASE_COUNTS = { close: 3, medium: 5, far: 4 };
/** +1 when a body's facing is (sin yaw, −cos yaw), the page's own forward convention. Flip to −1
 *  if the capture's face check (plan Task 7) shows the back of the head. */
export const BODY_FACING_SIGN = 1;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick a key from `weights` with a uniform sample u in [0, 1). Zero weights never win. */
export function pickWeighted(u, weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [k, w] of entries) {
    acc += w / total;
    if (u < acc) return k;
  }
  return entries[entries.length - 1][0];
}

const lerp = (a, b, u) => a + (b - a) * u;

/**
 * One sequence's plan. Always draws exactly 12 random numbers, whatever the branches, so a
 * resumed capture can replay the stream for finished sequences and stay in step.
 */
export function planSequence(rng, index, characters, rooms) {
  const u = Array.from({ length: 12 }, () => rng());
  const cls = pickWeighted(u[0], CLASS_SHARES);
  const lookAt = pickWeighted(u[1], LOOK_AT_MIX[cls]);
  const [d0, d1] = DISTANCE_M[cls];
  const eye = EYE_M[cls];
  const wounded = u[5] < WOUNDED_SHARE;
  return {
    index,
    class: cls,
    lookAt,
    distance: lerp(d0, d1, u[2]),
    orbitDeg: (u[3] * 2 - 1) * ORBIT_DEG[cls],
    eyeOffset: eye.relative !== undefined ? (u[4] * 2 - 1) * eye.relative : null,
    eyeHeight: eye.absolute ? lerp(eye.absolute[0], eye.absolute[1], u[4]) : null,
    character: characters[index % characters.length],
    room: rooms[Math.min(rooms.length - 1, Math.floor(u[10] * rooms.length))],
    wounds: wounded
      ? { shots: 1 + Math.floor(u[6] * 4), slug: u[7] < 0.5, blast: u[8] < BLAST_SHARE_OF_WOUNDED, blastAngle: u[9] * Math.PI * 2 }
      : null,
    lightPhase: 1000 + Math.floor(u[11] * 1_000_000),
  };
}

/**
 * Camera for a look-at point. The body's facing is (sin bodyYaw, −cos bodyYaw) × facingSign (the
 * page's forward convention, game-main.ts aimAtNearestSurface), orbited by orbitDeg around +Y.
 * The camera stands `distance` m out along that direction at eye height eyeY and looks at the
 * target. Returns setPose's (x, z, yaw, pitch) plus eyeY.
 */
export function cameraPose(target, bodyYaw, distance, orbitDeg, eyeY, facingSign = BODY_FACING_SIGN) {
  const fx = Math.sin(bodyYaw) * facingSign;
  const fz = -Math.cos(bodyYaw) * facingSign;
  const t = (orbitDeg * Math.PI) / 180;
  const dx = fx * Math.cos(t) - fz * Math.sin(t);
  const dz = fx * Math.sin(t) + fz * Math.cos(t);
  const x = target[0] + dx * distance;
  const z = target[2] + dz * distance;
  const vx = target[0] - x;
  const vz = target[2] - z;
  return { x, z, yaw: Math.atan2(vx, -vz), pitch: Math.atan2(target[1] - eyeY, Math.hypot(vx, vz)), eyeY };
}

/** The page's forward vector for a yaw/pitch. */
export function forwardOf(yaw, pitch) {
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

/** 'val' for about one sequence in VAL_EVERY, by a seeded integer hash of (seed, index). */
export function splitFor(seed, index) {
  let h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 1, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h % VAL_EVERY === 0 ? 'val' : 'train';
}

/**
 * The 12 fixed showcase ids: SHOWCASE_COUNTS per class from validation pairs, preferring pairs with
 * a head (2) and a wound (1), then id order. Short classes are filled from the rest.
 */
export function pickShowcase(pairs) {
  const val = pairs.filter((p) => p.split === 'val').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const score = (p) => (p.regions.heads.length > 0 ? 2 : 0) + (p.regions.wounds.length > 0 ? 1 : 0);
  const byScore = (list) => [...list].sort((a, b) => score(b) - score(a));
  const chosen = new Set();
  for (const [cls, n] of Object.entries(SHOWCASE_COUNTS)) {
    for (const p of byScore(val.filter((q) => q.class === cls)).slice(0, n)) chosen.add(p.id);
  }
  for (const p of byScore(val)) {
    if (chosen.size >= 12) break;
    chosen.add(p.id);
  }
  return [...chosen];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run scripts/lib/upscale-framing.test.ts`
Expected: PASS (6 tests). If the `splitFor` fraction test fails, fix the hash mixing, not the bounds.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/upscale-framing.mjs scripts/lib/upscale-framing.test.ts
git commit -m "feat(upscale P3): seeded capture framing planner"
```

---

### Task 4: Crop and region library

**Files:**
- Create: `scripts/lib/upscale-crop.mjs`
- Test: `scripts/lib/upscale-crop.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helper without type declarations (same pattern as npy.test.ts).
import { coverageBox, cropFrame, fleshBox, fleshFraction, maskIoU, pairCrop, toLocalRegions } from './upscale-crop.mjs';

function frame(w: number, h: number, rects: number[][]) {
  const d = new Float32Array(w * h * 4);
  for (let p = 0; p < w * h; p++) d[p * 4 + 3] = 1;
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0!; y < y1!; y++) for (let x = x0!; x < x1!; x++) { d[(y * w + x) * 4] = 0.25; d[(y * w + x) * 4 + 3] = 0.5; }
  }
  return d;
}

describe('upscale crop helpers', () => {
  it('fleshBox and fleshFraction', () => {
    expect(fleshBox(frame(10, 8, [[2, 3, 5, 6]]), 10, 8)).toEqual([2, 3, 5, 6]);
    expect(fleshBox(frame(10, 8, []), 10, 8)).toBeNull();
    expect(fleshFraction(frame(10, 8, [[0, 0, 5, 8]]), 10, 8)).toBe(0.5);
  });

  it('coverageBox uses coverage >= minFrac', () => {
    const cov = new Float32Array(20 * 16);
    for (let y = 2; y < 6; y++) for (let x = 6; x < 10; x++) cov[y * 20 + x] = 0.5;
    cov[3 * 20 + 12] = 0.25;
    expect(coverageBox(cov, 20, 16)).toEqual([6, 2, 10, 6]);
    expect(coverageBox(new Float32Array(4), 2, 2)).toBeNull();
  });

  it('pairCrop unions the input box with the halved target box, pads and clamps', () => {
    const inp = frame(10, 8, [[2, 3, 5, 6]]);
    const cov = new Float32Array(20 * 16);
    for (let y = 5; y < 14; y++) for (let x = 1; x < 12; x++) cov[y * 20 + x] = 1;
    expect(pairCrop(inp, 10, 8, cov, 20, 16, 1)).toEqual({ x: 0, y: 1, w: 7, h: 7 });
    expect(pairCrop(frame(10, 8, []), 10, 8, new Float32Array(20 * 16), 20, 16, 8)).toBeNull();
  });

  it('cropFrame copies a window', () => {
    const data = Float32Array.from({ length: 4 * 3 * 2 }, (_, k) => k);
    const out = cropFrame(data, 4, 3, 2, 1, 1, 2, 2);
    expect(Array.from(out)).toEqual([10, 11, 12, 13, 18, 19, 20, 21]);
  });

  it('maskIoU', () => {
    expect(maskIoU(frame(4, 4, [[0, 0, 2, 2]]), frame(4, 4, [[1, 0, 3, 2]]), 4, 4)).toBeCloseTo(1 / 3, 12);
    expect(maskIoU(frame(4, 4, []), frame(4, 4, []), 4, 4)).toBe(1);
  });

  it('toLocalRegions moves circles into crop-local output px and drops ones outside', () => {
    const crop = { x: 10, y: 5, w: 20, h: 10 };
    const ann = [
      { actorId: 1, head: { x: 30, y: 15, r: 4 }, wounds: [{ x: 18, y: 12, r: 3, type: 'pellet' }] },
      { actorId: 2, head: { x: 100, y: 100, r: 5 }, wounds: [] },
      { actorId: 3, head: null, wounds: [] },
    ];
    expect(toLocalRegions(ann, crop)).toEqual({
      heads: [{ x: 10, y: 5, r: 4, actorId: 1 }],
      wounds: [{ x: -2, y: 2, r: 3, type: 'pellet', actorId: 1 }],
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run scripts/lib/upscale-crop.test.ts`
Expected: FAIL — cannot resolve `./upscale-crop.mjs`.

- [ ] **Step 3: Implement `scripts/lib/upscale-crop.mjs`**

```js
// scripts/lib/upscale-crop.mjs — crops, masks and region transforms for capture v2
// (docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §1).

/** [x0, y0, x1, y1) of texels with alpha < 1 in a w*h RGBA float frame, or null. */
export function fleshBox(data, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 1) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

/** [x0, y0, x1, y1) of pixels with coverage >= minFrac in a w*h coverage array, or null. */
export function coverageBox(cov, w, h, minFrac = 0.5) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cov[y * w + x] >= minFrac) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

/** Fraction of texels that are flesh (alpha < 1). */
export function fleshFraction(data, w, h) {
  let n = 0;
  for (let p = 0; p < w * h; p++) if (data[p * 4 + 3] < 1) n++;
  return n / (w * h);
}

/** IoU of the flesh masks of two same-size RGBA frames (1 when both are empty). */
export function maskIoU(a, b, w, h) {
  let inter = 0, union = 0;
  for (let p = 0; p < w * h; p++) {
    const fa = a[p * 4 + 3] < 1, fb = b[p * 4 + 3] < 1;
    if (fa && fb) inter++;
    if (fa || fb) union++;
  }
  return union === 0 ? 1 : inter / union;
}

/**
 * The pair crop in INPUT px: the input flesh box unioned with the target coverage box (halved
 * outward), padded by `pad` and clamped to the input frame. The output crop is exactly 2x.
 * Null when neither frame has flesh.
 */
export function pairCrop(inData, inW, inH, tgCov, tgW, tgH, pad = 8) {
  const a = fleshBox(inData, inW, inH);
  const b = coverageBox(tgCov, tgW, tgH);
  if (!a && !b) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  if (a) { x0 = a[0]; y0 = a[1]; x1 = a[2]; y1 = a[3]; }
  if (b) {
    x0 = Math.min(x0, Math.floor(b[0] / 2));
    y0 = Math.min(y0, Math.floor(b[1] / 2));
    x1 = Math.max(x1, Math.ceil(b[2] / 2));
    y1 = Math.max(y1, Math.ceil(b[3] / 2));
  }
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(inW, x1 + pad);
  y1 = Math.min(inH, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Copy the (x, y, w, h) window of a W*H*C float frame. */
export function cropFrame(data, W, H, C, x, y, w, h) {
  if (x < 0 || y < 0 || x + w > W || y + h > H) throw new Error(`cropFrame: window ${x},${y} ${w}x${h} outside ${W}x${H}`);
  const out = new Float32Array(w * h * C);
  for (let row = 0; row < h; row++) {
    const src = ((y + row) * W + x) * C;
    out.set(data.subarray(src, src + w * C), row * w * C);
  }
  return out;
}

/**
 * Full-frame annotations (output px) -> crop-local output px for a pair crop (given in input px).
 * Keeps circles whose disc overlaps the crop.
 */
export function toLocalRegions(annotations, crop) {
  const ox = crop.x * 2, oy = crop.y * 2, ow = crop.w * 2, oh = crop.h * 2;
  const overlaps = (c) => c.x + c.r > ox && c.x - c.r < ox + ow && c.y + c.r > oy && c.y - c.r < oy + oh;
  const heads = [];
  const wounds = [];
  for (const a of annotations) {
    if (a.head && overlaps(a.head)) heads.push({ x: a.head.x - ox, y: a.head.y - oy, r: a.head.r, actorId: a.actorId });
    for (const w of a.wounds) if (overlaps(w)) wounds.push({ x: w.x - ox, y: w.y - oy, r: w.r, type: w.type, actorId: a.actorId });
  }
  return { heads, wounds };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run scripts/lib/upscale-crop.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/upscale-crop.mjs scripts/lib/upscale-crop.test.ts
git commit -m "feat(upscale P3): crop, mask and region helpers for capture v2"
```

---

### Task 5: Shared capture library (and the P2 capture on top of it)

**Files:**
- Create: `scripts/lib/upscale-capture.mjs`
- Modify (full rewrite, same behaviour): `scripts/upscale-pairs-capture.mjs`

Background: `scripts/upscale-pairs-capture.mjs` currently holds the boot, pins, readback, staging and G2 checks inline. They move into a library so capture v2 reuses them. The G2 logic (depth registration gate, IoU, orientation, depth sanity, and the determinism fallback) must stay byte-for-byte equivalent in behaviour.

- [ ] **Step 1: Create `scripts/lib/upscale-capture.mjs`**

```js
// scripts/lib/upscale-capture.mjs — shared plumbing for the neural upscale captures:
// boot + pins, march readback, render-at-scale, body staging, and the G2 checks
// (docs/dev-notes/2026-09-11-neural-upscale/g2-pairs.md). Used by scripts/upscale-pairs-capture.mjs
// (P2 format) and scripts/upscale-capture-v2.mjs (P3 dataset v2).
import { applyShipDefaults, bootCloseupPage, connectGame, sleep } from './sdf-closeup-stage.mjs';
import { registerHalfRes } from './upscale-registration.mjs';

/** Connect, boot sdf-game.html, apply ship defaults and capture pins, wait for the probe bake. */
export async function bootCapturePage({ vite, cdp, fail, query = 'frozen=1&vhs=off' }) {
  const conn = await connectGame({ vite, cdp, width: 1280, height: 800, onFail: fail });
  const { send, evaluate } = conn;
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      window.__capConsole = [];
      const e = console.error, w = console.warn;
      console.error = (...a) => { window.__capConsole.push(['error', a.map(String).join(' ')]); e(...a); };
      console.warn = (...a) => { window.__capConsole.push(['warn', a.map(String).join(' ')]); w(...a); };
    })()`,
  });
  await bootCloseupPage({ send, evaluate, fail, url: `http://localhost:${vite}/sdf-game.html?${query}` });
  await applyShipDefaults(evaluate);
  // Pin the probe gather to its per-frame estimate: its afterglow (blend 0.6, fall 0.12) makes the
  // march converge asymptotically, so render-locked reads would never be bit-stable (g1-parity.md).
  await evaluate('(() => { __sdfGame.setOccluder(false); __sdfGame.setHullExitBound(true); __sdfGame.setLightClockFrozen(true); __sdfGame.setDemoHold(true); __sdfGame.setProbeBlend(1); __sdfGame.setProbeFall(1); __sdfGame.installDebugProbe(); return 1; })()');
  await evaluate('(() => { performance.now = () => 100000; return 1; })()');
  for (let i = 0; i < 240; i++) {
    if (await evaluate('(() => __sdfGame.roomProbesReady())()') === true) return conn;
    await sleep(500);
  }
  fail('roomProbesReady never landed');
  return conn;
}

/** The march target as { w, h, data: Float32Array } (row 0 = texel row 0). */
export async function readMarch(evaluate) {
  const r = await evaluate('__sdfGameDebug.readMarchTarget()', 300_000);
  const copy = Buffer.from(Buffer.from(r.rgba32f, 'base64'));
  return { w: r.w, h: r.h, data: new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4) };
}

/** Render the current (render-locked) state at an SDF scale, fields and upscale off, and read it. */
export async function renderAt(evaluate, scale) {
  await evaluate(`(() => { __sdfGame.setUpscale(null); __sdfGame.setFieldStyle('off'); __sdfGame.setSdfScale(${scale}); __sdfGame.step(4); return 1; })()`);
  await evaluate('__sdfGame.resolveGpu()');
  return readMarch(evaluate);
}

export const maxAbsDiff = (a, b) => {
  if (a.data.length !== b.data.length) return Infinity;
  let m = 0;
  for (let k = 0; k < a.data.length; k++) {
    const d = Math.abs(a.data[k] - b.data[k]);
    if (d > m) m = d;
  }
  return m;
};

export const coverage = (img) => {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.data[(y * img.w + x) * 4 + 3] < 1) { n++; sx += x + 0.5; sy += y + 0.5; }
    }
  }
  return { n, frac: n / (img.w * img.h), cx: n ? sx / n : NaN, cy: n ? sy / n : NaN };
};

export const linear = (d, near, far) => (near * far) / (far - d * (far - near));

/** P2 staging: teleport to a room, pick its nearest body, frame it at seq.dist / seq.orbit. */
export async function stageBody(evaluate, fail, seq, pitchUp) {
  const r = await evaluate(`(async () => {
    __sdfGame.setRenderLock(false);
    __sdfGame.teleport(${seq.room});
    const z = __sdfGame.zombies().find(q => q.room === ${seq.room});
    if (!z) return { error: 'no body in room ${seq.room}' };
    __sdfGame.freeze(true);
    const d = ${seq.dist}, a = ${seq.orbit};
    const ex = z.pos[0] + Math.sin(a) * d, ez = z.pos[2] + Math.cos(a) * d;
    const dx = z.pos[0] - ex, dz = z.pos[2] - ez;
    __sdfGame.setPose(ex, ez, Math.atan2(dx, -dz), Math.atan2(1.0 - 1.62, Math.hypot(dx, dz)) + ${pitchUp}, 0);
    __sdfGame.step(30);
    __sdfGame.setRenderLock(true);
    return { body: z.id, pose: [ex, ez] };
  })()`);
  if (r?.error) fail(r.error);
  return r;
}

/**
 * The G2 checks on one staged frame: determinism (with a temporal-start-off fallback), linear-depth
 * registration, coverage IoU, orientation (body staged below centre) and depth sanity.
 * Returns { checks, failures, lr, hr, temporalStartOff }.
 */
export async function runG2Checks(evaluate, fail, { seq = { room: 1, dist: 2.5, orbit: 0 }, pitchUp = 0.2 } = {}) {
  const checks = {};
  // Pitched UP so the body sits below screen centre, which the orientation check needs.
  await stageBody(evaluate, fail, seq, pitchUp);
  const { near, far } = await evaluate('__sdfGame.upscaleInfo()');
  checks.nearFar = { near, far };

  const lrA = await renderAt(evaluate, 0.5);
  if (lrA.w !== 400 || lrA.h !== 300) fail(`input march is ${lrA.w}x${lrA.h}, expected 400x300`);
  const lrB = await renderAt(evaluate, 0.5);
  const hrA = await renderAt(evaluate, 1.0);
  if (hrA.w !== 800 || hrA.h !== 600) fail(`target march is ${hrA.w}x${hrA.h}, expected 800x600`);
  const hrB = await renderAt(evaluate, 1.0);
  const lrC = await renderAt(evaluate, 0.5);
  checks.determinism = {
    sameScaleInput: maxAbsDiff(lrA, lrB),
    sameScaleTarget: maxAbsDiff(hrA, hrB),
    scaleRoundTrip: maxAbsDiff(lrA, lrC),
  };
  let temporalStartOff = false;
  if (Object.values(checks.determinism).some((v) => v > 1e-6)) {
    console.log('determinism failed with temporal start ON:', checks.determinism, '— retrying with setTemporalStart(false)');
    await evaluate('(() => { __sdfGame.setTemporalStart(false); return 1; })()');
    temporalStartOff = true;
    const a = await renderAt(evaluate, 0.5);
    const b = await renderAt(evaluate, 0.5);
    const h1 = await renderAt(evaluate, 1.0);
    const h2 = await renderAt(evaluate, 1.0);
    const c = await renderAt(evaluate, 0.5);
    checks.determinismTemporalStartOff = { sameScaleInput: maxAbsDiff(a, b), sameScaleTarget: maxAbsDiff(h1, h2), scaleRoundTrip: maxAbsDiff(a, c) };
    if (Object.values(checks.determinismTemporalStartOff).some((v) => v > 1e-6)) fail(`G2 determinism: ${JSON.stringify(checks)}`);
  }
  checks.temporalStart = temporalStartOff ? 'off (needed for determinism)' : 'on (shipped)';

  const lr = await renderAt(evaluate, 0.5);
  const hr = await renderAt(evaluate, 1.0);
  const cl = coverage(lr);
  const ch = coverage(hr);
  if (cl.n < 500) fail(`G2: only ${cl.n} flesh pixels at 400x300 — the staged body is not in frame`);
  // ALIGNMENT = registration of LINEAR DEPTH on interior flesh. Colour registration and the
  // coverage centroid are reported, never gated (g2-pairs.md: both misread aliasing).
  const reg = registerHalfRes(lr, hr, { mode: 'depth', near, far });
  const regColour = registerHalfRes(lr, hr, { mode: 'rgb' });
  checks.alignment = {
    inputCoverage: cl.frac,
    targetCoverage: ch.frac,
    registration: { mode: 'depth', texels: reg.texels, argmin: reg.argmin, subpixelOutputPx: reg.subpixel, mse: reg.mse },
    colourRegistration: { gated: false, argmin: regColour.argmin, subpixelOutputPx: regColour.subpixel },
    coverageCentroidOffsetOutputPx: { dx: 2 * cl.cx - ch.cx, dy: 2 * cl.cy - ch.cy, gated: false },
  };
  let inter = 0, union = 0;
  for (let y = 0; y < lr.h; y++) {
    for (let x = 0; x < lr.w; x++) {
      let votes = 0;
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (hr.data[((2 * y + oy) * hr.w + 2 * x + ox) * 4 + 3] < 1) votes++;
      const a = lr.data[(y * lr.w + x) * 4 + 3] < 1;
      const b = votes >= 2;
      if (a && b) inter++;
      if (a || b) union++;
    }
  }
  checks.alignment.iou = inter / union;
  checks.orientation = {
    inputCentroidRow: cl.cy, inputHeight: lr.h, targetCentroidRow: ch.cy, targetHeight: hr.h,
    rowZero: cl.cy > lr.h / 2 && ch.cy > hr.h / 2 ? 'top' : 'UNCONFIRMED',
  };
  let dSum = 0, dN = 0;
  for (let y = 0; y < lr.h; y++) {
    for (let x = 0; x < lr.w; x++) {
      const a = lr.data[(y * lr.w + x) * 4 + 3];
      const b = hr.data[(2 * y * hr.w + 2 * x) * 4 + 3];
      if (a < 1 && b < 1) { dSum += Math.abs(linear(a, near, far) - linear(b, near, far)); dN++; }
    }
  }
  checks.depthMeanAbsDiffMetres = dN ? dSum / dN : NaN;

  const failures = [];
  const r = checks.alignment.registration;
  if (r.texels < 500) failures.push(`registration: only ${r.texels} interior flesh texels (need 500)`);
  if (r.argmin.ox !== 0 || r.argmin.oy !== 0) failures.push(`registration: best match at output shift (${r.argmin.ox}, ${r.argmin.oy}), not (0, 0)`);
  if (!(Math.abs(r.subpixelOutputPx.x) <= 0.25 && Math.abs(r.subpixelOutputPx.y) <= 0.25)) {
    failures.push(`registration: sub-pixel offset (${r.subpixelOutputPx.x}, ${r.subpixelOutputPx.y}) exceeds 0.25 output px`);
  }
  if (checks.alignment.iou < 0.85) failures.push(`IoU ${checks.alignment.iou.toFixed(3)} < 0.85`);
  if (checks.orientation.rowZero !== 'top') failures.push('orientation unconfirmed: body staged below centre but centroid row <= H/2');
  if (!(checks.depthMeanAbsDiffMetres < 0.05)) failures.push(`mean depth diff ${checks.depthMeanAbsDiffMetres} m >= 0.05`);
  return { checks, failures, lr, hr, temporalStartOff };
}
```

- [ ] **Step 2: Rewrite `scripts/upscale-pairs-capture.mjs` on the library**

Replace the whole file with:

```js
// scripts/upscale-pairs-capture.mjs — paired frozen-frame capture for the neural upscale, P2 smoke
// format (docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md §7, gate G2). P3 capture v2
// is scripts/upscale-capture-v2.mjs; both share scripts/lib/upscale-capture.mjs.
//
// For each frame, ONE frozen simulation state is rendered twice:
//   input  = sdfScale 0.5, fields off -> march target 400x300 (rgb + clip depth)
//   target = sdfScale 1.0, fields off -> march target 800x600 (native progressive)
// setRenderLock(true) makes step(n) pure re-renders; the sim advances only between frames.
//
// Usage:
//   LAB_VITE_PORT=5313 LAB_CDP_PORT=9313 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-pairs-capture.mjs'
// Env: UPSCALE_OUT (default .upscale-data/<stamp>), UPSCALE_SEQS ("room:dist:orbit,..."),
//      UPSCALE_FRAMES (20), UPSCALE_ADVANCE (6 sim frames between captures), UPSCALE_PITCH_UP (0.2 rad),
//      UPSCALE_DUMP_CHECK=1 (save the frames the G2 checks score, for scripts/upscale-g2-diag.py)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodeNpy } from './lib/npy.mjs';
import { bootCapturePage, coverage, renderAt, runG2Checks, stageBody } from './lib/upscale-capture.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5313);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9313);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = process.env.UPSCALE_OUT ?? `.upscale-data/${STAMP}`;
const SEQS = (process.env.UPSCALE_SEQS ?? '1:2.5:0,3:3.0:1.2,4:2.0:-0.8').split(',').map((s) => {
  const [room, dist, orbit] = s.split(':').map(Number);
  return { room, dist, orbit };
});
const FRAMES = Number(process.env.UPSCALE_FRAMES ?? 20);
const ADVANCE = Number(process.env.UPSCALE_ADVANCE ?? 6);
const PITCH_UP = Number(process.env.UPSCALE_PITCH_UP ?? 0.2);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => { console.error('FAIL: watchdog 60 min'); process.exit(3); }, 60 * 60_000).unref();
mkdirSync(OUT, { recursive: true });

const { evaluate } = await bootCapturePage({ vite: VITE, cdp: CDP, fail });

// ---- G2 checks on the first staged frame -------------------------------------
const g2 = await runG2Checks(evaluate, fail, { seq: SEQS[0], pitchUp: PITCH_UP });
const { checks } = g2;
if (process.env.UPSCALE_DUMP_CHECK) {
  writeFileSync(`${OUT}/check-in.npy`, encodeNpy(g2.lr.data, [g2.lr.h, g2.lr.w, 4]));
  writeFileSync(`${OUT}/check-target.npy`, encodeNpy(g2.hr.data, [g2.hr.h, g2.hr.w, 4]));
}
console.log('G2 checks:', JSON.stringify(checks, null, 2));
if (g2.failures.length) {
  writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ created: new Date().toISOString(), checks, g2Failures: g2.failures, frames: [] }, null, 2));
  fail(`G2: ${g2.failures.join('; ')}`);
}
const { near, far } = checks.nearFar;

// ---- capture ---------------------------------------------------------------------
const checkout = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
const frames = [];
for (let s = 0; s < SEQS.length; s++) {
  const seq = SEQS[s];
  const staged = await stageBody(evaluate, fail, seq, 0);
  mkdirSync(`${OUT}/seq${s}`, { recursive: true });
  for (let f = 0; f < FRAMES; f++) {
    if (f > 0) {
      await evaluate(`(() => { __sdfGame.setRenderLock(false); __sdfGame.freeze(false); __sdfGame.step(${ADVANCE}); __sdfGame.freeze(true); __sdfGame.setRenderLock(true); return 1; })()`);
    }
    const input = await renderAt(evaluate, 0.5);
    const target = await renderAt(evaluate, 1.0);
    const inPath = `seq${s}/frame${String(f).padStart(3, '0')}-in.npy`;
    const tgPath = `seq${s}/frame${String(f).padStart(3, '0')}-target.npy`;
    writeFileSync(`${OUT}/${inPath}`, encodeNpy(input.data, [input.h, input.w, 4]));
    writeFileSync(`${OUT}/${tgPath}`, encodeNpy(target.data, [target.h, target.w, 4]));
    const cov = coverage(input).frac;
    frames.push({ seq: s, frame: f, room: seq.room, body: staged.body, dist: seq.dist, orbit: seq.orbit, input: inPath, target: tgPath, inputCoverage: cov });
    process.stdout.write(`seq${s} frame ${f}: coverage ${(100 * cov).toFixed(2)}%${cov < 0.01 ? '  (WARN: body mostly out of frame)' : ''}\n`);
  }
}
await evaluate('(() => { __sdfGame.setRenderLock(false); __sdfGame.freeze(false); __sdfGame.setSdfScale(1.0); __sdfGame.setFieldStyle("bodies"); return 1; })()');

writeFileSync(`${OUT}/manifest.json`, JSON.stringify({
  created: new Date().toISOString(),
  spec: 'docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md',
  checkout,
  page: 'sdf-game.html?frozen=1&vhs=off',
  input: { w: 400, h: 300, sdfScale: 0.5, fieldStyle: 'off' },
  target: { w: 800, h: 600, sdfScale: 1.0, fieldStyle: 'off' },
  channels: ['r', 'g', 'b', 'clipDepth (>= 1.0 means no flesh)'],
  dtype: 'float32 little-endian, shape (H, W, 4)',
  rowOrder: 'row 0 = texel row 0 = top of the rendered image (verified by checks.orientation)',
  depth: 'WebGPU [0,1] clip depth; linear = near*far / (far - d*(far - near))',
  near, far,
  temporalStart: checks.temporalStart,
  content: 'flesh layer only, tracked public/assets/lab/* — no Blood placeholder assets',
  checks,
  frames,
}, null, 2));
console.log(`\nG2: PASS — ${frames.length} pairs in ${OUT}`);
process.exit(0);
```

- [ ] **Step 3: Syntax check**

Run: `node --check scripts/lib/upscale-capture.mjs && node --check scripts/upscale-pairs-capture.mjs && echo ok`
Expected: `ok`.

- [ ] **Step 4: GPU regression — the P2 capture still passes with identical G2 numbers**

```bash
mkdir -p /tmp/blud-upscale-data
LAB_VITE_PORT=5322 LAB_CDP_PORT=9322 UPSCALE_SEQS=1:2.5:0 UPSCALE_FRAMES=2 UPSCALE_OUT=/tmp/blud-upscale-data/p2-regression bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-pairs-capture.mjs' 2>&1 | tee /tmp/p3a-task5.log | tail -30
```

Expected: `G2: PASS — 2 pairs`. The G2 JSON should match the r4 numbers in `docs/dev-notes/2026-09-11-neural-upscale/g2-pairs.md`: depth registration argmin (0, 0), sub-pixel ≈ (0.00016, 0.0029), IoU 0.98744, `depthMeanAbsDiffMetres` 0.0021873. The staging is deterministic, so they should match to at least 6 decimals. If they differ, the refactor changed staging or pins — diff the library against the pre-refactor script (`git show HEAD~1:scripts/upscale-pairs-capture.mjs`) and fix it.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/upscale-capture.mjs scripts/upscale-pairs-capture.mjs
git commit -m "refactor(upscale P3): shared capture library (boot, readback, staging, G2 checks)"
```

---

### Task 6: Game seams for capture v2

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`
- Create: `scripts/upscale-capture-smoke.mjs`

- [ ] **Step 1: Imports**

In `game-main.ts`, directly after `import { runUpscaleSelfCheck } from './upscale/upscale-selfcheck';`, add:

```ts
import { accumulateSamples, float32ToBase64, jitterGrid, sampleOrder } from './upscale/supersample';
```

Then run `grep -n "from '../damage'" src/lab/sdf-zombie/webgpu/game-main.ts`. At the time of writing, that import **already lists `woundWorldPos`**, so there is nothing to add (a second copy is a `Duplicate identifier` error). Only if no `'../damage'` import names it, add this line next to the other `'../'` imports:

```ts
import { woundWorldPos } from '../damage';
```

- [ ] **Step 2: Seams**

Find the end of the `upscaleSelfCheck` seam:

```ts
      resolveGpu: () => handle.resolveGpu(),
    }, opts ?? {}),
```

and directly after it add:

```ts
    /** NEURAL UPSCALE P3 capture (spec 2026-09-11-neural-upscale-p3-training-design.md §1).
     *  A fixed sub-pixel march jitter in output px, or null. Returns false when refused. */
    setMarchJitter: (x: number | null, y = 0) => sdfLayer.setMarchJitter(x === null ? null : [x, y]),
    /** P3 capture: replace every actor with the default cast (fresh, unwounded bodies). */
    resetCast: () => { rebuildCast(); return actors.length; },
    /** P3 capture: a full magazine, so scripted wound shots never click empty. */
    refillShells: () => { shells = MAGAZINE_CAPACITY; updateHud(); return shells; },
    /** P3 capture: world centre of an actor's live head or torso cluster, or null. */
    actorLimbCenter: (actorId: number, limb: 'head' | 'torso') => {
      const a = actors.find((q) => q.id === actorId);
      const c = a?.posed().clusters.find((cc) => cc.limb === limb && cc.alive)?.center;
      return c ? ([c[0], c[1], c[2]] as Vec3) : null;
    },
    /** P3 capture: an actor's wounds in world space — the transform rendering uses. */
    actorWounds: (actorId: number) => {
      const a = actors.find((q) => q.id === actorId);
      if (!a) return [];
      const posed = a.posed();
      const yaw = a.pose().yaw;
      return a.wounds().map((w) => ({ pos: woundWorldPos(posed.prims, w, yaw), radius: w.radius, type: w.type }));
    },
    /** P3 capture: every actor's head circle and wound circles, projected through the live camera to
     *  output px (row 0 = top); circles behind the camera are omitted. Call after a render, with the
     *  march jitter off. */
    captureAnnotations: (width: number, height: number, headRadius = 0.12) => {
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const circle = (c: readonly number[], r: number) => {
        const centre = new THREE.Vector3(c[0], c[1], c[2]);
        const a = centre.clone().project(camera);
        if (a.z > 1) return null;
        const b = centre.clone().addScaledVector(up, r).project(camera);
        const ax = (a.x + 1) * 0.5 * width;
        const ay = (1 - a.y) * 0.5 * height;
        const bx = (b.x + 1) * 0.5 * width;
        const by = (1 - b.y) * 0.5 * height;
        return { x: ax, y: ay, r: Math.hypot(bx - ax, by - ay) };
      };
      return actors.map((a) => {
        const posed = a.posed();
        const yaw = a.pose().yaw;
        const head = posed.clusters.find((cc) => cc.limb === 'head' && cc.alive)?.center;
        const wounds: Array<{ x: number; y: number; r: number; type: unknown }> = [];
        for (const w of a.wounds()) {
          const c = circle(woundWorldPos(posed.prims, w, yaw), w.radius);
          if (c) wounds.push({ ...c, type: w.type });
        }
        return { actorId: a.id, head: head ? circle(head, headRadius) : null, wounds };
      });
    },
```

If `tsc` reports a name as missing (`rebuildCast`, `shells`, `MAGAZINE_CAPACITY`, `actors`, `camera`, `Vec3`), find the actual identifier with `grep -n` in `game-main.ts` and use it. Don't add new state.

- [ ] **Step 3: The in-page supersampled readback**

Find `        async readMarchTarget() {` inside `installDebugProbe` and directly BEFORE it add:

```ts
        /** NEURAL UPSCALE P3: the supersampled 800x600 training target. Renders the CURRENT state
         *  grid*grid times with a centred sub-pixel march jitter and temporal ray start OFF (its
         *  reprojection matrix is the unjittered camera), accumulating in-page; only the averaged
         *  target crosses CDP. Caller: freeze + render lock on, scale 1.0, fields off, upscale off. */
        async readSupersampledTarget(grid = 4) {
          const t = sdfLayer.marchTarget;
          const w = t.width, h = t.height;
          const offsets = sampleOrder(jitterGrid(grid));
          const stride = Math.ceil(w * 16 / 256) * 64;
          const wasStart = sdfLayer.temporalStart.on;
          const samples: Float32Array[] = [];
          handle.setLoopRunning(false);
          sdfLayer.setTemporalStart(false);
          try {
            for (const [jx, jy] of offsets) {
              if (!sdfLayer.setMarchJitter([jx, jy])) throw new Error('readSupersampledTarget: march jitter refused (fields or accumulation on?)');
              handle.step(1 / 60);
              await handle.resolveGpu();
              const raw = new Float32Array(await handle.renderer.readRenderTargetPixelsAsync(t, 0, 0, w, h));
              const dense = new Float32Array(w * h * 4);
              for (let y = 0; y < h; y++) dense.set(raw.subarray(y * stride, y * stride + w * 4), y * w * 4);
              samples.push(dense);
            }
          } finally {
            sdfLayer.setMarchJitter(null);
            sdfLayer.setTemporalStart(wasStart);
          }
          const { target, coverage } = accumulateSamples(samples, w, h);
          return { w, h, offsets, target: float32ToBase64(target), coverage: float32ToBase64(coverage) };
        },
```

- [ ] **Step 4: Typecheck, targeted tests, build**

Run: `npx tsc --noEmit` — Expected: no errors.
Run: `npx vitest run src/lab/sdf-zombie/webgpu/sdf-layer.test.ts src/lab/sdf-zombie/webgpu/upscale/` — Expected: PASS.
Run: `npm run build` — Expected: success.

- [ ] **Step 5: Write the GPU smoke `scripts/upscale-capture-smoke.mjs`**

```js
// scripts/upscale-capture-smoke.mjs — GPU smoke for the P3 capture seams
// (docs/superpowers/plans/2026-09-11-neural-upscale-p3a-capture-v2.md Task 6).
// Usage: LAB_VITE_PORT=5321 LAB_CDP_PORT=9321 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-capture-smoke.mjs'
import { bootCapturePage, maxAbsDiff, readMarch, renderAt } from './lib/upscale-capture.mjs';
import { cameraPose } from './lib/upscale-framing.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5321);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9321);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => fail('watchdog 20 min'), 20 * 60_000).unref();
const decodeF32 = (b64) => { const c = Buffer.from(Buffer.from(b64, 'base64')); return new Float32Array(c.buffer, c.byteOffset, c.byteLength / 4); };
const problems = [];

const { evaluate } = await bootCapturePage({ vite: VITE, cdp: CDP, fail });
const characters = await evaluate('__sdfGame.characterNames()');
const castSize = await evaluate('(() => { __sdfGame.setRenderLock(false); __sdfGame.teleport(1); return __sdfGame.resetCast(); })()');
if (!(castSize > 0)) problems.push(`resetCast returned ${castSize}`);
let spawned = null;
for (const name of characters) {
  const r = await evaluate(`__sdfGame.spawnDebugCharacter(${JSON.stringify(name)})`);
  if (r.errors.length === 0) { spawned = { name, id: r.id }; break; }
}
if (!spawned) fail('no character could be spawned');
await evaluate('(() => { __sdfGame.freeze(true); __sdfGame.step(10); return 1; })()');
const head = await evaluate(`__sdfGame.actorLimbCenter(${spawned.id}, 'head')`);
const torso = await evaluate(`__sdfGame.actorLimbCenter(${spawned.id}, 'torso')`);
if (!head || !torso) fail(`limb centres missing: head ${JSON.stringify(head)} torso ${JSON.stringify(torso)}`);
const body = (await evaluate('__sdfGame.zombies()')).find((z) => z.id === spawned.id);
await evaluate('(() => { const p = __sdfGame.pose(); __sdfGame.setPose(p.pos[0], p.pos[2], p.yaw, 0, 0); __sdfGame.step(1); return 1; })()');
const eyeBase = (await evaluate('__sdfGame.cameraWorld()'))[1] - (await evaluate('__sdfGame.pose()')).pos[1];

const pose = cameraPose(head, body.yaw, 1.2, 0, head[1]);
await evaluate(`(() => { __sdfGame.setPose(${pose.x}, ${pose.z}, ${pose.yaw}, ${pose.pitch}, ${pose.eyeY - eyeBase}); __sdfGame.step(2); __sdfGame.setRenderLock(true); return 1; })()`);

// 1. a (0, 0) jitter bit-matches no jitter
const plain = await renderAt(evaluate, 1.0);
const zeroOk = await evaluate('(() => { const ok = __sdfGame.setMarchJitter(0, 0); __sdfGame.step(4); return ok; })()');
await evaluate('__sdfGame.resolveGpu()');
const zero = await readMarch(evaluate);
await evaluate('(() => { __sdfGame.setMarchJitter(null); return 1; })()');
if (!zeroOk) problems.push('setMarchJitter(0, 0) refused with fields off');
const zeroDiff = maxAbsDiff(plain, zero);
if (zeroDiff !== 0) problems.push(`(0,0) jitter differs from no jitter: ${zeroDiff}`);

// 2. a real jitter changes the march (the hook reaches it)
await evaluate('(() => { __sdfGame.setMarchJitter(0.375, 0.375); __sdfGame.step(4); return 1; })()');
await evaluate('__sdfGame.resolveGpu()');
const jittered = await readMarch(evaluate);
await evaluate('(() => { __sdfGame.setMarchJitter(null); __sdfGame.step(4); return 1; })()');
if (maxAbsDiff(plain, jittered) === 0) problems.push('a 0.375 px jitter left the march unchanged — the hook is not reaching the march');

// 3. supersampled target
const ss = await evaluate('__sdfGameDebug.readSupersampledTarget(4)', 600_000);
if (ss.w !== 800 || ss.h !== 600) problems.push(`supersampled target is ${ss.w}x${ss.h}`);
if (ss.offsets.length !== 16) problems.push(`offsets ${ss.offsets.length}`);
const target = decodeF32(ss.target);
const cov = decodeF32(ss.coverage);
let nativeFlesh = 0, targetCovered = 0, disagree = 0;
for (let p = 0; p < 800 * 600; p++) {
  if (plain.data[p * 4 + 3] < 1) nativeFlesh++;
  if (target[p * 4 + 3] < 1) targetCovered++;
  if ((target[p * 4 + 3] < 1) !== (cov[p] >= 0.5)) disagree++;
}
if (disagree) problems.push(`${disagree} pixels where target alpha and coverage >= 0.5 disagree`);
if (nativeFlesh < 1000) problems.push(`only ${nativeFlesh} native flesh px — the head close-up is not in frame`);
if (Math.abs(targetCovered - nativeFlesh) > 0.05 * nativeFlesh) problems.push(`supersampled coverage ${targetCovered} vs native ${nativeFlesh} differs by > 5%`);
if ((await evaluate('__sdfGame.temporalStart.on')) !== true) problems.push('temporal ray start was not restored after supersampling');
if ((await evaluate('__sdfGame.marchJitter ?? null')) !== null && (await evaluate('__sdfGame.marchJitter')) !== undefined) problems.push('march jitter left on');

// 4. annotations
await evaluate('(() => { __sdfGame.step(2); return 1; })()');
const ann = await evaluate('__sdfGame.captureAnnotations(800, 600)');
const mine = ann.find((a) => a.actorId === spawned.id);
if (!mine?.head) problems.push('no head annotation for the spawned actor');
else {
  const { x, y, r } = mine.head;
  if (!(x > 0 && x < 800 && y > 0 && y < 600 && r > 2)) problems.push(`head circle off-frame or tiny: ${JSON.stringify(mine.head)}`);
  else if (!(plain.data[(Math.round(y) * 800 + Math.round(x)) * 4 + 3] < 1)) problems.push(`head centre (${x.toFixed(1)}, ${y.toFixed(1)}) is not on flesh`);
}

// 5. wounds: shoot the torso from 3 m
const shot = cameraPose(torso, body.yaw, 3.0, 0, torso[1] + 0.1);
await evaluate(`(() => { __sdfGame.setRenderLock(false); __sdfGame.refillShells(); __sdfGame.setPose(${shot.x}, ${shot.z}, ${shot.yaw}, ${shot.pitch}, ${shot.eyeY - eyeBase}); __sdfGame.step(2); __sdfGame.fire(1); __sdfGame.step(30); return 1; })()`);
const wounds = await evaluate(`__sdfGame.actorWounds(${spawned.id})`);
if (wounds.length === 0) problems.push('fire(1) at the torso from 3 m left no wounds (check the aim convention)');
else {
  await evaluate(`(() => { __sdfGame.setPose(${shot.x}, ${shot.z}, ${shot.yaw}, ${shot.pitch}, ${shot.eyeY - eyeBase}); __sdfGame.setRenderLock(true); __sdfGame.step(2); return 1; })()`);
  const ann2 = await evaluate('__sdfGame.captureAnnotations(800, 600)');
  if (!(ann2.find((a) => a.actorId === spawned.id)?.wounds.length > 0)) problems.push('wounds exist but none were projected');
}

// 6. refusal while fields are on
const refused = await evaluate(`(() => { __sdfGame.setFieldStyle('bodies'); const ok = __sdfGame.setMarchJitter(0.1, 0); __sdfGame.setFieldStyle('off'); return ok; })()`);
if (refused !== false) problems.push('setMarchJitter was accepted with fields on');

const logged = await evaluate('(() => window.__capConsole ?? [])()');
const shaderErrors = logged.filter(([, t]) => /TSL|WGSL|Tint|pipeline|not found in Fn/i.test(t));
if (shaderErrors.length) problems.push(`${shaderErrors.length} shader console errors: ${shaderErrors[0][1].slice(0, 200)}`);
console.log(JSON.stringify({ spawned, castSize, zeroDiff, nativeFlesh, targetCovered, wounds: wounds.length, head: mine?.head ?? null }, null, 2));
for (const p of problems) console.log(`PROBLEM: ${p}`);
console.log(problems.length ? 'SMOKE: FAIL' : 'SMOKE: PASS');
process.exit(problems.length ? 1 : 0);
```

Note: `__sdfGame.marchJitter` is not a seam; check 3's last line is harmless if it reads `undefined`. The authoritative check is that the smoke's later renders are unjittered, which check 4 relies on.

- [ ] **Step 6: Run the smoke**

```bash
LAB_VITE_PORT=5321 LAB_CDP_PORT=9321 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-capture-smoke.mjs' 2>&1 | tee /tmp/p3a-task6.log | tail -40
```

Expected: `SMOKE: PASS`. Debugging facts:
- `(0,0) jitter differs` → the jitter branch changes something besides the offset. Check that `setViewOffset(fullW, fullH, 0, 0, fullW, fullH)` produces an identical projection.
- `0.375 px jitter left the march unchanged` → the offset is set after the march or cleared too early (Task 2, 3c/3d).
- `no wounds` → the shot missed. Log `__sdfGame.screenPosOf(...torso)` after posing (it should be near 0, 0) and check the yaw convention.
- `head centre is not on flesh` → a projection problem. Compare `captureAnnotations` with `__sdfGame.screenPosOf(...head)`.

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts scripts/upscale-capture-smoke.mjs
git commit -m "feat(upscale P3): capture seams — jitter, cast reset, limb centres, wounds, annotations, supersampled readback"
```

---

### Task 7: Capture v2, dataset check, smoke capture

**Files:**
- Create: `scripts/upscale-capture-v2.mjs`
- Create: `scripts/upscale-dataset-check.py`
- Create: `docs/dev-notes/2026-09-11-neural-upscale/p3a-capture.md`
- Modify: `TASKS.md`
- Modify (only if the face check needs it): `scripts/lib/upscale-framing.mjs`

- [ ] **Step 1: Write `scripts/upscale-capture-v2.mjs`**

```js
// scripts/upscale-capture-v2.mjs — neural upscale P3 capture v2
// (spec docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md §1;
//  dataset format docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §1).
//
// Per pair, ONE frozen state rendered up to three ways:
//   input  = scale 0.5, fields off, temporal ray start as shipped   -> 400x300 single-ray
//   target = scale 1.0, 16 jittered samples, temporal ray start off -> 800x600 supersampled
//   native = scale 1.0 single-ray (validation sequences only)       -> 800x600
// Stored as flesh crops (+8 input px). pairs.jsonl / sequences.jsonl are appended as they land, so
// rerunning the same command resumes.
//
// Usage:
//   LAB_VITE_PORT=5320 LAB_CDP_PORT=9320 UPSCALE_NAME=v2-smoke UPSCALE_PAIRS=24 UPSCALE_FRAMES=4 \
//     bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-capture-v2.mjs'
// Env: UPSCALE_DATA_ROOT (~/blud-upscale-data), UPSCALE_NAME, UPSCALE_SEED (1), UPSCALE_PAIRS (1000),
//      UPSCALE_FRAMES (10 per sequence), UPSCALE_ADVANCE (6), UPSCALE_CAP_GB (5), UPSCALE_ROOMS (1,2,3,4,5),
//      UPSCALE_FACE_SHOT=1 (save a presented-frame PNG of the first head close-up, for the face-direction check)
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { encodeNpy } from './lib/npy.mjs';
import { bootCapturePage, maxAbsDiff, readMarch, renderAt, runG2Checks } from './lib/upscale-capture.mjs';
import { cropFrame, fleshFraction, maskIoU, pairCrop, toLocalRegions } from './lib/upscale-crop.mjs';
import { cameraPose, mulberry32, pickShowcase, planSequence, splitFor } from './lib/upscale-framing.mjs';
import { registerHalfRes } from './lib/upscale-registration.mjs';

const VITE = Number(process.env.LAB_VITE_PORT ?? 5320);
const CDP = Number(process.env.LAB_CDP_PORT ?? 9320);
const ROOT = process.env.UPSCALE_DATA_ROOT ?? join(homedir(), 'blud-upscale-data');
const NAME = process.env.UPSCALE_NAME ?? `v2-${new Date().toISOString().slice(0, 10)}`;
const OUT = join(ROOT, NAME);
const SEED = Number(process.env.UPSCALE_SEED ?? 1);
const PAIRS = Number(process.env.UPSCALE_PAIRS ?? 1000);
const FRAMES = Number(process.env.UPSCALE_FRAMES ?? 10);
const ADVANCE = Number(process.env.UPSCALE_ADVANCE ?? 6);
const CAP_BYTES = Number(process.env.UPSCALE_CAP_GB ?? 5) * 1024 ** 3;
const ROOMS = (process.env.UPSCALE_ROOMS ?? '1,2,3,4,5').split(',').map(Number);
const GRID = 4, IN_W = 400, IN_H = 300, OUT_W = 800, OUT_H = 600;
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
setTimeout(() => fail('watchdog 12 h'), 12 * 3600_000).unref();
mkdirSync(join(OUT, 'pairs'), { recursive: true });
const SEQ_FILE = join(OUT, 'sequences.jsonl');
const PAIR_FILE = join(OUT, 'pairs.jsonl');
const decodeF32 = (b64) => { const c = Buffer.from(Buffer.from(b64, 'base64')); return new Float32Array(c.buffer, c.byteOffset, c.byteLength / 4); };
const readJsonl = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const stats = { skippedStatic: 0, skippedEmpty: 0, skippedNoHead: 0, skippedSpawn: 0, secondsPerPair: 0 };
const startedAt = Date.now();

const { evaluate } = await bootCapturePage({ vite: VITE, cdp: CDP, fail });
const { near, far } = await evaluate('__sdfGame.upscaleInfo()');
const characters = await evaluate('__sdfGame.characterNames()');
if (!Array.isArray(characters) || characters.length === 0) fail('no characters');

async function readSupersampled() {
  await evaluate(`(() => { __sdfGame.setUpscale(null); __sdfGame.setFieldStyle('off'); __sdfGame.setSdfScale(1.0); __sdfGame.step(4); return 1; })()`);
  const r = await evaluate(`__sdfGameDebug.readSupersampledTarget(${GRID})`, 600_000);
  return { w: r.w, h: r.h, offsets: r.offsets, data: decodeF32(r.target), coverage: decodeF32(r.coverage) };
}

// ---- session checks: G2 on the P2 staging, then the supersampler ----------------
const g2 = await runG2Checks(evaluate, fail, { seq: { room: 1, dist: 2.5, orbit: 0 }, pitchUp: 0.2 });
if (g2.failures.length) fail(`G2: ${g2.failures.join('; ')}`);
const ssChecks = {};
{
  const plain = await renderAt(evaluate, 1.0);
  await evaluate('(() => { if (!__sdfGame.setMarchJitter(0, 0)) throw new Error("jitter refused"); __sdfGame.step(4); return 1; })()');
  await evaluate('__sdfGame.resolveGpu()');
  const zero = await readMarch(evaluate);
  await evaluate('(() => { __sdfGame.setMarchJitter(null); __sdfGame.step(4); return 1; })()');
  ssChecks.zeroJitterMaxAbsDiff = maxAbsDiff(plain, zero);
  const tgt = await readSupersampled();
  ssChecks.offsetMean = tgt.offsets.reduce((s, o) => [s[0] + o[0] / tgt.offsets.length, s[1] + o[1] / tgt.offsets.length], [0, 0]);
  const lr = await renderAt(evaluate, 0.5);
  const reg = registerHalfRes(lr, tgt, { mode: 'depth', near, far });
  ssChecks.registration = { texels: reg.texels, argmin: reg.argmin, subpixelOutputPx: reg.subpixel };
  const failures = [];
  if (ssChecks.zeroJitterMaxAbsDiff !== 0) failures.push(`(0,0) jitter differs from no jitter by ${ssChecks.zeroJitterMaxAbsDiff}`);
  if (tgt.offsets.length !== GRID * GRID || ssChecks.offsetMean.some((v) => Math.abs(v) > 1e-12)) failures.push(`jitter offsets not centred: ${JSON.stringify(ssChecks.offsetMean)}`);
  // Depth comes from the first hit in sample order, a (-0.125, -0.125) sample, so |sub-pixel| up to
  // ~0.125 px is expected; the gate stays at 0.25.
  if (reg.texels < 500 || reg.argmin.ox !== 0 || reg.argmin.oy !== 0 || !(Math.abs(reg.subpixel.x) <= 0.25 && Math.abs(reg.subpixel.y) <= 0.25)) {
    failures.push(`supersampled target registration ${JSON.stringify(ssChecks.registration)}`);
  }
  console.log('supersample checks:', JSON.stringify(ssChecks));
  if (failures.length) fail(`supersample: ${failures.join('; ')}`);
}

// ---- eye height: camera height above the player's feet -----------------------------
await evaluate('(() => { __sdfGame.setRenderLock(false); const p = __sdfGame.pose(); __sdfGame.setPose(p.pos[0], p.pos[2], p.yaw, 0, 0); __sdfGame.step(1); return 1; })()');
const eyeBase = (await evaluate('__sdfGame.cameraWorld()'))[1] - (await evaluate('__sdfGame.pose()')).pos[1];

async function setCamera(pose) {
  await evaluate(`(() => { __sdfGame.setPose(${pose.x}, ${pose.z}, ${pose.yaw}, ${pose.pitch}, ${pose.eyeY - eyeBase}); return 1; })()`);
}

async function bodyOf(id) {
  return (await evaluate('__sdfGame.zombies()')).find((z) => z.id === id) ?? null;
}

async function woundActor(id, plan) {
  const body = await bodyOf(id);
  if (!body) return 0;
  for (let s = 0; s < plan.wounds.shots; s++) {
    const torso = await evaluate(`__sdfGame.actorLimbCenter(${id}, 'torso')`);
    if (!torso) break;
    await setCamera(cameraPose(torso, body.yaw, 3.0, (s - plan.wounds.shots / 2) * 15, torso[1] + 0.1));
    const fire = plan.wounds.slug && s === 0 ? 'fireSlug()' : 'fire(1)';
    await evaluate(`(() => { const g = __sdfGame; g.setRenderLock(false); g.refillShells(); g.step(2); g.${fire}; g.step(20); return 1; })()`);
  }
  if (plan.wounds.blast) {
    const torso = await evaluate(`__sdfGame.actorLimbCenter(${id}, 'torso')`);
    if (torso) {
      const a = plan.wounds.blastAngle;
      await evaluate(`(() => { __sdfGame.explode(${torso[0] + Math.cos(a) * 1.6}, ${torso[1]}, ${torso[2] + Math.sin(a) * 1.6}); __sdfGame.step(10); return 1; })()`);
    }
  }
  return (await evaluate(`__sdfGame.actorWounds(${id})`)).length;
}

async function stageSequence(plan) {
  const r = await evaluate(`(() => {
    const g = __sdfGame;
    g.setRenderLock(false);
    g.freeze(false);
    g.resetCast();
    g.teleport(${plan.room});
    const sp = g.spawnDebugCharacter(${JSON.stringify(plan.character)});
    if (sp.errors.length) return { error: sp.errors.join(' | ') };
    g.freeze(true);
    g.step(10);
    performance.now = () => ${plan.lightPhase};
    g.setLightClockFrozen(false);
    g.setLightClockFrozen(true);
    return { actorId: sp.id };
  })()`);
  if (r?.error) {
    console.warn(`seq ${plan.index}: spawning ${plan.character} failed (${r.error}) — skipped`);
    stats.skippedSpawn++;
    return null;
  }
  if (plan.wounds) await woundActor(r.actorId, plan);
  return r;
}

async function aimFor(plan, id) {
  const body = await bodyOf(id);
  if (!body) return null;
  let target = null;
  if (plan.lookAt === 'head') target = await evaluate(`__sdfGame.actorLimbCenter(${id}, 'head')`);
  if (plan.lookAt === 'wound') {
    const ws = await evaluate(`__sdfGame.actorWounds(${id})`);
    if (ws.length) target = ws[plan.index % ws.length].pos;
  }
  if (!target) target = await evaluate(`__sdfGame.actorLimbCenter(${id}, 'torso')`);
  if (!target) return null;
  const eyeY = plan.eyeOffset !== null ? target[1] + plan.eyeOffset : plan.eyeHeight;
  return cameraPose(target, body.yaw, plan.distance, plan.orbitDeg, eyeY);
}

let faceShotDone = false;
async function captureFrame(plan, split, id, f, prevInput) {
  if (f > 0) await evaluate(`(() => { const g = __sdfGame; g.setRenderLock(false); g.freeze(false); g.step(${ADVANCE}); g.freeze(true); return 1; })()`);
  let input = null;
  for (let attempt = 0; ; attempt++) {
    const aim = await aimFor(plan, id);
    if (!aim) return { stop: true };
    await setCamera(aim);
    await evaluate('(() => { __sdfGame.setRenderLock(true); return 1; })()');
    input = await renderAt(evaluate, 0.5);
    if (!prevInput || maskIoU(prevInput.data, input.data, IN_W, IN_H) < 0.98) break;
    if (attempt === 3) { stats.skippedStatic++; return { stop: true }; }
    await evaluate(`(() => { const g = __sdfGame; g.setRenderLock(false); g.freeze(false); g.step(${ADVANCE}); g.freeze(true); return 1; })()`);
  }
  if (fleshFraction(input.data, IN_W, IN_H) < 0.005) { stats.skippedEmpty++; return { input }; }
  const annotations = await evaluate(`__sdfGame.captureAnnotations(${OUT_W}, ${OUT_H})`);
  if (plan.lookAt === 'head') {
    const h = annotations.find((a) => a.actorId === id)?.head;
    if (!(h && h.x - h.r >= 0 && h.x + h.r <= OUT_W && h.y - h.r >= 0 && h.y + h.r <= OUT_H)) { stats.skippedNoHead++; return { input }; }
  }
  const native = split === 'val' ? await renderAt(evaluate, 1.0) : null;
  const target = await readSupersampled();
  const crop = pairCrop(input.data, IN_W, IN_H, target.coverage, OUT_W, OUT_H, 8);
  if (!crop) { stats.skippedEmpty++; return { input }; }

  const pid = `s${String(plan.index).padStart(4, '0')}-f${String(f).padStart(3, '0')}`;
  mkdirSync(join(OUT, 'pairs', pid), { recursive: true });
  const files = {
    in: `pairs/${pid}/in.npy`,
    target: `pairs/${pid}/target.npy`,
    targetCoverage: `pairs/${pid}/target-coverage.npy`,
    native: native ? `pairs/${pid}/native.npy` : null,
  };
  const write = (rel, data, shape) => { const buf = encodeNpy(data, shape); writeFileSync(join(OUT, rel), buf); return buf.length; };
  const X = crop.x * 2, Y = crop.y * 2, W2 = crop.w * 2, H2 = crop.h * 2;
  let bytes = 0;
  bytes += write(files.in, cropFrame(input.data, IN_W, IN_H, 4, crop.x, crop.y, crop.w, crop.h), [crop.h, crop.w, 4]);
  bytes += write(files.target, cropFrame(target.data, OUT_W, OUT_H, 4, X, Y, W2, H2), [H2, W2, 4]);
  bytes += write(files.targetCoverage, cropFrame(target.coverage, OUT_W, OUT_H, 1, X, Y, W2, H2), [H2, W2, 1]);
  if (native) bytes += write(files.native, cropFrame(native.data, OUT_W, OUT_H, 4, X, Y, W2, H2), [H2, W2, 4]);
  if (process.env.UPSCALE_FACE_SHOT && !faceShotDone && plan.lookAt === 'head' && plan.class === 'close') {
    writeFileSync(join(OUT, `face-check-${pid}.png`), Buffer.from(await evaluate('__sdfGame.presentedShot()'), 'base64'));
    faceShotDone = true;
  }
  const pair = {
    id: pid, seq: plan.index, frame: f, split, showcase: false,
    class: plan.class, lookAt: plan.lookAt, character: plan.character, room: plan.room,
    distance: plan.distance, orbitDeg: plan.orbitDeg,
    wounds: (await evaluate(`__sdfGame.actorWounds(${id})`)).length,
    crop, files, regions: toLocalRegions(annotations, crop),
    inputCoverage: fleshFraction(input.data, IN_W, IN_H),
    iouPrev: prevInput ? maskIoU(prevInput.data, input.data, IN_W, IN_H) : null,
    bytes,
  };
  return { input, pair };
}

// ---- resume: keep only pairs from sequences that finished, replay the rng stream ---------
const seqDone = readJsonl(SEQ_FILE);
const pairs = readJsonl(PAIR_FILE).filter((p) => p.seq < seqDone.length);
writeFileSync(PAIR_FILE, pairs.map((p) => JSON.stringify(p) + '\n').join(''));
let bytes = pairs.reduce((s, p) => s + p.bytes, 0);
const rng = mulberry32(SEED);
for (let i = 0; i < seqDone.length; i++) planSequence(rng, i, characters, ROOMS);
let seqIndex = seqDone.length;
if (seqIndex) console.log(`resuming after ${seqIndex} sequences, ${pairs.length} pairs`);
const pairsAtStart = pairs.length;

while (pairs.length < PAIRS && bytes < CAP_BYTES) {
  const plan = planSequence(rng, seqIndex, characters, ROOMS);
  const split = splitFor(SEED, seqIndex);
  const staged = await stageSequence(plan);
  let captured = 0;
  if (staged) {
    let prevInput = null;
    for (let f = 0; f < FRAMES && pairs.length < PAIRS; f++) {
      const r = await captureFrame(plan, split, staged.actorId, f, prevInput);
      if (r.stop) break;
      if (r.input) prevInput = r.input;
      if (!r.pair) continue;
      pairs.push(r.pair);
      bytes += r.pair.bytes;
      appendFileSync(PAIR_FILE, JSON.stringify(r.pair) + '\n');
      captured++;
      if (pairs.length % 100 === 0) {
        const a = await renderAt(evaluate, 0.5);
        const b = await renderAt(evaluate, 0.5);
        const d = maxAbsDiff(a, b);
        if (d > 1e-6) fail(`determinism spot-check at ${pairs.length} pairs: max |Δ| ${d}`);
      }
    }
  }
  appendFileSync(SEQ_FILE, JSON.stringify({ id: seqIndex, split, captured, ...plan, actorId: staged?.actorId ?? null }) + '\n');
  process.stdout.write(`seq ${seqIndex} ${plan.class}/${plan.lookAt} ${plan.character} room ${plan.room}: ${captured} pairs (total ${pairs.length}, ${(bytes / 1e9).toFixed(2)} GB)\n`);
  seqIndex++;
}

const newPairs = pairs.length - pairsAtStart;
stats.secondsPerPair = newPairs ? (Date.now() - startedAt) / 1000 / newPairs : 0;
const showcase = new Set(pickShowcase(pairs));
for (const p of pairs) p.showcase = showcase.has(p.id);
await evaluate('(() => { __sdfGame.setRenderLock(false); __sdfGame.freeze(false); __sdfGame.setSdfScale(1.0); __sdfGame.setFieldStyle("bodies"); return 1; })()');
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
  format: 'blud-upscale-dataset/2',
  created: new Date().toISOString(),
  checkout: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(),
  spec: 'docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md',
  seed: SEED,
  near, far,
  input: { fullW: IN_W, fullH: IN_H, sdfScale: 0.5, fieldStyle: 'off', temporalStart: g2.checks.temporalStart },
  target: { fullW: OUT_W, fullH: OUT_H, samples: GRID * GRID, grid: GRID, coverageRule: 'k >= 8', temporalStart: 'off' },
  rowOrder: 'row 0 = top',
  checks: { g2: g2.checks, supersample: ssChecks },
  stats,
  sequences: readJsonl(SEQ_FILE),
  pairs,
}, null, 1));
const byClass = pairs.reduce((m, p) => ({ ...m, [p.class]: (m[p.class] ?? 0) + 1 }), {});
console.log(`\nCAPTURE V2: ${pairs.length} pairs, ${(bytes / 1e9).toFixed(2)} GB, ${JSON.stringify(byClass)}, ${stats.secondsPerPair.toFixed(1)} s/pair, stats ${JSON.stringify(stats)} -> ${OUT}`);
process.exit(0);
```

- [ ] **Step 2: Write `scripts/upscale-dataset-check.py`**

```python
#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26"]
# ///
"""Validate a neural-upscale capture v2 dataset against docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §1.

Usage: uv run scripts/upscale-dataset-check.py ~/blud-upscale-data/<name>
"""
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np


def main(root: str) -> int:
    base = Path(root).expanduser()
    manifest = json.loads((base / "manifest.json").read_text())
    problems: list[str] = []
    if manifest.get("format") != "blud-upscale-dataset/2":
        problems.append(f"format {manifest.get('format')}")
    classes: Counter = Counter()
    splits: Counter = Counter()
    for p in manifest["pairs"]:
        pid, c = p["id"], p["crop"]
        h, w = c["h"], c["w"]
        a = np.load(base / p["files"]["in"])
        t = np.load(base / p["files"]["target"])
        cov = np.load(base / p["files"]["targetCoverage"])
        if a.shape != (h, w, 4) or a.dtype != np.float32:
            problems.append(f"{pid}: in {a.shape} {a.dtype}")
        if t.shape != (2 * h, 2 * w, 4) or t.dtype != np.float32:
            problems.append(f"{pid}: target {t.shape} {t.dtype}")
        if cov.shape != (2 * h, 2 * w, 1):
            problems.append(f"{pid}: coverage {cov.shape}")
        for name, arr in (("in", a), ("target", t), ("coverage", cov)):
            if not np.isfinite(arr).all():
                problems.append(f"{pid}: non-finite values in {name}")
        if t.shape[:2] == cov.shape[:2] and not np.array_equal(t[..., 3] < 1, cov[..., 0] >= 0.5):
            problems.append(f"{pid}: target alpha disagrees with coverage >= 0.5")
        if (p["split"] == "val") != (p["files"]["native"] is not None):
            problems.append(f"{pid}: native file present={p['files']['native'] is not None} for split {p['split']}")
        if p["files"]["native"]:
            n = np.load(base / p["files"]["native"])
            if n.shape != (2 * h, 2 * w, 4):
                problems.append(f"{pid}: native {n.shape}")
        for r in p["regions"]["heads"] + p["regions"]["wounds"]:
            if not (-r["r"] <= r["x"] <= 2 * w + r["r"] and -r["r"] <= r["y"] <= 2 * h + r["r"]):
                problems.append(f"{pid}: region outside its crop {r}")
        classes[p["class"]] += 1
        splits[p["split"]] += 1
    showcase = sum(1 for p in manifest["pairs"] if p["showcase"])
    heads = sum(1 for p in manifest["pairs"] if p["regions"]["heads"])
    wounds = sum(1 for p in manifest["pairs"] if p["regions"]["wounds"])
    print(f"pairs {len(manifest['pairs'])}  classes {dict(classes)}  splits {dict(splits)}  showcase {showcase}  with-head {heads}  with-wound {wounds}")
    print(f"stats {manifest.get('stats')}")
    for q in problems[:20]:
        print("PROBLEM", q)
    print("OK" if not problems else f"FAIL ({len(problems)} problems)")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
```

- [ ] **Step 3: Syntax check**

Run: `node --check scripts/upscale-capture-v2.mjs && python3 -c "import ast,sys; ast.parse(open('scripts/upscale-dataset-check.py').read())" && echo ok`
Expected: `ok`.

- [ ] **Step 4: Smoke capture (24 pairs) with the face check**

```bash
mkdir -p /tmp/blud-upscale-data
LAB_VITE_PORT=5320 LAB_CDP_PORT=9320 UPSCALE_DATA_ROOT=/tmp/blud-upscale-data UPSCALE_NAME=v2-smoke UPSCALE_PAIRS=24 UPSCALE_FRAMES=4 UPSCALE_FACE_SHOT=1 \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-capture-v2.mjs' 2>&1 | tee /tmp/p3a-task7.log | tail -40
uv run scripts/upscale-dataset-check.py /tmp/blud-upscale-data/v2-smoke
ls /tmp/blud-upscale-data/v2-smoke/face-check-*.png
```

Expected: `CAPTURE V2: 24 pairs …`, then `OK` from the checker, and one `face-check-*.png`.

**Face-direction check:** open the PNG (the Read tool shows images).
- If the close-up shows the **back** of the head, set `BODY_FACING_SIGN = -1` in `scripts/lib/upscale-framing.mjs`, delete `/tmp/blud-upscale-data/v2-smoke`, and rerun Step 4. The framing tests pass an explicit facing sign, so they don't change.
- If the PNG has no close-up head at all, the smoke drew no close head sequence. Rerun with `UPSCALE_SEED=2` (a fresh name) until one is captured.

If a resumed rerun is needed, run the same command again; it continues from `pairs.jsonl`.

- [ ] **Step 5: Notes and TASKS**

Create `docs/dev-notes/2026-09-11-neural-upscale/p3a-capture.md` with:
- date, checkout SHA, and the smoke command;
- the `supersample checks:` line and the G2 summary from the log;
- the checker output;
- **seconds per pair**, and the projected time for 1,000 pairs;
- the face-direction result and `BODY_FACING_SIGN`;
- skipped counts (`stats`);
- any problems.

In `TASKS.md`, in the `## Neural upscale (ESPCN family)` section, replace the line starting `- [ ] P3 spec` (and its continuation line) with:

```
- [x] P3 spec `docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md`; plans p3a–p3d + contracts in `docs/superpowers/plans/`.
- [x] P3a capture v2 built — smoke 24 pairs OK (`p3a-capture.md`). Owner: run the full ~1,000-pair capture (runbook in the plan).
```

- [ ] **Step 6: Commit**

```bash
git add scripts/upscale-capture-v2.mjs scripts/upscale-dataset-check.py docs/dev-notes/2026-09-11-neural-upscale/p3a-capture.md TASKS.md
git add -u scripts/lib/upscale-framing.mjs
git commit -m "feat(upscale P3): capture v2 — supersampled targets, framing mix, regions, resume; smoke 24 pairs"
```

---

## Owner step (not an agent task): the full capture

Run this on a quiet machine. It takes hours; use `p3a-capture.md`'s seconds-per-pair for the estimate. Rerunning the same command resumes.

```bash
LAB_VITE_PORT=5320 LAB_CDP_PORT=9320 UPSCALE_NAME=v2-2026-09-12 UPSCALE_PAIRS=1000 \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-capture-v2.mjs' 2>&1 | tee ~/blud-upscale-data/v2-2026-09-12.log
uv run scripts/upscale-dataset-check.py ~/blud-upscale-data/v2-2026-09-12
```
