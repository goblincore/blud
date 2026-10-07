# Text-pin audit, batch 3

Read-only audit, 2026-10-07. "Pins" is the count of in-scope `expect()` calls as written in the
block (a loop body counts once; the iteration count is noted). A block that mixes kinds has one
row per assertion group, all with the same Line. Assertions on exported WGSL constants, on
behaviour and on data files are not listed.

## src/lab/sdf-zombie/webgpu/post-aa.test.ts
Reads: src/lab/sdf-zombie/webgpu/post-aa.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 172 | history is a ping-pong pair, never sampled where written | 2 | KEEP (unsure) | read/write swap would bind a target as both sample and attachment; targets are closure-private so the stub renderer cannot see it. No incident recorded, and the pin does not check the swap lines (1669-1670) |
| 177 | every target gets the explicit first clear | 2 | RESTATES | pins the exact 13-name array line: it breaks when a target is correctly added and stays green when one is forgotten (the tongue targets are already absent from the list) |
| 184 | round 2b: fire composite blends into the capture (5 blend-factor lines) | 5 | CONVERT | the stub renderer already receives each pass's material; capture `post:fire-composite` in `stubRenderer().render` and assert `blending/blendSrc/blendDst/blendSrcAlpha/blendDstAlpha` |
| 184 | same block: `not.toContain('fireOut')`, `not.toContain('fireCopyMat')` | 2 | COVERED | post-aa.test.ts "setFireVolume(true) runs the three fire passes into the capture" asserts 4 renders and the pass names, so a returned copy draw fails it |
| 203 | the fire materials never re-wrap a vec4 wgslFn result | 2 (x3 materials) | KEEP | a `vec4(out, 1.0)` wrapper gives JoinNode five components: console-only error, picture still looks right; documented incident, missed twice |
| 210 | round 2b: fire resolve + history run at the march resolution | 2 | KEEP (unsure) | history sized differently from the march target breaks the resolve's 1:1 reprojection; sizes are private. No incident recorded, and the line appears twice in the source so one stale copy would pass |
| 215 | a sink added AFTER the redirect is handed the current target | 1 | CONVERT | documented incident (goo layer hidden on the game page). `createPostAa(stub)`, `post.render(...)` with FXAA on, then `post.addSink(s)` and assert `s.target === post.captureTarget`; the existing redirect test only adds the sink before the first render |
| 224 | the scene capture target carries a depth buffer | 1 | COVERED | post-aa.test.ts "exposes the real capture target with sampleable depth (prewarm seam)" asserts `captureTarget.depthTexture` is not null, and `captureTarget` returns `sceneTarget` |
| 230 | every declared WGSL parameter is supplied at the call site | 3 (x7 passes) | KEEP | fa57506: a header param the `wgslFn(...)({...})` call never bound is silently unbound; green tests, dead renderer. Diffs both sides instead of restating either |
| 273 | the VHS stage owns a filterable input pair, never histA/histB | 7 | KEEP | three emits no sampler for a nearest target, and the motion gate latches on if it reads the smear history; targets and filters are closure-private |

Whole-file note: `readFileSync` stays (five KEEP blocks use it). The two CONVERTs need only the existing `stubRenderer`.

## src/lab/sdf-zombie/webgpu/flame-lab-main.test.ts
Reads: src/lab/sdf-zombie/webgpu/flame-lab-main.ts, sdf-flame-lab.html, vite.config.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 22 | is served by the page shell and registered for the build | 3 | RESTATES | script path, `id="app"` and the vite input line exist; no incident, and a missing vite entry shows up as a missing page on the first build |
| 28 | renders through the real march and the real post chain | 4 | RESTATES | four identifiers exist in the file |
| 35 | drives each body burn state into its own burnCfg uniform | 5 | RESTATES | five call names exist; says nothing about per-body routing |
| 43 | exposes the lab through a console API | 4 | RESTATES | substrings `ignite`, `capture`, `setTuning` pass on any file that mentions the words |
| 50 | freezes pose and camera so two capture runs are pixel-comparable | 5 | RESTATES | five verbatim lines of a lab tool; the stated reason (drifting A/B captures) is found the first time anyone captures |
| 63 | kills a burning body into a burn-down and feeds the card pile | 4 | RESTATES | names and one assignment exist |
| 73 | feeds the soldier his measured kit radius | 4 | RESTATES | one ternary and three names restated |
| 82 | holds the tongue technique switch | 7 | RESTATES | seven lines of URL and console plumbing restated |
| 95 | installs the game shutter through the post capture stage | 3 | RESTATES | three call names exist |
| 101 | pins the Blood reference sprites beside the bodies | 1 | RESTATES | an image path is present in the html |
| 106 | feeds the volumetric fire pass from posed capsules | 10 | RESTATES | ten call fragments restated; the pure pieces (`fireCapsules`, `packFireVolume`) have their own tests |

