# Task 3 — Integrate flying-gib shutter blur

Branch: `codex/shutter-blur-game-task-3` (isolated dispatch worktree)
Base: Task-2 tip `e20cb8f9` (`f4588548` in-game evidence + boot prewarm)
Code tip: `24cc679a` (`db32c0d0` implementation + the explicit 30/60/120 test)
Scope: extend the accepted selective shutter blur from airborne blood to
**flying gibs**, with tumbling rotation, a separate default-on Gib motion blur
switch sharing the blood exposure/max-trail controls, real scene separation,
depth-correct compositing and focused tests + a real game WebGPU smoke.
**No** push, **no** merge, no dispatcher metadata edit, no extracted asset.

This is a successor to `TASK-1.md` and `TASK-2.md` in this directory; both were
read before any edit, their fixes are preserved (the `poseSharp` partition, the
capture target seam, the boot `prewarm`, the selection tripwires), and the
reviewed defaults are unchanged.

## 0. Owner authorization

The owner accepted the blood shutter lab, requested game integration, said *"the
more pronounced the blur the better"*, and then explicitly added *"we can also
apply to the gibs i think"*. This task implements exactly that: flying pieces
blur with translation **and** tumbling rotation, at the same accepted
`44.444 ms` effective exposure, with the stronger `66.67 / 100 ms` presets and
the same `120` content-px initial streak cap (finite `400` cap).

## 1. Prerequisite check

- Task-1/2 integration is intact: `shutterGame.poseSharp()` runs before the goo
  sync, the capture stage returns its own target, `prewarm(postAa.captureTarget)`
  is at boot, and the goo selection tripwire still counts two filter sites.
- Baseline before edits: `npx tsc --noEmit` exit 0; the focused shutter/goo/
  post-aa/gib-sprite set green.
- The gib render path was traced before editing: the default is
  `?gibrender=assets`, which spawns **mesh** pieces through
  `gib-sprite-pieces` (`render:'mesh'`, real per-instance geometry + material);
  `?gibrender=carve` uses the same mesh path with carved geometry;
  `?gibrender=sprite` uses billboards; `?gibrender=march` (and the per-piece
  fallback when an asset is missing/damaged) uses `ChunkGpuView` marched
  proxies. All four carry the same `Chunk` state and the same `stepChunk`
  physics, which is what makes one motion model cover them.

