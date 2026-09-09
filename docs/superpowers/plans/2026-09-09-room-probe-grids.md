# Per-room probe grids in the game (lighting P3, step 2)

**Goal:** Every room in the SDF game gets its own static irradiance probe grid,
gathered once at boot from the room's paint colours, its accent point lights
and its furniture as occluders, and bound to each body spawned in that room.
Behind `probeCfg.x` (0 = bit-identical). The lab spike
(`docs/dev-notes/2026-09-09-probe-grid-spike/result.md`) is owner-confirmed.
**Architecture:** Extend the pure gather in `src/lab/sdf-zombie/probe-grid.ts`
(dispatchable, no three, worker-friendly) with point lights and occluder boxes.
Game wiring (interactive session) bakes one grid per `RoomDef` in a module
worker at boot and swaps the march's `probeTex` node per body at spawn, the
same place the enclosure uniforms are set today.
**Tech Stack:** TypeScript, vitest, WGSL (unchanged — the evaluator is done).

### Task 1: probe-grid.ts — point lights, occluder boxes, inside-probe repair

**Files:**
- Modify: `src/lab/sdf-zombie/probe-grid.ts`
- Modify: `src/lab/sdf-zombie/probe-grid.test.ts`

Read first: the whole of `probe-grid.ts` and its test (they are yours from
this morning's task), `src/lab/sdf-zombie/webgpu/game-level.ts` lines 52–94
(`AccentLight`, `ACCENT_ALBEDO_REF_DIST`, `litWallAlbedo` — the falloff the
walls already use and which this gather must MIRROR so bodies and walls agree)
and lines 264–290 (`FurnitureDef`). Do NOT import from game-level.ts — copy
the falloff constant into probe-grid.ts as `POINT_REF_DIST = 2.2` with a
comment naming its twin, and add a test pinning them equal by importing
`ACCENT_ALBEDO_REF_DIST` in the TEST only.

Every existing test must keep passing unchanged: the additions are optional
fields with defaults that reproduce today's behaviour exactly.

- [ ] **Point lights.** Extend `GatherLight` (or whatever the light options
  type is called) with `points?: { pos: Vec3; color: Vec3 }[]` (default `[]`).
  In `wallRadiance` (or the per-hit radiance site) add, for each point light
  that is VISIBLE from the hit point (see occluders below):
  `albedo * color * max(dot(normal, toLight), 0) / (1 + (d / POINT_REF_DIST)^2)`
  where `d` is the distance to the light. `power` is deliberately ignored,
  exactly as `litWallAlbedo` ignores it — the mesh PointLight and the bounce
  are calibrated separately, and this mirrors the wall side. Test: a single
  point light above the floor lights the floor directly below it more than a
  point 2.2 m away by the 1/(1+1) ratio (within 1%), and a wall facing away
  from the light gets nothing from it.
- [ ] **Occluder boxes.** Extend `ProbeGridOptions` with `occluders?: Box[]`
  (default `[]`, AABBs INSIDE the enclosure, e.g. furniture). Export
  `hitAabbEntry(origin, dir, box): { t, point, normal } | null` — the nearest
  positive ENTRY into the box from outside (slab test; normal points OUT of
  the box, toward the ray origin). In the gather, a probe ray's hit is the
  nearest of the enclosure exit and every occluder entry. An occluder hit's
  albedo is `options.occluderAlbedo` (default `[0.35, 0.33, 0.30]`, a dark
  crate). Point-light visibility from a hit point: the segment to the light
  must not enter any occluder (reuse `hitAabbEntry` with `t < d`). Tests:
  a ray from the centre toward a crate hits the crate, not the wall behind
  it; with a crate between a wall point and the light, that point receives
  only fill and bounce; a crate lit from above bounces its own albedo.
- [ ] **Probes inside an occluder.** After the gather, any probe whose
  position is inside an occluder box (inclusive) is REPLACED by the average
  of its up-to-6 axis neighbours that are not inside any occluder (if none,
  leave it zero). Export `probeInsideOccluder(grid, i, j, k, occluders)` and
  do the repair inside `buildProbeGrid`. Test: a crate covering exactly one
  probe position leaves that probe equal to the mean of its free neighbours.
- [ ] **Worker-friendly entry.** Export
  `buildProbeGridRequest(req: { box; walls; light; options })` returning
  `{ dims, min, max, sh: Float32Array }` — a plain-data wrapper over
  `buildProbeGrid` with NO closures or class instances in or out, so a module
  worker can `postMessage` the request and transfer the result buffer. Test:
  the result structurally equals `buildProbeGrid(...)` for the same inputs
  and survives `structuredClone`.
- [ ] **Performance pin.** A 10×4×10 grid, 96 rays, 2 bounces, 2 occluders,
  2 point lights completes in under 1500 ms (assert with `performance.now()`;
  print the number in the report).
- [ ] Run `npx vitest run src/lab/sdf-zombie/probe-grid src/lab/sdf-zombie/webgpu/probe-grid`
  and `npx tsc --noEmit -p .`; paste output.

### Task 2: game wiring (interactive session, GPU)

`webgpu/game-main.ts`: bake one grid per room in a module worker at boot
(paint colours as albedo, `room.accents` as point lights, that room's
FURNITURE as occluders, key = `practical-hard-key`'s dir/colour/intensities);
at spawn, next to the enclosure uniforms, set the body's `probeTex`,
`probeMin`, `probeInvExtent`, `probeDims`; `__sdfGame.setProbes(weight, gain)`
and `?probes=0` to disable; a matched-level default gain computed as the lab's
button does. Verify: `probes=0` parity, then screenshots in rooms 1 and 3.
