# The Flat set and the screen emergence — Design (DRAFT)

**Date:** 2026-10-01 · **Status:** **draft for the owner's review.** The decisions marked *owner* were made in chat on
2026-10-01; everything marked *proposed* was written while the owner was away and waits for a yes. Not built.
**Kind:** design. **Part 1 of 3** of the monitor-room work (§0). **Follows:** the [ending spec](2026-09-30-night-train-egg-ending-design.md)
§6 ("pull back out of the big CRT to the desk and the goblin playing; the egg pushes out of the glass, wet").
**Look-dev:** [Blender animatic + the Flat blockout](../../dev-notes/2026-10-01-flat-emergence-lookdev/) (key frames, a short
clip, the generator script, and the real SDF goblin meshed from `goblin.blob`).

## Why

- The owner: after the egg ending, **the monitor room**. "The big effect is the transition of the egg from the monitor:
  the screen becomes a fluid membrane and the egg comes out of it, all gooey and shiny. Gooey and shiny are key terms."
- It is the vision's signature image (vision §8.1: "glass creaking in a way glass can't, a wet stretch, a slap on the desk,
  the membrane settling slowly, and a film on the glass that stays"), and the first time the player sees the Flat.
- It can proceed without the final egg (the owner paused the egg design, 2026-10-01); the egg here is a stand-in.

## 0. The three parts (owner, 2026-10-01)

1. **The emergence (this spec):** a basic Flat set, the pull-back out of the CRT, the membrane and the egg pushing through,
   the goblin in held poses. Ends on a hold until part 3 exists.
2. **Goblin animation ("better rigging"):** driving the SDF goblin's rig from authored poses (sit, type, recoil, stand,
   reach), authored on a Blender armature. Its own spec.
3. **The playable Flat:** fixed cinematic cameras that cut as the goblin moves, third-person control, the face rule,
   sitting back down to continue. Its own spec.

## Decisions

| # | Decision | Source |
| --- | --- | --- |
| 1 | After the egg lands, **control passes to the player** in the Flat (part 3; until then, a hold) | owner |
| 2 | The Flat is seen through **fixed cinematic cameras**, third person, never the goblin's face (part 3; this spec's shots obey it) | owner |
| 3 | The look is **90s ray-traced CGI** for the whole game: the CS 348B competition, the IRTC (POV-Ray) stills, PSX-era prerendered cutscenes; plus the game's modern effects ([design statement §1.1](../../game/design-statement-draft.md)) | owner |
| 4 | **The goblin is the game's SDF goblin** (`goblin.blob`) with its own skin (the palette's green, mottle, clammy sheen), not a separate model | owner |
| 5 | The Flat is a **second scene in the same page**, loaded alongside the FPS level, not a `?level=` reload | proposed |
| 6 | The CRT shows a **captured still** of the last FPS frame; live render-to-texture (Flat task F-T2) stays later | proposed |
| 7 | The membrane is a **dense mesh sheet** carrying the captured image, displaced in the vertex stage by an analytic "tent over the egg"; not an SDF | proposed |
| 8 | The goblin holds **authored poses** made by overriding the `.blob` skeleton's bone angles (as the look-dev does); part 2 replaces this with animation | proposed |
| 9 | The egg is a **stand-in** (a small candled egg with an inner light) until the egg design is settled | proposed |
| 10 | The shots run on the **existing sequence system**, extended with a per-shot scene and two camera kinds | proposed |

## 1. The Flat set (a first, basic version)

Built in Blender through the level pipeline as its own level asset (`the-flat`), like the void and the Wake. Sizes follow
the [Flat design](../../game/flat/design.md): about 4 × 5 m, a 2.4 m ceiling, goblin-sized furniture (world law 5).

