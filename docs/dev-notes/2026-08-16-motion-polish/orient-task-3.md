# Per-prim orientation — the detached-visor fix (motion-polish task 3, 2026-08-17)

## Root cause (confirmed)

Face prims (brow/nose/jaw/cranium) are anisotropically scaled ellipsoids
(brow scale `[1.55, 0.42, 0.80]`), and `sdPrim` applied the squash in WORLD
axes. `applyRig`'s rigid head pass rotated prim POSITIONS only, so a turned
head left the wide-flat brow wide-flat in the wrong direction — reading as a
detached visor/spike, with nose/jaw misalignment.

## Fix

- `Primitive.orient?: Quat` (identity default, same optional pattern as `dead`).
- New data-texture row: `DATA_ROWS` 7→8, `ROW_PRIM_QUAT` = 7 (xyzw).
- `applyRig` stamps the head's clamped rigid rotation (the SAME q
  `headTransform` derives — reused, not recomputed) on skull-owned prims.
  At rest q is the exact identity, so statues pay nothing.
- WGSL `sdPrimO` (new) rotates the sample AND both endpoints into the prim's
  local frame by the CONJUGATE quat about the prim midpoint before the
  scale-divide. CPU `sdPrimitive` mirrors it exactly (same commit).
- **Cluster-level hoist**: the naive per-prim quat row read cost a measured
  +10–18% frame time, so `clusterRange.w` (previously unused) is now the
  oriented-cluster flag; `mapBody`/`applyCarves` call plain `sdPrim` (still
  the world-axis version, diffable against the frozen GLSL) for every cluster
  except a turned head. `sdPrimO` on an identity quat runs sdPrim's exact op
  sequence, so the CPU mirror's per-prim branch is bit-identical to both.
- `specialiseMapBody` THROWS on a non-identity orient — rig-posed bodies must
  use the generic march; crowd/chunks always have identity quats.
- Chunk views write the quat row once at spawn: a severed head keeps its face
  orientation frozen at sever time (sever's prim copies carry the field).
- `march.glsl.ts` is FROZEN per owner decision and deliberately diverges here
  (header note in `march.wgsl.ts`). Not ported.

## Parity

- CPU↔WGSL parity test: 40 random oriented prims × 25 random sample points,
  `validate.sdPrimitive` vs a hand transcription of `sdPrimO` reading a packed
  Float32Array in data-texture layout (`march.wgsl.test.ts`).
- Rotated-brow regression (`rig-bind.test.ts`): head tipped past the clamp;
  the brow's surface extents along world axes, measured by bisection, match
  the rotated-ellipsoid prediction `r / |S⁻¹(q* v)|` to 2% — and the pre-fix
  behaviour (orient stripped) is pinned as the counterfactual.
- Browser parity in anger: phantom click on the TURNED head
  (headQuat w ≈ 0.92, ~46° off rest) landed the wound where clicked
  (wounds 0→1) — CPU raycast and drawn field agree.

## benchGpu (240 frames each, hiddenSteps 0, adjacent A/B pairs)

| config | before | after (naive per-prim fetch) | after (cluster-hoisted) |
| --- | --- | --- | --- |
| 1 body, motion idle | 2.41 / 2.41 ms | 2.84 / 2.83 ms (+18%) | 2.67 / 2.71 ms |
| 1 body, statue (all-identity field) | 3.01 ms | — | 3.08 ms (+2%, noise) |
| 10 bodies, cone+occluder | 14.24 ms | 15.75 ms (+10.6%) | 14.56 ms (+2.2%) |

(Machine under load from two parallel chains — absolute drift between
non-adjacent runs; only adjacent pairs quoted.) Residual cost is the feature
itself: only a cluster carrying a real quat (a turned head) pays the fetch.

## Screenshots

- `before/` — pre-fix build (visor visible on turned head), same poses.
- `after-hoisted/` — fixed build: `orient-rest` (identity quat),
  `orient-turned`/`orient-turned-2` (headQuat logged in console at shot time),
  `orient-clicked-head` (wound on the turned head).

Driver: `scripts/verify-orient.mjs` (CDP, no deps); crowd bench:
`scripts/bench-orient-crowd.mjs`.
