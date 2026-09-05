# Zombie crowd separation + chase/attack brain — 2026-09-04

Spec: `docs/superpowers/specs/2026-09-04-zombie-crowd-and-brain-design.md`
Plan: `docs/superpowers/plans/2026-09-04-zombie-crowd-and-brain.md`

Owner's two reports, one session: bodies clipped and overlapped constantly,
and nothing in the level cared where the player was.

## What landed

Three pure modules — `crowd.ts` (soft ground-plane circle separation),
`brain.ts` (notice / chase / swing), `attack.ts` (the swing pose) — one
optional `MotionConfig.attack` field that leaves the lab bit-identical, and
wiring in `game-actor.ts` / `game-main.ts`. Built by a seven-task dispatch
chain on `zai/glm-5.3-flash:high`.

## Two defects the spec had, found end-to-end by the gate

Both were real design errors in the spec, not implementation slips, and both
were invisible to unit tests — they only appear when the whole loop runs.

**1. A chaser aiming at the standoff point could never engage.** The spec had
the brain emit a target `attackRange` (1.0 m) out from the player, on the
theory that arriving there = arriving at melee. But `stepWander`'s
`arriveRadius` is 0.4 m, so a body stops ~1.4 m from the player — *outside*
`attackRange`. Zombies would walk up, stall in a ring, and never swing. Fixed
in `game-actor.ts`: the walk goal is the PLAYER, and the engage latch halts the
walk on the way in. The standoff point survives only as the brain's own
geometry.

**2. The furniture rejection deadlocks a chaser.** The old rule — land inside
a fattened furniture box, restore the position and drop the target — is the
right unstick for a *wanderer*, which then picks a new random leg. A chaser
re-aims at the player every sub-step, so it was rejected, restored and re-aimed
into the same crate forever. Fixed with two measures in `game-actor.ts`
(`segmentCrossesBox` / `pushOutOfFurniture` / `firstBlockingBox` / `avoidPoint`
/ `pickAvoidSide`, all exported and unit-tested): the rejection now pushes out
along the shallowest axis so the tangential part of the step survives and the
body SLIDES along the face, and a blocked chase line aims at a way-point pushed
to one COMMITTED side so the body arcs around the blocker. The side is chosen
once per blocked episode — re-picking every sub-step flips it and jitters.

`brain.ts` stayed pure geometry through both fixes; obstacle knowledge lives in
`game-actor.ts` next to the furniture AABBs that were already there.

## Frames

| file | what it shows |
|------|---------------|
| `room4-enter.png` | Room 4 as the player steps in: four bodies, pre-convergence. |
| `room4-topdown-before.png` / `room4-topdown-after.png` | The same convergence from a raised camera — the footprint view, where stacking would be unmistakable. |
| `room4-converged.png` | Two simulated seconds later: the pack has closed and fanned, not stacked. |
| `fpv-swing.png` | Zombie 7 at ~1 m, mid-swing (`swingT` 0.262), with the body behind it clearly separate. |
| `room4-melee-ring.png` | The settled melee ring, 3.3 s after the first swing. |

**The swing frame was itself a defect once.** The gate originally took it after
the ring-settle loop, from the doorway — by then the swing was over and the
picture showed a zombie standing several metres down a tunnel. The assertion
(`brains()` state) was right and the frame was of something else. The gate now
places the camera 1.6 m from the swinging body, takes the frame on the next
step, and FAILS if `mode`/`swingT` say the swing had already finished — the
picture has to show what the caption claims.

## The gate

`scripts/sdf-game-crowd-gate.mjs` — the convergence metric, the alert count in
the player's room, a swing captured in flight, a separation probe, and a
negative control (everything goes calm once the player leaves the room).

Run it:

    LAB_VITE_PORT=5291 LAB_CDP_PORT=9291 bash -c '. scripts/lab-servers.sh; \
      trap lab_servers_down EXIT; lab_servers_up; \
      GAME_OUT=docs/dev-notes/2026-09-04-zombie-crowd \
      node scripts/sdf-game-crowd-gate.mjs "$LAB_VITE_PORT" "$LAB_CDP_PORT"'

**Why there is a probe.** The natural scenario cannot fail on its own, which
took a while to establish. The worst pairwise distance stays above the floor
even with the nudge disconnected, for two reasons that have nothing to do with
separation: the engage halt alone parks chasers a ring-radius apart (0.526 m
measured nudge-off), and `stepPlayer`'s capsule resolves the player out of any
body he stands in. Zombie-vs-zombie is the nudge's exclusive domain, so the
probe teleports one alert zombie ONTO another through the `zombieNudge` seam
(the same clamp path the real nudge takes) and measures where the pair settles.

Measured, both ways, on this machine:

| | worst pairwise | probe pair |
|---|---|---|
| nudge wired | **0.679 m** | **0.700 m** (exactly touching) |
| nudge commented out | 0.526 m | **0.437 m** → gate FAILS |

A gate never shown to fail is not a gate. This one was.

## Known limits, deliberate

* **Zombies do not follow through tunnels.** `stepWander` clamps each body to
  its own room's bounds; a chaser stops at the doorway. Cross-room pursuit is a
  pathfinding task, not a tuning change.
* **The swing does no damage.** The owner's call for this round: approach and
  swing rhythm first, what a hit costs later. No player health, no HUD, no
  death.
* **A body does not re-aim mid-swing.** `halt` gates `stepWander`, so the
  heading stops updating for the 0.7 s a swing lasts; a player who strafes hard
  during a committed swing will not be tracked. Same trade-off that makes the
  swing read as weighty.
* **Only 2 of room 4's 4 zombies were alert** in the gate run — the other two
  were facing away and out of the cone when the player entered, which is the
  aggro rule working as specified, not a bug. It does mean the "swarm" is a
  trickle at first; if the owner wants more pressure the knob is
  `BRAIN_TUNING.noticeCone`.
