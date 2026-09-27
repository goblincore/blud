# Shared light list, Task 10: bodies and crowds lit by their own 4 lights

Plan 1, Task 10 (2026-09-27). With `lightlist` on by default, every SDF body and crowd member is lit
by the 4 lights it picks from the shared list. `?lightlist=0` gives the old key path
(`applyWindowKey` / `presentingLamp`).

![off | on](contact-sheet-off-on.png)

The contact sheet has one row per scene: a body under a third-class tube, a held bolt
(`holdWindowLight(32, -1)`), the flashlight on a crowd member under the next tube, and the dark coat
check (lamps killed, no picks). The left column is `?lightlist=0` and the right is the list. Each
column is a fresh boot with the clocks pinned and the train stopped. `scripts/sdf-game-light-gate.mjs` section 7 renders
it. Set `LIGHT_GATE_SHOT=<dir>` to keep the frames, or `LIGHT_GATE_ONLY_LIST=1` to run that section
alone.

## The first cut blew the bodies out; the calibration fixed it

The list's rgb is physical: colour × three.js intensity × level gain. That is tube spot 16-17.6,
window 32 while held, flashlight 90. The first cut multiplied that by the pick weight and the old
presentation gain (1.3), so keyI came out near 19 under a tube. The old key was about 2. The result
was flat white bodies under a tube, a bolt and the flashlight.

The rgb stays physical because plan 2 feeds the same list to level materials. Two things convert
it to the body key the old path gave:

- **`bodyNorm`**, packed in light v3.z, is 1 / the light's reference intensity (`refIntensity`):
  - For a tube, base × `TUBE_SPOT_GAIN` 7.
  - For a point lamp, its base.
  - For the flashlight, its base of 90.
  - For everything else, 1.

  Per light, `intensity × bodyNorm` is the lamp's live level. That is the old key's level term, so
  flicker and blackouts still ride it. A single per-kind constant could not do this, because lamp
  bases differ (a 4.9 tube in the tender).
- **Each profile's GPU `gain`** (lane a.x) is the old path's conversion. Its derivation is written
  next to the number in `light-profiles.ts`, and the old constants are pinned equal to their homes
  by `game-light-list-leaves.test.ts`.

`bodyLights` (WGSL) and `shadeBodyLights` (CPU twin) compute `c = rgb × weight × gain × bodyNorm`.
The WGSL change is one line; the march golden moved on purpose, and only `__HELPERS_joined`
changed.

