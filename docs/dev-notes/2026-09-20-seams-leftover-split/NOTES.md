# Splitting `game-seams-leftover.ts` into concern-named seam modules (2026-09-20)

Wave 1 of the game-main decomposition lifted 96 `__sdfGame` members — everything
that needed nothing but the `GameContext` — into one file and named it
"leftover". Wave 2 did the opposite: 31 members into five modules named by
concern (`weapon-aim`, `render-quality`, `demo-step`, `lighting-probes`,
`gibs-bake`). This task gives the wave-1 bucket the same treatment: every member
moved **verbatim** into a module named for what it holds. No behaviour change,
no renamed members, no new members.

Method notes:

- Member names, line spans and `ctx` slices below come from
  `scripts/sdf-game-members.mjs` (added here): an AST dump that (a) simulates
  the `__sdfGame` object literal — spreads applied in source order, later
  same-named members overwriting earlier — to produce the authoritative
  `Object.keys(__sdfGame).sort()` list, and (b) prints a per-member census of
  any seam module.
- Bodies are moved by line-range extraction, not retyping. The proof the seam
  set is unchanged is a before/after diff of the simulated member list
  (Step 4); the proof the bodies moved verbatim is that extraction is
  byte-exact, plus the raw-text pin tests that carry exact body strings.

## Step 1 — census of `game-seams-leftover.ts` (96 members, 937 lines)

`npx tsx scripts/sdf-game-members.mjs census src/lab/sdf-zombie/webgpu/game-seams-leftover.ts`:

