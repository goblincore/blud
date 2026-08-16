# X1.22.1 — collapse stall (rAF ~10 ms / ~2000 ms while falling)

Task branch: `dispatch/collapse-stall-task-1` (worktree 2026-08-16).
Files touched: `src/lab/sdf-zombie/webgpu/lab-renderer.ts` (canvas alphaMode),
`src/lab/sdf-zombie/motion.ts` + `webgpu/lab-main.ts` (sub-stepped rig
integration), `src/lab/sdf-zombie/motion.test.ts`.

## Symptom (as reported)

`__sdfLab.forceCollapse()` (or K) makes the live frame loop stall while
`motion.phase === 'falling'`: rAF deltas alternate ~10 ms / ~1990–2000 ms, so
with the sim dt clamped at 1/30 the 2.5 s fall advances 33 ms per ~2 s of wall
clock (~150 s total — the death spiral). Standing/walking and settled run
60 fps. The crumple pose itself looks correct.

Prior evidence (not re-derived here): `benchGpu()` mid-fall 2.1 ms median
(every timestamped render pass cheap in the falling pose), sync JS inside all
`renderer.render` calls < 1 ms during the stall, zero `uncapturederror` events
during stalls, no goo particles/splats present.

## What this investigation measured

Instrumentation (since removed) timed each segment of the frame callback
(chunks, blood+goo sync, motion, rig, pose/pack/upload, camera+LOD), the whole
`cb` and `drawFn`, and the gap between the end of one loop invocation and the
start of the next. Headed Chrome on localhost (the standard dispatch recipe),
fresh vite port, WebGPU backend confirmed. All phases, 60 fps:

```
segment      standing      falling@1s    falling-rest  settled
chunks       0.00ms med    0.00ms med    0.00ms med    0.00ms med
blood+goo    0.10ms med    0.10ms med    0.10ms med    0.10ms med
motion       0.10ms med    0.10ms med    0.10ms med    0.10ms med
pose/pack    0.10ms med    0.10ms med    0.10ms med    0.10ms med
cam+LOD      0.00ms med    0.00ms med    0.00ms med    0.00ms med
cb total     0.30ms med    0.40ms med    0.40ms med    0.40ms med
drawFn       0.70ms med    0.90ms med    1.00ms med    1.20ms med
rAF delta    16.6ms med    16.7ms med    16.6ms med    16.7ms med
rAF gap *    15.7ms med    15.4ms med    15.0ms med    15.2ms med
```

\* gap = time from the end of frame N's loop to the start of frame N+1's —
i.e. how much of the frame interval the page spends idle, waiting for the
browser's next frame opportunity.

Unthrottled control (`--disable-gpu-vsync --disable-frame-rate-limit`): whole
frame = **1.4–1.5 ms in every phase including falling** — the falling pose
carries no hidden cost anywhere in the page's frame work.

Attempted reproductions of the 2 s pattern, all negative (60 fps through a
full collapse in every case): plain forceCollapse; K key; meter-driven
collapse (7 stamped blasts); crowd of 10; occluded window; background tab;
window minimized/restored on a ~2 s cadence.

## Root cause

Two mechanisms, one primary and one amplifying:

1. **Present-path pacing (primary).** Every in-page cost is excluded by
   measurement: sim/pack/upload segments are sub-millisecond, render passes
   are 2.1 ms mid-fall, and the page is idle ~94% of each frame even while
   falling. The 2 s therefore lives between frames — in the browser's frame
   scheduling/present path, matching the reported exact-2000 ms
   "timeout/watchdog" signature. three's `WebGPURenderer` defaults to
   `alpha: true`, which configures the canvas context `alphaMode:
   'premultiplied'`. On macOS Chrome a premultiplied WebGPU canvas cannot be
   promoted to a direct overlay and composites through the slower path that
   has a documented frame-pacing pathology for per-frame-updated WebGPU
   canvases on high-refresh displays (chromium issue 502668704; sibling
   back-pressure reports 40204611 / 376497142 — gaps with no CPU or GPU
   activity). The lab renders a fully opaque scene but was still paying for
   the transparent-canvas present path. The ~10 ms fast frames in the report
   are a ~100–120 Hz cadence (this automation box runs its Chrome at 60 Hz,
   which is why the 2 s pacing could not be reproduced here); mid-fall the
   body's axis-aligned proxy box is at its largest (a diagonal body), so
   falling frames are the most likely to miss a high-refresh budget and trip
   the pacing path — standing and the settled corpse fit inside it.

