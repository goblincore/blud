# Burning feedback task 1 — fire lights the room + neighbour molten look

Branch `dispatch/2026-09-18-burning-burn-room-light` (worktree
`2026-09-18-burning-feedback-task-1`). Plan:
`docs/superpowers/plans/2026-09-18-burning-feedback-pass.md` task 1; spec
`docs/superpowers/specs/2026-09-18-burning-feedback-pass-design.md` §A.

Capture: `scripts/burn-light-capture.mjs`, headless Chrome + WebGPU, warm gate
`ready`, renderer-pipeline-error guard. Raw report:
`task-1-captures/burn-light-report.json`; screenshots beside it.

    npm run flame:atlas                     # once per worktree (gitignored)
    node scripts/burn-light-capture.mjs 5496 9496 \
      docs/dev-notes/2026-09-18-burning-feedback/task-1-captures

## What shipped

- `webgpu/burn-room-light.ts` (+ test): pure slot policy. `fireGatherLights`
  caps fire at N gather slots and MERGES a surplus burner into the nearest kept
  slot (intensity summed at the intensity-weighted position — the room does not
  go dark when a third body catches); `assignFirePool` fills the mesh pool
  nearest-first and zero-fills the rest.
- `burn-profiles.ts`: `lightGatherPeak` (default 120, bounds [0,400]) and
  `lightMeshPeak` (default 40, bounds [0,400]); the flame panel gained the two
  sliders (its "every tunable has a slider" test required them).
- `game-burning.ts`: `pushGatherLights` (≤2 gather slots, colour
  `[1.0,0.5,0.18]`, `fill = spread*0.5`), `createFireLightPool` (4 permanently
  visible `PointLight`s at intensity 0), `updateFireLightPool`, `setTuning`.
  `pushFlashes` now uses `lightFlicker * 0.25` (see B).
- `game-main.ts` call sites only: pool created once right after
  `createGameBurning` (before the warm-up's `drawOnce`, so the lit materials
  compile with 3 explosion + 4 fire point lights); `pushGatherLights` after the
  "(3b) LIVE EXPLOSIONS" loop; `updateFireLightPool` beside the explosion pool
  writer; console seams `setBurnTuning`, `burnTuning`, `burnGatherDebug`,
  `igniteActor`.
- `game-seams-world.ts`: `worldToScreen` capture seam; `game-seams-fx.ts`: live
  `probeGates` / `probeDispatchCount` (the `probeDynamic` **getter is a boot
  snapshot** — object spread evaluates it once — so it cannot testify about a
  running gather).

## A. Fire lights the room

Frozen frame (light clock frozen, demo-hold on, zero-dt steps, pure-estimate
gather). 60×60 floor crop beside the burner at (683, 503); mean luma:

| arm | floor crop | whole frame |
|---|---|---|
| gather 120 + mesh 40 | **29.13** | 49.31 |
| gather 120 + mesh 0 (gather only) | 21.00 | 43.77 |
| both 0 | **21.00** | 43.77 |

- **Total fire light: +8.13 luma on the crop (+5.54 whole-frame).**
  `bothOn > bothOff` is the spec's done criterion, and it is unambiguous.
- Gather contribution here: **0.00**. Mesh pool: **+8.13**.

**Pipeline check (no first-ignite re-key).** `pipelineLog()` immediately before
`igniteActor` and after the 2 s burn ramp:
`totalPipelines 205 → 207 (+2)`, `compileMs` unchanged, `evictions 79 → 79`,
`rebuilds 0`, long frames 0. The +2 are the flame-card material's own first
draw; **no lit material was re-keyed or rebuilt**, which is what creating the
pool before warm-up buys.

**Gather cost, 4 burners vs 0** (`bench({mode:'passes'})`, the probe gather's
own `compute:probe-gather` pass timing — `probe-gather-compute.ts` labels the
dispatch):

