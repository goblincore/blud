# Raymarcher performance — design (draft for the next session)

Status: brainstorm paused mid-way on 2026-08-23 (context limit). Decisions so
far are recorded; the open questions at the end are where the next session
resumes, then `superpowers:writing-plans`.

## Goal

Render SDF characters fast enough for the game: **30 fps at the owner's full
window** (1536×1704 CSS px, retina → 3072×3408 buffer) with **2–4 enemies at
close/mid range** ("A", the arena fight) as the hard requirement, and **8–15
at mixed range** ("B") degrading to quality LOD, not to mush. Today the
adaptive controller holds 30 fps only by dropping the SDF pass to 0.2–0.45
scale when zoomed in, which the owner judges "way too low resolution".

## What is measured (do not re-measure these)

- The marcher is **fill-bound**: frame time ∝ covered pixels × per-pixel
  cost. Halving scale halves the frame (0.7 → 0.5 → 0.35: 22.7 / 12.3 / 8.4 ms
  in a 767×777 pane at the close camera). Prior record: 18.6 ms + 0.237 ms per
  1k pixels; ten bodies 47 ms from across the room, 137 ms inside the crowd.
- **No single shading feature is the cost.** At the close camera, toggling
  surface noise, mottle, AO, translucency, relaxed tracing, the occluder hull
  each moved the frame < 0.5 ms; halving the step budget (96 → 48) only 2.5 ms.
  So the cost is the marcher's body: every step evaluates all primitives of
  the clusters the ray touches (~20 on the cyclops torso), each from a data
  texture (`textureLoad` per primitive per step), and the hit pixel then pays
  ~6 more full field evaluations (tetrahedron normal ×4, AO probe,
  translucency probe).
- Quality LOD (steps/noise/AO/face/wounds levers, distance-based) had a
  measured ceiling of −24% and is at "near" = full quality when zoomed.
- The hero body never uses the specialised (compile-time constants) shader;
  crowd bodies can (`specialiseShaders`). Each body is its own proxy-box draw
  with a full march; bodies overdraw each other, sorted only by depth.
- Wall-clock frame time is vsync-pinned; GPU timestamps are unreliable with
  multi-pass frames (see `adaptive-scale.ts` header). There is **no headroom
  signal** today. The adaptive controller (now on by default, 30 fps budget,
  spike rule, early probe abort, floor 0.2) is a bandage.
- Measurement hygiene learned the hard way: check host load first
  (`fileproviderd` at 115 % and stale dispatch vite servers polluted a round);
  the first `benchGpu` of a run carries warm-up spikes — run the baseline last.

## Candidate levers (to be chosen in the next session)

1. **Instrumentation first.** A debug view rendering *march steps per pixel*
   and *primitives evaluated per pixel* as heatmaps, and a per-variant GPU
   microbench that is trustworthy (fix or bypass the multi-pass timestamp
   resolve; a single-pass bench mode is acceptable). Nothing below is chosen
   without this.
2. **Per-tile primitive lists.** Project cluster *and* primitive bounds per
   screen tile; march each tile against its own list. The win at close range
   is the ratio of "prims in cluster" to "prims actually near this tile" —
   expected 2–4×. This also composes with crowds: a tile lists prims from
   every body that touches it, which removes the per-body overdraw march.
3. **Cheaper hit shading.** Reduce the ~6 post-hit evaluations: accumulate
   the gradient during the fold (analytic per-primitive gradients through
   smin), or share one tetrahedron between normal, AO and translucency.
4. **Specialise the hero.** Compile the hero's primitives as constants (the
   `specialise` path). Cheap to test; likely a modest win.
5. **One march for all bodies** (follows from 2): a single full-screen pass
   over a merged primitive/tile list instead of N proxy-box draws, so near
   bodies do not pay N× overdraw.
6. **Headroom signal for the controller**: once 1 gives real numbers, either
   fixed GPU timestamps or a coverage predictor (projected cluster-sphere area
   × scale²) so the controller probes only when the prediction has room.

## Approaches to decide between (next session, one question at a time)

- **Approach 1 — instrument, then tile-cull (2) + cheaper shading (3).**
  Biggest expected win for A; B improves too. Most engineering.
- **Approach 2 — instrument, then specialise (4) + cheaper shading (3),
  keep per-body draws.** Smaller, safer; may not reach 30 fps at full window
  for A without resolution drop.
- **Approach 3 — one merged march (5) from the start.** Biggest structural
  change; best for B; risk of a long tail before anything ships.
  Recommendation going in: Approach 1, with 4 as a first-day cheap test.

## Open questions for the owner

1. Acceptable minimum SDF scale when zoomed (0.5? 0.7?) — the quality floor
   the target is measured against.
2. Does B (8–15 enemies) need to hold 30 fps, or is 20 acceptable there?
3. Is a visible LOD pop (e.g. far bodies without noise/wounds) acceptable?
4. Is the lab (`sdf-lab-webgpu.html`) the benchmark surface, or should the
   measurement harness be its own page with a fixed camera path?

## Success criteria (draft)

- A: 2–4 bodies, close camera, full window, SDF scale ≥ (answer to Q1):
  p95 ≤ 33 ms over a 15 s orbit, measured with the new instrumentation.
- B: 12 bodies, mixed range: p95 ≤ 33 ms (or Q2's answer) with quality LOD.
- No regression in `blob:render-check`, the lab tests, or the wound fixes of
  2026-08-23 (flicker, rim, cavity shading, near-wound stepping).
