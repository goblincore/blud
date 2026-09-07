# Task 1 — Reconcile current main and make the core composable

**Status: COMPLETE** (original run hit its 45-minute timeout after the
implementation and most checks; this continuation fixed the one remaining
defect, verified on real WebGPU, and removed the temporary probes).

- Branch: `codex/dispatch/2026-09-06-hybrid-deferred-m2-task-1-continue-1`
  (continuation of the timed-out `2026-09-06-hybrid-deferred-m2-task-1`,
  whose work is preserved at base `93904144`)
- Planning commit: `48fdabfb`; M1 merge source: `f25a31be`; main base `909b6a87`
- Continuation commits: `d8751448` (depth-write fix + regression tests),
  final evidence commit (this one)

## What was delivered

### Original run (93904144, timed out before GPU re-verification)

- Merge of reviewed M1 `f25a31be` into the task branch, preserving current
  main character-view/registry/soldier work.
- Composable core in `src/lab/sdf-zombie/webgpu/deferred-layer.ts`:
  `setOutputTarget`, `render(..., hooks?)` draw hooks, `setEnvironment`,
  `setFlashlightShadow` (task-4 reservation), plus
  `encodeSurfaceClass`/`decodeSurfaceClass` receiver metadata in
  `deferred-surface.ts`.
- Unit tests for output-target restoration, thrown draw hooks, present
  depth/sentinel, environment defaults, metadata round-trip (81 core tests).
- Composition diagnostics in `deferred-main.ts` (`presentComposition`),
  which exposed the defect below.

### Continuation (this branch)

**The defect.** `quadPass()` unconditionally set `mat.depthWrite = false`
AFTER `targetPresentMat` had been assigned `depthWrite = true` — the helper
undid the fixed-config material's write flag before its only compile. A
three `NodeMaterial` selects its fragment-depth output at graph compile time
from `depthWrite`/`depthNode`, so the owned-target present pipeline compiled
depth-less and forward geometry behind the body painted over it. Saved
evidence (`task1-composition.json` at 93904144): behind-body quad
`beforeLum 0.387 → afterLum 4` (incorrectly visible).

**The fix** (`deferred-layer.ts`). `quadPass(mat, opts?)` now takes the
`depthWrite` choice explicitly (default `false` preserves every other
fullscreen pass); the target-present pass opts in via
`quadPass(targetPresentMat, { depthWrite: true })`, so the flag holds at
construction, before the material's first render/compile. The canvas
presentation material keeps the M1 depthless config.

**Regression pin** (`deferred-layer.test.ts`). Three behavioral tests inspect
the material actually submitted to `renderer.render` (not internal refs):
the owned-target present material arrives with `depthWrite === true` and a
wired `depthNode`; the canvas present material stays `depthWrite === false`
/ `depthNode === null`; both hold across render order and
`setOutputTarget` flips.

**Probe cleanup** (`deferred-main.ts`). After green validation: removed the
temporary `debugForwardDraw()` canvas diagnostic and the
`forwardDepthTest={false}` diagnostic option (the constructed
`forwardMat.depthTest = true` default is re-pinned in
`presentComposition`). `presentComposition` is now exception-safe: an
idempotent `restore()` closure restores output target / quad visibility /
renderer target+autoClear and redraws the canvas on every exit path
(including probe-positioning throws).

## Interfaces (as specified by the plan)

- `encodeSurfaceClass(baseClass, receiver)` / `decodeSurfaceClass(encoded)`
  — low four bits keep classes 0..3, bit 4 = level-only;
  `encodeSurfaceClass(1,'level-only') === 17`, `decodeSurfaceClass(18) ===
  { baseClass: 2, receiver: 'level-only' }`, empty stays exactly 0. Invalid
  / non-integer base classes are rejected.
- `setOutputTarget(target | null)` — owned color+depth target; rejects
  layer-owned targets (read-while-write hazard), depth-less targets, and
  size mismatches at render time.
- `render(meshScene, sdfScene, camera, hooks?)` — hooks run once at their
  producer target with the sentinel clear submitted and `autoClear=false`;
  a throwing hook propagates and caller state is restored in `finally`; the
  M1 path is unchanged when no hooks are given.
- `setEnvironment` — ambient + distance fog for the lit stage only; M1
  defaults with fog OFF; raw surface outputs provably unaffected (hashes).
- `setFlashlightShadow` — validated + stored only; pinned by GPU test to
  change no output until task 4.

## Test evidence

Focused Vitest (`--maxWorkers=2 --minWorkers=1`), all green:

- `deferred-layer.test.ts` — 35 (incl. 3 new continuation regressions)
- `deferred-surface.test.ts` — 21, `deferred-lighting.test.ts` — 8,
  `deferred-sdf.test.ts` — 17, `zombie-gpu.test.ts`,
  `character-view.test.ts`, `bone-instancer.test.ts`
- Focused core total: **117 passed** in the final run.
- `npx tsc --noEmit` — clean at every commit.

## Real-GPU evidence (Chrome WebGPU via CDP, private 5322/9322)

`DEFERRED_SKIP_TIMING=1 LAB_VITE_PORT=5322 LAB_CDP_PORT=9322
scripts/deferred-check.sh` — **24/24 checks PASS** on the final cleaned
code (`docs/dev-notes/2026-09-06-hybrid-deferred-m1/validation.json`).

The previously failing composition check now reads
(`task1-composition.json`, 800x600, chest at px [390,306] class 2 flesh):

| probe | before lum | after lum | verdict |
| --- | --- | --- | --- |
| front quad (in front of chest) | 0.256 | 4.0 | wins against presented depth |
| behind quad (beside, on body) | 0.387 | **0.387** | **occluded by the presented body depth** (was 4.0 — the defect) |
| far quad in empty region | 0.0 | 4.0 | empty pixels present far depth (depth 1) |

`outputRestored: true`; canvas screenshot `task1-canvas-restored.png`.
All original M1 checks retained: coverage/resolve, light invariance,
bidirectional occlusion at both scales, wound depth/tissue determinism,
legacy-vs-deferred SDF depth parity (maxDiff 0), mode-switch cycles,
orb marker correspondence/occlusion, light count/color correspondence,
world-reconstruction centroid (1.26 px), one-trace-per-fragment shader
structure, environment defaults + fog invariance (surface hashes
untouched, restore exact), flashlight-shadow reservation (no output
change), no GPU or page errors.

## Process notes / lessons

- JS `return` evaluates its expression BEFORE `finally` runs: restoring
  only in `finally` made the first cleaned-code GPU run report
  `outputRestored: false`. Fixed by the idempotent `restore()` called
  before the report is built (finally re-invokes it for the throw path).
  Caught because the gate asserts the flag rather than trusting cleanup.
- Owned test servers/browser were verified stopped after every gate run
  (`lsof` on 5322/9322 empty on all exits, including the failed one).

## Unresolved issues

None known for task 1's scope. Downstream notes: `setFlashlightShadow`
is a validated reservation only — task 4 owns real shadow maps and
sampling; `setDebugView`'s lighting/debug outputs decode base classes
while the raw encoded value is retained for shadow selection.
