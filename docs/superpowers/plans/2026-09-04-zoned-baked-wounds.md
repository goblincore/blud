# Zoned Baked Wounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a default-off head AND main-torso wound-cache prototype, then deliver a visible motion comparison and an honest close-up performance verdict.

**Architecture:** Bake small authored damage operators offline and accumulate them into one head cache and four torso caches on impact. Play a short source-to-target transition and sample only the accumulated target once settled. Preserve the analytic body, existing gameplay and unsupported wound paths; compare dynamic shading and cached cavity shading separately.

**Tech Stack:** Existing TypeScript, Vitest, Three WebGPU/TSL/WGSL, Data3DTexture, tsx, Vite and Chrome/CDP harnesses. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-04-zoned-baked-wounds-design.md` — read the complete spec before implementation; it travels with each dispatch task.

## Global Constraints

- BOTH head and main torso. Torso close-up is the primary visual and performance case; a head-only result does not satisfy the request.
- Opt-in feature, default OFF. One experimental actor; other actors remain baseline.
- Five physical cache frames: one rigid head frame and one for EACH of the four authored torso masses in zombie.blob. Logical zones do not become anatomical cluster IDs.
- Start with 64^3 cells per cache and evaluate 96^3 for close-up quality. Hard experimental GPU ceiling: 96 MiB for this one candidate actor, not a suggested crowd budget.
- Source-to-target playback is deterministic 160 ms cubic ease-out. No settled per-frame history replay or volume upload.
- Separate raw field values from safe ray-advance distances. Never raise relax above 1.0 to hide a slow candidate.
- No changes to src/sim or src/game; prototype stays under src/lab/sdf-zombie and scripts, with lab assets and evidence docs.
- No global limit increases, adaptive resolution, per-frame extraction, whole-character draft tooling or full corpse system.
- No automatic default flip, merge or dispatch of follow-up projects. Owner visual acceptance is separate from numerical success.
- Planning baseline: main ea7d989, 2026-09-04. Re-read current main and reconcile concurrent game/march changes. Fog on numeric distance passes and the frozen-from-boot missing hull were fixed in 8da0bdd; do not repeat that investigation.
- Read project and infra DualMem context through the shared launcher; check cochange before edits. Do not use MEMORY.md. Save findings with associated files.
- Each task runs in its own worktree. The dispatch chain is queued for later execution; task preparation is not authorization to run it now.
- Task 3 numerical/memory failure or task 4 motion/lifecycle failure stops later feature work. Task 6 still produces the negative-result report. Missing gate evidence is not a pass.

## File map and shared contracts

New `src/lab/sdf-zombie/zoned-wounds/` modules: `types.ts` defines the contract; `regions.ts` resolves eligible owners and labels; `presets.ts` selects content; `bake.ts` generates stamp voxels; `sample.ts` implements the CPU reference; `cache.ts` owns accumulation/playback; `pose.ts` maps cache frames through live rig and detachment. Keep their Vitest tests beside them.

New WebGPU modules: `webgpu/zoned-wound-volume.ts` owns textures and upload diagnostics; `webgpu/zoned-wounds.wgsl.ts` owns sampled damage helpers. Integrate at existing `march.wgsl.ts`, `zombie-gpu.ts`, `game-actor.ts` and `game-main.ts` seams. `gib-chunks.ts` changes only if the existing detachment payload cannot carry the frame/reference without it.

New scripts: `scripts/bake-zoned-wounds.ts`, `scripts/zoned-wound-bench.mjs`, `scripts/zoned-wound-reel.mjs`, `scripts/zoned-wound-gpu-check.mjs`; shared gate handling in `scripts/lib/zoned-wound-gates.mjs`. Reuse the current close-up staging library if it has landed. Bake outputs go in `public/assets/lab/wounds/zombie/`; evidence goes in `docs/dev-notes/2026-09-04-zoned-baked-wounds/`.

Task 1 establishes these names in `types.ts`. Arrays at the CPU/GPU boundary have validated lengths and finite numbers. Existing game Vec3 values convert at the adapter boundary; do not change the project's vector type.

```ts
export type V3 = readonly [number, number, number];
export type Bounds = { min: V3; max: V3 };
export type Side = 'front' | 'back' | 'left' | 'right';
export type RegionId = `head-${Side}` | `torso-${'upper' | 'lower'}-${Side}`;
export type CacheKey = 'head' | `torso-${0 | 1 | 2 | 3}`;
export type WoundMode = 'analytic' | 'cached-dynamic' | 'cached-cavity';
export type Recipe = 'puncture' | 'ragged-crater' | 'split';
export type Stage = 1 | 2 | 3;
export interface DamageSample { cut: number; lip: number; mask: number; ao: number }
export interface FieldSafety { error: number; lipschitz: number }
export interface OwnerSpec {
  key: CacheKey; primitiveIds: readonly number[]; bounds: Bounds;
}
export interface Impact {
  id: number; key: CacheKey; region: RegionId; seed: number;
  point: V3; normal: V3; radius: number; depth: number;
  recipe: Recipe; variant: 0 | 1 | 2; stage: Stage; timeMs: number;
}
export interface StampManifest {
  version: 1; format: 'rgba16f'; units: 'metres'; dims: V3; bounds: Bounds;
  recipe: Recipe; variant: 0 | 1 | 2; stage: Stage;
  safety: FieldSafety; contentHash: string;
}
export interface BakedStamp { manifest: StampManifest; rgba: Float32Array }
export interface CacheBrick {
  key: CacheKey; dims: V3; bounds: Bounds;
  source: Float32Array; target: Float32Array;
  safety: FieldSafety; version: number; startedAtMs: number;
}
export interface CacheSnapshot {
  bricks: readonly CacheBrick[]; timeMs: number; transitioning: boolean;
  impactCount: number; cpuBytes: number;
}
export interface CacheSystem {
  enqueue(impacts: readonly Impact[]): void;
  advance(timeMs: number): CacheSnapshot;
  snapshot(timeMs: number): CacheSnapshot;
  reset(): void;
}
```

`FieldSafety` describes the represented scalar field plus its measured/derived error, not an assertion that the samples form an exact SDF. Cache safety covers combined cutter/lip effects. The shader additionally accounts for the base field and frame transform. Normalized outward normals, metre units and stage keys are validated. `CacheSnapshot` is a read-only view over owned buffers; callers must not retain mutable arrays across the next update without copying. The impact log is copied and immutable.

Gate file: `docs/dev-notes/2026-09-04-zoned-baked-wounds/gates.json`. New helpers `readGate(path)` and `writeGate(path, patch)` preserve unrelated entries and write atomically. Shape:

```json
{
  "version": 1,
  "fixture": "pending",
  "baker": "pending",
  "numerical": "pending",
  "memory": "pending",
  "lifecycle": "pending",
  "visualEvidence": "pending",
  "ownerLook": "pending",
  "timing": "pending",
  "reasons": []
}
```

Each gate accepts `pending`, `pass`, `fail`, `deferred`, or `skipped-by-gate`. Only the user can set `ownerLook: pass`. Every update records the source commit, command, artifact path and reason in `reasons`. Tests can use temporary paths. Write `baseline.json` and an append-only `notes.md` beside it; do not store unbounded raw recordings in Git.

---

### Task 1: Establish the head-and-torso fixture and comparison contract

**Files:**
- Create: `src/lab/sdf-zombie/zoned-wounds/types.ts`, `regions.ts`, `regions.test.ts`.
- Create: `scripts/zoned-wound-bench.mjs`, `scripts/lib/zoned-wound-gates.mjs`, `scripts/lib/zoned-wound-gates.test.mjs`.
- Create: `docs/dev-notes/2026-09-04-zoned-baked-wounds/{baseline.json,gates.json,notes.md}`.
- Modify: `src/lab/sdf-zombie/webgpu/game-bench-scenario.ts` and `game-bench-scenario.test.ts` for deterministic region hit sequences.
- Read: `characters/zombie.blob`, `blob-compile.ts`, `rig-bind.ts`, `damage.ts`, `scripts/sdf-game-closeup-bench.mjs`, `scripts/lab-servers.sh`.

**Interfaces:**
- Consumes: existing compiled zombie/body metadata and current close-up staging APIs, inspected at execution time.
- Produces: all shared types above; `classifyRegion(part: 'head' | 'torso', localPoint: V3, localNormal: V3, torsoBounds: Bounds): RegionId`; `resolveOwners(body: BuildResult): readonly OwnerSpec[] | null` using existing `BuildResult` import; gate helpers; baseline-only CLI `node scripts/zoned-wound-bench.mjs --mode analytic --hits 8 --out /tmp/zoned-baseline`.

- [ ] Read current main, the entire spec, relevant DualMem context and the active close-up helper's status. If `scripts/lib/sdf-closeup-stage.mjs` exists, import its actual exports. If absent, keep this script as a thin adapter to the existing bench's staging and document the source; extract only the required shared staging functions without behavior changes. Never assume unmerged work exists.
- [ ] Add boundary-classification and unsupported-layout tests first. Use the real compiled zombie fixture for owner count and metadata mapping; also insert an unrelated face primitive and prove selection does not rely on fixed indices. Assert no new renderer cluster IDs.

```ts
const bounds = { min: [-1, 0, -1], max: [1, 2, 1] } as const;
it('chooses one label at the torso split, without moving the hit', () => {
  const p = [0.1, 1, 0.2] as const;
  expect(classifyRegion('torso', p, [0, 0, 1], bounds))
    .toBe('torso-upper-front');
  expect(p).toEqual([0.1, 1, 0.2]);
});
```

- [ ] Run `npx vitest run src/lab/sdf-zombie/zoned-wounds/regions.test.ts` and observe the missing behavior fail. Implement classification with +Z front, -Z back, +X right, -X left in the canonical fixture frame; at equal |X|/|Z| choose Z, and at midpoint choose upper. Verify this convention against the rendered fixture and convert rig axes in the adapter if needed. Infer four torso masses and head membership from compiled source/bone metadata; return null with a diagnostic for unsupported layouts.

```ts
const side = Math.abs(localNormal[2]) >= Math.abs(localNormal[0])
  ? (localNormal[2] >= 0 ? 'front' : 'back')
  : (localNormal[0] >= 0 ? 'right' : 'left');
