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

## Task 2 + review (2026-09-21) — wiring by the dispatch agent, occlusion added in review

Wiring (dispatch agent, `zai/glm-5.3-flash:high`, kept as written): the set is
computed once per tick into `ctx.render.visualActors`; view time / head shape,
both live hull updates and the wound exclusion spheres, the skeleton mesh
renderer (`update(entries, owners, shown)`) and its crater list read it;
`?visualcull=0` / `__sdfGame.setVisualCull(false)` restore the old behaviour;
`visualActors` is in the recording state. Two calls of the agent's worth keeping:
the FROZEN one-shot hull build is deliberately NOT filtered (captures teleport
the camera after it; filtering it discards staged bodies' fragments), and the
kit `pose()` loop was left alone. It also moved telemetry-v4's `gpuCollecting` /
`gpuAttributor` off `main()` bindings onto `ctx.telemetry`
(`game-context-coverage`).

What the plan got wrong: **the cone ignores walls, and it is nearly a hemisphere**
(diagonal FOV 50.4 deg + 35 deg margin). From the spawn room, looking down the
level, it kept 23 of 23 — the agent measured exactly that and was diagnosing it
when the task was cancelled. Fix in review: `selectVisualActors` takes an
`inSight` predicate, fed the march cull's own per-cluster test
(`actor-sight.ts`). Sight depends on positions, not view direction, so it is not
stale; the margin still covers the flick; `alsoKeep` bypasses it.

Measured, one page, seam-toggled off/on/off/on (headless, room 1):

| | visual set | visible meshes | bodies on screen |
| --- | --- | --- | --- |
| off | 23 / 23 | 816 | 3 |
| on | 5 / 23 | 487 | 5 |
| off | 23 / 23 | 820 | 5 |
| on | 6 / 23 | 507 | 6 |

Frame after a 180-degree `setPose` flick: flesh, skeleton and wall shadow all
present. Pixel gate: room1 `8f2b74e7…` (+repeat, wounded `1381a866…`), room2
`35b6d561…` — canonical. Frame-time saving: NOT measured here; needs an owner
recording against the `2026-09-21T03-12-07` baseline.

Found on the way: `march-hash` could hash the per-body FALLBACK (returns
`2c5dac0d…` = PERBODY_HASH) when the crowd program was still compiling — fixed
in the gate. And on a cold profile under load the GIB background job hit its
180 s per-pass timeout and settled `failed`, which means `gibDraw()` stays
`skip` for that whole session (no gib chunks). Open.
