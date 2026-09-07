# Hybrid Deferred M2 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for your assigned task only. Execution and the selected flashlight-first scope are owner-authorized. Work through Dispatch UI in isolated branches; the coordinator owns review and final integration decisions.

**Goal:** An opt-in playable deferred game with shared opaque dynamic lighting and flashlight shadows.

**Architecture:** Port reviewed M1 onto current main, export every game opaque producer to the same surface contract, explicitly render full/level-only flashlight shadow maps, and compose forward effects against resolved hardware depth before existing postprocessing. Default gameplay remains legacy.

**Tech Stack:** TypeScript, installed Three 0.185.x `three/webgpu` + `three/tsl`, WGSL, Vite, Vitest, real Chrome WebGPU/CDP.

**Spec:** `docs/superpowers/specs/2026-09-06-hybrid-deferred-m2-design.md`

## Global Constraints

- Owner-selected executor: `zai/glm-5.3-flash:high` through the pi harness. Seven sequential tasks; do not substitute GLM 5.3 non-Flash, Kimi, or a different effort.

- Owner selected flashlight shadows first; other dynamic lights remain unshadowed. Exactly two 1024x1024 flashlight shadow maps by default, no point-light shadow cube maps or per-light SDF raymarching.
- Read the spec, this header, and your assigned task. Do not restart architecture brainstorming or execute later tasks.
- Start task 1 from the immutable planning commit based on main `909b6a87`; merge reviewed M1 `f25a31be` only into the isolated task branch. Subsequent tasks inherit the prior successful branch. Do not merge into main, push, reset failed worktrees, or alter primary-checkout assets.
- Use the shared DualMem launcher `~/.config/dualmem/bin/dualmem-run`; no MEMORY.md. Save code findings with file associations.
- Use existing node_modules via symlink, not dependency upgrades. Runtime imports must not mix `three` and `three/webgpu` copies.
- Preserve game caps, independent SDF scaling, geometry/wounds/poses, authored materials and game behavior. All new runtime behavior is opt-in through `?renderer=deferred`; legacy remains the default.
- Keep the 4-attachment/28-byte color contract, linear intermediate data, exact clip depth, and a single SDF trace. Use explicit material/shadow receiver metadata without adding an attachment.
- New WGSL requires a real-device smoke check before calling it valid. Unit tests or shader string matching alone are insufficient.
- Each task commits functional progress before extended measurements. Write an honest `task-N.md` report under `docs/dev-notes/2026-09-06-hybrid-deferred-m2/` with changed interfaces, tests, GPU evidence, unresolved issues, and commit. If time is nearly exhausted, preserve and report rather than claiming success.
- Do not run full-suite tests during another task or GPU measurements. Coordinator runs full tests/build when the chain is idle. Task checks use `NODE_OPTIONS=--no-experimental-webstorage npx vitest run <listed tests>` and `npx tsc --noEmit`.
- Browser drivers must have bounded CDP requests, reject on socket close, close owned tab/socket in `finally`, and terminate successfully after assertions. Use scripts/lab-servers.sh with private ports and trap cleanup of only owned servers. Don't time benchmark work in a concurrently running visible preview.

## Interfaces shared across tasks

The declarations below are the integration contracts to implement, not existing APIs. Keep M1 callers source-compatible by using optional arguments/defaults.