const half = localPoint[1] >= (torsoBounds.min[1] + torsoBounds.max[1]) / 2
  ? 'upper' : 'lower';
return part === 'head' ? `head-${side}` : `torso-${half}-${side}`;
```

- [ ] Establish torso-heavy and head-detail cameras. Require >=50% intact flesh coverage and >=35% torso coverage before accepting a baseline; derive coverage from diagnostic masks, not beauty-image brightness. Record fixed resolution, actual SDF target, camera, seed, owner metadata, all feature toggles and body census. Refuse a missing SDF layer or a camera inside flesh. Keep the intact coverage mask for later paired runs.
- [ ] Extend the deterministic scenario data with 1/4/8/16-hit sequences on head AND torso, a repeated-zone sequence and a cross-boundary sequence. Store world input plus intended region and expected successful hit count. Tests assert the exact hit counts and deterministic ordering; the GPU smoke asserts hits land on intended visible surfaces. Do not disable sever rules in gameplay cases; diagnostic settled stamping is a separately labeled case.
- [ ] Write gate helpers with atomic temporary-file rename and preservation tests, using Node's built-in test runner. The bench records `fixture: pass` only after a real screenshot and coverage census. Timing may be deferred under load without blocking a valid fixture. Close browser tabs in `finally`.
- [ ] Verify with `node --test scripts/lib/zoned-wound-gates.test.mjs`, the two targeted Vitest files, `npx tsc --noEmit`, and the baseline CLI above with local Vite/CDP servers started through the existing lab server helper. Record actual port/configuration and command in `notes.md`.
- [ ] Commit only this task's implementation and small evidence manifests: `feat(lab): establish zoned wound comparison fixture`. Do not promote the feature or touch unrelated work.

### Task 2: Bake reusable wound stamps and persistent playback state

**Files:**
- Create: `src/lab/sdf-zombie/zoned-wounds/{presets.ts,presets.test.ts,bake.ts,bake.test.ts,sample.ts,sample.test.ts,cache.ts,cache.test.ts}`.
- Create: `scripts/bake-zoned-wounds.ts`, `public/assets/lab/wounds/zombie/manifest.json` and generated stamp binaries.
- Modify: `src/lab/sdf-zombie/zoned-wounds/types.ts` only for documented contract corrections; update every consumer if changed.
- Update: `docs/dev-notes/2026-09-04-zoned-baked-wounds/{gates.json,notes.md}`.

**Interfaces:**
- Consumes: Task 1 types, region/owner selection, existing wound radius and depth-cap semantics.
- Produces: `selectPreset(type: 'pellet' | 'blast', seed: number, regionHitCount: number): { recipe: Recipe; variant: 0 | 1 | 2; stage: Stage }`; `bakeStamp(recipe: Recipe, variant: 0 | 1 | 2, stage: Stage, resolution: number): BakedStamp`; `composeDamage(a: DamageSample, b: DamageSample): DamageSample`; `applyDamage(flesh: number, damage: DamageSample): number`; `sampleStamp(stamp: BakedStamp, point: V3): DamageSample`; `createCache(owners: readonly OwnerSpec[], resolution: 64 | 96, library: readonly BakedStamp[]): CacheSystem`; `sampleCache(snapshot: CacheSnapshot, key: CacheKey, point: V3): DamageSample`.

- [ ] Require `fixture: pass`; otherwise record `baker: skipped-by-gate` and stop. Write reference-composition tests first, including identity, order independence, repeated impacts and lip/cutter ordering.

```ts
it('never lets a later lip refill already cut space', () => {
  const old = { cut: -0.03, lip: 0, mask: 1, ao: 0.8 };
  const next = { cut: 1, lip: 0.04, mask: 0.7, ao: 0.6 };
  const damage = composeDamage(old, next);
  expect(applyDamage(-0.01, damage)).toBeCloseTo(0.03);
  expect(composeDamage(next, old)).toEqual(damage);
});
```

- [ ] Run the new sample test and observe failure. Implement the reference channel algebra with explicit outside-bounds identity, bounded compact lip support and finite positive far-cutter sentinel exceeding the full cache diagonal. Blend field endpoints before applying the operator; do not blend finished rendered colors.

```ts
return { cut: Math.min(a.cut, b.cut), lip: Math.max(a.lip, b.lip),
  mask: Math.max(a.mask, b.mask), ao: Math.min(a.ao, b.ao) };
