# Cut cost: what the excess pass really costs, and what was taken back (2026-10-06)

Branch `claude/cut-cost`, off `claude/head-cleaving-effect-ef9515` (`37943f97`; the excess pass is `36b3a7c3`).
The task: the cut "excess" pass was recorded as costing +22 ms of frame time for three axe chops and +430 ms of cold
boot, neither investigated. Find where it goes and take it back without changing the look.

## Summary

1. **The +22 ms was never the cuts' cost.** It is a staging artifact of `scripts/axe-gate.mjs` scenario C: in the
   state the gate reaches C in, the "before" frame draws no body flesh at all, so "after minus before" is the whole
   torso at 0.9 m plus the cuts. With the body in both frames, three chops cost **about 4 to 5 ms** on a fresh ring
   zombie (4.8 ms, IQR 4.2 to 5.2, on the quietest read) and about 6.5 ms on the gate's own zombie.
2. **What the pass added is small in milliseconds and clear in the counters.** Timing could not separate the tree before
   the pass from the tree after it on this machine today (both read +3 to +8 ms per boot). The march's own counters
   can: the near-wound zone covers 2.7 times the pixels, the chops' extra prim folds are 2.8 times as many, wound rows
   are up 15 to 22%.
3. **Where the 4.8 ms goes** (fresh zombie, quiet read): the near-wound zone carries 59% of it, and most of that is the
   **organ fold** (41% of the whole). The field's noise (fine jag and pinch together) is a fifth at most, on one
   loaded read. The mask's noise is not measurable, and the per-ray wound list changes nothing. The table is below.
4. **Kept, two commits** (`11325bf1`, `503b4646`): three exact early exits in the cut's row and mask (the noise and
   the lip are read only where they can change the result) and a soft near zone for cuts (the organ fold runs in a cut's column only under a
   carve that raised the field). Noise reads fall 92 to 96%, organ-prim evaluations 78 to 80%. On the float march
   target the depth of every texel is unchanged and 243 to 279 texels differ in colour by at most 1.2e-5. Frame time:
   **about -0.5 to -1.0 ms of 4 to 5 ms on the fresh zombie, -2.2 ms of 6.5 ms on the gate's zombie.**
