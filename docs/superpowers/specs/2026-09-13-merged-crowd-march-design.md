# Merged crowd march — design

**Date:** 2026-09-13 · **Status:** design, derived from the hand-off brief
(`2026-09-13-merged-crowd-march-brief.md`) plus a code audit of the march material, kernel, packer, tile
binner, pass structure, gib instancing, deferred producer and gates. Written autonomously; the decisions
in §3 are recommendations with rationale, marked for the owner to ratify or overturn before stage (a)
ships as default. · **Plan:** `docs/superpowers/plans/2026-09-13-merged-crowd-march-stage-a.md`.

## 1. Problem (measured, from the brief)

The march draws one proxy box per body with its own `MeshBasicNodeMaterial` (~100 named inputs, its own
128×22 RGBA32F prim `DataTexture`, face sheet, segment-volume atlas) and traces only that body's field.
Overlapping boxes trace the same pixel once per body. `sdf:march` is 5–8 ms in rooms 1–2 (3–5 bodies) and
the run-5 refine twin is body-bound for the same reason. Fifty zombies would cost fifty bindings, fifty
draws and fifty duplicate traces wherever they overlap. Gibs (`createSharedChunkGpuMaterial`) already share
one node graph but still cost one draw and one uniform block each.

## 2. Audit results the design rests on

### 2.1 Uniform classification (`createMarchUniforms` / `createMarchMaterial`, 100 WGSL params)

| Class | Count | Members |
| --- | --- | --- |
| per-TYPE (look, skin, face, rest template, volume placement of the type) | 33 | `baseColor deepColor charColor mottleColor fatColor boneColor organColor organAmp visceraColor visceraDepth surfCfg surfCfg2 surfCfg3 meatCfg woundCfg(yzw) woundCfg2 woundShadowCfg faceCfg faceCfg2 faceGlowRedOnly faceProj faceAtlas faceGlowColor headAxes volumeMin volumeInvExtent volumeClip volumeWarp marchCfg lodCfg(xyw) counts2(y) normalGradientCfg` |
| per-INSTANCE | 14 | `counts` `counts2(x,z,w)` `woundCfg.x` (wound count) `woundBound` `bodyCentre` `bodyHalf` `bodyAnchor` `windDrift` `meltCfg` `bodyFlash` `headCentre` `headQuat` `volumePose0` `volumePose1` `lodCfg.z` (bodyYaw) `faceCfg3.zw` (root shift / noise shift) + the prim `DataTexture` band + `segVolumeMeta` |
| GLOBAL | ~30 | lighting rig, spot, bounce, walls, level shadow, probes, `aaCfg debugCfg perfCfg tileCfg temporalCfg`, `faceCfg3.y` (time) |

Three per-instance channels are packed inside otherwise per-type vec4s (`woundCfg.x`, `lodCfg.z`,
`faceCfg3.zw`); the split must move those channels into the record, not reassign the vec4s.

Sampled textures in the lit fragment stage today: **14 of the 16-per-stage limit** (`data volumeTex faceTex
segVolumeAtlas segVolumeMeta probeTex levelShadowTex coneTex occTex shellIn shellOut prevTex depthPreTex
lastTex`), 15 with the refine's `marchTex`. Per-type textures are `faceTex`, `segVolumeAtlas`, `volumeTex`.
The segment-volume atlas is already refcount-shared per type by `bindSkeletonVolume` (key = source revisions).

### 2.2 Kernel facts that make the merge cheap

- `band: i32` (row-block offset into a shared multi-body texture) is already threaded through `sdPrim`,
  `sdPrimO`, `foldGroup`, `foldBoneRange`, `applyBones`, and the tile-list path already converts a tile
  entry's `bodyIndex` into `gTileBand = bodyIndex * DATA_ROWS`. The cluster walk passes band 0.
- NOT banded yet: `applyCarves`, `applyWounds` (wound rows `ROW_WOUND*`), the wound-owner re-fold, and every
  `textureLoad(data, vec2<i32>(hitBest, ROW_*), 0)` in `MARCH_TRACE_POST` (hit material, rest anchor).
- `counts`, `counts2`, `woundCfg`, `woundBound`, `bodyAnchor`, `windDrift`, `meltCfg`, `bodyFlash` are read as
  parameters throughout the sections; the sections are pinned as verbatim strings by tests.
