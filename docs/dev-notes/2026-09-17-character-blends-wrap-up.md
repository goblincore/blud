# Character blends and heading fix — accepted 2026-09-17

Owner manually playtested the half-strength blends and the subsequent zombie heading fix, reported everything looked good, and authorized shipping to main and pushing. Production commits: `3662c1ca` (blend default and regenerated gib assets), `3e9850e3` (heading correction).

## Shipped behavior

- Eligible additive round flesh blends default to half strength across character builds. CPU queries, GPU packing, wounds, severing and baked gib assets use the same effective geometry. Explicit primitive tuning overrides stay absolute.
- Character shape axes and attachment offsets turn with the body. The apparent room-specific zombie variants were one model with world-aligned torso/foot axes; the shared rig correction preserves the intended proportions across headings.
- The existing quadratic smooth-min equation remains unchanged. This is a geometry/performance tradeoff, not a cheaper replacement equation.

Implementation and audit details: [half-strength defaults](2026-09-17-half-blend-default.md) and [heading diagnosis and regression](2026-09-17-zombie-heading-shape.md).

## Performance evidence and limits

Earlier Apple M3 WebGPU measurements used frozen scenes, 800×600 output, 400×300 SDF input, the trained upscaler, five alternating reference/half pairs, and GPU-fenced batches. Whole-render median costs:

| Scene | Full blend | Half blend | Observed saving |
| --- | ---: | ---: | ---: |
| Single armored soldier | 4.60 ms | 4.54 ms | Negligible/noisy |
| Zombie-heavy crowd, 13 visible actors | 42.06 ms | 36.34 ms | 5.72 ms / 13.6% |
| Close wounded crowd stress case | 118.46 ms | 87.14 ms | 31.32 ms / 26.4%; substantial drift |

These omit simulation and presentation waiting and are not live-play FPS measurements. They predate the heading correction, which enables existing oriented evaluation on additional anisotropic clusters. No final combined timing claim is made. The experiment and its raw evidence remain preserved locally on `codex/blend-march-2026-09-17` at `0402afae`, under `docs/dev-notes/2026-09-17-blend-march/`; experimental hooks were not merged into production.

## Verification and acceptance

The blend rollout passed 300 focused tests across 14 files, production build/TypeScript and gib asset freshness checks. The heading fix passed 225 focused tests across nine files and production build/TypeScript. Counts overlap and should not be added. WebGPU visual checks covered sideways and full-body views in rooms 2 and 4 without captured page errors. The owner then accepted the live playtest. No full repository test-suite claim is made.

Existing extra rest-pose validation diagnostics from narrower blending remain documented and unsuppressed. Owner visual acceptance does not mean those diagnostics disappeared; they do not block this accepted rollout.

## Lessons

1. Smaller blend influence can save more marching work than changing the smooth-min arithmetic: group rejection, bounds and silhouette coverage all matter. Measure the whole renderer in the scenes that spike.
2. A room-dependent appearance can be a transform bug. Check the same model at multiple headings before creating asset variants or changing anatomy.
3. Rotate anisotropic axes and endpoint/bend offsets together. Rigid rotation should preserve signed distance when both the primitive and query point rotate; this is now a regression test.
4. Keep render geometry and CPU/gameplay/baked assets consistent. Rebuild dependent assets when the effective build profile changes.
5. Visual harnesses need real animation frames: a synchronous manual-step capture showed missing flesh, while actual frame scheduling rendered complete bodies. Discard invalid captures instead of diagnosing their artifacts as model defects.

The accepted work is complete. Further character polish or a combined timing rerun is separate work, not an outstanding shipping gate.