## 2. What changed

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/gib-motion-blur.ts` | **New** pure motion model: selection, prior rigid state, bounded rigid probes, rotation-aware per-surface sweep stamps, age clamp, query switch. |
| `src/lab/sdf-zombie/webgpu/gib-shutter-layer.ts` | **New** GPU layer: dedicated camera layer, real-material content pass, CPU seed, one bounded fullscreen resolve, route gate, prewarm/diagnostics/dispose. |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | Creates the gib layer with the blood's parsed exposure/streak, lifts pieces before the base draw, chains gib → blood in the capture stage, exposes `setGibBlur`/`gibBlur`, shares the exposure setters, hard-excludes deferred. |
| `src/lab/sdf-zombie/webgpu/shutter-panel.ts` | Separate **Gib motion blur** checkbox; exposure/max-trail setters drive both layers; live read-back; host takes the optional gib layer. |
| `src/lab/sdf-zombie/webgpu/shutter-blur.ts` | Resolve gains `setSceneTexture(tex)` so the blood pass can read the gib result without a material rebuild. |
| `src/lab/sdf-zombie/webgpu/shutter-game-layer.ts` | Forwards `setSceneTexture`. |
| `gib-motion-blur.test.ts` (18), `gib-shutter-layer.test.ts` (11) | **New** focused tests (29). |
| `scripts/sdf-shutter-game-task3.mjs` | **New** in-game rig: own vite + headless Chrome, frozen A/B captures, per-shot state JSON, census, fallback/mode legs, clip, cost bench. |
| `scripts/shutter-game-task3-evidence.py` | **New** pixel-diff metrics + tight 3-up crops + deterministic noise floor. |

`git diff --stat` against `e20cb8f9` touches those ten files (2061 insertions) and
the new evidence; **no** gameplay/sim/emission/material/weapon code changed and
no gib physics was retuned to manufacture streaks.

## 3. The motion model (translation + rotation)

A gib is a rigid body, so a single centre vector is not enough: a piece spinning
in place must still blur at its edges. `gib-motion-blur.ts` builds **per-surface**
motion:

- **Probes.** A bounded set (`<= 9`) of local points: the piece's own support
  sphere ends first (a capsule contributes both ends) plus the six local axes
  when the support shape is a single sphere. Deduplicated and capped.
- **Same surface point, two times.** Each probe is transformed by `chunkPoint`
  (the exact map both renderers pose from) at **now** and at the **prior** rigid
  state. The prior state is the current velocity integrated back over the
  exposure plus the same exponential-map rotation step `stepChunk` uses, run
  backwards from the current quaternion and sign-normalised to the shortest arc.
  Nothing is paired across unrelated primitive/vertex slots, and squash is
  carried at both ends.
- **Rotation is real.** Probes away from the centre get their own tangential
  screen velocity, and the shared seed rasterizer keeps the strongest probe per
  texel, so an edge probe's motion wins at the edge. A fixed-centre pure spin
  produces non-zero edge streaks and a still centre (asserted in the tests).
- **Timing is fixed.** Everything is a function of the shutter interval in
  seconds; no frame delta, presented FPS or wall clock enters. `30/60/120`
  render cadence integrate the same exposure.
- **History is safe.** There is no stored prior frame to go stale, so a recycled
  pool slot cannot inherit one. The one history clamp is AGE: a piece younger
  than the exposure cannot streak before it was born, and its stored vector
  still reproduces the FULL exposure gather. `Infinity` means "already
  presented" (full exposure); a non-finite/garbage age is treated as newborn
  rather than silently full.
- **Selection.** A piece is blurred while it is airborne OR spinning above a
  small threshold; `chunkSettled` (the integrator's own "has already stopped"
  predicate) hands it back to the sharp/baked path. Off/zero exposure is a
  no-op, and the seed/aging state is reset on every disabled frame.

## 4. Scene separation, coverage and depth

Opaque gibs cannot be handled by filtering a translucent layer the way blood is.
The layer does the full separation:

1. **Before the base draw** (`tick`), selected moving pieces are moved to a
   dedicated layer (`GIB_BLUR_LAYER = 10`). The ordinary pass' camera sees only
   layer 0, so those pieces — and the depth they would write — are **absent from
   the clean capture**. A clean background behind the current silhouette is what
   makes a trail reveal the scene instead of smearing the finished image.
2. **In the capture stage**, the camera is pointed at the dedicated layer and
   the SAME scene is rendered once; only the selected pieces draw, with their
   real materials, faces, cuts and wet detail (never a proxy). No shadow pass is
   repeated (gibs cast no shadows — only `levelGroup` does — and their light is
   explicit uniforms, so their light participation is unchanged).
3. The CPU seed stamps were planned from the live states; the **exposure
   average** is resolved over the clean capture using the capture's own depth:
   gibs behind walls/actors/settled gibs are dropped, and the layer never writes
   depth into the scene, so a transparent tail cannot occlude later content.
4. When the switch is off the list is empty, every mesh is restored to its base
   layer, and the frame is the shipped sharp one (bit-identical on the next
   frame). A piece leaving the live list (settled, dropped, recycled) was in the
   previous selection, so `restoreLayers()` puts it back before the new frame.

Coverage validated in-game:

| Path | Behaviour | Evidence |
| --- | --- | --- |
| `?gibrender=assets` (default) mesh pieces incl. a flying **head** | blurred | `t3-gib__*`, `t3-gibhead__*` (1 head in flight) |
| `?gibrender=carve` meshes | blurred | `mode:carve`, 16067 changed px |
| `?gibrender=sprite` billboards | blurred | `mode:sprite`, 42339 changed px |
| `?gibrender=march` / per-piece marched fallback | blurred | `t3-gibmarch__*`, 108 stamps, 13/14 selected |
| settled/resting pieces, sharp pools | untouched sharp | off variants, empty parity |
| living actors, geometry, viewmodel, HUD | sharp | all crops |
| `?renderer=deferred` | **explicitly off** — gibs stay sharp | `mode:deferred` 0 changed px |
| non-full-colour / hidden pieces | not selected (`visible` gate) | source + census |

## 5. Controls

Panel (`__sdfGame.shutterPanel(true)`, "BLOOD MOTION BLUR"): **Blood motion
blur** on/off, **Gib motion blur** on/off (new, default ON), shared
**Exposure (ms)** slider + presets, shared **Max trail** slider.

Query flags (reversible, additive to Task-1/2):

```
?gibblur=0|off     disable gib blur only (default ON on this branch)
?blurms / ?blurmax / ?blurseed / ?blurbias   shared with blood, unchanged
```

Live API on `window.__sdfGame`:

```
setGibBlur(on)          -> applied on/off (false in deferred: route-gated)
get gibBlurEnabled
get gibBlur             -> { enabled, supported, ready, warmed, exposureSeconds,
                             exposureMs, maxStreakPx, seed, layer, selectedPieces,
                             stamps, last, passes, error }
