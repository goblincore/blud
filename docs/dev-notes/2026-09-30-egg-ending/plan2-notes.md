# Egg pass (ending plan 2): notes

Plan: `docs/superpowers/plans/2026-09-30-night-train-egg-pass.md`. Spec: `docs/superpowers/specs/2026-09-30-night-train-egg-ending-design.md` §1-§2.

## What was built

1. `94961e1e` pure twin `egg-look.ts` (ellipsoid rays, analytic soft Gaussian figure, spots, pulse, resolve) with tests.
2. `85c12794` WGSL `egg.wgsl.ts`: three nested analytic ellipsoids (veined outer shell, milky spotted inner egg, glow + soft figure inside), composed in a fixed order, so no transparency sorting.
3. `ae125d03` `game-egg-leaves.ts`: the proxy box in the SDF late scene, hides the plan-1 placeholder, pulse on the train clock, `__sdfGame.egg()` / `setEgg()` seams.
4. `992e4518` headless check `scripts/sdf-egg-check.sh` (wiring, draws, pulse, figure, all round, away, cost).
5. This commit: the look pass (below), notes and task board.

## The sheet

- Final: `egg-pass.png` (door 5.3 m, near 1.8 m at resolve 0 and 1, behind, pulse held 0 and 1).
- Before tuning: `egg-pass-before-tuning.png` (same frames, plan defaults).
- Targets: `egg-close.png`, `control-room-door.png` (Blender blockout).

## Numbers (final)

- Figure contrast (side milk minus figure patch, over side): near resolve 0 **0.263**, near resolve 1 **0.375**, far resolve 1 **0.249** (before tuning: -0.165, -0.205, -0.099, i.e. the figure was brighter than the milk). Check thresholds unchanged and passing: resolve 1 sharpens near by 43% (needs > 15%), far < near, near < 0.6.
- Pulse: held 0 -> luma 78.5, held 1 -> 99.5 (+27%); live pulse takes 19 distinct values over 40 steps.
- Cost: egg pass on 6.90 ms vs placeholder 6.90 ms at the door pose (+0.00 ms).
- Cold boot to `__warmGate` ready, fresh Chrome profile and fresh vite per run, headless, `level=night-train`: this commit 3.4 s and 3.3 s; base `81ed9d9d` 3.3 s and 3.3 s. Within noise (the machine's Metal shader cache is outside the profile, so these are "fresh profile", not "cold GPU cache").
- Train gate: office +182 draws (as plan 1), control pose 50 -> 76 (+26; plan 1 recorded +23, so the proxy swap costs about +3 draws in that pose, still far inside the +200 budget); the cost line passes.

## Why a constant could not do it (WGSL edits)

The figure was invisible because the in-scatter of the milk (`scatter`) was not attenuated by the figure: the figure patch always showed at least the milk's own scatter, and its glow (a strong warm emission) was brighter than the milk beside it, so even a large `figureStrength` left the patch brighter. Fixes:

- `scatter` is multiplied by `exp(-0.8 * tauAll)` (the figure dims the milk in front of and around it). Not reachable by a constant.
- `milkCol` changed from grey-white (0.86, 0.88, 0.82) to warm (0.95, 0.72, 0.55) so the inner egg reads as a peach milk like the blockout, not a grey one.
- The figure's absorption now divides by `blur^3` (twin and WGSL, test updated) instead of `blur`: a defocus conserves a blob's total absorption, so its peak falls as `1/blur^2`. With a constant peak the blurred figure darkened the milk beside it as much as the sharp one, and resolve could not sharpen the contrast. Now the figure is a faint smudge at range (peak optical depth about 1.4 at blur 1.7) and a clear soft figure near (about 4 at blur 1).

## Constants changed from the plan defaults (`egg-look.ts` EGG)

| constant | before | after | why |
| --- | --- | --- | --- |
| `figureStrength` | 3.2 | 16 | the figure must clearly darken the glow: peak optical depth 4 through the body at blur 1 |
| `coreScale` | [0.3, 0.5, 0.18] | [0.5, 0.75, 0.3] | a broad warm backlight across the inner egg like the blockout, not a small hot spot |
| `coreGain` | 5.0 | 5.0 | kept; 7 flooded the view from behind (flat peach, spots washed) and 4 left the egg grey |
| `milkSigma` | 1.4 | 2.2 | the lit screens showed through the inner egg as pale squares |
| `spots` | 24 | 14 | 24 looked like stickers and one large disc covered half the figure; 14 leaves the figure clear |

Unchanged: `shellAlpha`, `milkFront`, `blurFar`/`blurNear`, the `FIGURE` blobs.

Check script: only the pose-specific contrast boxes moved (the new spot layout put a spot on the old boxes); the thresholds are untouched. `EGG_FIGURE_WARN` stays in place, unused.

## The look, honestly

Matches: a milky peach inner egg with teal spots inside a red-veined transparent outer shell; at the door the figure is a faint dark smudge in the middle of the inner egg; near with resolve 1 it is a clear soft dark figure (head hump and body), blurry-edged and never a crisp outline; resolve 0 near gives a wider, fainter smudge; the room stays dark and warm (the egg does not flood it).

Falls short of the blockout: the glow is a broad flat peach, not a bright core with a falloff to a dimmer milk; the figure is an oval blob with a head, not limbs you can count; the spots are flat discs, bigger and more evenly teal than the blockout's; from behind the glow is a flat peach and the spots wash out.

## Open items

- The egg light and the consoles' screens do not follow the pulse (out of scope).
- The outer shell is an ellipsoid without the blockout's slight taper.
- Spots are flat discs (no relief), and from behind the glow washes them.
- The figure is five blobs; limbs are barely legible at this softness.
- The glow has no falloff structure of its own (a brighter core would help the figure read as a silhouette against a backlight).
