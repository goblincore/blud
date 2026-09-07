# Hybrid deferred M2 — game integration and flashlight shadows

## Owner scope update — 2026-09-07

Instanced polygonal bone tubes are retired from the intended gameplay path because their appearance is unsuitable. They are excluded from mandatory M2 acceptance and must not block the game GPU gate. Existing SDF field bones remain supported. Bone sphere culling is not integrated here; a separate agent owns that work. Detached/shared chunks and baked geometry remain in scope, including material, depth, normal and lifecycle evidence. Earlier tube-specific steps below describe historical work and do not override this scope update.


Date: 2026-09-06. The owner requested game integration and shadows after reviewing M1, then explicitly selected **flashlight shadows first; other dynamic lights unshadowed**. Continue the established Dispatch UI execution and coordinator-review workflow. The owner subsequently approved this direction and selected GLM 5.3 Flash with high reasoning (`zai/glm-5.3-flash:high`, pi).

## Outcome

Make `sdf-game.html?renderer=deferred` playable through the shared opaque lighting pipeline, with flashlight shadows and correct composition of blood, transparent effects, and postprocessing. Keep the default and `?renderer=legacy` on the existing game renderer until the owner evaluates the result. A boot-time switch is sufficient; do not maintain two copies of every live actor solely for an instantaneous toggle.

This is a game integration milestone, not clustered lighting, omnidirectional shadows, exact SDF shadow silhouettes, or a new temporal reconstruction project. Other point lights, practicals, and muzzle flashes are unshadowed. No game-wide FPS improvement is promised.

## Baselines and authorization

- Current main inspected at `909b6a87`; use the immutable planning commit containing this document as the task-1 base, then bring in reviewed M1 `f25a31be` on the isolated execution branch.
- M1 and current main diverged from `a555d1d5`. Main now has `character-view.ts`, registry-driven characters, soldier AI/animation work, and updated game/lab consumers. Preserve those additions. Never replace current game-main or character paths with their older M1-era counterparts.
- Reviewed M1 is retained in `/Users/donny/.codex/worktrees/blud-deferred-m1-review` on `codex/deferred-m1-review`. No reset, destructive retry, push, merge into main, or default flip is authorized by this milestone.
- User-owned reference/face assets and unrelated modifications in the primary checkout must remain untouched.

## Alternatives considered

**Chosen: shared opaque deferred rendering plus forward effects, with two bounded flashlight shadow maps.** This carries the architectural benefit into the actual game while preserving authored blood/particle behavior and the existing receiver distinction.

A wrapper that only deferred-renders the main character would leave bones, chunks, equipment, and room light response split and would not satisfy game integration. A full replacement including all transparency, exact SDF shadows, and shadowed point lights would multiply independent risks and exceed the selected shadow scope.

## Frame contract

1. Update game simulation and poses once, including the flashlight, practical flicker, muzzle-flash envelope, actor proxy hulls, and a deterministic shared light list.
2. Render the flashlight shadow maps explicitly from current caster transforms. No hidden color-render dependency and no one-frame shadow delay on boot.
3. Produce full-resolution opaque mesh surfaces and independently scaled SDF surfaces. Existing body/wound/face evaluation remains shared with the production marcher.
4. Resolve the closest sample, carrying all material attributes and its exact clip depth together.
5. Shade opaque surfaces with the shared light list, flashlight shadow visibility, and game-specific ambient/fog settings. Ambient/emission are not multiplied by flashlight shadow visibility.
6. Present linear opaque color and resolved hardware depth into the requested scene target. The same depth is available for forward opaque exceptions, transparent effects, and the existing depth-aware goo composite. Empty pixels write far depth.
7. Composite forward content in a documented order, then run the existing post-AA/lens/output conversion chain exactly once. Preserve the user's current resolution caps and SDF scale; do not transplant the fixture's fixed 800x600 cap into the game.

The core deferred layer must implement the existing `setOutputTarget(RenderTarget | null)` sink contract. M1 currently always targets the canvas and disables depth on presentation; both must be corrected for game composition. Intermediate targets remain linear. A draw redirected by post-AA must never bypass that target or perform display compensation twice.

## Surface coverage and lifecycle

Opaque surface producers include the room/furniture, character SDF bodies, polygon equipment and held props, instanced bone tubes, detached raymarched chunks, and baked chunks. Keep instancing, shared chunk materials, per-draw data rebinding, character palettes, skin normal detail, wounds, char, wetness, and emission intact. Surface export is opt-in; existing lit factories retain their defaults.

Use current `createCharacterView` and forward its GPU options rather than duplicating spawning. Material adaptation must handle asynchronous kit/prop loading and actor rebuilds. Cache by material identity, preserve geometry/instance attributes, alpha-test, face/map orientation, normal maps and depth behavior, and dispose owned adapters without disposing shared original assets. Custom node materials require explicit surface producers; never blindly replace their vertex or shading graphs with the standard-material adapter.

The registry records each draw's route: deferred mesh, deferred SDF, forward effect, or excluded helper/shadow proxy. Unknown opaque materials must be reported with object/material names; silently dropping or blackening geometry is unacceptable. SDF helper twins and inflated shadow hulls must never enter visible G-buffer output.

All registered character types receive a real GPU smoke render, with stronger close-up/wounded coverage for zombie, goblin (polygon kit plus generated face), and soldier (held prop and combat pose). Parsing/building is not equivalent to rendering.

