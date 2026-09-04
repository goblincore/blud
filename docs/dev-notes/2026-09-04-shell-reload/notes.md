# Shell eject clip + load insertion — 2026-09-04

Owner report after the breech merge: cases clip through the gun frame on
eject; fresh cases "magically appear"; the reload is the urgent one. A third,
mid-session: looking hard down shows a detached forearm end.

## What was wrong

Every case was handled in RIG space with no knowledge of where the bore was.

* `ejectedShell()` was a ballistic arc in rig +Y starting AT the chamber mouth
  locator. But the extract slide had just walked the case 7 cm out of the bore,
  so the tumble teleported it 3.5 cm back toward the muzzle, and
  `m.rotation.set(PI/2 + spin, ...)` snapped it from bore-aligned to rig −Z —
  66° off the open gun's bore. Its rear half was back inside the tube and its
  vertical rise cut the chamber wall and the standing breech. That is the clip.
* The arc also came back DOWN: apex 16 cm, then falling through the frame
  ~15 cm from the camera as a shell that filled a quarter of it
  (`before-900.png`, top).
* The load beat lerped a rig-space mesh from the hand straight to the mouth
  with fixed rig orientation, and the support hand's authored key at 1.11 s
  never reached the live breech (`before-1110.png`: hand at the bottom edge,
  cases seated by themselves). The carry happened below the frame.

## What changed

* `boreFrameInRig(out, side)` — the bore basis in rig space from the live
  Muzzle/Breech locators, every frame.
* Eject: hand-off at the extracted case's centre (`mouth + out·SHELL_LEN/2`),
  orientation `qBore` (hull +Y onto −out), velocity along `out` + hard up +
  side drift, tumble about `side`. Dropped once past the apex and back below
  `EJECT_DROP_BELOW_M`. Seeded per reload; seed 0 is the reference; the
  origin is seed-invariant (gate still pins it: 3.50 cm, old constant 16.8).
* Load: `loadCarry` (rig, 0.74→0.96) then `insertStage` (barrel-local,
  0.96→1.11) on the seated Shell nodes. `stagedShellCenter` is where the two
  stages meet — algebraically the same point as the Shell node pulled back by
  `CHAMBER_DEPTH + LOAD_STAGE_GAP` (checked: node centre is 0.035 forward of
  the mouth in GLB z, so −0.085 puts it 0.05 behind = SHELL_LEN/2 + gap).
* `supportHandPose(t, hold)` — the 0.96 and 1.11 keys are replaced by
  `loadHold()` from the live mouths; the table's values are fallbacks.
* Forearms: fixed `ELBOW_L/R` behind the camera, `aimForearm` per frame,
  capsule 0.90 m so the end is never in frame.

## Two wrong placements on the way

1. Orb behind the heads along `out` (a thumb pushing): `out` points largely
   AT the camera on the presented gun, so the orb sat between the eye and the
   breech and hid the entire load — a green disc with a red sliver at 960/1040.
2. "Left of the pair" as `−side`: went screen-RIGHT, over the mouths. The GLB
   is yawed 180° (`gunGroup.rotation.y = PI`) so the model's right chamber is
   on screen-left. `loadHold` now picks the side by `side.x < 0` in rig space.

## Evidence

Before: `before-650.png` (cases already at the top edge, one having passed
through the frame), `before-900.png` (spent case falling back in, fresh ones
off-screen below), `before-1110.png` (seated, hand at the bottom edge).

After: `after-530.png` / `after-560.png` (both cases leaving along the bore,
clear of the frame, tumbling), `after-900.png` (hand rising from lower-left
with the cases), `after-960.png` (staged on the bore axis, heads to camera,
orb beside), `after-1040.png` (half in), `after-1110.png` (seated, hand about
to withdraw).

Gate: `scripts/sdf-game-shorty-gate.sh` passes; `GAME_EXTRA_BEATS=530,560,600,800`
produced the extra frames. Look-down check (scratch driver: `setPose` pitch
±1.45 × `setAimPoint(0, ±1)`): no forearm end in view in any of five frames.

Suite 3101 green, tsc clean.

## Round 2 — owner's pass (same day)

Owner: cases still visibly clip the receiver; the beside-the-pair hold reads
as "one shell held, the other floating"; lower the gun for the reload so it
blocks less; and a way to slow the reload down to see it.

