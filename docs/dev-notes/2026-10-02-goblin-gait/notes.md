# Goblin gait (phase 4a): working notes (2026-10-02)

Spec `../../superpowers/specs/2026-10-02-goblin-gait-design.md`, plan `../../superpowers/plans/2026-10-02-goblin-gait.md`.

## Task 1: baseline

- Frames: `before-{walk,run}-{40,55,70}-{side,front}.png` (`BLOB_POSE_FRAMES` = the phase held). The goblin walks on the
  zombie's SHAMBLE with carry arms (`SHAMBLE_CARRY`); walk and run are the SAME gait, so "run" is identical to walk.
  The legs stay nearly straight with a tiny stride, the body is upright and stiff, the gun is held out in front.
- **Foot stretch (the audit's "goblin/gnasher feet +8-10 cm"): measured, and gone for the goblin.** Probe: every prim's
  rest length (`__sdfLab.current.prims`) against its posed length (`__sdfLab.heroPosed().prims`) in held walk and run
  poses, listing changes > 10 mm. Result, both poses: ONE prim, `goblin.blob:216` (the neck cord, `head on neck`), rest
  0.124 m -> posed 0.144/0.145 m (+20 mm). No foot prims stretch because the armour phase removed the flesh feet (the
  boot is the foot). The +20 mm cord is under the collar and below the visible threshold; recorded, not fixed. So plan
  Task 4 is skipped.
