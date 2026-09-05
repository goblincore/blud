# Zombie analytic normals — incomplete verdict

Date: 2026-09-05, updated 15:22 EDT. GPU-tested candidate: `95e9206`; capture/fixture corrections are a later checkpoint. Conclusion: **incomplete**.

The mathematical reference, isolated real-WebGPU kernels, and the first full gameplay shader compilation passed. The first game run now supplies six raw numerical scene comparisons. It ended `passed: false` because the wounded upper-body closeup had zero analytic pixels, below the mixed-scene 10% floor. Its beauty images were subsequently found to contain diagnostic-color history from the shipped temporal smear. Corrected capture and wider wounded fixtures are implemented and tested offline, but their one guarded rerun stopped before servers at load1 17.7056, above the required 12. These remaining checks keep `intact` deferred.

## Valid partial gameplay evidence

The unmodified first run is preserved in `intact-first-run.json`; `intact.json` identifies both its valid numerical results and rejected visual evidence. Backend was real WebGPU, the shader console was clean, and the run compared 208,795 hit pixels across six scenes.

| First-run scene | Target hit pixels | Analytic coverage | Numeric result |
| --- | ---: | ---: | --- |
| Whole body | 9,376 | 88.92% | Exact depth/fallback parity |
| Torso framing | 36,258 | **86.61% of 12,516 anatomical torso pixels** | Exact depth/fallback parity |
| Head framing | 61,346 | **83.58% of 8,698 anatomical head pixels** | Exact depth/fallback parity |
| Animated/scaled flesh | 37,440 | 91.67% | Exact depth/fallback parity |
| Bare-bones unsupported control | 37,440 | 0%; 100% unsupported fallback | Exact legacy normal/depth result |
| Wounded upper-body closeup | 26,935 | 0%; 100% wound-pending fallback | Exact legacy normal/depth result; mixed coverage criterion failed |

The animated body had 23 visible primitives, 10 anisotropic and 4 nonidentity-oriented rows. Maximum eligible geometric scalar error was `1.0361e-8`; normal differences against the shipped finite stencil stayed below 1.50 degrees p99, with a 6.60-degree maximum in the animated case. Those angles compare to the finite stencil, not an independent claim of exact differentiation. No timing claim follows.

## Visual and mixed-coverage blockers

The original screenshot sequence rendered one beauty frame immediately after eligibility. `post-aa.ts` ships exponential smear 0.25, so legacy beauty retained 25% diagnostic history and hybrid retained 6.25%. Owner-shaped violet patches and pink bands were therefore capture contamination, despite matching raw normals. **Original beauty images and 24 motion frames are non-acceptance evidence.** They remain at `/tmp/zombie-ng-intact-resume/`; valid raw diagnostic images are tracked separately. The old motion frames also followed the crater and exercised full wound fallback.

The capture correction asserts actual smear 0.25, preserves shipped settings, flushes 20 identical zero-dt beauty frames, fences through raw target readback, and records/checks standard debug, normal mode and material values for each pair. Motion now occurs before wounding: simulation advances once, freezes, then captures legacy/hybrid at the same actor/camera/light pose. This corrected path has not run on a GPU.

The shipped 0.16 m slug radius and recorded wound settings imply a conservative production reach of 0.8796 m, plus the normal stencil margin; that can cover the entire upper-body closeup. The corrected fixture retains this narrow scene as an explicit full wound-pending control and adds a 2.4 m whole-body view containing skin beyond the reach. The original mixed >=10% floor applies to that wider view, without changing shader support or thresholds. This will demonstrate mixed supported/unsupported coverage, **not wounded-closeup acceleration**. Task 4 remains responsible for wound-surface gradients.

## Gates and next step

| Gate | State |
| --- | --- |
| reference / gpuKernel | pass |
| intact | deferred for corrected capture/fixture validation |
| wounds | skipped-by-gate |
| visualEvidence / timing | skipped-by-gate |
| ownerLook | pending |

The updated offline verdict generator preserves partial GPU coverage and explains the first-run failure; it no longer claims zero gameplay samples. Ten focused Node tests, driver syntax and TypeScript pass. There are no valid paired timings or owner acceptance. Static review of the prior three driver fixes passed; the latest capture/fixture fixes still need review and the required GPU run.

Anatomical coverage uses the intended actor's primitive-owner limb masks. Other actors keep geometry/depth but emit a temporary negative RGB sentinel; exact look values restore in `finally`. Chunk-containing eligibility captures are rejected until Task 4 extends piece identity/masks before any impact/sever coverage claim. A future combined zoned-cache build must force complete legacy normals while `zonedCfg.x` is active; that uniform is absent here.

After review and an authorized quiet-machine attempt, run from the isolated worktree:

```bash
export LAB_VITE_PORT=5251 LAB_CDP_PORT=9251
# Require both ports free and load1 <=12 before starting owned servers.
source scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/zombie-normal-gradient-check.mjs --phase intact --out /tmp/zombie-ng-intact-corrected --vite 5251 --cdp 9251
```

Inspect clean beauty and matched intact motion, validate the narrow control plus wider mixed coverage, and retain the separate numeric gates before considering `intact: pass`. Do not enable by default or begin Task 4 from the current incomplete result.
