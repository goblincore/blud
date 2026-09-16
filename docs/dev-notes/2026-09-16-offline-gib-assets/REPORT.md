# Offline gib assets — Task 3: visual and performance gate

Branch `codex/offline-gib-assets-task-3`, baseline `30e66c84`, parents
`a08c8f43` (Task 1) and `1d3d45c3` (Task 2). Isolated dispatch worktree; **no
merge, no push, primary checkout untouched.**

Task 3 owns the GPU/visual gate and the performance numbers Tasks 1–2 explicitly
did not produce. This report records what was measured, what was fixed because
it failed, and the two precise blockers that keep the asset path **opt-in**.

**Bottom line:** the ordinary zombie and soldier body gibs pass the automated
visual gate (matched silhouette through rupture→flight, floor contact, no
rest-pose snap, no stuck airborne pieces, no faceless head, no revived armour)
after fixing one real defect that made the whole path unusable. The shipped
default stays `?gibrender=march` because two material gaps remain, both named in
[Default decision](#default-decision--exact-blockers).

---

## What this delivers

| File | Role |
| --- | --- |
| `scripts/sdf-gib-assets-look.mjs` | Visual/telemetry capture rig: one boot = one arm, matched `?seed=`, camera bearing (occluder-aware), detonation point and frame count. A/B is `?gibrender=march` vs `assets`. |
| `scripts/sdf-gib-assets-head.mjs` | Detached-head follow rig, renderer-agnostic (`chunkStates()` covers live chunks *and* sprite pieces). Follows the head through flight and bake. |
| `scripts/sdf-gib-assets-perf.mjs` | Loader / explosion / moving-gib frame cost probe (paired shown-vs-hidden rAF bursts + GPU pass rows). |
| `scripts/gib-assets-gate.sh` | Owns vite + Chrome via `scripts/lab-servers.sh`; runs every leg; records a failed leg instead of aborting. |
| `scripts/gib-assets-diff.mjs` | Matched-frame pixel diff (per-frame %pixels >12 levels, mean, max). |
| `scripts/gib-assets-sheet.py` | A/B contact sheets (rows = frames, columns = arms). |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | **Evidence-driven fix**: the rupture-path deform source (see below), plus the `gibAssetMeshEligible` call. |
| `src/lab/sdf-zombie/webgpu/gib-asset-runtime.ts` | `gibAssetMeshEligible` + the `head-face` reason. |
| `src/lab/sdf-zombie/webgpu/gib-asset-integration.test.ts` | The CPU regression test for the cap-row spike and for the head exclusion. |
| `docs/dev-notes/2026-09-16-offline-gib-assets/captures/` | Compact evidence: 8 A/B sheets, 8 diff JSONs, `gate-summary.json`. |

## Exact usage

```bash
# Build once (Node 22).
npm ci
npm run build

# Full automated gate from an isolated worktree (owns vite + Chrome).
LAB_VITE_PORT=5297 LAB_CDP_PORT=9297 LAB_TMP=.lab-tmp \
  scripts/gib-assets-gate.sh .lab-tmp/gate all
#   groups: core | wound | multi | budget | reset | deferred | head | perf | all

# A/B in the running game (default is still march; assets are opt-in):
open '/sdf-game.html?gibrender=assets'            # arm at boot, throw dynamite
open '/sdf-game.html?gibrender=march'             # control
# live, no reload:
__sdfGame.setGibRenderMode('assets')              # awaits the load; returns ready
__sdfGame.gibRenderMode()                         # mode/ready/assets{armed,zombie,soldier}
__sdfGame.gibAssetStats()                         # hits, fallbacks by reason, bytes, live meshes
__sdfGame.gibAssetLibrary()                       # per-archetype state/fingerprint/bytes
__sdfGame.resetGibAssets()                        # cancel loads, drop caches + pooled pieces
__sdfGame.preloadGibAssets()                      # arm without switching mode
__sdfGame.chunkStats().gibAssets                  # same census inside chunk stats
```

Relevant existing knobs: `?gib=parts|clusters|pieces`, `?gibbones=all|core|off`,
`?gibtear`, `?tearslough`, `?giblaunch`, `?gibstagger`, `?gibspritelive`,
`?gibspriterest`, `?maxchunks`, `?renderer=deferred`, `?room=<id>`, `?seed=`.

## Environment and coordination

- **Playtest pause respected.** Before any GPU work the listening servers were
  identified by `lsof`/`cwd`: `5391` (`dynamite-weapon-slot`), `5392`
  (`playtest-followups-review`), `5393` (`soldier-gib-equipment`), `5415`
  (`rupture-live-review`). None had an established browser connection; the gate
  used its own pair **5297/9297** and its own `--user-data-dir`. **No user server
  or browser was killed**, and `lab-servers.sh` only ever stops what it started.
- **One GPU run at a time.** Every leg ran inside a single `lab-servers`
  lifecycle; no other Chrome/GPU run was started from this worktree.
- Headless Chrome with `--enable-unsafe-webgpu`; screenshots via
  `presentedShot()` (canvas `toDataURL`), never `Page.captureScreenshot`.
- During the first `core` run a source edit was made while the page was live;
  Vite HMR reloaded the page and invalidated an A/A leg. The run was discarded
  and re-run from frozen source. Recorded here because it is the failure mode
  that made one earlier measurement meaningless.

## Evidence-driven fix: cut-cap rows stayed at the rest pose

**Symptom (native vision, first assets capture).** Every released asset piece
trailed metre-long thin spike triangles. The march arm did not. Second control
`?gibrender=assets&gibtear=0` (the row-aligned immediate path) was clean; the
`?gibrender=assets&tearslough=0` arm still spiked, which ruled out the slough.

**Root cause.** `spawnAssetGibPiece` deformed the mesh with
`gibAssetPosedRows(piece.doc, frame.deformedPrims, frame.deformedBones)` — a
per-source-index map into the whole-body slough. That is equivalent for **sourced**
rows, but the bind table also carries **unsourced `sub` cut-cap rows**, and
`frame.deformedPrims` has no entry for them. `deformBoundVertex` then fell back to
the row's REST frame, so those vertices were placed at
`restBodyPoint − runtimeCleanOrigin`. The asset was baked against the REST body,
while the runtime plan is built on the POSED body, so those two origins differ by
the body pose; every cap-bound vertex inherited that whole offset, which the
region rotation then swung out as a spike. Measured on the committed zombie set:
**2,540 of 37,738 vertices (6.7%) have their top-weight row on an unsourced cap**
(torso.abdomen 34%, torso.chest 12%, torso.pelvis 17%).

**Fix.** Deform against the runtime piece's own row-aligned frames —
`gibAssetRowsFromPrims([...g.prims, ...g.bones])` with `g.origin` as pivot. On the
rupture path `g.prims` are `retargetGibPieces`' output (sourced rows = the slough
twins) plus the posed caps, and `displaceGibPieces` has already added the region
offset to both the rows and `g.origin`, so subtracting `g.origin` cancels it. For
a cap the runtime frame is the POSED cap, which is the same geometry
`spawnChunkPiece` marches — one contract for every row. `gibAssetPosedRows`
remains exported and tested for callers that only have the whole-body arrays.

