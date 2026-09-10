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

## Update 2026-09-09 — per-room grids in the game (P3 step 2)

Shipped ON. `room-probes.ts` bakes one 10×4×10 grid per `RoomDef` in a
module worker at boot (paint colours as albedo, `room.accents` as point
lights with the same 1/(1+(d/2.2)²) falloff the walls use, that room's
FURNITURE as occluders, key/fill from `practical-hard-key`), ~125 ms per room,
all five rooms in ~2 s, and stamps each body's five probe slots at spawn next
to its enclosure. Gain defaults to each room's matched level at 4× the fill
(the level of today's P1 at ambientGain 4), so brightness is unchanged and
only the ambient's direction and hue move. `?probes=0` or
`__sdfGame.setProbes(0)` is the bit-identical P1 path; `setProbes(1, g)`
overrides the gain. Verified in real Chrome: five bakes logged, zero errors,
toggling weight restores the P1 frame; the effect on a lit body is subtle
under the flashlight (the key dominates) and shows on the shadow side.

Not done: body occlusion of probes, flashlight injection (both dynamic).

## Update 2026-09-09 (late) — the GPU gather: dynamic layer shipped ON

The paper's core is in: a per-frame compute pass (`probe-gather-compute.ts`,
kernel `K_PROBE_GATHER` in `probe-dynamic.wgsl.ts`, CPU twin `probe-dynamic.ts`)
writes a DYNAMIC probe layer (L1 radiance from the muzzle flash + L1 body
visibility) for the player's room, read by the march via two storage slots
(`probeDyn`, `probeDynCfg`; both pins at 95). Bodies are capsules packed from
each actor's posed bones with the instancer's own packer; boxes are the room
+ furniture; the light is `flashLight` (world pos, 55×envelope).
Compose: `amb = amb * mix(1, vis, y) + dyn * x`. Defaults x 0.05, y 1;
`?probedyn=0` / `setProbeDynamic(0,0)` bit-identical.

Verified in real Chrome with the hand-step seam (`__sdfGame.step`, because a
hidden tab stops requestAnimationFrame): 90 capsules for two bodies; 55 of
400 probes occluded, min visibility 0.55/3.545; a slug fired puts 404 total
radiance into the layer (max probe 12); zero errors.

Two bugs found only on the GPU, both now pinned:
- `renderer.compute()` INSIDE the post-aa render callback broke the pass
  state and stalled the loop after a handful of frames. The dispatch now
  runs at the top of the draw function, one frame behind the packing.
- The kernel indexed all three input buffers at `4u + k*stride` (a float
  offset) instead of `1u + k*stride` (vec4 index): lights read zeros, boxes
  and capsules read misaligned records. Source-text pins in
  probe-dynamic.wgsl.test.ts.

Process trap: Chrome (extension) and the in-app pane both report
`visibilityState: hidden` when occluded and stop the loop; readbacks of a
buffer that was never dispatched throw "reading 'size'". Drive frames with
`__sdfGame.step(n)` for any GPU verification.

## Update 2026-09-09 (later) — soldier flashes and the beam as gathered lights

The light record is now three vec4 (`pos+I`, `color+cosOuter`, `axis+cosInner`);
a point light packs `cosOuter = -2`, a spot applies the analytic beam's
`coneFall²` on top of the inverse square. Per frame the gather lights are:
the player's muzzle flash, every soldier's muzzle flash in the room (from
`character.muzzle()`, 0.14 s like the sprite, 35×(1-t)²), and the flashlight
BEAM as a spot (`flashlight.spot` intensity/colour, `sAxis`, the same
cosInner/cosOuter the march gets). The analytic bounce spot ships at gain 0
now that the beam itself is gathered (`?bouncespot=1` restores it).

GPU-verified via `__sdfGame.step`: one light packed per frame without a
shot, 81 total radiance / max 3.5 per probe from the beam alone, visibility
min 2.66 with one body; zero errors.