```ts
// deferred-surface.ts
export type ShadowReceiver = 'full' | 'level-only';
export function encodeSurfaceClass(baseClass: number, receiver: ShadowReceiver): number;
export function decodeSurfaceClass(encoded: number): { baseClass: number; receiver: ShadowReceiver };
// Low four bits retain classes 0..3. Bit 4 selects level-only; full has no bit.
// E.g. encodeSurfaceClass(1, 'level-only') === 17. Empty remains exactly zero.

// deferred-layer.ts additions
export interface DeferredRenderHooks { drawMesh?: () => void; drawSdf?: () => void; }
// render(meshScene, sdfScene, camera, hooks?: DeferredRenderHooks): void;
// Call hooks at the owned producer target, with autoClear=false; fallback is
// renderer.render(scene,camera), preserving the M1 fixture API.
// setOutputTarget(target: THREE.RenderTarget | null): void;
// setEnvironment({ ambient: THREE.Color, fogColor: THREE.Color,
//                  fogNear: number, fogFar: number, fogEnabled: boolean }): void;
export interface DeferredFlashlightShadowBinding {
  fullDepth: THREE.Texture; levelDepth: THREE.Texture;
  viewProjection: THREE.Matrix4; lightIndex: number;
  bias: number; mapSize: THREE.Vector2; enabled: boolean;
}
// setFlashlightShadow(binding: DeferredFlashlightShadowBinding | null): void;
// null means unshadowed and must remain the M1 default.

// New factory options (trailing args; all existing calls stay lit)
export interface SurfaceOutputOptions {
  output?: 'lit' | 'surface'; shadowReceiver?: ShadowReceiver;
}
// GpuViewOpts already has output from M1; add optional shadowReceiver.
// createSharedChunkGpuMaterial(prev?, options?: SurfaceOutputOptions)
// createChunkGpuView retains existing args, adds trailing options?: SurfaceOutputOptions
// createBoneInstancer(max?, options?: SurfaceOutputOptions)
// createBakedChunkMaterial(options?: SurfaceOutputOptions)
```

### Task 1: Reconcile current main and make the core composable

**Files:**
- Merge source: reviewed M1 `f25a31be`, preserving current main additions.
- Modify: `src/lab/sdf-zombie/webgpu/deferred-layer.ts`, `deferred-surface.ts` and their tests.
- Modify as needed: `deferred-main.ts` diagnostic base-class decoding, with unchanged default M1 outputs.
- Create: `docs/dev-notes/2026-09-06-hybrid-deferred-m2/task-1.md`.

**Interfaces:** Implement surface-class encoding/decoding, optional draw hooks, `setOutputTarget`, `setEnvironment` above. Reserve `setFlashlightShadow` implementation for task 4. Present writes actual resolved depth into the selected target.

- [ ] Verify isolated branch and base. Inspect the merge before resolving overlapping plan/source changes:
```sh
git status --short
git log -1 --oneline
git merge --no-ff --no-commit f25a31be
git diff --name-only --diff-filter=U
```
Resolve against current main behavior; retain character-view/registry/soldier work. Review duplicate marcher parameters/uniforms/bindings even if Git reports no conflict. Commit the reconciled baseline separately before new core changes. Run focused existing character/view/renderer tests and typecheck; report any baseline failure.

- [ ] Add failing behavioral tests for output target restoration, a thrown draw hook, present depth/sentinel, environment defaults, and metadata round-trip. Example expectations:
```ts
expect(encodeSurfaceClass(1, 'level-only')).toBe(17);
expect(decodeSurfaceClass(18)).toEqual({ baseClass: 2, receiver: 'level-only' });
expect(encodeSurfaceClass(0, 'level-only')).toBe(0);
// After layer.setOutputTarget(sceneTarget) and render(), last presentation
// goes to sceneTarget; caller target/MRT/depth/background state is restored.
```
Reject invalid/noninteger base classes rather than corrupting packed metadata. Decode base class in lighting/debug output while retaining raw encoding for shadow selection.

- [ ] Add an owned output target, present `depthNode` from the winning `surfaceDepth`, and depth testing/writing appropriate for a fullscreen opaque presentation. Clear destination depth before presenting; empty pixels write depth 1. Don't sample the target being written. Draw hooks must run once in their corresponding producer pass, restore state on exception, and not change the M1 path.

- [ ] Add game environment uniforms with M1-compatible defaults. Apply ambient and distance fog in the lit stage; raw surface outputs stay unaffected. Do not add legacy display compensation.

