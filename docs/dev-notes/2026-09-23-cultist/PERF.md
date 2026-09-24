# Cultist perf pass: findings so far (2026-09-24)

The owner reported three cultists close up at 65 ms. This pass measured where the cost is and
landed one engine-wide cull fix. It was **paused** because the machine was under heavy load and
timing was unreliable. Pick up with a quiet machine.

## Tooling added

- **Bench scenes** `?scene=C` (three cultists 0.9 m apart, camera 2.2 m) and `?scene=CZ` (the same
  layout with zombies, the reference) in `sdf-bench.html`: `scripts/sdf-bench.sh C 0.7 10`.
- **`?debug=shaded`** (`scripts/sdf-bench.sh C 0.7 5 shaded`): the held yaw-0 frame, shaded. It is
  deterministic (two runs are byte-identical), so it is the before/after image diff for any march
  change.
- The **close-up harness** (`scripts/lib/sdf-closeup-stage.mjs`, `runInterleaved`) works on a
  cultist with `url: sdf-game.html?frozen=1&seed=7&spawn=cultist` and `stage: { room: 2 }`. Its
  `flat0` leg skips shading, which splits march cost from shading cost.

## Numbers

All numbers are from the bench scene C prims heatmap, decoded back to prim evaluations per body
pixel. It is deterministic, so it has no timing noise. Timings are medians from the same machine.

| Variant (cultist.blob edits, scene C) | Prims per pixel |
| --- | --- |
| baseline | 576 |
| no face features (10 head blobs) | 279 |
| no teeth (8 prims) | 437 |
| no shell `warp=` | 485 |
| face blobs unsquashed | 503 |
| no fingers | 541 |
| thigh-only legs | 542 |
| blends capped at 0.016 | 519 |
| **upper-bound cull (landed)** | **396** |
| zombie scene CZ: before / after the cull | 134 / 88 |

- **Bench timing**, with alternating A/B/A/B runs:

  | Scene | Before | After the cull |
  | --- | --- | --- |
  | C (cultists) | 84.7 ms | 78.7 ms |
  | CZ (zombies) | 17.9 ms | 17.0 ms |

  The prim reduction is only partly time.
- **Game** close-up (`__sdfGame.bench` closeup, passes mode): `sdf:march` is about 22 ms of a
  26 ms frame with one cultist near. A zombie in the same spot is about 5.4 ms. The cull showed
  **no** measurable game change in an alternating A/B, but those runs had non-deterministic
  framing (fixed since: `?frozen=1&seed=7`).
- **Close-up harness**, one cultist filling the screen, under heavy load: 238 ms normal against
  142 ms flat. So about **40% of his cost is SHADING** (normals, AO probes, paint, face), not the
  march. The upper-bound cull only helps the march.

## Why the face was so expensive

The group cull is `sphere distance > (d + 4 x maxBlend) x distort`. The head is the FIRST cluster
folded (`CLUSTER_ORDER`), so while it folds `d` is still 1e9 and nothing in it can cull. Every
march step of every ray paid all 24 head prims. The face groups are also squashed (distort about
2.1).

- **The fix**, `gCullRef` in `fields/groups.wgsl.ts`: the march passes an upper bound on the fold
  (the previous sample's fold + 3 x the distance moved), and the culls use `min(d, bound)`.
- **Fold order is untouched.** Reordering the clusters (torso first) was measured: smin is
  order-dependent and it moved surfaces up to 78 mm (bloatmaw) and 19 mm (ogre).
- The shaded stills of scenes A, B, C and CZ match the old shader. No pixel is more than 24/255 off
  and the maximum is 11/255.

## Next

1. Re-run on a quiet machine (the close-up harness, variants and the zombie reference):
   `.lab-tmp`-style driver = `runInterleaved` + a `.blob` variant swap between blocks.
2. **Shading side**:
   - `calcNormal`'s 4 taps and the AO probes call `mapBody` with no bound. Give them one: the hit's
     fold + tap distance.
   - Check the per-pixel painted/face cost.
3. **Content**:
   - Fewer and rounder face features. The teeth could become one prim or a baked mesh (owner's idea).
   - Drop `warp=` from the field and keep it in shading.
   - Hidden legs and fingers are cheap: leave them unless baking the hands.
4. If the robe shells still dominate after that, try a baked or mesh robe (see TASKS).