Also added: a row-count guard in the mesh path
(`bind.prims.length !== g.prims.length + g.bones.length → 'row-mismatch'`
fallback), so a plan that grew or lost a cap between the rest bake and this body
falls back instead of silently deforming against the wrong frame.

**Regression test.** `gib-asset-integration.test.ts` — "deforms cut-cap rows
against the runtime frames, with no rest-origin spike": on a rigidly posed body
it reproduces both paths and asserts the new one stays inside the rest extent
while the old one exceeds it by >0.2 m. It passes on the fix; the old path is
retained in the test as the failure case.

Evidence: `captures/anatomy-ab.jpg`, `captures/zombie-ab.jpg` and
`captures/multi-ab.jpg` are the fixed arm. The spiking "before" frames were
produced by the discarded first run and live under `.lab-tmp/` (gitignored); the
regression test is the durable record.

## Visual gate: matched A/B

All legs boot `/sdf-game.html?room=<id>&frozen=1&seed=7&vhs=off` with the same
camera bearing (chosen from the actor list to keep another body out of the shot),
the same detonation point and the same frame count; only `gibrender` differs.
`zombie-aa` is the noise floor from an A/A re-boot of the march arm.

| Leg | kind | frames | mean %px>12 | max %px>12 | mean abs/255 |
| --- | --- | ---: | ---: | ---: | ---: |
| `zombie-aa` (A/A noise floor) | zombie | 92 | **0.052** | 0.172 | 0.277 |
| `zombie-ab` | zombie | 92 | 2.854 | 67.885 | 1.151 |
| `soldier-ab` | soldier | 92 | 6.773 | 16.784 | 2.923 |
| `multi-ab` (3 bodies) | zombie | 92 | 2.480 | 4.369 | 0.895 |
| `deferred-ab` | zombie | 62 | 0.629 | 1.680 | 0.165 |
| `wounds-ab` | zombie, 4 craters | 82 | 13.316 | 100 | 7.039 |
| `anatomy-ab` (VFX killed) | zombie | 61 | 12.897 | 100 | 7.736 |
| `head-ab` | zombie head | 11 | 14.326 | 18.893 | 5.416 |

