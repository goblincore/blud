# Task 1 — Selective shutter blur: game integration

Branch: `codex/shutter-blur-game-task-1` (isolated dispatch worktree)
Base: `85a6525028a0eb67de2ac47f2397931c76d5e2d8` (task-3 tip, merged lab work)
Scope: integrate the owner-accepted efficient shutter candidate into the active
SDF game (`/sdf-game.html`), ON by default at the accepted exposure, with
focused player/dev controls, tests, tsc/build and a real WebGPU smoke.
**No** merge, **no** push, no dispatcher metadata edit, no extracted asset.

## 0. Owner authorization

The owner reviewed the shutter lab and said: *"oh yeah i like it we can add it
in game ... basically the more pronounced the blur the better"*. The lab look
gate is satisfied. The screenshot `2026-09-17 01:21:58` (read natively) reports:

- effective exposure **44.44 ms** (320° at an explicit reference 20 fps);
- candidate **seed 200x150**, **24 taps**, **depth bias 0.020 m**;
- the dropdown says 1/30 but angle mode overrides it — `320/360/20 =
  44.444… ms` (1/22.5), which is what shipped;
- the max-streak slider read between presets, so **120 content px** was used
  initially with the cap raised to 400 (this is NOT an exact screenshot
  measurement — the diagnostic line does not print it).

## 1. Prerequisite check (Tasks 1–3)

`docs/dev-notes/2026-09-16-shutter-blur/TASK-1.md`…`TASK-3.md` and
`docs/superpowers/plans/2026-09-16-selective-shutter-blur.md` were read before
any edit. The accepted candidate is `src/lab/sdf-zombie/webgpu/shutter-blur.ts`
(24 stratified taps, single-owner seed, depth-gated destination resolve) plus
`goo-layer.renderLayer` (premultiplied working-linear layer). The inherited
limits recorded by tasks 1–3 were carried forward unchanged: one motion owner
per seed texel, residual fine comb, moving/static separation, mist sharp, and
`BLOOD_TRAIL.velScale` making gib-trail droplets nearly stationary. Inherited
focused tests were green before the first edit:

```
npx tsc --noEmit -> exit 0
npx vitest run shutter-* goo-layer goo-presets post-aa blood-compare-main
  -> 7 files / 222 tests passed (task-3 tip)
```

