# Telemetry v3 and what the first capture says (2026-09-20)

Recordings are `captureVersion: 3` from `c16673b1`.

## New fields

- `frames[].selfPhases` — EXCLUSIVE ms per span (a span minus the spans inside
  it). Sum and rank these. `phases` stays inclusive.
- `frames[].unattributedCpuMs` — tick + draw CPU no span covered. Was ~half the
  frame (3.5 of 6.3 ms tick, 2.5 ms of draw); now 0.0 p50.
- Region laps `tick:*` / `draw:*` partition the frame (`GameTelemetry.lap`:
  a span that ends at the next lap on its channel — no token crosses a block).
- `cpu:<passLabel>` — CPU submission per GPU pass, driven by the existing
  `setPassLabel` calls (`setPassLabelObserver`, set only while recording).
- Events: `long-frame` (tick+draw >= 20 ms; `top` = heaviest self spans),
  `shader-build` (three r186 `renderer.debug.onNodeBuilderCreated`; `mode: sync`
  is the one that stalls a frame), `flare-shot`.

## First capture (headless, room 1, 30 fps cap, ~7 s — a first look)

| self p50 | ms |
| --- | --- |
| `cpu:sdf:polys` | **5.0** of a 7.6 ms draw |
| `body-step` | 2.3 |
| `tick:burn-kit-viewtime` | 1.8 |
| `tick:occluder-hull` | 1.7 |
| `cpu:sdf:shell-hull` | 0.6 |
| `skeleton-mesh` | 0.5 |
| `cpu:sdf:march` | 0.2 |

**The CPU draw cost is three submitting the POLYGONAL level scene, not the SDF
pass chain.** The flat ~4 ms `crowd-sdf-inner` (3.8 ms at 0 bodies) was the poly
pass all along. Levers: merge static level geometry, `BatchedMesh`, render
bundles (`BundleGroup`). Second: the occluder hull costs 1.7 ms every frame.

The `long-frame` event found one more hitch on its first run: the first flare
ignite builds the `flame-cards` material synchronously (4 sync `shader-build`s,
20 ms draw). The boot warm-up covers the fire volume but not the card pool.

## The two hitches the OLD recording hid (both fixed)

- Weapon switch: muzzle `PointLight` under the hideable `gunRig` re-keyed the
  LightsNode — 16-19 pipeline rebuilds, 115-445 ms, exactly 166 ms after every
  switch to/from the shotgun (`df51f66a`). Lights live under never-hidden parents.
- Flare shot: `traceSlugHitFrom` ran 240 segments x full `sdBody` per actor,
  61-86 ms; now a cluster-sphere broad phase, bit-identical over 720 poses,
  85.7 -> 0.2 ms (`b0c1b051`).

## Not done

Per-frame GPU span + `gpu:idle` in the recording — the piece that answers
"are we GPU-bound?". `gpu-pass-timing.ts` has the exclusive attribution; the
hazard is the `resolveGpu()` drain cadence.