// applyDamage:
return Math.max(flesh - damage.lip, -damage.cut);
```

- [ ] Author puncture, ragged-crater and split recipes with three seeded variants and three stages each. Stage 1 is hit 1; stage 2 hits 2-3; stage 3 hits 4+. Start from current 0.055 m pellet and 0.13 m blast references, retain supplied depth caps, and document tuned dimensions. Use deterministic analytic cutter combinations and bounded lip envelopes; bake 27 stamp assets with a reproducible content hash. A transform scales distance values and safety bounds as well as coordinates; test uniform scaling and reject unsupported nonuniform stamp scaling initially.
- [ ] Derive trilinear gradient bounds from maximum corner differences per axis and account for float16 quantization and support-boundary transitions. Round-trip binary assets and test finite values, units, bounds, dimensions, channel ranges, hash reproducibility and outside identity. Compare random and boundary samples against the high-resolution analytic bake source; store maximum observed error alongside the conservative bound. A measured maximum alone is not a conservative proof.
- [ ] Implement cache updates in affected CPU voxel ranges, source/target versioning and same-frame batching. During interruption, materialize the current blend once into source, but compose the new target from the PREVIOUS TARGET. Keep the immutable impact log outside the wound ring. Record touched voxels and CPU bytes; do not call a full GPU texture upload a partial update.

```ts
const t = Math.min(1, Math.max(0, (timeMs - brick.startedAtMs) / 160));
const blend = 1 - (1 - t) ** 3;
// On a new batch: source = mix(source, target, blend).
// Then target = compose(previousTarget, batch), startedAtMs = batch time.
// Settled snapshots select target directly and change no version.
```

- [ ] Test an interrupted transition at 80 ms against an uninterrupted reference: previously targeted removed space remains removed in the new final target, and the new source equals the field visible immediately before the hit. Test same-frame pellet order, impacts beyond 16 records, seed stability, bounds guards, empty caches, reset and no version/upload trigger changes after settling. Use small resolutions inside internal bake/cache fixtures to keep unit tests fast; public runtime accepts only 64 or 96.
- [ ] Run `npx vitest run src/lab/sdf-zombie/zoned-wounds`, `npx tsx scripts/bake-zoned-wounds.ts --out public/assets/lab/wounds/zombie`, and `npx tsc --noEmit`. Re-run the bake into `/tmp/zoned-wound-rebake` and compare manifest and binary hashes. Mark `baker: pass` with errors, bounds and asset bytes; otherwise fail and explain.
- [ ] Commit source, tests, reproducible assets and evidence manifests: `feat(lab): bake wound operators and cache impact playback`.

### Task 3: Integrate bounded GPU damage sampling with a numerical stop gate

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/{zoned-wound-volume.ts,zoned-wound-volume.test.ts,zoned-wounds.wgsl.ts,zoned-wounds.wgsl.test.ts}`.
- Create: `scripts/zoned-wound-gpu-check.mjs`.
- Modify: `src/lab/sdf-zombie/webgpu/{march.wgsl.ts,zombie-gpu.ts}` and their existing tests.
- Inspect and modify only if required for conservative bounds: `src/lab/sdf-zombie/webgpu/{shell-hull-outer.ts,occluder-hull.ts}` and current cone/bounds call sites discovered from `zombie-gpu.ts`.
- Update: `docs/dev-notes/2026-09-04-zoned-baked-wounds/{gates.json,notes.md}` with numerical arrays/images.

