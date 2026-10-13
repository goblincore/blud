# Goblin facial expressions: design (first slice: a toothy evil grin, scowl, shout, blink)

**Date:** 2026-10-13 · **Status:** design approved by the owner in conversation (2026-10-13). Written spec awaiting owner review.
**Request (owner, 2026-10-13):** "the goblin has no facial expressions ... it would be good if we could work on some way to
animate some expressions in his face. I suppose he would have to have teeth (sharp?). Mostly if there is some way he could
have a toothy evil grin, that would be cool. Not sure what other expressions ... that might be a separate chip."
**Unlocked by:** the owner's 2026-10-11 decision that the goblin's face may be shown (`docs/game/vision.md`,
`docs/game/flat/design.md`; the old "never its face" rule is discarded).
**Related:** [goblin pose layer](2026-10-03-goblin-pose-layer-design.md) (the keyed-clip shape this reuses),
[goblin refinement](2026-10-01-goblin-refinement-design.md), the bride's jaw (Task 12 in `docs/dev-notes/2026-09-24-bride/`).

## Why

The goblin's face is a generated 64x64 greyscale sheet projected on a rigid head, plus a few static prims (ears, hooked
nose, lips, a mouth groove). Nothing about it moves and there is no tooth geometry, so the face is a mask. The owner wants
it to emote, first of all a toothy evil grin. The Flat's emergence sequence (PR #47) is the first place a goblin on screen
could use it.

## Decisions (owner, 2026-10-13, in the brainstorm)

1. **First slice:** neutral, **grin**, **scowl**, **shout**, plus **blink** as an overlay. Surprise and sneer are deferred:
   they are clip data once the channels exist.
2. **Teeth:** jagged and uneven, about 5 upper and 4 lower small sharp teeth of uneven length plus two longer fangs
   (about 11 prims), dirty ivory, pointed (`r2`), chamfered. Not an even needle row, not a few big tusks.
3. **Mechanism A, with C as the escalation:** a jaw bone plus expression channels. If the owner does not like the result,
   the next plan is **C** (per-prim morph targets for lips and cheeks). The design keeps the channel layer independent of
   the mechanism so C is one more actuator, not a rewrite.
4. **Base:** current `main`, judged in the lab (`?character=goblin`) only. The screen-emergence wiring (PR #47) is a
   short follow-up once #46 and #47 merge. Everything is authored in the file's 1.30 m frame, which #46's
   `scale 1.3077` line transforms unchanged.

## What exists (verified 2026-10-13)

- **No `scale` line on main.** `goblin.blob` is 1.30 m here; the 1.70 m scale is open PR #46.
- **The face sheet** (`blob-face-sheet.ts` `generateFaceSheet`) is a pure function from `FaceSheetParams` to a 64x64 byte
  buffer plus its measured mean: 4,096 texels, no DOM. Features are darkenings of a grainy base (the shader uses the sheet as
  an albedo multiplier, a bump and an emissive mask). `lab-main.ts` (around lines 760-850) builds a `DataTexture` from it,
  once, via `loadGeneratedFace`; there is no in-place update path. Sign warning: positive `mouthCurve` is a frown,
  negative is a smile (the code comment is backwards; measured, see the dualmem warning on `blob-face-sheet.ts`).
- **The jaw system exists already, for the bride:** a `bone jaw` carrier (`bride.blob:106`), `on jaw` prims, `jaw.ts`
  (`JAW_HINGE`, `openAboutHinge`, `jawOrient`, `JAW_MAX_GAPE 0.9`), `rig.jawGape` consumed in `rig-bind.ts` (`ridesHead`
  treats `on jaw` prims as part of the rigid head, then applies the gape), and `MotionFrame.jawGape` produced by
  `motion.ts` (today only from the bride's sword swing, `sword-swing.ts jawGapeAt`).
- **The goblin's lower face cannot hinge as authored.** The chin and jaw are `facePrims` ellipsoids from the `face` block
  (`jawWidth`, `jawHeight`, `jawDrop` 0.076, `jawJut`), which are rigid-head prims, plus two static lip prims at
  `skull at=0.12` and a mouth `groove`. Only prims declared `on jaw` take the gape. The bride solved this by zeroing the face
  block and splitting her chin capsule into a skull half and a jaw half on the same line.
- **The face block is pinned** to the goblin's approved look (see the block's own comment: reshaping the skull drags the
  nose, lips, sunglasses and the kit with it). The jaw split must not move the rest-pose silhouette.
- **The goblin wears round sunglasses** in the kit (eyes are hidden in the game). Brows and mouth carry the expression;
  the blink and lids are visible only without the kit, as in the lab.
- **Pose layer:** `pose.ts` keys BONE angles only. `jawGape` is a separate scalar, which is also how the bride's gape
  travels (never read back off the jaw point, which is one step stale).

## Design

### Units

| Unit | Kind | Job | Depends on |
|---|---|---|---|
| `src/lab/sdf-zombie/expression.ts` | pure, new | channels, keyed clips, `expressionAt(clip, t)`, `actuate(channels, rest)` | `blob-face-sheet.ts` (types only) |
| `src/lab/sdf-zombie/characters/goblin-expressions.ts` | data, new | `NEUTRAL`, `GRIN`, `SCOWL`, `SHOUT`, `BLINK` clips and the goblin's actuator tuning | `expression.ts` |
| `characters/goblin.blob` | data | `bone jaw`, jaw split, teeth, mouth interior | existing jaw system |
| motion wiring (`motion.ts`, `actor.ts`) | glue | an `expression` input feeds `MotionFrame.jawGape` | `expression.ts`, `jaw.ts` |
| `lab-main.ts` | glue | in-place sheet update, expression panel, play | `expression.ts` |

`expression.ts` follows the pose layer's shape: plain data in and out, no `three`, tested alone (project rule: logic in pure
renderer-free modules, rendering in hand-written WGSL for the Rust + wgpu release port; this feature adds no WGSL).

