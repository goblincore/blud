# Offline gib assets — Task 4: closing the two blockers

Branch `codex/offline-gib-assets-task-4`, tip `35e81c41` (baseline `30e66c84`,
parent `10d7a5ff`; Task 3's substantive commit is `f2c67c84`). Isolated dispatch
worktree; **no merge, no push, primary checkout untouched.**

Task 3 shipped a working asset path but left **two measured blockers** that kept
the shipped default at `?gibrender=march`. This task closes both, re-runs the
gate on the regenerated sets, and records where parity now stands.

**Bottom line.** Both blockers are fixed and verified:

1. **The committed sets now carry a real wet/cut mask.** `bakeColor.a` was `0` on
   100% of vertices; it is now derived from the planner's actual `sub` cut caps
   via the same "depth beneath the original skin" contract the carve path uses.
   Every cut-face vertex is fully wet (`wm > 0.5`), the outer skin stays dry, and
   the matched A/B pixel difference **fell on every body leg**.
2. **The moving asset head now wears the actor's face.** A per-instance face
   material (own uniforms, own frame) follows the head through pose, slough,
   flight, squash and settle; the `head-face` fallback is gone from ordinary
   blasts (counted `0` where it was `1`/body), while damaged/custom heads still
   fall back. A face-on orbit capture shows the eyes/nose/mouth on the asset
   head, not a bare-flesh blob.

The shipped default **still stays `?gibrender=march`**. The reason is no longer
an open blocker but a judgement call recorded in
[Default decision](#default-decision--remaining-evidence-gap): the cut-aware mask
is a real close-range material change (asset cut faces read wet and dark where
the marched planner caps read pale skin), the asset head's mid-flight exterior
carries the mesh material's blood decals unattenuated by face coverage, and no
owner has looked at either. Everything the automated gate can decide passes.

---

## What this delivers

| File | Role |
| --- | --- |
| `src/lab/sdf-zombie/chunk-bake-field.ts` | **New shared `cutAwareField`/`cutLook`/`CUT_BAND`** — the "the cut is the wound" contract, generalised so `depthAt` can be the carve's body field OR the asset's pre-cap field. |
| `src/lab/sdf-zombie/webgpu/chunk-bake-geometry.ts` | Optional `ChunkBakeData.cutMask`: derives the mask from the piece's additive prims with the `sub` caps removed. The runtime settle bake passes none and is unchanged. |
| `src/lab/sdf-zombie/webgpu/gib-asset-build.ts` | Passes `cutMask` for capped pieces, uses `cutLook` (no cavities on a cap cut), and **fails the build** if a capped piece bakes an empty mask. |
| `src/lab/sdf-zombie/webgpu/gib-asset.ts` | `GIB_ASSET_SCHEMA_VERSION = 2`, `GIB_ASSET_CUT_MASK`, `cutMask` in the recipe fingerprint and the doc's `bake` block. |
| `public/assets/lab/gibs/*` | Regenerated zombie + soldier sets, deterministic, same vert/tri counts as Task 1. |
| `src/lab/sdf-zombie/webgpu/gib-asset-head.ts` (+ `.test.ts`) | **New**: the chunk→world head frame and the per-instance face-material registry (idempotent release, no shared mutable uniforms). |
| `src/lab/sdf-zombie/webgpu/baked-chunks.ts` | `BakedChunkMaterial.faceUniforms` — a read/update handle for a MOVING face-carrying mesh. |
| `src/lab/sdf-zombie/webgpu/gib-asset-runtime.ts` | Head registry ownership, `acquireHead`, `headMaterials`/`headFaceAvailable` counters, `gibAssetMeshEligible(doc, gib, faceSupported)`. |
| `src/lab/sdf-zombie/webgpu/gib-sprite-pieces.ts` | `SpritePiece.onPose` (re-project after every re-pose) and `quat` in `spritePieceStates`. |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | Head material factory, per-head spawn/frame/dispose, face support check, `quat` in `chunkStates`. |
| `scripts/sdf-gib-assets-head.mjs` | Orbit + face-bearing diagnostics; asset arm settles without waiting for a bake it never performs. |
| `docs/dev-notes/2026-09-16-offline-gib-assets/captures/` | Updated A/B sheets, cut-face close-ups, head orbit/face sheets, `gate-summary.json`. |

## Blocker 1 — CLOSED: the committed sets carry a wet cut mask

**The defect (Task 3).** `bakeChunkGeometry` was called with `torn: []`, so
`woundMask` was identically zero and `bakeColor.a == 0` on **100% of vertices**.
Every cut face rendered as dry outer skin while the marched pieces read as torn
meat.

**The mechanism (not an alpha fill).** A planner piece's cut is a capped PLANE:
`g.prims` is the additive flesh plus one `sub` cap per cut. Because the cap lives
in the SAME `flesh` array, `ev.preWound` is *already zero on the capped face* —
so the carve path's trick (`woundMask = depth beneath the original skin`) cannot
be read from `ev` directly. The builder therefore hands `bakeChunkGeometry` a
`cutMask.flesh` = the piece's additive prims **with the `sub` caps removed**.
`chunkBakeGeometry` builds a second field from those and wraps the bake's field
with `cutAwareField(ev, look, preCap.preWound)`: the wound mask and the tissue
depth both come from how deep the cut fell below the pre-cut surface. On the
outer skin that depth is `~0` (dry); on a cut face it is however deep the cap
carved (wet). `cutLook` zeroes `visceraAmp` because a cap cut is not a cavity,
so the ramp saturates at the clot knee — the same treatment the carved library
already ships.

The `cutAwareField`/`cutLook`/`CUT_BAND` helpers moved from `gib-carve.ts` to
`chunk-bake-field.ts` and are shared by both paths; `gib-carve.ts` re-exports
them, and its suite is unchanged (7 tests, same thresholds).

**Versioning / fingerprint / determinism.**

- `GIB_ASSET_SCHEMA_VERSION` 1 → 2 and a `cutMask: 'planner-cut-v1'` recipe
  field, so an old (dry) set is rejected as `schema`/`stale`, never served.
- A unit test pins that changing `cutMask` changes the recipe fingerprint.
- `npm run gib:assets -- --force` twice produces **byte-identical** `.gib.bin`
  files (`cmp` clean), and `npm run gib:assets:check` reports
  `all assets valid and current`. No timestamps are in the content fingerprint.
- The geometry is unchanged by the fix: zombie 37,738 verts / 75,552 tris /
  3,925,208 bin bytes; soldier 42,918 / 85,820 / 4,463,376 — the same totals as
  Task 1. Only `bakeColor.a` (and the ramped albedo on cut faces) changed.
- No extracted Blood pixels are embedded: the bin carries procedural channels
  only and the head face texture stays an external reference.

**Regression test** (`gib-asset-runtime.test.ts`, on the COMMITTED files): a
vertex is classified "at a cut" when it sits on a stored `sub` cap's own iso
(`|sdPrimitive(cap)| < 2 mm`) and "outer skin" when it is clear of every cap
(> 3 cm). Measured against the regenerated bins:

| | zombie | soldier |
| --- | ---: | ---: |
| cut-face vertices, mask > 0.5 | 2286 / 2286 (**100%**) | 2722 / 2722 (**100%**) |
| outer-skin vertices, mask < 0.3 | 19043 / 19948 (**95.4%**) | 25337 / 26078 (**97.2%**) |
| max mask (was 0.0) | 1.00 | 1.00 |

That is the blocker's exact shape — meaningful nonzero mask at cuts, lower away
from them — asserted on the committed sets, so removing the `cutMask` wiring
fails the test.

**Effect on parity.** The matched A/B mean `%px>12` between the marched and
asset arms, Task 3 (dry mask) → Task 4 (wet mask):

| leg | Task 3 | Task 4 |
| --- | ---: | ---: |
| `zombie-ab` | 2.854 | **1.209** |
| `soldier-ab` | 6.773 | **4.905** |
| `multi-ab` | 2.480 | **1.723** |
| `anatomy-ab` | 12.897 | **9.480** |
| `wounds-ab` | 13.316 | **8.087** |
| `deferred-ab` | 0.629 | **0.107** |

Every body leg moved closer. The remaining difference is concentrated at the cut
faces and is discussed under the default decision.

## Blocker 2 — CLOSED: moving asset heads project the face

**The defect (Task 3).** The face layer projects from world-space
`headCentre`/`headQuat`/`headAxes`. The marched chunk path re-uploads those from
the posed primitives every frame; the shared asset material had one frozen copy,
so the mesh head drew as bare flesh and was excluded with the counted
`head-face` fallback.

**The mechanism.** `gib-asset-head.ts` adds:

- `gibAssetHeadFrame(state, local)` — the world frame from the chunk's own
  transform, mirroring `ChunkGpuView.apply` line for line: centre via
  `chunkPoint` (rotate, world-axis squash, translate), quaternion
  `qMul(state.quat, restQuat)`, semi-axes scaled by the same squash.
- `GibAssetHeadRegistry` — one NEW face material per head spawn, with its own
  uniform set. `release()` is idempotent and registered, so a reset that disposes
  the registry and a later piece eviction cannot double-free; `dispose()` is
  safe while pieces still hold a reference.

`game-main.ts` builds the per-instance material from the ACTOR's live
`MarchUniforms` (so the frame is the POSED/sloughed one at release, exactly the
snapshot `spawnChunkPiece` takes), seeds it with the shared asset material's
gore uniforms, and registers it for the per-frame flashlight update. The local
head offset is `actorHeadCentre − g.origin` (the chunk pivot);
`SpritePiece.onPose` re-projects it after every re-pose, so the face rides
flight, squash, settle and reset. On detach the resource is released at the SAME
single point that already returns the pooled geometry.

`gibAssetMeshEligible(doc, gib, faceSupported)` now excludes the head **only**
when no face source is available (no factory, `faceCfg.x <= 0.5`, or no face
texture). A damaged/severed head still fails the source check and keeps the
marched path, so custom bodies and lost damage are never silently replaced.

**Counters (matched gate, `finalStats`).**

| leg | asset pieces | fallbacks | live head materials | runtime extraction jobs |
| --- | ---: | --- | ---: | ---: |
| `zombie-march` | 0 | `{}` | 0 | 0 |
| `zombie-assets` | **14** | `{}` | **1** | **0** |
| `soldier-march` | 0 | `{}` | 0 | 0 |
| `soldier-assets` | **13** | `{}` | **1** | **0** |
| `multi-march` | 0 | `{}` | 0 | 0 |
| `multi-assets` | **56** | `{}` | **4** | **0** |
| `wounds-assets` | 14 | `{}` | 1 | 0 |
| `tight-assets` | 52 | `{}` | 1 (4 created / 3 disposed) | 0 |
| `deferred-assets` | 14 | `{}` | 1 | 0 |

`fallbacks: {}` on every asset leg is the direct proof the `head-face` exclusion
is gone: Task 3 reported `1` per body (`4` on the 3-body leg). The `tight-assets`
row shows the pool and the head registry both recycling
(`poolCreated 52 / poolFree 43 / liveMeshes 9`).

**Native vision.** `captures/head-face-ab.jpg` photographs the settled head along
its own local ±Z axis in both arms (the rig now reads `chunkStates().quat`, and
`head-orbit-zoom-ab.jpg` shows eight bearings). The asset head shows the same
eye sockets / nose / mouth as the marched bake — a face, not a bare-flesh blob —
and `pageErrors` is 0. `head-settle-ab.jpg` is the settled follow shot,
`head-flight-ab.jpg` the rupture→flight row.

**Motion / reset / disposal / ownership tests** (`gib-asset-head.test.ts`,
9 tests + `gib-asset-runtime.test.ts` additions): the frame matches an
independent THREE quaternion/scale composition; it tracks a real `stepChunk`
motion; two acquires get distinct materials and frames; locals are snapshotted;
`release` is idempotent; a registry `dispose` disposes exactly once and a late
release is a no-op; no factory means `acquire → null` (fallback intact); a real
`createBakedChunkMaterial({face})` exposes a private frame handle and does NOT
dispose the borrowed face texture.

## Visual gate — matched A/B, re-run on the frozen source

All body legs boot `/sdf-game.html?room=<id>&frozen=1&seed=7&vhs=off` with the
same camera bearing, detonation point and frame count; only `gibrender` differs.
Soldier legs run in the annex (`GA_ROOM=5 GA_DIST=3`); everything else in the
arena (`GA_ROOM=6 GA_DIST=4`). `zombie-march-aa` is the A/A noise floor.

| Leg | kind | frames | mean %px>12 | max %px>12 | mean abs/255 |
| --- | --- | ---: | ---: | ---: | ---: |
| `zombie-aa` (A/A) | zombie | 92 | **0.036** | 0.129 | 0.289 |
| `zombie-ab` | zombie | 92 | 1.209 | 2.228 | 0.572 |
| `soldier-ab` | soldier | 92 | 4.905 | 17.151 | 2.398 |
| `multi-ab` (3 bodies) | zombie | 92 | 1.723 | 3.106 | 0.711 |
| `wounds-ab` (4 craters) | zombie | 82 | 8.087 | 100 | 5.456 |
| `anatomy-ab` (VFX killed) | zombie | 61 | 9.480 | 100 | 6.564 |
| `deferred-ab` | zombie | 62 | 0.107 | 0.503 | 0.027 |
| `head-ab` (close follow + orbit) | zombie head | 20 | 27.35 | 47.678 | 9.338 |

The single-frame 100% peaks are the release frame landing one sub-step
differently between representations; the mean is the readable number. `head-ab`
is high by construction: the asset arm's head is now a mesh where Task 3 marched
it in both arms.

**Simulation parity is exact** (same seed, same drive). Every settle census is
identical between arms and `airborne` is 0 everywhere (asserted: the `lowY`
arrays are `===`):

| Leg | pieces | sprite assets | settle | lowest y (m) |
| --- | ---: | ---: | --- | --- |
| `zombie-march` / `zombie-assets` | 14 | 0 / **14** | 14/14 | −0.036, −0.012, 0.001, 0.022, … (**same**) |
| `soldier-march` / `soldier-assets` | 13 | 0 / **13** | 13/13 | −0.009, −0.002, −0.001, 0.015, … (**same**) |
| `multi-march` / `multi-assets` | 56 | 0 / **56** | 56/56 | −0.036, −0.012, 0.001, 0.019, … (**same**) |

**Native-vision observations** (sheets in `captures/`):

- `anatomy-ab.jpg` / `cutfaces-close-ab.jpg` — from rupture to settled pile both
  arms carry the same silhouette and separation order with no spike triangles and
  no rest-pose snap. The asset cut faces now read as wet, dark torn meat; the
  marched planner caps read as pale skin (see the default decision).
- `zombie-ab.jpg` / `soldier-ab.jpg` — real fireballs + default post; the two
  arms track through flight and settle. The soldier keeps its retired armour off.
- `multi-ab.jpg` — three simultaneous bodies, 56 pieces, both arms settle to the
  floor with identical heights and nothing stuck airborne.
- `wounds-ab.jpg` — four stamped slug craters still lose nothing on the mesh
  path; all pieces are eligible with no fallback.
- `head-flight-ab.jpg`, `head-settle-ab.jpg`, `head-orbit-zoom-ab.jpg`,
  `head-face-ab.jpg` — the head is a textured head in both arms through flight
  and at rest; the face-on bearings show the face.
- `tight-budget.jpg` (`?gibspritelive=24&gibspriterest=8`) — the cap is honoured
  and pieces return to the pool and the head registry.
- `cutfaces-ab.jpg` is retained as the **Task-3 before** state (dry mask).

## Performance

One Chrome at a time, own profile, ports 5297/9297. The machine is
**vsync-limited at ~16.7 ms**, so no moving-gib cadence win is claimed.

| | value |
| --- | --- |
| committed bytes | **8,388,584 B** bin (zombie 3,925,208 + soldier 4,463,376) + 262,412 B json = **8,650,996 B** both archetypes |
| `resetGibAssets()` + `preloadGibAssets()` | **cold 185.1 ms**, **warm 33.9 ms** (HTTP re-fetch + decode + attribute wrap; spread is IO/GC) |
| library `builtMs` (decode + wrap) | zombie **2.1 ms**, soldier **2.4 ms** |
| explosion detonate wall | march 9.5 / 9.9 / 1.9 ms · march A/A 8.4 / 6.5 / 2.5 ms · **assets 8.7 / 6.8 / 2.4 ms** |
| asset pieces carried per explosion | march 0 · **assets 14 / 28 / 14** |
| moving-gib rAF median (pieces shown/hidden) | march 16.7 / 16.7 · march A/A 16.7 / 16.7 · **assets 16.7 / 16.7 ms** |
| `runtimeExtractionJobs`, `totalBakes` (20-frame window) | **0** / 0 in every arm |

There is no new startup mesh-generation delay: the loader is fetch + decode, and
no `bakeChunkGeometry` runs on this path. The Task-3 perf caveats stand (the
pass-row method's noise floor is larger than the piece cost at these counts; the
loader numbers are reset-and-reload on a warm page).

## Default decision — remaining evidence gap

**The shipped default stays `?gibrender=march`.** The plan's condition is
"ordinary zombie/soldier visually pass **and no material regression**". The
blockers are closed and every automated leg passes, but two things are real
close-range material changes with no owner look:

1. **Cut-face treatment.** The mask is now doing exactly what the plan asked, and
   the A/B diff fell on every body leg — but the asset cut faces read wet and
   dark where the marched planner caps still read pale skin, because the MARCH
   path gives a planner cap no wound mask. Flipping the default would therefore
   lighten every ordinary gib relative to today's march look; the two paths do
   not yet present the same material at close range.
2. **Mid-flight head gore.** The mesh face material's procedural blood/burn layer
   runs before the face layer and is not attenuated by face coverage, and the
   asset head wears that material from spawn (a settled/baked marched head wears
   it only after settle). The face itself is correct; the exterior reads bloodier
   during flight than the marched head's. Fixing that means re-ordering the
   accepted baked-chunk shader, which is a separate, owner-visible change.

Neither is a defect in the two fixes; both are reasons a default flip should wait
for an owner look or a tuned parity pass. Everything else the plan asked the gate
to check passes: no rest-pose snap, no faceless head, no revived/floating armour,
no stuck airborne chunk, matched settled floor contact, and the pool/reset
contract holds.

## Limitations / honest scope

- No owner look pass; this is an automated native-vision gate on one machine.
- The deferred leg is a smoke leg (`?renderer=deferred`, 0.107% mean), not a
  deferred-parity claim.
- Soldiers only exist in rooms 1 and 5; the soldier legs ran in the annex.
- The A/A noise floor (0.036% mean for frozen, hand-stepped frames) does not
  cover frame timing under load, and other Chrome sessions were open.
- The head's face close-ups are at 0.85 m with the default flashlight; the face
  is legible but a dedicated face close-up at owner framing was not taken.
- Baseline perf/memory caveats are unchanged: offline meshes remove extraction,
  not every renderer cost.
- Body captures were produced by the same frozen source as the head; the only
  later source edit was an additive `quat` field in `chunkStates()`, which no
  renderer path reads.

## Verification (this branch, this worktree, Node 22)

- `npx tsc --noEmit` — clean.
- `npm run build` (tsc + vite) — clean.
- Focused suites — `gib-asset`, `gib-asset-runtime`, `gib-asset-integration`,
  `gib-asset-head`, `gib-sprite-pieces`, `chunk-bake-field`, `baked-chunks`:
  **87 tests pass**; `gib-carve` **7 pass** on the shared helper refactor.
- Full `vitest run` on the committed source — **341 files, 5352 tests, all
  passing**.
- `npm run gib:assets -- --force` twice → byte-identical bins; `npm run
  gib:assets:check` → all valid and current.
- Full GPU gate — `LAB_VITE_PORT=5297 LAB_CDP_PORT=9297 LAB_TMP=.lab-tmp
  scripts/gib-assets-gate.sh .lab-tmp/gate4 all`, exit 0, no failed legs.
  Compact record: `captures/gate-summary.json`.
- Shared-resource safety: own vite + Chrome (`--headless=new
  --enable-unsafe-webgpu`, own `--user-data-dir`); no user server or browser was
  killed; no unsafe flags, no watchdog/sandbox bypass.

## Prove it

```bash
npm run gib:assets:check                                   # stale/repro check
scripts/gib-assets-gate.sh .lab-tmp/gate core              # zombie+soldier A/B
scripts/gib-assets-gate.sh .lab-tmp/gate head              # head bake/asset + orbit
scripts/gib-assets-gate.sh .lab-tmp/gate multi             # simultaneous bodies
```
