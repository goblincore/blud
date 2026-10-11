# The screen emergence, lab spike: notes (2026-10-11)

**Spec:** [`2026-10-11-screen-emergence-lab-spike-design.md`](../../superpowers/specs/2026-10-11-screen-emergence-lab-spike-design.md) · **Plan:** [`2026-10-11-screen-emergence-lab-spike.md`](../../superpowers/plans/2026-10-11-screen-emergence-lab-spike.md) ·
**Parent draft:** [`2026-10-01-flat-screen-emergence-design.md`](../../superpowers/specs/2026-10-01-flat-screen-emergence-design.md) · **Look-dev it follows:** [`2026-10-01-flat-emergence-lookdev`](../2026-10-01-flat-emergence-lookdev/notes.md).

**Sheet:** [`sheet.jpg`](sheet.jpg): the old Blender animatic on top, then one lab frame per shot (glass gives t 2.0, push 5.5, crowning 8.0, out 10.0, settle 13.0), from the headless check below.
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
| The goblin's `reach` and `touch` clips (angles only) | `characters/goblin-poses.ts` |
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
