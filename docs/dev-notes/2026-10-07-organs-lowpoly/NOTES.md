# Organs, low-poly — notes

Branch `claude/organs-lowpoly` (worktree `.claude/worktrees/charming-lamport-9fe36c`), on top of `claude/organs-mesh`
(`e0c951e5`, PR goblincore/blud#34, open when this was built and merged to main the same day; this branch is
PR goblincore/blud#37 against main). Follow-up to
`docs/dev-notes/2026-10-06-organs-mesh/NOTES.md`; design in section 3.7 of
`docs/superpowers/specs/2026-10-06-organs-mesh-design.md`.

Owner, 2026-10-07: "i think the vertices can be reduced lol thats alot, tbh you can probably make alot of it via normal
maps and simplify it (thinking about like the intestines for example)".

## The result

The zombie's two organ segments, as meshes (`mesh.test.ts` pins these counts):

| Mesh (`ORGAN_MESHES`) | vertices | triangles | built in (in page) |
| --- | --- | --- | --- |
| `nets-5mm`: the 2026-10-06 extraction | 2,768 + 1,270 = 4,038 | 5,548 + 2,536 = 8,084 | 36.2 + 5.6 ms |
| `nets-10mm`: the bones' cell, normals from the field gradient | 671 + 328 = 999 | 1,996 | not timed in page |
| **`tubes`: ships** | **438 + 90 = 528** | **848 + 176 = 1,024** | **1.4 + 0.1 ms** |
| `tubes-12`: 12 round a ring (unit-counted only, never captured) | 1,120 | 2,208 | |

`tubes` is 13% of the 5 mm extraction's vertices and of its triangles. The ring page's whole skeleton cache goes from
93,846 to 90,336 vertices (87 entries either way).

**This is a tidiness and scalability change, not a frame-time one.** The frame was GPU-bound before and is now, and the
organ draw was never measurable in it. Flipping the organ mesh in page on the belly-crater frame (`COST=1`, 8 rounds of
24 fenced frames, `tubes` and `nets-5mm` alternating): the 4,038-vertex extraction costs +0.62 ms wall over the tubes'
24.60 ms, with an interquartile range of -0.25 to +1.35 ms. That range spans zero: no frame-time difference was
measured. A second run, on a machine busy with another session's job (43.90 ms a frame), read +0.10 ms with a range of
-2.5 to +6.35. The quiet run's frame is 4.8 ms of CPU and 19.6 ms waiting on the GPU. What did change, measurably: the vertex and
triangle counts above, and the build (41.8 ms for the pair by extraction, 1.5 ms by sweep, of a 986 ms boot extraction
whose largest single entry is the rib cage at 557 ms).

## What changed

| Piece | File | What |
| --- | --- | --- |
| Sweep | `webgpu/skeleton-spike/mesh-organ-tubes.ts` | `sweepOrganTubes(prims, spec)`: one closed tube per organ prim (rings about the axis, a cap each end), analytic normals, and per vertex `tube` = (the vertex on its tube pulled straight, the crease shade). Null for a prim it cannot sweep. Pure CPU. |
| Contract | `webgpu/skeleton-spike/contract.ts`, `mesh-skull.ts` | `BoneFieldSource.prims`: the member prims `distance()` folds. The skull sculpt adapter clears it (its field is carved, no longer the fold of its prims). |
| Cache | `webgpu/skeleton-spike/mesh.ts` | `OrganMeshSpec`, `ORGAN_MESHES`, `ORGAN_MESH_DEFAULT = 'tubes'`, `SegmentMeshCache.organMesh` (assignable; the key carries the spec). `ORGAN_MESH_CELL` is gone. Bones are untouched. |
| Shader | `webgpu/skeleton-spike/mesh-organ.ts` | `meshOrganHeight`, `meshOrganDetail` (hand-written WGSL), `ORGAN_DETAIL`, `ORGAN_RELIEF`, `ORGAN_DETAIL_SETS`; `meshOrganShade` takes the cavity shade. `OrganLook` gains `detail` and `relief`. |
| Renderer | `webgpu/skeleton-spike/mesh-renderer.ts` | The organ material reads `organTube` (an extracted organ gets zeros and no crease) and two more uniforms. Glue only. |
| Seams | `webgpu/game-seams-skeleton.ts` | `setOrganMesh(name)`; `organs()` adds `mesh`, `drawnVerts`, `drawnTris`, `detailSets`; `organSegments(id)` adds each segment's cached mesh. |
| Gate | `scripts/organs-mesh-gate.mjs` | Checks V1 to V5, a mesh cost block under `COST=1`, and `ONLY=V` for the mesh sheets. |

No march WGSL changed. `?organs=sdf`, the organ sources, their bounds and the reach cull are as they were.

## Why a sweep and not a coarser extraction

An organ prim is a sphere swept along a straight or quadratic-Bezier axis (`validate.ts` `sdPrimitive`: the capsule,
the round cone, `sdBentCone`), so its surface is the envelope of those spheres and has a closed form. The segment's
field is the hard min of its prims and the organ material writes depth, so drawing each prim's own closed tube is that
union: the nearest surface wins, and the crease where two loops meet is exact, with no cell to smear it.

- The count is set by the tessellation (8 round a ring, a ring every 18 degrees of turn, 2 cap rings), not by surface
  area over a cell squared. The 1 cm extraction is still twice the tubes' vertices.
- The normal is analytic, so a coarse ring shades round. On the sheet the plain tubes and the 5 mm extraction are hard
  to tell apart (columns 2 and 3).
- Every vertex knows where it is on its tube. That is what makes structured detail possible: a ring ACROSS the tube
  needs the tube's own coordinate. A noise bump in segment space gives lumps, not haustra (the same lesson as the
  muscle-definition dead end: noise reads as "bumpy texture").

