# Soldier silhouette and damage pass

**Goal:** Exaggerate the soldier's readable silhouette and make localized injury lead to consistent wounds, dismemberment, armor loss and collapse in lab and game.

**Design:** Keep the existing rig/motion/sever architecture. Art edits preserve joint centres and grip spacing. Add a pure soldier-specific cumulative injury policy, leaving zombie behavior unchanged. Opt the soldier kit into connected-piece damage/debris; presentation follows the same live body/wounds in both consumers.

**Constraints:** No scene-lighting rewrite, FPV weapon change, or global wound-radius changes. Keep seeded/pure injury decisions. Corpses remain damageable. Never spawn detached pieces at rest coordinates or retain invisible gun hands. User explicitly delegated creative decisions.

- [x] Character art: broaden chest/hips/armor, tighten hair, lighten face, add small glowing red eyes. Regenerate WAM mesh and inspect front/side/back in live lab/game.
- [x] Shotgun: ~37% thicker, ~19% longer, preserve hand locators, synchronize longer muzzle. Real-rig hand contact tests and model preview.
- [x] Injury policy: actual soldier anatomy tests for cumulative arm/leg cuts, headshot fatality, leg buckling and single-leg collapse; distinguish distal missing limb from surviving cluster. Keep stump wounds out of injury accumulation.
- [x] Detached pose: carry source indices through severs; same posed positions, bone pieces, and torn ends in lab/game. Test posed arm/shin rather than only rest pose.
- [x] Armor: partition disconnected triangles, retain original intact draw calls, bake only released pieces at current skinned pose. Detach on local damage or missing anatomy, tumble with floor contact; reset/dispose correctly. Test component partition, cut visibility, wound breakoff, pose fidelity and reset.
- [x] Integration: lab pointer/keyboard/explosion damage share injury and detached-pose helpers; shared character view passes live wounds/anatomy to kit and releases gun after injury.
- [x] Verify: focused tests, full Node22 suite, production build, actual WebGPU front/game/leg wound/leg sever/fall/headshot/armor-removal captures; review final changes and record findings.

Owner-approved result, implementation gotchas and verification: [notes](../../dev-notes/2026-09-06-soldier-bulk/notes.md). The final face uses the owner’s replacement texture and red-only eye emission; earlier skull/rounded-hair experiments were rejected.
