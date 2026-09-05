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
