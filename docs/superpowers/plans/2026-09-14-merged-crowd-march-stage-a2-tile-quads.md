# Merged crowd march — stage a-2: one fragment per pixel (screen quad per type) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crowd type's instanced proxy boxes with one screen-covering quad per type so every pixel is marched exactly once against the union field, removing the overlap-proportional duplicate traces Task 7f measured (per-visible-body premium 1.18× → 2.37× from 2 to 8 bodies).

**Architecture:** The crowd material draws a single full-screen quad (clip-space vertex override) and reconstructs the pixel ray from `screenUV` and the camera matrices; `MARCH_TRACE_SETUP` gains a third entry mode (`instCfg.y == 2`) where the fragment's conservative entry is the nearest ray-sphere entry over the pixel's preloaded tile entries, and a pixel whose tile list is empty or whose ray misses every inflated sphere discards before any stepping. The depth-prepass twin uses the same quad and entry rule. Per-body materials are untouched (`instCfg.y == 0` keeps the box path bit-identical; canonical hash `a8ab4e…` must not move). The crowd acceptance gate is `scripts/march-parity.mjs` (Task 7b), re-pinned for the new start point. Base: `dispatch/2026-09-13-merged-crowd-march-stage-a-task-7f`. Spec: `docs/superpowers/specs/2026-09-13-merged-crowd-march-design.md` D5 (stage a-2).

**Tech Stack:** TypeScript, three r185 WebGPU/TSL (`vertexNode`, `cameraProjectionMatrixInverse`, `cameraWorldMatrix`, `screenUV`), vitest, `scripts/march-hash.mjs`, `scripts/march-parity.mjs`, `scripts/sdf-game-bench.mjs`.

---

## Conventions

- Browser scripts: `. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up` with `LAB_VITE_PORT=5323 LAB_CDP_PORT=9323`; the bench takes ports as argv. Output under ~150 lines per call; never print base64.
- Safety (unchanged from 7d–7f): `BENCH_FRAME_CAP_MS=250` guard on, `BENCH_CROWD_MAX=24`, never above 24, kill any browser step silent for 60 s, check `uptime` and wait while 1-minute load > 4, record the load.
- Gates on every task: `npx tsc --noEmit -p .` clean; `node scripts/march-hash.mjs` = `a8ab4efac15fc0376c3e4e05420f13e34d1511bd` twice; the vitest files named per task; `node scripts/march-parity.mjs` per the task's rule.
- Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Names fixed here: WGSL `instCfg.y == 2` = quad mode, `gTileEntryT` (nearest sphere entry), `QUAD_ENTRY_SLACK`; TS `createCrowdQuadGeometry()`, `crowdRayNodes()` (in `crowd-type.ts` / `zombie-gpu.ts`), `CrowdType.dispatch: 'boxes' | 'quad'`, `__sdfGame.setCrowdDispatch(mode)`, bench legs `crowd-quad`, `crowd-boxes`.

## File map

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/march.wgsl.ts` | quad entry mode in `MARCH_TRACE_SETUP` (and the depth-prepass entry); `gTileEntryT` |
| `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` | pins for the new branch |
| `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` | `createCrowdMaterial(..., dispatch)` — quad vertex override + ray reconstruction nodes |
| `src/lab/sdf-zombie/webgpu/crowd-type.ts` | `createCrowdQuadGeometry`, `dispatch` option, `setDispatch`, instance attrs kept for boxes |
| `src/lab/sdf-zombie/webgpu/crowd-type.test.ts` | dispatch switch test |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | `?crowddispatch=quad|boxes` (default `quad`), `__sdfGame.setCrowdDispatch`, `crowdInfo().dispatch` |
| `scripts/march-parity.mjs` | `MARCH_PARITY_DISPATCH` env; thresholds re-pinned for quad |
| `scripts/sdf-game-bench.mjs` | legs `crowd-quad`, `crowd-boxes` |
| `docs/dev-notes/2026-09-13-merged-crowd-march-stage-a.md` | `## Stage a-2` sections |

---

## Task A2-1: Quad dispatch in the kernel and the crowd type

**Files:** `march.wgsl.ts`, `march.wgsl.test.ts`, `zombie-gpu.ts`, `crowd-type.ts`, `crowd-type.test.ts`, `game-main.ts`, `scripts/march-parity.mjs`

- [ ] **Step 1: Failing kernel pins.** In `march.wgsl.test.ts` add:

