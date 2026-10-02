# The Flat set and the screen emergence — Design (DRAFT 2)

**Date:** 2026-10-01 · **Status:** **draft 2, for the owner's review.** Draft 1 was written while the owner was away; the
owner's feedback (same day) is folded in and marked *owner*. What is still *proposed* waits for a yes. Not built.
**Kind:** design. **Part 1 of 3** of the monitor-room work (§0). **Follows:** the [ending spec](2026-09-30-night-train-egg-ending-design.md)
§6 ("pull back out of the big CRT to the desk and the goblin playing; the egg pushes out of the glass, wet").
**Look-dev:** [Blender animatic, the Flat blockout, the SDF goblin in Blender, the CRT](../../dev-notes/2026-10-01-flat-emergence-lookdev/).
The animatic is a **preview only**: the owner wants the scene in the engine, and found the Blender render a little too
smooth for period CGI.

## Why

- The owner: after the egg ending, **the monitor room**. "The big effect is the transition of the egg from the monitor:
  the screen becomes a fluid membrane and the egg comes out of it, all gooey and shiny. Gooey and shiny are key terms."
- It is the vision's signature image (vision §8.1: "glass creaking in a way glass can't, a wet stretch, a slap on the desk,
  the membrane settling slowly, and a film on the glass that stays"), and the first time the player sees the Flat.
- It can proceed without the final egg (the owner paused the egg design, 2026-10-01); the egg here is a stand-in.

## 0. The three parts (owner)

1. **The emergence (this spec):** a basic Flat set, the pull-back out of the CRT, the screen giving and the egg pushing
   through, the goblin in held poses. Ends on a hold until part 3 exists.
2. **Goblin animation ("better rigging"):** driving the SDF goblin's rig from authored poses (sit, type, recoil, stand,
   reach), authored on a Blender armature. Its own spec.
3. **The playable Flat:** fixed cinematic cameras that cut as the goblin moves, third-person control, the face rule,
   sitting back down to continue. Its own spec.

## Decisions

