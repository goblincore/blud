# SDF composite reconstruction (half-res flesh that does not look like crap) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Task 1 is pure and dispatchable; Task 2 needs a GPU and the owner's eyes.

**Goal:** Make the SDF layer's reduced-scale march (which already exists:
`sdfLayer.setScale`, `__sdfGame.setSdfScale(v)`, adaptive ladder 0.2–1.0)
look acceptable at 0.7 (ship candidate) and 0.5 (stretch) by replacing the
composite's nearest-texel republish with a depth-guided reconstruction, so
the march pays for ~half the pixels while silhouettes stay crisp.

**Architecture:** The flesh is marched into `target` at `scale × output`
(RGB colour, A = NDC depth, A ≥ 1.0 = "nothing here") and republished over
the polygonal scene by a full-res quad running `COMPOSITE_WGSL`
(`sdf-layer.ts` L256–337): one `textureLoad` at `floor(st * dims)`. This
plan adds `reconMode` to that function: mode 0 is the existing path
bit-for-bit; mode 1 is a 2×2 bilinear-weighted, depth-edge-stopped
reconstruction — colour is blended only across texels whose depth agrees
with the nearest texel's, and depth is NEVER interpolated (the composite's
standing rule: the alpha IS the depth the quad republishes, and a mix of two
depths describes no surface). Sentinel texels (A ≥ 1) carry zero weight, so a
silhouette against the wall keeps the nearest texel's edge rather than
smearing flesh into the background. A CPU twin in `sdf-composite-recon.ts`
pins the arithmetic with tests; the WGSL is pinned by parse and by shared
literals.
**Owner's framing (2026-09-10):** adaptive scaling is OFF because the low
rungs look like crap; "it would be amazing if reconstruction was better but
honestly I think it's hard at low resolutions." This plan's gate is his
look, at 0.7 first. Interior detail smaller than ~1/scale full-res pixels
(small wounds at 0.5) is genuinely lost and no reconstruction recovers it;
that is why 0.7 is the candidate. If 0.7 fails the look gate, STOP and plan
the alternative: temporal reprojection start inside the march (full
resolution, fewer steps per pixel), not more reconstruction.
**Tech Stack:** TypeScript, vitest, WGSL via `wgslFn`, three r185 WebGPU.

**What is NOT in scope:** neural upscaling (the 2026-09-08 experiment failed
to beat bicubic; dropped), changing the march, the half-rate hold/reproject
paths (`holdMode` 1/2 — reconstruction runs AFTER the hold logic picks `st`,
so it composes with them untouched), the interlaced field path (mode 1 is
skipped when `fieldMode > 0.5`, which has its own row rules).

## Facts pinned for the implementer (verified 2026-09-10 on `claude/level-probe-lighting`)

- `COMPOSITE_WGSL` is `fn sdfComposite(layerTex, prevFieldTex, texCoord, flipY, holdMode, heldInv, curVp, fieldMode, fieldParityF, fieldComb, outHeight) -> vec4<f32>` (`sdf-layer.ts` L256). The fresh path ends at L330–336:
  ```wgsl
  let c = clamp(vec2<i32>(floor(st * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  let texel = textureLoad(layerTex, c, 0);
  if (texel.w >= 1.0) { discard; }
  if (outDepth >= 0.0) { return vec4<f32>(texel.xyz, outDepth); }
  return texel;
  ```
  `dims` is the LAYER's size (`textureDimensions(layerTex, 0)`), `st` the output uv (flipped, possibly reprojected).
