# Task 2 — In-game visual acceptance evidence and cost

Branch: `codex/shutter-blur-game-task-2` (isolated dispatch worktree; inherits Task 1)
Base: Task-1 tip `e76ba1438792ac0461c3f300d3220b6441095e31`
(`23a0b02c` integrated the accepted efficient blood blur into the game)
Code+evidence tip: `f45885488b5e59253f3ff0c1b14c3893f1441b95`
Scope: **in-game** look/QA evidence, regression checks and measured cost for the
already-integrated selective shutter blur on `/sdf-game.html`; one narrow,
evidence-backed boot-prewarm fix. **No** push, **no** merge, no dispatcher
metadata edit, no extracted asset.

This is a successor to `TASK-1.md` in this directory; it was read (and
`2026-09-16-shutter-blur/TASK-1.md`…`TASK-3.md` and the master plan) before any
edit. Lab captures alone were treated as insufficient; every look claim below
comes from the real game page with its shipped graphics/upscale, skeleton/gib
assets, dynamic lights and the shipped VHS stack.

## 0. Owner authorization and the accepted diagnostic

The owner reviewed the lab and said *"oh yeah i like it we can add it in game …
basically the more pronounced the blur the better."* The accepted screenshot was
inspected natively (`read_image` on a copy at
`.lab-tmp/owner/owner-accepted.png`; the Desktop original was copied via a
glob because macOS inserts a U+202F before "AM"):

```
effective exposure 44.44 ms · 8 samples · 320deg @ 20 fps (explicit)
candidate seed 200x150 · 24 taps · bias 0.020 m
```

- Angle mode overrides the `1/30` dropdown: `320/360/20 = 0.044444… s`.
- The oracle's `8 samples` is irrelevant to the efficient candidate (24 taps).
- `max streak` is set between presets and is **not printed**; `120 content px`
  is the Task-1 initial value, not a screenshot measurement. **It does not clip
  the accepted 44.44 ms look**: measured longest drawn streak at 44.44 ms was
  74–85 px across runs (the 120 cap only binds at 66.67–100 ms).
- The lab's `shape`/`filter` labels are stale; the efficient path forces the
  smooth production goo. The rendered candidate look was preserved, not the
  labels.

## 1. Prerequisite check

- Task-1 integration is intact: `goo-layer.setSelection` filters BOTH droplet
  fill paths (the source tripwire still counts 2), the capture stage returns its
  OWN target, the seed grid follows the density dims, and the sharp/selected
  partitions are disjoint. No prerequisite gap in Task-1 §11 was found broken.
- Inherited limits carried forward unchanged: one motion owner per seed texel,
  residual fine comb, static/moving separation breaks metaball fusion at
  non-zero exposure, mist stays sharp, and `BLOOD_TRAIL.velScale = 1/256` makes
  gib-*trail* droplets nearly stationary.
- Baseline before edits: `npx tsc --noEmit` exit 0; focused shutter/goo/post-aa
  tests green.

