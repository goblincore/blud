# Fisheye lens — capture notes and verdict

**2026-09-03.** Branch `claude/fisheye-distortion-postprocess-7887a3`.
[spec](../../superpowers/specs/2026-09-03-fisheye-lens-design.md) ·
[plan](../../superpowers/plans/2026-09-03-fisheye-lens.md)

## What shipped

The camera renders WIDER than the player sees and the canvas blit squeezes it
back. Two knobs, both vertical degrees: `renderFovDeg` (90, up from 75) and
`centerFovDeg` (60). The ratio between them is the bend.

* `fisheye.ts` — the radial map, one definition shared by the blit shader
  (`FISHEYE_WGSL`) and the DOM reticle (`reticleNdc`). Corners pinned;
  `sampleRadius(r) <= r` everywhere, so no sample ever leaves the source rect.
* `post-aa.ts` — the warp folded into the existing blit (no new pass: the
  file's orientation invariant counts intermediate passes), as a 4-tap
  rotated grid that supersedes sharp upscale. `setLens` / `lens`, re-resolved
  from the live content aspect on every refit, and joined to the `active` gate.
* `game-main.ts` — camera to 90, `postAa.setLens`, the reticle through the
  inverse map, and `__sdfGame.setFisheye` / `setRenderFov` / `.fisheye`.

## The field of view, measured

**The game runs at a 4:3 fixed cap (800x600), not 16:9** — the spec's table was
written for 16:9 and is right for that aspect but is NOT what the game shows.
Both, for the record:

| aspect | | render | on screen | at centre |
| --- | --- | --- | --- | --- |
| **4:3 (the game)** | vertical | 90.0 | **72.2** | 60.0 |
| | horizontal | 106.3 | **97.0** | 75.2 |
| | *old 75deg camera* | | *75.0 / 91.3* | |
| 16:9 | vertical | 90.0 | 68.3 | 60.0 |
| | horizontal | 121.3 | 115.9 | 91.5 |
| | *old 75deg camera* | | *75.0 / 107.5* | |

So at the aspect the game actually runs: **+5.7 deg horizontal, -2.8 deg
vertical, centre magnified 1.73x.** The visible extent barely moves; the bend
is the whole effect. `k = 0.2635`, `rmax = 1.667` at 4:3.

A radial warp on a rectangle cannot pin the corners AND keep the mid-edges,
so the outermost sliver of the rendered frame does not reach the screen. That
is why the render FOV went up rather than down.

## Captures

`scripts/dungeon-look.sh <pose> /tmp/fisheye-after`, poses corridor / room /
wall. A lens-off baseline was captured by temporarily setting
`FISHEYE_DEFAULTS` to `{ renderFovDeg: 75, centerFovDeg: 90 }` and reverting.

* **The bend is unmistakable and correct.** Ceiling edges, floor lines and
  mortar courses all bow; the A/B on the `room` pose is dead straight before
  and strongly curved after.
* **No black anywhere** at any edge or corner, as the map guarantees.
* **The gun bulges with the world** rather than sitting flat on it — the
  intended look.
* Two zombies that sit outside the old frame appear at the edges of the
  `room` shot: the wider horizontal view, visible.

## Frame cost

Same pose, same headless Chrome, `room` (2 bodies on screen):
**35.9 ms lens off -> 39.8 ms lens on, about +4 ms (+11%).** `corridor`
(6 bodies) measured 33.4 ms with the lens on.

Read this in proportion: the baseline was ALREADY over the 33.3 ms / 30 fps
budget in that pose, so the fisheye did not break the budget — but it does not
help, and it is a real cost for a pure look feature. `__sdfGame.setRenderFov(85)`
buys most of it back for a slightly gentler bend. Headless numbers; a real
session should be better.

## KNOWN ISSUE — free aim can point off-screen

**Not fixed. Owner's call (2026-09-03): "leave it, I'll judge it in play."**

Free aim has no auto-recentring (`game-main.ts:1115` — the reticle stays where
the mouse put it), and its clamp lives in the TRUE frustum, not on screen. The
lens shows 72 deg vertically out of 90 rendered, so aim can now address points
outside the visible frame. Measured, at the 4:3 cap:

| aim | drawn at | |
| --- | --- | --- |
| `y = 0.730` | `y = 1.000` | the limit |
| `y = 0.75` | `y = 1.020` | off the top |
| `y = 1` | `y = 1.235` | well off |
| `x = 0.848` | `x = 1.000` | the limit |
| `x = 1, y = 1` | `1.000, 1.000` | on screen — the corner is the fixed point |

Because shoving the reticle past the dead zone (`deadzoneY = 0.38`) is HOW you
turn, a player looking up parks the crosshair off the top of the screen and it
stays there. This is a regression introduced by this work: before the lens,
full deflection landed exactly on the frame edge.

**Weight it heavier than "an edge case."** `deadzoneY` is 0.38, so the upward
turn range is `[0.38, 1.0]` and the crosshair leaves the frame at 0.730 — the
top ~45% of the deflection you must use to look up. Any firm upward flick gets
there; it is not reachable only by abuse.

**Cheapest first probe, not in the two fixes below:** `FREE_AIM.recentreRate`
already exists and ships at `0.0`. A small non-zero rate would not fix the
clamp — aim could still momentarily address off-screen points — but it would
stop the crosshair PARKING off-screen, which is the actual complaint. One line
to try, at the cost of the "keeps it where you put it" feel the reference has.

Two fuller fixes, if the probe is not enough:

1. **Reframe `aim` as SCREEN space** (preferred). Convert through the forward
   map when computing weapon angles and the fire ray. "You can only aim where
   you can see" becomes structural rather than a clamp, and the reticle goes
   back to linear placement — `reticleNdc` disappears from the frame loop.
   Touches firing maths, so it wants its own pass.
2. **Clamp `moveAim` in screen space** and renormalise `deadzonePush` so peak
   turn rate is unchanged. Contained, does not touch firing, costs a little
   vertical aim range.

## Other things worth knowing

* **`k = 0` is an exact identity**, so the lab and bench pages (which never
  call `setLens`) are bit-identical to before, and the all-off parity path in
  `post-aa.ts` still holds.
* **Sharp upscale and fisheye do not stack** — the warp takes the 4-tap path
  regardless of the sharp flag, because sharp's fractional ramp assumes an
  axis-aligned uniform magnification the warp does not provide. The game page
  does not use sharp mode.
* **Anything that later tweens `camera.fov`** (an ADS or recoil tween — the
  comment at `game-main.ts:1578` anticipates one) must re-call
  `postAa.setLens(camera.fov, centerFovDeg)` in the same breath, or the blit
  keeps squeezing for the old frustum.
* `src/vfx/post-fx/barrel-pass.ts` is a SEPARATE radial warp on the WebGL path
  (`src/main.ts`). Untouched, and not duplication to consolidate — different
  renderer stack, and its map clamps out-of-range samples to black, which is
  the exact failure this one eliminates by construction.
* **Central-crop capture numbers on the game page have a discontinuity at this
  commit.** `scripts/wound-redness-capture.mjs` and friends measure a fraction
  over a fixed 30-70% central crop; with the centre magnified 1.73x that crop
  now covers a much smaller solid angle. Nothing GATES on those values (they are
  logged, and the slug/shorty gates are world-space and unaffected), but
  historical numbers are not comparable across this commit.
* **Adaptive resolution reads differently now.** `applySdfScale` drops the SDF
  march resolution under load and the lens then magnifies the centre of that
  reduced march 1.73x, so a dropped rung is more visible than it used to be.
  Not a defect — but the static captures will understate it.
* This worktree has an empty `node_modules/`, so imports resolve up to the main
  repo but path-relative binaries do not: `scripts/blob-measure.test.ts` fails
  here with `node_modules/.bin/tsx ENOENT`. Pre-existing, unrelated.