The single-frame 100% peaks in the wound/anatomy legs are the release frame
landing one sub-step differently between representations; the mean is the
readable number.

**Simulation parity is exact** (same seed, same drive). Every settle census below
is identical between arms, and `airborne` is 0 everywhere:

| Leg | pieces | sprite assets | marched fallback | settle | lowest y (m) |
| --- | ---: | ---: | ---: | ---: | --- |
| `zombie-march` | 14 | 0 | 14 | 14/14 | −0.036, −0.012, 0.001, 0.022, … |
| `zombie-assets` | 14 | 13 | 1 (`head-face`) | 14/14 | **same** |
| `soldier-march` | 13 | 0 | 13 | 13/13 | −0.009, −0.002, −0.001, 0.015, … |
| `soldier-assets` | 13 | 12 | 1 (`head-face`) | 13/13 | **same** |
| `multi-march` | 56 | 0 | 56 | 56/56 | −0.036, −0.012, 0.001, 0.019, … |
| `multi-assets` | 56 | 52 | 4 (`head-face`) | 56/56 | **same** |
| `wounds-*` | 14 | 13 / 0 | 1 / 14 | 14/14 | **same** |
| `deferred-*` | 14 | 13 / 0 | 1 / 14 | 14/14 | **same** |

**Native-vision observations** (sheets in `captures/`):

- `anatomy-ab.jpg` — from f013 to f059 the mesh pieces carry the drawn
  silhouette: the same separation order, the same limb shapes, the head a
  distinct piece above a neck gap, no spike triangles, no rest-pose snap-back.
  The mesh arm reads slightly smoother/harder on cut faces (see blockers).
- `zombie-ab.jpg` / `soldier-ab.jpg` — with real fireballs/smoke on, the two arms
  are visually close through flight and at the settled floor; the soldier keeps
  its retired armour off (no revived/floating armour).
- `multi-ab.jpg` — three simultaneous bodies, 56 pieces, both arms settle to the
  floor with identical heights and no stuck airborne chunk.
- `wounds-ab.jpg` — a body with four stamped slug craters still loses nothing on
  the mesh path (all pieces eligible; only `head-face` falls back), and its
  craters/level of damage read the same across arms.
- `tight-budget.jpg` (`?gibspritelive=24&gibspriterest=8`, 3 bodies) — the cap is
  honoured (24 sprite pieces live, 28 total with the 4 marched heads), pieces are
  evicted and returned to the pool, and nothing is left floating.
- `head-ab.jpg` — the head is identical across arms; see below.

## Head gate (no faceless heads)