## 2. What changed (all source, scoped)

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/post-aa.ts` | New `captureTarget` on the interface + factory getter (the real capture target, identity stable across `refit`). |
| `src/lab/sdf-zombie/webgpu/shutter-game-layer.ts` | New `prewarm(capture)`: allocates layer/seed targets and fires the pipeline compile against the REAL capture target. |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | Calls `shutterGame.prewarm(postAa.captureTarget)` at boot. |
| `post-aa.test.ts` (+1), `shutter-game-layer.test.ts` (+1) | Runtime test for the capture target, source tripwire for the prewarm wiring. |
| `scripts/sdf-shutter-game-task2.mjs` | **New** focused game harness (look / checks / clips / cost / tiers). |
| `scripts/shutter-game-task2-evidence.py` | **New** diff metrics + tight 3-up crops. |

`git diff` against `e76ba143` touches only those five source files (53 added
lines); **no** gameplay/sim/emission/material/weapon code changed and no accepted
material or simulation was retuned to manufacture streaks.

The fix is evidence-backed: before it, the first blurred frame stalled
**0.253–0.259 s** in both pre-fix runs because `precompile()` ran before any
capture target existed (`warmOnce()` returned early, and `ready` was false until
the first capture). With `prewarm()`, `bloodBlur.ready === true` and
`warmed === true` **at boot**, before the first blurred frame; the post-fix
first frame measured 0.11–0.23 s across runs (machine-load confounded), warm
frames 0.025–0.041 s.

## 3. How the game was driven (exact)

Own vite + headless Chrome 152 on an **unused** port pair, own profile under
`.lab-tmp`, no unsafe flags; the runner refuses a port it did not start and
stops only what it started. Content 960×600; the game's default `?res=800` is a
**fixed 800×600** render cap, so the capture target is 800×600 and the goo density
is 400×300 (seed 400×300 at scale 1). Match conditions for every frozen pair:

- fixed boot seed `?seed=20260917`;
- `setDemoHold(true)` + `setLightClockFrozen(true)` (pins the gather/anim phase,
  the flicker clock and the VHS time hash);
- shipped VHS restored explicitly: `setVhs('blud')`,
  `setVhsTerm('intensity', 0.81)`, `setVhsTerm('blurAmount', 0.17)`;
- variants applied with `setBloodBlur(on)` + `setBloodBlurExposure(ms)` then
  `step(N, 0)` (dt = 0 re-renders the **same** sim instant), so the droplet /
  splat / stamp counts are identical by construction and are read back per shot.

Commands (as executed):

```
node scripts/sdf-shutter-game-task2.mjs 5492 9492 \
  docs/dev-notes/2026-09-17-shutter-blur-game/evidence --only=look,checks,clips,cost,tiers
python3 scripts/shutter-game-task2-evidence.py \
  docs/dev-notes/2026-09-17-shutter-blur-game/evidence