**Interfaces:**
- Consumes: `CacheSnapshot`, `DamageSample`, `FieldSafety`, CPU `sampleCache`/`applyDamage` and stamp manifests.
- Produces in `zoned-wound-volume.ts`: `createZonedWoundVolume(resolution: 64 | 96): ZonedWoundVolume`; interface methods `sync(snapshot: CacheSnapshot): void`, `dispose(): void`, `diagnostics(): { gpuBytes: number; uploadBytes: number; uploadCount: number }`. Its texture/transform bindings become an optional property on existing `ZombieGpuView`/`GpuViewOpts`; the field stays disabled by default. Export WGSL helpers through `ZONED_WOUND_HELPERS`, following the existing string-helper pattern.

- [ ] Require `baker: pass`. Add allocation/packing tests for five guarded slabs at both resolutions, exact byte accounting, slab isolation, invalid sizes and the 96 MiB ceiling before allocating GPU resources. Count both endpoints and every mip/resource; no hidden allocation fallback. Add tests that unchanged settled versions cause zero uploads and disposal releases all owned handles.
- [ ] Run the new tests to establish failure. Implement two RGBA16F 3D atlases with two-voxel slab guards, explicit identity outside bounds and inactive-cache early exits. Allocate slabs only for active owners; growth/repacking on a newly wounded owner is event work and must appear in upload/impact counters. The five-owner calculation below is the maximum, not permission to allocate empty owners. Choose manual trilinear sampling as the correctness reference; hardware filtering is allowed only after equivalence and device support are verified. Clamp within the selected slab, never into adjacent owners. Bind valid neutral textures when disabled. Record actual allocations, including Three's behavior.

