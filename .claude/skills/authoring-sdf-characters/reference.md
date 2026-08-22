# `.blob` syntax reference

The companion to `SKILL.md`. That file is the loop and the lessons; this one is
the grammar for the four features that are pure syntax to look up. Everything
here was true of the format on 2026-08-22.

## Sharp features: `r2=`, `tip=`, `chamfer`

For most of this format's life it had exactly one primitive — an axis-scaled
capsule — and one fold, the quadratic smooth-min. Between them that ruled out
every SHARP shape: smooth-min rounds any tip it touches, so the sharpest thing
authorable was a small sphere, and the only alternative to a fillet was
`hard` (`blendK: 0`), a raw boolean seam. Three additions close that gap:

- **`r2=`** — the radius at the FAR end. The primitive becomes a round cone.
  `r2=0` is a **true point**, the one shape a capsule cannot make. Omit it and
  the primitive takes the plain capsule path, bit-identical to before.
- **`tip=(x,y,z)`** — displaces the far end ALONE, so a primitive can point
  somewhere its bone does not. Every capsule before this ran *along* its bone;
  a nose out of a vertical skull or a tusk out of a jaw needs this. `offset=`
  still moves both ends together. Under `both`, `tip` mirrors in x with
  `offset`, so a pair of tusks splays instead of both leaning one way.
- **`chamfer`** — a bare word like `hard`/`mirror`/`both`. Folds with a flat
  45° bevel, keeping a **crease** where the default gives a fillet.

```
# the goblin's hooked nose: a bridge, then a hook turning down off its end
blob head on skull at=0.47 r=0.031 r2=0.017 blend=0.0030 chamfer offset=(0,-0.010,0.070) tip=(0,-0.026,0.062)
blob head on skull at=0.47 r=0.016 r2=0.004 blend=0.0016 chamfer offset=(0,-0.036,0.132) tip=(0,-0.040,0.030)
```

**`groove`** is a fourth part kind beside `blob`/`bar`/`carve`. It cuts a
CHANNEL along where its own surface crosses the assembled body, so a mouth
line, a panel seam, a nostril slit or a scar is a *line* rather than a
subtracted solid:

```
groove head on skull at=0.12 r=0.030 wide=1.30 tall=0.09 depth=0.004 width=0.005 offset=(0,-0.014,0.060)
```

`depth`/`width` are metres and both must be above zero — a groove missing
either cuts nothing at all while still costing a slot in the fold. Make the
primitive FLAT in the direction you want the line to run (`tall` right down for
a horizontal seam): the channel follows its zero-set. Grooves run in the carve
pass, after the whole additive fold, so they cut the finished surface.

**REACH IS THE WHOLE GAME, and it is easy to under-do.** A sharp point still
reads as a bump if it stops inside the mass it grows from. The goblin's cranium
has a semi-depth of `headRadius × headDepth` = 0.118 m; the first tapered nose
tipped out at 0.122 and was still a bump. Compute the host's extent and clear
it properly.

Two rejections you will meet, both deliberate:

- `r2=` on a `blob` with no `tip=` — a blob is a sphere, so there is nothing
  to taper *along* and the cone collapses to its larger end. Use a `bar`, or
  give the blob a `tip=`.
- `chamfer` on a `carve` — carving folds through `smax`, which has no
  chamfered form here. Rejected rather than silently ignored.

## Curved primitives: `bend=`

Horns, tusks, tails, claws, curved fingers, ribs, hooked noses. Before this
the only way to author a curve was a CHAIN of straight primitives placed by
hand — and every link in the chain has its own round base, which reads as a
lump. That failure cost this project three owner rejections on one character
before `bend=` existed.

- **`bend=(x,y,z)`** — displaces the quadratic Bezier CONTROL point from the
  MIDPOINT of the primitive's two endpoints, in world axes. The same
  convention as `offset=` and `tip=`, so you reason about all three the same
  way: hold in your head where the chord's midpoint is, then push the control
  point where the curve should bulge. Absent means straight, and a straight
  primitive keeps the exact code path it has always had. Under `both`,
  `bend.x` mirrors with `offset.x` and `tip.x`, so a pair of horns curves
  outward rather than both leaning the same way.

The radius still tapers ALONG THE CURVE (`r=` at the start end, `r2=` at the
far end), so a curved horn that comes to a point is ONE primitive:

```
# a horn off a mirrored skull bone, sweeping back and out to a point
bar head on skull from=0.55 to=0.95 r=0.030 r2=0.002 bend=(0.02,-0.05,0.06) blend=0.0018 chamfer mirror
```

How to aim it: the curve passes through the midpoint of your endpoints only
when the bend is zero; it bulges HALFWAY toward the control point (the apex
sits at half the displacement). So `bend=(0.06,0,0)` puts the belly 30 mm out
from a 60 mm-displaced control point. If the shape needs a sharper turn than
one quadratic gives, that is the format's honest limit — split into two bent
prims at an INFLECTION, not at a lump.

