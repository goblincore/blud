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
- **Bench (final run, g1-cost.md):** ship config ≈ native frame cost (9.1 vs 9.3 ms room 1, 10.5 vs 10.8 room 5 —
  the stage + sharpen spends what the half march saved); s64-rgb ≈ 1.4×, s64d-rgbn ≈ 2.7–3× baseline (tight
  spread, real). Normal-attachment cost below the noise floor.
- **Open:** the trained-smoke parity bar for 64-wide models (moot if s64 is not pursued); the bench's
  `baseline` leg is the pre-stage march, not ship truth (follow-up in TASKS).

## 9. Run 3 (launched 2026-09-12 19:00) and the run-4 candidate

**Run 3** (`.lab-tmp/grid-run3.sh`, dataset v3, 12k steps): t24-rgbn and t16-rgbn (3 layers, middle dilated 2 —
RF 7 → 11 texels, ~s32 / ~half-s32 MACs); t24-rgbn-dw1.0 and s32-rgbn-dw1.0 (gradient/detail weight 0.5 → 1.0 —
the "sharpen in training" experiment; the s32 variant isolates the axis against s32-rgbn 0.0158);
t24-rgbn-rep (3x3‖1x1‖identity branches, fused at export — same runtime cost). Built for it: per-layer dilation in
the ladder + JSON (`dilation`, absent = ladder value), the TS twin/WGSL taps, `RepConv.fuse()` (exact), grid
flags `--detail-weight --reparam --tag`. G3 PASS on random dilated/fused exports; compile smoke PASS.

**Owner observation (2026-09-12):** the skin's procedural bump (perlin-style normal perturbation on soldier and
zombie) washes out through the upscaler, most visibly as lost specular grain under the flashlight. Cause: the
bump is at or below one march texel at 400×300; the march samples it once, the 16-sample target averages it,
and L1 predicts the mean — three averaging steps. A gradient weight cannot restore detail the input never had.

**Run-4 candidate — full-res procedural detail channel (radiance demodulation).** The bump is procedural, so it
is FREE at output resolution: evaluate the same noise / bump normal at 800×600 from the march's seed and feed it
to the net as a full-res input, so it re-synthesises the specular grain over the low-res lit surface instead of
guessing. Needs one extra full-res texture in capture and stage, and a first-layer branch at output resolution
(a change to the pixel-shuffle structure). Stopgap: bump amplitude / flashlight gain in the march (changes the
native look too).

## 10. Demodulation — the general trick, and where else it applies (2026-09-12)

Rule of thumb: anything that is a function of **surface position + a seed** is cheap at full resolution;
anything that is a function of **light transport** is expensive. Split the picture into those two factors,
march only the expensive one at 400×300, and let the net recombine them. Candidates in Blud:

- **Albedo / face sheet** (the classic radiance demodulation): the face decal, palette ramps, wound and char
  colouring are lookups given a surface point. Upscale unshaded irradiance only, remodulate with full-res
  albedo — the face texture stops blurring through the net entirely.
- **Skin bump** (§9): procedural normal perturbation, re-evaluated at 800×600 from the march's seed.
- **Wound geometry**: rims are procedural carves with their own colour bands — re-evaluate edges at full res.
- **Blood goo**: density/thickness are low-frequency (half-res is fine); the surface-normal detail and specular
  highlight that read as "liquid" are the high-frequency factor, computable at full res over low-res thickness.
- **Anything with a seed**: skin mottle, char crackle, bone-tube flecks.

Shared plumbing: every full-res procedural needs a **surface point per output pixel**; the march gives one per
low-res texel, but depth + the normal we now export define a plane per texel, so the full-res position is a
cheap local reconstruction, not another march. That reconstruction is the enabling step for all of the above.
Does NOT apply to soft shadows / bounce / AO — those are light transport and stay the net's job (the
pre-rendered-look direction), so the two directions are complementary.

## 11. Owner note — revealed flesh reads "smooth blobby red" (2026-09-12, screenshots)

The soldier's skull-reveal state shows red flesh that reads as a smooth blob; the owner wants texture, grit,
noise and specular variation so it reads as flesh + blood + wound. Two causes, two fixes:

1. **The shader gives it none.** In `MARCH_BODY_SURFACE_PREP` the wound region is a colour ramp plus a
   single wetness boost (`wetWound = max(wm * lip, gore)`, `woundWetBoost` 1.6–2.15, one `specPow`). No
   albedo noise, no per-texel wetness variation, no fibre direction. Meat needs: (a) a dark clotted fbm
   speckle in the albedo (two octaves, tissue-space so it does not swim), (b) wetness modulated by a second
   noise so the highlight breaks into glints instead of one sheet, (c) anisotropic striation along the bone
   or limb axis for muscle, (d) darker crevices where the carve depth is highest (the `tissueDepth` term is
   already there to key it), (e) a slight `specPow` spread (tight glints on blood, broader on muscle).
   This is shader work in one section of march.wgsl.ts, a few hours, and it improves the NATIVE look too.
2. **The upscaler averages what little there is** (§9). Once (1) exists at march resolution it will still be
   softened at 400×300 — which makes the wound band a prime demodulation candidate (§10): evaluate the
   wound noise/wetness at full res from the same seed and let the net apply it.

