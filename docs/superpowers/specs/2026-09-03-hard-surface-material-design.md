# Hard surface, part two: making metal *shade* like metal

**Date:** 2026-09-03
**Status:** design, approved
**Supersedes nothing.** Continues
[`2026-09-02-blob-hard-surface-box-design.md`](2026-09-02-blob-hard-surface-box-design.md).

## Why

The `box` primitive gave the format flat faces and crisp corners, and the
minotaur's prosthetic now has both. The owner's verdict on the round-4 render:
*"the plates still dont quite read as metallic though also the pitted nature
of the metal doesn't help"*, and separately *"parts of a character that are
determined to be hard surface or metal ... dont deform like the flesh"*.

Both are the SAME gap the box primitive fixed, one layer up. `box` taught the
FIELD about hard surfaces. Nothing taught the SHADER, so a machined plate is
still shaded, textured and wobbled as though it were skin.

Three defects, in the order they hurt:

1. **The plates are pitted.** `surfaceNoiseAmp` perturbs the normal at
   `march.wgsl.ts:1966` — for every pixel, ~260 lines BEFORE the shader reads
   whether the prim is painted. It is a flesh knob with no per-prim opt-out,
   so the minotaur's 0.16 of bull-hide micro-detail lands on milled steel.
   The same is true of `silhouetteNoiseAmp` (`marchCfg.z`), which displaces
   the REAL field and so ripples a flat face geometrically.
2. **There is no metalness anywhere in the shader.** Metal's defining property
   is that it has essentially NO diffuse — its albedo tints the SPECULAR and
   its brightness is reflection. A painted prim today gets a full diffuse plus
   an untinted white highlight, which is the exact recipe for polished
   plastic. Raising `gloss` from 0.70 to 0.95 made it shinier plastic.
3. **Nothing on a character can glow.** `faceGlow` is the only emissive path
   and it is multiplied by `(1.0 - decal)` at `march.wgsl.ts:2179` — glow is
   DELIBERATELY off in decal mode so a photographic bake does not
   self-illuminate in a dark corridor. The minotaur uses `decal 1`, so its
   baked red eyes cannot glow and no amount of re-baking will change that.

(3) is what blocks the head work: Terminator eyes and lit cable runs are not
authorable at all today.

## Verified scope facts

Each of these was checked in the code before writing, because three rounds of
rework this session traced to spec assertions that were not.

- **The GLSL twin is FROZEN.** `march.wgsl.ts:59` records the owner decision;
  its lab keeps the old world-axis squash. **All three changes are WGSL-only.
  Do not port to `march.glsl.ts`.**