5. **The big lever is not in the cut code.** The owner decided on 2026-10-06 that organs become mesh ("they aren't
   even really that visible or noticeable atm"); that takes the organ fold out of the default game's march for every
   wound, craters included. It is its own task.
6. **The +430 ms of cold boot is not there.** The pass's commit against its own base, two quiet interleaved pairs:
   `drawOnce` 1673 / 1665 ms against 1810 / 1661 ms. Neither the pinch nor the mask's noise moves it, and neither does
   this branch's change.

## The measurement trap: axe-gate scenario C

The gate reaches C after K, and K thaws the ring for 3 + 3 + 3 + 45 frames with the player at K's zombie. During a thaw
a body outside the player's view is not in the visual set, so its march view keeps the pose it was last drawn in. The
gate then freezes, moves the camera to C's zombie (the fifth of the room, 17) and reads "before". Frozen ticks do not
refresh that view, so the flesh is not in the frame: only the zombie's shadow and its mesh skull are. The chops
re-upload the body's wounds, which re-uploads its view, and the body appears.

| Read | Image | Body texels (march census) |
| --- | --- | --- |
| The gate's "before" | [`gate-c-before-no-body.jpg`](gate-c-before-no-body.jpg) | 0 hits on the walk; HUD "bodies 5/23" |
| The gate's "after" | [`gate-c-after-3-chops.jpg`](gate-c-after-3-chops.jpg) | 59,884; HUD "bodies 7/23" |
| "Before", after one thawed step of no sim time with the camera in place | [`synced-before-with-body.jpg`](synced-before-with-body.jpg) | 59,884 |

Reproduced three ways on the tree as it was (`37943f97`):

| Run | Before | After 3 chops | Delta | Load |
| --- | --- | --- | --- | --- |
| The full gate (`axe-gate.mjs`, C) | 21.4 / 25.5 ms | 42.7 / 42.8 ms | +19.3 ms | 5 at the start; 57 by the end (not quotable) |
| `cut-cost.mjs`, the gate's staging (`zi=4,thaw=54`), no body before | 16.7 ms | 34.4 ms (34.0 to 34.9) | +17.7 ms | 3.3 to 3.6 |
| The same, body present before (`sync=1`) | 25.9 ms | 32.4 ms (29.9 to 34.8) | +6.5 ms | 3.3 to 3.6 |

So of the "+22 ms", about 10 ms is the torso itself. The excess pass's STATUS read 25.8 / 28.6 → 49.1 / 48.6 ms in
the same scenario; the axe notes' earlier "+4.3 ms" (14.3 / 20.1 → 24.4 / 24.2, with "the first baseline read is low,
systematic, not investigated") came from the same gate and is not comparable with either: nobody checked what its
"before" drew.

Two more things the gate's C does not control, found on the way:

- **It does not wait for the background crowd pipeline.** The boot log reads `warm {"gib":"ready","crowd":"compiling"}`.
  The frame is a different one while the crowd compiles: the whole-pixel prim census of the same view reads 3.67 M
  against 2.56 M once it is ready, and the float target's hash differs. `cut-cost.mjs` waits for `crowd: ready`.
- **The game ships the near-wound step multiplier at 1.0** (`game-main.ts` `GAME_WOUND_STEP`, the owner's verdict of
  2026-09-05), not the compiled 0.6 that `march/layout.ts` describes and the lab pages take.
  `__sdfGame.setWoundStep(0)` means "the compiled constant", so a harness that "restores" with 0 measures 0.6 from
  then on (+18% march steps here; it cost this investigation one run). Restore with `setWoundStep(1)`.

**The gate is not changed in this branch** (the head-split session is running it). Its C numbers should not be quoted
as a cost. The fix is one thawed step of no sim time after `look()` and a wait for the crowd warm; `cut-cost.mjs`
has both and is the cost instrument from here on.

## Method

`scripts/cut-cost.mjs` (new). The axe gate's C scenario, three torso chops H, R, L at 0.9 m, on the bare ring page,
pinned as `march-hash` pins it, 1280 × 800 window, 400 × 300 march target. Two stagings:

- **A, fresh:** ring zombie 13, straight after boot. 41,951 body texels.
- **B, the gate's:** zombie 17 after K's 54 thawed frames, then the zero-time thawed step. 60,388 body texels.

Three instruments, in order of trust:

1. **The march's cost census** (debug modes 13, 14 and 5, summed over the float march target): prims folded, wound
   rows folded, march steps, near-zone hit texels, inside-flesh (organ) prim evaluations. Exact and identical from
   boot to boot, whatever the load.
2. **In-page alternation.** One shader with every ablation behind a selector uniform (the `cutab=sel` build, in
   [`ablation-build.patch`](ablation-build.patch); the selector rides `perfCfg.x` as 1 + 2 × sel). Blocks of 10 to 24
   fenced frames alternate baseline, variant, baseline, ...; each variant block is scored against the mean of the
   baseline blocks either side of it, so a drift in load cancels. Reported as the median over 14 to 40 rounds with its
   interquartile range, wall clock (`timeDraws`) and the march pass's GPU timestamps. Selector 0 is an A/A control.
   Its limit: the baseline carries the selector's branches, so the shader is not the shipped text.
3. **Separate boots per variant** (`timeDraws(120)` × 2 or 3, before and after the chops), interleaved in one
   session. This is the gate's measure. On this machine today it does not resolve 2 ms: three Claude sessions and the
   owner's work shared the GPU, the load average ran from 3 to 80, and one build's two reads inside one boot differ
   by up to 7 ms.

From 12:45 the three sessions shared a lock (`/tmp/blud-gpu-timing.lock`, later with a ticket queue) so that only
one drove the GPU at a time. Loads are given with every number; rows above load 8 are marked and are not the ones the
conclusions rest on.

## What the pass added

Counters, three chops (after minus before the chops where a delta is given). `e3d4a897` is the tree before the pass,
run from a detached worktree with the same harness.

| Counter | Staging A, before the pass | A, after the pass | B, before | B, after |
| --- | --- | --- | --- | --- |
| Near-zone hit texels | 4,892 | 12,936 | 4,760 | 13,164 |
| March steps (walk), delta | +7,882 | +16,848 | +7,082 | +16,517 |
| Prims folded (whole pixel), delta | +164 k | +454 k | +159 k | +448 k |
| Wound rows folded (whole pixel) | 1.369 M | 1.649 M | 1.778 M | 2.053 M |

Timing, separate boots (delta per boot, three chops):

| Tree | Staging A | Staging B | Load |
| --- | --- | --- | --- |
| Before the pass | +7.6, +4.1 | +2.6, +4.6 | 4 to 6 |
| Before the pass, interleaved | +3.3, +7.0, +5.5 | +2.9, +12.6, +2.3 | 20 to 80 (not quotable) |
| After the pass | +4.2; +4.5, +4.9 | +6.5 (5.8 on the second round) | 3 to 9 |
| After the pass, interleaved | +5.8, +3.5, +7.9 | +6.2, +6.9, +10.5 | 8 to 67 (not quotable) |

Read: the two trees overlap. The counters say the pass roughly tripled the area that pays the near-zone costs; the
attribution below puts a number on that zone for the tree after the pass (2.8 ms of 4.8), so the pass's own share is
of the order of 2 ms at this view, not 18.

## Attribution (tree after the pass, before this branch's change)

In-page alternation; each row is the frame time change with that term switched off, three chops in view. Staging A at
load 3.2 is the cleanest session of the day; B was taken at load 10 to 20 and is given for the order only.

| Term switched off | A: wall ms (IQR), 14 rounds | A: march GPU ms (IQR) | B: wall ms (IQR), load 10 to 20 |
| --- | --- | --- | --- |
| **The cuts' whole field** (rows `continue`): the cost of three chops | **-4.8** (-5.2, -4.2) | -5.0 (-5.4, -3.1) | -7.9 (-9.1, -6.4); -9.2 (-10.6, -6.7) |
| The near zone (`near` never set by a cut) | -2.8 (-3.7, -2.2) | -2.8 (-3.9, -2.1) | -3.2 (-5.3, -1.7) |
| The inside-flesh fold (`applyBones`: organs) | -2.0 (-2.4, -1.4) | -1.7 (-2.4, -1.4) | -3.9 (-5.7, -1.7); -3.5 (-4.7, -2.5) |
| The near zone at its size before the pass | | | -2.2 (-3.2, -1.5) |
| The fine jag and the pinch (no noise in the field) | | | -1.6 (-3.7, -0.1) |
| Rows outside the slot's column skipped (a box test) | | | -2.1 (-2.9, +0.4) |
| The owner re-fold | | | -1.1 (-4.6, -0.1) |
| The lip | | | +0.8 (-0.5, +1.8): it costs steps to remove it (+9.6 k) |
| The mask's noise | | | +0.8 (-0.2, +2.7): not measurable |
| The mask's cut branch | | | -1.2 (-2.1, +2.3): not measurable |
| The d-aware reach (`setWoundExact`) | | | -0.4 (-2.4, +0.9): rows -14%, no time |
| The per-ray wound list (`setWoundList`) | see below | | |
| Selector 0 (A/A control) | +0.07 (-0.85, +0.55) at load 7 | -0.15 (-1.65, +1.32) | +0.45 (-1.0, +1.45) |

Per march step against per shaded pixel: the field side (rows, near zone, organs, re-fold) carries all of it that can
be resolved. The per-pixel side (`woundMask`, one call per shaded pixel, three cut rows each with a `noise3`) is
inside the noise of every session.

Half-length and kerf back at their values before the pass (0.09 m, 0.015 m) were not run as an alternation (they are
stamp constants, not shader text); the pre-pass tree above is that measurement, with the old lip, mask and reach, and
its counters are the ones to read.

**The per-ray wound list is not the missing piece.** On staging A, list on changes no counter (rows 1,182,855 either
way): a cut's reach sphere is 3.56 × its half-length + 0.31 m, about 0.84 m for the axe, so every ray's list holds
all three cuts. On staging B, list on reads 326 wound rows and no near texels: **the cuts are not drawn at all.** That
is a bug in the seam (off by default) on a body that has walked, not a saving; it is not investigated here.

**A 78% cut in organ work buys about a quarter of the organ fold's time** (below; the same holds for the noise).
The likely reason, not verified: the exits are per sample, and a fragment only saves what the fragments shaded with
it also skip; around three crossing slots most groups hold some sample that still needs the fold or the noise.
Whatever the cause, a term switched off for every fragment at once (the table above) is the ceiling, not the
forecast.

## The change (two commits)

`11325bf1` holds items 1 to 3 (the exits), `503b4646` item 4 (the soft near zone). `fields/wounds.wgsl.ts`,
`map-body.wgsl.ts`, mirrored in `cut-wound.ts`; text pins in `wounds.wgsl.test.ts` and `bones.wgsl.test.ts`; the
argument held on the CPU mirror in `cut-idle.test.ts` (26 tests, about 35 s). `627d4631` is the instrument,
`scripts/cut-cost.mjs`.

1. **The idle carve.** `carveTop` is the slot's carve with the jag at its ceiling (`cutJagTop`: the fine jag's
   amplitude plus the pinch's at this point of the slot, plus a 1e-3 slack for the noise's f32 rounding), read from
   the row alone. The noise only enters the wall term, which grows with it, so the carve never passes `carveTop`. The
   shader's quadratic `smax(d, carve, k)` is `max` to the bit once its arguments are 4 k apart, so where the running
   field stands that far above `carveTop` the row cannot raise it: the `noise3` and the two `hash13` are not read and
   the `smax` is not run.
