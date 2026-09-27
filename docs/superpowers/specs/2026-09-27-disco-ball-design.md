# Boiler Room disco ball: mirror tiles and sweeping stars — Design

**Date:** 2026-09-27 · **Status:** approved by the owner in chat (choice A, design "lgtm").
**Owner report:** the disco ball is "like black so hard to see and it doesn't cause the classic disco reflection stars going across the room".
**Context:** Night Train carriage 5, the Boiler Room.
- The ball is the kit piece `disco-ball`, at (0, h − 0.33, u 10). It spins with `discoSpin(t)`, 0.7 rad/s (`train-motion.ts`), driven by `game-train-leaves.ts` sway kind `spin`.
- The room's two ceiling tubes run the `strobe` script at the threshold, then die for good.
- The two red emergency beacons take over after the strobe (`docs/superpowers/specs/2026-09-27-boiler-room-beacons-design.md`).

## 1. The ball

The ball gets a mirror-tile material at runtime, replacing its dark kit material.

- **Tiles.** Small square facets. Each has a seeded glint that flares as the facet turns toward the camera. The tile gaps stay dark.
- **Tint.** The facets are tinted and scaled by the light on the ball: party white, then beacon red (§3).
- **Spin.** It keeps turning with the existing disco spin. The tiles are in the ball's own frame, so they turn with it.
- **Hand-written WGSL.**

## 2. The stars

- **Directions.** There are **96** fixed reflection directions on the ball: a Fibonacci sphere with seeded jitter. They rotate about Y by the same `discoSpin(t)` as the mesh.
- **Hits.** Each frame, each direction is cast from the ball's centre against the **Boiler Room's box**: its walls, floor and ceiling, from the level's room bounds. Pure CPU work, cheap.
- **Size and fade.** At each hit a soft round star is placed flush with the surface, pushed off it by a few mm. It grows slowly with distance, and fades with distance and at grazing angles.
- **Drawing.**
  - All 96 stars are one additive `InstancedMesh` in `sdf-layer`'s `lateScene`, with depth test on and depth write off.
  - It is drawn only while the player is in the Boiler Room or a room joined to it. The mesh can be hidden; the no-`.visible` rule is for lights only.
- **Limitation (accepted).** Stars never land on zombies, and pillars and the bar don't block them.

## 3. Colour and intensity through the beat (owner choice A)

| Phase | Stars and ball tint |
|---|---|
| Party, before the strobe | White (slightly warm), at the room's party-lamp level |
| Strobe | Follow the strobe level (flash) |
| After the strobe | Red. Intensity = the strongest beacon's cone coverage **of the ball** at that moment, so the stars pulse as a beam passes over the ball |

This is a pure rule: `discoLight(lampLevel, beacons[])` → `{ rgb, intensity }`, where each beacon has position, axis, cone, level and colour.

## 4. Code layout

| Piece | Where |
|---|---|
| Directions, ray-box hits, `discoLight` | `src/lab/sdf-zombie/webgpu/disco-stars.ts` (pure, no three) + tests |
| Star mesh and mirror-tile material, per-frame update | a renderer leaf next to the train's moving parts (`game-train-leaves.ts`, or a new `game-disco-leaves.ts`) |
| Star and tile shaders | hand-written WGSL (`*.wgsl.ts`) |

Everything runs on the sim clock (`ctx.world.light.time`), and the directions and glints are seeded.

## 5. Proof and cost

- **Unit tests:** directions on the unit sphere, hits on the box faces with correct normals, and `discoLight` in each phase.
- **A standalone headless check** (its own script, so it doesn't collide with other work on the light gate). It asserts:
  - stars land on room-5 surfaces;
  - they are white before the strobe and red after;
  - after the strobe, their intensity varies with the beacon sweep.
- **A contact sheet for the owner:** the room before the strobe and after the strobe, at two beacon angles.
- **Cost:** one extra draw of 96 instances plus about 96 ray-box tests a frame. Report the frame time delta in the Boiler Room.
