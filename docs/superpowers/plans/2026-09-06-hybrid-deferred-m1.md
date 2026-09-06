# Hybrid Deferred M1 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement the assigned task. Execution is explicitly authorized through Dispatch UI; the written design records the owner's approved direction. Do not stop to request the same approval again. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a real WebGPU comparison scene where wounded SDF flesh and mapped stone share deferred lighting while preserving independently scaled SDF rendering.

**Architecture:** Separate surface generation from lighting using mesh and SDF MRT producers, a depth-tested attribute resolve, and one shared light pass. Keep the ordinary game/lab path unchanged. Dispatch tasks execute sequentially because their contracts and real GPU validation build on each other.

**Tech Stack:** Existing three.js r185 WebGPURenderer/TSL/WGSL, TypeScript, Vite, Vitest, existing Chrome CDP capture helpers. No new dependencies or engine upgrade.

**Spec:** `docs/superpowers/specs/2026-09-06-hybrid-deferred-m1-design.md`

## Global Constraints

- Follow the spec's surface attachment formats, spaces, material IDs, depth convention, and 16-light capacity exactly unless actual WebGPU verification proves an adjustment necessary; document any adjustment and preserve 32-byte default color attachment budget compatibility.
- Import runtime THREE from `three/webgpu`, nodes from `three/tsl`; never mix a second runtime copy from bare `three`.
- Do not change existing renderer defaults, field/wound math, march quality settings, tile defaults, user assets, or package versions. No main merge/push. Work only in the dispatcher-created worktree; abort if dispatcher fell back to the user's primary checkout.
- Keep tracing once per SDF fragment. No rerender per attachment, per light, or debug view within a single frame. G-buffer data is unlit linear material data.
- M1 lighting is explicitly unshadowed. Existing shadows stay intact; camera-depth occlusion is not a shadow test.
- Every task must run focused tests and `npx tsc --noEmit`. Task 3 runs real WebGPU integration checks and images. Do not run the full suite concurrently with another task's GPU measurements. Coordinator runs final broad checks.
- Use `NODE_OPTIONS=--no-experimental-webstorage` for Vitest on this machine. Link the main checkout's `node_modules` only if missing; do not install/upgrade dependencies.
- Append task-specific evidence to `docs/dev-notes/2026-09-06-hybrid-deferred-m1/notes.md`; include commands, outcomes, limitations. Save raw images/JSON under that directory. Save useful DualMem findings through `~/.config/dualmem/bin/dualmem-run` with file associations.
- Plan code blocks specify contracts and representative behavioral tests, not permission to replace the real production body/material pipeline with mocks. Inspect actual local Three source for API details.

## File structure

`deferred-surface.ts` owns attachment schema, target lifecycle and CPU visibility helpers. `deferred-lighting.ts` owns light packing and shared lighting nodes. `deferred-mesh.ts` adapts the fixture's real stone material. `deferred-layer.ts` owns passes and resolve. `deferred-sdf.ts` owns the opt-in SDF output integration, with the smallest necessary changes to the existing march/material builder. `deferred-main.ts` owns only the comparison scene and controls. Tests live beside each module; the CDP gate lives under scripts.

## Dispatch dependencies

Task 1 (mesh/surface foundation) -> Task 2 (SDF producer) -> Task 3 (comparison scene and GPU evidence). Each downstream task starts from its dependency's committed branch. No automatic integration into main.

### Task 1: Surface buffers, mesh producer, and shared lighting

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/deferred-surface.ts`
- Create: `src/lab/sdf-zombie/webgpu/deferred-surface.test.ts`
- Create: `src/lab/sdf-zombie/webgpu/deferred-lighting.ts`
- Create: `src/lab/sdf-zombie/webgpu/deferred-lighting.test.ts`
- Create: `src/lab/sdf-zombie/webgpu/deferred-mesh.ts`
- Create: `src/lab/sdf-zombie/webgpu/deferred-layer.ts`
- Create: `src/lab/sdf-zombie/webgpu/deferred-layer.test.ts`
- Create: `docs/dev-notes/2026-09-06-hybrid-deferred-m1/notes.md`

**Interfaces:** Produce the following exported contracts (additional internal helpers are fine):

```ts
// deferred-surface.ts
export type SurfaceSource = 'empty' | 'mesh' | 'sdf';
export function selectSurface(meshDepth: number, sdfDepth: number): SurfaceSource;
export function sdfTargetSize(width: number, height: number, scale: number): { width: number; height: number };
export const SURFACE_ATTACHMENT_NAMES = ['albedoRoughness', 'normalMetalness', 'emissionClass', 'surfaceDepth'] as const;
// createSurfaceTarget(width,height) returns a THREE.RenderTarget with the four named textures;
// expose getSurfaceTextures(target) by name, never depend on incidental texture ordering downstream.

