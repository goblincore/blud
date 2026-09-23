# Lower march resolution: what was tried, what was measured, what the owner judged (2026-09-22/23)

**Question.** Can the bodies march at 0.25 (−38 % `sdf:march`, measured) and still look like today's 0.5 + t16?
**Answer (updated 2026-09-23, see the last section): yes, with the checker + edge coverage + temporal edge, under the
owner's retuned (heavier) VHS preset.** Melee crush frame 12.55 -> 7.80 ms on the quiet pair. Before the edge work,
no hand-built reconstruction was shippable; the trained temporal network is now deferred, not needed.

Owner rules that shaped every step: judge by eye in play, not by metrics ("similarity numbers" misled more than once);
the footprint hit tolerance (`setAa`/`setAaDistance`) is a perf side-effect and is OFF for quality captures/probes.

## Timeline

| # | Approach | Result | Where |
| --- | --- | --- | --- |
| 1 | Offline probe: 0.25 bilinear vs 16× truth | Inside of the body holds up; edges are the problem. The pale fat halo at 0.25 was the HIT TOLERANCE (sized to one march pixel, ×6 near), not the upscaler | `scripts/upscale4x-probe.mjs` |
| 2 | 0.35 plain (half the rays) | Owner: "closer to 0.25 than 0.5", not good | `upscale4x-sheets.ts` |
| 3 | Hybrid: coarse + real full-res rays on edges/seams/face (offline splice) | LOOKED right (owner: 0.25 ≈ 0.35 ≈ 0.5), but measured **NO-GO**: hard pixels are 23–28 % of the crush and the most expensive rays → ~20–26 ms vs today ~10.4 | `upscale4x-splice.ts`, `HYBRID-TIMING-PLAN.md`, melee `MELEE_HYBRID_EST=1` |
| 4 | Per-pixel object motion vectors (prev prim rows + inverse restPoint) | Works; limbs, feet planted = 0, debug mode 16 | commit e7aa65b9, `MOTION-VECTORS-PLAN.md` |
| 5 | Accumulation v2 at 0.5 (object motion + depth validity + clamp) | Ghost smearing GONE ("the v2 version is great"), but alone worse than 0.5 + t16 (jaggies, soft) | commit 18292bcc |
| 6 | Checker reconstruction: 0.25 jittered through a fixed 2×2 cycle → exact 0.5 grid → t16 | Still: matches a 0.5 march. Motion: shimmer, then blockiness, then stair-step close edges, through 4 iterations | commit 648a7baf (parked, flags only) |
| 7 | Distance split (owner idea): < D checker, ≥ D real 0.5 rays (far pass) | Transition invisible; medium/far fixed. Close edges still "not clean or good enough to ship" | same commit |

## What each checker iteration taught

- **Direct sample returned outright** → 4-frame flicker: in rejected blocks one exact pixel sat beside three soft fallback
  pixels, rotating each frame, and t16 sharpened the pattern.
- **Consistent fallback + drifting kept pixels toward the fill** → the whole image settled at 0.25 detail (the fresh
  sample only pulls back one frame in four). Kept pixels must HOLD.
- **Nearest history fetch** → compounding stair-steps under sub-pixel motion. Catmull-Rom history fixed the blockiness.
- **Coverage tied to colour validity** → silhouettes fell back to 0.25 steps (the background behind an edge always fails
  the depth test). Deciding coverage separately (fresh pixel exact; band pixels from motion-reprojected history, not
  depth-gated) improved it — still not shippable up close.
- History rejection was NOT the problem (debug view mostly kept, not red).

## Measured costs (melee crush, quiet, clean phase, tolerance off unless noted)

`sdf:march`: ship 0.5 (tolerance on) 9.8 ms · 0.5 10.6 · 0.35 7.2 · 0.25 6.0 · 1.0 33.1. t16 ≈ 0.6 ms.
The checker/stack/split itself was never timed (the look failed first).

## Traps found (each cost time)

- `readMarchTarget` re-renders a frame (`step(0)`), so it always reads ZERO motion: verify motion in the live loop.
- The agent's own game tab running during the owner's cold compile made the owner's Chrome LOSE THE WEBGPU DEVICE.
- A probe that never calls `process.exit` hangs forever on its CDP socket; chained `&&` steps never run.
- `debugCfg` is a vec2 (no `.z`); nothing compiles WGSL offline, so a bad swizzle only shows in the browser.
- The shipped model loader forces `sdfScale` to 0.5 (`applyUpscaleAbMode`); the stack must halve it.
- `setTemporalAccumCfg({})` resets history: use the `checkerAccum` getter to read state.
- Mode 11 `.r` is the BODY INSTANCE (`gHitSlot`); the prim id is `.b` (`hitBest`).

## Follow-up (owner, 2026-09-23): trained network with temporal inputs

t16-style, fed the current 0.25 frame + motion-reprojected history + motion vectors + disocclusion/validity mask, trained
against 0.5 + t16 (or 16× truth) on captured MOTION sequences, so it learns what to trust instead of hand rules.
Everything it needs as INPUT already exists behind flags: object motion vectors (`marchMotion` attachment), the checker
history on the 2× grid, the far/near split. The capture side exists (`scripts/upscale-capture-v2.mjs`, `nupscale`);
it would need motion sequences and a TS twin of the new model.

