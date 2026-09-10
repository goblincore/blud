# Blud 320×240 → 800×600 Neural Upscaling Experiment Plan

> **For agentic workers:** Use superpowers:executing-plans to execute this gated experiment task-by-task. Planning is approved; execution has not started.

**Goal:** Test whether a tiny model trained on Blud can reconstruct acceptable 800×600 gameplay from actual 320×240 renders, while retaining a meaningful net performance saving.

**Architecture:** Benchmark a fixed-size custom spatial network before training. If inference fits the measured rendering headroom, train a small pilot on matched Blud renders, evaluate unseen moving sequences, then integrate the trained candidate behind a dev flag. Temporal reconstruction is a separate conditional follow-up.

**Tech stack:** Existing Three.js/WebGPU/TSL/WGSL renderer, Vite, Vitest; isolated Python/PyTorch training environment. Prefer a direct WGSL implementation of the small fixed network so it shares the renderer's GPU device. ONNX Runtime Web is an alternative only if operator support and GPU interoperability are verified.

**Spec:** The September 8 user correction and approval: actual 320×240 input, 800×600 output, custom Blud training first, cheap spatial controls, early runtime-cost gate. This supersedes the previous larger-output/Anime4K proposal.

## Global constraints

- Exact target: 320×240 → 800×600, 2.5× per axis, 6.25× fewer input pixels. This is not a claim of 6.25× faster gameplay.
- Start with the fully composed 3D scene at 320×240, including world, actors, and effects; retain HUD/text at 800×600. A later SDF-only variant needs a separately labelled comparison and depth/coverage design.
- Canvas backing remains 800×600 with 4:3 CSS letterboxing, independent of devicePixelRatio. Do not use CSS resizing as evidence of reconstruction.
- Forward renderer and accepted mesh skeleton remain the control. Deferred stays opt-in. Keep default game behavior unchanged; all experimental seams are dev-only.
- Execute in an isolated worktree; preserve unrelated character/assets changes. Do not merge or push as part of the experiment.
- GPU capture, inference benchmarks, and training run serially. Own and clean up only the experiment's resources.
- Use original or appropriately licensed content for training. Extracted Blood placeholders must not enter a distributed dataset/model or committed capture evidence. Audit fixture content before collecting pairs.
- Initial effort is a bounded local pilot. No cloud training, paid compute, broad model search, or large training run is implied.
- Anime4K is removed from the experiment. Arm NSS remains a reference and possible later temporal investigation.

## Hypothesis and comparisons

The model learns the relationship between our low-resolution raymarch/render artifacts and our desired 800×600 appearance. Training targets are the identical simulation state rendered at 800×600. Downscaling an 800×600 screenshot is not an adequate substitute for actual 320×240 input.

Compare at the same final 800×600 backing size:

| Mode | Scene rendering | Reconstruction |
| --- | --- | --- |
| Native control | 800×600 | Existing presentation |
| Low-res control A | 320×240 | Nearest |
| Low-res control B | 320×240 | Bilinear |
| Low-res control C | 320×240 | FSR 1 EASU/RCAS, if needed after the minimal pilot |
| Custom neural | 320×240 | Fixed 2.5× Blud network |

First diagnose all modes with FXAA and smear disabled, holding lens/color treatment constant. Train and infer at the same pre-post-processing seam. Separately assess the candidate with the accepted presentation effects, including smear 0.25; report the exact effect ordering for every mode. Preserve the shipped 800×600 appearance as the user-facing acceptance reference.

Missing features are a fundamental risk: a rib or distant silhouette that never reaches a low-resolution pixel cannot reliably be recovered from that frame. Look for stable reconstruction and readability, not invented detail. Inspect chunky shapes, gritty surfaces, wounds, bones, dark contrast, and combat effects in motion.

## Code landmarks inspected during planning

All paths below are relative to `src/lab/sdf-zombie/webgpu/` unless stated otherwise. Recheck them against the execution checkout.

| File | Role |
| --- | --- |
| `game-main.ts` | Fixed 800×600 resolution default, output sink setup, `setSdfScale`, adaptive resolution, effect controls and resolution readbacks. |
| `post-aa.ts` | Composed scene capture, FXAA/smear, color transfer, Y orientation, lens and presentation. Its existing sharp-upscale mode fills the window and is not the required fixed-output path. |
| `sdf-layer.ts` | Alpha stores depth and the composite writes `depthNode`. Never feed this intermediate RGBA texture to ordinary image reconstruction. |
| `lab-renderer.ts` | Content/backing sizing and renderer/device setup. |
| `game-bench.ts`, `game-bench-scenario.ts` | Stepped scenarios, frame timing and scene census. Reproducibility must be checked, not assumed. |
| `gpu-pass-timing.ts` | Labelled GPU timing; raw overlapping pass durations must not simply be summed. |
| `scripts/sdf-game-skeleton-capture.mjs` (repo root) | Existing freeze/step and browser WebGPU capture pattern. Frozen captures alone cannot establish moving-image quality. |

## Task 1: Measure headroom and establish paired captures

