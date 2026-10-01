# The Flat and the screen emergence: look-dev (2026-10-01)

A Cycles blockout of the goblin's Flat and an animatic of the egg pushing out of the CRT, made for the draft
[emergence spec](../../superpowers/specs/2026-10-01-flat-screen-emergence-design.md). **A preview only:** the owner wants
the sequence in the engine (SDF screen, the real SDF goblin), found the Blender finish a little too smooth for period
CGI, wants the egg bigger than the screen so the bezel deforms and the screen to push much further out, and the goblin
in a stained vest and shorts at home (not its armour).

| File | What |
| --- | --- |
| `keyframes.png` | The eight key frames in the 90s-ray-tracer mode (`RT94`): the pull-back (from the FPS frame to the goblin at its CRT), the room, the glass giving, the stretch (picture to skin), crowning, out (the goblin thrown back), settle |
| `emergence-animatic.mp4` | The animatic, 12 s at 15 fps, through an MPEG-1 pass at 320 × 240 (the PSX-FMV look): pull-back, room, the push, out, settle |
| `render-modes.png` | The same four frames path-traced (top) and in the 90s-ray-tracer mode (bottom: direct light only, hard shadows, clipped highlights, a flat ambient) |
| `fmv-treatment.png` | Four frames clean (top) and with a still FMV treatment (bottom); an earlier skin |
| `goblin-sdf-poses.png` | **The game's own SDF goblin** (`goblin.blob`) meshed from its CPU field, wearing its armour kit (`goblin-kit.gltf`) posed to the same bones: rest, typing, recoil (side and back) |
| `goblin-kit-option.png` | In the Flat: skin only (as the key frames) and with its armour kit. An open question: does the goblin wear its game armour at home? |
| `crt-p225f.png`, `crt_p225f.py` | The CRT after the owner's reference, a ViewSonic P225f (22-inch, flat glass): front frame with a sloped inner bevel, the chin's buttons and LED, the long tapered housing, the pedestal. Replaces the animatic's boxy monitor ("looks like a microwave") |
| `crt-biomech.png`, `crt_biomech.py` | The machine's later stages: grounded biomech (bone face, ribbed gunmetal carapace, spinal hoses, vertebra pedestal) and a first crude full-biomech pass (`VARIANT=p225f|grounded|creature`) |
| `view-bryce.png`, `bryce.py` | **The view, take 2**, after the owner's Bryce reference (a fantastical, not a natural, landscape): a banded gas giant, floating rock moons, streaky stratus (noise stretched along one axis), jagged ridged mountains, a spiky rock arch, milky turquoise water with bump-mapped rock and boulders. Haze as Bryce did it: each material mixes to an emissive haze colour by view distance. `PREVIEW=1` renders 400 x 300 at 16 samples in seconds |
| `view-idyll.png`, `terragen.py` | Take 1: "looks like a landscape, not Bryce" (owner) | The view from the window, the owner's idyll done as Bryce/Terragen did it: a painted gradient sky with a sun glow (not a physical sky), ridged multifractal mountains (noise at kilometre scale, height-banded meadow, rock, snow), a mirror sea, flat textured cloud layers, the Line on pylons with the train |
| `flat_lookdev.py` | The Blender generator: the Flat set, the membrane (`membrane()`), the stand-in egg, the goo, the cameras, the frames and the clip |
| `blob-mesh.ts` | `.blob` SDF → PLY (surface nets, vertex colours from the owning prim), with bone-angle overrides for poses |
| `blob-bones.ts` | `.blob` skeleton → JSON (heads and directions, rest and posed), for posing the kit |
| `kit_pose.py` | Poses `goblin-kit.gltf`'s armature to a `blob-bones.ts` pose |
| `fmv.py` | The FMV treatment for a still |

## Commands (from the repo root)

