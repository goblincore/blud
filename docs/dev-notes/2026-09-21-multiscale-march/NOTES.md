# Multi-scale march + learned reconstruction — is it worth building?

**Date:** 2026-09-21 · **Branch:** `claude/sdf-raymarch-multiscale-22412b` · **Status:** research. The multi-scale part changed no engine code; the wound follow-up ([WOUND-COST.md](WOUND-COST.md)) added one shader gate that ships OFF.

Owner's question: could we march the SDF at ~0.25 scale and train a model to
reconstruct the target frame, using data from the finer scales — as opposed to
today's upscaler, which works on pixels and never sees the march? The pain
case is an enemy close up, when the whole screen is march pixels.

## Short answer

1. **The ceiling is real: 5–7 ms of GPU per close-up frame.** Dropping the march
   from the shipped 0.5 (400x300) to 0.25 (200x150) cuts `sdf:march` by 44–72 %
   in every close-up scene measured. Nothing else on the table is that large.
2. **The geometry is very reconstructible.** From 1/16 of the depth samples,
   95 % of body pixels rebuild to within 5 mm by plain bilinear interpolation;
   97 % of body pixels sit in blocks whose four coarse corners all hit. The hard
   3–10 % is silhouettes — exactly the pixels you would re-march.
3. **But "give the march a better start" is a dead lever, and we already proved
   it twice.** Rays that hit take ~4.2 steps. A depth prior can save at most 2–3
   of them and costs a pass to produce (the 09-05 quarter-res prepass: steps
   −45 %, frame +0.5 ms; ships OFF). Savings only come from **not running pixels
   at all** — walk *and* shading — and reconstructing their colour. So the
   workable form of the idea is a **4x guided upscaler with sparse re-march**, not
   a learned march.
4. **Two findings that are bigger than the idea itself** (both orthogonal to
   resolution, see below): wounds add a ~4.5 ms cost that does **not** shrink with
   resolution, and 32–49 % of all walk steps are spent on rays that hit nothing.

## What the repo had already settled (read before building anything)

- Ship state is already multi-scale: 800x600 buffer, march at **0.5**, trained
  `t16-rgb` ESPCN net upscales 2x (inputs: RGB only; ~0.6 ms).
- `docs/dev-notes/2026-09-04-closeup-3-depth-prepass`: a conservative 4x4-block
  coarse march feeding the ray start. Census-clean, steps on hit pixels
  6.6 → 3.6, frame **slower**. `GAME_DEPTH_PREPASS = 0`. (That note labels 15.9 %
  as the "walk share"; by its own leg definitions that number is the *shading*
  share — the walk was 84 %. The verdict still holds: the saving was real but
  smaller than the pass that bought it.)
- `2026-09-10-cone-prepass-ab`: cone pre-pass, same story, ships OFF. Also
  unsafe near wounds (cone step has no near-wound term).
- Run 5 / 5b (`REFINE_BODY` in `march/body/entry.wgsl.ts`): per OUTPUT pixel, take
  depth from the four surrounding march texels, 1 eval + 2 Newton steps, shade at
  output res. This *is* "reconstruct the march from lower-scale data". Quality
  win (−24 % loss, owner: "definitely the best looking"), cost 6–11 ms because it
  pays the full post-hit chain per output pixel. Ships only under `?graphics=high`,
  band-gated to 1.5–3.5 m — i.e. switched off in exactly the close-up case.

Together these say: **using coarse data to make fine pixels cheaper does not pay;
using coarse data to avoid fine pixels does.**

## New measurements

Instrument: `closeup-multiscale-probe.mjs` (this directory). One page,
`setFrameCap(0)`, frozen scene, legs alternated in rotating order inside the same
page (the clock-scaling rule), `bench({ kind: 'closeup', mode: 'passes' })`,
median of 3 blocks x 90 frames. Block-to-block spread was under 0.1 ms on almost
every leg. Headless Chrome, ship boot state (crowd program ready, upscaler on).
`flat` = `setFlatAlbedo` = the walk with the whole post-hit chain skipped.

`sdf:march` GPU ms (exclusive attribution):

| scene | cover | 1.0 shaded | 1.0 walk | **0.5 shaded (ship)** | 0.5 walk | 0.25 shaded | 0.25 walk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| room 1, one body 0.7 m, clean | 27 % | 31.4 | 25.0 | **7.6** | 6.6 | 2.7 | 2.0 |
| room 1, same body, 5 wounds | 29 % | 44.4 | 30.1 | **13.8** | 9.7 | 7.7 | 4.1 |
| room 4, 1.0 m, several bodies | 16 % | 32.6 | 30.9 | **10.1** | 8.5 | 2.9 | 2.3 |

Fenced frame p50 at ship / 0.25: 10.4 / 5.0, 17.0 / 10.1, 13.4 / 5.4 ms.

Step census (march debug mode 4, read at scale 1.0):

| scene | steps per hit ray | steps per miss ray | misses' share of all steps |
| --- | ---: | ---: | ---: |
| room 1 clean | 4.3 | 8.0 | 34 % |
| room 1 wounded | 4.2 | 7.5 | 32 % |
| room 4 | 4.7 | 5.3 | 49 % |

Depth reconstructibility (truth = hit depth at 800x600; coarse grid = every Nth
pixel; bilinear rebuild; fraction of body pixels within tolerance). The 1 mm
column is at the truth's own noise floor (hit epsilon + shell fbm), so read 2–5 mm:

| scene | N | all 4 corners hit | < 2 mm | < 5 mm | < 10 mm |
| --- | ---: | ---: | ---: | ---: | ---: |
| room 1 wounded | 2 | 98.5 % | 90.9 % | 97.2 % | 98.2 % |
| room 1 wounded | 4 | 97.2 % | 88.5 % | 95.5 % | 96.8 % |
| room 1 wounded | 8 | 94.7 % | 81.7 % | 91.0 % | 93.7 % |
| room 4 | 4 | 93.1 % | 77.6 % | 90.5 % | 92.7 % |

