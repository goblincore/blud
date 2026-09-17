# G2 — paired capture for training (determinism / alignment / orientation)

- **Date:** 2026-09-11
- **Gate:** spec `docs/superpowers/specs/2026-09-11-neural-upscale-espcn-design.md`, Gates → **G2 — pairs**.
- **Verdict: PASS — 60 pairs**, from re-run `r4` in the owner session (checkout `6db708e0`). The
  alignment gate was re-scoped to linear-depth registration (see the Update section). The Python
  loader verified the dataset.
- **History:** the first run (task 7, checkout `f26c3090`) FAILED on the coverage-centroid
  sub-check and wrote no dataset. Its record is kept below, marked as the first run.

## Update 2026-09-11 (owner session) — alignment re-diagnosed; the gate now registers depth

**Everything below about alignment is superseded by this section.** What changed:

- **"Diagnosis" item 1 below is tautological.** The "shared flesh region is exactly aligned"
  evidence computes both centroids over the same set of input texels, so they are equal by
  construction. That check can never fail and proves nothing. It follows that "Options"
  item 1 (gating on the intersection-mask centroid) would be a gate that cannot fail. It was
  not used.
- **A content-based registration test settles it.** The helper is
  `scripts/lib/upscale-registration.mjs`; the offline tool is `scripts/upscale-g2-diag.py`,
  run on frames dumped with `UPSCALE_DUMP_CHECK=1`. Each input texel is compared with the mean
  of the 2×2 output block it should sample, at output shifts −2..+2, using interior flesh only.
  A 2-D quadratic gives the sub-pixel vertex. Results on the same staged frame (room 1, 2.5 m,
  pitch +0.2):

  | Measure | Best shift (ox, oy) | Sub-pixel vertex (output px) | Notes |
  |---|---|---|---|
  | **Linear depth** | **(0, 0)** | **(0.0002, 0.003)** | MSE 1.1e-6 at 0; 1.2e-5 at ±1 x; 4.7e-6 at ±1 y — clean and symmetric |
  | Colour (lit rgb) | (0, +1) | (0.78, 1.01) | **false** — see below |
  | Mask IoU vs shift | (0, 0) | — | 0.9714 at 0, symmetric falloff |
  | Silhouette extents | top +1, bottom +1, left −1, right +1 | — | half-res edge quantisation, not a consistent shift |

- **Why colour cannot register.** Lit colour has HDR highlights up to ~28 and sub-texel
  detail. The variance *inside* a 2×2 output block (8.9e-2) is larger than the colour MSE at
  the best shift (3.6e-2). The jagged colour error surface (odd x-shifts worse in most rows)
  is that detail aliasing, not geometry.
- **Conclusion:** the 400×300 and 800×600 marches are geometrically aligned. The original
  centroid failure was silhouette aliasing — the conclusion below was right, its proof was not.
- **Gate change (spec amended):** alignment is now linear-depth registration: best shift
  (0, 0), |vertex| ≤ 0.25 output px on both axes, and ≥ 500 interior texels. Coverage IoU
  ≥ 0.85 is kept. Colour registration and the coverage centroid are reported but ungated.
  Commits: `c1688bd5` (registration helper) and "fix(upscale): G2 registers LINEAR DEPTH".

## Result of the passing run (r4, owner session)

```bash
LAB_VITE_PORT=5313 LAB_CDP_PORT=9313 UPSCALE_OUT=/tmp/blud-upscale-data/smoke-2026-09-11-r4 UPSCALE_DUMP_CHECK=1 \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-pairs-capture.mjs'
uv run --with numpy python3 scripts/upscale-pairs-load.py /tmp/blud-upscale-data/smoke-2026-09-11-r4
```

Run on checkout `6db708e0` with the default sequences (`1:2.5:0,3:3.0:1.2,4:2.0:-0.8`), 20 frames
each, 6 simulation frames between captures.

| Sub-check | Threshold | Measured | Result |
|---|---|---|---|
| Determinism (same scale ×2; 0.5→1.0→0.5) | ≤ 1e-6 | 0, 0, 0 (temporal start on, as shipped) | PASS |
| Alignment — linear-depth registration | best (0, 0); vertex ≤ 0.25 px; ≥ 500 texels | (0, 0); (0.0002, 0.003) px; 4210 texels | PASS |
| Alignment — coverage IoU | ≥ 0.85 | 0.987 | PASS |
| Orientation (pitched up, row 0 = top) | centroid row > H/2 | 185.6 / 300 and 369.9 / 600 | PASS |
| Depth sanity | < 0.05 m | 0.0022 m | PASS |
| *Reported, ungated:* colour registration | — | (0, +1); vertex (0.78, 1.01) — false, see Update | — |
| *Reported, ungated:* coverage centroid offset | — | dx −0.0004, dy 1.16 px | — |

