# Goblin facial expressions: notes (2026-10-13/14)

Spec: [`docs/superpowers/specs/2026-10-13-goblin-expressions-design.md`](../../superpowers/specs/2026-10-13-goblin-expressions-design.md).
Plan: [`docs/superpowers/plans/2026-10-13-goblin-expressions.md`](../../superpowers/plans/2026-10-13-goblin-expressions.md).
Task 3b's own notes (the mouth moved to the lip line, the per-body hinge): [`grin/NOTES-grin.md`](grin/NOTES-grin.md).

## What was built

The goblin's face moves. `goblin.blob` has a `jaw` carrier bone (the bride's jaw system) with **its own hinge** (`hinge=0.06` on
the bone, y 1.1326, the lip line); the lower face (lower lip, chin, mouth corners, a dark mouth floor) rides it, and the
mouth opens AT THE LIP LINE (Task 3b: the groove is gone, an upper ridge, a cheek-fill pair, a mouth-corner pair and the floor
were added). Eleven jagged teeth (5 small upper, 2 upper fangs, 4 small lower; `color=8f8266 gloss=0.15`, brightened in Task 12) and a dark throat
bar are buried in the flesh at rest. The pure `expression.ts` turns keyed clips of five face channels (`gape`, `smile`,
`browDown`, `lipCurl`, `lid`) into a jaw gape (radians) and overrides on the goblin's authored face sheet; `blinkLid`/`withBlink`
overlay a blink on any expression. The goblin's tuning and clips (neutral, grin, scowl, shout) are data in
`characters/goblin-expressions.ts`, registered in `expression-library.ts`. The lab regenerates the 64x64 face sheet in place
only when its quantised params change (`sheetToRgba`), rides `rig.jawGape`, and has a panel section, an `__sdfLab` API and
capture env vars; the actor path takes `MotionConfig.jawGape`. No new WGSL.

## The contact sheet (final, 2026-10-14)

[`frames/index.html`](frames/index.html), made by `scripts/goblin-expression-sheet.sh` (camera 0.3 m from the mouth line,
`BLOB_DIST=0.3 BLOB_TARGET_Y=1.14 BLOB_PITCH=0.05`; the plan's 0.7 m framing makes the mouth too small to judge). Each
expression has `frame-00.png` (front) and `frame-01.png` (45 degrees), with the kit (`<name>/`, as the goblin ships) and
without it (`<name>-nokit/`; the kit is the sunglasses AND the armour, so those frames show bare shoulders). What I see:

| frame | gape (rad) | what it looks like |
|---|---|---|
| `neutral` | 0 | Closed, no tooth anywhere. A thin straight mouth line under the upper lip; the lower face is a rounded roll (see "the rest face" below). |
| `grin` | 0.204 | The upper row and both fangs hang long over a dark gap, the lower lip pushed down. Reads as a toothy snarl or leer: menacing rather than friendly, but not a SMILE: nothing turns up at the corners, and at 45 degrees the dropped lower jaw looks slack. |
| `scowl` | 0.144 | A narrower dark slit with the fang tips standing out of the row: bared, clenched teeth. With the kit on it differs from the grin by the gape alone. |
| `shout` | 0.48 | A wide dark mouth, the upper row on top, the four lower teeth as studs along the floor's front edge, the lower jaw dropped about 5 cm. Clearly a shout; the opening is a box (flat top, flat floor, straight sides). |
| `blink` | 0 | From the front: nothing (the sunglasses cover the eyes). At 45 degrees the red eye beside the lens is shut to a slit (two red texels left at its corners). Without the kit both eyes shut, each leaving two red texels at its corners. |

Teeth at rest: none shows in `neutral` or `blink`, front or 45 degrees, with or without the kit.

## Tuning by eye (Task 10)

Only numbers in `characters/goblin-expressions.ts` changed; each change carries a comment naming the frame that asked for it
(the frames are in [`tuning/`](tuning/)). Two rounds on the grin, one each on the scowl and the shout:

- **The grin's painted U** (`smileCurve 0.9 -> 0.35`, `smileWiden 0.25 -> 0.5`, `smileMouthOpen 0.01 -> 0.015`;
  [`tuning/paint-locate.png`](tuning/paint-locate.png)). Painting the grin's mouth 2.7x thick showed where it lands: at 0.9 the
  U bottomed out about 2.8 cm under the seam, ON the lower lip, a dark band across it (a second mouth whenever it shows).
  The sheet cannot paint corners ABOVE the seam (the formula pins the corners at `mouthRise` and moves the middle), so the
  best it can do is a shallow, wide U whose middle falls inside the opening and whose arms rise outside it. Honestly: at
  normal thickness those arms are lost in the grain and the cheek's shadow; I cannot see them in the final frames. The
  change mostly removes the lower-lip band.
