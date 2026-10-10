# Ending plan 3: the sequence system (2026-09-30)

Plan: `docs/superpowers/plans/2026-09-30-night-train-sequence-system.md`. Touching the egg now starts a
scripted sequence instead of the instant "LEVEL COMPLETE". This plan built the system and a two-shot stub;
plan 4 fills in the montage.

## What was built

- `e17c97e5` pure timeline: `ending-sequence.ts` (shots, drift camera, flash/black overlay, the ending stub).
- `f13d5a88` the `sequence.<id>` level command.
- `39ebe68f` the level: touching the egg fires `egg.touch -> sequence.ending`; the level completes on `ending.end`.
- `c05f1b2e` the runtime: `game-sequence-leaves.ts` (clock on the sim step, DOM overlay, camera override, input
  and damage freeze, end event).
- `8352a944` fix found while looking: the spike flail viewmodel and the free-aim reticle stayed on screen during
  the pull (the leaf only hid the shotgun group); `game-flail.ts` `updateRig` and the reticle in `game-main.ts`
  now hide while a sequence has started.
- This commit: loop-gate section 5 rewritten to walk the sequence; these notes; the task board.

## Gate

`scripts/sdf-game-loop-gate.mjs` section 5 (stepped at 1/60, the gate boots `frozen`, but note `tick()` still
runs on the live loop between evaluates, so the clock can run a few frames ahead; the checks leave 0.4 s of margin):

```
ok   ending: egg touch -> pull (lens narrows, camera moves) -> black + title -> level complete; input and damage frozen
PASS sdf-game-loop-gate
```

Step counts: 3 steps starts it (the first step fires the trigger), +120 = 2.05 s in (u 0.51, halfway through the
4 s pull), +150 = 4.55 s (in the 2 s black shot), +130 = 6.7 s (past the 6 s end), +3 more completes the level.
The plan's "camera moved" check was vacuous (`eye[2] < -132.5 || ...` is true at the start eye); it now compares
the eye at 0.05 s against the eye at 2.05 s (moves 0.12 m).

Also run and passing: train gate, egg check, disco check; vitest (ending-sequence, level-events,
level-json.night-train, game-state-world: 34 tests); `tsc` with only the known `pack-golden.test.ts` error.

## The four frames (headless Chrome, 800 x 600, god, frozen; sequence time exact via the sim step)

- `seq-pull-0.png` (t 0.1 s, u 0.025): the egg already fills the middle of the frame, a warm beige milky ovoid
  with a pale cyan oval highlight (the inner egg) lower left, CRT monitors (green, yellow, teal) in rows left and
  right, red vein-like beams of light crossing the frame. No flail, no chain; the big reticle is gone, a 4 px
  white centre dot remains (`sdf-game.html` static element).
- `seq-pull-2.png` (t 2.0 s, u 0.5): the lens has narrowed (fovDelta -12.5): the egg is bigger, its edge near
  the frame sides, the monitors pushed to the edges, the inner oval's highlight larger. No visible camera jump.
- `seq-pull-4.png` (t 3.9 s, u 0.975, fovDelta -25): the view is inside the egg's soft shape: a grey-beige
  polygonal inner mass with a visible faceted outline, the pale cyan highlight at the left, monitors only at
  the far edges. It reads as dim and slightly low-poly at this zoom (the facets are visible).
- `seq-black.png` (t 4.5 s): pure black, `NIGHT TRAIN` centred in cream monospace, letter-spaced. No debug
  panels; only the Record [F8] button (bottom left, a dev panel) sits over it.

During the pull the dev panels (VHS TUNING, WOUND TUNING, LIGHT LAYERS), the top status line and the bottom
debug line are visible; they cover the top of the frame but not the title (the black overlay, z 44, sits over
them for the title shot, except the Record button). The loop HUD (health) and the "LEVEL COMPLETE" overlay
do not appear.

## Open items

- Two shots only (pull, black + title); the montage is plan 4.
- The camera cannot yet enter the egg: `eggShade` has no inside-the-shell case; plan 4's "inside" shot needs one.
  At u 0.975 the stub already looks at the inner shape from 1.3 m and it shows faceting.
- Enemies are not frozen during the sequence (only input and damage).
- The train sway is overridden by the sequence camera.
- The title is a DOM overlay (a stand-in); no sound.
- A 4 px centre dot (`sdf-game.html`) and the dev panels/Record button are not hidden by the sequence.
- Other weapon viewmodels (shotgun group is hidden; dynamite, launcher, flare rigs are not) are not hidden
  explicitly; hiding `aimRig` would also switch off the torch (`flashLight` is its child).
- `tick()` runs on the live loop even in `frozen` mode, so captures should step right after `setPose` (no sleep
  between them) or the sequence clock runs ahead in real time.
