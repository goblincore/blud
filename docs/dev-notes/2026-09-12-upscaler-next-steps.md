# Neural upscaler — assessment and next steps (2026-09-12)

Written after the local grid finished, for the owner to revisit. Companion to the
[visual direction handoff](2026-09-12-visual-direction-handoff.md). Obsidian copy:
`Claude Notes/Research/2026-09-12-upscaler-next-steps.md`.

## 1. Where the local grid landed

All six runs done on the MacBook Air, 20,000 steps each, dataset `v2-2026-09-12` (924 train / 76 val).

| run | best overall | best step | face | edge | far | wall |
|---|---|---|---|---|---|---|
| s8-rgb | 0.02484 | 16000 | 0.0350 | 0.0685 | 0.0306 | 518 s |
| s8-rgbd | 0.02535 | 13000 | 0.0358 | 0.0698 | 0.0315 | 538 s |
| s16-rgb | 0.02378 | 11500 | 0.0342 | 0.0651 | 0.0293 | 664 s |
| s16-rgbd | 0.02397 | 11500 | 0.0344 | 0.0654 | 0.0295 | 665 s |
| s32-rgb | 0.02317 | 11500 | 0.0335 | 0.0635 | 0.0287 | 921 s |
| **s32-rgbd** | **0.02289** | 11500 | 0.0333 | 0.0624 | 0.0282 | ~1000 s |

Bars: bicubic 0.0284, native single-ray 0.0141. s32-rgbd-best passes G3 parity (max rel rgb 3.6e-6,
no coverage mismatches) and is staged in `.upscale-models/s32-rgbd-best` — open
`/sdf-game.html?upscale=trained&upscalemodel=s32-rgbd-best`, U cycles native / nearest / model.

**What the numbers say**

- **Steps are spent.** Every run peaked between 7,500 and 16,000 of 20,000. Training longer buys nothing.
- **Capacity is not spent.** Each doubling of width buys a steady 3–4 %: s8 → s16 → s32 is
  0.0248 → 0.0238 → 0.0232. The grid stopped where the curve was still going.
- **Depth as an input buys nothing** at any width (rgbd within noise of rgb, worse at s8). A scalar
  the net cannot relate to shading is not information to it.

## 2. Improving what exists, ranked by payoff per hour

1. **Go much bigger.** Two hidden 3×3 layers = a 7×7 receptive field. At ~0.3 ms per frame (march is
   6.7–13 ms) s64 with three or four layers, or dilated convs for a wider field, is affordable. Training
   is kernel-launch bound so a wider net is not much slower locally. Overnight, free.
2. **Normals in, depth out.** Orientation says where a crease darkens, which is most of what shading
   is. Emit them from the march as a second target; drop the depth channel to pay for it. This is the
   same MRT plumbing the "pre-rendered look" work needs, so it is not wasted if the look changes.
3. **Free augmentation.** The crop sampler has no flips or rotations. Horizontal/vertical flips and
   90° rotations quadruple 1,000 pairs at zero capture cost. Apply identically to input, target and
   weight map; the §4 sub-pixel neighbour mapping is symmetric under them, so the reconstruction
   stays valid. (Normals must be flipped as vectors: negate the flipped axis component.)
4. **More characters, not more frames.** Three characters risks memorising skin. Probed 2026-09-12:
   of the 20 registered lab characters, these spawn cleanly in-game — bonewalker, clown, clown-alt,
   cyberdemon, female, gnasher, minotaur, schoolgirl, schoolgirl-described, plus the shipping trio.
   Chosen for the next capture: **bonewalker, clown, cyberdemon, female, gnasher, minotaur** (bone,
   pale skin, armoured red flesh, human, beast, fur/hide — material diversity, not headcount).
   WIP bodies are valid training data even when they are not shippable content.
5. **Temporal input** (later run). Feed the previous frame's upscaled output, reprojected, as extra
   channels. Every production upscaler does this; it attacks flicker directly instead of measuring it
   after the fact. post-aa.ts already has reprojection. A real project, not a grid run — after the s64 run.

## 3. On the handoff's new directions

- **The still-frame gate is right; do not skip it.** One frame at expensive march settings, or one
  Cycles render of the sampled field. If it does not look pre-rendered, loss and input work is moot.
- **Perceptual before adversarial.** A VGG/LPIPS term next to the existing L1 is a one-file change and
  stable. A discriminator on 1,000 pairs at 64-px crops will be fragile and will invent texture that
  flickers — the handoff's own central risk for faces.
- **Blood first, characters second, gibs parked.** Gore tolerates temporal chaos, faces do not, and the
  blood pipeline already has the screen-space fluid pieces.
- **Replace G4 before any look training.** A model that looks better will score worse on L1. Build
  LPIPS-for-reporting and the temporal-stability number first, the blind A/B third.

## 3b. Pre-rendered CG look — scope decision (owner, 2026-09-12): characters first

Decided: **characters first, full frame later**, with the still-frame gate rendering the WHOLE frame at
expensive settings so the full-frame question is answered for free.

