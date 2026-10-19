# The egg emerges in the Flat: notes (2026-10-16, looked at 2026-10-18)

**Spec:** [`2026-10-16-emergence-in-the-flat-design.md`](../../superpowers/specs/2026-10-16-emergence-in-the-flat-design.md) · **Plan:** [`2026-10-16-emergence-in-the-flat.md`](../../superpowers/plans/2026-10-16-emergence-in-the-flat.md) · **Branch:** `claude/emergence-in-the-flat`, stacked on `claude/screen-emergence-lab` (PR goblincore/blud#47).
**Parent notes:** [the lab spike](../2026-10-11-screen-emergence/NOTES.md) (the pass, the timeline, look rounds) · [goblin expressions](../2026-10-13-goblin-expressions/) · [goblin human height](../2026-10-11-goblin-human-height/).

**Sheet:** [`sheet.jpg`](sheet.jpg): the five key frames (glass gives 2.0, push 5.5, crowning 8.0, out 10.0, settle 13.0) at 320 x 240, from `npm run flat-emergence:check`. 320 x 240 is the hardest case: the vest's cloth shell (about 4.6 mm) is under a pixel there and speckles whatever the lighting; the default flow (400 x 300 march, the trained t16 upscaler to 800 x 600) is clean.

## What was built

The egg-out-of-the-monitor scene plays in the real game, in the Flat, on a debug trigger. The Night Train hookup is not built.

| Part | Where |
| --- | --- |
| A `320` resolution rung (`?res=320`, 320 x 240 fixed) | `game-main.ts`, `game-state-boot.ts` |
| The screen pass (proxy box, WGSL march, per-frame uniforms), shared by the lab page and the game | `webgpu/screen-pass.ts` |
| The set builders (CRT, keyboard, lamp, glow, zabuton, table and room); the game builds only CRT, keyboard, lamp, cushion | `webgpu/screen-set.ts` |
| Screen frame to world transform and the kotatsu's place in the Flat | `webgpu/emergence-placement.ts` (`FLAT_KOTATSU`) |
| The goblin puppet (pose pinning, expressions, teeth kit, lighting), shared by the lab page and the game | `webgpu/goblin-puppet.ts` |
| `goblin-cinematic-home`: the cinematic head with his home clothes, 1.70 m, with the cinematic kit's mesh teeth | `characters/goblin-cinematic-home.blob`, `kit-overlay.ts`, `character-registry.ts` (`kitOnly`, `kitScale`) |
| Expression cues from the egg's events (neutral, surprise, shout, scowl, evil grin) | `webgpu/emergence-expressions.ts` |
| The `flat-early` level: the Flat without the Giger iMac, plus a lamp and a CRT light | `scripts/levels/build_the_flat.py` (`FLAT_STAGE=early`), `public/assets/levels/flat-early.*` |
| The five shot cameras, inside the room, and the hand-off pose | `webgpu/emergence-camera.ts` |
| The runtime on the sequence system | `webgpu/game-emergence.ts` (`ctx.world.emergence`), `ending-sequence.ts` (`registerSequence`) |
| The headless check | `scripts/flat-emergence-check.sh` / `.mjs` (`npm run flat-emergence:check`) |

## How to run it

`npm run dev`, then `/sdf-game.html?level=flat-early&emergence=1&res=320` (drop `res=320` for the normal flow). It autostarts 2 s after the level is ready; the first boot on a cold shader cache takes 1.5 to 3 minutes. `?emergence=0` turns it off. Console seams: `__sdfGame.startEmergence()` (replay), `skipEmergence()`, `emergenceSetT(t, hold = true)` (hold the clock to look at one moment), `emergence()` (state), `emergencePuppet()` (his view, for tuning uniforms). URL overrides: `?emergencerim=`, `?emergencefill=`, `?emergencegpu=lab`. The lab page (`/sdf-screen-lab.html`) is still the tweaking bench and uses the same pass, set and puppet.

**The hand-off** (about 14.5 s): the puppet vanishes; the pass and the egg stay (the egg sits on the keyboard in its goo); the player stands at (0.12, 0, -1.455) facing the egg, the eye rising from his seated height to standing over 1.2 s; input is released. The viewmodel's orb hands are hidden and the flashlight held off while the sequence plays (and it stays off after).

**Rebuilding `flat-early`** (about 19 MB of art; rebuild when `build_the_flat.py` changes): `FLAT_STAGE=early blender --background --factory-startup --python scripts/levels/build_the_flat.py`, then export through `scripts/levels/export_level.py`. The late Flat's export is not byte-identical when rebuilt (triangle order), so only rebuild the stage you changed.

## Lighting (the look round after the first run, 2026-10-18)

The owner saw a "weird white fuzzy cobweb" round the goblin. It was his cold rim (`GOBLIN_RIM` 1.5, `compose.wgsl.ts`: `pow(1 - n.v, 4)` times the key side, unclamped): on the unstable normals of a silhouette at 320 x 240 it throws white HDR sparks onto the air round him. One boot, A/B through the `emergencePuppet()` seam: gone at rim 0, worse with the footprint accept off. The game now lights him with no rim and a fill of 0.30 (was 0.10), `GAME_RIM`/`GAME_FILL` in `game-emergence.ts`. The lab page keeps `GOBLIN_RIM`/`GOBLIN_FILL` and may show the same sparkle at low resolution. He is still lit by a key aimed at the lamp, not by the level's light list (the list is off by default in the game; the actors use `applyWindowKey` and `applyRoomFill`).

## The first-show stall

The screen pass's pipeline was created in the first frame it was shown (the SDF layer's late scene is not in the boot warm), a half-second freeze at the start of the emergence, longer on a cold shader cache. `precompilePasses` now compiles the late scene too, with its hidden children flipped visible across the compile (`sdf-layer.ts`). Measured with `?pipelinelog=1`: the pass pipeline is created during the warm (32 ms) and nothing is created after the level is ready; no frame over 60 ms through the sequence. The egg's own late-scene pipelines are compiled by the same change.