- **None of this changes the SDF.** Metal and glow are shading; noise
  suppression touches the shader's own perturbation. `validate.ts` applies
  `surfaceNoise` to the SILHOUETTE SHELL only (`validate.ts:681`: "so
  click-to-shoot is untouched"), so **no CPU field parity work is owed.**
  Confirm this rather than trusting it, and say what you found.
- **`prof` bit 4 (16) is safe to add.** Every read of `prof` in
  `march.wgsl.ts` is now a bit mask (`& 2`, `& 4`, `& 8`, and `(& 7) == 1`
  for chamfer). The magnitude comparisons that bit 3 broke were converted
  when `box` landed. Bit 4 is masked off by all four.
- **`primClip.w` is genuinely spare** — documented so at
  `march.wgsl.ts:126`, and packed as literal `0` on BOTH branches of
  `pack.ts:212`, shell and non-shell alike.
- **Budget is not a constraint, but CLUSTERS ARE FULL.** The minotaur is 48
  prims of 128 and its fullest cluster is 16 of 64 — but it uses **6 of
  `MAX_CLUSTERS` 6** (head, torso, armL, armR, legL, legR), and that is a hard
  `validateBody` error. New parts must ride an EXISTING limb group.

## The three changes

### A. `gloss` suppresses the flesh's own noise

Scale both noise amplitudes by `(1 - gloss)` at the point of application.

This is not a new lever: `gloss` already means "polished hard surface" and
already drives four terms at once (specular exponent, specular weight, fresnel
rim, and `wet`). Micro-detail suppression is the fifth, and it is the same
statement — a polished surface has no pores.

**Blast radius, measured.** Only prims that set `gloss` change at all, and
outside the minotaur that is four lines:

| character | line | prim | gloss |
| --- | --- | --- | --- |
| cyclops | `cyclops.blob:181` | eye lens | 0.9 |
| cyclops | `cyclops.blob:185` | pupil | 0.9 |
| mouse | `mouse.blob:359` | eye bead | 0.95 |
| mouse | `mouse.blob:364` | eye highlight | 0.95 |

All four are eyes and lenses, where losing pitting is an IMPROVEMENT, not a
regression. **Render all three characters before and after and say so from the
frames**, not from the argument — an argument that a change is an improvement
is exactly the kind of claim that has been wrong this session.

The 13 prims at `gloss=0.45` and below barely move: at 0.45 the noise is
still at 55%.

### B. A `metal` modifier

A bare word on a painted prim, beside `box` and `chamfer`. `prof` bit 4 (16).

`gloss` and `metal` stay SEPARATE axes on purpose. A glass lens is glossy and
emphatically not metal, and the cyclops' eye needs its diffuse term. Folding
metalness into `gloss` would turn that eye into a ball bearing.

What `metal` does at shading time, in the final composite around
`march.wgsl.ts:2387`:

- **Suppress the diffuse term.** Not to zero — a pure-metal term in a shader
  with no environment map goes black wherever the highlight is not, and the
  lab has one key. Leave a small floor and report what value reads.
- **Tint the specular by the prim's albedo** instead of by `keyC` alone. This
  is the single change that most makes metal read as metal, and it is why a
  steel plate looks different from a white plastic one under the same light.
- **Let fresnel carry the rim**, which it already does at `mix(1, 2.5, gloss)`.

`metal` implies the noise suppression of (A) whether or not `gloss` is set —
say so in the grammar docs, since an author will reasonably write `metal`
alone.

**This is a paint approximation, not a BRDF.** There is no environment map and
no roughness-driven reflection. Say that in the grammar comment so the next
author does not go looking for a metalness workflow that is not there.

### C. Per-prim `glow=0..1`

`glow=` beside `color=`, gated on `color=` exactly as `gloss=` is
(`blob-parse.ts:168` is the pattern and the error message to copy). Packed
into **`primClip.w`**.

**The glow colour is the prim's own `color=`.** No new colour field: a prim
with `color=ff2200 glow=0.9` glows red because it IS red. That keeps the
grammar to one number and makes the authored intent obvious on the line.

The composite already exists at `march.wgsl.ts:2417-2419`
(`glow = faceGlowColor * faceGlow * faceCfg2.w`, then
`lit = fleshLit * (1 - faceGlow) + glow`). The per-prim version is the same
two lines keyed off the prim row instead of the face texture.

`ROW_PRIM_CLIP`'s docstring must be rewritten — it currently says "w spare",
and leaving a lie in the row table is how the next person packs over it.

**Interaction to resolve and state:** the face path already zeroes `faceGlow`
on painted prims (`march.wgsl.ts:2234`, so painted eyes cannot shine through
sunglasses). Per-prim glow must not resurrect that. Decide the precedence,
write the test, and put the reasoning in the comment.

## What this explicitly does not do

- **`march.glsl.ts`.** Frozen. See above.
- **Wounds and gibs on metal.** Shooting the prosthetic today opens a wet red
  crater in it, and severing tears it like meat. That is the OTHER half of
  the owner's "don't deform like the flesh", it lives in `damage.ts` /
  `gib-chunks.ts` / `humanoid-sever.ts` rather than in shading, and it is a
  separate piece of work. Noted here so it is not lost.
- **An environment map or a real metalness BRDF.** Out of proportion to a
  raymarched sprite enemy.
- **Authoring.** No `.blob` file changes except the minotaur's own plates as
  the acceptance case.