```

`task2-report.json` (machine-readable, 47 shots) and `task2-image-diff.json`
are beside the captures. `--only=` reruns a subset and **merges** into the
existing report.

## 4. Defaults at boot (real page)

```
enabled true · exposureMs 44.444444444444436 · exposureSeconds 0.04444444444444444
taps 24 · depthBiasM 0.02 · maxStreakPx 120 · seed 400x300
route 'capture-stage' · renderMode 'legacy' · sdfScale 0.5 · frameCap 30
vhs 'blud' { intensity 0.81, blurAmount 0.17, ... } · sscsTerms {strength .35,maxDist .8,bias .02}
upscale on (model t16, layout sp, inputs rgb, sharpen 0.5, out 800x600)
```

The shipped `?graphics=default` already loads the t16 neural upscaler, so the
look evidence includes the shipped upscale path.

## 5. Visual review — matched frozen pairs (shipped VHS)

Measured at `max-channel |Δ| > 8` against the sharp frame at the **same frozen
instant**. Under shipped VHS the whole frame carries tape history, so the
shipped-stack `changedPx` is dominated by VHS temporal drift; the clean numbers
are the `vhs=off` deterministic set in §6. The tight crops are the review form.

| Scenario (frozen) | drops | stamps | m44 changedPx | m67 changedPx | m100 changedPx | m44↔m67 IoU |
| --- | --- | --- | --- | --- | --- | --- |
| `wound-44` (sustained bleed) | 266 | 178 | 55 549 | 88 541 | 99 899 | 0.61 |
| `woundclose` (heavy close-up) | 254 | 168 | 9 379 | 10 337 | 11 660 | 0.83 |
| `impact` (buckshot+slug burst) | 255 | 195 | 3 590 | 8 722 | — | 0.38 |
| `dyn-spray` (multi-body blast peak) | 592 | 536 | 36 944 | 40 937 | — | 0.80 |
| `dyn-trail` (a moment later) | 563 | 538 | 32 949 | 38 610 | — | 0.76 |
| `dyn-blast` (blast+1 frame) | 240 | 0 | 102 | 98 | — | 0.68 |
| `pools` (settled, no airborne) | 0 | 0 | (VHS noise) | — | (VHS noise) | — |
| `removal` (last droplets gone) | 0 | 0 | (VHS noise) | — | — | — |

The shipped-VHS `changedPx` values swing run to run (the VHS temporal history is
path-dependent and dominates the diff); e.g. the same wound pair read 12 k and
55 k px on two runs. Treat the crop inspection and the `vhs=off` numbers in §6 as
the measurement; the table is a coverage census.

Inspection (`read_image`, tight crops): the accepted default turns discrete
round blood beads into long cohesive diagonal/vertical smears; 66.67 ms is
longer and 100 ms longer still, with the residual fine comb growing with length.
The strongest read is the `dyn-spray` and `woundclose` tight crops. **Blurred vs
sharp is in §8.** No background-colour halo, no through-wall streak, no doubled
sharp+blurred droplet were seen on any crop.

### Scenario coverage and honest gaps

| Requested | Status |
| --- | --- |
| shotgun/slug impact | `t2-impact__*` (+ clip `wound-on-44`) |
| sustained wound bleeding | `t2-wound-44__*`, `t2-woundclose__*` |
| dynamite multi-body spray | `t2-dyn-spray__*`, `t2-dyn-trail__*`, clip `dynamite-on-44` (real `detonate()` on the densest 8-body cluster; peak 599 drops / 256 splats) |
| heavy close-up | `t2-woundclose__*` (standoff 1.15 m) |
| moving camera | clip `camera-turn-on-44` (yaw sweep while blood is airborne) |
| blood in front of living flesh | all wound/close-up crops (blood over the torso) |
| blood behind flesh / mesh gibs | partially: the `wound-44` floor spray is partly occluded by the body edge and the depth test cuts it there. A dedicated "blood strictly behind a body" staging was **not** produced. |
| walls/crates | `dyn-spray` streaks against the brick wall/floor, clean |
| stationary floor pools/guts | `t2-pools__*` — blur is a no-op (0 selected) |
| spawn/landing/removal | `t2-removal__*`; `removal` trace below |
| pause/resume | §7 |
| blood on/off | §6, §7 |
| scene reset | §7 |
| resize/graphics tier/upscale | §7 (boot-decision rungs) |

## 6. Deterministic evidence (`vhs=off`, clocks held)

`t2-det__*` is the SAME frozen spray as the primary wound pair, rendered with
`setVhs(null)` so the only delta is the exposure resolve.

```
on-a vs on-b (noise floor)          41 px
on-a(120) vs off                 11 844 px      signal / noise = 289x
on-b(120) vs off                 11 835 px
m67 vs off                       13 308 px
cap200 vs off                    11 835 px  (== cap120: the cap does not bind at 44.44 ms)
```

Clean off/zero parity (`t2-detparity__*`): `sharp vs zero = 48 px` against a
`sharp vs sharp2` noise floor of `104 px`. Empty-sim parity (`t2-still__*`,
`setBleed(false)`): blur-on at 44.44 ms vs sharp = **0 px**; blur-on at 100 ms =
40 px = the noise floor. The empty fast path returns the exact sharp frame.

Per-variant matched counts are recorded in `checks["counts:<scenario>"]`;
droplets, splats and stamps are identical across sharp/44.44/66.67/100 at each
frozen instant.

## 7. Regression checks (`task2-report.json`)

```
clamps    exposure high 200 / neg 0 / default 44.444; streak high 400 / zero 1 / default 120;
          seed high 2 / low 0.25 / default 1; bias high 50 / default 0.02      -> all finite
empty     idle (no airborne blood): stamps 0, texels 0, error null, ready true
pause     loop stopped 1.5 s: beforeMaxPx == afterMaxPx (16.93), texels equal, error null
resize    ?res=800 (default) is a FIXED 800x600 rung: layer stays 800x600 across
          window-bounds changes; draw calls stable (0 pre-init then 1082); error null
scale     setSdfScale 0.5 -> 1.0: seed 400x300 -> 512x384, layer 800x600, error null
reset     resetCast() + cleared sim + fresh wound: stamps 169, texels 12983, error null
removal   240-frame trace from 90 drops to 0: maxStreak 1.92 px (bounded); no newborn/teleport burst
tiers     ?res=640  layer 640x480 seed 320x240  stamps 108  error null
          ?res=960  layer 864x540 seed 432x270  stamps 109  error null
          ?graphics=high (t16 -> r5b) layer 800x600 seed 400x300 stamps 106 error null
          ?graphics=high&bloodblur=0 (control) boots clean, layer 0x0 (blur off, no targets)
