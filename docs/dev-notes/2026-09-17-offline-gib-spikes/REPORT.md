# Offline gib spikes — metre-scale poles on animated gibs (2026-09-17)

Worktree `2026-09-17-offline-gib-spikes`, branch `codex/offline-gib-spikes`.
Base `ea699255`; substantive tip `9b1d05d0` (not pushed, not merged). Node 22.

## Verdict

Fixed. The owner's metre-scale red/black poles were the **`sub` cut caps being
used as skinning targets**. The bind table is now additive-only
(`GIB_ASSET_BIND_MASK = 'additive-v1'`, schema 3), `primTransformPoint` rotates
the radial offset with the rest→posed segment axis, and the renderer refuses to
display a deformed piece that leaves the runtime additive geometry (counted
marched fallback, pooled buffers released exactly once).

Default stays `?gibrender=march` pending an owner look and the GPU/visual gate
(see "Not done").

## Owner report

Owner playtested `ea699255` at
`/sdf-game.html?room=arena&seed=7&gibrender=assets`, live moving enemies and
repeated dynamite: long red/black metre-scale poles attached to gibs in flight
AND settled, in arena and room1. Screenshots (`9.06.35 PM`, `9.06.45 PM`) show a
striped rod leaving a floor gib through the crate, and several rods airborne.
This supersedes the Task-3 "no spike triangles" visual-gate claim, which was
taken from frozen fixtures, one seed, pieces spawned at rest, and limited
positions.

## Root cause (evidence, not pixels)

The planner seals each cut with a `sub` cap: a **point sphere** (`a === b`)
whose centre is `GIB_CUT.radiusK` (12×) piece extents *behind* the cut plane,
so its radius is ~3-5 m and its surface passes exactly through the cut face.
The bake bound every vertex to its 4 nearest prims **by surface distance**, so
the cut-face vertices measured `|sd(cap)| ≈ 0` and were bound 255/255 to the
cap.

`primTransformPoint` maps `q` by projecting onto the rest segment, carrying the
offset from that base to the posed base and scaling by the radius ratio. A
point cap has no axis, so the radial (~3.2 m, mostly perpendicular to the
rotation axis for an arm swing) could not be rotated with the body. The error
is `(I − R)·radial`: **zero for a pure translation, metres under the animated
skeleton's joint rotation**. The frozen gate translated/posed too little to
show it; live walking + yaw + arm swing exposed it on every piece.

Reproduced on the CPU with a real walk cycle (`facing-chain` driver), both
archetypes, both hand-off paths, against the pre-fix committed assets:

| measurement (worst vertex) | zombie | soldier |
| --- | ---: | ---: |
| PRE-FIX v2 assets, caps bound: distance outside runtime additive union | **4.279 m** (`armR.upper`) | **5.189 m** (`armR.upper`) |
| PRE-FIX pieces over the 0.25 m gate (would fall back) | 4 / 24 | 5 / 19 |
| POST-FIX v3 assets | **0.036 m** (`organ.gut`) | **0.030 m** (`torso.pelvis`) |
| POST-FIX pieces over the gate | 0 | 0 |

Before/after was measured with two temporary probes (removed after the run):
one read the pre-fix v2 assets out of `HEAD` into `/tmp/oldgibs` and ran the
pre-fix row-aligned deform (sub caps bound, no radial rotation); the other ran
the shipped helpers over four walk poses × both hand-off paths × both
archetypes. The committed regression test
(`gib-asset-deform-regression.test.ts`) is the reproducible guard.

Secondary hypothesis checked: rotation-aware `primTransformPoint` alone did
**not** fix the poles (a degenerate cap has no axis): worst local radius stayed
4.48 m / 5.39 m. Additive-only rebinding alone fixed it (0.28-0.67 m). Both
together are the shipped fix.

## Changes

- `webgpu/gib-asset.ts` — schema **3**; `GIB_ASSET_BIND_MASK = 'additive-v1'`
  rides the recipe/fingerprint; `primTransformPoint` rotates the radial by
  `qFromTo(rest axis, posed axis)` (identity at rest, so rest poses are
  bit-identical); `GibAssetRecipe.bindMask`.
- `webgpu/gib-asset-build.ts` — bind candidates are `op !== 'sub'` only; the
  extraction-field/error ground truth still uses the FULL carved prim list, so
  the recorded `vertexFieldError*`/`deformedFieldError*` stay meaningful.