- Storage buffers already reach the material as `ptr<storage, array<...>, read>` params (`tileHdr`,
  `tileEnt`, `probeDyn`) with zero-filled singleton fallbacks and a `cfg` uniform gating the read. Instance
  records follow that route exactly.
- The GPU tile binner (`tile-bin-compute.ts`) is bit-identical to the CPU `TileBinner`, but `MAX_TILE_GROUPS
  === TILE_MAX_ENTRIES === 64` and `packGroups` throws above it — one body's groups. The per-tile entry cap
  (64) is the per-pixel fold cost bound and stays; the total-groups cap must be raised.
- No crowd room exists: the level caps at 5 co-located bodies (room 5) and 15 total; `__sdfGame.
  spawnDebugCharacter(name)` adds bodies one at a time into the current room.

## 3. Decisions (ratify or overturn)

**D1 — One material and one draw per character TYPE, not one for all.** Binding count decides it: the lit
stage sits at 14/16 sampled textures and the per-type textures are a 2D face sheet and a 3D
segment-volume atlas. Paging both into cross-type atlases is real work with no measured need: the game has a
handful of types and a crowd is mostly one type. A type = a character registry name (`zombie`, `soldier`,
…); gibs become their own type in stage 4. The per-type uniform block is the existing `MarchUniforms`
minus the per-instance members.

**D2 — Instance record = 16 vec4 in a read-only storage buffer, `MAX_CROWD_INSTANCES = 64` slots per type.**
Layout (`crowd-records.ts`, `REC_*` constants): `counts`, `counts2`, `woundBound`, `bodyAnchor.xyz + band`,
`windDrift.xyz + slotAlive`, `meltCfg`, `bodyFlash`, `noiseShift.xyz + bodyYaw`, `headCentre.xyz + woundCount`,
`headQuat`, `volumePose0`, `volumePose1`, `bodyCentre.xyz + variantSeed`, `bodyHalf.xyz + damageRevision`,
two spare. The slot index IS the band index. Wounds stay in the band's rows (cap `MAX_WOUNDS = 16` per
instance, unchanged) so `writeWounds` is reused with a row offset; only `woundBound` moves to the record and
the union-reach cull survives as-is.

**D3 — Shared prim atlas per type: one `DataTexture` of `MAX_PRIMS × (DATA_ROWS × MAX_CROWD_INSTANCES)` =
128 × 1408 RGBA32F (≈2.9 MB).** CPU posing kept (stage a): each attached view packs into its band through a
`PrimSink` interface instead of its own texture; the atlas uploads once per frame (dirty-range tracked).
Stage (b) GPU posing is deferred until the packer measurably bounds a crowd frame.

**D4 — Every view becomes a one-instance crowd first.** The kernel's per-instance parameters move into the
record for ALL bodies in one commit (the "remove from the signature in the same commit" rule): a per-body
view owns a one-band texture and a one-record buffer, and the fold loop runs over `instCfg.x = 1`
instances. This is what makes the mid-plan gate strong: after that commit the march-hash must be
bit-identical with nothing else changed, before any multi-instance code exists.

**D5 — Dispatch in stage (a) = instanced proxy boxes + mandatory tile list.** One `InstancedBufferGeometry`
box per type with per-instance centre/half attributes; the fragment's `startT` still comes from its own box
face (bit-identical to today for a lone body); the fold set per pixel is the tile list, whose entries carry
the instance slot. `mapBody` groups entries by slot and evaluates each instance's FULL field (groups, carves,
wounds, owner re-fold, bones) then takes the min — the union of exact fields, not a nearest-instance
approximation (a carved-away nearest prim must not overstep a body behind it). Overlapping boxes still
trace a pixel more than once in stage (a); a fragment whose box entry lies inside another body's solid hits
at step 1, and the depth test keeps the nearest, so the result is correct. Per-tile screen quads
(true one-ray-per-pixel) are stage (a2), after the crowd bench shows how much overlap costs.

**D6 — Tile binner: GPU compute binder, per-type binding, `MAX_TILE_GROUPS` raised to 2048** (64 instances ×
32 groups; a zombie packs ~37 groups, the cap is checked and overflow falls back per type with a counter).
The CPU `TileBinner` stays as the bit-identical parity reference in tests. Cost at 50 instances is measured
in the crowd bench before deciding whether the CPU-side group assembly needs a pass.

