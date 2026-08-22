---
name: authoring-sdf-characters
description: Use when creating or editing a Blud SDF character - writing a .blob file, porting a WAM cast member (goblin, imp, knight, lizardman, ogre, orc, skeleton, troll), adding a creature to the bestiary, or retuning an existing body's proportions or face.
---

# Authoring SDF characters

The toolchain is called **Blobforge**: the `.blob` format plus its parser,
compiler, checks, emitter, turntable and this skill. Use that name.

Blud's characters are raymarched signed-distance fields built from blended
primitives. You author them in `.blob` text, which compiles to `BodyDef`. You
never hand-write `BodyDef` TypeScript.

## Read this first

`src/lab/sdf-zombie/characters/zombie.blob` is the worked example and the
house style. Read it before writing anything. Note how many lines are
comments explaining WHY a number is what it is — that is the format working
as intended, not clutter:

```
# The upper body hunches FORWARD (+z). These used to lean -z while the
# forearms angled +z, so in profile the occiput jutted where the face should
# be and the head read as being on backwards.
bone spine parent=pelvis dir=up pitch=6.842773 len=0.34
```

## The loop

1. **Get the reference as geometry.** `docs/dev-notes/refs/<name>-mesh/*.glb`
   if it exists; a plate (`<name>-reference.png`) if not. If you have neither,
   stop and ask for one — two characters were authored from prose and both
   drifted a long way (`docs/dev-notes/refs/README.md`).
2. **Measure before you touch anything:** `npm run blob:measure -- <name>`.
   Read the three worst bands. Each names a `.blob` line. That is your edit
   list, in order. If it prints POSE MISMATCH, score a `--range` window where
   the poses agree and treat whole-figure numbers as a before/after gradient
   only.
3. **Edit the line. Re-measure.** One band at a time. The score should move; if
   it does not, the band is owned by a different line than you thought — the
   tool told you which.
4. **Every ~5 edits, look:** `npm run blob:shot -- <name>`, then `Read` the
   frames. The measure cannot see a hole behind the front surface, a feature
   smeared by `blend=`, or a colour. The pictures can.
5. **See something the measure did not predict?** Run
   `npm run blob:render-check -- <name>` *before* editing the `.blob`. If it
   fails, the bug is in `webgpu/`, not in your file.
6. Tests: `npx vitest run src/lab/sdf-zombie/`. The character's own
   `*-blob.test.ts` pins measured properties; update the numbers it pins when
   you change them on purpose, with a comment saying why.

Iterate on the `.blob` text, never on compiled output.

### Running the turntable by hand

`npm run blob:shot` automates exactly the steps below (it starts a Vite server
on 5233 and a Chrome on debug port 9223 only if they are not already
listening, and stops only what it started). They remain true, and are what to
fall back to when you need a different port, a headed window, or to watch the
lab itself:

```
npx vite --port 5233 --strictPort &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9223 --enable-unsafe-webgpu \
  --user-data-dir=/tmp/chrome-blob-turntable &
BLOB_CHARACTER=<name> BLOB_DIST=1.35 node scripts/blob-turntable.mjs 5233 /tmp/<name>
```

`BLOB_CHARACTER` is passed through as the lab's `?character=`; without it you
shoot the lab default and can spend a while judging the wrong body. `BLOB_DIST`
(and `BLOB_PITCH`) override the camera framing — the default 2.4 m frames the
~1.8 m zombie, and a 1.30 m goblin shot at that distance is a small figure in a
large empty room, which is exactly the wrong image for judging whether two
limbs read as separate. Then open `/tmp/<name>/index.html` (or the individual
`frame-NN.png`s) and actually look. Read the script's own header comment — it
documents a real determinism limit (frames match in content, ~0.3-0.4% of
pixels differ byte-for-byte run to run; treat them as reproducible for review,
not as a byte-diffable golden image).