```bash
D=docs/dev-notes/2026-10-01-flat-emergence-lookdev; OUT=.lab-tmp/flat; mkdir -p $OUT; G=src/lab/sdf-zombie/characters/goblin.blob
TYPE="spine1=pitch=20 chest=pitch=27 neck=pitch=24 skull=pitch=-6 thigh=pitch=86 shin=pitch=-4 upperarm=pitch=40 forearm=pitch=80 hand=pitch=70"
RECOIL="spine1=pitch=-6 chest=pitch=-12 neck=pitch=-2 skull=pitch=-14 thigh=pitch=78 shin=pitch=2 upperarm=pitch=150 forearm=pitch=172 hand=pitch=175"
# 1. Mesh the SDF goblin in the two held poses (about 15 s each) and dump the bones for the kit.
npx tsx $D/blob-mesh.ts $G $OUT/goblin-type.ply 0.006 $TYPE;     npx tsx $D/blob-bones.ts $G $OUT/bones-type.json $TYPE
npx tsx $D/blob-mesh.ts $G $OUT/goblin-recoil.ply 0.006 $RECOIL; npx tsx $D/blob-bones.ts $G $OUT/bones-recoil.json $RECOIL
# 2. The key frames (Metal GPU; ~1 min a frame at 640 x 480, 128 samples). The screen shows any 4:3 image. Add KIT=1 for the armour.
GOBLIN_DIR=$OUT RT94=1 SAMPLES=128 blender --background --factory-startup --python $D/flat_lookdev.py -- $OUT/frames SCREEN.png
# 3. The clip frames (pull-back 30 + push 48), 400 x 300.
GOBLIN_DIR=$OUT RT94=1 CLIP=1 SAMPLES=24 RES_X=400 RES_Y=300 blender --background --factory-startup --python $D/flat_lookdev.py -- $OUT/clip SCREEN.png
# 4. The FMV look: an MPEG-1 pass at 320 x 240, then H.264 to play anywhere.
ffmpeg -framerate 15 -i SEQ/%04d.png -vf "scale=320:240,fps=30" -c:v mpeg1video -b:v 900k -g 15 fmv.mpg
ffmpeg -i fmv.mpg -vf "scale=640:480" -c:v libx264 -pix_fmt yuv420p -crf 18 animatic.mp4
```

The screen image used here is the round-1 egg look-dev's torn-caul render (`../2026-10-01-egg-lookdev/`), standing in
for the montage's last frame.

## Findings

- **The membrane works as a mesh.** A 150 × 112 sheet with fixed UVs, displaced by a smooth maximum of the tube's glass
  and the egg's front surface, stretches the picture over the egg by itself. Stretch (displacement plus slope) is the one
  value that drives everything else: the picture dims, the glass turns to translucent veined skin, the egg's light comes
  through. Radial folds where the sheet is dragged into the tent sell the rubberiness.
- **The torn lip needs its own geometry.** Discarding the sheet round the egg leaves a paper edge; a wet pink ring along the
  tear reads as flesh.
- **Strands must catch light.** Clear transmissive mucus reads as dark specks against the glowing egg; a milky, subsurface,
  glossy mucus reads as strands.
- **The goblin's own skin** (owner): the palette's saturated green, darker hand-span mottle, the char colour in the
  creases, a clammy sheen and fine pits (see `goblin-skin.ts`), not generic pink flesh.
- **The armour kit poses with the SDF.** `goblin-kit.gltf` is skinned to a skeleton that mirrors `goblin.blob`; giving
  each kit bone the minimal rotation from its `.blob` rest direction to its posed direction fits it to any pose. Blender's
  glTF importer leaves objects in quaternion rotation mode, which silently ignores `rotation_euler`.
- **The real goblin reads from behind.** The hunched beaded spine, the ears against the screen glow. The face rule holds
  if the cameras stay behind the shoulder line.
- **The `.blob` SDF is a pure CPU function**, so any character can be meshed into Blender in any pose (bone-angle
  overrides; bone directions are absolute, and pitch turns the base direction toward +z, i.e. forward, for up and down bones
  alike). That makes Blender look-dev of the real cast cheap, and suggests a route for goblin animation (part 2): author on a
  Blender armature, export the bone angles.
- **Blender metaball gotcha:** an ellipsoid element's `size_x/y/z` are *relative* multipliers, and a ball of radius R shows a
  surface of radius about 0.575 R at threshold 0.6. Passing metres shrinks elements to nothing.