2. **The idle lip.** The bump is a product of three gates, each exactly 0 outside its band (a smoothstep's clamp). It
   is computed only where none of them is.
3. **The idle band.** `woundMask`'s cut footprint is the noisy band times the gates. Where the gates' product is 0,
   or the point is past the band's outer edge at the noise's ceiling, it is 0 whatever the noise reads, and the noise
   is not read.
4. **The soft near zone.** A cut's column reports `near` = 0.75 (`CUT_NEAR`) where a crater's zone reports 1. Every
   "near a wound?" test reads > 0.5, so the march steps, the re-fold's trigger and the last-step rule see a cut's
   column exactly as before. `mapBody`'s inside-flesh fold (`applyBones`: organs, packed bones) asks more of a soft
   zone: it runs there only where some carve raised the field at the sample (`gWoundRaisers`). The rows it folds
   are contained in the flesh (`validate.ts` `checkBoneContainment`, bones and organs both), so they can win the hard
   min only where the field stands above the pre-wound flesh, and a lip only lowers it: the same identity the near
   gate itself rests on, applied to a zone that is mostly lip and open air. A crater's zone folds as before, so a
   body with craters and no cuts takes the old path.

The look constants, the slot, the lip, the mask and the reach are untouched.

### Before and after

Counters, three chops, per frame (identical on every boot):

| Counter | A before | A after | B before | B after |
| --- | --- | --- | --- | --- |
| Noise reads in `applyWounds` (walk) | 979,873 | 48,559 (-95%) | 1,229,291 | 48,545 (-96%) |
| Noise reads in `applyWounds` (whole pixel) | 1,415,714 | 111,431 (-92%) | 1,813,645 | 107,256 (-94%) |
| Inside-flesh prim evaluations | 869,704 over 19,878 texels | 189,224 over 7,810 (-78%) | 943,128 over 21,004 | 189,408 over 7,713 (-80%) |
| Steps, rows, prims, near texels | | unchanged | | unchanged |

The picture, on the float march target (tree before the change against the candidate build, same boot pins):

| Staging | Body texels | Texels differing in any bit | Largest colour difference | Depth | Hit set |
| --- | --- | --- | --- | --- | --- |
| A | 41,951 | 279 | 1.0e-5 | identical in every texel | unchanged |
| B | 60,388 | 243 | 1.2e-5 | identical in every texel | unchanged |

No texel differs by 1/255 (the largest difference is a 300th of that), so an 8-bit image of either is the same
image: [`ab-before-change.jpg`](ab-before-change.jpg) and [`ab-after-change.jpg`](ab-after-change.jpg) are staging B
after the chops, for the record. The exits are exact in the arithmetic (the tests hold that). The last-bit colour
differences were not isolated; they are taken to be the compiler's (the same expressions, now inside a branch). Every
differing texel is in the wound's own patch (x 160 to 239, y 101 to 173 of 400 × 300). On staging B the build with
the exits alone and the build with the soft near zone on top give the same hash of the float target (`a0a79df0`): the
soft zone moves no texel there, as an identity should.

Frame time, in-page alternation, the candidate against the tree before it (selector 14: the three exits and the
raise-gated fold together):

| Staging | Three chops cost | The change | Its parts | A/A control | Load |
| --- | --- | --- | --- | --- | --- |
| A, 14 rounds | 4.8 ms (4.2, 5.2) | **-1.0 ms** (-1.35, -0.65) | exits alone +0.4 (0.05, 0.85); raise gate alone -0.45 (-0.85, +0.2) | | 3.2 |
| A, 30 rounds | 3.7 ms (3.05, 4.7) | **-0.55 ms** (-1.1, +0.55); march GPU -2.0 (-3.1, -0.45) | exits -0.9 (-1.75, +0.7); gate -0.5 (-1.25, +0.35) | +0.07 (-0.85, +0.55) | 7.2 |
| B, 30 rounds | 6.5 ms (5.65, 7.35) | **-2.2 ms** (-2.85, -0.9); march GPU -1.9 (-3.4, -0.1) | exits -0.95 (-1.9, 0); gate -1.3 (-1.95, +1.55) | +0.45 (-1.0, +1.45) | 8.0 |

Read: the change takes back roughly a fifth of the chops' cost on the fresh zombie and a third on the gate's. The
parts do not resolve separately; the sum does on A's quiet session and on B (its whole interquartile range below
zero), and not on A's second session. These are reads of the selector build, whose selector 14 is the final code's
logic for a body that carries only cuts; the final build itself was compared by separate boots only, which did not
resolve it (one boot each at load 8 to 56).

