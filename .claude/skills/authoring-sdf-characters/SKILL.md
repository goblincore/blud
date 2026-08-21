---
name: authoring-sdf-characters
description: Use when creating or editing a Blud SDF character - writing a .blob file, porting a WAM cast member (goblin, imp, knight, lizardman, ogre, orc, skeleton, troll), adding a creature to the bestiary, or retuning an existing body's proportions or face.
---

# Authoring SDF characters

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
   node scripts/blob-turntable.mjs 5233 /tmp/<name>
   ```
   Then open `/tmp/<name>/index.html` (or the individual `frame-NN.png`s) and
   actually look. Read the script's own header comment — it documents a real
   determinism limit (frames match in content, ~0.3-0.4% of pixels differ
   byte-for-byte run to run; treat them as reproducible for review, not as a
   byte-diffable golden image).
4. **Iterate on the text**, never on compiled output.

## Look at the render. The checks are not enough.

`validateBody` and the `fused`/`clear` checks in `blob-checks.ts` prove a
body is closed, connected, and non-interpenetrating. They cannot tell you it
reads well. The FPV hand/wrist bake in `X1.hand-followups` passed every
topological gate — zero boundary edges, one connected component,
sub-millimetre contact error — and still failed owner review because the
wrist did not merge in an anatomically convincing way.

Closed is not the same as convincing. Always open the turntable frames
before calling a character done.

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
- The `face` block is `FaceParams` (`face.ts`), not primitives — it's the one
  part of a `.blob` file that isn't geometry, and it stays live-tunable in
  the lab panel.
