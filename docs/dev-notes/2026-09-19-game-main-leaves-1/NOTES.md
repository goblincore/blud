# game-main.ts decomposition — leaves wave 1 (2026-09-19)

Task: shrink `src/lab/sdf-zombie/webgpu/game-main.ts` by extracting LEAF
functions bottom-up with `scripts/extract-leaf.ts`, then lift the `__sdfGame`
members those extractions unblock with `scripts/extract-seam-group.ts`. Pure
moves; rendered output byte-identical.

## Result

| metric | before | after |
| --- | --- | --- |
| `game-main.ts` lines (`wc -l`) | 11,598 | **9,721** (−1,877, −16.2%) |
| main()-scope function declarations | 117 | 71 |
| `__sdfGame` literal members | 141 | 45 |
| targeted tests | 2 failed / 507 passed / 1 skipped | 2 failed / 507 passed / 1 skipped |
| `npx tsc --noEmit -p .` | clean | clean |
| room1 march-hash | `8f2b74e7…` | `8f2b74e7…` (see Gate below) |

The 2 test failures are the known pre-existing `game-actor-torso-slug` pair
(`warm=30` / `warm=120`); they fail identically on the untouched base.

## Functions extracted (46, all leaf after their deps moved)

Every module below is new (the extractor writes a fresh file, it cannot append).
All 46 bodies were AST-diffed against the base `main()`: identical apart from
the explicit `ctx` first parameter and the `ctx,` prepended at internal call
sites. No hand edits.

| module | functions |
| --- | --- |
| `game-render-leaves.ts` | median, applyBoneCullMode, applyBoneMesh, updateUpscaleAbLabel, copyUniformValues, fisheyeReport, gibBlurSubjects |
| `game-vfx-leaves.ts` | faceFor, applyWoundRamp, woundTuningNow, scaleBurstVisual, spillVerdict |
| `game-gibs-leaves.ts` | gibAssetArchetypeOf, ensureGibAssets, gibAssetArmed, primsLongAxis, scheduleGib, retireActor, stepPendingGibImpulses, reacquireHeldProp, newBlastProfile, applyChunkKindLook |
| `game-weapon-leaves.ts` | viewToRig, locatorInView, breechInRig, newTracerQuad, setQuadMatrix, startReload, stepBursts |
| `game-world-leaves.ts` | stampLevelProbeRoom |
| `game-render-leaves2.ts` | applyBoneCull, restampLevelProbes |
| `game-gibs-leaves2.ts` | spawnAssetGibPiece, spawnSpriteGibPiece |
| `game-world-leaves2.ts` | woundStreamId, gateRefineTwin |
| `game-demo-leaves.ts` | readInputFrame, neutralInput, updateDemoHud, placeFromDemo, describeRecordedWound |
| `game-player-leaves.ts` | applyMouseDelta |
| `game-boot-leaves.ts` | setLoader |
| `game-world-leaves3.ts` | stepGutRopes, registerBleed |
| `game-demo-leaves2.ts` | demoRecordStop |

18 of the 36 functions `slice-extract.ts --functions` marked `EXTRACTABLE` moved
in this wave; the other 18 were either multi-slice true leaves (also moved) or
refused/blocked (below). Extracting `bodiesOnScreen`-dependent callers was not
possible because `bodiesOnScreen` itself is refused (see below).

## `__sdfGame` members lifted

`game-seams-leftover.ts` — **96 members, 994 lines**. Verbatim AST cut-and-paste
by `scripts/extract-seam-group.ts`, spread in as `...createLeftoverSeams(ctx)`.

Important: the previous session's `--slices` pass had silently skipped **88**
members that had always needed only `ctx` (empty or unmapped slice sets — its
`pick` requires `m.slices.length > 0`). This wave lifts all of them plus the
members the new module functions unblocked (`stampWoundAt`, `explode`,
`setFisheye`, `fisheye`, `setBoneCull`, `setBoneCullMode`, `setBoneMesh`,
`gibRenderMode`, `gibRenderer`, `preloadGibAssets`, `woundTuning`, …).

Three members were deliberately left in `main()` (verified by `tsc`):

| member | why |
| --- | --- |
| `demoSynthesize` | shorthand property whose value IS the main()-scope function `demoSynthesize` |
| `bodiesOnScreen` | same shorthand shape |
| `resolution` | references module-scope `RES_RUNGS` (not an import; the tool copies types, not value consts) |