```
  44-  44 (  1L)  fireFlare  [ctx.weapon]
  46-  46 (  1L)  igniteAll  [ctx.vfx]
  49-  54 (  6L)  igniteActor  [ctx.vfx, ctx.world]
  59-  75 ( 17L)  actorTrace  [ctx.vfx, ctx.world]
  77-  77 (  1L)  extinguishAll  [ctx.vfx]
  79-  82 (  4L)  burning  [ctx.vfx]
  83-  88 (  6L)  flameCards  [ctx.vfx]
  92-  92 (  1L)  setBurnTuning  [ctx.vfx]
  93-  93 (  1L)  burnTuning  [ctx.vfx]
  96-  96 (  1L)  setTechnique  [ctx.vfx]
  97-  97 (  1L)  technique  [ctx.vfx]
  98-  98 (  1L)  setVolume  [ctx.vfx]
  99-  99 (  1L)  volume  [ctx.vfx]
 100- 100 (  1L)  setTongueTuning  [ctx.vfx]
 101- 101 (  1L)  tongue  [ctx.vfx]
 103- 103 (  1L)  burnGatherDebug  [ctx.vfx]
 109- 109 (  1L)  setPipelineLog  []
 110- 110 (  1L)  pipelineLog  []
 118- 118 (  1L)  pipelineCensus  []
 121- 121 (  1L)  pipelineShaderSource  []
 127- 130 (  4L)  screenPosOf  []
 134- 134 (  1L)  cameraWorld  []
 139- 144 (  6L)  screenRayToWorld  []
 164- 173 ( 10L)  readOutputTarget  [ctx.boot, ctx.render]
 177- 195 ( 19L)  setDemoHold  [ctx.demo, ctx.probes, ctx.render]
 196- 209 ( 14L)  brains  [ctx.player, ctx.world]
 212- 212 (  1L)  ringTuning  []
 215- 215 (  1L)  attackTuning  []
 219- 235 ( 17L)  guts  [ctx.vfx, ctx.world]
 241- 248 (  8L)  setAimTuning  []
 255- 255 (  1L)  reloadTotalSec  []
 256- 260 (  5L)  setBlastDistortStrength  [ctx.render, ctx.vfx]
 265- 281 ( 17L)  sceneCensus  []
 282- 289 (  8L)  levelProbes  [ctx.lighting, ctx.world]
 294- 300 (  7L)  setVhs  [ctx.panels, ctx.render]
 301- 305 (  5L)  setVhsTerm  [ctx.panels, ctx.render]
 313- 320 (  8L)  setRegisteredObjectsVisible  []
 339- 345 (  7L)  setFisheye  [ctx.player, ctx.render]
 349- 351 (  3L)  fisheye  []
 358- 374 ( 17L)  setGoo  [ctx.goo, ctx.panels, ctx.vfx]
 377- 382 (  6L)  setBloodBlurExposure  [ctx.gibs, ctx.panels]
 384- 389 (  6L)  setBloodBlurMaxStreak  [ctx.gibs, ctx.panels]
 391- 395 (  5L)  setGibBlur  [ctx.gibs, ctx.panels]
 399- 402 (  4L)  setDynamiteTuning  []
 403- 403 (  1L)  dynamiteTuning  []
 404- 406 (  3L)  woundTuning  []
 410- 410 (  1L)  setBoneMesh  []
 416- 433 ( 18L)  hitMeshSkull  [ctx.render, ctx.world]
 434- 434 (  1L)  meshEyeState  [ctx.render, ctx.world]
 437- 437 (  1L)  bodyBuild  []
 439- 455 ( 17L)  skeletonDiagnostics  [ctx.render, ctx.telemetry]
 456- 484 ( 29L)  boneTubes  [ctx.gibs, ctx.render, ctx.world]
 487- 490 (  4L)  setGoutTuning  []
 491- 493 (  3L)  gout  []
 497- 501 (  5L)  setRefineTail  [ctx.render, ctx.world]
 502- 502 (  1L)  refineInfo  [ctx.render, ctx.world]
 504- 508 (  5L)  upscaleModels  []
 511- 517 (  7L)  upscaleSelfCheck  [ctx.boot, ctx.render]
 527- 531 (  5L)  setNormalGradient  [ctx.bake, ctx.render, ctx.telemetry, ctx.world]
 532- 536 (  5L)  setNormalGradientDebug  [ctx.bake, ctx.telemetry, ctx.world]
 538- 543 (  6L)  normalGradientPieces  [ctx.bake, ctx.world]
 544- 548 (  5L)  normalGradientPiece  [ctx.bake, ctx.world]
 549- 553 (  5L)  normalGradientStatus  [ctx.telemetry, ctx.world]
 557- 580 ( 24L)  crowdUniformDiff  [ctx.crowd, ctx.world]
 587- 610 ( 24L)  actorDump  [ctx.render, ctx.world]
 611- 627 ( 17L)  crowdSlotDump  [ctx.crowd, ctx.world]
 630- 638 (  9L)  setUniformAll  [ctx.crowd, ctx.world]
 639- 642 (  4L)  setMarchDebugMode  [ctx.crowd, ctx.world]
 643- 652 ( 10L)  setFlatAlbedo  [ctx.bake, ctx.crowd, ctx.world]
 659- 662 ( 4L)  setWoundCull  [ctx.vfx, ctx.world]
 666- 666 (  1L)  setBoneCull  []
 670- 670 (  1L)  setBoneCullMode  []
 674- 680 (  7L)  setAa  [ctx.render, ctx.world]
 685- 688 (  4L)  setLevelShadow  [ctx.lighting, ctx.world]
 696- 720 ( 25L)  depthPreStats  [ctx.boot, ctx.render]
 724- 738 ( 15L)  refreshHull  [ctx.render, ctx.world]
 743- 745 (  3L)  setShoulderSocket  []
 749- 754 (  6L)  setSscs  [ctx.boot, ctx.render]
 755- 760 (  6L)  hullDebug  [ctx.render, ctx.world]
 761- 761 (  1L)  setActorCull  [ctx.render, ctx.world]
 762- 762 (  1L)  actorCull  [ctx.render, ctx.world]
 768- 792 ( 25L)  stampWoundAt  [ctx.world]
 797- 813 ( 17L)  explode  [ctx.world]
 837- 841 (  5L)  setBonePiecesVisible  [ctx.bake, ctx.render]
 842- 855 ( 14L)  setChunksVisible  [ctx.bake, ctx.render, ctx.vfx]
 856- 883 ( 28L)  gibRenderMode  [ctx.bake, ctx.gibs]
 886- 886 (  1L)  preloadGibAssets  []
 891- 895 (  5L)  enclosureBoxAt  []
 908- 908 (  1L)  characterNames  []
 909- 909 (  1L)  warmDone  []
 913- 913 (  1L)  warmBackground  [ctx.boot]
 915- 927 ( 13L)  gibRenderer  [ctx.bake, ctx.gibs]
 928- 931 (  4L)  rooms  []
 932- 932 (  1L)  tunnels  []
 933- 933 (  1L)  furniture  []
 935- 935 (  1L)  accents  []
```

