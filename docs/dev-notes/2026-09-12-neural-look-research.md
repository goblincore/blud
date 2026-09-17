# Research pass — neural upscaling, learned look, liquid blood (2026-09-12)

Three parallel web-research agents, compiled and judged against the plan in
[upscaler-next-steps](2026-09-12-upscaler-next-steps.md). Obsidian copy in `Claude Notes/Research/`.
Long-range framing (owner): a general "pre-rendered retro CGI" neural renderer — a screen-space
G-buffer → image net, trained on our own engine at expensive settings, generalising over characters,
then materials, then the frame, then lighting.

## What changes the plan (ranked)

1. **Predict lighting terms, not RGB.** For the CG look, have the net output AO / soft-shadow /
   bounce as separate channels and composite analytically (radiance demodulation: upscale irradiance,
   remodulate with albedo). Supervised scalar targets are far more sample-efficient than RGB→RGB at
   1,000 frames, keep albedo and edges crisp, and stop the net hallucinating texture. This is the
   single biggest correction to §3 of the handoff. (Deep Shading; radiance-demodulation SR, CVPR 2024.)
2. **Light-space inputs.** Every successful soft-shadow net needed emitter-space depth, n·l and light
   distance, not just screen-space depth+normal — penumbra width is unresolvable from the screen alone.
   Our march already evaluates the flashlight analytically per pixel; export n·l and light distance
   as channels (cheap). Bounce needs an off-screen term (a probe sample) or it hallucinates colour.
3. **Receptive field ≥30 texels at 400×300** for AO/soft shadow. 4–6 stacked 3×3 = 13 px is not
   enough; use a dilated branch or a 2-level tiny U-Net. Still ≤1 ms.
4. **Recurrent previous-output channel with motion vectors** is the cheapest stability win, more than
   any temporal loss. Standard recipe: warp `y_{t-1}` by MVs (dilated by nearest depth in 8×8 blocks),
   feed it + a disocclusion mask (our hit mask makes this near-free), net outputs a blend α. Train
   **unrolled on 8–16-frame clips**. Consequence: the temporal run needs **motion vectors per pair**
   — the capture already records 10-frame sequences, so the delta is an MV buffer from the ray hit
   (per-bone rigid motion is enough), not a redesign. Add before the temporal capture.
5. **Structural reparameterisation**: train 3×3 ∥ 1×1 ∥ identity branches, fuse to one 3×3 at export.
   Free capacity at zero inference cost — the best-value trick for a net this small. Applies to s64 too.
6. **Teacher → student distillation** for the look net: train a wide 64ch/5+-layer teacher on the Air,
   distil with confidence weighting. INT8 not needed (WebGPU fp16 is the norm).
7. **Losses**: keep L1 (or Charbonnier) as anchor ≥0.1–0.3 weight; DISTS/LPIPS on top for look (LPIPS
   alone on a tiny net makes grid noise); small FFT/DCT term for edges; occlusion-masked temporal
   loss; EPE-style LPIPS leash to the raw render to prevent drift. GAN only with a small
   spectral-normalised patch discriminator — ESRGAN-size discriminators overpower a 4-layer generator.
8. **Metrics**: warping error / tLPIPS with engine MVs as GT flow; **CGVQM+D** (Intel 2025, calibrated
   on rendering artifacts) as the headline video number; FLIP for stills; 2AFC blind pairs, ≥20 clips.
