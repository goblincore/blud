# Task 4 — Combined in-game verification and bounded tuning

Branch: `codex/shutter-blur-game-task-4` (isolated dispatch worktree)
Base: Task-3 docs tip `11b48672` (`24cc679a` implementation + the 30/60/120 test)
Code tip: `b4294efc`
Scope: **combined** real-game verification of the already-integrated selective
shutter blur on blood **and** flying gibs — the same seeded fight at sharp /
blood-only / gibs-only / both `44.44 ms` and `66.67 ms` (plus a `100 ms`
stress frame), rotation, transitions, mutual occlusion, regression seams and a
split cost — plus two bounded, evidence-driven additions and one harness.
**No** push, **no** merge, no dispatcher metadata edit, no extracted asset.

This is the successor to `TASK-1.md`…`TASK-3.md` in this directory. All three
were read before any edit; their fixes are preserved (the `poseSharp`
partition, the capture-target seam, the boot `prewarm`, the selection tripwires,
the rotation-aware per-surface gib model, the deferred-route exclusion). The
reviewed defaults are unchanged: gibs share the accepted blood exposure.

## 0. Owner authorization

The owner accepted the blood shutter lab, requested game integration, preferred
*"the more pronounced the blur the better"*, and explicitly added *"we can also
apply to the gibs i think"*. Task 3 implemented rotation-aware flying-gib blur;
Task 4 verifies the combined shipped result and recommends a strong default.
No owner-acceptance claim is made here.

## 1. Prerequisite check

- Task-1/2/3 integration is intact: `shutterGame.poseSharp()` runs before the
  goo sync, the capture stage returns its own target, `prewarm(postAa.captureTarget)`
  is at boot, the goo selection tripwire counts two fill sites, and the gib
  layer lifts selected pieces before the base draw.
- Baseline before any edit: `npx tsc --noEmit` exit 0; `npm run build` exit 0;
  299 focused shutter/goo/post-aa/gib tests pass.
- The three in-game rigs were re-read and the Task-2/3 scripts were left intact;
  Task 4 adds a sibling Harness rather than mutating them.