```ts
describe('crowd quad dispatch (stage a-2)', () => {
  it('has a quad entry mode gated on instCfg.y == 2 that discards empty tiles before stepping', () => {
    expect(MARCH_TRACE_SETUP).toContain('let quadMode = instCfg.y > 1.5;');
    expect(MARCH_TRACE_SETUP).toContain('if (quadMode && gTileN < 0.5) { discard;');
    expect(MARCH_TRACE_SETUP).toContain('gTileEntryT');
    expect(MARCH_TRACE_SETUP).toContain('let bodyEntry = select(boxEntry, gTileEntryT, quadMode);');
  });
  it('keeps the box entry text for instCfg.y <= 1', () => {
    expect(MARCH_TRACE_SETUP).toContain('let boxEntry = max(max(min(bLo.x, bHi.x), min(bLo.y, bHi.y)), max(min(bLo.z, bHi.z), 0.0));');
  });
});
```

Run `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` — FAIL.

- [ ] **Step 2: Kernel — nearest sphere entry during the tile preload.** In `MARCH_TRACE_SETUP`'s preload loop (the one that fills `gTileBounds[w]` etc., after the optional `rayCull` test), accumulate the nearest conservative entry along the ray:

```wgsl
    var entryT = 1e9;
    // ... inside the loop, after the entry survives rayCull:
      {
        let oc = b.xyz - camPos;
        let tc = dot(oc, rd);
        let rInf = b.w + reach * max(g.z, 1.0) + ${QUAD_ENTRY_SLACK};
        let d2 = dot(oc, oc) - tc * tc;
        if (d2 <= rInf * rInf) {
          let th = sqrt(max(rInf * rInf - d2, 0.0));
          entryT = min(entryT, max(tc - th, 0.0));
        }
      }
    // ... after the loop:
    gTileEntryT = entryT;
```

