# Static probe grid spike — result (2026-09-09)

Lighting P3 step 1, per the plan at
`docs/superpowers/plans/2026-09-09-static-probe-grid-spike.md`. Background:
SDFDDGI (arXiv 2007.14394), assessed in the Obsidian note
`Claude Notes/Research/2026-09-09-sdfddgi-vs-blud-lighting.md`.

## What was built

- `src/lab/sdf-zombie/probe-grid.ts` — CPU gather: 8×4×8 probes inset 0.15 m
  in the enclosure, 128 Fibonacci rays each, ray-vs-box exit, wall radiance =
  albedo × (key·max(n·L,0) + fill + bounce/π), two bounces by re-reading the
  previous pass, projected to L1 SH (4 coeffs × RGB). 60–400 ms per bake in
  the browser. 32 tests including the analytic grey-room convergence.
- `src/lab/sdf-zombie/webgpu/probe-grid.wgsl.ts` — the evaluator: manual
  trilinear over the 8 surrounding probes (blend coefficients, then evaluate
  the cosine lobe, clamp ≥ 0). Parse contract + literal pins. Zero field
  evaluations, 24 texture loads per shaded pixel.
- March: five slots appended positionally last; `probeCfg.x = 0` is
  bit-identical (pinned at 89 inputs in both parse tests).
- Lab (`sdf-lab-webgpu.html`): built at boot and on wall/light/ceiling
  change; panel `probe grid (P3 spike)` with on/off, gain, rebuild, and
  **match fill level** (sets the gain so the room-centre irradiance has the
  flat fill's luminance — the fair comparison).

## What it looks like

Same camera (`__sdfLab.setCam(0.7, 0.12, 1.9, 1.0)`), enclosure on, Cornell
walls, `practical-hard-key`. Note the lab parks P1's analytic bounce at
probeWeight 1, so the baseline here is **P1, not flat fill**.

| | observation |
| --- | --- |
| P1 (probes off) | shadow side a uniform pinkish grey; the arm's underside reads the same as its top |
| probes, matched level (gain 0.022) | underside of the arm and the torso's far side go darker; slightly more form; subtle |
| probes, 4× fill (gain 0.088) | shadow side lifts with the red wall's warmth on the wall-facing side; the figure gains volume without the key changing |
| probes, gain 0.25+ | blows out — probe irradiance is absolute (~1–5), the fill is 0.06 of the key |

Verdict: the directional ambient reads. At the fill's own level it is a
refinement; at a few times the fill it is the "radiosity lift" the P1 spec
said would need to be measured — and it is available here as one slider.

## Process notes that cost time

- `/sdf-lab.html` is the WebGL lab. The WebGPU lab with the bounce/probe
  panel is `/sdf-lab-webgpu.html`.
- The in-app browser pane's GPU adapter fails the lab's tile storage-buffer
  bind group (zero-size binding) and renders black; **real Chrome is clean**.
  Verify lab work in real Chrome.
- The lab camera **auto-spins** until `setCam` is called. Screenshots taken
  from behind a wall are the clear colour and look like a shader failure.
  Pin the camera first.

## Next steps (not started)

1. Body occlusion of probes (proxy capsules), so bodies shadow the floor.
2. Flashlight injection (the game's dominant light bounces nothing today).
3. Game-side: one grid per room from the room boxes, gathered at room load.
