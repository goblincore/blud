# B2 — Volume round 2b: tongues, visible smoke, trustworthy cost

Date: 2026-09-18. Branch: `dispatch/2026-09-18-burning-volume-look` (worktree
`2026-09-18-burning-feedback-task-4b`). Plan:
`docs/superpowers/plans/2026-09-18-burning-feedback-pass.md` Task 4b. Spec:
`docs/superpowers/specs/2026-09-18-burning-feedback-pass-design.md` §B.
Round-2 predecessor: `B-volume-lab.md`.

## What changed

| File | Change |
| --- | --- |
| `fire-volume.wgsl.ts` | erosion + fbm, smoke inscatter, softer heat gate, composite-by-blend |
| `fire-volume-tuning.ts` | 10 new fields (noise/erode/smoke) + defaults + bounds |
| `fire-volume-pack.ts` | AABB reach padding (coreR + smoke spread) — a real bug fix, below |
| `post-aa.ts` | 3 passes not 4; composite blends into the capture; resolve+history at march resolution |
| `flame-lab-main.ts` | `passTimings` exclusive attribution; `volumeProbe()`; `dash()`/`dashStart`/`dashStop`; scripted dash replaces the wander run |
| `flame-panel.ts` | 10 new VOLUME sliders |
| `scripts/flame-capture.mjs` | `--look` A/B metrics, `--fixture dash`, `--sheet`, exclusive cost table |

## Step 1 — trustworthy cost

`__flameLab.passTimings()` now returns `exclusive` (per frame -> label -> ms)
from `gpu-pass-timing.attributePassSamples`, alongside the raw end-minus-start
`samples[].ms`. The raw number is why round 2's table was not credible: on the
Apple tile GPU three's timestamp pair STARTS at the command-buffer schedule
time for every pass, so a full-res copy reports the same residency as the
32-step march it queued behind (`gpu-pass-timing.ts` documents this). The
exclusive charge partitions the frame by completion order and is the number the
notes below use; `rawMarch`/`rawCopy` are kept in `cost.json` only to show the
old number was residency, not cost. The table also carries `counts` (the
per-label pass census) so a mislabelled or re-rendered pass shows up.

Corrected baseline and post-change cost are in the "Cost" section.

## Step 2 — cheaper passes

The fire pass is now **three draws**, not four:

1. `post:fire-march` — low-res (resolutionScale) rgba16f.
2. `post:fire-resolve` — **low-res** now; the history pair is sized to the march
   target, so all three passes shrink with `resolutionScale` (round 2's resolve
   was full-res).
3. `post:fire-composite` — full-res, bilinear-upsamples the low-res field and
   writes `vec4(emission, T)` with `CustomBlending` (src colour `One`, dst
   `SrcAlpha`), so the capture target becomes `emission + scene * T` **in
   place**. It never samples the target it writes, so the WebGPU rule holds and
   round 2's separate composite target + raw copy draw are gone.

The composite shader no longer takes `sceneTex`; a source-level test asserts it.

## Step 3-4 — erosion and smoke (with two deviations from the plan's formulas)

The plan's formulas are implemented in spirit, with two deviations that were
forced by what the captures did:

- **Multiplicative erosion.** The plan's `density = (shape - erosion*erodeAmt) *
  edgeSharp` collapses the whole `exp(-d/coreR)` falloff to a thin shell at the
  erode values tongues need: the first three look runs produced a *mottled
  bodysuit*, no gaps (structure ratio 0.99-1.02). The shipped form is
  `density = shape * saturate(1 - erosion*erodeAmt) * edgeSharp`, which keeps the
  flame's thickness and punches holes where the noise is high.
- **Normalised fbm.** The 3-octave value-noise fbm peaks at 0.875, so an erosion
  subtractand could never reach the core's shape=1; `fireFbm` now normalises to
  0..1.
- **AABB reach padding (bug fix).** `packFireVolume` padded the ray AABB by the
  capsule radius only, so a flame whose `coreR` exceeds the capsule radius was
  **clipped** by the AABB (and a widened smoke column cut off). The bounds now
  pad sideways by `coreR + 1.5*smokeSpread*max(0, sootRise-0.4*rise)`. This is
  why raising `coreR` changed nothing on screen in the first runs.
- The heat gate was softened (`smoothstep(0.02, 0.14, temp)`) because the hard
  round-2 gate clipped the eroded outer falloff back to a thin bright shell.
- Smoke inscatter is gated by `clamp(sootGain,0,1)` as well as the extinction, so
  `sootGain 0` is a true smoke-off switch (the Step-5 twin depends on it).

## Step 5 — the four look metrics

`--look` runs stand and close on ONE frozen page/camera and compares a
round-2-emulated arm (erode 0, edgeSharp 1, coreR 0.06, curlStrength 0.35,
tempGain 0.7, no smoke) against the new tuning, both with cards off and the SDF
surface fire / glow zeroed, so the metrics read the VOLUME alone. Structure and
gaps are measured inside the projected fire AABB (`volumeProbe().bounds`, canvas
pixels — see the pixel-space note below); smoke and motion are separate arms.

| metric (stand) | round-2-emulated | new | change |
| --- | --- | --- | --- |
| structure (mean abs Laplacian of luma) | 1.286 | 1.423 | **+10.7 %** |
| gaps (dark fraction of the flame bounds) | 0.0004 | 0.0004 | 0 % |
| smoke crop (0.5-1.5 m above head) | 18.83 (no smoke) | 66.51 | **+47.7 luma** |
| motion (20 standing frames, mean frame diff) | 0.592 | 0.840 | **+42 %** |

| metric (close) | round-2-emulated | new | change |
| --- | --- | --- | --- |
| structure | 4.286 | 4.219 | -1.6 % |
| gaps | 0.3667 | 0.3742 | +2.0 % |
| smoke | crop is above the frame at this zoom (cropPx 0) — not measured | | |
| motion | 1.255 | 1.758 | **+40 %** |

**The gaps metric does not work in this scene.** The projected fire AABB is now
padded for the smoke reach, and the fire's light pool on the floor keeps most of
the box above `0.3 * median`, so the "dark fraction" reads ~0 in both arms. The
tight image-derived box has the same problem (the lit floor). A gaps metric
needs a floor-excluded mask; that is not implemented.

The committed round-2 `volume-{stand,close}-fresh.png` measured with an
image-derived box (left body, reference strip excluded): stand structure 1.619,
gaps 0; close 3.009, gaps 0.2387. Those have the surface fire + cards ON, so
they are a sanity cross-check against the shipped round-2 look, not the primary
number.

**Honest reading.** Smoke and motion rise clearly at both framings (the two
owner-visible items). Structure rises 10.7 % at stand but is flat at close, and
the gaps metric is unusable here, so the "eroded into tongues" claim is only
weakly measured. The `--look` captures show why: the volume-only flame is a
faint wash next to the SDF surface fire + cards that carry the shipped look. See
"Still looks off".

## Step 6 — the dash and the trail

The wander-driven `run` fixture is replaced by a scripted straight dash:
`fixture('dash')` parks body 0 at x=-2, faces it +x and arms the dash;
`dashStart()` translates it at a constant 3 m/s for 1.5 s; it auto-stops and
holds. The camera is fixed side-on (yaw 0, dist 5.5). The capture waits on the
page's own `dash().t`, so headless frame-rate variation cannot skew the timing.
The trail is the flame's image centroid minus the body's projected x, converted
with the probe's px-per-metre. The sample band is ABOVE THE TORSO and the
reference strip is excluded: the fire's light pool on the floor and the strip's
orange art both pass the hot test and dragged the whole-frame centroid forward
in the first dash run (a +1.06 m "trail" in the WRONG direction).

| capture | body x (m) | velX | flame centroid offset | verdict |
| --- | --- | --- | --- | --- |
| `volume-dash-mid-fresh` | 0.45 | +3.0 | **-0.477 m** | trailing, opposite motion (> 0.15 ✓) |
| `volume-dash-stop-fresh` | 2.50 | 0 | +0.190 m | plan's < 0.05 **missed** |
| `volume-dash-mid-charred` | 0.40 | +3.0 | -0.417 m | trailing ✓ |
| `volume-dash-stop-charred` | 2.50 | 0 | +0.187 m | missed |

The lag itself straightens: the offset moves +0.67 m from mid-dash to stop. The
+0.19 m residual is the flame's own asymmetry above the torso (the body's arms
and head are not symmetric in x), not lag — the velocity at the stop frame is
exactly 0. A parked-body baseline capture would subtract it; the fixture does not
shoot one, so the raw number is reported as measured.

## Pixel-space trap (worth remembering)

`postAa.contentSize` is the ~909x540 INTERNAL buffer; `Page.captureScreenshot`
returns the 1380x820 canvas CSS size. Projecting world points for image metrics
with `contentSize` puts every box/crop in the wrong place (off by ~1.5x). The
probe uses `canvas.clientWidth/Height`. The Blood reference-tile strip
(bottom-right, orange flame art) must also be excluded from any hot-pixel mask.

## Cost (Step 1 + Step 2)

`--cost` writes `cost.json`. **The exclusive attribution is unusable on this
headless backend**: every `post:fire-*` label charges 0 ms, because all three
fire passes complete at the same timestamp here (`rawBoundariesPresent: true`,
but the completion-order partition collapses). Round 2's raw table was already
known to be residency, not cost; this run shows the exclusive number cannot be
recovered on this machine either. What IS reportable is the workload control:
`steps 0` leaves the same three draws in the frame but the march early-outs, so
the raw residency drop is the march's own share.

Raw end-minus-start residency (ms, medians), 0.5 scale:

| bodies | march steps 32 | march steps 0 | march stride | resolve | composite |
| --- | --- | --- | --- | --- | --- |
| 1 | 6.342 | 0.243 | 6.10 | 6.379 | 6.403 |
| 4 | 6.887 | 0.257 | 6.63 | 6.931 | 6.950 |
| 8 | 8.858 | 2.105 | 6.75 | 8.879 | 8.896 |

0.25 scale:

| bodies | march steps 32 | march steps 0 | march stride | resolve | composite |
| --- | --- | --- | --- | --- | --- |
| 1 | 2.179 | 0.279 | 1.90 | 2.179 | 2.206 |
| 4 | 2.892 | 0.279 | 2.61 | 2.910 | 2.938 |
| 8 | 6.435 | 0.285 | 6.15 | 6.451 | 6.475 |

What the numbers do support:

- The march's timestamp pair tracks the march: 6.34 → 0.24 ms when `steps`
  goes to 0 at 0.5/1 body. A mislabelled or fixed pair could not move that way.
- The whole pass now shrinks with `resolutionScale` (Step 2's goal): 0.5/1 =
  6.34 vs 0.25/1 = 2.18; 0.5/4 = 6.89 vs 0.25/4 = 2.89. Resolve and composite
  sit ~0.03-0.05 ms above the march because they are queued behind it, not
  because they cost that.
- The march stride grows only 6.10 → 6.75 ms from 1 → 8 bodies at 0.5, so the
  per-capsule loop is NOT the dominant cost; the fixed per-pixel march is.
- **Budget (≤ 2 ms at 4 bodies / 0.5 scale) is MISSED** on this path (6.6 ms
  march stride). These are headless numbers on a software-ish path, not the
  owner's GPU; and the full-res composite still exists (one full-res pass).

## Captures

`docs/dev-notes/2026-09-18-burning-feedback/task-4b-captures/`:
`volume-{stand,close,walk}-{fresh,charred}.png`, `volume-contact.png` (the three
canonical frames + the Blood tiles), `volume-sheet.png` (round-2 volume | new
volume | cards | the three Blood wildfire tiles, one row),
`volume-dash-{mid,stop}-{fresh,charred}.png`,
`volume-look-{stand,close}-{r2,new-flame,new}.png` (the volume-only A/B arms),
`look.json`, `captures.json`, `cost.json`.

## Still looks off

- The volume alone is **faint** next to the SDF surface fire and the cards; the
  close volume-only capture is a pale wash. The tongues read as edge roughening,
  not as separated licks, because a viewing ray through the capsule shell still
  crosses an un-eroded back surface. A real fix is a thicker open envelope with
  the emission weighted by density (not just the gated core), or 2D-coherent
  noise along the view.
- The close flame-shape metrics do not move. The plan's "structure must rise
  clearly" is met at stand, not at close.
