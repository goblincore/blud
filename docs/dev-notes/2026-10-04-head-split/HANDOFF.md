# The axe and the head split: final handoff (2026-10-05)

The feature is built: the axe (part A), the cut excess pass, and the head split (part B, tasks B1 to B9). This file is
what you need to pick it up cold. The task-by-task record, with every measurement, is in [`NOTES.md`](NOTES.md) and in
git (`git log --oneline 47db2bec..HEAD`).

**Branch:** `claude/head-cleaving-effect-ef9515` (worktree `.claude/worktrees/head-cleaving-effect-ef9515`). It was
fast-forwarded from `claude/head-explosion-effect-d6231e` at `e04577ce` and carries everything since.
**PR:** goblincore/blud#31, ready for review as of 2026-10-06. Its branch is `claude/head-explosion-effect-d6231e`
on the remote; it was fast-forwarded to this work (`claude/head-cleaving-effect-ef9515`) on 2026-10-06. The local
worktree of that name may still sit at `e04577ce`: pull it before working there.

**The wet film is settled:** shown `look/14-wet-variants.jpg`, the owner chose C on 2026-10-06 ("I think C is
fine"), the boldest of three, and C ships (`SPLIT_SHADE.glisten`: `gain` 4.5, `pow` 28). The quieter B and the
grazing-only A are recorded as alternatives (the dial table below; NOTES, "The owner's pick").

| Document | Path |
| --- | --- |
| Spec | [`docs/superpowers/specs/2026-10-04-axe-and-head-split-design.md`](../../superpowers/specs/2026-10-04-axe-and-head-split-design.md). §9 is "as built" for the axe, §10 for the head split. §5 is superseded in part by §10. |
| Plan A (the axe) | [`docs/superpowers/plans/2026-10-04-axe-part-a.md`](../../superpowers/plans/2026-10-04-axe-part-a.md). Done. |
| Plan B (the head split) | [`docs/superpowers/plans/2026-10-04-head-split-part-b.md`](../../superpowers/plans/2026-10-04-head-split-part-b.md). Done; its status block lists where the build diverged. |
| Head split notes | [`NOTES.md`](NOTES.md); photos in `b4/` to `b7/`, `gate/` and `look/`. |
| Axe notes | [`docs/dev-notes/2026-10-04-axe/NOTES.md`](../2026-10-04-axe/NOTES.md) |
| Cut excess pass | [`STATUS.md`](../2026-10-04-cut-excess/STATUS.md) and [`compare/NOTES.md`](../2026-10-04-cut-excess/compare/NOTES.md) |
| Cut-wound handoff (house rules) | [`docs/dev-notes/2026-10-03-cut-wounds/HANDOFF.md`](../2026-10-03-cut-wounds/HANDOFF.md) |

## What exists

Paths are under `src/lab/sdf-zombie/` unless they start with `scripts/` or `docs/`.

**The axe** (`webgpu/axe-swing.ts`, `webgpu/axe-strike.ts`, `webgpu/game-axe.ts`). Weapon slot 7: an H / R / L chop
combo. Each chop that lands stamps a cut wound along the blade line. It shares the flail's 1.8 m reach, and its light
list with the flail (`webgpu/viewmodel-lights.ts`). The axe model is a primitive built in code. The owner: it is
not important, and he will do a Blender pass later.

**Head chops** (`webgpu/axe-head.ts`). Pure, per actor: the count, the axe's opening table, the kill's kick, and two
rules. `chopOnHead`: only a chop whose nearest prim is head flesh is a head chop. `headChopCut`: what a head chop
stamps (the split's faces when it opens the head, its own cut on outer skin, nothing on a cut face or through the
gap). Head chops kill by count (3) and do not feed the body's collapse meter.

**The cut excess pass** (`cut-wound.ts`, `webgpu/march/fields/wounds.wgsl.ts`; commit `36b3a7c3`). The owner found the
cuts too short and too tidy. Now: the axe's cut half-length is 0.15 m (was 0.09) and its kerf 0.025; the rod's sweeps
are 1.4× longer with `maxLen` 0.45 and kerf 0.02. Every cut's kerf is capped at 0.3 × its half-length
(`kerfPerHalfLen`), which keeps the Lipschitz maxima at 1.7 to 2.0 against the 2.2 bound, GPU noise included. Ends
taper and break up; walls are rougher; lips rise 8 to 9 mm (from 2.9); the wet band is blotchy; there is more blood.
The far-skin, thin-limb, silhouette and lid invariants hold. Before and after sheets are in
`docs/dev-notes/2026-10-04-cut-excess/compare/`; the raw photos (38 MB) are untracked in the other worktree's
`photos/` and should not all be committed.

**The split's rules** (`head-split.ts`, pure; start with its header). Everything the split is: the presets (`middle`,
`face`), the preset choice from the chop's blade plane, the angle spring, the world-space description `SplitWarp`, THE
SPLIT FIELD (`splitField`: the union of three rigid capped pieces, continuous and 1-Lipschitz), the maps between the
open head and the closed one (`unwarpPoint`, `warpPoint`), the cut faces' segments, the bounds rules, the range rule,
the wobble, and the skull's rule. Spec §10.1 explains the field. A one-sided split costs two field evaluations.
`HeadFrame.radius` is the skull's largest semi-axis (0.137 m on the zombie, with 0.037 m to spare inside `rho`);
`choosePreset` takes the head's half-width instead.

