# Task 2 — Efficient shutter candidate (blood layer + bounded exposure resolve)

Branch: `codex/shutter-blur-task-2` (inherits task 1; base `761cf8d3`, task-1 tip `ba8bf93b`)
Scope: lab-first. `/sdf-blood-compare.html` only; `game-main.ts` and shipping defaults untouched.
No push, no merge, no default flips, no dispatcher metadata edits, no extracted-asset commits.

## Prerequisite check (Task 1)

- `docs/superpowers/plans/2026-09-16-selective-shutter-blur.md` is present (Task 1 committed it).
- Task 1's focused tests were green before any edit:
  `npx vitest run` on shutter-timing/timeline/reference/blood-compare-main → 87 passed.
- Task 1's contract was reused unchanged: fixed-second exposure (`shutter-timing.ts`),
  identity-preserving timeline (sampled oracle only), premultiplied working-linear math,
  the `goo-layer.renderLayer()` premultiplied layer API, and the Y-inverted offscreen
  sampling rule recorded after Task 1's orientation bug.

## What landed

### New module — `src/lab/sdf-zombie/webgpu/shutter-blur.ts`

Pure, GPU-free heart (unit-tested) plus one TSL resolve:

| Export | Contract |
| --- | --- |
| `clipToViewDepth` / `viewToClipDepth` | Exact inverses of `goo-layer`'s surface depth: `depthBuf = far*(z-near)/(z*(far-near))`. The CPU seed stores the same `[0,1]` buffer depth the hardware depth texture holds. |
| `projectWorldRadiusToPixels` | Pinhole projected radius; `focalPx = (H/2)/tanHalfFovY`. |
| `sweepOccluded` | Metric view-metre occlusion twin of the resolve: owner is dropped when `ownerZ > sceneZ + bias`; a cleared far plane (`clipZ >= 1`) never occludes. |
| `planSweepStamp` / `planSweepStamps` | Object-only projected sweep. BOTH endpoints project through the CURRENT camera (`pos` and `pos - vel*exposure`). Rejects mist, sub-cutoff drops, behind-eye points, non-finite data, zero exposure. Caps the drawn streak at `maxStreakPx` by pulling the far endpoint in. Stores clamped motion in display UV/s. |
| `rasterizeSweepSeed` | Rasterizes each clamped sweep segment into a display-indexed RGBA float seed: `xy` = clamped motion (UV/s), `z` = owner buffer depth, `w` = soft sweep weight. Single-valued ownership (max weight, nearer depth on a tie) — no velocity sums. Counts conflicts and opposed-velocity conflicts for the crossing diagnostic. |
| `seedDimsForOutput` | Seed resolution from the goo density grid, clamped to `[16, 512]`. |
| `SHUTTER_RESOLVE_WGSL` | The single resolve, described below. |
| `createShutterResolve` | Builds the one fullscreen resolve material + ortho quad; `setNearFar/setDepthBias/setExposure/setSeedDims/render/dispose`. |

### Resolve algorithm (one bounded pass)

1. `d = (uv.x, 1-uv.y)` — display index, the Task-1 offscreen Y rule.
2. `scene` = the clean sharp half (fixture + static pools/guts, no selected blood),
   `base` = the selected blood shaded ONCE as premultiplied colour+coverage.
3. The seed is read with **nearest-style ownership** (strongest of the 4 neighbours,
   no bilinear blend) so opposed stream velocities can never average to a standstill.
4. Occlusion: the owner's stored buffer depth becomes metric view metres and is compared
   to the frozen scene depth at the DESTINATION pixel. Occluded destinations DROP the
   blood (`cov = 0`); the selected layer is deliberately not pre-culled so this test owns
   occlusion for both the silhouette and its trail.
5. `cov = 0; rgb = 0` on occlusion, else a **bounded 8-tap exposure gather**:
   `avg = mean_{i<8} layer(d + v_E * (i+0.5)/8)` with `v_E = v * exposure`. This is the
   standard `(1/E)∫L(P + v t)dt` resolve; it fills the whole swept region and gives the
   interior the correct partial coverage without ever accumulating density across times.
6. Compose in working-linear space: `scene*(1-cov) + rgb`. The canvas-bound sRGB encode
   is left to three, exactly as Task 1's sampled composite leaves it.

### `blood-compare-main.ts` wiring

- `refScene` gained a sampleable `THREE.DepthTexture` (the frozen clean-scene depth).
- `renderCandidateReference(target)` reuses the sampled oracle's shape: clean half →
  selected layer → CPU seed → one resolve. Exact per-frame work:
  **1 scene render, 2 goo chains (static half + selected layer), 1 fullscreen resolve.**
  The sampled oracle is 1 + N goo chains plus its fixture depth pass.