Whole-file note: the file is entirely text pins apart from line 17 (`FLAME_LAB_BODIES`, behavioural, which also provides the "imports resolve" smoke the header describes). After deletion the three `readFileSync` lines, `PAGE` and the `node:fs` import can go. It is a lab page: no block guards a game hazard.

## src/lab/sdf-zombie/webgpu/earlyz/earlyz-wiring.test.ts
Reads: src/lab/sdf-zombie/webgpu/game-main.ts, src/lab/sdf-zombie/webgpu/game-spawn.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 32 | boots early-Z, then the guards, then crowd-off, then the seed, then the first crowd type (5 orderings + `not.toContain('crowdTypeFor(')`) | 6 | KEEP | bootEarlyz must not overwrite the deferred/accum guard, and no front mesh or seed may be built before the guards; pure boot order in main(), no seam |
| 32 | same block: `spawnSource` contains `crowdTypeFor(ctx, name, room.id, stride)` | 1 | RESTATES | only records where the call lives after today's move |
| 42 | turns early-Z off under deferred and `?accum=1` in one guarded block | 4 | CONVERT | restates the `if` and its body; extract `earlyzBootRefusal({ on, deferredMode, accumBoot, crowdOn }) -> reason or null` beside `seed-gate.ts` and test the table. The position of the guard is already held by line 32 |
| 52 | reports early-Z off when the crowd path is off (the two block-content pins) | 2 | CONVERT | same extracted function covers the `!crowd.on` reason |
| 52 | same block: the check sits after the refine/cone fallback assigned `crowd.on = false` (2 orderings) | 2 | KEEP | a check placed before the fallback reports early-Z "on" with no effect and builds front meshes for a per-body boot; order in main() |
| 62 | lists each crowd type's front mesh with its back mesh in setBodies | 2 | CONVERT | 2026-10-02 cost run (front batch marched again, 34-45 ms per chunk). Extract the inline expression to `crowdBodyList(types, earlyzOn)` and assert the front mesh is listed |
| 72 | keeps the shipped map() list (no per-frame flatMap) when early-Z is off | 4 | RESTATES | pins `flatMap` versus `map`; both give the same list when no type has a front mesh, so only the code shape is asserted |
| 83 | does not compile the front mesh of a quad-dispatch type | 2 | CONVERT | wasted cold compile (tens of seconds). Extract `crowdCompileMeshes(t)` from `compileCrowdInBackground` and assert a quad-dispatch type yields only `t.mesh` |
| 91 | draws the seed only for a crowd-march boot with early-Z on | 5 | KEEP (unsure) | an ungated `setEarlyzSeed` breaks "flag off is the shipped boot"; five expects restate one `if` line and `ctx.crowd.on` is redundant after the line-52 guard. One regex would do |
| 105 | degrade checks twice: after each front compile, every frame before the types sync | 5 | KEEP | a failed front pipeline is skipped by three's draw, so its bodies vanish unless the type is degraded before that frame's `t.sync`; `degradeFailedEarlyzFronts` itself is tested in earlyz-boot.test.ts but the two call positions are in main() |

Whole-file note: the file is entirely text pins. The three CONVERT extractions (boot refusal, body list, compile list) would cut it from 33 assertions to about 18 and leave only real orderings.

