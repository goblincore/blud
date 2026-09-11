# G1-parity — GPU vs CPU twin, both upscale layouts

- **Date:** 2026-09-11
- **Base checkout SHA:** `3ed4a89b0dee90ad9ebc6dfd0dbee768c5d559c1` (Task 4, "compile smoke"; the G1-parity commit is the child of this).
- **Gate:** spec `docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md`, Gates → **G1-parity**.
- **Verdict: PASS.**

## Command

```bash
LAB_VITE_PORT=5311 LAB_CDP_PORT=9311 bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-parity.mjs' 2>&1 | tee /tmp/upscale-parity.log
```

One boot, one staged frozen frame (room 1, body 1, 2.5 m). The simulation is frozen and
render-locked (`freeze(true)` + `setRenderLock(true)`) before any read, so re-rendering does
not move the scene. For each model × input set the driver enables the stage with random
weights (seed 1) and calls `__sdfGame.upscaleSelfCheck({ compareLayouts: true })`, which
compares **both** layouts against the CPU twin (float16 storage emulated) and against each
other, **in-page** — only statistics cross CDP.

## Results (verbatim from the log)

```
model inputs | layout  covered   maxRelRgb  covMis  covMisFar  depthMis | sp-vs-dc maxRelRgb covMis | ms
zero  rgb    | sp        20884    0.00e+0       0          0         0 |           0.00e+0      0 | 0
zero  rgb    | dc        20884    0.00e+0       0          0         0 |           0.00e+0      0 | 0
s8    rgb    | sp        19327    1.76e-3       0          0         0 |           7.68e-4      0 | 0
s8    rgb    | dc        19327    1.29e-3       0          0         0 |           7.68e-4      0 | 0
s8    rgbd   | sp        19340    1.71e-3       0          0         0 |           8.28e-4      0 | 0
s8    rgbd   | dc        19340    1.23e-3       0          0         0 |           8.28e-4      0 | 0
s16   rgb    | sp        19328    1.89e-3       0          0         0 |           6.79e-4      0 | 0
s16   rgb    | dc        19328    1.31e-3       0          0         0 |           6.79e-4      0 | 0
s16   rgbd   | sp        19354    1.91e-3       0          0         0 |           7.61e-4      0 | 0
s16   rgbd   | dc        19354    1.44e-3       0          0         0 |           7.61e-4      0 | 0
s32   rgb    | sp        19314    1.83e-3       0          0         0 |           8.71e-4      0 | 0
s32   rgb    | dc        19314    1.10e-3       0          0         0 |           8.71e-4      0 | 0
s32   rgbd   | sp        19274    1.56e-3       0          0         0 |           5.60e-4      0 | 0
s32   rgbd   | dc        19274    1.35e-3       0          0         0 |           5.60e-4      0 | 0

console errors/shader warnings: 0

G1-PARITY: PASS  (json: /tmp/upscale-parity/parity.json)
```

- **Zero model** (identity/nearest): GPU == CPU exactly (`0.00e+0`) in both layouts, and
  `sp` vs `dc` exactly equal — the nearest-reconstruction path is bit-exact.
- **Random models** s8/s16/s32, rgb and rgbd: worst GPU-vs-CPU relative rgb error
  **1.91e-3** against the 2e-3 gate; zero coverage mismatches (so none outside the
  threshold band), zero depth mismatches, in both layouts.
- **sp vs dc** agreement ≤ **8.71e-4** with zero coverage mismatches (< 0.5% allowed).
- March size 400×300 (the 2× upscale input) for every config; `marchStable` true.
- The ms column reads 0 because the driver pins `performance.now` to a constant; it is
  not a timing measurement (that is Task 6's G1-cost).

## Bugs found and fixed

Both were confounds in the **staging/self-check**, not in the generated shaders or the
stage's math — the raw parity numbers were already inside the gate on the first run.

- **Gather afterglow made the march drift every frame → `marchStable: false`.**
  Symptom: `marchStable` failed for every config; the march (and the gather's `probeDyn`
  layer) changed between consecutive render-locked frames while the bone-instance layer
  stayed bit-identical. Cause: the probe gather ships an afterglow (`blend 0.6`,
  `fall 0.12`) whose state depends on how many frames the run has dispatched, so the
  march converges asymptotically and never becomes bit-stable. Fix: pin the gather to the
  R1 dispatch check's pure per-frame estimate — `setProbeBlend(1); setProbeFall(1)` — in
  the driver staging, so the march is a function of the frozen scene alone. The march then
  reads bit-identical across frames.
- **The stage's first re-creation perturbs the march once → the two layouts were read on
  different marches.** Symptom: after the gather was pinned, the march was still
  bit-stable within a layout but changed when the self-check re-created the stage to
  switch `sp`→`dc` (~1.2% of floats differ, a localized blob, `maxAbs≈0.93`). The first
  layout was therefore measured one stage-generation earlier than the second. Fix: a
  settle warm-up at the top of `runUpscaleSelfCheck` (render, re-create the stage once,
  render again) before any measurement, so both layouts read the same steady march. With
  it, the zero model's `sp`-vs-`dc` delta is exactly 0.

Neither affects the parity verdict: each layout's GPU output is compared against a CPU
twin built from that same layout's own march read (march and output are read after the
same render, with no render in between), so a march that differs *between* the two reads
cannot mask a GPU-vs-CPU disagreement.

## Console

`console errors/shader warnings: 0` — no `TSL`/`WGSL`/`Tint`/`pipeline`/`not found in Fn`
messages and no page errors during the whole run.

## Left broken / not covered

- The stage-recreation march perturbation is **not fixed at the source** — it is worked
  around by settling in the self-check. If a future task re-creates the stage mid-render
  (e.g. a live layout switch) the same localized march change will occur. Root cause was
  not chased further because it does not affect parity and Task 5's scope is the parity
  gate; flagged here for the review.
- `upscaleSelfCheck` compares a single frozen frame at one pose. It does not exercise
  moving cameras, the temporal-accum branch, or layouts other than `sp`/`dc`.