- **The brows** (`browAngle 10 -> 25` deg per unit, `browHeavy 0.2 -> 0.3`; grin `browDown 0.35 -> 1`;
  [`tuning/brow-nokit.png`](tuning/brow-nokit.png), [`tuning/kit-hides-brows.png`](tuning/kit-hides-brows.png)). At 10 deg
  the scowl's brows were indistinguishable from the neutral's EVEN WITHOUT THE KIT (the brow ridge's own shadow swamps the
  paint); at 30 an angry slash over each eye reads. **With the kit on, the round sunglasses cover the painted brows
  completely from the front**: the brows carry nothing in the shipped look.
- **The grin's gape** (`0.28 -> 0.34`, 0.168 -> 0.204 rad; [`tuning/grin-gape-sweep.png`](tuning/grin-gape-sweep.png)): at
  0.12 rad the teeth are a stubby clenched row (a grimace), at 0.24 the fangs hang long but the side seam opens into a dark
  notch at 45 degrees; 0.204 shows the fangs' length.
- **The scowl's gape** (`0.18 -> 0.24`, 0.108 -> 0.144 rad) and **the shout's** (`1 -> 0.8`, 0.6 -> 0.48 rad;
  [`tuning/scowl-shout-gape.png`](tuning/scowl-shout-gape.png)): the scowl's fangs did not stand out from the small teeth; the
  shout at 0.6 rad dropped the lower jaw about 6 cm onto the collar, a nutcracker at 45 degrees.

`npx vitest run src/lab/sdf-zombie/characters/goblin-expressions.test.ts`: 10 passed after every round.

## Candid assessment

- **Is the grin evil?** It is menacing, not friendly, but it is not a grin: it reads as a toothy snarl or leer. Everything
  that would make it a SMILE is out of reach of numbers in `goblin-expressions.ts`: the painted brows are under the sunglasses,
  the painted mouth cannot lift its corners above the seam, and the geometry (lips, corners, cheeks) does not move except by
  the jaw's rotation. **With the kit on, the four expressions differ by the jaw and the teeth alone.**