// deferred-lighting.ts (Vec3 below is a readonly numeric triple)
export interface DeferredLight {
  kind: 'point' | 'spot'; position: readonly [number,number,number];
  direction: readonly [number,number,number]; color: readonly [number,number,number];
  intensity: number; range: number; cosInner: number; cosOuter: number;
}
export const MAX_DEFERRED_LIGHTS = 16;
export function packDeferredLights(lights: readonly DeferredLight[]): { data: Float32Array; count: number };
```

The layer factory `createDeferredLayer(renderer, options)` returns `resize(width,height,sdfScale)`, `render(meshScene,sdfScene,camera)`, `setLights(lights)`, `setDebugView(view)`, `dispose()`, and `diagnostics()`. Options include `width`, `height`, `sdfScale`. Debug view is `'lit'|'albedo'|'normal'|'depth'|'material'`. Expose producer and resolved targets through a read-only `targets` property for the GPU gate. `render` accepts an empty SDF scene until task 2. Include adapter limit validation using the actual renderer backend/device only where supported; report checked limits in diagnostics.

- [ ] **Step 1: Establish source baseline and write behavioral tests.** Read `sdf-layer.ts`, `post-aa.ts`, `stone-textures.ts`, local Three `MRTNode.js`, `NodeMaterial.js`, and `Renderer.js`. Record `git rev-parse HEAD`, verify a dispatch worktree, link node_modules if absent. Add visibility, sizing, packing, overflow, and resize/dispose state tests. Include these boundary cases:

```ts
expect(selectSurface(1, 1)).toBe('empty');
expect(selectSurface(0.2, 0.8)).toBe('mesh');
expect(selectSurface(0.8, 0.2)).toBe('sdf');
expect(selectSurface(0.4, 0.4)).toBe('mesh');
expect(sdfTargetSize(960, 540, 0.5)).toEqual({ width: 480, height: 270 });
expect(() => sdfTargetSize(960, 540, 0)).toThrow();
expect(packDeferredLights([]).count).toBe(0);
const light = { kind: 'point' as const, position: [0,2,0] as const,
 direction: [0,-1,0] as const, color: [1,0.5,0.2] as const,
 intensity: 2, range: 8, cosInner: 1, cosOuter: 0 };
expect(packDeferredLights([light]).count).toBe(1);
expect(() => packDeferredLights(Array(17).fill(light))).toThrow();
```

- [ ] **Step 2: Run the failing tests before implementation.**

```bash
NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lab/sdf-zombie/webgpu/deferred-surface.test.ts src/lab/sdf-zombie/webgpu/deferred-lighting.test.ts src/lab/sdf-zombie/webgpu/deferred-layer.test.ts
```

- [ ] **Step 3: Implement MRT targets and visibility resolve.** Create three RGBA16F data textures and one R32F clip-depth texture, all named/nearest/NoColorSpace, plus hardware depth. Clear empties to material ID 0/depth 1 explicitly; one common RGBA clear value does not suffice for arbitrary attachment semantics. Resolve the closest valid depth and copy every attribute from that source. Derive UV orientation from actual Three render-target conventions and retain a single documented boundary transform. Use `selectSurface` as a CPU reference, with shader equivalence covered by task 3. Reject nonfinite/out-of-range sizes/depth inputs sensibly, clamp fractional positive dimensions to >=1. Restore MRT/target/clear state in `finally`.

```ts
// Semantic resolve rule; translate this once to the GPU implementation.
const source = meshDepth < 1 && meshDepth <= sdfDepth ? 'mesh'
  : sdfDepth < 1 ? 'sdf' : 'empty';
