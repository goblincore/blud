# `.blob` syntax reference

The companion to `SKILL.md`. That file is the loop and the lessons; this one is
the grammar for the features that are pure syntax to look up. Everything here
was true of the format on 2026-09-02.

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

Both must be above zero — a groove missing either cuts nothing at all while
still costing a slot in the fold. Make the primitive FLAT in the direction you
want the line to run (`tall` right down for a horizontal seam): the channel
follows its zero-set. Grooves run in the carve pass, after the whole additive
fold, so they cut the finished surface.

**`depth` is metres. `width` IS NOT, and this is the trap.** `depth` is added
to the body's own field directly, so `depth=0.004` cuts 4 mm. `width` is
compared against the groove primitive's distance, and `sdPrimitive` reports a
SCALED distance — it divides by the prim's scale and multiplies by the
smallest component. So the channel's real half-width in metres is

    width / min(wide, tall, deep)

and the flatter you make the prim — which is exactly what a crisp line needs —
the more it multiplies. A plate at `tall=0.05` turns `width=0.010` into a
**200 mm** band: not a line, a shrink of the whole panel. Author it backwards
from the band you want:

    width = (half-width you want) x min(wide, tall, deep)

A 20 mm line on a `tall=0.05` plate is `width=0.0010`. Measured on the
minotaur's torso 2026-09-03, where the naive values cut 40 mm trenches the
whole height of the body.

**Every groove authored before 2026-09-03 was a silent no-op** (`placePrims`
dropped `depth`/`width` while keeping `op`), so no existing `.blob`'s groove
numbers were ever validated by eye — including the ones in this file. Treat
them as untested starting points, not as known-good.

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

## Hard surface: the bare word `box` (added 2026-09-02)

Every primitive was a capsule or round cone until this, which ruled out a FLAT
FACE. `chamfer` bevels the fold BETWEEN two prims; the prim itself still had
round ends, so a machined plate read as a lozenge. That is the whole reason the
first biomechanical reference could not be authored. `box` sweeps a rounded BOX
along the segment instead of a sphere:

```
bar leg on shin from=0.18 to=0.86 r=0.055 wide=1.35 deep=0.80 box round=0.10 color=8d9299
blob leg on knee at=0.50 r=0.070 box round=0.22 chamfer color=6f747b
```

`blob ... box` is a cube; `bar ... box` is a slab — the same point/segment
duality as everywhere else. It is a MODIFIER, not a part kind, so it composes
with `mirror`/`both`, `offset=`, `core`, `color=`/`gloss=` and `chamfer`
exactly as they already work.

- **Half-extents are `r x wide/tall/deep`** — the SAME world semi-axes a capsule
  gets. That is deliberate: `blob:rings` measures semi-axes, so its "one block
  is one edit" suggestions stay meaningful on a box with no change to the
  fitter. Do not reason about a box as though it had its own size convention.
- **`round=` is a FRACTION of `r`, 0..1, default 0.08** — not metres. The field
  is evaluated in the scale-divided frame, where an absolute length would come
  out anisotropically distorted on any part with unequal `wide/tall/deep`. It is
  INSET, so raising it softens the corner without growing the part.
  `round=0.05` reads machined; `round=0.40` reads soft; **`round=1` is exactly
  the capsule**, which is the useful mental anchor.
- **A box extends past its endpoints, exactly as a capsule does** — it reaches
  its half-extent beyond A and B along the axis. Surprising for a box, but it
  keeps `from=`/`to=` meaning what they already mean.

Rejected loudly, never silently ignored: `bend=`, `r2=` and `tip=` on a box
(`sdRoundBox` has no bent, tapered or tip-displaced form), `box` on a `shell`,
and `round=` outside 0..1 — above 1 the inset extent goes negative and the field
inverts, so a clamp would hide a typo.

**Judging a box by measurement: on-axis probes CANNOT see it.** The inset is
defined so a box's axis-aligned extreme point coincides exactly with a
same-`r` capsule's. Every on-axis width, every band in `blob:measure`, and
`blob:rings`' whole radial fit therefore read a box and a capsule identically —
they differ only OFF-axis, out to the corner at `r*sqrt(3)` when `round=0`. So
a silhouette that looks right is not evidence the box is working. Look at a
CORNER, from a 3/4 yaw: two flat faces meeting at a crisp vertical edge is the
tell. `docs/dev-notes/2026-09-02-box-primitive/` has reference frames.

Still missing, and known: **`carve` is head-only**, so you cannot bore a socket
or cut a vent slot into a plate. (`metal` has since landed — 2026-09-03 — as a
shading word; see its section under Paint. The FIELD-level gaps below remain.)
And `gloss=` pulls toward a WET highlight,
which is a flesh cue — the `metal` word is the answer for plates, but there is
still no roughness, so one plate cannot be brushed and another polished. Both
are deliberate gaps left for evidence from a real character; raise them rather
than routing around them.

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

