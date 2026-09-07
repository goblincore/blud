# Soldier appearance, injuries, and rendering fixes

Owner approved this iteration and requested merging to main on 2026-09-06. This extends the earlier shotgun/readability pass. The preview on port 5184 uses `.worktrees/soldier-polish`; retain that worktree while the preview is in use.

## Approved appearance

- Bulkier torso, arms, neck and armor; exaggerated low-poly semiautomatic shotgun. Preserve rig lengths and the weapon grip/muzzle locators when changing the silhouette.
- Glossy olive chestplate with rounded connected shoulder plates. Armor and weapon use mesh geometry; flesh and head remain SDF.
- Keep the owner's face proportions in `characters/soldier.blob`, replacement face texture, narrow green top strip with a short taper at the rear. The skull-head experiment was rejected and removed.
- Red-only eye emission works with the replacement texture. `eyeGlowRedOnly` is opt-in; its default preserves other characters' texture behavior.
- Final material tuning: fresnelBoost **1.5**, wetness **0.79**, skin lightness **+0.02** baked into baseColor **0.522 0.424 0.333**. Do not reapply the lightness adjustment every load.

## Shared damage and presentation

`soldier-damage.ts` supplies cumulative limb injuries, fatal headshots, joint-sensitive severing and leg-loss collapse. Large blast head wounds can sever the head. `detached-pose.ts` preserves the current animated pose when severing. Lab and game use these shared helpers; artificial stump wounds do not accumulate fresh injury.

`webgpu/kit-damage.ts` releases armor pieces at their current skinned pose, resets/disposes debris, and follows missing anatomy. Injury releases the held weapon when necessary. This is localized breakoff, not a new armor durability/ballistics simulation. Wounds remain damageable after collapse.

The support arm bends down and forward instead of locking nearly straight across the face. The real rig retains both hand contacts and arm segment lengths through carry transitions.

## Gotchas and lessons

1. **Animated mesh culling:** update the skinned kit's bounding sphere after bone world matrices each pose. A stale bound made armor disappear/reappear with camera angle even while flesh remained visible. WAM mirror terminators also matter: a missing `end` duplicated components.
2. **Wounds need anatomical ownership:** a shoulder cutter applied to the combined body field moved into the head when the arm raised. Wound flags now carry owning cluster plus primitive range. The shader restores independently wounded neighboring limb fields and restricts wound shading to the owning surface. Legacy unscoped chunk wounds remain supported; clear ownership metadata when reusing slots. Retained projectile wounds keep their original owner even after that cluster is severed; filtering owner lookup by `alive` accidentally turns them into global cutters.
3. **Keep the full body when refreshing wounds:** `createWoundRing().refresh` needs clusters as well as primitives. Never cast `{ prims }` to `BuildResult`; lab uploads now pass the actual posed build.
4. **REST versus posed:** `CharacterView.pose` receives the rest body and applies the animation itself. Passing an already posed body applies the transformation twice. Severed chunks need an explicit current-pose copy instead of being spawned at rest coordinates.
5. **Save skin must save materials:** the button previously sent only baseColor. It now includes all material sliders, validates against their ranges and inserts palette fields previously inherited from defaults. Skin lightness is baked into color, so its slider returns to zero after reload. Saving writes the source file; it does not make a Git commit.
6. **Separate Vite caches per checkout:** this worktree shares `node_modules` with main. A shared default optimizer cache mixed Three/TSL module state, collided on node IDs and dropped the shader helper chain. Symptoms: “No stack defined”, unresolved `sdPrim`, meshes visible but SDF absent. `vite.config.ts` uses checkout-local `.vite` (already ignored). Do not revert it to shared `node_modules/.vite`.
7. **Build/unit success is not GPU proof:** the compute-only wound test passed while the browser's production shader failed. `verify-soldier-wound.mjs` now subscribes before navigation and fails on browser errors as well as checking actual GPU samples. Always inspect the rendered result after shared shader changes.

## Verification

The final browser regression restored all **66** head-interior samples erased by the old unscoped shoulder wound, while preserving **204** arm-cavity samples. It also rendered the wounded aiming soldier without browser errors. The saved material values were applied through the native lab save button and confirmed in the source file. Production build passed; merge-time full-suite results are recorded below.

Run the GPU check using an owned browser; the helper reuses the existing Vite server and only shuts down processes it starts:

```sh
LAB_VITE_PORT=5184 LAB_CDP_PORT=9226 fnm exec --using=22.22.1 bash -c 'source scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/verify-soldier-wound.mjs'
```

[Final wounded aim](final-wounded-aim.png). Other images in this directory document intermediate art/pose checks and do not supersede the final approved `.blob` settings.

Merge review identified and fixed the severed-cluster ownership edge case. The pre-merge full suite passed **228 files / 3,638 tests**; an additional real-sever regression reproduced the bug before the fix.

## Merge result

Merged to local main at **64aa78ee**. The merged main tree passed **228 test files / 3,639 tests**, including the severed-owner regression, and the production TypeScript/Vite build. Independent review confirmed its ownership finding was resolved. Unrelated main asset edits were preserved. The preview worktree and server on port 5184 remain available. No remote push was performed.
