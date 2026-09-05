# Close-up task 3 — the quarter-resolution depth prepass

**Date:** 2026-09-05 · **Branch:** `dispatch/2026-09-04-closeup-task-3`
**Status:** built, census-clean, **does not earn the flip — ships OFF**
(`GAME_DEPTH_PREPASS = 0`) · Base: task-2 branch (426b55e)

## The round-trip question (Question B)

Answered before this task started: the three-r185 decay was scene fog, fixed
in main `8da0bdd`. A written ray parameter survives a texture round-trip. The
gate was gone; the prepass was buildable. **It let us start.**

## Question A's answer aged out from under the task

Task 1b measured the wounded fill-screen split at a ~45 ms baseline: walk
~29% + wound walk ~41%. Task 2's branch merged main and the owner re-took
`nearWound` stepping to 1.0 (`426b55e`) — and this task's first benches put
the SAME staging at **13.9 ms** with a completely different split. Re-measured
here (interleaved, 4 reps, quiet machine):

| leg | p50 |
|---|---|
| normal (walk+shade), wounded fill-screen | 13.86 ms |
| flat (walk only, `setFlatAlbedo`) | 11.65 ms |
| **walk share** | **15.9%** |

The walk the prepass attacks is now worth ~2.2 ms of the target frame, not
~30 ms. Every number below is against the CURRENT ship baseline (exit bound
ON, near-wound 1.0, adaptive off).

## What was built

A coarse march of the same field at one texel per 4×4 block of SDF pixels
(~1/16 of the marching work), consumed as a third lower bound in the march's
ray start:

- `DEPTH_PREPASS_MARCH` (march.wgsl.ts) — `coneMarch`'s construction with the
  cone radius = the block's half-diagonal footprint (2√2 SDF px). That radius
  is the proof: any full-res ray in the block lies within `k·t` of the coarse
  ray, so the first cone-touch is a provable lower bound on every block ray's
  own first surface. Miss = −1 (contributes nothing). Same near-wound step
  multiplier as the full march; full cluster field (no tile binning —
  conservative against any tile-listed sub-field).
- One twin mesh per body on `DEPTH_PREPASS_LAYER` (7), sharing the proxy-box
  geometry; `frag_depth` = touch/32 so overlapping proxy boxes resolve to the
  NEAREST touch — the one value safe for every body at that pixel. Chunks get
  no twin (a missing start is conservative).
- The march consumes `max(max(startT, shellIn), preStart)` with
  `preStart = touch − (touch·k + 1.2 mm + shellAmp)`. Off = fetch 0 =
  bit-identical (pinned: 0.000% vs the pre-task build at the boot view,
  0.007% at the room-3 standoff — both noise floor).
- Seams: `__sdfGame.setDepthPrepass()` / `.depthPrepass`;
  `__sdfGame.depthPreStats()` (occupancy-pattern readback of the coarse
  target — the instrument that made an invisible "pass writes nothing"
  failure observable).

## The census (the gate), before the timing

Six views × occupancy triple (off → on → off2) + decoded PNG triplets, ship
defaults, exit bound ON:

| view | hits kept | meanStepsHit | px-diff (noise) | verdict |
|---|---|---|---|---|
| wounded-0.5m | 100% | 6.56 → 3.61 (−45%) | 0.119% (0.019%) | CLEAN |
| wounded-3m | 100.02% | 3.61 → 2.98 (−17.5%) | 0.148% (0.056%) | CLEAN |
| wounded-9m (5 bodies) | 100% | 5.09 → 3.56 (−30.1%) | 0.090% (0.072%) | CLEAN |
| head-0.9m-thin | 100% | 5.96 → 3.72 (−37.6%) | 0.081% (0.067%) | CLEAN |
| room3-standoff (3 bodies) | 99.99% | 4.56 → 3.73 (−18.2%) | 0.068% (0.018%) | CLEAN |
| room4-standoff (7 bodies) | 100.01% | 4.21 → 4.00 (−5%) | 0.090% (0.075%) | CLEAN |

State-clean everywhere; diffs read as silhouette + crater-rim fringes in the
diff maps (built and eyeballed: the 0.5 m wounded map clusters at the blast
crater rim and silhouette edges; the head view shows jaw/skull-edge fringe
only; all three room-3 bodies intact). Visual off/on pair at fill-screen:
indistinguishable by eye — wound cavity, shading, silhouettes identical.
A severed-limb view was attempted (fireSlug aim sweep); no sever landed, so
the torn-end check rests on the head/jaw and crater-rim views.