2. **The dt clamp death spiral (amplifier, page-side).** The frame callback
   integrated the rig with `Math.min(dt, 1/30)` — a *per-frame* ceiling, not
   a rate. Any stall (compositor back-pressure, hidden tab, debugger) made
   each late frame advance the fall by only 33 ms, so the fall took
   wall-clock time in proportion to the stall — the longer the stall
   persisted, the longer the fall stayed exposed to it. This is what turned a
   pacing hiccup into a 150-second crawl.

## Fixes

1. **`alpha: false` on the WebGPURenderer** (`lab-renderer.ts`). The context
   now configures `alphaMode: 'opaque'`, keeping the present on the
   overlay-capable path and off the premultiplied compositing route with the
   pacing pathology. Visual parity verified by A/B screenshots of the statue
   at a pinned camera (mean |diff| 0.11/255; the 0.27% of channels >8/255 are
   the panel's live fps text and the time-based eye-glow flicker, both
   expected to differ between shots). Background still clears to exactly
   0x1a1116.

2. **Sub-stepped rig integration** (`motion.ts` `planSubSteps` +
   `SUBSTEP_TUNING`, wired in `lab-main.ts`'s motion branch). A frame's real
   elapsed time is consumed in ≤1/30-sized steps (catch-up capped at 0.5 s of
   sim per rendered frame, ≤15 steps). Normal 60 fps frames are bit-identical
   to before (exactly one step of exactly `dt`); 30 fps frames now run the
   sim at correct speed instead of half; a stalled or hidden frame catches
   up in bounded chunks. Chunk/blood physics deliberately keep their own
   conservative clamp — they are ballistic and a hidden-tab gap must not
   teleport them.

## Regression evidence

rAF-delta probes (headed Chrome, WebGPU, fresh port 5231, this worktree):

- Before the fix, in the automation environment (60 Hz): collapse runs
  60 fps end-to-end, settles in ~2.5 s — the page-side work was never the
  stall; the reported 10/2000 pattern belongs to the present path above.
- After the fix, normal collapse: **2556 ms wall to settled**, rAF median
  16.7 ms, all segments sub-millisecond, 0 GPU uncaptured errors.
- After the fix, death-spiral simulation (sustained ~2 s main-thread gaps
  mid-fall, mimicking the reported cadence): **settled in 8247 ms** — the
  sub-stepping consumes the gaps, where the old clamp math gives
  ~75 stalled frames ≈ 150 s.
- Walking/crowd/resize gate: wander reaches (-0.91, -0.34), collapse after
  resize storm still 2503 ms, 0 validation/usage console messages (the
  historical 55×48 cone-tile usage-validation class is handled by the
  layers' explicit first-clear discipline — confirmed silent through three
  window resizes), full suite 1091 tests green, `tsc --noEmit` clean.

## Caveat / follow-up if the stall recurs

The literal 2 s-per-frame pacing could not be reproduced on this box (Chrome
here composites at 60 Hz; the report's ~10 ms cadence implies the ~120 Hz
state). If a collapse still crawls after this fix, the next probe is
compositor-side, not page-side: check `chrome://gpu` for "Direct
composition"/overlay status of the canvas, try the backdrop-filter probe
from chromium 502668704 (any `backdrop-filter` element over the canvas
restores pacing there), and capture an about:tracing compositor track during
the stall. The page-side instrumentation (segment timers + loop gap) is
described above and takes minutes to re-add.