// Read albedo, normal, emission/class and depth from the SAME selected texel.
```

- [ ] **Step 4: Implement mapped mesh surface output and shared light evaluation.** `createDeferredMeshMaterial(source: THREE.MeshStandardMaterial)` adapts color/map/normalMap/normalScale/roughness/roughnessMap/metalness/emissive without borrowing Three's prelit `output`. Use material MRT nodes and the existing normal-map node support. Surface output is invariant under scene light motion. Define and document the packed light stride; zero inactive slots on every update. Keep light data mutable without material rebuild. Reconstruct position from WebGPU NDC z directly. Implement diffuse + rough specular, metal tint, and bounded flesh-class response; no per-light field sampling. Emission is additive linear radiance. Add finite zero-distance handling and range cutoff. Do not run old SDF legacy gamma compensation on these values.

- [ ] **Step 5: Verify tests and compile, record implementation decisions, commit.** If practical, render a small temporary mesh-only fixture through the actual backend to validate MRT formats before handing off; task 3 owns the durable fixture. Do not claim shader validation without running it.

```bash
NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lab/sdf-zombie/webgpu/deferred-surface.test.ts src/lab/sdf-zombie/webgpu/deferred-lighting.test.ts src/lab/sdf-zombie/webgpu/deferred-layer.test.ts
npx tsc --noEmit
git add src/lab/sdf-zombie/webgpu/deferred-*.ts docs/dev-notes/2026-09-06-hybrid-deferred-m1/notes.md
git commit -m "render: add deferred surface buffers and shared mesh lighting"
```

### Task 2: Export real SDF hit/material data without relighting or retracing

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/deferred-sdf.ts`
- Create: `src/lab/sdf-zombie/webgpu/deferred-sdf.test.ts`
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts`
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`
- Test: `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`
- Test: `src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts`
- Modify: `docs/dev-notes/2026-09-06-hybrid-deferred-m1/notes.md`

**Interfaces:** Consume task 1's named surface attachments/classes. Add opt-in `output?: 'lit' | 'surface'` to `createZombieGpuView` options; default `'lit'`. Returned `ZombieGpuView` retains all existing methods/uniforms. The surface material writes the task-1 MRT contract, normal space and exact clip depth. `deferred-sdf.ts` owns node output assembly and any shared surface-capture declarations, not a copied full marcher. Avoid circular runtime imports.

- [ ] **Step 1: Read existing consumers and establish tests.** Inspect `buildMarchFn`, `createMarchMaterial`, `createZombieGpuView`, shader variants in `normal-gradient.wgsl.ts`, `shell-spike.wgsl.ts`, and hand/gib consumers. Read all relevant DualMem file context before modifying. Add default-path and surface-output tests: no caller must opt in implicitly, legacy depth-alpha output stays intact, surface uses the true hit normal and wound-modified albedo. Do not satisfy tests by inserting shader comments. Include view factory lifecycle and uniform binding compatibility tests using the established test style.

```ts
// Required semantic cases for the behavioral/GPU gate, not text-only substitutes:
// - unchanged body/camera, two different light sets -> identical surface buffers
// - setWounds(...) changes real depth/tissue pixels in surface mode
// - surface mode and legacy mode preserve the same traced hit depth
// - one trace produces ALL surface attachments; no extra trace for normal/depth
// - an ordinary createZombieGpuView(body, existingOpts) stays on legacy output
```

- [ ] **Step 2: Run new focused tests to observe failures.**

```bash
NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lab/sdf-zombie/webgpu/deferred-sdf.test.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts
```

- [ ] **Step 3: Add a static surface-output variant around shared hit/material evaluation.** Preserve one source of truth for the trace and material computation. Prefer explicit source sections/entry builders over a brittle sequence of unchecked `.replace()` calls. It is acceptable to split the existing WGSL string into named shared sections as long as its default expansion preserves current behavior. Keep procedural tissue/char/face colors, normal detail, material gloss/metalness, and emission. Exit the surface variant before light-dependent terms and display conversion; rearrange light-independent wetness/emission computation as needed without changing legacy arithmetic. Do not use the flat-albedo diagnostic seam: it omits normals and tissue material evaluation.

