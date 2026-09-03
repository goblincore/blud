# Blud — Hull-refine renderer: per-frame surface nets + band refinement — Design

**Date:** 2026-09-02 · **Status:** design approved, plan pending
**Type:** `X1` renderer side quest, phase 0 spike
**Supersedes the premise of:** [polygonisation design (2026-08-16)](2026-08-16-sdf-polygonisation-design.md) (`X1.7`, parked as "premise moved")
**Builds on:** [crowd perf investigation](2026-08-31-sdf-crowd-perf-investigation-design.md) ·
mesh-deform verdict — `git show 7fc259b:docs/dev-notes/2026-08-28-mesh-deform-spike/verdict.md` (branch `claude/mesh-deformation-fluid-sim-da6ab4`, not on main) ·
[shell-march spike](../../dev-notes/2026-08-25-shell-march-spike.md)

---

## 1. Why now

Perf round 2 (task 9, 2026-09-02) ended with the march **harvested**: shell
bounds, omega 1.0 and the tile cull cut mean steps ~40% and the remaining cost
is **hit-pixel fill** — every covered pixel pays its steps times a fold over
the whole character (zombie 12 prims, schoolgirl 57, cyclops 38), then four or
five more full folds for calcNormal, AO, scatter and wound shadow. Cost is
linear in prim count and in covered pixels, and `frag_depth` + `discard`
still defeat early-Z so bodies behind bodies pay in full.

The owner's question: can the raymarch be avoided entirely without losing the
deformation — smooth-min joints, jiggle, carved wounds, self-closing stumps —
that makes the SDF characters worth having?

Two prior answers constrain this design:

- **`X1.7` polygonisation (2026-08-16)** designed per-frame compute marching
  cubes and was parked when the march reached 13.5 ms at ten bodies. That
  premise has moved back: the target is now stable 30 fps with nine bodies on
  screen *plus effects*, and the march has no lever left.
- **`R-mesh-deform` (2026-08-30, NOT pursuing).** Baked ONE rest mesh at load,
  skinned it, ran a CPU elastic solver, stamped wounds as vertex displacement.
  Three killers, quoted from its verdict: craters needed res 96 / 21,886 verts
  to read as wounds against a 3k CPU budget; **fixed topology** could not open
  the armpit/groin membranes smin fuses at rest (28 triangles inverted at walk
  amplitude); and the silhouette was locked to a 3.9 cm tessellation.

This design is not that spike. It re-extracts the hull from the **wounded,
posed field on the GPU every frame** (dissolves killers 1 and 2 by
construction: topology is recomputed, resolution is a compute cost on surface
cells only) and refines each fragment onto the true SDF surface (dissolves
killer 3: the mesh is a conservative hull, not the surface, so tessellation
never reaches the screen).

## 2. Decisions taken in the brainstorm

| Question | Decision |
| --- | --- |
| Silhouette | **Fragment band refinement** (option 2); the hybrid-by-distance switch (option 3) stays available as a phase 2 decision |
| Hull freshness | **Per-frame re-extraction from the wounded posed field** — a requirement, not an option. A crater deeper than the band is unreachable from a stale hull face and a through-hole discards with nothing behind it |
| Extraction method | **Sparse surface nets in compute.** Marching cubes rejected (more code, sharper output buys nothing since the fragment refines); tightening the shipped sphere-chain hulls rejected (cannot follow craters) |
| Go / no-go | **Look first.** The owner judges an A/B reel; cost is measured after and reported, not gated |
| Look reel | Zombie only: (1) wounded close-up at FPV range, static and walking; (2) walk cycle at speed — armpits, groin, limb silhouettes; (3) sever and gib. Schoolgirl dropped from the reel by owner call |
| Dispatch model | `kimi-oai/kimi-k3:xhigh` (glm-5.3-flash is occupied by another agent) |

## 3. Architecture

The field stays the authority. `pack.ts`, `validate.ts`, `damage.ts`,
`sever.ts`, `rig*.ts`, `face.ts` and the packed prim texture are untouched;
that texture is extraction's input. What changes is the path from field to
pixels — three passes per body per frame:

```
packed prim texture (posed, wounded)
        │
        ▼
 [1] occupancy compute ──► live-block list (atomic counter)
        │
        ▼
 [2] surface-nets compute ──► vertex buf + index buf + indirect draw args
        │
        ▼
 [3] raster, front faces, hardware depth test, NO frag_depth
        └─ fragment: band walk (≤4 steps, ≤2×band) with the shipped fold
              hit  → shipped post-hit shading unchanged, refined depth out
              miss → discard
```

Both renderers stay behind a toggle (precedent: `setShell`, `setHalfRate`), so
the A/B reel is a flag flip on the same scene. Field helpers are the shared
WGSL in `march.wgsl.ts`; extraction reuses them and nothing is duplicated.

## 4. The extraction passes

**Grid.** Per body, in body space, sized from the posed prim bounds plus band.
A body forty pixels tall costs the same as one filling the frame. Cell size is
a knob; the spike sweeps **1.5–3 cm** (res ~64–128 on a zombie). The band must
cover the extraction error, so a coarser grid means a wider band and more
fragment steps — the two knobs trade against each other.

**Occupancy (pass 1).** One thread per coarse block corner (blocks of 8³ fine
cells; ~24 blocks per axis, ~16k corner evals) evaluates `field − band`. A
block is live if any two corners differ in sign, with a one-cell margin so a
surface skimming a block face is not missed. Live block indices append to a
list through an atomic counter. This is the only pass that touches empty
space.

**Surface nets (pass 2).** One workgroup per live block, one thread per fine
cell, with a shared-memory tile of 9³ corner values so each corner is evaluated
once. A cell with mixed corner signs emits one vertex at the mean of its edge
crossings, the field gradient there as its normal, and — for each of its three
positive-axis edges that crosses iso — one quad linking the four cells around
that edge. Per-block vertex offsets come from a workgroup prefix over cell
counts, then one atomic add on the global counter. Block seams share corners
through the 9³ tile.

**Output.** Vertex and index buffers preallocated per body for a worst case;
counts land in an indirect draw argument, the CPU never reads back. Overflow
is clamped and flagged, never silent (the tile-cull rule).

**Conservativeness.** Extracting at `iso + band` contains the true surface as
long as the field is a lower bound on distance — the same assumption
`shell-hull-outer.ts` already rests on. The packed distortion factor that
anisotropic prims carry scales the band exactly as it scales the cull
threshold. Wound subtraction only moves the surface inward and per-frame
extraction follows it, so craters and holes are in the hull.

**Cost estimate to confirm.** Zombie at 2 cm ≈ 12k surface cells ≈ **~100k
field evals** for extraction, against the march's ~1M per body. Phase 0's job
is to put a real number on this, atomics and prefix sums included.

## 5. Fragment refinement and shading

**Draw.** Into the same scaled SDF target the march writes today, hardware
depth test against the scene and other bodies, **front faces only**. A ray
that misses the front band only reaches a back face through a hole, and a
hole's far wall is a hull face in its own right, so every reachable surface has
a front face along the ray.

**The walk.** Start at the hull position, sphere-trace along the view ray with
the shipped fold: budget **4 steps**, distance cap **2 × band** (bounds
grazing rays inside a thin band). Hit threshold and relaxation follow the
shipped march (omega 1.0). A hit writes refined depth to the depth target so
goo, bleed and depth compositing keep working unchanged.

**Shading.** The hit runs the shipped post-hit path unchanged: calcNormal,
wound mask, tissue ramp, bones, face decal, scatter, AO. Two later wins fall
out of it, neither in phase 0: the hull vertex normal is a good starting
normal so calcNormal can drop to one central difference; and post-hit prim
narrowing (the tier-2 investigation note in dualmem) lands here naturally.

**Silhouette noise.** Stays as normal warping at shading (`X1.9`), not in the
marched field; the band is unaffected.

**Miss.** Discard. The mesh is conservative, so misses are band slack, not
holes.

## 6. Bodies, chunks, occlusion, hybrid

