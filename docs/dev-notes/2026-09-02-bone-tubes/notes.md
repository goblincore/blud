# Bone tubes — notes

**Date:** 2026-09-02 · **Spec:** ../../superpowers/specs/2026-09-02-bone-tubes-design.md · **Plan:** ../../superpowers/plans/2026-09-02-bone-tubes.md · **Branch:** claude/bone-tubes

## What was built

- `webgpu/bone-tube-geom.ts` — unit tube mesh (`TUBE_RINGS=24`, `TUBE_SEGS=12`, 4 cap lat rings + pole per end), `tubePoint()` CPU mirror, `boneInstanceOf()` (a, b, c=bendCtrl, r1, r2, scale, orient).
- `webgpu/bone-instancer.ts` — `createBoneInstancer(512)`: one `InstancedBufferGeometry`, per-instance data as **interleaved** `InstancedInterleavedBuffer` (18 floats/instance: a3 b3 c3 r2 scale3 quat4) with six `InterleavedBufferAttribute` views (`iA iB iC iR iScale iQ`); the interleaved form shipped — the split-attribute fallback was not needed. WGSL vertex sweep (`BONE_VERTEX_WGSL`) + march-parity Lambert key + flashlight cone (`BONE_SHADE_WGSL`). **No winding flip** — the shipped index order renders front-side correct on the page.
- `pack.ts` — `PackOpts.packBones` (default true = byte-identical legacy layout); false skips `op === 'bone'` rows and `boneCount` counts organs only.
- `zombie-gpu.ts` — `GpuViewOpts.packBones`, `setPackBones(on)` on both views, `ChunkGpuView.posedBones()` (world-space, squash applied).
- `game-main.ts` — instancer on layer 0 fed per frame from actors + `posedBones()` of live chunks; seams `__sdfGame.setBoneMesh(on)` / `.boneMesh` / `.boneTubes()`; flashlight + key-light uniforms copied per frame; `aimSurface(limb?)` + `aimHead()` added for the reel. Ships **OFF**.
- Two fixes found at first real-device boot (task 5): WGSL `ref` is a reserved word (renamed `refAxis`; vitest WGSL-string tests do not catch reserved keywords, only the page boot does), and cap 256 overflowed the live cast (46 bonePrims/zombie × mirror expansion × 10 zombies → 380; cap now 512).

## Tube-vs-field agreement

Worst |sdPrimitive| over every tube vertex (body + caps), per Task 1 case (bound: < 1 mm):

| case | worst |
| --- | --- |
| straight capsule | 0.0000 mm |
| round cone (radiusB) | 0.0351 mm |
| bent rib | 0.0000 mm |
| skull sphere (a == b) | 0.0000 mm |
| scaled (wide/deep) | 0.0000 mm |
| oriented skull sphere | 0.0000 mm |
| bent + tapered + scaled | 0.0000 mm |

## Counter gate (12-slug recipe, `__sdfGame.boneEvals()`)

`scripts/sdf-game-organs-boneevals.mjs` gained a `--bone-mesh` leg (`setBoneMesh(true)` before staging). Both legs: 12/12 slugs staged on 4 bodies, fresh page each.

| leg | bonesTotal | meanPerPayingRay | paying px |
| --- | --- | --- | --- |
| field bones (off) | 1,807,616 | 276.4 | 6,540 / 42,822 (share 0.153) |
| tubes (on) — organs only remain | 309,992 | 47.0 | 6,593 / 43,275 (share 0.152) |

Not zero — the counter counts every prim in the inside-flesh array and **organs stay** by design. The tubes leg is exactly the organ share: 309,992 / 1,807,616 = 0.171 ≈ 8 organs of ~46.7 prims/body, and meanOnHit 68.4 → 11.4 (÷6.0 ≈ (38 live bones + 8 organs) / 8). Bone capsule evaluations in the marched field: **deleted**; what remains is organs.

## Reel (owner judges)

`scripts/bone-tubes-reel.sh docs/dev-notes/2026-09-02-bone-tubes/reel` — room 3, frozen scene, A/B/A/B via `perf-r2-parity.mjs`.

| scene | a-1 (tubes) vs b-1 (field) changed px | noise floor | hot cells (a vs b) |
| --- | --- | --- | --- |
| 1-torso (slug crater) | 75 (0.0073%) | 1,213 | none |
| 2-head (`aimHead()` slug) | 20,615 (2.01%) | 20,915 | bottom band = goo pool churn; a-1 vs a-2 also 16,951 — within scene noise |
| 3-chunk (armL severed, 2 slugs) | 13 (0.0013%) | 55 | none |

Agent inspection (a-1 vs b-1, full frame + wound zooms): no pale bone visible through intact skin anywhere in any capture; wound interiors read as dark red cavities in both legs at these capture distances, and the tube-vs-field diffs sit at or below the frozen-scene noise floor. Head-shot frame shows blood-particle/goo churn, not geometry.

Bone through intact skin anywhere: **none seen**.

## Verdict

_pending owner_