**G2: PASS — 60 pairs.** Loader output: `OK 60 pairs, input 400x300, target 800x600, near 0.1, far 200`.

- **Dataset:** `/tmp/blud-upscale-data/smoke-2026-09-11-r4/`, 559 MB.
  - Contents: 60 × (`frameNNN-in.npy` 300×400×4 + `frameNNN-target.npy` 600×800×4), plus the
    scored check frames (`check-in.npy`, `check-target.npy`).
  - **It lives in /tmp, so it is lost on reboot.** The command above regenerates it, and the
    manifest records the checkout. `manifest.json` is copied to `smoke-manifest.json` beside
    this note.
- **Per sequence** (input flesh coverage; frame-to-frame silhouette IoU of the input):

  | Seq | Staging | Coverage min / mean / max | Frame-to-frame IoU min / median | Near-static steps (IoU ≥ 0.98) |
  |---|---|---|---|---|
  | 0 | room 1, 2.5 m, orbit 0 | 3.4% / 3.6% / 4.0% | 0.693 / 0.992 | **13 / 19** |
  | 1 | room 3, 3.0 m, orbit 1.2 | 3.5% / 3.9% / 4.7% | 0.691 / 0.761 | 0 / 19 |
  | 2 | room 4, 2.0 m, orbit −0.8 | 11.3% / 16.8% / 23.7% | 0.401 / 0.773 | 0 / 19 |

- **Diversity caveat for P3.** Sequence 0's body stops moving after about frame 8, so 13 of its
  19 steps are near-duplicate poses. Its colour still changes between some of those frames
  (mean |Δrgb| up to 0.26), most likely the per-frame probe lighting, which the capture pins to
  its unblended estimate (`setProbeBlend(1)`). Each pair is internally consistent (same frozen
  state at both scales), so this is a diversity issue, not a correctness one. A P3 capture
  should re-stage, or advance further, when consecutive silhouettes stay above ~0.98 IoU.
- **Flesh is a small fraction of each frame** (3.4–24%). Training should sample crops around
  flesh, or weight the loss toward it, rather than use whole frames that are mostly sentinel.

## G1-parity carried in (the task asked for the verdict line)

> G1-PARITY: PASS (worst GPU-vs-CPU relative rgb error **1.91e-3** against the 2e-3 gate;
> zero coverage mismatches, zero depth mismatches, in both layouts; the zero model bit-exact).

## Command (first run)

```bash
LAB_VITE_PORT=5313 LAB_CDP_PORT=9313 UPSCALE_OUT=/tmp/blud-upscale-data/smoke-2026-09-11 \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-pairs-capture.mjs' \
  2>&1 | tee /tmp/upscale-g2.log
```

Run with the plan's default `UPSCALE_SEQS='1:2.5:0,3:3.0:1.2,4:2.0:-0.8'`, `UPSCALE_FRAMES=20`,
`UPSCALE_ADVANCE=6`, `UPSCALE_PITCH_UP=0.2`. The G2 checks abort before any frame is captured,
so the sequences/frame counts never run.

## Results of the first run (verbatim from the log)

```
G2 checks: {
  "nearFar": { "near": 0.1, "far": 200 },
  "determinism": { "sameScaleInput": 0, "sameScaleTarget": 0, "scaleRoundTrip": 0 },
  "temporalStart": "on (shipped)",
  "alignment": {
    "inputCoverage": 0.041675,
    "targetCoverage": 0.04066458333333333,
    "centroidDxOutputPx": -0.00042056755921748845,
    "centroidDyOutputPx": 1.16243551330723,
    "iou": 0.9874376869391824
  },
  "orientation": {
    "inputCentroidRow": 185.55558888222356, "inputHeight": 300,
    "targetCentroidRow": 369.9487422511399, "targetHeight": 600,
    "rowZero": "top"
  },
  "depthMeanAbsDiffMetres": 0.002187324418808602
}
FAIL: G2: centroid offset > 0.5 output px
```

Sub-check tallies:

| Sub-check | Threshold | Measured | Result |
|---|---|---|---|
| Determinism (same scale ×2, and 0.5→1.0→0.5) | ≤ 1e-6 | **0, 0, 0** | PASS |
| Alignment — centroid (input ×2 vs target, output px) | ≤ 0.5 | **1.162** (dx −0.000, dy 1.162) | **FAIL** |
| Alignment — coverage IoU (target 2×2 majority) | ≥ 0.85 | **0.987** | PASS |
| Orientation (pitched up, row 0 = top) | centroid row > H/2 | **185.6/300 and 369.9/600**, `rowZero: "top"` | PASS |
| Depth sanity (mean \|Δlinear depth\| over shared flesh) | < 0.05 m | **0.00219 m** | PASS |

**Temporal-start state:** `on (shipped)` — the `setTemporalStart(false)` fallback was not
needed once determinism was fixed (below); the shipped path is what the checks measured.

**Orientation convention confirmed:** the plan's probe applies `+0.2` rad and the centroid
sits below centre (row > H/2). Re-staging room 1 / 2.5 m at `-0.2` rad moves the centroid
above centre (`rowZero` becomes `UNCONF`, i.e. centroid row ≤ H/2). So **a larger pitch value
looks UP** and the recommended `UPSCALE_PITCH_UP=-0.2` sign test behaves as documented. The
saved-orientation convention (`row 0 = texel row 0 = top`) is confirmed; no data was flipped.

## Staging bug found and fixed (not a threshold change)

The plan's capture script, run as written, **failed determinism** in this environment:
`sameScaleInput 4.20e-4`, `sameScaleTarget 2.21e-4`, `scaleRoundTrip 9.33e-4`, and the
`setTemporalStart(false)` fallback still failed (`5.39e-5 / 2.73e-5 / 1.63e-4`, all > 1e-6).

This is the confound already diagnosed and fixed in `g1-parity.md` ("Bugs found and fixed"):
the probe gather ships an afterglow (`blend 0.6`, `fall 0.12`) whose state depends on how
many frames have been dispatched, so the march converges asymptotically and consecutive
render-locked reads are never bit-stable. `scripts/upscale-parity.mjs` pins it with
`setProbeBlend(1); setProbeFall(1)`; the plan's capture script omitted those two lines.
Adding them (matching the parity driver, with a comment) makes determinism **exactly 0**.
This is a staging fix, not a gate relaxation: the coverage mask and every threshold are
unchanged.

## Diagnosis of the alignment failure

The mismatch is **edge aliasing between the coarse and native marches, not a readback or
projection bias**. Evidence, from throwaway probes (`.scratch/`, gitignored, not committed):

1. **The shared flesh region is exactly aligned.** Restricting both masks to the 4952 input
   pixels where the low-res and majority-downsampled-target masks agree, the centroids are
   identical to three decimals: input ×2 = **(400.000, 370.746)** and target = **(400.000,
   370.746)**. `centroidDxOutputPx` is −0.0004. Any half-texel, flip or projection offset
   would show up here; none does.
2. **The failure is the disagreeing edge pixels.** Input-only = 49 px (mean row 204, biased
   below the 185.6 centroid), target-only = 14 px (mean row 122, biased above). Those 63 px
   out of ~5000 (1.3%) are enough to separate the two centroids by 1.16 px. They sit on the
   silhouette (head/shoulders and feet), where a coarse ray and a native ray legitimately
   disagree.
3. **The magnitude is framing-dependent, as aliasing predicts.** Sweep over the plan's
   sequences × pitch (centroid |Δ| output px / IoU):

   | staging | pitch 0.2 | pitch 0 | pitch −0.2 |
   |---|---|---|---|
   | room 1, 2.5 m | **1.162** / 0.987 | 0.596 / 0.993 | 0.961 / 0.991 |
   | room 3, 3.0 m | 0.351 / 0.973 | 0.348 / 0.972 | 0.277 / 0.973 |
   | room 4, 2.0 m | 1.084 / 0.981 | 2.138 / 0.978 | 1.255 / 0.977 |
   | room 1, 1.6 m | 1.088 / 0.995 | — | — |
   | room 1, 4.0 m | 3.224 / 0.954 | — | — |

   Error grows with distance/edge count (1.6 m → 4.0 m: 1.09 → 3.22 px) while IoU stays
   0.95–0.995. The plan's first sequence (room 1 at 2.5 m) is intrinsically ~0.6 px even at
   level pitch and ~1.16 px at the orientation-probe pitch.