A collinear or zero bend is dropped at compile time and the primitive stays
bit-identical to its straight twin — write `bend=(0,0,0)` freely, but do not
depend on sub-tenth-millimetre bends surviving.

Same rejection as the taper, for the same reason: `bend=` on a `blob` with no
`tip=` has no midpoint to displace from. Use a `bar`, or give the blob a
`tip=`.

## Colour is the biggest lever you have

Before the `palette` block existed, every `.blob` character wore one global
`FLESH_PRESET` the lab panel picked — so the whole cast rendered as the same
pink creature in different shapes. The first goblin still read as "the zombie
with different limbs" after its skeleton had been rebuilt end to end. Rebuild
the proportions all you like; if you skip the palette it will still look like
the zombie.

```
palette
  baseColor     0.34 0.44 0.19   # linear RGB
  deepColor     0.46 0.09 0.09   # wound interior — keep it red
  specRoughness 0.42
  mottleAmp     0.65
  mottleScale   1.6
  mottleColor   0.21 0.19 0.06
```

- Keys are `FleshMaterial`'s own field names (`material.ts`), not friendlier
  aliases — same rule as the `face` block, and for the same reason.
- It is a PARTIAL override of `henenlotter-latex`, a NAMED preset rather than
  whatever the panel has selected, so a character looks the same in the lab, in
  a turntable capture and in the game.
- Values are linear RGB and go through an sRGB encode on the WebGPU path, which
  lifts the low channels hard. Saturated colours come out much paler than the
  numbers read.
- **`mottleAmp` is the within-body variation** — `surfaceNoiseAmp` roughens the
  NORMAL, which reads as texture and never as colour, so without a mottle a
  body is one flat tone from every angle. It is 0 in every stock preset;
  turning it on is a per-character decision.
- `mottleScale` is NOT cycles per metre: the shader's `fbm` multiplies its own
  input by 4 and 9, so a value near 1 gives patches a hand-span across. By 5 it
  is freckles; past ~10 it aliases into what reads as compression noise.
- **Raising `mottleAmp` shifts the mean colour**, because the blotch weight
  averages ~0.5 — the body lands near `mix(baseColor, mottleColor, amp/2)`.
  Lift `baseColor` back when you raise the amplitude.
- Pick a `mottleColor` that differs in HUE, not only in value. A mottle that is
  just a darker base is nearly invisible; one far from the base reads as dirt
  ON the creature rather than variation IN it.

## Paint: `color=` on a primitive (added 2026-08-22)

A `.blob` is no longer one colour. Any `blob`/`bar` line can carry
`color=rrggbb` (BARE hex — `#` opens a comment, and the parser tells you so)
and an optional `gloss=0..1`. Wherever that primitive is the nearest one to
the surface, its colour REPLACES the flesh albedo — mottle and face sheet
included — and gloss pulls it toward a tight wet highlight. A painted prim is
exactly a painted region of a sculpt, which is what the reference meshes are.

```
blob head on skull at=0.00 r=0.028 ... color=101012 gloss=0.95   # a lens
bar  leg  on thigh from=0.08 to=0.92 r=0.034 mirror core color=1d27a4   # shorts
```

Rules that fell out of the first painted character (the mouse):

- **The paint boundary is a primitive boundary.** One prim is one colour, so
  a hem or a collar has to sit where two prims meet. Split a bar in two if
  the boundary falls mid-limb (the mouse's shin at the shorts' hem).
- **Measure paint off the mesh's texture, not off a render.** Classify each
  mesh vertex by its texel (see `scripts/head-profile.ts` and the
  `decodePng` + `parseGlb` helpers in `silhouette.ts`) and you get every
  region's extents per height and per z band, and its mean colour. The mouse's
  shades, shoes, tee and shorts were all authored from that, and the lesson
  was that the clothes had NO drape — the tee is the torso painted red.
- **Mark the limb's structural mass with `core`.** The fuse probe
  (`clusterCore`) takes the fattest primitive, which is wrong as soon as a
  shoe or a sleeve is fatter than the bone it hangs off; a painted shoe once
  became a leg's core and the probe to the pelvis ran through air. `core`
  on the thigh bar / shoulder ball says which prim is the mass. Inferring it
  from colour was tried and broke the moment a limb's own flesh was painted.
- **Accessories are geometry, too.** Sunglasses are two bent capsules that
  WRAP the cheek (a flat ellipsoid floats off a receding face), a thin bridge,
  and two temple arms seated inside the skull and the ear. Shoes are three
  prims on the foot bone. Nothing in the mouse is a polygon kit any more.
- **Under plain `mirror`, a prim's own offset/tip/bend x reflects on the
  `.r` copy** (since 2026-08-22 — it did not before, and the mouse's finger
  bones exist because of that). Author outward of the `.l` bone and the `.r`
  side follows.
- **An untapered BENT prim renders now.** `coneBend` had no `r2 < 0` branch
  until the lens: every earlier bent prim happened to be tapered. If a bent
  part shows as a lone sphere at one end, that class of bug is where to look.
