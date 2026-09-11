# P3c in-game — trained-model loading, self-check, A/B key (GPU smoke)

- **Date:** 2026-09-11
- **Checkout SHA:** `e6faf277dcb5697b584ef1d73c143fc8ae07b9a1` (Task 5, "G3 parity against PyTorch fixtures" — the parent of the Task 6 commit)
- **Harness:** `pi` (macOS, Chrome 140 headless, Metal/WebGPU)
- **Plan:** `docs/superpowers/plans/2026-09-11-neural-upscale-p3c-ingame.md`, Task 6
- **Verdict: FAIL** — one gate: `sp` GPU-vs-CPU rgb `2.07e-3` > `2e-3`. Everything else in the smoke passed.
  No threshold was weakened (contracts §0 rule 2).

## Command (exactly the plan's Step 3)

```bash
npx tsx scripts/upscale-make-test-model.ts        # .upscale-models/test-s8-rgbd/model.json (seed 3), weightHash 89367253
LAB_TMP=.lab-tmp UPSCALE_SMOKE_MODEL=test-s8-rgbd LAB_VITE_PORT=5323 LAB_CDP_PORT=9323 \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-trained-smoke.mjs' \
  2>&1 | tee /tmp/p3c-task6.log
```

`LAB_TMP=.lab-tmp` is the dispatch-sandbox override from `scripts/lab-servers.sh`; `.upscale-models/` and
`.lab-tmp/` are gitignored, so the test model and the Chrome profile never enter `git status`.

## Result — default test model (`test-s8-rgbd`, seeded random weights, seed 3)

```
self-check: [{"layout":"sp","pixels":480000,"covered":19335,"maxRelRgb":0.0020729363882828486,"coverageMismatch":0,"coverageMismatchFar":0,"depthMismatch":0},
             {"layout":"dc","pixels":480000,"covered":19335,"maxRelRgb":0.0013007789251783023,"coverageMismatch":0,"coverageMismatchFar":0,"depthMismatch":0}]
            sp-vs-dc {"pixels":480000,"bothCovered":19335,"maxRelRgb":0.0008129086482694547,"coverageMismatch":0}
PROBLEM: sp: GPU vs CPU rgb 2.07e-3 > 2e-3
SMOKE: FAIL
```

Only that one problem was reported, so **every other check in the smoke passed**:

- **Boot** `?upscale=trained&upscalemodel=test-s8-rgbd`: stage on, `source === 'trained'`,
  `model === 's8'`, `inputs === 'rgbd'`, `weightHash === 89367253` (matches `model.json`),
  `inSize 400x300` / `outSize 800x600`, label names the model, `upscaleModels()` lists it with
  the same hash.
- **Async seam** `await __sdfGame.setUpscale({ trained: 'test-s8-rgbd' })`: same matching info.
- **Self-check** ran on the trained `weightHash` with `marchStable: true`, zero coverage mismatches
  and zero depth mismatches in both layouts; `sp` vs `dc` within `8.13e-4`.
- **A/B key** (values required by the passing assertions): U #1 → `mode 'native'`, `on false`,
  `sdfScale 1`, label `upscale [U]: native (march 1.0, no upscale) · sp`;
  U #2 → `mode 'nearest'`, `model 'zero'`, `sdfScale 0.5`, label `nearest 2x (zero model)`;
  U #3 → `mode 'model'`, trained weights again, `sdfScale 0.5`, label names the model.
- **Missing model** `setUpscale({ trained: 'no-such-model' })` rejects; booting
  `?upscale=trained&upscalemodel=no-such-model` leaves the stage off and logs a `not loaded`
  console error; zero shader/TSL/WGSL/pipeline console errors.

## Diagnosis — seed-dependent `sp` tail, not a shader or plumbing defect

The `sp` layout stores the last layer pre-shuffle in RGBA16F; `dc` computes it in-shader. The CPU
twin emulates storage rounding with `f16round` in `upscale-reference.ts`. The reported metric is a
**single worst pixel** over 19,335 covered × 3 channels, so its max is a tail statistic of
rounding differences between `f16round`'s round-half-away-from-zero and hardware
round-to-nearest-even. Random weights move where that worst sample lands; trained weights do not.

Controlled check on the same code path, same harness, same boot, only the seed changed
(generated into the gitignored store with an inline `tsx -e`, using `createUpscaleModel('s8','rgbd',1)`):

