# Per-ray wound list — result (2026-09-07)

**Question:** cut the per-step cost of the wound loop in the SDF march by
building, ONCE per pixel at the march entry, the list of wounds whose reach
sphere the pixel's ray can enter — so every march step (and every post-hit
probe) folds only those instead of all sixteen. Behind a seam (`counts2.w`),
proven pixel-identical, measured against the pass-attribution bench.

**Prediction (from the plan):** likely ~0. The `wound-earlyout-off` leg
(run 5 of the pass-attribution study) already showed the wound loop's per-step
skips cost nothing measurable, which suggests the per-step texel loads are not
the dominant term inside the near-wound zone. A parity-proven ~0 is a valid
result — it retires the idea with a number.

## What was built

Three code sites, one seam:

1. **`src/lab/sdf-zombie/webgpu/march.wgsl.ts`**
   - Private per-invocation list state beside the `gTile*` vars:
     `gWoundListOn` (0), `gWoundN` (0), `gWoundList` (`array<i32,16>`). Private
     vars start at their initialisers, so the cone/depth pre-pass chains —
     separate invocations that never run the preload — keep `gWoundListOn` 0
     and fold the full 16-wound loop: conservative by construction.
   - `MARCH_BODY` wound preload, immediately after the `TILE-LIST PRELOAD`
     (so `rd`/`camPos` exist): on `counts2.w > 0.5`, iterate the wound rows,
     keep those whose reach sphere the ray can enter (`dot(oc,oc) - tc*tc >
     reach*reach` → skip), store the survivor index in `gWoundList`. Uses the
     SAME reach formula as `applyWounds`, plus `RAY_CULL_SLACK` for the
     off-ray post-hit probes.
   - `APPLY_WOUNDS` loop head now folds by `gWoundList` when ON, and iterates
     identically (`k == i`, same break on `n`) when OFF — so OFF is
     bit-identical to the shipped shader. The union-reach early return stays
     first, before the loop.
2. **`src/lab/sdf-zombie/webgpu/zombie-gpu.ts`** — both
   `u.counts2.value.set(...)` calls now preserve `.w` the way `.z` is
   preserved, so the gate survives every upload.
3. **`src/lab/sdf-zombie/webgpu/game-main.ts`** — `setWoundList(on)` /
   `get woundList()` beside `setOwnerRefold`. Seam mirrors the owner re-fold
   gate.
4. **`scripts/sdf-game-bench.mjs`** — leg `'wound-list-on'`; ship-defaults
   reset pins `setWoundList(false)`.

New test `march-wound-list.test.ts` pins: (a) the list branch exists in
`APPLY_WOUNDS`; (b) the union-reach early return stays BEFORE the loop; (c)
the gate is set from `counts2.w` and the reach formula appears in BOTH
`APPLY_WOUNDS` and `MARCH_BODY` (text-pinned so they cannot drift); (d) no
parens/colons in any `MARCH_BODY` parameter-list comment.

Two pre-existing `MARCH_BODY` parameter-list comments (`meltCfg` and
`levelShadow`) violated the file's own "NO PARENS" contract (both contained a
paren). Fixed — comment-only, no functional change. `march.wgsl.test.ts`'s two
hard-coded-`i` loop-bound checks were made variable-agnostic (the loop renaming
`i`→`k` broke them).

## Parity — the frame must not change

`parity.mjs` + `diff.py` (same folder). Boot `sdf-game.html`, carve wounds
deterministically with `__sdfGame.bench({ room:3, mode:'throughput', warmup:20,
walkFrames:10, fireFrames:90, gibFrames:10, chunkFrames:10 })` (census wounds
`[0,16,16]`, max 16 ≥ 8 ✓), then STATIC-IFY + freeze: `setBleed(false)`
(clears droplets+splats), goo `passGate` all off, `freeze(true)`,
`setLoopRunning(false)`, and pin `performance.now` (kills the fire-flicker,
which otherwise makes same-state captures differ on ~19% of pixels — measured
originally by closeup-woundcull-capture.mjs).

Capture `off-a`, `off-b` (both OFF), `on`, `off-c` (OFF), each after
`step(3, 1/60)`. PIL diff, channel delta > 8, HUD strip (top 44 px) and the
FPV weapon region (310,532,801,799) excluded. The weapon is not an SDF-wounded
body and still sways subtly even frozen.

| pair | changed px | % of frame | maxΔ |
| --- | ---: | ---: | ---: |
| off-a vs off-b (same-state NOISE FLOOR) | 31 426 | 3.2476% | 238 |
| off-a vs on     (SIGNAL, wound list) | 32 502 | 3.3588% | 252 |
| off-a vs off-c  (recheck, back to OFF) | 32 530 | 3.3616% | 253 |
| **on-minus-floor** (ON-only, beyond the floor) | **1 078** | **0.1114%** | — |

