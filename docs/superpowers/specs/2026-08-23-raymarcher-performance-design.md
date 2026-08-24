# Raymarcher performance — design

Status: DECIDED 2026-08-24. All four open questions answered by the owner and
the approach locked ("Approach 1 extended", below). Implementation plan:
`docs/superpowers/plans/2026-08-24-raymarcher-perf.md`; execution queued as
dispatch tasks `~/.claude/dispatch/plans/2026-08-24-perf-task-{1..4}.md`
(owner triggers task-1 in dispatch-ui, the rest chain).

## Goal

Render SDF characters fast enough for the game: **30 fps at the owner's full
window** (1536×1704 CSS px, retina → 3072×3408 buffer) at **SDF scale ≥ 0.7**,
for BOTH **2–4 enemies at close/mid range** ("A", the arena fight) and
**8–15 at mixed range** ("B"). Today the adaptive controller holds 30 fps
only by dropping the SDF pass to 0.2–0.45 scale when zoomed in, which the
owner judges "way too low resolution".

## Decisions (owner, 2026-08-24)

1. **Quality floor: scale ≥ 0.7** when zoomed. The 30 fps target is measured
   against this floor; the controller may still ride 0.7–1.0.
2. **30 fps everywhere** — B (8–15 bodies) holds the same 33 ms p95 as A.
   This is what rules out per-body proxy draws as the destination: N near
   bodies re-march their overdrawn pixels N times.
3. **Smooth LOD fades only.** Quality levers ramp with distance; nothing
   snaps. (No PSX pop, despite the aesthetic — owner call.)
4. **Dedicated bench page** is the measurement surface: fixed camera path,
   fixed body sets, adaptive off, single-pass timing. The lab stays the
   playground; numbers quoted in reports come from the bench page only.

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
- **(2026-08-23 pm) Two-level bound-group cull is on main** (`dfac7b2`):
  pack.ts `boundGroups` splits each limb cluster into contiguous fold-order
  runs with ≤ 0.16 m spheres; the shader walks a surviving cluster's own
  span. Schoolgirl ~35 % faster (stash-A/B, 5× benchGpu min per side).
- **A FLAT group list was SLOWER than no groups at all** (zombie 2.6 → 4.8
  ms): per-step bound texel reads dominate. Hierarchy is the win; any tile
  scheme must respect the same economics (few reads before the prim work).
- **Cull soundness rule:** `sdPrimitive` is a scaled-space field —
  `sd ≥ euclidDist × minScale/maxScale` (schoolgirl sole plate: 22×). Every
  Euclid-sphere-vs-running-`d` cull must multiply its threshold by the
  packed per-group distortion factor, or the field tears (black crack seams
  inside wound cavities, where `d` goes negative). Applies verbatim to any
  per-tile test.
- **Bench pollution is real on this host:** the owner's live lab tab and
  running dispatch agents both moved medians by 2×. Protocol: stash-A/B in
  one session, 5× `benchGpu` per side, take the min, same page load.

## The six levers (stages above choose among these)

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

## Approach: "Approach 1 extended" (LOCKED)

Four stages, each shipping value and de-risking the next. Decision 2 (30 fps
for crowds too) is what extends the original Approach 1 to include the
merged march — per-body draws cannot reach it.

1. **Bench page + instrumentation.** `sdf-bench.html`: fixed 15 s orbit,
   fixed body sets A (4 close) and B (12 mixed), adaptive off, p50/p95/p99
   to the page and to `window.__bench` for headless capture. Heatmap debug
   views: march steps per pixel, prims evaluated per pixel. Nothing after
   this stage is judged without these numbers.
2. **Cheaper hit shading** (~6 post-hit field evaluations → ~3–4 by sharing
   probes between normal/AO/translucency), plus the one-day
   specialise-the-crowd measurement — keep or drop by bench delta.
3. **Per-tile primitive lists + one merged march for all bodies.** A tile
   pre-pass bins every body's bound groups (distortion factor included);
   one full-screen pass marches each pixel against its tile's list.
   Removes both the prims-in-reach cost and N-body overdraw; also the
   multi-character architecture (cost scales with screen overlap, not cast
   size). Hero-only first, then multi-body, per-body draws retired behind a
   flag until parity.
4. **Smooth LOD ramps + headroom signal.** Distance-faded quality levers
   (decision 3: no pops) and a coverage predictor (projected cluster-sphere
   area × scale²) so `adaptive-scale.ts` probes only with predicted room.

## Success criteria

- **A**: 4 bodies, close camera, full window, scale ≥ 0.7: p95 ≤ 33 ms over
  the bench page's 15 s orbit.
- **B**: 12 bodies, mixed range, scale ≥ 0.7: p95 ≤ 33 ms with smooth LOD
  active.
- No regression in `blob:render-check` (all six characters), the lab suite,
  or the 2026-08-23 wound work: flicker transport, rim reach, cavity
  shading, near-wound stepping, the facing-gated wound mask, the light-gated
  specular, and the flat-lit face decal.
- No visible LOD pop in a slow approach capture (stage 4 gate).
