# Fire render cost: measuring pass (2026-11-16)

Branch `claude/burning-body-effect-optimization-4795c0`, after the burn flail and burn death. Measurement only: no
source file changed. Nothing here is optimised yet.

## What was asked

Find where burning bodies cost render time, before proposing any optimisation.

## The earlier "+7 ms on the body march" was already explained

The 2026-09-22 census showed `sdf:march` 14.9 -> 21.7 ms with fire. The same week's fire study
([WOUND-COST.md](../2026-09-21-multiscale-march/WOUND-COST.md), "it is the PANIC, not the fire") had already
attributed it: the old burn behaviour made zombies charge the pinned player, so they filled the screen. Fire shading
added nothing. This pass re-checks that on the current branch.

## Method

`scripts/sdf-game-melee-bench.sh`, arena, the boot cast walked to the player and frozen, one page, frame cap off.
`igniteAll()` lights all 23 bodies in the room; 5 are on screen, nearest 1.24 m.

- `thaw`: 45 sim frames, no fire (the movement control).
- `firecalm`: the same 45 frames, burning, `setBurnBehaviour(false)` (same motion as `thaw`).
- `fire`: burning with the new panic behaviour.
- Legs: `fvOff` (`setFireVolume({steps:0})`), `fvBodies8` (`maxBodies: 8`), `charOn` / `charOff`
  (`setUniformAll('burnCfg', 2, 1 | 0)`: every body fully charred through the per-view ramp).

**Load.** Another session was removing a worktree during this pass. Two runs at load 8 to 96 were discarded. The
numbers below are from runs at load 3.2 to 4.1 (control) and up to 5.0 (char), which is at or just over the bench's
own 4.0 limit: treat differences under about 0.5 ms as noise. The `fire` run was at load 6.8, so only its counts
are used. A re-run on a quiet machine is still owed before any before/after claim.

## Results

Control run ([control-run.md](control-run.md)), ms p50, ship leg unless named:

| | clean | thaw (no fire) | firecalm | firecalm, volume off | firecalm, 8 bodies in volume |
| --- | ---: | ---: | ---: | ---: | ---: |
| frame | 7.03 | 7.17 | 9.14 | 7.78 | 11.82 |
| `post:fire-march` (flame volume) | 0 | 0 | 1.51 | 0.03 | 4.22 |
| `compute:sdf-march` (bodies) | 1.20 | 3.11 | 3.31 | 3.15 | 3.25 |
| `cpu:draw` | 3.7 | 3.8 | 5.2 | 6.1 | 7.3 |
| `cpu:phase:crowd-sdf-inner` | 2.5 | 2.9 | 3.4 | 4.1 | 6.2 |
| `cpu:phase:draw:effects-tail` (cards, volume feed) | 0.3 | 0.3 | 0.8 | 1.0 | 0.7 |
| `cpu:tick` | 0.7 | 0.8 | 0.9 | 1.1 | 0.7 |

(The clean `compute:sdf-march` of 1.20 against thaw's 3.11 is not understood; the comparison that matters is thaw
against firecalm, which share their motion.)

1. **Burning adds about 2.0 ms of frame** for 23 lit bodies (7.17 -> 9.14).
2. **The flame volume is the largest part: 1.5 ms** at the shipped cap of 4 bodies, and it removes 1.4 ms of frame
   when switched off. It scales worse than linearly with bodies: 4.2 ms at 8.
3. **Burn shading adds nothing measurable to the body march** (3.11 -> 3.31, inside the noise). Same answer as
   September.
4. **Fully charred bodies cost nothing measurable either** ([char-run.md](char-run.md)): march 3.46 (off), 3.49
   (on), 3.44 (off again); in the clean phase 3.03, 3.12, 3.14. This is the skeleton show-through path (one bone
   probe plus four taps per revealed pixel). Not confirmed on screen that the char applied to every crowd body, so
   this is "no cost seen", not "proven free".
5. **CPU: about +1.4 ms of `cpu:draw`, noisy** (the volume-off leg read higher than ship, so the error is near
   1 ms). The part that is clearly fire is `effects-tail`, +0.5 ms; it read +1.1 and +1.4 in the two loaded runs.
6. **With the new panic, burners leave the screen.** Coverage 22.2 % -> 8.1 % and body hits 26,591 -> 9,767 after 45
   frames of panic ([panic-run-loaded.md](panic-run-loaded.md); counts, so the load does not matter). The old
   behaviour's march spike is gone because the burn flail makes them flee.

## Where the CPU time goes (read from the code, not timed per line)

