# Soldier shotgun and firing readability

The owner approved the first soldier polish on September 6; commit 909b6a87 was fast-forwarded into local main after 3,607 tests passed. This follow-on is developed on codex/soldier-shotgun using the existing preview workspace/port 5184.

## Design and checks

- Replace the enemy's borrowed first-person double barrel with a compact, low-poly semiautomatic shotgun. Keep the existing grip/muzzle coordinate contract; player weapon stays its own asset.
- Raise the firing grip to the shoulder and seat the stock against the shoulder pad. Preserve exact arm lengths and support-hand contact through the transitions; verify against the actual soldier rig.
- Put the short white-hot muzzle flash in shared character presentation, so lab and game show the same effect. Render transparencies after the SDF composite while testing against its depth. Keep environment lighting out of this change.
- Validate profile/asset locators, motion and effect lifetime; production build; live lab and game captures with clear firing state and wall occlusion.

## Damage/reactions follow-up

Armor should break off under fire and expose the flesh underneath. Headshots should kill immediately, with occasional head gibs. Fix soldier arm detachment so severed arms and attached armor behave as coherently as the zombie's. Implement through shared character/damage presentation so the lab previews game results. This needs a separate damage pass: armor durability/hit routing, exposed-body hits, headshot handling, and kit visibility/chunks on sever.

## Result

- Dedicated `soldier-shotgun.glb`: 1,296 triangles, 71,836 bytes, one mesh / three material primitives. Prior shorty: 13,754 triangles, 281,416 bytes, 32 meshes / 34 primitives. No textures or skeletal animation. Exact Grip_Hand / Fore_Hand / Muzzle locators verified by the Blender script.
- Aim grip is within 8 cm of shoulder height, stock within 8 cm of the shoulder point, and support-hand reach is 0.485 m on a 0.50 m arm. Existing transition tests preserve contact and both segment lengths.
- Shared flash: 35 ms hot core, 140 ms total lifetime, warm halo; 1.8 cm outside the actual recoiling bore. The separate transparent pass retains finished depth, so it is neither erased by flesh nor visible through walls.
- Prop-only reflections make the gun's metal readable without changing the environment. Rebuild disposes character effects and pending model loads safely.

## Verification

- Fresh Node 22 suite: **224 files / 3,609 tests passed**. Subsequent 1.8 cm gas-origin visual adjustment was checked in the live lab and production build.
- Production TypeScript/Vite build passed. Existing large-chunk warning only.
- Independent review: actor-rebuild flash leak found and fixed; final lifecycle review found no remaining material issues.
- WebGPU game: observed aim → fire at a 3.48 m standoff, stopped movement during firing, bright flash, hidden behind a solid wall, no orphaned flash after rebuilding the cast; no runtime exceptions.
- WebGPU lab: walk/run/aim plus repeated F shots; no runtime exceptions. Temporal smear disabled for frozen QA captures to avoid blending different camera positions.

[Model](model.png) · [Shoulder aim](lab-aim.png) · [Lab firing](lab-fire.png) · [Game firing](game-fire.png) · [Wall occlusion](game-wall-occlusion.png)

Preview: [game](http://localhost:5184/sdf-game.html), [soldier lab](http://localhost:5184/sdf-lab-webgpu.html?character=soldier). Weapon/readability and the later bulk/injury fixes are merged to local main at `64aa78ee`. The preview worktree remains in use on port 5184.

## September 6 follow-up

The owner approved the larger weapon and subsequent appearance/injury work for main. The damage follow-up above is implemented as localized breakoff and injury/sever logic; the original dimensions and pose measurements here describe the earlier pass. See [final settings, captures and gotchas](../2026-09-06-soldier-bulk/notes.md).