| # | Decision | Source |
| --- | --- | --- |
| 1 | After the egg lands, **control passes to the player** in the Flat (part 3; until then, a hold) | owner |
| 2 | The Flat is seen through **fixed cinematic cameras**, third person, never the goblin's face | owner |
| 3 | The look is **90s ray-traced CGI** for the whole game (CS 348B, IRTC/POV-Ray, PSX FMV) plus the game's modern effects, and **not too smooth**: period CGI had aliasing, hard terminators and visible procedural noise ([design statement §1.1](../../game/design-statement-draft.md)) | owner |
| 4 | **It runs in the engine**, with the game's own SDF goblin. Blender is for look-dev only | owner |
| 5 | **The screen is SDF** (with the bezel's inner lip), so it can stretch and tear; **the rest of the monitor is a hard mesh**, modelled after the owner's reference, a ViewSonic P225f (22-inch, flat glass) | owner |
| 6 | **The egg is bigger than the screen.** The bezel's lip deforms round it, and the screen balloons a long way out before it gives | owner |
| 7 | **At home the goblin wears a stained vest and shorts**, not its armour | owner |
| 8 | The goblin is `goblin.blob` with its own skin (the palette's green, mottle, clammy sheen) | owner |
| 9 | The Flat is a **second scene in the same page**, loaded alongside the FPS level, not a `?level=` reload | proposed |
| 10 | The CRT shows a **captured still** of the last FPS frame; live render-to-texture (Flat task F-T2) stays later | proposed |
| 11 | The SDF screen is a **dedicated hand-written WGSL march pass** (screen sheet, bezel lip, egg, goo) on a proxy box, in the pattern of `humanoid-view.ts` and the egg pass; not a body in the character pipeline (§3.2) | proposed |
| 12 | The goblin holds **authored poses** made by overriding the `.blob` skeleton's bone angles; part 2 replaces them with animation | proposed |
| 13 | The egg is a **stand-in** until the egg design is settled | proposed |
| 14 | The shots run on the **existing sequence system**, extended with a per-shot scene, two camera kinds and parameter cues | proposed |

## 1. The Flat set (a first, basic version)

Built in Blender through the level pipeline as its own level asset (`the-flat`), like the void and the Wake. Sizes follow
the [Flat design](../../game/flat/design.md): about 4 × 5 m, a 2.4 m ceiling, goblin-sized furniture (world law 5).

| Part | Content (blockout) |
| --- | --- |
| Shell | Dirty green-grey walls, brown lino floor, a grey ceiling with pipes along it (the music's route) |
| **The CRT** | After the P225f ([blockout](../../dev-notes/2026-10-01-flat-emergence-lookdev/crt-p225f.png)): front 0.50 × 0.47 m, a light-grey frame with a sloped inner bevel down to **flat glass** (viewable 0.406 × 0.305 m), a deep chin with a groove, a button row and a green LED, a dark-grey housing tapering 0.47 m back, side vents, a round swivel pedestal. The housing is mesh; the glass and the bevel's inner lip are the SDF pass's |
| Desk | North wall, top at 0.6 m; the beige PC tower with its CD tray, keyboard, mouse, cans, a green banker's lamp |
| Chair | A tall office chair, too big for the goblin; a low back so the hunched spine reads from behind |
| Room | The high window (streetlight blue), the mattress, the CD shelf, a bucket under a drip, the door (south) |
| Light | The lamp (warm, the key), the screen (its colour follows the image), the streetlight through the high window, a dim fill |

## 2. The shots

From the animatic, revised for the owner's notes (a bigger egg, a longer push). About 22 s. Cuts are hard unless noted.

| # | Shot | Camera | What happens | ~s |
| --- | --- | --- | --- | --- |
| 0 | (the montage's last frame) | — | The FPS image is captured; the montage cuts to it full screen | — |
| 1 | The pull-back | screen → over the shoulder | The image becomes the CRT's glass (scanlines); the camera pulls back past the bezel to the goblin from behind, hunched, ears against the glow | 4 |
| 2 | The room | high corner | The Flat: the goblin small at the desk, the lamp, the dark | 2.5 |
| 3 | The glass gives | close, low, front-right | The picture swells into a dome, a ripple runs across it, the reflections slide | 2.5 |
| 4 | The push | same, then a cut wider | **The screen balloons out a long way** (most of a metre at its peak) as a sac with the picture stretched over it; where it thins, the picture dims to veined skin lit by the egg. **The bezel's lip bows outward** round the egg's widest part | 4 |
| 5 | Crowning | same | The sac tears at its tip; a wet lip rolls back round the egg; strands across its face; drips off the bezel | 2.5 |
| 6 | Out | behind and left of the goblin | The goblin thrown back, arms up; the egg slumps onto the desk in a slick, tied to the torn screen by strands | 2.5 |
| 7 | Settle | low on the desk | The sac sucks back into the frame and heals, wrinkled and glistening, the picture distorted; the bezel stays slightly warped; the egg glows in its slick | 3, then hold |

Shot 7's hold is where part 3 hands control over.

## 3. How it is built (proposed)

### 3.1 Two scenes, one page

The Flat loads as a **second scene** next to the FPS level (memory and pipelines warmed before the ending), and the
renderer draws whichever scene the current shot names. This is the seam the three-layer structure needs anyway (the
vision's "Escape pulls back a layer"), and it avoids a page reload and its cold pipeline compile in the middle of the
sequence. **Risk to resolve first:** the SDF layer marches bodies from the level scene; the goblin must march in the
Flat scene.

### 3.2 The screen: an SDF march pass

**Why a dedicated pass (proposed, decision 11).** The character pipeline builds bodies from rigged `.blob` primitives;
the screen is a sheet that inflates, tears and strings out goo, driven by a handful of animated parameters. A
hand-written WGSL march on a proxy box round the monitor's face (the pattern `humanoid-view.ts` and the egg pass already
use: a box, a ray, a hit, `depthNode` for real depth) keeps all of that in one function that is cheap to iterate. The
alternative, a static body in the character pipeline, gets the flesh shading for free but needs a new spawn path and
cannot express an inflating sheet with its primitives.

**The field** (all smooth-blended, which is where the goo comes from):

- **The sheet:** the glass's rest plane, its surface displaced by a **sac function** over the egg: a smooth maximum of
  the flat glass and the egg's front surface, widening as the egg pushes, so that at full push the sheet is a long
  rounded sac (the look-dev's tent, extended). A thin shell: `|d| − thickness`, thickness falling where it stretches.
- **The bezel's lip:** a rounded rectangular rim at the bevel's foot that bows outward and apart as the egg's cross-section
  exceeds the opening (decision 6). The mesh frame's inner bevel ends where the SDF lip begins, so the seam is hidden.
- **The egg** (the stand-in, §3.4), an ellipsoid with the candled look.
- **Goo:** strands as capsules between points on the tear's lip and the egg, beads as spheres, drips as tapered capsules;
  their points come from a small spring simulation on the CPU (a few points each). Smooth-unioned into the sheet and
  the egg with a wide blend, they web and neck like real mucus.
- **The tear:** a smooth subtraction opening from the sac's tip, its edge ragged by noise.

**Shading:**

- **The picture:** the captured frame, mapped from the rest plane through the inverse of the sac's stretch, so the image
  stretches with the sheet. Scanlines and a phosphor grain while it is glass.
- **Stretch:** dims the picture and turns the sheet to translucent, veined flesh lit from behind by the egg's light.
- **Wet:** a clear coat with hard, white highlights (decision 3).
- **Light:** a handful of uniform lights (the lamp, the screen's own glow, the streetlight) and hard shadows from the egg's
  light onto the goo, so the pass sits in the room the way the egg pass sits in the control room.

**Cost:** the box covers the screen and the sac's reach; the shots are close, so a fixed step budget (about 64) and an
early-out on the box. It is a cutscene, but it should hold the frame rate.

### 3.3 The goblin

The SDF goblin (`goblin.blob`) in two **held poses**, type and recoil. A pose is a set of bone-angle overrides on the
skeleton (typing: `spine1 pitch 20, chest 27, neck 24, skull −6, thigh 86, shin −4, upperarm 40, forearm 80, hand 70`;
recoil throws the spine back and the arms up). The plan finds the narrowest seam to make the rig hold a recompiled
rest pose (pinned, no gait). Part 2 replaces this with authored animation.

**At home it wears a stained vest and shorts** (decision 7). How they are built is the plan's question: the project's
rule is that augments are a `.wam` mesh kit (as the armour is), and the look-dev shows that a kit posed to the same bone
angles fits; coloured `.blob` primitives (a shell over the torso and hips) are the alternative if a mesh vest reads
badly against the SDF body. The owner is reworking the armour kit separately.

**Precedent and warning:** the isometric experiment (branch `iso-experiment`) put the goblin's SDF body on screen as the
player and hit a march bug where that body drew nothing; read its notes first.

### 3.4 The egg (stand-in)

Bigger than the screen (decision 6): about 0.35 m across and 0.45 m tall against the 0.406 × 0.305 m glass, so it cannot
pass without the lip giving. A candled look: an opaque, glowing shell, faint vessels, a dark shape inside, its own light.
It is replaced when the owner settles the egg design.

### 3.5 The sequence

`ending-sequence.ts` gains:

- a **scene per shot** (`fps` | `flat`);
- **camera kinds:** `fixed` (exists), a two-pose `move` (eye and look interpolated, for the pull-back), and named cameras
  in the Flat;
- **cues** for the screen pass's parameters over a shot: the egg's depth, the sac's reach, `tear`, ripple, settle, the
  lip's bow, from authored curves.

All pure and unit-tested. The `ending` sequence appends these shots after the montage (plan 4 of the ending spec) or,
until plan 4 exists, after the current two-shot stub.

## 4. Verification

- Unit tests: the sac function (zero at the lip, wraps the egg, monotone in the push); the lip's bow; the tear; the spring
  strands (stable, length-limited); the picture's inverse-stretch mapping; the new camera kinds, scenes and cues in
  `ending-sequence.ts`.
- The headless boot compiles the WGSL (nothing in node does).
- A headless check in the style of `sdf-egg-check`: walk the sequence, capture each shot's key frame, lay them out as a
  sheet beside the animatic's frames (look, not pixels), check the cut from the FPS frame to the CRT has no visible jump,
  measure cost.
- The loop gate's section 5 extends to the new shots; the other gates stay green.

## 5. Out of scope

- The playable Flat (part 3), goblin animation (part 2), live render-to-texture, sound.
- The final egg (paused) and the armour kit rework (the owner's).
- **The train seen from outside** (the sperm-shaped train on its rails into space): the owner wants it, its place is
  open. Candidates: the game's **intro cutscene** (new game flow: the first thing a player sees, the whole premise without
  words), the ending montage's shot 7 (already specified), and the **lift-off** after the Keep (vision §10.3). It needs
  the per-shot scene selector this spec adds and a silhouette built from the level's room table.

## Risks

- **Two scenes in one page:** memory, warming the Flat's pipelines before the ending, and the SDF layer drawing the goblin
  in the Flat (§3.1). The riskiest item; spike it first.
- **The screen pass's look:** wet, stretched, torn and goo in one marched field is the heart of the sequence; build it in
  the lab first, against the animatic and the owner's notes, before wiring the sequence.
- **The held pose:** whether the rig can hold a recompiled rest pose without its gait or the wound system fighting it.
- **The cut from the FPS frame to the CRT:** the capture must match the framing, or the pull-back's first frame jumps.

## Open questions for the owner

1. Approve the proposed decisions 9–14, or change any?
2. Does the goblin touch the egg in this sequence (reach, pick it up), or is that part 3's first player action?
3. Where does the exterior train go first: the intro cutscene, the ending montage, or the lift-off?