- Characters are the clean problem: the stage already sits on the marched flesh layer, the v3 capture
  provides march normals, the target is our own march with expensive settings — one renderer, alignment free.
- Full frame is a different input: level, weapon and blood come from the polygon pass with different
  statistics and no march normals. Doing it well means a whole-screen G-buffer, which the deferred path is
  already building — a plumbing project larger than the net.
- Risk: flicker on a face is bad; flicker across a wall you strafe past is unplayable. Full frame raises
  the temporal-stability bar before we have the metric.
- Aesthetic: Blood's own look was pre-rendered creatures in a real-time world, so characters-only is a
  legitimate period style; a consistently soft-lit frame is the more striking end state.
- Cost is not the gate: 1–3 ms of net next to a 7–13 ms march is affordable, so the look net can be
  4–6 layers at 64 wide with dilations for a 30–60-texel receptive field (soft shadow / bounce are non-local).
  Training with a perceptual loss is where a rented GPU starts paying (VGG per step is real GPU math; the
  kernel-launch bottleneck that made the pod slower than the Air stops mattering there).

Whether the level goes into the net later is a capture-and-training decision, not an architecture change.

## 4. Blood — owner direction (2026-09-12, mid-session)

The owner wants a **second blood system that supplements the goo layer**, not a replacement: something
that reads as smooth liquid — sheets, splashes, tendrils — because the current output is blocky
(a handful of ~2 px orange specks). Reference:
[Blood in UE 5.1 Niagara (cghow)](https://cghow.com/blood-in-ue-5-1-niagara-tutorial/) — thick glossy
splatter sheets with ragged edges, separated droplets, spray.

What that reference actually is: mostly **pre-simulated splash meshes / vertex-animation flipbooks**
fired as one-shot events, plus particle spray, plus a decal on landing. It is not a runtime fluid sim.
That maps onto Blud as:

- **Splash events** (hit, gib, decapitation): a small library of baked splash animations (mesh
  sequence or vertex-animation texture, 8–16 frames, 3–6 variants), oriented to the hit normal,
  rendered in the poly pass with a glossy blood material (Fresnel, specular, slight refraction of the
  background). Baked in Blender from a fluid sim, exported as GLB frames or a VAT. Blender is already
  in the toolchain.
- **Goo layer keeps** pooling, trails and dripping — the things that must persist and merge.
- **Decals** on landing so the splash leaves something behind.

Conventional rendering first; the learned path (a net that reconstructs the goo surface from a
quarter-res field) is downstream and separate. Sequencing: still-frame the splash look in Blender
→ export one variant → wire one event → judge in-game → build the library.

## 5. Immediate plan (agreed 2026-09-12) — and what landed the same day

1. **Done:** s32-rgbd-best on `localhost:5173` (`?upscale=trained&upscalemodel=s32-rgbd-best`). Cost bench
   legs added; the run was **unresolved** (40–60 % repeat spread, machine not quiet) — see
   [g1-cost.md](2026-09-11-neural-upscale/g1-cost.md). Least-contaminated samples say s8 is free on top of a
   half march and s32 may cost 1–3 ms, which is more than the 0.3 ms assumed. Re-run quiet before sizing s64.
2. **Built, capture in flight:** `s64`/`s64d` ladder (py + ts), flip augmentation (vector-aware), `rgbn`/`rgbdn`
   input sets on the Python side, march debug mode 9 (world normals) + `readMarchNormals()`, capture writes
   view-space `normal.npy` (contract §1). Smoke: 6 pairs, unit normals, hit mask identical, 7.7 s/pair (2× the
   old capture — the extra render). Full v3 capture: 1,000 pairs, nine characters, ~2 h. Grid launcher:
   `.lab-tmp/grid-s64.sh` (s32-rgbn, s64-rgb, s64-rgbn, s64d-rgbn, s64-rgbdn; 15k steps; 120 min cap).
   **Still needed before an rgbn model can ship in-game:** the runtime normals MRT + TS twin + WGSL input
   assembly — plan in `docs/superpowers/plans/2026-09-12-neural-upscale-runtime-normals.md`.
3. Temporal input in a later run — needs motion vectors per pair first; see the research note
   [2026-09-12-neural-look-research.md](2026-09-12-neural-look-research.md) for the ten plan changes it surfaced.
## 6. s64 grid results (v3 dataset, 2026-09-12 evening)

Dataset `v3-2026-09-12`: 1,000 pairs, nine characters (95–118 each), view-space `normal.npy` per pair,
flips on. 15k steps, `--compile`, MacBook Air. Bars are LOWER than v2's (different mix; not comparable
across datasets — compare within this table only).

