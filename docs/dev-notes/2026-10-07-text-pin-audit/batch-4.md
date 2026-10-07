# Text-pin audit, batch 4

Read-only audit. Nothing was run: every CONVERT below is a judgement from reading the code and the
existing harnesses, not a test that was written and seen to pass. Where a block mixes kinds it has one
row per assertion group (same Line, suffix a/b/c in the title).

Two findings that change several verdicts:

1. **`sdf-layer.ts` has a working stub-renderer harness.** `sdf-layer.test.ts` already drives the real
   `createSdfLayer(...).render()` against a fake renderer that records every `renderer.render` call and
   its target (`describe('capture march jitter')`, `fakeRenderer()`), and the layer exposes
   `setOutputTarget`, `setEarlyzSeed`, `earlyzSeedInfo`, `setDepthGate`, `setBodies`, `setChunkPass`.
   `seed-pass.test.ts` says "there is no unit seam"; that is no longer true, so most of its 75 pins are
   CONVERT rather than KEEP.
2. **three 0.186 binds `wgslFn(...)({...})` object parameters BY NAME, not by position**
   (`node_modules/three/src/nodes/code/FunctionCallNode.js`, `generate`: `parameters[inputNode.name]`; a
   missing key logs an error and binds `float(0)`). `post-aa.test.ts` ("every declared WGSL parameter is
   supplied at the call site") says the same. The "bound POSITIONALLY" comments in `zombie-gpu.ts` and the
   header of `zombie-gpu-burn.test.ts` describe a hazard the installed three does not have. The real
   hazard is a MISSING key, not a misplaced one. Worth a second pair of eyes before acting on it.

## src/lab/sdf-zombie/webgpu/earlyz/seed-pass.test.ts
Reads: src/lab/sdf-zombie/webgpu/sdf-layer.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 31 | exposes setEarlyzSeed and earlyzSeedInfo | 4 | RESTATES | interface + one-line implementations; tsc and the callers (game-main, game-seams-earlyz) already require them |
| 38 | builds the seed mesh only inside ensureSeed, once a scene was requested | 7 | CONVERT | flag-off must build nothing: with the fake renderer, render() without setEarlyzSeed leaves no `earlyz-seed` child and `earlyzSeedInfo().built === false`; with it (and an output target with a depth texture) exactly one |
| 51 | creates the seed node only inside ensureSeed | 4 | CONVERT | flag-off node-id hazard is real; count `wgslFn(EARLYZ_SEED_WGSL)` calls with the `vi.mock('three/tsl')` wrapper `flag-off-node-ids.test.ts` already uses (0 before setEarlyzSeed, 1 after, still 1 after a second) |
| 59 | depth-only, full-screen quad, draws first, starts hidden | 9 | CONVERT | read the properties off the real mesh: `scene.getObjectByName('earlyz-seed')` -> colorWrite/depthTest/depthWrite/default depthFunc/renderOrder/layers/visible/frustumCulled |
| 73 | feeds the pure seed gate every input from the layer's own state | 15 | CONVERT | drive each refusal through the real layer and read `earlyzSeedInfo().reason` (no output target, field style on, accum on, march jitter on, size mismatch via setSize); the gate itself is in seed-gate.test.ts |
| 94 | decides the per-body branch and the seed with ONE shared predicate | 9 | CONVERT | `setDepthGate(true)` + `setBodies([...])`, render, assert the reason is the gate's per-body one and the seed is invisible in every recorded render call |
| 110 | shows the seed only for a single-render march, then hides it | 8 | CONVERT | record `seed.visible` inside the fake `renderer.render`: true only in the march-target call, false in every later one; render with another scene -> reason 'seed lives in another scene' |
| 127 | hides the seed before the 'split' chunks-only render | 6 | CONVERT | same recorder with `setChunkPass('split')` and a chunk list: visible in the first march render, hidden in the chunks-only one (more setup than the rows above, same harness) |
| 144 | turns the quad on only around the march; precompile order | 5 | CONVERT | the whole-pass precompile test already mocks `compileAsync`; record seed visibility per compile call (visible for 'march' only, hidden after) |
| 154 | never calls setEarlyzSeed itself | 1 | RESTATES | a call count; the flag-off behaviour it stands for is the line-38 conversion |
| 158 | dispose removes the quad and frees geometry and material | 7 | CONVERT | after `dispose()`: scene has no `earlyz-seed`, geometry/material `dispose` events fired, `earlyzSeedInfo()` equals `{ built: false, on: false, reason: 'not requested' }` |

Whole-file note: file is entirely text pins (75). The hazards are real (flag-off byte identity, the seed
leaking into a later pass), so do not delete before the conversions exist; one new `describe` in
`sdf-layer.test.ts` on the existing `fakeRenderer` would replace all nine CONVERT rows, after which this
file and its `between()`/`count()` helpers can go.

## src/lab/sdf-zombie/webgpu/gib-shutter-layer.test.ts
Reads: gib-shutter-layer.ts, game-main.ts, game-tick.ts, game-seams-spawn-goo.ts, game-seams-fx.ts, shutter-panel.ts, shutter-blur.ts (all under src/lab/sdf-zombie/webgpu/)
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 59 | isolates selected pieces on a dedicated layer (a: the four `layers.set` pins) | 4 | COVERED | same file: 'a rejected mesh nobody lifted goes back to its base layer, and the next select restores all' (mesh masks) and 'compiles the subject through a camera clone...' (camera mask on GIB_BLUR_LAYER) |
| 59 | isolates selected pieces (b: `renderer.render(scene, camera)` / not `render(mainScene`) | 2 | RESTATES | a call spelling and a variable name that never existed; no wrong implementation trips it |
| 69 | resolves over the CLEAN capture with its own depth | 4 | RESTATES | four option/call spellings; resolving in place is a loud WebGPU validation error, not a silent one |
| 76 | rotation-aware per-surface stamps (a: `planGibMotionStamps`, `rasterizeSweepSeed`) | 2 | RESTATES | identifiers present; the planner's behaviour is in gib-motion-blur.test.ts |
| 76 | rotation-aware per-surface stamps (b: `ageSeconds: s.ageSeconds`) | 1 | CONVERT | no pre-birth streak for a new gib: the capture() mock test in this file can select a subject with `ageSeconds: 0` and assert `diagnostics().stamps === 0` |
| 82 | the resolve can be repointed at the gib result | 2 | RESTATES | a method signature and its one-line body; game-main calls it, so tsc holds the signature |
| 87 | mutual occlusion (a: members, signatures, uniform write, `setGibOccluder:`, `giboccluder` flag) | 8 | RESTATES | existence of members and a query-flag spelling; all typed and called |
| 87 | mutual occlusion (b: `gibDepth = ...occluderDepth`, `setOccluderDepth(occluderEnabled ? gibDepth : null)`) | 2 | KEEP (unsure) | the hand-off lives in the capture-stage closure inside main(); dropping it silently lets blood composite over a blurred gib |
| 106 | game-main lifts pieces before the base draw, then chains gib -> blood | 6 | KEEP | select must run in the tick (before the base draw) and gib capture -> setSceneTexture -> blood capture in that order, or pieces smear / blood paints over gibs; no seam in main() |
| 119 | separate gib switch + shared exposure (a: `gib?.setExposureMs(applied)` etc. in panel and fx seam) | 4 | CONVERT | call `shutterPanelHost(stubLayer, stubGib)` and `createFxSeams(stubCtx).setBloodBlurExposure(...)`; assert the gib stub receives the APPLIED (clamped) value |
| 119 | separate gib switch + shared exposure (b: label, `setGibEnabled`, `setGibBlur`, two game-main call spellings) | 5 | RESTATES | a UI label and four names |
| 131 | prewarms the gib targets (a: `prewarm(capture: ...): boolean`) | 1 | RESTATES | signature; tsc |
| 131 | prewarms the gib targets (b: the boot call in game-main) | 1 | KEEP (unsure) | a dropped boot call is a silent first-blur-frame hitch (~0.26 s measured, comment in game-main) with no seam |
| 136 | explicitly excludes the deferred route (a: three game-main pins) | 3 | STALE | reason is the deferred route, which is paused; one of the three is a console.warn string. Restore if deferred is resumed |
| 136 | explicitly excludes the deferred route (b: `supported` gate in the layer) | 2 | CONVERT | `createGibShutterLayer({ renderer: {}, supported: false })`, `setEnabled(true)` -> `enabled === false`; the I1 tests already build the layer on a bare stub |
| 148 | bounds the per-frame work | 1 | COVERED | same file: 'the cap falling mid-chain does not demote a mesh an earlier sample lifted' asserts select() returns GIB_BLUR_MAX_PIECES with one more offered |
| 154 | deterministic pure-spin fixture | 5 | RESTATES | signature and body lines of a debug seam; the rigs that use it (scripts/sdf-shutter-game-task4.mjs and others) fail loudly if it goes |

Whole-file note: after the RESTATES/STALE/COVERED deletions and the conversions, the 'integration
tripwires' describe keeps three small blocks (lines 87b, 106, 131b) reading only game-main.ts and
game-tick.ts; the readFileSync lines for the layer, seam, fx, panel and resolve sources can go.

## src/lab/sdf-zombie/webgpu/shutter-game-layer.test.ts
Reads: shutter-game-layer.ts, game-main.ts, game-tick.ts, game-seams-misc.ts, game-seams-fx.ts, post-aa.ts, goo-layer.ts (all under src/lab/sdf-zombie/webgpu/)
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 209 | the capture stage reads the capture and writes its own target | 5 | RESTATES | option and call spellings; a feedback loop is a loud validation error |
| 217 | forwards the optional gib occluder depth to the resolve | 2 | RESTATES | interface line plus a one-line delegation pinned verbatim |
| 222 | clamps exposure against particle age | 1 | KEEP (unsure) | `clampToAge: true` is a literal inside the layer's private stamp planner; dropping it brings back pre-birth streaks. The clamp itself is tested (shutter-blur.test.ts 'clamps the back-projection to the droplet age'), the flag passing is not, and this layer has no stub harness |
| 226 | post-aa runs the stage after the chain and before FXAA (a: stage presence) | 3 | COVERED | post-aa.test.ts 'a capture stage forces the captured path even with every effect off' and 'clearing the capture stage restores the all-off parity path' |
| 226 | post-aa runs the stage after the chain and before FXAA (b: chain < stage < fxaa) | 3 | CONVERT | in that same post-aa test push 'chain', 'stage' and each stub `renderer.render` into one array and assert the order (FXAA on) |
| 238 | goo-layer partition seam, both sync paths honour it | 2 | CONVERT | one unfiltered loop draws a droplet in both halves; the goo-upload.test.ts fixture already calls `setSelection` + `sync` under both `setAreaPriority` modes, assert `mesh.count` equals the selected droplet count in each |
| 245 | game-main poses the sharp half (a: poseSharp present and before the goo sync in the tick) | 2 | KEEP | the pose must precede the sync it partitions or the selected droplets draw twice (sharp and blurred); tick() has no unit seam |
| 245 | game-main poses the sharp half (b: stage install, settings read, four setter names) | 6 | RESTATES | names in files; the comments on them are a log of past moves |
| 264 | prewarms the shutter targets (a: `captureTarget` type, `prewarm` signature, `ensureTargets(...)` call) | 3 | RESTATES | signatures and a call spelling |
| 264 | prewarms the shutter targets (b: `get captureTarget() { return sceneTarget; }`) | 1 | CONVERT | identity is the point: in the post-aa capture-stage test assert the target handed to the stage `toBe(post.captureTarget)` |
| 264 | prewarms the shutter targets (c: the boot call in game-main) | 1 | KEEP (unsure) | same silent first-frame hitch as the gib twin (gib file, line 131b) |

Whole-file note: the first 195 lines are behavioural and out of scope. After deletions the tripwire
describe needs only game-main.ts, game-tick.ts and shutter-game-layer.ts.

## src/lab/sdf-zombie/webgpu/march/body/blocks/post/prim-material.wgsl.test.ts
Reads: src/lab/sdf-zombie/webgpu/march/layout.ts (and march.wgsl.ts via ?raw, for the same block)
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 194 | row 17 no longer documents w as spare | 2 | STALE | pins a doc comment (ROW_PRIM_CLIP's JSDoc must not say 'spare', must say 'glow'); the lane itself is pinned on shader text two blocks down |

Whole-file note: every other assertion is on exported WGSL strings (out of scope). With this block
gone both `?raw` imports (`moduleSource`, `layoutSource`) are unused.

## src/lab/sdf-zombie/webgpu/march/body/blocks/post/body-grain.wgsl.test.ts
Reads: src/lab/sdf-zombie/webgpu/zombie-gpu.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 96 | applyMaterial writes the palette grain into meltCfg.w and syncs the record | 3 | CONVERT | zombie-gpu.test.ts builds real views: `createZombieGpuView(body, {})`, `view.applyMaterial({...m, grain: 0.5}, light)`, assert `view.uniforms.meltCfg.value.w === 0.5` and the record lane (as 'syncRecord lands a view's light picks...' reads it) |

Whole-file note: the rest is shader-string assertions (out of scope).

## src/lab/sdf-zombie/webgpu/zombie-gpu-burn.test.ts
Reads: src/lab/sdf-zombie/webgpu/zombie-gpu.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 14 | declares the burn uniforms | 8 | RESTATES | eight declarations; every one is read as `u.<name>` elsewhere, so tsc already fails on a missing one |
| 19 | binds the burn uniforms last, same order as the WGSL tail (the `<name>: u.<name>,` and lightListCfg pins) | 9 | KEEP (unsure) | a WGSL param with no key at the call site is bound to `float(0)` with only a console error, GPU-only; the pins hold key PRESENCE (not order, see finding 2). The WGSL-order half of the block is on a shader string, out of scope |
| 39 | carries the body burn state into the crowd record | 3 | CONVERT | `writeViewRecord` is exported and already tested: set `u.burnCfg.value` to (0.6, 2.5, 0.25), write, read the burn lanes back (crowd-records.test.ts 'carries the burn ramp...' covers the record side only) |
| 47 | binds lightListCfg then the list node after the burn tail | 4 | STALE | asserts KEY ORDER in an object literal; three 0.186 binds by name, so the order cannot matter. Keep one presence pin for `lightList:` with the line-19 group if that group is kept |
| 56 | lightListCfg default and list routing (a: default is zero) | 1 | RESTATES | a literal; `defaultUniforms(...).lightListCfg.value` is a one-line behavioural check if wanted (baked-chunks.test.ts does it for its own material) |
| 56 | lightListCfg default and list routing (b: `sources?.lightList?.node`, two `opts.lightList?.node`) | 2 | KEEP (unsure) | the list is the 20th positional argument of createMarchMaterial; omit it and that material silently reads the empty fallback list (unlit bodies, or a refine twin lit differently from its body) |

Whole-file note: file header's stated reason (positional binding) is wrong for the installed three;
rewrite it if the line-19 group stays.

## src/lab/sdf-zombie/strand-wiring.test.ts
Reads: src/lab/sdf-zombie/webgpu/zombie-gpu.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 70 | uploads the strand row wherever it uploads the other prim rows | 2 | CONVERT | the documented bug (row packed, never uploaded) is real, but "no seam to call" is out of date: zombie-gpu.test.ts reads rows off a real view's data texture ('writes the TRANSFORMED control point into the bend row'); build a view and a chunk view from the strand fixture and compare ROW_PRIM_STRAND with `packBody(...).primStrand` |

Whole-file note: other blocks assert on WGSL constants, numeric field behaviour, or .blob data (out of
scope). After the conversion the `readFileSync` import is still needed for the .blob reads.

## scripts/march-private-seed-guard.test.ts
Reads: wound-masks.wgsl.ts, surface.wgsl.ts, zombie-gpu.ts, deferred-sdf.ts, sdf-layer.ts, march-private-reads.ts (under src/lab/sdf-zombie/webgpu/)
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 21 | the march body really does write a private declared only in MARCH_NORMAL_OUT | 2 | CONVERT | both files only hold WGSL strings: import the exported constants and match on those (a shader-string assertion, which is wanted) instead of reading the .ts files |
| 28 | the forward chain seeds with marchNormalRead | 1 | CONVERT (unsure) | the header says wgslFn is opaque, but three's `nativeFn` returns a proxy over the FunctionNode, whose `includes` is a plain array: walk `marchBody` (exported) down its one-edge chain and assert the root `toBe(marchNormalRead)`. If the proxy does not expose `includes`, this is KEEP |
| 32 | the DEFERRED surface chain seeds with the same node, not [] | 2 | STALE | the incident this guards (cd8d8d8a, found 2026-09-21) is on the deferred route, which is paused. It is the cheapest guard on that route; restore (or convert like line 28) when deferred resumes |
| 39 | nobody builds a second copy of the declaring node | 4 | CONVERT | count `wgslFn` calls whose source is MARCH_NORMAL_OUT after importing the modules, with the `vi.mock('three/tsl')` wrapper from flag-off-node-ids.test.ts; covers every file, not the three named |

Whole-file note: file is entirely text pins (9).

## src/lab/sdf-zombie/webgpu/normal-gradient-reference.test.ts
Reads: src/lab/sdf-zombie/webgpu/game-seams-debug-probe.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 297 | the wound-coverage probe sizes its buckets by the codes and leaves split pixels to their own region | 6 | RESTATES | the decision is `ngCoverageClass`, tested three blocks up; these pin that a debug readback probe calls it, in its minified spelling. If the probe judged split pixels against sdBody it would report loud false mismatches, not hide a bug |

Whole-file note: everything else in the file is behavioural.

## src/lab/sdf-zombie/webgpu/game-head-damage.test.ts
Reads: src/lab/sdf-zombie/webgpu/game-flail.ts, src/lab/sdf-zombie/webgpu/game-main.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 92 | the flail falls through to its plain crater when the ladder declines (a: the `if (region && deps.headHit?.(...))` line, the `?? true` in game-main) | 2 | KEEP (unsure) | if the flail `continue`d whatever headHit returned, a split-open head would take no flail wound at all; `createFlail` has no test harness (game-flail-tear.test.ts is text pins too) and the `?? true` is inside main() |
| 92 | the flail falls through... (b: the `headHit?(...): boolean` signature) | 1 | RESTATES | a type signature; tsc |

Whole-file note: the leaf's side (hit() returns false on a split head) is covered behaviourally in the
same describe; only the flail's reaction to that false is pinned by text.

## src/lab/sdf-zombie/webgpu/crowd-type.test.ts
Reads: src/lab/sdf-zombie/webgpu/crowd-type.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 58 | never zeroes the tile gate on overflow | 2 | CONVERT | the 2026-09-14 GPU hang is worth guarding, but `not.toContain('tileCfg.value.x = 0')` misses `.set(0, ...)`; the overflow fixture at line 416 ('a budget-culled instance is drawn in neither batch') already syncs past the group budget on a real CrowdType: assert `t.uniforms.tileCfg.value.x` is unchanged after that sync |

Whole-file note: with this converted the `?raw` import of crowd-type goes.

## src/lab/sdf-zombie/webgpu/humanoid-volume.test.ts
Reads: src/lab/sdf-zombie/webgpu/humanoid-volume.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 542 | keeps the hard host endianness guard for r16f-le distance | 1 | RESTATES | pins that an `if (!HOST_IS_LITTLE_ENDIAN)` line exists; passes if its body is emptied, and the host it guards (big-endian WebGPU) is not one the game runs on. The `expect(HOST_IS_LITTLE_ENDIAN).toBe(true)` beside it is behavioural and stays |

Whole-file note: the other readFileSync calls read the manifest and volume data (out of scope).

## Totals

45 it-blocks carry in-scope assertions; 11 of them mix kinds, giving 57 rows. "Rows" counts a split
block once per verdict it contains.

| Verdict | Rows (it-blocks or assertion groups) | Assertions |
| --- | --- | --- |
| KEEP | 9 (7 marked unsure) | 26 |
| COVERED | 3 | 8 |
| RESTATES | 19 | 67 |
| STALE | 4 | 11 |
| CONVERT | 22 (1 marked unsure) | 100 |
| Total | 57 | 212 |

Of the 100 CONVERT assertions, 70 are seed-pass.test.ts and rest on one unverified claim: that the
existing `sdf-layer.test.ts` fake renderer can host the seed mesh. Check that first.
