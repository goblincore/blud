# Organs in the cavity, and guts that boing

**Date:** 2026-09-02 · **Status:** approved (brainstormed with owner)
**Scope:** `src/lab/sdf-zombie/` — `pack.ts` (`W_ORGAN`), `march.wgsl.ts`
(organ material), `material.ts`, `zombie.blob`, `entrails.ts`, `goo-layer.ts`.
WebGPU only.
**Owner intent:** wound interiors should show "the classic intestine look" —
pale pink coiled tubes — and spilled guts should read as those tubes rather
than as blood. Explicitly **"not about realism, it's about making it feel
interesting and fun"**, and **"doesn't need to be anatomically correct, just
suggestive"**.

## Where this came from

Entrails shipped a cavity viscera ramp and a gut rope. Both under-delivered,
in instructive ways:

- The **viscera tint** is not discernible at combat range (measured, task 8).
  The cavity reads as a hole because of the *bone plug*, not the colour.
- The **rope** reads as "a rigid dark T shape... basically impacted fecal
  matter that has hardened" (owner). It is goo's single blood maroon, and a
  verlet chain with only distance constraints has no mechanism that could
  produce a coil — it hangs straight and lands straight.

### The finding that drives the whole design

**Geometry reads at combat range; tint does not.** Bone lands because it has a
hard silhouette and its own normal. The viscera tint — same depth, same wound,
only a colour — does not. So organs must be **geometry**, not a shading region.

This is the opposite of what the earlier "internal detail cannot survive combat
range" claim would have predicted. That claim is void (its rib evidence was a
shader bug — see the entrails spec's correction), and the evidence that
replaces it points the other way.

**A second enabler:** `applyBones` hard-coded taper, profile and bend to
"none", so no bone-array prim could render curved. Fixed at `3dc8373`. A coiled
tube is a chain of strongly bent capsules, so this design was literally
undrawable until that fix.

## §1 — The organ: a coiled tube in the abdomen

A new op, **`W_ORGAN = 5`**, in the existing `body.bonePrims` array. It folds
under the same `nearWound` gate, uses the same prim-material identity read that
gives bone its shading, and has the same cost profile — everything the bone
array already earned applies unchanged.

**Form: suggestive, not anatomical** (owner). Roughly 6–10 prims:

- **Loops** — `bar` prims with heavy `bend`, looping back and forth across the
  lower torso.
- **Segmented bulges** — two or three chains of overlapping `blob` prims at low
  `blendK`. Overlapping spheres with a tight blend give the haustra-style
  bumpy read from the reference, more cheaply than grooving a smooth tube.

The cues that must survive are **round tubes, visible loops, pale pink, wet
sheen**. Anything finer is detail the beam will not resolve.

**Material:** a new `organColor`, pale salmon — linear `[0.72, 0.32, 0.30]`,
noticeably lighter than `deepColor` — with high gloss and high wetness. The
reference's read is as much wet-plastic sheen as it is hue.

**`organAmp`** (default 1) is the amplitude guard, matching every other quality
lever here: at 0 the organ material is not applied and organ prims shade as
plain bone, so the off-state is a one-knob comparison rather than a rebuild.

**Placement:** lower torso only, inside the flesh and behind the ribs, so
`checkBoneContainment` still passes. A gut shot opens onto coils; a chest shot
still opens onto ribs.

**Honest caveat:** the reference is a clean model on white. Under one
flashlight in a dark dungeon, pale salmon sits much darker and must survive
`absorb` and `shadowRed` in the surrounding blood. Expect **form** to carry more
than hue — consistent with bone reading and the viscera tint not. If it comes
out muddy, lift the organ's wet/emissive response rather than chasing the
colour.

## §2 — The spilled rope shares the organ's material

The rope is currently goo's single blood maroon, which is why it reads as gore
rather than gut. It takes the **same pale pink**, so the thing that spills
obviously came from the thing in the cavity: one material, two states.

**The cheap path, verified.** `goo-layer.ts`'s density pass writes
`vec4(fall, fall*viewDepth, fall, 1)`. `.r` is density, and `.g`/`.b`
reconstruct view depth (`c.g / max(c.b, 1e-4)`) — all consumed. **`.a` is never
read anywhere in the file.** So:

- gut droplets write their mask into `.a`;
- the surface pass lerps blood colour → `organColor` by `a / max(r, eps)`.

No second render target and no second pass. Blood *near* a rope stays blood,
which matters because a disembowelled body bleeds heavily exactly there.