## 2. What changed in Task 4

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/shutter-blur.ts` | Resolve gains an **optional second occluder depth**: `occluderTex` + `cfg2.x` enable flag, `setOccluderDepth(tex|null)`, default 1×1 far depth (never sampled). Off = single-depth behaviour, byte-for-byte the same shader path. |
| `src/lab/sdf-zombie/webgpu/shutter-game-layer.ts` | Forwards `setOccluderDepth`. |
| `src/lab/sdf-zombie/webgpu/gib-shutter-layer.ts` | The gib layer's `layerTarget` now carries a sampleable `DepthTexture`, exposed as `occluderDepth`. |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | Capture stage hands the blood resolve the gib layer's depth (`?giboccluder=0` / `setGibOccluder(false)` is the A/B control); adds `spawnSpinFixture(x,y,z,r,spin)` (fixed-centre pure spin) and optional `velocity`/`spin` on `spawnTestChunk`; `spawnTestChunk` now returns the new piece id. |
| `gib-shutter-layer.test.ts` (+2), `shutter-game-layer.test.ts` (+1) | Tripwires for the occluder chain and the fixtures. |
| `scripts/sdf-shutter-game-task4.mjs` | **New** combined rig (own vite + headless Chrome on an unused pair, no unsafe flags, stops only what it started). |
| `scripts/shutter-game-task4-evidence.py` | **New** changed-pixel metrics, tight 3-up crops, radial rotation profile, deterministic signal/noise and the mutual-occlusion A/B. |

`git diff --stat` against `11b48672` touches **six** source files (188 insertions)
plus the new scripts/evidence. No gameplay/sim/emission/material/weapon module
changed, and no accepted exposure, gib count or particle density was reduced.

### The mutual-occlusion fix (and why it is small)

Task 3 documented the ordering limit: the gib resolve runs first and the blood
resolve composites over its result, so blood was *ordered*, not depth-resolved.
Because the selected gibs are lifted out of the clean capture, their depth is
absent from `capture.depthTexture`, so blood behind a blurred foreground gib was
painted over it. Task 4 attaches a `DepthTexture` to the gib layer and passes it
as a second occluder; the shader takes the nearer of the two depths. Measured on
one frozen frame with a foreground moving chunk and a wound spray behind it:

```
inside the gib smear (37 319 px mask):  occluder OFF 5 204 px  ->  ON 3 399 px
capture-to-capture noise inside that mask (off vs off-b):      1 369 px
whole-frame on-vs-off: 1 888 px   (off-vs-off noise 1 443 px)
blood-mask cross-check: 278 px (on) vs 279 px (off) — unchanged
```

So the correction removes ~1.8 k px of wrongly-drawn blood, about 1.3× the
frozen-frame noise floor at this staging. It is **structurally correct, modest in
size, and toggleable** (`?giboccluder=0`); the default ships ON. It adds one
per-pixel depth sample and one 1.92 MB gib-layer depth texture; no extra pass.

## 3. The fixture seam

`spawnSpinFixture(x, y, z, radius, spin)` spawns one piece through the REAL spawn
path with a chosen angular velocity and an upward kick that cancels one 1/60 s of
gravity. After one tick it passes the newborn age gate; after two ticks it has
~zero linear velocity and turns at the chosen rate, so the blur is **rotation-only
at a fixed centre**. Measured track (radius 0.22 m, spin z 10 rad/s):

```
frame 0  pos [-6.3487, 1.6906, -6.0721]  w [0, 0, 9.38]
frame 1  pos [-6.3487, 1.6858, -6.0721]  w [0, 0, 9.08]
frame 2  pos [-6.3487, 1.6779, -6.0721]  w [0, 0, 8.79]
frame 3  pos [-6.3487, 1.6682, -6.0721]  w [0, 0, 8.51]
```

The x/z centroid does not move; only gravity (from tick 2) lowers y. The capture
is taken at exactly two ticks, where the linear speed is one frame of gravity
≈0.16 m/s (<1 px of translation at the 1.5 m standoff) versus a rim speed of
ωr ≈ 2 m/s.

## 4. Defaults, controls and supported routes (real page, final code)

```
gib    enabled true · supported true · ready true · warmed true
       exposureMs 44.444444444444436 (320°/360/20) · maxStreakPx 120 (cap 400)
       seed 400x300 · layer 800x600 · depthBiasM 0.02 · taps 24