Measured (`mesh-organ-tubes.test.ts`, on the real zombie):

- every vertex is within 0.2 mm of its own prim's zero set, and none is outside the segment field (the mesh is
  inscribed in the field, so it cannot poke out of flesh the SDF organ was contained in);
- the normal is within 0.995 (cosine) of that prim's field gradient;
- 0 of the 1,024 faces are folded (no authored bend is tighter than its radius; a fold, if one is ever authored, lies
  inside the solid, and the test asserts that);
- every vertex of the 5 mm extraction is within 3.05 mm of a tube face, 1.20 mm on average: the sag of an 8-gon
  inscribed in a 2.2 to 2.6 cm circle. On screen that is the 3.5% in V3 below.

The bone tubes of 2026-09-02 were rejected because a tube cannot be a pelvis. That does not apply here: these prims
are tubes by authorship, and the sweep is checked against the extraction. A segment with a prim a sweep cannot express
(a box, a strand, a shell) is extracted instead, at 1 cm with gradient normals (`ORGAN_NETS_FALLBACK`, unit-tested;
no such organ is authored).

## The detail, as shading

`organTube.xyz` is the vertex's place on its own tube pulled straight: x along the axis in metres (arc length, each
prim on its own stretch), yz across it. On a cap it is the point on the straightened capsule's end sphere, so nothing
is singular at a pole and there is no seam round the tube. `organTube.w` is baked: 0 where the vertex touches another
prim of the segment, 1 from 1.4 cm clear.

- `meshOrganHeight(q, detail, relief)` is a height in metres over that coordinate: **haustra**, a groove a period in
  `q.x` whose line wanders a little round the tube, and **fine wrinkles**, a noise stretched along the tube.
- `meshOrganDetail` takes the height's slope in tube coordinates (three more heights) and carries it to a world normal
  with screen derivatives of the tube coordinate and of the world position (Mikkelsen, Bump Mapping Unparametrized
  Surfaces on the GPU, 2010). The mesh needs no tangent and the shader no instance matrix: three's instancing node
  transforms position and normal only. It fades each detail out as it nears 3 pixels, and returns the cavity shade:
  the baked crease times the groove's floor.
- `meshOrganShade` multiplies the cavity shade into the lit colour and the glint.

A baked normal map was not needed: the height is a dozen lines, has no texture to bind, and stays sharp at any
distance the fade allows.

The numbers (`setOrganLook({ detail, relief })` tries others live):

| | haustra depth | wrinkle depth | crease shade | period | groove wander | floor shade | sharpness | wrinkle size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `plain` | 0 | 0 | 0 | | | | | |
| `subtle` | 1.5 mm | 0.3 mm | 0.3 | 26 mm | 0.2 | 0.12 | 4 | 4 mm |
| **`ships`** | **2.5 mm** | **0.4 mm** | **0.4** | **25 mm** | **0.22** | **0.2** | **5** | **4 mm** |
| `strong` | 3.5 mm | 0.6 mm | 0.6 | 22 mm | 0.45 | 0.45 | 6 | 4 mm |

`strong` was the first try. It reads as an intestine on the gutted scene and as rope where a coil is seen end on
(sheet 01), so the shipped set is weaker. The wrinkles barely register at this size (a 4 mm wrinkle is a few pixels
at 0.7 m, where the fade has already taken most of it); they are there for a closer look than the game gives today.

The detail darkens the organ's mean colour a little, mostly by breaking the torch's one long glint into a spot per
bulge: under the torch the mesh organ is 0.220 from the SDF organ in the gate's S9 (the 5 mm mesh on `wet` was 0.191;
the tolerance is 0.25).

## The sheets (the owner picked: as shipped)

`look/` — written by `ONLY=V OUT=docs/dev-notes/2026-10-07-organs-lowpoly/look node scripts/organs-mesh-gate.mjs`.
Columns: SDF organs | `nets-5mm`, plain (2026-10-06) | `tubes`, plain | `tubes`, detail `subtle` | `tubes`, detail as
shipped | `tubes`, detail `strong`. Rows: torch off, torch on. Every tile is the same frame; the mesh and the detail
are flipped in page. All mesh columns are on the `wet` look.

