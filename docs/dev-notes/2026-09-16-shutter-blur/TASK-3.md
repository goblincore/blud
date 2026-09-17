# Task 3 — Live visual verification, bounded fixes and cost report

Branch: `codex/shutter-blur-task-3` (isolated dispatch worktree)
Inherited base: Task-2 tip `1fcd8d56` (Task 1 base `761cf8d3`)
Scope: lab-only. `/sdf-blood-compare.html` plus a focused runner. **No** `game-main.ts`
change, **no** default flip, **no** push/merge, **no** dispatcher metadata edit, **no**
extracted placeholder asset committed. Game integration, VHS acceptance and flying gibs
remain later gated work and are **not** claimed here.

## 1. Prerequisite check (Tasks 1–2)

- `docs/superpowers/plans/2026-09-16-selective-shutter-blur.md` is present (Task 1).
- Inherited focused tests were green before any edit: 6 files / 215 tests.
- The lab booted on its own vite + headless Chrome 152 with WebGPU (`backend = webgpu`),
  `installPassTiming(renderer).installed = true`.
- Task-2's documented defects were re-observed rather than assumed: the 8-tap gather
  beading reproduced in the crossing crop (now fixed, §4), the trail fixture cannot show
  fast streaks (production tuning, §5), and no GPU cost had been measured (now §7).

## 2. What changed (scoped lab instrumentation + two evidenced fixes)

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/blood-compare-main.ts` | Wires `installPassTiming`; labels every pass site (`sharp:scene`, `goo:surface/density/layer`, `cand:static-scene`, `cand:selected-goo`, `cand:resolve`, `oracle:*`, `blit`). Adds `__bloodCompare.benchShutter()`, `.present()`, `.driveSteps(dt,count)`, `.passTimingInstalled`. Adds the empty-work fast path. |
| `src/lab/sdf-zombie/webgpu/shutter-blur.ts` | `SHUTTER_CANDIDATE_TAPS` 8 → 24; the resolve gather taps are stratified-jittered by a pure `hash(pixel, tap)` (not time-based, so frames stay reproducible). Rejects/ownership unchanged. |
| `src/lab/sdf-zombie/webgpu/shutter-blur.test.ts` | Tap-bound assertion updated to `<= 24` with the evidence comment. |
| `src/lab/sdf-zombie/webgpu/blood-compare-main.test.ts` | +3 source tripwires for the bench API, pass labels and cadence driver. |
| `scripts/sdf-shutter-blur-check.mjs` | **New** focused reproducible runner: review matrix, 30/60/120 cadence, frozen-frame cost bench, clips, game smoke. Own vite/Chrome on an unused port pair, own profile, no unsafe flags, refuses a port it did not start. |
| `scripts/shutter-blur-evidence.py` | **New** PIL/numpy post-step: changed-pixel counts, changed-mask IoU, mean |Δ|, 3-up contact strips and candidate-vs-sampled streak crops. |

`git diff --name-only` against the inherited tip touches **only** lab files plus the two
new scripts and the notes below: no shared game module changed.

## 3. Verification (exact commands and results)

```
npx tsc --noEmit
  -> exit 0

npx vitest run \
  src/lab/sdf-zombie/webgpu/shutter-blur.test.ts shutter-timing shutter-timeline \
  shutter-reference blood-compare-main goo-layer goo-presets
  -> Test Files 7 passed (7); Tests 222 passed (222)

node scripts/sdf-shutter-blur-check.mjs 5463 9463 <evidence>
  -> WebGPU probe: ok; backend = webgpu; pass timing installed = true
  -> zero-exposure parity sharp==candidate==sampled: true (byte-identical)
  -> empty-frame candidate == sharp: true; two paused presents identical: true
  -> cadence 30/60/120: playback hashes equal: true; snapped hashes equal: true
  -> game smoke: booted true, no new console errors
  -> wall clock end to end ~7 min for review+cadence+bench+clips+game

python3 scripts/shutter-blur-evidence.py <evidence>
  -> image-diff.json + contact strips (see §6)
