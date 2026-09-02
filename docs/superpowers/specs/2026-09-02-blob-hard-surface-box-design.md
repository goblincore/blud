# Hard surface in `.blob`: the `box` primitive

**Date:** 2026-09-02
**Status:** design, approved
**Supersedes nothing.** Adds one bare word to the grammar, beside `chamfer`/`hard`/`mirror`.

## Why

The next characters are biomechanical. The reference committed at
`docs/dev-notes/refs/minotaur-mesh/minotaur.glb` is a demon brawler whose right
leg is a full prosthetic: a plated thigh cowl with a circular port, a layered
knee, a shin plate with a recessed strip, an armoured foot. Two more meshes
waiting in the primary checkout (`cyber_minotaur_biped`, `spidermecha`) are the
same problem — a cannon arm, armoured greaves, a tripod chassis.

The format cannot make any of it. Every primitive is an axis-scaled capsule or
round cone. `chamfer` bevels the *fold between* two primitives, but the
primitive itself still has round ends and no flat faces, so a machined plate
authored today is a lozenge.

The gap is narrower than it looks. Breaking the reference's leg down against
the grammar we already have:

| what the reference does | grammar today | verdict |
| --- | --- | --- |
| red cable loops over the shoulder | `bar` + `bend=` | works |
| panel seams; the recessed shin strip | `groove` — takes a limb word, unlike `carve` | works |
| flat-faced plates with crisp edges | nothing | **this spec** |
| the circular port on the thigh cowl | `carve` — head-locked | deferred, below |
| brushed metal read | `gloss=` only, which pulls toward a *wet* highlight | deferred, below |

So this spec adds exactly one thing: the item with no approximation. Grooves
and cables already work. The other two gaps are things a person can look at a
render and judge, which is the argument for building the box first and letting
the authoring pass produce the evidence for the rest.

### The rejected alternative: polygon attachments

The original framing was that biomechanical parts "should maybe be mesh". That
was considered and rejected, and the reference is the reason. Its metal is a
**smooth slab with panel lines painted on** — there are no modelled bolts,
vents or greebles anywhere on it. The mechanical read is texture. There is no
geometric detail a mesh would carry that a box plus `groove` plus `color=`
does not.

Against that near-zero gain, a raster attachment costs the one property the
whole renderer is built on: everything is one field, so everything behaves
uniformly. A polygon attachment would need its own pass, its own depth
reconciliation (there is already a warning on file that main-pass geometry is
painted over by the SDF composite), its own lighting match, and its own answer
for wounds, bleed anchoring, occluder hulls, severing and click-to-shoot. The
project has already been here and come out the other side — "nothing in the
mouse is a polygon kit any more".

## The design

**A bare modifier word `box` on `blob`/`bar`.** Not a new part kind.

```
bar leg on shin from=0.18 to=0.86 r=0.055 wide=1.35 deep=0.80 box round=0.10 color=8d9299
blob leg on knee at=0.50 r=0.070 box round=0.22 chamfer color=6f747b
```

`blob ... box` is a cube; `bar ... box` is a slab. That matches the existing
point/segment duality exactly, so there is no new authoring concept.

A modifier rather than a kind, for three reasons:

1. It inherits `mirror`/`both`, `offset=`, `core`, `color=`/`gloss=` and
   `chamfer` wholesale, with no new parse path and no new mirroring rules.
2. It composes forward. When `carve` eventually takes a limb word,
   `carve on shin ... box` is rectangular vent slots for free — and that
   reference is full of them.
3. `shell` and `groove` both went in this way. There is a worn path through
   parse → compile → `validate.ts` CPU twin → WGSL → occluder hull → tests.

### Semantics

- **Half-extents are `r × wide/tall/deep`** — identical to a capsule's
  semi-axes. This is the load-bearing decision. `blob:rings` measures and
  reports world semi-axes `A_k = r·s_k` and prints the SEMI-AXIS in millimetres
  beside every ratio, so defining a box the same way means **ring-fit keeps
  working on boxes with no change to the fitter at all.** Every "one block is
  one edit" gauge-family block stays exactly as meaningful.
- **`round=` is a FRACTION of `r`, not metres.** Range 0..1, default `0.08`.
  The corner is **inset**, so the total half-extent stays `r·scale` — which is
  what ring-fit measured:

  ```
  base = sdBox(q − closest, vec3(r · (1 − round))) − r · round
  ```

  `round=0.05` reads machined; `round=0.4` reads soft; `round=1` is exactly the
  capsule. A fraction rather than an absolute is deliberate and load-bearing:
  `sdPrimitive` evaluates in the **scale-divided frame**, where the radius is
  isotropic `r` and world semi-axes are `r·scale`. An absolute-metre `round`
  would be measured in that divided frame and so would come out anisotropically
  distorted on any part with unequal `wide/tall/deep` — which is every plate on
  this character. A fraction has no frame problem. It also survives a resize:
  the "machined-ness" of a part is a property of the part, and ring-fit's
  gauge families move `r` and the scales together.
- **The box extends past its endpoints, exactly as a capsule does.** A capsule
  is `len(q − closest) − r`, which reaches `r` beyond A and B. A box is
  `sdBox(q − closest, …)`, which reaches its half-extent beyond A and B along
  the axis too. So a `bar ... box` is longer than `|AB|` by twice the extent —
  surprising for a box, but the same rule as every other primitive, and the one
  that keeps `from=`/`to=` meaning what it already means.