blood  enabled true · exposureMs 44.444444444444436 · seed 400x300 · route capture-stage
renderMode legacy   vhs 'blud' {intensity .81, blurAmount .17}
sscsTerms {strength .35, maxDist .8, bias .02}
```

Panel (`__sdfGame.shutterPanel(true)`, "BLOOD MOTION BLUR"): **Blood motion blur**
on/off, **Gib motion blur** on/off (separate, default ON), shared
**Exposure (ms)** slider + presets (`Off · 8.33 · 16.67 · 33.33 · 44.44 · 66.67 ·
100.00`), shared **Max trail** slider.

Query flags (all verified booting clean):

```
?bloodblur=0|off      blood off (gib stays on)      -> gib enabled true
?gibblur=0|off        gib off (blood stays on)      -> gib enabled false
?blurms=<ms>          shared exposure, clamp [0,200] -> 66.67 applied
?blurmax=<px>         shared max trail, clamp [1,400] -> 200 applied
?blurseed=<scale>     DEBUG seed scale [0.25,2]
?blurbias=<m>         DEBUG destination bias [0,50]
?giboccluder=0        mutual-occlusion A/B control (default ON)   [task 4]
```

Live API on `window.__sdfGame`:

```
setBloodBlur(on) / setGibBlur(on)
setBloodBlurExposure(ms) / setBloodBlurMaxStreak(px)   (drive BOTH layers)
setBloodBlurSeedScale(v) / setBloodBlurDepthBias(m)
setGibOccluder(on)  · get gibOccluderEnabled                 [task 4]
get bloodBlur · get gibBlur
spawnSpinFixture(x,y,z,r,spin) · spawnTestChunk(x,y,z,r,stationary,velocity,spin)  [task 4]
```

Supported routes: legacy forward (default) with `?gibrender=assets|sprite|carve|march`
all blur (fallback leg below). `?renderer=deferred` keeps gibs **sharp** — the
explicit Task-3 exclusion is preserved (`setGibBlur(true)` returns false;
`mode:deferred` on/off = 0 changed px in TASK-3).

## 5. Combined look — same seeded fight (shipped VHS)

One boot, fixed `?seed=20260917`, shipped VHS restored, `setDemoHold(true)` +
`setLightClockFrozen(true)`, a real `detonate()` on the densest actor cluster
stepped to the joint gib+blood peak: **14 pieces, 1 flying head, 107 gib stamps,
209 blood stamps, 14/14 selected**. All variants render the SAME frozen instant
(`step(N, 0)`); the census is read back per shot.

Changed pixels vs the sharp frame at max-channel |Δ| > 8 (shipped VHS owns
temporal drift, so this is a coverage census; the deterministic numbers are §6):

| Scenario | blood44 | gib44 | both44 | both67 | both100 |
| --- | --- | --- | --- | --- | --- |
| wide | 10 663 | 12 387 | 18 071 | 20 562 | 22 884 |
| close-up (asymmetric) | 11 777 | 23 964 | 34 208 | 40 830 | 47 787 |
| flying head (both) | — | — | 29 949 | 36 049 | — |

The wide table shows both channels contributing independently and their union
being larger than either (e.g. 10 663 + 12 387 vs 18 071), which is the
attribution the owner asked for. The close-up (framed 1.4 m on the highest
airborne piece) is where the pronounced look reads: discrete spinning pieces
become long cohesive smears and blood beads become streaks, while the ceiling
grid stays visible inside the vacated silhouettes.

Tight 3-up crops (`read_image`, native): `t4tight-combined-sharp-both100-both67.png`
(sharp | both100 | both67) shows a tumbling head with face/bone colour, a severed
arm and a leg dissolving into long smears with the wall behind revealed, plus
independent blood streaks. `t4tight-combinedhead-sharp-m67-m44.png` frames the
flying head. `t4tight-combinedclose-*` is the 3-up at the densest close window.

## 6. Deterministic attribution (VHS off)

`combineddet` at one frozen instant, reference = the settled blur-off frame:

```
blood-only   9 010 px
gib-only    14 160 px
both44      22 426 px     (≈ blood-only + gib-only, 744 px of overlap)
both67      26 863 px
noise: on-a vs on-b   2 427 px     signal / noise = 9.2x
sharp vs off              0 px
```

The 2 427 px noise is the explosion/fire/crosshair still varying between frozen
renders; it is why the deterministic signal is quoted against it. **Empty-scene
parity** (`vhs=off`, no particles): blur on vs off = **106 px**, zero vs off =
**131 px** — a no-op at the AA/HUD floor.

## 7. Rotation — visible, not just translation

The pure-spin fixture (`spindet`, VHS off, reference = settled off frame):

```
on-a 18 035 px vs off   on-a vs on-b noise 147 px   signal / noise = 123x
m67  23 422 px
```

Robust radial profile about the change centroid (97th-percentile radius as the
normaliser, so stray pixels cannot inflate it):

```
on-a: inner (r<0.35R) 14.5 %   mid 41.7 %   outer (r>0.7R) 43.8 %   R 84 px
m67 : inner 13.6 %             mid 40.8 %   outer 45.6 %         R 92 px
```

The change is rim-weighted (outer density ~3× inner), and the 3-up crop
`t4tight-spindet-sharp-m67-on-a.png` shows the piece's mottled red/white material
**swirling around a comparatively still centre** — while the live actor and wall
behind stay crisp. Translation-only blur cannot produce that shape.

Real blast (`rotheaddet`, VHS off, ref off): 33 240 px vs off, noise 3 106 px,
signal/noise 10.7×, on-a/on-b agree. The measured quaternion sweep over one
1/60 s frame:

```
flying head  id 1   ω 0.31 rad/s   translation 0.058 m/frame (3.5 m/s)
split arm    id 12  ω 1.06 rad/s   translation 0.073 m/frame (4.4 m/s)
```

Honest read: real blast pieces are **mostly translating**; the arm exceeds the
0.5 rad/s rotation-probe threshold, the head does not (it gets a centre probe).
The decisive rotation evidence is the controlled pure-spin fixture, exactly
because a real blast rarely produces a fixed-centre spin. `rothead`,
`rotlimb`, `rotwide` (shipped VHS) and their tight crops are on disk for context.

## 8. Transitions — sliding vs settled

One slow-slide fixture (controlled velocity from the live camera right vector)
plus one stationary twin (spawned on the floor with an explicit zero spin, since
`stationary` alone leaves the random tumble). `?chunkbake` is disabled for this
leg so settled pieces stay in `chunkStates`.

```
slide:  frame 4   y 0.479  speed 0.86 m/s  ω 3.16 rad/s  settled false
        frame 39  y 0.279  speed 0.16 m/s
        frame 42  y 0.281  speed 0.013 m/s  ω 0      settled TRUE