(The line spans cover the member token; the doc comments above each move with
their member.)

For orientation, what the existing destinations already hold (member counts
from the same tool): fx 58 (lighting/probe clocks, bleed, probes, goo, gib
shutter state, chunks, gore/sprite pieces), render 66 (post-chain toggles incl.
the `vhs`/`blastDistort`/`refine`/`boneCull`/`sscs`/occluder families),
world 42 (actor readbacks incl. `worldToScreen`, `minHandGap`, the march-uniform
A/B readbacks `aa`/`levelShadow`/`flatAlbedo`), boot 30 (frame capture, the
`readSurfaceAt`/`readCompositeAt`/`hashSurface` readback family, warm-up),
weapon-player 34, debug-probe 5, render-diag 4 (heavy GPU readbacks
`texRoundTrip`/`temporalDiag`/`occupancy`/`boneEvals`), shell-diag 3,
gibs-bake 6, render-quality 6, weapon-aim 13, demo-step 4, lighting-probes 2,
misc 29 (demo/freeze, panels, telemetry), bench 2, spawn-goo 8.

## Step 2 — the split

Four new modules named for a concern a reader would look for, plus extensions
of the existing wave-1/wave-2 homes wherever the concern already matches (the
instruction: extend rather than invent a near-duplicate name). Nothing is left
homeless, so no `game-seams-misc-*` bucket is needed.

### New modules

**`game-seams-fire.ts` — `createFireSeams` (16 members)**
`fireFlare, igniteAll, igniteActor, actorTrace, extinguishAll, burning,
flameCards, setBurnTuning, burnTuning, setTechnique, technique, setVolume,
volume, setTongueTuning, tongue, burnGatherDebug`
— The bucket's own first comment block calls this the FLARE TEST HARNESS; all
16 read/write `ctx.vfx.burning` (fire technique, tongue, volume, burn tuning,
gather census). Fire is the top concern here and no existing module name
covers it (`fx` is probes/goo/chunks/gore; wave 2 has no fire module).

**`game-seams-skeleton.ts` — `createSkeletonSeams` (6 members)**
`setBoneMesh, hitMeshSkull, meshEyeState, bodyBuild, skeletonDiagnostics,
boneTubes`
— All six are the `skeleton=mesh` / bone-tube evidence seams
(`segMeshRenderer`, `boneInstancer`, the body-build cache). "Skeleton" is a
name a reader would grep; render.ts holds only the bare `boneMesh`/
`skeletonMesh` state getters and render-diag holds GPU readbacks — neither
name would carry these well.

**`game-seams-dynamite.ts` — `createDynamiteSeams` (3 members)**
`setDynamiteTuning, dynamiteTuning, explode`
— The dynamite/explosions concern from the task sketch. `explode` is the
wound-only diagnostic detonation through the SAME `resolveExplosion` path
dynamite uses (its comment says so). The real `detonate`/`overcook` stay
directly in game-main.ts's literal (not part of this bucket).

**`game-seams-march-debug.ts` — `createMarchDebugSeams` (11 members)**
`setNormalGradient, setNormalGradientDebug, normalGradientPieces,
normalGradientPiece, normalGradientStatus, crowdUniformDiff, crowdSlotDump,
actorDump, setUniformAll, setMarchDebugMode, setFlatAlbedo`
— The march-shader debug/A-B cluster: the flat-albedo + normal-gradient seams
(the shading-normal tripwire trio), the per-body/crowd uniform diff and dump
tools, and the set-any-uniform hammer. One concern: "why does this pixel
shade the way it does" tooling. `setFlatAlbedo`'s getter twin lives in world
(`flatAlbedo`), and the shading-normal test pins these names — the pin is
repointed in the same commit.

### Extensions of existing modules (concern already has a home)

**`game-seams-gibs-bake.ts` (+5 → 11)** — `gibRenderMode, gibRenderer,
preloadGibAssets, setBonePiecesVisible, setChunksVisible` — the gibs-and-
chunks module already holds `setGibRenderMode`, `chunkStats`, `goreShowcase`;
these are the gib-renderer state readbacks, the asset preloader, and the
pieces show/hide differential seams.

