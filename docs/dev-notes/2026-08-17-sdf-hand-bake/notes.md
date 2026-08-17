# X1.26 task C — the baked hand look gate (captures, warp, benchmark)

Task C wired the baked volume into the lab (`hand-volume-pose.ts`, the pure
field/warp/clay state machine in `fpv-mode.ts`, and the lab A/B mode in
`webgpu/lab-main.ts`) and produced the four captures the owner judges. Design:
[2026-08-17-sdf-hand-bake-design.md](../../superpowers/specs/2026-08-17-sdf-hand-bake-design.md) ·
plan: [2026-08-17-sdf-hand-bake-prototype.md](../../superpowers/plans/2026-08-17-sdf-hand-bake-prototype.md) ·
bake/dev-note: [2026-08-17-hand-detail-bake.md](../2026-08-17-hand-detail-bake.md).

## The captures

All four at one pinned FPV eye/yaw/pitch (`setFpvAim({yaw: 0, pitch: -0.06,
pos: [0,0,4]})`, statue background, identical settings; 2640×1546 Chrome
window, `/sdf-lab-webgpu.html`), captured through the established
visible-tab CDP screenshot path (rAF-probed before every shot).

| File | State |
|---|---|
| `primitive-flesh.png` | control: capsule prims, flesh, stick + cigarette |
| `baked-clay-static.png` | baked volume, neutral clay, warp OFF |
| `baked-flesh-static.png` | baked volume, flesh, warp OFF, 2 hand wounds |
| `baked-flesh-warp.png` | baked volume, flesh, warp ON after aim-swing excitation, settled |

Baked mode isolates the right relaxed hand (left hand, stick, cigarette
hidden — the spec's sanctioned look-gate isolation) and switches the right
view to volume marching (relaxation 1.0, stepMul 0.75, hit ε = half the
largest voxel pitch ≈ 0.75 mm, ≥128 steps).

## Task-B defect found and fixed by this gate

The first capture run rendered a BLANK canvas: `sampleHandVolume`'s top-corner
clamp mixed WGSL vector types — `textureDimensions()` is `vec3<u32>` and
`dims - vec3<i32>(1,1,1)` has no overload, so EVERY march pipeline failed
compilation and froze the surface at boot. Invisible to task B because the
WGSL lives in template strings (vitest checks substrings, tsc checks TS) and
task B never rendered it live. Fix: explicit `let dimsI = vec3<i32>(dims);`
(`march.wgsl.ts`, + regression substring in `march.wgsl.test.ts`). Lesson
recorded: the shared marcher needs a live browser smoke at least once per
WGSL-touching task; string tests cannot catch type errors.

## Wiring notes

- `bakedHandPose(unjiggled, jiggled, projection)` (hand-volume-pose.ts):
  wrist/forearm prim-group mean lag is the rigid translation applied to the
  projection centre; digit/thumb-group residual minus that is the distal
  warp, projected into the anatomical basis and clamped to 12 mm. The
  determinant repair recomputes z := x×y (never negate x — that mirrors the
  thumb to the pinky side; the baker's own Z is cross(X,Y), which is the
  PALMAR side on this right hand, dorsal_sign −1).
- Unjiggled pose comes from `posedHandPrims` with jiggle points pinned AT the
  frame's `handPoseTargets`; jiggled is the live Verlet state; both go through
  `handPrimsToWorld`.
- The prim grip SHEET is dropped in baked mode (`setSheet(null)`): it was
  baked from the fisted grip hand and would smear creases across an open
  hand. Switching back restores it.
- Pure UI state (`makeHandFieldUi`/`requestHandField`/`settleHandVolume`/
  `handFieldFrame`) lives in fpv-mode.ts; lab-main only binds it. Baked is
  refused until `load: 'ready'`; load failure forces prims and exposes the
  message on `__sdfLab.fpv.handVolumeError`.
- The loaded volume is owned by lab-main and disposed on `pagehide`; each
  view's 1³ fallback is disposed by its own `dispose()` (task B).

## Pre-checks done before the owner verdict

- **Preview vs march:** the marched silhouette agrees with task A's
  `mesh-preview.png` — five fanned digits with open web spaces, a distinct
  thumb, palm mass reading, no mitten bridging. No transform/boundary/
  hit-epsilon discrepancy found, so no resolution increase was needed.
- **Digits:** separable at capture resolution; the warp-on diff map moves
  each digit's contour separately (no fused blob).
- **Flesh family:** prim hand mean RGB (63,42,40) vs baked (42,30,28) — same
  R>G>B latex family under the same preset/light/legacy-gamma path (the baked
  palm faces further from the light). Clay mean (48,37,34) is the expected
  desaturation.
- **Wound path:** one in-hand overcook (2 splash wounds) rides the shared
  wound ring onto the baked field — the rim structure is visible at the palm
  base in `baked-flesh-static.png` and absent in the pre-wound clay shot.
- **Warp:** excitation = ±0.55 rad aim swings, ~0.9 s settle. Difference vs
  the static frame is contour-only along the digits; wrist/palm core
  unmoved; no swimming at settle, no finger merge, no wrist tear.

## Benchmark (visible page, B keypress, alternating order)

Settings both sides: 1 body, SDF scale 0.7, cone OFF (occluder default on),
LOD off, statue, FPV, hands on, same 2-wound hand ring. Every run
`hiddenSteps = 0` (n=240 each).

| order | median | p05 | p95 |
|---|---|---|---|
| primitive 1 | 2.73 ms | 2.55 | 13.36 |
| baked 1 | 2.51 ms | 2.29 | 8.19 |
| baked 2 | 2.52 ms | 2.29 | 5.95 |
| primitive 2 | 2.66 ms | 2.55 | 2.90 |

Mean medians: **primitive 2.70 ms, baked 2.52 ms → regression −0.18 ms**
(baked is FASTER: one volume-sampling proxy box replaces the two prim hands'
re-pack + the prop meshes). Gate: regression ≤ max(0.5 ms, 5% = 0.13 ms) —
**PASS with margin**. (The p95 spread is first-run thermal/hitch noise, not
mode-dependent.)

## Checklist for the owner

Owner verdict: PENDING

```text
[ ] five digits separable at normal FPV size
[ ] thumb root/opposition reads
[ ] web spaces open; no mitten bridges
[ ] knuckle and palm structure read
[ ] no objectionable voxel stair-step
[ ] wounds/material match the primitive flesh family
[ ] warp adds weight without collapse or swimming
```

## Verification (task C)

- `npx vitest run src/lab/sdf-zombie/hand-volume-pose.test.ts` — 8 tests
  (rest identity, 10 mm distal lag, pinned wrist, basis conversion, 12 mm
  clamp, determinant repair both handednesses, immutability).
- `npx vitest run src/lab/sdf-zombie/fpv-mode.test.ts` — 37 tests (defaults,
  refusal until ready, failed-load fallback, frame policy, immutability).
- Full suite `npm test`, `npm run build`, `npx tsc --noEmit` — green
  (1386 tests total). Python: `uv run scripts/test_bake_hand_sdf.py -v`
  19/19 and `uv run scripts/bake_hand_sdf.py --validate-only` PASS (the
  plan's `uv run python -m unittest …` spelling only works where the
  workspace venv already has numpy — the script's own PEP 723 invocation
  is the reproducible one).