Task 2 left the asset face projection unwired, and the first Task 3 capture of
`?gibrender=assets` confirmed the consequence: the shared gore material draws the
head as bare flesh. The fix is an explicit, counted exclusion:
`gibAssetMeshEligible` returns `'head-face'` for any piece carrying a face frame,
so the head falls through to the **marched** piece, which settles, bakes and
picks up its face material exactly as before.

`scripts/sdf-gib-assets-head.mjs`, both arms:

| | march | assets |
| --- | --- | --- |
| `faceBaked` at settle | 1 | 1 |
| baked head id | 14 | 1 (march chunk) |
| baked head position | 20.5249, 0.139, −8.6510 | 20.5255, 0.139, −8.6508 |
| sprite pieces live | 0 | 6 |

The head follows the same trajectory in both arms and bakes into a face-material
mesh in both. `head-face` is counted `1` per body (`4` on the 3-body leg), so the
exclusion is visible in `gibAssetStats().fallbacks`, never silent.

## Performance

Ran on the headless Chrome/Apple-GPU page, one Chrome at a time. The A/A cadence
leg is the control for machine drift.

### Loader

| | value |
| --- | --- |
| committed bytes | **8,650,864 B** (zombie 3,925,208 bin + 147,920 json; soldier 4,463,376 bin + 114,360 json) |
| `resetGibAssets()` + `preloadGibAssets()` | **33.9–187.5 ms** first, **38.9–161.2 ms** second (range over runs: HTTP re-fetch + decode + `BufferAttribute` wrapping; the spread is IO/GC, not parse) |
| library `builtMs` (decode + attribute wrap) | zombie **2.1 ms**, soldier **3.9 ms** |
| per-instance pooling | `poolCreated` bounded by concurrency, `poolFree` returns on detach; reset leaves `{live:0,rest:0,meshes:0,materials:0}` |

There is **no new startup mesh-generation delay**: the loader is a fetch+decode,
`runtimeExtractionJobs` is **0**, and no `bakeChunkGeometry` runs on this path.

### Explosion cost (three bodies, hand-stepped)

| arm | detonate wall (ms) | page `lastBlastMs` (ms) | pieces | asset pieces |
| --- | --- | --- | ---: | ---: |
| march | 8.3 / 6.4 / 2.5 | 8.2 / 6.4 / 2.5 | +14 / +28 / +14 | 0 |
| march A/A | 8.1 / 6.8 / 2.5 | 7.9 / 6.7 / 2.5 | +14 / +28 / +14 | 0 |
| **assets** | 9.0 / 5.4 / 1.4 | 8.9 / 5.4 / 1.4 | +14 / +28 / +14 | **13 / 26 / 13** |

Comparable within noise; the assets arm's hit count proves the mesh path carried
the blast. `totalBakes` is 0 in the 20-frame window in both arms, and
`runtimeExtractionJobs` is 0.

### Moving-gib frame cost

rAF cadence, 240 frames/arm, bursts of 30 alternating pieces shown/hidden:

| arm | shown median | shown p95 | shown max | hidden median | paired Δ median |
| --- | ---: | ---: | ---: | ---: | ---: |
| march | 16.70 | 16.70 | 16.80 | 16.70 | 0.00 |
| march A/A | 16.70 | 16.80 | 16.80 | 16.70 | 0.00 |
| assets | 16.70 | 16.80 | 16.80 | 16.70 | 0.00 |

**The page is vsync-limited at ~16.7 ms**, so a piece cost that fits the budget is
invisible by construction. The GPU pass rows are the intended cross-check, but
**they are not usable as evidence here**: in the A/A control the top rows swing
−3.76 ms … +0.82 ms with the sign flipping (pieces "hidden" reading slower), i.e.
the row method's noise floor on this machine is larger than any piece cost at
these counts. The honest statement is *"no measurable moving-gib cadence penalty
at the default caps (14–56 pieces) in this configuration"*, not "free".

## Default decision + exact blockers

