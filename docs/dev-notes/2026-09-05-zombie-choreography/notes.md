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

Measured on this machine, room-4 pairs (the pack around the player):

| | worst arm gap | most engaged | tightest spread |
|---|---|---|---|
| shipped | **0.435** m | **2** | **114.9°** |
| waiters back on the 0.35 m walking circle | **-0.020** m → gate FAILS | 2 | 147.5° |

## Three defects found by verifying the dispatch output, and fixed

The eight dispatch tasks all exited 0 and the gate passed. Verifying it by hand
found three things anyway, all of the same shape: **the measure did not cover
the case that was broken.**

**1. The ring's arm-gap measure excluded the waiters.** The gate narrowed
`minHandGap()`'s all-bodies aperture to bodies in `engage`/`attack`/`recover`
— correctly, because the global number was being set by two IDLE bodies parked
in room 3, ten metres from the fight. But the narrowed set left out
`encircle`, and a room-4 all-states probe measured **-0.051 m between bodies 7
and 10, with 7 encircling**. Waiters stand in the same pack the owner
photographed. `encircle` is now in the set, and a waiter is submitted to
separation at the engaged radius like everyone else.

**2. `ENGAGED_RADIUS` never cleared two arm reaches.** It was 0.55 — two such
circles settle 1.10 m apart, and two ~0.6 m arms need 1.20 m. The 90° ring
spacing was computed from the arm reach; this number was picked as "wider than
0.35" and never checked against it. Now 0.70 → 1.40 m, the same 0.2 m of
margin the ring spacing was given.

**3. `meleeRadius` then sat inside the separation equilibrium.** With the
radius at 0.70 and the player an immobile 0.32 m anchor, separation parks an
engaged body 1.02 m from him — outside the old 1.0 m melee radius, so
`dist <= meleeRadius` never held and a body stood in `engage` for ten seconds
without swinging (zombie 10, caught by the same probe). `meleeRadius` is 1.25,
which clears 1.02 with margin and widens the holder spacing from 1.41 m to
1.77 m as a side effect.

The gate's window was also 3 s of sampling straight after the settle, which
lands in the approach rather than the melee; it is 12 s now, and refuses to
report at all if it never saw a body in `attack`.

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
* **Idle wanderers in other rooms still clip.** The global `minHandGap()` goes
  negative for bodies 4/5/6 idling in room 3: they separate at the base 0.35 m
  walking circle, which is 0.70 m apart against a 1.2 m arm span. Fixing it
  means raising `ZOMBIE_RADIUS` toward 0.6, which spreads EVERY crowd
  permanently — a feel decision for the owner, not a bug fix, so it is
  reported by the gate and not gated.
* **A stuck token-holder halves the pressure.** In every probe, one body
  (zombie 9) held a token while pinned at 2.85 m by furniture and never
  closed, so the nominal two attackers were really one. That is the navigation
  problem the owner reported, and it will not go away until the nav spec is
  built; a possible cheaper mitigation is revoking a token from a holder that
  has not closed in N seconds.