## Shared game light list and look

Use a deterministic maximum of 16 lights. Reserve the flashlight slot and an active muzzle-flash slot, then choose relevant practical lights by stable distance/ID ordering with counts of selected/dropped lights in diagnostics. A muzzle flash becomes its own shared light and no longer changes flashlight cone/color for deferred bodies. Existing legacy replay remains in the legacy branch.

Light positions are world-space, including the muzzle light parented under the first-person rig. Preserve practical flicker, beam offset `[0.25, -0.15, 0.1]`, cone, range, and authored colors. Do not assume the legacy SDF gate or Three point-light intensity is numerically identical to the deferred falloff; calibrate through matched images and document conversion constants in the game light adapter.

Expose game ambient/fog configuration independently of the M1 fixture's constant ambient. Preserve the dungeon's darkness, readable wet highlights, fog distance, and wound detail. Surface data stays unlit. Any remaining differences from legacy flesh scatter/AO, face-flat lighting, specular intensity, emission behavior, and display compensation are inventoried with screenshots. Those differences must be visible in the report, not disguised as parity.

Blood/goo and transparent particles remain forward effects in this milestone. Preserve their authored look, shadow-red floor, depth occlusion, and existing lighting behavior. Full shared-light shading of these forward effects is a later extension; no claim is made that M2 unifies every transparent material's shading.

## Flashlight shadow contract

Exactly one shadowed light: the flashlight. Preserve two 1024x1024 maps by default:

- **Full caster map:** eligible level geometry and existing animated inflated character shadow proxies; sampled by standard opaque mesh receivers so characters cast onto the environment.
- **Level-only map:** eligible level geometry without inflated flesh proxies; sampled by flesh and bone/tissue receivers to avoid hull self-shadowing. Equipment following an actor uses this receiver category as well to prevent its character hull swallowing its illumination. Classification must be explicit, independent of albedo/class assumptions.

This preserves the current approximation: flesh receives level shadows, while character-to-character shadows and exact wound/limb SDF silhouettes are not introduced. Keep the shrunken occlusion hull separate from the inflated shadow proxy. Do not spend a new raymarch per light or per shadow sample.

A dedicated shadow module owns projected-depth targets, shadow cameras, caster proxy scenes, filtering/bias uniforms, and disposal. Produce depth with explicit raster passes and nearest, non-color depth data plus hardware depth testing. Keep source geometry/transforms/instance data and alpha-cutout behavior; preserve the existing caster eligibility rather than accidentally including viewmodels or visible SDF bounding boxes. If a custom caster vertex path cannot be reproduced, report and resolve that limitation instead of silently casting its box. Do not reparent game objects or mutate their original materials to assemble shadow scenes.

Shadow lookup uses the current world position, light view-projection, consistent WebGPU depth convention, a documented bounded filter kernel, and bias. Treat positions outside the valid shadow frustum as unoccluded. Full vs level-only selection happens per receiver. Visibility modulates only the flashlight's direct contribution.

`?spotshadow=0` must skip both map renders, not just zero a sampling multiplier. A separate diagnostic sampling toggle may disable shadow darkening while maps still render, with counters making the distinction visible. Preserve the existing flashlight offset so cast shadows are not hidden directly behind their casters. Clear/reset maps at boot, resize, disabled transitions, and rebuilds so stale silhouettes cannot remain.

## Validation and acceptance

- Legacy boot and default behavior remain valid after importing M1 onto current main. M1's own 21-check gate continues to pass.
- Deferred game boots without WebGPU validation errors. Every visible opaque producer route has actual coverage; all registered characters render. Wounds, kill/detach, chunk baking, kit loading, actor rebuilds and soldier behavior remain functional.
- Hardware depth at output matches resolved depth; blood/particles and equipment interleave correctly with mesh and SDF in both directions. Post-AA/lens toggles and target resize preserve orientation and one output conversion.
- With source geometry fixed, moving/toggling lights or shadow sampling leaves material buffers unchanged. Flashlight and muzzle flash affect both mesh and flesh through independent slots.
- A known pillar/wall blocks flashlight illumination on flesh; a posed character proxy casts a coherent shadow onto the floor/wall; flesh does not become uniformly black from its own inflated hull. Move camera/light/caster and verify same-frame tracking. Shadow-off boot renders zero shadow maps and produces no stale shadow on re-enable/reload.
- Inspect matched legacy/deferred captures in dark dungeon, bright beam, wounded close-up, zombie/goblin/soldier views, kit/prop crossings, blood, detached/baked chunks, and shadow cases. Retain timestamps, camera pose, light state, cap, scale, and counters.
- Measure matched gameplay views at scales 1 and 0.5, with shadows on/off and repeated alternating modes. Stop the automatic loop for stepped timing and await the actual GPU queue. Report completed-frame wall distributions separately from live frame pacing and label baseline light-model differences. No CPU tests or other benchmark jobs during GPU measurements.
- Coordinator reviews implementation and images, runs full tests/build after dispatch is idle, and reports remaining visual limitations. Keep integration opt-in for owner playtesting.

## Execution boundaries

Use seven sequential, independently reviewable tasks: core integration/output contract; missing surface producers; scene/light adapters; flashlight shadows; game wiring/composition; gameplay/producer GPU gate; shadow/effect images and measurements. Keep shader smoke checks with the task introducing the shader. The last two tasks own different evidence and must exit cleanly rather than leaving CDP sockets open.