```ts
const interior = resolution;
const guarded = interior + 4;
const bytesPerTexel = 4 * 2; // RGBA16F, not Float32 CPU storage
const fullPairBytes = guarded * guarded * (guarded * 5) * bytesPerTexel * 2;
if (fullPairBytes > 96 * 1024 * 1024) throw new Error('cache GPU budget exceeded');
```

- [ ] Integrate cached cutters/lips into flesh before bone/organ union while retaining pre-wound flesh for tissue shading. Query all active cache bounds and combine their operators; do not select by nearest primitive. Preserve analytic fallback wound evaluation and replace cache-owned material/nearWound support. During animation sample two endpoints; once settled only target. Make field-probe diagnostics include normal, AO, scatter and shadow queries rather than only primary steps.
- [ ] Implement a separate conservative step result accounting for base flesh, cache gradient/error and local-to-world scaling. For a scalar field with certified bound L and error e, use `max(0, abs(raw)-e)/L` as the distance lower bound in the applicable tracing domain; the actual composition supplies L and e. Bound base-field smooth blends and any enabled noise too. Near zero safe advance, refine the hit with the raw field instead of inventing an unsafe minimum step. Keep raw signed values for tissue/AO decisions. Explicitly audit primary, cone and wound-shadow rays, including hidden relax/over-relax paths.
- [ ] Update proxy bounds to include lip support, and prove first-hit accelerators cannot skip expanded flesh. If an accelerator has no conservative integration, disable it in both matched legs and label that configuration; preserve a separate unmodified shipping baseline. Never compare a candidate with a missing layer or reduced body coverage.
- [ ] Build real GPU checks for CPU/GPU sample agreement, negative distances, slab boundaries, translated/rotated frames, overlapping owners and texture-distance round-trip under scene fog at several camera ranges. Numeric materials disable fog, tone mapping, blending and color conversion. Add dense CPU first-crossing rays through raised lips, grazing joins and cavities at both resolutions. Require first-surface error within the derived voxel/quantization bound and no unreported crossing past an earlier surface. Include the prior default-omega raised-lip fixture; document any baseline error separately.
- [ ] Run the targeted WebGPU Vitest files, `npx tsc --noEmit`, and `node scripts/zoned-wound-gpu-check.mjs --out /tmp/zoned-gpu-check` against actual WebGPU. Unit tests that merely inspect WGSL text cannot pass this gate. Save numerical arrays, max errors, missed crossings, actual bytes and a diagnostic screenshot.
- [ ] Set numerical and memory gates to pass only with evidence. If safe sampling is incorrect or exceeds memory, record NO-GO and stop; do not weaken bounds or hide cost. Commit the bounded experiment and findings as `feat(lab): sample wound caches with conservative trace checks`, or a documentation-only negative result if integration cannot safely land.

### Task 4: Attach caches to the live actor, collision and detached pieces

**Files:**
- Create: `src/lab/sdf-zombie/zoned-wounds/{pose.ts,pose.test.ts}`.
- Modify: `src/lab/sdf-zombie/webgpu/{game-actor.ts,game-actor.test.ts,game-main.ts,zombie-gpu.ts}`.
- Modify if required: `src/lab/sdf-zombie/{gib-chunks.ts,gib-chunks.test.ts}` for explicit cache-reference lifetime metadata.
- Update: `scripts/zoned-wound-bench.mjs` and `docs/dev-notes/2026-09-04-zoned-baked-wounds/{gates.json,notes.md}`.