**The CPU mirror** (`validate.ts` `sdBody`, `damage.ts` `unwarpHit`, `cut-wound.ts` `unwarpCutSeg`). `sdBody` honours
`body.split`, so every strike, shot and trace sees the opened halves; with no split it is unchanged to the bit. Every
stamp un-warps its hit first, because wounds live on the closed head, where the GPU reads them: pellet, slug, axe,
rod, the flail's body crater, explosions and the `stampWoundAt` seam.

**The leaf** (`webgpu/game-head-split.ts`). Owns each actor's `SplitState`, steps the spring and the wobble once a
frame (before the actors step), and installs the actor's split hook. THE POSE IS THE ONE SOURCE OF THE SPLIT: the
hook's answer rides `posed().split`, and nothing else keeps a copy. The hook answers null for a head that is gone, a
body that is tearing, or a closed state. Zombies only. Head damage and the split are mutually exclusive: a head the
head-damage leaf holds refuses to split, and that leaf declines a head this one has open. The split stays open on the
corpse.

**The GPU record and the field** (`webgpu/crowd-records.ts`, `webgpu/march/map-body.wgsl.ts`). `REC_VEC4S` is 21:
lanes N 17 = (n, thetaP), H 18 = (h, d0), A 19 = (a, thetaM), R 20 = (r, 0, 0, 0). A closed, torn or reused view
writes zeros. `loadInstance` sets `gInstSplitOpen`, the only open test. `mapBody` wraps the slot body in THE PIECE
LOOP: three pieces as `vec3 (cap, theta, id)`, sorted by unrolled compare-swaps, with the exact early skip.
**`webgpu/march/map-body-split-twin.test.ts` is a HAND TWIN of that WGSL**, compared with `splitField` (largest
difference 3.5e-16). Edit both together.

**Bounds and range** (rules in `head-split.ts`: `splitFrame`, `splitHolds`, `splitHoldBall`, `splitBound`,
`splitSphereImages`, `splitDrawDistance`; used in `webgpu/zombie-gpu.ts`, `webgpu/shell-hull-outer.ts`,
`webgpu/occluder-hull.ts`). The proxy box, the cluster row, the tile groups and both hulls follow the open head. Bounds
use `rho`, not `r`. The per-ray wound list is off for an open slot. **Past 12.7 m a split is drawn closed** and it
reopens inside 0.9× that (11.4 m): beyond it the march's accept reach could draw the region shell as a false surface.
`view.splitDrawn` is what the record really carries; anything else that draws the head must follow it, not the pose.
The shipped accept numbers live in `webgpu/game-march-accept.ts`, and a test holds them under the margin.

