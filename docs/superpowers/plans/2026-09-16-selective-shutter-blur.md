# Selective shutter blur — next rendering / FX phase

Status: owner accepted the lab and then the combined in-game blood/gib result; merged into main on 2026-09-17. Execution used `deepseek-flash` through `dsh`. See the [final wrap-up](../../dev-notes/2026-09-17-shutter-blur-game/WRAP-UP.md) for shipped controls, verification and remaining limits. The original proposal below is retained as design history; its pending gates and initial scope have been superseded by the accepted implementation.

Owner intent: cinematic motion blur controlled by shutter speed, selectively applied to blood trails and other movement after the dynamite/gib work. Recommended first scope: airborne blood, then flying gibs. This ordering is a proposal, not a recorded owner decision.

Owner follow-up: wants a dedicated shutter lab/page or an extension of the existing blood-effects page. Plan choice: extend `/sdf-blood-compare.html` first, using its synchronized production-blood fixture. The lab is the first reviewable deliverable; game integration follows the initial lab look gate.

## Prior decisions and current evidence

- [September 10 pass-off](../../dev-notes/2026-09-10-PASSOFF-3.md#3-liked-but-unspecced--per-object-motion-blur): owner liked selective smear but rejected history trapped inside the current body silhouette. Character blur must eventually cover flesh, bones and attached meshes coherently.
- [Blood comparison plan](2026-09-13-blood-surface-comparison.md): shutter blur was explicitly deferred while the blood surface was improved. This proposal reopens that work.
- `blood-sim.ts` supplies position, velocity, age/lifetime, optional path samples and emitter stream identity. A stream ID identifies an emitter, not an individual droplet. Existing `hist` samples have no timestamps and cannot directly define shutter time.
- `webgpu/goo-layer.ts` reconstructs and lights blood from a density field. Its velocity stretch is a shape parameter, not exposure integration. The field also includes floor splats, scraps, gut nodes and optional connections; these cannot all be treated as flying blood.
- `webgpu/game-main.ts` uses smooth goo reconstruction by default and renders the goo surface around the SDF composition flow, before `characterEffects.render`. Some older module comments describe superseded defaults; inspect executable wiring when implementing.
- `webgpu/post-aa.ts` captures the frame, has sampleable scene depth and downstream AA/VHS/lens/blast-distortion stages. `POST_AA_BLEND_WGSL` blends same-pixel current/history with a uniform weight; it has no object velocity or shutter interval. DualMem's generated consult claimed otherwise; source takes precedence.
- `webgpu/blood-compare-main.ts` already re-renders a single seeded simulation state for comparison. Extend this fixture rather than inventing a separate blood effect.

## Intended controls and behavior

Exposure measures the interval during which a selected moving surface contributes to a frame. It controls blur length; it should not automatically change scene brightness.

| Control | Proposal |
| --- | --- |
| Shutter time | Off, 1/240, 1/120, 1/60, 1/30 s; milliseconds shown alongside |
| Initial comparison | Off / 1/120 / 1/60 / 1/30 s; no default flip before viewing |
| Affected content | Airborne blood first; separate switches for fine spray and gibs |
| Motion source | Object motion by default; camera contribution optional later |
| Per-category amount | Multiplies exposure for artistic tuning; expose effective time |
| Quality | Sample budget plus maximum streak length in content pixels |

Keep fixed shutter seconds independent of measured render FPS. If angle controls are added, use an explicit reference cadence: `exposureSeconds = angle / 360 / referenceFps`. Thus 180 degrees at reference 60 fps is 1/120 s, and at 30 fps is 1/60 s. Do not silently substitute instantaneous FPS.

For constant projected speed, `streakPixels = speedPixelsPerSecond * exposureSeconds`. At 600 px/s, 1/120, 1/60 and 1/30 s produce 5, 10 and 20 px. These are geometric lengths before the particle's own width, coverage threshold and safety cap.

Use a trailing shutter interval `[now - exposure, now]` initially; a centered shutter would need future pose prediction or presentation delay. This is an intentional aesthetic approximation. Use a normalized box exposure first; alternate shutter profiles can follow after the base effect works.

Keep trails (fluid persisting in space), droplet stretch (fluid shape), and shutter blur (exposure) independent. Preserve accepted stretch/material settings in the first A/B so blur is the only variable.

First-stage exclusions: stationary pools/decals, gut ropes, live actors, environment, weapon/viewmodel and HUD. Scraps remain a separately classified moving-meat category. Optional connected strands need a coherent motion source before opting in. Pure camera turns leave these excluded categories sharp.

## Rendering approach

Build a conventional, bounded exposure resolve for the selected FX layer. Do not use a running blend of previous final frames as the exposure model. Prior color history is unnecessary for the first candidate; short timestamped motion data may still be needed.

1. Retain a clean scene color/depth without the selected moving FX. Render selected FX into separate working-linear, premultiplied color/coverage and motion/depth inputs. Keep unselected blood sharp. Audit shared-density fusion at the moving/static boundary: separating pools/guts from airborne blood may change the surface, and that difference must be visible in an exposure-zero comparison.
2. Derive motion from stable droplet identity and timestamped positions or short-interval velocity projection. For object-only blur, project both endpoints through the current camera. Camera-inclusive mode would instead use corresponding camera transforms. Use the actual presentation/simulation timing contract; slow motion should reduce displayed motion, while a performance hitch should not inflate shutter time.
3. Build a bounded velocity-aware resolve whose support reaches outside current coverage. A tile/neighbor velocity search or swept source bounds can cover those destination pixels. Sample premultiplied FX color and coverage together, account for occlusion along the sweep, then composite against the clean scene. Masking a finished full-screen blur by the current silhouette fails this requirement.
4. Never assign an opaque depth to a translucent streak. Keep sharp opaque depth available for scene tests; define handling of FX depth separately. Current-frame depth cannot reproduce every moving occluder or disoccluded surface across exposure; document this limitation rather than calling the result physically exact.
5. Compose in the scene's working-linear space before display-space AA/VHS and final lens/blast distortion. Verify the color boundary in `post-aa.ts` instead of reusing its display-space history blend. Scope exact SSCS/character-effects ordering during the layer extraction; avoid introducing an unexamined full-frame reorder.

Blood-specific risk: the goo field averages overlapping particle contributions, while independent streams can have opposite velocities. A single averaged motion vector can cancel them or invent the wrong trail. The spike must compare nearest/dominant depth-coherent motion ownership against a reference with crossing streams. If a single layer is visibly inadequate, use bounded separate motion groups or an exposure-sampled blood path; do not silently add many full-screen buffers.

Build a slow comparison reference that evaluates and shades the selected blood at multiple shutter times, then averages linear premultiplied color/coverage after per-sample occlusion. Never accumulate particle density across shutter times and threshold once: that makes a different fluid shape. Freeze the camera/world for this first reference; use timestamped trajectory samples with birth/death/contact events, so it is a valid reference to the recorded simulation. It is a quality oracle, not the proposed shipping frame cost.

## Implementation stages and exit gates

### 1. Exposure contract and comparison fixture

Create a small pure shutter configuration/motion module and extend `/sdf-blood-compare.html` with shutter presets, fixed-seed replay, pause/step and the slow sampled reference. Keep one sim clock for every variant. Capture the sharp zero-exposure baseline at the actual game's reconstruction and density resolution.

Add a Shutter comparison mode with Sharp / Shutter candidate / Sampled reference, single view and wipe comparison. Exposure controls stay independent of existing surface/shape controls. Provide repeatable slow-bleed, fast-trail and crossing-stream fixtures, obstacle toggle, current exposure in milliseconds, and displayed sample/radius limits. The reference can update on demand while paused rather than attempt interactive playback. The first visible milestone can compare sharp versus sampled exposure while the efficient candidate is being developed.

Gate: measured constant-speed lengths match the exposure equation; same timed trajectory at 30/60/120 presentation fps gives consistent fixed-seconds blur within raster tolerance. Missing history, new particles, reused slots, birth/death and impacts cannot generate long spurious vectors. Step does not depend on wall-clock wait duration.

### 2. Blood layer extraction and efficient shutter candidate

Expose selected blood color/coverage and a motion/depth input from the production goo/view paths. Keep optional mist independently switchable. Resolve bounded streaks and integrate into the actual game behind an opt-in setting. Give all new draw/compute passes labels and prewarm the selected pipelines. Reuse targets and explicitly initialize/resize/dispose them.

Gate: zero exposure reproduces the current game, including airborne blood meeting pools/guts; no doubled sharp droplet plus blurred duplicate; no background-color halos; streaks extend outside current silhouettes; wet glints streak without arbitrary brightness gain. Crossing streams and foreground wall/body edges hold up against the sampled reference. Render the selected FX once per required pass; do not re-render the whole dungeon for every shutter sample.

### 3. Visual acceptance and cost

Review synchronized clips for slow wound bleed, fast gib trails, impact spray, opposed crossing streams, close-up heavy blood, wall/body occlusion, static pools, spawn/impact/settle and a camera turn. Compare clean output first, then the actual shipped VHS/AA/upscale stack. Include stopped-motion clips to expose residual ghost trails.

Measure a matched seeded fight at the actual shipped graphics settings. Report CPU preparation, all GPU passes/copies, total p50/p95 frame cost, memory, warm-up and first burst; compare off versus candidate at the same particle counts. Proposed budget to validate: roughly 1 ms extra GPU at the game's content resolution for ordinary blood, with an explicit worst-case cost. This is a target, not a promised result. Bound pixel radius and taps, skip empty work; fall back to sharp rendering rather than unbounded work if the budget is exceeded.

Run focused simulation/motion tests, relevant renderer tests, typecheck/build for cross-cutting integration, then actual WebGPU compilation and visual checks. CPU/mocked tests do not establish render quality. Coordinate GPU work with other local jobs and clean up only owned resources.

Exit: owner look acceptance plus measured cost. Only then choose defaults. If the cheap candidate loses the wet cohesive look, resolve that before expanding scope.

### 4. Flying gibs, then additional selected motion

Reuse the shutter contract, but supply rigid piece transforms including rotation. Center velocity alone cannot blur a tumbling chunk correctly. Integrate whichever marched/asset/baked routes are supported at that implementation base and test spawn, rupture, settle and representation handoffs. Clear invalid pose history at discontinuities; no long spikes when a slot or mesh is reused.

Opaque gib blur additionally needs the background behind the current gib silhouette. Reconstructing that from a final opaque frame is incomplete; extend layer separation deliberately and test coverage holes before shipping.

Only after blood/gibs succeed consider moving actors. Actor motion requires posed flesh correspondence plus matching skeleton, clothing and attachments; camera and viewmodel blur remain independent policy choices. Motion conventions may later support temporal upscaling, but blur should not depend on reopening reconstruction work.

## Expected source touchpoints

- `src/lab/sdf-zombie/blood-sim.ts`: data contract only if needed; preserve RNG, emission and physics.
- `src/lab/sdf-zombie/webgpu/goo-layer.ts`, `blood-view-gpu.ts`, `blood-connections.ts`: classification, selected surface and motion data.
- `src/lab/sdf-zombie/webgpu/blood-compare-main.ts`: synchronized fixture and reference.
- `src/lab/sdf-zombie/webgpu/game-main.ts`, `post-aa.ts`: final camera timing, target/depth ownership, controls, prewarm and composition.
- New small `webgpu/shutter-blur.ts` / shader and pure motion helpers, names provisional.
- `scripts/sdf-game-bench.mjs` or a focused sibling: matched off/on measurement with shipped settings.

## Technical references

- [PBRT camera interface](https://pbr-book.org/4ed/Cameras_and_Film/Camera_Interface): camera samples span shutter-open to shutter-close time.
- [McGuire et al., A Reconstruction Filter for Plausible Motion Blur](https://casual-effects.com/research/McGuire2012Blur/index.html): conventional velocity-buffer reconstruction; a starting point for the efficient resolve, not evidence that the current goo representation will handle transparent overlap correctly.

Planning validation: read current production wiring and prior notes; no runtime code, GPU work, benchmark or build executed for this document.

## Dispatch execution slice — owner approved

Three sequential tasks extend the blood comparison lab: (1) exposure contract and sampled reference, (2) efficient lab candidate, (3) live visual verification, fixes and bounded cost report. All use `deepseek-flash` through `dsh`, isolated `codex/shutter-blur-task-N` branches. Task 1 starts from merged HEAD `761cf8d3`; each successor inherits its predecessor's branch. Full task files live in `/Users/donny/.claude/dispatch/plans/2026-09-16-selective-shutter-blur-task-N.md`.

Tasks 1–3 deliver the lab for owner review. Game integration, default changes and flying-gib/actor extensions follow the lab look gate rather than automatically starting when these tasks finish. Scoped GPU compilation/captures and measurements are authorized as necessary verification; coordinate shared GPU use and preserve other work.
