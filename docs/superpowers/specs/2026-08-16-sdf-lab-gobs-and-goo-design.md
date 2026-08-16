# SDF lab gobs & goo — design (Spec A)

**Date:** 2026-08-16
**Status:** approved (brainstormed with project owner)
**Scope:** SDF zombie lab only (`src/lab/sdf-zombie/`), **WebGPU path only** — the WebGL lab is frozen as of the 2026-08-16 gore fix-pass (owner decision; WebGPU is the build path per X1.2). No game-side changes.
**Depends on:** the gore fix-pass landing first
(`docs/superpowers/plans/2026-08-16-sdf-lab-gore-fix-pass.md`). Implementation
chain bases off its final branch. The skeleton reveal (X1.20) follows THIS
spec — bones ride the large gobs.

## Why

Playtest on the gore-feel pass (2026-08-16): gib pieces are "too big and too
geometric primitive shaped" — per-prim pieces are anatomy capsules verbatim,
and torso prims make comically large clean balls. The owner wants "a few maybe
large chunks but more like fleshy amorphous bits and pieces" with "some red
bloody texture to them instead of just the plain latex." And the blood should
be a **viscous shiny fluid spray** (Blender fluid-sim reference images: drops
fusing into ropey strands, membranes, thick glossy splashes) — "not simple
circle red drops."

Key decisions:

- **Amorphous generated gobs** replace per-prim chunk geometry; scraps merge
  into the blood system.
- **Screen-space metaballs** for the viscous blood (owner-picked over a true
  SDF droplet field): drops fuse into strands/sheets automatically; the
  flesh-merging SDF goo (gushes stringing off wounds) is deferred to the
  X1.18 wound-fluid spec.
- Bloody chunk texturing is deliberately the first vocabulary of the future
  progressive body-damage system (not specced yet).

## 1. Gob generation

A pure module (`gobs.ts`) turns a gibbed body region into chunk shapes:

- **Large gobs, 4–6 per full-body gib.** Each is 2–4 jittered overlapping
  blobs (spheres/short fat capsules) smin'd into one ragged lump. Seeded from
  a source prim's position and volume — a torso prim yields a bigger gob than
  a hand — but squashed/asymmetric (per-axis scale jitter 0.6–1.3) so nothing
  reads as a clean primitive. Torn-edge treatment: every gob carries 1–2 torn
  wounds (girth-derived radii, existing pipeline) plus a higher
  silhouette-noise amplitude than the body, so edges read ripped.
- **Scrap bits, 10–15 per gib: NOT raymarched.** Scraps are heavy, slow,
  chunky particles handed to the blood system (bigger radius, higher drag,
  shorter flight than droplets). They render through the metaball pass, so
  they read as gooey lumps that fuse with the spray around them. Meat and
  fluid share one glossy vocabulary; scrap cost rounds to zero.
- **The head stays a special case**: intact chunk with face carves + skull
  sphere (Blood kickable-head signature), as today.
- Sever (single limb, keyboard or wound-driven) still detaches the REAL limb
  prims as one chunk — anatomy is correct for an amputation; gobs are for the
  full gib explosion. Mid-limb severed distal pieces likewise stay real prims.
- Deterministic under an injectable rng; counts/sizes are exported tuning
  constants.

## 2. Bloody chunk material

Large gobs drop the clean latex read:

- A **gore mask** per shaded point: 3D fbm mottling blended with proximity to
  the gob's torn wounds (reusing the wound-mask machinery chunks already
  carry). Mask blends albedo from base flesh toward wet deep-red/darkened
  meat; the wet specular boost rides the mask so bloody regions glisten
  hardest.
- Implemented in the shared march shading for chunk fields only (a per-body
  uniform flag/strength so the standing body is unaffected until the future
  body-damage system adopts the same mask).
- march.wgsl.ts only (WebGL frozen); text-lint tripwires extended.

## 3. Screen-space metaball blood

The billboard droplet view is replaced as the primary blood renderer (billboard
micro-beads survive only for fine mist):

- **Density pass:** every blood-sim droplet and scrap renders a soft radial
  density blob (additive) into a low-res offscreen target (~1/2 SDF-layer
  resolution). Blob radius from particle size; scraps are much larger.
- **Surface pass:** fullscreen composite thresholds density into a surface,
  derives normals from the density gradient, shades with the blood/latex
  specular family (deep red base, tight glint, fresnel rim), and writes
  depth from the per-pixel nearest-particle depth (accumulated as a separate
  channel: min-depth) so goo interleaves with flesh and floor.
- Result: dense spray fuses into ropey strands and sheets (the Blender
  reference look); sparse drops remain beads. Threshold, blur radius and
  shading constants are panel-tunable.
- Splat decals on the floor stay as today (they already read well).
- WebGPU only. The WebGL lab is frozen at fix-pass parity and gets none of
  this; its billboard blood view stays as-is.

## 4. Physics

Unchanged. Large gobs ride the existing 3D stepper (tumble, bounce, topple,
squash). Scraps ride blood-sim with their own mass/drag band. The fix-pass
launch velocities apply to gobs as-is.

## 5. Testing

- `gobs.ts`: gob count bands; blob counts per gob; per-axis jitter within
  bounds; volumes track source prims (torso gob > hand gob); torn wounds
  present; deterministic under a seed; head excluded.
- Blood-sim: scrap band (size/drag) distinct from droplets; deterministic.
- Shaders: text tripwires for the gore-mask uniform and the metaball surface
  pass wiring.
- Visual (WebGPU lab): full gib reads as a few ragged hunks + gooey scraps in
  a viscous connected spray; strands visible where spray is dense; gobs land
  bloody-side glistening; standing body unchanged.

## Out of scope

- True SDF goo merged with the flesh field (wound gushes that string off the
  body) — X1.18 wound-fluid spec, which should reuse this spec's metaball
  surface pass.
- Progressive body damage on the standing body (adopts the gore mask later).
- Skeleton reveal (X1.20 — next after this).
- Game-side changes.