**Interfaces:**
- Consumes: `CacheSystem`, CPU sampled field, `ZonedWoundVolume`, `OwnerSpec`, existing `HeadRigid`, `woundWorldPos`, `woundCarveNormal`, `DetachedPiece` and `ChunkGpuView` paths.
- Produces in `pose.ts`: `CacheFrame` containing validated 16-number `worldFromCache` and `cacheFromWorld` matrices; `worldToCache(frame: CacheFrame, point: V3): V3`; `cacheToWorld(frame: CacheFrame, point: V3): V3`. Extend actor/view APIs with `setWoundMode(mode: WoundMode): void` and `woundCacheSnapshot(): CacheSnapshot | null`. Expose diagnostic `__sdfGame.setZonedWounds({ mode, actorId, resolution })` and `__sdfGame.zonedWoundsInfo()`; the latter returns mode, owners, readiness, fallback counts, hit counts, resource/update counters and current gate-relevant frame data.

- [ ] Require numerical and memory gates to pass. Read `refreshWounds`, `applyProjectileHit`, hit/hitSlug/stampBlast, rig application, sever/rebind and `spawnChunkPiece` on the latest checkout. Identify exact collision/aim/bleed call sites from these methods before modifying them. Preserve concurrent post-hit/goo changes.
- [ ] Write transport tests using existing posed zombie fixtures: a point anchored to each of four torso masses and the skull must round-trip through 0/90/180-degree body yaw, head rotation, walking pose and recoil. Include spherical torso anchors, which need bodyYaw despite uninformative primitive axes. Test a seam hit that changes nearest primitive as the rig moves but stays attached to its original owner.

```ts
// Each fixture supplies a CacheFrame from the actual rig transform adapter.
const local = [0.03, 0.01, -0.02] as const;
const back = worldToCache(frame, cacheToWorld(frame, local));
for (let axis = 0; axis < 3; axis++) expect(back[axis]).toBeCloseTo(local[axis], 5);
```

- [ ] Run the transport tests and observe failure. Implement frames from the same head-rigid and primitive-local transport used by existing wounds. Cache ownership persists by stable source metadata through primitive reindexing. Region labels only select recipes; they never clip a wound at the neck/shoulder/torso zone border. Unsupported neck, burn and limb impacts stay analytic and increment fallback diagnostics.
- [ ] Add default-off game/view mode wiring. Keep existing Wound records for recoil/sever/accounting and separate immutable cache impacts for persistence. Stage loading and texture readiness before suppressing supported analytic visual entries. Process a same-frame batch once; update frame matrices per pose, but upload voxel data only on impact/version changes. A zero-count legacy upload must clear stale wound texture entries.

```ts
const visualOwner = cacheReady && supportedImpact ? 'cache' : 'analytic';
// Always retain the gameplay record. Suppress only its analytic VISUAL upload
// after the cache version containing this impact is ready for rendering.
// During readiness delay, render the analytic entry once, never neither/both.
```

- [ ] Route candidate projectile/aim surface sampling through the same composed CPU cache field and current transition time; preserve bone/organ union and fallback wounds. Test a second projectile through an existing hole, depth caps, bleed attachment and render/hit position agreement within Task 3's error bound. Confirm disabling restores baseline behavior from retained records/replay. Do not substitute an intact CPU field for the candidate.
- [ ] Carry damage through `DetachedPiece` -> `spawnChunkPiece` -> `ChunkGpuView`. Retain/share the relevant cache state with explicit reference counts and transform it into detached local space; release on piece/actor disposal. Test a wounded head sever, a torso-adjacent detached piece, simultaneous source/piece visibility and actor reset while a piece is alive. Removed tissue must not reappear. If transfer cannot preserve the supported damage, set lifecycle fail and stop feature work.
- [ ] Test off/on/off, first-hit loading delay, >16 impacts, consecutive pellet batches, reset, actor disposal and detached-piece disposal. Assert no duplicate visual wound, no stale cut, no growing resource count and baseline parity when off. Run `npx vitest run src/lab/sdf-zombie/zoned-wounds src/lab/sdf-zombie/webgpu/game-actor.test.ts src/lab/sdf-zombie/gib-chunks.test.ts src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts`, `npx tsc --noEmit`, then an actual WebGPU motion/sever smoke via the bench script's new `--scenario lifecycle` option.
- [ ] Save the motion/sever evidence and mark lifecycle pass/fail with specific reasons. Commit `feat(lab): preserve zoned damage through actor motion and severing`. Keep the default off regardless of outcome.

### Task 5: Tune visible head/torso playback and isolate cavity shading

**Files:**
- Create: `scripts/zoned-wound-reel.mjs`.
- Modify: `src/lab/sdf-zombie/zoned-wounds/{presets.ts,bake.ts}` and their tests only for bounded art tuning.
- Modify: `src/lab/sdf-zombie/webgpu/{march.wgsl.ts,zoned-wounds.wgsl.ts,zoned-wound-volume.ts,game-main.ts}` and relevant tests for explicit shading modes and measured upload improvements.
- Update generated assets and `docs/dev-notes/2026-09-04-zoned-baked-wounds/{gates.json,notes.md}`; save selected stills/reel contact sheets there and raw captures outside Git.

