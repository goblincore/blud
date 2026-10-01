# Hand-off — 2026-10-01: the egg, the Flat's emergence, the game's shape, the retro-CGI look

A design session with the owner, mostly look-dev and specs. **No game code changed.** Branch
`claude/egg-shader-gooey-transitions-21fb04` (worktree of the same name), on top of the Night Train ending branch
(`b6182581`); **not merged, not pushed**.

## Where things stand

| Thread | State | Read |
| --- | --- | --- |
| **The egg rework** (candled inner egg, torn caul of wet flesh) | Spec approved, then **paused** by the owner (thinking about the egg) | [spec](../superpowers/specs/2026-10-01-egg-candled-caul-design.md), [look-dev](2026-10-01-egg-lookdev/) |
| **The Flat and the screen emergence** (part 1 of 3: then goblin animation, then the playable Flat) | Spec **draft 2**, waiting on the owner's answers | [spec](../superpowers/specs/2026-10-01-flat-screen-emergence-design.md), [look-dev](2026-10-01-flat-emergence-lookdev/) |
| **The game's shape** (design statement) | **Draft 2**: owner-agreed direction marked; not yet in `vision.md` | [statement](../game/design-statement-draft.md) |
| **The retro-CGI look** (Bryce / POV-Ray) | Recipes written; **rock and sand baked as seamless kit textures** | [recipes](../reference/retro-cgi-recipes.md), [preview](2026-10-01-flat-emergence-lookdev/kit-rock-sand.png) |

## Owner decisions this session (the short list)

- **Look, whole game:** 90s ray-traced CGI (CS 348B, IRTC/POV-Ray, PSX FMV) plus the modern effects; not too smooth.
- **The emergence runs in the engine** with the real SDF goblin; the screen and the bezel's lip are SDF, the CRT housing a
  mesh after a ViewSonic P225f; the egg is bigger than the screen; at home the goblin wears a stained vest and shorts.
- **The Flat:** fixed cinematic cameras, third person; a tiny crammed room; **outside the window an idyll done as Bryce**
  (the Line left out of the view for now); interior after *Garage* (grounded biomech).
- **The shape:** the first third a classic FPS; the egg hatches; **the creature crawls into the computer**; feeding it
  (discrete finds, no meat economy) **mutates the weapons and the machine**; mutations are **slapstick body comedy**
  (budding and bloat-float favoured; calcify dropped); sleep warps the game (dreams).

## Next (the owner picks)

1. Answer the emergence spec's open questions, then write its plan (spike two scenes in one page first; build the SDF
   screen pass in the lab).
2. A **mutation test range** in the ring testbed: bloat-float or budding first.
3. The **"Giger iMac"** stage of the machine (look-dev).
4. Use the rock and sand on a kit piece; port the skies (WGSL next to `sky.wgsl.ts`) or prerender window panoramas.
5. Resume the egg when the owner is ready.

## Tools made this session (all in the look-dev folders)

- `blob-mesh.ts` / `blob-bones.ts` / `kit_pose.py`: mesh any `.blob` character from its CPU SDF in any pose (bone-angle
  overrides) into Blender, with its armour kit posed to match.
- `flat_lookdev.py` (the Flat and the emergence animatic, `RT94=1` for the 90s ray-tracer mode), `crt_p225f.py`,
  `crt_biomech.py`, `bryce.py` (`PREVIEW=1`), `fmv.py` and the MPEG-1 pass for the PSX-FMV look.
- `build_train_kit.py -- --bake-only <kinds>`: bake a few kit maps without wiping the rest (a full bake wipes them all).