- **The rest face is puffier than the pre-expression head** ([`tuning/rest-before-after.png`](tuning/rest-before-after.png),
  the head of `f81e5b10` rendered beside today's neutral at the same framing): before, the mouth was a sculpted, pursed,
  slightly smiling crease and the chin tapered into it; now the mouth is a thin line and the lower face reads as a separate
  rounded roll ("puck") with a crease under the lower lip, as if rolled under it; at 45 degrees the chin is a rounded blob
  rather than a taper. The head-profile pins still hold (every probe within 2.5 mm, one re-pinned), so this is shape and
  shading the probes do not see, not a silhouette change. It came with Task 3b's lip-line seam.
- **The opening is a box** from about 0.3 rad (flat top from the upper ridge, flat floor, near-vertical corner walls): the
  shout reads as a puppet's or a nutcracker's mouth rather than a lipped one.
- **At 45 degrees the side seam shows**: a dark notch at the mouth's corner in the grin and the scowl, and a thin line back
  along the cheek at big gapes.
- **The lower teeth are small**: they barely show in the grin and read as four studs in the shout.
- **The eyes and the blink** only show at 45 degrees (one red eye beside a lens) or without the kit.

## The spike and the owner's gate (Task 4, then Task 3b)

The Task 4 spike ([`spike/`](spike/), [`spike-close/`](spike-close/)) put the opening in the muzzle's bevel at the chin
(y 1.10-1.115), 2-3 cm below the lips and the painted mouth, so the teeth hid in shadow. The owner saw the same ("hard to see
any teeth ... a big bevel to make the lips"), floated big lipstick-red lips, then backtracked: "the main thing is getting a
viable toothy grin with teeth". Task 3b moved the mouth to the lip line with natural flesh lips about today's size; after it
every upper tooth shows at 0.15 rad ([`grin/NOTES-grin.md`](grin/NOTES-grin.md)).

## `eyeSquash` is dead

`blob-face-sheet.ts` declares and defaults `eyeSquash` in `FaceSheetParams`, but `generateFaceSheet` never reads it (the eye's
vertical scale is a fixed 1.25), so the goblin's authored `eyeSquash 1.70` has never taken effect. The blink uses a new `eyeLid`
param instead (default 0, so no existing sheet changes). Wiring `eyeSquash` in would change every character's eyes: an owner
decision.

## The jaw hinge is per body now

The plan assumed the bride's global `JAW_HINGE` (0.30 of the skull, her upper lip line). For the goblin that sits about 5.6 cm
above the lip line: the jaw lever hung straight down from it and opening swung the chin back into the throat (at 0.5 rad the
lower lip's middle dropped 4.7 cm and moved back 4.5 cm; at the old 0.6 rad shout the lower jaw vanished into the neck,
[`grin/old-hinge/`](grin/old-hinge/)). Task 3b added a **per-body hinge**: `hinge=<0..1>` on a `.blob` jaw bone (an error on
any other bone), carried by `blob-parse.ts` -> `BoneDef`/`ResolvedBone.jawHinge` (`resolve.ts`) -> `jaw.ts` `jawRestOf(..., hingeAt)`,
which `rig-bind.ts` and `motion.ts` both call. The goblin uses `hinge=0.06` (y 1.1326, 2 cm behind the skull axis): at 0.5 rad
the lower lip now drops 5.1 cm and moves back 1.7. Bodies without `hinge=` keep `JAW_HINGE` exactly (the bride is unchanged).

## The kit

`goblin-kit.wam` got the transcribed jaw line (`bone jaw parent=neck dir=up pitch=112 len=0.0638`, the blob's 0.083 / 1.30) and
`public/assets/lab/goblin-kit.gltf` WAS rebuilt with WAM in the jaw-bone commit (`6f550a08`): vertex data byte-identical, the only
new node `jaw`. The goblin has no kit skeleton-parity test (the bride's kit test has one); `goblin-kit.test.ts` passes.

## Frame cost (Task 11)

**The expressions made the goblin's head much more expensive: +47 ms a frame on a face close-up (54 -> 101 ms, +86%), far over
the plan's 1.5 ms line.** Nothing was trimmed (the plan says not without the owner).

How it was measured. `scripts/frame-cost.mjs` has no goblin scene (its close-up is a zombie on the game page), so this is the lab's
own `__sdfLab.benchGpu()` (hand-stepped frames, wall clock per chunk of 20 with the queue full, `hiddenSteps` 0 on every leg),
headless Chrome at 1380 x 820, `sdfScale` 0.7, the kit on, on this M3. A scratch driver booted `?character=goblin` and took three
`benchGpu` legs per camera; the BEFORE is `goblin.blob` from `f81e5b10` copied over the file, the AFTER is HEAD; boots
alternated after/before three times (load average 2-5) and the file was restored with `git checkout --` (the tree is clean).
Each cell is the median over the boots of each boot's median leg (ms per frame):

| camera | before (40 prims) | after, rest (58 prims) | after, grin | after, shout | delta at rest |
|---|---|---|---|---|---|
| face close-up (0.3 m, the sheet's framing) | 54.1 (53.9-54.2) | 100.7 (99.9-101.5) | 87.3 | 95.6 | **+46.6** |
| head (0.8 m, 45 degrees) | 42.0 (41.6-42.9) | 74.5 (74.2-75.1) | 73.4 | 64.4 | **+32.5** |
| whole body (2.4 m) | 10.1 (9.4-10.2) | 15.6 (14.6-16.1) | 13.3 | 14.1 | **+5.4** |

The boot-to-boot spread is under 2 ms for every cell; the three legs inside one boot spread more (the fastest about 10-25% under the median).
The whole-body rest leg is the first measured in each boot; its grin and shout legs read 2 ms lower, so +5.4 may be a little high.

Where it goes (an ablation, two more alternated boots of four variants, rest pose; the variant files were scratch copies):

| variant | prims | close-up | head |
|---|---|---|---|
| after (HEAD) | 58 | 99.8 | 74.7 |
| without the 11 teeth | 47 | 77.1 | 57.6 |
| without the teeth, the floor and the throat bar | 45 | 70.3 | 52.3 |
| before (`f81e5b10`) | 40 | 54.3 | 41.2 |

So on the close-up: **the teeth about 23 ms, the dark floor and throat bar about 7 ms, and the jaw split plus Task 3b's lip-line
prims (net +5) about 16 ms.** All of it is paid at rest, where the teeth and the interior are buried and draw nothing.

Cheapest trims, in order of what they would save for what they cost the look (owner's call):
1. **Skip the teeth and the interior when the jaw is shut** (gape 0 shows none of them; pinned): about 30 ms back on a close-up at
   rest, no visual change. Needs a per-prim "only when open" flag or a cull in the rig output, not a `.blob` edit.
2. A near-distance gate on the same prims (the plan's idea), on top of 1.
3. Fewer teeth (the plan's list: the two outer upper small teeth, then two lower): roughly 2 ms each on a close-up.
4. Look at why the 5 net lip-line prims cost 16 ms (overlapping blends on the face's front: they sit where every face ray ends).

For scale: the goblin is the protagonist seen in cutscenes and the screen lab (the first-person game shows only its arms), so the
close-up is the shot that matters for it, and it is a worst case (the face fills the frame).

## Task 12 (2026-10-15): brighter teeth

Owner, on the Task 10 sheet: "its better. maybe we should like light the teeth somehow or make them brighter - hard to see them
tbh". Frames in [`teeth/`](teeth/) (same framing as the sheet, ports 5301/9301).

**What changed:** the 11 teeth went from `color=8f8266 gloss=0.15` (the cultist's dirty ivory) to `color=e0d8c0 gloss=0.35
glow=0.15`: a light, near-neutral ivory (the warm key yellows it), a little more gloss, and a faint per-prim glow (15% of the
lit colour replaced by the flat albedo; free, it is a field of the prim's row). Nothing else moved: same geometry, the interior
untouched (its front-view gap is already near black, luma 9).

**Why they were dark:** the mouth is a cavity, so the field AO sits on its 0.35 floor inside it and the key reaches the teeth only
from the front; a 0.27-linear brown under that rendered at a mean luma of 26 of 255.

**The number** (`teeth/before-after-front.png`, `teeth/before-after-45.png`: before, after with the kit, after without). Tooth
pixels and gap pixels come from a MARKER render of the same shot (the teeth repainted `color=ff00ff glow=1`, the throat bar and the
floor `color=00ffff glow=1`, the file restored afterwards), each mask eroded by a pixel; the gap is the interior pixels inside the
teeth's bounding box; luma is Rec. 709 on the 8-bit frame.

| grin close-up | tooth luma before -> after | gap luma | ratio before -> after |
|---|---|---|---|
| kit, front | 26.5 -> 82.4 | 9.3 -> 8.7 | 2.86 -> **9.42** |
| kit, 45 degrees | 32.7 -> 93.4 | 34.4 -> 43.1 | 0.95 -> **2.17** |
| no kit, front | 26.6 -> 82.3 | 9.3 -> 9.6 | 2.87 -> **8.58** |
| no kit, 45 degrees | 32.4 -> 93.8 | 34.5 -> 41.3 | 0.94 -> **2.27** |
| shout, kit, front / 45 | 25.7 -> 84.8 / 35.5 -> 104.5 | 4.4 / 9.5 | 5.8 -> 17.4 / 3.7 -> 10.3 |

At 45 degrees the "gap" between the grin's teeth is not dark: it is the interior's grey specular sheen (painted prims keep the
flesh's wetness, so a near-black albedo still takes a white highlight at a grazing angle) plus a little spill from the teeth.
That is why the 45-degree ratio only just clears 2. Variants tried (`teeth/glow-sweep-front.png`, top to bottom glow 0, 0.15,
0.3, all `e0d8c0 gloss=0.35`): glow 0 gave 6.8 front but 1.98 at 45 degrees; glow 0.3 flattened the row toward a pale clump
(9.5 / 2.6). 0.15 keeps each tooth's shading and its own outline.

**What I see:** front, each of the seven upper teeth and both fangs is a separate pale peg with a dark gap on either side; the
fangs read as the longest. At 45 degrees the row is pale and visible under the overhanging lip; the gaps between teeth are grey
rather than black. In the shout the four lower teeth now read as small pale teeth along the floor instead of brown studs.
Neutral is unchanged (the teeth are buried; `goblin-blob.test.ts` still pins that no tooth paints the rest face).

## How to run

- The lab: `?character=goblin` on `/sdf-lab-webgpu.html`, panel section "expression" (hold, play, blink).
- Console: `__sdfLab.holdExpression('grin', t = 10, lid = 0)`, `__sdfLab.playExpression('grin')`, `__sdfLab.blink()`,
  `__sdfLab.setJawGape(0.2)` (a hand-set gape holds until an expression is held or played), `__sdfLab.expressionNames()`.
- Captures: `BLOB_EXPR=grin npm run blob:shot -- goblin <out> 2` (`BLOB_EXPR=<name>[:<t>[:<lid>]]`, e.g. `neutral:10:1` for a
  blink); `BLOB_GAPE=0.3` for a raw gape. Use your own `LAB_VITE_PORT`/`LAB_CDP_PORT`; never the owner's 5173.
- The sheet: `LAB_VITE_PORT=5291 LAB_CDP_PORT=9291 scripts/goblin-expression-sheet.sh [outDir]` (about 3.5 minutes;
  `NOKIT=0` skips the kit-hidden row).
- Tests: `npx vitest run src/lab/sdf-zombie/expression.test.ts src/lab/sdf-zombie/characters/goblin-expressions.test.ts
  src/lab/sdf-zombie/characters/goblin-blob.test.ts`.

## Open items for the owner

1. **Is the grin evil enough?** It is a toothy snarl, not a smile (see the assessment). With the sunglasses on, only the jaw
   and teeth carry the expressions.
2. **Approach C, the pre-approved per-prim morph, was NOT built.** Task 3b found the teeth read without it, and Task 10 was
   numbers only. The reasons it may still be wanted, all observed in the frames: the grin's corners do not curl up (the sheet
   cannot paint above the seam, and nothing in the geometry lifts them); the opening is box-shaped from about 0.3 rad; the lower
   teeth are small; and cheeks bunching on a smile would be the obvious next cue. The pre-approved shape: a `.blob` prim may
   declare a morph (channel + offset and/or radius scale), `applyRig` applies it by the channel's weight, `actuate` outputs
   the weights; neutral stays bit-identical.
3. **The rest face's lower jaw is puffier** than the pre-expression head ([`tuning/rest-before-after.png`](tuning/rest-before-after.png)).
   Acceptable, or should the lower lip and chin be re-sculpted toward the old taper?
4. **The brows**: tuned stronger for the no-kit look; invisible with the kit. Raise them above the lenses (`browRise` or the
   brow block), or accept that the goblin's expressions are all mouth?
5. Surprise and sneer (clip data only); the screen-emergence lab wiring after PRs #46/#47.
6. The dead `eyeSquash` (fix for every character, or leave).
7. **The cost: +47 ms a frame on a face close-up** (see Frame cost). The first trim (skip the buried teeth and interior while the
   jaw is shut) should give about 30 ms back with no visible change; it needs your go-ahead and a small engine change.
