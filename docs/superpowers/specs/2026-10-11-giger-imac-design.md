# The Giger iMac in the engine — design

**Date:** 2026-10-11 · **Status:** built 2026-10-11, owner look pending ([notes](../../dev-notes/2026-10-11-flat-room/NOTES.md)) · **Branch:** `claude/flat-room` (stacked on slice 1) ·
**Parent:** [the Flat's room in the engine](2026-10-11-flat-room-design.md) (section 11, follow-up 2) ·
**Look-dev:** [`docs/dev-notes/2026-10-01-flat-room-lookdev/`](../../dev-notes/2026-10-01-flat-room-lookdev/notes.md) (`room.py` 881–1102 and the umbilicus at 1071; frames `imac.png`, `skull.png`) ·
**Owner decisions (2026-10-11):** build the machine and its connection to the room (not the keyboard and mouse); the shell is alpha-blended; the WGSL shell is a separate, later spike.

## 1. Why

The owner liked slice 1 of the Flat and said the Giger iMac "would really tie the room together". Slice 1 shows an amber ball with a black bezel where the
machine goes. The look-dev's iMac is the room's centrepiece: the iMac G3's translucent coloured plastic merged with a xenomorph's dome, lit from inside so
the guts and a curled creature read through it. The machine is "the machine's last stage" (design statement §3.4) and the room's only amber.

## 2. Scope

**In:**

- **The shell:** the teardrop body (a superellipse in section, rounded face, a cranium that sweeps back and up to a tip), frosted amber with veins, alpha-blended.
- **The face:** a bone surround (the G3's front), a black bezel with the screen sunk in it, a screen lip studded with 24 small bone teeth, the mouth (swollen
  lips, a dark slot, the CD tray out like a tongue with a disc on it, a strand of drool to the table), the speakers as gill slits.
- **The guts, seen through the shell:** seven gunmetal skull-frame hoops, a keel of vertebrae along the crown, the dark neck of the tube, seven vessels on
  the inside of the dome, and the curled creature.
- **The outside parts:** a vertebral handle, a bone crest down the cranium, six beetle legs.
- **The connection to the room:** the umbilicus from the tip across the table and floor into the wall by the window (with its flesh collar), and two lesser hoses.
- **The screen:** a static frame of Night Train, scanlines baked in, shown as an emissive image. No live render-to-texture.
- **Lights:** two amber lamps inside the shell and a cool lamp at the screen.

**Out (separate tasks, §9):** the keyboard and mouse (they go with the goblin at the kotatsu), the stickers, a live CRT, the WGSL shell, the clutter pass.

## 3. Architecture

| Unit | Does | Depends on |
| --- | --- | --- |
| `scripts/levels/flat/imac.py` | Ports `giger_imac()`, the gloop strand and the umbilicus and hoses from `room.py`; builds the machine at the kotatsu's place. Replaces `props.build_imac_placeholder()`. | `flat_layout`, `common`, `materials`, `giger.vertebral` |
| `scripts/levels/flat/materials.py` | Adds the machine's materials: `SHELL` (alpha-blended), `FLESH`, `LIPS`, `TONGUE`, `DARKGLASS`, `BEZEL`, `CD`, `MUCUS`, `SCREEN`. | the textures |
| `scripts/levels/flat/make_textures.py` | Adds the veined amber shell texture and the screen image (a captured Night Train frame with scanlines and glow baked in). | `scripts/capture-flat-screen.mjs` |
| `scripts/capture-flat-screen.mjs` | Boots Night Train headless and saves one frame as the screen source (`assets-source/levels/flat-textures/screen-source.png`, committed). | the existing capture plumbing |
| `scripts/levels/flat_layout.py` | The machine's constants (face plane, centre, length, half sizes); the lights move and a `screen` light is added. | nothing |
| `scripts/levels/build_the_flat.py` | Calls `imac.build(M)` instead of the placeholder. | the units above |
| `scripts/sdf-game-flat-gate.mjs`, `level-json.flat.test.ts` | New close-up shots; a check that the shell material is blended. | the export |

The look-dev's geometry functions are ported, not rewritten, as in slice 1 (`room.py` stays untouched as provenance).

## 4. The translucent shell

The shell is a glTF material with `alphaMode: BLEND`: a veined amber base colour texture, a smooth, slightly rough surface, alpha about 0.45 (whether the engine honours a clear coat is not assumed). The
interior meshes (hoops, keel, vessels, creature, neck) are real geometry, lit by the lamps inside, so the guts show through it as through the G3's frosted plastic.
It is plastic-like and glass-like, not the egg's candled rule (the owner's call; §9 item 1 is the upgrade).

