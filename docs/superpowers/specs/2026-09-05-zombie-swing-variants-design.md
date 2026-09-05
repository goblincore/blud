# Zombie swing variants — the hook's arc, and an overhead

**Date:** 2026-09-05
**Status:** approved, awaiting implementation plan
**Page:** `sdf-game.html`
**Predecessor:** [2026-09-05-zombie-combat-choreography-design.md](2026-09-05-zombie-combat-choreography-design.md)

## Why

Owner, after playing the choreography build:

> "The zombie attack is okay but there should also be an overhead variant. The
> current one sweeps from front to side but it would be nice to have one that
> is more like an overhead swing or even a proper hook — the current animation
> resembles a swimmer's motion tbh."

That is an accurate read, and the cause is structural.

## The diagnosis

`attackPose` drives every offset from ONE signed scalar, `attackDrive(phase)`,
which runs 0 → −1 (wind-up) → +1 (strike) → 0. Every arm angle is therefore
`d × magnitude`, which forces pitch to be **negative at the wind-up and
positive at the strike** — the arm must swing from behind the body to in front
of it. There is no way to express "the arm is raised at BOTH ends", which is
what a hook is.

Compounding it:

* Pitch magnitude at the strike (0.55) is SMALLER than at the wind-up (0.85),
  so the arm is travelling *down* while it sweeps.
* Yaw dominates the motion (1.15 against 0.55).
* The off arm counter-swings at 0.28 of the swinging arm, in opposition.

Two arms moving in opposition through a near-horizontal plane is a front
crawl. This was never a tuning problem; the single-scalar drive cannot
represent either shape the owner wants.

## Architecture

One rewritten pure module and two small wiring changes. **`motion.ts` is not
touched**: `AttackPose.reach`'s shape is unchanged, so the world-up sweep built
in the predecessor carries both variants as-is, and its bit-identity pin is
untouched.

### 1. Split the body's drive from the arm's arc — `attack.ts`

`attackDrive` stays exactly as it is and keeps driving the BODY: root lunge,
wind-back, chest lean, head carry, shoulder twist. The back-then-forward weight
shift it expresses is correct for both variants.

The ARM gets its own curve, interpolating between explicit per-variant wind-up
and strike angles over a 0..1 progress through the same beats:

```ts
export type SwingVariant = 'hook' | 'overhead';

/** Arm progress through the beats: 0 at rest, 1 at the wind-up peak, then
 *  0 -> 1 again across the strike, held through contact, back to 0 in
 *  recovery. Unlike attackDrive this is UNSIGNED and paired with a `beat`
 *  saying which leg of the swing it belongs to, which is what lets an angle
 *  be positive at both ends. */
export function armArc(
  phase: number, variant: SwingVariant, tuning?: AttackTuning,
): { pitch: number; yaw: number };

export function attackPose(
  phase: number, side: 'L' | 'R', variant: SwingVariant, tuning?: AttackTuning,
): AttackPose;
```

Per-variant angles (radians; pitch positive = the existing "forward reach"
convention, yaw positive = cocked away from the body's centre line):

| | wind-up pitch | strike pitch | wind-up yaw | strike yaw |
|---|---|---|---|---|
| `hook` | +0.35 | **+0.95** | +0.85 | −0.90 |
| `overhead` | +1.35 | **−0.75** | +0.15 | −0.10 |

The hook's pitch **rises** into the strike rather than falling, so the arc
climbs and then drives across and down — an elbow-high hook. The overhead is
almost pure pitch across a 2.1 rad vertical traverse with yaw near zero, so it
reads as a chop past the head.

Both variants pass through zero at phase 0 and phase 1, so the pose still
enters and leaves the gait without a discontinuity.

### 2. The off arm stops counter-swinging

`offArmShare` drops 0.28 → 0.12, and the off arm holds a **raised guard**
(a constant positive pitch, scaled by the swing's progress so it fades in and
out) instead of mirroring the swinging arm's angles negated. Two arms moving in
opposition through a near-horizontal plane IS the swimming motion; this removes
half the read on its own, independently of the arc fix.

### 3. Variant selection — `brain.ts`, `game-actor.ts`

`Brain.side: 'L' | 'R'` becomes `Brain.swing: { side: 'L' | 'R'; variant: SwingVariant }`,
picked when a swing STARTS and held for its duration; `BrainOutput.attack`
carries `{ phase, side, variant }`.

`brain.ts` stays RNG-free. `BrainInput` gains `roll: number` — a 0..1 value the
actor supplies each frame from the RNG it already carries (`makeRng(seed)`),
consumed only at the frame a swing begins. Deterministic given its inputs, so
captures and tests reproduce exactly; unpredictable in play.

Arm side keeps alternating underneath the variant roll, so the pack shows four
distinct silhouettes rather than two.

Selection is a fair coin: `roll < 0.5 ? 'hook' : 'overhead'`. A weighting knob
is deliberately NOT added — there is no evidence yet that one should be rarer,
and `ATTACK_TUNING` is where it would go if the owner later wants one.

## Testing

* **The owner's complaint, pinned.** The hook's pitch travel between wind-up
  and strike must exceed `flatArcRatio` (0.6) of its yaw travel. A flat arc —
  the shipped behaviour — fails this test. This is the regression guard; it is
  the reason the fix cannot silently revert.
* The overhead's |yaw| stays under 0.25 rad at every phase while its pitch
  traverses more than 2 rad and goes negative at the strike.
* Both variants are exactly zero at phase 0 and phase 1, for both sides.
* `side: 'L'` and `side: 'R'` are exact mirrors in yaw for both variants.
* The off arm's |pitch| and |yaw| never exceed the swinging arm's at any phase.
* `armArc` is finite across a swept phase, including out-of-range phases, for
  both variants.
* **brain**: the variant is chosen at swing start from `roll`, does NOT change
  during the swing even as `roll` changes every frame, and both variants appear
  across a run of swings with a varying roll; `side` still alternates.

## Verification

A capture strip: each variant at five phases (rest, wind-up peak, mid-strike,
contact, recovery) from one fixed camera placed at the swinging body, so the
two arcs can be judged side by side by eye rather than from the numbers above.
The existing crowd gate's swing-in-flight frame and its "fail if the swing
already ended" guard are unchanged.

One added gate assertion: across the melee window, **both** variants are
observed. A variant that never fires is a selection bug that every unit test
above would pass.

Frames and notes land in `docs/dev-notes/2026-09-05-swing-variants/`, and
`TASKS.md` gets the row.
