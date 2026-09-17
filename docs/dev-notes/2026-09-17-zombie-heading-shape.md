# Zombie shape changes with heading — 2026-09-17

The owner reported two apparent zombie variants: most rooms showed a thin torso, exposed ribs, separated shoulders and broad flat feet; room 4 showed the preferred fuller torso and narrow feet. Half-strength blending was otherwise acceptable.

There is no room-specific zombie asset: `spawnAll` selects the same `zombie` registry entry for every non-soldier spawn. The difference came from `applyRig`: skull primitives received a rotation quaternion, while other flesh retained world-aligned anisotropic axes. Torso width/depth and foot width/length therefore changed relative to the facing direction. Non-arm endpoint offsets also stayed in world space, shifting attachments incorrectly as the rig turned. Room layout made different headings look like different models.

The fix rotates non-head endpoint offsets with body yaw (arm offsets retain the existing solved bone rotation), rotates bend offsets, and supplies orientation for anisotropic or directional primitives. Isotropic capsules retain the un-oriented field path. CPU distance queries and GPU group/cluster flags use the existing orientation machinery. Half-strength blend constants and authored character assets are unchanged. Remaining rest-pose bone-containment warnings from the half-blend rollout are separate; this does not claim all authored bone exposure is eliminated.

Regression: rotate the same zombie and query points together at yaw 0, ±90°, 180° and 0.7 radians around both room-1 and room-4 spawn origins. Every primitive and the combined CPU flesh field must preserve signed distances; GPU packs must mark torso and foot clusters oriented. Before the fix four of five headings fail; after the fix all pass. Existing head, elbow and actor elbow tests pass too.

225 focused tests across nine files pass, covering rigging, rotation, elbow constraints, packing, damage, severing, blend propagation and gib deformation. Production build/TypeScript pass (existing bundle-size warning only). No new frame-time claim is made: correct orientation activates the existing oriented evaluator on anisotropic torso/foot clusters.

WebGPU smoke check on the normal animation loop (headless Chrome, primary Vite on 5498) covered room 2 at approximately 1.76 radians, then full-body views in rooms 2 and 4. The sideways torso retains its width and shoulders stay attached; feet retain distinct silhouettes. No captured page/console errors. These are visual checks, not frame-time measurements or a full gameplay pass.

Harness caveat: issuing all simulation/render steps synchronously in one browser evaluation initially captured missing flesh with visible mesh bones. Allowing actual animation frames produced complete bodies with the shell both enabled and disabled. The synchronous captures were discarded; do not use them as geometry evidence.