**`game-seams-weapon-aim.ts` (+2 → 15)** — `setAimTuning, reloadTotalSec` —
the free-aim/bob feel knobs (FREE_AIM/BOB) next to `setFreeAim`; the reload
length next to `setReloadSpeed`.

**`game-seams-demo-step.ts` (+1 → 5)** — `setDemoHold` — pins the
render-side clocks for deterministic captures; `demoInfo` here already
reports `demoHold`.

**`game-seams-lighting-probes.ts` (+1 → 3)** — `levelProbes` (getter) — the
readback for exactly what this module's setters change.

**`game-seams-render-quality.ts` (+4 → 10)** — `setFisheye, fisheye,
upscaleModels, upscaleSelfCheck` — the lens pair completes the fov
co-invariant with `setRenderFov` (both clamp through `clampFovDeg` and share
`fisheyeReport`); the two upscale seams sit next to `setUpscale`.

**`game-seams-render.ts` (+12 → 78)** — `setBlastDistortStrength, setVhs,
setVhsTerm, setRefineTail, refineInfo, setBoneCull, setBoneCullMode, setSscs,
refreshHull, hullDebug, setActorCull, actorCull` — every one has its state
getters here already (`vhs`/`vhsTerms`, `blastDistort*`, `refineBand`,
`boneCull`/`boneCullMode`, `sscsTerms`, `setOccluder`/`setHullExclusions`);
these are the missing setters/readbacks of those families.

**`game-seams-world.ts` (+15 → 57)** — `brains, ringTuning, attackTuning,
screenPosOf, cameraWorld, screenRayToWorld, setAa, setLevelShadow,
setShoulderSocket, characterNames, enclosureBoxAt, rooms, tunnels, furniture,
accents` — the melee/AI readbacks (`brains` is the crowd gate's oracle;
`ringTuning`/`attackTuning` are the combat tunings its gates assert against)
next to `minHandGap`/`actorList`; the camera projection helpers next to
`worldToScreen`; the `aa`/`levelShadow` setters for the getters already here;
the motion A/B next to `setRelax`/`setOmega`; the level-data tables
(`rooms`/`tunnels`/`furniture`/`accents`/`enclosureBoxAt`) and the registry
roster `characterNames` next to `zombies`.

**`game-seams-fx.ts` (+10 → 68)** — `setGoo, setBloodBlurExposure,
setBloodBlurMaxStreak, setGibBlur, setGoutTuning, gout, woundTuning,
stampWoundAt, setWoundCull, guts` — the goo switch for the `goo` family
already here; the shutter-blur shared controls next to `gibBlur`/
`gibOccluderEnabled`; the blood-impact gout and wound tuning tables; the
wound-stamping capture twins (`stampWoundAt`, `explode`'s sibling
`spillVerdict` calls) and the gut-rope readback.

**`game-seams-boot.ts` (+3 → 33)** — `readOutputTarget, warmDone,
warmBackground` — the composited-output readback joins the
`readSurfaceAt`/`readCompositeAt`/`hashSurface`/`presentedShot` readback
family; the warm-up state seams join `bootMarks`.

**`game-seams-render-diag.ts` (+6 → 10)** — `setPipelineLog, pipelineLog,
pipelineCensus, pipelineShaderSource, sceneCensus, depthPreStats` — GPU-side
diagnostics: the compile census, the scene draw attribution census, and the
depth-prepass readback (same one-paused-step read contract as `occupancy`,
which lives here).

**`game-seams-debug-probe.ts` (+1 → 6)** — `setRegisteredObjectsVisible` —
the bounded subtree inspector joins `debugRegisteredTree`, its task-6
kit/prop evidence sibling.

### Order in game-main.ts

`createLeftoverSeams`'s spread line is replaced, group by group, by the new
factories' spreads; the extensions need no game-main change (already spread).
The four new spreads sit where the leftover spread was. No member name
collides with any other module (422 final keys = 422 summed origins), so the
spread order is not load-bearing — the Step 4 diff proves that stays true.

### Test pins that must move with their members

Three suites read seam files as raw text and pin exact body strings:

- `gib-shutter-layer.test.ts` — pins `setGibBlur`,
  `ctx.gibs.shutter?.setExposureMs(applied)`,
  `ctx.gibs.shutter?.setMaxStreakPx(applied)` against
  `game-seams-leftover.ts` → repoint to `game-seams-fx.ts` (same commit as
  the fx move).