- The candidate is **lazily built** (`ensureCandidate`) and `applySizes` disposes it, so
  while the candidate is not selected (or exposure is off) there is no allocation or
  extra pass beyond Task 1's overhead. `disposeCandidate` runs on pagehide.
- `setShutter` now accepts `reference:'efficient'`, plus `seedScale` and `depthBias`.
- New controls: `reference` (all three enabled), `seed scale (candidate)`,
  `occlusion bias m`; existing `samples (oracle)` and `max streak px` retained.
- Diagnostics: `state().shutter.candidate` = `{stamps, texels, conflicts,
  oppositeConflicts, nearerWins, maxStreakPx, avgStreakPx, buildMs, taps, seedScale,
  depthBias, passes{sceneRenders,gooChains,fullscreen}}`; a live `candidate:` diag line.
- `setCamera({yaw,pitch,distance})` added for reproducible occlusion angles.
- The replay timeline, pause/step/replay, sampled reference and wipe path are unchanged.

## Verification (exact commands and results)

```
npx tsc --noEmit
  -> exit 0

npx vitest run \
  shutter-blur.test.ts (13) shutter-timing.test.ts shutter-timeline.test.ts \
  shutter-reference.test.ts blood-compare-main.test.ts goo-layer.test.ts goo-presets.test.ts
  -> Test Files 7 passed (7); Tests 219 passed (219)
```
Focused checks only, per the task; the full suite was already run in Task 1 and no change
touches shared game modules.

New tests cover: depth round-trip and endpoints; pinhole radius; occlusion rule;
constant-speed object-only sweep (400 px/s at 1/120 = 40 px over 0.1 s); streak clamp
(with the clamped velocity retained); rejects (behind eye, zero exposure, mist,
sub-cutoff); seed rasterization outside the endpoint; **opposed streams stay
single-valued and never average to a 0-vector**; nearer-depth tie-break; dimension and
tap bounds.

GPU (WebGPU, headless Chrome 152, own vite 5434 / CDP 9434, own profile, no unsafe flags):

```
node scripts/shutter-lab-capture.mjs 5434 9434 docs/dev-notes/2026-09-16-shutter-blur/evidence
  -> WebGPU probe: ok
  -> page booted; backend = webgpu
  -> no page/console errors
  -> zero-exposure parity byte-identical: true (25155 bytes)
  -> candidate zero-exposure parity byte-identical: true (25155 bytes)
```

Zero-exposure and disabled parity hold **including through the candidate selection**:
`20-candidate-zero-exposure.png` is byte-identical to the Task-1 sharp frame, and no
candidate buffer exists before that shot is taken. Prewarm is `compileAsync` on creation.

### Candidate vs sampled oracle (agent-side measurements, `01-zero-exposure-sharp` reference)

Changed pixels vs the sharp frame at `|Δ|>8`, and IoU of the two changed masks:

| fixture / exposure | candidate px | sampled px | IoU |
| --- | --- | --- | --- |
| burst 1/120 | 1999 | 2024 | 0.789 |
| burst 1/60 | 2835 | 2789 | 0.848 |
| burst 1/30 | 3717 | 3563 | 0.869 |
| bleed 1/60 | 3500 | 3491 | 0.993 |
| crossing 1/30 | 15573 | 14928 | 0.881 |
| trail 1/60 | 5296 | 5000 | 0.942 |

Pass/seed cost per candidate frame (`state().shutter.candidate`):

| fixture | sweeps | seed texels | conflicts | opposed | max px | build ms |
| --- | --- | --- | --- | --- | --- | --- |
| burst 1/30 | 85 | 721 | 0 | 0 | 19.4 | 0.20 |
| bleed 1/60 | 5 | 48 | 0 | 0 | 6.2 | 0.10 |
| crossing 1/30 | 120 | 2018 | 946 | 943 | 25.4 | 1.40 |
| trail 1/60 | 6 | 303 | 0 | 0 | 5.9 | 0.10 |

`buildMs` is CPU plan+raster only (0.1–1.4 ms after the first frame; the first measured
frame includes DataTexture/seed allocation). **No GPU wall-clock timing was taken — that
is Task 3.** The structural tradeoff is named: the sampled oracle shades 680–912
particle draws plus a depth pre-pass; the candidate shades one selected layer plus 8
fullscreen taps, at the cost of per-pixel gather shading instead of true re-shading.

### Depth occlusion A/B

Camera orbited behind the fixture obstacle (`yaw 2.41, pitch -0.28, distance 2.34`):

| shot | red pixels | extent |
| --- | --- | --- |
| `32-candidate-occluded-obstacle` (bias 0.02) | 607 | floor strip only (y 571–583) |
| `33-candidate-occlusion-bias-off` (bias 20, test disabled) | 1253 | blood paints over the wall (y 317–583) |
| `34-sampled-occluded-obstacle` (bias 0.02) | 612 | floor strip only |

