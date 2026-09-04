# Zombie combat choreography — 2026-09-05

Spec: `docs/superpowers/specs/2026-09-05-zombie-combat-choreography-design.md`
Plan: `docs/superpowers/plans/2026-09-05-zombie-combat-choreography.md`

Owner's play-test of the 2026-09-04 build: arms clip when several zombies
surround you, and the two-arm slam is "merely… okay".

## What landed

* `melee-ring.ts` — at most two bodies may swing at once, and a second token
  needs 90° of clearance from the first. Angles are the claimants' CURRENT
  bearings, not fixed slots, which would orbit the ring as the player turns.
* `brain.ts` — seven named states (idle / pursue / encircle / engage / attack /
  recover / stagger) replacing three modes and three ad-hoc overrides. The
  blast hold moved in from `game-actor.ts`, so locomotion is gated in one place.
* `attack.ts` — the alternating one-arm hook. The swinging arm cocks back and
  out, then sweeps forward AND across; the off arm counter-swings; the lunge
  dropped 0.22 → 0.14 because the rotation carries the weight now.
* `motion.ts` — the reach pivot gained a world-up rotation, because a pitch
  about the body's right axis can only raise and lower an arm. The lab's
  bit-identity pin is unchanged and still passes.

## The arm-clipping arithmetic

Separation treats a body as a 0.35 m circle, so two engaged zombies settle
0.70 m apart and separation reports itself satisfied — but an arm reaches
~0.6 m, so at 0.70 m two facing bodies have half a metre of mutual arm
overlap. The circles never touch; the arms always do.

Two holders 90° apart at the 1.0 m melee radius are **1.41 m** apart, clear of
two 0.6 m reaches with 0.2 m to spare. At 75° it would be 1.22 m — clearing by
2 cm, which is not clearing. That is why `minSlotAngle` is 90° and not smaller,
and it is the knob to move if the pack ends up feeling too spread out.

## Frames

| file | what it shows |
|------|---------------|
| `melee-ring.png` | Four bodies around the player: two engaged at spaced bearings, two holding the outer ring. |
| `fpv-swing.png` | A one-arm hook mid-strike, captured in flight. |
| `room4-topdown-before.png` / `room4-topdown-after.png` | The convergence from a raised camera. |
| `room4-converged.png`, `room4-enter.png`, `room4-melee-ring.png` | Carried over from the 2026-09-04 gate. |

## The gate

`scripts/sdf-game-crowd-gate.mjs`, now nine checks. The three new ones:

* **Arm gap > 0** — closest surface gap between arm prims on different
  bodies: the owner's screenshot as a number. One deviation from the plan,
  found by Task 7 and kept: the `minHandGap()` ARITHMETIC (endpoint to
  endpoint minus both radii, a conservative under-estimate) is computed over
  RING-RELEVANT pairs — at least one body of the pair in an attack state —
  because `minHandGap()`'s all-bodies aperture went negative on every run for
  exactly one pair, z5+z6: two IDLE room-3 bodies parked shoulder to shoulder
  10+ m from the fight, whose hanging arms graze as soft separation settles
  idle neighbours near touch distance. A real graze, but not the claim this
  check exists to make; ring bodies stayed ≥ 0.18 m clear in the same samples.
* **Token cap** — never more than `RING_TUNING.tokens` bodies in an attack state.
* **Holder spacing** — any two token holders' bearings differ by ≥ `minSlotAngle`.

Measured on this machine:

| | worst arm gap | most engaged | tightest spread |
|---|---|---|---|
| ring wired | **1.971** m | **2** | **147.1°** |
| every body forced to hold a token | **0.036** m | **4** | **0.1°** → gate FAILS |

Both rows are from the real runs — a gate never shown to fail is not a gate.
This one was. The mutation forces a token on every body through `setRingInput`, which packs
four claimants onto the two-token ring: all four read as an attack state
(4 > cap 2, check 5b), nothing spreads their bearings (0.1°, floor 90°, 5c),
and the arm gap collapses from 1.971 m to 0.036 m (5a).

## Known limits, deliberate

* **Navigation is untouched.** The owner also reported getting stuck on
  furniture; that needs a nav grid over `levelColliders()` + `FURNITURE`, A*
  and path following, and is its own spec. The committed-sidestep router in
  `game-actor.ts` is exactly as it was.
* **No player damage.** Still choreography — no health, no HUD, no death.
* **Chasers stop at their room's doorway**, because `stepWander` clamps to room
  bounds. Cross-room pursuit falls out of the navigation work, not this.
* **A body does not re-aim mid-swing**: `halt` gates `stepWander`, so heading
  stops updating for the 0.7 s a swing lasts.
