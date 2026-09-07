# Soldier structural injuries and falls

The soldier now uses an articulated floor pose instead of the zombie collapse. Lethal hits drive a quick topple and short airborne shove in the horizontal shot direction; leg damage or either missing arm produces a nonfatal incapacitated fall. The surviving arm braces and the head moves subtly. Downed soldiers stop combat and release the shotgun, but remain damageable.

This is a procedural force-directed fall followed by the existing rig solver, not a full rigid-body ragdoll. Lethal pose transition is 0.30 seconds; incapacitation takes 0.48 seconds. Blast throws are stronger than pellet impacts. Zombie collapse remains unchanged.

## Damage tuning

- Four accumulated leg pellets incapacitate; eight limb pellets sever.
- Sixteen accumulated torso pellets are fatal; head flesh hits remain fatal.
- Heavy joint blasts can still sever immediately.
- Both arms are required for soldier shotgun operation. Losing either arm incapacitates, including pre-existing missing limbs on actor initialization.

## Other refinements

- Strafe feet and knees remain in their own lateral lanes instead of crossing.
- Chest armor has a raised, tapered rear collar with checked flesh clearance.
- Fallen head orientation follows the rig, including face projection. Lab hand/toe tips follow fall targets.
- Respawn/reset recomputes injury signals so a fresh soldier does not inherit incapacitation.

## Gotchas

- Authored left limbs are positive X; derive splay from the actual joint position rather than assuming a sign.
- The usual upright head cone and yaw-only pinned tips must be bypassed for a fallen soldier or they undo the floor pose.
- Keep shoulder wound ownership intact: retained severed wounds must not become global cutters.
- Lab and game both need the injury/fire/drop wiring; changing only motion can leave a disabled soldier carrying or firing a weapon.

## Verification

Focused tests cover injury thresholds, either-arm weapon release and incapacitation, bone lengths and floor pose, head alignment, shot-directed falls, strafe lanes, and collar clearance. `scripts/verify-soldier-structural.mjs` exercises lethal fall, leg loss, both arm losses, collar rendering, and reset in real WebGPU; captures go to `/tmp/soldier-*.png`. It reuses the live Vite server and closes only its owned browser resources.

Final verification: 228 test files / 3,647 tests passed; TypeScript + production build passed. Real WebGPU scenarios completed without browser errors. Review of injury propagation, head/tip binding, limb handedness and reset found no remaining concrete regressions.

## Side-fall grounding and back plate follow-up

The original minimum-joint grounding lifted the torso whenever a hand extended below it, even if the arm had been severed. It also reused an ankle-height contact plane plus 7.5 cm padding. Side-fall regression cases reproduced torso clearance of 8.8 cm and 41.4 cm. Falls now ground against torso/shoulder support volumes and use the soldier boot-sole plane (13 cm below authored ankle joints). `MotionFrame.floorY` carries that same plane into both actor solvers. Limb constraints fold against the floor without determining whole-body height. This remains approximate flat-floor contact, not terrain-aware rigid-body physics.

Added a beveled rectangular back plate over the flexible spine region, overlapping the rear collar and cuirass. Armor clearance tests pass. Follow-up validation: 122 focused tests across actor, motion, rig binding, soldier gameplay and armor; production build passed. Lab debug `forceCollapse([x,y,z])` now accepts an optional impact direction for repeatable side-fall checks.

Real WebGPU follow-up passed for both side directions, intact deaths, arm/leg incapacitation and reset, without browser errors. Reviewed clean side-fall and rear-plate captures.

## Settled soldier body baking

The pre-existing bake seam handles detached chunks, not whole zombie corpses. Soldiers now reuse its worker extraction and mesh lighting for a settled torso/limb snapshot. After the settled phase plus 1.5 seconds without new damage, rig stepping pauses. The live snapshot remains visible while the worker runs; a successful result swaps the large body proxy for a static mesh. Armor is already polygonal and remains attached. The small head stays on SDF to preserve the exact face projection and red-eye glow. Thus this is body baking, not complete removal of every soldier SDF draw.

Nonfatal incapacitation intentionally becomes still after the brief bracing interval; subsequent damage wakes the body. Actor damage revisions invalidate in-flight results and remove completed meshes before the damaged frame draws. Hits continue using the actor's original posed field, so wounds, armor damage and severing still work. Rebinding after a sever preserves `headFollowsRig` immediately, avoiding a one-frame upright head snap. Quiet bodies can bake again after damage.

Body snapshots retain clustered dead flags, per-primitive paint and capped, owner-scoped wounds. The chunk defaults are unchanged. Extraction failure/overflow keeps the live renderer; empty/overflowed snapshots are not retried until damage changes their revision. One worker job runs at a time, with cleanup on cast rebuild, pagehide and HMR. Baked surface lighting is the existing approximate chunk lighting; detailed head shading remains exact.

Debug: `__sdfGame.soldierCorpseBake()` reports pending/baked actor IDs and errors; `setSoldierCorpseBake(false)` restores live rendering. `scripts/verify-soldier-corpse-bake.mjs` exercises a real game incapacitation, successful worker swap and subsequent damage restore. Captures: `/tmp/soldier-corpse-baked.png`, `/tmp/soldier-corpse-live.png`. Do not infer FPS improvement from the frame-capped smoke check; it verifies the representation change.

Validation: 229 test files / 3,657 tests passed; production build passed; the subsequent head-rebind fix passed the 11-test soldier actor suite. Real WebGPU bake and damage restore completed without browser errors.