```ts
// Output meanings, assembled from the production hit evaluation:
// albedoRoughness = vec4(unlitTissueOrPaintColor, roughnessFromGlossAndWetness)
// normalMetalness = vec4(normalize(worldHitNormal), metalness)
// emissionClass = vec4(actualEmissionOnly, materialClass)
// surfaceDepth = (projection * view * vec4(camera + ray * hitT, 1)).z / clip.w
```

If WGSL private outputs/readback helpers are used to bridge the existing vec4 entry to MRT, reset all outputs per invocation and establish explicit TSL evaluation ordering through a cached trace result dependency. Verify the generated shader has one trace and that reads follow writes. Do not assume `.toVar()` alone proves ordering. A typed struct result is preferable only if the pinned TSL/WGSL parser actually supports it. Add the smallest optional argument/builder extension to `createMarchMaterial`; bind all positional arguments consistently for every existing variant.

- [ ] **Step 4: Wire surface view creation/disposal with no game changes.** Preserve proxy geometry, update/setWounds/setFaceTexture behavior, and existing ownership/disposal rules. Surface mode can omit light-dependent shader work; it cannot change the traced body, normal approximation, or wound constants. Make source geometry/material resources available to task 3 through the existing view object. Record which legacy lighting-only terms are intentionally absent from M1.

- [ ] **Step 5: Verify legacy tests and typecheck, record evidence, commit.** Run every affected existing shader/view test, including variants discovered in step 1. Leave real image/lighting invariance validation to task 3 only if no fixture is available yet; state that explicitly.

```bash
NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lab/sdf-zombie/webgpu/deferred-sdf.test.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts src/lab/sdf-zombie/webgpu/normal-gradient.wgsl.test.ts
npx tsc --noEmit
git add src/lab/sdf-zombie/webgpu/deferred-sdf* src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/webgpu/zombie-gpu.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts docs/dev-notes/2026-09-06-hybrid-deferred-m1/notes.md
git commit -m "render: export wounded SDF surfaces for shared deferred lighting"
```

### Task 3: Runnable comparison scene, real WebGPU gate, and measurements

**Files:**
- Create: `sdf-deferred.html`
- Create: `src/lab/sdf-zombie/webgpu/deferred-main.ts`
- Create: `scripts/deferred-check.mjs`
- Create: `scripts/deferred-check.sh`
- Modify: `vite.config.ts`
- Modify as needed after real GPU failures: `src/lab/sdf-zombie/webgpu/deferred-*.ts`, `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`, `src/lab/sdf-zombie/webgpu/march.wgsl.ts`
- Modify: `docs/dev-notes/2026-09-06-hybrid-deferred-m1/notes.md`
- Create: `docs/dev-notes/2026-09-06-hybrid-deferred-m1/validation.json` and inspected PNG captures

**Interfaces:** Consume tasks 1/2. Export a browser debugging seam with this contract:

```ts
interface DeferredLabControls {
  ready: boolean;
  setMode(mode: 'legacy'|'deferred'): void;
  setSdfScale(scale: number): void;
  setDebugView(view: 'lit'|'albedo'|'normal'|'depth'|'material'): void;
  setLightCount(count: number): void;
  setLightTime(seconds: number): void; // deterministic positions, no camera/body change
  setWounded(enabled: boolean): void;
  setCameraPose(pose: 'overview'|'mesh-front'|'sdf-front'|'wound'): void;
  step(frames: number): Promise<void>;
  diagnostics(): unknown; // adapter, dimensions, mode, counts, supported/omitted features
  readSurfaces(): Promise<unknown>; // typed/serializable bounded test data with source coverage
  sampleTiming(frames: number): Promise<unknown>; // p50/p95 + explicit timing method
}
```

- [ ] **Step 1: Build the fixture from production components.** Use `createLabRenderer`, `buildBody` with the existing authored zombie (see `lab-main.ts`), `FLESH_PRESETS`, and `stoneTextures` for a room/floor/pillar. Do not substitute analytic sphere SDFs or flat mesh colors. A stable torso wound should visibly expose depth/tissue. Create separate legacy/surface views from identical body data and parameters; only render the selected one. Use `createSdfLayer` in legacy mode so it honors the same SDF scale. Legacy mesh lights mirror the shared light list; label SDF legacy's limited light support in measurements. Avoid game actors/AI/physics and unrelated asset dependencies in this fixture.