setBloodBlurExposure(ms) / setBloodBlurMaxStreak(px)   now set BOTH layers
```

`gibBlur.error` is the failure surface. `setGibBlur(true)` returns false on the
deferred route (see §10); it cannot be forced on through the panel either.

## 6. In-game defaults (real page, branch tip)

```
gib   enabled true · exposureMs 44.444444444444436 · maxStreakPx 120
      seed 400x300 · layer 800x600 · depthBiasM 0.02 · ready true · warmed true
blood enabled true · exposureMs 44.444444444444436 · seed 400x300
renderMode legacy · vhs 'blud' · tracks/assets loaded from public/assets/lab
```

## 7. Visual evidence (frozen matched pairs, shipped VHS)

Own vite + headless Chrome 152 on an unused pair, own profile, no unsafe flags;
stopped only what it started. Content 960x600, fixed boot `?seed=20260917`,
`setDemoHold(true)` + `setLightClockFrozen(true)`, shipped VHS. Variants use
`step(N, 0)`, so the sim instant and the piece census are identical by
construction (read back per shot).

Blast: a real `detonate()` on the densest actor cluster, stepped to the peak gib
flight (14 pieces, 1 head, **115 seed stamps**). Pixel change vs the sharp frame
at `max-channel |Δ| > 8`:

| Scenario | m44 | m67 | m100 | blood-only | attribution |
| --- | --- | --- | --- | --- | --- |
| `gib` (assets, gib only) | 13 102 px | 19 016 px | 20 981 px | 6 082 px | gib blur is the change; blood-off isolates it |
| `gibmarch` (marched fallback) | 13 749 px | 15 219 px | — | — | fallback pieces blur |
| `gibhead` (flying head peak) | 10 227 px | — | — | — | 22 pieces, 1 head, 167 stamps |
| `mode:carve` | 16 067 px | — | — | — | mesh path |
| `mode:sprite` | 42 339 px | — | — | — | billboards |

Tight 3-up crops (sharp | strongest | second, native `read_image`):

- `t3tight-gib-sharp-m100-m67.png` — discrete tumbling pieces dissolve into long
  cohesive smears; the wall/floor behind the trail stays visible.
- `t3tight-gibdet-off-on-a-m67.png` — same frozen instant, `vhs=off`: off shows
  body parts, on shows long smears.
- `t3tight-gibhead-sharp-m44.png` — a flying head and companions smear while
  keeping bone/flesh colour, not a generic red proxy.
- `t3tight-gibmarch-sharp-m67-m44.png` — marched SDF fallback pieces blur too.

Deterministic `vhs=off` pair (same frozen instant): `on-a` vs `off` = 16 151 px,
`on-b` vs `off` = 11 485 px, `on-a` vs `on-b` noise floor = 6 725 px
(signal/noise 2.4×). The noise floor is large because the explosion/fire and
crosshair still vary between renders; the clean numbers are the empty parity
below.

**Empty fast path:** no pieces, gib blur on vs off with `vhs=off` = 107 changed
px total, of which **1 px is scene area**; the rest is HUD text/crosshair. The
resolve and layer are skipped entirely when nothing is selected.

## 8. Cost (same frozen gib flight, interleaved reps)

Quiet-ish machine (`loadavg 2.6 → 2.4`; the same foreign load as Task 2 was
present). Interleaved sharp → 44.44 → 66.67 × 4 reps, each frame fenced with
`step(1,0) + resolveGpu()`.

| Workload | sharp p50 | 44.44 p50 | 66.67 p50 | median Δ 44.44 | median Δ 66.67 |
| --- | --- | --- | --- | --- | --- |
| 14-piece blast, 115 stamps | 16.8 | 13.8 | 16.1 | **+0.1 ms** | +2.2 ms |

Per-rep 44.44 deltas were +1.2 / −3.0 / −3.4 / +0.1 ms — the run-to-run spread is
larger than the effect, so the **wall-clock marginal cost is inconclusive** on
this machine (roughly 0–2 ms). The reliable figure is the CPU seed build:
**p50 0.5–0.8 ms, ≤0.9 ms** for 115 stamps. GPU passes per blurred frame: one
selected-piece layer draw (only the selected meshes) and one fullscreen resolve,
plus one extra `resolveGpu` seed upload (400×300 RGBA float = 1.92 MB/frame).
Target memory ≈ layer 3.84 MB + depth 1.92 MB + stage 3.84 MB + seed 1.92 MB
≈ **11.5 MB**, disposed/rebuilt on a size change.

## 9. Clips

`clips/gib-dynamite-on-44.mp4` / `.gif` (100 frames @ ~28 fps, normal speed): a
real crowd blast with both switches on at 44.44 ms. Raw per-frame dir trimmed.

## 10. Route support and honest exclusions

- **Legacy forward (default): supported, smoke-tested.**
- `?gibrender=assets|sprite|carve|march`: supported (see §4).
- **`?renderer=deferred`: gib blur is hard-OFF and reported.** The deferred route
  turns gibs into G-buffer producers with route-assigned materials; the isolated
  layer draw is neither validated nor safe there, and the deferred march shader
  already logs pre-existing `gMarchAnchor` pipeline errors with gib blur off
  (42 errors in the `deferred-off` control). Rather than leave moving gibs
  excluded-but-undrawn, `setGibBlur` returns false and the gibs render **sharp**
  through their normal route (`mode:deferred` on/off = 0 changed px). This is an
  explicit exclusion, not a silent renderer switch.

## 11. Verification

```
npx tsc --noEmit                                                    -> exit 0
npm run build                                                       -> exit 0 (vite build 3.09 s)
npx vitest run shutter- gib-motion-blur gib-shutter-layer goo-layer post-aa gib-sprite-pieces
  -> 10 files / 299 tests passed (18 + 11 new)