**D7 — Twins.** The quarter-res depth prepass (on by default) gets the same instanced treatment through the
same kernel path (`depthPreMarch` reads records). The cone pass (off by default) and the run-5 refine twin
(opt-in `?refine=1`) are NOT supported in crowd mode in stage (a): enabling either with crowd on logs once and
stays off. Stage 3 makes refine a fullscreen record-reading pass and deletes the twins and Task E.

**D8 — Per-instance skin variation = the record's `noiseShift` (the existing `faceCfg3.zw`/`lodCfg.z`
channels) plus a `variantSeed`.** Baked noise volumes remain parked.

**D9 — Deferred renderer: register the crowd mesh once per type as `'sdf'`, receiver `'level-only'`.** All
flesh already uses that receiver, so nothing is lost; a per-instance class lane is not needed until a
producer wants per-instance receivers.

**D10 — Flag first, default later.** `?crowd=1` / `__sdfGame.setCrowd(true)` selects the per-type crowd path;
the per-body path stays the ship default until the acceptance bars in §5 hold, then the flag flips and the
per-body path is deleted (not kept as a mode).

## 4. Data flow after stage (a)

```
actor.posed() ──packBody──▶ view.upload ──PrimSink.writeRow(band)──▶ CrowdPrimAtlas (one DataTexture per type)
view.setWounds ─────────────writeWounds(rowOffset = band*DATA_ROWS)─▶ same atlas
view.uniforms (per-instance) ─CrowdRecords.write(slot)──▶ storage buffer  ◀── crowd material param `inst`
view.getTileGroups() (bodyIndex = slot) ─┐
                                          ├─▶ ComputeTileBinding.bin(groups of the type) ─▶ tileHdr/tileEnt
crowd mesh: InstancedBufferGeometry(box) ─┘   per-instance attrs: iCentre, iHalf, iSlot
fragment: SETUP preloads the tile list ▶ LOOP folds per-slot full fields, min ▶ POST reads hit slot's record + band
```

## 5. Staging and acceptance bars

| Stage | Deliverable | Acceptance |
| --- | --- | --- |
| a-0 | baselines: march-hash tiles-off (canonical) and tiles-on; crowd spawn seam + bench leg | hashes recorded in the plan; `BENCH_CROWD=n` runs |
| a-1 | records + one-instance kernel (D4) for every body | march-hash bit-identical to canonical; refine-smoke PASS; `tsc` clean; vitest pins rewritten deliberately |
| a-2 | per-type atlas, instanced mesh, per-type tile binding, `?crowd=1` | crowd path: hit mask identical within 0.1 %, max depth delta below the pinned bound, flat-albedo RGB byte-identical; per-body canonical sha1 unchanged |
| a-3 | deferred registration, bench | `sdf:march` p50 flat or better at 3–5 bodies; crowd leg (24 and 48 zombies) shows cost growing with covered pixels, not bodies; tile-binning-submit < 1 ms at 48 |
| 3 | refine as one fullscreen pass reading records | refine-smoke PASS, no twins, Task E deleted |
| 4 | gibs as a chunk type; corpse bake for all characters | `sharedLiveMaterial` invariant replaced by "one chunk type draw"; chunk bench flat |
| b | GPU posing from the type's rest template | only if `packBody` shows in the crowd profile |

## 6. Risks and traps carried forward

- Positional binding in `createMarchMaterial` and by-name `wgslFn` inputs: every removed param leaves the
  binding object in the same commit; every added one is appended last in signature order.
- Shared TextureNodes: the crowd material owns the type's `levelShadowTex`, `segVolumeAtlas`,
  `segVolumeMeta` nodes; `game-main` rebinds those per type, not per actor.
- WGSL: no parens/colons in comments inside the param list; `meta` is reserved; comments are stripped by
  tests that scan declared names.
- `DataTexture` cannot resize: the atlas is allocated at `MAX_CROWD_INSTANCES` on creation.
- The frame-hash debug seam enumerates `view.uniforms` and `view.dataTexture`; it must read the record
  buffer and the band instead.
- Machine: MacBook Air 24 GB; run the targeted vitest files, not the suite, while a bench boots.
