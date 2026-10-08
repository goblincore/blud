# Native wgpu spike: is the march faster outside the browser? — 2026-10-08

**Answer: no.** The same `sdf:march` pass, replayed through wgpu 30 on Metal, is not faster than
the same pass in Chrome. It measured 7 to 9 % slower, which is inside the run-to-run spread of
this machine. The march's cost is the fragment shader on the GPU, and both stacks hand Metal
equivalent code.

## What was measured

One frame's `sdf:march` render pass, recorded off the raw WebGPU API underneath three.js: the
game's own WGSL (331 k characters of fragment shader), pipeline state, bind groups, and the
contents of every buffer and texture the pass read. Scene: the bench close-up (one zombie filling
the 400 x 300 march target), ship defaults.

That capture is replayed four ways. Each run encodes 10 back-to-back copies of the pass in one
command buffer and takes wall-clock from submit to completion, divided by 10; 15 rounds per run;
five runs per leg, alternating, order rotated.

| Leg | What it is | Median ms / pass | Best | Range of run medians | vs Chrome |
| --- | --- | --- | --- | --- | --- |
| `chrome` | capture as recorded, bare WebGPU in Chrome 154 (Dawn/Tint) | 25.51 | 19.90 | 24.54 – 26.87 | — |
| `chrome:naga` | the naga-compat rewrite, in Chrome | 24.53 | 21.67 | 23.59 – 27.90 | −3.8 % |
| `wgpu` | the rewrite through wgpu 30 / naga, runtime checks on | 27.84 | 22.80 | 27.40 – 33.90 | +9.1 % |
| `wgpu-unchecked` | same, bounds checks and loop bounding off | 27.35 | 22.48 | 25.64 – 27.47 | +7.2 % |

Every leg's output was compared with the game's own readback of the march target: Chrome
bit-identical, wgpu within 4.9e-5 with no pixel over the 1e-4 bar.

## What it does and does not show

- **The browser costs the march pass nothing measurable.** No GPU-process hop or validation layer
  shows up in a pass this heavy.
- **WebGPU's shader safety checks are not the cost either.** Turning naga's off moved the median
  0.5 ms, inside the spread.
- **Not measured:** the rest of the frame (the other ~20 passes, present, the compositor), CPU-side
  three.js overhead, frame pacing. The march is 93-99 % of labelled GPU time in the crowd scenes,
  so those are the smaller part, but this spike says nothing about them.
- **Not measured:** native-only features (variable-rate shading, MetalFX, hardware ray tracing).
  Those change the algorithm, and are the only route by which a native renderer would win.