## Cost

Recorded, not gated. CPU per frame in the game: puppet 1.1 to 1.7 ms, pass under 0.3 ms. The check's widest frame gap through the sequence was 85 ms at 320 x 240, median 11 ms. **GPU cost in the Flat is not measured**: the lab's numbers (the cinematic head is heavy: about +47 ms in the close-up at full res on the lab page; the game's march settings halve it) have not been re-read here.

## Known issues and open items

- **The vest speckles at 320 x 240** (a thin cloth shell under a pixel); clean in the normal flow.
- **The goblin is still dark from behind** in the push shot (the key is the lamp's direction; the room is warm and dim); fill 0.30 helps, a proper room light would be better.
- **Flashlight:** held off during the sequence and left off at the hand-off (owner 2026-10-19); the player can switch it back on.
- **Deferred render mode is untested** (the puppet registers lazily in `stepEmergence`).
- **His march is not shell-bounded** (the outer-hull shell is built from the actors only; binding it discards every pixel, so `puppetGpuOpts` leaves it out): a possible cost.
- **Teeth and the grin** cannot be judged at 320 x 240.
- `JAW_HINGE.back` is an absolute 0.020 m, 0.45 mm off a pure scale of the cinematic jaw (pinned in `goblin-cinematic-home-teeth.test.ts`).
- The hand orb attaches 4.24 cm above the hand tip and does not follow the hand bone (an engine and owner call, untouched); the game's `faceFor` zombie-face bug (`game-wound-vfx.ts`) is untouched; the armour kit's sunglasses are off at home.
- Out of scope, as the spec says: the Night Train hookup and the two-scene seam, a world trigger for the sequence, a live CRT picture, an openable front door, the later stages of the Flat, sound.

## Owner decisions (2026-10-19)

The hand-off spot (at the cushion's place, looking at the egg) is fine; the expression cue timings are fine for now; the five camera shots are fine; the flashlight stays off after the hand-off.

## How to check it

`npm run flat-emergence:check` (own ports 5246/9246, output in `.lab-tmp/flat-emergence/`): one boot at 320 x 240; fails on any console error or WebGPU validation message, an unbuilt puppet or runtime error, the proxy missing from the late scene, the proxy or the puppet hidden at a key time, or a hand-off that does not leave the sequence inactive, the puppet hidden and the player on the spot; records the frame gaps and the CPU cost; builds the sheet. It does not run the full 1280 x 800 matrix; the lab's `npm run emergence:check` stays as it is.