**Shading after the hit** (`webgpu/march/body/blocks/post/split-hit.wgsl.ts`, `webgpu/march/body/blocks/post/cut-face.wgsl.ts`).
`split-hit` derives the hit's split state once: `splitTheta`, `pS` (the un-warped point), `splitQ`, `faceCentre` /
`faceQuat`, `splitIn`, `cutFace`, `cutDepth`. Everything anchored to the body reads `pS` (the rest anchor, wound and
char masks, the face sheet and eye glow, burn bone taps, wetness, motion); lighting stays at the world point. Closed
slots and piece 0 never run a rotation, so closed bodies are bit-identical. Analytic normals fall back to finite
differences inside an open region (`ngReason` 8, analytic mode only). `cut-face` holds the cut faces' look: wound
interior by depth, wet all over. It also declares `cutKeep` (0 today): the share of a cut-face texel that is not
flesh, which the mottle, the gore and the wound wetness leave alone.

**The skull mesh** (`webgpu/skeleton-spike/mesh-split.ts`, `webgpu/skeleton-spike/mesh-renderer.ts`; rule in
`head-split.ts`: `skullSplitOf`, `skullPieceAt`, `skullWarpPoint`, `skullPieces`). The bone opens LESS than the flesh,
in stages: a crack, a wider crack, split. It is drawn as per-piece instance copies in their own batches, clipped at the
un-turned point along a ragged fracture edge that both halves share (one `jag` table for the WGSL and its TypeScript
twin), two-sided with a dark inside and a cut-bone rim. The stage only advances (`SplitState.stage`), so a kick or a
wobble swings the bone in proportion and never steps it. Driven from `view.splitDrawn`. Closed heads draw as before.

**The wobble** (`HEAD_SPLIT.wobble` in `head-split.ts`; driven from the leaf). Each turning half has its own offset
(`SplitState.wobP` / `wobM`): a damped spring driven by the acceleration of the split's mass point, with hard limits.
It reaches the renderers only through `SplitWarp.thetaP` / `thetaM`. A frozen actor rests at exactly zero offset. Its
parameters are passed in (`WobbleParams`); nothing writes to the constant.

**The wet film** (`webgpu/march/body/blocks/light/split-glisten.wgsl.ts`; numbers in `SPLIT_SHADE.glisten`).
Highlights over an open split's raw surfaces (the pit and the caps), off a normal of its own. It keeps to the opened
head: above the hinge plane and inside the hold ball, so a chest wound on a zombie whose head is open does not take
it. Nothing outside an open split's region changes. The deferred surface entry does not carry it; the game's default
entries do. It does not walk the light list, and must not from inside its gate (follow-up 1).

**Seams** (`__sdfGame.…`; `webgpu/game-seams-fire.ts`, `webgpu/game-seams-skeleton.ts`):