### Channels, clips, actuation

A **channel** is a named scalar, roughly 0..1 (signed where noted): `gape`, `smile` (signed: negative is a frown),
`browDown` (signed: negative raises), `lipCurl`, `lid` (0 open, 1 closed). Channel names describe the face, never the
mechanism.

A **clip** is a list of timed keys, each `{ t, channels, ease? }`: the same contract as `PoseClip` (a channel a key does not
mention takes its rest value 0, interpolation per channel, one key holds). `expressionAt(clip, t)` returns the channel set.
A **blink** is a short overlay clip that is multiplied onto `lid` so it composes with any base expression.

**Actuation** is a pure function `actuate(channels) -> { jawGape, sheet }`:

- `jawGape` (rad) = `gape * GOBLIN_MAX_GAPE` (tuned, at or under `JAW_MAX_GAPE 0.9`).
- `sheet` = overrides on the goblin's authored `FaceSheetParams` (`mouthCurve`, `mouthWidth`, `mouthOpen`, `browAngle`,
  `browHeavy`, `eyeSquash`, `eyeSize`). The goblin's authored `sheet` block is the neutral; channels offset it.

C (later) adds a third output, per-prim morph deltas, without touching clips or channels.

### The rig side

- `goblin.blob` gains `bone jaw parent=neck` as a carrier, the bride's way (a carrier with a named tail; the jaw rotates
  about `JAW_HINGE`, not the bone's head). The hinge height will be re-tuned for the goblin's lip line in the spike.
- **Jaw split.** The face block's lower-face ellipsoid is replaced by two mass prims on the same line and taper (the bride's
  split): the upper part stays on the skull, the lower part rides the jaw. They start below the lip line so the top cap does
  not swing down and fill the opening. A pin keeps the rest silhouette (profile and front) within a few millimetres of today's.
  The lower lip prim and the chin ride the jaw. The mouth groove stays on the skull. Exact numbers are for the spike.
- **Teeth.** About 11 prims on the skull (upper) and the jaw (lower): about 5 upper and 4 lower small teeth of uneven length
  plus two longer fangs. Roots 3-5 mm inside the flesh, pointed, chamfered, dirty ivory, low gloss (the cultist's lesson:
  clean ivory under the key light reads yellow). Closed, the lips cover them, with fang tips allowed to just touch the lip line.
