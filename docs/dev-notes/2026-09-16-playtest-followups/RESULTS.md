# Playtest follow-up Task 3 — NotBlood-derived launch distribution and grounded rest

Worktree `2026-09-16-blud-playtest-followups-task-3`, branch
`codex/playtest-followups-task-3`, from Task 2 tip `874f21db`. Node `v22.22.1`.
Design reference and source citations: [PHYSICS.md](PHYSICS.md).

**Owner report this task answers.** *"Gib launch should more closely follow the
existing ported NotBlood behavior; pieces cluster too much."* and *"fix floating
or upright resting gibs"* (explicitly moved into scope).

**No NotBlood C source is present on this machine** (see PHYSICS.md §0), so the
launch is derived from Blud's verified port + generated tables, and every gap is
labelled. No invented fidelity claim.

## 1. What changed

| # | Change | File |
| --- | --- | --- |
| 1 | **`gib-launch.ts` (new).** The launch is now the SOURCE two-path model: an independent per-piece random spread from the gib table's `atc`/`at10` fields (`GibThing` no-`pVel`, `gib.cpp:361-432`) PLUS one shared coherent body shove (`ConcussSprite`, `actor.cpp:2677`). Unit chain and worked numbers in PHYSICS.md §2. | `src/lab/sdf-zombie/gib-launch.ts`, `.test.ts` |
| 2 | **The old per-piece `concussionVelocity(at, g.origin, ...)` is gone from `gibActor`.** It was the generic radial shove, which correlated neighbours. The shared shove is computed ONCE at the torso centre; the spread is hash-deterministic per `"<part>#<index>"` and global `?seed=`. | `webgpu/game-main.ts` |
| 3 | **`?giblaunch=radial`** restores the old path as a labelled A/B control. Default `notblood`. | `webgpu/game-main.ts` |
| 4 | **Orientation-aware floor/ceiling support.** `Chunk.support` is the piece's real local geometry (one sphere per capsule end, `chunkSupportSpheres`); `stepChunk` floors at the lowest world point for the CURRENT orientation and re-seats upward after the topple. `chunkSettled` uses the same predicate. `radius` stays the conservative broad-phase wall bound. | `gib-chunks.ts`, `extent.ts` (+ tests) |
| 5 | **`gib-rest.test.ts` (new).** Measures the rendered surface-to-floor gap on real severed limbs through the same rotate-then-squash transform the renderer/bake use. | `src/lab/sdf-zombie/gib-rest.test.ts` |

Angular hand-off (`spinQuat`/`spinAngVel`, task 4), the rupture's separation
geometry, the release `delay=0`, the accepted face/material ownership and the
bounded pools are untouched.

## 2. Tests and build

```
npx tsc --noEmit                      # clean
npm run build                         # tsc --noEmit && vite build — exit 0, built in 3.89s

npx vitest run \                      # focused chunk/gib/launch/rest set
  src/lab/sdf-zombie/gib-chunks.test.ts src/lab/sdf-zombie/gib-launch.test.ts \
  src/lab/sdf-zombie/gib-rest.test.ts src/lab/sdf-zombie/extent.test.ts \
  src/lab/sdf-zombie/gib-rupture.test.ts src/lab/sdf-zombie/gib-parts.test.ts \
  src/lab/sdf-zombie/gib-tear.test.ts src/lab/sdf-zombie/explosion-aoe.test.ts \
  src/lab/sdf-zombie/webgpu/baked-chunks.test.ts \
  src/lab/sdf-zombie/webgpu/chunk-bake-jobs.test.ts \
  src/lab/sdf-zombie/chunk-bake-field.test.ts \
  src/lab/sdf-zombie/webgpu/gib-sprite-pieces.test.ts
# 12 files passed, 201 tests passed

# Second focused set (sever/melt/bake/actor panel/renderers):
# 17 files passed, 459 tests passed, 0 failed
```

New tests, by behaviour:

- `gib-launch.test.ts` (8) — the exact ported unit chain (300→75 m/s, 900→225
  m/s); determinism by key and seed; **near-coincident pieces get independent
  directions** (mean pairwise |dot| < 0.75 vs a common spoke ≈ 1.0); the source
  1:3 horizontal:vertical envelope is preserved; the kick is never downward; the
  shared shove is applied at `coherentFrac`; the speed bound; the zero case.
- `gib-chunks.test.ts` (+9) — support offset follows rotation; a flat long piece
  rests on its THICKNESS (0.06 m) not its half-length (0.56 m); an upright piece
  rests on its end and never sinks; `chunkSettled` no longer calls a floating
  piece grounded; a toppling limb ends flat ON the floor; the default single
  sphere keeps existing calls bit-identical.