## The timing (after the census)

| scene | off p50 | on p50 | delta | steps (msh) |
|---|---|---|---|---|
| fill-screen wounded | 14.04 ms | 14.57 ms | +0.53 ms (+3.8%) | 6.87 → 3.77 |
| room3 standoff | 4.39 ms | 5.34 ms | +0.95 ms (+21.6%) | 4.56 → 3.73 |
| room4 standoff (quiet load 5.3) | 7.11 ms | 9.05 ms | +1.94 ms (+27.3%) | 4.21 → 4.00 |

Interleaved, 6 reps, 0 load-rejections, 0 crash retries; `bench-*.json` in
`/tmp/sdf-depth-prepass-bench/`.

## Verdict: does not earn the flip

The walk halves on hit pixels and the frame does not get faster, because at
today's baseline the walk is only 15.9% of the target frame (~2.2 ms), and
the prepass's own cost — one more render pass plus the coarse march's own
evals, ~0.5 ms at one body growing with scene size — meets or exceeds the
saving. At multi-body standoff scenes the coarse rays march long distances
(mostly missing), so the pass costs up to +2 ms while the step win shrinks to
−5%. No tuning of the coarse pass fixes the economics: the addressable
saving (≤ ~1 ms at the target scene) is below the mechanism's floor cost.
The 8×8-block variant would cut the coarse cost 4× and simultaneously shrink
the start quality toward exactly what the cone pre-pass already offers — and
the cone ships OFF for the same reason. **The seam and the census stay; the
flip would need a frame where the walk is large again (the 45 ms baseline
Question A measured) or a way to run the coarse pass for ~free.**

## Three pipeline-generation traps this task found (all fixed, all pinned)

The first ON-boot rendered every body **unlit-black with every uniform dead**
— the page looked fine until you looked at the bodies, and the console error
was the only signal. Three independent causes, each verified by boot-screenshot
bisect:

1. **Parens in a WGSL-signature comment.** three's declaration regex captures
   the parameter list UP TO THE FIRST CLOSE-PAREN — a paren in any comment in
   the list truncates the parsed inputs (mine cut at windDrift), the call
   substitutes `float(0)` for the texture slot, WGSL generation dies with a
   JoinNode null deref, and the material falls back to a pipeline with no
   working uniforms. The file's old warning documented colons only; **parens
   are equally fatal** (and `ABOVE: three` in a comment parses as a phantom
   input via the case-insensitive regex — a colon after any capitalised word
   counts). Pinned by the 78-input parse pin in march.wgsl.test.ts.
2. **Call target spelled as the CONST name** (`DEPTH_PRE_FETCH(...)` vs the
   emitted `fn depthPreFetch(`) — "unresolved call target" at pipeline
   creation. The WGSL call is text and must use the source name.
3. **`vec4(a, b, 0, 0)` composed from two scalar uniforms** in a wgslFn
   literal — JoinNode over uniform scalars dies in
   `WGSLNodeBuilder.getTypeFromLength` (null deref), same silent
   dead-uniform fallback. The cfg is ONE vec4 uniform passed WHOLE (house
   pattern, load-bearing), with a shared zero-vec4 uniform as the no-source
   identity.

Plus the quiet one that cost the most time: **`createZombieGpuView`'s
positional `createMarchMaterial(...)` call silently dropped the new 12th
argument**, so the march sampled the 1×1 zero fallback while the twin wrote
real starts — coarse target full of content, counters bit-identical on/off.
The `depthPreStats()` seam is what made that class of failure observable.

## Instrument notes

- A posed-field update lag: `predictSlugHit()` issued in the SAME tick as the
  staging `setPose` misses 5/5; with `step(3)` + a short sleep it stamps 5/5.
  Any driver that stages-then-stamps needs a step between.
- The pre-existing flaky-boot behaviour seen mid-task (intermittent
  JoinNode TSL errors + dead occupancy readbacks on BOTH this branch and its
  base) was traced to uncommitted half-reverted trees plus vite serving
  stale transforms during rapid patch/revert cycles — not a three race.
  Hygiene that fixed it: commit each consistent state, restart vite between
  shader-shape changes, and verify what vite actually serves
  (`curl` the transformed module).
