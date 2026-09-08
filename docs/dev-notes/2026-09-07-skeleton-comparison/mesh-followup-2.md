# Mesh follow-up 2

Approved scope: reproduce and fix soldier bent-knee protrusions; replace dry bone coloration with wet burgundy/pink tissue coating and limited ivory; add seated fleshy eyes/red pupils. Eye popping animation remains later.

Task ownership: soldier_crouch owns pose contract and regression; wet_bone_eyes owns mesh appearance and eye integration. Coordinator owns serial GPU validation and independent review. Existing preview5396 remains available, defaults unchanged. No merge/push.

Acceptance: bent-knee pose must actually exercise knee displacement, not just a boot-frozen screenshot. Material should follow bone-local motion and blend into flesh. Eyes follow head, respect visibility/lifecycle. Focused tests and build plus actual GPU visual inspection; frame drift prohibits exact parity claims.

## Implementation and verification

- 336d2088: non-arm limbs now rotate from stable rest axis toward live endpoints; origin compensates offsets. e926fecf removes an invalid minimum-error assumption in the volume fixture.
- d4c94e9a: mesh-only continuous wet burgundy/rose coating, limited ivory, mesh gloss floor; paired surface-seated eyeballs with red pupils parented to head. Shared lighting/defaults unchanged.
- Focused verification: contract16, mesh18, volume-GPU12 passed. Full volume run11 passed and1 failed due to the obsolete >1mm defect prerequisite; corrected targeted test passed. Eye/appearance7 passed; TypeScript and production build passed (existing chunk-size warning).
- Independent source reviews approved pose/volume and eyes/material.
- Actual firing stance after120 live simulation steps: `/tmp/soldier-crouch-before/mesh-r1-intact-a.png` shows shin strips; `/tmp/soldier-crouch-final/mesh-r1-intact-a.png` shows clean boots in same stance. CPU regression additionally samples240 motion steps and two grounded squats.
- `/tmp/wet-skull-eyes/mesh-r1-torso-wound.png` shows exposed wet pink skull and fleshy red-pupilled eyes. `/tmp/wet-ribs-final/mesh-r1-torso-wound.png` shows wet pink/red rib coating. These are coordinator-inspected local artifacts, not user visual approval.
- Serial GPU drivers completed captures with no shader/runtime errors; empty-draw and favicon warnings remain. They exit nonzero for repeated-frame drift, so no exact parity or performance verdict. An earlier capture was interrupted by HMR and superseded by final captures above.
- Preview5396 retained; no merge/push. Eye popping remains later.

Final integration review approved with no blockers; shared head and leg transforms, eye lifecycle, and mesh-only material scope checked.
