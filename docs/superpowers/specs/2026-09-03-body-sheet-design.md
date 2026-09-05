# The body sheet: painting muscle onto the field

**Date:** 2026-09-03
**Status:** design, approved
**Supersedes nothing.** A body-wide sibling of the `face` block's `sheet`.

## Why

Three rounds of work on the minotaur's torso, each measured and each rejected
on sight, converge on one conclusion. Full evidence in
[`docs/dev-notes/2026-09-03-torso-relief/notes.md`](../../dev-notes/2026-09-03-torso-relief/notes.md).

- **Geometry cannot carry muscle in this renderer.** The AO term is a single
  field tap at 0.06 m (`march.wgsl.ts:2334`) so nothing shallower than ~60 mm
  darkens at all, and self-shadowing was deliberately cut. That leaves
  `dot(n, L)` under a broad key, where a crease crisp enough to be sharp is a
  few pixels wide at gameplay distance and one wide enough to see is a gentle
  dish with no contrast. Authored `groove` creases scored 12.8 mm mean error
  and were invisible at every yaw.
- **Procedural structure cannot either.** Anisotropic and ridged noise both
  produce convincing *texture* — and ridged creases land in random places. A
  pec split has to be where the pec split is.
- **But displacement DOES read.** `silhouetteNoiseAmp` is the one thing on
  any character that reads clearly, because it displaces the REAL field:
  `detail = fbm(anchor * 3.0) * noiseAmp` at `march.wgsl.ts:1190`, ±14 mm of
  geometry at ~33 cm feature size, riding the prim's rest frame.

So the mechanism is right and only its *content* is wrong. Replace the random
content with an authored plate: **a projected greyscale image that displaces
the field.** Owner's framing: *"like how a normal map works, just project a 2D
black and white texture, like painting the muscles."*

## Why not a normal map

A normal map perturbs `n` and nothing else, so it walks straight into the same
wall the grooves did — no AO response, no self-shadow, weak `dot(n, L)`
contrast, and no silhouette break. **The sheet must displace the field**, in
`mapBody`, alongside the fbm it sits beside. Then it breaks the outline, feeds
the AO tap, and shades for free.

## What already exists

Nearly all of it, built for the face:

| piece | where |
| --- | --- |
| project a 2D image onto a body part | `blob-face-sheet.ts`, `projScaleX/Y`, `projCentreX/Y` |
| drive a bump from that image | `march.wgsl.ts:2212` |
| bake such an image from the reference mesh | `scripts/blob-face-bake.py` |
| a rest-frame point stable through gait and jiggle | `anchor` / `restPoint`, already what every fbm samples |

`anchor` is the important one. It already solves the hard problem — a
projection built on it rides the limb through gait, jiggle and severing,
exactly as the existing noise does, with no new machinery.

## The design

### Grammar

A `bodySheet` block beside `palette`, mirroring `sheet`'s vocabulary so an
author who knows the face block already knows this:

```
bodySheet
  image       minotaur-muscle.png
  amp         0.018          # metres of displacement at full white
  projScaleX  0.42
  projScaleY  0.55
  projCentreX 0.5
  projCentreY 0.5
```

Absent means absent: no row written, no sample taken, every existing character
bit-identical. **This is additive and opt-in** — it does not replace
`silhouetteNoiseAmp`, which stays and keeps doing its job. The owner was
explicit that the noise is wanted: without it a body "just looks like a smooth
blob".

### Sampling

In `mapBody`, beside the existing fbm:

```wgsl
let detail = fbm(anchor * 3.0) * noiseAmp + sheetSample(anchor) * sheetAmp;
```

Projection is planar in the `anchor` frame — front-on, the same convention the
relief map and `blob:depth` already use (`front: u = world x, depth = z`).
Mid-grey (0.5) is zero displacement so a plate can both raise and cut; a pec
belly is bright, the sternum between them is dark.

**INVESTIGATE, do not assume: whether the sample belongs inside the
`noiseAmp <= 0` early-out at `march.wgsl.ts:1181`.** That guard exists because
fbm costs sixteen hash calls; a texture fetch is a different cost. A character
with a sheet and no noise must still get its sheet.

### The gradient budget — the constraint that will bite

Every failure in the spikes behind this spec was one of these. `mapBody` is a
sphere-tracing distance field: displacing it breaks the Lipschitz bound, and
the march pays. Measured, the cost is the product

    gain x maxFrequency x amplitude

with the shipped baseline at `1.0 x 3.0 x 0.014 = 0.042`. Holding that product
constant let the noise change character freely with no artefacts; exceeding it
tore the surface into black streaks — at an amplitude a **fourteenth** of what
`validateBody` permits.

For a plate, the frequency term is `amp / pixel_size`: **a sharp black line in
the image is a cliff in the field.** So:

- The bake must **blur** the plate, and the blur radius is a function of amp
  and projected pixel size, not a taste knob.
- **`validateBody`'s noise guard cannot see any of this.** It is
  `silhouetteNoiseAmp > (1 - stepMultiplier) * 0.5` — amplitude only, no
  frequency term. It must gain one, and the sheet must be inside it, or the
  first author to paint a hard edge gets a torn character with a green check.

### Emitting the plate — it may not need painting

`blob:relief` already computes reference-minus-body front-wall depth per
`(x, y)` cell. **That difference IS a displacement map.** `--emit-map` writes
it as a PNG: mid-grey where the body already matches, brighter where the mesh
has mass the body lacks, darker where the body is proud.

This closes the loop the whole session circled — the tool that MEASURES the
missing relief also SUPPLIES it, and the plate is anatomically correct because
it came from the anatomy. Hand-painting stays available and is the fallback
when a character has no reference.

Two things to get right, both from the relief tool's own limits:
- Its cells are **47 mm**, coarser than a muscle line. The emitted map wants
  resampling and smoothing, and the tool should say what resolution it can
  honestly claim.
- It is only valid where the two subjects **share a pose**. Emitting outside a
  `--y` window would bake pose error into the plate as if it were anatomy.

## Order

1. `--emit-map`, on the tool that already exists. It is testable on its own
   and produces the artefact everything else needs.
2. The frequency term in the noise guard. **Before** the shader work, so the
   new displacement path is born inside a guard that can see it.
3. Grammar, packing, sampling.
4. The minotaur as the acceptance case: does the torso read as muscled from
   every yaw? A "no" here is a good outcome and has been three times already.

## What this explicitly does not do

- **Replace `silhouetteNoiseAmp`.** It stays. This is a second, additive term.
- **A normal-map-only mode.** See above; it would not read.
- **Triplanar projection.** Planar front-on first, matching the face block and
  every measurement tool. Triplanar is the obvious extension and needs a
  reason from a render, not from anticipation.
- **The cavity AO tap.** A separate change from the same investigation — a
  second AO sample at ~0.015 m, which made even the invisible `groove` creases
  read. It belongs with the hard-surface shader work, needs a perf
  measurement, and would compound with this rather than substitute for it.
