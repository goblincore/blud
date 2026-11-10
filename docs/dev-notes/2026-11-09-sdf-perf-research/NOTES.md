# SDF march performance: where the ceiling is, and what to try next (2026-11-09)

Research pass, no renderer code changed. Asked for: a new direction for the march's cost when many
pixels are covered (close-up crowds), whether the neural upscaler could be a plain algorithm, and
whether "weight-space programming" (writing network weights directly) is useful here.

**Stage 0 (the cost ladder, §3 A) was run the same day: [LADDER.md](LADDER.md).** It confirms the
gap of §1 on live posed primitives and finds it in `mapBody`'s wound, re-fold and bone code, not in
the suspects listed in §1's table (`loadInstance` is 4 %; the private arrays and the texture layout
were not isolated).

Sources: this repo's notes and shaders, a literature sweep (links at the end), and one small
offline probe of the shipped upscaler's weights (`net_probe.py`, beside this file).

## 1. The finding: a primitive costs about 20 times more in the game's shader than in a bare one

Two measurements already in the repo, never put side by side:

| | Primitive evaluations | Time | Per evaluation |
| --- | --- | --- | --- |
| Clean-room tracer on the game's zombie prims, close-up, 400 × 300, `cull` mode ([native spike, part 2](../2026-10-08-native-wgpu-spike/NOTES.md)) | 103 a pixel, about 12 M | 3.44 ms | about 0.3 ns |
| The same tracer, per-ray list (`softmask`) | 19 a pixel, about 2.3 M | 0.66 ms | about 0.3 ns |
| The game, clean close-up, walk only (`flat`) ([cost census](../2026-09-22-cost-census/NOTES.md)) | 1.59 M | 10.2 ms | 6.4 ns |
| The game, one zombie at 0.8 m, whole frame ([frame cost §3.3](../2026-10-08-frame-cost/NOTES.md)) | 2.94 M | about 25 ms | about 5 ns |

- The clean-room tracer is not a toy field: it has the round cones, per-prim orientation and scale,
  and the ordered smin and chamfer. It lacks wounds, carves, shells, noise and shading.
