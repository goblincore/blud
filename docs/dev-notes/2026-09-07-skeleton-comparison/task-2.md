# Skeleton comparison — Task 2: anatomy mesh prototype with forward shading

Status: **FUNCTIONAL PROTOTYPE — CPU-verified, GPU/visual evidence NOT yet
captured.** Extraction, cache, renderer and game wiring are implemented,
opt-in, typecheck-clean and build-green. Shader compilation on a real
device, matched baseline/mesh captures and the wound/sever visual gates are
**not done** — treat gameplay parity as NOT achieved until the capture
checklist below runs.

Commits on `codex/dispatch/2026-09-07-skeleton-representation-comparison-task-2`:
- `e8d05e43` extraction + cache + 13 tests
- `be3c4974` renderer + selector + game wiring (+4 selector tests)

## What exists

- `skeleton-spike/mesh.ts` — `extractSegmentMesh(source, cellSize)`:
  surface-nets (band 0 = true surface + Newton pull, exact-position weld,
  smooth normals) over each `BoneFieldSource`'s segment-local field inside
  its contract bounds. `SegmentMeshCache`: key `${revision}@${cellSize}`,
  identity-hit, explicit `dispose()`. Default cell 1 cm (= chunk bake's
  BAKE_CELL; limb two-anchor error 1.26 mm is 8× below it).
- `skeleton-spike/mesh-renderer.ts` — `createSegmentMeshRenderer(cache)`:
  one `THREE.Mesh` per live segment per actor, geometry shared across
  actors via the cache, posed per frame from `source.pose()`, hidden when
  `!isLive()` (sever rule). Shading is the march's own bone look —
  `BONE_SURFACE_WGSL`/`BONE_SHADE_WGSL` + `boneInstancerUniforms` reused
  verbatim from `bone-instancer.ts` (only change there: the factory is now
  exported), fed by real `positionWorld`/`normalWorld`. Lit forward mode
  ONLY — no deferred G-buffer output.
- `skeleton-spike/selector.ts` — `resolveSkeletonMode(search, {dev,
  deferred})`: `?skeleton=mesh` resolves only in dev forward mode; absence
  or production or deferred → `procedural` (baseline preserved exactly).
  This is the exact API task 3 extends: add `'volume'` here.
- `webgpu/game-main.ts` wiring (all behind the selector): rest-bind
  `createSkeletonSources` per actor at spawn (`rig`/`bodyYaw` live
  accessors), `view.setPackBones(false)` per meshed actor, sever re-derive
  on posed-body reference change, per-frame pose + crater `setWounds`,
  light/ambient/flashlight seeding mirroring the bone-tube blocks,
  `__sdfGame.skeletonMesh()` diagnostics (mode, coverage stats, cache
  totals — proof the intended path ran).

## Wound/flesh exposure rule (the required one, not depth-only hiding)

Meshed actors drop their bone rows from the marched field
(`setPackBones(false)` — pack.ts skips only `op==='bone'` rows; organs
stay procedural). Flesh+wound smax is marched; bone surface is mesh;
composition is the depth test. Because the shipped bone fold is a HARD MIN
after the wound smax (foldBoneRange), nearest-surface depth composition ==
the field's min composition for opaque surfaces: bone appears exactly
where the carve reaches it. This is the same mechanism the shipped bone
tubes use. **Not yet visually validated.**

## Verification run (this session)

```
npx vitest run src/lab/sdf-zombie/webgpu/skeleton-spike/ --maxWorkers=2 --minWorkers=1
# 4 files, 33 tests, all passed (contract 15 + diagnostics 2 + mesh 13 + selector 3... 33 total)
npx tsc --noEmit   # exit 0
npm run build      # built in 2.91s
```

Mesh tests prove, on the REAL zombie skull/pelvis/rib segments: every
vertex on the field within 1.5 cells; mesh inside contract bounds;
Newton-pulled surface samples covered within 1.5 cells (holes / dropped
disconnected components would fail this); cache identity/invalidation/
disposal. No capsules or tubes substituted anywhere.

## Coverage / fallback accounting (honest)

- Meshed: actor bone segments (18/zombie: 4 rigid + 14 limb).
- Procedural fallback, by design: organs (contract), chunks (chunk views
  keep `packBones=true`), deferred mode (selector refuses), non-actor
  content. Limb segments pose via the contract's two-anchor approximation
  (measured 1.26 mm worst — task-1.md; below the extraction cell).
- Extraction-health counters in `skeletonMesh()`: overflow / clamped /
  droppedQuads — all asserted 0/false in tests, re-reported live.

## Known differences from the shipped oracle (classified per owner clarification)

- **Intentional art differences (allowed, recorded):** rigid-frame bend
  rotation (ribs carry bend up to 0.162 m — the mesh rotates bend vectors
  with the segment; the shipped field keeps them world-axis), limb squash
  rotating with the limb. Smoother welded normals vs. the field's gradient
  normals.
- **NOT bugs verified:** no holes (coverage test), no out-of-bounds leak
  room (bounds test), sever drop wired via `isLive()`.
- **Unverified (could still be bugs):** everything visual — shading match,
  wound reveal timing, severed-segment disappearance, depth seams at
  flesh/bone contacts, frustum culling correctness per segment.

## NOT done (next steps, in order)

1. **GPU boot + shader compile check** (private ports 5396/9396,
   scripts/lab-servers.sh): load `/sdf-game.html?skeleton=mesh`, assert no
   page errors, `__sdfGame.skeletonMesh()` reports segments/verts > 0 and
   zero overflow/clamped/droppedQuads. First-risk: the `wgslFn` include
   chain or `normalWorld` on MeshBasicNodeMaterial.
2. **Matched captures** (deterministic freeze: `pauseLoop` + `holdStill`,
   NOT `setMotionEnabled(false)` alone — fixture-contract.md): baseline vs
   mesh, skull/pelvis/ribs, darkness + flashlight, one posed/sever state,
   normal/depth views, per-mode switch proof. Gates: clipping, leaks
   through intact flesh, wound reveals, severing, shading mismatch.
3. Sever re-derive mid-pose: limb local frames derive from `restPose`,
   which stepActorMotion rewrites — spawn-time creation is exact,
   post-sever recreation is a documented approximation; measure endpoint
   error after a sever before trusting it.
4. Tilted-pose rib-gap re-measurement (task-1 limitation carried forward).
5. Task 3 API note: extend `resolveSkeletonMode` with `'volume'`; consume
   the same `BoneFieldSource[]` and cache-key discipline
   (`${revision}@${resolution}`).