```
seed 1: sp covered 19340  maxRelRgb 0.0017084844229057876   dc 0.0012266360863805981   sp-vs-dc 0.0008277553864373568   → SMOKE: PASS
seed 3: sp covered 19335  maxRelRgb 0.0020729363882828486   dc 0.0013007789251783023   sp-vs-dc 0.0008129086482694547   → SMOKE: FAIL
```

The seed-1 numbers reproduce the pre-existing G1-parity reference for `s8 / rgbd` in
`docs/dev-notes/2026-09-11-neural-upscale/g1-parity.md` almost exactly — `sp 1.71e-3`, `dc 1.23e-3`,
`covered 19340`. That is the same value the plan's own verification saw on a real pre-flight export
(`1.28e-3` on `s8-rgb`, 600 steps). So the loader, the trained-weights path, the self-check and the
A/B seams are working; the default test-model **seed 3** simply pushes one pixel of the `sp` tail
3.6 % over the gate.

The number is reproducible to the last digit across runs (`2.0729363882828486e-3` in two separate
server sessions), so this is deterministic weights, not flake.

## What this means for the gate

- Do **not** raise the `2e-3` gate and do **not** re-roll the test-model seed to dodge the metric —
  both would be weakening the check.
- The gate is calibrated for trained exports. P3d's real-export smoke is the meaningful G1-parity
  check for the trained path; this task's seeded model is a plumbing fixture, and seed 3 happens to
  sit just outside the gate on Metal.
- If the seeded smoke is meant to be a green gate on its own, the deterministic fix is to make the
  CPU twin's `f16round` round-to-nearest-even (matching hardware) rather than to touch the
  threshold. That is in `upscale-reference.ts`, which is not this task's file.

## Surprises / notes

- The plan's Step 3 "Expected: SMOKE: PASS" was verified while writing the plan against a **real
  export**; the seeded `test-s8-rgbd` model (Task 5's generator, seed 3) was not reported as
  verified. Its `sp` number lands just over.
- `covered` differs by 5 px between the two seeds (19,335 vs 19,340) only because the staged frozen
  frame is re-derived after the stage lifecycle; both are far above the 1,000-px sanity floor and
  both have zero coverage mismatches.
- vite had to be started fresh (port 5323 was down); the plan's 404-stale-config note did not apply.

## Update 2026-09-11 — both follow-ups done; the smoke passes, and the rounding fix was inert

Owner asked for both fixes from the diagnosis above.

**1. `f16round` now rounds half to even** (`upscale-reference.ts`), matching IEEE 754
round-to-nearest-even and the hardware; `Math.round` had been rounding ties away from zero. Tie
cases are pinned in `upscale-reference.test.ts` (including subnormals and a non-tie control).

**2. The smoke fixture is seeded 1, not 3** (`upscale-make-test-model.ts`) — the same seed the
G1-parity reference fixtures use. New `weightHash e9f4faf6`.

**Re-run on the GPU (this machine, Metal, Chrome headless):**

```
scripts/upscale-parity.mjs                      → G1-PARITY: PASS (7 configs x 2 layouts,
                                                   sp 1.56e-3 .. 1.91e-3, dc 1.10e-3 .. 1.44e-3,
                                                   0 coverage / 0 depth mismatches, 0 console errors)
scripts/upscale-trained-smoke.mjs (seed 1)      → SMOKE: PASS
                                                   sp 1.7084844229057876e-3, dc 1.2266360863805981e-3,
                                                   sp-vs-dc 8.277553864373568e-4, covered 19340
```

**The tie theory was wrong, and the numbers say so.** The seed-1 smoke reproduces the pre-change
control to every digit (`1.7084844229057876e-3`, `1.2266360863805981e-3`, `8.277553864373568e-4`),
so round-to-nearest-even moved nothing: this workload hits **no exact ties** — a tie needs
`value / ulp` to land on exactly .5, which float arithmetic here effectively never produces. The
residual GPU-vs-twin gap is accumulation, not tie direction: the shader sums each 3x3 convolution in
fp32 (with FMA contraction), the twin sums in float64 and rounds once per stored feature map.

So the change is a correctness fix to the emulator, not a fix to this metric. What made the smoke
green is the seed, and the honest reading of the gate is unchanged: **2e-3 is calibrated for the
worst pixel of the G1 reference fixtures**, seed 3 sat 3.6 % outside it, and a real trained export
sits well inside (1.28e-3 measured on the pre-flight s8-rgb export).

