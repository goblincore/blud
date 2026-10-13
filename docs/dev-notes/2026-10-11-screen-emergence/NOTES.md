# The screen emergence, lab spike: notes (2026-10-11)

**Spec:** [`2026-10-11-screen-emergence-lab-spike-design.md`](../../superpowers/specs/2026-10-11-screen-emergence-lab-spike-design.md) · **Plan:** [`2026-10-11-screen-emergence-lab-spike.md`](../../superpowers/plans/2026-10-11-screen-emergence-lab-spike.md) ·
**Parent draft:** [`2026-10-01-flat-screen-emergence-design.md`](../../superpowers/specs/2026-10-01-flat-screen-emergence-design.md) · **Look-dev it follows:** [`2026-10-01-flat-emergence-lookdev`](../2026-10-01-flat-emergence-lookdev/notes.md).

**Sheet:** [`sheet.jpg`](sheet.jpg): the old Blender animatic on top, then one lab frame per shot (glass gives t 2.0, push 5.5, crowning 8.0, out 10.0, settle 13.0), from the headless check below. **It shows the state after look round 1** (below); the first round's sheet is in the PR #47 history.
**The home clothes:** [`home-clothes.jpg`](home-clothes.jpg) (front, side, back at rest; and seated).

## What is built

A scrubbable lab page, `/sdf-screen-lab.html` (dev-served; run `npm run dev` and open it; `?t=9.5`, `?shot=crowning`, `?free=1`, `?nopass=1`, `?nogoo=1`, `?character=goblin` for the plain goblin, `?sdfscale=`, `?rim=`, `?fill=`):
the goblin at his CRT, the screen goes fluid, the egg (a stand-in, bigger than the glass) pushes about 0.73 m out, the sac tears with a wet rolled lip, strands and drips of milky mucus, the egg slumps onto the desk shoving the keyboard aside, the goblin's hands come down on it, and the sheet heals wrinkled and glistening with the bezel still bowed. 14.5 s, one clock, deterministic.

| Part | Where |
| --- | --- |
| Cue curves, shots (the only source of `t`) | `webgpu/emergence-timeline.ts` |
| The CPU twin of the field: the sac (a dome smooth-unioned with the egg, tapering from its equator to the lip), the egg's fall, the lip's bow, the sheet's thickness, the tear (a ragged sphere cut at the tip, knitting to a slit as it heals), the wrinkle, the picture's inverse-stretch table | `webgpu/emergence-field.ts` |
| Strands, beads, drips, pools (a seeded Verlet sim replayed from t = 0, so a scrub equals a playback) | `webgpu/goo-strands.ts` |
| The march and the shading (WGSL, one function per string, built from the twin's constants) | `webgpu/screen-emergence.wgsl.ts` |
| The page: renderer, the set, the real SDF goblin through `createSdfLayer` + `createCharacterView` and the pose layer, controls, the seam `window.__screenLab` | `webgpu/screen-lab-main.ts`, `screen-lab-goblin.ts` |
| The goblin's floor clips (angles only: `floor-type`, `lean-back`, `brace-back`, `sit-up-look`; round one's chair clips stay registered, unplayed) | `characters/goblin-poses.ts` |
| The home goblin: `goblin.blob` plus a marked block of `shell` cloth (a vest, shorts) and bare feet | `characters/goblin-home.blob` (guard test: minus the block it equals `goblin.blob`) |
| The headless check (compile check, five shots, a sheet, cost) | `scripts/screen-emergence-check.sh` / `.mjs` (`npm run emergence:check`) |

## How to check it

