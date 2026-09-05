# FPV goblin arms — 2026-09-04

Spec: docs/superpowers/specs/2026-09-04-fpv-goblin-arms-design.md
Plan: docs/superpowers/plans/2026-09-04-fpv-goblin-arms.md

## What changed
* `scripts/model_goblin_arm.py` -> `public/assets/lab/goblin-arm.glb`: ball
  hand (r 0.046, unchanged), knuckles, wrist/elbow balls, forearm 0.036-0.042,
  upper-arm stub to 0.70; leather bracer with steel lip, two straps with brass
  buckles, six rivets; smartwatch (band, body, `Watch_Screen` quad) on the left.
* `goblin-skin.ts`: `goblinAlbedoPixels` — tiling colour map with the blob's
  mottle patches and wart darkening, same lattice as the normal map.
* `game-arms.ts`: loads + dresses; skin has NO emissive; the watch screen is a
  CanvasTexture exposed as `__sdfGame.watchScreen` for a later device pass.
* `game-main.ts`: the sphere+capsule hands are gone; `aimArm` keeps the hand
  fixed and swings the arm toward the fixed elbow anchors.
* Gate check 2b: arms present, skin emissive 0, watch present.

## Evidence
* `turntable-0..3.png` — the authored left arm from four angles.
* `gate/fpv-rest.png`, `rest-closeup.png` — at rest: mottle, bracer, watch glow.
* `gate/reload-900.png`, `gate/reload-960.png` — the support arm crossing the frame.

## Numbers
* tris: 8942 / 14000 cap
* skin envMapIntensity: 1.1 (same as the gun)

## After the chain (2026-09-05, by hand)

Task 1's agent stopped: the plan's albedo formula and its tests could not
both hold — a `x4.5` mottle gain clipped half the map to full mottle colour,
which out-darkened every wart (the "darkest texel is a wart" test) and dragged
the blue mean past the 8% bound. Fixed: the mottle mix is linear in the dark
half of the field (0..80% toward `mottleColor`), wart darkening is a
multiplicative SHADE (up to 55% at the crown) applied after the mix so a wart
is darker than its surroundings on any ground, and the tests now assert
crown texels are >7% darker on average than plain skin, luminance within 8%
of base, hue within 12% per channel. Measured at 64px: plain 428.8, crown
367.1 (summed sRGB bytes). Suite 3169, tsc clean, gate + arms check green.

## Owner's first look (2026-09-05) — three changes

1. **Two-bone arm.** "At extreme angles the arm can be seen detached... most
   FPV rigs are full upper arm / lower arm and hand." The one-piece stick from
   the hand to a fixed anchor showed its far end at extreme view pitch. Now:
   `Upper_L/R` nodes rooted at the elbow carry the upper arm and a shoulder
   ball; `armIk()` (game-arms-math.ts) places the elbow between the hand and a
   fixed SHOULDER anchor behind the camera (`SHOULDER_L/R` in game-main), bent
   down-and-out; `aimArm()` aims the root at the elbow and the Upper node at
   the shoulder. The upper-arm mesh overshoots its IK length (0.46 vs 0.30) so
   its end is behind the eye straight or bent. `pitch-up-aimup.png` /
   `pitch-down-aimdown.png`: continuous arm, no end in frame. 9742 tris.
2. **Skin like the face.** First look: "too pale and bright versus the goblin";
   a plain darkening then read as matte olive; the reference render settled
   it — saturated green, wet sheen, fine dark speckle. `goblinAlbedoPixels`
   now follows the marched shader's recipe (smoothstep-remapped two-octave
   mottle toward mottleColor) plus a fleck lattice (24 cells/tile, ~10%
   coverage, toward charColor), under `fpvTone` (saturation 1.35, exposure
   0.86); material roughness 0.46, env share 0.55, normal scale 2.0.
   `fist-960.png`.
3. **Bracer and warts.** Brass dots -> three rows of chrome spike studs
   between the straps; warts off the fist, onto forearm and upper arm.