- The game's walk folds about as many primitives as the tracer's better modes (4.56 a step on the
  tile lists, 20 to 45 a hit pixel against the tracer's 19 to 55 a pixel), and still takes about 9
  times longer than `softmask` for the same kind of frame (6.0 ms at 38 % cover against 0.66 ms; the
  two frames' cover was not matched).
- The spike's own note says it: "most of the game's cost is in things this does not exercise". The
  follow-up went to per-ray masks (fewer folds), which did not pay, because folds are not the cost.
- The step budget says the same from the other side: on a far body, cutting the cap from 96 steps
  to 24 moved nothing ([march floor](../2026-09-21-march-floor/NOTES.md)).
- Not shown: that the gap survives live posed primitives, a crowd's slot loop and three.js's pass
  set-up. The tracer ran in native wgpu on rest-pose instances. Stage 0 below is that check.

So the ceiling is not sphere tracing and not the primitive count. It is what the production shader
does around each field evaluation. Candidates, from reading the shader (none measured yet):

| Suspect | Where | Why it could be large |
| --- | --- | --- |
| `loadInstance` runs inside `mapBody`, for every slot of the pixel, on every evaluation | `march/map-body.wgsl.ts:63`, `march/fields/groups.wgsl.ts:378` | 19 to 22 storage reads a call; the fold needs about six of those fields |
| Primitive data is one texture row per attribute | `foldGroup`, `sdPrim`, `sdPrimO` | 3 to 5 texel loads from different rows for each primitive; the clean-room tracer reads six adjacent `vec4`s |
| About 3.5 KB of private arrays per fragment | `gTileBounds`, `gTileGrp`, `gTileBand`, `gTileSlot`, `gPix*` (64 entries each), `gWoundList` | read on every fold; thread-local memory limits how many fragments a GPU core keeps in flight |
| Work that runs on every evaluation whether or not it applies | the split's piece loop, the flag decode, `applyCarves`' scan of every prim's scale row, the wound gate, the cull-bound bookkeeping | a per-step floor that does not shrink with the tile list |
| The per-pixel setup before the first step | tile preload, slot table, wound list, hull bounds, a `mapBody` at the start bound | paid by every rasterised pixel, hit or miss |

## 2. What has been tried (so nothing here repeats it)

The full table is long; the short form of what matters for the proposals:

- Shipped: tile lists, the quad dispatch, the outer shell hull, temporal start, last-step secant,
  the distance-based accept, the upper-bound cull, analytic normals, the normal hint, the exact wound
  reach, 0.5 march scale with the t16 upscaler.
- Built and rejected because the extra rays cost too much: the quarter-res depth pre-pass (+0.5 to
  +1.9 ms), the cone pre-pass (slower), the hybrid sparse re-march (hard pixels 23 to 28 %, 20 to
  26 ms against 10.4), the refine head ungated (6 to 11 ms; ships only as `graphics=high` in a
  1.5 to 3.5 m band).
- Built and rejected on look: deeper interlace, held-row reprojection, accumulation as
  reconstruction, half-rate march. Stepping the march scale visibly is ruled out by the owner; a
  lower resolution is acceptable only if the result matches.
- Flag-only, owner undecided: the 0.25 checker with a near-miss edge channel (melee march 9.8 to
  4.4 ms; close edges "not clean enough" without the heavier VHS).
- Dead: over-relaxation, step budget, per-ray masks, hardware ray queries, early-Z on the quad.

Every "extra rays cost too much" verdict was priced at the production shader's rate.

## 3. Proposals

### A. A lean visibility kernel (recommended)

A second, small shader that answers only "where does this ray hit the body, and which body and
primitive", at something close to the clean-room rate. The production shader keeps the wounds, the
split, the bones and all shading, and runs where they matter.

Why it is sound: wounds and carves only remove flesh, so the closed, unwounded body is an outer
bound of the real one. A lean hit depth, pulled back by a small margin (wound lips, the silhouette
noise shell), is a safe start for the production march; a lean miss is a real miss. Two exceptions
need a proxy in the lean field: an open head (a turned half lies outside the closed head; use the
split's region sphere) and anything melting.

Stages, each with its own gate:

0. **The cost ladder (measurement only).** Run the clean-room field as a pass inside the game on
   live posed primitives, then add the production shader's features one rung at a time, timing each
   by alternation on a frozen close-up: own packed buffer; the game's data texture; tile preload into
   private arrays; `loadInstance` per evaluation; carves and shaped prims; the wound gate; the full
   walk. Result: a table of where the walk's 6 ms goes. If one rung holds most of it, fix it in
   `mapBody` and every field call gets faster (walk, normal taps, probes, shadows) with no new pass.
1. **Lean pass as the start and the miss mask.** It writes depth, slot and primitive to the seam the
   depth pre-pass already has (`preStart`). The production pass discards lean misses before its
   setup and starts its walk at the lean depth. Removes the grazing and far misses (31 % of the
   clean frame's primitive work, and its most expensive pixels) and most interior steps.
2. **Lean hit is final outside wounds.** The production walk runs only inside a body's wound bound.
   Unwounded pixels go straight to shading from the lean hit.
3. **Spend what was saved.** Ideas this repo priced out become cheap: visibility at output
   resolution on edge texels (B below), the refine head outside its band, coarse-miss culling.

Estimates, not measurements: stage 1 about a third to a half off the march in close-ups; stage 2
more on clean bodies, less on heavily wounded ones. The march hash moves at stage 2 (different
float order); stage 1 can stay bit-identical.

Risks: a second cold compile; the lean and production fields must agree on the base body (one
generated source for the fold, two entry points); the crowd's slot loop must stay lean too.

### B. Silhouettes from the field, not from the network (the "pure algorithm" upscaler)

The shipped net works on colour alone. On dataset v3.2
([next-steps note](../2026-09-12-upscaler-next-steps.md), §14):

| | Overall L1 | Edge band | Interior |
| --- | --- | --- | --- |
| bicubic | 0.01751 | 0.0675 | 0.01111 |
| t16-rgb (ships) | 0.0154 | 0.0642 | 0.0092 |
| s32-rgbn + run-4 head | 0.01455 | 0.0611 | 0.00864 |
| the same + one SDF refine step at output resolution | 0.01112 | 0.0481 | 0.00654 |
| native 800 × 600 march | 0.00905 | 0.0382 | 0.00538 |

The shipped net closes about a quarter of the distance from bicubic to native, and about a tenth
of it on edges. One field evaluation per output pixel closes three quarters. The information is in
the field, and a colour-only method, learned or hand-written, cannot recover it.

The algorithm: lean visibility rays at output resolution, only in texels on a silhouette or a depth
step (a few tens of thousands of rays); each output pixel then takes its colour from the low-res
neighbour on its own surface (same slot, nearest depth). Interior: bicubic plus the CAS already in
the chain, or the current net. No training, exact edges. It needs A, because at the production rate
this is the hybrid sparse re-march that was a no-go.

### C. Later, if the fold itself becomes the cost again

- A per-type 3D grid of pruned primitive lists (Lipschitz pruning, Barbier et al. 2025): screen
  tiles prune in 2D only. Their factors (8× to 600×) are against a naive march, not a tile-binned one.
- An analytic ray-against-primitive test to prove a grazing miss early. Unpublished as far as the
  sweep found.
- The 48 B/px MRT diet (about 40 % of a far body's march scales with target pixels, per the floor note).

### D. The march as a compute pass, one tile a workgroup (idea, 2026-11-10; owner: try this first)

Nothing here is measured. It is the idea to try before A's later stages and B, on the owner's call: those are
better understood, this one is not.

**Why it might pay.** The march is a fragment shader, so every pixel carries its own copy of what its tile shares.
That per-pixel storage turned out to be the largest fixed cost in the pass:

- The first field call of a pixel was about 7 ms of a 9.5 ms clean walk, and the cause was 3.3 KB of private
  arrays a fragment ([ONE-CALL.md](ONE-CALL.md)).
- Cutting them to 256 bytes took 51 % off the pass on a clean close-up and 25 % on a 12-body crowd
  ([TILE-REF.md](TILE-REF.md)), and a dense close mob in the live game from 104.6 ms a frame to about 70.
- What a pixel still keeps for itself: the reference list (256 bytes), the per-ray wound list, and the preload
  that reads its tile's entries and culls them against its own ray.

**The idea.** One compute workgroup per screen tile (`TILE_SIZE_PX` = 16, so 256 pixels):

- What the tile shares (its entry list, its slot runs, which bodies are clean) is read once for the tile, not
  once a pixel. A pixel's own cull could be a 64-bit mask over the tile's list in place of a list of its own.
- Tiles with an empty list are never dispatched. The crowd quad rasterises fragments that run the setup and
  discard ([crowd firefight cost](../2026-09-14-crowd-firefight-cost.md) measured 78 to 92 % of them in September,
  before the tile work; not re-measured).
- The pass writes storage textures, so the output layout is ours to choose (the 48 B/px MRT of C).
- Rays can be grouped before the walk (clean against wounded, one body against several), which a fragment
  shader cannot do.

**What could sink it.**

- No depth test in a compute pass: the depth goes to a texture and a full-screen pass composes it with the
  polygon scene. Early-Z on the quad was already a dead end, so nothing is lost there.
- Whether a compute walk is faster than a fragment walk on Apple's GPUs at all. Not known.
- A second pipeline to compile cold, and three.js's node material path does not give this for free. The release
  target (Rust + wgpu) has no such problem.
- The half of the gain that is "less private memory" may already be taken by the reference list.

**First step, no game code.** The replay harness (`scripts/native-spike/replay.html`, `capture.mjs`,
`lean-ab.mjs`) runs a captured `sdf:march` pass in bare WebGPU over the game's own buffers. Port the walk to a
compute entry point there, one workgroup a tile, and time it in alternation against the fragment pass on the
clean close-up and the 12-body crowd captures, with the output compared texel for texel. That says whether the
idea has a number before any of the integration cost is paid. A denser capture than 12 bodies is worth staging
too: the mob that prompted this drew 22.

### Not worth pursuing

Over-relaxation and auto-relaxation (dead here; Claybook lists it as failed), segment tracing (it
helps fields with a loose Lipschitz bound; these primitives are exact), hardware ray queries,
learned step predictors (nothing real-time on small GPUs found), texture-space shading (no
parameterisation, and shading is not the cost).

## 4. The upscaler as a pure algorithm

- **Speed is not a reason.** The upscale is 0.25 to 0.7 ms of a 20 to 30 ms frame.
- **Drop-in colour-only algorithms** (FSR1 EASU + RCAS, Snapdragon GSR1): both assume an
  anti-aliased input; a one-ray-per-texel march is not one. Expect sharper than bicubic, probably
  short of the net. Untested here.
- **Fitted, not trained:** RAISR-style filters (pick one small linear filter per pixel by local
  gradient direction and strength; the filters come from closed-form least squares on the pairs).
  Published at about 80 % of an ESPCN's gain over bicubic. One pass, no f16 feature maps, no weights
  file to keep in parity with a CPU twin.
- **The probe** (`net_probe.py`): synthetic capsule bodies, since the training pairs are not on this
  machine. 17 bucketed 5 × 5 filters fitted to truth beat bilinear and bicubic there (edge band
  0.0213 against 0.0252 and 0.0292; native 0.0124). The shipped net scored worse than bilinear on
  these frames, so they are too far from the game's for a net-against-algorithm verdict. That needs
  a re-captured set of real pairs (`scripts/upscale-pairs-capture.mjs`).
- **The better algorithm is B.**

## 5. Weight-space programming

The post (Takehi et al., 2 Nov 2026) is about a frontier language model reading and writing small
networks' weights by reasoning, without gradient descent: policy MLPs for grid games written from
the rules, a looping direction subtracted from a small language model. No convolutional or image
network is in it. Published criticism: what can be stated as a short program can already be written
as a network, so writing the weights is compiling by hand.

For this project:

- **Not for the upscaler's numbers.** Its last-mile quality is image statistics, which least squares
  or SGD finds in minutes; the s32 class is already saturated on L1.
- **Useful as structure, set by hand and then trained:** a bilinear or bicubic anchor in place of the
  nearest one (interior error on the probe: nearest 0.0045, bilinear 0.0011, so the net spends
  capacity re-deriving interpolation), fixed edge-detector branches (ECBSR), an exact pass-through for
  a coverage channel supplied by the field.
- **Not for behaviours.** An enemy's rules are already a program; a hand-written network of them
  adds nothing a state machine lacks.

## Sources

- Lipschitz Pruning: https://wbrbr.org/publications/LipschitzPruning/
- Claybook, GDC 2018: https://media.gdcvault.com/gdc2018/presentations/Aaltonen_Sebastian_GPU_Based_Clay.pdf
- Dreams, "Learning from Failure": https://advances.realtimerendering.com/s2015/AlexEvans_SIGGRAPH-2015-sml.pdf
- The Gunk's raymarcher (march to a thin G-buffer, shade separately): https://jarllarsson.github.io/gen/gunkraymarcher.html
- Synchronized tracing of primitive-based implicit volumes: https://arxiv.org/abs/2304.09673
- Cone-traced supersampling with subpixel edge reconstruction: https://doi.org/10.1109/TVCG.2023.3343166
- RAISR: https://arxiv.org/abs/1606.01299 ; edge-SR: https://arxiv.org/abs/2108.10335
- FSR1: https://github.com/GPUOpen-Effects/FidelityFX-FSR ; Snapdragon GSR: https://github.com/SnapdragonStudios/snapdragon-gsr
- ECBSR: https://github.com/xindongzhang/ECBSR ; ABPN: https://arxiv.org/abs/2105.09750
- Weight-space programming: https://rikiyat.github.io/blog/weight-space-programming/
