# SDF polygonisation — Phase 0 plan (next session)

**Spec:** [2026-08-16-sdf-polygonisation-design.md](../specs/2026-08-16-sdf-polygonisation-design.md)
**Task:** `X1.7`
**Status:** ready to start

Phase 0 is a **go/no-go spike**, not a feature. It answers one question — is
extraction actually cheaper than marching — and nothing else is worth building
until it does.

---

## Before writing any code

1. **Cool the machine and re-baseline.** This is not optional bookkeeping: the
   last session's absolutes ranged 2x on identical configurations (the same
   10-body scene read 222 ms hot and 112 ms cooled). Phase 0's whole output is
   a comparison, so it needs trustworthy absolutes, not just ratios.
   - Plug in. Nothing else running — **do not run `npx vitest` during a
     measurement**, it spiked one repeat 78%.
   - `renderer.setSize(960, 540, false)` at the top of every benchmark.
   - Record the raymarch baseline fresh: 1 body and 10 bodies, cone on, SDF
     scale 1.0, LOD off. That is the number extraction has to beat.
2. **Re-read** the spec's §3 (the cost argument) and §5 (silhouette noise is
   the one real casualty).

## The spike

Smallest thing that answers the question:

- One posed body. No wounds, no severing, no face, no scatter, no AO.
- Compute pass over a tight AABB at ~2 cm voxels (~30 x 90 x 18 ≈ 50k).
- Marching cubes into a vertex buffer, indirect draw, flat shading.
- Rasterise it. Confirm on screen that **the jiggle still reads** — that is
  the property the whole direction depends on, and it should survive
  untouched, because `applyRig` moves primitive endpoints and extraction
  happens downstream of the posed field.

Then measure extraction + raster against the raymarcher at the same body count.

## Decision rule, fixed in advance

- **Extraction well under the march** → proceed to Phase 1 (parity: wounds,
  severing, face, baked scatter/AO).
- **Within 2-3x of the march** → the idea is dead. Record it and stop. The
  spec says so explicitly; do not tune a losing approach into a draw.

Deciding this in advance is the point — it is easy to keep optimising a spike
once effort is sunk into it.

## Known traps waiting

- **Vertex count varies every frame** (severing and wounds change the surface
  genus), so the draw must be indirect and buffers sized for the worst case.
- **Voxel resolution is a new tuning axis** with a hard aliasing floor. Too
  coarse loses the jaw crease and the fingers; too fine and extraction cost
  overtakes the saving. Expect a narrow useful range.
- **Silhouette noise will alias** at 2 cm voxels. Start with option (1) from
  the spec — drop it from the field, apply as a normal-only perturbation in
  the fragment shader — since the LOD work already showed it is the single
  most expensive term.
- **Do not skin the mesh to the rig** to avoid re-extracting. It needs
  per-vertex bone weights, and blending them across a smooth-min joint
  reintroduces exactly the seam the SDF design exists to avoid. Per-frame
  extraction is what buys the seamlessness.

## What is already in place

The raymarcher stays — Phase 2's hybrid needs it, and `lod.ts` already
computes the projected-screen-height metric that would choose between meshed
and marched bodies.

Shared and untouched by any of this: `build-body`, `pack`, `validate`,
`damage`, `sever`, `rig*`, `face`, `simplify`. The field is the same field.

## Open question worth settling early

The spec assumes per-frame extraction for every body. If extraction turns out
mid-range in cost, the hybrid may want extraction only for **distant** bodies
(where the raymarcher is cheapest anyway) — which would be backwards. Check
early whether extraction cost varies with body screen size at all. It should
not, and that is precisely what makes it attractive for crowds.