(An output pixel is ~1.8 mm across at 0.7 m, so 5 mm of depth error along the ray
is invisible to shading position. It is *not* good enough to derive normals from —
normals must come from the field or be interpolated as their own channel.)

### Reading the numbers

- **Close-up cost is the walk, not the shading.** Clean: 87 % walk. Wounded: 70 %.
  Room 4: 84 %. Everything is field evaluations; ~35 ns each at ship scale.
- **Pixel scaling is near-linear on clean scenes** (1.0 → 0.5 = 4.1x, 0.5 → 0.25 =
  2.8–3.6x; floor ~1 ms). So a 4x reconstruction really does buy ~3x on the march.
- **Wounds break that.** Five wounds cost +6.2 ms at ship scale, +5.0 ms at 0.25,
  +13 ms at 1.0: roughly **4.5 ms that is independent of resolution** plus a
  per-pixel part. It is not extra steps (steps per ray: 3.9 / 4.6 / 4.9 across the
  three scales) and it shows in the fenced frame too, so it is real GPU time, not
  an attribution artefact. **Root-caused since: the owner re-fold in `mapBody` — see
  [WOUND-COST.md](WOUND-COST.md).** No resolution scheme touches it, and at
  0.25 it would be **two thirds of the march**. This wants its own investigation
  before or alongside any upscaler work.
- **Misses are a third to a half of the walk.** 21–46 % of rasterised pixels hit
  nothing, and miss rays walk longer than hit rays. The old prepass wrote −1 for a
  coarse miss and the march *ignored* it; a conservative coarse miss is a proof
  that every ray in the block misses, so it could discard instead. That pays back
  the coarse pass in a way ray-start never did. Worth re-running the prepass A/B
  with miss-culling on before writing it off.
- **Caveat on my staging:** the harness's "fill-screen" pose is one standing body at
  0.7 m = 27 % coverage. The owner's GPU-bound episode (8 bodies, nearest 1.6 m,
  coverage 1.0, march 28–38 ms) is 3–4x the pixels. Per-pixel costs scale up to
  that case; the absolute ms here are a lower bound on what is at stake.

## What to build, in order

**0. Chase the two free findings first** (no ML, no look change):
   wound fixed cost (~4.5 ms) and coarse-miss culling. Either could be worth as
   much as the whole multi-scale project in a wounded close-up, and both make the
   later numbers honest.

**1. Offline 4x quality test — no engine work.** The question that decides
   everything is whether 200x150 → 800x600 looks acceptable, and that can be
   answered in the existing training pipeline (`scripts/neural-upscale`, capture
   v2 already writes depth + view normals). Capture the same poses at march scale
   0.25, train three heads against the existing supersampled truth, compare to the
   2x numbers already on file (s32-rgbn ≈ 0.0158, refine head 0.0111, native 0.0091):
   - `4x-rgb` — the baseline, expected to fail on faces and wound rims;
   - `4x-rgbdn` — depth + normal + body key as guides;
   - `4x-rgbdn+sparse` — the same plus a mask of true 0.5-scale texels on a fixed
     jittered pattern (1 in 4), which is the owner's "data from subsequent scales".
   Needs `UPSCALE_SCALE` (hard 0.5 today) and the net's shuffle factor made
   parameters in the Python side only. If `4x-rgbdn+sparse` is not within reach
   of the shipped 2x look, stop here.

**2. If it passes: sparse re-march, hand-written mask first.** March 0.25
   everywhere writing a G-buffer (depth, normal, body key, wound mask, and the
   ray's **minimum distance** — the near-miss signal that tells you a thin feature
   sits inside a block no coarse ray hit). Flag blocks by rule: corner hit
   mismatch ∨ body-key mismatch ∨ depth non-planarity ∨ wound mask ∨ min-dist <
   footprint ∨ face region. Re-march flagged blocks at 0.5. The census says
   3–10 % of body pixels are flagged by geometry alone; wounds and faces add to
   that. Budget: 0.25 march + ~15 % of the (0.5 − 0.25) delta + a larger net ≈
   ship − 4 ms in the scenes above. Only then consider replacing the rule with a
   learned classifier — it is unlikely to beat the rule by enough to matter.

**3. Temporal accumulation is what makes 4x reliable**, and it is the expensive
   part: jitter exists (`setMarchJitter`, the supersample capture), reprojection
   of skinned, lunging bodies does not. At a 30 fps cap with a melee enemy filling
   the screen, history is at its least trustworthy exactly when it is needed.
   Treat as phase 2, and only if step 1 shows the spatial-only net falls short.

**Not recommended:** a learned field / learned step length (bodies are animated,
wounded and melted per frame; an over-long step is a hole — the same failure
class as the cone march near craters), and any further work on ray-start priors.

## Reproduce

```bash
docs/dev-notes/2026-09-21-multiscale-march/run-probe.sh                     # room 1, wounded
PROBE_WOUNDS=0 docs/dev-notes/2026-09-21-multiscale-march/run-probe.sh      # room 1, clean
PROBE_ROOM=4 PROBE_WOUNDS=0 PROBE_LADDER='[2.0,1.6,1.3,1.0]' docs/dev-notes/2026-09-21-multiscale-march/run-probe.sh
```

Raw results: `probe-room1-wounded.json`, `probe-room1-clean.json`,
`probe-room4-clean.json`. Note the probe calls `setSdfScale` with the upscaler
left on, so the presented image is wrong at 1.0 and 0.25 — it is a cost probe,
not a look. GPU ms are comparable *within* one file only.