- [ ] Run core tests/typecheck and a real GPU integration smoke: deferred into an offscreen color+depth target, then a known forward primitive behind and in front of an SDF, plus direct-canvas output. Inspect depth/color to prove composition. Run `DEFERRED_SKIP_TIMING=1 LAB_VITE_PORT=5321 LAB_CDP_PORT=9321 scripts/deferred-check.sh`; retain M1 success. Commit and record evidence.

### Task 2: Export bones and both chunk paths without duplicating shading

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`, `deferred-sdf.ts`, `bone-instancer.ts`, `baked-chunks.ts`.
- Tests: `zombie-gpu.test.ts`, `deferred-sdf.test.ts`, `bone-instancer.test.ts`, `baked-chunks.test.ts` (create a focused file if absent).
- Read: current `character-view.ts`, `chunk-bake-geometry.ts`, `chunk-bake-buffers.ts`.

**Interfaces:** Implement `SurfaceOutputOptions` and trailing factory options listed above. M1 default surface bodies remain class 2; game callers explicitly request level-only receivers. Share one chunk material/node graph per output mode.

- [ ] Inspect actual factory signatures and per-draw shared chunk binding before editing. Add a failing test that creates two chunks with distinct data under one surface material and observes the correct texture/uniform binding for each draw. Pin all existing calls' default lit behavior and default M1 class 2.
- [ ] Add receiver metadata to the SDF emission/class output as an unlit uniform/option, defaulting to the existing encoding. Pass `output:'surface'` through shared/nonshared chunk construction; do not fork the march body or create a graph per detached chunk. Check alive masks, wounds, volume data, and posed transforms.
- [ ] Split bone and baked-chunk material evaluation from their existing light compose. Retain instanced bone vertex positions/normals/wound exposure and baked vertex albedo/wetness. Build MRT outputs from those material terms using the existing mapped clip depth:
```ts
const kind = encodeSurfaceClass(1, options.shadowReceiver ?? 'full');
// The bone positionNode and normalNode are retained in BOTH modes.
// Surface mode publishes albedo/roughness, world normal/metalness,
// actual emission/kind, and projected hit depth; lit mode keeps its shader.
```
Do not encode old lit color as albedo or change bone capacity/packing.
- [ ] Run the focused suites and typecheck. On actual WebGPU, render a body with bone mesh, two differently bound chunks, and a baked chunk; verify nonzero producer coverage, depth, finite/unit normals and light-invariant surface buffers. Generated surface WGSL must retain one SDF trace. Capture and inspect the test image; commit and report.

### Task 3: Route game materials and build a stable shared light list

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-deferred-scene.ts`, `game-deferred-scene.test.ts`, `game-deferred-lights.ts`, `game-deferred-lights.test.ts`.
- Modify: `deferred-mesh.ts` and focused tests only for receiver metadata and preserving mapped/cutout materials.
- Read: `character-view.ts`, `kit-overlay.ts`, `held-prop.ts`, `game-main.ts`, `dungeon-lighting.ts`.

**Interfaces:**
```ts
// game-deferred-scene.ts
export type GameDrawRoute = 'mesh' | 'sdf' | 'forward' | 'exclude';
// createGameDeferredScene(scene: THREE.Scene) returns:
// register(object: THREE.Object3D, route: GameDrawRoute, receiver?: ShadowReceiver): void
// unregister(object: THREE.Object3D): void
// sync(): void // discovers asynchronously loaded descendants and disposed sources
// draw(route: 'mesh'|'sdf'|'forward', renderer: THREE.WebGPURenderer,
//      camera: THREE.PerspectiveCamera): void
// diagnostics(): { counts: Record<GameDrawRoute, number>; unsupported: string[] }
// dispose(): void
// draw uses scoped visibility/material-reference changes on ORIGINAL objects;
// retain onBeforeRender callbacks and restore in finally. No reparenting.

// game-deferred-lights.ts
export interface GameLightCandidate {
  id: string; role: 'flashlight'|'muzzle'|'practical'; light: THREE.Light;
}
// buildGameDeferredLights(candidates: readonly GameLightCandidate[],
//   cameraWorld: THREE.Vector3): { lights: DeferredLight[]; ids: string[];
//                               dropped: string[]; flashlightIndex: number }
// flashlightIndex is 0 when present, otherwise -1. Inactive muzzle is omitted.
```

