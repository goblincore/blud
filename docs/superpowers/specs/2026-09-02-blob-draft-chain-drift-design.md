# `blob:draft` chain drift: length is a chain quantity, not a measurement

**Date:** 2026-09-02
**Status:** design, approved
**Amends** `2026-09-02-blobforge-draft-and-depth-design.md`, whose Tool A section
this corrects.

## The bug, and that it is mine

`blob:draft` shipped working — its output parses, compiles, builds, validates,
sits at 67 of an 80-prim budget with the minotaur's prosthetic correctly
unmirrored — and Task 10 still judged it **not a better starting point than
hand-authoring**, for reasons it called structural rather than tuning. It was
right, and the structure it hit is a sentence in the spec I wrote:

> `len` is that line's extent, **not the joint-to-joint distance**.

That is correct for *measuring a cloud* and wrong for *building a skeleton*,
and the two got conflated.

**`.blob`'s skeleton is a rigid kinematic chain.** A bone's head is its
parent's TAIL; its tail is head + `dir` × `len`. So `len=` does not describe a
bone, it *places every descendant of that bone*. Length is a chain quantity.

**Vertex clouds do not compose into a chain.** A bone's cloud is the skin its
weights dominate, and adjacent clouds OVERLAP — thigh and shin both own the
knee region. Summing overlapping extents overshoots, and the error accumulates
down the chain. Measured on the drafted minotaur: **soles ~0.3 m above the
floor, torso chain ~8% taller than its own height line.**

**The rig's joint-to-joint distances do compose, by construction** — they are
the chain that produced the skin in the first place.

There is direct precedent. Bonewalker took every `len=` from the reference
rig's joint-to-joint distances times a single global scale, and the note
records the consequence: *"no `BONE LENGTH IS OFF` block ever printed — the
failure class that drowned every mouse/schoolgirl fit was absent by
construction."* The proven method was already on the shelf.

### The 9–13 cm trap has a different right answer

The original spec avoided rig joints because they sit 9–13 cm off the skin, and
that observation is real. But the conclusion drawn from it was wrong.

A joint sitting off the skin is a statement about where the **surface** is, not
about how long the **bone** is. Moving the bone to chase the surface breaks the
chain for everything downstream. The format already has the right instrument
for a surface that is not centred on its bone: **`offset=` on the primitive.**

So the trap is handled by offsetting the PRIMS, not by relocating the BONE.

## The fix

**Lengths and directions come from the rig. Everything about the surface comes
from the cloud.**

| quantity | source | why |
| --- | --- | --- |
| `len=` | rig joint-to-joint × one global scale | the only chain-consistent source |
| `dir=`/`pitch=`/`tilt=` | the rig bone's direction | must agree with `len` or the chain still drifts |
| `root ... at` | derived so the sole lands at y = 0 | the chain's one free placement |
| `r`, `wide`, `deep` | the cloud, per band | unchanged — this part worked |
| bands | the cloud's radial inflections | unchanged — this is what stops a smooth tube |
| `offset=` | the cloud's centroid **off the rig axis** | the 9-13 cm trap's actual fix |
| `color=`, `palette` | the cloud's texels | unchanged |

One global scale, not per-bone: `targetHeight / referenceHeight`. Per-bone
scaling would reintroduce exactly the inconsistency this removes.
`ref-align.ts`'s `globalScale` already computes a scale of this shape against
an existing body; the draft needs the simpler height-ratio form, since there is
no body yet.

### What this simplifies

The `>45°` non-limb fallback the CLI grew during Task 10 — the one without
which schoolgirl's draft "does not even build connected", because her dress
cloud's principal axis measured 86° — **stops being load-bearing.** Directions
now come from the rig, so a skirt's non-vertical cloud can no longer steer a
bone.

Keep measuring the cloud's axis, but demote it from a source to a **check**:
when it disagrees with the rig direction by more than a threshold, say so in
the `# fit:` comment. That is a real signal — it means the surface genuinely
does not follow its bone — and the author should see it rather than have it
silently corrected.

### What it does not fix

`len=` from the rig gives a chain that closes. It does **not** guarantee the
drafted body is a good likeness — that is what `blob:rings` and now
`blob:depth` are for. This spec is about a skeleton that stands on the floor,
not about a character that reads.

## Acceptance

The current failure is measurable, so the fix must be too. Both are properties
of the emitted draft, checkable without an eye:

- **The soles land on the floor.** The lowest point of the built body sits
  within a stated tolerance of y = 0. Today: ~0.3 m out.
- **The chain matches its own height line.** The crown-to-sole extent is within
  a stated tolerance of the requested `--height`. Today: ~8% out.
- **Every mapped bone's `len=` equals the rig's joint-to-joint distance times
  the global scale**, to within float tolerance. This is the property bonewalker
  had by construction and the draft did not.
- **`blob:draft -- schoolgirl` builds connected with the `>45°` fallback
  disabled.** If it does not, directions are still coming from clouds
  somewhere.
- Regression: the minotaur draft's prim count stays inside budget and its
  prosthetic stays unmirrored. The parts that worked must keep working.

## Also on the list, not in this spec

Task 10 reported that **`parseBlob` accepts arbitrary non-comment garbage as
leading trivia** — an npm banner parsed cleanly and only failed the round-trip
test. Real, unrelated to chain drift, and worth its own fix; recorded here so
it is not lost.