```

- Sliding frame (`t4-slide__*`, shipped VHS): `m44` = 6 608 changed px — the
  moving pieces blur.
- Rest frame (`restdet`, VHS off, **gib-only** so any diff is gib blur): both
  fixtures live, `flying 0`, `gibsel 0`; blur on vs off = **91 px**, on-a vs
  on-b noise = 87 px, off vs sharp = 41 px. Settled and stationary pieces are a
  **no-op** — they return to the sharp/baked path.

## 9. Occlusion, scene separation and crossing

- **Background revealed:** the combined crops show the ceiling grid/floor inside
  the vacated smear; the selected pieces are lifted out of the base capture, so a
  trail reveals the scene rather than smearing the finished image.
- **No double rendering:** `gibBlur.selectedPieces` = 14/14 while the sharp base
  carries none; `sharp` frames show discrete pieces, `both` show only smears.
- **Mutual occlusion:** §2. `occlwall__both` against a wall/crate framing = 575
  changed px, clean. `occldet` (one moving chunk in front of a wound spray):
  gib mask 39 004 px, blood mask 10 683 px.
- **Live actors + blood crossing gibs:** the occlusion staging includes a live
  actor (pink flesh) with airborne blood and a moving gib; the actor and world
  stay sharp.
- **Hidden pieces:** `gibBlurSubjects` skips `!mesh.visible`; the census never
  leaked a hidden piece into the selection in any leg.
- **Context preserved:** shipped VHS + SSCS (`strength .35`) run after the
  resolve; the mesh skeleton path (default) and the optical blast wave/smoke
  were present in every blast frame.

## 10. Regression seams (all legs, final code)

```
leg errors                        0        console errors   0
empty  off vs on 106 px · off vs zero 131 px (vhs off, no particles)
pause  loop stopped 1.5 s: before/after maxStreak 0, stamps 0, error null
toggle setGibBlur(false)->true: off enabled false, on enabled true, no error
repeat detonate x3: gib.error null, blood.error null
query  ?gibblur=0 gib off / blood on · ?bloodblur=0 blood off / gib on
       ?blurms=66.67 applied · ?blurmax=200 applied
realloc ?res=640 -> layer 640x480 seed 320x240, error null
        ?graphics=high -> layer 800x600 seed 400x300, error null