- `shutter-game-layer.test.ts` — pins `setBloodBlurExposure`,
  `setBloodBlurMaxStreak` against leftover → repoint to fx (same commit).
- `march/body/blocks/post/shading-normal.wgsl.test.ts` — reads
  game-main + leftover concatenated; pins `setNormalGradient(mode: 0 | 1)`,
  `setNormalGradientDebug(mode: 0 | 1 | 2)`, `normalGradientStatus()` →
  repoint to `game-seams-march-debug.ts` (same commit as the march-debug
  move).

## Step 3 — commits

One destination module per commit, `npx tsc --noEmit` clean after each:
fire → skeleton → dynamite → march-debug (with the shading-normal pin) →
gibs-bake → weapon-aim → demo-step → lighting-probes → render-quality →
render → world → fx (with the two shutter pins) → boot → render-diag →
debug-probe (leftover deleted here, import removed from game-main).

## Step 4 — seam-set proof

Baseline (before any move), from `scripts/sdf-game-members.mjs dump`:
**422 members**, by origin: gibs-bake 6, lighting-probes 2, demo-step 4,
render-quality 6, leftover 96, misc 29, fx 58, weapon-player 34, boot 30,
render 66, world 42, debug-probe 5, bench 2, render-diag 4, shell-diag 3,
spawn-goo 8, game-main 14. Sorted list saved to
`/tmp/sdf-members-before.txt` (also reproduced below in the results section).

## Step 4 result — seam set unchanged

`npx tsx scripts/sdf-game-members.mjs dump` before and after; the sorted
`Object.keys(__sdfGame)` list is **byte-identical** (md5 `0f7f1d2b25e3679b6fa45b5efee9a0fc`,
422 members, no duplicates before or after — the final count equals the sum of
per-file origin counts in both runs):

- before: `/tmp/sdf-members-before.txt` (also `/tmp/sdf-members-before2.txt`,
  re-generated after the dependency merge — identical), keys in
  `/tmp/keys-before.txt`
- after: `/tmp/sdf-members-after.txt`, keys in `/tmp/keys-after.txt`
- `diff /tmp/keys-before.txt /tmp/keys-after.txt` → empty

By-origin counts, before → after (members that moved): gibs-bake 6 → 11 (+5),
lighting-probes 2 → 3 (+1), demo-step 4 → 5 (+1), render-quality 6 → 10 (+4),
weapon-aim 13 → 15 (+2), leftover 96 → **file gone** (16 to fire, 6 to
skeleton, 3 to dynamite, 11 to march-debug, 5 to gibs-bake, 2 to weapon-aim,
1 to demo-step, 1 to lighting-probes, 4 to render-quality, 12 to render,
15 to world, 10 to fx, 3 to boot, 6 to render-diag, 1 to debug-probe),
misc 29 → 29, fx 58 → 68, weapon-player 34 → 34, boot 30 → 33, render 66 → 78,
world 42 → 57, debug-probe 5 → 6, bench 2 → 2, render-diag 4 → 10,
shell-diag 3 → 3, spawn-goo 8 → 8, game-main 14 → 14.

## Line counts

| file | before | after |
| --- | --- | --- |
| game-seams-leftover.ts | 937 | **deleted** |
| game-seams-fire.ts (new) | — | 77 |
| game-seams-skeleton.ts (new) | — | 98 |
| game-seams-dynamite.ts (new) | — | 49 |
| game-seams-march-debug.ts (new) | — | 157 |
| game-seams-gibs-bake.ts | 85 | 174 |
| game-seams-weapon-aim.ts | 83 | 104 |
| game-seams-demo-step.ts | 42 | 64 |
| game-seams-lighting-probes.ts | 27 | 35 |
| game-seams-render-quality.ts | 100 | 149 |
| game-seams-render.ts | 195 | 279 |
| game-seams-world.ts | 356 | 463 |
| game-seams-fx.ts | 457 | 583 |
| game-seams-boot.ts | 193 | 228 |
| game-seams-render-diag.ts | 444 | 518 |
| game-seams-debug-probe.ts | 598 | 613 |

