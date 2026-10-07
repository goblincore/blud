# Text-pin audit, batch 2

Counting rule: "Pins" is the number of in-scope assertions that execute. A loop over a literal needle list counts once per needle; a loop over a data table (`DYNAMITE_KEYS`) counts once. Where one `it` block mixes verdicts it is split into rows `a`/`b` with the same line number.

## src/lab/sdf-zombie/webgpu/blood-compare-main.test.ts
Reads: src/lab/sdf-zombie/webgpu/blood-compare-main.ts (as `src`; not in the batch list but it is the main subject), sdf-blood-compare.html, vite.config.ts

Context for every row: the pinned file is a 2,672-line lab comparison page whose logic lives inside one `bootstrap()` closure. Only `renderVariantFrame` and a few constants are exported, and those have real mock/value tests (lines 26, 52, 97 and the `SHAPES`/`SPLASH_*`/`COMPARE_*` value assertions), which are out of scope and stay.

| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 38 | html shell mounts the page module and the UI slots | 5 | RESTATES | script path and four element ids exist; a missing slot throws at page boot, a wrong path fails the dev server |
| 46 | vite registers the page as a build entry | 1 | RESTATES | one config line exists; the page is a dev-only lab tool, nothing ships from the vite build |
| 117a | page actually calls the exported ordering function | 1 | KEEP (unsure) | the mock-order tests at 52/97 only mean something if the page routes through `renderVariantFrame`; inlining it loses the sync and draws no blood (the documented blocker); call site is inside the closure |
| 117b | (same block) exactly one `createBloodSim(` | 1 | RESTATES | call-site count; the page now has a literal second sim (`flowSim`), so the count no longer expresses "one sim" |
| 125 | uses the shared production blood + goo + view functions | 9 | RESTATES | nine identifiers appear somewhere in the file (an import line satisfies it) |
| 135 | uses the game blood view options and visibility | 11 | RESTATES | option literals and call strings exist; wrong values elsewhere or a dead call pass |
| 150 | exposes the four variants incl. baseline original | 4 | RESTATES | `id: '...'` substrings; `VARIANTS` is exported and its length is already asserted by value in the same block |
| 158 | separates 400x300 source grid from 800x600 output | 2 | RESTATES | two call lines exist; the sizes themselves are asserted by value on the exported constants in the same block |
| 165a | labels the split a full-size wipe | 3 | RESTATES | the word `wipe`, a label, and one arithmetic line exist |
| 165b | (same block) old half-canvas blit must be gone | 1 | STALE | `not.toContain` of an exact line removed long ago; any reintroduction would be worded differently |
| 173 | starts paused: loop stopped after one present | 3 | RESTATES | counts `setLoopRunning(true)` call sites (== 2); breaks on a third play path, passes if the stop moves |
| 183a | seeds deterministically: no `Math.random` anywhere | 1 | KEEP (unsure) | a `Math.random` in the page would make the two sides of a wipe differ for a reason other than the axis under test, silently; sim driving is closure-only |
| 183b | (same block) `makeSeededRng(seed)`, `seed, frame, scenario` | 2 | RESTATES | two substrings exist |
| 189a | tags every emission site with a stable stream id | 2 | RESTATES | `streamSeq++` and `scenarioStream` appear; says nothing about "every site" |
| 189b | (same block) no `tagNew` helper remains | 1 | STALE | `not.toContain` for a helper deleted in an early revision |
| 196 | offers replay, pause/step, speed, orbit, ... | 11 | RESTATES | UI labels and identifiers exist |
| 205 | reports source/density/output, exposes capture API | 5 | RESTATES | state-object field lines exist |
| 213 | never claims visual success in source | 2 | STALE | pins a prose caveat string ("not verified during the training window") and a phrase that only occurs in a header comment |
| 220 | exposes exactly two shapes, separate from filters | 3 | RESTATES | three row labels exist; the shape ids are asserted by value in the same block |
| 229 | defaults to the Impact splash frozen at crown | 3 | RESTATES | three `let` initialisers / calls exist; a lab default, no hazard |
| 238 | splash at the SAME wound origin as the slug burst | 1 | RESTATES | one emit call line; origin/direction are asserted by value in the same block |
| 247 | uses the production impact-splash module, shared seed | 3 | RESTATES | two identifiers plus a duplicate of the line-244 pin |
| 255 | compares shapes at the SAME elapsed event time | 6 | RESTATES | function names and call strings exist; none shows both branches read the same clock |
| 271 | prefers the burst scenario when switching to Current | 3 | RESTATES | regex anchored on a comment (`SHAPE COMPARISON PREFERS THE BURST`) plus a `let` initialiser |
| 278 | states the filter explicitly, disables it for splash | 4 | RESTATES | label/field strings; one duplicates line 226 |
| 285 | freezes at the crown moment, loops, has a reset | 5 | RESTATES | identifiers and button labels exist |
| 294 | renders the splash without the current sim/goo | 4 | RESTATES | `clearSim();` and three call strings exist anywhere in the file; ordering claimed in the comment is not checked |
| 303 | leaves a status legend and time indicator | 4 | RESTATES | one html id and three label strings |
| 310 | exposes splash controls on the global API | 5 | RESTATES | five identifiers appear somewhere |
| 322 | adds a mode axis, RETAINS surface/shape controls | 6 | RESTATES | row labels; three duplicate pins at 224/225/118 |
| 333a | lists sharp + sampled + efficient, dispatches on id | 4 | RESTATES | identifiers and one comparison string exist |
| 333b | (same block) no "unavailable until task 2" | 1 | STALE | `not.toContain` for a placeholder label from a finished task |
| 343 | fixed-second presets, shows milliseconds | 7 | RESTATES | identifiers and row labels |
| 354 | records one deterministic timeline, never re-steps | 6 | RESTATES | six names exist; "never re-steps the live sim" is not checked by any of them |
| 363 | shades each sample separately, premultiplied | 8 | RESTATES | seven names exist; the `not.toContain('accumulateDensity')` is vacuous (identifier never existed in the file's history) |
| 375 | keeps static pools/guts sharp, background normalized | 5 | RESTATES | five variable names exist |
| 384 | sample/radius limits and trailing interval in diag | 4 | RESTATES | diagnostic labels |
| 391 | three repeatable shutter fixtures via prod emitters | 5 | RESTATES | scenario labels and two identifiers |
| 399 | reuses the wipe view for reference vs sharp | 9 | RESTATES | call strings and four button labels (duplicates of 196) |
| 412 | task-2 candidate is a bounded velocity-streak resolve | 13 | RESTATES | imported names, function names, one condition string; "lazily built / allocation-free" is not demonstrated by any of them |
| 433 | exposes the shutter API (title says "unavailable") | 6 | RESTATES | API field names; the title contradicts the block at 333 (candidate is available) |
| 442 | ships the flow OFF so the baseline look is unchanged | 3 | RESTATES | three `let` initialisers on a lab page the game never reads |
| 449 | builds a SECOND sim without a second factory call | 4 | RESTATES | declaration/function names; the count pin duplicates line 120 |
| 458 | threads the shared curl volume into stepBlood | 4 | RESTATES | four names exist; threading not shown |
| 465 | wipes baseline against flow, SAME filter both sides | 4 | RESTATES | two exact call lines and a label; exact-line pins break on any signature change |
| 472 | applies the soft fade to both translucent families | 7 | RESTATES | two setter names and five slider labels |
| 483 | ships the packing OFF so the baseline is unchanged | 6 | RESTATES | default-object field lines exist |
| 494a | threads the emission pack through every spawn site | 4 | RESTATES | type field and call strings; one is a full call line with literal coordinates |
| 494b | (same block) pack is set BEFORE the t=0 prime | 1 | KEEP (unsure) | if `st.pack` is assigned after `primeScenarioInto`, the t=0 burst is emitted unpacked and the "dense" side silently shows baseline; both live in the closure |
| 505 | rebuilds the second sim with the current packing | 4 | RESTATES | function names and a partial call string |
| 512 | wipes baseline against dense on the SAME filter | 5 | RESTATES | exact call lines and a label |
| 521 | applies the goo half of the pack, exposes both halves | 10 | RESTATES | setter call strings and six slider labels |
| 533 | records the packing in state(), exposes setDensity | 6 | RESTATES | field names exist |
| 542 | carries the per-stream switch through API/state/panel | 8 | RESTATES | field, label and default lines exist |
| 556 | adds a per-stream wipe axis | 4 | RESTATES | condition, two spread literals, a label |
| 564 | installs labeled pass timing, labels candidate passes | 11 | RESTATES | imported names and pass-label strings |
| 577 | drives the frozen frame by hand in the bench | 6 | RESTATES | function name, two calls, three result field names; "never advances the sim" is not checked |
| 587 | separates presentation cadence from shutter interval | 5 | RESTATES | signature fragment and identifiers |

Whole-file note: 52 of 55 `it` blocks contain text pins; 272 in-scope assertions, 264 of them RESTATES. After deletion the `html` and `vite` reads (lines 22-23) go; `src` stays only for the three KEEP rows (117a, 183a, 494b), which could be gathered into one small "closure tripwires" describe. The describes from "Current slug vs Impact splash" (219) downward keep only their value assertions on `SHAPES` / `SPLASH_*` / `VARIANTS`; "shutter mode", "flow axis" (442-480), "density axis" (except 494b) and "task 3 bench" become empty. If the owner regards the comparison page as a throwaway spike tool, the three KEEPs are the first candidates to drop as well.

## src/lab/sdf-zombie/gun-wet-lip.test.ts
Reads: src/lab/sdf-zombie/webgpu/character-view.ts, src/lab/sdf-zombie/webgpu/game-actor.ts, src/lab/sdf-zombie/webgpu/game-seams-weapon-aim.ts (all via `?raw`)

| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 59 | upload sets bit 4 only for a live wet lip ... switch drops it | 1 | KEEP (unsure) | `rows.map(w => wetLipUpload(w))` is the 16th positional array to `writeWounds`; passing `!!w.wetLip` instead silently bypasses the A/B switch and the cloth/decal refusal that the behavioural half of this block tests; character-view has no GPU-free seam |
| 72a | gun stamps it on pellets and slugs, zombie-class only | 3 | CONVERT | `gunWetLip` is a two-line closure in game-actor.ts (`if (soldierDamage || softTarget) return; wetLipWound(...)`); move it to torn-lips.ts as e.g. `stampGunWetLip(wound, kind, { soldierDamage, softTarget })` and assert the soldier and soft target get no `wetLip` while a zombie pellet/slug does |
| 72b | (same block) the seam A/Bs it: `setWetLip(on: boolean) {` | 1 | RESTATES | a debug seam method signature exists; the switch itself is tested behaviourally at lines 66-69 |

Whole-file note: the `it` blocks at 82, 91 and 97 assert exported WGSL constants and are out of scope. After 72 is converted, the `actorSrc` and `seamSrc` imports (lines 15-16) go; `viewSrc` stays for line 70.

## src/lab/sdf-zombie/webgpu/demo-scenario-determinism.test.ts
Reads: src/lab/sdf-zombie/webgpu/game-seams-bench.ts, scripts/sdf-demo-hash.mjs

| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 35 | resets the gather cadence phase before recording | 1 | KEEP | without `gatherTick = 0` in `demoScenario` two identical runs diverge at frame 0 (documented incident, 240 vs 35 instances); reproduces only on a real GPU across two page loads |
| 39 | does NOT reset the accumulated dynamic layer | 2 | KEEP | adding `gather?.reset()` / `pendingGather = null` here (as `bench` does 180 lines above) makes runs agree by zeroing the probe layer; measured 2026-09-18; the tempting "fix" must not come back |
| 49 | drives frames by hand rather than racing the rAF loop | 1 | KEEP (unsure) | recorder would race rAF and frame set would depend on tab visibility; GPU-only to reproduce, but no recorded incident and the `ab` gate would show it on first run |
| 57 | refuses a recording whose march target is empty | 1 | RESTATES | pins an error-message substring in the script; passes if the condition is wrong or the string survives in a comment; no incident recorded for this guard |
| 61 | refuses a recording whose dynamic probe layer is empty | 1 | KEEP (unsure) | same weak shape as 57, but this guard is the one that stops the 2026-09-18 "pass by comparing two all-zero layers" failure, and the script cannot be imported (top-level CLI side effects) |

Whole-file note: file is entirely text pins. `memberBody()` scopes the first three to the `demoScenario` member, which matters: the forbidden lines legitimately exist in the sibling `bench` member. It carries one extra in-scope `expect(start).toBeGreaterThan(-1)` per call (not counted). If both 57 and 61 are to be kept honest, a small `recordingLiveness(march, dyn)` helper in a sibling `.mjs` would let them become value tests, at the cost of a new wiring gap.

## src/lab/sdf-zombie/entrails-gates.test.ts
Reads: src/lab/sdf-zombie/webgpu/zombie-gpu.ts

| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 105 | live uniform pack sources surfCfg3.w from visceraAmp | 1 | KEEP (unsure) | positional 4-vector pack inside `applyMaterial`; `.w` was a hard-coded 0 spare before, and a wrong slot silently turns viscera off (or breaks amp-0 parity); no test constructs the GPU view and reads the uniform |

Whole-file note: the other three blocks in "gate 1a" (116, 125, 135) assert the exported `MARCH_BODY` / `TISSUE_RAMP` shader strings and are out of scope; gates 1b-3 are behavioural. `body-grain.wgsl.test.ts` (another batch) slices the same `applyMaterial(m, light) {` body from zombie-gpu.ts, so a shared decision on that function is worth making once.

## src/lab/sdf-zombie/webgpu/dynamite-panel.test.ts
Reads: src/lab/sdf-zombie/webgpu/game-dynamite-tuning.ts

| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 26 | every key in the table is a case the page setter handles | 1 | CONVERT | hazard is real (a slider key the setter ignores shipped twice), but `applyDynamiteTuning(ctx, patch)` is now an exported function taking a context: for each `DYNAMITE_KEYS` entry call it on a stub ctx with a non-default value and assert `dynamiteTuningValues(ctx)[key]` moved |
| 49 | the read-back covers every key the panel can move | 1 | CONVERT | same round-trip test covers it: `dynamiteTuningValues(stubCtx)` must have every key as an own, finite property |

Whole-file note: the stub needs `render.postAa` (two setters and two fields), `bake`, `gibs`, `vfx` (with an `explosionVfx` fake whose `setTuning` merges into `tuning`), `lighting`, `world.actors: []` and `panels: {}`. The current text pin is looser than it looks: its second regex (`name: 'word'`) accepts any `key: 'string'` pair in the function body as "handled", and a `case` that writes the wrong field passes. The header comment's claim that "no runtime check can see" the failure was true while the setter lived in `main()`; it stopped being true at the 2026-09-17 extraction. Blocks 57 and 64 are behavioural and stay.

## src/lab/sdf-zombie/hand-volume-pose.test.ts
Reads: src/lab/sdf-zombie/hand-volume-pose.ts

| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 423 | source guard: derives only from volume frame and contract | 2 | COVERED | `bakedDynamitePose(hand, prop)` is a pure two-argument function whose exact output is asserted in the same file: "identity hand seats the authored grip point exactly at prop.gripLocal" (309), "a 90° hand quaternion rotates BOTH the root position and the bundle axis" (325), "modelGripOffsetM moves the GLB root opposite model +Y from the world grip" (348); a version that consulted `handPropPoses` / `PROP_MESH` seats could not satisfy them |

Whole-file note: `readFileSync` stays imported; line 275 uses it to load a JSON asset (out of scope).

## src/lab/sdf-zombie/webgpu/soft-fade.test.ts
Reads: src/lab/sdf-zombie/webgpu/soft-fade.ts

| Line | it-title (shortened) | Pins | Verdict | Why (one line) |
| --- | --- | --- | --- | --- |
| 52 | reads scene depth from the viewport depth texture, never a bare fragment depth | 3 | KEEP | a bare `linearDepth()` / `depth()` on the scene side makes the fade identically zero and the whole effect transparent black with no error (wildfire teardown trap); the TSL node graph cannot be evaluated without a GPU; the pin strips comments first and targets the 80-line helper that exists to own this trap |

Whole-file note: the best-built pin in the batch: small single-purpose target file, comments stripped, asserts absence of the dangerous call rather than presence of a line.

## Totals

64 `it` blocks contain in-scope assertions (291 assertions). Seven blocks are mixed and are split, giving 71 rows.

| Verdict | Whole it-blocks | Split parts of mixed blocks | Assertions |
| --- | --- | --- | --- |
| KEEP | 7 (4 marked unsure) | 3 (all unsure) | 13 |
| COVERED | 1 | 0 | 2 |
| RESTATES | 46 | 7 | 266 |
| STALE | 1 | 3 | 5 |
| CONVERT | 2 | 1 | 5 |
| Total | 57 | 14 (from 7 blocks) | 291 |

By file: blood-compare-main 272 assertions (264 RESTATES, 5 STALE, 3 KEEP); gun-wet-lip 5; demo-scenario-determinism 6; entrails-gates 1; dynamite-panel 2; hand-volume-pose 2; soft-fade 3.