| Seam | What it does |
| --- | --- |
| `axe()`, `axeSwing()`, `axeChop(id, side, target?)` | the axe's state; a click; a chop on one actor's torso or head |
| `headSplit(id)` | an actor's split state |
| `forceSplit(id, preset, sides, offset, angleFrac)` | opens a split directly (for tuning, and for `face`) |
| `headSplitDrive(id, accs)` | feeds the wobble a scripted list of accelerations, one a tick (the gate's J) |
| `skullSplit({ follow, zigAmp, zigLen, chipAmp, chipLen, inside, rim, rimWidth, … })` | the skull's look, live; `follow: null` puts the table back |
| `skullDrawn(id)` | an actor's split skull copies, each with the matrix it is drawn with |
| `meshSkeletonShow({ bones, eyes })` | hides or shows the bone meshes and the eyes (a shown / hidden pair tells bone pixels from flesh) |
| `actorWounds(id)` | each wound, with `headSlot`, `headRegion` and a cut's `dirWorld` |

## How to run and verify

**Playing it.** The axe is weapon slot 7 (`Digit7`; click to chop), always owned in the dev harnesses. The gates use
the bare ring page, `/sdf-game.html`. While agents are editing this worktree, serve a playtest build from a snapshot
(a `git archive` of the chosen commit) or from a clean checkout, not from the worktree: the dev server reloads the
page on every source edit. **Port 5273 is the owner's: never use or stop it.**

**The three gates.** Headless capture only. Each needs its own servers, which come from `scripts/lab-servers.sh`; that
needs bash, not zsh. Use ports 5241 / 9241.

**Two sessions at once.** `lab-servers.sh` reuses whatever answers on its ports, so a second session on 5241 / 9241
drives the first one's vite, which serves the other worktree. If another session may be live, take a private pair
(5247 / 9247 were used on 2026-10-06) and check after `lab_servers_up` that `$lab_started_vite` and
`$lab_started_chrome` are both set.

```bash
bash -c 'export LAB_VITE_PORT=5241 LAB_CDP_PORT=9241; . scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up
  node scripts/head-split-gate.mjs 5241 9241
  OUT=.lab-tmp/axe-gate node scripts/axe-gate.mjs 5241 9241
  OUT=.lab-tmp/cut-wound-gate node scripts/cut-wound-gate.mjs 5241 9241'
```

| Gate | Checks (as of 2026-10-05) | Notes |
| --- | --- | --- |
| `scripts/head-split-gate.mjs` | 80 | Scenarios S, W, K, O, L, F, M, R, A, H, J, B, T, C. Five boots. `ONLY=S,K` runs a subset (W and K need S). C holds the depth guard and its positive control. |
| `scripts/axe-gate.mjs` | 27 | A, D, K, S, C, T. The 26th and 27th are the depth guard's positive control and the guard. |
| `scripts/cut-wound-gate.mjs` | 30 | |

- **Photos.** The head-split gate writes its sheets to `.lab-tmp/head-split-gate`; `SHEETS=1` rewrites the tracked
  ones in `gate/`. The other two write into TRACKED folders by default (`docs/dev-notes/2026-10-04-axe/gate`,
  `docs/dev-notes/2026-10-03-cut-wounds/gate`): pass `OUT=` as above, or you will have modified PNGs to put back.
- **What the head-split gate measures on.** The float march target (`__sdfGameDebug.readMarchTarget`), not
  screenshots. Each capture is two reads, and their difference is checked. Its boot is pinned as `march-hash` pins it
  (the dynamic-light clock, the probes' afterglow, the field interlace), so every number is the same in every run.
- **Every scenario has a check that was shown to fail** under a breaking change (NOTES lists each mutation).
- **Its expectations are derived from the live tuning constants** (`HEAD_SPLIT`, `AXE_HEAD`, the follow table), so a
  retune moves them with it. What a retune can still trip: the gap line needs the cut faces to reach the head centre's
  height; `F_MOVED_MIN`; `O_BEARING` must still land a one-sided hit; and the two unit tests that hold the spring's
  overshoot and the table's crack / split.
- **After a thaw, wait for the wobble.** The gate calls `restWobble` before it measures a rest angle. A new scenario
  that thaws must do the same. Let the spring settle between chops.
- **The depth guard** (`scripts/lib/march-depth-guard.mjs`, with unit tests; the head-split gate runs it on every
  capture, the axe gate at every screenshot). Each body texel, placed in the world by its depth, must lie in front of
  the camera and inside some actor's proxy box or live gib chunk's sphere (the chunks are marched into the same
  target; the first-person axe and arms are meshes and are not in it); and of all the body texels at the world
  origin's clip depth, no more than 2 may share one depth to the bit. Both gates also run its positive control (each
  arm shown to fail on made-up texels). It is there for the depth fault (follow-ups, below). Only the head-split
  gate's cameras see that fault on a faulty build; the axe gate's do not.
- **What the gate does not guard:** the proxy box's growth (`fit`) and `splitBound`'s growth of the cluster and tile
  spheres. No gate camera sees them fail; their unit tests hold them (`head-split-bounds.test.ts`,
  `zombie-gpu.test.ts`). The cost (C) is reported, not gated.

**The test tree.** After ANY WGSL change run the whole tree:

```bash
npx vitest run src/lab/sdf-zombie --exclude '**/cut-wound.test.ts'   # 511 files as of 2026-10-05; 3 to 5 minutes (the depth guard's own tests: npx vitest run scripts/lib/march-depth-guard)
npx tsc --noEmit                                                     # only the node:crypto error is allowed
```

Targeted sets missed a red cross-cutting gate twice (`entrails-gates`, `normal-gradient-probe`). `cut-wound.test.ts`
is left out of that run (it alone took 5 min 26 s when last timed); run it when you touch the cut field.

**The shader check set.** Every WGSL change needs all four:

1. `npx vitest run march-golden -u`, noted in the commit;
2. `node scripts/compile-census.mjs`: phase ready, `uncapturedCount` 0, no device loss;
3. `node scripts/march-hash.mjs`: with no split in its scenes the six pins must NOT move (they did not, in any task);
4. an interleaved cold boot pair (`node scripts/boot-time.mjs`), base and new alternated, with a unique `hash13` nonce
   per boot: the OS Metal cache otherwise warms a "cold" boot.

## The tuning dials

Everything is in `head-split.ts` unless a file is named. `SPLIT_SHADE` values are written into WGSL, so changing one
needs the shader check set. `HEAD_SPLIT.skull` is live through `__sdfGame.skullSplit`.

| Dial | Constant | Shipped | Off, or the neutral setting |
| --- | --- | --- | --- |
| Chops to kill | `AXE_HEAD.chopsToKill` (`webgpu/axe-head.ts`) | 3 | |
| The axe's table: the opening after each chop before the kill | `AXE_HEAD.openAngles` | `[0.8, 1]` of the preset's maximum | `[0.55, 0.8]`: the thin crack first (the design's table) |
| The kill's kick | `AXE_HEAD.killKick` | 0.3 of the preset's maximum | 0 |
| Full angles | `HEAD_SPLIT.presets.*.maxBoth` / `maxOne` | `middle` 0.55 / 0.9 rad; `face` 0.8 / 0.8 | |
| How far off centre the plane goes; when one side opens | `maxOffsetFrac`, `bothFrac`, `faceOffsetFrac` | 0.4, 0.15, `[-0.3, 0.5]` of the head's half-width | |
| The chop's spring | `HEAD_SPLIT.hz`, `zeta`, `kick` | 7, 0.35, 6 | `zeta` 1.2: no overshoot (the gate still passes; two unit tests fail) |
| The face cuts (the ragged cut faces) | `HEAD_SPLIT.faceCut`, `faceCalibre` | inset 0.006, `lenFrac` 1.1; depth 0.12, kerf 0.012, lip 1 | No off. The owner wants them as they are |
| Skin against cut face, for a later chop | `HEAD_SPLIT.skinEps` | 0.015 m | |
| The skull's follow table | `HEAD_SPLIT.skull.follow` | (0.55 → 0.1), (0.8 → 0.3), (1 → 0.85) | 0: the whole closed skull stands in the gap. 1: the bone rides the flesh |
| The fracture edge | `HEAD_SPLIT.skull.jag` | `zigAmp` 0.004, `zigLen` 0.022, `chipAmp` 0.0015, `chipLen` 0.006, `wobble` 0.43, `wobbleAlong` 1.7, `wobbleUp` 1.3, `upFreq` 0.73 | `zigAmp` 0 and `chipAmp` 0: the clean plane |
| The bone's inner wall and broken rim | `HEAD_SPLIT.skull.inside`, `rim` | (0.1, 0.018, 0.015); colour (0.72, 0.5, 0.4), width 0.004 m | `rim.width` 0: no rim |
| The wobble | `HEAD_SPLIT.wobble` | `hz` 3, `zeta` 0.3, `gainSide` 6, `gainBob` 8, `arm` 0.1, `accelClamp` 40, `jumpSpeed` 25, `max` 0.45, `minOpen` 0.03, `over` 0.45 | `gainSide` 0 and `gainBob` 0: bit-identical to no wobble |
| The cut faces' shading gate | `SPLIT_SHADE.cutLo`, `cutHi`, `shellLo`, `shellHi`, `poreCut` | 0.0015, 0.004, 0.0015, 0.004, 0.5 | |
| How wet a cut face is | `SPLIT_SHADE.wet` | 1 (wet all over) | 0: wet like a crater (its lip, not its floor) |
| The wet film | `SPLIT_SHADE.glisten` | `gain` 4.5, `pow` 28 (the owner's pick, C; B is `gain` 2.6, `pow` 40; A is `gain` 4, `pow` 24, `lumpTilt` 3.2, `lumpFlat` 0.1, `fineTilt` 0.3), `spill` 0.3, `lamps` 0.45, `lampPow` 20, `rawLo` 0.3, `rawHi` 0.8, `lump` 0.014, `lumpTilt` 2.4, `lumpFlat` 1, `fine` 0.006, `fineTilt` 0.6, `fadeLo` 0.75, `fadeHi` 1.5, `edge` 0.01, `horizon` 0.15 | `gain` 0: the block is not written into the shader at all |
| A flail hit on a split head: its share of the meter | `FLAIL_HEAD.meterScale` (`webgpu/flail-strike.ts`) | 0.3 | |
| The axe's body cut | `AXE_CALIBRE`, `AXE_CUT.halfLen` (`webgpu/axe-strike.ts`) | depth 0.1, kerf 0.025, lip 1.1; 0.15 m | |
| Blood on opening | `webgpu/game-axe.ts` (`deps.bleed` per face) and the leaf's `open()` | | |

Not dials: `REGION_MARGIN` (0.06: it must be at least the AO probe's distance), `holdFrac` (1.25: `rho` must hold the
head), `SHELL_ACCEPT_FRAC` (0.8) and `SPLIT_REOPEN_FRAC` (0.9). The bounds and the range rule are derived from them.

If the wet film twinkles in motion, the dials are `fineTilt` 0 (no fine octave), a larger `lump`, or a lower `gain`.
The film's lean (how far its normal stands off the surface's) is what decides WHERE it glints: median 39 degrees as
shipped (5% under 15, 95% under 55), so a face seen square on and a raked one both catch the torch; `lumpTilt` 3.2
with `lumpFlat` 0.1 leans 72 degrees and glints only at a rake. The variants A and C: NOTES, "round 3".
If a lurch reads as a hard stop, the wobble's dials are `max` and `gainSide`.

## What the owner decided (2026-10-05)

- **The axe skips the thin crack.** Chop 1 opens to 0.8 of the maximum, chop 2 to 1.0 with the zombie alive, chop 3
  kills with a kick. Kept.
- **The wobble stays as tuned** ("looked fine to me"). A reviewer suggested a lower `accelClamp`; not applied.
- **The ragged face cuts stay. Do not restyle the cut faces.** A restyle (the face cuts shrunk to a notch at the
  crown, a bone ring, layers and a dark cavity) was built and reverted in `d0d407d2` at his call: "pretty subtle",
  "I'm happy with the before". The steps are `f2a1c7f8`, `eb2f131b` and `e1e4acf2`; their sheets (`look/01` to `03`)
  are in `e1e4acf2`'s tree. To bring one back, cherry-pick it or revert the revert.
- **The wet film** was built at his request. Shown three settings (`look/14-wet-variants.jpg`), **he chose C, the
  boldest, on 2026-10-06**: "I think C is fine". It is past the 3% blow-out bound the builder had held B to; his pick
  overrides that bound.
- **The open-head frame cost:** "we can figure out how to optimize later".
- **Told, and no objection:** chops to the upper chest, the collar and the neck's base no longer count as head chops,
  for any character (`chopOnHead`). They are body chops and kill through the collapse meter (about 7 overheads or 9
  diagonals).
- **Earlier:** the cuts were too short and too tidy, and he wanted them "more excessive" (2026-10-04; hence the
  excess pass). The axe model is not important. On the first photos of the shaded split (2026-10-05): "looking pretty
  good", but the skull needed cracked and split states, which is why the bone opens in stages.

## Debt

All of it is accepted for now and none of it has been investigated. Numbers and conditions are in spec §10.9.

- **An open head costs about +6 to +8 ms of frame time at 0.6 m** and about +0.6 to +1.6 ms at 2 m, against the same
  head closed (headless, a 400 × 300 march target). Closed bodies read +0.1 to +0.3 ms at 0.6 m since B6,
  unattributed.
- **Cold shader compile: +4.5 s** on B4's boot pair (45.0 → 49.5 s warm-up). Later pairs did not show that level
  again; it has not been re-measured against the tree before B4.
- **A walking split head never rests,** so its bounds, hulls and record are re-made every tick. Only a corpse or a body
  that stands still could cache them.
- **`sdBody` costs about 2.7× inside the region** (CPU).
- **The split skull's copies** cost +0.1 to +0.5 ms over the whole skull: a clipped copy is shaded in full.
- **The wet film** is six `noise3` taps and two `pow` per raw texel, and again in the refine twin. Its frame cost was
  not resolved (under 1 ms if anything).
- **The cut excess pass:** cold boot about +430 ms (+136 to +936 ms over four pairs); three axe chops on one torso
  add about +22 ms of frame time, against +4.3 ms before. First things to try: drop or cheapen the `woundMask` noise
  and the pinch's `hash13` calls, tighten the cut's reach sphere, lower `AXE_CUT.halfLen` or the kerf.

Not tried, for the open head: a fixed piece order with a per-piece `continue` in place of the compare-swap sort;
flattening the pieces into the slot loop; for the skull copies, a branch in place of the select on the back face, and
drawing piece 0 front-faced when its top is hidden. A tighter tile bound was tried, gained 0.2 ms, and was reverted.
Keep bookkeeping out of `mapBody`'s per-sample path: it is inlined about ten times, and one form of the re-fold
report there cost 0.5 ms on every closed body.

## Follow-ups

1. **The depth fault in the light tail: bisected, rule pinned** (NOTES, "The depth fault, bisected"). On Apple's GPU,
   when only some fragments of a 4 × 4 block of the march target take a `bodyLights` call, the others come back with
   a zeroed ray and hit distance in the entry point: colour right, depth the WORLD ORIGIN's (rectangular notches).
   The rule: call `bodyLights` only under conditions every fragment shares (`lightListCfg`); a block that wants the
   list per fragment calls it for every fragment and gates the use (built, clean). `split-glisten.wgsl.test.ts` pins
   that; the gates' depth guard (`scripts/lib/march-depth-guard.mjs`) catches the fault whatever its cause. The cause
   proper is below the shader source (Metal's compile or the GPU) and was not reached.
   **The `return` after the miss `discard` landed 2026-10-06** (branch `claude/miss-discard-return`, off `a2d61133`;
   NOTES, "The miss discard's return"), with the refine twin's three:
   - **Parity is exact.** The six `march-hash` pins did not move, the three gates are green (79 / 26 / 30 on that branch; 80 / 27 / 30 merged), and base
     against new is the same to the bit on 8 scenes and on the refine twin's two attachments.
   - **It saves nothing.** Interleaved `timeDraws(120)` in a crowd and close up: every difference is inside the
     noise (about 0.5 ms on one body, 1 to 2 ms on a crowd). Truly cold boots: 39.8 s new, 40.0 s base.
   - **Why:** a probe (16 384 noise taps placed after the miss branch) costs 64 ms when hit fragments run it and
     nothing when only missed fragments reach it. On this GPU a discarded fragment does not pay for the code after its
     `discard`. Do not expect a speed-up from an early exit behind a `discard` on Metal; the returns are kept for the
     shader's shape and for back ends that may keep running.
   - **So the bisect's explanation is open again.** It said the fragments taking the gated call were missed ones
     running the tail on garbage. They pay nothing for the tail, so that is not shown. The rule, its pin and the
     guard do not depend on it.
   - **Not shown:** the deferred surface entry. `?renderer=deferred` draws no flesh into its G-buffer on the unchanged
     base and logs pipeline failures (follow-up 8).
2. **`gRefoldBy` is indexed by piece, not slot.** In a crowd pixel another slot's re-fold win can leak into an open
   slot's normal hint. It never touches the field. The fix moves what closed crowd pixels compute, so it is its own
   task with its own `march-hash` re-pin.
3. **Optimise the open head** (Debt, above).
4. **Something in the gap.** After the kill the skull is hollow and the room shows through the V. A whole brain mesh
   riding piece 0, drawn from `view.splitDrawn` like the skull, is the cheapest structural answer.
5. **A baked split head** has no answer yet: a detached or baked head takes the mesh face layer with no split.
6. **The slug opening the split** (spec §2): not started.
7. **The wet film in fast motion** is not measured. A walk's wobble does not make it sparkle (0.8% of highlight
   texels last one tick at 0.6 m, 4.1% at 2 m, on the shipped film).
8. **The deferred game boot is broken** (found 2026-10-06, on `a2d61133` before any change): at
   `/sdf-game.html?renderer=deferred` no body reaches the G-buffer (surface classes 1 and 17 only, no 18, at
   `scripts/deferred-game-check.mjs`'s own stance), the router counts 9 SDF producers where that gate wants 10, and
   the console has "Color target has no corresponding fragment stage output" and "structures must have at least one
   member" pipeline failures. Seen on a `?renderer=deferred&seed=1&vhs=off` boot, waited on for 10 minutes; the
   deferred gate itself was not run, and nothing was investigated.

## Known limits

- **Still the closed head's:** the shadow hull, `bodyInSight` (`webgpu/game-main.ts`) and motion vectors (a moving
  half's object motion reads zero). The top neck vertebra is left unsplit on purpose.
- **A pellet or slug crater on a cut face** sits on the old plane, so it shows on both faces. A rod sweep across the
  gap is un-warped as one segment, by its midpoint's piece.
- **A one-sided split's face cut marks the still half's crown** (775 of 4520 texels, up to 8.2 mm). Accepted by the
  owner. `HEAD_SPLIT.faceCalibre.lip` and the cut's reach are what drive it.
- **The bone's stage, through the seam only:** a chop that lands while the flesh is still past the old target steps
  the bone's share at the next tick (about 20° with chop 2 three frames after chop 1). In play strikes are at least
  0.6 s apart. A unit test holds the bone's per-tick bound for chops that land settled.
- **Hands split with the head.** Each piece turns the whole slot body above the hinge and within `rho`, so a hand
  raised near the face would split. If it shows, evaluate P± on the head cluster only.
- **The range cut-off pops** at 12.7 m (14 texels of the march target). Up close, a coarser SDF pass (`aaCfg.x` over
  0.00152) or `?laststep=7` could draw the region sphere as a ball; the view warns once in a dev build.
- **At 0.6 m the torch's beam misses a head in the middle of the screen** (the torch is 0.25 m off the eye, its cone
  21.6 degrees). That is why the film has its own wider cone (`spill`). With the torch lit, the lamps add no glint to
  the film. The film's fade distances are in march texels (2.4 m / 5 m at the gate's resolution).
- **Look, known and left:** the fracture's teeth read as a regular saw up close; an off-centre split halves an
  eyeball; an eye shot out of a split head leaves from its closed seat; loose pixels at the slab's tip and speckle on
  the `face` preset's crown; the corpse's halves pass through the floor; the `face` preset's hinge sits 2 cm in front
  of its plane (sound, but worth moving onto the plane in a tune).
- **A forced re-split with fewer sides** leaves the old face wound (seam only).
- **The axe's kerf** is 0.025 and can go no wider than 0.3 × the cut's half-length (`kerfPerHalfLen`). Re-measure the
  Lipschitz bound (`cut-wound.test.ts`) before widening it.

## House rules

- Never `git stash`. Never run `git checkout -- .`, `git restore .`, `git reset --hard` or `git clean` here: an
  implementer wiped its own uncommitted work that way.
- `git add` by name. Don't run implementers in parallel when their files overlap: a broad `git add` mixed commits
  once.
- Don't edit source while a gate runs: the dev server reloads the gate's page.
- Headless capture only, via `scripts/lab-servers.sh` (bash), on ports 5241 / 9241. **Port 5273 is the owner's.**
- Targeted vitest while you iterate. Every WGSL change needs the shader check set and then the whole test tree
  (above). `tsc` allows only the `node:crypto` error.
- Prove a visual claim with a number, and look at the images yourself.
- Never commit extracted Blood assets.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Use dualmem for memory, not MEMORY.md.