- One scene, one shader variant, one machine (fanless M3 Air, load average 3-4 during the run;
  the absolute numbers are a hot machine's — the same pass read 16-20 ms earlier in the session).
- The `--window` mode presented at ~33 ms a frame with and without vsync; nobody looked at it, and
  it is not comparable with a game frame.

## Found on the way: the game's WGSL does not compile under naga

naga 30 rejects `ptr<storage, …>` function parameters, which three's `wgslFn` emits for every
storage-buffer argument (nine functions in the march: `loadInstance`, `mapBody`, `calcNormal`,
`woundShadow`, `probeDynamic`, `probeDynLoad`, `bodyLights`, `ngBody`, `marchBody`). Chrome's Tint
accepts them. `scripts/native-spike/naga-compat.mjs` rewrites them mechanically (each parameter is
only ever bound to one buffer) and the rewrite is timing-neutral in Chrome. **The planned
Rust + wgpu release port needs this rewrite or its equivalent in the shader sources.**

Cold compile of the march shader through wgpu/Metal: 37 s checked, 70 s unchecked; 53 ms once
Metal has cached it.

## Running it

```
(cd native/march-replay && cargo build --release)
scripts/native-spike/servers.sh node scripts/native-spike/capture.mjs 5291 9291 .scratch/native-spike/capture
scripts/native-spike/servers.sh node scripts/native-spike/compare.mjs .scratch/native-spike/capture 5
native/march-replay/target/release/march-replay .scratch/native-spike/capture --window
```

`SPIKE_SCENE=crowd`, `SPIKE_PASSES` (a regex over pass labels) and `SPIKE_QUERY=level=night-train`
choose what is captured. The recorder handles render passes only (no compute), and not passes
that load an attachment.

---

# Part 2 — hardware ray tracing — 2026-10-08

**Answer: the hardware BVH did not help; the idea it serves did.** Giving each ray its own short
list of primitives made a clean-room tracer 2.5 to 4 times faster than marching with bound-group
culling. Building that list with a hardware ray query was slower, in every scene, than building it
with a plain loop of ray-box tests in the shader — which needs no ray tracing hardware and runs in
WebGPU today.

## What was built

`native/march-replay/src/bin/rt_spike.{rs,wgsl}`: a small sphere tracer over the game's real
primitives (exported rest-pose by `scripts/native-spike/export-prims.ts`), instanced as a crowd.
One shader, four modes, same picture from each (asserted: at most 0.1 % of pixels differ, on
silhouette edges):

| Mode | Where the march starts and ends | What each step folds |
| --- | --- | --- |
| `cull` | the body's bound sphere | every prim, skipping bound groups too far to blend (`GROUP_RADIUS_MAX` 0.16) |
| `cullspan` | entry/exit of the prim boxes the ray crosses | same as `cull` |
| `softmask` | same as `cullspan` | only the prims whose box the ray crosses — found by a slab test per prim, in the shader |
| `rtmask` | same | the same list, found by a hardware ray query over a BVH of the prim boxes (one BLAS, one TLAS instance a body) |

Boxes are inflated by 4 x the largest `blendK` (times the prim's scale distortion), which is the
reach of the smooth-min, so the masked fold is exact, in the original fold order.

wgpu 30 exposes this on Metal (`EXPERIMENTAL_RAY_QUERY`, AABB geometry, ray queries in a fragment
shader). The M3 runs it. BVH build for 384 instances: 3.7 ms.

## Numbers

Median ms per pass, 400 x 300, five alternating runs each (ranges were within 3 % except where
noted). `evals` is primitive evaluations per pixel.

| Scene | `cull` | `cullspan` | `softmask` | `rtmask` | evals: cull / cullspan / masks |
| --- | --- | --- | --- | --- | --- |
| zombie (27 prims) close-up | 3.44 | 2.70 | **0.66** | 1.04 | 103 / 55 / 19 |
| zombie x 24 | 6.24 | 4.37 | **1.39** | 2.10 | 100 / 50 / 17 |
| zombie x 96 | 8.36 | 5.86 | **2.20** | 3.35 | 106 / 52 / 18 |
| zombie x 384 | 11.29 | 7.61 | **3.56** | 4.55 | 107 / 52 / 18 |
| schoolgirl (53 prims) close-up | 7.00 | 5.50 | **1.94** | 3.32 | 305 / 175 / 65 |
| schoolgirl x 24 | 18.31 | 11.58 | **4.70** | 6.63 | 437 / 200 / 64 |
| zombie x 24 at 1600 x 1200 (noisy, ±30 %) | 58.1 | 40.2 | **14.0** | 17.9 | as x 24 |

## Reading it

- **The per-ray list is the win**, about 3x fewer primitive evaluations than group culling with
  the same tight start, and the time follows.
- **The hardware BVH loses to 27-53 slab tests.** A character is too few boxes for a BVH to beat a
  loop, and the ray query has a fixed cost per pixel. The gap narrows with body count (1.6x at one
  body, 1.3x at 384) but never closes at crowd sizes this game will draw.
- **The ray-query path also needs a per-ray table of bodies** (eight here). At 96 bodies 34 k
  pixel-candidates overflowed it, at 384 88 k; the picture survived, but nothing guarantees it.

## What this does not show

- **It is not the game's shader.** No wounds, carves, grooves, shells, strands, noise, lighting or
  shadows; schoolgirl's 4 shells and 4 grooves are flattened or dropped. The game's march costs
  ~20 ms where this costs ~3 ms for the same framing, so most of the game's cost is in things this
  does not exercise.
- **`cull`/`cullspan` are my reconstruction of the game's culling, not the game's.** The game
  already bins bound groups into screen tiles (`tile-bin-compute.ts`) and bounds the march with
  the shell hull, so it sits somewhere between `cullspan` and `softmask` already. How far is
  unmeasured — that is the number that says whether per-ray masks are worth building.
- Rest pose, identical instances, one machine.

## If this is followed up

The follow-up is not native: a per-ray primitive mask in the existing WGSL march (slab tests
against prim boxes, fold only the set bits), measured against the tile-bin lists on the real
shader. Wounds and carves need their reach added to the box margin.

```
npx tsx scripts/native-spike/export-prims.ts zombie
(cd native/march-replay && cargo build --release)
scripts/native-spike/rt-matrix.sh 5
```

---

# Part 3 — per-ray primitive masks in the real march — 2026-10-08

**Answer: it does not pay here.** On the real shader, on the tile-list path, the mask made the
zombie close-up 0.6 ms slower and moved a 12-body crowd by about −3 %, inside that run's noise.
The clean-room 2.5-4x did not carry over: the tile lists and the per-step sphere culls already
remove most of what a mask would, and building the mask costs three texel loads per listed prim
per pixel.

## What was built (behind `?raymask`, shader text byte-identical without it)

- `march/raymask-flag.ts`: `?raymask` compiles in a PROBE (debug mode 21: of the walk's prim
  folds, how many have a box the pixel's ray never crosses); `?raymask=apply` also compiles in the
  mask itself. Mode 22 is its diagnostic.
- The mask: `tile-preload.wgsl.ts` slab-tests every prim of every listed group against the ray
  (box inflated by 4k x the group's distortion) into a 64-bit mask per tile entry; `foldGroup`
  skips cleared prims. Walk only; off for shaped groups, wounded bodies and an open head split.
  `debugCfg.x == 0.25` switches it off at runtime, so both A/B legs come from one boot.

## Counters (exact, mode 21; walk only)

| Scene | Path | Folds / step | A mask would skip |
| --- | --- | --- | --- |
| Zombie close-up | per-body fallback (cluster walk) | 9.5 | 35 % |
| Zombie close-up | **tile lists** | **4.56** | **10 %** |
| 12 zombies in view | tile lists | 13.9 | 61 % |
| 24 zombies in view | tile lists | 16.4 | 59 % |

With the mask applied the probe reads 0 skippable and the close-up folds 4.4 a step.

## Time (same boot, same frozen frame, captured pass replayed in Chrome, 5 alternating runs)

| Scene | Mask off | Mask on | |
| --- | --- | --- | --- |
| Zombie close-up | 13.21 – 13.46 ms | 13.87 – 14.03 ms | **+0.6 ms (+4.6 %)**, every run |
| 12 zombies in view | 100.9 – 104.4 ms | 98.2 – 103.2 ms | about −3 %; run minimums overlap (82 – 93 ms) |

## Caveats

- **Picture parity is not established.** Mask on vs off differed by more than 1e-3 on 32 k of
  120 k texels (max 0.20) on the close-up and 13 k (max 1.11) on the crowd. Two captures of the
  same frozen frame with the mask inactive in both differed on 28 k texels (max 0.02), so most of
  the count is the frame's own step-to-step variation, but the larger maxima are unexplained and
  could be the mask.
- The crowd pass replays at ~100 ms for one 400 x 300 pass. Investigated below: it is real.
- Zombies only, unwounded.

## Two traps this cost hours on

- **`crowdInfo().tilesOn` is not readiness.** After any march text change the crowd program
  compiles in the background for minutes and every body renders through the per-body fallback
  (no tile lists) until `__sdfGame.warmBackground().crowd === 'ready'`. The scripts here now wait
  for that. **Part 1's Chrome-vs-wgpu capture was the fallback path** — still a fair same-pass
  comparison, but not the tile-list march.
- **Two boots do not stage the same frame** (`stageCloseUp` kept d 0.6 on one boot and 0.7 on the
  next). A first A/B across boots read −0.9 ms and was void. `capture.mjs` `SPIKE_VARIANTS` takes
  several captures from one boot.

**Afterwards (owner's call, same day):** the `apply` path and mode 22 were removed; the `?raymask`
probe (mode 21) stays. `map-body.wgsl.ts` and `tile-preload.wgsl.ts` are back to their committed
text. The A/B driver went with it; the timings above cannot be re-run without restoring it.

```
scripts/native-spike/servers.sh node scripts/native-spike/raymask-probe.mjs
```

## The 100 ms crowd pass: real, and it is the boxes dispatch

The 12-body scene (the bench's `distance` staging: player in room 1's near corner, a 0.9 m grid
of zombies in the far half) costs the live game about 106 ms a frame at ship defaults.

| Live game, `timeDraws(20)` x 3, whole frame | ms / frame |
| --- | --- |
| Room 1, no crowd | 13.2 / 11.9 / 11.9 |
| 12-body crowd, dispatch `boxes` (the default) | 104.6 / 108.3 / 106.1 |
| 12-body crowd, dispatch `quad` | 31.0 / 29.5 / 28.7 |
| back to `boxes` | 109.2 / 112.1 / 111.8 |

The captured pass replayed draw by draw (wgpu, ms per pass) says where it goes:

| Draw | ms |
| --- | --- |
| whole pass (4 instanced draws: 1, 2, 3 and 12 bodies) | 122 |
| the 1-, 2- and 3-instance draws, each alone | 2.0, 3.8, 4.4 |
| the 12-instance crowd draw alone | 121 |
| that draw limited to 1 / 3 / 6 / 12 instances | 9.8 / 27 / 65 / 120 |

About 10 ms per body, linear. Under `boxes` every body's proxy box runs the merged march for the
pixels it covers, and that march folds the pixel's whole tile list — every body in the tile, not
just the box's own. Where boxes overlap on screen the same pixel is marched once per box, and the
shader writes `frag_depth`, so the depth test cannot reject the losers early. The march census
cannot see this: it counts one write per texel, the winner's.

This is the "duplicate-trace growth" the quad dispatch was built to remove (rendering.md, stage
a-2). The default went back to `boxes` on 2026-09-15 on a room-1 fight recording with few bodies
(`game-main.ts`, "DEFAULT DISPATCH = BOXES"), with a note that the quad "may still win specific
scenes (many bodies stacked in few tiles)". This is such a scene, by 3.6x.

**The default is `quad` again (owner's call, same day).** The sweep that settled it, live
`timeDraws`, whole frame, same scene (`scripts/native-spike/crowd-dispatch.mjs`; boxes measured
again after the quad agreed within 1.5 ms in every row):

| Bodies spawned | `boxes` | `quad` |
| --- | --- | --- |
| 0 | 12.7 ms | 13.0 ms |
| 2 | 15.8 | 19.0 |
| 4 | 31.0 | 16.6 |
| 8 | 69.1 | 23.8 |
| 12 | 109.5 | 23.8 |
| 24 | 236.9 | 38.3 |

The quad loses about 3 ms at two bodies and ties with none. `?earlyz=1` takes the boxes to 86 ms at
12 bodies and 156 ms at 24, and leaves the quad where it is; its boxes rows below 12 bodies did not
repeat (first read 39 ms, second 15) and are not quoted. `scripts/march-hash.mjs`: the no-flag
boot now yields the quad canonical `0c71e712…`, `MARCH_HASH_BOXES=1` the boxes one `d7392d52…`;
both ran green after the flip.

**Early-Z and a per-frame dispatch were both considered and left out (owner's call after a
playtest).** Live `timeDraws` on the early-Z scenes (`scripts/lib/earlyz-scenes.mjs`):

| Scene | Quad | Quad, `?earlyz=1` | Boxes | Boxes, `?earlyz=1` |
| --- | --- | --- | --- | --- |
| Doorway (12 bodies behind a wall) | 22.8 – 24.5 ms | 24.2 | 69.2 – 73.4 | 53.8 – 55.2 |
| Pack (6 bodies behind each other) | 26.3 – 27.1 | 28.1 | 75.1 – 76.2 | 79.1 – 81.5 |

A quad-dispatch type never draws its front-face twin, so early-Z has nothing to act on there. A
per-frame dispatch would need both dispatch programs warmed: they are separate materials, the
background warm-up compiles only the active one, and a runtime `setDispatch` compiles the other
synchronously on its first draw.