## §3 — The rope is a SPRING, not a rope

The "rigid T" has one cause: a verlet chain with only distance constraints has
nothing resisting collapse into a straight line. Trying to make a coil *emerge*
from self-collision is unreliable; making it **explicit** is both simpler and
more controllable.

**Mechanism.** Alongside the existing segment-length constraints, add a
**skip-one constraint** between nodes `i-1` and `i+1`, targeting a distance
shorter than two segments. That encodes a preferred bend angle at every node,
and a uniform preferred bend is a coil. Offsetting the target out of plane
makes it a helix. For 10 nodes that is 8 extra constraints.

**What it buys:**

- **It cannot be a T.** The straight shape is now actively resisted; the spring
  pulls back toward a coil every step.
- **It boings.** Yanked by the gait, or stretched as it tears free and falls, it
  extends and recoils. That is *motion*, which reads at combat range better
  than any static detail tried so far — and it is the "interesting and fun"
  the owner asked for rather than realism.
- **Node repulsion is unnecessary** and is explicitly NOT built. The coil holds
  its own shape rather than needing collisions to find one.

**Knobs:** `coilTightness` (the skip-one target as a fraction of two segments;
1.0 is a straight rope, lower is tighter — **default 0.55**) and `springiness`
(the skip-one constraint's correction weight relative to the segment
constraints, 0..1 — **default 0.35**, so segments still win and the tube cannot
crush itself). Loose is a hanging rope, tight is a slinky.

Also raise **`gut thickness`**: the fallen heap reading as separate beads is the
metaballs failing to fuse, which is that slider and goo's `threshold`.

**Honest limit:** at 10 nodes over 0.55 m the coil is chunky — a few big loops,
not a fine spiral. Given "suggestive, not realistic" that is probably right, and
more nodes is the lever at linear cost if not.

## §4 — Cost and gates

**Cost.** Organs are ~6–10 more prims in the bone array, folded under the same
`nearWound` gate — so undamaged bodies still pay **zero**, which is now
measured rather than argued (`boneEvals()` reads exactly 0 with no wounds). The
spring is 8 extra constraints per rope. The tint is one channel already being
written and never read.

**The measurement to use is the counter, not the clock.** `__sdfGame.boneEvals()`
reported 1,224,192 bone evaluations in one frame for 12 wounds while the timing
bench read +0.0% — the GPU absorbs this at current scale. Organs push that count
up by roughly a third (17 bones → ~24 prims). Report the counter delta; do not
claim a frame-time result the bench cannot resolve.

**Gates:**

1. **Off-state parity** — `organAmp 0` (or no organ prims authored) shades and
   packs bit-for-bit as today.
2. **Containment** — `checkBoneContainment` must pass for every organ prim on
   every character; organs sit inside flesh exactly as bone does. A breach
   breaks the `nearWound` gate's identity.
3. **Spring behaviour**, as pure unit tests on `entrails.ts`: a chain released
   from straight converges toward a coil; a settled chain still freezes; the
   skip-one constraint does not fight the segment constraints into instability
   (assert node positions stay finite and bounded over 2000 steps).
4. **Counter delta** — `boneEvals()` before and after organs, on the same
   staged wound set.
5. **Combat-range read** — capture at 2–3 m under the beam, judged by looking.
   **Never a pixel diff**: 52–82k pixels of same-build flicker.

**Risks on the record:**

- Pale salmon may go muddy under the dungeon beam and inside blood (§1).
- The spring may read as comedic rather than visceral. That is a genuine
  possibility and the owner has accepted it as the intent ("interesting and
  fun"), but `coilTightness` at 1.0 degrades gracefully back to a plain rope if
  it lands wrong.
- Organs compete with bone for the crater floor: at `boneRatio 0.38` bone
  already claims it just past `visceraDepth`. Organs sit *behind* the ribs and
  lower, so they should not collide — but if a gut shot shows bone where it
  should show coils, lowering `boneRatio` or the organ's depth is the lever.

## Explicitly out of scope

- **Anatomical accuracy** — owner: "doesn't need to be anatomically correct,
  just suggestive of the above".
- **Chest organs** (heart/lungs). The chest is where the ribs already do the
  reading; add later only if a gut shot reads and the chest then looks bare.
- **Rope-to-body and rope-to-rope collision** — still not built, and the spring
  removes the main reason it was wanted.
- **Organs spilling as separate objects.** The rope is the spill; the organ is
  what stays.
