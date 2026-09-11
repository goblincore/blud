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

---

# SCOPED — 2026-09-10, session 2 (before any code)

Owner: *"i think we can start on the reprojection project experiment i think
worth a shot."* This section is the result of reading the code and the history
FIRST, as this file demanded. It changes the shape of the work.

## ⚠ THREE TEMPORAL MECHANISMS ALREADY EXIST. Do not rebuild any of them.

| mechanism | state | where |
| --- | --- | --- |
| **Temporal START for the march** — start the ray from last frame's hit depth, reprojected with the frame's own inverse VP, minus a motion margin + slope, folded by `max` with the cone/hull/depth-prepass bounds | **SHIPPED, owner-passed** ("looks good, ship it"), `?tstart=0` disables | `temporal-start.ts`, plan `docs/superpowers/plans/2026-09-10-temporal-march-start.md` |
| **C2 half-rate + per-pixel reprojection** of the whole marched frame | built, VERIFIED, retired to a toggle | `sdf-layer.ts` `holdMode 2`, note `2026-08-31-temporal-c2-spike/notes.md` |
| **Interlaced fields + 3-slot history ring** | SHIPPED at h/2; h/3 and h/4 rejected on look | `sdf-layer.ts` `COMPOSITE_WGSL` field branch, `sdfFieldInterleave` |

**Temporal start's own numbers, because they answer a question this session was
asked separately** ("do you have thoughts about optimizing the ray march step"):
room 4, per-pass p50, before the own-body gate 17.4 → 7.3 ms; with the gate
14.9 → 11.3 ms (walk 11.0 → 7.0, fire 14.9 → 11.3, gib 18.0 → 13.8 — the on-run
had fewer bodies, so read it as ~25–35%). At the shipped config: gib 7.83 → 7.21
(−8%), fire −5%, walk ~0. **The cheap, high-value temporal lever is already
banked.** Its hard-won lessons are worth keeping: the first playtest showed other
bodies' silhouettes cutting into flesh, fixed with an own-body gate plus a
one-sample inside check; the margin ships at 0.25 m because 0.15 glitched in play
even though a static bisect cleared it; and the adaptive margin machinery is
PARKED with floor == cap.

## So what is actually left

Exactly one thing, and it is the thing this file was written about: **the held
rows of a deeper interlace are stale samples with no reprojection.** At nf ≥ 3 the
composite's held-row branch (`COMPOSITE_WGSL`, the `else` at the `outRow % nf`
test) reads a real sample taken 1–3 frames ago and composites it at the SAME
screen position — so under camera motion it is an image from an older camera, and
the weave interleaves instants down the screen. That is the owner's
"when moving the lines are just way too distracting at 3 and 4".

### The gap, precisely, with the sites

1. **A held row HAS its own depth in the composite path** — the ring textures are
   `rgba32f` and the branch already reads `held.w`, with a sibling rule that depth
   is never interpolated. ✔ nothing to add there.
   ✗ But `sdfFieldInterleave` (the WHOLE-FRAME interleave) still takes depth from
   slot 0: *"the retained ring stores COLOUR only, so a held row takes its depth
   from the most recent field"* (`sdf-layer.ts` ~449-452). That is this brief's
   prerequisite, and it is where the ring must grow a depth channel.
2. **There is ONE `heldInv`, and the ring holds THREE fields from three different
   frames.** Reprojecting a held row needs the inverse VP of the frame THAT ROW
   WAS SAMPLED FROM — so the ring needs a per-slot camera, rotated alongside the
   slots (`sdf-layer.ts` ~1529 rotates the textures; the matrices must rotate with
   them). The `lastTex`/`invVp` pair (~899-911) is the precedent for retaining an
   inverse VP per marched frame.
3. **The reprojection maths is already written and does NOT need inventing** —
   `COMPOSITE_WGSL`'s `holdMode > 1.5` branch does exactly this (unproject the held
   pixel's own depth through `heldInv`, project with `curVp`, resample, republish
   the reprojected depth as `outDepth`). It is unreachable in field mode because
   the field branch RETURNS first. The change is to give the field branch the same
   treatment, with the slot's own camera.
4. **Body motion is NOT fixable this way, and the scope must say so.** Camera
   reprojection cancels camera lag (C2 measured that: raw hold best-aligned at
   dx = +21 px, reproject at dx = 0) but knows nothing about a body that moved.
   The gait judder ("each pose HELDS for a frame then jumps two gait-steps") is
   motion-vector work, i.e. items 1-3 of the original brief below.

## The first experiment, and its acceptance test

**Reproject the held row at nf = 3 using (a) its own depth and (b) a per-slot held
camera, then measure the residual lag.** Staged as:

1. Rotate a per-slot inverse-VP with the ring (host: three matrices, three
   uniforms; shader: pick by slot).
2. In the field branch's held path, replace the direct `textureLoad` with the
   reprojected fetch (`heldInv[slot]` → world → `curVp` → resample the ring), and
   republish that reprojected depth.
3. Keep `fieldComb` semantics: 1 = held content as before, and the reprojection
   must be an identity when the camera has not moved (a same-frame A/B gate: with
   a frozen camera the frame hash must be UNCHANGED).

**The acceptance number is C2's own methodology, not a taste call:** a scripted
lateral camera sweep past a frozen body, comparing the held-row content against a
full-rate reference at the same instant, scanning the shift that minimises the
difference. C2 measured a raw hold's best alignment at **dx = +21 px** (6 m/s at 2
m) and the reprojection at **dx = 0**. The reprojected held row at nf = 3 must
reach dx ≈ 0; if it does not, the mechanism is wrong and no look pass is worth
running. **Only after that number lands does the owner's eyes-in-motion verdict
decide the look** — a still cannot see this defect, which is why the rejected
h/3/h/4 decision cannot be re-litigated from a screenshot.

**Regression gate:** `__sdfGame.frameHash()`, compared WITHIN one boot across
repeats (`demoScenario`'s `repeated`), never across boots.
