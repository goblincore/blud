# Night Train ending: the control room, the egg, the montage — Design

**Date:** 2026-09-30 · **Status:** draft, scope B chosen by the owner in chat (2026-09-30); built through plan 3 (the sequence system) with a two-shot stub; the montage (plan 4) is next. **§2 (the egg) is superseded** by [the candled egg and the torn caul](2026-10-01-egg-candled-caul-design.md) (2026-10-01): a candled inner egg in a torn caul of wet flesh, no spots, so montage shot 4 loses its spot.
**Kind:** design (no code yet). **Changes:** the Night Train cab and ending; adds a level-ending sequence system.
**Context:** Night Train (level 1) is a good short first level, but it ends on a trigger in the cab and a "LEVEL COMPLETE" overlay (`level.end` → `completeOn`). The docs say *the first CD starts the pull-back into the Flat*, but the Flat, the CRT render-to-texture and the pull-back do not exist yet, and the CD (`dj-cd` on the Boiler Room's DJ deck) triggers nothing. This spec gives the level a real ending that needs none of those.
**Blockout:** [renders + .blend](../../dev-notes/2026-09-30-egg-ending/) (door view, cutaway overview, egg close-up).

## Why

- The train level needs an ending that reads as an ending, in the level's own terms.
- The owner wants short scripted sequences to be **abstract and evocative** (jump cuts, extreme close-ups, sequenced imagery) and never the plain "cut to a third-person shot of the hero doing the thing".
- The owner wants a big, semi-translucent, *alive and ominous* egg. It has no stated narrative meaning; symbolically it is the larval form of the screen bulge that comes later (vision §6.1: the CRT glass swells and the wet CD pushes out).
- The train, read from outside, is a **sperm** heading for the egg: a tail of ordinary carriages and a swollen head (the Boiler Room and the control room). The layout already swells toward the front (3.6–4.2 m carriages → the 8 m Boiler Room → an 8 m control room), and vision §10.3 already sends the train line up into space.

## Decisions

1. **The end room is a control room, not the cab.** The 3.0 × 8 m cab becomes an **8.0 × 10.0 m control room** (x −4…4, z −140.4…−130.4, ceiling 3.4 m), entered by the existing vestibule 7 from the tender. "Bigger on the inside", as the Boiler Room is. The Stoker is still later; the firebox moves to a glowing door in the east wall's north end so the room is still the engine's end.
2. **The egg is the room's one object.** It stands in the middle (centre x 0, z −136.7 in game coordinates, 6.3 m in from the south door; Blender blockout y 6.3), on a rusted plinth held by six clamps, with roots and cables running to the consoles. It is **nested**:
   - **outer egg:** large (about 1.9 m wide × 2.6 m tall), transparent, red-veiny, warm-lit;
   - **inner egg:** 0.6 scale, **milky, semi-translucent, spotted** (pale-teal raised spots, varied sizes), on the viewer-facing half;
   - **the figure:** a **soft, blurry dark silhouette** inside the inner egg against a warm backlight. It is hard to make out: no defined outline, broken up by noise, diffused by the milky shell. Who it is stays undecided (it may be the goblin).
3. **The CD stays separate.** `dj-cd` remains a Boiler Room collectible. The egg does not need it.
4. **Contact starts the ending.** Walking to within **1.6 m** of the egg's centre fires a once-only `egg.touch` event. It replaces the `level.end` trigger in `triggers`; `completeOn` becomes `ending.end`.
5. **The ending is a timed abstract montage** (§4), then a hard cut to black and a title card. The Flat and the pull-back are **out of scope**; they attach later at the end of the montage (§6).
6. **A sequence system is added** (§3): a pure timeline of shots, played by the game loop. It is reusable for later short scripted moments, in the same abstract style.

## 1. The control room

Kit and pipeline: Blender → `build_night_train.py` → `night-train.level.json` + `night-train.art.glb`, like every other room. The blockout is a rough guide, not final art.

| Part | Content |
| --- | --- |
| Shell | 8.0 × 10.0 m, 3.4 m ceiling, 1.4 m doorway south; steel ceiling beams every 2 m; two cable trays along z, two rusted ducts |
| Consoles | Five on the west wall and four on the east (the firebox door takes the east wall's north end): a desk, a sloped panel, a beige CRT on top with a lit screen, a keyboard; a rack at z ≈ −136.7 each side with status LEDs |
| North wall | A grid of beige CRTs, 9 × 3, every screen a different state (static, green, amber, dead); **one big CRT at the centre**, about 2.2 × 1.45 m, dimly lit. It foreshadows the screen in the Flat |
| Firebox | A rusted frame with an orange door on the east wall's north end; fire light as in the old cab |
| Lights | Dim emergency reds on the ceiling line; green/amber console glow; the egg's warm light is the room's main source and shadow-casting |
| Enemies | None. It is a quiet beat after the Boiler Room; the wheels, a low pulse and the consoles' hum are the room |

**Pulse.** The egg has a slow pulse clock (about 1 Hz) driving the glow and the screens' brightness. It quickens as the player approaches and gives one flinch when the shotgun fires in the room (stretch goal; not needed for the first cut).

**Budget.** The train gate allows +400 draws / +40 ms. The room adds draws (consoles, CRT wall, the egg pass); measure against the gate before adding detail, and follow the project rule of optimising after the look is right.

## 2. The egg

- **Drawing:** one hand-written WGSL pass in `sdf-layer`'s late scene (as the steam and the disco stars are), over a proxy box. It intersects the ray with the three nested ellipsoids **analytically** (outer shell, inner shell, backlight core) and composes them **in a fixed order**, so the result does not depend on the viewer's side. Mesh layers would need back-to-front sorting while the player can walk all the way round.
- **Outer:** thin transparent shell, a warm emission, a fresnel rim, and red veins as procedural curves on the surface (about 9 meridians with a wobble).
- **Inner:** milky (alpha ≈ 0.5), a faint cool emission, raised spots as procedural domes with a pale-teal emission.
- **Figure:** a few soft blobs (body, head, two limbs, a hump) accumulated as a **density** along the ray inside the inner egg, not as opaque shapes. Opacity falls off toward each blob's edge and is broken up by noise, so the figure is uneven and soft. It is drawn against an opaque warm core behind it.
- **Resolve (tunable):** at range the figure is a smudge; within about 3 m it gains slight definition (still soft). `egg.resolve` is a single 0–1 parameter so the owner can dial it from "always a smudge" to "sharpens as you approach".
- **Collision:** the plinth and clamps are a solid cylinder of radius ≈ 1.2 m; the 1.6 m trigger ring sits outside it.

## 3. The sequence system

A **pure, renderer-free** module (`ending-sequence.ts`) holds the timeline as data: an ordered list of shots, each with a duration, a cut type (`hard` or `flash`), a camera description, and scene parameters. A function of sequence time returns the current shot and its local time. It is unit-tested. The loop drives it:

- `egg.touch` → the loop emits a new command `sequence` (beside `complete`, `light`, `wave`); input, vitals and enemies are frozen; the pointer lock stays as is.
- Each step advances the sequence clock; the renderer reads the current shot through one seam, and each shot selects a scene and camera (first-person interior, macro, exterior).
- At the end the loop fires `ending.end`, which `completeOn` maps to `complete`; the existing overlay is replaced by black plus a title card for now.
- Shots are authored in **seconds**, with cuts on a half-second grid. A beat clock can replace the grid later; the game does not have one yet, so nothing depends on it.
- No sound is required. Wheels and the pulse continue; the heartbeat rate follows the shot.

## 4. The montage (first cut, about 30 s)

Hard cuts unless noted. Nothing is explained; nothing shows the goblin from outside.

| # | Shot | What we see | ~s |
| --- | --- | --- | --- |
| 1 | The pull | First person. The FOV narrows and the camera drifts toward the inner egg; the shells fill the view, spots sliding past | 4 |
| 2 | Vein | Extreme close-up: one red vein pulsing on the outer shell | 1.5 |
| 3 | Wall | The whole CRT wall goes to static at once; the big monitor stays dark | 1 (flash cut) |
| 4 | Spot | Extreme close-up: a teal spot on the inner egg; the milky shell behind it lit | 2 |
| 5 | Figure | The figure rotating slowly inside the shell, lit from behind in sweeps of light (the train's window-light sweeps, reused) | 4 |
| 6 | Egg in space | The egg, small, drifting through stars; the same light sweeps passing over it | 5 |
| 7 | The train | From outside and far: the train as a sperm shape against the stars. The tail is the ordinary carriages; the head is the swollen Boiler Room and control room. Drawn as a silhouette with lit windows | 6 |
| 8 | Inside | Back inside the shell, the milk thinning to white | 3 |
| 9 | Black | Hard cut to black; the title card | hold |

The exterior train (shot 7) is built from the level's own room widths and lengths, so the silhouette cannot drift from the layout. It is seen only in this shot.

## 5. Changes to the level

- `night-train.level.json` (via `build_night_train.py`): the cab room is replaced by the control room; `egg.touch` trigger added, `level.end` removed; `completeOn` is `ending.end`; a `nav` point for the room.
- Updates that any change to room geometry needs (recorded after the Boiler Room resize): `level-json.night-train.test.ts` (the widths, the `cab` waypoints and moods), `scripts/sdf-game-train-gate.mjs` (the cab probe at z −134 and the `room()` check), `scripts/sdf-disco-check.mjs` if it references the far rooms, and the table in `docs/game/levels/01-night-train/layout.md` (cab row).
- `docs/game/levels/01-night-train/design.md` §5.1 (the dawn) and §6 (the Stoker): the dawn and the Stoker remain *later* and this ending does not use them.

## 6. Out of scope (future attachments)

- **The Flat, the CRT render-to-texture and the pull-back** (vision §6.1): shot 9 becomes "pull back out of the big CRT to the desk and the goblin playing; the egg pushes out of the glass, wet". The wall's big CRT is where it starts.
- **The goblin question:** whether the figure is the goblin, the next goblin, or unexplained.
- **The CD:** what the `dj-cd` pickup does (it is a collectible for now).
- **Sound and a beat clock** for the cuts.
- **The dawn and the Stoker** set piece (design §5.1).

## 7. Build order (each item is its own plan)

1. **The control room** through the level pipeline (kit pieces, level JSON, the test and gate updates in §5), with the egg as a placeholder cylinder. Gate: every room walked to the control room.
2. **The egg pass** (WGSL, §2), its pulse and resolve parameter, and a look sheet (door, close-up, round the back).
3. **The sequence system** (pure module + loop seam + tests) with a two-shot stub.
4. **The montage shots** (§4) and the exterior train silhouette.
5. **Playtest + budget pass**, then docs: `TASKS.md`, `docs/tasks/levels.md`, hand-off.

## Risks

- **Nested transparency.** Analytic ellipsoid composition avoids sorting, but the figure's density and the milky layer must not blow out under the level's tone-mapping and VHS grade; the look sheet in build step 2 is the check.
- **Tone.** The egg's warm light must stay the room's main source; in the blockout an unshadowed, cooler egg light washed the room flat. Shadows stay on and the light stays warm.
- **The sperm silhouette** only works if shot 7 is seen briefly and from far away. It is an image in a montage, never a model the player meets.
- **Nothing here is measured yet:** the draw count, the frame cost of the egg pass and the room.

## Open questions

1. Does the figure stay a smudge the whole way, or resolve as you approach? (`egg.resolve`; default: sharpens slightly within 3 m.)
2. Who is the figure? (Left open; the montage works either way.)
3. Does the egg react to the player earlier in the level (the pulse quickens, the flinch)? (Stretch.)