## src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts
Reads: src/lab/sdf-zombie/webgpu/zombie-gpu.ts, src/lab/sdf-zombie/webgpu/lab-main.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 633 | forwards volumeClip beside volumeWarp in ALL march call sites | 2 | KEEP | the TSL call is matched by name against the WGSL header, so a twin missing the key is silently unbound; counts all four call sites. A header-versus-call-site diff like post-aa.test.ts line 230 would be sturdier |
| 645 | depth-prepass twin: `depthPreMaterial.fog = false` | 1 | CONVERT | 8da0bdd: scene fog mixed the written distance toward fogColor and deleted geometry at range. Build a view with a `depthPre` source and assert `view.depthPreObject.material.fog === false` |
| 645 | same block: positionally-last inputs, fallback texture, fallback cfg is a uniform not a composed constant | 4 | KEEP (unsure) | 2026-09-05: a vec4-of-scalars constant breaks three's WGSL generation (console-only error, unlit-black bodies). The fallback helpers are module-private. The `cfg: uniform(new THREE.Vector4(0, 0, 0, 0))` pin also matches two unrelated lines (1089, 1170), and the key-order regex is very brittle |
| 676 | startMelt freezes motion and wander, stopMelt restores them | 6 | KEEP (unsure) | 2026-09-03: the finished puddle walked around, and the capture harness hid it. `startMelt` is a closure in lab-main's main(). Lab page only, not the game |
| 699 | rewrites ROW_PRIM_BEND every frame in apply, not once in reset | 4 | COVERED | zombie-gpu.test.ts "writes the TRANSFORMED control point into the bend row" reads the row out of the data texture after two `update()` calls; its own comment calls it the real check. Gap: it reads the bone row only, not a bent flesh prim |
| 1079 | builds refineBody on the march chain and binds the four refine inputs by name | 4 (one x4 keys) | RESTATES | two export lines and five key names exist; `cosRay:` and `nearFar:` also match unrelated lines (1052, 1188) so those pass regardless |
| 1089 | the refine twin is built from refineTailUniforms | 2 | RESTATES | a function is declared and called |

Whole-file note: line 1093 ("the WGSL gates the slim tail relies on still exist") asserts on `MARCH_BODY_LIGHT` and is out of scope; it does not use `src`. If 1079 and 1089 go, both `describe`-level `readFileSync` lines at 1078 and 1088 go with them.

## src/lab/sdf-zombie/webgpu/sdf-layer.test.ts
Reads: src/lab/sdf-zombie/webgpu/sdf-layer.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 807 | REFINE_LAYER is a new, unique layer and the pass is labelled sdf:refine | 2 | RESTATES | two `setPassLabel('sdf:refine...')` strings exist; nothing in the repo reads those labels by name |

Whole-file note: the layer-uniqueness and `REFINE_LAYER === 9` expects in the same block are behavioural and stay. Removing the two pins removes the file's only `readFileSync` (line 812) and its import (line 2).

## src/lab/sdf-zombie/webgpu/march/body/blocks/post/shading-normal.wgsl.test.ts
Reads: src/lab/sdf-zombie/webgpu/zombie-gpu.ts, game-main.ts, game-spawn.ts, game-seams-march-debug.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 12 | binds a default-off uniform and propagates requests: uniform default, chunk copy from template | 2 | CONVERT | `defaultUniforms(tex).normalGradientCfg.value` equals (0,0,0,0); `createChunkGpuView(chunk, prims, template.uniforms)` copies a non-zero template value. Both fixtures exist in zombie-gpu.test.ts |
| 12 | same block: `normalGradientCfg: u.normalGradientCfg` at the march call | 1 | KEEP (unsure) | same silent-unbind class as volumeClip; pins one of four call sites, so weaker than the line-633 count |
| 12 | same block: spawn stamps `normalGradientCfg` from `ctx.telemetry` | 1 | KEEP | the uniform defaults to 0 and the game default mode is 1, so this one line in `spawnEnemy` is what turns analytic normals on for every new body; no spawn test exists |
| 12 | same block: three `__sdfGame` seam signatures | 3 | RESTATES | method signatures exist; the block's own comment records three relocations of these pins |

Whole-file note: line 30 asserts on shader constants only and is out of scope.

## src/lab/sdf-zombie/webgpu/game-head-split.test.ts
Reads: src/lab/sdf-zombie/webgpu/game-main.ts, game-tick.ts, game-head-split.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 351 | the draw stage feeds it: drawEye before the skull meshes and the crowd's sync (4 orderings + the `warp:` line) | 5 | KEEP | the skull mesh and the crowd tiles read `view.splitDrawn`, which `drawEye` settles for the frame; called later, the skull lags the split by a frame. Draw order in main(), no seam |
| 351 | same block: `tickSrc` contains `ctx.weapon.headSplit?.tick(dt);` | 1 | RESTATES | records that the call exists in game-tick.ts after today's move |
| 351 | same block: `leafSrc` does not contain `ctx.boot.handle` | 1 | COVERED | game-head-split.test.ts "drawEye hands the frame's eye to the view of each actor it holds a split for, and the tick hands none" asserts the tick supplies no eye |

Whole-file note: the rest of the 900-line file is behavioural. `tickSrc` and `leafSrc` imports can go with their two pins; `mainSrc` stays.

