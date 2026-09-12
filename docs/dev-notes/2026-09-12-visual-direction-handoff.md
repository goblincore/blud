# Visual direction — session handoff, 2026-09-12

Written to survive a context reset. Covers where the neural upscaler landed, what the owner decided
about using it as an aesthetic tool, and the two other visual projects that came out of the
conversation (blood, gibs). Nothing here is implemented beyond P3 — the rest is agreed direction
and open questions.

Branch: `claude/image-upscaling-srcnn-6810da`. Memory: `dualmem recall "neural upscale"`.

## 1. Where the upscaler landed (done, verified, owner-approved)

The ESPCN-family flesh upscaler ships 400×300 → 800×600 on the marched flesh layer.

**Owner verdict 2026-09-12: worth it.** Playtested in-game, stable 30 fps, "smooth and details are
not bad", surprised how good it looked.

| | overall | face | wound | edge | medium | far |
|---|---|---|---|---|---|---|
| nearest | 0.0314 | 0.0431 | 0.0311 | 0.0798 | 0.0277 | 0.0394 |
| **bicubic (the G4 bar)** | **0.0284** | 0.0405 | 0.0290 | 0.0728 | 0.0240 | 0.0379 |
| native single-ray | 0.0141 | 0.0203 | 0.0140 | 0.0402 | 0.0123 | 0.0181 |
| best model (s32-rgbd, pod) | 0.0233 | 0.0336 | 0.0224 | 0.0641 | 0.0208 | 0.0288 |

All six grid runs passed G4. Cloud spend: **$2.21**.

### Numbers that change what to do next

- **Training length is spent.** 20,000 steps beats 2,618 by 3 % (s8-rgb 0.0248 vs 0.0255). The gap
  to native is **not** a compute problem — it is information and capacity.
- **The upscaler is nearly free.** `sdf:march` costs 6.7–13.1 ms (20–27 during gibs) and a half-res
  march saves ~8 ms of a frame. The model's ~0.2–0.5 ms is rounding error at 30 fps, so 5–10× the
  capacity is affordable if quality needs it. (Exact ms: the P1 Task 6 cost bench is still deferred,
  held in `~/.claude/dispatch/plans-hold/`. Run it when the GPU is quiet.)
- **Local training beats the rented pod.** MacBook Air 11–21 steps/s vs the RTX 4090 pod's 1.4–4.5.
  The step is kernel-launch bound, not FLOP bound; the pod had 12 shared vCPU. `--compile` fuses it
  for 2× (56.0 → 28.3 ms/step). **Train locally; do not rent GPUs for this workload.**
- Two hypotheses measurement killed, so nobody retries them: the crop sampler is 17 % of a step (not
  the bottleneck), and replacing four `index_select`s with one `gather` in `reconstruct` is
  bit-identical but **2× slower** on MPS.

## 2. The conceptual boundary that governs everything below

The upscaler is a **2× surface enhancer with a 7×7 input receptive field**. It can change how
surfaces look — sharper, wetter, differently shaded, differently lit. It **cannot change
silhouettes**: it will never turn a blob into a torn limb, and it cannot invent fluid dynamics.

And with an L1-family loss it cannot hallucinate at all: under uncertainty L1's optimum is the mean,
which is blur. Inventing detail requires a perceptual or adversarial loss — which costs **nothing at
inference**, because the discriminator is training-only.

## 3. Aesthetic direction (agreed, spec not yet written)

Use the upscaler as an aesthetic instrument, not just a fidelity restorer: a **90s pre-rendered CG
look**, explicitly *not* a Blood-sprite reproduction. Reference point is soft ray-traced —
Myst / FF7 backgrounds: soft shadows, bounce light, atmospheric softness.

**Scope: characters only** for now. The stage only touches the marched flesh layer; the level,
weapon and post chain bypass it. Whole-frame is a separate, later question. This is also
historically what these games did — Blood's enemies were pre-rendered CG sprites in a real-time world.

**Approach:** enriched inputs (normals, maybe albedo — the "richer aux inputs via MRT" the spec
deferred twice) **plus** a perceptual/adversarial loss. Frame budget: the owner said ≤0.5 ms, which
the march numbers say is far tighter than necessary.

### Resolved in conversation (2026-09-12)

**1. The target is your own renderer with the brakes off.** Alignment is not the problem — the P3
capture already freezes the scene and renders it twice, and posing a character identically is easy.
The question was which renderer produces the look, and the answer is the existing march with
expensive settings: more AO samples, more shadow rays, finer steps, better probe sampling. Same
scene, same camera, alignment free; the work is shader work, not capture work.

**Rejected: an offline renderer (Blender).** The characters are SDFs, not meshes. Meshing them and
matching camera, FOV, lights and materials across two renderers guarantees small mismatches, and a
mismatch teaches the net to change silhouettes — which it structurally cannot do (§2), so it would
learn to blur instead.

**FIRST TASK, before any capture or training: produce ONE still frame that looks right**, by any
means and however slow. The net only ever copies; if the expensive render does not look
pre-rendered, no amount of training gets there. This is a cheap gate — one frame, one afternoon of
shader knobs — and it decides whether the project is real.

**2. Inputs, ranked — and the cost lands on the march, not the upscaler.** Extra input channels come
from the march target, so they widen the 6.7–13.1 ms pass, not the 0.3 ms model.

- **Normals** — the big win. Orientation is what says where a crease darkens, which is most of what
  soft ray-traced lighting is.
- **Albedo** — separates "dark because painted dark" from "dark because shadowed". Earns its place
  if the target relights the scene.
- **Material id** — only worth the bandwidth once the roster has genuinely different materials.
  Flesh, flesh and flesh buys nothing.

