# X1.23 — FPV + dynamite, final wiring (task 4)

Branch `dispatch/fpv-dynamite-task-4`. Modules from tasks 1-3 (fpv.ts,
dynamite-flight.ts, hands.ts, explosion-aoe.ts — all pure, all tested) wired
into `webgpu/lab-main.ts` through a new orchestration seam.

## What landed

| File | Role |
| --- | --- |
| `src/lab/sdf-zombie/fpv-mode.ts` | Pure orchestration: mode machine (god↔fpv), cook→throw→flight→detonate pipeline, `applyExplosionEffect` (the resolver→gore-port routing), hand pose driver + per-prim Verlet jiggle, camera-kick envelope, `forceThrow` automation. 22 unit tests. |
| `src/lab/sdf-zombie/webgpu/fpv-view.ts` | Render tail: `createHandsGpuView` (chunk-view tech — own data texture, world-space re-pack per frame, hero's material template incl. legacy gamma, own wound ring), `createStickProp` (cylinder bundle + flickering fuse spark), `createBurstLayer` (billboards; game SEQ atlases if the local extraction exists, else procedural flipbook). |
| `webgpu/zombie-gpu.ts` | Export-only change: `createDataTexture`/`writeWounds`/`createMarchMaterial`/`marchBody`/`defaultUniforms`/`blankFaceTexture` now exported for the hands view — one copy of the packing machinery. |
| `webgpu/lab-main.ts` | Wiring: Tab toggle + pointer lock, FPV input latch, FPV camera branch (eye 1.75 m, kick as roll/pitch), hands/stick/burst stepping in the frame callback, charge-bar DOM HUD, `fpv` panel section, `__sdfLab.enterFpv/exitFpv/throwDynamite/setFpvAim/setFpvHands/fpv`. |

### The gore port (the seam that keeps lab-main honest)

`applyExplosionEffect(port, effect, at, hero)` routes one resolved bundle:
**gibbed ⇒ `gibBody()` only** (single-hit rule); else `stampWounds` →
`creditMeter(meterCredit)` **directly** → `impulseRig` + `pushShot` (the same
`MotionSignals['shot']` a blast click-shoot produces — blast maps to 'lurch')
→ `severFullLimbs`/`applyChainCuts` (the keyboard-sever / distal-cut paths);
then `impulseChunks`, `spawnBurst`, `stampHandWounds`. The port impl in
lab-main calls `pushWound`/`impulseAt`/`severLimb`/`severDistal`/
`gibEverything`/chunk-velocity adds — nothing re-implemented.

**Meter contract (regression-tested in fpv-mode.test.ts):** the meter is
credited with `effect.meterCredit` as a number. Passing explosion wounds as
`stepCollapse` freshWounds would weight them by PROFILE radius (~2.08 meter
for ANY in-radius blast) and collapse the zombie from an edge graze.

## Browser verification (2026-08-17, headed Chrome + CDP, vite :5277)

Full log in `results.json`; screenshots below. WebGPU backend confirmed,
`hiddenSteps: 0` on every bench.

- **FPV + hands**: Tab → pointer-locked FPV at 1.75 m eye. Pixel probe
  (bottom-corner region stats, hands on vs off via `setFpvHands`):
  fleshFrac 0.097/0.062 (L/R) → 0.005/0.003 — the hands ARE marched SDF flesh
  in the lower frame. `11/12-fpv-hands-*.png`.
- **Cook → charge bar**: 1 s hold reads 49-50% charge; DOM HUD visible with
  the right fill % and color. `02-cook-charge-bar.png`.
- **Throw + arc + standoff detonation**: charge 0.1 from 4 m → bundle arcs
  (flight pos tracked), lands, **16 wounds, meter 0.407, stagger 'lurch',
  no gib** — the far-falloff path. `03-flight-arc.png`, `04`.
- **Point-blank gib**: 1.2 m out, steep-down aim, charge 0.12 → bundle lands
  at its feet → **chunks 6, wounds 0 (gib supersedes), collapse falling** —
  the single-hit rule through the EXISTING gib stack. `05-point-blank-gib.png`.
- **Overcook in hand**: hold 2.4 s → in-hand air burst, **2 hand-splash
  wounds**, blast credits the meter (body falls), charge HUD gone.
  `06-overcook-hand-scorch.png` (screen fills with the fireball — mid-region
  flesh 0.46), `07-overcook-after.png` (settles back).
- **Burst selection**: ground = landing bursts (bottom-anchored dome), air =
  in-hand burst (centered fireball) — driven by `BurstVisual.kind` from the
  resolver's `GROUND_BURST_THRESHOLD_M` logic, same anchoring as the game's
  `ExplosionVfx`.
- **Walking**: W from origin 350 ms → [0,0,-2.1] — direction + floor-bounds
  clamp correct (walk bounds are the lab floor ±9.5; the bundle still flies
  the game's BALLISTIC_BOUNDS ±19.5).
- **God-cam regression**: after exit, `setCam` + click-shoot wounds the body
  (wounds 1); orbit/drag/sever keys untouched in god mode (FPV gates the
  pointer handlers instead).

## benchGpu — hands on vs off (the spec §2 perf gate)

Same camera, same scene (1 body, wander off, sdfScale 0.70, 960×540 buffer),
3 interleaved pairs, all `hiddenSteps: 0` (`/tmp/fpv4-bench.json`):

| run | hands off median | hands on median |
| --- | --- | --- |
| 0 | 1.04 ms | 1.45 ms |
| 1 | 1.01 ms | 1.48 ms |
| 2 | 1.14 ms | 1.46 ms |

**The hands cost ≈ +0.4 ms median** (their proxy box covers meaningful
screen area up close and marches its own field at full step budget). At the
60 fps budget that is ~2.5% — well inside the gate; no LOD/step demotion
needed. p95 sits in the same band as the body (1.4-5 ms thermal noise on
this M3; the occasional 4-8 ms p95 spike appears on BOTH configs).

Note: a naive "god-cam vs FPV" comparison is confounded — the god orbit at
2.4 m fills more pixels with the body than the FPV view from 3 m — which is
why the gate is measured with the camera pinned and only `setFpvHands`
flipping.

## Asset guardrail

`createBurstLayer` fetches the game's atlas manifests at the exact paths
`src/main.ts` loads (`/assets/vfx/explosion-{air,ground}-placeholder/…`).
Those atlases are **local-extraction-only (gitignored)** — on this machine's
clean worktree they are absent, so the lab ran the **procedural flipbook**
fallback (verified: `burstsUseAtlas: false`, bursts visibly render — see the
pixel probes). No extracted-asset file was committed; the fallback keeps a
clean checkout fully functional. On a machine with the extraction present the
billboards switch to the SEQ atlases automatically.

## Screenshots

`01` FPV idle hands · `02` cook + charge bar · `03` flight arc · `04`
standoff-blast wounds · `05` point-blank gib · `06/07` overcook scorch +
aftermath · `08/09` bench god/FPV · `10` god-cam after exit · `11/12` hands
on/off pixel-probe pair · `13/14` in-hand burst fill + settled.