## 2. What landed

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/shutter-game-layer.ts` | **New** reusable game layer: owner-accepted defaults/presets, select/clamp helpers, query parsing, and the GPU lifecycle (layer target, stage target, CPU motion seed, one bounded resolve). Consumes the live `BloodSim` + final camera each presented frame; no timeline, no replay, no fixture. |
| `src/lab/sdf-zombie/webgpu/shutter-panel.ts` | **New** focused player panel: Blood motion blur on/off, Exposure (ms, with presets), Max trail length (content px). Algorithm/debug knobs stay off the panel. |
| `src/lab/sdf-zombie/webgpu/post-aa.ts` | **New** explicit `setCaptureStage(fn)` seam. The stage runs on the captured clean frame, after `chain()` and before SSCS/FXAA/VHS, and returns the target the rest of the chain reads. A set stage forces the captured (redirected) path. |
| `src/lab/sdf-zombie/webgpu/goo-layer.ts` | **New** `setSelection(GooSelection | null)` seam and `precompileLayer()`. `sync()` now filters droplets/splats/connection blobs by the selection in BOTH fill paths. `null` is the shipped one-pass pose, unchanged. |
| `src/lab/sdf-zombie/webgpu/shutter-blur.ts` | `SweepStampOpts.clampToAge` (no pre-birth streaks); aspect-preserving seed max clamp (the independent clamp returned 512×512 for a 960×540 density). Shared planner unchanged for the lab. |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | Creates the layer with the goo layer, installs the capture stage, poses the sharp remainder before the goo sync, adds the panel, and exposes the live API/flags. |
| Focused tests | `shutter-game-layer.test.ts` (new, 22), `post-aa.test.ts` (+2 behavioural), `goo-layer.test.ts` (+1 tripwire), `shutter-blur.test.ts` (+1 age clamp). |

`git diff --name-only` touches only these files plus the new notes/scripts. No
shared gameplay module (sim, emission, physics, weapon) changed.

## 3. Integration design (render-target ownership and ordering)

Per frame, in the legacy (forward) branch:

1. **Render callback** — after the camera is final and before the draw:
   `shutterGame.poseSharp()` installs the sharp-remainder selection on the goo
   layer; `gooLayer.sync(bloodSim, camera)` poses it. Selected airborne
   drops/scraps are NOT in this pass.
2. **`gooLayer.render(camera, () => sdfLayer.render(...))`** — the ordinary
   goo chain (density → sharpen/quads → goo surface) composites the SHARP
   remainder into the post-aa capture target. `characterEffects.render` follows.
   The ordinary scene is rendered exactly once.
3. **post-aa capture stage** (`postAa.setCaptureStage`) — after `chain()`, the
   shutter layer:
   a. installs the selected selection, `sync()`s the goo layer and calls
      `renderLayer` ONCE into the premultiplied layer target (depth cleared to
      far, so the layer never depth-preclips a source that can sweep into view);
   b. plans each selected droplet's swept segment through the CURRENT camera and
      rasterizes the bounded motion seed;
   c. runs ONE fullscreen resolve that reads the captured scene **and its own
      depth** and writes a SEPARATE stage target — it never samples what it
      writes. Occlusion is resolved at the destination against the clean depth;
   d. returns the stage target to post-aa.
4. **post-aa continues** — SSCS reads the capture's untouched depth, then
   FXAA → VHS → lens/blast-distortion → blit. The blur is composited in
   working-linear space, never after display encoding.

When the blur is off/zero, `poseSharp()` clears the selection, the capture
stage returns null, and the frame is the shipped fused goo (the same one-pass
pose, `bit-identical` to before this change). When on but no airborne blood is
selected, the capture stage returns null after one cheap check — the sharp pass
already drew the fused frame.

### Blurred vs sharp

| Content | Behaviour |
| --- | --- |
| Airborne drops + scraps (>= `mistMaxSize`) | **Blurred** — shaded once into the layer, exposure resolve. |
| Floor pools / splats | **Sharp** — sharp-remainder pass. |
| Gut nodes / entrail ropes | **Sharp** — sharp-remainder pass. |
| Mist / ribbons / billboards | **Sharp** (`bloodView` is untouched). |
| Blood connections (opt-in) | Rendered with the **selected** partition (blob geometry follows the airborne stream); never globally disabled. |
| World, flesh, meshes, chunks, viewmodel, HUD, effects | **Sharp** — never in the blurred layer. |
| Flying-gib mesh blur, actor/camera blur | **Out of scope** (later work), as the plan requires. |

## 4. Defaults, controls and exact seams

Owner-accepted default (shipped ON in the active game):

| Setting | Value |
| --- | --- |
| Exposure | **320 / 360 / 20 = 44.444… ms** fixed, independent of measured FPS |
| Max trail length | **120 content px** (cap 400) |
| Seed scale | **1** (seed grid = goo density dims) |
| Depth bias | **0.020 m** |
| Taps | **24** (module constant) |
| Route | legacy forward (`?renderer=deferred` supported; see §8) |

Presets: off, 8.33 ms (1/120), 16.67 ms (1/60), 33.33 ms (1/30), **44.44 ms
(default)**, 66.67 ms, 100.00 ms. Exposure is clamped to a finite `[0, 200] ms`
ceiling; the streak cap to `[1, 400] px`.

**Query flags** (all reversible; documented and tested):

```
?bloodblur=0|off          disable (default ON)
?blurms=<ms>              exposure in ms, clamped [0, 200]
?blurmax=<px>             max trail in content px, clamped [1, 400]
?blurseed=<scale>         DEBUG seed scale vs the density grid, [0.25, 2]
?blurbias=<m>             DEBUG destination depth bias, [0, 50]
```

**Live API** (`window.__sdfGame`):

```
setBloodBlur(on)            -> applied on/off
setBloodBlurExposure(ms)    -> applied ms
setBloodBlurMaxStreak(px)   -> applied px
setBloodBlurSeedScale(v)    -> DEBUG, applied scale
setBloodBlurDepthBias(m)    -> DEBUG, applied metres
get bloodBlurEnabled
get bloodBlur               -> { enabled, ready, warmed, route, exposureSeconds,
                                 exposureMs, exposureLabel, maxStreakPx,
                                 seedScale, depthBiasM, taps, seed, layer,
                                 selectedDroplets, last, passes, error }
shutterPanel(on?)           -> show/hide the focused controls
```

`__sdfGame.bloodBlur.error` is the failure surface: a hard resolve/shader
failure is recorded and logged, never silently swallowed while claiming the
default works.

## 5. Verification

Commands exactly as executed on the branch tip:

```
npx tsc --noEmit                         -> exit 0
npm run build                            -> tsc --noEmit + vite build, exit 0
npx vitest run shutter-* goo-layer goo-presets post-aa blood-compare-main
                                         -> 9 files / 293 tests passed