node scripts/sdf-shutter-game-task3.mjs 5493 9493 <evidence>        -> all legs, no legError
python3 scripts/shutter-game-task3-evidence.py <evidence>           -> task3-image-diff.json + tight crops
```

The full 347-file suite was **not** re-run: the only shared-module edits are
`shutter-blur`'s `setSceneTexture` (used by the new tests) and the panel host;
the focused set covers those plus every inherited partition/parity tripwire, and
the machine was carrying a foreign load (the same reason Task 2 skipped it).

## 12. Not claimed / remaining gaps (for Task 4)

- **No merge or push** (`codex/shutter-blur-game-task-3` only).
- **Wall-clock cost is inconclusive** (0–2 ms); only the CPU seed build is
  measured cleanly. A quieter exclusive bench is the Task-4 job.
- **Mutual blood/gib depth is ordered, not resolved.** The gib resolve runs
  first and the blood resolve composites over it (blood after gibs). Blood is
  therefore not occluded by a blurred gib that is in front of it. Both layers
  keep separate seeds and depths (no cross-contamination); a combined depth test
  is the next step.
- **Deferred route excluded** (above) and visually unvalidated for gibs.
- **First-use compile of the gib materials in the layer target is not awaited.**
  `prewarm` allocates and compiles the resolve at boot, but the gib materials
  are created lazily when assets load; the first blast may still pay a small
  pipeline compile for the layer target format.
- **`gibBlur.stamps` is stale while the layer is off** (it reads the last
  planned frame) — the same diagnostic artifact as `bloodBlur.last`. Use
  `selectedPieces`/`chunkStates()` for matched counts.
- **Rotation is integrated from the current angular velocity over a sub-frame
  window** (bounded rigid exposure), not sampled from stored history past
  transforms; a piece whose spin reverses inside one exposure is not resolved.
- Extracted Blood placeholder assets were neither used nor committed.
- DualMem `add`/`checkpoint` still fail for lack of an API key; both launcher
  read contexts ran and the durable findings are in this report.

## 13. Evidence on disk

`docs/dev-notes/2026-09-17-shutter-blur-game/evidence/` (Task-1/2 `game-*` and
`t2-*` files retained untouched):

- `t3-<scenario>__<variant>.png` + `.state.json` — 27 captures across `gib`,
  `gibdet`, `gibmarch`, `gibhead`, `mode-*`, `check-empty-*`.
- `t3tight-*.png` — tight 3-up crops (sharp | blur variants).
- `task3-report.json` — machine-readable per-shot gib diagnostics, census,
  clamps, caps, route checks, and the cost bench.
- `task3-image-diff.json` — changed-pixel metrics and deterministic noise floor.
- `clips/gib-dynamite-on-44.mp4` + `.gif`.

## 14. Reproduce

```
npm run dev        # http://localhost:5173/sdf-game.html (WebGPU)

node scripts/sdf-shutter-game-task3.mjs 5493 9493 \
  docs/dev-notes/2026-09-17-shutter-blur-game/evidence
python3 scripts/shutter-game-task3-evidence.py \
  docs/dev-notes/2026-09-17-shutter-blur-game/evidence
```

Owner playtest: open the branch's `/sdf-game.html`, throw dynamite into a crowd,
and toggle **Gib motion blur** on the panel (the **Blood motion blur** switch is
separate); share the **Exposure** slider and compare **44.44 / 66.67 / 100 ms**.
The accepted 44.44 ms default is already ON for both.
