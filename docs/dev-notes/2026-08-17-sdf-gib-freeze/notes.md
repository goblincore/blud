# SDF gib-freeze fix — evidence and handoff

Date: 2026-08-17
Branch: `claude/gib-wound-bugs-b8c728`

## Result

The seconds-long pause on the first and repeated WebGPU SDF gibs is removed.
The current lab's full `G` gib stayed at 16.8–18.0 ms worst frame across eight
visible-window gib/respawn cycles. Those cycles create at least 40 chunks in
total, so they also crossed and churned the existing 40-live-chunk cap.

The lab now shows `gib worst frame: … ms` in the renderer panel. It measures
five `requestAnimationFrame` gaps beginning with the first rendered gib frame;
this is intentionally a worst-frame readout rather than p95, which hid the
original one-frame stall.

## Baseline and root cause

Preserved failed-dispatch report:
`/Users/donny/.claude/dispatch/reports/2026-08-17-post-polish-bugs-task-1-20260817-104512.txt`

- `gibEverything()` itself took about 1 ms.
- The first rendered frame after the old 18-chunk spawn stalled 5.8–6.5 s.
- A repeated gib stalled again (about 13 s in one run) without increasing the
  renderer program count.
- Instrumented WebGPU shader-module/pipeline creation was about 0–0.1 ms.
- The CPU profile was dominated by Three r185 NodeMaterial builder/generator
  and cache-key work, repeated for each fresh chunk material/view.

This was CPU-side node-graph construction, not GPU pipeline compilation and
not chunk physics.

## Implementation

- Every live chunk shares one `MeshBasicNodeMaterial`/march graph.
- TSL `onObjectUpdate` callbacks select the currently drawn mesh's exclusive
  data texture, volume texture, and `MarchUniforms`, so simultaneous chunks do
  not share mutable state.
- The material is compiled asynchronously during loading in the same
  FloatType SDF render-target context used by the live march pass.
- The compiled warm-up mesh becomes pool slot zero rather than being thrown
  away.
- `ChunkGpuView.reset()` uploads a new primitive/torn-end payload into the
  same texture, uniforms, unit proxy geometry, and mesh identity.
- Once 40 chunks are live, `spawnChunk()` recycles the oldest mesh slot. This
  matters because Three r185 geometry disposal only clears a RenderObject's
  attributes; it does not remove the material listener/cache entry. Reusing
  object identity keeps renderer objects and binding state bounded.
- Page teardown disposes all live/spare views before the shared material.
- No seam shader, FPV/hand logic, motion code, or gameplay gib system changed.

## TDD evidence

Focused tests were first observed red:

```text
layer.precompile is not a function
view.reset is not a function
```

The resulting regression coverage proves:

- two simultaneous chunks use the same material but distinct uniform blocks;
- 80 alternating head/arm resets preserve mesh and uniform identity while
  clearing head/limb-specific state;
- the SDF-layer precompile selects a FloatType target and SDF camera layer,
  then restores the previous target and layer mask;
- chunk-view disposal does not dispose the externally owned shared material.

## Visible WebGPU verification

Environment: one in-app-browser tab, `backend: webgpu`, 672×378 SDF layer at
0.70 scale. The tab and local Vite server were closed immediately afterward.

Procedure:

1. Load `/sdf-lab-webgpu.html` and wait for startup warm-up.
2. Press `G`, wait for the five-frame panel probe.
3. Click `respawn` and repeat eight times.
4. Read the panel after every gib; visually inspect the final pooled field.
5. Confirm the performance panel returns to 60 fps and browser logs contain
   no warnings or errors.

Exact worst-frame sequence:

```text
17.4, 16.8, 17.2, 18.0, 17.2, 17.5, 17.1, 18.0 ms
```

The final scene visibly contained distinct glossy chunks at different sizes,
positions, and orientations after pool churn. The renderer remained at 60 fps
(about 17.4 ms CPU+GPU), with no browser warnings/errors.

Note: the current `makeGobs()` full-gib design emits 5–7 large gobs (including
the head), not the older 18 per-primitive chunks used by the failed baseline.
Eight cycles were used so the verification still exercised the 40-slot cap
and repeated resets, not only the easy first allocation path.

## Automated verification

Project Node runtime:
`/Users/donny/.local/share/fnm/node-versions/v22.22.2/installation/bin/node`

- Vitest: 106 files, 1515/1515 tests passed.
- TypeScript: `tsc --noEmit` passed.
- Vite production build passed (existing bundle-size warning only).
- `git diff --check` passed.

The system Node 25 runtime injects an invalid empty local-storage backing file
and is not the project verification runtime; Node 22 avoids that unrelated
panel-test failure.
