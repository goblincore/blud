# Motion polish task 4 — socketed shoulders, gaze follows travel, wounds ride the turn (2026-08-17)

Continuation of the timed-out task-4 run. The prior run had already landed
defect 3 (`67e46ea`, wounds) and defect 1 (`f2e9e77`, shoulders) plus most of
defect 2 (gaze) in the timeout auto-commit; this run reviewed that work
(kept it — see below), then finished the browser verification.

## The three fixes (all prior-run, reviewed and kept)

1. **Shoulders** (`f2e9e77`): the additive reach offsets contracted both arm
   segments ~30%, so the verlet length constraints levered the shoulder point
   off the chest (ball-to-surface gap up to +18 mm). Replaced with a ROTATION
   SPEC from `gait.ts` (per-side pitch + forearm droop) that `motion.ts`
   applies about the FINAL shoulder target — rest segment lengths preserved,
   constraints satisfiable without moving the shoulder.
2. **Gaze** (timeout auto-commit): `MOTION_TUNING.gazeFollow` (default 1)
   blends the head look-at between the wander target (0 = the owner's pinned
   "creepy" variant, exactly the old behaviour) and a look-ahead point
   `gazeAhead` (2 m) along the wander heading. Panel slider +
   `__sdfLab.setGazeFollow`.
3. **Wounds** (`67e46ea`): the wound frame came from `basisFromAxis(prim
   axis)` alone — world-axis-fixed for spheres and degenerate axes, so
   craters stayed viewer-fixed under the heading rotation. `worldHitToWound`
   / `woundWorldPos` now take the applied body yaw: the basis is built in the
   de-yawed body frame and rotated back out (oriented prims use their orient
   quat outright, which already carries the yaw).

## Live-behaviour finding: bodyYaw NEVER lags heading in wander

The damped-turn lead (`wander.heading` vs `bodyYaw`) is unobservable in live
wandering: `stepWander` slews heading at `turnRate` 1.7 rad/s and `bodyYaw`
closes any gap ≤ 1.7 rad/s × dt **fully** in the same frame
(`applied = dYaw when |dYaw| ≤ maxTurn`). Starting from a synced state the
gap stays bit-exact 0 — measured: 448 walking rAF samples, max |d| = 0.
The lead only exists when heading teleports (tests, respawn). So defect 2's
real fix is the look-ahead TARGET (heading direction) replacing the wander
target POINT (which sits off-axis during every direction change), not a
heading/bodyYaw split. Don't burn time trying to photograph a mid-turn lead
— catch a heading SLEW instead (`turned > 0.25 rad from window start`).

## Verification

- `npm test`: 90 files / 1125 tests green, incl. the new regressions:
  shoulder socket across 4 s of walking reach (motion.test), gaze converges
  to heading + pinned tuning holds (motion.test), wound-rotation 90°
  regression incl. spheres/degenerate axes/oriented prims (damage.test).
- `npx tsc --noEmit` clean.
- `scripts/probe-shoulder-socket.ts`: ball–chest surface gap stays NEGATIVE
  (embedded) through reach, wander on and off: [-0.031, -0.0015]; pre-fix
  was up to +0.018. Shoulder–elbow rest length holds to 5e-4.
- Browser (vite :5301, CDP :9223, `scripts/verify-motion-polish-4.mjs` —
  wounds stamped via `__sdfLab.stampWounds`, NOT synthetic clicks, per the
  phantom-click trap). Screenshots in `task-4/`:
  - `t4-reach-0..3` — walking reach frames (speed 0.3–1.15), shoulders
    socketed.
  - `t4-gaze-follow-slew` / `t4-gaze-pinned-slew` — A/B caught mid heading
    slew (>0.25 rad into a direction change, walking): follow looks along
    travel, pinned stays on the target point.
  - `t4-wounds-stamped` / `t4-wounds-rotated` — two blast wounds stamped at
    bodyYaw 1.06, then the body wandered ~134° to −2.88: the craters ride
    the flesh (both frames show wounds: 2, no re-stamp).