| run | overall | face | wound | edge | interior | medium | far | best step | wall s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| nearest | 0.0219 | 0.0303 | 0.0223 | 0.0776 | 0.0139 | 0.0182 | 0.0350 |  |  |
| bicubic | 0.0191 | 0.0277 | 0.0201 | 0.0704 | 0.0116 | 0.0150 | 0.0331 |  |  |
| native | 0.0098 | 0.0139 | 0.0092 | 0.0393 | 0.0056 | 0.0079 | 0.0164 |  |  |
| s32-rgbn | 0.0158 | 0.0233 | 0.0159 | 0.0621 | 0.0092 | 0.0132 | 0.0249 | 14000 | 805 |
| s64-rgb | 0.0157 | 0.0231 | 0.0152 | 0.0630 | 0.0090 | 0.0130 | 0.0252 | 14000 | 1926 |
| s64-rgbn | 0.0151 | 0.0224 | 0.0152 | 0.0592 | 0.0088 | 0.0126 | 0.0238 | 11000 | 1561 |
| s64d-rgbn | 0.0145 | 0.0216 | 0.0150 | 0.0561 | 0.0085 | 0.0121 | 0.0229 | 10500 | 2031 |
| s64-rgbdn | 0.0149 | 0.0225 | 0.0153 | 0.0580 | 0.0087 | 0.0124 | 0.0236 | 11500 | 1487 |

**Read:**
- **Normals and width stack.** s32-rgbn 0.0158 ≈ s64-rgb 0.0157 (each alone), s64-rgbn 0.0151 (both).
- **Normals pay most at the silhouette**: edge 0.0630 → 0.0592 → 0.0561 down the rgbn column.
- **A third layer beats doubling width**: s64d-rgbn 0.0145 is the best model, and its edge number is the
  lowest. Receptive field is the lever now (research: AO/soft shadow want ≥30 texels) — dilated layers next.
- **Depth still buys nothing** next to normals (s64-rgbdn 0.0149 > s64-rgbn 0.0151 within noise). Drop it.
- **Gap to native is still large** (0.0145 vs 0.0098): capacity is not spent.
- Every run peaked by 10.5–14k of 15k steps.

**Shipping state (updated same evening):** runtime normals landed, so **`v3-s64d-rgbn-best` loads in-game**:
`?upscale=trained&upscalemodel=v3-s64d-rgbn-best` (the second march attachment is allocated only for `?upscale`
boots). Compile smoke PASS on every config; G3 PASS at 6e-7; the GPU-vs-twin trained smoke reads 3–5e-3 against
a 2e-3 bar for every s64 model including the no-normals one (f16 accumulation at 64 wide — bar left unchanged,
see p3c-ingame.md). `dc` layout is refused at 64 wide (17 sampled textures > 16); `sp` only.

**Next run** (after runtime normals): s64 with 4 layers and dilation 2 on the middle ones (RF ~15 → ~30 texels),
reparameterised 3×3‖1×1 branches, no depth, `--max-steps 12000`. Then the temporal run (needs MVs per pair).

## 6b. Fields + upscaler stack — tried and REVERTED (2026-09-12 evening)

Built the cheap version (field weave → stage input, `?upscalefields=sdf`) and the owner looked: **"that looks
bad"** — the v3 models sharpen the comb artifacts on motion, as predicted. Reverted the same evening; nothing
of it remains in the code. Learned: the 'frame' style does not halve the march (whole-frame fielding), only
'sdf'/'bodies' do, and their weave lives in the composite. If revisited, it needs a fields-on capture and a
retrain first, or the raw-fields net (current + previous field + parity in), which is the temporal model.

## 8. Decisions at wrap-up (owner, 2026-09-12 evening)

- **Ship s32-rgbd, not s64.** Owner playtested both: s64d-rgbn "runs way worse than baseline but looks
  pretty much the same as s32". ~6x the multiply-adds (87k vs 15k per pixel, 14 passes vs 6) for a
  difference below the visual threshold. The metric gain was real and is still the right training signal;
  it just does not show at 800×600 through the VHS chain.
- **s32-rgbd with the CAS sharpen (strength 0.5) is the DEFAULT boot.** `public/assets/lab/upscale/
  s32-rgbd-best.json` is a tracked asset (83 KB), loaded when no `?upscale` param is given; `?upscale=0`
  is the native march. `?upscale=trained&upscalemodel=<dev-store name>` still loads from `.upscale-models/`.
  This displaces the 'bodies' field-style default (the stage forces fields off).
- **Sharpen:** the adaptive, clamped CAS-style pass is the one shipped; the plain **unsharp** mode
  (`?upscalesharpenmode=unsharp`, strength up to 4, no clamp) was tried, judged "interesting", left off.
  The proper version of the same idea is a higher gradient weight in the next training run.
- **VHS 'blud' preset retuned** on top of the stage: intensity 1 → 0.81, blurAmount 1 → 0.17.
- **Runtime normals stay in** (gated: the second march attachment is allocated only for rgbn/rgbdn
  boots or `?upscalenormals=1`; an unconditional version cost frame time on s32 and was fixed).
- **Next training run, agreed:** same cost as s32 — a third layer at 16–24 wide with dilation, normals,
  higher gradient weight, reparameterised branches; and an s16 + normals + 3 layers variant as the
  "same quality, half the cost" candidate. No recapture needed (dataset v3).
- **Open:** the trained-smoke parity bar for 64-wide models (moot if s64 is not pursued); the quiet
  bench incl. the normal attachment cost; the bench's `baseline` leg is now NOT ship truth (ship = stage on).

