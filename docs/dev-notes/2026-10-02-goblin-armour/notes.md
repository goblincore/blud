# Goblin armour (phase 2) — working notes

## Task 2: painted pants and shirt (2026-10-02)

- `color=` paint on the new body keeps the body grain's mottle: the pants read as worn cloth, not flat plastic, with
  no renderer change needed. The first hexes (4a4d50 / 383c3f) rendered near-black under the lab's key; the renderer
  darkens low sRGB values, so the shipped values are 7a7e82 (pants) and 585c60 (shirt).
- Painted prims: pelvis bar + gut blob, thigh and shin bars (pants); spine1 and chest bars + 6 spine beads (shirt).
  The ankle knob and feet stay flesh under the boot.
- Removed from the kit: fauld, cleaver, buckler (cleaver/buckler retired by the refinement spec).
- The old boots and greaves are still the pre-phase-2 pieces, replaced in Task 3.
- Frames: `task2-front.png`, `task2-three-quarter.png`.

## Task 3: boots, cuff, knee plate (2026-10-02)

- Boot shaft hugs the shin 6.4-7.9 mm off the flesh over its whole height; the gaiter cuff stands 10.6-14.1 mm off
  (flares over the boot top). Pinned in `goblin-kit.test.ts`.
- **Flesh feet removed** from `goblin.blob` (commented, with the restore lines). In the walk pose the flesh foot swung
  out from under the sole (`BLOB_POSE=walk`); the soldier made the same call on 2026-09-05. The foot bone stays.
  Re-pinned on purpose: `pack.test.ts` goblin prof array (4 fewer prof-0 entries, nothing else) and the
  `pack-golden` snapshot (paint + feet).
- Knee plate is a chain loft across thigh..shin (skinned with blended weights at the joint) and followed the bend in
  the walk frames.
- **Known failing until Task 5:** `silhouette.test.ts` "says kit when the outline there is clothing". It asserted that
  the old fat boots stood proud of the flesh outline; the new kit hugs the flesh by design. The pauldrons will
  protrude again, so re-check it after Task 5 and re-aim the test at the shoulder band if needed.
- Frame: `task3-walk.png` (the walk gait is still the zombie shamble: arms out is phase 4's problem, not the kit's).

## Task 4: utility belt (2026-10-02)

- Belt on the hips bone only (a loft spanning the hips->spine1 bend folded: WAM warned "doubles back"), y 0.669-0.705 m,
  ending on the pants/shirt paint seam. Brass buckle, two front-corner pouches (mirrored), one back pouch.
- **Measure trap, recorded in measure.md:** at belt height the whole body is 0.209 m wide (thigh tops), the torso cluster
  alone 0.162 m. The first belt used the torso number and had side vertices 12 mm inside the thighs; the pin now measures
  against the whole body. Same trap as the soldier kit's header warns about for arms.
- The old breastplate's bottom rings were trimmed so the belt is visible; the piece is replaced in Task 5.
- Frames: `task4-front.png`, `task4-back.png`.

## Task 5: pauldrons, lame, chest yoke (2026-10-02)

- Pad = bulbous dome shell around the r 0.0405 shoulder round (R 0.066 after the owner's "slightly oversized"), a lame
  band overlapping under it, and a short yoke on the chest bone. The old full-length breastplate (a metal tube from belt
  to collar) is gone: it was what read as a metal shirt.
- **Owner feedback, mid-task: "reads as a tight fit, like a small t-shirt, I want it slightly oversized, XL".** The
  first fit was flesh x1.10-1.18. Now the yoke is x1.20 wide at the hem (capped by the hanging upper arm: inner edge
  x 0.0915 at y 0.878), x1.28-1.36 wide higher (hidden under the pads), x1.38 DEEP, hem at the bottom of the chest
  bone; the pad R 0.060 -> 0.066. Pinned loose: farthest standoff 35.3 mm (was 23.9 tight).
- First yoke pass (x1.10) had a scalloped lower edge and hairlines: the body grain's surface noise (1-2 mm) z-fights with
  plate that close. Keep >= ~8 mm clear at facet midpoints.
- Tuck bound re-derived 0.045 -> 0.036 (deepest vertex is the pad's inner rim, 31.3 mm).
- `silhouette.test.ts` "kit band" re-aimed at 12 bands (the hugging kit is no longer >15 mm outside the flesh outline at
  any of 6 sample rows).
- Frames: `task5-three-quarter.png`, `task5-side.png`.

## Owner additions during Task 5 (2026-10-02)

- **Dirty wife-beater undershirt.** The shirt paint is now off-white, two-toned (chest e9e7dd, belly cfcab8, spine beads
  bab5a2). A first cream (ddd3b4) rendered as TAN SKIN under the lab's warm key, so the source is kept neutral and the
  light does the yellowing. Dirt is tone only: paint is one colour per prim.
- **Pauldron spikes, left pad only** (owner "one or both"): three spikes (one tall, two flankers) as WAM sweeps snapped to
  the pad with `on=pauldron.l`, material `plate` (iron's steel under its own name, so the plate-fit pin does not have to
  cover the tips). First pass was r 0.011 with up=35 per segment and read as thin flat blades; chunkier + 55/40 degree
  bends fixed it. To mirror them: move the three sweeps into the `mirror` block and use `on=pauldron`.
- **Round-lens sunglasses with ear hooks.** Two 16-sided lenses (56 mm, 8 mm thick) at x +/-0.045, y 1.229, z 0.122
  (clears the nose bridge z 0.113 by 9 mm), a 23 mm bridge, and temple arms: `dir=back yaw=-16` so they run out and around the
  head (half-width 0.075-0.086 behind the cheek), then a 65 degree rise to the ear base and a small hook. WAM sweeps take
  no explicit `dir=(x,y,z)` (that is bones only). Frame material `black` (LOOK already had it); the watch strap keeps
  `band`, which the test pins to the left wrist.
- Frames: `shades-front.png`, `shades-spikes-side.png`.

## Collar, bandoliers (2026-10-02)

- **Collar and neck-line** (owner: "extended up to the neck, like a collar"). The yoke now reaches the neck base and a
  flared stand-up collar tops out at neck t0.5 (y 1.052, the jaw starts ~t0.8). Four rounds of render findings, all in
  the `.wam` comments: (1) tapering the top rings in let the painted shirt poke through as white patches (flesh is still
  0.1124 x 0.131 at the chest top); (2) a `cap end=flat` closing the top put a vertex 52.8 mm inside the neck, caught by
  the fit test, and was removed; (3) a probe of iron-front-z vs flesh-front-z gave only 6-15 mm of cover at the front
  centre, so the upper front was deepened to stand ~35 mm off like the hem; (4) the yoke rides the chest bone and the
  collar the neck bone, 26 degrees apart in the kit skeleton, so equal end rings still left a wedge gap at the front:
  the collar is now a free ray starting 29 mm below the neck base, overlapping inside the yoke.
- **Bandoliers built, then removed** (owner: "its too busy"). Two crossed leather straps with 26 brass cartridges read
  clearly as an X but crowded the chest. The generated lines are kept in `bandoliers-removed.wam.txt`. The strap path:
  P0 (+/-0.060, 0.980, 0.150) -> P1 (-/+0.006, 0.840, 0.161, over the yoke hem) -> P2 (-/+0.072, 0.705, 0.122), the second
  strap 5 mm further forward where they cross; each half a straight loft aimed with `dir=down tilt= pitch=`.