- [ ] Write failing tests for asynchronous descendants, array materials, hidden parent, removed/rebuilt actor, unsupported opaque node material, preservation of per-draw callbacks, and restoration after render throws. Registration of a parent propagates receiver policy to newly loaded kit children; explicit child registration overrides it.
- [ ] Implement cached standard-material adapters and explicit custom-producer routing. Body/proxy helpers must be excluded. Preserve original render order, transparent blending/alpha-test, depth flags, layer masks and texture ownership. Only registered surface-mode node materials enter opaque MRT passes; unknown custom materials emit a diagnostic error with source names. Forward routes retain original materials and scene lights.
- [ ] Add light tests for flashlight/muzzle priority, parented muzzle world position, deterministic practical selection at the 16-slot cap, inactive entries, repeatability, and stable distance/ID ties:
```ts
expect(result.ids[0]).toBe('flashlight');
expect(result.lights.length).toBeLessThanOrEqual(16);
expect(result.ids).toEqual(repeated.ids);
// Moving only the muzzle must never change the flashlight position/cone/color.
```
- [ ] Implement data-only conversion of point/spot lights with explicit range/falloff/intensity conversion constants. Preserve authored source colors and world transforms, don't rebuild materials when light values change. Environment fog/ambient is separate from this list.
- [ ] Run focused tests/typecheck; use the task-1 smoke scene to exercise the scoped draw hooks with an alpha-cutout mapped mesh and a late-added kit child. Commit and report interfaces.

### Task 4: Explicit flashlight shadow maps and receiver-aware sampling

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/deferred-shadows.ts`, `deferred-shadows.test.ts`.
- Modify: `deferred-layer.ts`, `deferred-layer.test.ts`; keep M1 null-shadow default.
- Read: `dungeon-lighting.ts`, `occluder-hull.ts`, local Three depth/node material implementation.

**Interfaces:** Implement `setFlashlightShadow` above. Shadow factory contract:
```ts
// createDeferredFlashlightShadows(renderer, { size: 1024 }) returns:
// update(scene: THREE.Scene, light: THREE.SpotLight,
//        { enabled: boolean; fullCasterLayers: number; levelCasterLayers: number }): void
// binding(lightIndex: number, samplingEnabled?: boolean): DeferredFlashlightShadowBinding
// diagnostics(): { renderedMaps: number; fullCasters: number; levelCasters: number;
//                  size: number; enabled: boolean }
// dispose(): void
```

- [ ] Write failing tests for full vs level-only caster selection, hidden/removed proxies, source matrix/instance changes, boot/disable clear state, and zero render calls when disabled. Receiver-bit decoding must choose the correct map while preserving base material shading. Bias and kernel size are named constants.
- [ ] Own two depth targets with explicit raster passes: R32F projected depth output, matching hardware depth, nearest filtering, NoColorSpace, far clear. Derive one light camera from current spot pose/cone/near/far and WebGPU projection. Use source-referencing shadow clones with shared geometry and current matrix/instance data; never render SDF bounding boxes as casters. Reproduce alpha cutouts and relevant caster vertex transforms. Keep existing caster eligibility and the inflated-vs-shrunken proxy distinction.
- [ ] Implement bounded PCF (3x3 manual depth comparisons is sufficient) using one selected map per receiver. Outside-frustum samples are unoccluded. Apply visibility only to the designated flashlight contribution:
```wgsl
// within the existing light loop, after evaluating this light's contribution:
// if (i == shadowLightIndex && shadowEnabled) {
//   contribution *= flashlightVisibility(worldPosition, receiverPolicy);
// }
// Ambient and emission remain outside this multiplication.
```
Map updates are explicit before lighting, even with unlit MRT producer materials. Avoid depending on Three's auto-shadow traversal or cached last-frame map bindings.
- [ ] Run unit/type checks. Real-device smoke must demonstrate level occlusion of flesh, a coherent body-proxy shadow on stone, lack of inflated-hull self-shadowing, current-frame light motion, and shadow-off zero-map counters. Retain on/off images and sampled masks with coordinates; verify the M1 null binding stays valid. Commit and report.

### Task 5: Wire the opt-in playable game and its frame composition

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/game-deferred-renderer.ts`, `game-deferred-renderer.test.ts`.
- Modify: `game-main.ts`, `character-view.ts` only if GPU passthrough needs adjustment, and existing game tests affected by wiring.
- Modify as required for correct target/depth integration: `goo-layer.ts`, `post-aa.ts`; preserve legacy APIs/defaults.

