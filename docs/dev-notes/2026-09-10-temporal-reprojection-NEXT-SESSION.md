# Full temporal reprojection on held rows — NEXT SESSION (owner, 2026-09-10)

**Status: DEFERRED BY THE OWNER to the next session. Not started. Scope it before
writing code — see "What this actually requires" below, because the name makes it
sound smaller than it is.**

## Why it is on the table

The deeper interlace fields (h/3, h/4) were **rejected on look**: *"when it's still
it's not that bad but it's when moving the lines are just way too distracting at 3
and 4. 2 is fine."*

The history ring (`8e57c278`) fixed the STILL half — that was my build error, steps
1-2 shipping without step 3, so two of three held rows were interpolated instead of
read. What remains is the MOTION half: at h/3 a held row reads a REAL sample taken 2
frames ago, which is a stale image at a different camera position once you move, so
the weave interleaves three instants down the screen.

**Scope it as a general capability, not as "fix h/3".** If held rows can be
reprojected correctly under motion, that unlocks deep fields AND revisits the retired
half-rate C2 path — they fail for the same reason.

## The prerequisite already exists, and it is not sufficient

`sdf-layer.ts` `holdMode 2` is an existing **per-pixel reprojection** (added for C2):
it uses the depth the march already writes into the target's alpha, plus the retained
held camera VP, to answer "which texel of the held frame does this screen pixel
correspond to".

That model is **CAMERA-ONLY**. It assumes the held row is the SAME SCENE viewed from
an older camera — true for static level geometry, and FALSE for a body that has
moved. Reprojection therefore fixes the walls and does nothing for the bodies, and
the bodies are what the owner was looking at. This is also the recorded cause of
C2's retirement: *"half-rate held and reprojected the whole marched frame, which
desynced from full-rate polygons under camera motion"* — same failure, same cause.

## What this actually requires

1. **PER-VERTEX motion vectors, not a camera transform.** For deformable bodies you
   need to know where each vertex WAS. That means keeping the previous frame's
   skinned/posed vertex positions (or the previous bone transforms, and re-skinning
   into the held row's view). `bone-instancer.ts` already packs posed bone instances
   per frame, so the DATA is close to hand — the work is producing a motion field and
   consuming it in the composite.
2. **A motion-vector target** the composite can sample, per held row.
3. **Occlusion / disocclusion handling.** A reprojected sample can land on a surface
   that is not visible in the current view, or two rows can claim the same texel.
   Without a validity test this reads as smearing, which is a worse artifact than the
   comb.
4. **The depth problem the ring already flagged.** The history ring currently stores
   COLOUR only, so a deep field's held rows take depth from the most recent field.
   Reprojection needs the held row's OWN depth. **Add depth to the ring first** — it
   is a prerequisite, recorded at the seam in `sdf-layer.ts`.
5. **A decision about what "correct" means under motion.** Perfect reprojection of
   stale geometry still cannot invent detail that was never sampled. The realistic
   goal is "no tearing at the boundaries", not "indistinguishable from full rate" —
   so define the acceptance test before building it.

## Before writing code

- **Re-read the C2 retirement reasoning.** It failed on exactly this axis. Whatever
  killed it will kill this unless the motion-vector piece genuinely lands, so start
  by reading what was measured then, not by re-deriving it.
- **Order the work as: ring depth -> motion vectors -> validity test -> composite
  consumption.** Each step is independently checkable.
- **The frame hash is the regression gate** (`__sdfGame.frameHash()`): a held-row
  change must show up as a STABLE difference across repeats within one boot. Do not
  compare across boots — two boots disagree at h/2 for unrelated reasons (the
  two-state branch).
- **Acceptance is the owner's eyes, in MOTION.** A still-frame comparison cannot see
  this defect. That is the whole point of the exercise.

## Do not

- Do not "fix" it by loosening `fieldComb`. That trades the comb for blur — it is the
  knob that already exists, it is already measured, and it does not address staleness.
- Do not assume the camera-only reprojection in `holdMode 2` will mostly work. It was
  measured to fail on this exact axis, and the bodies are the visible subject.
- Do not ship a deeper field behind a look decision that has already been answered:
  h/3 and h/4 at a UNIFORM divisor are rejected. This work exists to make a
  reprojected version viable, not to re-open the rejected one.
