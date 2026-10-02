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

## Tasks 2-3: the gaits (2026-10-02)

- `GOBLIN_WALK` / `GOBLIN_RUN` (`gait.ts`), curve mode on `SOLDIER_WALK` / `SOLDIER_RUN`; `GOBLIN_PROFILE` uses them with
  cruise 1.19 m/s and runBand 1.30..2.77, both derived from the curves (`travel x 0.56 m x freq / duty`) and pinned in
  `goblin-gait.test.ts` as RELATIONSHIPS (cruise < runBand.from, cruise = the walk's implied speed, run top = the run's).
- Before/after frames: `before-*` vs `after-*` (3 phases each, side and front) and `after-{walk,run}-sheet-side.png`.
  Before: walk and run identical, legs nearly straight, tiny stride. After: a real stride (trailing leg, lifted foot, bent
  knee), a high-knee run with a flight phase; boots stay on the feet; the shotgun and the carry arms hold; no visible
  armour, head, shades or gun clipping at the phases shot.
- Tuning: ONE step so far. The first walk read as an upright soldier, so `torsoLean` went 8 -> 12 (walk) and 14 -> 18
  (run); `final-{walk,run}-55-side.png` are after it. Cadence (1.5 / 2.1 Hz), sway and arms are the starting values.
- **Not verified, and stills cannot show it:** the feel in motion (tempo, bob, whether it reads as scamper rather than a
  hurried soldier), foot skating (the system plants feet by design; not measured), and the head bob, which in curve mode
  is the clip's hip bob x leg length and may be weak. The owner's look in the live lab is the gate.
- Task 4 skipped (no foot stretch, see above).
