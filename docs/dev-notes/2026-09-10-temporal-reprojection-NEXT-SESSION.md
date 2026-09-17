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

---

# RESULT of the pre-test — IT IS CAMERA MOTION, BY ~15x

Rig: `scripts/sdf-fields-motion-probe.{mjs,sh}`. Owner's own framing of the test:
*"i could of course freeze them and move around them to see the camera movement
side. if it looks good then we can then figure out the motion vector side of it."*
That is exactly what this measures. `?frozen=1` (the subject does not move at all),
`stageCloseUp` puts a body at **0.7 m** filling the frame (extreme parallax on
purpose — the worst case), and h/2 is A/B'd against h/3 **at a matched pose in one
boot** via the live `setFieldCount`.

| case | mean \|Δ\| (8-bit levels) | pixels changed by >2 levels |
| --- | ---: | ---: |
| **still camera** | **0.80** | 25,591 / 480,000 (5.3%) |
| **strafe 0.25 m** | **12.06** | 334,501 / 480,000 (69.7%) |

**15x more difference, and 13x more visibly-changed pixels, the moment the camera
moves — with the subject frozen.** That is the held rows carrying a sample from an
OLDER CAMERA, which is precisely the component a reprojected held row removes. The
still column is also the useful control: at a still camera h/3 is nearly
indistinguishable from h/2 (0.8 levels), i.e. **the reconstruction is not the
problem — the staleness is.** That matches the owner's report ("when it's still
it's not that bad but it's when moving the lines are just way too distracting at 3
and 4") and now it is a number.

Shots from that run (one boot, matched poses, directly comparable):
`2026-09-10-temporal-reprojection-NEXT-SESSION/shots/` —
`f2-still.png`, `f3-still.png`, `f2-strafe.png`, `f3-strafe.png`.

**Verdict: PROMISING, and the experiment is worth building.** The remaining
artifact after reprojection will be body motion (the motion-vector side the owner
wants to defer until this half looks good), which the frozen subject here
deliberately removes.

⚠ A metric in this rig that DID NOT work, recorded so nobody trusts it: the
per-row-phase vertical gradient (intended to show the comb as a phase-dependent
signature) came back with spreads of 0.1–1.9% in every case, including the strafe
pair — because the graded image is the WHOLE frame and the crisp level contributes
the same gradient at every phase, diluting the body's comb. The mean-|Δ| A/B was
the metric that answered the question; the row-phase spread is not evidence of
anything at this framing. If someone wants the comb signature, restrict the
gradient to the body's pixels (the SDF target) rather than the whole frame.

---

# FINAL VERDICT — the held-row reprojection does NOT pay. Do not ship it.

Owner, after looking at it live at `?fields=3&heldreproj=1` with frozen enemies
and strafing past them: **"it looks exactly the same."** Correct, and the numbers
say why.

## The measurement that decides it: at PLAY RANGE it does not reduce the artifact

