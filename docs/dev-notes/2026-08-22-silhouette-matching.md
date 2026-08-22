# Scoring a character's outline against its reference plate

2026-08-22. Built because the mouse failed owner review after a pass that hit
every number it was given.

## The gap it fills

`validateBody` and the `fused`/`clear` checks in `blob-checks.ts` prove a body
is closed, connected and non-interpenetrating. They cannot tell you it reads
as the character, and the authoring skill says so outright.

The mouse is the worked example. Its proportion pass optimised local
measurements — ring widths, ankle clearance, "the shoe must reach the floor" —
and produced a narrow snout, a nose the reference has not got, ears well under
size, and both shoes fused into a single pod. **Every one of those is in the
outline**, and invisible to a check that measures one primitive at a time.

## How it works

`scripts/silhouette-match.ts` builds the `.blob` through the same compile path
the lab uses, sphere-traces an orthographic silhouette off `sdBody`, unions in
the kit's triangles, keys the reference PNG to a mask, normalises both to their
own subject bounding box, and compares.

Normalising to the subject box is what makes the score about **proportion**:
size and position in frame cannot move it.

```bash
npx tsx scripts/silhouette-match.ts mouse
npx tsx scripts/silhouette-match.ts mouse --range 0.8:1 --bands 32
```

## Three things that would have made it lie

**1. It was scoring a bare body against a dressed plate.** A `.blob` is flesh;
a plate shows the character wearing its kit. Every band where clothes add bulk
read as "too narrow" and blamed the sculpt. On the mouse's shoe band:

| | of body height |
|---|---|
| flesh only | 0.132 |
| with kit | 0.204 |
| reference | 0.345 |

Both say too narrow, but the flesh-only reading would have driven a rebuild
that thickened the body to compensate for clothes it could not see. The kit's
triangles are now unioned into the same raster and into the bounds that frame
it.

**2. The two ASCII figures were at different vertical scales.** `renderMask`
picked its row count from each mask's own aspect, so rows stopped
corresponding while still looking like a comparison. It made the mouse's
newly-splayed shoes appear absent from a figure whose shoe band measured 0.346
against the plate's 0.345.

**3. Alpha is not the key.** Every plate in `docs/dev-notes/refs/` is RGBA with
alpha 255 everywhere — the white is painted, not transparent. Keying on alpha
gives a mask of the whole rectangle and a score of "the character is a square".

## The headline number is not a grade

Measured the day it landed, whole figure, before any of the mouse rework:

| | IoU | mean width error |
|---|---|---|
| mouse — **rejected** by the owner | 0.709 | 0.074 |
| clown — **approved** by the owner | 0.640 | 0.095 |

The approved character scores worse. Two reasons, and the second matters more:

- **Pose.** Plates pose their arms; a `.blob` rasterises in its authored rest
  pose. Use `--range` to score a window where the poses agree.
- **Intent.** The owner on the clown: fine with how it turned out *"despite not
  matching the reference"*, where the mouse *"is a different case"*. Matching
  the plate is a per-character decision — a plate is sometimes a brief and
  sometimes a mood. **A low score is a question, never a verdict.**

Do not wire this to a pass/fail gate across characters. It would have said keep
the mouse and throw away the clown.

## What it is good for

- The side-by-side picture.
- Per-band deltas inside a pose-agreeing window.
- Before/after on **one** character against **one** plate, where pose is
  constant and a change in the numbers is real signal.

## What it caught, and what it cannot see

Driving the mouse rework, whole figure against the front plate:

| | IoU | mean width error |
|---|---|---|
| as merged to main | 0.660 | 0.060 |
| after head rebuild | 0.705 | 0.048 |
| after shoe splay | 0.749 | 0.028 |

Two defects in the same rework were **structurally invisible** to it and came
straight off the render:

- The muzzle was 31% wider than tall — a horizontal blade that read as a flat
  flap. The front silhouette only measures width, and the width was right.
- The shades are aimed off the skull bone, so rebuilding the head moved the
  face out from under them and they rendered as a wire across it. The kit does
  not follow the face.

That is the rule the module header states and this note exists to repeat: a
good score is necessary, not sufficient. Keep opening the render.