| profile | gain | derivation |
|---|---|---|
| tube | 3.276 | lightCfg.x 2.4 × BODY_LAMP_GAIN 1.5 × PRESENT.gain 1.3 × LAMP_LIST_TRIM 0.7, bodyNorm 1/(base × 7) |
| lamp | 2.772 | 2.4 × 1.5 × 1.1 (the lamp's own presentation gain) × 0.7 (tube-measured trim; no warm lamp measured), bodyNorm 1/base |
| window | 0.1092 | 2.4 × BODY_WINDOW_GAIN 0.035 × WINDOW_LIST_TRIM 1.3, on the raw intensity (bodyNorm 1) |
| flashlight | 11.2 | beam gain (spotCfg2.x) 4 × FLASHLIGHT_LIST_TRIM 2.8, bodyNorm 1/90 |
| muzzle | 0.0387 | bodyFlashGain 0.06: old I·0.06/d², list I·g/(1+0.2d²), equal at 1.5 m (not measured) |
| fire | 0.0327 | the same, with fire's distFall 0.1 (not measured) |

**The trims are measured, not derived.** The old key was one lamp. The list adds up to three more
lights, each light's backRim, the wrap floor and the highlight shoulder. The shoulder compresses, so
the mean moves slowly with gain. Body-box mean against today's at the gate pose, by trim:

- **Tube:**
  - 0.45 gives 0.90×.
  - 0.6 gives 0.99×, with the std 4% under today's.
  - 0.7 gives 1.01-1.04×, with the std at or above today's.
- **Flashlight** (the old beam replaced the key direction with a frontal lambert; the list's
  flashlight is one wrapped light of four):
  - 2.4 gives 0.99×.
  - 2.8 gives 1.00×.
- **Window** (held bolt):
  - 1.0 gives 0.96×.
  - 1.3 gives 0.99×.

This is a baseline that reproduces today's brightness. The owner tunes the look from here.

## A/B, body box (0.38-0.62 × 0.2-0.8 of the frame), final constants, full gate run

| scene | on mean / std / near-black | off mean / std / near-black | on/off mean |
|---|---|---|---|
| tube | 0.350 / 0.306 / 0.8% | 0.337 / 0.296 / 0.8% | 1.04× |
| bolt | 0.376 / 0.335 / 0.0% | 0.381 / 0.345 / 0.0% | 0.99× |
| flashlight | 0.595 / 0.356 / 1.8% | 0.596 / 0.366 / 2.0% | 1.00× |
| dark coat check (no picks) | 0.051 / 0.052 / 60.0% | 0.053 / 0.057 / 58.6% | — |

The std is at or above today's under a tube. It is 2.6-2.9% under today's for the bolt and the
flashlight, which is within run-to-run noise (about 0.01).

**The gate** requires the tube, bolt and flashlight means to be within 0.9×..1.2× of
`?lightlist=0`. It also requires the near-black share to be ≤ 15% in those three scenes, and the
dark scene to stay within today's value + 5 points.

**Determinism.** Each boot pins the scene before the A/B:

- The train is stopped (`setTrainSpeed(0)`), so the tubes hang still. The old key's direction
  follows the tube's swing: frozen mid-swing with the tube behind the body, today's tube mean fell
  to 0.16 against 0.34 at rest. The list stayed at about 0.24-0.35 there, which is the point of
  the list.
- The A/B body stands 0.6 m past its tube as the camera sees it, so the pool presents its front.
- The coat check's `die` script is stepped to its end, so the dark scene has no picks. The gate
  checks this.
- The flicker clock is pinned only when the third-class tubes are at full level.
- The clock is re-pinned after the torch ramps on.

## How the list looks against today (by eye)

At this pose today's path is itself a bright, pale body, and the list now matches it.

- **Tube.** Close to today. The list is a little smoother, with a soft sheen on the shoulders and
  chest. The limbs, chest and head still read as modelled. It is not flat and not black.
- **Bolt.** Close to today. The list is slightly softer, and the cold rim reads on the edges.
- **Flashlight.** Both are very pale on the torso. The list keeps a little more pink relief there
  and lights the face, where today leaves the face and scalp darker. The crowd member behind is lit
  differently from the one in front: each has its own picks.
- **Dark coat check.** Essentially identical: a dark body carried by the blue fresnel rim and the
  red eyes. There is no flat black. There is no visible (0,1,0) highlight from the empty slot 0.
- **No NaN speckles** in any frame.

**For the owner.** "Match today" means matching today's pale look at a front-lit pose. The first
uncalibrated cut was flat white, and that is gone.

## Deviations from the task text (approved by the coordinator)

- **`applyRoomFill` is kept in list mode.** It is the fill, not the key. It makes blackouts go
  dark, and BODY_DARK_FLOOR is the floor for bodies no light picks.
- **`applyStormBodyKey` is kept at spawn.** It sets keyColor to COLD_FILL on storm levels, and the
  watch items say to keep keyColor as the fill colour. `releaseWindowKey` hands back a key that the
  old path steered, for the live `setLightList` switch.

## Watch items (Task 9 review)

- **keyColor stays the fill colour.** It is COLD_FILL on Night Train and is never steered in list
  mode.
- **`lightListCfg.x = 1`** is set on every crowd type's uniforms and on single views. It is not set
  on chunks or hands (Task 12).
- **`spotCfg2.w` and `bodyFlash.w` are 0** in list mode. `spotCfg` and `levelShadowCfg` are left
  alone (shader-gated).
- **Never black in a dark corridor.** The body box is 60.5% near-black with no picks, against
  57.3% today. The rim and the room fill (BODY_DARK_FLOOR) carry it, the same as today.
- **Flat-lit face against the body in a dark carriage.** The face is no brighter or flatter than the
  body there. Lit, the face reads better than today under the flashlight.
- **Shine and fresnel on a dim dominant.** keyC is normalised to peak 1, so the wet shine and the
  fresnel do not dim with the key. This is the likely source of the smoother sheen under a tube. It
  is a look item for the owner.

## Cost (indicative only: the machine was loaded, load average 10-70)

Rounds interleave on and off via `__sdfGame.setLightList`, with 8 rounds of `timeDraws(9)` and the
`passTimings` march passes. There were two runs, minutes apart:

| scene | run 1 frame off→on | run 1 march GPU off→on | run 2 frame | run 2 march GPU |
|---|---|---|---|---|
| third class, refine off | 31.8 → 34.0 | 7.30 → 10.70 | 32.0 → 31.7 | 6.06 → 6.65 |
| Boiler Room, refine off | 34.2 → 35.3 | 14.81 → 12.60 (inverted) | 27.0 → 28.0 | 10.57 → 12.18 |
| third class, `?refine=1` | 63.0 → 64.1 | 8.69 → 8.86 | 50.4 → 50.6 | 7.65 → 8.20 |
| Boiler Room, `?refine=1` | 67.2 → 68.9 | 14.72 → 12.24 (inverted) | 55.6 → 55.3 | 11.11 → 12.97 |

Run 1 disagrees with itself: +3.4 ms in third class, and inverted in the Boiler Room. Run 2 is
steadier: march GPU +0.6 ms in third class and **+1.6 / +1.9 ms in the Boiler Room**. That is over
the 1.5 ms flag, but the Boiler Room strobes and the machine was busy. Task 13 needs the real
measurement on a quiet machine.

`?refine=1` puts the game on the per-body path (the crowd path falls back), so its rows measure the
refine twin's list loop at output resolution.