**Create:** `scripts/neural-upscale-capture.mjs`, `docs/dev-notes/2026-09-08-neural-upscaling/notes.md`.
**Modify only as needed:** `game-main.ts` and `post-aa.ts` for dev-only independent scene/presentation sizing and composed-color capture.

- [ ] Record checkout, browser/adapter/OS, input/output target sizes, camera/lens, render flags, SDF scale and scene census. Disable adaptive resolution and verify actual target sizes.
- [ ] Expose 320×240 composed rendering into an 800×600 presentation target, plus a native 800×600 control. Preserve depth interactions before reconstruction and HUD rendering after it.
- [ ] Use frozen simulation snapshots to render both resolutions without advancing camera, actors, animation, particles, lighting, RNG or damage. Capture sequences by advancing once only after both members of a pair are complete. Reset or bypass temporal post state during pair generation.
- [ ] Validate pairing by rendering the same resolution twice; compare pixels and state identifiers. Record any backend nondeterminism separately. If pairing fails, fix it before training.
- [ ] Capture asymmetric patterns to establish orientation, RGB encoding, pixel-center mapping and borders. Record these conventions in a manifest alongside each paired sequence.
- [ ] Measure native and low-resolution full-frame performance on matched scenes, including the low-resolution presentation pass. Record median/p95 and repeat variance. Their difference is the available reconstruction headroom, not an assumed pixel-count speedup.

**Gate:** reproducible aligned pairs and positive measured headroom. If full-scene low resolution has unacceptable rendering defects beyond reconstruction, report them before expanding scope.

## Task 2: Benchmark the custom architecture before training

**Create:** `sdf-upscale-lab.html`; under `src/lab/sdf-zombie/webgpu/upscale-experiment/`: `lab-main.ts`, `spatial-baselines.ts`, `model.wgsl.ts`, `model.ts`, `model.test.ts`; under `scripts/neural-upscale/`: `model.py`, `reference.py`.

**Initial architecture proposal (fixed for the pilot):**

1. Input: display-encoded composed RGB, 320×240, with depth excluded.
2. Three low-resolution 3×3 convolutions, channels 3→8→8→8, stride 1, edge-clamped padding, ReLU after each layer.
3. Bilinearly sample the eight feature channels directly at 800×600 pixel centers using source coordinate `(outputPixel + 0.5) / 2.5 - 0.5`.
4. At each output pixel, concatenate those features with the fractional source-coordinate phase (two values), then apply a learned 1×1 10→3 projection.
5. Add that RGB residual to bilinearly upscaled input. Keep the training output unclamped; clamp only for final display and record this convention.

This handles 2.5× directly; no 2×/3× pixel-shuffle assumption and no hidden larger intermediate image. The proposal is intentionally small and may be insufficient. It contains 1,425 trainable parameters with biases and about 119.5 million multiply-accumulates per frame, excluding interpolation and presentation. Neither number predicts GPU speed.

- [ ] Implement nearest/bilinear baselines and a complete network path with fixed seeded nonzero weights. Use identical packing, border and phase conventions in Python and WGSL.
- [ ] Test the zero-residual case against bilinear output, nonzero weights against Python reference, phase alignment, borders, orientation, invalid dimensions, and disposal. Compare output and intermediate layers; numerical tolerance is 1e-4 absolute for FP32 reference fixtures, with discrepancies investigated before relaxing it.
- [ ] Verify shader compilation and texture validation in a real WebGPU browser. Include RGB packing, all intermediate texture reads/writes, final reconstruction and presentation in timing. No CPU round trip during normal inference.
- [ ] Benchmark on the rendering GPU at the exact target sizes after warmup, then with the game submitting its ordinary work. Random-weight timing is a cost probe only, never a quality result.
- [ ] If inference consumes the measured headroom, try one narrower 4-channel variant, recompute its cost, and repeat parity/timing. If neither fits, stop this architecture before training.

**Gate:** correct GPU/reference parity and complete inference overhead below native-minus-low-resolution headroom, with room for a useful full-frame gain. Small weight size is not a substitute for this gate.

## Task 3: Run a bounded local training pilot

**Create under `scripts/neural-upscale/`:** `dataset.py`, `train.py`, `export.py`, `evaluate.py`, `requirements.txt`; local ignored dataset/checkpoint directories; a versioned model manifest containing dimensions, layer shapes, source revision, color convention and weight hash.

