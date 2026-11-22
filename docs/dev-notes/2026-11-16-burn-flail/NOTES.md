# Burn flail and burn death: build notes (2026-11-16)

[Spec](../../superpowers/specs/2026-11-16-burn-flail-and-death-design.md) ·
[plan](../../superpowers/plans/2026-11-16-burn-flail-and-death.md). Branch
`claude/burning-body-effect-optimization-4795c0`.

## What was built

A lit body stops attacking, runs from the player on a wandering heading with an authored arm flail, falters
over the last quarter of its clock, then dies on one of three authored burn falls and the fire burns down on
the corpse. How long it lasts, how hard it flails, whether fire kills it and whether it takes a burn fall are
per character (`MotionProfile.burn`, `BurnTier`).

| file | what |
| --- | --- |
| `motion-profile.ts` | `BurnTier` (`panicSec`, `speed`, `flail`, `dies`, `fall`), the tier values |
| `burn-behaviour.ts` | the seeded burn clock: panic, falter, done; the flee heading; the blocked turn |
| `burn-flail.ts` | new: the flail pose and a two-bone elbow solve |
| `death-fall.ts` | `burnKneel`, `burnTopple`, `burnHeap`, `pickBurnFall` |
| `motion.ts` | `cfg.burnFlail` (arms, trunk, head), `cfg.authoredDeath` |
| `webgpu/game-actor.ts` | the wiring, `burnPhase()`, stuck detection and the walkable-direction probe |
| `webgpu/game-burning.ts` | starts the burn-down once on a burn death |
| `webgpu/game-loop.ts` | a panicking zombie does not bite |
| `scripts/burn-behaviour-trace.mjs` | follows the new behaviour; 8 s burn, per-frame samples |

## What was verified, and how

- `npm run typecheck` clean; `npm run test:changed` 31 files, 468 tests pass.
- Headless trace (`node scripts/burn-behaviour-trace.mjs 5541 9541 docs/dev-notes/2026-11-16-burn-flail`,
  the real page and renderer, room4, one soldier and one zombie lit): passes, no console errors. Numbers in
  `burn-behaviour-trace.json`:

| | panic frames (30 Hz) | mean speed while panicking | shots | panic then dead |
| --- | ---: | ---: | ---: | --- |
| soldier | 81 (2.7 s) | 1.01 m/s | 0 | yes |
| zombie | 154 (5.1 s) | 1.18 m/s | 0 | yes |

**Not verified: the look.** Nobody has watched it. The trace's contact sheet is framed on the room, not the
bodies: it shows a raised burning arm at the frame edge and a burning body on the floor at 6 s, and is not
evidence that the flail or the falls read well. The fall key angles, the flail constants and the tier
numbers are first values. No GPU timing was taken; this change adds no shader work.

## Found by the trace and the review, and fixed

The unit tests passed before any of these were found.

1. **A burner fled straight into a wall and ran on the spot** (zombie: 0.18 m/s for its whole panic). Now a
   body that makes no ground for 0.3 s turns 90 to 112 degrees off the away direction and holds the turn.
   The turn probes for a direction it can stand in (`burnClear`: end point and midpoint clear of furniture
   and standable to the level's navigation). Blocked again, it takes the other side. With nothing clear it
   runs on its own wander legs for a second.
2. **The shambler's slow turn kept it walking into the wall for 1.5 s** after it had picked a good
   direction: the level's navigation rejects a blocked step outright, with no slide. A blocked burner now
   whips round to the new heading.
3. **About 40 % of zombie burn deaths also rolled the ragdoll slump**, which zeroed the authored fall's pull
   while `fallKind` still named a burn fall (review B1). A burn fall no longer rolls the slump or the
   blow-away. Pinned across seeds on both sides of the roll.
4. **The burn clock kept running on a body shot dead mid-panic** and gave the corpse a second death (review
   B2). The panic now ends when the body is down or dying by any other cause. Such a corpse keeps burning as
   it did before this feature. A soldier downed but alive also stops panicking.
5. **The flail popped on the frame falter began** (up to 0.25 arm lengths). The fold's cap now blends in.
6. **A burned corpse could not be re-lit** (it was killed again on the next step). The burn-down kill runs
   once per death. Untested: `game-burning.ts` has no test harness.
7. **The gorehound's rig reuses the humanoid joint names**, so it passed `canDeathFall` and would have
   played a biped burn fall. `BurnTier.fall` (off for the beasts) gives it its ordinary death.

## Changed from the plan's first values

- Hand-wave rates in `burn-flail.ts`: (2.3, 3.7), (2.9, 4.3), (2.1, 3.3) Hz to (2.0, 3.2), (2.5, 3.7),
  (1.9, 2.9): the originals moved a hand 0.16 arm lengths a frame against a 0.15 bound.
- `burnHeap` last key `topple` 0.95 to 1.2: under 1.0 the pose code keeps the legs bearing the body and the
  pelvis ended 0.61 m up. At 1.2 the body may lie nearly flat instead of reading as sat down into itself.

## Open

- **Owner look, in the arena** (`npm run dev:arena`, `__sdfGame.igniteAll()`): zombie, soldier, a heavy
  (ogre), the gorehound, and a crowd for repetition. Things to look for: the soldier's gun keeps its carry
  orientation in his fist while he flails and his left hand leaves the fore-grip; `burnHeap`'s end pose; the
  whip-round on a blocked turn.
- The flayer inherits the butcher's tier (panics, does not die). Not in the spec's table.
- A soft target (the cultist) that burns to death drops on the plain forced collapse, not his soft-death
  plan and not a burn fall.
- A panicking body is still an active combatant to the encounter director, so it can hold a ring token or a
  fire lane it will not use.
- Re-igniting the same body replays the same clock and wobble (the seed is the id).
- The fire's render cost: separate spec, not started. The 2026-09-22 census has fire adding about 7 ms to
  `sdf:march` against about 2 ms of `post:fire-march`, cause unattributed.
