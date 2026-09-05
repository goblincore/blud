# Zombie swing variants — 2026-09-05

Spec: `docs/superpowers/specs/2026-09-05-zombie-swing-variants-design.md`
Plan: `docs/superpowers/plans/2026-09-05-zombie-swing-variants.md`

Owner, on the choreography build: "the current one sweeps from front to side
… the current animation resembles a swimmer's motion tbh."

## The cause was structural

Every arm angle was `attackDrive(phase) × magnitude`, and `attackDrive` runs
0 → −1 → +1 → 0. That FORCES pitch negative at the wind-up and positive at the
strike: the arm must travel from behind the body to in front of it. A hook
needs the arm raised at both ends, which that cannot express. Add pitch
falling into the strike (0.85 → 0.55) while yaw swept 1.15 across, plus an off
arm counter-swinging in opposition, and it is a front crawl.

The body still rides `attackDrive` — its weight shift was never the problem.
The arm now rides `armArc`, interpolating between explicit per-variant angles.

| | wind-up pitch | strike pitch | wind-up yaw | strike yaw |
|---|---|---|---|---|
| hook | +0.35 | +0.95 (climbing) | −0.85 (out) | +0.90 (across) |
| overhead | +1.35 | −0.75 | −0.15 | +0.10 |

## Frames

`scripts/sdf-swing-strip.mjs` — both variants at five beats from ONE fixed
camera, so the arcs compare directly.

| file | what it shows |
|------|---------------|
| `hook-{rest,windup,midstrike,contact,recovery}.png` | The hook: cocked out and raised, then high and across. |
| `overhead-{rest,windup,midstrike,contact,recovery}.png` | The overhead: up past the head, then driven down. |

**What they actually show:** the subject is the dark body left of centre (the
camera is parked 1.6 m behind-left of it, because it locked on before the
camera teleported and does not re-aim mid-swing). In `hook-windup` its right
arm is cocked OUT and UP — elbow above the shoulder line, fist beside the head
on the outboard side; in `hook-contact` the same arm is extended HIGH and
ACROSS, the fist crossing above the head line to the body's far side, with
`hook-midstrike` passing through shoulder height in front and
`hook-recovery` folding back down. That is a hook. In `overhead-windup` the
arm is ramrod straight up, hand the highest point of the silhouette; in
`overhead-contact` it is driven all the way down in front, hand near hip
height, with `overhead-midstrike` through horizontal-forward (foreshortened
from behind — the hand just passes the body silhouette). The off arm holds a
forward chest-height guard through every swing frame and does not
counter-swing. One honest limitation of the pictures: the rig's arm is a
single shoulder-pivoted capsule, so "cocked" is the whole arm angled out-up —
there is no elbow flex to read; and `rest` is not perfectly neutral because
the subject's own stance leans while engaged.

## Two things the strip caught that the unit tests could not

**1. One step cannot pose a jump — the strip needs a settle loop.** The plan's
capture snippet forced a phase and shot ONE frame later. The rig is a spring
system: the forced config sets the TARGET, and one step moves the arm only
part of the way (measured, phase-hopping one frame at a time: overhead
wind-up target 1.35 rad read 0.44 and was still climbing; with the pin re-armed
every frame it converges by ~frame 5 and holds with ±0.07 rad of live stance
wiggle). The strip therefore re-arms the pin on every one of 10 settle frames
before shooting — and the settled pose still sits short of the table
(~75–80%: measured wind-up 1.01 vs 1.35; the shapes are right, damped). The
frames are evidence of arc SHAPE, not of the exact table radian values.

**2. The yaw table's sign was reasoned, never observed — the hook photographed
as a BACKHAND.** The first strip run showed the hook's fist ACROSS the chest
at the wind-up and flung OUT and up at contact — the mirror of the spec. The
numbers (arm-prim endpoints from `posed()`, live body yaw, settled pin):
wind-up yawRel −0.73, contact +0.93 — across → out, where the design says out
→ across. Root cause: `SWING_ARCS`' comment assumed a positive yaw cocked the
right arm OUT, but the reach pivot applies yaw as a world-up rotation, and a
POSITIVE rotation about up carries a forward-pointing arm toward the body's
LEFT. Fixed in this task, data-level: the table's yaw signs flipped (hook
−0.85/+0.90, overhead −0.15/+0.10) and the comment corrected to the measured
convention. Re-measured after: wind-up +0.84 (out) → midstrike +0.09 →
contact −0.78 (across), pitch climbing 0.04 → 0.63 — the arcs the frames now
show. The reach pivot's maths is untouched. This also retro-explains the
owner's "sweeps from front to side" on the OLD swing, which had the same sign
relationship (its +0.55 wind-up applied across-front, its −0.60 strike
applied out to the side).

## The regression guard

`ATTACK_TUNING.flatArcRatio` (0.6): a swing's pitch travel must exceed that
fraction of its yaw travel, pinned by a test in `attack.test.ts`. The shipped
flat swing fails it. That is what stops this quietly reverting to a swimmer.

The crowd gate additionally asserts BOTH variants fire across the melee
window — a variant that never appears is a selection bug every unit test
passes, because the roll is consumed on one frame per swing. Measured on this
run: `ring: both swing variants fired (hook, overhead)` alongside the existing
arm-gap 0.397 m / cap 2 / spread 114.9°.

## Known limits

* **No weighting knob.** Variant selection is a fair coin. If one should be
  rarer, `ATTACK_TUNING` is where that would go.
* **No damage.** Still choreography — no player health, no HUD, no death.
* **Settled poses undershoot the table** (~75–80%, see above). If a capture
  ever needs the exact radian values, it must settle longer and accept the
  spring's equilibrium, or the rig needs a way to snap.
