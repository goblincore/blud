# Boiler Room emergency beacons — dev note (2026-09-27)

[Spec](../../superpowers/specs/2026-09-27-boiler-room-beacons-design.md) ·
[plan](../../superpowers/plans/2026-09-27-boiler-room-beacons.md) ·
sheet: [`beacons-sweep.png`](beacons-sweep.png)

## What shipped

When the Boiler Room's strobe kills its lamps, two red ceiling beacons (z −94 and −104, room 5)
stutter on and sweep the carriage for good.

- **Pure** (`beacon.ts`): `beaconAxis` / `beaconAxisInto` (35° below horizontal, `spin` rev/s,
  sign = direction), `beaconPhase(i, n)` (a room's beacons start evenly spread: the two start at 0
  and π), `beaconShadowLive` (refresh policy), `scriptFor` (the strobe arms a beacon as
  `emergency`; once armed it ignores die / blackout / strobe), lamp kinds (a beacon is neither the
  room's lamp glass nor its fill), `beaconSpotIntensity`.
- **Level**: `fixture: 'beacon'` + `spin` in level JSON. `spin` on anything else is an error; a beacon
  with no `spin` gets `BEACON.spin` (0.7 rev/s). The two beacons hang at **y 2.95**, under the
  carriage's centre pipe (see Deviations).
- **Runtime** (`game-dynamic-light-leaves.ts` `makeBeacon`): a spot (512² hard shadow, autoUpdate off,
  castShadow decided at boot, `onlyRooms` = the Boiler Room), a beam cone in the late scene, a
  glowing dome on a stalk to the ceiling, all in the authored light colour. The lamp's own omni stays
  at 0 and is list-only (`userData.listOnly`: no level material or deferred practical lists it).
- **Shared list**: the swept spot is a `beacon`-profile source (red back rim), room 5 only.
- **Shadow policy**: re-rendered every sim step while lit and while the Boiler Room is in the
  player's near set (their room plus tunnel-joined rooms, `nearRoomMask`) — so the floor seen through
  the door from the vestibule never shows a shadow frozen at an old angle.
- **Seams**: `lights().beacons[]` (room, level, script, spot intensity, axis, shadowFrames),
  `lights().glassInfo[]`, and the measurement-only `setBeaconsOn(on)` (a script override: `emergency`
  already past its stutter, or none → the `dead` mood; never `.visible`).

## Proof

- Unit: `beacon.test.ts` (axis, phase, shadow policy, arming incl. armed-stays-on), `level-json`
  (beacon spin default, spin-on-non-beacon error), `level-json.night-train` (2 beacons in room 5,
  below the centre pipe), `light-pick` / `light-profiles` (the profile).
- Light gate section **6b BEACONS** (`LIGHT_GATE_ONLY_BEACONS=1` alone): fresh boot with the cast,
  light clock frozen and set by hand. Dark before the threshold and through the strobe (no shadow
  renders while dark); level 1 from t+4.0 s; axis turns 45° in 0.18 s; +6 shadow renders per beacon
  over 6 steps; the dancer placed 3.6 m past beacon 0 picks a `beacon`-profile light.

## Cost (gate section 10, `LIGHT_GATE_ONLY_COST=1`, Apple GPU, 800×600 headless)

Measured at 1-min load 3.62 (enforced run). Frame = fenced median of 9 frames × 8 interleaved rounds.

| Scene | A/B | frame median off → on | Δ frame | Δ GPU span |
| --- | --- | --- | --- | --- |
| Third class | list off/on | 16.75 → 16.60 | −0.15 ms | −0.11 ms |
| Boiler Room (strobe peak, beacons forced on) | list off/on | 18.65 → 18.70 | +0.05 ms | −0.06 ms |
| Boiler Room after the strobe (list on) | beacons off/on | 19.65 → 20.40 | **+0.75 ms** (rounds +0.20..+1.50) | **+1.12 ms** (rounds +0.60..+1.59) |

The beacon A/B frames are sim step + draw (the shadow re-render is requested per step, so a bare
`drawOnce` would miss it): 144 beacon shadow renders over 72 "on" frames, i.e. both maps every
frame. The two 512² shadow passes are inside the +1.5 ms budget at the median; single rounds reach
+1.5 (frame) / +1.6 (GPU). Shadows kept (spec §4: report, never drop).

Second sample, the full gate run (load 3.11, enforced): list on−off third class −0.05 ms, Boiler
Room +0.25 ms (GPU +0.18); **beacons on−off +0.70 ms frame (rounds +0.50..+0.90), +0.78 ms GPU
(rounds +0.32..+1.19)**, 144 shadow renders over 72 frames. Per-pass attribution is by completion
order, so the shadow passes land under the `sdf:polys` label (+4.3) with `sdf:shell-hull` −3.1: read
the span, not the labels.

## march-hash

No re-pin needed: all three canonicals held, 3/3 boots each, on this tree
(default `e2ce8904…`, quad `7386cd6b…`, per-body `094176e6…`; wounded `06eaee1b…` /
`5773171f…` / `0e1331a0…`). The gate stages a room-1 close-up at light time 0: the beacons live in
room 5 (their spot is `onlyRooms` 5, their list records are room-5 only), their omni is at 0 (and
now list-only), and the beam and housing are out of view. The level change does not reach room 1.

## The sheet (`beacons-sweep.png`) — honest read

Top 2×2: the Boiler Room from the south door after the strobe, light clock pinned, a quarter turn
apart (t+4.00 / 4.36 / 4.71 / 5.07 s). Bottom row: close, beam 0 crossing the dancers
(−0.12 s / on / +0.12 s).

- **Housing** reads: a glowing dome on a stalk, top centre. It reads salmon-pink rather than deep
  red (the emissive saturates through the tone map).
- **Red cone** reads well side-on (quarter-turn frames: across the carriage to the right, then the
  left wall and a bay pillar lit red). Pointing away (frame 1) it is a hot apex plus a red floor
  pool; pointing at the camera (frame 3) the whole frame goes red haze.
- **Bodies**: a dancer in the beam goes flat saturated red — its shading is lost (blown). Out of the
  beam, bodies keep a red rim / red tint in every frame (their beacon picks stay, at low weight).
- **Floor**: lit red where the cone lands; the bay pillar's shadow wedge swings across it in the
  close row.
- **Not reading**: a dancer's own swinging shadow on the floor or wall is not clearly readable in
  any frame taken. Beacon 1 (z −104) is mostly hidden behind beacon 0 / the pillar from the south
  door.

## Deviations and findings

- **The housing was invisible**: at y 3.3 the beacon (dome 3.18–3.30) sat INSIDE the carriage's
  centre pipe (`build_train_kit.py` `ceiling_bay`: r 0.13 at h − 0.2, i.e. 3.07–3.33) — the dome
  never showed and the beam's apex was buried. Moved to y 2.95 (layout + level JSON), with a stalk
  up into the pipe; a level test now keeps beacons below `h − 0.33`.
- **Phase**: the hashed phases once landed ~13° apart; now `beaconPhase` (0 and π). With the two
  spins opposite (±0.7), the beams are mirror images about the carriage centreline at all times:
  both point the same way along the train, and they are exactly parallel twice a turn (when
  pointing straight down the carriage). The start phase only picks where they cross.
- **Review fixes folded in** (1a5428bc): shadow refresh by the near-room mask (I1), armed beacons
  stay on (I2), no per-step axis allocation (M1), authored colour for beam and housing (M3), housing
  comment (M4), stalk (M5), level-json spin rules (M6), list-only omni (M7).
- **Known gap (M2)**: under `?lightlist=0` (the diagnostic old key), `presentingLamp` treats a lit
  beacon as a full-cover omni: a steady red key, no sweep. Not fixed (diagnostic fallback only).
- The gate section boots its own page (not section 7's), so it runs under `LIGHT_GATE_ONLY_BEACONS`
  alone and does not disturb the list scenes.