| Part | Content (blockout) |
| --- | --- |
| Shell | Dirty green-grey walls, brown lino floor, a grey ceiling with three pipes along it and one across (the music's route) |
| Desk | North wall, top at 0.6 m: the beige 15-inch CRT (screen 0.30 × 0.225 m), the PC tower with its CD tray, keyboard, mouse, cans, a green banker's lamp |
| Chair | A tall office chair, too big for the goblin; a low back so the hunched spine reads from behind |
| Room | The high window (streetlight blue, feet pass later), the mattress, the CD shelf, a bucket under a drip, the door (south) |
| Light | The lamp (warm, the key), the screen (its colour follows the image), the streetlight through the high window, a dim fill |

The set only has to serve this spec's shots; the walkable Flat (part 3) dresses it further.

## 2. The shots

From the animatic (key frames and timing). About 20 s. Cuts are hard unless noted.

| # | Shot | Camera | What happens | ~s |
| --- | --- | --- | --- | --- |
| 0 | (the montage's last frame) | — | The FPS image is captured; the montage cuts to it full screen | — |
| 1 | The pull-back | screen → over the shoulder | The image becomes the CRT's glass (scanlines, the tube's curve); the camera pulls back past the bezel to the goblin from behind, hunched, ears against the glow | 4 |
| 2 | The room | high corner | The Flat: the goblin small at the desk, the lamp, the dark | 2.5 |
| 3 | The glass gives | close, low, from the front-right | The picture swells into a dome, a ripple runs across it, the reflections slide | 2.5 |
| 4 | The stretch | same | The dome rises; where it stretches, the picture dims and the glass turns to pink skin, veined, lit from behind by the egg | 3 |
| 5 | Crowning | same | The skin tears at the apex; a wet pink lip rolls back round the egg; strands across its face; drips off the bezel | 2.5 |
| 6 | Out | behind and left of the goblin | The goblin is thrown back, arms up; the egg sits on the desk in a slick, tied to the torn screen by strands | 2.5 |
| 7 | Settle | low on the desk | The screen has healed, wrinkled and glistening, the picture distorted; the egg glows in its slick; drips | 3, then hold |

Shot 7's hold is where part 3 hands control over.

## 3. How it is built (proposed)

### 3.1 Two scenes, one page

The Flat loads as a **second scene** next to the FPS level (memory and pipelines warmed before the ending), and the
renderer draws whichever scene the current shot names. This is the seam the three-layer structure needs anyway (the
vision's "Escape pulls back a layer"), and it avoids a page reload and its cold pipeline compile in the middle of the
sequence. **Risk to resolve in the plan:** the SDF layer marches bodies from the level scene; the goblin must march in the
Flat scene. A per-scene body list or moving the goblin's body into the SDF layer for the Flat shots.

### 3.2 The screen

- **Capture:** at the end of the montage, the final frame is copied into a texture (the post-aa capture stage,
  `post-aa.ts` `captureTarget` / `setCaptureStage`, is the starting point). The CRT's screen material samples it with
  scanlines and the tube's curvature. Shot 1 starts with the camera framing the glass exactly, so the cut from the FPS
  frame to the CRT is invisible.
- **The membrane:** a grid of about 150 × 112 vertices over the screen, its UVs fixed, so **the picture stretches with
  the sheet**. Per vertex, in the vertex stage:
  - **the tent:** a smooth maximum of the tube's convex glass and the egg's front surface, widening as the egg pushes
    (the look-dev's function, `membrane()` in the generator script); clamped to zero at the bezel;
  - **radial folds** where the sheet is dragged into the tent; a ripple in shot 3; a slow wrinkle for the healed sheet;
  - **stretch** (from the displacement and its slope) passed to the fragment stage.
- **Fragment:** the picture as emission, dimming as stretch rises; under it a wet clear coat; where stretched, translucent
  pink flesh with ridged veins, lit from behind by the egg's light (a wrap term from the egg's position). **Tear:** a
  discard mask (an ellipse round the egg, ragged by noise) opened by a `tear` uniform.
- **The lip:** a ring mesh along the tear, pink, wet, slightly irregular. **Strands and drips:** tube meshes whose points
  are a small spring simulation on the CPU (a few points each), so they stretch, sag and snap; drips grow and bead.
  **The slick:** a flat glossy decal-like mesh on the desk.

### 3.3 The goblin

The SDF goblin (`goblin.blob`) in two **held poses**, type and recoil. A pose is a set of bone-angle overrides on the
`.blob` skeleton (`spine1 pitch 20, chest 27, neck 24, skull −6, thigh 86, shin −4, upperarm 40, forearm 80, hand 70` for
typing; the recoil throws the spine back and the arms up). In the look-dev these overrides are compiled and meshed from the
SDF on the CPU; in the game the plan finds the narrowest seam to make the rig hold a recompiled rest pose (pinned, no gait).
It wears its own skin (the palette's green, mottle, clammy sheen; `goblin-skin.ts`); its polygon armour kit poses with the
same bone angles if the owner wants it in the Flat (open question 4). Part 2 replaces the held poses with authored
animation. **Precedent and warning:** the isometric experiment (branch `iso-experiment`)
put the goblin's SDF body on screen as the player and hit a march bug where that body drew nothing; read its notes first.

### 3.4 The egg (stand-in)

A small egg (about 0.15 × 0.2 m, so it can pass through a 0.30 × 0.225 m screen) with a candled look: an opaque, glowing
shell, faint vessels, a dark shape inside, its own small light. It is replaced when the owner settles the egg design.

### 3.5 The sequence

`ending-sequence.ts` gains:

- a **scene per shot** (`fps` | `flat`);
- **camera kinds:** `fixed` (exists), a two-pose `move` (eye and look interpolated, for the pull-back) and authored named
  cameras in the Flat;
- **cues** for the membrane's parameters over a shot: the egg's depth, `tear`, ripple, sag, settle, from authored curves.

All pure and unit-tested. The `ending` sequence appends these shots after the montage (plan 4 of the ending spec) or, until
plan 4 exists, after the current two-shot stub.

## 4. Verification

- Unit tests: the tent function (zero at the bezel, wraps the egg, monotone in the egg's depth); stretch; the tear mask;
  the spring strands (stable, length-limited); the new camera kinds and per-shot scene in `ending-sequence.ts`.
- A headless check (in the style of `sdf-egg-check`): walk the sequence, capture each shot's key frame, compare against
  the animatic's frames as a sheet (look, not pixels), check the cut from the FPS frame to the CRT has no visible jump,
  measure cost.
- The loop gate's section 5 extends to the new shots; the other gates stay green.

## 5. Out of scope

- The playable Flat (part 3), goblin animation (part 2), live render-to-texture, sound.
- The final egg (paused).
- The Flat's later stages (soft PC case, door, ceiling).

## Risks

- **Two scenes in one page:** memory, warming the Flat's pipelines before the ending, and the SDF layer drawing the
  goblin in the Flat (§3.1). This is the riskiest item; the plan should spike it first.
- **The held pose:** whether the rig can hold a recompiled rest pose without its gait or the wound system fighting it.
- **The goblin's look in the Flat:** the game's skin shader under the Flat's lamp; the look-dev's Cycles finish is a
  target, not a guarantee.
- **The cut from the FPS frame to the CRT:** the capture must match the framing, or the pull-back's first frame jumps.

## Open questions for the owner

1. Approve decisions 5–10, or change any?
2. The egg's size coming out of a 15-inch screen: small enough to fit (as drawn), or bigger than the screen so the
   bezel itself deforms (more grotesque, more work)?
3. Does the goblin touch the egg in this sequence (reach, pick it up), or is that part 3's first player action?
4. Does the goblin wear its armour kit (`goblin-kit.gltf`: plates, bracers, boots, axe and shield) at home in the Flat, or
   only inside the game? The look-dev shows both ([kit option](../../dev-notes/2026-10-01-flat-emergence-lookdev/goblin-kit-option.png)).
