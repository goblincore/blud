# Visual-actor cull — measurement notes

Plan: `docs/superpowers/plans/2026-09-20-visual-actor-cull.md` (task 1 = this
file). Evidence base: `docs/dev-notes/2026-09-20-telemetry-v3/NOTES.md` — the
level spawns every room at boot (23 actors) and pays per-actor visual upkeep
for all of them: 426 `skeleton-segment-meshes` of 815 visible meshes walked 3x
per frame, `cpu:sdf:polys` 3–5 ms CPU / `sdf:polys` 4.7 ms GPU with ZERO bodies
on screen, `tick:occluder-hull` 1.5–1.7 ms at zero bodies,
`tick:burn-kit-viewtime` 1.7 ms at 23 actors vs 0.6 at 15–18.

## THE TABLE — every later task appends one row. A task that cannot show its row did not measure.

| task | what landed | verification |
| --- | --- | --- |
| task 1 (pure selector) | `webgpu/visual-actor-set.ts` — renderer-free, **no `three` import**: `selectVisualActors()` = padded view-cone test (half the DIAGONAL fov from `fovYDeg`/`aspect` + `marginDeg` 35°, forward = game `aimDir` convention, body counted as its 1.3 m bounding radius via `angle − asin(r/d) ≤ halfAngle`) ∪ everything within `alwaysWithinM` 3 m ∪ `alsoKeep` (last frame's visible actors); distance 0 kept. Pure data in/out; nothing wired into the game yet — wiring is task 2. | `npm test -- visual-actor-set` 11/11 in 364 ms; `npx tsc --noEmit` clean. No pixel/scene numbers: no runtime behaviour exists to measure yet — task 2 owns the A/B (`setVisualCull` seam) and the pixel gate. |

## Task 1 — notes and anything surprising

- The one real design decision is what "the cone" means. A vertical-fov cone
  would cull bodies visible in the screen corners, so the half-angle is half
  the DIAGONAL field of view: `atan(tan(fovY/2)·√(1+aspect²))` ≈ 49.7° for a
  60°/16:9 camera. The 35° margin then pads it to ≈ 84.7° — wide on purpose
  (safety bias: a wrongly culled visible body is a visible bug; a wrongly kept
  one is only a cost), and `alwaysWithinM` + `alsoKeep` add two more keep
  paths that ignore the cone entirely.
- The forward convention is copied verbatim from `aimDir`
  (`game-weapon-leaves.ts:262`): `[sin(yaw)·cos(pitch), sin(pitch),
  −cos(yaw)·cos(pitch)]` — yaw 0 → −Z, yaw π/2 → +X. Both the helper and the
  behaviour (kept/dropped bodies) are pinned by tests, so a future convention
  drift breaks loudly.
- Nothing surprising in the math; the tests needed a "tight" options set
  (`marginDeg: 0, bodyRadiusM: 0.001, alwaysWithinM: 0`) because the DEFAULTS
  keep almost everything within 90° — by design, and exactly the bias the plan
  asks for.
