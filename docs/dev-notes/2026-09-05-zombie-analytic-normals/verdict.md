# Zombie analytic normals — incomplete verdict

Date: 2026-09-05. Candidate checkpoint: `8637914`. Conclusion: **incomplete**.

The mathematical reference and isolated real-WebGPU kernels passed. The default-off intact/detail implementation exists, but its full gameplay shader has never compiled or executed on a GPU. Three bounded launch attempts stopped before starting Vite or Chrome because load1 was 20.47, 27.25 and 25.78, above the required limit of 12; an intermediate observation reached 83.79. There are therefore no gameplay numeric samples, depth comparisons, fallback comparisons, eligibility pixels, coverage images, motion frames, performance pairs, or owner look result.

## Gate result

| Gate | State | Evidence |
| --- | --- | --- |
| reference | pass | 19 focused CPU/oracle cases at `dcca600` |
| gpuKernel | pass | 11 real RGBA32F WebGPU cases and a negative control with 16 expected mismatches at `edeca69` |
| intact | deferred | Code and focused static checks exist, but zero real gameplay GPU samples were collected |
| wounds | skipped-by-gate | Task 4 requires `intact: pass`; no wound-gradient implementation was attempted |
| visualEvidence | skipped-by-gate | No gameplay images or motion reel exist |
| timing | skipped-by-gate | No paired timing leg was attempted; no timing value can be reported |
| ownerLook | pending | Owner review requires representative gameplay evidence |

The tracked machine-readable result is `summary.json`. Its timing and coverage measurements are `null`, and its image list is empty. Those values mean unavailable, not zero milliseconds, zero cost, or zero percent coverage.

## Unresolved validation

Static review of the intact driver found three issues whose fixes are pending: head/torso coverage currently counts all camera-framed hit pixels instead of anatomical regions; staging helpers can call `process.exit` and bypass driver cleanup; and the motion camera uses the wrong yaw sign. These are driver defects, not gameplay GPU evidence, and they do not change the incomplete conclusion.

The separate zoned wound-cache branch has `zonedCfg.x`; that uniform is absent at this checkpoint. Any future combination must force complete legacy normals while cache mode is active until cached-field gradients pass separate validation. Cached gradients and reduced-rate AO/scatter remain future experiments.

## Resume sequence

From `/Users/donny/Projects/blud/.worktrees/zombie-analytic-normals`, after the driver review fixes land and machine load1 is at most 12:

```bash
export LAB_VITE_PORT=5251 LAB_CDP_PORT=9251
source scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/zombie-normal-gradient-check.mjs --phase intact --out /tmp/zombie-ng-intact --vite 5251 --cdp 9251
```

Investigate actual full-shader compilation, numeric and depth parity, complete fallback parity, anatomical head/torso coverage, and moving-light/body evidence before considering `intact: pass`. Only then implement and validate Task 4 wounds, followed by the complete paired visual, coverage and timing work in Task 5. Keep the mode default off throughout.