Same rig, same boot, staged at **4 m** (the owner's actual viewing range) instead
of the close-up, 0.05 m strafe (~3 m/s walking), `?frozen`:

| comparison (body at 4 m) | mean \|Δ\| | pixels >2 |
| --- | ---: | ---: |
| h/3, reproj off vs on | 4.23 | 31% |
| **h/2 vs h/3, reproj OFF** | **6.00** | 38.9% |
| **h/2 vs h/3, reproj ON** | **6.17** | 39.5% |

**The reprojection does not move h/3 toward h/2 at all** (6.00 → 6.17, marginally
worse). If it were fixing the staleness that separates the two, that gap would
shrink. It changes 31% of pixels by ~4 levels and makes none of them right.

The same measurement at the 0.7 m close-up (`stageCloseUp`'s "body fills the
frame"), where the mechanism DOES work:

| comparison | reproj OFF | reproj ON |
| --- | ---: | ---: |
| h/2 vs h/3, 0.25 m strafe | 20.29 | 16.21 |
| h/3 distance to a SAME-POSE GROUND TRUTH (fielding off), 0.25 m | 15.53 | **9.25 (−40%)** |
| h/3 distance to ground truth, 0.05 m | 17.89 | 14.31 (−20%) |

and the identity gate: with a STILL camera the reprojection changes the frame by
**0.18 levels** (7,059 px of 480,000) — a near no-op, exactly as designed.

## Why, and what it means

1. **Parallax scales as 1/distance.** At 0.7 m a 0.05 m step displaces content
   ~40 px; at 4 m it is ~7 px. The pre-test's "camera motion dominates by 15x" was
   measured at 0.7 m and is a CLOSE-UP result. Building the case for the project on
   that framing was the error.
2. **The reprojection is horizontal-only by design** (a held row's sample must stay
   in its own row), so at range, where the offset is a few pixels, it cannot touch
   the residual. That residual is the **ROW STRUCTURE**: at h/3 two rows in three
   are samples from OTHER INSTANTS, and no sideways shift makes their content line
   up with the fresh rows. **This is also almost certainly what the owner meant the
   first time — "the lines are just way too distracting at 3 and 4". Lines = the
   row structure, which this change never addressed.**

**Therefore the motion-vector follow-up is not worth building either.** Moving
bodies are the same class of fix — repositioning content WITHIN held rows — so it
inherits the same ceiling while being far more work. Deeper interlace is not
reachable by reprojection: the obstacle is the RECONSTRUCTION, not staleness.

## Where the code is

- `main` @ `fc7c70c7`: the layer half (per-slot held cameras, `rotateHeldCameras`,
  the reprojection in `COMPOSITE_WGSL`), **OFF** by default, wired to nothing.
  Harmless and inert; it is also the accurate record of why the idea fails.
- Branch **`held-row-reproj`** @ `81a87262`: the `?heldreproj` wiring, the bench
  reset-block pin, and the rig extensions (`FIELDS_PROBE_REPROJ`,
  `FIELDS_PROBE_DIST`, the same-pose ground-truth reference). Unmerged on purpose.

## If deeper interlace is ever wanted: the real shape of the problem

Not "a better held row" — **reconstruct EVERY row from a temporally accumulated
history**, i.e. march a low-resolution grid with a per-frame sub-pixel jitter and
accumulate it into a full-resolution history reprojected with motion vectors. That
is the only scheme in which the row structure does not exist, because no output
pixel is a sample from a single older instant — each is a blend over time.

What it needs, in the order that de-risks it:

1. **Motion vectors**, camera AND object. Camera is available (this work built
   per-frame VP retention; `temporal-start.ts` already reprojects by it). Object
   motion is the real cost: a screen-space motion field for the marched bodies,
   whose per-vertex data is close to hand in `bone-instancer.ts` (posed instances
   per frame) but which needs its own pass and target.
2. **A validity / disocclusion test** — the reprojected depth must agree; without
   it this reads as smearing, which is worse than the comb.
3. **Neighbourhood clamping** of the history against the current frame, the
   standard anti-ghosting measure. Ghosting is THE failure mode of this class, and
   it is what retired C2 for a related reason (reprojected flesh desyncing from
   exactly-rendered polygons).
4. **A jitter sequence** and its determinism consequences: the whole frame becomes
   a function of its entire history, which changes what `frameHash`'s `repeated`
   check means and interacts with the two-state branch. **SETTLED — see
   [2026-09-10-temporal-accumulation-frame-hash-DECISION.md](2026-09-10-temporal-accumulation-frame-hash-DECISION.md):** every layer stays in the
   hash (nothing dropped, the accumulated output is ADDED and the version bumped),
   but the accumulator must be resettable and epoch-labelled, the gate becomes a
   SEQUENCE comparison from a fresh epoch, and the jitter must be a pure function
   of frames-since-epoch that `demoHold` must NOT freeze.

Pieces that already exist and would carry over: `sdfScale` already marches at a
scaled resolution (`setSdfScale`, reset to 1.0 in the ship defaults) — that is the
low-res march this scheme wants; the history ring is the pattern for the retained
history; the temporal-start reprojection is the pattern for the camera term.

**The cheap first experiment, before any of the above:** measure the CURRENT
quarter-resolution march look — `setSdfScale(0.5)` with no accumulation at all —
so the baseline artifact (shimmer/softness) is known. Then ask the one question
that decides the project: accumulate with CAMERA-ONLY motion vectors and see how
bad the ghosting on a walking body is. If that is unacceptable, the object-vector
pass is mandatory before any look verdict is worth taking; if it is tolerable, the
cheap version may already be shippable. Do not build the motion-vector pass before
that number exists.

---

# THE COST SIDE OF ACCUMULATION, MEASURED (2026-09-10, after the owner said proceed)

Before building anything: what is a LOW-RESOLUTION march actually worth? The
accumulation scheme exists to make one acceptable, so this is the ceiling it is
spending against — and the first number that makes the idea look like more than a
rescue mission. Room 4, `BENCH_PASSES=1`, median of 3, harness reset block pins
`sdfScale` to 1.0 and the new legs override it:

| `setSdfScale` | `sdf:march` | vs 1.0 | fenced frame p50 | vs 1.0 |
| --- | ---: | ---: | ---: | ---: |
| **1.0 (ships)** | **8.18** | — | **16.64** | — |
| 0.75 | 5.35 | −2.83 (−35%) | 11.15 | −5.49 (−33%) |
| 0.5 | 4.12 | −4.06 (−50%) | 8.51 | −8.13 (−49%) |
| 0.35 | 3.63 | −4.55 (−56%) | 8.30 | −8.34 (−50%) |

Legs: `sdfscale-0.75`, `sdfscale-0.5`, `sdfscale-0.35` in `scripts/sdf-game-bench.mjs`.

**A half-scale march is worth ~8 ms of a 16.6 ms frame — nearly half of it**, and
that is the BEST single lever measured this session (R1 was −2.1 to −2.5 ms). Two
things to read carefully:

- **The march is SUB-LINEAR in pixel count.** 0.5 is a QUARTER of the marched
  pixels for HALF the cost; 0.35 is about an eighth for 56%. So a substantial part
  of the pass is not per-marched-pixel at all — consistent with the repo's
  "cost is per-PIXEL, not per-step" finding, and evidence there is a fixed
  per-frame component (setup, clears, uniforms, proxy-box rasterisation) that no
  resolution change touches.
- **Below 0.5 there is nothing left to take**: 0.35 buys 0.49 ms of march and 0.21 ms
  of frame over 0.5. So **0.5 is the sweet spot**, and the reconstruction should be
  designed for that target rather than for the smallest possible grid.
- The frame tracks the march almost 1:1 at 0.75 and 0.5 (the march is ~79% of the
  labelled total), so this is a real frame-level win, not a pass-attribution move.

**What this does NOT measure: the look, or the reconstruction's cost.** A
half-scale march is upsampled today with a nearest tap and no history, so it is
aliased; the accumulation's job is to spend some of those 8 ms back on looking
right. **The decision it enables is cheap and belongs to the owner**: put
`__sdfGame.setSdfScale(0.5)` in the console on the dev server and judge the
aliasing as-is.

- If a half-scale march already looks acceptable inside this game's degraded CRT
  look, **there is nothing to build** — ship the scale and bank ~8 ms.
- If it looks too aliased, build the accumulation, and its budget is the difference
  between 8 ms and whatever the jitter + reprojection resolve costs.