npx vitest run                           -> full suite (see §5.1)
node scripts/sdf-shutter-game-check.mjs 5484 9484 <evidence>
python3 scripts/shutter-game-evidence.py <evidence>
```

### 5.1 Full-suite regression

```
npx vitest run
  -> Test Files 347 passed (347); Tests 5460 passed (5460); Duration 131.8s
```

This covers the shared-module edits (`goo-layer.ts` selection seam and
`post-aa.ts` capture stage) against the whole repo, not just the focused set.

Focused coverage (new/changed assertions): accepted defaults and labels; the
exposure/streak/seed/bias clamps; the disjoint sharp/selected partition; the
aspect-preserving seed grid; every query flag; the age clamp (newborn = no
pre-birth sweep, stored vector still per full exposure); post-aa's capture stage
forcing the captured path and returning a target, and parity restored when it is
cleared; both goo `sync` fill paths filtering; and source tripwires that
`game-main` poses the sharp half before the sync, installs the stage, and exposes
the live setters.

## 6. GPU smoke — actual WebGPU game

`node scripts/sdf-shutter-game-check.mjs 5484 9484 <evidence>` owns its vite +
headless Chrome 152 on an unused port pair, its own profile under `.lab-tmp`,
no unsafe flags, and stops only what it started. It waited on `#loader`/
`__warmGate` before capturing. Result (branch tip, one run):

```
default bloodBlur = { enabled: true, exposureMs: 44.444444444444436,
  exposureSeconds: 0.04444444444444444, maxStreakPx: 120, seedScale: 1,
  depthBiasM: 0.02, taps: 24, route: 'capture-stage', error: null }
idle (no airborne blood)   -> capture stage bypassed; stamps 0
wound spray (attempt 0)    -> 186 stamps / 15509 seed texels; captured frame 176/15481
off at the frozen spray    -> enabled=false, restored sharp goo
on again                   -> enabled=true, same 176/15481 (deterministic)
deterministic A/B          -> changedPx 13349, IoU 0.9497 between the two ON frames
dynamite (real throw)      -> 1 detonation, thrown=1, 58 stamps / 5289 texels
?bloodblur=0 boot          -> enabled=false
?renderer=deferred         -> renderMode='deferred', enabled=true, error=null, 8 stamps
console errors             -> none
```

The deterministic A/B is `vhs=off` + the light clock frozen on the SAME frozen
spray, so the only frame delta is the exposure resolve (VHS owns temporal
blending; under the shipped stack an on/off diff is dominated by tape noise).
Evidence on disk: raw stills + `.state.json` per shot (`game-00` idle,
`game-10` spray, `game-15`/`game-16`/`game-17`/`game-18` resize, `game-19`
resize with blur off, `game-20`/`game-21` shipped off/on, `game-30` dynamite,
`game-40`/`game-41`/`game-42` deterministic A/B, `game-60` query off,
`game-70` deferred), the 3-up crop `game-70-ab-3up.png`, `shutter-game-report.json`
and `game-image-diff.json`. Inspected with native `read_image`: the ON column
shows long cohesive smears off the wound/arm and floor while the OFF column
shows discrete round beads and a defined pool; the two ON frames agree. No Y
flip, no background halo, no through-wall streak, no sharp duplicate.

**Resize caveat (honest):** resizing the viewport (`960x600 -> 720x480 -> back`)
tracks the layer and seed dims (400x300) and surfaces no error, and the frame is
correct from the second frame on. The single frame immediately after a metrics
override is black **with the blur OFF too** (`game-16-resize-back-f1` and
`game-19-resize-back-off` are both ~24 KB) — it is the host's existing
resize/reallocation frame, not the shutter layer, and it recovers by f3/f8.

## 7. Cost

Measured on the run above (headless Chrome, content 800x600, frozen 176-stamp
spray, `vhs=off`, light clock frozen, 90 `step(1, 0)` frames + one
`resolveGpu()`):

| Measurement | Value |
| --- | --- |
| Wall ms/frame WITH blur | **32.052** |
| Wall ms/frame WITHOUT blur | **31.584** |
| Extra wall ms/frame | **+0.468** |
| CPU motion-seed raster, per frame (`last.buildMs`) | 0.1–0.7 ms (≤0.7 observed; 0.2 in the A/B state) |
| Extra GPU passes | one density+layer chain (`goo:layer`) and one fullscreen resolve (`shutter:resolve`) |
| Extra CPU | one extra `gooLayer.sync` (pose selected partition) |
| Extra upload | CPU seed DataTexture, 400x300 RGBA float = 1.92 MB/frame |