**Interfaces:** A small game renderer coordinator owns scene/light registry, deferred layer and shadow module; implements `setOutputTarget`, `setSize`, `setScale`, `render(camera)`, `diagnostics`, `dispose`. It consumes live callbacks for candidate lights/actor registrations so boot does not read not-yet-initialized game variables. It does not own simulation.

- [ ] Add boot-mode tests: absent/legacy selects old path, deferred selects new path, unsupported explicit deferred reports a visible error instead of secretly benchmarking legacy. Parse the mode once at boot. Avoid duplicate actors and live pipelines.
- [ ] Create the current registry-based characters with `gpu.output:'surface'` and `shadowReceiver:'level-only'` only in deferred mode. Build bone/shared chunk/baked chunk factories with the matching option. Register room/furniture as full receivers, actor kit/held props and tissue as level-only, transparent/blood sprites as forward, and accelerator/proxy helpers as excluded. Propagate registrations through async loads, deaths, detached chunks, baking and rebuilds.
- [ ] Preserve the current legacy draw callback. Extract only the new deferred orchestration into its module. Common pose/light updates run once; defer branch consumes separate flashlight and muzzle entries without replaying the muzzle into body flashlight uniforms. Keep legacy uniform updates available for its old branch and existing forward blood look.
- [ ] Wire the ordered chain:
```ts
postAa.render(() => {
  // update light/proxy state already reflects this simulation frame
  // deferredRenderer's render does shadows -> opaque -> depth presentation
  // -> registered forward content. Both it and goo are postAa output sinks.
  if (gooEnabled && gooLayer) gooLayer.render(camera, () => deferredRenderer.render(camera));
  else deferredRenderer.render(camera);
});
```
Validate the actual transparent ordering; if a forward item must composite after goo, give it an explicit later pass rather than disabling depth. Preserve first-person anchoring, materials and geometry; route cutout/opaque vs blended items deliberately. Set/resize output sinks from actual postAa content size and retain game lens/caps.
- [ ] Feed game fog/ambient and practical flicker through the new adapter. Add diagnostics for render mode, routes/unsupported materials, selected/dropped light IDs, shadow generation/sampling counters, target sizes and errors. Provide boot `?spotshadow=0` and a diagnostic sampling-only shadow toggle with distinct counters.
- [ ] Run focused game/character/renderer tests and typecheck. Real GPU boot both modes and inspect a wounded zombie, goblin kit/generated face, soldier held prop, blood and a detached chunk. No first-frame errors or canvas bypass. Commit playable integration before final gate work; report remaining look differences precisely.

### Task 6: Real-game producer and lifecycle GPU regression gate

**Files:**
- Create: `scripts/deferred-game-check.mjs`, `scripts/deferred-game-check.sh`.
- Modify: `game-main.ts` only for narrow deterministic diagnostic seams needed by the gate.
- Create: `docs/dev-notes/2026-09-06-hybrid-deferred-m2/game-validation.json` and task-6 report.

**Interfaces:** Shell wrapper starts/stops private Vite/CDP resources. Node gate uses existing `__sdfGame` methods where possible, adds a bounded serializable deferred diagnostics/readback seam, and awaits readiness plus real GPU completion. Do not return raw multi-megabyte buffers through CDP when hashes, masks and bounded probes suffice.