## Round 2 (2026-09-23, branch `claude/checker-edge-coverage`): edge coverage, VHS, and the real cost

Before building a trained network, the owner agreed to try giving the checker better SILHOUETTE information, since
close edges in motion were the one thing that failed. Everything below is behind `?accumedge=1` (on top of
`?accum=1&accumscale=0.25&accumchecker=1`); the ship frame is untouched except the VHS preset.

| # | Change | Owner verdict |
| --- | --- | --- |
| 8 | **Near-miss distance.** A missed ray reports how close it passed to a surface (min over the walk of field distance / (t * aaCfg.x)), written instead of discarding: x = distance, y = -7 sentinel, alpha 1 (still a miss), hardware depth just short of far so any hit wins and the nearer miss wins among misses. Gated by meltCfg.y == 2 (`setEdgeOutAll`). Units verified: misses adjacent to a hit report a median of 0.5 quarter-scale px (p10 0.12, p90 0.97), the diagonal ring 1.1. | — |
| 9 | **Edge-distance coverage v1.** In the silhouette band, a screen-space signed distance from the near-miss values (hits: -min over neighbouring misses of \|hit-miss\| - dist), interpolated at the pixel. | Edges "more consistent", but a stair-step that moves ("marching ants"). Edge-off (history coverage) is cleaner when still, but its fresnel rim goes fuzzy/blocky in motion. "A wash." |
| 10 | **Still/moving split** (history coverage where the pixel moved < `edgeStillPx` 0.3 half-scale px; else edge) + **edge lines** (the slope of the near-miss field across neighbouring misses gives the edge direction; each miss texel is a line, blended near the pixel). | Works: ants vanish when a head stops, return when it moves; transition smooth. Zombie idle animation keeps most edges "moving". |
| 11 | **Temporal edge.** The edge distance lives in a second checker-history attachment (`ckEdge`), reprojected with the colour, each frame's estimate blended in (`edgeTemporal` 0.35) and the history clamped to within `edgeClampPx` 0.75 px of it. | Tested together with the VHS change below. |
| 12 | **VHS `blud` preset retuned** (owner): intensity 0.64, blurAmount 1, chromaAmount 8.2, chromaJitter 4.5, motionThreshold 0.54. Now the shipped default. | "With the cranked up VHS settings, it works fine visually now." |

Why the edge estimate crawls at all: the checker cycles the ray through four sub-positions, and each frame's edge
estimate carries a different error; snapping coverage to each frame's estimate turns that error into motion. A
real half-scale march never has this (its rays land in the same place every frame). The temporal edge averages it.

Knobs (`__sdfGame.setTemporalAccumCfg`): `edge`, `edgeLines`, `edgeStillPx`, `edgeTemporal`, `edgeClampPx`;
`checkerDebug` now colours band pixels by the rule that decided them (yellow lines, magenta v1 field, cyan history).

### Cost (melee crush, clean phase, M3 10-core GPU = MacBook Air M3 class)

Four interleaved boots per run (ship / checker / ship / checker), frame p50 and `sdf:march` p50:

| run | ship frame | ship march | checker frame (split 3 m) | checker march | checker, no split |
| --- | --- | --- | --- | --- | --- |
| 1 (as first built) | 12.61 / 13.13 | 9.89 / 10.15 | **14.73 / 14.21** | 4.26 / 4.22 | — |
| 2 (far-pass early-out), quiet pair | 12.55 | 9.83 | **7.80** | 4.42 | 7.62 |
| 2, noisy pair (load 4.5-4.8, CPU-bound: cpu:draw 9 ms) | 13.54 | 10.11 | 11.16 | 4.90 | 10.61 |

- Run 1 was SLOWER than ship: the distance split's far pass (real half-scale rays beyond D) ran the tile preload,
  wound list and hull bounds on every NEAR body's proxy fragment before the ray-window discard. Fix: an early
  discard at the top of `MARCH_TRACE_SETUP` when the pass is the far pass and the proxy's BACK face (worldPos, the
  box exit) is nearer than D. It changes no image; ship frames never take the branch (depthPreCfg.w == 0).
- After the fix the split costs 0.2-0.5 ms (split vs no-split legs), and the resolve + edge + stacked t16 together
  well under 1 ms: the frame falls by ~4.8 ms against a ~5.4 ms march saving.
- **Do not trust the `sdf:march-far` pass label**: it still reads 6-7 ms after the fix, which cannot fit in a
  7.8 ms frame. Frame and GPU span agree with each other; use those.

### Where it stands

Uncommitted-to-main, flag-only (branch `claude/checker-edge-coverage`). Open: re-run the noisy pair quiet to
confirm; decide whether 0.25 + checker ships as the default or as a low-end quality setting (owner: M3 Air is the
low end; discrete GPUs have headroom); the known split limitation (a near body just in front of one at ~D can get a
false near-miss from the window end — `accumsplit=0` removes it). The trained temporal upscaler is deferred.