9. **Still-frame target: our own engine, not Cycles-on-VDB.** VDB sampling changes silhouettes and
   the normal field, so pixel-aligned losses fight geometry. Use Cycles only for a small held-out
   look-check set. (Agrees with the handoff's "own renderer, slowly" and settles the open question.)
10. **Flips confirmed** (must negate normals/MVs on the flipped axis — done in `CropSampler`). An
    analytic SDF **coverage channel** as input is cheap and on-theme.

Confirms: an ESPCN-class net is a real production design point (Qualcomm ICCV 2023 smallest variant is
16ch × 1 hidden layer; quality came from inputs + history, not width). Arm Neural Super Sampling
(SIGGRAPH 2025) is fully open — weights, PyTorch training code, QAT, paired dataset — the practical
template for the temporal pipeline.

## Blood — supplemental splash system

- The reference looks come from **baked FLIP sims**: Houdini/Blender → mesh per frame → VAT or mesh
  flipbook, plus sprite layers (droplets, spray) and a landing **decal**; 24–48 frames at 30 fps,
  3–6 variants; glossy material (high spec, low roughness, thin-edge translucency, normal detail).
- Blender: Mantaflow FLIP with Mesh on. Vertex count varies per frame, so VAT needs padding (flanb
  VAT add-on targets three.js; OpenVAT triangle-bank). **Simplest robust path: one Draco GLB per
  variant with 36 frame meshes, concatenated into one BufferGeometry with per-frame index ranges,
  InstancedMesh with start/scale/quat, drawRange per frame** — 200–400 KB, sub-0.2 ms.
- Why the current goo reads blocky: we blur a **density splat**; the good demos rasterise sphere
  impostors writing **view-space depth**, filter the depth with the **narrow-range filter**
  (Truong & Yuksel; μ=3r, δ=10r, separable — WGSL exists in matsuoka-601/Splash), reconstruct normals
  from filtered depth, thickness = additive impostor pass, screen-space **refraction** by
  normal.xy·thickness. Stretch impostors along velocity for tendrils. 1–2 ms at half-res.
- Copy-worthy: Doom Eternal ID-buffer mesh decals; splash lifetime ≤1.5 s then hand off to a decal.
- **One-day first slice**: Mantaflow res 64–96, directional burst (hit) + radial burst (gib), decimate
  0.15 + smooth, 36 frames, 4 variants → GLB export script → TSL instanced playback with glossy red
  material, orient to impact normal, stamp decal on despawn. Same day cheap win: narrow-range filter
  on depth + velocity-stretched droplets in the existing goo layer.

## Links

Upscaling: Qualcomm ENSS https://arxiv.org/pdf/2308.01483 · Arm NSS https://huggingface.co/Arm/neural-super-sampling ·
training https://github.com/arm/neural-graphics-model-gym-examples · Xiao 2020 https://dl.acm.org/doi/10.1145/3386569.3392376 ·
Radiance demodulation https://arxiv.org/abs/2308.06699 · NTIRE ESR 2025 https://arxiv.org/html/2504.10686v1 ·
INT8 SR / distillation https://arxiv.org/html/2604.20291v1 · Snapdragon GSR https://github.com/SnapdragonGameStudios/snapdragon-gsr
Look: Deep Shading https://arxiv.org/pdf/1603.06078 (code https://github.com/marcelsan/DeepShading) · NNAO
https://theorangeduck.com/page/neural-network-ambient-occlusion · Neural Shadow Mapping https://arxiv.org/pdf/2301.05262 ·
Soft from hard shadows 2025 https://www.sciencedirect.com/science/article/pii/S1524070325000414 · AMD indirect
https://gpuopen.com/learn/lightweight-attention-based-indirect-illumination/ · EPE https://arxiv.org/abs/2105.04619 ·
G-buffer NST in games https://ieeexplore.ieee.org/document/10458434/ · Intel temporal denoise+SS
https://www.intel.com/content/www/us/en/developer/articles/technical/temporally-stable-denoising-and-supersampling.html ·
CGVQM https://github.com/IntelLabs/cgvqm · losses review https://arxiv.org/pdf/2401.17109
Blood: narrow-range https://ttnghia.github.io/posts/narrow-range-filter/ · Splash WGSL
https://github.com/matsuoka-601/Splash/blob/main/render/narrowRangeFilter.wgsl · demo https://splash-fluid.netlify.app ·
flanb VAT https://github.com/flanb/VAT-blender-addon · OpenVAT https://github.com/sharpen3d/openvat · cghow MK11
https://cghow.com/mortal-kombat-blood/ · Overdraw flipbooks https://www.overdraw.xyz/simulating-blood-splatters-in-houdini ·
Doom Eternal decals https://simoncoenen.com/blog/programming/graphics/DoomEternalStudy