`game-burning.ts`, every frame, for every body with `burn > 0` or `dying` (23 here), with no visibility test:

- `step`: `fireCapsules(a.posed())` and `capsuleVelocities` build fresh arrays for all 23, but `updateVolume` only
  ever uses the nearest `maxBodies` (4).
- `updateCards`: `limbAnchors`, `standingFloor`, and two new frame objects per body (`cardFrames`, `lodFrames`),
  then both card pools place and write quads for every body, including those behind the camera.
- `updateVolume`: packs one world AABB around every body in the volume.

## Where the flame volume's time goes (read from the code)

`fire-volume.wgsl.ts` marches `steps` (24) across ONE box holding all the volume's bodies (`boundsMin/Max`). Bodies
spread over a room make a large box, so most steps land in the empty space between them and the flame gets fewer
samples where it is. That fits the worse-than-linear growth from 4 to 8 bodies, but it is not yet measured directly.

## Candidates, in the order I would try them

| # | change | expected | cost / risk |
| --- | --- | --- | --- |
| 1 | Flame volume: march each body's own interval (per-body boxes or a screen tile list) instead of one shared box | The largest GPU saving, and better flame quality per step; should let `maxBodies` rise | Shader change in the fire pass only (not the body march, so no long cold compile); needs an owner look |
| 2 | Build fire capsules only for the bodies in or near the volume set | Removes most of the per-tick fire CPU for a crowd | Small; the hysteresis set must still get capsules a frame early |
| 3 | Cull card and anchor work for bodies outside the view or past a distance | Removes most of `effects-tail` for a crowd | Small; a body re-entering view must not pop |
| 4 | Reuse the per-body arrays and frame objects (no per-frame allocation) | Less garbage, steadier frame times | Small, mechanical |
| 5 | Place flame cards in the vertex shader from uploaded limb anchors | Takes card placement off the CPU; carries to the Rust + wgpu port | Larger; not checked whether the card material can read the crowd's per-body buffer |
| 6 | Scissor the fire pass to the screen rectangle of its bodies | Saves the pass's fixed cost when fire is small on screen | Small; overlaps with 1 |

Not worth doing on this evidence: any change to burn or char shading in the body march.

## Still to do

- Re-run the control on a quiet machine (load under 4, ideally under 2).
- Measure candidate 1's premise directly: the same 4 bodies close together against spread out.
- Confirm on screen that the `charOn` leg chars crowd bodies.

## Update, same day: candidate 1's premise was wrong; the real cost was the cull sphere's lag pad (FIXED)

Reading `fire-volume.wgsl.ts` showed the march already culls capsules per ray, marches only the union of the crossed
spheres' intervals and skips empty space. The "one shared box" explanation above is wrong.

What cost the time: each capsule's cull sphere was padded by `curlStrength + lagMaxM` (0.07 + 0.6 m) whether or not
the body moved. Every sphere was over a metre across, so a ray near a body kept all of that body's capsules (up to
16), and a ray through two overlapping bodies overflowed `FIRE_RAY_CAPS` (32) and fell back to looping over every
capsule in the scene at every sample.

**Premise test** (old code, `setFireVolume({lagMaxM: 0})` leg; load 10, so ratios only): flame march 2.47 -> 1.12 ms
at 4 bodies, 8.47 -> 1.71 ms at 8.

**The change:** the pad is now per capsule, `min(|vel| * lag * sheetLength, lagMaxM)`, which is the bound on what
`fireLag` can actually displace that capsule's flame. A still body pads by nothing. The flame field is unchanged.
The marched interval is shorter and `steps` is the same, so flames are sampled more finely than before; frames are
not pixel-identical.

**After** ([after-run.md](after-run.md), load up to 5.6; the flame march is a GPU span and read the same in every
leg), `post:fire-march` ms p50, panic off:

| bodies in the volume | before | after |
| --- | ---: | ---: |
| 4 (ship) | 1.51 | 0.67 |
| 8 | 4.22 | 0.97 |

The `lagMaxM: 0` legs now read the same as ship (0.66, 0.95), as they should for bodies standing still. Before and
after frames: [before-firecalm.png](before-firecalm.png), [after-firecalm.png](after-firecalm.png). They are
different frames (pose and flame phase differ), so they show the look is of the same kind, not that it is identical.

Not measured: panicking (running) bodies, whose pad is their real trail (about 0.2 m at panic speed, by the
formula), and a quiet-machine run.

Open, seen in both frames: the far body's flame has a hard rectangular edge. Not caused by this change; not looked
into.

With the 8-body cost now under the old 4-body cost, raising `maxBodies` from 4 is an owner call.