```

The runner is the single reproducible entry point; `--only=review,cadence,bench,clips,game`
reruns a subset and merges into `evidence/task3-report.json`.

## 4. Visual review — what the actual WebGPU output shows

Inspected with native `read_image`. Left/right/triples are sharp | candidate | sampled.
Changed-pixel counts are vs the sharp frame at max-channel `|Δ| > 8`; IoU is the overlap of
the candidate-changed and sampled-changed masks.

| Case (exposure) | cand px | sampled px | IoU | observed |
| --- | --- | --- | --- | --- |
| bleed 1/60 | 709 | 752 | 0.85 | short cohesive dribble streaks; candidate ≈ oracle |
| trail 1/60 | 515 | 753 | 0.57 | near-stationary beads in BOTH (see §5); candidate under-covers the oracle's tiny interpolation smear |
| burst (impact spray) 1/30 | 7297 | 7351 | 0.92 | long spray streaks, close to the oracle |
| crossing (opposed) 1/30 | 45630 | 45853 | 0.83 | two opposed arms preserved; no stationary averaged blob |
| overlap close-up 1/30 | 6173 | 6440 | 0.88 | heavy close blood; streaks + wet glints preserved |
| landing contact 1/60 | 29 | 30 | 0.31 | tiny motion; counts are near-noise |
| landing settle 1/60 | 80 | 84 | 0.59 | floor pools stay SHARP; only the falling stream streaks |
| occluded 1/30 | 1687 | 1990 | 0.71 | streak cut at the wall edge; candidate under-covers the oracle slightly |
| off-center 1/30 | 2961 | 4306 | 0.63 | aligned with the live silhouette; no Y flip; candidate dimmer at threshold |
| camera-turn L/R 1/60 | 224/226 | 225/225 | 0.69/0.63 | object-only: static pools stay sharp under a yaw change |

**Defects confirmed and fixed (evidence-linked):**

1. **Beaded/shattered streaks** (Task-2 limitation #2). At 8 uniform taps the crossing
   spray read as evenly spaced beads (`evidence/58-tight-crossing-cand-vs-sampled.png`
   pre-fix form). Cause: 8 translates of the *current discrete* goo surface leave gaps of
   ~streakPx/8. Fix: 24 taps (§2). Post-fix the streaks read as cohesive smears. A **fine
   comb texture remains** — this is point-sampling a discrete current layer, not a shape
   error, and it is the honest residual the owner should weigh.
2. **Empty work was not skipped.** A frame with zero selected moving blood still ran the
   static half + empty layer + fullscreen resolve (measured GPU span 0.98 ms vs sharp
   0.66 ms). Fix: route zero-moving frames to the fused sharp frame. The empty candidate
   frame was already byte-identical to sharp (parity `r20`), so nothing visible changed and
   the extra ~0.33 ms is gone.

**Defects NOT present:** no background-colour halos observed in any triple; no doubled
sharp-droplet + blurred duplicate; no through-wall tails (the occlusion A/B drops the
streak); streaks extend beyond the live silhouette; glints streak with the motion.

**Honest limitations still open:** single-owner motion at a true crossing (one stream wins
per seed texel); the 24-tap dense point gather still leaves the fine comb; layer separation
means a moving droplet does not metaball-fuse with a static pool at non-zero exposure;
mist/ribbons stay sharp by design.

## 5. The `trail` fixture cannot show fast streaks

`BLOOD_TRAIL.velScale` is `1/256` (`src/game/gibs/tuning.ts`), a source-faithful NotBlood
fixed-point inheritance. `emitTrails` therefore emits near-stationary droplets, so the
`trail` fixture reads as discrete beads in **both** the sampled oracle and the candidate
(`r11-trail-1-60-*`, IoU 0.57). It is still a useful near-zero-motion parity check, but the
plan's fast-motion review is carried by `burst` (impact spray) and `crossing`, not `trail`.
This is recorded as a fixture/tuning limitation, not a candidate defect.

## 6. Evidence

All under `docs/dev-notes/2026-09-16-shutter-blur/evidence/` (assembled clips only;
raw per-frame screencast directories trimmed):

- Raw stills + `state.json`: `r00`–`r22` (zero parity, bleed, trail, impact spray, crossing,
  close-up, landing contact/settle, occlusion, off-center, camera-turn L/R, empty, stopped,
  stepped/scripted), `c30`/`c31` cadence, `g00-game-smoke`.
- `task3-report.json` — machine-readable state/hashes/parity/cadence/bench/clips/gameSmoke.
- `image-diff.json` — per-triple changed px, bboxes, IoU, mean |Δ|.
- Contact strips: `50`–`55-*.png` (sharp | candidate | sampled); streak crops
  `56`/`58` crossing, `57` burst.
- Clips (also `.mp4`): `clips/normal-speed-bleed-candidate.gif`,
  `clips/normal-speed-burst-candidate.gif`, `clips/play-bleed.gif`,
  `clips/paused-hold-bleed.gif`.
  `paused-hold-bleed` emitted a **single** screencast frame across a 1.5 s hold — the canvas
  never changed — which is the strongest available stopped-motion evidence that no
  indefinite ghost is drawn.

## 7. Cost report (LAB numbers, quiet-ish machine, 800×600 output)

Not in-game performance and not look acceptance. Frozen frames, sim not advanced, seed and
event time pinned, source grid 400×300 (the game march) unless noted. `fenced` = wall clock
around one `drawOnce()` plus three's timestamp-resolve fence (includes the readback copy).
`gpuSpan` = sum of per-pass exclusive GPU attribution from `gpu-pass-timing`.
Run-to-run spread on p50 is ~±0.1 ms.

| Case | ref | drops/splats | drawCpu p50 | cpuPrep p50 | gpuSpan p50/p95 | fenced p50/p95 |
| --- | --- | --- | --- | --- | --- | --- |
| ordinary sharp | sharp | 51 / 53 | 0.40 | — | 0.98 / 1.05 | 2.00 / 5.70 |
| ordinary candidate | efficient | 51 / 53 | 0.60 | 0.00 | **1.44 / 1.44** | 2.30 / 4.30 |
| heavy sharp (crossing 1/30) | sharp | 552 / 56 | 0.40 | — | 1.05 / 1.11 | 2.10 / 3.90 |
| heavy candidate (cap 200, seed ×2) | efficient | 552 / 56 | 1.80 | 0.70 | **2.23 / 5.77** | 3.40 / 6.80 |
| long-exposure cap 1/30 @200 px | efficient | 51 / 53 | 0.60 | 0.00 | 1.38 / 5.44 | 2.30 / 6.60 |
| empty sharp | sharp | 0 / 0 | 0.30 | — | 0.66 / 0.72 | 1.70 / 3.80 |
| empty candidate (fixed) | efficient | 0 / 0 | 0.30 | 0.00 | 0.39 / 0.72 | 1.40 / 3.30 |
| cold candidate (after resize) | efficient | 51 / 53 | 1.00 | 0.10 | 1.44 / 1.57 | 2.80 / 7.00 |
| output-size source 800×600 | efficient | 51 / 53 | 1.10 | 0.10 | 1.51 / 1.70 | 2.40 / 6.60 |

**Ordinary extra GPU ≈ +0.46 ms p50** (0.98 → 1.44), drawCpu +0.20 ms, CPU seed prep ≤0.1 ms.
That is inside the plan's proposed ~1 ms ordinary target. **Worst measured case is the heavy
crossing: +1.18 ms GPU p50, with p95 5.8 ms** — an explicit worst-case for the owner, not a
shipped default.

Labelled GPU passes, ordinary candidate (per frame):
`goo:layer ×3 p50 0.33`, `cand:resolve ×6 p50 0.26`, `goo:surface ×3 p50 0.26`,
`cand:static-scene ×3 p50 0.20`, `goo:density ×6 p50 0.07`, plus `gpu:idle 0.26`.
Heavy candidate: `goo:layer 0.46`, `cand:resolve 0.52`, `goo:surface 0.26`,
`cand:static-scene 0.20`, `goo:density 0.07`, `gpu:idle 0.66`.
The 24-tap fix moved the resolve only +0.13 ms in the heavy case and was unmeasurable in the
ordinary case (the gather is not the bottleneck at short streaks).

Per-frame copies/uploads: the seed is a `DataTexture` upload of `texels × 16 B` (200×150 →
480 KB ordinary; 400×300 → 1.92 MB at seed scale 2); the pass-timing fence adds one
`copyBufferToBuffer` + map readback. No other per-frame copies.

Target memory (candidate allocations, steady state): **≈4.68 MB ordinary**
(seed 0.48 MB + ownership 0.36 MB + RGBA16F layer 3.84 MB; the layer's depth attachment
adds ≈1.92 MB) and **≈7.20 MB heavy** (seed 1.92 MB + ownership 1.44 MB + layer 3.84 MB).
JS heap settled ≈33 MB; 19 textures. `gpu.lost=false`, `uncaptured=0` in every bench.

First-use / prewarm: `ensureCandidate` builds once per size and fires `renderer.compileAsync`.
First measured candidate frame was **6.9–12.0 ms** across runs (compile + allocation), then
steady state within 2–3 frames (ordinary warmup 2.6, 2.2, 1.9…; heavy 7.8, 6.8, 4.7, 4.6…).
A resize disposes and rebuilds the candidate, so the cold path is real and bounded.

## 8. Cadence consistency (30/60/120)

The same timed trajectory (`bleed`, target 0.6 s, fixed 1/60 shutter) was driven by
`driveSteps(1/30, 18)`, `(1/60, 36)` and `(1/120, 72)` through the shared clock; the
resulting candidate frames are **byte-identical** (hash `7c465f212ee356b3` for all three,
16 droplets, 10 stamps, 87 seed texels, max streak 9.56 px). Snapping to the exact 0.6 s
also yields that same hash. This is the plan's gate: exposure is a fixed shutter interval,
never a function of measured/presented FPS, and there is no running frame history.

## 9. Playable-game sharp smoke

No shared module changed (`git diff --name-only` is lab-only), but the runner navigated to
`/sdf-game.html` as a final smoke: `__sdfGame` booted, `newErrors: []`, and
`g00-game-smoke.png` shows the dungeon, character, viewmodel and HUD rendering on WebGPU.
This is a boot smoke only — it does not re-verify gameplay or look, and Task 3 does not
change game behavior.

## 10. Best proposed preset (proposal only — owner look acceptance PENDING)

`mode = Shutter`, `reference = efficient`, exposure **1/60 s (16.7 ms)**, motion **object-only**,
affected content **airborne blood only** (static pools/guts sharp, mist sharp), `max streak
120 px`, `seed scale 1`, `occlusion bias 0.02 m`, 24 taps. Rationale: ordinary extra GPU is
+0.46 ms; bleed/burst/crossing/close-up track the oracle well; 1/30 doubles the streak length
and the residual comb; 1/120 is subtle. **1/30 is the honest heavy setting**, not a default.

## 11. Remaining work / not claimed

- **Owner look acceptance is PENDING.** Nothing here is an acceptance claim.
- Game integration, an opt-in runtime setting, prewarm wiring in `game-main.ts` and the
  shipped VHS/AA stack comparison are **not done** (later gated work).
- Single-owner crossing resolution, residual comb texture, linear-only motion, and
  non-fusing moving/static topology remain named limitations.
- Flying gibs (rigid transforms + rotation, background-behind-silhouette) are untouched.
- Extracted Blood placeholder assets were neither used nor committed.
- DualMem `add`/`checkpoint` writes failed in this session (`no API key: set GEMINI_API_KEY
  or GOOGLE_API_KEY`); the two launcher read contexts ran, and the durable findings are in
  this report instead.

## 12. Owner review checklist

1. `npm run dev`, open `http://localhost:5173/sdf-blood-compare.html` (WebGPU required).
2. `mode = Shutter`; `shape` auto-switches to Current.
3. `scenario = burst`, `reference = efficient`, exposure `1/60`, `max streak 120`.
4. Compare `reference = sampled` at the same state; open `evidence/50`–`58` strips.
5. Judge the fine comb texture on `evidence/58-tight-crossing-cand-vs-sampled.png`
   (left candidate, right oracle) — this is the main open look question.