The 15 moved groups carry their doc comments and internal blank lines with
them (extraction is by AST line span, not retyping); the per-file growth is a
few lines over the moved body count in each destination for that reason.

## Step 5 result — full suite

`npx vitest run`: **15 failed | 5947 passed | 1 skipped** — the failure SET is
main's base set, name for name:

- `game-actor-torso-slug` ×2 (warm=30 / warm=120)
- `march-step-soundness`
- `surface-nets-cpu`
- `blob-measure`
- the blob/skeleton set: `zombie-blob` ×2, `soldier-blob`, `gnasher-blob`,
  `blob-compile` ×2, `skeleton-spike/contract`, `skeleton-spike/mesh`,
  `skeleton-spike/mesh-skull`, `gib-rupture`

The three raw-text pin suites were repointed in the same commits as the moves
they follow: `shading-normal.wgsl.test.ts` (pins now read game-main +
game-seams-march-debug), `gib-shutter-layer.test.ts` and
`shutter-game-layer.test.ts` (pins now read game-seams-fx). Both shutter
suites were re-run green right after the repoint; the full run above is the
final word.

`npx tsc --noEmit` clean at every commit (16 move/notes commits + this one).

## Step 6 result — pixel gate (ran ONCE, at the end)

Own ports (5362/9362), `scripts/lab-servers.sh` lifecycle, nothing else of
mine running, HEAD of this branch (post-split), gate scripts at the dependency
fix (`ea1ccd83` line):

- room1 shipped defaults: **`8f2b74e7…`** = canonical, repeat identical,
  room1-wounded **`1381a866…`** = canonical. First boot, no retries.
- room2 (`MARCH_HASH_ROOM=2 MARCH_HASH_TILES=0`):
  **`35b6d5619f7f85a52e852056a09f6c0fbfacf2c5`** = the documented stable
  value, repeat identical. First boot, no retries. room1's known flakiness did
  not appear (the dependency task's settle fix held).

## Verbatim discipline

Bodies moved by line-span extraction from the census spans (comment blocks
attached to each member ride along; adjacent members stay adjacent, distant
members separated by one blank line exactly as in leftover). A post-move check
in the mover compared every extracted stripped line against the destination
file (all groups reported `verbatim check ok`); the raw-text pin suites pin
eight exact body strings across the moved members and pass. Member names,
order within each destination, and the `__sdfGame` key set are unchanged.

## For TASKS.md (owner to carry over — not edited there, another session owns it)

- The "game-main.ts decomposition" block can move the leftover-split item to
  done: `game-seams-leftover.ts` (wave 1's 96-member ctx-only bucket) is gone
  at the head of `dispatch/2026-09-20-seams-leftover-split`. Its members live
  in four new concern-named modules (`game-seams-{fire,skeleton,dynamite,
  march-debug}.ts`) and as extensions of eleven existing homes — biggest
  adds: world +15, render +12, fx +10, render-diag +6, gibs-bake +5,
  render-quality +4; boot +3, weapon-aim +2; demo-step, lighting-probes,
  debug-probe +1 each (setter/readback joins for families already living
  there). `__sdfGame` key set byte-identical (422, md5
  `0f7f1d2b25e3679b6fa45b5efee9a0fc`); tsc clean at every commit; full suite
  = the base 15-failure set; pixel gate room1 `8f2b74e7…` / wounded
  `1381a866…` and room2 `35b6d561…`, both first-boot canonical through the
  settled staging.
- `scripts/sdf-game-members.mjs` (committed here) is the member-set tool the
  next decomposition wave should reuse: `dump` simulates the `__sdfGame`
  literal (spread order + overwrite) for the before/after diff; `census <file>`
  prints per-member line spans and ctx slices.
- The three raw-text pin suites now point at the members' new homes
  (shading-normal → march-debug; gib-shutter/shutter-game → fx). Any future
  member move must repoint pins in the same commit — that is a test fix, not a
  behaviour change.
- Remaining bucket-style seam files worth the same treatment some day:
  `game-seams-misc.ts` (29: demo/freeze + panels + telemetry), `game-seams-fx.ts`
  (68: probes/goo/chunks/gore), `game-seams-render.ts` (78),
  `game-seams-world.ts` (57) — all now concern-homogeneous enough to split
  mechanically with the census tool when a wave takes them on.