## src/lab/sdf-zombie/humanoid-damage.test.ts
Reads: src/lab/sdf-zombie/humanoid-damage.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 205 | bounds discipline: only the occupied bounds are read, never the padded exterior | 4 | CONVERT | hazard is real (shoulder hits handed to the spine) and `ownerBrickForHit` is pure: pick a point inside the spine's padded `boundsMin/Max` but outside its occupied box and inside the upper arm's, assert it returns the arm. The pin also fails on a comment that mentions `boundsMin` |

Whole-file note: the `readFileSync` import stays; line 33 reads the manifest JSON.

## src/lab/sdf-zombie/webgpu/game-flail-tear.test.ts
Reads: src/lab/sdf-zombie/webgpu/game-flail.ts, game-head-damage.ts, game-seams-flail.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 12 | the flail tears body craters by swing and head craters at full: two `headSrc` lines | 2 | CONVERT | game-head-damage.test.ts already has a fixture that calls `leaf.hit(...)`; assert the stamped wound's `tear` equals `FLAIL_TEAR.head` |
| 12 | same block: `flailSrc` tearWound line, `seamSrc` setTear line | 2 | RESTATES | a call and a seam member exist; a feature-landing pin (plan Task 31) with no incident, and game-flail.ts has no test fixture to convert onto |

Whole-file note: the `FLAIL_TEAR` / `flailTear` / `setFlailTear` expects are behavioural and stay. All three `?raw` imports go once the four pins are converted or deleted.

## src/lab/sdf-zombie/webgpu/goo-presets.test.ts
Reads: src/lab/sdf-zombie/webgpu/game-main.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 22 | matches every literal game-main applies | 1 (x10 setters) | CONVERT | the drift it gates exists only because game-main repeats the literals. Have game-main call `applyGameGooDefaults(ctx.goo.layer)` (same order as its lines 5008-5031); "applies every default through the layer setters, in order" then covers both pages |
| 40 | matches the game mode and carries the same numbers (`setMode('depth')` pin) | 1 | CONVERT | same change removes it |

Whole-file note: this is a source edit in game-main rather than a new test. If the owner wants the documented literal block left in game-main, both rows become KEEP: the pin is then the only thing tying the blood-compare page to the game look. After conversion `readFileSync` and `src` go.

## scripts/seam-merge-guard.test.ts
Reads: src/lab/sdf-zombie/webgpu/game-main.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 12 | passes seam factories as arguments, never as spreads | 2 | KEEP | `...createXSeams(ctx)` freezes that factory's getters at boot and type-checks; seam-merge.test.ts covers `mergeSeams` but not how game-main assembles `__sdfGame` |

Whole-file note: file is entirely text pins and should stay as it is.

## src/lab/sdf-zombie/webgpu/occluder-hull.test.ts
Reads: src/lab/sdf-zombie/webgpu/game-main.ts, lab-main.ts, bench-main.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 540 | game-main.ts does not enable the occluder pre-pass at startup | 2 | CONVERT | sdf-layer already defaults `occluderUniforms.enabled` to `uniform(0)`, so the pinned startup line is a no-op; assert `createSdfLayer(fake).occluderEnabled === false` in sdf-layer.test.ts. The negative regex is dead here: the line is now spelled `ctx.render.sdfLayer...` and can never match `\n  sdfLayer.` |
| 540 | lab-main.ts does not enable the occluder pre-pass at startup | 2 | CONVERT | same default-off test; the holes cannot return by enabling the pass, since the march no longer clamps tMax by it (only frame cost is at stake) |
| 540 | bench-main.ts does not enable the occluder pre-pass at startup | 2 | CONVERT | same |

Whole-file note: one `it` inside a three-entry loop. After conversion the three entry-point `?raw` imports (lines 15-17) and the comment above them go; the `.blob?raw` imports are data and stay. The following test ("update({ occluder: false }) refreshes the shadow twin...") is behavioural.

## Totals

45 distinct it-blocks hold 167 in-scope assertions. Seven blocks mix verdicts and are counted once under each verdict they contain, so the block column sums to 54.

| Verdict | it-blocks | Assertions |
| --- | --- | --- |
| KEEP | 15 (6 contain an unsure row, 20 assertions) | 55 |
| COVERED | 4 | 8 |
| RESTATES | 20 | 71 |
| STALE | 0 | 0 |
| CONVERT | 15 | 33 |
| Total | 54 entries / 45 blocks | 167 |
