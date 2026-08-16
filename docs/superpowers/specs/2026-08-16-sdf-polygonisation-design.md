# Blud — Polygonising the SDF zombie — Design

**Date:** 2026-08-16
**Status:** design, pre-implementation
**Type:** side-quest infrastructure — continues `X1`, still off the M6/M7 critical path
**Extends:** [WebGPU migration](2026-08-15-sdf-lab-webgpu-design.md) ·
[parity note](../../dev-notes/2026-08-16-sdf-lab-webgpu-parity.md) ·
[LOD note](../../dev-notes/2026-08-16-sdf-lab-lod-pass.md)

---

## 1. Why

Raymarching is the cost, and that is now measured rather than suspected. One
body at 240x135 costs **0.92 ms at one march step and 8.32 ms at ninety-six**:
the gap is the march loop. Cost is close to linear in pixels, and linear in
body count even when bodies hide behind one another, because writing
`frag_depth` and calling `discard` defeats early-Z.

Everything cheap has now been spent:

| Lever | Worth |
| --- | --- |
| All quality LOD together | −24% ceiling, ~10% in practice |
| Half-resolution flesh layer | ~2x |
| Remaining ideas (box-entry march, stepMul) | maybe 10–20% between them |

Ten to fifteen zombies on screen is still hard. Rasterising a mesh instead
would be 20–50x, because rasterisation touches each pixel once and early-Z
rejects occluded ones for free, where the raymarcher evaluates a 23-primitive
field 30–100 times **per pixel**.

## 2. The question that decides the design

**Does polygonising lose the jiggle and the flesh?** No — and the reason
matters, because it also settles the architecture.

`applyRig` moves primitive ENDPOINTS (`rig-bind.ts`). The verlet jiggle is a
deformation of the field's DEFINITION, not a rendering effect. Pose the field,
then extract, and the jiggle is exactly what it is today.

The same is true of everything the lab exists for, because all of it is field
geometry: smooth-min seamless joints, wounds as `smax` subtraction with their
everted Gaussian rims, self-closing stumps, gib chunks carrying the damage
already dealt. Marching cubes extracts that surface and nothing is lost.

Two shading tricks re-sample the field at the hit point and cannot on a mesh:

- **Backlit scatter** — `mapBody(p + L * 0.06)`
- **Field AO** — `mapBody(p + n * 0.06)`

Both get *easier*: extraction is already evaluating the field, so bake them
into vertex attributes there.

## 3. The cost argument

Per body, per frame:

| Approach | Field evaluations |
| --- | --- |
| Raymarch, close-up at 0.7 scale | ~40k px x ~30 steps = **~1.2M** |
| Marching cubes, 2 cm voxels in a tight AABB (30 x 90 x 18) | **~50k** |

About 25x fewer, and — the part that matters for a crowd — **independent of
screen coverage**. A zombie filling the frame costs the same as one forty
pixels tall. Rasterising the resulting mesh is nearly free.

### This is what rules out skinning

The obvious optimisation is to extract once and skin the mesh to the rig, so
extraction happens only on damage. **Do not.** Skinning needs per-vertex bone
weights, and blending weights across the smooth-min region between two clusters
reintroduces exactly the joint seam this whole design avoids — `rig-bind.ts`
notes that an SDF primitive is owned by a single bone precisely so that "there
are no skinning weights to solve and no blend seams".

Per-frame extraction is affordable, so buy the seamlessness with it.

## 4. What changes

| Piece | Today | After |
| --- | --- | --- |
| Field → pixels | fragment raymarch | compute extraction → triangle mesh |
| Occlusion | none (frag_depth defeats early-Z) | hardware early-Z |
| Cost driver | screen coverage | voxel count |
| Scatter / AO | field taps at the hit point | vertex attributes from extraction |
| Silhouette noise | inside `mapBody`, per step | see §5 |
| Wounds, severing, rig, face | unchanged — all upstream of extraction | unchanged |

`pack.ts`, `validate.ts`, `damage.ts`, `sever.ts`, `rig*.ts`, `face.ts` and
`simplify.ts` are all untouched. The field is the same field; only the way it
reaches the screen changes.

## 5. Silhouette noise is the one real casualty

`fbm(p * 3.0) * noiseAmp` currently perturbs the field on every march step, so
it displaces the silhouette at whatever resolution the screen has. Extraction
would capture it as real geometry, which needs voxels fine enough to resolve
it — at 2 cm they are not, and it would alias into a boiling surface as the
body moves.

Options, to be settled by eye during the spike:

1. Drop it from the field and apply it as a normal-only perturbation in the
   fragment shader. Cheapest; loses silhouette wobble, keeps surface break-up.
2. Extract at finer voxels only where noise matters. More cost, more code.
3. Displace the extracted vertices along their normals by the same fbm. Keeps
   silhouette wobble at vertex resolution rather than pixel resolution.

(1) first, since the LOD measurements already showed the noise is the single
most expensive term in the shader.

## 6. Phasing

**Phase 0 — spike, and the go/no-go.** Compute extraction of ONE posed body
into a vertex buffer; rasterise it with flat shading; no scatter, no AO, no
face, no wounds. Measure against the raymarcher at the same body count. This
either shows the 20x or it does not, and nothing else is worth building until
it does. Verify on screen that the jiggle still reads.

**Phase 1 — parity.** Wounds, severing, stumps, the face projection as a
fragment shader on the mesh, and scatter/AO baked at extraction.

**Phase 2 — the hybrid.** Raymarch the body being dismembered, mesh the crowd,
switching on the same projected-screen-height metric `lod.ts` already uses.
This is where the two approaches earn their keep together, and it is why the
raymarcher stays rather than being deleted.

**Phase 3 — decide.** With both paths measured on the same scene, either the
mesh path becomes the default or the experiment is recorded and closed.

## 7. Risks

**Extraction may not be as cheap as the arithmetic says.** 50k voxels per body
is the count; the constant factor for marching cubes on compute — the edge
tables, the vertex dedup, the indirect draw setup — is not in that number. If
extraction lands within 2–3x of the raymarch, the whole idea is dead and Phase
0 says so quickly.

**Topology changes every frame.** Severing and wounds change the surface's
genus. Marching cubes handles that natively, but the vertex count varies, so
the draw has to be indirect and the buffers sized for the worst case.

**Voxel resolution is a new tuning axis** with a hard aliasing floor: too
coarse and the fingers and jaw crease vanish, too fine and the compute cost
overtakes the saving. Expect the useful range to be narrow.

**Two renderers again.** The raymarcher stays for Phase 2's hybrid, so the lab
carries both. Accepted deliberately — the same trade the WebGPU migration made
— but the field maths must stay in ONE place, as it is now.

**This is still `X1`, a side quest.** The design doc's actual plan is
claymation sprites with voxel gibs. If the gib feel never needed field-accurate
wounds, the honest cheapest path is to record what the lab proved and go back
to that.
