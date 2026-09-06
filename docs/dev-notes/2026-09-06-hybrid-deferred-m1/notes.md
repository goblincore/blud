# Hybrid deferred M1 — task 1 dev notes

Date: 2026-09-06. Task 1 of 3 (surface buffers, mesh producer, shared lighting).
Spec: `docs/superpowers/specs/2026-09-06-hybrid-deferred-m1-design.md`.

## Baseline

- Worktree: `/Users/donny/.claude/dispatch/worktrees/2026-09-06-hybrid-deferred-m1-task-1` (dispatch worktree, confirmed via `git rev-parse` — NOT the user's primary checkout).
- Base commit: `a555d1d54f02daa496a4d5e26f8627903853a942` (branch `codex/dispatch/2026-09-06-hybrid-deferred-m1-task-1`).
- three 0.185.1 (local `node_modules`, linked/present — no installs).
- Runtime THREE imports from `three/webgpu`, nodes from `three/tsl` (verified `three.tsl.js` exports `mrt`, `screenCoordinate`, `textureLoad`, `normalWorld`, `materialColor`).

## Source baseline reads (before writing code)

- `sdf-layer.ts`: render targets come back with texture v=0 at scene-top (ndc.y=+1); the existing composite compensates with a `flipY` uniform because it samples by `uv()`. Target-to-target passes that sample by integer fragment coordinate need no flip. `outputNode` (not `colorNode`) is required to carry non-1 alpha out of an opaque MeshBasicNodeMaterial. Clear-colour traps: any target whose clear value is a sentinel must be cleared explicitly, never with the scene background.
- `post-aa.ts`: rendering into any RenderTarget applies NO output colour transform (working space); only the canvas pass encodes. Every uv()-sampled quad pass inverts Y once on this backend.
- `stone-textures.ts`: stone maps are DataTextures — albedo tagged `SRGBColorSpace`, normal/roughness `NoColorSpace`. The deferred mesh adapter must preserve those tags (they drive hardware decode); the G-buffer then holds linear data.
- three `MRTNode.js`: MRT outputs are matched to `renderer.getRenderTarget().textures` BY TEXTURE NAME; a material-level `mrtNode` is used as the output struct when no renderer-level MRT is set. `NodeMaterial.js` line ~557: `renderer.getMRT()` is null for direct `renderer.render` into a multi-texture target, so `material.mrtNode` is the mechanism for the producers.
- three `RenderTarget.js`: `new RenderTarget(w, h, { count: 4 })` creates `textures[0..3]` clones; per-texture format/type/name/filter set after construction, before first upload.
- `zombie-gpu.ts` (~line 1050): WebGPU clip z convention in this codebase is ALREADY [0,1] — `clip.z / clip.w` with `cameraProjectionMatrix * cameraViewMatrix`, no `* 0.5 + 0.5` remap. The deferred mesh producer's `surfaceDepth` attachment uses the same formula, and the light pass reconstructs world position by multiplying `vec4(ndc.xy, clipDepth, 1)` by the inverse view-projection directly.
- `Normal.js`: `normalWorld` resolves through `builder.context.setupNormal()`, so it includes the material's tangent-space normal map — the mesh producer gets mapped world normals by reading `normalWorld`, no custom TBN code.

## Decisions (task 1)

- Attachment order is exactly `SURFACE_ATTACHMENT_NAMES` = `[albedoRoughness, normalMetalness, emissionClass, surfaceDepth]`, but nothing downstream depends on order — all access is by name via `getSurfaceTextures()` and by name-matched `mrt()` outputs.
- Formats: three RGBA `HalfFloatType` (rgba16float, 8 B each) + one `RedFormat`/`FloatType` (r32float, 4 B) = 28 B/sample of colour attachments, inside the 32 B default `maxColorAttachmentBytesPerSample` budget. r32float is colour-renderable (non-blendable, non-filterable) in core WebGPU; we use nearest/textureLoad and NoBlending throughout.
- Clear semantics: one shared RGBA clear colour cannot express "depth=1, class=0", so each producer target is cleared every frame by a full-screen MRT quad writing `surfaceDepth=1`, `emissionClass.a=0` (material id 0 = empty), albedo/roughness and normal/metalness zeros; the renderer's own autoClear handles the hardware depth attachment during that pass.
- Orientation: ALL internal passes sample by integer fragment coordinate (`screenCoordinate` → `textureLoad`), which is framebuffer-identity for target-to-target AND target-to-canvas on this backend, so no flip transform exists in the internal chain. The single documented boundary transform is the present pass's `uFlipY` uniform (default 0 = identity), kept adjustable pending task 3's on-screen verification with asymmetric geometry. This differs from sdf-layer's `flipY=1` because sdf-layer samples by `uv()`, which flips once per quad pass.
- Light packing: stride 16 floats (4 vec4) per light — v0 = position.xyz + kind (0 point / 1 spot), v1 = direction.xyz + range, v2 = color.rgb + intensity, v3 = cosInner, cosOuter, 0, 0. Stored in a fixed 4x16 RGBA32F DataTexture (allocated once at max capacity, never resized — the DataTexture resize trap), so light updates are `needsUpdate` uploads with zero pipeline rebuilds. `packDeferredLights` returns a full-capacity array so inactive slots are zero on every update.
- Attenuation: bounded inverse-square — `intensity * window(d)^2 / max(d^2, 1e-6)` with `window = 1 - clamp(d/range)^4` (hard zero at range), spot cone via smoothstep between cosOuter..cosInner. Zero-distance is finite by the d^2 clamp.
- M1 lighting is explicitly UNSHADOWED. Flesh class (2) gets a wrapped diffuse and a clamped, reduced specular as its bounded class-specific response; no per-light field sampling, no legacy gamma compensation anywhere in the deferred chain.
- The mesh producer material copies color/map/normalMap/normalScale/roughness/roughnessMap/metalness/metalnessMap/emissive/emissiveMap/emissiveIntensity/alphaTest/side from the source `MeshStandardMaterial`, forces `transparent=false` and `lights=false` (surface output must be invariant under scene light motion), and writes MRT via `materialColor`, `materialRoughness`, `materialMetalness`, `materialEmissive`, `normalWorld`.

## Verification log

### Task 1 (2026-09-06)

Commands and outcomes:

- `NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lab/sdf-zombie/webgpu/deferred-surface.test.ts src/lab/sdf-zombie/webgpu/deferred-lighting.test.ts src/lab/sdf-zombie/webgpu/deferred-layer.test.ts` — first run failed on missing modules (expected, pre-implementation); final run **32/32 passed** across the three files.
- `npx tsc --noEmit` — clean.
- Real-GPU smoke (temporary fixture, deleted after the run; task 3 owns the durable one): a stone-mapped box parked upper-left, one point light, rendered through `createDeferredLayer` on headless Chrome (`--enable-unsafe-webgpu`, Apple GPU) via the CDP harness on private ports 5261/9261. Evidence: `task1-smoke-report.json` and `task1-smoke-lit.png` in this directory (both inspected).
  - Adapter limits checked on the real device: `maxColorAttachments` 8 >= 4, `maxColorAttachmentBytesPerSample` 32 >= 28 — pass, reported in diagnostics.
  - Resolved G-buffer readback at the box's projected pixel (107, 56): depth 0.9716 (hit), class 1 (mesh), normal ~(-0.066, -0.027, 0.997) (front face + normal-map perturbation), albedo ~(0.184, 0.195, 0.208) (the cold-gray stone), roughness 0.75. Corner (4, 174): depth exactly 1, class 0 — the clear sentinels.
  - ORIENTATION: the hit texel was found exactly at the CPU-projected pixel (upper-left, row 56 of 180), and the lower-left corner read empty — the fragment-coordinate identity convention is confirmed on the real backend, no flip needed (uFlipY default 0 validated).
  - Surface invariance: albedo/normal/emission/depth bytes identical before and after moving the light; lit texel changed (0.0497 -> 0.0344). Both asserted in the report (`surfaceInvariant: true`, `litChanged: true`).
  - The screenshot shows the box upright, upper-left, brick albedo visible — visually inspected, not just written.
- Servers were started by the smoke run and stopped by its trap (verified ports closed afterwards). No other GPU jobs were running (the only foreign vite on this machine serves another worktree on port 5183 and was untouched).

Limitations / handoff notes for tasks 2-3:

- Task 1 renders the SDF producer scene into `sdfTarget` unconditionally; with the task-1 empty scene this just re-writes the clear state. Task 2 must make its march materials emit the same four named attachments (`createDeferredMeshMaterial` in deferred-mesh.ts is the template; class 2 = flesh).
- The resolve assumes the mesh and SDF producer cameras are the same camera (shared clip convention) — task 2/3 must keep that.
- The layer assumes the app's `clearDepth` is the default 1 (it never touches clearDepth; the clear-quad pass relies on autoClear).
- Lighting is unshadowed by design (M1). Depth readback returns Float32 for r32f and half floats for rgba16f attachments (decode as in the smoke report).
- The temporary fixture files (root html, `tmp-m1-smoke.ts`, `scripts/tmp-m1-deferred-smoke.mjs`) were deleted post-run; the report JSON above records every assertion they made.

## Task 2 (2026-09-06) — SDF surface producer

Worktree `2026-09-06-hybrid-deferred-m1-task-2`, branch `codex/dispatch/2026-09-06-hybrid-deferred-m1-task-2`, base = task 1's `7c9974e8` (confirmed dispatch worktree, not the primary checkout).

### What was built

- `march.wgsl.ts`: `MARCH_BODY` is now assembled from named sections — `MARCH_BODY_PARAMS` (the shared 81-input signature), `MARCH_BODY_TRACE` (ray setup, march loop, hit, full albedo/normal material chain), `MARCH_BODY_SURFACE_PREP` (light-independent wet/specPow/glow terms, hoisted above the flashlight), `MARCH_BODY_LIGHT` (flashlight through display conversion). The hoist is arithmetic-neutral: verified by extracting the old template from `git show HEAD` and diffing against the section concatenation — the ONLY differences are the wet/glow blocks moving above the flashlight and the shine exponent taking the name `specPow`. No `.replace()` chains; the sections are one source of truth.
- `deferred-sdf.ts` (new): owns the surface-capture declarations (`SDF_SURFACE_STATE` globals, the NG_STATE parse pattern), `MARCH_SURFACE = fn marchSurface + PARAMS + reset prologue + TRACE + PREP + tail`, the three readback fns (each takes the traced hit as a `dep` input so TSL data flow orders reads after the march), one shared dependency-ordered node chain, and `sdfSurfaceMrtNodes()` (the four named attachments). No imports from zombie-gpu — acyclic: march.wgsl <- deferred-sdf <- zombie-gpu.
- `zombie-gpu.ts`: `GpuViewOpts.output?: 'lit' | 'surface'` (default `'lit'`, no implicit opt-in), trailing `output` param on `createMarchMaterial` (positional-last rule preserved; all existing variants unchanged). Surface mode: entry = `sdfSurfaceMarch` (same signature, one binding block), trace cached with `.toVar('sdfTrace')`, MRT via material `mrtNode`, `depthNode` keeps the real traced clip depth in hardware depth, no colorNode/outputNode. Surface mode deliberately skips the flashlight/scatter/AO/wound-shadow/level-shadow/ambient/shoulder/display-conversion tail.

### Output meanings (from the production hit evaluation)

- `albedoRoughness = vec4(unlit tissue/paint albedo, roughness)`; roughness inverts the light pass's `shin = exp2((1-rough)*8)+2` against the legacy exponent `specPow = mix(mix(128,4,surfCfg.y),220,gloss)`, then folds the legacy wet INTENSITY multiplier into roughness (char widens to matte, wet tightens) — a documented M1 approximation, since the G-buffer has no per-pixel specular-intensity channel.
- `normalMetalness = vec4(normalize(worldHitNormal), metal)` — the detail/bump-perturbed shading normal, world space.
- `emissionClass = vec4(face-sheet glow + per-prim glow, 2)` — actual emission only, class 2 = flesh.
- `surfaceDepth = clip.z/clip.w` of the traced hit via the SAME formula/nodes as the legacy depth-alpha.

### Legacy lighting terms intentionally absent from M1 surface data

Analytic flashlight beam, key specular/fresnel compose, backlit scatter field probe, AO field probe, traced wound soft shadow, level shadow map, enclosure ambient bounce, highlight shoulder, faceFlat relight mix, legacy display compensation (lodCfg.y). Also: legacy REPLACES flesh under a glow; the deferred light pass ADDS emission over the lit surface. Not hidden in prelit data; full look parity is a later gate.

### Verification (all run on this branch)

- `NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lab/sdf-zombie/webgpu/deferred-sdf.test.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts src/lab/sdf-zombie/webgpu/normal-gradient.wgsl.test.ts` — 252/252 pass.
- Whole `src/lab/sdf-zombie/webgpu/` directory (every consumer/variant: fpv hands, hull-refine, humanoid, chunks, sdf-layer, tile/normal-gradient suites): **63 files, 1239/1239 pass**.
- `npx tsc --noEmit` — clean.
- Real-GPU smoke (headless Chrome `--enable-unsafe-webgpu`, Apple GPU, own vite+chrome on private ports 5262/9262, temporary page/driver deleted post-run like task 1's): a real `buildBody(ZOMBIE)` surface-mode view rendered through `createDeferredLayer` at fixed 800x600, sdfScale 1. Evidence: `task2-smoke-report.json`, `task2-smoke-lit.png` / `-material.png` / `-normal.png` (all three inspected: wounded zombie lit by the shared light pass with a visible glistening chest crater; class-2 flesh silhouette in the material view; plausible world normals; the black band at the frame bottom is page background below the 800x600 canvas, not render output), `task2-surface-shader-0.wgsl` (the generated fragment shader).
  - GENERATED SHADER (not template text): exactly ONE march loop (`i < 512` once) in the surface material; `sdfTrace = marchSurface(...)` executes first, then the clip-depth computation, then `sdfSurfaceReadAlbedo/Normal/Emission(sdfTrace)` — reads follow the write, one trace feeds all four attachments plus `frag_depth`. The legacy lit material's shader contains NO `gSdf*` globals (zero contamination of the shipping path).
  - Pixels: 43975 flesh pixels; centre sample (400,300): depth 0.9774, class 2, unit normal (len 0.9997), albedo (0.552, 0.144, 0.168), roughness 0.150, emission 0. Corner (2,2): depth exactly 1, class 0. Zero class/depth coherence mismatches across all 480k pixels; every hit pixel class 2.
  - LIGHT INVARIANCE: changed the view's legacy light uniforms (lightDir/keyColor/lightCfg/spotCfg) AND the layer's light set (1 point -> 1 point + 1 spot, moved) — all four SDF surface buffers BIT-IDENTICAL (`surfaceInvariant: true`).
  - WOUNDS: `setWounds` at the chest changed 36228 depth texels and 92004 albedo texels.
  - DEPTH PARITY: legacy lit path's depth-alpha vs surface-mode surfaceDepth at all 43975 flesh pixels, same body/camera — max diff **exactly 0** (bitwise-identical traced hit depth).
  - Console: zero errors.

### Traps hit (recorded for task 3)

- three's `copyTextureToBuffer` pads rows to 256-byte multiples and returns the PADDED mapped range as a TypedArray (not an ArrayBuffer). At 800 px the rgba16f attachments are exactly aligned (6400 B/row) but r32f (3200 B/row) pads to 3328 B — indexing the raw buffer as tight rows silently misreads every row after the first. Task 3's gate must unpack rows (the smoke's `unpackRows`) when reading `surfaceDepth` at 800 wide, or use widths whose row size is a 256 multiple.
- Generated WGSL formats declarations as `fn name (` with a space — grep generated code accordingly.
- Depth-parity comparisons must use the UNWOUNDED surface buffers (base == relit, proven bit-identical) — comparing post-wound buffers against an unwounded legacy render diffs the crater, not the pipeline.

### Handoff to task 3

- The producer mesh/material/uniforms reach task 3 through the existing view object (`view.object`); nothing new was added to `ZombieGpuView` beyond the `output` opt-in. The deferred layer's SDF scene just adds `view.object`.
- Surface mode REQUIRES debugCfg = 0 (the default everywhere): the debug early-returns predate the G-buffer and would emit reset/empty attributes at a computed depth. The deferred fixture must not enable the march's debug modes.
- Real image/lighting invariance validation IS DONE for the SDF producer at scale 1 (above); what remains for task 3 is the full comparison scene (stone room + occluder + moving orbs), sdfScale 0.5, resize behavior, debug-view captures, and the legacy/deferred frame-time comparison.
