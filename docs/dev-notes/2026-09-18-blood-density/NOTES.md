# Blood spray: density / metaball packing (spike, 2026-09-18)

This spike asks the question the curl spike left open: **can the spray read as
connected goo — droplets fusing into sheets and strings as they fly — by
packing the droplets tighter and letting the metaball goo layer
(`webgpu/goo-layer.ts`) fuse more of them, with curl on top to keep the
connected mass moving as one?**

The answer is **yes for cohesion, with two real limits** (a saturated launch
pulse and over-merging of independent streams). The frames are the evidence;
the numbers below are gates, not the verdict. Nothing in the game changes.

## What was built

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/blood-sim.ts` | New optional `DensityPack` (`coneScale` / `countMul` / `sizeMul`) threaded into `spawnWoundDroplets` and `spawnImpactGout`. It MULTIPLIES the shipped per-calibre bands; absent = the shipped profile exactly, same RNG draw count. No change to `stepBlood`, `curl-sample`, `curl-volume-node` or `soft-fade`. |
| `src/lab/sdf-zombie/webgpu/blood-compare-main.ts` | A **DENSITY** panel section (spread ×, count ×, size ×, goo radius, goo threshold, goo blur px) + reset; `packing` in `state()`; `__bloodCompare.setDensity({...})` beside `setFlow`; a new **`wipe axis = density`** (baseline \| dense on the SAME frame and filter); the second sim now carries an emission pack and its curl follows `curlOn`. |
| `src/lab/sdf-zombie/blood-sim.test.ts` | Emission-pack tests: missing pack and a NEUTRAL pack are byte-identical to the shipped profiles, a golden digest pins the default seeded scenario, a non-neutral pack reaches the spray, and it stays deterministic. |
| `scripts/blood-density-capture.mjs` (new) | Headless capture + gates (pipeline-error guard, flat-frame guard, determinism gate, "the packing/goo changed something" gates) and the sheet compositor. |
| `package.json` | `npm run blood:density`. |

### The knobs (what actually controls fusion)

Two halves — the emission that decides how close droplets end up, and the goo
knobs that decide how readily neighbours merge:

**Emission** (sim side, per-calibre bands in `blood-sim.ts`):
`WOUND_BLEED[kind]` / `IMPACT_GOUT[kind]` — `coneRad` (spread), `count` /
`baseHz` (how many), `sizeMin/Max` (how big). The pack exposes them as
multipliers. Density is what makes the density *field* overlap: `countMul` is
the strongest lever, `coneScale` the cheapest, `sizeMul` the most double-edged
(it also pushes mist over `GOO_TUNING.mistMaxSize` into the field).

**Goo fusion** (`GOO_TUNING`, and the GAME overrides in `goo-presets.ts`):
`sizeScale` (blob radius — the file's own note: 0.15 breaks trails into beads,
0.22 = thin connected strands, 0.4 = thick hose-water ropes), `threshold`
(density above which a pixel is goo — lower fuses more), `blurPx` (widens the
density before thresholding; 0 in the game). The lab runs the GAME look, so
the shipped baseline is `sizeScale 0.14 / threshold 0.65 / blur 0` — the small
sharp blobs that read as "oval blood cells".

### How to use the lab

`/sdf-blood-compare.html` → shape **Current slug** → **DENSITY** section. For
the A/B: check `wipe A/B`, set `wipe axis = density`, drag `wipe pos`; left is
the shipped game look, right is the packed look (emission **and** goo on the
dense side only). `__bloodCompare.setDensity({spread,count,size,gooRadius,gooThreshold,gooBlur})`
drives the same thing from a capture. Reset packing restores the shipped
values.

### How to reproduce the captures

```
npm run blood:density                 # -> docs/dev-notes/2026-09-18-blood-density/
LAB_VITE_PORT=5237 LAB_CDP_PORT=9227 node scripts/blood-density-capture.mjs
```

It boots headless Chrome + vite, hides the page chrome, drives the page
entirely through `__bloodCompare` (rAF off), and **fails** on a
`THREE.WebGPURenderer` pipeline/shader error, a page exception, a flat frame, a
non-reproducing baseline, a dense run that changed nothing, or a goo-only run
that changed nothing.

## Values that looked best

Best look (the capture's `denseLook`), judged on `sheet-emission.png` and
`sheet-goo.png`:

| knob | shipped | best | why |
| --- | --- | --- | --- |
| spread × (`coneRad`) | 1 | **0.5** | droplets leave along one another instead of fanning into isolated specks |
| count × | 1 | **2.5** | the dominant lever: 92 → 232 droplets on the mid frame |
| size × | 1 | **1.8** | bigger beads overlap sooner and cross the goo mist cutoff |
| goo radius (`sizeScale`) | 0.14 | **0.22** | fuses neighbours without swallowing the frayed droplet tail |
| goo threshold | 0.65 | **0.50** | more of the inter-droplet field lands over the line |
| goo blur px | 0 | **1.0** | a gentle widening; 0 leaves pinholes, >2 turns the spray into one solid tongue |

The sweeps:
- **Emission × curl** (`sheet-emission.png`, rows = shipped → very dense, columns
  curl off/on, goo held at 0.22/0.5/1): the shipped row still reads as clusters
  of ovals at every count of curl; rows 2–3 fuse into a connected sheet with a
  frayed droplet tail; row 4 is a single mass and has lost the stringy read.
  **Row 3 is the sweet spot**, and is the capture's best look.
- **Goo radius × threshold** (`sheet-goo.png`, best emission, curl off): radius
  is the stronger knob; 0.14 fragments, 0.22–0.32 connect while keeping edge
  detail, 0.45 is one smooth mass. Lower threshold fattens at every radius.
  0.22/0.50 is the best of the grid.

Frame diffs vs baseline (same seed/scenario/time, only the packing differs):
launch **0.83 %**, mid **3.90 %**, landing **7.22 %** of pixels. A **goo-only**
run (emission untouched, fusion widened) moves **1.62 %** — so the goo half
alone reaches the render; the two halves are not one switch wearing two labels.

## What the frames actually show

**Against "big oval blood cells" — largely fixed.**
`baseline-mid.png` is a scatter of discrete red ovals with visible gaps between
them. `dense-mid.png` is one connected sheet with a ragged, still-droplet edge;
`dense-landing.png` is a thick glossy rope that pools. The mid frame no longer
reads as N particles — it reads as one body of fluid that is breaking up.
`sheet.png` (rows launch/mid/landing, columns baseline | dense | dense+curl)
shows it at a glance.

**Against "thin, hard edges, not gooey" — fixed by the same change.**
The baseline beads are small and hard-edged; the packed mass has the wide,
absorbed, specular body of the goo surface, because more of the spray now lives
in the goo density field instead of as billboard beads. This is the goo layer
doing what it was built for, with more input.

**Does curl help once the spray is dense? — it reshapes the mass, but cohesion
comes from the packing.**
Curl on top of the dense look changes the frames by 0.49 % (launch), **4.19 %
(mid)** and **11.39 % (landing)** of pixels — comparable to or larger than the
packing change itself, because a connected rope is a much bigger lever for
advection than a cloud of beads. Visually (`sheet.png`, right column vs middle),
curl-off and curl-on are both connected; curl bends the landing rope into a
cleaner, more continuous tapered strand instead of the looped lump the curl-off
run leaves. So curl *is* worth keeping on a dense spray — but it is changing
*how the connected mass moves*, not whether the droplets fuse. The crossing
fixture confirms this: density alone changes 6.64 % of pixels, curl on top
2.13 %, and both dense variants are one mass. That is exactly what the curl
spike predicted: divergence-free advection reorders a cloud, it cannot compress
it.

**Two limits the frames expose — this is not a complete solution.**

1. **The dense launch pulse over-saturates.** `dense-launch.png` (t = 0.15 s) is
   a hollow red **ring / torus**, not a blob: the whole gout is in one tight
   cluster, the goo density blows past the absorption range, and the core
   darkens to near-black while the rim stays red. The baseline launch is a
   small filled blob. So the packing that fixes mid-flight makes the first
   frames of the pulse look wrong. A production version would have to ramp the
   pack in over the arc (or cap density), not hold it constant.
2. **Independent streams over-merge.** `crossing-dense.png`: two opposed stump
   sprays (570 baseline droplets, saturated at the 600 cap when packed) fuse
   into one symmetric **butterfly/clover mass with a hole** — connected, but no
   longer two crossing streams. The screen-space density field has no notion of
   stream identity: it merges whatever is near whatever, so proximity between
   unrelated wounds invents connections (`blood-connections.ts` exists precisely
   because that is wrong for geometry).

## Honest verdict

- **Packing is the right lever and it works.** With the goo layer as it stands,
  tight emission + more/larger droplets + a moderate goo radius/threshold/blur
  turns the spray from discrete ovals into a connected, gooey mass that still
  breaks into droplets at its edges. This is the first blood-spray attempt here
  that clearly answers "reads as goo" rather than "reads as particles". The
  change is lab-only and the game is byte-identical (pinned).
- **But packing alone cannot be shipped as-is.** It buys cohesion by making
  *everything* merge, and it has no answer for (a) the saturated launch pulse
  or (b) two independent wounds fusing into an invented shape. Those are not
  tuning failures; they are consequences of a **screen-space, stream-blind
  density field** with a global threshold.
- **What I think would actually get there**, in order of cost:
  1. **Per-stream (or per-source) goo fields** — the field already has a
     `setSelection` partition seam and `setExtraBlobs`; if the threshold were
     applied per stream/source instead of globally, the crossing case would stay
     two streams and a wound could not fuse with a different wound. This is the
     cheapest real fix and it builds on what exists.
  2. **A capsule field** (wildfire teardown §2/§Gibbing): treat the connected
     mass as a small set of capsule/blob primitives along the droplet cloud's
     principal axis, evaluate a proper 3D field, and sample it. That gives
     volume and a physical surface instead of a screen-space threshold, and the
     primitives can carry per-source identity naturally. Medium effort.
  3. **Low-res volumetric march + temporal reprojection** (teardown §3/§4): the
     general answer for real volume and self-occlusion, but the largest change;
     worth it only if 1–2 leave the close-range read short.

  A shipping path does **not** need to discard the emission pack: tightened
  emission + the goo layer is a good, cheap foundation, and 1 above would make
  it safe. But do not ship the pack against the current stream-blind field.

## Caveats

- The capture is a manual rig (`scripts/blood-density-capture.mjs`), not wired
  into CI or `npm test`. Visual acceptance remains a human judgement on a GPU.
- The dense landing frames show blown-out white specular cores: `spec`/`gloss`
  were tuned for small game blobs and are too hot on blobs this size. Retuning
  them is a separate, purely cosmetic change and was not done here.
- The crossing fixture saturates `MAX_DROPLETS` (600) when packed, so its
  over-merge is partly the FIFO eviction of older droplets. The launch ring and
  the butterfly are still real, but the exact crossing shape depends on the cap.
- No performance measurement was taken. Count × 2.5 puts ~2.5× the droplets into
  the density pass (fill-bound), and `gooLayer.setParticleCap` / `maxParticles`
  already exist as the lever if that matters.
- **Game untouched**: emission multipliers default to 1, goo to
  `GAME_GOO_DEFAULTS`, curl off, fade 0. `blood-sim.test.ts` proves a missing
  pack and a neutral pack are byte-identical to the pre-spike code (a temporary
  HEAD-vs-working check was run and removed; the golden digest pins it forward).