```

CDP headless note: `Emulation.setDeviceMetricsOverride` and
`Browser.setWindowBounds` did not move `window.innerWidth` in this build, so the
default fixed rung's capture target cannot change at runtime by construction.
The real reallocation seams are the `?res=` rungs and the `?graphics=` upscale
level (both boot decisions), and both were exercised across sizes with the blur
live and `error null`.

One transcribed-vs-live check: `bloodBlur.last` is only refreshed by a capture,
so on a blur-off frame it reads the previous blurred frame's stamps/texels. This
is a diagnostic-readout artifact, not a render bug; the matched-count oracle used
throughout is `__sdfGame.bleed` (droplets/splats), which is real. Documented, not
changed.

## 8. Blurred vs sharp, and trails vs exposure

| Content | Behaviour |
| --- | --- |
| Airborne **goo droplets above the mist cutoff** and **all goo scraps** | **Blurred** — selected, shaded once, exposure-resolved |
| Floor splats / pools, gut nodes / entrails | **Sharp** (not selected; empty path is exact) |
| Mist / ribbons / billboards (`bloodView`) | **Sharp** (by design, not exposure-sampled) |
| World, living flesh, mesh gibs/chunks, viewmodel, HUD | **Sharp** — never in the blurred layer |
| Post stages SSCS → FXAA → VHS → lens/blast | **Sharp inputs, run after** the resolve (working-linear) |

**Persistent physical trails ≠ shutter exposure.** The sim's trail emission
(`BLOOD_TRAIL.velScale = 1/256`) lays near-stationary droplets in space, so those
beads persist but barely smear at any exposure. The shutter exposure smears what
is *moving now*: the dynamite **blast spray** (595 droplets, 536 selected, max
streak 22.5 px at 44.44 ms → 33.8 px at 66.67 ms) reads strongly, while the
*trail* droplets contribute little. Blood physics was deliberately not changed to
fake a longer trail. Falling **mesh gib geometry is not blurred** and no viewmodel
or actor blur is claimed.

## 9. Cost (quiet-ish machine, matched frozen replay)

Same frozen sim instant per variant; each variant fenced per frame with
`step(1,0) + resolveGpu()`. Interleaved sharp→44.44→66.67 × 4 reps so the paired
delta is robust to drift. Machine load during the run: `loadavg 2.13/2.61/2.87 →
2.28/2.55/2.81`; a foreign `/Users/donny/Work/LearnCard-…/nx` daemon held ~13 %
CPU (not mine, not stopped). p50/p95 are fenced wall-clock; they are **not**
lab numbers.

| Workload | sharp p50 | 44.44 p50 | 66.67 p50 | median Δ 44.44 | median Δ 66.67 | mean Δ 44.44 |
| --- | --- | --- | --- | --- | --- | --- |
| ordinary (dense wound spray, 272 drops, 17 160 seed texels) | 37.9 | 39.5 | 39.5 | **+1.7 ms** | +1.8 ms | +1.71 ms |
| heavy (dynamite multi-body, 599 drops, 27 808 seed texels) | 22.3 | 22.5 | 21.9 | +1.3 ms | +0.3 ms | +0.48 ms |

Per-rep ordinary 44.44 deltas: −0.2 / +1.5 / +1.7 / +1.8 ms. Heavy rep 3 hit a
machine spike (sharp 61.9 ms vs 21–22 ms in reps 0–2) and is the source of the
median-vs-mean spread; excluding it the heavy delta is ≈0. p95 deltas are within
±2 ms of the p50 deltas. **Report the ordinary +1.7 ms p50 as the shipped
marginal cost; the heavy figure is inconclusive (0–1.3 ms) because that view is
GPU-cheap and open.** This is above the lab's lab-only +0.46 ms partly because
the game seed is 400×300 (4× the lab's 200×150) and the resolve runs at 800×600
(vs the lab's 400×300).

CPU preparation: seed plan+raster `buildMs` p50 0.4–0.7 ms, max 0.9 ms.
GPU passes per blurred frame: one selected-goo layer chain (`shutter:selected-goo`
/ `goo:layer`) and one fullscreen resolve (`shutter:resolve`), plus one extra
`gooLayer.sync` (selected partition). Upload: the motion seed `DataTexture`,
400×300 RGBA float = **1.92 MB/frame**. The per-pass GPU timestamp attribution on
this Apple tile GPU is not trustworthy as absolute cost (pass residency exceeds
the fenced frame and double-counts), so the fenced numbers are the evidence; the
raw labelled means are kept in `task2-report.json` under `passMeanMsPerFrame`.

Target memory (analytic, steady state, 800×600 + 400×300 seed):
layer RGBA16F 3.84 MB + its depth ≈1.92 MB + stage RGBA16F 3.84 MB + seed
1.92 MB ≈ **11.52 MB**; disposed and rebuilt on a size change. GPU texture
memory is not readable through the shipped API — a stated limit.

First-use: pre-fix runs measured the first blurred frame at **253 / 259 ms**;
post-fix runs at **109 / 230 ms** (machine-load confounded), with next frames
25–41 ms and `ready=true, warmed=true` at boot. The allocation is off the live
frame; the `compileAsync` completion is still not awaited (remaining gap).

Empty bypass: idle/wound-free frames skip the layer and resolve (stamps 0, §7);
off/zero route to the fused sharp frame.

## 10. Clips (normal speed, shipped VHS)

Assembled at the measured screencast cadence; raw per-frame dirs trimmed.

| Clip | Frames | ~fps | Shows |
| --- | --- | --- | --- |
| `clips/wound-on-44.mp4` / `.gif` | 101 | ~28 | sustained bleed with 44.44 ms blur |
| `clips/wound-off.mp4` / `.gif` | 101 | ~28 | the same staged fight with blur off |
| `clips/dynamite-on-44.mp4` / `.gif` | 233 | ~27 | real thrown bundle: flight, blast, multi-body gore with blur |
| `clips/camera-turn-on-44.mp4` / `.gif` | 89 | ~28 | yaw sweep while blood is airborne (object-only blur) |

Mid-clip A/B of `wound-off` vs `wound-on-44` shows discrete beads on the left and
elongated streaks on the right at the same fight moment.

## 11. Player controls and exact live seams

Panel (`__sdfGame.shutterPanel(true)`, "BLOOD MOTION BLUR"):

- **Blood motion blur** on/off
- **Exposure (ms)** slider 0–200 step 0.5 + preset buttons
  `Off · 8.33 · 16.67 · 33.33 · 44.44 (default) · 66.67 · 100.00`
- **Max trail** slider 1–400 px

Debug/algorithm knobs are deliberately off the panel. Query flags (tested):

```
?bloodblur=0|off      disable (default ON)
?blurms=<ms>          exposure ms, clamped [0, 200]
?blurmax=<px>         max trail in content px, clamped [1, 400]
?blurseed=<scale>     DEBUG seed scale vs density grid, [0.25, 2]
?blurbias=<m>         DEBUG destination depth bias, [0, 50]
```

Live API on `window.__sdfGame` (applied values read back after clamping):

```
setBloodBlur(on)              -> applied on/off
setBloodBlurExposure(ms)      -> applied ms
setBloodBlurMaxStreak(px)     -> applied px
setBloodBlurSeedScale(v)      -> DEBUG applied scale
setBloodBlurDepthBias(m)      -> DEBUG applied metres
get bloodBlurEnabled
get bloodBlur                 -> { enabled, ready, warmed, route, exposureSeconds,
                                   exposureMs, exposureLabel, maxStreakPx, seedScale,
                                   depthBiasM, taps, seed, layer, selectedDroplets,
                                   last, passes, error }
