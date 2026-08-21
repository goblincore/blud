# `.blob` primitive and fold roadmap

**Date:** 2026-08-21
**Status:** taper + chamfer shipped; the rest queued

## Why this document exists

For most of `.blob`'s life the format had exactly **one primitive** — an
axis-scaled capsule — and **one fold**, the quadratic smooth-min, with
`blendK: 0` as the only alternative. Between them that ruled out every sharp
shape by construction, and the cost was not obvious until you went looking:
the goblin's hooked nose was two ellipsoids faked into a hook, and its pointed
ears were two blobs apiece whose own comment read *"one ellipsoid cannot taper
— it is round whatever you scale it to."* Those comments were describing the
format's limit, not the art.

Adding `r2=` (taper), `tip=` and `chamfer` fixed both in an afternoon and
turned out to be the single biggest improvement to modelling ability so far.
That is the argument for the rest of this list: **the vocabulary is the
bottleneck, not the authoring loop.** Each entry below is a shape the format
currently forces an author to fake with a stack of spheres, and every one of
those fakes reads as a lump.

The ordering is by shape unlocked per unit of work.

---

## 1. Arc capsule — a capsule swept along a curve  ⬅ biggest remaining gap

**Bigger than the taper was.** Horns, tusks, tails, claws, curved fingers,
ribs, tentacles, hooked noses — every one of them is currently a chain of N
straight primitives placed by hand, and every link in that chain has its own
round base. That is precisely the failure this project has now hit three
times: the two-blob ear, the two-prim nose, and the lips. A curved horn
tapering to a point should be **one primitive**.

Proposed grammar — a control point, so a straight primitive stays straight:

```
bar head on skull from=0.4 to=0.9 r=0.03 r2=0.002 bend=(0.02,0.06,0.04)
```

Implementation: quadratic Bézier from `a` through the control point to `b`,
with the radius lerped along `t`. iq's `sdBezier` is the standard exact
construction (solves a cubic; has a real degenerate case when the control
point is collinear, where `dot(b,b)` is 0 — must fall back to the straight
cone or it produces NaN, and one NaN in a smooth-min fold takes the whole
body with it). Needs the closest-point `t` returned as well as the distance,
so the taper can be evaluated there.

Costs a new data row for the control point (`ROW_PRIM_BEND`), gated on the
same per-cluster `shaped` bit the taper already uses.

---

## 2. Groove / pipe folds — crisp channels along an intersection

Mercury's `fOpGroove` / `fOpEngrave` / `fOpPipe` / `fOpTongue`. These cut a
channel where a cutting surface meets the assembled body, which is how you get
a mouth line, a panel seam, a nostril slit, a wound edge, or a lip crease
without modelling it as a separate subtracted solid.

```
groove head on skull at=0.12 r=0.05 depth=0.004 width=0.006 offset=(0,-0.02,0.06)
```

Not a blend profile — a subtractive OP, so it belongs in the carve pass
alongside `carve`, using the accumulated field as `a` and the primitive's own
field as `b`:

```
fOpGroove(a, b, ra, rb) = max(a, min(a + ra, rb - abs(b)))
```

`primShape.zw` are already spare, so `depth`/`width` need no new row — only a
third `primScale.w` op value.

---

## 3. Rounded box — the first flat face in the format

Everything in `.blob` is round. There is no flat surface anywhere, at any
scale. Teeth, slabs, crystal, bone, blocky armour, plate, buckles, tablets.
`sdRoundBox` with an authored corner radius covers all of it, and it is also
the primitive that would let some of the `.wam` kit move back into
**deformable** SDF flesh rather than living as rigid mesh.

```
blob head on skull at=0.3 box=(0.04,0.01,0.02) round=0.004
```

---

## 4. Blend exponent — `soft` … `round` … `tight` as a continuum

The current fold is the quadratic polynomial smooth-min (h²). Raising the
exponent tightens the fillet; lowering it softens. **One parameter** replaces
what Chisel exposes as four separate named profiles (`ROUND`, `SOFT`,
`TIGHT`, `SHARP`), and it composes with the `chamfer` we already have.

Cheapest item on this list by a wide margin.

---

## 5. Torus / ring

Rings, collars, ruffs, bracelets, open mouths, eye rims, bangles. `sdTorus` is
trivial and exact. The clown's belled ruff collar wants one; today it would be
a ring of hand-placed spheres.

---

## 6. Triangular prism / wedge

The taper gives points, but always round in cross-section. Fins, flat-backed
horns, claws, blades, spikes with facets. Lower priority than the above
because a rounded box plus a taper approximates most of it.

---

## Explicitly NOT on this list

- **Baked SDF grids / mesh-to-SDF.** Owner verdict 2026-08-20: buys detail,
  costs deformability. `X1.humanoid-sever-spike`. And if the answer is a baked
  mesh, a mesh is simpler.
- **NGon / spline / curve-revolve primitives.** These are interactive-editor
  concepts (Chisel has them); they do not map onto a text format an LLM
  authors, and the `.wam` kit already covers lathed and extruded hard parts.

## Reference

- Chisel 4.0.1's primitive and blend vocabulary, surveyed in
  [`docs/dev-notes/2026-08-21-chisel-primitive-sculpt/notes.md`](../../dev-notes/2026-08-21-chisel-primitive-sculpt/notes.md)
- Mercury's hg_sdf for the fold operators
- iq's distance-function catalogue for `sdBezier`, `sdRoundBox`, `sdTorus`