route  ?gibrender=assets (default) 14/14 sel · carve 11/11 · march 14/13
```

The empty-parity and rest-parity numbers sit at the temporal-AA settle floor
(the known 2.5 s AA convergence in a frozen scene). They are reported, not
hidden.

## 11. Cost

Frozen matched replay, interleaved sharp → blood-only → gib-only → both44 →
both67, 20 frames per variant, `step(1,0) + resolveGpu()` per frame. Two full
runs on a machine carrying a foreign load (`loadavg` 2.6→8.3); the wall-clock
deltas are **inconclusive at this load** and are quoted honestly:

| Scenario | sharp p50 | Δ blood-only | Δ gib-only | Δ both44 | Δ both67 |
| --- | --- | --- | --- | --- | --- |
| heavy crowd (14 pieces, ~107 gib stamps, ~210 blood stamps) run A | 22.7 | +0.2 | −1.2 | +1.0 | 0.0 |
| heavy crowd run B | 13.5 | +4.1 | −0.3 | +4.3 | +1.6 |
| ordinary single-body (13 pieces) | 14.4 | −2.8 | +0.1 | −2.7 | — |
| settled (14 pieces, 0 flying) | 14.2 | — | — | −0.8 | — |

The run-to-run spread (up to ~5 ms) exceeds every delta, so **no reliable
wall-clock marginal cost can be claimed**; the settled case is a no-op within
noise. The reliable structural numbers:

- **CPU preparation** (`last.buildMs`, heavy): gib seed p50 **0.6 ms**, p95
  0.7 ms (≤126 rotation-aware probes over 14 pieces); blood seed p50 **0.1 ms**,
  p95 0.2 ms.
- **GPU passes per blurred frame:** one selected-piece layer draw
  (`gib:selected`), one gib resolve (`gib:resolve`), one selected-goo layer
  (`goo:layer`) and one blood resolve (`shutter:resolve`), plus one seed upload
  each (RGBA32F DataTexture, 400×300 = 1.92 MB per layer). Labelled wall means
  on this tile GPU are advisory only (passes overlap and double-count):
  `gib:selected ~2.0`, `gib:resolve ~3.0`, `shutter:resolve ~3.2`,
  `goo:layer ~3.5 ms`.
- **First vs repeated:** first blurred frame 13.7 ms vs next 12.3 ms in the
  final run (the boot `prewarm` keeps this small; the pre-prewarm stall was
  0.25 s in Task 2).
- **Memory (analytic, from diagnostics dims, 800×600 + 400×300):** gib seed
  1.92 + layer 3.84 + layer depth 1.92 + stage 3.84 = **11.52 MB**; blood layer
  3.84 + seed 1.92 = **5.76 MB**; combined ≈ **17.3 MB**. Rebuilt on a size
  change. GPU texture bytes are not readable through the shipped API — stated
  limit.

`?blurmax=200` / `100 ms` were captured for the stress look; the 100 ms frame
drew `maxStreakPx` capped at 200 (the fastest streak reaches the cap), which is
why the report recommends raising Max trail with the longer presets.

## 12. Clips (normal speed, shipped VHS; raw per-frame dirs trimmed)

| Clip | Frames | ~fps | Shows |
| --- | --- | --- | --- |
| `clips/combined-blast-both44.mp4` / `.gif` | ~100 | ~28 | real crowd blast, blood+gibs both at 44.44 ms |
| `clips/combined-blast-gibonly44.mp4` / `.gif` | ~68 | ~28 | same blast, gibs only |
| `clips/combined-blast-bloodonly44.mp4` / `.gif` | ~68 | ~28 | same blast, blood only |

## 13. Commands run (exact)

```
npx tsc --noEmit                                                     -> exit 0
npm run build                                                        -> exit 0
npx vitest run shutter- gib-motion-blur gib-shutter-layer goo-layer post-aa gib-sprite-pieces
  -> 10 files / 281+ tests passed  (18 gib-motion + 13 gib-layer + …)