Order: shader detail first (it is the target the net would learn from), then the full-res channel.

## 12. Run 3 results (2026-09-12 evening) — the cheap axes are FLAT

Dataset v3, 12k steps. Reference from the v3 grid: s32-rgbn 0.0158 (edge .0621), s64d-rgbn 0.0145.

| run | overall | face | edge | far | best step | wall s |
|---|---:|---:|---:|---:|---:|---:|
| t24-rgbn (3 layers, dilated, ~s32 MACs) | 0.0159 | 0.0235 | 0.0616 | 0.0251 | 8500 | 771 |
| t24-rgbn-dw1.0 (gradient weight 1.0) | **0.0157** | 0.0232 | 0.0614 | 0.0250 | 8500 | 880 |
| t24-rgbn-rep (reparameterised) | 0.0159 | 0.0234 | 0.0620 | 0.0252 | 11000 | 895 |
| s32-rgbn-dw1.0 (known net, weight only) | 0.0159 | 0.0235 | 0.0623 | 0.0251 | 11000 | 559 |
| t16-rgbn (~half s32 MACs) | 0.0164 | 0.0239 | 0.0636 | 0.0259 | 11000 | 561 |

**Read:** every s32-cost variant lands within ±1 % of s32-rgbn. Dilation, reparameterisation and the doubled
gradient weight are all neutral on the L1 metric. The only lever that moved it was raw width+depth (s64d, −8 %),
which the bench priced at ~3× the frame and the owner rejected. So on THIS metric and THIS input the s32 cost
class is saturated — the remaining gap to native (0.0098) is information the 400×300 input does not carry.
Two things follow: (1) **t16-rgbn is the cheap-tier candidate**: half the compute, 3 % behind s32-rgbn — worth
an in-game look; (2) the next quality step is not another net shape, it is **more input at full resolution**
(§9/§10 demodulation: procedural bump/wound detail channels) and a **look metric** instead of L1 (research note).
dw1.0 may still LOOK sharper — the metric cannot see that; it needs eyes (`?upscale=trained&upscalemodel=
r3-t24-rgbn-dw1.0` vs `r3-t24-rgbn`, both staged in the dev store as `r3-*`).

Built for run 3 and kept: per-layer dilation across ladder/JSON/twin/WGSL, RepConv with exact fuse, grid flags
(`--detail-weight --reparam --tag=` — note the `=`: a tag starting with '-' is otherwise read as a flag).


## 13. Run 4 results (2026-09-13) — the full-res head is a keeper, and a subtle one

Controlled pair on dataset v3.1 (652 / 57 pairs, detail fields): same s32-rgbn net, same interior weight 2, with
and without the output-res head fed by the `sdf:detail` noise field.

| run | overall | face | wound | edge | interior | best step |
| --- | --- | --- | --- | --- | --- | --- |
| s32-rgbn-int2 (control) | 0.01474 | 0.0214 | 0.0111 | 0.0617 | 0.00878 | 11000 |
| s32-rgbn-head-int2 | **0.01443** | **0.0207** | 0.0112 | 0.0611 | **0.00852** | 11000 |
| t16-rgbn-head-int2 | 0.01505 | 0.0220 | 0.0114 | 0.0614 | 0.00915 | 6500 |
| bicubic | 0.01751 | 0.0251 | 0.0141 | 0.0675 | 0.01111 | |

- Head beats control by 2–3 % on every region — inside run noise, so the metric cannot settle it. L1 against a
  16-sample box-averaged target rewards the mean; a head that adds real relief can score flat and still look better.
- **Owner look (in-game, U-key A/B, 2026-09-13):** "the heads look good — rather subtle, not a huge difference, but
  not a regression for sure." Verdict: keep the head. It is not the visual step-change the plan hoped for.
- Gates: G3 PyTorch-vs-twin PASS 7e-7 on the head export. Trained-smoke GPU-vs-twin: control 1.5e-3, head 3.0e-3
  vs the 2e-3 bar, coverage/depth exact — the head's extra f16 full-res pass, same class as the s64 finding. Bar
  unchanged.
- t16 with the head peaks early (6500) and lands 4 % behind s32: the head does not rescue the half-cost tier.
- Staged: `.upscale-models/r4-*`; `?upscale=trained&upscalemodel=r4-s32-rgbn-head-int2`.

**Reading.** The head plumbing works and the net uses the channel, but a noise-only detail field carries little
the target rewards — the skin noise is the *smallest* relief in the image. The channel is the right shape; the
signal in it is thin. Next inputs on the same plumbing, in order of expected payoff (see the Obsidian note
`Research/2026-09-13-upscaler-sample-the-surface-not-the-march.md`):

1. **One-step SDF refinement at output res** — interpolate the hit point from the 4 march texels, 1–2 SDF evals to
   Newton-step onto the surface, 4 more for a true output-res normal. ~10–20 % of march cost, real geometric
   relief (muscle, knuckles, wound rims) into the same head.
2. **Wound meat noise + albedo through the same anchor channel** — the rest of the demodulation from §10.
3. **Temporal** (anchor-derived motion vectors, warped previous output, learned blend) — the Qualcomm design.
   Shares the MV work with shutter motion blur, which the owner wants built conventionally first.

Not worth doing: higher target resolution or a different scale factor (§ the Obsidian note); more net shape (§12).
