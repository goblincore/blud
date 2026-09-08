# Skeleton representation comparison — experimental design

## Owner intent

The owner prefers the forward renderer's deliberately readable characters in darkness. Deferred M2 is merged but remains opt-in. Tube geometry demonstrated a speed opportunity but failed shape and lighting expectations, especially skull and pelvis. Compare faithful extracted meshes against sampled bone SDFs before choosing a production representation. This is an authorized research spike, not approval to ship either option.

## Baseline and alternatives

Baseline is latest main cb51bf1b, forward mode, shipped segment bone culling enabled. Use zombie first, soldier to verify transfer, goblin only if the first two pass within the budget. Retired game, unrelated characters, forward+ light culling, organs optimisation and repository relocation are out of scope.

A mesh bake extracts authored bone surfaces in rigid segment-local coordinates and poses them using existing rig transforms. It must preserve skull cavities, pelvis silhouette and ribs; tubes are not the geometry source. Mesh depth alone is insufficient: the current field's bone/flesh union, wound reveal and shading semantics must be reproduced or the mismatch documented as a failed approach. Share the forward authored lighting rules; do not switch to generic PBR or accept a second unmatched lighting model.

A sampled SDF bake stores the authored bone field in segment-local grids and samples it from the existing field evaluation. Keep the same material identity, wound composition, hit/normal path and authored lighting. Trilinear interpolation and transforms do not automatically preserve exact distances or safe steps. Quantify errors, outside-volume behavior, smooth union across segment boundaries, thin structures and non-rigid/scaled cases. Use conservative stepping or procedural fallback where approximation could miss surfaces; report fallback work honestly.

## Shared experimental contract

Opt-in mode names: procedural, mesh, volume. Ordinary game and lab defaults remain unchanged. New modules live under src/lab/sdf-zombie/webgpu/skeleton-spike/. Expose one experiment selector only through a development URL/diagnostic seam. Keep mesh and volume implementations separate, with common segment identity and fixture state. No per-frame baking; cache per character/configuration with explicit invalidation, bounded memory and disposal. Changes to anatomy/rig/sever state cannot reuse stale geometry. Bone organs stay procedural and explicitly counted separately.

## Acceptance and decision

Visual fidelity is a prerequisite for recommendation: matched camera, posed animation, wound state, light state, timestep and resolution; render repeatability floor measured first. Compare skull/pelvis/ribs, intact flesh coverage, shallow/deep wounds, bent joints, severed segments, moving flashlight, darkness, and wet highlights. Capture and inspect normal/depth/material evidence as well as lit images. Never compensate with a global brightness change. A candidate can be rejected with useful evidence; do not relax criteria merely to finish a task.

For a recommendation, report image-space silhouette/depth/normal/material errors, darkest-face/wound readability, seams and light discontinuities at 1x and 0.5x SDF resolution. Numeric differences within a noisy frame floor are not proof of correctness: require deterministic state and visual inspection. No universal speed threshold is assumed. Measure end-to-end GPU frame cost as well as march/mesh/light/copy cost, bake latency, triangles or grid bytes, CPU upload and cache growth. The old tube numbers are an ablation clue, not a guaranteed speed ceiling or speedup for these implementations.

Only one GPU job at a time. Do not benchmark while user preview tabs are actively rendering or another GPU task is active. Do not close foreign tabs/processes. If busy, save all functional evidence and report timing blocked immediately; do not spend a runtime waiting. No main merge, push or renderer default change. Coordinator reviews the result and gives the owner a playable preview before a production choice.
