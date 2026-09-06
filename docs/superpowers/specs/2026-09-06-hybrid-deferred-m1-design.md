# Hybrid deferred rendering — milestone 1

Date: 2026-09-06. Owner approved the staged direction in conversation and requested a written plan, Dispatch UI execution, and coordinator review.

## Outcome and scope

Build an isolated, runnable comparison scene containing a real wounded SDF zombie, a textured stone room, a mesh occluder, and moving point/spot lights. Both opaque representations publish surface attributes to the same lighting implementation. Preserve independent SDF resolution. Keep the existing game/lab rendering path as the baseline and default.

This milestone establishes the surface/lighting boundary and measures its cost. It does not migrate the entire game, enable deferred by default, add clustered light culling, or promise a frame-rate improvement. Those are subsequent milestones, conditional on this result. The user approved this first-milestone scope in the preceding discussion.

## Current architecture and constraints

- `sdf-layer.ts` renders lit mesh color, then lit SDF color at a separate resolution, then composites SDF clip depth against mesh depth. Float alpha carries WebGPU clip depth; changing that convention in the existing path is out of scope.
- `march.wgsl.ts` combines tracing, normal/material evaluation, direct/ambient lighting, local shading effects, emission, and legacy display compensation. `zombie-gpu.ts` binds its long positional signature; every variant must remain compatible.
- `game-main.ts` copies flashlight values into actors, bone tubes, and baked chunks. The SDF muzzle flash temporarily alters the flashlight rather than using an independent light slot.
- `dungeon-lighting.ts` uses a level-only shadow twin so flesh does not see the inflated character shadow hull. Deferred does not eliminate that receiver/caster distinction.
- The default renderer and its shader signatures, SDF marching constants, wound geometry, tile defaults, body materials, and user assets must retain their behavior.

## Pipeline

1. Rasterize opaque mesh material attributes into a full-resolution mesh G-buffer, with hardware depth testing.
2. Trace SDF surfaces once per candidate fragment into a separately sized SDF G-buffer. Use the existing field/hit/normal/material implementation, not a simplified replacement character or a second marcher per attachment.
3. Resolve visibility into a full-resolution G-buffer by comparing compatible clip depths. Select all attributes from the same winning source/sample. Use nearest sampling for the low-resolution SDF, preserving the game's pixel style; do not blend normals/materials across silhouettes. Equal depths deterministically favor meshes. A miss is depth 1 and material ID 0.
4. Evaluate a single shared lighting shader on the resolved visible surface. Reconstruct world position from clip depth, pixel coordinates, and inverse view-projection. Point/spot lights have a fixed-capacity uniform/storage array with runtime count; moving or enabling a light must not recompile geometry shaders.
5. Output linear HDR color, then perform exactly one final display conversion. The isolated fixture owns this chain. Existing post-AA/legacy SDF gamma compensation is not applied to G-buffer data.

This is a hybrid deferred foundation: blended smoke and similar effects remain forward in a later game integration. The fixture has opaque/cutout content only; it must not claim general transparency support.

## Surface contract

Use named MRT attachments with explicit formats and an actual device-limit check:

| Attachment | Format | Channels |
|---|---|---|
| `albedoRoughness` | rgba16float | linear albedo RGB, perceptual roughness |
| `normalMetalness` | rgba16float | world-space unit normal XYZ, metalness |
| `emissionClass` | rgba16float | linear emission RGB, small integer material class |
| `surfaceDepth` | r32float | WebGPU clip depth in [0,1], 1 for empty |

This is 28 bytes of color attachment data per sample, plus the hardware depth attachment. Confirm WebGPU format accounting on the actual adapter. Reject unsupported limits explicitly, not by creating a subtly different format. All data textures have `NoColorSpace`, nearest filtering, and no blending. No separate world-position attachment. A depth hardware buffer is still required for each geometry producer.

Material classes: 0 empty, 1 standard stone/mesh, 2 flesh, 3 flat-face/decal. Flesh-specific specular/fresnel settings may be separate small lighting uniforms shared by class. Wound tissue color, char, surface normal detail, wetness-derived roughness, and emission must reach the surface data. Do not encode already-lit color as albedo or emission. Mesh albedo, tangent-space normal map, and roughness map must all participate.