## Cold boot

`scripts/boot-time.mjs`, a fresh Chrome profile and its own servers per boot, interleaved, the order reversed on
alternate rounds, `hash13`'s 0.1031 nudged to a unique nonce per boot (0.103600 to 0.103627; the file put back
after each). `drawOnce` is the first real march draw; `warmMs` is the whole warm-up, mostly the march pipelines'
cold compile. "Before" is `37943f97`; "no pinch" and "no mask noise" are that tree with one term's noise stubbed
(`cutab=nopinch`, `cutab=nomasknoise`).

| Session | Build | `drawOnce` ms | `warmMs` s | Load |
| --- | --- | --- | --- | --- |
| 2 (quiet) | Before | 1665, 1657 | 48.4, 47.1 | 3 to 11 |
| 2 | This branch | 1651, 1664 | 44.8, 45.1 | 3 to 6 |
| 2 | No pinch | 1683, 1644 | 43.4, 43.8 | 4 |
| 2 | No mask noise | 1660, 1647 | 43.3, 44.1 | 3 to 4 |
| 1 (another session on the GPU) | Before | 2857, 2378 | 52.8, 57.0 | 4 to 6 |
| 1 | This branch | 2572, 1704 | 78.7, 49.8 | 5 to 6 |
| 1 | Before the pass (`e3d4a897`) | 2123, 2040 | 45.9, 45.1 | 8 to 10 |
| 3 (quiet) | Before the pass (`e3d4a897`) | 1810, 1661 | 42.1, 43.4 | 4 to 5 |
| 3 | The pass (`36b3a7c3`) | 1673, 1665 | 40.4, 40.6 | 4 to 5 |
| 3 | Before | 1692, 1691 | 44.1, 57.5 | 4 |
| 3 | This branch | 1673, 1759 | 45.7, 46.5 | 4 to 5 |

