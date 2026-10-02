# Goblin refinement phase 3 (held weapons), thin first pass: the shotgun (2026-10-02)

Scope (owner, 2026-10-02): "keep it thin, shotgun first". One weapon, one stance, on the zombie's legs; no new animation.

## What was done
- `GOBLIN_PROFILE` in `motion-profile.ts`, registered as `goblin`: the zombie profile plus `armStyle: 'carry'`,
  `carries { walk: low, run: low, fire: aim }` and `prop shorty-double.glb` (scale 1, gripReach 0.0396).
- `SHAMBLE_CARRY` in `gait.ts`: the zombie shamble with `armStyle: 'carry'`. motion.ts takes the arm style from the GAIT
  (pickArmStyle), never from the profile (the cultist's trap, GLIDE_CARRY's comment), so a gun carrier needs a
  carry-style gait. Legs are still the zombie's shamble: phase 4 replaces them.
- NO model work: `shorty-double.glb` (the first-person shotgun) already carries `Grip_Hand` (0, -0.074, -0.074) and
  `Fore_Hand` (0, -0.045, 0.155) at exactly carry.ts's `GUN_GRIP`, so the held-prop system takes it as is.
- `gripReach` 0.0396 = where the goblin's hand orb is (55% along its 0.072 m hand bone), so the handle passes through
  the orb (spec decision 3).

## Seen (lab, `BLOB_POSE=walk`, frames `walk-front.png`, `walk-side.png`)
Held in two hands, right fist at the grip, left orb on the fore-end, barrel roughly level at chest height, kit on.

## Aim pose checked (owner asked, same day; `BLOB_POSE=aim`, frames `aim-three-quarter.png`, `aim-side.png`)
`holdPose('aim')` works in the lab although blob-turntable.mjs's header lists only walk|run|hip. Result: a shouldered aim,
stock at the cheek, barrel forward at eye height, right fist on the grip and left orb on the fore-end. Checked from 8 yaws:
no visible plate, pad, yoke, bracer or spike clipping with the gun or arms, and the shades and nose are clear of it. The
receiver sits right against the cheek (the goblin's long nose and shades are the tightest spot); if that reads crowded in
play, the `aim` carry's `gunPitch`/`yaw` is the dial, but the carries are shared with the soldier, so add a goblin carry
rather than edit `aim`.

## Not done / not checked
- The `chest` carry (unused: the goblin's run uses `low`), and any firing, muzzle flash or recoil from the goblin.
- The carry angles are the SOLDIER's (grid-solved per rig, relative to the authored hang); the goblin's arms are long
  (0.235 + 0.235 m). They look plausible but are untuned. Hand roll: the hand bone has no roll, so the grip is the
  orb-through-handle read, not a finger wrap (by design, phase 3 decision).
- Third-person muzzle for gas/flash: the .glb's muzzle nodes are at z 0.318, `GUN_GRIP.muzzle` is 0.41 (soldier's
  longer gun), and `held-prop.ts` muzzle() reads the constant. Irrelevant until the goblin fires.
- Kit-versus-gun clipping in poses other than this one; the chest plate and the stock were not checked in `aim`.
