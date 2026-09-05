# Zombie analytic normals — Task3 passes; overall verdict incomplete

Updated 2026-09-05 after the resumed guarded GPU validation. `reference`, `gpuKernel` and `intact` pass. Owner look remains pending. Task4 wound-surface work and performance have not run; the experiment remains default off.

Three real gameplay runs are preserved independently: `intact-first-run.json` (six comparisons, failed mixed coverage, contaminated beauty), `intact-corrected-1738.json` (seven comparisons, valid corrected beauty/motion, failed torso control and wider mixed coverage), and `intact-head-wound.json` (seven comparisons, all numerical criteria passed). `intact.json` links all three and contains the latest numerical results. Twenty scene comparisons are repeated measurements across runs, not twenty distinct actors or a performance sample.

| Latest scene | Analytic coverage | Numerical result |
| --- | ---: | --- |
| Whole body | 8,337/9,376 = 88.92% | Exact depth/fallback |
| Anatomical torso | 10,840/12,516 = 86.61% | Exact depth/fallback |
| Anatomical head | 7,270/8,698 = 83.58% | Exact depth/fallback |
| Animated/scaled body | 34,322/37,440 = 91.67% | Exact depth/fallback |
| Bare-bones control | 0%; 37,440 unsupported | Exact complete legacy result |
| Torso-slug control | 23/16,477 = 0.14% | 16,452 wound-pending, 2 owner-unstable; exact fallback |
| Fresh head-wound whole body | 1,702/9,469 = 17.97% | 7,645 wound-pending, 122 owner-unstable; exact fallback |

All seven scenes have depthChanged=0, depthMax=0, fallbackMax=0 and nonFinite=0. Maximum eligible scalar error is 1.0361e-8; legacy finite-stencil comparison p99 stays below1.50°, maximum6.59° in the animated case. These angle tolerances compare against the finite stencil and do not independently prove exact differentiation. Shader console is clean.

The torso slug's actual centerY1.020 and production reach0.8796m exclude almost the whole body. Moving the camera back did not create useful eligibility; the second failed run preserves that result. The torso control now requires actual wound-pending pixels and exact fallback parity, not mathematically unjustified100% fallback. Its acceleration is negligible and cost is unknown.

The separate mixed fixture starts a fresh page, reapplies shipped settings and verifies zero preexisting wounds. A single shipped0.16m slug anchors at world(-4.7335875,1.5806372,-4.6493816), primitive2, limb`head`. Production reach remains0.8796m. Including the stencil margin, geometry belowY0.698439 lies beyond its vertical reach; six leg primitive endpoint rows extend below it. Raw eligibility confirms analytic lower-body skin. **The wounded scene's anatomical head and torso are both0% analytic.** This demonstrates local supported/unsupported coexistence, not wounded head/torso acceleration. The mixed>=10% and>=100analytic-pixel criteria remain unchanged.

Corrected beauty preserves shipped smear0.25, flushes20 identical zero-dt frames, fences through raw target readback and compares paired debug/material/camera/actor/light states. The twelve motion pairs advance simulation once per pair, before any wound, and freeze for both modes. Controller inspected head/torso, motion0/6/11, torso-wound pairs and fresh-head-wound beauty/eligibility with no obvious regression. The brief disappearance concern was retracted after identical file hashes and fresh individual views confirmed body and weapon; no rendering or screenshot-delay fix was made. Original first-run beauty/motion remain non-acceptance evidence.

The durable owner viewer is `.superpowers/sdd/2026-09-05-zombie-analytic-normals/owner-review/review.html`. Latest raw artifacts are `/tmp/zombie-ng-intact-head-wound`. HUD times and image RGB differences are not performance evidence. Owner look is pending separately from the controller's technical image inspection.

Twelve focused Node tests and both driver/helper syntax checks pass. Fixture and offline-report regressions were observed RED then GREEN. No TypeScript or shader changed in this correction; prior TypeScript checks passed. The final GPU launch passed load1=6.46875, used owned5251/9251 and exited0; trap cleanup completed and both ports were verified free.

Chunk-containing eligibility captures remain rejected until piece identity/masks are extended. A future combined zoned-cache build must force full legacy normals while `zonedCfg.x` is active; that uniform is absent here. No Task4, performance run, merge, push or default enablement occurred. Next step is owner intact-look review.

## Owner feedback after intact review

The owner inspected the A/B viewer and said it looks good, like exactly the same, and explicitly does not require such close visual parity. Intact appearance is accepted; small benign appearance differences are acceptable while preserving the wet skin and wound read. This is not acceptance of the unimplemented wound-gradient stage. The full ownerLook gate remains pending for that later result. Next implementation step is Task 4 after scoped review completes.