Also an overfitting angle: more channels with only three characters give the net more ways to
memorise instead of generalise.

**3. How to judge it, without only eyeballing.** Once a *look* is the goal the old metric is
actively misleading — a model that looks better will score worse on 0.0233 — so the G4 structure has
to be replaced, not reused. Three mechanisms, all three wanted:

- **Temporal stability as a number.** Render a slow camera move; measure frame-to-frame change in the
  output that is NOT explained by change in the input. Flicker becomes a metric. Most important of
  the three: it catches exactly what still frames hide and what would ruin the game in motion.
- **A perceptual distance (LPIPS)** in place of L1 for *reporting*. Compares images the way a vision
  model does; correlates with human judgement far better. Training-time only, so no frame cost.
- **Blind forced-choice A/B.** Same scene, two variants, randomised, labels hidden, owner picks.
  Keeps the human as the judge while removing the bias of knowing which is which.

**4. Temporal stability is the central risk** for characters — invented detail that flickers is worse
than no detail — and notably *not* a risk for blood or gibs, where chaotic inconsistency is invisible.
That asymmetry is why gore is the safer place to be ambitious and faces are not.

## 4. Blood — overhaul, conventional rendering first

**Owner's goal:** blood that reads as actual liquid. Reference: the UE 5.1 Niagara blood look
(cghow tutorial) — thick glossy splatter sheets with ragged tendrils, separated droplets, spray.
Screenshots compared in-session: current blood is a handful of ~2 px orange specks; the reference is
volumetric, connected, glossy.

**What already exists** (`goo-layer.ts`): a textbook screen-space fluid pipeline — density splatting
into a **half-res** additive float target, separable Gaussian blur (the grapes→sheets fix), a surface
pass with density-gradient normals, Beer-Lambert thickness, specular, Fresnel rim, reconstructed
depth. Plus `blood-view-gpu.ts`, instanced billboard droplets. Cost: `goo:density` 12–28 ms.

**Why it still reads chunky — hypotheses, in order of suspicion:**

1. **The Gaussian is the wrong filter.** It smooths across depth discontinuities, flattening the
   field into plateaus. The canonical fix is a **narrow-range filter** (Truong & Yuksel) or curvature
   flow: smooth within a depth band, preserve silhouettes.
2. **No refraction.** Specular and Fresnel are there, but nothing bends the background through the
   blood. Refraction is most of what makes a viewer read "liquid" instead of "red plastic".
3. **Half-res density** under all of it, so the grid shows through.
4. **Volume and connectivity**: the current scene has far too few, far too small particles to fuse
   into sheets at all.

**Sequencing agreed: look first, cost second.** You cannot train toward a target you cannot render.
Build the good-looking version conventionally; *that becomes the target*; then a net can learn it
from a quarter-res field and hand back a chunk of the 12–28 ms.

**Worth investigating:** the reference asset's look comes largely from **pre-simulated splatter
meshes**, not metaballs. Supplementing (meshes for dramatic splat events, goo for pooling and trails)
may beat overhauling.

## 5. Gibs — parked

SDF gib chunks currently read as "rods and orb blobs"; the owner wants ripped and torn. **The
upscaler cannot fix this** — it is a silhouette problem (see §2), so the fix is upstream geometry or
art. A WIP branch is replacing marched SDF gibs with prebaked meshes for performance; the open
question there is making the meshes look good.

Note the trade: **meshes render in the poly pass and bypass the upscale stage entirely**, so moving
to meshes removes gibs from the learned-enhancement path.

Parked until the mesh rework lands or the upscaler's measured cost changes the picture.

## 6. Next actions

- [ ] **Cost bench** (deferred P1 Task 6, in `plans-hold/`): real ms for s8/s16/s32 in both layouts,
      on a quiet GPU. Gates how much capacity the character work can spend.
- [ ] **Character generalisation check** — no training needed: spawn a lab character the model never
      trained on (it saw only zombie, goblin, soldier) and look. The net learns local statistics, not
      identity, so it should hold up; novel *materials* (metal, glass, fur) are the risk.
- [ ] **Local grid finishing**: s8/s16 done (0.0248/0.0253/0.0238/0.0240), s32 running. Expect ~3 %
      better than the pod's models — not visibly different.
- [ ] **The still-frame gate** (first real task for the character look): one frame, expensive settings
      in the existing march, that the owner actually wants. Everything else is downstream of it.
- [ ] Then: brainstorm → spec for **either** the character pre-render look **or** the blood overhaul.
- [ ] Owner: more side-by-side comparisons to name specific artifacts (shimmer, mush, distance).

## 7. Where things live

| | |
|---|---|
| Models (12 exports, G3-verified) | `.upscale-models/` (gitignored) |
| Dataset, 1,000 pairs | `~/blud-upscale-data/v2-2026-09-12` |
| Local grid runs | `~/blud-upscale-data/runs-local-2026-09-12` (dashboard.json + index.html) |
| Pod run artifacts | `.upscale-models/_pulled/ads3oxjqv25e7o/` |
| Plans and specs | `docs/superpowers/plans/2026-09-11-neural-upscale-p3-*.md` |
| Results notes | `docs/dev-notes/2026-09-11-neural-upscale/` |
| Owner-facing overview | `docs/superpowers/plans/2026-09-11-neural-upscale-p3-overview.md` |
| Obsidian write-up | `Claude Notes/Research/2026-09-12-neural-upscale-p3-training-run.md` |

The pod `ads3oxjqv25e7o` is **stopped, not deleted** — `runpodctl pod delete ads3oxjqv25e7o` when
the models have earned their keep.