- The call site is `sdf-layer.ts` L852–864 (`composite({ layerTex: texture(target.texture), ... outHeight: uOutHeight })`); the quad writes `sampled.xyz` as colour and `sampled.w` as depth. New inputs go POSITIONALLY LAST in both the WGSL signature and this object (the file's "meltCfg rule": bind in the same commit as the WGSL inputs).
- `target` is created with `NearestFilter` (L632–633); mode 1 uses `textureLoad`, so the filter is irrelevant — do not change it.
- The existing WGSL contract tests live in `sdf-layer.test.ts` (imports `COMPOSITE_WGSL`; L191 slices the field branch, L200 pins a literal). Add to that file.
- `WGSLNodeFunction` parses inputs by `/name\s*:\s*type/` — a `word: word` in a signature COMMENT becomes a phantom input (see `probe-dynamic.wgsl.test.ts`); keep comments out of the signature.
- Public seams: `SdfLayer.setHalfRateMode(n)` (L493) is the pattern for a small numeric seam; `game-main.ts` forwards it at ~L5867 (`setHalfRateMode: (n) => sdfLayer.setHalfRateMode(n)`). `__sdfGame.setSdfScale(v)` exists (~L7481, clamps 0.2–1). Adaptive is OFF by default (`adaptiveEnabled = false`, ~L821).
- The layer is composited BEFORE FXAA/VHS (`post-aa.ts`), so the reconstruction is judged pre-lens; the VHS softening is on top.

## The reconstruction (mode 1), stated once

For output uv `st` and layer size `dims`:

```
f    = st * dims - 0.5              // texel-centre space
base = floor(f);  t = f - base      // 2x2 footprint: base .. base+1
w00 = (1-t.x)(1-t.y), w10 = t.x(1-t.y), w01 = (1-t.x)t.y, w11 = t.x t.y
texel_ij = load(clamp(base + (i,j)))
nearest  = the texel of the four with the largest w        // ties: 00,10,01,11 order
if nearest.w >= 1.0: discard                                 // same sentinel rule as mode 0
dRef = nearest.w
for each texel: k_ij = (texel_ij.w < 1.0 && |texel_ij.w - dRef| <= depthTol) ? w_ij : 0
colour = Σ k_ij * texel_ij.rgb / Σ k_ij      (Σ k > 0 always: nearest has k = w_nearest > 0)
depth  = dRef                                // never interpolated
```

`depthTol` is in NDC depth units; ship 0.002 (bodies are ~1 m deep at
NDC ~0.01/m near the camera; a wound is far under that; a body against a
wall is far over). Seam-tunable.

Properties the tests pin: (1) `t = 0` at a texel centre reproduces mode 0
exactly for any depthTol; (2) with all four depths equal it is plain
bilinear; (3) a sentinel neighbour contributes nothing and cannot make the
nearest texel discard; (4) depth out is always one of the inputs; (5)
weights sum to 1 over the kept set.

## File structure

- Create `src/lab/sdf-zombie/webgpu/sdf-composite-recon.ts` — the CPU twin
  (`reconstructTexel`) + the WGSL snippet `SDF_RECON_WGSL` (`fn sdfRecon(...)`)
  + the shared literals (`RECON_DEPTH_TOL`).
- Create `src/lab/sdf-zombie/webgpu/sdf-composite-recon.test.ts`.
- Modify `src/lab/sdf-zombie/webgpu/sdf-layer.ts`: `COMPOSITE_WGSL` gains
  `reconMode: f32, reconTol: f32` last and calls `sdfRecon` in the fresh
  path when `reconMode > 0.5 && fieldMode < 0.5`; the composite node includes
  `wgslFn(SDF_RECON_WGSL)`; two uniforms; `setReconMode(n)` / `setReconTol(v)`
  on the `SdfLayer` interface and object.
- Modify `src/lab/sdf-zombie/webgpu/sdf-layer.test.ts`: parse contract for
  the new inputs, literal pins.
- Modify `src/lab/sdf-zombie/webgpu/game-main.ts`: `__sdfGame.setRecon(mode)`,
  `setReconTol(v)`, `?recon=1` boot, HUD tag.

---

### Task 1: the reconstruction — CPU twin, WGSL, tests (dispatchable, pure)

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/sdf-composite-recon.ts`
- Create: `src/lab/sdf-zombie/webgpu/sdf-composite-recon.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lab/sdf-zombie/webgpu/sdf-composite-recon.test.ts
import { describe, it, expect } from 'vitest';
// @ts-expect-error — deep three source import for the real wgslFn parser (same
// pattern as probe-grid.wgsl.test.ts).
import WGSLNodeFunction from 'three/src/renderers/webgpu/nodes/WGSLNodeFunction.js';
import { RECON_DEPTH_TOL, SDF_RECON_WGSL, reconstructTexel, type Texel } from './sdf-composite-recon';

/** A 2x2 layer: index [j][i], texel = [r, g, b, depth]. */
const load = (grid: Texel[][]) => (x: number, y: number): Texel => {
  const j = Math.max(0, Math.min(grid.length - 1, y));
  const i = Math.max(0, Math.min(grid[0]!.length - 1, x));
  return grid[j]![i]!;
};

describe('reconstructTexel — the properties the composite relies on', () => {
  const flat: Texel[][] = [
    [[1, 0, 0, 0.5], [0, 1, 0, 0.5]],
    [[0, 0, 1, 0.5], [1, 1, 1, 0.5]],
  ];

  it('at a texel centre reproduces the nearest texel exactly (mode-0 parity)', () => {
    // st * dims - 0.5 = (0,0) -> texel (0,0) with weight 1.
    const r = reconstructTexel(load(flat), [2, 2], [0.25, 0.25], RECON_DEPTH_TOL);
    expect(r).toEqual({ rgb: [1, 0, 0], depth: 0.5, discard: false });
  });

  it('with equal depths is plain bilinear, and depth is untouched', () => {
    // Midpoint of the four centres: f = (0.5, 0.5) -> equal weights.
    const r = reconstructTexel(load(flat), [2, 2], [0.5, 0.5], RECON_DEPTH_TOL);
    expect(r.rgb[0]).toBeCloseTo(0.5, 9);
    expect(r.rgb[1]).toBeCloseTo(0.5, 9);
    expect(r.rgb[2]).toBeCloseTo(0.5, 9);
    expect(r.depth).toBe(0.5);
    expect(r.discard).toBe(false);
  });

  it('a depth edge stops the blend: far texels contribute nothing', () => {
    const edge: Texel[][] = [
      [[1, 0, 0, 0.30], [0, 0, 1, 0.31]],   // right texel is 0.01 deeper: an edge at tol 0.002
      [[1, 0, 0, 0.30], [0, 0, 1, 0.31]],
    ];
    // Just left of the midpoint: nearest is column 0 (weight 0.55 vs 0.45).
    const r = reconstructTexel(load(edge), [2, 2], [0.475, 0.5], 0.002);
    expect(r.rgb).toEqual([1, 0, 0]);
    expect(r.depth).toBe(0.30);
  });

  it('within tolerance the blend crosses: a wound-scale depth wiggle is not an edge', () => {
    const wiggle: Texel[][] = [
      [[1, 0, 0, 0.300], [0, 0, 1, 0.3005]],
      [[1, 0, 0, 0.300], [0, 0, 1, 0.3005]],
    ];
    const r = reconstructTexel(load(wiggle), [2, 2], [0.5, 0.5], 0.002);
    expect(r.rgb[0]).toBeCloseTo(0.5, 9);
    expect(r.rgb[2]).toBeCloseTo(0.5, 9);
  });

  it('a sentinel neighbour (alpha >= 1) has zero weight and never forces a discard', () => {
    const rim: Texel[][] = [
      [[0, 1, 0, 0.4], [0, 0, 0, 1.0]],
      [[0, 1, 0, 0.4], [0, 0, 0, 1.0]],
    ];
    const r = reconstructTexel(load(rim), [2, 2], [0.475, 0.5], RECON_DEPTH_TOL);
    expect(r.discard).toBe(false);
    expect(r.rgb).toEqual([0, 1, 0]);
    expect(r.depth).toBe(0.4);
  });

  it('discards exactly when the NEAREST texel is the sentinel (mode-0 rule)', () => {
    const rim: Texel[][] = [
      [[0, 1, 0, 0.4], [0, 0, 0, 1.0]],
      [[0, 1, 0, 0.4], [0, 0, 0, 1.0]],
    ];
    const r = reconstructTexel(load(rim), [2, 2], [0.525, 0.5], RECON_DEPTH_TOL);
    expect(r.discard).toBe(true);
  });

  it('depth out is always one of the input depths (never interpolated)', () => {
    const mixed: Texel[][] = [
      [[1, 0, 0, 0.30], [0, 1, 0, 0.31]],
      [[0, 0, 1, 0.32], [1, 1, 1, 0.33]],
    ];
    for (const st of [[0.3, 0.3], [0.5, 0.5], [0.7, 0.45], [0.45, 0.7]] as [number, number][]) {
      const r = reconstructTexel(load(mixed), [2, 2], st, 1.0);
      expect([0.30, 0.31, 0.32, 0.33]).toContain(r.depth);
    }
  });

  it('clamps the footprint at the layer border instead of reading outside', () => {
    const r = reconstructTexel(load(flat), [2, 2], [0.01, 0.01], RECON_DEPTH_TOL);
    expect(r.discard).toBe(false);
    expect(r.rgb).toEqual([1, 0, 0]);
  });
});

describe('SDF_RECON_WGSL — parse and shared-literal contract', () => {
  it('starts with fn sdfRecon, per the wgslFn parse contract', () => {
    expect(SDF_RECON_WGSL.startsWith('fn sdfRecon(')).toBe(true);
  });
  it('the real wgslFn parser sees exactly the four declared inputs, in order', () => {
    const parsed = new WGSLNodeFunction(SDF_RECON_WGSL);
    expect(parsed.inputs.map((i: { name: string }) => i.name)).toEqual(['layerTex', 'st', 'dims', 'depthTol']);
  });
  it('never interpolates depth and only ever loads (no sampler)', () => {
    expect(SDF_RECON_WGSL).toContain('textureLoad(');
    expect(SDF_RECON_WGSL).not.toContain('textureSample');
    // The returned depth is the nearest texel's, by name.
    expect(SDF_RECON_WGSL).toContain('return vec4<f32>(rgb, dRef);');
  });
  it('shares the sentinel rule and the tolerance literal with the CPU twin', () => {
    expect(SDF_RECON_WGSL).toContain('>= 1.0');
    expect(RECON_DEPTH_TOL).toBe(0.002);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/sdf-composite-recon.test.ts`
Expected: FAIL — `Cannot find module './sdf-composite-recon'`.

- [ ] **Step 3: Write the module**

```ts
// src/lab/sdf-zombie/webgpu/sdf-composite-recon.ts
//
// DEPTH-GUIDED RECONSTRUCTION of the SDF layer (plan
// docs/superpowers/plans/2026-09-10-sdf-composite-reconstruction.md). The
// flesh is marched at a reduced scale and republished over the polygonal
// scene by the composite quad, which loads ONE nearest texel — at 0.5 scale
// every silhouette is a staircase. This is the 2x2 bilinear-weighted,
// depth-edge-stopped alternative: colour blends only across texels whose
// depth agrees with the nearest texel's; depth is NEVER interpolated (the
// alpha IS the depth the quad republishes, and a mix of two depths
// describes no surface); sentinel texels (alpha >= 1, "nothing here") weigh
// nothing, so a body's edge against the wall stays the nearest texel's edge
// instead of smearing flesh into the background.
//
// The maths lives twice — reconstructTexel is the tested CPU twin of
// sdfRecon — and sdf-composite-recon.test.ts pins both.

/** Depth agreement, NDC units. A wound-scale wiggle is far under it; a body
 *  against the wall behind is far over it. */
export const RECON_DEPTH_TOL = 0.002;

/** One layer texel: rgb + NDC depth in alpha (>= 1 = nothing here). */
export type Texel = [number, number, number, number];

export interface ReconResult {
  rgb: [number, number, number];
  /** Always one of the input depths. */
  depth: number;
  /** True when the nearest texel is the sentinel — the caller discards. */
  discard: boolean;
}

const clampI = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * The CPU twin of `sdfRecon`. `load(x, y)` returns the texel at integer
 * layer coordinates (callers clamp or the function clamps for them);
 * `dims` is the layer size; `st` the output uv in [0,1].
 */
export function reconstructTexel(
  load: (x: number, y: number) => Texel,
  dims: [number, number],
  st: [number, number],
  depthTol: number,
): ReconResult {
  const fx = st[0] * dims[0] - 0.5, fy = st[1] * dims[1] - 0.5;
  const bx = Math.floor(fx), by = Math.floor(fy);
  const tx = fx - bx, ty = fy - by;
  const w: [number, number, number, number] = [
    (1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty,
  ];
  const texels: Texel[] = [];
  for (let k = 0; k < 4; k++) {
    const x = clampI(bx + (k & 1), 0, dims[0] - 1);
    const y = clampI(by + (k >> 1), 0, dims[1] - 1);
    texels.push(load(x, y));
  }
  // Nearest = largest weight; ties resolve in 00, 10, 01, 11 order (strict >).
  let n = 0;
  for (let k = 1; k < 4; k++) if (w[k]! > w[n]!) n = k;
  const nearest = texels[n]!;
  if (nearest[3] >= 1.0) return { rgb: [0, 0, 0], depth: nearest[3], discard: true };
  const dRef = nearest[3];
  let sum = 0, r = 0, g = 0, b = 0;
  for (let k = 0; k < 4; k++) {
    const t = texels[k]!;
    const keep = t[3] < 1.0 && Math.abs(t[3] - dRef) <= depthTol;
    const kw = keep ? w[k]! : 0;
    sum += kw; r += kw * t[0]; g += kw * t[1]; b += kw * t[2];
  }
  // sum > 0 always: the nearest texel is kept with its own (positive) weight.
  return { rgb: [r / sum, g / sum, b / sum], depth: dRef, discard: false };
}

/**
 * The WGSL twin. Returns rgb + the nearest texel's depth; a depth of 1.0
 * or more in .w means "discard" (the nearest texel was the sentinel) —
 * the caller tests `.w >= 1.0` exactly as it does for a plain load.
 * Inputs stay comment-free: the wgslFn parser reads `name: type` pairs.
 */
export const SDF_RECON_WGSL = /* wgsl */ `fn sdfRecon(
  layerTex: texture_2d<f32>,
  st: vec2<f32>,
  dims: vec2<f32>,
  depthTol: f32
) -> vec4<f32> {
  let f = st * dims - vec2<f32>(0.5, 0.5);
  let base = floor(f);
  let t = f - base;
  let w = vec4<f32>((1.0 - t.x) * (1.0 - t.y), t.x * (1.0 - t.y), (1.0 - t.x) * t.y, t.x * t.y);
  let maxI = vec2<i32>(dims) - vec2<i32>(1, 1);
  let b = vec2<i32>(base);
  let t00 = textureLoad(layerTex, clamp(b, vec2<i32>(0, 0), maxI), 0);
  let t10 = textureLoad(layerTex, clamp(b + vec2<i32>(1, 0), vec2<i32>(0, 0), maxI), 0);
  let t01 = textureLoad(layerTex, clamp(b + vec2<i32>(0, 1), vec2<i32>(0, 0), maxI), 0);
  let t11 = textureLoad(layerTex, clamp(b + vec2<i32>(1, 1), vec2<i32>(0, 0), maxI), 0);
  // Nearest = largest weight; ties resolve 00, 10, 01, 11 (strict >), as the CPU twin.
  var nearest = t00;
  var wn = w.x;
  if (w.y > wn) { nearest = t10; wn = w.y; }
  if (w.z > wn) { nearest = t01; wn = w.z; }
  if (w.w > wn) { nearest = t11; wn = w.w; }
  if (nearest.w >= 1.0) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  let dRef = nearest.w;
  let k00 = select(0.0, w.x, t00.w < 1.0 && abs(t00.w - dRef) <= depthTol);
  let k10 = select(0.0, w.y, t10.w < 1.0 && abs(t10.w - dRef) <= depthTol);
  let k01 = select(0.0, w.z, t01.w < 1.0 && abs(t01.w - dRef) <= depthTol);
  let k11 = select(0.0, w.w, t11.w < 1.0 && abs(t11.w - dRef) <= depthTol);
  let sum = k00 + k10 + k01 + k11;
  let rgb = (t00.xyz * k00 + t10.xyz * k10 + t01.xyz * k01 + t11.xyz * k11) / sum;
  return vec4<f32>(rgb, dRef);
}`;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/sdf-composite-recon.test.ts`
Expected: PASS, 12 tests. If the "sentinel neighbour" case fails, check
the nearest choice: at `st.x = 0.475` on a 2-wide layer, `f.x = 0.45`, so
`t.x = 0.45` and column 0 has weight 0.55 — column 0 must be nearest.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p .` — expected: no output (clean).
```bash
git add src/lab/sdf-zombie/webgpu/sdf-composite-recon.ts src/lab/sdf-zombie/webgpu/sdf-composite-recon.test.ts
git commit -m "feat(sdf-layer): depth-guided reconstruction — CPU twin, WGSL, tests (not wired)"
```

---

### Task 2: wire `reconMode` into the composite, seams, owner A/B (GPU, session)

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/sdf-layer.ts` (COMPOSITE_WGSL L256–337, composite call L852–864, interface ~L430–500, the returned object ~L1350+)
- Modify: `src/lab/sdf-zombie/webgpu/sdf-layer.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts` (seams next to `setHalfRateMode` ~L5867; boot param; HUD)

- [ ] **Step 1: Write the failing contract tests** (append to `sdf-layer.test.ts`)

```ts
describe('COMPOSITE_WGSL — reconstruction inputs (plan 2026-09-10)', () => {
  it('declares reconMode and reconTol as the LAST two inputs', () => {
    const parsed = new WGSLNodeFunction(COMPOSITE_WGSL);
    const names = parsed.inputs.map((i: { name: string }) => i.name);
    expect(names.slice(-2)).toEqual(['reconMode', 'reconTol']);
  });
  it('calls sdfRecon only on the fresh path, gated on reconMode, outside the field branch', () => {
    const field = COMPOSITE_WGSL.slice(COMPOSITE_WGSL.indexOf('if (fieldMode > 0.5)'), COMPOSITE_WGSL.indexOf('// holdMode:'));
    expect(field).not.toContain('sdfRecon(');
    expect(COMPOSITE_WGSL).toContain('if (reconMode > 0.5) {');
    expect(COMPOSITE_WGSL).toContain('sdfRecon(layerTex, st, dims, reconTol)');
  });
});
```
(`WGSLNodeFunction` is imported the same way as in `probe-grid.wgsl.test.ts`; add the import at the top of `sdf-layer.test.ts` if it is not there.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/sdf-layer.test.ts`
Expected: the two new tests FAIL (`names.slice(-2)` is `['fieldComb', 'outHeight']`).

- [ ] **Step 3: Extend `COMPOSITE_WGSL`**

Signature: after `outHeight: f32` add
```wgsl
  outHeight: f32,
  reconMode: f32,
  reconTol: f32
) -> vec4<f32> {
```
Fresh path (replace L330–336):
```wgsl
  // RECONSTRUCTION (plan 2026-09-10). reconMode 0 is the classic single
  // load, bit-identical; 1 is the depth-guided 2x2 blend from
  // sdf-composite-recon.ts. Runs AFTER the hold logic chose `st`, so it
  // composes with the reprojected hold; the interlaced field path above
  // returned already and keeps its own row rules.
  if (reconMode > 0.5) {
    let rec = sdfRecon(layerTex, st, dims, reconTol);
    if (rec.w >= 1.0) { discard; }
    if (outDepth >= 0.0) { return vec4<f32>(rec.xyz, outDepth); }
    return rec;
  }
  let c = clamp(vec2<i32>(floor(st * dims)), vec2<i32>(0, 0), vec2<i32>(dims) - vec2<i32>(1, 1));
  let texel = textureLoad(layerTex, c, 0);
  if (texel.w >= 1.0) { discard; }
  if (outDepth >= 0.0) { return vec4<f32>(texel.xyz, outDepth); }
  return texel;
```
Include the helper and bind the inputs (the meltCfg rule — same commit):
```ts
import { SDF_RECON_WGSL, RECON_DEPTH_TOL } from './sdf-composite-recon';
// ...
const composite = wgslFn(COMPOSITE_WGSL, [wgslFn(SDF_RECON_WGSL) as never]);
// ... in createSdfLayer, next to uHoldMode (L622):
const uReconMode = uniform(0);
const uReconTol = uniform(RECON_DEPTH_TOL);
// ... in the composite({...}) call, LAST:
    outHeight: uOutHeight,
    reconMode: uReconMode,
    reconTol: uReconTol,
```
Interface (next to `setHalfRateMode(n: number): void;`):
```ts
  /** Composite reconstruction: 0 = classic nearest load (bit-identical),
   *  1 = depth-guided 2x2 blend (sdf-composite-recon.ts). */
  setReconMode(n: number): void;
  readonly reconMode: number;
  /** Depth agreement for the blend, NDC units (RECON_DEPTH_TOL ships). */
  setReconTol(v: number): void;
```
Object (next to the `setHalfRateMode` implementation):
```ts
    setReconMode(n) { uReconMode.value = n > 0.5 ? 1 : 0; },
    get reconMode() { return uReconMode.value as number; },
    setReconTol(v) { uReconTol.value = Math.max(0, v); },
```

- [ ] **Step 4: Run the layer tests and typecheck**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/sdf-layer.test.ts` — expected: PASS (all, including the two new).
Run: `npx tsc --noEmit -p .` — expected: clean.

- [ ] **Step 5: Game seams** (`game-main.ts`, next to `setHalfRateMode` ~L5867)

```ts
    /** Composite reconstruction for the reduced-scale flesh (plan
     *  2026-09-10): 0 classic, 1 depth-guided. ?recon=1 boots it on. */
    setRecon: (mode: number) => { sdfLayer.setReconMode(mode); return sdfLayer.reconMode; },
    get recon() { return sdfLayer.reconMode; },
    setReconTol: (v: number) => { sdfLayer.setReconTol(v); return v; },
```
Boot param, right after `sdfLayer.setScale(sdfScale)` (~L782):
```ts
  // ?recon=1 boots the depth-guided composite; default OFF until the owner's
  // look gate passes (plan 2026-09-10). ?sdfscale=0.7 pairs with it.
  if (new URLSearchParams(location.search).get('recon') === '1') sdfLayer.setReconMode(1);
```
(If `?sdfscale=` does not already exist as a boot param, add it next to it:
`const sdfScaleParam = Number(new URLSearchParams(location.search).get('sdfscale')); if (sdfScaleParam > 0) applySdfScale(sdfScaleParam);` — `applySdfScale` is defined at ~L784; check it is declared before this line, else place the call after it.)
HUD: where the HUD string appends `ADAPTIVE r${…}` (~L4011), add
`(sdfLayer.reconMode ? ' · RECON' : '')`.

- [ ] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/sdf-layer.ts src/lab/sdf-zombie/webgpu/sdf-layer.test.ts src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "feat(sdf-layer): reconMode on the composite — depth-guided 2x2 blend behind __sdfGame.setRecon / ?recon=1"
```

- [ ] **Step 7: GPU checks (in-app browser or the owner's Chrome; hidden panes stop rAF — use `__sdfGame.step`)**

1. Parity: `setRecon(0)` at scale 1.0 must be bit-identical to before — canvas readback region means equal to the noise floor (the probe-lighting session's readback recipe: 2D canvas `drawImage` + `getImageData`, frozen scene via `__sdfGame.freeze(true)` + `setLightClockFrozen(true)`).
2. At scale 1.0, `setRecon(1)` vs `0`: near-identical (the 2x2 at a texel centre is the nearest texel; differences only at sub-texel uv phase, which at scale 1 is zero).
3. At `setSdfScale(0.7)` and `0.5`: screenshots of a body against a wall, recon 0 vs 1 — the staircase silhouette should be gone in 1, the rim against the wall still hard (no flesh halo on the wall), and NO depth artefacts where a limb crosses the torso (that is the depthTol working; if a halo appears, lower the tol; if limb edges look torn, raise it).
4. Frame cost: `__sdfGame.bench({ mode: 'passes' })` (the timestamp collector only samples inside the bench) at scale 1.0 vs 0.7 vs 0.5, recon 1 — the composite pass should be within noise of before (four loads instead of one), the march pass ~half at 0.7 (0.49×) and ~quarter at 0.5.

- [ ] **Step 8: THE LOOK GATE (owner).** `?sdfscale=0.7&recon=1` in a real playtest, wounds and all; then 0.5. Owner decides: ship 0.7 ON (flip the default in Step 5's boot param and record it), keep it a knob, or STOP. If it fails at 0.7, the next plan is temporal reprojection start inside the march, not more reconstruction.

### Risks

- The hold/reproject path (holdMode 2) changes `st` before the fresh path;
  mode 1 reads the same `st`, so it composes — but a reprojected `st` can
  land off-layer; the clamp in `sdfRecon` handles it like mode 0's clamp.
- `depthTol` is in NDC units, which are non-linear in distance: the same
  tolerance is looser near the camera than far away. Acceptable for the
  gate; if far bodies show halos, switch the test to linearised depth
  (needs near/far uniforms — not in this plan).
- Four loads per composite pixel instead of one. The composite runs at
  full res; the loads are cached and neighbouring. Measure, do not assume.