- [ ] Read existing `scripts/sdf-game-slug-gate.mjs`, `crowd-capture.mjs`, `refactor-baseline.sh` and current `__sdfGame` API. Use deterministic pauseLoop/holdStill rather than merely stopping gait where it happens to be. Keep camera/character/light state fixed for comparisons.
- [ ] Implement assertion phases for default/legacy/deferred boot, actual coverage of every opaque route, all registered characters rendered once, and detailed zombie/goblin/soldier wounds/kit/held prop. Exercise kill/detach, two shared-material chunks, bake transition and actor rebuild. Detect missing or unsupported materials and collect GPU/console errors.
- [ ] Verify material hashes invariant under light/sampling changes with moving marker geometry hidden, distinct flashlight/muzzle changes, and exact output-depth agreement. Test scale 1/0.5, explicit target resize down/up, CSS caps, post-AA/lens off/on, and forwarded effect occlusion. Do not infer success from a counter or source string when a pixel observation is required.
- [ ] Run the complete driver with private ports 5326/9326. Fail nonzero on any assertion/error; success must close CDP resources and exit 0. Run affected focused tests/typecheck for any seam changes. Commit gate and evidence. Image/performance review is task 7; do not spend this task's budget on that matrix.

### Task 7: Shadow/effect visual gate and bounded gameplay measurements

**Files:**
- Create: `scripts/deferred-game-shadow-check.mjs`, `scripts/deferred-game-shadow-check.sh`.
- Create: `docs/dev-notes/2026-09-06-hybrid-deferred-m2/shadow-validation.json`, captures, `review.md` and task-7 report.
- Modify game diagnostic seams only when required by real assertions; retain deterministic API contracts from task 6.

**Interfaces:** Reuse bounded CDP lifecycle/readback conventions from task 6. Separate functional/capture and timing phases so a slow timing run cannot conceal completed functional evidence. Save results after each phase.

- [ ] Build deterministic scenarios: pillar/wall between beam and flesh; posed body proxy between beam and floor/wall; receiver near its own proxy; light/caster moving one step; shadow generation disabled at boot. Record world anchors and projected masks; compare flashlight visibility on actual pixels, not overall scene brightness. Sampling-off and generation-off must be distinguished.
- [ ] Capture legacy/deferred/shadow-on/off at scales 1/0.5 for those scenarios, plus dark dungeon, beam/wounds, goblin kit, soldier prop/pose, blood crossing body/level, and detached-to-baked chunk transition. Open and inspect saved images. Record changed flesh appearance, shadow leaks/acne/detachment, source alignment, fog and any missing features. A broken image is a defect, not an acceptable test waiver.
- [ ] Measure repeated matched views after warmup. Use three alternating repetitions, 32 measured frames each with eight warm frames, at both scales with shadows on/off. Stop rAF and await the actual WebGPU queue. Record p50/p95/raw samples plus cap, camera, actor/light counts and adapter. Report live pacing separately if sampled; do not derive production FPS from stepped wall timing. If another GPU job is active, postpone measurement and report the conflict.
- [ ] Run both GPU gates and M1 regression gate, using separate private ports and cleanup. Save shell exit codes, error lists, image review notes, and measurements. Any material runtime fix must have focused regression checks and rerun affected GPU phases. Production build is required; coordinator owns the final full suite after the queue is idle.
- [ ] Commit the evidence/review. State which acceptance criteria passed and every remaining visual limitation. Keep legacy as default, leave a reproducible deferred launch command, and do not merge into main. Coordinator then reviews the branch and offers it for owner playtesting.

## Coordinator checkpoints

Review task 1's reconciliation/output contract before relying on it. Review producer and shadow shader changes against generated WGSL and real-device evidence. Inspect task 5's playable composition. After tasks 6/7 finish, review all failures/limitations, run the full suite and production build with no dispatched work active, verify a real playable preview, and update Obsidian/DualMem. A timed-out task is recovered from its preserved commit in a new continuation; do not retry destructively.