shutterPanel(on?)             -> show/hide the focused controls
```

`bloodBlur.error` is the failure surface. Launch: `npm run dev` then
`http://localhost:5173/sdf-game.html` (WebGPU). Best suggested presets: the
shipped default **44.44 ms / 120 px**; a stronger **66.67 ms** (raise Max trail
to ~200 to stop clipping the fastest streaks); **100 ms** as the stress preset.
Max-trail is a hard finite cap of 400 px and exposure of 200 ms.

## 12. Verification

```
npx tsc --noEmit                                                    -> exit 0
npx vitest run shutter- goo-layer goo-presets post-aa blood-compare-main
    -> Test Files 9 passed (9); Tests 295 passed (295)   (293 before; +2 new)
node scripts/sdf-shutter-game-task2.mjs … --only=look,checks,clips,cost,tiers
    -> all legs completed; report.failed absent
python3 scripts/shutter-game-task2-evidence.py …                    -> diff JSON + tight crops
```

No full-suite run was repeated: the only source change is the post-aa capture
getter, the shutter `prewarm`, the game-main call and their tests; the focused
set covers all three plus the inherited partition/parity tripwires.

## 13. Evidence on disk

`docs/dev-notes/2026-09-17-shutter-blur-game/evidence/`
(Task-1 `game-*` files retained untouched):

