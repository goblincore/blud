# Goblin pose layer (phase 4b, first slice): working notes (2026-10-03)

Spec `../../superpowers/specs/2026-10-03-goblin-pose-layer-design.md`, plan `../../superpowers/plans/2026-10-03-goblin-pose-layer.md`.

## What exists
- `pose.ts` (pure): a pose is per-bone absolute `pitch`/`tilt` in degrees like a `.blob` bone line; keys interpolate in ANGLE
  space and the skeleton is re-resolved every frame through the engine's own `resolveBones`; ground-lock keeps the lower foot on
  the rest ground height. 10 tests on the goblin's skeleton.
- `motion.ts`: `MotionConfig.pose` (joint positions in rig-point order, rest world frame) becomes `restPose` and every rig point is
  pinned (`posePins`), after every other target writer. `actor.ts` forwards it. 4 tests through the real pipeline
  (buildBody -> bindRig -> stepMotion -> stepRig): the pose reaches the rig, holds over 120 frames with no sag or drift, and an
  absent `pose` leaves every other path alone.
- `characters/goblin-poses.ts` (data): `type`, `recoil` (the look-dev numbers, unchanged) and clips `sit` / `stand` (0.8 s,
  smooth), `jolt` (type -> recoil, 0.25 s, smooth). `pose-library.ts` maps character -> clips.
- Lab: `__sdfLab.holdAuthoredPose(name, t = 0, frames = 30)` holds a pose/clip at time t and freezes like `holdPose`;
  `BLOB_POSE=pose:<name>` and `BLOB_POSE_T=<seconds>` in `blob-turntable.mjs`. From the browser console in the lab:
  `__sdfLab.holdAuthoredPose('sit', 0.4)`. It hides the held prop (the carry system still drives the gun from its own arm
  targets, which the pose overwrites, so it floated off the hands); `holdPose` shows it again.

## Seen (lab frames in this folder)
- `type-*`: seated, hunched toward an invisible screen, arms forward, boots flat on the floor (ground-lock), kit following.
  The reference cube is the nearest thing to a desk; there is no chair, so the pelvis hangs in the air by design.
- `recoil` (frames shot, not saved separately here): arched back in side view, both arms straight up in front view; the
  pitches above 90 degrees resolve (a pure test pins that too); no visible clipping of the pads, yoke, collar or spikes.
- `sit-sheet-*`: t = 0.2, 0.4, 0.6 of the stand -> sit clip: a progressive lowering, feet planted, no limb shortening.
- `jolt-sheet-*`: t = 0.08 (fists in front of the chest) and 0.17 (arms rising).

## Findings and limits
- **Blend in angle space is not optional**: lerping joint positions between a 90-degree swing's ends gives 0.707 of the limb at
  the midpoint; a pure test pins the angle-space result at 0.235 m.
- **Pelvis height from the pose**: type puts the pelvis at y 0.339 (my hand estimate was 0.341); the lab has no chair.
- **A pale lump at the lower back** in the type pose, seen from behind (`type-back-three-quarter.png`): the painted tank top
  bunches where the spine pitches 20 + 27 degrees. It is the SDF's response to a bent spine, not a pose bug. Not fixed; the
  vest and shorts slice will replace that clothing anyway.
- **Poses are judged on the ARMOURED goblin.** At home it wears a vest and shorts (Flat decision 7): a separate slice.
- **Entry is from a standstill:** while `cfg.pose` is set the gait is ignored entirely; a pose started from a walk pops.
- **Per-frame cost not measured:** `poseJoints` re-resolves ~35 bones and runs `expandMirror` each call. Trivial next to
  a render frame, but it allocates; the game wiring should sample once per frame, not per sub-step.
- No hands-on-keyboard contact, no chair, no prop contact: hands hover where the arm angles put them.
- Not wired into the game or the Flat scene (which does not exist yet); only the lab and the tests.

## Owner feedback on the seated pose: the "diaper" and the belt (2026-10-03)

Owner: "his legs are attached to the side of his pelvis so his pelvis dips below when he sits like he has a big diaper ... his
pelvis and butt need some work ... when he sits his belt has all kinds of clipping issues where it doesn't really move with his
waist." Both confirmed by close-up frames (`type-*` before, `pelvis-fix-*` after) and fixed.

- **Cause 1, the pelvis.** `goblin.blob`'s pelvis was ONE tapered bar from the root (y 0.60) to the hip joint (y 0.705) with a
  68 mm round end cap: 17 cm of mass hung below the hips. Standing, the thighs hid it; seated, the thighs lie flat at hip height
  (underside 46 mm below the joint) and the pelvis dangled ~8 cm under them.
- **Fix 1.** A squashed sphere AT the hip joint (bottom y 0.648), the gut blob 20 mm further forward and 12 mm lower, and a
  mirrored glute pair (`both`, 38 mm out, 46 mm back, r 0.050). Seated: flush on the thigh line. Standing from behind: two cheeks.
  Front: no crotch gap visible. Re-pinned on purpose: pack golden snapshot, the prof array (+2 prof-0 entries), the
  continuity test's start point (the root is now outside the body). The "gut in front" pin was kept, not loosened: the first
  pass dropped the belly from +27 to +8 mm because the new glutes fill the back, so the gut blob was pushed forward until it
  passed again.
- **Cause 2, the belt.** It rode the HIPS bone at y 0.669-0.705: the hip joint's own height, a rigid hoop on the pelvis. Seated,
  the spine pitches and the belly moves but the belt does not, and the thighs swing through that height.
- **Fix 2.** The belt now sits at the waist (y 0.766-0.812, the torso's narrowest) skinned to `spine1`, so it bends with the belly;
  the pants/shirt paint seam (y 0.705) is now below it, so the tank top hangs untucked over the pants. Pouches and buckle moved with
  it. **WAM `attach` boxes HANG DOWN from their anchor** (found the hard way: the pouches dangled below the belt toward the thighs
  and their inner corners were 10.8 mm inside the belly); anchored at the belt band's top now.
- **Residual:** pitching the spine 20 degrees about the hip drops a point 0.085 m in front of the pivot by ~3 cm, so the belt front
  still settles to within ~1 cm of the thigh top when seated. A rigid ring cannot fold; it reads fine in the frames, but it is the
  first place to look if clipping is still visible.
- Not re-checked after the pelvis change: the WALK and RUN poses (only rest and seated were shot), and the recoil pose.