## EXTRACTABLE functions the tool REFUSED (drives the next wave)

These are genuine leaves. `extract-leaf.ts` cannot move them as written. Grouped
by root cause:

1. **Generic signature defeats the ctx regex.** `registerLitChunkMaterial<T extends BakedChunkMaterial>(m: T): T`
   — the tool's `function name\(` regex never matches `<T …>(`, so no `ctx` param
   is inserted and the name is not exported. Worse, even when fixed up, passing
   `ctx` to it resets TS's flow narrowing of `ctx.bake.mat` at its ~12 call
   sites (inside `if (!ctx.bake.mat)` blocks) → a cascade of "possibly null".
2. **Shorthand bare refs are not wrapped.** The tool's bare-ref detector skips
   `ShorthandPropertyAssignment` (`p.name === n`), so a member/dep passed as
   `{ f }` keeps the raw `(ctx, …) => …` function and no longer matches the
   callee signature. Affected: `bodiesOnScreen` (3 deps objects:
   `createBenchSeams`/`createRenderDiagSeams`/`createShellDiagSeams`),
   `traceSlugHitFrom` (`createFlareHarness`), `demoScenarioOf` and `awaitBakes`
   (`createBenchSeams`).
3. **Uncontextualised bare-ref wrapper.** `pushProbeWeight` is exposed as
   `setProbeWeight: (...a) => pushProbeWeight(ctx, ...a)`. The `__sdfGame`
   literal is typed `unknown`, so the untyped rest param is implicit-any
   (TS7019/TS2556). The tool wrapped it (`bareRefs: 1`) but the result does not
   compile.

Blocked (not refused) EXTRACTABLE leaves — they still have free `main()` names,
so a later wave must extract the dependency first (or move the const with
`--consts`):

| function | free main()-scope names |
| --- | --- |
| `chunkCollidersAt` | `ceilingAt` |
| `tickAdaptive` | `applySdfScale`, `ADAPTIVE_WINDOW`, `PROBE_ABORT_FRAMES` |
| `enableTrainedUpscale` | `applyUpscaleAbMode` |
| `spawnAll` | `spawnEnemy` |
| `playerRoomId` | `ROOM_ID_BY_NAME` (const — `--consts` candidate) |
| `aimArms` | `viewDirToRig`, `BEND_*_VIEW`, `SHOULDER_*_VIEW`, `_bendL`, `_bendR`, `_sh` |
| `boreFrameInRig` | `_bfA`, `_bfB` (scratch vectors — `--consts` candidate) |
| `convergedDir` | `aimDir`, `AIM_CONVERGE_M` |
| `newTracerView` | inner type `TracerView` |
| `ensureGibAtlas` | `GIB_ATLAS_URL`, `GIB_SHEET_URL` (`--consts` candidate) |
| `igniteExplosionLight` | `EXPLOSION_LIGHT`, `EXPLOSION_LIGHTS` (`--consts` candidate) |
| `propWorld` | `_propPos` (scratch vector) |
| `bundleHitsBody` | `BUNDLE_BODY_RADIUS_M` (`--consts` candidate) |
| `spawnBurstStandIn` | `BURST_SLOTS` (`--consts` candidate) |
| `applyDemoQuery` | `applySdfScale`, `rebuildCast` |

`extract-leaf.ts`'s header claims it "refuses non-leaves"; it does not — it
moves whatever you name and relies on `tsc` to catch the fallout. Treat the dry
run as a count, and `tsc` as the real gate.

## Gate (march-hash) — the important finding

Step 0 baseline on the untouched base:
`{"room1":"8f2b74e71ff18dd04a99c05fe19392b96dd80c9d","room1-repeat":"8f2b74e71ff18dd04a99c05fe19392b96dd80c9d","room1-wounded":"1381a866703b827745486a1062240a46bee5c73f"}`

HEAD reproduced exactly that line (all three fields). **But the gate is
cross-boot nondeterministic in this environment, at base as well as at HEAD.**
Observed base (untouched `e3077f7c`) runs, same machine, same command:

```
base run A: 8f2b74e7…   (canonical)
base run B: 8f2b74e7…
base run C: ce7045ac…
base run D: 9871c2c2…
base run E: b6422b41…
base run F: 8f2b74e7…
base run G: 8f2b74e7…
```