This is the game-integration delta at the shipped content size. The raw
timestamp sums the runner also prints (`onMsPerFrame`/`offMsPerFrame`) are NOT
exclusive attribution and read high on this tile GPU; the wall number is the one
to trust. For a more precise exclusive-GPU figure see TASK-3.md's lab bench
(+0.46 ms p50 ordinary, +1.18 ms p50 heavy at 800x600) — but note the LAB seed
grid was 200x150 (its density scale is 0.5) while the GAME density is 400x300
(`setDensityScale(1)`), so the game seed is 4x the texel count.

**Seed-grid note.** The accepted screenshot's `candidate seed 200x150` came from
the lab's density scale 0.5. The instruction here is to bind the seed to the
current content/density dimensions at scale 1, and the game's goo density is
400x300, so the shipped seed is 400x300 (aspect-preserving max clamp). The
rendered streak geometry is unchanged (same 24-tap resolve, same 0.020 m bias);
only the seed texel density is finer. `?blurseed=0.5` reproduces the literal
200x150 grid if a cheaper seed is preferred.

## 8. Render routes

| Route | Blur |
| --- | --- |
| Legacy forward (default) | Supported; smoke-tested. |
| `?renderer=deferred` (opt-in) | Supported through the same post-aa capture seam; the smoke boots it, runs a real spray and reports no error. Deferred is NOT routed through forward to enable blur. |

## 9. Honest remaining gaps

- The moving/static partition is inherited from the lab: a moving droplet that
  overlaps a static pool does not metaball-fuse with it at non-zero exposure.
  Zero exposure still routes to the fused sharp path, so the difference only
  exists while blurred.
- Single motion owner per seed texel; the residual fine comb of the point-sampled
  layer remains.
- Mist/ribbons stay sharp.
- `BLOOD_TRAIL.velScale` makes gib-trail droplets near-stationary, so increased
  exposure barely affects them; the burst/crossing/wound spray carries the
  visible motion. Blood physics was deliberately not changed.
- Flying-gib mesh blur, actor blur and camera-inclusive motion are later work.
- The headless wall-cost bench is CPU-submit dominated; the exclusive GPU cost
  from TASK-3 is the more precise figure.

## 10. Reproduce

```
npm run dev               # http://localhost:5173/sdf-game.html (WebGPU)
node scripts/sdf-shutter-game-check.mjs 5484 9484 docs/dev-notes/2026-09-17-shutter-blur-game/evidence
python3 scripts/shutter-game-evidence.py docs/dev-notes/2026-09-17-shutter-blur-game/evidence
```

In the page: `__sdfGame.setBloodBlur(false|true)`,
`setBloodBlurExposure(ms)`, `setBloodBlurMaxStreak(px)`, read `bloodBlur`;
the panel is `shutterPanel(true)`. Headless caveats the runner handles: the gun
GLB is async (`fire()` returns false until ready — the runner polls), the
grapeshot cooldown is 0.45 s, and combat hit placement is random (the runner
retries across two rooms until goo-eligible blood is on screen).

## 11. Successor prerequisites (fix these first)

1. Read `TASK-3.md` (lab look/cost) and this file; the accepted look and the
   integration contract are both here.
2. The goo layer now has a `setSelection` seam and both `sync` fill paths must
   filter (there is a source tripwire). Adding a third fill path without the
   filter would draw selected blood twice.
3. The capture stage must keep returning its OWN target: resolving in place over
   the capture would sample the texture being written and lose SSCS depth.
4. The seed grid follows the goo density dimensions by design; changing
   `setDensityScale` changes the seed cost (and `?blurseed=` can compensate).
5. Flying-gib/actor/camera blur remain later work; do not fold them into this
   layer without the plan's depth/background separation.

## 12. Not claimed

- No merge or push (isolated `codex/shutter-blur-game-task-1` branch only).
- Extracted Blood placeholder assets were neither used nor committed.
- The deferred capture in this run had only 8 seed stamps (a grazing spray), so
  it proves the route runs clean, not a deferred look gate.
- The single-frame black after a metrics override is the host's resize path
  (reproduces with blur off); it is not claimed as fixed.
- DualMem `add`/`checkpoint` still fail for lack of an API key; the two launcher
  read contexts ran, and the durable findings are in this report.