6. Play `clips/normal-speed-burst-candidate.gif` and `clips/paused-hold-bleed.gif`.
7. Decide whether `trail` should be replaced by a deliberately fast fixture for the gib phase.
8. Local GPU used only for scoped lab work on an owned Chrome/vite pair (ports 5463/9463,
   profile `.lab-tmp/chrome-9463`), stopped on exit; no other service touched.

## 13. Reproduce

```
node scripts/sdf-shutter-blur-check.mjs 5463 9463 docs/dev-notes/2026-09-16-shutter-blur/evidence
python3 scripts/shutter-blur-evidence.py docs/dev-notes/2026-09-16-shutter-blur/evidence
```
```
npm run dev   # http://localhost:5173/sdf-blood-compare.html
```
Controls: `mode` = Surface/shape | Shutter; `reference` = Sharp | Sampled reference |
Shutter candidate; `exposure` presets show ms (or angle with an explicit reference fps);
`samples (oracle)`, `max streak px`, `seed scale`, `occlusion bias m`; `scenario` =
burst / bleed / trail / crossing / overlap / landing / jet; Play/Pause/Step/Replay; `wipe A/B`.
`__bloodCompare.state().shutter` and `.benchShutter()` record the exact exposure, sample plan,
seed stats, pass labels and timings beside a capture.