- `01-belly-slug-0.7m.png` — one slug in the belly: a coil seen end on.
- `02-gutted-two-slugs-0.6m.png` — two slugs: the gut coil and the loop above it, seen along their length.
- `*-zoom-2x.png` — the middle of each tile at twice the size (nearest neighbour), for the eye.

**The pick, 2026-10-07: the detail as shipped** ("go with as shipped"): `ORGAN_DETAIL` / `ORGAN_RELIEF` stay as
built, on the `tubes` mesh. `plain`, `subtle` and `strong` remain in `ORGAN_DETAIL_SETS` for a live comparison.

The two questions the sheet put: columns 2 against 3 (is the low-poly mesh as good as yesterday's, detail off), and
columns 3 to 6 (how much haustra, if any). `__sdfGame.setOrganMesh('nets-5mm')` and
`__sdfGame.setOrganLook(__sdfGame.organs().detailSets.subtle)` try them live.

## The gate: `scripts/organs-mesh-gate.mjs`

37 checks, 0 failed (2026-10-07, ports 5257 / 9257, run twice): the 32 of 2026-10-06 and five new ones. U3's
unwounded march target still hashes `00a29832`, the value in the 2026-10-06 notes: the march is untouched.

| Check | Result |
| --- | --- |
| S8 organ area, mesh / sdf | 0.86 (the 5 mm mesh: 0.89) |
| S9 mean colour, torch on | 0.220 and 0.219 apart (was 0.191) |
| T2 mean colour, torch off | 0.069 apart (was 0.055) |
| V1 the default mesh | `tubes`: 528 vertices / 1,024 triangles in 2 instances |
| V2 `setOrganMesh('nets-5mm')` on the same frame | 4,038 vertices / 8,084 triangles |
| V3 silhouette, tubes / extraction, detail off | 7,287 px / 7,555 px = 0.965 (tolerance 0.9 to 1.05) |
| V4 shade, tubes against extraction, detail off | 0.042 apart (tolerance 0.08) |
| V5 and back | `tubes`, 528 vertices, the shipped look |

V4 failed its first run: its tolerance was a guess of 0.03 and the measurement is 0.042 (the tubes are slightly
brighter: their normals are the field's own, where the extraction's are averaged over faces and smeared across each
crease). The tolerance is now 0.08, set from that measurement and from the mutation below.

### Each new check was shown to fail

One breaking change at a time, `ONLY=M`, then the file restored:

| Breaking change | Checks that failed |
| --- | --- |
| the sweep's normals negated (`mesh-organ-tubes.ts`) | V4 (0.163 apart), S9, T3 |
| the sweep's radius times 0.88 (`mesh-organ-tubes.ts`) | V3 (0.879) and no other: S8's 0.6 to 1.5 does not see a 12% thinner tube |
| `ORGAN_MESH_DEFAULT = 'nets-5mm'` (`mesh.ts`) | V1, V2, V5 |

## Verification

- Unit tests beside the changed modules: `mesh-organ-tubes.test.ts` (new, 12), `mesh.test.ts` (organ block rewritten:
  the counts, the keys, gradient normals, the fallback), `mesh-organ.test.ts` (the detail WGSL and its CPU mirrors),
  `mesh-renderer.test.ts` (`organTube` on every organ geometry, the spec swap, the look's new fields).
- The vitest tree (`npx vitest run src/lab/sdf-zombie scripts/lib`): 529 files, 7,673 tests; 1 failed,
  `game-seams-skeleton.test.ts` (it pinned the exact shape of `__sdfGame.organs()`, which now has four more fields).
  Pin updated and a `setOrganMesh` test added beside it; that file and the `skeleton-spike` folder were rerun
  (15 files, 206 tests, all pass). The whole tree was not run a second time.
- `tsc --noEmit` is clean but for `pack-golden.test.ts`'s `node:crypto` import, which the base branch has too.
- Not run: `head-split-gate`, `axe-gate`, `cut-wound-gate`, `march-hash`, `compile-census`, the cold-boot comparison.
  No march WGSL and no bone path changed; the organ pipeline compiled and drew with no console error in every boot of
  the organs gate.
- The first capture of a session at a load average near 190 timed out in `warmBackground`; nothing was wrong with
  the page. Heavy jobs now queue on `/tmp/blud-gpu-timing.queue` before taking `/tmp/blud-gpu-timing.lock`.

## Left open

- **`around: 8`** is the shipped ring. `tubes-12` exists for a rounder silhouette at 1,120 vertices; it was not
  captured, because the 8-gon's silhouette is within 3.5% of the extraction's and is not visibly faceted at 0.6 m.
- **The crease shade is per vertex** (rings about 1.5 cm apart), so it is a soft contact shade, not a line. The crease
  line itself is exact, from the depth test.
- **No self-shadowing** on the mesh organ, as before (2026-10-06 notes).
- **New organ shapes** are cheaper again: a bar or a blob with `organ` in the .blob comes out as about 40 to 100
  vertices, with haustra, and a liver or a heart (ellipsoid `scale`) sweeps too (unit-tested on a built prim).