- `extent.test.ts` (+5) — `chunkSupportSpheres`: one sphere per capsule end at
  the prim girth, LOCAL centres, carves skipped, point-budget fallback.
- `gib-rest.test.ts` (5) — four real severed limbs (legL/legR/armL/armR) settle
  with the rendered surface ON the floor.

## 3. Grounded rest — measured

Rendered-cap surface gap (lowest world point of the piece's capsules, through
`chunkPoint`'s rotate-then-squash transform) after settling a real severed limb:

| piece | broad `chunkExtent` (old pin) | resting origin y | rendered surface gap |
| --- | --- | --- | --- |
| legL | 0.603 m | 0.108 m | **0.0000 m** |
| legR | 0.603 m | 0.108 m | **0.0000 m** |
| armL | 0.370 m | 0.084 m | **0.0000 m** |
| armR | 0.370 m | 0.081 m | **0.0000 m** |

Under the old single-radius pin each of these rested with its origin at the
extent (0.60 / 0.37 m) — i.e. floating by roughly half a limb. A real severed
arm also exposed a second defect during this work: the topple rotates the piece
AFTER the floor clamp, and on a real arm that swung a support sphere 1.6 cm
lower, so the returned state was sunk. `stepChunk` now re-seats UP (never down)
after the topple; the arm gap went −1.6 cm → 0.0000 m.

## 4. Launch distribution — A/B measured

Same body, same blast, same seed (`?seed=7`), same camera/standoff
(front, 3.0 m), same `?gibtear=0.2`; only `?giblaunch=` differs. Velocities are
finite differences of each piece's centre across the two release frames
(`t3-front` / `t3-radial` telemetry, release at 217 ms).

| metric | new (notblood) | radial control | note |
| --- | --- | --- | --- |
| pieces | 14 | 14 | full split plan |
| launch speed min/med/max (m/s) | 5.71 / 8.38 / 10.61 | 7.39 / 8.38 / 8.43 | new speed VARIES; radial is uniform |
| 0.5 s landing-distance range (m) | **1.30** | 0.26 | **5.08×** more distance spread |
| mean pairwise \|Δv\| (m/s) | 3.18 | 3.69 | radial's angular fan is not low-dispersion at point blank |
| mean pairwise \|dot\| 3D | 0.947 | 0.855 | see honest limit below |
| mean pairwise \|dot\| XZ | 0.605 | 0.539 | near the isotropic 0.637 baseline |

**Honest reading.** The metric that maps to the owner's "cluster" is the
*landing-distance spread*: the radial control launches every piece at almost the
same speed, so they stay on a shell at the same distance from the blast, while
the source-derived spread gives each piece its own envelope and they land at
clearly different distances (5.08×). The 3D direction-dot metric is WORSE for the
new path because the source tables give `at10 = 3 × atc` — every gib gets a
strong upward kick (this is genuine NotBlood behaviour), so all 3D direction
vectors lean up. Direction-dot alone is therefore the wrong acceptance metric
here; the visual read and the landing spread are the ones that changed.

## 5. Native-vision observations (images actually opened)

All images below were opened with the native image viewer.

| Image | What was inspected | Observation |
| --- | --- | --- |
| `captures/task3-new-launch-front-sheet.jpg` | new, front, 16 tiles, body crop | f0 intact body; f1–f11 the chest peels and ribs show (task 2/3 preserved); f12 release; f15–f30 pieces fan out with visibly different arcs and distances — one limb high-left, chunks centre/right. |
| `captures/task3-radial-control-front-sheet.jpg` | radial control, same framing | Same onset/peel; from f15 the pieces form a narrower, more evenly spaced fan and by f24–f30 read as a tighter column. |
| `captures/task3-new-launch-front-grid.jpg` | new, full frames f0/13/15/18/24/30/45/60 | At f45/f60 pieces are distributed across the frame; no single spoke or column. |
| `captures/task3-radial-control-front-grid.jpg` | control, same frames | At f45/f60 a narrow vertical run of red remains down the blast axis — the clustered read the owner reported. |
| `captures/task3-settle-live-grid.jpg` / `task3-settle-baked-grid.jpg` | 4.7 s, frames 0/13/…/280, bake OFF vs default ON | The two grids are visually indistinguishable frame for frame — no sink or pop at the live → baked swap. |
| `captures/task3-settle-live-f280.jpg` / `task3-settle-baked-f280.jpg` | final frame, 800×600 | The pieces lie on the floor: a pale bone ring flat at left, red chunks flat mid-frame, a white bone tube flat upper-right. No piece is visibly floating or standing on end. |
| `captures/task3-settle-live-floor.jpg` / `task3-settle-baked-floor.jpg` | 1.8× floor crop of the final frame | Close floor read: settled pieces rest ON their blood decals; live and baked are indistinguishable. |
| `task3-new-launch-front-normal.mp4` / `task3-radial-control-front-normal.mp4` | 0.5 s at 60 fps, looped 4×, normal speed | New: pieces leave on varied arcs and spread. Control: a tighter fan/column. |
| `task3-settle-baked-front-normal.mp4` | 4.7 s at 60 fps, normal speed | Flight → bounce → settle → bake; no floating piece frozen mid-air. |

## 6. Reproduction

Owned Vite on `5407` + headless Chrome on `9407` (`--enable-unsafe-webgpu`,
scratch in `.lab-tmp/`); the owner's `5391`/`5415` and the other task's `5403`
were never touched. Emulated viewport 960×720 CSS at DPR 1; the page's
`presentedShot()` came back 800×600. Frozen loop (`?frozen=1`), one fixed 1/60 s
step per captured frame, `?seed=7`, stand-in explosion VFX so the body is not
hidden, `?gibtear=0.2`.

```
bash scripts/link-dev-assets.sh
LAB_VITE_PORT=5407 LAB_CDP_PORT=9407 LAB_TMP="$PWD/.lab-tmp" \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; while true; do sleep 30; done' &

# launch A/B (normal-speed flight)
RUP_VIEW=front RUP_DIST=3.0 RUP_FRAMES=150 RUP_SEED=7 RUP_VFX="&explosionfx=standin" \
  node scripts/sdf-gib-rupture.mjs 5407 9407 /tmp/t3-front  "&gibtear=0.2" t3-front
RUP_VIEW=front RUP_DIST=3.0 RUP_FRAMES=120 RUP_SEED=7 RUP_VFX="&explosionfx=standin" \
  node scripts/sdf-gib-rupture.mjs 5407 9407 /tmp/t3-radial "&gibtear=0.2&giblaunch=radial" t3-radial

# settle A/B (live-marched vs baked)
RUP_FRAMES=280 ... /tmp/t3-settle-live  "&gibtear=0.2&chunkbake=0" t3-settle-live
RUP_FRAMES=280 ... /tmp/t3-settle-baked "&gibtear=0.2"             t3-settle-baked

# clips
ffmpeg -stream_loop 3 -framerate 60 -pattern_type glob -i '/tmp/t3-front/t3-front-f*.png' \
  -vf scale=640:-2:flags=neighbor -c:v libx264 -pix_fmt yuv420p -crf 20 task3-new-launch-front-normal.mp4
```

Final census at frame 280 (~4.68 s): bake OFF `chunks 13/14, baked 0`; bake ON
`chunks 2/2, baked 12`, `spin 0.00 rad/s` — i.e. the pieces settled and 12 of 14
had baked, with the two remaining live (one out of frustum).

**Machine load was high during the runs** (1-min load 3.3 / 15-min 17.5; other
Claude sessions and Chrome processes were resident). Every capture is a frozen,
fixed-step loop, so contention affects wall time, not the simulated result; no
timing or performance claim is made from these runs.

## 7. Limits / honest gaps — do the criteria actually hold?

1. **Owner acceptance is NOT claimed.** Model inspection is not the owner's
   playtest. The clips and sheets are the review material.
2. **No same-session `?giblaunch=radial` control was captured before the fix's
   direction metric was chosen.** The A/B above is the new path vs the explicitly
   restored old path on the same seed/camera, which is the closest available
   control. The radial control's `at`-relative magnitudes are the old code's.
3. **The 3D direction-correlation number is worse than the control** (0.947 vs
   0.855) for the source-faithful reason in §4; this is reported, not hidden.
4. **Grounded rest was judged from a chest-height camera at 3 m**, not a
   dedicated floor-level side camera. The pieces are clearly on the floor in the
   final frames and the crop, but a purpose-built low camera would be stronger.
   The unit-level gap measurement (§3) is exact and pins the fix.
5. **`?gibrender=carve` keeps the old single-sphere support** (its pieces carry a
   pre-baked radius/long-axis and no prim list). Carve is non-default.
6. **Piece-to-piece contact does not exist** and was not added: the floor is a
   plane and the walls/ceiling are the level colliders. "Pile-adjacent" pieces
   therefore overlap on the plane rather than stacking. The task asked for floor
   and wall/ceiling contact, which is what is implemented. This is a documented
   behaviour, not a regression.
7. **No full vitest suite** was run (shared machine; per the recorded warning).
   Two focused sets (201 + 459 tests) plus `tsc` and the production build passed.
8. **No performance claim.** The support loop is O(support spheres) (≤ 10 points
   per current piece) per chunk per frame; the launch adds three hashes per piece
   at spawn. Neither was measured.

## 8. Commit

Code + evidence commit: `<fill after commit>` on
`codex/playtest-followups-task-3` (inherits Task 2 `874f21db`). No merge, no
push. Extracted assets were never committed.