**The clip was the MODEL.** The body loft's top strap ran forward over the
chambers (z 0.0235 from y −0.078), so a closed gun buried its chamber tubes in
the receiver and an OPEN one put each chamber mouth exactly level with the
receiver's top surface: at 45°, mouth centre z 0.023, case radius 0.017, so a
case leaving along the bore had its lower half inside the receiver for the
first ~35 mm. No runtime arc can fix that. `model_grapeshot_shorty.py` now
steps the outline down to z −0.004 forward of the breech face — action flats
the barrels sit ON, standing breech behind — re-exported with `blender -b
-noaudio -P`, body loft sections 16 → 14 to stay under the 14000-tri cap
(13994). The closed gun now reads as a real break action
(`model-threequarter.png`); at 45° open the mouth's bottom edge clears the
flats by 3 mm and the case rises from there (`after-490..560.png`).

**Pose:** the owner asked for lowered-not-raised. Tried at dy −0.055 the whole
reload left the bottom of the frame — the breech already rests ON the bottom
edge, 19° below the horizon at z −0.33. Settled on the smallest lift that keeps
the open mouths in the lower third: dy 0.040 / roll −16 / pitch 16 / dz 0.030
(was 0.115 / −30 / 21 / 0.080). Out of the fisheye's 1.73× centre.

**Hold:** a fist centred on the pair just behind the heads (`loadHold`, no
side offset). It covers the heads and then the mouths as it pushes, which is
what two cases jammed in together look like; the round-1 beside placement
(`round1-960-beside.png`) is gone. This only works on the LOW pose — on the
presented pose the same fist hid the whole load (`round1-500-presented.png`
shows how much of the frame the presented breech took).

**Slow-mo:** KeyT cycles the reload time scale 1 → 0.25 → 0.1 (HUD shows
`RELOAD x0.25 (T)`); `__sdfGame.setReloadSpeed(x)` / `.reloadSpeed`.

**Extractor (owner's screenshot):** the flat bar across both open mouths was
the `extractor` box — 52 × 16 mm, centred ON the bore axis at the breech face.
Now a 50 × 6 × 6 mm plate just under the chamber tubes (z −RO·1.07 − 1 mm),
hidden in the flats when shut, riding out under the cases when open
(`after-650-extractor-under.png`). Re-exported; 13994 tris, `[shorty] OK`.

## Round 3 — the tray inside the tube, and the chrome bore (owner's second pass)

Owner: "weird geometry in the tubes rather than just a smooth tube" after the
eject, and a "triangular piece jutting out" from the receiver where the plate
under the tubes meets it. Then, testing by hand, the diagnosis: "when the gun
splits open the barrels clip into the bottom plate under the chamber tubes, so
you see it in the empty barrels."

That was it. The hinge pin (y −0.070) sits INSIDE the chamber's 70 mm, so an
open chamber swings its forward half down through the action flats, and a
hollow tube shows whatever solid crosses it: the flats' top plane was inside
the empty bore as a flat grey slab (`round3-slab-in-bore.png`). Two model
changes:

* **Ramped flats.** The tray slopes from z −0.004 at the standing breech to
  −0.022 at the hinge knuckle, which keeps it under the swung tube along the
  whole visible hollow (tube bottom at y −0.050 open is z −0.0076; the ramp
  there is −0.0116). It also tapers in width toward the knuckle (0.050 →
  0.040), which was the "triangular piece": the tray's front-left corner
  standing 2.5 mm proud of the tubes.
* **Bore plug from 27 mm.** `HOLLOW_DEPTH` — the plug now starts 12 mm behind
  the hinge, so the part of the chamber that dives is solid-in-solid and
  invisible. The model gate's hollowness ray now asserts `HOLLOW_DEPTH`, not
  `CHAMBER_DEPTH`; a capped mouth still fails at ~5 mm. (First cut of this
  had the plug poking 28 mm out of the muzzles — wrong length formula, caught
  in the three-quarter render.)
* **Matte bore.** The chamber's inner wall was chrome and mirrored the room,
  which read as angular junk inside the tube. `put(..., mat_inner='Bore')`
  gives the inner faces the matte near-black bore material (a second slot;
  the exporter splits it into `t004`/`t004_1` primitives, verified live).

13782 tris. Mouths after: `round3-mouths-clean.png`; model: `model-threequarter.png`.