**The risk, and the first task.** It is not confirmed that Blender exports `BLEND` from a script-built material, that the art loader keeps it, or how it
sorts against the opaque art and the emissive window plane. The plan's first task is a spike: one blended shell, exported and drawn in the room. If alpha
does not survive the art loader, the fallback is a small, tested loader change (honour `material.transparent` on level art); if that is not enough, the
owner decides between that and an opaque candled shell.

Levels draw art in room batches by material (`artBatchKey`): a transparent mesh is its own batch, so the shell is one draw. The loader's static batching
bakes world matrices, so the shell is not moved afterwards.

## 5. The screen

`capture-flat-screen.mjs` saves a Night Train frame from the guard's van (the level's own art, no extracted assets). `make_textures.py` bakes the
look-dev's scanline term (`sin` over the image's height, 0.55 to 1.0) and a mild brightening into `screen.jpg` (1024 px or less), shown by an emissive
`SCREEN` material. The engine caps emissive at 1, so the baked brightness stands in for the look-dev's strength 2.6. The cool `screen` light (the look-dev's
area light, 5 W, blue-white) becomes a point light in front of the face.

## 6. Lights

| Light | Position | Colour | Role |
| --- | --- | --- | --- |
| `amber` | inside the shell, behind the creature (look-dev `imac_guts`: face plane + 0.36 m back, the face's centre height -0.06 m) | amber | lights the guts from behind |
| `amber2` | inside, nearer the face (`imac_guts2`: +0.14 m back, -0.10 m) | amber | lights the face's inside |
| `screen` | in front of the screen, just off it | cool, blue-white | the screen's light into the room |

All three have `fixture: "none"` (the art is the lamp). Powers start at the look-dev's ratios and are tuned on the shots. The per-room light cap is checked in the plan.

## 7. Budget

About 9 new materials: roughly +9 draw calls (32 today), and the machine adds perhaps 60k triangles (the umbilicus' rings, the legs, the creature mesh, the
shell's 6 500 quads). The triangle cap is 400 000 (298 000 today) and file size is not a constraint (owner). The frame stays under 33 ms.

## 8. Verification

- **Spike result:** the blended shell draws, sorts and does not break the window plane or the batches.
- **Level test:** the shell's material is blended in the GLB (`alphaMode` `BLEND`); primitives and triangles stay under the caps.
- **Gate:** the existing checks, plus `imac` and `skull` close-ups (the look-dev's `imac` and `skull` cameras) with the flashlight off.
- **Comparison sheet** against the look-dev's `imac.png` and `skull.png`, for the owner. The owner is the judge of the look.

## 9. Follow-ups (separate tasks)

1. **The WGSL shell material, a spike** (owner, 2026-10-11, "maybe later after this"): a hand-written translucent shell that reuses the candled egg's
   analytic lamp-and-shadow rule (opaque, light through it, the guts as soft shadows on its skin), live lamp and pulse, port-ready. It replaces the blended
   glTF shell if it proves better. The egg's own pass is paused, so it would start from the egg's design
   ([candled caul spec](2026-10-01-egg-candled-caul-design.md)), not from code.
2. **The keyboard and mouse** with the goblin at the kotatsu.
3. **A live CRT** (render-to-texture, F-T2), replacing the static screen.
4. **Stickers** (it is loved) and the clutter pass.
5. **The bone-ring and spine look, the optimisation pass** (slice 1's follow-ups).