- **Mouth interior.** A dark wet bar on the skull behind the lips, buried under the rest face so it paints nothing at rest, which
  the opening jaw exposes as the throat (the bride's trick).
- **Wiring.** A new `expression` field next to `cfg.pose` produces `jawGape` for the existing `MotionFrame.jawGape` path (and
  the jaw point's pin target via `jawTargetAt`).

### The sheet side

`lab-main.ts` gets `updateFaceSheet(params)`: regenerate with `generateFaceSheet`, rewrite the existing `DataTexture` buffer in
place, `needsUpdate`, and `setFaceTexture(tex, atlas, mean)` (the mean is measured per sheet, never assumed, or the whole
head's brightness shifts). It runs only when the quantised sheet params change, at most once per frame. The crowd shares one
sheet, so every goblin instance in the lab shares an expression; that is acceptable for the lab and the screen lab (one goblin).

### Cost

A 64x64 regeneration is 4,096 texels of arithmetic plus a 16 KiB upload, negligible; the real cost is about 11 more SDF
prims on a character that is already heavier than the zombie (the goblin-home accessories cost +2.3 to +5.5 ms in the
screen lab, spread over all added prims with no single trim saving more than 0.8 ms). The plan measures the delta with the
repo's frame-cost tooling and trims by count before shipping. Teeth near the camera only matter close up, so a cheap
distance gate on the tooth prims is an option if the number is too high.

## Risks and how the plan handles them

1. **A small gape may not read as a grin.** The lips are static prims, so a grin cannot lift the lip off the teeth. Task 1 is a
   look-dev spike that decides it with frames. If gape plus a darker mouth and a wider sheet mouth does not read, the
   fallback inside A is a small lip-offset channel (the upper lip prims riding a second tiny carrier); if that fails, the
   owner's own fallback is C.
2. **The jaw split can change the approved head.** Pinned by a silhouette test against the current head.
3. **A new bone changes the skeleton.** `goblin-kit.wam` transcribes `goblin.blob`'s skeleton by hand and a parity test caught
   the bride's `jaw` the same way. The kit's skeleton gains the bone (geometry unchanged), as Task 13 did for the bride.
4. **`rig-bind` `ridesHead` trap:** any zero-length blob in the head limb rides the rigid head transform about the skull pivot
   even if declared on the neck (the goblin's neck vertebra bead already has this latent bug). New teeth must be real
   short bars or blobs with a tip, never accidental points on the wrong bone.
5. **Fine surface detail must stay small** (owner constraint): no new grain or mottle on the teeth or the interior; they
   get flat colour with low gloss.
6. **The pose layer's stepActorMotion path is not exact** (dualmem warning): the lab's pose captures re-hang points after the
   pinned step. Expression frames are judged at rest pose, where it does not apply, and the jaw is driven by the scalar.

## Verification

- **Pure tests:** `expression.test.ts` (interpolation, held ends, blink overlay composition, `actuate` mapping, mouth-curve
  sign, rest = authored sheet unchanged).
- **Blob tests:** `goblin-blob.test.ts` pins still pass (arm daylight, fuse, head size); new pins for the jaw split silhouette
  and the tooth prims riding the right bones; the kit skeleton-parity test passes with the jaw bone.
- **Commands:** `npm run typecheck`, `npm run test:changed`, `npx vitest run <path>`. Never the full suite.
- **Look-dev (the owner judges):** `npm run blob:shot -- goblin` (own `LAB_VITE_PORT`/`LAB_CDP_PORT`, never the owner's
  5173) for a turntable, plus a sheet of the expressions (front and three-quarter, with and without the sunglasses) in
  `docs/dev-notes/2026-10-13-goblin-expressions/`, with a NOTES.md. Report frame cost before and after as a number.
- **Docs:** update `TASKS.md` and `docs/tasks/characters.md`.

## Out of scope (this chip)

Surprise and sneer (data additions later); the screen-emergence lab wiring (follow-up after #46 and #47); per-prim morph
targets (approach C, only if the owner rejects the A result); other characters; sound; the first-person game's face (the
goblin appears there as arms only).
