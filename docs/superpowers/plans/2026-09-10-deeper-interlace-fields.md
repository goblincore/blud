# Deeper interlace fields (h/3, h/4) — implementation plan

**Goal:** make the interlaced field's divisor configurable (2 -> 3 or 4) so the
march pays a third or a quarter of the pixels instead of a half. This is the
only perf lever in the project with a **measured large number**: quartering the
pixels (`setSdfScale(0.5)`) bought **-54%**, against **-6..-31%, mostly
single-digit**, for a 6x cut in the step budget
(`docs/dev-notes/2026-08-31-game-perf-baseline/notes.md:204-238`, reproduced on
the interlace config 2026-09-10). The march is 51-63% of the labelled GPU frame
at 6.7-9.7 ms with no cadence, so it is the top frame item.

**Owner gate:** h/3 and h/4 are aesthetically APPROVED (2026-09-10), on the
understanding that the comb changes period from 2 rows to 3-4. This is a look
decision that must be made on screen, not in a bench number.

## What is already DONE (pure, tested, `fields = 2` bit-identical)

`src/lab/sdf-zombie/webgpu/field-render.ts`, 47 tests green:

- `fieldParity`, `fieldTargetHeight`, `fieldJitterNdcY`, `fieldRowSource`,
  `fieldHeldNeighbours` all take an optional `fields`. `fields = 2` reproduces
  the shipped answers EXACTLY, pinned in tests.
- `fieldRingDepth(fields)` = `fields - 1`: the retained buffers a deep field
  needs, or the extra held rows can only be interpolated and go soft.
- `fieldHistorySlot(y, currentField, fields)` / `fieldHistoryRead(...)`: WHICH
  retained buffer holds a row's real sample and WHERE in it. `fields = 2`
  resolves every held row to slot 0 — the single `prevField` that exists today.
- `fieldHeldNeighboursInteger(...)`: the **division-free** form the shader must
  evaluate. WGSL's `/` and `%` truncate toward zero, so the float derivation
  `ceil((y - field)/fields)` is wrong wherever `y < field` — a silently shifted
  scanline. The integer form is PROVEN equal to the float one on every held row
  at fields 2, 3 and 4, and reproduces the shipped `tRow - parity` form
  including its -1 edge.
- `fieldPixelFraction(fields)` = `1/fields`.

## Remaining steps, in order

### Step 1 — the shader, `fields` as a uniform (MECHANICAL now)

`src/lab/sdf-zombie/webgpu/sdf-layer.ts`, `COMPOSITE_WGSL` field branch (~L279):

```wgsl
let outRow = i32(floor(st.y * outHeight));
let nf = max(i32(fieldCount + 0.5), 1);
let tRow = outRow / nf;                       // outRow >= 0 -> true floor
if ((outRow % nf) == i32(fieldParityF)) { ...fresh... }
else {
  // fieldHeldNeighboursInteger, transcribed:
  let own = tRow * nf + i32(fieldParityF);
  let base = select(tRow - 1, tRow, own <= outRow);
  ... a = layerTex[base], b = layerTex[base + 1] ...
}
```

Add `fieldCount: f32` as the **LAST** input (the file's "meltCfg rule": bind it
in the same commit as the WGSL input). Bind `uFieldCount = uniform(2.0)`.

**⚠ THE HAZARD THIS PLAN EXISTS TO AVOID.** The inputs bind POSITIONALLY, and a
missing or zero `fieldCount` means division by zero in the composite, i.e.
broken rendering — which no unit test here can catch without a GPU. Do not land
this blind. Do it where a GPU round trip is available, and clamp in the shader
(`max(..., 1)`) so a bad binding degrades to "no interlace" rather than to NaN.

### Step 2 — the target height and the seam

- `resize()` already computes `h = fieldTargetHeight(hFull)`; pass the live
  `fields`. **Both** the march target and (for `'bodies'`) `fieldMesh` must move
  together, or bone and flesh weave on different grids.
- `setFieldCount(n)` / `fieldCount` on the `SdfLayer` interface + object,
  mirroring `setFieldComb`; `__sdfGame.setFieldCount(n)` and `?fields=N`.
- `FIELD_INTERLEAVE_WGSL` (the `'frame'` style) ALSO hardcodes `% 2` / `/ 2`.
  Either generalise it too or refuse `fields > 2` for `'frame'` — silently
  leaving it at 2 is the worst option.

### Step 3 — the history ring

With ONE retained buffer, only slot 0 has real data; every other held row falls
back to interpolation (the existing `comb` blend), which is stage 1 and is fine
to MEASURE with. To reconstruct properly:

- Allocate `fieldRingDepth(fields)` retained targets (3 prev for `fields = 4`),
  rotated per frame, and bind them to the composite.
- Per held row, `fieldHistoryRead` says which slot and row to read; use it when
  available, else interpolate. This is where the visual quality of h/3 and h/4
  is won or lost — interpolating two of three missing rows is exactly what makes
  a deep field read as "lower resolution" rather than as interlaced.

### Step 4 — measure, then look

- Cost: `BENCH_LEGS=baseline` with `?fields=3` / `4` via `BENCH_QUERY`, reading
  `sdf:march` (a true per-frame row, no cadence) against `fields=2`.
- **Expect less than the linear prediction.** h/2 -> h/4 halves the marched
  pixels, but the march also has per-pixel setup and post-hit shading that do
  not halve.
- Then the owner's eyes at each rung, `?fields=2` first as the control.

## Do not re-litigate

- **Step budget / miss tail:** measured dead. A 6x budget cut produces NO
  monotonic trend in `sdf:march` (9.05/8.96/10.28/8.88 at 96/48/24/16).
- **Cone pre-pass:** measured at 0.4% (`TASKS.md` X1.14); the occluder hull
  supersedes it, and enabling it reproduces a CPU submission stall
  (`../2026-09-10-cone-prepass-ab/notes.md`).
- **Checkerboard instead of scanlines:** performance is identical (both leave
  live pixels in every 2x2 quad) and the artifact reads as shimmer, not
  interlacing. Recorded in the original design spec.
- **Neural upscale:** lost to bicubic.