**The shipped default stays `?gibrender=march`.** Assets remain opt-in, because
the plan's condition is "ordinary zombie/soldier visually pass **and no material
regression**", and two measured material gaps remain:

1. **The asset wound/wet mask is empty.** Measured on the committed set:
   `bakeColor.a == 0` on **100% of vertices** (torso.chest, torso.abdomen, head,
   armL.upper all min/mean/max 0.000). Task 1 baked it from a rest pose with
   `torn: []`, so the cut-aware mask the carved/baked path derives is not in the
   committed bins. The consequence is visible in `captures/cutfaces-ab.jpg`: the
   mesh pieces read glossier/harder with dark untreated cut faces where the
   marched pieces are a wet mottled mass. **Fix:** regenerate the sets with the
   cut-aware mask (changes the Task-1 fingerprint), or add a runtime cut/wet
   variant.
2. **Head face projection is not wired for meshes.** Fixed conservatively by
   excluding the head (`'head-face'`, counted) so nothing ships faceless, but
   full-body asset coverage needs the per-fragment face uniforms
   (`headCentre`/`headQuat`/`headAxes`) driven from the mesh's world transform and
   the posed head prims, with the actor's face atlas retained past actor release.

Everything else the plan asked the gate to check passes: no visible rest-pose
snap, no faceless head, no revived/floating armour, no stuck airborne chunk,
matched settled floor contact, and the pool/reset contract holds.

## Limitations / honest scope

- No owner look pass; this is an automated native-vision gate on one machine.
- The deferred leg used `?renderer=deferred`; assets are wired through the same
  router as the sprite path, and the A/B diff there is 0.63% mean, but this is a
  smoke leg, not a deferred-parity claim.
- Soldiers only exist in rooms 1 and 5; the soldier legs ran in the annex (room 5,
  3 soldiers + 5 zombies), not the arena.
- The A/A noise floor (0.052% mean px>12) is for *frozen, hand-stepped* frames.
  It does not cover frame timing under load, and the machine had other Chrome
  sessions open (not rendering the lab).
- The perf loader "cold/warm" labels are reset-and-reload on one already-warm
  page, not a fresh browser profile; treat the numbers as a range, not a
  benchmark.
- The plan's note stands: offline meshes remove extraction, not every renderer
  cost. No universal-fix claim; a fresh session may still freeze for unrelated
  reasons.

## Later candidates (with measured rationale)

- **Regenerate the committed sets with a cut-aware `bakeColor.a`** (blocker 1).
  CPU-only, ~6 s, changes the fingerprint; this is the single change that would
  most likely clear the default-flip condition.
- **Wire the asset head face projection** (blocker 2), removing the one
  per-body `head-face` fallback and the last marched piece in an asset blast.
- **Other archetypes** in `character-registry.ts`: the loader/runtime contract is
  archetype-agnostic and the soldier set already loads, but there is no measured
  visual or cost rationale to expand further.
- **A real moving-gib cost measurement** would need frame-cap off and a quieter
  machine, or a counter-based instrument; the pass-row method as run is
  inconclusive.

## Verification (all on this branch, this worktree)

- `npx tsc --noEmit` — clean.
- `npm run build` (tsc + vite, Node 22) — clean, `built in 2.95 s`.
- Focused suites — `gib-asset`, `gib-asset-runtime`, `gib-asset-integration`
  **30 tests** pass, including the new cap-row regression and head-exclusion
  tests.
- Full `vitest run` on the committed source — **340 files, 5340 tests, all
  passing** (158 s).
- Full GPU gate — `scripts/gib-assets-gate.sh .lab-tmp/gate all`, exit 0, no
  failed legs. Compact record: `captures/gate-summary.json`.

## Prove it

```bash
scripts/gib-assets-gate.sh .lab-tmp/gate core     # zombie+soldier A/B, anatomy, diffs
scripts/gib-assets-gate.sh .lab-tmp/gate head     # head bake, both arms
scripts/gib-assets-gate.sh .lab-tmp/gate perf     # loader/explosion/cadence
```
