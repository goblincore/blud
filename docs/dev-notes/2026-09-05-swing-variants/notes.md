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

**Shot in ROOM 1, not room 4.** The first strip photographed the room-4 pack:
the subject ended up in shadow at the frame edge while unrelated bodies
wandered through the middle, and the ten frames could not be compared because
their composition changed between captures. Room 1 has exactly one zombie, and
the camera sits 1.15 m out so the body fills the frame.

**What they actually show, having looked at them:**

* `overhead-windup.png` — the right arm is cocked high above and behind the
  head, elbow up, with the off arm out front at chest height as a guard. This
  is unambiguously an overhead.
* `overhead-contact.png` — the arm has come all the way down past the body.
  Up-then-down reads clearly across the two frames; the silhouette is
  completely distinct from the hook's.
* `hook-contact.png` — arm high and folded across the chest. This is a hook
  landing, and it is not a swimmer.
* `hook-windup.png` — **the weakest of the four.** The arm reads as extended
  nearly straight out to the side, more "reaching sideways" than "cocked to
  throw". Wind-up pitch 0.35 against yaw 0.85 puts it out and only slightly
  raised. Raising `SWING_ARCS.hook.windupPitch` toward ~0.7 and easing
  `windupYaw` to ~0.6 would tuck it in; the elbow bend that would really sell
  the cock comes from the gait's `reach.drop`, not from `attack.ts`, so a
  proper fix may need an attack-time elbow override. Left for the owner to
  judge — it is a tuning constant, and the arc's SHAPE is correct.

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