4. **This is documented engine behaviour.** `sdf-layer.ts` (`TEMPORAL_ACCUM_WGSL` note)
   records that at `sdfScale 0.5` a sub-pixel jitter "flips WHICH low-res texel the output
   pixel reads — a two-pixel jump at sdfScale 0.5 … quantised displacement". A 1–2 px
   silhouette difference between a 400×300 and an 800×600 ray march is the expected form of
   that quantisation; the gate's 0.5 px centroid tolerance does not accommodate it.

Note also a comment/code discrepancy inherited from the plan's script: its comment says the
pitch is "only for the orientation check", but the code stages once at `PITCH_UP` and measures
alignment on that same frame. The sweep above measures the level framing as well (0.596 px for
room 1), so moving the alignment check to a level frame would **not** make the gate pass — the
literal pitched number is reported as the gate result, and the level number is recorded here
for the owner. The threshold itself was not changed.

## Python loader check (`scripts/upscale-pairs-load.py`)

There is no real dataset to load (capture is gated off), so the loader and the encoder were
verified against a synthetic 2-frame pair set written by the real `encodeNpy`:

```
$ node .scratch/synth-dataset.mjs
wrote 2 synthetic pairs to /tmp/blud-upscale-data/synthetic
$ uv run --with numpy python3 scripts/upscale-pairs-load.py /tmp/blud-upscale-data/synthetic
OK 2 pairs, input 400x300, target 800x600, near 0.1, far 200
```

Value fidelity through numpy was checked directly: numpy loads `float32`, shapes `(300,400,4)`
and `(600,800,4)`, the sentinel `1/3` round-trips bit-exactly (`a[0,0,2] == np.float32(1/3)` →
`True`), and the header is `.npy` v1.0 little-endian. So the `.npy` writer/reader pair and the
Python loader are sound; only the GPU gate blocks the real dataset.

## Dataset (first run — superseded by the r4 result above)

- **Path:** `/tmp/blud-upscale-data/smoke-2026-09-11/` — contains only `manifest.json`
  (the failure record). **No `.npy` pairs were written and no size is reported.** The
  dispatcher deletes this task's worktree, so the run must be regenerated from the command
  above once G2 is resolved.
- `manifest.json` is copied verbatim to `smoke-manifest.json` beside this note (it records the
  exact checks that ran, `g2Failures: ["centroid offset > 0.5 output px"]`, `frames: []`).
- Coverage per sequence: **not available** (capture never ran). The comparison framings above
  had input coverage 0.018–0.117 of the 400×300 frame.

## Verdict of the first run (superseded — resolved by the Update above)

**G2: FAIL** on alignment-centroid. The capture pipeline, `.npy` encode/decode and checks are
implemented and the non-alignment sub-checks pass with strong margins. The failing metric is
dominated by coarse-march silhouette quantisation: the masks agree on 98.7% of flesh pixels
(IoU 0.987) and their shared region is pixel-exact, but a 0.5 px centroid tolerance cannot
absorb the 1–3 px edge disagreement between a 400×300 and an 800×600 march — and it gets worse
with distance. Nothing here was loosened.

Options for the owner (not applied):

1. Re-scope the alignment gate to a statistic that matches its intent — e.g. centroid of the
   shared/intersection mask (exact here) or an IoU/edge-band tolerance — and keep the 0.5 px
   figure for a synthetic or full-coverage fixture.
2. Keep the gate and pick a staging framing that passes (room 3 at these distances measures
   0.28–0.35 px). This is staging-shopping and was deliberately **not** done.
3. Accept a known-miscalibrated sub-check and capture the dataset with the G2 failure recorded
   in the manifest, so P3 is not blocked. This deviates from the plan's STOP-on-gate-failure
   rule and was **not** done.

Left as-is on this branch: the capture script still hard-fails G2 and writes no dataset.

## Left broken / not covered (first run — the r4 result above replaces the first two bullets)

- No smoke dataset, so "3 sequences × 20 frames round-trip through a Python `.npy` loader"
  (spec G2, last bullet) is unverified against real GPU data; only the synthetic loader check
  above is.
- The gate result is from a single pose (room 1, 2.5 m, pitch 0.2). The deadline/sequence
  framing differences in the sweep are not a passing claim for other poses.
- Machine load: the host had Chrome helpers at ~18–29% CPU during the run (Task 6 deferred for
  exactly this reason). Correctness checks are load-independent, but this was not a timing run.