The occluded candidate matches the sampled oracle; disabling the test visibly paints the
streak over the wall, so the depth test is actually exercised (not pre-culled upstream).

## Evidence (`docs/dev-notes/2026-09-16-shutter-blur/evidence/`)

Raw captures (PNG + `state.json` each):
`20` candidate zero-exposure, `21`–`23` candidate 1/120/1/60/1/30, `24` sampled repeat,
`25`/`26` candidate+sampled crossing, `27` candidate trail, `28` candidate bleed,
`29` candidate obstacle, `30` wipe sharp|candidate, `31` candidate near-zero angle,
`32`–`35` occlusion A/B and camera restore.

Task-1 raw captures (`00`–`12`) were regenerated by the same script; their PNGs are
byte-identical, only the `state.json` gained `candidateAvailable:true`.

Derived review strips (nearest-neighbour crops of the raw PNGs; regenerated by the
diff-bbox recipe recorded below): `40-compare-burst-1-30`, `41-compare-crossing-1-30`,
`42-compare-bleed-1-60`, `43-compare-occlusion`. Left→right is sharp | candidate | sampled.

Agent-side visual inspection was done with `read_image` (vision available). Findings:

- **Outside-silhouette trails:** burst 1/30 candidate shows a soft vertical smear beyond
  the live silhouette, closely matching the sampled oracle's extent and brightness.
- **Crossed streams:** candidate and sampled both keep two opposed spray arms; the
  candidate has 946 collisions / 943 opposed collisions and still resolves each into its
  own direction (no stationary blob).
- **Highlights:** the same production `renderLayer` shading is gathered, so the wet glint
  streaks with the motion in both candidate and sampled; no arbitrary brightness gain seen.
- **Occlusion:** see the A/B above.
- **Banding:** the 8-tap gather leaves faint regularly-spaced banding along the streak
  (visible on the burst 1/30 close-up). It is a bounded-tap artifact, not a shape error.

**Owner look acceptance is PENDING.** Nothing here is a claim of owner acceptance.

## Honest limitations / remaining work for Task 3

1. **Single-layer motion ownership.** One owner per seed texel. At a true crossing the
   winner is chosen by sweep weight then nearest depth; the losing stream's contribution
   at that texel is not resolved. IoU stays high (0.88) but this is not a multi-layer
   resolve. If the owner judges crossed streams insufficient, the bounded alternatives
   are separate motion groups or a small exposure-sampled path.
2. **Gather banding** from 8 uniformly spaced taps (no jitter). A bounded dither or a
   larger capped tap budget is the fix; both were left out to keep the cost floor low.
3. **Linear motion only.** Gravity over the shutter window is ignored (sub-frame error);
   non-linear arcs at 1/30 s could be slightly under-swept.
4. **Layer separation topology.** Like the Task-1 oracle, selected moving blood and
   static pools/guts are reconstructed separately, so a droplet overlapping a static pool
   does not metaball-fuse with it. Exposure-zero routes to the fused sharp path, so the
   difference is only visible at non-zero exposure. The candidate cannot settle this.
5. **Mist stays sharp.** Fine mist is independently selectable through the existing
   `mist` layer toggle but is NOT exposure-sampled by this candidate (it is not in the goo
   layer). This is the plan's "only if properly implemented" clause: it is not implemented.
6. **CPU seed is O(sweeps × clamped bbox).** Bounded by `maxStreakPx` and the seed
   resolution, but at `max streak 200 px` + `seed scale 2` the CPU raster grows; a hitch
   cannot grow it (no time-based work) but the worst case should be measured in Task 3.
7. **No GPU/cost measurement.** Wall-clock, GPU passes and memory are Task 3.
8. **Scraps** are included by classification but the fixture has no scrap scenario.

## Reproducing the lab

```
npm run dev            # then open http://localhost:5173/sdf-blood-compare.html (WebGPU)
```
Controls: `mode = Shutter`; `scenario = burst / bleed / trail / crossing`; `reference =
Sharp / Sampled reference / Shutter candidate`; `exposure` presets show ms (or angle with
an explicit reference fps); `samples (oracle)`; `max streak px`; `seed scale (candidate)`;
`occlusion bias m`; Play/Pause/Step/Replay; `wipe A/B`. `__bloodCompare.state().shutter`
records the exposure, sample plan, seed stats and exact per-frame pass count beside a
capture.

Derived comparison strips were regenerated with Python/PIL: crop each raw PNG to the union
of the candidate-vs-sharp and sampled-vs-sharp changed-pixel bounding boxes (pad 30 px,
threshold `max|Δ| > 8`), scale ×3–4 nearest-neighbour, and paste side by side.