- [ ] Pin the available Python/PyTorch environment after checking local device support; use an isolated environment. Training/export never becomes a production dependency.
- [ ] Collect up to 1,200 paired frames across 12 short distinct sequences. Allocate eight sequences to training, two to validation, and two untouched test sequences. Split by scene/encounter/camera path and lighting, not adjacent frames from one recording.
- [ ] Include slow strafes, rapid turns, moving enemies, close wounds/thin bones, darkness/flashlight motion, muzzle flashes, and sever/gib reveal. Audit content rights and storage before capture; stop at 5 GB for the pilot.
- [ ] Preserve scale alignment during patch sampling: use low-resolution 64×64 crops at even source origins and matching 160×160 targets; retain surrounding convolution context and compute loss on the aligned crop interior. Use whole paired frames for validation/testing.
- [ ] First overfit a tiny training subset to verify learning, pairing and export. If it cannot beat bilinear on that subset, debug before spending the pilot budget.
- [ ] Train with Adam at learning rate 0.001, a fixed seed, RGB L1 plus 0.1 times horizontal/vertical gradient L1, with a proposed ceiling of 10,000 updates or two hours of local training, whichever comes first. Select the checkpoint using validation only. Record batch size, device, wall time, curves and actual stopping reason.
- [ ] Export weights and check trained Python/WGSL parity on held-out fixtures. Evaluate full-resolution unseen sequences with L1/PSNR and visual crops, then play back motion. Do not use unwarped frame differences as a temporal quality score across moving content.
- [ ] Save lossless examples of texture smoothing, hallucinated edges, flicker and missed thin features. Do not add a generative/perceptual adversarial loss to make screenshots seem sharper.

**Gate:** beats bilinear on unseen meaningful content and looks promising in moving sequences. A spatial model has no temporal guarantee; if flicker dominates, stop and document whether temporal input is the next question. No automatic expansion of dataset, model size or compute budget.

## Task 4: Live comparison and gameplay verdict

**Modify:** `post-aa.ts`, `game-main.ts`, `post-aa.test.ts` for the minimal dev-only integration; keep model/runtime logic in `upscale-experiment/`.
**Create:** `docs/dev-notes/2026-09-08-neural-upscaling/verdict.md` and local timing/capture evidence.

- [ ] Load the trained model only when explicitly enabled in development. Expose mode, dimensions and model hash. Unsupported resources, bad weights or shape mismatches fall back to the normal path with an explicit diagnostic; never silently report a fallback as neural.
- [ ] Preserve resize/dispose behavior, color transforms, lens, orientation and depth occlusion. Test actual world, flesh, mesh skeleton, chunks, FPV weapon, goo, particles and output-resolution UI.
- [ ] If the pilot wins against bilinear, compare against pinned FSR 1 EASU/RCAS before calling the neural improvement worthwhile. Record license/version and sharpening strength; use the same inputs without per-scene tuning.
- [ ] For each mode, warm at least 120 frames and run three matched repetitions of at least 600 frames, alternating order. Keep capture separate from timing, browser visible, and GPU jobs serial.
- [ ] Report median/p95 full-frame time, available GPU span, reconstruction overhead, submission cost, pacing, scene census and repeat variance. Include every conversion/copy/synchronization cost; account explicitly for GPU work outside Three's timing hooks.
- [ ] Compare native 800×600, nearest/bilinear 320×240 → 800×600, FSR 1 and trained neural at the exact same presentation size. Repeat visual inspection with accepted post effects. Let the user play the promising configuration.

**Proposed success gate:** the user accepts the 800×600 moving image; neural visibly improves important scenes over cheap controls; median complete frame time improves by at least 15% over native 800×600 and exceeds run variance; p95 is no worse than native; no new sustained stutter or default-path regression. These are proposed experiment thresholds, not results or a promise of 60 FPS. Report distance from 16.7 ms and 33.3 ms budgets.

**Stop rules:** cheap spatial reconstruction wins quality/cost; learned detail is unstable or unreadable; inference erases savings; pairing/timing cannot support a valid comparison. A clear negative result is useful. Do not quietly raise the input resolution to obtain a passing result—the approved question is 320×240 → 800×600.

**Verification after implementation:**

```bash
npx vitest run src/lab/sdf-zombie/webgpu/post-aa.test.ts src/lab/sdf-zombie/webgpu/lab-renderer.test.ts src/lab/sdf-zombie/webgpu/gpu-pass-timing.test.ts src/lab/sdf-zombie/webgpu/upscale-experiment/model.test.ts
npm run build
```

Add executable Python reference/export checks as part of the training tools. Browser shader validation, numerical parity and real gameplay remain required beyond these commands.

## Conditional follow-up: temporal reconstruction

If a cheap spatial model cannot recover thin features consistently at 320×240, propose a separate temporal design using jittered samples, valid history, depth and object motion. Account for deforming flesh, mesh bones, newly cut wounds, severing, camera cuts and particles. Camera-only reprojection is insufficient. History cannot recover content never observed and introduces ghosting risk.

Arm NSS is a useful pretrained/training reference, but its Vulkan runtime is not a browser integration and its exact 2.5× behavior, operator graph, license and port cost must be audited. Custom recurrent reconstruction is another option; neither is part of this initial pilot.

## References from the initial feasibility research

- [FSR 1 spatial baseline](https://gpuopen.com/fidelityfx-superresolution/)
- [Arm NSS model and training resources](https://huggingface.co/Arm/neural-super-sampling)
- [Arm NSS capture requirements](https://github.com/arm/neural-graphics-model-gym/blob/main/docs/nss/nss_data_capture_guide.md)
- [ONNX Runtime WebGPU GPU-buffer IO](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)

## Status

Revised plan only. No model, dataset, training, game changes, dependency installation, benchmark, commit or GPU validation has been performed. The model architecture, training limits and success thresholds are concrete pilot defaults to verify during execution, not measured findings.