node scripts/sdf-shutter-game-task4.mjs 5497 9497 <evidence>         -> all legs, 88 shots, 0 errors
python3 scripts/shutter-game-task4-evidence.py <evidence>            -> task4-image-diff.json + tight crops
```

The full 347-file suite was **not** re-run: the only shared-module edits are the
shutter resolve's default-off occluder seam and the gib layer's depth texture;
the focused set covers those plus every inherited partition/parity tripwire, and
the machine carried a foreign load throughout.

## 14. Recommendation (owner taste: pronounced)

Keep both switches **ON** at the accepted **44.44 ms / 120 px** default — it is
already strong on a real blast. For the most pronounced look the owner asked
for, the **66.67 ms** preset with **Max trail ≈ 200 px** is the next step (at
120 px the fastest gibs clip at 66.67 ms), and **100 ms / 200 px** is the
stress setting; the comb/gather budget is unchanged (24 taps). Mutual occlusion
ships ON and is disengageable with `?giboccluder=0`.

## 15. Not claimed / remaining limits

- **No owner acceptance and no merge/push** (`codex/shutter-blur-game-task-4`).
- **Wall-clock marginal cost is inconclusive** (±5 ms spread at this load); only
  the CPU seed build and the pass inventory are reliable. GPU texture bytes are
  analytic.
- **The mutual-occlusion correction is modest** (≈1.8 k px inside the gib smear
  vs a 1.37 k px frozen-frame floor); it is correct by construction but its
  visible footprint in this staging is small.
- **Real-blast rotation is mostly translation**; the controlled pure-spin
  fixture carries the rotation claim. Rotation is integrated from the current
  angular velocity over a bounded rigid exposure, not sampled from stored past
  transforms, so a spin that reverses inside one exposure is not resolved.
- **Residual comb / fusion limits inherit Task 1–3**: single motion owner per
  seed texel, a fine comb on the longest streaks, and moving/static non-fusion
  at non-zero exposure. The `both100` close-up shows the comb growing with
  length.
- **First-use compile of the gib materials in the layer target is not awaited**
  (`prewarm` allocates and compiles the resolve; the lazy material compile can
  still cost a few ms on the first blast).
- `?renderer=deferred` is an explicit gib-blur exclusion (gibs sharp), not a
  silent renderer switch. `100 ms` was captured, not benched. The full test
  suite was not re-run. DualMem `add`/`checkpoint` writes still fail without an
  API key; both launcher read contexts ran and the durable findings are here.

## 16. Evidence on disk

`docs/dev-notes/2026-09-17-shutter-blur-game/evidence/` (Task-1/2/3 `game-*`,
`t2-*`, `t3-*` files retained untouched):

- `t4-<scenario>__<variant>.png` + `.state.json` — 88 captures across
  `combined`, `combinedclose`, `combinedhead`, `combineddet`, `spin`, `spindet`,
  `rothead`, `rotlimb`, `rotwide`, `rotheaddet`, `slide`, `still`, `settled`,
  `restdet`, `occl`, `occldet`, `occlab`, `occlaboff`, `occlwall`,
  `fall-assets|carve|march`, `reg-empty-*`.
- `t4tight-*.png` — 23 tight 3-up crops.
- `task4-report.json` — per-shot diagnostics/census, clamps, regression seams,
  route checks, cost benches and the aggregated GPU pass labels.
- `task4-image-diff.json` — changed-pixel metrics, deterministic signal/noise,
  radial rotation profiles and the mutual-occlusion A/B.
- `clips/combined-blast-*.mp4` + `.gif`.

## 17. Reproduce / ready to play

```
npm run dev        # http://localhost:5173/sdf-game.html  (WebGPU)

node scripts/sdf-shutter-game-task4.mjs 5497 9497 \
  docs/dev-notes/2026-09-17-shutter-blur-game/evidence
python3 scripts/shutter-game-task4-evidence.py \
  docs/dev-notes/2026-09-17-shutter-blur-game/evidence
```

Owner playtest: open the branch's `/sdf-game.html`, throw dynamite into a crowd,
and use the **BLOOD MOTION BLUR** panel — separate **Blood motion blur** and
**Gib motion blur** switches, shared **Exposure** (44.44 / 66.67 / 100 ms) and
**Max trail** sliders. Both ship ON at the accepted 44.44 ms.