- `webgpu/gib-asset-archetypes.ts` — recipe carries `bindMask`.
- `webgpu/gib-asset-deform.ts` — `gibAssetRowsFromPrims` skips `sub` rows (stays
  row-aligned with the new table); new `checkGibAssetDeformBounds` /
  `gibAssetDeformBoundsOk` / `measureGibAssetOutside`. The gate is cheap-first:
  it always checks `maxLocalRadius <= chunkExtent(runtime additive prims, pivot)`
  + slop (measured correct slack ≤ 0; the poles were 4.5 m against a ~0.4 m
  reach) and `maxEdge <= max(12×restMaxEdge, 0.5 m)`, and only pays for the
  exact `sdPrimitive` field sweep when those fail. Thresholds `MAX_OUTSIDE =
  0.25 m`, `LOCAL_SLOP = 0.05 m`, `EDGE_SLACK = 12`, `EDGE_MIN = 0.5 m`.
- `webgpu/gib-asset-runtime.ts` — `gibAssetRowsMatch`: row-for-row semantic
  check (flesh rows vs `g.prims` minus caps, bone rows vs `g.bones`), folded
  into `gibAssetMeshEligible`.
- `webgpu/game-main.ts` — `spawnAssetGibPiece` drops the count-only check
  (eligibility is now semantic), and after `deformRows` runs the bounds gate:
  invalid → `pool.release(inst)` once → `countFallback('deform-bounds' |
  'deform-nonfinite')` → marched fallback. No clamping, no blanket disable.
- `public/assets/lab/gibs/*` — regenerated at schema 3. Geometry unchanged
  (zombie 37,738 v / 75,552 tris / 3,925,208 B; soldier 42,918 v / 85,820 tris /
  4,463,376 B); only the bind table changed (zombie 103→91 rows, soldier 73→61;
  0 `sub`, 0 unsourced; max row radius 4.23 m → 0.15 m).

## Verification (CPU, this worktree)

- `npx tsc --noEmit` — clean.
- Full `npx vitest run` — **342 files / 5,358 tests pass** (was 341 / 5,352;
  the new file adds 6). `npm run build` (tsc + vite) — exit 0, built in 3.9 s.
- Focused suites — `gib-asset`, `gib-asset-runtime`, `gib-asset-integration`,
  `gib-asset-head`, `gib-asset-deform-regression`, `gib-sprite-pieces`,
  `gib-parts`, `gib-rupture`: **105 pass** (re-run after the last test edit:
  29 pass).
- `npm run gib:assets -- --force` twice: `.gib.bin` and `.gib.json`
  byte-identical (manifest identical modulo the timing diagnostic);
  `npm run gib:assets:check` reports both archetypes current. The recorded
  approximation stays meaningful after the recipe change (the field ground truth
  still uses the FULL carved prim list, and the synthetic motion now uses one
  angle per prim across reconstruction and ground truth):
  `vertexFieldErrorMax` 0.0071 m zombie / 0.0063 m soldier,
  `deformedFieldErrorMax` 0.0090 / 0.0097 m — all under one 12 mm cell.
- Shipped-helper stats, 4 walk poses × 2 paths × zombie+soldier: 344
  piece-spawns, **100% eligible, 0 fallbacks**; exact additive-field error
  (`measureGibAssetOutside`) ≤ 0.036 m zombie / 0.030 m soldier; worst local
  radius ratio 1.68; pool created = live (24 zombie / 19 soldier) after release.
- Display-gate cost after the cheap-first pass: **0.44 ms per zombie body (24
  pieces) / 0.50 ms per soldier body (19)** on top of 7.0/7.4 ms of deform — a
  ~150× cut from the first (always-exact) implementation at 74 ms, so no
  blast-time stall. The exact sweep runs only for a piece that already fails a
  cheap bound.
- Regression test recreates the failing input: two walk-cycle phases (different
  arm/leg swing), each on a rotated + translated body away from the origin, both
  archetypes, immediate and rupture hand-off, every piece audited for exact
  additive-field bounds, edges and unit normals.
- Flight/floor contact is unchanged by construction: `spawnAssetGibPiece`
  builds its `Chunk` with the same `makeChunk` radius/long-axis/support recipe
  as `spawnChunkPiece`, and `chunkExtent`/`chunkSupportSpheres` already skip
  `sub` — the bind change never touches physics inputs.

## Not done (blocked)

- **No GPU/browser work.** The task requires a `GPU-APPROVED` note in the plan
  before any browser/GPU session; no plan doc with that note exists in this
  worktree, so no Chrome was launched and no native-vision capture was taken.
  CPU statistics and the mechanism are proven; the normal-speed native-vision
  sheet across repeated explosions/rooms on a moving/damaged actor is still
  outstanding. Default remains `march`.
- No hardware performance claim; no live playtest.
- Partial-damage/severance live coverage: a wounded/severed body changes
  `srcPrims`, which eligibility rejects as `source-mismatch` (marched fallback)
  by design; the CPU regression covers undamaged moving bodies and the tight
  budget plan. A live wounded-body visual pass still needs the GPU session.