- **Per body.** Extraction runs per body per frame, gib chunks included: a
  chunk is a small field with a small grid, and chunks already own view slots
  the hull path plugs into. Out-of-frustum bodies skip extraction. Reusing
  last frame's hull for a body with no motion and no new wound is a later
  optimisation, not phase 0.
- **Occlusion.** Real depth writes and no pre-hit discard mean bodies behind
  bodies get early-Z rejection on covered pixels, drawn nearest first. This
  is the crowd win the march structurally cannot have.
- **Hybrid (option 3).** A per-body flag on the projected-screen-height metric
  `lod.ts` already computes: near bodies mesh + refine, far crowd may drop to
  zero steps and shade the hull directly. Phase 0 builds the toggle, not the
  switch; the hybrid is a phase 2 decision after the look gate.
- **Bones and organs.** Live in the field behind `nearWound` and reach the
  fragment through the same fold. The hull need only contain flesh: bone is
  visible only inside a cavity whose walls are hull faces.

## 7. Phase 0 — the spike and its gate

**Build.** A standalone page, the shell-spike precedent: own entry, own vite
config; `lab-main.ts`, `march.wgsl.ts` and the game path untouched until the
gate passes. One zombie, walking, shootable through the existing damage and
sever seams, drawn through occupancy → surface nets → band refinement with the
full shipped shading. Toggle to the march on the same scene and camera. Window
seam with kill switch and sweep knobs: cell size, band, step budget, renderer.

**Look gate — the owner judges.** Each reel item captured through both
renderers with the frozen-scene parity harness from perf round 2
(`scripts/perf-r2-parity.sh`: noise floor, repeat toggles):

1. Wounded close-up at FPV range — pellet craters and a slug crater with its
   lip, static and while walking.
2. Walk cycle at speed — armpit and groin opening, jiggle, limb silhouettes.
3. Sever and gib — stump self-closing, chunks flying, each chunk its own hull.

Pass = the owner cannot tell it from the march at the settings the sweep lands
on. Captures go in a dev note either way.

**Cost — after the look, reported not gated.** Only if the look passes: the
round-2 bench legs, interleaved ablation, mesh vs march at 1, 4 and 9 bodies
on the game bench scenario. Read the Repeatability section first and judge
each delta against its own spread.

**Out of scope for this spec:** phase 1 (any shading parity gaps, chunk slot
integration) and phase 2 (the hybrid switch, game-page integration). Each gets
its own plan after the gate.

## 8. Testing

Vitest cannot see a frame; the reel is the visual gate. The suite pins what it
can:

- **CPU mirror of surface nets** over `buildBody(ZOMBIE, …)`, never synthetic
  capsules (the mesh-deform lesson: fixtures an order of magnitude off real
  content hid a 97× error). Asserts: every vertex's field value within one cell
  of `iso + band`; mesh watertight; no true-surface sample from a 200k-point
  sweep lies outside the hull (the conservativeness proof).
- **Band coverage.** From every hull vertex, marching inward ≤ 2 × band along
  the normal reaches negative field. Catches a band too thin for the cell size.
- **Occupancy soundness.** Every fine cell that emits a vertex sits in a
  listed block.
- **WGSL parse contract.** New helpers ride the existing `wgslFn` chain test,
  one dependency edge each (boot is quadratic in helper edges — the 57 s
  lesson).
- **Overflow.** A worst-case fill sets the flag and clamps; no garbage draw.

## 9. Risks

- **Extraction constant factor.** Atomics, prefix sums and indirect setup are
  not in the 100k-eval estimate. If extraction lands within 2–3× the march at
  one body the crowd win evaporates. Measured after the look, reported
  honestly.
- **Band vs detail.** Thin band needs fine grid; coarse grid needs wide band
  and more steps. If no setting holds both the crater lip and the cost, the
  sweep says so.
- **Thin features.** 8–14 mm lips and the `shell` prims sit below a 2 cm cell.
  The lip is inside the band so refinement finds it; shells are off the reel by
  owner call and are a named phase 1 question.
- **Two renderers.** Accepted, as with the WebGPU migration and the shell.
  Field maths stays in one place.