| arm | mean ms | p50 ms |
|---|---|---|
| 0 burners | 0.031 | 0.000 |
| 4 burners | 0.070 | 0.066 |
| delta | **+0.039** | **+0.066** |

The pass timer's quantum is 0.0655 ms, so this is ~1 quantum; the gather is a
0.03–0.07 ms pass in this four-probe-row room, and fire's two extra packed
lights do not move it meaningfully.

### A finding: the gather fire light is self-shadowed

`burnGatherDebug` proves the light is pushed (1 source, in room, 1 slot, max
intensity ≈ 87–99) and `probeGates().lights` is **2 with fire vs 1 without** —
yet the 400-probe dynamic buffer is **byte-identical** (`radianceAbsSum` 115.95
both). The chest anchor (`burnLightAnchor`) sits inside the burning body's own
torso capsule, so every probe ray to it is blocked by `kdShadowed`: the packed
light contributes zero. The mesh-side `PointLight`s have no shadow test, which
is exactly why the floor brightens through them and not through the gather.

Experiment: lifting the gather anchor 1.8 m above the crown clears the body's
capsules — `radianceAbsSum` 114 → **5475** (max 186.6) and the floor crop gains
**+4.22 gather / +8.12 mesh**. But it re-introduces a ~10× larger flicker on the
non-burning neighbour (fires B's fire-on change 0.016 → 0.161 luma/frame),
regressing A2. Shipped the chest anchor (the plan's), mesh pool carries the
room; the gather path stays wired and is reported here for the owner/reviewer to
decide. The code comment in `pushGatherLights` records the same.

## B. Neighbour molten look

One burning zombie, a non-burning neighbour 1.4 m away. 30 frames of a 40×40
crop that follows the neighbour's torso; mean absolute frame-to-frame luma
change, dt 0 (sim, pose and shader clock pinned) so only the wall-clock light
flicker moves:

| arm | change/frame | mean luma |
|---|---|---|
| fire on, **before fix** (full `lightFlicker`) | **0.1508** | — |
| fire on, after fix (`lightFlicker*0.25`) | **0.0152** | 217.14 |
| bodyFlash off (room lights on) | 0.0001 | 214.58 |
| all fire lights off (`lightPeak/lightGatherPeak/lightMeshPeak = 0`) | 0.0000 | 214.58 |
| `lightFlicker = 0` (all fire light steady) | 0.0000 | 217.14 |
| burn distortion off | n/a — `burn-distort.ts` is used only by `flame-lab-main.ts`; the game has no burn-distortion seam or feed | |

- **Cause: the `directFlashes` flicker.** All light paths steady (`lightFlicker
  0`) or all fire lights off → change ~0; turning off only `bodyFlash` drops
  0.0152 → 0.0001. There is **no burn-value leak**: the neighbour's per-view
  `burnCfg = (0,0,0,0)` and it has no `burning()` entry.
- **Fix:** `pushFlashes` pushes `lightFlicker * 0.25`. The burning body still
  flickers via its own animated surface-fire emissive and the room lights.
  **0.1508 → 0.0152 = 9.9× reduction**, and the residual is entirely the
  quarter-depth direct flash (the room lights contribute 0.0001).
- The plan's literal "within 1.5× of a no-fire baseline" is not met in ratio
  terms because the pinned baseline is 0.0000 — any non-zero residual is
  infinite ratio. The meaningful comparison is the 9.9× before/after drop and
  the attribution (0.0152 is 0.6% of an 8-bit step and is external light, not
  the neighbour's own surface). To hit the letter of it, `bodyFlash`'s flicker
  depth would have to go to 0; kept at the plan's `*0.25`.

## Pre-existing / not done

- The gather fire light contributes zero visible light at the chest anchor (see
  above). A1's done criterion is met by the mesh pool; the gather cost is
  reported. Not silently fixed to a lifted anchor because that regresses A2.
- No in-app pane run (it loses the WebGPU device); all captures are headless.
- `docs/dev-notes/.../captures` PNGs are development captures, not shipped
  assets.
