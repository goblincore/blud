# Task 3 report

## Implemented

- Authored a contained Soldier cranium and jaw plus three paired rib levels, sternum, and rear spine. The existing mesh skull sculpt now has a separately revisioned Soldier branch and leaves Zombie behavior unchanged.
- Added Soldier-only three-lobe render wound clusters. They preserve all real wound rows, add only spare-slot cosmetic rows, use the carve normal's tangent plane for front and side hits, and extend beyond the primary crater rim without entering injury logic.
- Added localized angular gunmetal at the Soldier skull's left temple and brow through the existing mesh feature attribute and material shader. Zombie feature encoding and appearance remain unchanged.
- Added fresh-hit armor handling. Each wound object is consumed once, plate bounds are skinned into the current world pose only when new impacts exist, cumulative damage sheds a plate, and severed anatomy still sheds its equipment.
- Added a deterministic 32-slot billboard spark pool in the existing effects scene. Hit and shed bursts allocate no runtime meshes or materials; the pool hides when empty and resets/disposes with the character.
- Changed the `hitMeshSkull` debug fixture to trace from outside the posed head through the live flesh SDF and stamp the resolved surface point.
- Stopped the persistent Soldier injury ledger from appending hits in a limb already classified as structurally missing. Visual wound stamping remains intact.
- Assigned stable event identities in the wound ring because normal age updates clone wound objects. Armor deduplication now survives those clones, and kit damage reconstructs contacts from the separately supplied posed body rather than rest primitives.

## Focused verification

Run before commit:

```text
npx vitest run \
  src/lab/sdf-zombie/characters/soldier-blob.test.ts \
  src/lab/sdf-zombie/soldier-wounds.test.ts \
  src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-skull.test.ts \
  src/lab/sdf-zombie/webgpu/skeleton-spike/mesh-appearance.test.ts \
  src/lab/sdf-zombie/webgpu/kit-damage.test.ts \
  src/lab/sdf-zombie/webgpu/character-effects.test.ts \
  src/lab/sdf-zombie/webgpu/character-view.test.ts \
  src/lab/sdf-zombie/webgpu/game-actor-soldier.test.ts
npx tsc --noEmit
```

The focused suite covers authored containment, Soldier/Zombie sculpt gates, front and side ragged offsets, real-row preservation, steel localization, fresh event deduplication, current-pose plate bounds with nonzero body yaw, pool bounds/billboarding/empty visibility/disposal, and existing Soldier damage behavior.

## Limits for parent QA

- No GPU run or full production build was performed in this task; the parent owns those checks.
- `boneColor` is useful for Soldier procedural/reference rendering, but the default shared mesh material takes its base bone uniform from the shared renderer setup. Default mesh bloodiness therefore comes primarily from the existing exposure stain, the darker Soldier fat palette, and the new ragged silhouette; GPU QA must judge the final balance.
- Sparks use a bounded deterministic visual spray from the resolved plate contact. They do not add light sources or change projectile/damage rules.