Read:

- **The pass's "+430 ms" is not there.** Session 3 boots the pass's own commit against its base, the pair the
  figure was taken on: `drawOnce` 1673 / 1665 ms against 1810 / 1661 ms, warm-up 40.4 / 40.6 s against 42.1 / 43.4 s.
  The pass is not slower on either number. The recorded +136 to +936 ms over four pairs (load 4 to 6) is the size of
  what a busy machine does to `drawOnce`: session 1's builds read 1704 to 2857 ms with another session on the GPU.
- **`drawOnce` does not depend on the cut's noise.** On session 2 all eight boots read 1644 to 1683 ms, whatever the
  build: with the pinch stubbed, with the mask's noise stubbed, before and after this branch's change.
- **This branch's change costs nothing at boot.** Over sessions 2 and 3, `drawOnce` 1651 / 1664 / 1673 / 1759 ms
  against 1665 / 1657 / 1692 / 1691 ms before; warm-up 44.8 / 45.1 / 45.7 / 46.5 s against 48.4 / 47.1 / 44.1 / 57.5 s.
- **The warm-up does not resolve the noise terms either.** Stubbed, they read 43.3 to 44.1 s on session 2 against
  47.1 to 48.4 s for the tree before; but that tree read 44.1 s on session 3 (and 57.5 s on the next boot). Four boots
  a build say only that no term costs more than a few seconds of cold compile, if anything.

