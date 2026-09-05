# Zombie analytic normals — incomplete after partial wound validation

Updated 2026-09-05 from the retained Task 4 evidence. The overall verdict is **incomplete**. `reference`, `gpuKernel`, and `intact` pass; `wounds` is deferred; `visualEvidence` and `timing` are skipped by that gate; full `ownerLook` remains pending. The feature stays default off. No performance or acceptance conclusion can be derived from analytic-pixel percentages.

The intact scope is complete and its appearance was approved by the owner. That approval does not extend to the full wounded candidate. Task 4 produced substantial real-GPU wound evidence, but the final bounded-settling, detached-piece point-probe, and initial-impact capture changes have not run on GPU. The last permitted preflights were load1 26.50 and 55.74, above the required 12, so no server or browser was started and GPU retries stopped.

## Retained wound evidence

The production wound oracle contains 11 real RGBA32F cases and matches independent CPU scalar/finite-difference checks. Thirteen retained scene comparisons cover actual `fireSlug` impacts, stagger, overlap, head wounds, a real sever, the remaining body, and detached `chunk:1`. Completed comparisons preserve exact depth and fallback parity.

- Torso impact affected-wall coverage is 2,074 analytic / 2,627 hits; affected rim coverage is 11,015 / 11,993. Its p99 is 2.6409 degrees and max is 40.3719 degrees. Independent GPU central differences, CPU geometric gradients, stable owner 5, and the geometric-plus-noise decomposition localize the max. The controller reviewed that specific artifact and accepted the benign technical appearance exception; the raw max and failed history remain recorded.
- The real elbow shot changed the actor from 10 to 11 pieces and created two wounds, an impact wound and stump wound. The surviving `body:1` has exact depth/fallback, p99 1.7301 degrees, and max 44.3470 degrees. Five localized points have CPU gradient error at most 5.2e-5, GPU central error at most 8.9e-4 at the useful epsilon, stable owner 10, and matching noise decomposition. The controller accepted the specific retained body artifact exception.
- Detached `chunk:1` has 1,183 analytic pixels / 1,283 hits, exact depth/fallback, p99 5.8465 degrees, and max 8.9135 degrees. Its p99 remains an explicit unresolved proof and review item. It is not waived by the body review or by any threshold change.
- Exposed curved internals fall back conservatively: stagger has 101 pixels, all unsupported; overlap has 429 pixels, 374 unsupported and 55 hard-boundary; head impact has 61 pixels, all unsupported. None is counted as analytic.

Seven retained event records use the real `fireSlug` path. Only the elbow-controlled event is a demonstrated sever: wounds 0 to 2 and pieces 10 to 11. Other event records preserve their actual impact, overlap, repeat, or non-sever outcomes rather than inferring severing from a shot name.

## Historical failures and motion scope

All ten historical raw JSON reports remain listed with their original `/tmp` paths and SHA256 values in `wounds.json`. Byte-identical deterministic gzip archives now live under `wound-raw/`; decompression reproduces each recorded SHA. Failed runs, bad ROI evidence, wrapper mismatches, timeouts, and later controls remain separate.

The moving-shoulder first read was a legacy-to-legacy confound: 14,670 floats changed, including exactly 3,666 depth pixels, with depth max 0.084325075. Packed rows, config, camera, and captured CPU state were unchanged. The first legacy raw was byte-identical to the earlier failed arm-run legacy raw. After settling, legacy-to-hybrid depth and fallback are exact, with p99 1.6930 degrees and max 7.6107 degrees. This corrects the earlier interpretation without deleting the failure.

Motion evidence covers 24 paired frames after the torso impact/stagger and 12 paired frames of detached-piece flight. The 24-frame sequence captures every subsequent simulation frame after the original event setup, and the 12-frame sequence captures every sever-flight frame. The original evidence stepped two initial projectile/impact ticks before its first post-impact pair, so those ticks are not fully paired. Earlier moving-light review applies to actor appearance; background-shadow differences prevent a full-frame motion-equivalence claim.

Four representative paired beauty images are tracked for the torso impact and detached chunk. Their controller review is artifact-specific. The driver must not infer approval for future captures from a scene name.

## Remaining gates

1. On a load1 <=12 opportunity, run the final bounded settling and detached-piece point adapter on real WebGPU. Prove the worst detached-chunk pixels independently and review p99 5.8465 degrees without changing the threshold.
2. Validate the newly paired initial projectile/impact ticks and stronger full-state beauty signatures. Preserve the earlier shadow-motion limitation.
3. If Task 4 then passes, run the full paired Task 5 gameplay timing protocol. Until those measurements exist, timing stays `skipped-by-gate` and no speedup claim is valid.
4. Obtain full wounded-candidate owner review before changing `ownerLook`. Intact approval remains recorded as its own completed scope.

`summary.json` is generated offline by `--phase verdict`; it carries the explicit `intactValidation: complete` and `fullWoundGameplayValidation: deferred` coverage scopes, retained wound measurements and unresolved work. The offline command exits 1 by design for this incomplete verdict and does not contact dummy Vite/CDP ports.