## Metal: the bare word `metal` on a painted prim (added 2026-09-03)

`gloss=` alone made the minotaur's plates SHINIER PLASTIC, never metal: the
shader gave every painted prim a full diffuse plus an untinted white
highlight, which is the recipe for polished plastic. The bare word `metal`
(beside `box`/`chamfer`, gated on `color=` exactly as `gloss=` is) is the
shading half of hard surface:

```
bar  leg on thigh from=-0.05 to=0.68 r=0.162 wide=1.28 tall=1.20 deep=1.18 box round=0.10 color=6a7078 metal gloss=0.95 side=r
```

What it does at shading time (`march.wgsl.ts`, the composite):

- **Suppresses the diffuse family to a floor of 0.25** — ambient bounce
  included, because bounce IS diffuse. NOT zero: with no environment map the
  lab has one key, and a true-zero diffuse goes black wherever the highlight
  is not.
- **Tints the specular AND the fresnel rim by the prim's own `color=`**
  instead of shining the light's colour. This is the single change that makes
  steel differ from white plastic under the same light.
- **Implies gloss's noise suppression with NO `gloss=` set** — a machined
  surface has no pores either. An author writing `metal` alone gets the
  polished look, not bull-hide pitting.

- **`gloss` and `metal` are SEPARATE axes on purpose.** A glass lens is
  glossy and emphatically not metal; folding one into the other turns the
  cyclops' eye into a ball bearing. Keep `gloss=` on the line to keep the
  tight hot highlight; `metal` alone keeps the preset's own highlight shape.
- **This is a PAINT APPROXIMATION, not a metallic BRDF.** There is no
  environment map and no roughness-driven reflection; the tint is flat, not
  view-dependent beyond the existing fresnel. Do not go looking for a
  metalness workflow that is not here, and do not expect metal to reflect the
  room.
- Keep the albedo DARK (the plates' 848a91 -> 6a7078, roughly -35% linear):
  metal's diffuse is dark and its brightness is the highlight. A light albedo
  plus a hot spec still reads as white plastic.

## Face decal: `sheet image` + `decal 1` (added 2026-08-23)

Agents cannot paint a face. Three dispatches proved it: prims for eyes and a
mouth read as a navy visor band; the generated greyscale sheet reads as a
zombie. The mesh already HAS a face, so paste that on instead — flat, lit
once, the way a PSX face was painted onto a head.

```
npm run blob:face-bake -- schoolgirl          # -> public/assets/lab/faces/schoolgirl-face.png
```

renders the reference mesh's head (every triangle in the top `--head-frac`
0.165 of its height) orthographically from the front, with its own texture,
into a 512 square with alpha off the head, and prints the head box it used
(`head 0.216 wide x 0.280 tall`). Then in the `.blob`:

```
sheet
  image       schoolgirl-face.png   # under public/assets/lab/faces/
  decal       1                     # paste as albedo; no glow, no relief
  projScaleX  0.35                  # uv = hs * scale + centre, uv.y from the BOTTOM
  projScaleY  0.54
  projCentreX 0.5
  projCentreY 1.00
```

`hs` is head space: the offset from the FATTEST head prim's centre, divided
by its semi-axes. On a character with hair that prim is the crown shell,
not the skin cranium — so the proportional numbers (`scale = semi-axis /
head-box side`) put the eyes in the right place sideways and land the
mouth under the chin vertically. Aim the two features instead: pick the
world heights you want the image's eye row and mouth row at, convert to
hs, and solve the two equations. The schoolgirl's sheet comment shows the
arithmetic. Then LOOK, with a close-up:

```
BLOB_DIST=0.45 BLOB_PITCH=0 BLOB_TARGET_Y=1.55 npm run blob:shot -- schoolgirl /tmp/sg-head 4
```

and A/B a setting without editing anything by poking the uniform first:

```
BLOB_PROBE="(window.__sdfLab.uniforms.faceProj.value.set(0.35,0.54,0.5,1.1), 1)" npm run blob:shot -- schoolgirl /tmp/sg-try 1
```

Rules:

- **Delete the painted eye/mouth prims.** A painted prim replaces albedo
  AFTER the sheet, so it sits on top of the decal's eyes.
- **Hair prims stay painted** — the decal only lands on unpainted skin, and
  the image's own hair (hairline, fringe) fills the gap under the fringe.
- The decal is clamped to the head by `|hs|` with 1.5x the reach of the
  multiplier sheet (hair-crown normalisation pushed the mouth past the
  old cutoff). Its alpha and the facing fade bound it otherwise.
- `decal 1` without `image` is a compile error; the other sheet numbers
  (`eyeGap`..`seed`) are ignored in decal mode.
- Meshes face +z by glTF convention; `--front -z` if the bake shows the
  back of the head.