`npm run emergence:check` (own ports 5244/9244, output in `.lab-tmp/screen-emergence/`): fails on any console error or WebGPU validation message (a deliberate typo in the WGSL was confirmed to fail it: nothing in node compiles WGSL),
captures a frame per shot, builds the sheet next to the animatic, reads the cost with the pass off, on, and on with the goo shadow, and fails if the pass adds more than 8 ms (or the on-frame exceeds 33 ms where the baseline allows).
The pure modules have their own tests (field properties, strand stability and determinism, timeline continuity, the shader's constants against the twin, the pose clips).

## Cost

1280 x 800, the page's SDF scale 0.5, the game's march settings (they halve the goblin's cost; the lab's own are far slower), median of `timeDraws(21)`:

| Shot | pass off | pass on | pass on, goo shadow on |
| --- | --- | --- | --- |
| push (5.5) | 23.4 | 24.0 | 24.1 |
| crowning (8.0) | 23.7 | 27.8 | 28.0 |

The goblin alone is about 23 to 25 ms here, nearly all the cost. The pass adds 0.5 to 4 ms; the goo shadow under 0.5 ms. **The home goblin adds 2.3 ms seated and 4.6 to 5.5 ms in the over-the-shoulder shots** (15 more prims, the leg clusters grew from 3 to 9),
so crowning with the home goblin reads about 33 ms. A machine under load moves a single median by about 10 ms. The page calls `gooAt(t)` each frame from t = 7 (cached per t; 0.2 to 10 ms of CPU, replayed from 0): a later incremental cache.

## What the owner is judging (look round one)

1. **The membrane and the egg**: does the sac read as skin, not balloon or pipe (it was a rigid tube until the taper fix); the tear's rolled pink lip (it reads as flesh); the hole itself (egg and membrane are close in colour inside the tear).
2. **The goo**: milky and glossy, as the look-dev found it must be. **Known weak:** most strands lie on or inside the egg, because it rests in the screen's mouth (its back is at z 0.01 inside the bowed lip) and the goblin's knees stop it resting further forward, so no strand spans a visible gap for long; the slick under the egg reads a bit like cream paint.
3. **The sequence**: the egg falling and landing (it shoves the keyboard aside), the hands cupping it (a big dark blob in the settle shot: the hand prim is 6 cm), the heal.
4. **The set and the goblin**: he is dark from behind (a cool rim and fill were added; still dark in push and out); the settle shot's left half is his limbs.
5. **The home clothes** (SDF cloth, the owner's choice over a mesh kit): a singlet and shorts. Still wrong: the neck is a flat boat neck (one clip plane per shell cannot cut a scoop); the folds are weak and read as stains under the body's mottle; the vest is a stiff A-line; the lower cheeks press through the shorts; the feet sit on a 13 cm lower-leg extension (the skeleton's ankle at y 0.157 is the real fix, outside the home block).

## Decisions and changes worth knowing

- **The sheet is a shell round a solid, not a heightfield shell**: a heightfield `|z - sacZ|` cannot be hit from the side where `sacZ` jumps at the egg's silhouette. The twin keeps `sacZ` for the properties and a `sacSolid`; the shader's solid is exactly its surface, walls included.
- **The sac tapers** (`SAC_BLEND`, `DOME_EXP` 0.5) so it reads as a bulb on a soft neck, not a prism; **the egg leaves the sac** as `slump` rises (`eggHeld`), and falls ease-in with a small settling bounce (`SLUMP` in the field).
- **The tear is a ragged sphere** around the sac's apex, not a cylinder (a cylinder grazed the sac's walls and made slivers); `TEAR_RAG` holds the harmonics for both twins.
- **`EGG_REST`** is `[0, DESK_Y + EGG.ry, 0.185]` (it was 0.4, over the goblin's knees); the desk top reaches z 0.365, knee clearance 0.016 m.
- **Game march settings** (`game-march-accept.ts`, moved out of `game-spawn.ts` so the page does not import half the game) halve the goblin's cost.
- **Seat and desk come from the goblin's measured joints** (`measureSeat`): glass centre 0.828 m above the floor, 0.82 m in front of the hips; shells are skipped in the measurement (a shell's bounds are its unclipped base capsule).
- **`timeDraws` can hang about one run in four** (suspected: `resolveTimestampsAsync` colliding with the loop's own timestamp drain). The check wraps each read in a 20 s race and retries; the root cause is in `lab-renderer` or the seam, not fixed.
- **The picture is the Night Train still** committed for the iMac (`public/assets/lab/screen-source.png`).

## Knobs for the look rounds

The curve keys in `emergence-timeline.ts` (timing and amounts); `SAC_BLEND`, `DOME_EXP`, `LIP`, `TEAR_RAG`, `SLUMP`, `WRINKLE` in `emergence-field.ts`; the goo's blend, radii, milkiness and the strand slack in `goo-strands.ts` / the WGSL; the egg's colour and the membrane's; the cloth lines in `goblin-home.blob`.

## Out of scope, still (the spec's list)

Two scenes in one page; extending `ending-sequence.ts`; hooking the Night Train montage's last frame to the pull-back; the early-stage Flat as a level state (CRT and vest instead of the Giger iMac); a live CRT picture; the final egg (paused); sound; the playable Flat.

## Look round 1 (2026-10-12 and 2026-10-13): the owner's notes and what changed

Plan: [`2026-10-12-screen-emergence-look-round-1.md`](../../superpowers/plans/2026-10-12-screen-emergence-look-round-1.md).

| The owner's note | What was done |
| --- | --- |
| The drips clip into the monitor after they recede | The drips hang from the lip's lower rim, which relaxes up and back during the heal, so they ended inside the chin. They are now anchored on the outside of the chin face (`DRIP_FACE_Z`), retract from `heal` 0.15 to 0.7 (the tip rising, the radius thinning), and never lie inside the housing (a test checks a 0.05 s grid). The pools they leave stay |
| The drips are white; they should be the colour of the rest of the goo | The goo base was near-white, so each piece took the colour of whatever lit it (the drips got the lamp, the egg's light and a white sheen). Strands, beads, drips, runs, the slick and the keyboard coat now share one palette (`GOO_LOOK` in `emergence-field.ts`) and one shading function (`scrGooShade`); the egg's light on goo drops once the egg is on the table; a test pins that every goo path uses it. The tear's rim stays flesh-pink |
| The egg is too big; still a bit smaller | 0.175 x 0.225 x 0.175 to 0.14 x 0.18 x 0.14 to **0.123 x 0.158 x 0.123 m** (0.70 of the original). The sac's reach stayed about 0.65 m (`SAC_MAX` 0.646; **0.45 m since the third notes**, below); the lip still gives (opened half-height 1.02 x the egg's `ry`) |
| The strands, "the lines across the egg", look like random lines; a less shiny, more speckled eggshell; something moving visible only in intense light | The egg is an **eggshell**: matte cream, brown speckles (3 to 9 mm, denser at the blunt end), fine grain, a broad dim highlight, no glass glint, no outline, no lines. **Backlit translucency**: where the lamp is behind it, under it, or the egg's own light is strong (in the sac), the shell glows warm and a dim shape (three Gaussian blobs: body, a nodding head, a flexing limb) drifts inside; side-lit it is opaque. The membrane keeps veins but they are now a **branching tree** (7 trunks forking 3 times, thinning toward the apex and with `thin`) |
| The goblin should back away to let it out, not raise his arm | `jolt`/`recoil` are no longer used. He leans back (0.9 s) and scoots 0.55 m back on his cushion as the glass swells, braced on straight arms behind him, and stays back through the push, tear and out; as the egg lands he comes forward onto his knees and puts a hand on it (**superseded by the third notes**, below: a 0.2 m pushback, a slight lean, and he sits up and looks). A test checks his arms are never above his shoulders at any `t`, and that he stays more than 0.3 m clear of the sac from 3.45 to 10.4 s |
| The desk and elevated chair do not match the apartment (floor level) | The set is the Flat's **low kotatsu**: the board is **0.385 m** above the floor he sits on (`flat_layout.py`'s `KTOP` 0.44 is measured from the room box's floor, and the tatami top is 0.055 above it), 0.82 m square, a quilted skirt; he is cross-legged on a plump zabuton; the tower is on the floor; no chair, no desk |
| I do not want the keyboard to move out of the way; covered in egg goo when the egg comes out | `keyboardShove` is deleted. The egg lands **on** the keyboard (`EGG_REST` y = key tops + `ry`); a glossy goo coat spreads over the keys (0 before 10 s, 0.40 at 11, 0.72 at 11.5, 0.87 at the end), the keys faintly visible through it; drips land on the keys; three runs go over its front edge onto the board and leave pools |
| Render at 640x480 for previewing (the machine gets hot) | The page renders a fixed 640 x 480 by default; the controls have a res select (800x600, 1280x800) and `?res=` does the same. The headless check keeps 1280 x 800 (`&res=1280x800`) |

**Cost after the round** (`npm run emergence:check`, 1280x800, one run on a loaded machine): push 19.5 ms with the pass off and on (the pass adds 0.1 ms); at crowning the pass adds about 4.5 ms (the pass-off reading at crowning that run was not meaningful). A previous run of the same check read 73 to 129 ms with another Chrome rendering the page, so treat all of these as indicative; a quiet-machine re-measure is still owed.

### The owner's third notes (2026-10-13): what changed

| The owner's note | What was done |
| --- | --- |
| His face is the default zombie's (a flat zombie face with red glowing eyes), not his own | The lab copied the game's skin but took the registry's face slot, which for `goblin` / `goblin-home` is the shared `ZOMBIE_FLAT` texture. It now **generates his face from his own `sheet` block** (`generateFaceSheet`, as the WebGPU lab's `loadGeneratedFace` does): green grained skin, his brows, nose, mouth seam and glowing eye slits. The **sunglasses** in the old lab shots are the armour kit's (`goblin-kit.gltf`), which the lab retires at home by design: not restored (an owner call) |
| The egg extends a bit too far before it goes back in | The sac's apex at full push is **0.45 m** (`SAC_MAX` 0.449, `EGG.z1` 0.32; it was 0.646). The egg keeps its size; the lip still gives. With the egg only 0.32 m out the full dome swallowed the neck (a funnel round the egg), so the dome is less full (`DOME_EXP` 0.85, was 0.5) and the tent blend a little narrower (0.10, was 0.12): the bulb sits on a neck again (the wall 3.5 cm in from the equator top and bottom; a test pins 2.5 cm or more). The proxy box is 0.62 m deep (was 0.95) |
| The goblin slides back too far; a slight pushback and lean back | The pushback is **0.2 m** (was 0.55), eased over 2.3 to 3.45 s, held to the end. `brace-back` is a slight lean: the trunk 20 degrees back, the hand balls on the floor 0.45 m behind the hips (0.57 on straight arms before), the elbows bent 50 degrees; his nearest flesh stays 0.32 m short of the apex's plane |
| His head does not look at the egg when he sits up | The head aim is tested on the page's own head rotation (`headQuatOf`, its gaze cone included): leaning back (3.5 to 10 s) the head's forward axis is within 8 degrees of the sac's apex (the test allows 15); from the egg's landing (11.2 s) to the end within 1 degree of the egg's centre (the test allows 10), pitched 22 degrees down |
| No hand raising to touch the egg; the sequence ends, then the player takes over | `crawl-in` / `crawl-reach` are gone; **`sit-up-look`** (10.4 to 12.0 s, held) sits him upright on the cushion, legs still crossed, the hand balls resting on his knees, the head down at the egg. His flesh stays 0.46 m or more from the egg. The chair-era `touch` / `reach` / `jolt` / `recoil` stay registered (the pose library's tests use them), unplayed |

### Two findings worth carrying forward

- **The lab page was not rendering the poses the tests checked.** `stepActorMotion` pins the rig to the pose, but two later passes (`pinTips`, which hangs hand tips and toes at their rest offsets, and `constrainRigBends`, the knee and elbow stops) folded the crossed shins and dropped the hands, so the page measured the board 4 cm low while the tests, which pin the rig straight to the joints, passed. The fix is local to the lab (`pinToPose` in `screen-lab-goblin.ts`, with a test that the page's path and the tests' path give identical flesh). `actor.ts` is unchanged, so `lab-main.ts` pose captures and the actor path generally still have it: a separate task.
- **`pose.ts` gained** one-sided keys, a `root.y` for keys that turn the ground lock off, and a `fwd` foot that turns as a whole (all backward compatible; tests pin it).

### Still open after the round

The glass-gives shot never shows him on the floor (the push-wide shot is the first view that does); he is large in the out shot; the right foot sits ~6.7 cm inside the left thigh (hidden by the flesh union); the hands are the goblin's green orbs, so "flat" hands read as balls; the runs off the keyboard edge look stiff, like pegs; the slick catches large white highlights from the lamp; seen from low the coat reads as a thin film; the figure inside the egg is soft and slightly purple; the veins thin to about a pixel at crowning; the settle preset is partly backlit so the egg is peachy there (the owner may want less); he is dark from behind; the cloth's neck, folds and feet (Task 10's list); a quiet-machine cost re-measure.