## Rejected, and why

| Candidate | What was found | Verdict |
| --- | --- | --- |
| Cheaper noise for the mask (one tap, or the jag's) | The mask's noise is not measurable in any session (+0.8 ms, IQR -0.2 to +2.7, when removed). Its idle exit is kept because it is exact and free. | Nothing to win; no look risk taken |
| Dropping the pinch's `hash13` calls | The field's whole noise (fine jag + pinch) is about 1.6 ms at most, and the idle carve already removes 92 to 96% of its reads | Not needed |
| A tighter reach sphere, or a capsule / box per cut, before the row's loads | A box test after the frame is known reads -2.1 ms (IQR -2.9 to +0.4), overlapping the idle carve (it skips the same noise). What is left to skip is one texel load and the lip's arithmetic. A test before the loads cannot be exact: a cut's `near` column runs outward without limit (the approach needs it, see below), so a sphere that bounds the slot drops `near` for samples the march today treats as near. | Not taken: the gain left after the exits is inside the noise, and it is not exact |
| Capping the near column's height above the skin | Unsound at any height: a full sphere step from just outside the cap can land inside the lip (up to 9 mm proud of the pre-wound skin), which the hit test accepts as a hit on the old skin. The column has to reach the ray's first samples. | Rejected |
| The near zone back at its size before the pass (5.4 kerfs, no reach past the tips) | -2.2 ms (IQR -3.2 to -1.5) on B, but the zone is the lip's 3-sigma footprint: narrowing it leaves lip outside the zone. With the soft near zone the zone's main cost (the organ fold) is gone from most of it anyway. | Rejected (look and soundness), superseded |
| Lower `AXE_CUT.halfLen` or the kerf | The approved look | Not considered |
| The per-ray wound list | No effect on A (every list holds every cut); drops the cuts on B | Not the missing piece; a seam bug |
| Gating the organ fold on raised field for craters too | Same identity, and craters' near zones (2 × depth) are also mostly not raised. It changes what every wounded body evaluates, outside this task's scope, and organs-to-mesh removes the fold altogether. | Left for the organ task |

## Follow-ups

1. **Organs to mesh** (the owner's decision, 2026-10-06; spawned as its own task). The organ fold is about 2.0 ms of
   the 4.8 ms three chops cost here, 870 k organ-prim evaluations a frame, and every crater pays it too. With organs
   out of the field the default game never calls `applyBones`.
2. **`axe-gate.mjs` C**: add the zero-time thawed step and the crowd-warm wait, or point the cost line at
   `cut-cost.mjs`. The head-split gate's cost scenario should be checked for the same two things.
3. **`setWoundList` on a walked body draws no cuts** (staging B). Off by default.
4. **A seam that restores the page's own wound step** (`setWoundStep(0)` is the compiled 0.6, the game ships 1.0).

## Reproduce

```
export LAB_VITE_PORT=5247 LAB_CDP_PORT=9247 LAB_TMP=.lab-tmp; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
# the gate's artifact, and the honest read beside it
VARIANTS='|zi=4,thaw=54;|zi=4,thaw=54,sync=1' ROUNDS=2 node scripts/cut-cost.mjs 5247 9247
# the attribution (needs ablation-build.patch applied: git apply docs/dev-notes/2026-10-06-cut-cost/ablation-build.patch)
SEL=0,14,7,13,8,9,5 SEL_ROUNDS=30 SEL_K=10 VARIANTS='cutab=sel|zi=0' ROUNDS=1 node scripts/cut-cost.mjs 5247 9247
```

The patch is the measuring build as it stood before the final code was cut out of it (it applies to `37943f97`, not
to this branch's head): the `cutab=` URL switches, the selector build, and the candidate behind `cutab=idle`.

## Verification (on `503b4646`'s tree)

| Check | Result |
| --- | --- |
| `npx vitest run march-golden -u` | 1 snapshot updated per commit (`APPLY_WOUNDS`, `WOUND_MASK`, then `MAP_BODY`, and the joined helpers) |
| `node scripts/march-hash.mjs`, three modes, against the tree before run in the same session | all six pins unmoved: default `d7392d52` / `76bd51aa`, crowd `0c71e712` / `bf6836cd`, per-body `470ff0b3` / `f618070e`. The wounded pins are crater bodies: they take the old path to the bit. |
| `node scripts/compile-census.mjs 2` | `phase=ready` twice, `uncapturedCount` 0, no device loss; the march fragment module is 325.7 KB |
| `npx vitest run src/lab/sdf-zombie scripts/lib --exclude '**/cut-wound.test.ts'` | 526 files, 7591 tests passed, 1 skipped |
| `npx vitest run cut-wound` | 49 / 49 (237 s). Every Lipschitz sweep is as it was: the mirror's `cutCarve` and `cutLip` are untouched, and the exits return the same field. |
| `scripts/cut-wound-gate.mjs` (`OUT` in scratch) | 30 checks, 0 failed. Its own cost line: three rod cuts at 0.6 m, 27.6 / 27.3 → 31.4 ms, +3.95 ms (load 4) |
| `scripts/axe-gate.mjs` | 27 checks, 0 failed. Its C line read 21.2 / 24.4 → 38.7 / 37.5 ms, "+15.3 ms": the artifact above, unchanged in kind (the tree before read 21.4 / 25.5 → 42.7 / 42.8 under a load that ended at 57) |
| `scripts/head-split-gate.mjs` | 80 checks, 0 failed |
| `npx tsc --noEmit` | only the known `node:crypto` error |

Not done: no playtest by the owner (nothing for him to see: the picture is the same to 1e-5), and the thin-limb,
far-skin, silhouette and lid invariants were not re-derived, only re-run (`cut-wound.test.ts` and the cut-wound gate
hold them, and the field they test is the same field).
