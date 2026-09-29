# Zombie feet — the floating zombies, 2026-09-29

**Owner report (2026-09-28):** "the zombies appear to be floating above the ground because of the shadow disconnect".

**Cause (measured, not the shadow):** the zombie MODEL stopped 0.199 m above the floor at rest. Its legs hang
from the pelvis tail (y 1.06) and thigh 0.40 + shin 0.42 left the ankle at 0.24, with no foot — the shin's end
blob was the "foot". The tube shadows landed on the floor 20 cm below the stumps
([before-feet-under-tube.png](before-feet-under-tube.png)). Every character with a `foot` bone rests at ~0
(female, bride, warbull, ogre, schoolgirl, minotaur...); shin-ended kit characters (soldier 0.10, juggernaut
0.11, goblin 0.12, clown 0.05) are presumably hidden by their boots — not verified.

**Fix** (`zombie.blob` and its TS twin `body.ts`, kept in parity by `zombie-blob.test.ts`):
- thigh 0.40 → 0.46, shin 0.42 → 0.50: the ankle at ~0.10; hips, torso and height (top 1.737) unchanged;
- the thigh bar starts at 0.04348 of the bone (0.02 m, as before) so the hip flesh does not move — the iliac
  crest bone sits 4 mm inside it;
- the old end-of-shin "foot" blob becomes a round ankle (r 0.058); a new `foot` bone (dir fwd, 0.15) carries a
  heel blob and a tapered sole bar, displaced down onto the floor.
- Lowest point now 0.004 m (shadow hull −0.001 m). [feet-turntable.png](feet-turntable.png).

**Ripple (all deliberate, each commented in its test):** 19 rig points (+ `toeL`/`toeR`, rigid tips like the
soldier's; earlier indices unchanged), the stepMotion checksum re-recorded (second deliberate exception in
`gait-pins.test.ts`), collapse rope hip→foot 0.960 m, a knee sever takes 4 prims, packed prof values 27, bone
segments 20, the hull sampling test draws 300k points, two float-noise tests compare within 1e-12, and the
committed gib assets regenerated (`npm run gib:assets`).

**Round two (owner, same day): bigger and rounder.** Stylistic target is early Virtua Fighter without the
polygons — simple forms, the hands are orbs. Foot bone 0.15 → 0.16; heel is now a round orb (r 0.058) and the sole
a rounded capsule r 0.052 → 0.046, so heel-to-toe is ~0.27 m (was ~0.19). Still on the floor (undersides ~0.004).
gait-pins checksum re-recorded again; gib assets regenerated.

**Open:** the walk with the longer legs is not yet judged in play.
