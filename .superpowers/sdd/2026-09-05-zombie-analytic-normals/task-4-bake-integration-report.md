# Task 4 completion and main bake integration

Status: **correctness and artifact-specific technical appearance PASS; scoped code review pending**. Integrated main `b280709` into the isolated candidate with merge `d5c36b2`; only TASKS.md conflicted, resolved with main's current board and actual prototype status. Main checkout and unrelated edits untouched. Default remains off; no push, main merge, or timing claim.

## Remaining Task 4 checks completed

`docs/dev-notes/2026-09-05-zombie-analytic-normals/wound-resume/resume.json` indexes twelve deterministic, byte-identical raw JSON archives (including failures and controls), twelve representative fresh beauty images, and SHA256/size records for 25 external raw RGBA32F files. Original Task4 evidence and failures remain intact.

- Fresh arm and shoulder captures explicitly disable settled-chunk baking before the fresh scene/sever. They record this diagnostic setting. All reported coverage is live SDF pixels; baked meshes are excluded.
- Two identical legacy reads within the four-read bound passed for all five scenes, with exact packed/config/camera state. All legacy/hybrid depth and fallback comparisons are exact; no nonfinite results or scalar failure. The final moving-shoulder scene gives p99 1.6930°, max7.6107°.
- Actual elbow `fireSlug` creates detached `chunk:1`. Chunk coverage is1183/1283 analytic, affected wall32/33, rim400/419. Its prior p99 5.846468578° / max8.913456378° repeats exactly. Eight worst-point CPU/actual-GPU finite-difference probes now validate the chunk adapter, all tetra geometric/noisy owners are0, and noise decomposition agrees. The body has four localized proofs, owners10, p99 1.7288° / max39.3984°.
- Both initial projectile/impact ticks are paired in legacy/hybrid beauty for the elbow and moving shoulder; one subsequent sever-flight frame is paired. Every fresh stronger material/config/scene-state comparison passes. The earlier12/24frame sequences remain historical evidence; they were not replayed.
- Root independently reviewed the fresh body/chunk beauty, second initial tick elbow/shoulder pairs and later sever frame, and recomputed point proofs. It accepted only the exact arm SHA `e22b87be5cc6665beee71dd8e8f9ee1d5c7ad76e0c8511c0c4910ae80b363a7c` and shoulder SHA `f8c946ab8e333f5a12fa0b218310a881dcb114afcbdb989ce704fe71a9021abd`. Specific angle flags are diagnosed finite-stencil appearance approximations, not gradient defects. Raw captures still say technicalBeautyReviewed=false and retain exit1 flags; the separate artifact-specific adjudication records acceptance. No blanket threshold waiver or stencil-mimicking shader fallback was added.
- Earlier accepted head/torso/overlap/curved-internal evidence plus these final checks satisfies Task4. New shoulder curved-internal39hits also have zero analytic pixels.

## Combined settled-chunk bake compatibility

Separate fresh page leaves main's bake setting **ON by default**. `scripts/zombie-normal-bake-integration.mjs` passes8/8 checks: mode1 inherited on spawn;2live→2baked/0liveSDF transition; retired pooled views receive mode0/1 while baked meshes remain; actual buckshot re-gibs a baked mesh into mode1 live pieces; fifteen synthetic spawns exercise the12-view ring and reuse identities; reset inherits mode0, then toggle1 reaches all live reused views. These are synthetic test chunks through the real lifecycle, not an anatomical-sever claim. No sampled-volume cache is involved. Mesh normals remain main's vertex normals outside SDF shading.

## Diagnosed transport failure and fix

Initial integrated shoulder/arm drivers and a bake check timed out30s before receiving a full raw result. Cleanup initially hid the original error; the driver now retains operationErrors and catches cleanup errors separately. Fresh simple rendering, direct hash readback, shipping defaults, pinned clock and staged closeup all passed. A reduced result from the same readMarchTarget took166–178ms. The full10MB response timed out60s **after** logged GPU step/timestamp/pixel completion, proving a CDP transport stall rather than failed GPU work. Node runtime was v25.9.0; no unsupported claim about a particular Node internal cause.

`readNormalRaw` retains one image in-page and pulls256KiB slices, verifying exact metadata/decoded byte length and matching page/host FNV1a. In-page PNG and woundROI reuse that same retained frame instead of sending the large payload back. The final owned actual-GPU run succeeds at the same800x600 target. Temporary GPU-stage console instrumentation was removed after diagnosis; production TypeScript/shaders have no post-merge edits. No render-resolution reduction or runtime-dependency change.

## Verification and ownership

- `node --test scripts/lib/normal-gradient-intact.test.mjs`:14/14 pass, including bounded raw transfer exact reconstruction and truncation/hash negative controls.
- `npx tsc --noEmit`: pass on the combined main/candidate after diagnostic changes.
- Both drivers syntax-check; `git diff --check` passes.
- Final guarded owned lifecycle starts at load1=5.52246. Arm exits1 only for fresh review flags and explicit focused-scope sentinel; bake exits0; shoulder exits1 only for focused-scope sentinel. All owned processes closed via trap, ports5251/9251 free. Historical transport failures and60s control retained. No full suite or timing run.
- Root authorizes ownerLook pass specifically for the owner's manual d1a7450 wound/gameplay approval (“looks good,” no distinguishable mode difference, no perceived perf change). Combined branch has separate technical GPU validation. This is not measured performance.

Gates now record wounds/visualEvidence/ownerLook pass and timing pending. Full Task5 paired timing and scoped implementation review remain; the candidate stays default off.