- **The segment sweep is unchanged.** The closest-point-on-segment computation
  in `validate.ts`'s `sdPrimitive` is already there and is not touched — the
  box is one branch at the point where `base` is assigned.
- **The anisotropic scaffolding is unchanged.** The existing divide-by-scale,
  multiply-by-`minScale` construction that keeps the field a valid lower bound
  applies to the box identically.

### Rejected loudly, not ignored

Matching how `chamfer`-on-`carve` is handled today — a rejection at authoring
time with a reason, never a silently meaningless flag:

- **`bend=` on a box.** `sdRoundBox` has no bent form.
- **`r2=` / `tip=` on a box.** No taper in v1. A wedge is tempting and the
  reference does not need one.
- **`shell` + `box`.** A box cowl is interesting; it is not what this reference
  asks for.

## Where it lands

- `blob-parse.ts` — one bare word, beside `chamfer`/`hard`/`mirror`; `round=`
  as a numeric arg.
- `blob-compile.ts` — the three rejections above; carry the flag onto the
  compiled primitive the way `shell` params are carried.
- `validate.ts` — one branch at the `base` assignment in `sdPrimitive`. This is
  the CPU field that backs click-to-shoot, so it must match the shader exactly.
- `webgpu/march.wgsl.ts` — `sdRoundBox` behind the spare `zw` of
  `row 10 primShape`. The texture packing does not change.
- `occluder-hull.ts` — hull sizing for a box.
- **`march.glsl.ts` is not touched.** It is frozen per owner decision and only
  `zombie.ts` consumes it. Bent and oriented prims already diverge there; a box
  joins a documented list rather than opening a new one.

## Testing

- Parse round-trip through `blob-emit.ts` — comments and untouched lines echo
  back byte-for-byte.
- The three rejections, each asserting the message names the reason.
- CPU/GPU agreement: `validate.test.ts` already asserts shader literals stay in
  step with `validate.ts`; extend that to the box branch.
- **A non-`box` primitive's field is bit-identical to before.** This is the
  guarantee every past addition has had to meet — `bend=`, `r2=` and `shell`
  each keep the plain capsule path untouched, and the zombie pins depend on it.
- Two geometric pins anchoring the `round` sweep at both ends: at `round=1` the
  box field equals the capsule of the same semi-axes to within tolerance, and
  at `round=0.05` its corner sits measurably outside that capsule — by
  `r·(√3 − 1)` along the body diagonal for a cube, which is the number to pin.
- `round` outside 0..1 is a parse error, not a clamp. Above 1 the inset extent
  goes negative and the field inverts; a silent clamp would hide a typo in a
  character file.

## Then: the character

With the box in hand, author `minotaur.blob` against the committed reference.
Measured on arrival, so the authoring pass does not re-derive it:

| | |
| --- | --- |
| rig | `meshy-biped` (`detectRig`), 24 joints |
| verts | 135,942, of which 21,657 dropped below `MIN_DOMINANT_WEIGHT` |
| bind height | 1.217 m — a wide semi-crouch, arms in a clean T |
| coverage | **72.5%** reach a measurable bone (bonewalker 67%, mouse 40%) |
| cyber leg | the character's **right**: `shin.r` 18,032 verts vs `shin.l` 6,724; `thigh.r` 10,635 vs `thigh.l` 6,981 |
| unmapped | `Head` 7,354, `LeftHand` 4,286, `RightHand` 4,075 |

Reference bone lengths, joint to joint, in reference units:

```
pelvis     0.0771    clavicle.l 0.1939    thigh.l 0.2479    foot.l 0.1276
spine1     0.0771    clavicle.r 0.1909    thigh.r 0.2624    foot.r 0.1408
chest      0.0771    upperarm.l 0.1985    shin.l  0.2860
spine2     0.0310    upperarm.r 0.1934    shin.r  0.2786
neck       0.0681    forearm.l  0.2174
                     forearm.r  0.2312
```

Two consequences worth carrying into the plan:

- **`blob:rings` is the tool here, not `blob:measure`.** The reference stands in
  a wide semi-crouch, so a rasterised whole-figure score is POSE MISMATCH by
  construction — the same situation as bonewalker, where no clean `--range`
  window existed. Ring-fit measures each bone in its own frame, where pose
  cancels.
- **`blob:rings` is paint-blind, and this character is mostly paint.** The
  bonewalker run paid for this lesson: the fit sees the field, not the colour,
  and twice asked for the painted spine ridge to shrink to nothing. Expect it
  to ask for the prosthetic plates to shrink. Overrule it there and judge those
  by render.

## Deferred, deliberately

Neither is built, and the authoring pass decides both:

- **`carve` on a limb.** Blocked by one line — `blob-parse.ts` hardcodes
  `limb: 'head'`, with a comment already calling the lock provisional: *"if a
  body carve ever needs a different limb, `'head'` would need to become a real
  word in the grammar, not stay guessed here."* Carves are subtracted from the
  **assembled** body globally, so the limb tag drives clustering and bounding
  spheres, not what gets cut. Wanted for the thigh cowl's port.
- **Metalness.** `gloss=` pulls toward a tight wet highlight, which is a flesh
  cue. Whether flat grey plates need a different BRDF response is a question
  for the frames, not for a guess.
