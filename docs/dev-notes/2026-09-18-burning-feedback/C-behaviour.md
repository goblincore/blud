# C — Burning behaviour (Task 2, round 1)

Branch `dispatch/2026-09-18-burning-burn-behaviour`. Owner's call (2026-09-18):
a burning **soldier panics** (no shooting/aiming, flees the player on an erratic
heading, faster); a burning **zombie is mindless** (keeps chasing, faster,
heading jittering); **both stumble**. Neither brain learns a state — the actor
applies the panic as an override of its mind's verdict, the `doomed` pattern.

## What shipped

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/burn-behaviour.ts` | NEW. Pure, seeded `stepBurnPanic`: soldier flee target (swing off the away direction, re-picked every 1–2 s), zombie jittered chase target, shared stumble schedule 1.5–3 s. `BURN_BEHAVIOUR` frozen tuning table. |
| `src/lab/sdf-zombie/burn-behaviour.test.ts` | NEW. 4 tests (flee/no-fire, chase+jitter, stumble cadence, seed determinism). |
| `motion.ts` | `MotionSignals.cruiseScale?` (default 1) multiplies `travelCruise`. Absent ⇒ `x * 1`, byte-identical; the 191 motion/gait/stagger tests stay green. |
| `webgpu/game-actor.ts` | `setBurning(on)` + `burnStumbles()`; a per-substep override after the encounter block; stumble/flail pose signals via `signals.shot`. |
| `webgpu/game-burning.ts` | `step()` pushes only the `setBurning` **edge** (two reused swapped `Set`s, allocation-free); `retire()` releases it. |
| `scripts/burn-behaviour-trace.mjs` | NEW. In-game trace + 4-frame contact sheet. |
| `webgpu/game-main.ts` | Console seams only, one contiguous block: `igniteActor(id)` and `actorTrace()`. |

## Deviations from the plan (and why)

1. **The override runs AFTER the encounter-director block, not right after
   `doomed`.** In the game every actor is handed an `EncounterOrder` each frame;
   an idle actor's order is `halt: true`, and a combat soldier gets a
   `moveTarget`. Running the panic first meant that block nulled the flee/chase
   target on nearly every frame. The override is the last word on the target.
2. **The player comes from `encounterOrder.player` (+ `lastPlayerPos` cache),
   not `brainPlayer`.** `game-main` never calls `setBrainInput` anymore — the
   encounter director feeds the minds — so `brainPlayer` is always null in the
   game and the plan's literal snippet would have fled a fixed axis.
3. **The zombie's chase target is the mind's raw target, captured before the
   encounter block, with the last seen player point as fallback.** With the
   post-encounter `think.target`, a ring hold (`holdSecs > 0`) nulls the target
   and the burning zombie **froze at 3.8 m** (measured: `meanSpeed 0.013`,
   `distDelta 0.000`). The capture fixed it (measured: `meanSpeed 1.386`,
   `distDelta −1.036`).
4. **A soldier's stumble is `soldierLevel: 'medium'`, not `'small'`.** There is
   no `'light'` in `SoldierStaggerLevel` (`'small' | 'medium' | 'heavy'`), and
   `stepSoldierStagger` will not restart an equal-level reaction: the periodic
   flail already keeps a `'small'` soldier reaction alive, so a `'small'`
   stumble was silently dropped. `'medium'` ranks up and lands; `fullStagger` is
   false, so it is a lurch, **not** a knockdown.
5. **Arm flail = the plan's fallback.** `motion.ts` has no additive arm-pose
   channel, so the flail is a `burn` → `shudder` signal re-emitted on a timer
   (0.35 s zombies, 0.5 s soldiers — the soldier's `small` soldier reaction is
   0.42 s and must lapse before it can restart). This is a tremor + small
   arm-open, **not** an authored raised-arm wave; if a real arm channel lands
   later this should be replaced.
6. **`burnStumbles()` added to `ZombieActor`.** `staggerKind` cannot tell a burn
   stumble from a hit reaction (the flail also shows as a stagger), so the trace
   needs an unambiguous counter.

## Tests

```
npm test -- burn-behaviour motion gait stagger brain soldier-brain game-actor game-actor-soldier
  16 files passed; 2 failed (both the pre-existing game-actor-torso-slug
  failures, reproduced on the clean checkout — not this change)
  new: game-actor 32 tests, game-actor-soldier 55 tests, burn-behaviour 4 tests
npm test -- game-context-coverage        4 passed (no new main() state binding)
npx tsc --noEmit                         clean
```

Note: `burn-behaviour.test.ts` seed 7 yields 4 stumbles in 12 s, so the
"≥ floor(12 / stumbleMaxSec)" assertion holds.

## In-game trace — measured numbers

`node scripts/burn-behaviour-trace.mjs 5531 9531` (own vite + headless Chrome,
warm gate `ready`, flat-frame luma gate, renderer-pipeline-error guard).
Room 4, one spawned soldier + one spawned zombie, 1.5 s unburnt then 6 s burning.
Raw report: `burn-behaviour-trace.json`. 180 burning frames at 1/30 s.

| | soldier unburnt | soldier burning | zombie unburnt | zombie burning |
| --- | --- | --- | --- | --- |
| mean speed (m/s) | 0.000 | **2.972** | 0.816 | **1.386** |
| max speed (m/s) | 0.000 | 12.083 | 1.150 | 1.438 |
| dist to player head → tail (m) | 4.525 → 4.525 | 4.346 → **4.941** | 4.413 → 3.862 | 3.697 → **2.662** |
| distance trend | flat | **+0.595 m (flees)** | −0.552 m | **−1.036 m (closes)** |
| shots fired | 2 | **0** | — | — |
| burn stumbles | — | **2** | — | **2** |
| lurch / shudder frames | 0 / 0 | 46 / 24 | 0 / 0 | 48 / 128 |

* **Soldier flees, never fires.** Speed 0 → 2.97 m/s (it was standing and
  firing: mind states `engage/aim/fire`); zero firing frames across the 6 s burn;
  distance grows. The 12.08 m/s one-frame peak is the gait/footwork root snap
  after a stumble (`meanDistTail` is monotonic enough that it is a transient,
  not a trajectory).
* **Zombie closes, faster.** Speed 0.82 → 1.39 m/s (ratio 1.70 vs the unburnt
  approach; the pure multiplier is pinned at 1.25), distance −1.04 m, still in
  `pursue`/`encircle` — the ring hold no longer freezes it.
* **Both stumble 2× in 6 s** (the pure schedule is 1.5–3 s; 2 is the floor for
  a 6 s window).
* Visual: `burn-behaviour-contact-sheet.png` (unburnt → 2 s → 4 s → 6 s). The
  unburnt tile is an empty room; by 2 s a burning body is on the left with its
  ribs lit; 4 s and 6 s show fire at the wall body and the second burning figure
  mid-run across frame, i.e. the two opposing trajectories are visually
  distinct. Luma std stays 39–45 (not a flat frame).

## Limits / follow-ups

* The trace baseline is **1.5 s**, not the plan's 3 s: the zombie has only ~4.5 m
  of approach room before the melee ring stops it, and a 3 s baseline spent that
  room before ignition.
* The flail is the shudder stand-in (point 5), so the "arm flail" is a fast
  tremor plus a small soldier arm-open, not a raised wave.
* `burnStumbles` counts logic stumbles; a stumble's pose can still be partly
  masked by an in-flight hit reaction (a real hit signal wins the frame).