Every observed non-canonical value at HEAD (`b6422b41…`, `9871c2c2…`) also
appears at the untouched base, so none of them is attributable to this wave.
The within-boot determinism proof (`room1-repeat === room1`) held on every run,
including the non-canonical ones.

Evidence that the wave is a true pure move:

- `tsc --noEmit -p .` clean on all 13 commits.
- Every moved function body was AST-diffed against base: identical except the
  explicit `ctx` parameter and `ctx,` at internal call sites.
- No `arguments` / `this` / `Math.random` / `performance.now` in any extracted
  body (checked).
- No top-level member-name collision between `game-seams-leftover` and any
  pre-existing seam factory (checked via AST).
- The canonical line reproduced at HEAD (twice, including the full three-field
  JSON).

This is a pre-existing gate limitation, **not** a reason to loosen the pin. The
nondeterminism source is most consistent with the boot-time `frameIndex` parity
in `sdf-layer.ts` that the gate's own header already documents (the header's
fields-off pin removed one mode but not all). A follow-up should either pin that
parity properly or run the gate N times and compare the *set* of hashes, not a
single value.

## Tool bugs found (for the next wave)

- `scripts/extract-seam-group.ts` → `readMembers()` picks the **largest
  expression statement whose text contains `__sdfGame`**. Once the literal shrank
  below the `ctx.boot.handle.setDrawFn(() => { … })` closure (~39k chars vs the
  literal's ~20k), it picked the closure and crashed (`obj.properties` of
  `undefined`). Fix: select the `BinaryExpression` whose `.right` is an
  `ObjectLiteralExpression` (this wave used a local corrected copy to plan).
- `extract-leaf.ts` should (a) match optional type parameters in its ctx
  regex, (b) wrap `ShorthandPropertyAssignment` refs, (c) type the bare-ref
  wrapper, and (d) actually reject functions with free `main()` names instead of
  relying on `tsc`.

## Next wave

1. Fix the four `extract-leaf.ts` gaps above; then `registerLitChunkMaterial`,
   `pushProbeWeight`, `bodiesOnScreen`, `traceSlugHitFrom`, `demoScenarioOf`,
   `awaitBakes` are all immediately extractable.
2. Use `--consts` for the remaining const-only blockers (`ROOM_ID_BY_NAME`,
   `_bfA`/`_bfB`/`_muzA`/`_muzB`, `AIM_CONVERGE_M`, `GIB_ATLAS_URL`/`GIB_SHEET_URL`,
   `EXPLOSION_LIGHT`/`EXPLOSION_LIGHTS`, `BUNDLE_*`, `BURST_SLOTS`, `TRAIL_STREAM_BASE`,
   `ZOMBIE_RADIUS`), checking each is never reassigned and its initializer has no
   `main()` scope.
3. `updateHud` alone unblocks 8 members (`step`, `setFreeAim`, `setInfiniteAmmo`,
   `setReloadSpeed`, `setSlugMode`, `refillShells`, `setWoundStep`, `selectSlot`);
   it needs only `bodiesOnScreen`.
4. Fix `readMembers` before any further member lift.

## TASKS.md

Not edited (parallel session owns it). Two facts for whoever updates it:
- The board's "~52 members remain" is the count that still close over
  `main()`-scope functions. The literal actually held **141** members: 45 remain
  (42 blocked + the 3 above), 96 moved here.
- The board should record the march-hash gate's cross-boot flakiness (evidence
  above); the pinned canonical is still the correct target but a single red run
  is not a regression signal.

## Correction (reviewer, 2026-09-19) — the gate is not flaky; the runs overlapped

The non-canonical base values above (`ce7045ac…`, `9871c2c2…`, `b6422b41…`) are
exactly the values a parallel session's march-split pixel gate read during the
same window: two headless Chromes (ports 93xx) capturing on one GPU at once. Run
alone, this branch's HEAD gave the canonical line 3/3
(`8f2b74e7…` / repeat identical / wounded `1381a866…`), as did base and the march
branch on every isolated run. So the pin is a valid single-run signal **when
nothing else is capturing**; the fix is "never run two pixel gates at once",
not a multi-run set comparison. The `frameIndex`-parity theory is unproven.
