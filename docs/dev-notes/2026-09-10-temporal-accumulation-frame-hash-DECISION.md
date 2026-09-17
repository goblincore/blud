# DECISION — the frame hash under temporal accumulation (owner-delegated, 2026-09-10)

**Question, decided here because it constrains the design more than it looks:**
when the temporal accumulation lands (see the FINAL VERDICT section of
[2026-09-10-temporal-reprojection-NEXT-SESSION.md](2026-09-10-temporal-reprojection-NEXT-SESSION.md)),
does the frame hash stay a gate over ALL layers, or only over the frame
PRE-accumulation?

**Decision: over all of them — but the accumulator must be resettable and
epoch-labelled, and the gate becomes a SEQUENCE comparison from a known epoch.**
Nothing about the hash's layer set gets dropped; one field is added to the
envelope; one hard requirement lands on the accumulator.

---

## 1. Keep every layer, and ADD the accumulated output. Do not drop it.

`frameHash()` currently reports keyed layers — `marchTarget` (the march output),
`probeDyn` (the gather's dynamic layer), `instances` (the gather's packed inputs)
— each with a digest, per-tile digests for localisation, and bounded activity
`stats`.

The precedent for keeping the downstream layer is the repo's own: the presented
frame hash was added because *"everything downstream of the march … is invisible
to the former"*. Accumulation is downstream of the march, and it is exactly where
the new failure modes live: **ghosting** (history that never lets go),
**divergent history** (an error that persists instead of lasting one frame), a
**stale reprojection**, NaN propagating through a resize, and the disocclusion
path. A gate that stops at `marchTarget` would be blind to all of them — the same
blindness that let the black-silhouette and tracer-light bugs reach the owner's
eyes.

So: pre-accumulation layers stay exactly as they are (they are the *inputs*, and
their comparability is untouched by any history), and the accumulated result
becomes an additional keyed layer. **Bump `FRAME_HASH_VERSION`** — the constant
exists so a stored recording cannot be silently compared against a differently
shaped instrument, and this changes the layer set.

## 2. The actual requirement is a RESETTABLE, EPOCH-LABELLED accumulator

This is the load-bearing part, and it is not a hash change — it is a constraint on
the accumulator, to be designed in from the start:

> **With an IIR history, "frame k" is not a comparison point.** The same scene
> state, the same camera and the same step count produce a different frame
> depending on how much history preceded them. Every existing cross-run
> comparison the repo relies on becomes meaningless without a known history
> length.

Therefore the accumulator must expose:

- **`resetHistory()`** — clears the accumulation to a defined state (and is what
  a resize/teleport/boot-transition must call, not hope about).
- **An epoch**: an increasing counter of resets, and `framesSinceEpoch`.

...and the **gate is restated as**: *from a fresh epoch, the same step sequence
produces the same sequence of hashes.* That is testable, it is comparable across
runs, and it is self-documenting. Single-frame comparison from an unknown history
is not a gate and must not be used as one.

`FrameHash` gains `epoch` and `framesSinceEpoch` in its envelope, so a stored
recording carries the history it was taken from and cannot be compared against one
taken from a different one. That is the same spirit as `version`: make the
instrument's shape part of the record.

## 3. The jitter must be a function of frames-since-epoch, and `demoHold` must NOT freeze it

⚠ **This deliberately contradicts an existing precedent, so it is written down.**
The gather pins its ray-set rotation for recordings (`frameSeed: demoHold ? 0 :
(probeFrame % 64) / 64`) precisely so a recording is not at the mercy of a moving
sample pattern. **Do not do that here.** A frozen jitter stops the accumulation
from ever covering a pixel's sub-positions, i.e. it freezes convergence and turns
the scheme back into what it replaced.

The resolution is to make the jitter **deterministic and progressing**: a pure
function of `framesSinceEpoch` (a Halton/low-discrepancy sequence indexed from the
epoch, not from wall time and not from `Math.random`). Then a replay reproduces
the exact sequence, and the sequence still advances. If someone later "fixes" a
jitter-related recording mismatch by pinning the jitter to a constant, they will
have silently removed the feature.

## 4. A one-frame divergence no longer stays one frame — so gates compare windows

Accumulation blends the new sample in at rate α, so a single-frame difference
decays geometrically and leaves a residue for roughly `1/(1-α)` frames. Two
consequences:

- **Compare sequences, not single frames.** The gate is a window of hashes over
  the warm-up and a settled stretch, which is also what makes ghosting measurable:
  ghosting *is* a residue that fails to decay.
- **The existing reader controls must keep passing bit-for-bit**: `demoScenario`'s
  `repeat` (re-hash the same frame, no step between) and `resample` (same position,
  nothing in between) exist to separate "the frame changed" from "the readback
  lied". Accumulation does not touch them — nothing advances unless a frame is
  stepped — so if they ever fail, the accumulator is advancing when it should not.

## 5. Four things to carry into the implementation

- **A convergence stat, in the spirit of the existing `stats`.** Those counters
  turn "the hash differs" into "the layer is ZERO", which is what made the
  black-silhouette bug diagnosable. The accumulation analogue is an
  **unconverged-energy** figure (mean |accumulated − this frame's raw sample|, or
  the per-tile version of it): it turns "the hash differs" into "the history has
  not settled", which is a different verdict and must not read as one.
- **The recorder contract.** A `.dem`/demo scenario must record its epoch start
  and its warm-up length, or a replay begins from a different history and drifts
  by construction. The hash's `epoch`/`framesSinceEpoch` fields are what make that
  checkable rather than assumed.
- **Resize, teleport and boot transitions reset it.** The history is in
  screen space, so anything that reallocates or moves the camera discontinuously
  must reset the epoch rather than reproject garbage for N frames.
- **"Within one boot" gets MORE important, and there is a payoff.** The two-state
  branch (an unexplained boot-level render-state difference) would now bake into
  the history and decay instead of being confined to one frame, so cross-boot
  comparison of the accumulated layer stays invalid — and matters more. If that
  branch is ever fixed, cross-boot comparisons of the accumulated layer become
  possible, which is a concrete new reason to keep chasing it.

## 6. What this does NOT decide

Whether the accumulation ships, what α and the warm-up length are, whether the
low-res march is `sdfScale`-based or a new target, and whether object motion
vectors are mandatory before any look verdict. Those are the cheap-first
experiment's outputs (see the FINAL VERDICT note), and this decision is written so
that whichever way they go, the gate is already specified.