**Interfaces:**
- Consumes: all three `WoundMode` values, live diagnostic API, cache cavity AO/mask, fixture/scenario data.
- Produces: `node scripts/zoned-wound-reel.mjs --out /tmp/zoned-wound-reel` emitting labeled image frames and a JSON index with camera, mode, hit sequence, timestamps, resolution and configuration. `cached-dynamic` and `cached-cavity` use identical geometry/assets; only the explicitly documented cavity shading policy changes.

- [ ] Require numerical, memory and lifecycle pass; otherwise record visualEvidence skipped-by-gate and stop. Capture analytic and cached-dynamic with existing light/shadow first. Review full head+torso and head detail at 0/40/80/120/160/320 ms, using real playback time rather than resetting the animation for each unrelated image. Include repeated hits, upper/lower/front/side, zone boundaries, yaw, walking, flinch, exposed bone/organs and sever.
- [ ] Implement cached-cavity as a separate toggle. Keep existing normal, AO and scatter probes. Use cached cavity AO/material support and suppress dynamic wound-shadow marching only for cache-owned wounds; analytic fallback wounds retain their shadow behavior. Avoid applying both full baked darkness and old wound shadow. Add a regression fixture with one cached torso wound and one analytic arm wound to prove the latter still shadows.

```wgsl
// Policy sketch within the existing wound-shadow branch:
// cached-dynamic: trace the composed field for cached and legacy wound support.
// cached-cavity: cached support uses its cavityAO; legacy support still traces.
// Analytic mode preserves the existing branch and performs no cache fetches.
```

- [ ] Move the flashlight across the cavity and show both modes in the reel. Label cached-cavity as ambient cavity shading, not equivalent moving-light shadow. Geometry diagnostic images from both candidate modes must agree within numerical precision. Add that comparison to `zoned-wound-gpu-check.mjs` if an existing render-test seam cannot capture it.
- [ ] Tune recipe depth/lip/support and modest seeded orientation, retaining actual hit location and caps. Require visibly opening/tearing geometry with flinch, not a color fade masquerading as deformation. Sweep 64 and 96 resolution on torso and head inset. Re-bake after changes, re-run bake and GPU numerical gates, and record costs. Do not add general multi-keyframe authoring or new anatomy.
- [ ] Measure impact CPU update time, bytes uploaded, frame intervals and settled zero-upload behavior before optimizing updates. If full uploads cause a repeatable >2 ms impact-p95 regression against the paired analytic case, attempt one bounded dirty-brick GPU update implementation behind the same adapter and counter contract. Verify byte counts and CPU/GPU field parity. If unsupported or still slow, report the regression; do not introduce unmeasured asynchronous updates or suppress hits to pass. Re-run lifecycle and numerical gates after any update-path change.
- [ ] Run all `zoned-wounds` and new WebGPU tests, `npx tsc --noEmit`, the GPU check and reel CLIs. Store contact sheets with matching scales and a linkable frame index. Set visualEvidence pass only when every required case is captured without known attachment/interior/persistence errors; leave ownerLook pending. VisualEvidence pass means reviewable evidence, not owner art approval.
- [ ] Commit `feat(lab): compare authored wound playback and cavity shading`. Include the tested selected resolution and reasons; keep 64/96 selectable for final measurement and the shipping default off.

### Task 6: Measure the result and deliver a go/no-go report

**Files:**
- Modify: `scripts/zoned-wound-bench.mjs`; add `scripts/zoned-wound-bench.test.mjs` for report/gate arithmetic and label correctness.
- Create: `docs/dev-notes/2026-09-04-zoned-baked-wounds/verdict.md` and small normalized timing/coverage JSON tables.
- Update: `docs/dev-notes/2026-09-04-zoned-baked-wounds/{gates.json,notes.md}`.
- No renderer changes unless a measurement bug is found; such fixes require re-running affected evidence before drawing a conclusion.

**Interfaces:**
- Consumes: fixture/scenarios, all gate evidence, three modes and diagnostics.
- Produces: `node scripts/zoned-wound-bench.mjs --matrix --repeats 5 --out /tmp/zoned-wound-verdict` plus verdict `PASS-CANDIDATE`, `LOOK-ONLY`, `NO-GO`, or `TIMING-DEFERRED`. Report still runs after a failed prerequisite, summarizing its evidence instead of implementing skipped features.

