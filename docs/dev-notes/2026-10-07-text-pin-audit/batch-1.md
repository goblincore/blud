# Text-pin audit, batch 1

Read-only audit. Nothing was run; verdicts come from reading each test, its comments and the pinned source.
A block that mixes kinds is split into rows `123a` / `123b` (same `it(` line). "Pins" counts in-scope `expect()`
calls only (a loop of four counts as four).

Finding that drives most of the goo-layer verdicts: the claim repeated in `goo-layer.test.ts` that "render() needs
a live WebGPURenderer" is no longer true. `src/lab/sdf-zombie/webgpu/goo-upload.test.ts` already builds a real
`createGooLayer` against a 10-line stub renderer (`setRenderTarget`, `setClearColor`, `getClearColor`,
`getClearAlpha`, `render(scene)`), and runs the real `sync()` and `render()`. Every CONVERT below that says
"goo fixture" means that fixture, extended to record the calls it currently ignores (target passed to
`setRenderTarget`, args of `setClearColor`, the scene and the quad's `material` at each `render`).

## src/lab/sdf-zombie/webgpu/goo-layer.test.ts
Reads: src/lab/sdf-zombie/webgpu/goo-layer.ts, game-tick.ts, lab-main.ts, game-seams-fx.ts, game-seams-spawn-goo.ts, game-main.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 113 | bypasses both blur passes entirely at blurPx = 0 | 5 | CONVERT | goo fixture: `setBlurPx(0)`, `render()`, assert no `setRenderTarget` on the blur pair and the surface quad uses the raw material |
| 123a | the surface reads the blurred buffer (first 3 pins) | 3 | RESTATES | constructor-argument strings; two of them are re-pinned at line 303 and 1043 |
| 123b | ...and the pair rides the density size (last 3 pins) | 3 | CONVERT | lazy-first-clear trap and resize: goo fixture records the 4 init `setRenderTarget` calls on first render, and `debugTargets` sizes after `setSize` |
| 242 | exposes absorb/spec/gloss/rim on the layer interface | 4 | RESTATES | `setX(` exists; tsc already enforces the `GooLayer` interface and line 249 subsumes it |
| 249 | clamps all four setters to the range the shader produces | 5 | CONVERT | documented clamp trap; goo fixture: `layer.setGloss(1e9); expect(layer.gloss).toBe(400)` etc. (getters exist for all five) |
| 303 | builds a material per (mode x blurred) combination | 3 | RESTATES | table-literal shape; no stated hazard, third pin duplicates line 118 |
| 312 | overlay materials neither test nor write depth, transparent | 1 | CONVERT | regex is not even scoped to makeOverlayMat; goo fixture can read the flags off the quad material rendered in overlay mode |
| 316 | overlay materials do not bind a depthNode | 1 | CONVERT | must-not-come-back, but observable: quad material in overlay mode has no `depthNode` |
| 323 | retires setDepthTest in favour of setMode | 2 | STALE | `not.toContain` for an API removed long ago (tsc would flag any caller); the `setMode(` pin is a signature restatement |
| 328 | defaults to overlay, the shipped answer to the depth blocker | 1 | STALE | stated reason is gone: the game now ships `setMode('depth')` (game-main.ts:5020); if the default still matters, `expect(layer.mode)` in the goo fixture |
| 344 | the game page syncs the density quads every frame | 1 | STALE | duplicate of line 350, which asserts the same string is present (`sync > -1`) and its order |
| 350 | the game page syncs AFTER the camera is final | 3 | KEEP | missing/misordered `goo.layer.sync` in tick() renders an empty field silently (documented incident, five wasted sweeps); tick() has no unit seam |
| 359 | the lab still syncs too | 1 | KEEP (unsure) | same silent-empty-field failure on the lab page; lab-main has no seam, but it is a dev page where the loss is seen at once |
| 364 | the selection seam partitions droplets in BOTH sync fill paths | 2 | CONVERT | goo-upload.test.ts already syncs with a selection in both area paths but only compares old vs candidate; assert `mesh.count` equals the selected droplet count |
| 467 | with no gut droplets the blood colour is the original literal (2 src pins) | 2 | KEEP | gut mask must ride blue, not alpha (three forces colorNode alpha to opacity, silent; found only by A/B), and the fade weight must scale all three channels; TSL graph has no cheap behavioural read |
| 594 | every lever defaults to the shipped state | 5 | CONVERT | goo fixture: read `surfaceAtDensityRes`, `minTexelRadius`, `areaPriority`, `splatFadeTail`, `passGate` getters on a fresh layer |
| 602 | the low-res surface target carries no depth attachment, half-float | 2 | RESTATES | restates two constructor options; no hazard stated |
| 608 | the low DEPTH variant packs depth into alpha, never depthNode | 3 | CONVERT | goo fixture with `setSurfaceAtDensityRes(true)`, depth mode: the low quad's material has `depthWrite === false` and no `depthNode` |
| 617 | the upsample DEPTH variant is the only new place depthNode is bound | 3 | RESTATES | asserts presence only, not "only"; opt-in bench path |
| 624 | the low pass clears black with ALPHA 0 | 2 | CONVERT | goo fixture records `setClearColor(0x000000, 0)` before the low render and the restore with the previous alpha after |
| 632 | the density pass clear is untouched | 2 | RESTATES | the test's own comment says it is "not ours to restate"; two bare lines |
| 640 | passGate only skips work | 4 | CONVERT | goo fixture: `setPassGate({ blur: false })` with blurPx > 0 still picks the blurred surface material; `surface: false` renders nothing to the output |
| 650 | the item-1 branch returns after the upsample | 3 | RESTATES | three strings exist; proves neither the return nor the else arm |
| 659 | the minTexel skip is inert at 0 without touching the mist gates | 2 | CONVERT | goo fixture sim with `kind: 'mist'` droplets, both area paths: `mesh.count` excludes them at minTexelRadius 0 |
| 666 | sync still updates the fallMask buffer and draws only live instances | 2 | COVERED | goo-upload.test.ts "preserves all drawn bytes through shrinking, empty, growing and partition changes" (asserts `mesh.count`, fallMask values and update ranges) |
| 702 | exposes setGooPerf and reports the lever state in the goo getter | 3 | RESTATES | member names exist in two seam files; moved once already |
| 708 | keeps the perf seams OUT of setGooTuning | 4 | CONVERT | `createFxSeams(fakeCtx).setGooTuning({ surfaceAtDensityRes: true, minTexelRadius: 4 } as never)` with a recording `ctx.goo.layer`; assert no perf setter is called (the error message still says game-main.ts) |
| 1038 | defaults to the ORIGINAL path | 2 | CONVERT | goo fixture: `layer.reconstruction === 'original'`, then setter round-trip |
| 1043 | keeps the baseline materials and adds a parallel smooth table | 4 | RESTATES | table literals; first two duplicate lines 307-308 |
| 1052 | the smooth DEPTH material blends coverage but never writes depth | 5 | CONVERT | goo fixture, `setReconstruction('smooth')` + depth mode: captured quad material has depthTest true, depthWrite false, transparent true, depthNode set |
| 1064 | the smooth composite returns after the full-res draw | 4 | RESTATES | strings exist; does not prove the early return |
| 1073 | the candidate reports why the density-res seam is bypassed | 1 | RESTATES | one diagnostics field name |
| 1077 | reports source, density and output resolution separately | 6 | RESTATES | diagnostics field text; if wanted, read `layer.densityDiagnostics` in the goo fixture instead |
| 1086 | tracks the real composite destination for the coverage footprint | 2 | CONVERT | goo fixture: `setOutputTarget(rt)`, `render()`, `densityDiagnostics.outputWidth === rt.width` |
| 1091 | extra connection blobs ride the SAME density instancer and cap | 5 | CONVERT | goo fixture: `setExtraBlobs`, `sync`: `mesh.count` grows by the extras, stops at `particleCap`, is 0 extra when `selection.extras` is false |
| 1104 | defaults to no extras | 1 | CONVERT | `layer.extraBlobCount === 0` on a fresh layer |
| 1236a | per-stream defaults OFF (first 2 pins) | 2 | CONVERT | `layer.perStream === false`, `layer.streamRamp === 0` on a fresh layer |
| 1236b | ...the shipped density material is UNCHANGED (3rd pin) | 1 | STALE | duplicate of the colorNode pin at line 483 |
| 1246 | exposes the switch and the ramp on the layer API | 5 | RESTATES | one-line setter/getter bodies; tsc covers existence, the 0..4 clamp is a one-line getter test if wanted |
| 1254 | exposes the raw-channel diagnostic, default off (3 src pins) | 3 | RESTATES | setter/getter text for a capture-only debug switch |
| 1263 | routes each instance into its stream channel, uploads the mask only while on | 6 | CONVERT | goo fixture: `setPerStream(true)`, `sync`: read the `streamMask` attribute values and update range; off leaves it untouched |
| 1273 | runs the extra density/blur/combine passes only under the switch | 8 | CONVERT | goo fixture: count/identify `render` targets with per-stream off vs on (three extra targets only when on); the remaining label and uniform strings are restatement |
| 1287 | the lazy first clear covers every new target | 2 | CONVERT | submit-rejection trap: first per-stream `render()` must `setRenderTarget` each of the 4 new targets with the empty scene, and again after `setSize` |
| 1292 | the surface picks the per-stream field via a separate material table | 4 | RESTATES | identifier and constructor-argument strings |
| 1299 | the GAME never turns it on | 3 | STALE | reads only game-main.ts and goo-layer.ts, but the game's goo defaults now live in goo-presets.ts (`GAME_GOO_DEFAULTS`) and the seams in game-seams-*.ts, so it passes vacuously; the 3rd pin looks for `GAME_GOO_DEFAULTS.perStream` in a file that never held it |

Whole-file note: 136 in-scope assertions in 43 it-blocks. The describe blocks "goo blur wiring", "goo overlay
mode wiring", "goo perf seams", "smooth reconstruction wiring" and "per-stream wiring" are entirely text pins on
goo-layer.ts; after the conversions each keeps no `readFileSync`. What must stay as text: lines 350, 359 (tick
order, in game-tick.ts / lab-main.ts) and the two src regexes at 483 and 489. The header comments at lines 107-110
and 496-501 ("cannot run without a WebGPU device") should be corrected when the conversions land. Line 666 is
COVERED for `quads.count` and the fallMask contents; `needsUpdate` itself is not asserted anywhere (add
`attribute.version` to the goo-upload test if that matters).

## src/lab/sdf-zombie/webgpu/earlyz/pipeline-watch.test.ts
Reads: node_modules/three/src/renderers/common/Pipelines.js, Renderer.js, webgpu/WebGPUBackend.js, webgpu/utils/WebGPUPipelineUtils.js
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 50 | a failed pipeline sets backend.get(pipeline).error on both paths | 2 | KEEP | the watch reads a private three field; if an upgrade drops it, a failed front-to-back pipeline is never reported and the fallback never fires |
| 55 | compileAsync resolves on a failed pipeline | 1 | KEEP (unsure) | real contract (the async test at line 162 assumes resolve, not reject), but it pins a three.js COMMENT; re-point it at the `finally { resolve(); }` code |
| 58 | the backend draw skips an errored pipeline | 1 | KEEP | the reason a failed pipeline is invisible rather than a crash; private three behaviour, no GPU in CI |
| 61 | getForRender leaves renderObject.pipeline set on a cache hit too | 3 | KEEP | the hook reads `ro.pipeline` after the call; the fake renderer in this file is only valid while three does this |
| 70 | the renderer owns `_pipelines` and calls getForRender for every draw and compile | 3 | KEEP | the wrap point is a private member; if three stops routing through it the watch goes silently blind |

Whole-file note: these pin third-party source, not project source, so they never break on a project refactor and
only move when three is upgraded (the `REVISION` test at line 47 fails first and tells the reader to re-verify
exactly these points). They are the validity proof for the hand-written fake renderer the behavioural tests use.

## src/lab/sdf-zombie/head-split-cpu.test.ts
Reads: ./webgpu/game-flail.ts, ./webgpu/game-seams-fx.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 413a | the flail's body crater and its head-region read (5 flailSrc pins) | 5 | KEEP | a flail hit on an opened head half must be stamped at the un-warped point or the wound hangs in the air / misreads the region; `strike()` is a closure inside `createFlail` (three, viewmodel) with no harness, unlike the rod, axe, gun and blast in (d)-(g) |
| 413b | the dev stampWoundAt seam (3 seamSrc pins) | 3 | KEEP (unsure) | same hazard on the `__sdfGame` seam the capture gates stamp through; dev-only path, and `createFxSeams(ctx)` might take a fake ctx cheaply |

Whole-file note: everything else in the file is behavioural. A real fix for 413a is to lift the
probe/region/wound selection out of `strike()` into flail-strike.ts as a pure function, which is more than a tiny
extraction.

## src/lab/sdf-zombie/webgpu/humanoid-view.test.ts
Reads: src/lab/sdf-zombie/webgpu/humanoid-view.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 341 | imports writeWounds from zombie-gpu and never defines its own texel writer | 3 | RESTATES | an import line and a call exist; a "one implementation" style rule, no failure a wrong implementation would trip |

Whole-file note: after deletion the `readFileSync` import (line 13) has no other user.

## src/lab/sdf-zombie/webgpu/hand-volume.test.ts
Reads: src/lab/sdf-zombie/webgpu/hand-volume.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 199 | refuses to run on a big-endian host | 1 | RESTATES | asserts the `if (!HOST_IS_LITTLE_ENDIAN)` line exists; no big-endian WebGPU host exists to hit it (the `expect(HOST_IS_LITTLE_ENDIAN).toBe(true)` beside it is behavioural and stays) |
| 274a | loadHandVolume uses the shared helpers (2 toContain) | 2 | COVERED | same file: "verifies the binary sha-256 and rejects a tampered payload" (line 177) and "builds a RedFormat/HalfFloatType 3D texture from the raw bytes" (line 146) |
| 274b | ...the old private twin is gone (not.toContain) | 1 | STALE | `not.toContain` for a private function removed in a past dedupe |

Whole-file note: `readFileSync` stays; it also loads the checked-in manifest and binary (data, out of scope).

## src/lab/sdf-zombie/webgpu/flail-strike.test.ts
Reads: ./game-flail.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 232 | a head-region hit credits the head's share of the meter and throws head flesh (2 flailSrc pins) | 2 | KEEP (unsure) | `flailWound` returns the scale and flesh kind (tested), but only these lines show `strike()` applies them; dropped, a split head collapses about 3x too fast with no test failing; same no-harness closure as head-split 413a |

Whole-file note: the rest of the block and file is behavioural. The same extraction suggested for head-split
413a would cover these two pins.

## src/lab/sdf-zombie/webgpu/kit-lights.test.ts
Reads: src/lab/sdf-zombie/webgpu/game-main.ts
| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 94 | is scaled by the flashlight gate in the game loop | 1 | CONVERT | real past bug (ungated twin lit kitted enemies before the torch pickup); move the one line into e.g. `syncKitBeam(ctx)` beside `flashlightGate` in game-dynamic-light.ts and test it with a fake ctx at gate 0 and 1 |

Whole-file note: this is the file's only `readFileSync` use; the import and its `@ts-expect-error` go with it.

## Totals

Rows = it-blocks, with the four mixed blocks (goo-layer 123 and 1236, head-split 413, hand-volume 274) counted
once per verdict. 54 it-blocks, 58 rows, 164 assertions.

| Verdict | it-blocks (rows) | Assertions |
| --- | --- | --- |
| KEEP | 11 | 26 |
| COVERED | 2 | 4 |
| RESTATES | 17 | 54 |
| STALE | 6 | 9 |
| CONVERT | 22 | 71 |
| Total | 58 | 164 |

Of the 11 KEEP rows, 5 are the three.js contract pins in pipeline-watch.test.ts, and 4 are marked "(unsure)":
goo-layer 359, pipeline-watch 55, head-split 413b and flail-strike 232.