`export const QUAD_ENTRY_SLACK = '0.02';` (metres; the sphere already carries blendReach × distortion, this covers the smin support's outward bulge). Declare `var<private> gTileEntryT: f32 = 1e9;` next to `gTileN`. `reach` already exists in that block (`gInstCounts.w * 4.0 + RAY_CULL_SLACK`); in quad mode `gInstCounts` is slot 0's record — replace `reach` in this block with the max `maxBlendK` the type stamps: add it as `instCfg.w` (`CrowdType.sync` sets `instCfg.value.w = maxBlendK`; per-body views set 0 and the box path never reads it): `let reach = select(gInstCounts.w, instCfg.w, quadMode) * 4.0 + RAY_CULL_SLACK`. When `tileCfg.x < 0.5` (tiles off) the preload does not run; in quad mode with tiles off set `gTileEntryT = 0.0` (march from the camera; correct, slow, only a debug configuration — log once from `sync()` when `dispatch === 'quad'` and tiles are off).

- [ ] **Step 3: Kernel — entry selection and empty-tile discard.** Replace the box-entry block:

```wgsl
  let quadMode = instCfg.y > 1.5;
  if (quadMode && gTileN < 0.5) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  let boxCentre = select(gInstCentre, instCentre, instCfg.y > 0.5);
  let boxHalf = select(gInstHalf, instHalf, instCfg.y > 0.5);
  let bLo = (boxCentre - boxHalf - camPos) * invRd;
  let bHi = (boxCentre + boxHalf - camPos) * invRd;
  let boxEntry = max(max(min(bLo.x, bHi.x), min(bLo.y, bHi.y)), max(min(bLo.z, bHi.z), 0.0));
  let bodyEntry = select(boxEntry, gTileEntryT, quadMode);
  if (quadMode && bodyEntry > 1e8) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
  if (max(shellIn, bodyEntry) > prevT) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }
```

The two `discard` lines must be placed AFTER the tile preload (it is — the preload is earlier in SETUP) and BEFORE the wound-list build if that build is expensive (move the empty-tile discard up to immediately after `gTileN = f32(w);` if the wound list precedes the box block; the pin in Step 1 only requires the text to exist). Mirror the same three lines in `DEPTH_PREPASS_MARCH` (it has its own box-entry copy — grep `bodyEntry` in it; if the depth-prepass entry has no box entry and starts at 0, add only the empty-tile discard and `t = max(t, gTileEntryT)` in quad mode).

Bit-identity argument (comment it): for `instCfg.y <= 1`, `quadMode` is false, both discards are dead, `bodyEntry == boxEntry` verbatim, and `gTileEntryT` is never read.

- [ ] **Step 4: Run the kernel pins + the parser pin** — `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/deferred-sdf.test.ts` — PASS (the 7d `WGSLNodeFunction` pin over every helper must still pass; no `(`/`)`/`:` in param-list comments).

- [ ] **Step 5: Crowd material — quad vertex override and ray reconstruction.** In `zombie-gpu.ts` `createCrowdMaterial(atlasTex, uniforms, crowd, tiles, sources, dispatch: 'boxes' | 'quad' = 'boxes')`:

```ts
import { vec4, vec3, positionGeometry, screenUV, cameraProjectionMatrixInverse, cameraWorldMatrix, cameraPosition, cameraFar, normalize, float } from 'three/tsl';

function crowdRayNodes() {
  // Full-screen quad: geometry is PlaneGeometry(2, 2) in clip space; z = 1 keeps
  // it at the far plane so the hardware depth test never rejects it early.
  const clip = vec4(positionGeometry.xy, float(1.0), float(1.0));
  // Pixel ray from screenUV, y flipped to match the march's screenUV convention
  // (check MARCH_TRACE_SETUP's use of screenUV and the tile binner's flip).
  const ndc = vec4(screenUV.x.mul(2).sub(1), float(1).sub(screenUV.y).mul(2).sub(1), float(1.0), float(1.0));
  const view = cameraProjectionMatrixInverse.mul(ndc);
  const view3 = view.xyz.div(view.w);
  const dirWorld = normalize(cameraWorldMatrix.mul(vec4(view3, float(0.0))).xyz);
  const worldPos = cameraPosition.add(dirWorld.mul(cameraFar));
  return { clip, worldPos };
}
```

For `dispatch === 'quad'`: `material.vertexNode = clip`, pass `rays: { worldPos, startT: float(0) }` through the existing `rays` override of `createMarchMaterial` (the hull-refine view is prior art for `rays`), bind `instCentre`/`instHalf` to zero vec3 uniforms, and set `instCfg.y = 2` in `sync()`. The depth-pre twin material gets the same `vertexNode` and `worldPos`. Verify how `createMarchMaterial` computes `depthNode` from the hit `t` and `worldPos` (it must use `camPos + rd * t`, not the interpolated vertex depth; if it derives depth from `positionWorld`, switch it to the ray form for the quad path only). Confirm `screenUV` orientation by a 30-second lab check: with `?crowd=1&crowddispatch=quad` the room-1 close-up must show bodies where the per-body path shows them (compare `readMarchTarget` hit masks in `march-parity`; a flipped ray gives `maskDiff ≈ 100 %`).

- [ ] **Step 6: Crowd type — dispatch switch.** In `crowd-type.ts`: `createCrowdQuadGeometry()` returns `new THREE.PlaneGeometry(2, 2)`; `createCrowdType(renderer, name, uniforms, maxW, maxH, opts?: { dispatch?: 'boxes' | 'quad' })` builds BOTH geometries and both material pairs, and `mesh.geometry`/`mesh.material` (and the depth-pre twin) point at the active pair; `setDispatch(mode)` swaps them and stamps `instCfg.y` (1 boxes, 2 quad) on the next `sync()`. In quad mode `sync()` skips the instance-attribute pack (still computes `visible` for `info()`), stamps `instCfg.w = maxBlendK`, and sets `mesh.frustumCulled = false`. `info()` reports `dispatch`. Test (`crowd-type.test.ts`): after `setDispatch('quad')` + `sync`, `instCfg.value.y === 2` and `mesh.geometry` is the plane; after `setDispatch('boxes')`, `instCfg.value.y === 1` and the instanced geometry is back.

- [ ] **Step 7: Game seams.** `game-main.ts`: `?crowddispatch=quad|boxes` (default `quad`), passed to `createCrowdType`; `__sdfGame.setCrowdDispatch(mode)` loops types; `crowdInfo()` includes `dispatch`. Bench: legs `'crowd-quad': { setCrowd: true, setTiles: true, setCrowdDispatch: 'quad' }` and `'crowd-boxes': { ... 'boxes' }`; keep `crowd-on` as an alias of `crowd-quad`.

- [ ] **Step 8: Parity re-pin.** `scripts/march-parity.mjs`: `MARCH_PARITY_DISPATCH` (default `quad`) calls `setCrowdDispatch` on the crowd boot. Run tiles-on (quad mode is only meaningful with tiles) for rooms 1–2:

```bash
MARCH_PARITY_TILES=1 node scripts/march-parity.mjs
MARCH_PARITY_TILES=1 MARCH_PARITY_DISPATCH=boxes node scripts/march-parity.mjs   # must still PASS at the 7b thresholds
```

Expected for quad: `maskDiffFrac` small but possibly non-zero at silhouette rims (the entry moved from a box face to a sphere; the AA-gated hit can flip on rim pixels), `maxDz` larger than 7b's 1.4e-3 by up to one hit epsilon at the surface. Re-pin the QUAD thresholds from measurement (2× the maxima, one significant figure) as a separate threshold set keyed by dispatch; keep the boxes set unchanged. Hard ceilings regardless of measurement: `maskDiffFrac <= 0.005`, `maxDz <= 2e-2`, flat-albedo `rgbDiffChannels` restricted to pixels whose `|dz| > 0` (same prim, same albedo where t agrees). If any ceiling is exceeded, stop and report; the likely causes are a flipped ray (mask ≈ 100 %), a too-small `QUAD_ENTRY_SLACK` (mask diff concentrated at rims where the ray grazes a sphere — raise to 0.05 and re-measure), or the depth node still reading vertex depth (all hit pixels at far-plane depth).

- [ ] **Step 9: Gates and commit**

```bash
npx tsc --noEmit -p .
npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/deferred-sdf.test.ts src/lab/sdf-zombie/webgpu/crowd-type.test.ts
node scripts/march-hash.mjs   # a8ab4e…, twice
```

```bash
git add src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/zombie-gpu.ts src/lab/sdf-zombie/webgpu/crowd-type.ts src/lab/sdf-zombie/webgpu/crowd-type.test.ts src/lab/sdf-zombie/webgpu/game-main.ts scripts/march-parity.mjs scripts/sdf-game-bench.mjs docs/dev-notes/2026-09-13-merged-crowd-march-stage-a.md
git commit -m "feat(crowd): stage a-2 quad dispatch — one fragment per pixel, tile-sphere entry, empty-tile discard; parity re-pinned per dispatch"
```

Write `## Stage a-2 (1) — quad dispatch (2026-09-14)` in the dev note: the parity JSON lines for both dispatch modes and the pinned thresholds.

---

## Task A2-2: The knee again, quad vs boxes

**Files:** `docs/dev-notes/2026-09-13-merged-crowd-march-stage-a.md`, `TASKS.md`

- [ ] **Step 1: Sweep.** Same as Task 7f Step 2 with the two crowd legs:

```bash
for n in 2 4 6 8; do
  BENCH_PASSES=1 BENCH_REPEATS=1 BENCH_ROOMS=1 BENCH_LEGS=baseline,crowd-quad,crowd-boxes BENCH_CROWD=$n BENCH_QUERY='crowd=1&tiles-playtest' BENCH_OUT=docs/dev-notes/2026-09-13-merged-crowd-march-stage-a/a2-crowd$n node scripts/sdf-game-bench.mjs 5323 9323 || true
done
```

Load check before each. Then 12 and 16 if `crowd-quad` completed at 8; 24 only if 16 completes and its `crowd-quad` march ≤ 2× the 8 number. Record `crowdInfo()` (`dispatch`, `visible`, `clampedTiles`, `culledByBudget`, `tileFallbacks`) per crowd row.

- [ ] **Step 2: Note and verdict.** `## Stage a-2 (2) — knee, quad vs boxes` with the 7f-format table plus a `crowd-quad` column, the per-visible-body premium for both dispatch modes, and a three-sentence verdict: (1) is the quad premium flat in `n` (the duplicate-trace hypothesis confirmed or refuted); (2) quad vs boxes at 8; (3) highest `n` completed and whether crowd 24 was earned. Update `TASKS.md`'s crowd entry with the a-2 result and the next action (default flip Task 8 if the a-3 bars in the spec hold, otherwise what blocks).

- [ ] **Step 3: Commit** — `docs(crowd): stage a-2 knee — quad vs boxes, 2..8(+) bodies, verdict`.

## Self-review notes

- D5's stage a-2 is exactly this; D7 unchanged (refine/cone still unsupported under crowd); the spec §5 a-2 bar is now the per-dispatch parity thresholds.
- Names used consistently: `quadMode`, `gTileEntryT`, `QUAD_ENTRY_SLACK`, `instCfg.y` (0 per-body, 1 boxes, 2 quad), `instCfg.w` maxBlendK, `setDispatch`, `setCrowdDispatch`, legs `crowd-quad`/`crowd-boxes`.
- Known gaps stated: tiles-off quad marches from the camera (debug only); rim-pixel mask flips accepted up to 0.5 %; the temporal-start margin treats the quad mesh as one body at the origin (as before).