For the full suite rather than the character's own tests, `npx vitest run
src/lab/sdf-zombie/` needs no special env. For a fast inner loop, scope it to
`src/lab/sdf-zombie/blob-parse.test.ts src/lab/sdf-zombie/blob-compile.test.ts
src/lab/sdf-zombie/blob-checks.test.ts
src/lab/sdf-zombie/characters/zombie-blob.test.ts`.

## Make the limbs READ, not just connect

`fusedOf` says a limb is attached. `clearOf` says two limbs do not pass
through each other. Neither says a limb is *visible as a limb*, and that gap
cost this project two rounds of owner rejection on the goblin: `clearOf(armL,
torso)` read a comfortable +13.4 mm while the arm's SURFACE was 5.4 mm from
the body, and the render showed a torso with arm-shaped bulges. `clearOf`
samples centrelines; two surfaces can be a hair apart with both axes safely
outside each other.

`daylightOf(body, limb, against, join, joinRadius)` measures the actual air —
surface to surface, ignoring the region around the joint, where an attached
limb is deeply merged on purpose. Roughly 2% of standing height is where
separation became visible from every yaw rather than only on the shadowed
side.

The lever is usually **not on the limb**. Reach, tilt and joint radius are all
competing for one number: how far out the torso's flesh reaches at the height
the limb passes. The limb must start inside that flesh or it detaches, and get
outside it or it melds — so every arm-side knob is fighting a race the torso
sets the length of. On the goblin, no shoulder reach both attached and
cleared. Narrowing the torso in x and taking the mass back as `deep` freed the
whole budget at once, and made the profile better besides.

## Look at the render. The checks are not enough.

`validateBody` and the `fused`/`clear` checks in `blob-checks.ts` prove a
body is closed, connected, and non-interpenetrating. They cannot tell you it
reads well. The FPV hand/wrist bake in `X1.hand-followups` passed every
topological gate — zero boundary edges, one connected component,
sub-millimetre contact error — and still failed owner review because the
wrist did not merge in an anatomically convincing way.

Closed is not the same as convincing. Always open the turntable frames
before calling a character done.

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

## Comment every non-obvious number

A number without a reason is a number the next author cannot safely change.
Write the reason, in the voice `zombie.blob` uses. Comments are ordinary
source text, so this needs no special support to work while you're hand
editing — but it's also protected: `blob-emit.ts` splices tuned values into
their exact original line and echoes every other line back byte-for-byte, so
comments (and column alignment) survive a re-emit. Today that re-emit path
covers `face` overrides only (`emitBlob(doc, { face: {...} })`), and it is a
standalone function, not yet wired to a "save" button in the lab panel — the
face sliders in `panel.ts` are live-tunable on screen, but getting a tuned
value back into `.blob` text still means reading it off the panel and typing
it into the `face` block yourself, or calling `emitBlob` programmatically.

**Every number has a source.** Either it was measured (say from what:
`# mesh width at y 0.76 = 0.142`) or the comment says why not (`# eyeballed;
the mesh has no ear dish, owner asked for one`). A number with neither is a
guess, and guesses are what `blob:measure` exists to replace.

## Two constraints that bite silently

- **Within one limb, primitive order is fold order.** The smooth-min used to
  blend primitives is not associative, so reordering two primitives on the
  same limb changes the surface. (`assignClusters` auto-sorts primitives into
  contiguous per-limb runs regardless of how you interleave lines from
  *different* limbs in the source, so interleaving `blob torso` and `bar arm`
  lines is harmless — but reordering two lines that belong to the *same*
  limb is not. Group a limb's parts together anyway; it's the readable
  convention and it's what `zombie.blob` does.)
- **A single cluster may not exceed 64 primitives** (`MAX_CLUSTER_PRIMS` in
  `validate.ts`). Past that the shader's fixed-iteration loop stops folding
  and the surface loses geometry with no error at the shader level.
  `validateBody` now catches this at authoring time; do not raise the
  constant to silence it.

## The dials

- `blend=` is smooth-min strength — the roundness dial, and the main thing
  that makes an SDF character read as SDF rather than as boxes.
- `carve ... hard` subtracts with `blendK: 0` for a crisp edge (smooth
  carves smear, because smin's blend is wider than a small feature —
  `face.ts`'s header records four failed rebuilds of the face behind that
  exact lesson: geometric eye sockets never read as a face, so the shipped
  head is one textured ellipsoid with no carves at all). Hard carves are
  real and still used, just not for the face — reach for them on wounds,
  stumps, and the skeleton follow-up.
- **`carve` is currently head-only.** A `carve on <bone> ...` line has no
  limb word and is hardcoded to `limb: 'head'` regardless of which bone it
  targets (see `blob-parse.ts`'s `parseBodyLine`). A carved stump on a leg or
  arm bone would compile but land in the *head* cluster, not the limb it
  visually sits on — wrong fold group, wrong bounding sphere. If a WAM port
  needs a carve on a non-head limb, that's a grammar gap to raise, not
  something to route around in `.blob` text.
- `wide`/`tall`/`deep` scale a part's axes; omitted axes default to 1.
- **`clearOf` (the interpenetration check in `blob-checks.ts`) samples along a
  primitive's own shaft, spaced to its effective radius.** For a primitive
  whose `length / effRadius` exceeds 32, the spacing can't keep up and it
  prints a loud `console.warn` naming the limb and the actual spacing. That
  means a real crossing on that primitive could be stepped over and missed —
  a false "clear". It won't fire on the zombie (longest ratio ~4-5), but a
  slender limb, tail, or held weapon on a ported character will cross 32
  easily. If you see it: thicken the primitive, shorten it, or split it into
  more bones — don't ignore the warning as noise.
- **`dir=side` and `dir=fwd` bones don't take pitch/tilt the way `up`/`down`
  ones do** — on `side`, pitch is a no-op and tilt swings toward +y, not +x;
  on `fwd`, both are inert after normalization. `scripts/derive_blob_angles.mjs`
  only derives angles for `up`/`down` bases; it labels `side`/`fwd` bones
  "not derivable" and expects you to hand-write their `dir=` with no
  pitch/tilt. A cast port will hit this immediately on clavicles (WAM
  characters commonly rig them `dir=side`).
- **`stance` is optional, and omitting it means "not checked"** — not
  "humanoid". `checkStance` is the format's one INTENT check, and a defaulted
  intent is a guess: while `stance` defaulted to humanoid, zombie.blob (which
  declares none, and whose hunched knees sit 10.2 mm behind the hip-to-ankle
  line) reported two validation errors in the lab, both false. Declare it when
  you mean it.
- The `face` block is `FaceParams` (`face.ts`), not primitives — it's the one
  part of a `.blob` file that isn't geometry, and it stays live-tunable in
  the lab panel.

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

Engine path, for when you need to touch it: `blob-parse` (`color`, `gloss`,
`core` on `BlobPart`) -> `blob-compile` -> `PrimDef`/`Primitive` (`types.ts`)
-> `resolve.ts` passes them through -> `pack.ts` writes `ROW_PRIM_COLOR`
(xyz linear rgb, w = 1 + gloss; w = 0 means flesh) -> `march.wgsl.ts` reads
it at `hitBest` and overrides `albedo`, zeroes the eye glow on paint, and
feeds gloss into the specular term. `DATA_ROWS` is 13.

## Measure against the mesh, frame-aligned

**Start with `npm run blob:measure -- <name>`** — it is the whole-figure tool
and the only one that names the `.blob` LINE owning each bad band. It resolves
its reference itself: `--glb`, else the first `.glb` under
`docs/dev-notes/refs/<name>-mesh/`, else `--plate`, else
`docs/dev-notes/refs/<name>-reference.png`. Read its header comment in
`scripts/blob-measure.ts` before quoting its numbers at anyone — in particular
that a whole-figure IoU is a before/after gradient for ONE character against
ONE reference, never a target to optimise and never a grade across characters,
and that exit 2 means "did not run" (no `.blob`, no reference, build error) and
must never be read as a score of zero. It prints POSE MISMATCH when the
reference's pose dominates: the maus mesh holds its arms straight out while the
`.blob` rests them at ~47 degrees, so score a `--range` window where the poses
agree (`--range 0.75:1` is legs and shoes, where nothing is posed) and act on
those bands.

`npx tsx scripts/silhouette-match.ts <name> [--range lo:hi]` is the older
whole-outline scorer that blob-measure supersedes — same raster, but it cannot
tell you which line owns a band. Same caveat, recorded in `silhouette.ts`.

For close-ups the head tool is still the right one: `npx tsx
scripts/head-profile.ts <name>` prints the head's front/back profile, the
muzzle's plan view and ASCII front/side views against the mesh. It aligns
frames on the TORSO's z-centre and prints the shift — the maus mesh's whole
figure sits at z -0.067 in its own file, and comparing absolute z once leaned
the neck back 40 degrees to "fix" a head that was already right. Author to the
mesh SURFACE, not its rig joints: the rig's shoulder/collar heights were 9 and
13 cm above where the skin is.

Reference meshes live in `docs/dev-notes/refs/<name>-mesh/` (the maus is
`docs/dev-notes/refs/maus-biped/`). Check with `git ls-files` whether the one
you need is committed — a dispatched agent works in a fresh worktree, so an
untracked mesh in the primary checkout does not exist for it.

## Failure triage — what it looks like vs what it is

Every row here cost at least an hour of editing the wrong file. Check the table
before you change a number. Paths are relative to `src/lab/sdf-zombie/`.

| what you see | what it usually is | where |
| --- | --- | --- |
| a perfectly ROUND see-through hole, CPU field solid there | occluder hull sized a tapered prim from its fat end, or another hull/pre-pass bug | `webgpu/occluder-hull.ts`; run `blob:render-check` |
| a bent capsule renders as ONE sphere at its start | `coneBend` untapered branch | `webgpu/march.wgsl.ts` |
| a `both`/mirrored part sits on the centreline | mirror did not reflect x | `mirror.ts` |
| a limb's distal part "disconnects" after a paint or reorder | `clusterCore` picked the wrong prim; mark the structural one `core` | `validate.ts` `clusterCore` |
| a small feature is smeared / missing | `blend=` wider than the feature | the `.blob` — shrink blend or use `chamfer` |
| a stripe of flesh through a painted area, from one angle only | the camera, not the paint — `focusBody` was aiming down the collar | look from another yaw first (`webgpu/lab-main.ts`) |
| the whole body blanks | a zero in a panel override (`setStepsOverride(0)` used to) | `webgpu/lab-main.ts` |
| head reads right but sits 60 mm off in profile vs the mesh | the mesh is not at the same z — frame-align on the torso | `scripts/head-profile.ts` prints the shift |
| the whole-figure score is stuck while the sculpt is right | the reference's POSE (arms out vs down) dominates IoU | `blob:measure --range` over a window where poses agree |

The general rule the mouse paid for: **if a hole is round and the CPU field
(`sdBody`) is solid there, suspect the renderer, not the `.blob`.**
`npm run blob:render-check -- <name>` is that comparison automated — one
front-on GPU frame against a CPU march of the same body through the same
camera. Exit 1 names the cluster locations and the owning line of a hole the
GPU shows and the field does not; exit 0 means the renderer agrees with the
field, so the defect is yours to fix in the `.blob`; exit 2 means it could not
run. It needs the blob-shot servers (Vite 5233, Chrome 9223) already running
— `npm run blob:shot -- <name>` in another shell is the easy way to have them.

The full account of these, and the day they cost, is
`docs/dev-notes/2026-08-22-painted-sdf-outfit.md`.
