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

1. **Write** `src/lab/sdf-zombie/characters/<name>.blob`.
2. **Compile and check:** `npx vitest run src/lab/sdf-zombie/` (no special
   env needed — verified against the current suite, 64 files / 1203 tests).
   For a fast inner loop, scope it to
   `src/lab/sdf-zombie/blob-parse.test.ts src/lab/sdf-zombie/blob-compile.test.ts
   src/lab/sdf-zombie/blob-checks.test.ts src/lab/sdf-zombie/characters/zombie-blob.test.ts`.
3. **Look at it** with the turntable. It needs a running dev server and a
   *headed* Chrome with a debug port open — it will not work against a
   default `npx vite` alone:
   ```
   npx vite --port 5233 --strictPort &
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --remote-debugging-port=9223 --enable-unsafe-webgpu \
     --user-data-dir=/tmp/chrome-blob-turntable &
   BLOB_CHARACTER=<name> BLOB_DIST=1.35 node scripts/blob-turntable.mjs 5233 /tmp/<name>
   ```
   `BLOB_CHARACTER` is passed through as the lab's `?character=`; without it
   you shoot the lab default and can spend a while judging the wrong body.
   `BLOB_DIST` (and `BLOB_PITCH`) override the camera framing — the default
   2.4 m frames the ~1.8 m zombie, and a 1.30 m goblin shot at that distance
   is a small figure in a large empty room, which is exactly the wrong image
   for judging whether two limbs read as separate.
   Then open `/tmp/<name>/index.html` (or the individual `frame-NN.png`s) and
   actually look. Read the script's own header comment — it documents a real
   determinism limit (frames match in content, ~0.3-0.4% of pixels differ
   byte-for-byte run to run; treat them as reproducible for review, not as a
   byte-diffable golden image).
4. **Iterate on the text**, never on compiled output.

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
