# Boiler Room disco ball — dev note (2026-09-27)

[Spec](../../superpowers/specs/2026-09-27-disco-ball-design.md) ·
[plan](../../superpowers/plans/2026-09-27-disco-ball.md) ·
sheet: [`disco.png`](disco.png)

Owner report: the ball was "like black so hard to see and it doesn't cause the classic disco
reflection stars going across the room". Owner choice A: white at the party, the strobe's flash,
then red pulses as the emergency beacons pass the ball.

## What shipped

- **Pure** (`disco-stars.ts`): `discoDirections` (96 Fibonacci-sphere directions, seeded jitter via
  `hash01`), `discoHits` (turned about Y by the spin, cast from the ball's centre against the room's
  box: hit, inward normal, distance), `discoFade` (distance to `fadeDist` 9 m, grazing angles),
  `discoLight` (the light on the ball: party lamps' mean level in warm white, capped at 1.5 so the
  surge reads as a flash; plus each beacon's colour × level × heading coverage; rgb weighted,
  intensity summed and capped).
- **Ball** (`disco-tiles.wgsl.ts`): unlit `MeshBasicNodeMaterial` (like the window glass;
  `skipLevelLights`), hand-written WGSL: square tiles in the ball's local spherical coordinates
  (22 rows, columns per row keep them square), seeded per-tile tilt so a few flare toward the eye,
  a seeded share of the lit room, dark gaps, a small grey floor so it never reads black. Tinted by
  the same `rgb · intensity` as the stars. It keeps spinning via `stepTrain`'s `spin` sway.
- **Stars** (`disco-star.wgsl.ts`, `game-disco-leaves.ts`): one additive `InstancedMesh` of quads in
  the SDF layer's `lateScene` (depth test on, write off, polygon offset, 5 mm lift), matrices written
  straight into `instanceMatrix.array` per step (no allocation), a per-instance `fade` attribute,
  update ranges cover the live stars only. Soft disc + hot core. Hidden (the mesh, never a light)
  unless the player is in room 5 or a room joined to it (`nearRoomMask`).
- **State**: `ctx.world.disco` (world slice, +1 binding). Wiring in `game-main.ts`: `createDisco`
  after `createDynamicLight` (before the per-room light lists), `adoptDiscoFx` after `adoptLightFx`,
  `stepDisco` in the tick after `lightSteam`, `createDiscoSeams`.
- **Seams**: `__sdfGame.disco()` (room, centre, live count, stars on the room's faces, visible,
  in late scene, rgb, intensity, ball material); `setDiscoStars(on)` (cost A/B only).

## Deviations

- **Beacon coverage is on the beam's heading, not its 3D cone.** The beacons point 35° down and hang
  0.4 m above the ball's centre, so their cones (18° half-angle) miss the ball by ~30° at every
  angle: the spec's rule would give 0 forever. `discoLight` takes the horizontal angle between the
  beam and the ball with the cone's own half-angles, so the ball catches the beam each time the
  sweep passes it. Result: ~0.3 s pulses, two per 1.43 s turn (the two beacons counter-rotate).
- **The spin clock is the train clock** (`ctx.world.train.time`, the one `stepTrain` spins the mesh
  with), not `ctx.world.light.time`, so the stars turn with the ball's tiles. Both advance on the
  same sim step; the light clock picks the colour (it is what the gate pins).
- The star look was tuned once after the first sheet: `starRadius` 0.07 → 0.09, `starGrow` 0.012 →
  0.015, `rgbScale` 1 → 1.6 (the party stars read as faint specks against the tube-lit walls).

## Proof

- Unit: `disco-stars.test.ts` (14): unit directions and spread, seeding, hits on the box faces with
  inward normals and matching distance, 2π invariance, the spin moves them, no hits from outside;
  fade; `discoLight` party / beacon at the ball / at the real 35° tilt / pointing away / dark beacon /
  strobe pass-through and cap. Plus `game-state-world.test.ts` (binding count 32),
  `game-context.test.ts`, `beacon.test.ts`; `npx tsc --noEmit` clean.
- Check: `LAB_TMP=.lab-tmp scripts/sdf-disco-check.sh` (own ports 5367/9367):

```
ok   party: ball train.disco-tiles at 0,2.54,-100; 96 stars, all 96 on room 5's faces, late scene; light rgb 1.000,0.950,0.850 x 0.99
ok   strobe: flash 1.30 (rgb 1.000,0.950,0.850), gap 0.000
ok   after: red (rgb 1.000,0.080,0.050), intensity 0.00..1.00 over a turn, lit in 10/48 samples
ok   away: hidden from third class
ok   cost (report-only, load 3.87): Boiler Room after the strobe, stars off 9.25 -> on 9.05 ms = -0.20 ms
```

  One cold first run read the party stars hidden (not reproduced in 5 later runs); the script now
  sets the pose again right before its hand steps.

## Cost

Boiler Room after the strobe, beam on the ball, sim step + draw per frame, 9 frames × 10
interleaved rounds, 800×600 headless: stars on − off **−0.20 ms** (load 3.87, rounds −7.8..+0.7,
one outlier), **+0.00 ms** (load 4.25, rounds −1.1..+0.7), +0.15 ms (load 6.96). Within noise: one
96-instance draw and 96 ray-box tests. (The working tree carried another agent's uncommitted
flashlight/light-list shader edits during these runs; they touch body lighting, not this draw.)

## The sheet (`disco.png`: party, beam on the ball, between passes)

Flashlight off, lightning held off, no cast. What reads:

- **Party**: the ball is clearly a silver mirror-tile ball (tile grid visible, a few bright
  glints), and white elliptical stars are sprayed over the ceiling, both walls and the floor. The
  right half of this frame is washed out by a steam plume under the tube near the camera.
- **Beam on the ball**: the tiles glow red and the room is covered in red stars, larger on the near
  surfaces; clearly the classic look.
- **Between passes**: no stars; the ball reads grey-tiled (the floor term), the beacon beam visible
  off to the right. Side by side the two after-frames show the pulse.

What does not read / open questions for the owner: stars on the side walls foreshorten into tall
ellipses (correct perspective, but they read as streaks at a glance); the pulse is brief (~0.3 s
per pass) because the beams face the ball only briefly; stars go through furniture and bodies
(accepted limitation); the ball does not reflect the flashlight.