M1 is not pixel-identical relighting: the existing flesh model contains light-dependent scatter, traced wound self-shadow, ambient probes, face-flat compensation, and an intentional gamma workaround. Preserve geometric and material information, retain useful class-specific response, and explicitly inventory any unsupported legacy lighting terms in the report. Never hide omitted terms in prelit material data. Full production look parity is a later gate, not something this fixture proves.

## Public controls and lifecycle

New page: `sdf-deferred.html`. Query `mode=legacy|deferred` selects a mode; legacy remains available at the same camera, body, wound, and resolution settings. The page defaults to deferred because it is explicitly a deferred experiment. Ordinary `sdf-game.html` and labs remain unchanged.

Expose `window.__deferredLab` with mode/scale/light/debug controls, readiness, deterministic stepping, diagnostics, and bounded timing sampling. Debug views: lit, albedo, normal, depth, material. Visible controls should use those names; keep technical diagnostics in the debug API/report.

Use an explicit fixed 800x600 internal `RenderCap`, matching the current game's default, for both comparison modes. Window resize changes CSS presentation only; buffer reallocation is tested separately through `setResolution(width,height)` (800x600 -> 640x480 -> 800x600). Derive SDF target sizes from the internal buffer and SDF scale, not CSS pixels or device pixel ratio.

All owned targets/materials/geometry are disposed. Resize reallocates both producer targets and resolve/output targets, invalidates stale contents, and clears them before sampling. Restore renderer target/MRT/clear settings and camera layers even on errors. Do not sample a texture while writing it. Explicitly validate target/canvas orientation and clip-space conventions with asymmetric geometry.

## Lighting and shadows

Support up to 16 dynamic point/spot lights with a runtime active count. Use inverse-square-style bounded attenuation and smooth spotlight falloff consistently for SDF and mesh. Start with a small fixed loop; do not add tiled/clustered culling in this milestone. No additional field evaluations per light.

Keep M1's new shared lights unshadowed and label that accurately. Capture a pillar crossing in camera depth for visibility validation, not as proof of light-space shadows. Keep the legacy renderer's shadows untouched. The report must make clear that shared shadow receivers, character hull self-exclusion, shadow budgets, and transparent integration remain future work.

## Validation and acceptance

- Real WebGPU shader compilation/rendering is mandatory; TypeScript and string tests alone do not establish success.
- One real wounded zombie and mapped stone mesh respond to the same moving light buffer. Changing lights changes lit pixels on both but leaves their albedo/normal/depth data unchanged with a fixed camera/body.
- Mesh in front of flesh and flesh in front of mesh resolve correctly, including at SDF scales 1 and 0.5. No stretched normals, inverted Y, stale data after resize, or background filled with a false hit.
- Trace/hit/wound geometry matches the legacy path. SDF generation runs once per fragment rather than once per G-buffer output or light. Retain diagnostic/readback evidence and inspect generated shader structure if necessary.
- Capture lit/normal/albedo/depth/material views and baseline/deferred images from a fixed scene. Inspect the images, do not merely write them.
- Run focused tests and typecheck, then build and full tests after dispatch execution is otherwise idle. Preserve user-owned untracked assets.
- Compare warmed legacy/deferred frame time at matching camera, scene, resolutions, and 1/8/16 active lights, with repeated alternating runs. Report p50/p95, adapter, resolution, timing method, and known baseline lighting differences. Do not call CPU submit time GPU time. No performance claims while other GPU jobs are active.
- Coordinator reviews code, checks claims against evidence, and reruns the meaningful WebGPU gate before recommending further migration. No automatic merge to main or production default flip.

## Follow-on milestones, not queued by this plan

2. Opt-in game adoption including bone tubes, baked chunks, blood material response, existing shadows, forward transparency, fog, and post-AA.
3. Tiled/clustered light culling and a measured shadow budget.
4. Selected postprocessing effects using common depth/normals.

## Alternatives considered

Shared forward/Forward+ would reduce duplicated light definitions and support many lights with less G-buffer bandwidth, but would retain separate surface-shading integration paths. A full immediate game rewrite would expose too many independent material, shadow, depth, and postprocessing risks at once. The isolated deferred vertical slice tests the new boundary before either decision.