- [ ] **Step 2: Add page/build entry and controls.** Add `sdfDeferred: resolve(__dirname, 'sdf-deferred.html')` to Vite build inputs. Handle `mode=legacy|deferred`, visible mode/scale/debug/light controls, and the API above. Use fixed camera/body poses and deterministic light placement. `step` must render actual frames and resolve GPU work before readbacks; readiness is true only after both modes compile successfully. Add unload disposal, explicit resize handling, and clear errors in the page.

- [ ] **Step 3: Implement an assertion-driven CDP gate using existing lifecycle helpers.** Base browser control on `scripts/game-tiles-telemetry-check.mjs`, server ownership on `scripts/lab-servers.sh`. Allocate ports 5306/9306 by default. The shell wrapper starts/stops only its own Vite/Chrome. Capture console errors, runtime errors, and GPU validation errors. Fail on shader errors, empty body/mesh coverage, stale/mismatched depth, missing material classes, or light-dependent surface data.

```js
// Core invariant: use deterministic poses, freeze body/camera, then compare readbacks.
await evaluate('__deferredLab.setMode("deferred"); __deferredLab.setLightTime(0); __deferredLab.step(2)');
const before = await evaluate('__deferredLab.readSurfaces()');
await evaluate('__deferredLab.setLightTime(1.25); __deferredLab.step(2)');
const after = await evaluate('__deferredLab.readSurfaces()');
// Assert equality of material/depth samples and changed lit pixel statistics for BOTH classes.
// Assert coverage includes real mesh and flesh pixels, not just all-background equality.
```

The gate must also toggle wounds and verify a changed SDF hit/tissue region, compare legacy/SDF hit depths, check both occlusion poses at scales 1 and 0.5, resize down/up, and toggle modes repeatedly. Read all four attachments with appropriate typed formats (half-floats require decoding). Record threshold rationales and coordinates/masks; do not write tautological tests of a hardcoded fixture response.

- [ ] **Step 4: Run and inspect the real images; fix integration bugs before claiming success.**

```bash
LAB_VITE_PORT=5306 LAB_CDP_PORT=9306 scripts/deferred-check.sh
```

Capture overview legacy/deferred, wounded close-up, both occlusion poses, and all debug views at scales 1 and 0.5. Read the PNGs with the available image tool. Record what each shows, including flesh/stone response differences and omitted legacy effects. Verify the SDF trace is not duplicated for outputs by generated shader inspection or an equivalent actual GPU diagnostic. A failing GPU check must be fixed, not waived because unit tests pass.

- [ ] **Step 5: Measure the milestone honestly.** After shader warmup, run alternating legacy/deferred samples at matching scale 1 and 0.5, with 1/8/16 lights and fixed scene/camera. Take at least three repetitions per pair and report p50/p95 distributions. If adapter timestamp queries are available, record GPU elapsed; otherwise use completed-frame wall time and label it. Record whether other GPU workloads prevent useful comparison, rather than invent a speedup. The legacy SDF supports fewer independent lights: this is a feature/cost comparison with that explicit caveat, not equal-lighting-quality performance parity.

- [ ] **Step 6: Focused checks, production build, final report and commit.** Full-suite testing is reserved for the coordinator when no dispatch work is running. Include reproducible launch/check commands, screenshot list, actual errors/limitations, changed files, and commit IDs. State whether the milestone meets every spec criterion. Do not call a skipped criterion passing.

```bash
NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/lab/sdf-zombie/webgpu/deferred-surface.test.ts src/lab/sdf-zombie/webgpu/deferred-lighting.test.ts src/lab/sdf-zombie/webgpu/deferred-layer.test.ts src/lab/sdf-zombie/webgpu/deferred-sdf.test.ts
npm run build
git add sdf-deferred.html vite.config.ts src/lab/sdf-zombie/webgpu/deferred-*.ts scripts/deferred-check.* docs/dev-notes/2026-09-06-hybrid-deferred-m1
# Also explicitly stage any task-1/task-2 integration fixes named in the report.
git commit -m "render: add deferred comparison scene and WebGPU validation"
```