- [ ] Read gates first. If numerical/memory/lifecycle failed or feature tasks were skipped, write a NO-GO report identifying the first failed gate, exact reproduction and bounded findings; do not run misleading incomplete candidate timing. Missing runtime/unstable hardware evidence yields TIMING-DEFERRED and an exact rerun command, not a pass.
- [ ] Add report tests with synthetic samples proving percentage and absolute gates must BOTH pass, failed correctness cannot become PASS-CANDIDATE, chunk averages are never labeled frame p95, and missing/rejected repetitions are visible. Keep report helpers exported from the CLI without running the browser when imported by Node tests.

```js
// Proposed criterion, not a promised gain:
const savingMs = analyticMedianMs - candidateMedianMs;
const savingFraction = savingMs / analyticMedianMs;
const performancePass = savingMs >= 2 && savingFraction >= 0.15
  && savingMs > pairedRepeatSpreadMs;
// Example: 20 -> 18 ms fails (10%); 10 -> 8.5 ms fails (1.5 ms).
// 24 -> 19 ms passes the numerical thresholds only if spread < 5 ms.
```

- [ ] Run `node --test scripts/zoned-wound-bench.test.mjs` to establish failure, implement report helpers, then rerun. Define paired repeat spread as max-minus-min of paired savings across accepted repetitions, and publish every repetition; do not mix individual frames with independent repeated-run estimates.
- [ ] Run the matrix at 1280x800 CSS/DPR1, fixed SDF scale 1.0, recording actual target/capped dimensions. Compare analytic/cached-dynamic/cached-cavity at 1/4/8/16 hits and the selected 64/96 quality settings. Primary acceptance is torso-heavy eight-hit settled cost; head+torso both remain in evidence. Use fresh pages, identical replay and at least five balanced interleaved repetitions. Keep an explicit shipping-default leg if any accelerator was disabled for matched comparisons.
- [ ] Separate the frozen one-actor no-blood microbenchmark from live effects-on gameplay. Capture actual normal frame intervals over impact and settled segments for p50/p95/p99/max, at least 240 measured frames per leg after warm-up. Record GPU timestamps only if reliable. Keep existing fenced chunk-mean throughput and per-frame-fenced spikes as separately named supplementary measurements. Show impact-p95 regression against the proposed +2 ms limit and report the existing <=33 ms frame-p95 objective separately.
- [ ] Record machine load at each leg and flag a repetition when load changes by >2 absolute one-minute load units between its first and last legs; publish rejected data and retry counts, capped at two retries per repetition. This is a noise-screening heuristic, not a proof of isolation. If accepted repetitions remain inconsistent or five cannot be collected, mark timing deferred. Run no competing agent/browser benchmarks during this matrix and close tabs/resources afterward.
- [ ] Publish counts and census for bodies, expected/successful hits, supported/fallback wounds, active caches, source/target samples, coverage and removed area. Report allocated CPU/GPU bytes, per-impact upload bytes/update CPU time and settled upload count. Differences in damage extent remain visible in the table; fewer visible pixels or skipped impacts cannot be claimed as a field-evaluation win.
- [ ] Write a compact verdict explaining visual changes, bottleneck before/after, peak versus settled cost, per-actor memory and crowd implications. PASS-CANDIDATE requires correctness, repeatable performance and complete visual evidence but explicitly awaits ownerLook. LOOK-ONLY requires an otherwise correct, visually reviewable result that misses the performance criterion; NO-GO covers correctness or unacceptable lifecycle/update regressions. TIMING-DEFERRED names the missing measurement. All keep the default OFF; report user look feedback separately when available.
- [ ] Run `node --test scripts/zoned-wound-bench.test.mjs`, `npx tsc --noEmit`, and `npm test` once after final code changes. Record pre-existing failures distinctly. Save a human-readable Obsidian summary under `Codex Notes/Research/`, linking plan/spec/reel/verdict, and a DualMem investigation with all relevant file associations. Commit `docs(lab): report zoned wound visual and performance verdict`. Do not merge, enable by default or start a follow-up implementation.

## Dispatch handoff

Six queued tasks, sequential dependency chain: `1 -> 2 -> 3 -> 4 -> 5 -> 6`. Each task branches from its predecessor's branch so earlier contracts and code travel forward. Task 1 starts from current main. Prepare all tasks with `status: queued`; none should become pending/running during plan preparation. Prerequisite failures produce a committed gate record so Task 6 can explain the negative result. Review/merge remains a later explicit action.

## Plan review record

Self-review mapping: spec 1/9 -> Tasks 1/6; 2/3 -> Tasks 1/2/5; 4/5 -> Tasks 2/3/4; 6 -> Tasks 2/5; 7 -> Tasks 3/5; 8 -> Task 4; 10/11 -> global constraints, gate protocol and dispatch handoff. Shared interfaces are defined above and consumed with the same names. Performance thresholds and the +2 ms impact regression criterion are proposed experiment decisions, not measured outcomes or user-approved appearance.