**Gate numeric: PASS.** signal/floor = **1.03** (limit ≤ 1.5). **Shape
verdict: CLEAN.** `mask-on-minus-floor.png` is essentially black — 1 078
scattered single pixels plus a faint right-edge line, zero crater-shaped
blobs, zero filled regions, zero silhouette edges. The wound-list toggle
contributes nothing beyond the ambient scene animation.

**Reading the residual floor (3.25%):** it is NOT the wound list. The same
glowing dome (the central wounded zombie's light pool) and right-edge light
line appear IDENTICALLY in the same-state OFF/OFF floor and in the OFF/ON
signal; it is a pre-existing glow/light animation that persists under
`freeze(true)`. It is identical between OFF/OFF and OFF/ON captures, so it
cannot be a dropped wound. **The gate is a value no-op: ON renders the same
frame OFF does (within the same ambient noise as OFF vs OFF).**

## Bench — `sdf:march` exclusive ms (BENCH_PASSES=1)

Two runs on the shared machine, both **noise-limited** (`baseline` repeat
spread 54–100% both times; the machine had a 100%-CPU `deferred-game-check`
plus the owner's Codex/Chrome/WindowServer at 20–40% throughout). Per the
plan's own rule — **a delta smaller than either leg's spread is UNRESOLVED** —
none of the numbers below is a win or a loss.

Run 1 (`bench/`), median overall `sdf:march`: baseline room3 12.78 / room4
12.30; wound-list-on room3 14.96 / room4 14.93. Per-rep room4:

| leg | walk | fire | gib |
| --- | ---: | ---: | ---: |
| baseline | 7.23 / 7.51 / 9.02 | 11.88 / 21.37 / 11.42 | 20.67 / 41.54 / 18.00 |
| wound-list-on | 7.06 / 12.35 / 9.61 | 14.73 / 21.11 / 13.72 | 25.40 / 33.49 / 28.51 |

Run 2 (`bench/`), per-rep overall `sdf:march`:

| leg | room | walk | fire | gib |
| --- | ---: | --- | --- | --- |
| baseline | 3 | 7.41 / 12.77 / 10.67 | 13.97 / 24.26 / 20.64 | 9.52 / 28.88 / 24.41 |
| baseline | 4 | 9.15 / 12.98 / 9.97 | 18.13 / 27.21 / 13.04 | 22.09 / 33.49 / 15.79 |
| wound-list-on | 3 | 11.63 / 11.20 / 11.43 | 25.33 / 24.97 / 24.43 | 31.74 / 32.51 / 29.42 |
| wound-list-on | 4 | 12.72 / 10.86 / 11.82 | 33.32 / 28.86 / 27.13 | 40.21 / 37.00 / 39.93 |

**Reading (honestly):** the `wound-list-on` leg is far more repeatable (8–15%
spread) than `baseline` (54–100%) across both runs, and its `sdf:march` point
estimate is consistently AT or ABOVE baseline — the per-pixel entry preload
(16 wound-row loads + reach test for every marching pixel, with no
`woundBound` early-out at the entry level) appears to at least offset the
per-step fold savings. That is consistent with the plan's prediction: the
wound loop's per-step texel loads are NOT the near-wound cost, so removing
most of them buys nothing. The remaining near-wound suspect is the state the
gate opens — the inside-flesh rows (organs/bones) and the smaller near-wound
steps — exactly as run 5/6 of the pass-attribution study concluded.

## Verdict: PARK

The per-ray wound list is implemented CORRECTLY — parity-proven a value no-op:
ON renders the same frame OFF does, with no dropped-wound crater and a
signal/floor ratio of 1.03. But it delivers NO measurable performance win on
this machine. The point estimate is flat-to-slightly-negative (the entry
preload costs about what the per-step fold savings recovers), and even that is
within the run-to-run noise of a busy shared machine. This matches the plan's
stated prediction (~0). **Park it** — leave the seam in place, keep
`counts2.w` OFF (the shipped shader is unchanged and bit-identical with the
gate off), and do not ship it ON. The wound loop's per-step loads are NOT the
near-wound cost; the remaining suspect is the inside-flesh rows the
`nearWound` gate opens (bone tubes, run 7 of the pass-attribution study) and
the smaller near-wound steps, not the number of wound rows a pixel folds.

## Files

- `src/lab/sdf-zombie/webgpu/march.wgsl.ts` (preload + list fold + private vars)
- `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` (counts2.w preserved across uploads)
- `src/lab/sdf-zombie/webgpu/game-main.ts` (`setWoundList` seam)
- `scripts/sdf-game-bench.mjs` (`wound-list-on` leg + ship-default reset)
- `src/lab/sdf-zombie/webgpu/march-wound-list.test.ts` (new, pins the feature)
- `docs/dev-notes/2026-09-07-per-ray-wound-list/` (this note + `parity.mjs`,
  `diff.py`, `parity.json`, `off-a/off-b/on/off-c.png`, `mask-*.png`,
  `bench/`)
