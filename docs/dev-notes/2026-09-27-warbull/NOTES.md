# Warbull — Task 1 notes (body), 2026-09-27

Plan: `docs/superpowers/plans/2026-09-27-warbull.md`, Task 1.

## What landed

- **`characters/warbull.blob`** is `minotaur.blob` ×1.28 on every length, with
  angles and bone fractions unchanged. That takes 1.90 m to 2.432 m, with the
  horn tip at 2.605 m (field-marched). Beyond the scale:
  - **Dropped** the painted right-leg prosthetic (five metal `box` plates, a cable
    and two seam grooves) and the painted shoulder cables. Both legs are the
    minotaur's left-leg flesh, mirrored.
  - **Left-only** horn sweep and glowing eye bead. The right side is kit (steel
    horn, optic). Both horn-root bosses stay, as the steel horn's socket.
  - **A hump** behind the neck (one torso blob). The back surface at y 1.65–1.85
    moves from z ≈ −0.29 to about −0.39: about 10 cm of profile, where the
    minotaur has only the gap behind its traps.
- **`warbull-face.png`** was baked from the minotaur reference mesh
  (`blob:face-bake -- minotaur --head-frac 0.165`), then soft-cropped to the face
  band. The minotaur's own PNG was never committed; the registry has been 404ing
  it. Mean 0.3204, measured off the opaque texels.
- **Registry entry** `warbull`, shown as `?character=warbull` in the lab. He
  walks the zombie shamble for now; his profile is Task 4.
- **Tests:** `warbull-blob.test.ts`, 13 pins (plan, Task 1).

## Frames

There are no GPU frames: the cloud container has only SwiftShader, as for the
Juggernaut. The image below is a CPU sphere-trace of `sdBody`: flesh only, with
no face decal, no palette and no kit. Views are front, side and three-quarter,
with the Juggernaut's flesh left and the Warbull right in each pair. The blue
lines mark 2.60 m and 2.291 m.

![body vs juggernaut](body-vs-juggernaut.png)

## For the owner to judge in the lab

- The bull head and horns at scale, and whether the hump reads from the side.
- **Palette:** kept at the minotaur's pink (henenlotter-latex). A darker,
  redder hide may contrast the chrome better; judge that once the kit is on.
- **Gait:** the zombie shamble for now. STOMP (the ogre's) is the candidate.