- `t2-<scenario>__<variant>.png` + `.state.json` — 47 captured frames
  (`wound-44`, `woundclose`, `impact`, `dyn-blast`, `dyn-spray`, `dyn-trail`,
  `pools`, `removal`, `det`, `parity`, `detparity`, `still`, `check-empty-idle`,
  `check-reset`, `tier-*`).
- `t2tight-<scenario>-sharp-m44-m67.png` — tight 3-up crops (sharp | 44.44 | 66.67)
  at the densest changed window; `t2strip-*` are the whole-frame 3-ups.
- `task2-report.json`, `task2-image-diff.json`.
- `clips/*.mp4` + `*.gif` (raw frames trimmed).

## 14. Not claimed / remaining gaps

- **No merge or push** (`codex/shutter-blur-game-task-2` only).
- Flying-gib mesh blur, actor blur and camera-inclusive motion are **not**
  integrated; only airborne blood goo is.
- A dedicated "blood strictly behind a living body / mesh gib" staging was not
  produced; the depth-occlusion rule is inherited from the lab (A/B there) and
  is visible at the body edge, but a new in-game behind-body pair is missing.
- The heavy-cost figure is inconclusive (0–1.3 ms) and the machine was not
  quiet (foreign nx daemon). The ordinary +1.7 ms p50 is the number to trust.
- The first blurred frame still costs 109–230 ms once (pre-fix 253–259 ms);
  `prewarm` allocates at boot but does not await the compile. If the owner
  notices the first-blood hitch, awaiting a real precompile is the next step.
- GPU texture memory is not readable via the shipped API; target bytes are
  analytic.
- Mist/ribbons sharp, single-owner crossing comb, moving/static non-fusion and
  linear-only motion all remain (inherited).
- DualMem `add`/`checkpoint` writes still fail (`no API key`); both launcher read
  contexts ran and the durable findings are in this report.

## 15. Successor prerequisites (fix these first)

1. Read `TASK-1.md` and this file; the integration contract and the measured
   look/cost are here.
2. `prewarm(postAa.captureTarget)` must stay at boot. Removing it restores the
   ~0.25 s first-blur stall. If you make it awaited, keep
   `post-aa captureTarget` identity-stable (the resolve binds those textures).
3. Any new goo fill path must honour `Selection` (tripwire counts two today).
4. `bloodBlur.last` is stale while blur is off — use `__sdfGame.bleed` for
   matched counts.
5. The game default `?res=800` is a FIXED cap; runtime window resize cannot move
   the capture target. Test reallocation with `?res=640|960` or `?graphics=high`.
6. The harness refuses to share ports; pick an unused pair and stop only your own
   browser/vite.

## 16. Reproduce

```
npm run dev        # http://localhost:5173/sdf-game.html (WebGPU); panel via shutterPanel(true)

node scripts/sdf-shutter-game-task2.mjs 5492 9492 \
  docs/dev-notes/2026-09-17-shutter-blur-game/evidence --only=look,checks,clips,cost,tiers
python3 scripts/shutter-game-task2-evidence.py \
  docs/dev-notes/2026-09-17-shutter-blur-game/evidence
```

Owner playtest: open the branch's `/sdf-game.html`, shoot a body, throw dynamite
into a crowd, and compare the panel's **Blood motion blur** on/off and the
**44.44 / 66.67 / 100 ms** presets. The accepted default is already ON.
