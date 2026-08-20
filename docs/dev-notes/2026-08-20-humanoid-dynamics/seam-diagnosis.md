---
created: 2026-08-20
author: claude
topic: humanoid brick seam diagnosis
tags: [sdf-lab, humanoid, seam, smin, diagnosis]
---

# Humanoid brick seam — measured diagnosis

Task 2 of the humanoid dynamics pass. The owner reports "highly visible seams" at
the wrists and upper arms. This note records what the CPU-mirror probe actually
measured across the `RightArm`/`RightForeArm` joint band, before any constant is
touched.

## The probe

`sampleAcrossJointBand` (in `humanoid.wgsl.test.ts`) is a hand transcription of
`mapHumanoidField`: it samples the **real dense R16F distance atlas** on disk (the
same bytes the GPU marches — no synthetic stand-in), trilinearly on the baker's
endpoint-inclusive lattice with the outside-box metric distance, then folds the two
dominant bones with the `jointBlendWeight`-gated iq smooth-min and records, per
sample, three quantities:

- **composed distance** — `smin(best, second, kBand)`;
- **finite-difference normal** — the shader's exact `calcNormal` tetrahedral taps
  at `0.0015 m` (`e = (1,-1) * 0.0015`), on the composed field;
- **colour blend weight** — `bandW * proximity * 0.5`.

The scan walks **400 points along the limb axis through the joint centre, at the
bisected surface radius in the inner-elbow flexion direction**, spanning
`±45 mm` (pitch ≈ 0.226 mm), in bind pose.

## Measured maxima

| quantity | measured | threshold | verdict |
| --- | ---: | ---: | --- |
| distance step `maxDistJump` | **0.000443 m** (gradient **1.962×**) | `pitch × 1.5` = 0.000338 m | **FAILS** |
| normal swing `maxNormalJump` | **6.28°** | 15° | passes |
| colour step `maxColorJump` | **0.0225** | 0.1 | passes |

The **distance** assertion fails: the composed field's gradient reaches ~1.96× a
unit SDF along the scan. The normal swings only ~6° and the colour weight ramps
smoothly — there is **no hard-min crease and no colour line**.

## The sweep: widening `HUMANOID_JOINT_SMIN_K` makes it worse

The prescribed fix for a distance failure is to widen the smooth-min k. The sweep
says the opposite:

| `HUMANOID_JOINT_SMIN_K` | `maxDistJump` | gradient | clears? |
| ---: | ---: | ---: | --- |
| 0.005 | 0.000220 m | 0.98× | yes |
| **0.010** (checked in) | 0.000443 m | **1.96×** | no |
| 0.015 | 0.000668 m | 2.96× | no |
| 0.020 | 0.000894 m | 3.96× | no |
| 0.030 | 0.001345 m | 5.96× | no |

The pinch gradient is **~196 × k** — linear in the smin k. Widening the smin
deepens the divot and sharpens the ridge; no value in the prescribed
0.010–0.030 sweep clears the assertion. Only a *smaller* k does.

## Root cause

The two bricks overlap so heavily that their SDFs are **near-identical across the
entire 30 mm band** (their distance gap stays ≈ 0). The smin therefore has no real
transition to smooth — its `h²·k/4` carve just digs a divot of depth `k` at the
band centre, and the divot's edge, where `bandW` ramps 0→1 over the
`[7.5 mm, 15 mm]` smoothstep, is a steep axial ridge (gradient ≈ `k × 200/m`).

That ridge **is** the visible seam. The smooth-min is not too narrow here; it is
the *cause* of the seam, because the geometry it was written to blend (two
different surfaces meeting) does not exist in this heavily-overlapping pair.

## Blocking conclusion

The plan's hypothesis #1 ("the smooth-min is too narrow") is **inverted** for the
baked humanoid. The prescribed fix — *widen* `HUMANOID_JOINT_SMIN_K` and take the
smallest value that clears — is unreachable: every widened value fails worse than
the baseline. Per the plan's own rule ("a truthful blocker beats a passing lie"),
**no constant is changed here**; the measured direction is to *reduce* k (or widen
the band smoothstep), which is the owner's call, not this task's prescribed sweep.

The probe test in `humanoid.wgsl.test.ts` is intentionally left **RED** on the
distance assertion — that failing assertion is the diagnosis, recorded here rather
than papered over by widening a constant that the sweep proves makes the seam
worse.
