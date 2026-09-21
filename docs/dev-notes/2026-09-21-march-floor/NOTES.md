# The one-body march floor, the GPU clock, and the shell (2026-09-21)

Method (the only one that gave repeatable numbers): ONE page, crowd program
`ready`, wander frozen, `setFrameCap(0)`, recorder on, each leg tagged by a
1e-3 pitch offset so frames group exactly, first 45 frames of a leg dropped,
and every pass time **normalised to a constant clock** by dividing by the
frame's constant-work post chain (`post:fxaa + post:vhs + post:vhs-input +
post:blit + sdf:composite`) and multiplying by the run's median of it.
"ms" below are those normalised ms.

## 1. Raw GPU ms hides the load, because the clock follows it

Even uncapped the GPU clock tracks load: the reference chain read 0.62-1.67 ms
for identical work in one run, FASTER when the frame is heavy. Raw
`sdf:march + sdf:shell-hull` for one body went 10.4 -> 7.9 ms from a
screen-filling body to a 3%-of-screen one; normalised it goes **15.7 -> 4.7**.
"The march does not scale with covered pixels" was an artefact of the governor.

| one body at | sphere frac | march | shell | m+s |
| --- | --- | --- | --- | --- |
| 1.0 m | 1.00 | 13.96 | 1.77 | 15.73 |
| 1.3 m | 0.74 | 12.49 | 1.83 | 14.32 |
| 1.7 m | 0.45 | 9.76 | 0.81 | 10.56 |
| 2.2 m | 0.28 | 4.26 | 1.80 | 6.07 |
| 3.0 m | 0.15 | 4.31 | 2.68 | 7.00 |
| 4.0 m | 0.09 | 3.67 | 2.30 | 5.98 |
| 5.5 m | 0.05 | 3.92 | 3.02 | 6.94 |
| 7.0 m | 0.03 | 2.48 | 2.17 | 4.65 |

(there-and-back reps agree within ~1 ms). So: a real **floor of ~5-7 ms once
any body is visible**, and a per-pixel cost that takes it to ~15 ms full screen.

## 2. What the floor is (far pose, 7 m, baseline 7.43 ms, n=9, spread 7.16-7.81)

| lever | march | shell | m+s |
| --- | --- | --- | --- |
| shell OFF | +0.33 | -3.67 | **-3.34 (-45%)** |
| `setSdfScale(0.25)` (quarter the march pixels) | **-1.59** | -0.02 | -1.60 (-22%) |
| march steps 96 -> 24 | -0.09 | +0.06 | 0 |
| spot shadow OFF | -0.23 | +0.02 | -3% |
| temporal start OFF | +0.16 | +0.17 | +4% |

- **`sdf:shell-hull` is a ~3.7 ms FIXED cost**, independent of `sdfScale` (its
  targets do not follow the march scale) and of how small the body is.
- ~40% of the far-body MARCH scales with TARGET pixels, not covered pixels
  (per-target work: clears / attachment stores / blits on 3x rgba32float).
- Step budget is dead as a lever (again). Spot shadow, temporal start: nothing.

## 3. The shell: fixed cost, pays back only in a crowd, and it changes pixels

| scene | shell net effect |
| --- | --- |
| 1 body, 1.3 m | costs +0.97 ms |
| 1 body, 2.2 m | costs +2.92 ms |
| 1 body, 3.0 m | costs +4.08 ms |
| 1 body, 7.0 m | costs +3.34 ms |
| 5 bodies, 4.5 m (coverage 0.49) | SAVES 0.77 ms |
| 4 bodies, 3.0 m | SAVES 0.58 ms |
| 4 bodies, 1.8 m | SAVES 0.59 ms |

Break-even is about 3-4 visible bodies. Shell on/off is NOT pixel-neutral: same
frozen frame, 24.7% of pixels differ slightly and 2371 differ by more than
24/765 (silhouettes), so removing it is a look decision as well as a perf one.

## What this means for "4-5 ms"

- The over-budget frames are close-up, multi-body: genuinely per-pixel march
  work. The floor is not what hurts there.
- An adaptive shell (on only at >= 3 visible bodies) would give ~3 ms back in
  1-2 body frames — which already have headroom. Low value on its own.
- Candidates that attack the hot frames: march-resolution scaling driven by
  coverage (`setAdaptive` exists), the 48 B/px MRT diet (the per-target share),
  and making the shell's cost scale (scissor / lower-res hull targets).

Instrument fixes that came out of this: recorder pass precision 0.1 -> 0.01 ms
(`gpu-frame-summary.ts`); the 12 MB recorder cap is ~2900 frames at 60 fps.
`setCrowdDispatch('quad')` mid-session stalled GPU collection ~50 s (cold
compile of the quad program) — do not toggle it in a timed run.
