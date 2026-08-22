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

1. **Get the reference as geometry.** The convention is
   `docs/dev-notes/refs/<name>-mesh/<name>.glb` — `blob:measure` resolves that
   path itself, and falls back to the plate
   (`docs/dev-notes/refs/<name>-reference.png`) without complaining, so confirm
   with `git ls-files docs/dev-notes/refs/` that the mesh exists **on your
   branch**, and read the `=== mesh <path>` / `=== plate <path>` header line the
   command prints to see which one it actually scored. If you have neither, stop
   and ask for one — two characters were authored from prose and both drifted a
   long way (`docs/dev-notes/refs/README.md`).
2. **Measure before you touch anything:** `npm run blob:measure -- <name>`.
   Read the three worst bands. Each names a `.blob` line. That is your edit
   list, in order. If it prints POSE MISMATCH, score a `--range` window where
   the poses agree and treat whole-figure numbers as a before/after gradient
   only.
3. **Edit the line. Re-measure.** One band at a time. The score should move; if
   it does not, the band is owned by a different line than you thought — the
   tool told you which. One blind spot to know about: the depth scan behind
   each column steps 5 mm (`D_STEP`, `silhouette.ts`), so a feature THINNER
   than that along the view axis — a lens, a blade-thin ear seen front-on — is
   stepped straight over and the band is attributed to the next primitive
   INWARD. It never invents an owner; it can name one too deep.
4. **Every ~5 edits, look:** `npm run blob:shot -- <name>`, then `Read` the
   frames. The measure cannot see a hole behind the front surface, a feature
   smeared by `blend=`, or a colour. The pictures can.
5. **See something the measure did not predict?** Run
   `npm run blob:render-check -- <name>` *before* editing the `.blob`. It starts
   and stops its own servers — there is nothing to set up first. If it fails,
   the bug is in `webgpu/`, not in your file.
6. Tests: `npx vitest run src/lab/sdf-zombie/`. The character's own
   `*-blob.test.ts` pins measured properties; update the numbers it pins when
   you change them on purpose, with a comment saying why. Iterate on the
   `.blob` text, never on compiled output.

### Frames: `blob:shot`, and driving the turntable by hand

`npm run blob:shot -- <name>` is the supported way to get frames: it is
HEADLESS by default (`BLOB_HEADED=1` for a real window), writes
`/tmp/blob-shot/<name>/` with an `index.html` and `frame-NN.png`s, and does not
set `BLOB_DIST` for you — pass it in the environment if the default framing is
wrong for a short character. Both it and `blob:render-check` share
`scripts/lab-servers.sh`: each starts a Vite and a WebGPU Chrome if none is
listening, reuses (and leaves running) a lab that already is, and stops only
what it started. `LAB_VITE_PORT` / `LAB_CDP_PORT` override the default 5233 /
9223 so two runs can coexist.

Drive it by hand only when you need to watch the lab itself, or want a port and
a camera the wrapper does not expose:

```
npx vite --port 5233 --strictPort &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9223 --enable-unsafe-webgpu \
  --user-data-dir=/tmp/chrome-blob-turntable &
BLOB_CHARACTER=<name> BLOB_DIST=1.35 node scripts/blob-turntable.mjs 5233 /tmp/<name>
```

`BLOB_CHARACTER` becomes the lab's `?character=`; without it you shoot the lab
default and can spend a while judging the wrong body. `BLOB_DIST` (and
`BLOB_PITCH`) set the framing — the default 2.4 m frames the ~1.8 m zombie, and
a 1.30 m goblin at that distance is a small figure in a large empty room, which
is the wrong image for judging whether two limbs read as separate. Read
`blob-turntable.mjs`'s header for its determinism limit: frames match in
content, ~0.3-0.4% of pixels differ run to run, so they are reproducible for
review but not a byte-diffable golden image.

For a fast test loop, scope vitest to
`src/lab/sdf-zombie/blob-{parse,compile,checks}.test.ts` plus the character's
own `characters/<name>-blob.test.ts`.

## Measure against the mesh, frame-aligned

**Start with `npm run blob:measure -- <name>`** — it is the whole-figure tool
and the only one that names the `.blob` LINE owning each bad band. It resolves
its reference itself: `--glb`, else `docs/dev-notes/refs/<name>-mesh/<name>.glb`,
else the first `.glb` in that directory (with a stderr warning naming which —
heed it; a texture-only or animation-merge export scores nonsense), else
`--plate`, else `<name>-reference.png`. Read its header comment in
`scripts/blob-measure.ts` before quoting its numbers at anyone — a whole-figure
IoU is a before/after gradient for ONE character against ONE reference, never a
target to optimise and never a grade across characters, and exit 2 means "did
not run", never a score of zero. It prints POSE MISMATCH when the
reference's pose dominates: the mouse mesh holds its arms straight out while
the `.blob` rests them at ~47 degrees, so score a `--range` window where the
poses agree (`--range 0.75:1` is legs and shoes, where nothing is posed) and
act on those bands.

`scripts/silhouette-match.ts` is the older whole-outline scorer blob-measure
supersedes — same raster, but it cannot name the line that owns a band.

For close-ups the head tool is still the right one: `npx tsx
scripts/head-profile.ts <name>` prints the head's front/back profile, the
muzzle's plan view and ASCII front/side views against the mesh. It aligns
frames on the TORSO's z-centre and prints the shift — the mouse mesh's whole
figure sits at z -0.067 in its own file, and comparing absolute z once leaned
the neck back 40 degrees to "fix" a head that was already right. Author to the
mesh SURFACE, not its rig joints: the rig's shoulder/collar heights were 9 and
13 cm above where the skin is.

Reference meshes live at `docs/dev-notes/refs/<name>-mesh/<name>.glb` — the
mouse's is committed at `docs/dev-notes/refs/mouse-mesh/mouse.glb`.

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
`npm run blob:render-check -- <name>` automates exactly that comparison. Exit 1
names the cluster locations and the owning line of a hole the GPU shows and the
field does not; exit 0 means the renderer agrees with the field, so the defect
is yours; exit 2 means it could not run. The full account of these, and the day
they cost, is `docs/dev-notes/2026-08-22-painted-sdf-outfit.md`.

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

`validateBody` and the `fused`/`clear` checks in `blob-checks.ts` prove a body
is closed, connected, and non-interpenetrating. They cannot tell you it reads
well. The FPV hand/wrist bake in `X1.hand-followups` passed every topological
gate — zero boundary edges, one connected component, sub-millimetre contact
error — and still failed owner review because the wrist did not merge in an
anatomically convincing way. Closed is not the same as convincing: open the
frames before calling a character done.

## Comment every non-obvious number

A number without a reason is a number the next author cannot safely change.
Write the reason, in the voice `zombie.blob` uses. Comments survive a re-emit:
`blob-emit.ts` splices tuned values into their exact original line and echoes
every other line back byte-for-byte. That path covers `face` overrides only
(`emitBlob(doc, { face: {...} })`) and is not wired to a save button, so a
value tuned on the lab's face sliders still gets back into the text by hand.

**Every number has a source.** Either it was measured (say from what:
`# mesh width at y 0.76 = 0.142`) or the comment says why not (`# eyeballed;
the mesh has no ear dish, owner asked for one`). A number with neither is a
guess, and guesses are what `blob:measure` exists to replace.

## Two constraints that bite silently

- **Within one limb, primitive order is fold order.** Smooth-min is not
  associative, so reordering two primitives on the same limb changes the
  surface. `assignClusters` sorts primitives into contiguous per-limb runs, so
  interleaving lines from *different* limbs is harmless — reordering two lines
  of the *same* limb is not. Group a limb's parts together, as `zombie.blob`
  does.
- **A single cluster may not exceed 64 primitives** (`MAX_CLUSTER_PRIMS` in
  `validate.ts`). Past that the shader's fixed-iteration loop stops folding
  and the surface loses geometry with no error at the shader level.
  `validateBody` now catches this at authoring time; do not raise the
  constant to silence it.

## The dials

- `blend=` is smooth-min strength — the roundness dial, and the main thing
  that makes an SDF character read as SDF rather than as boxes.
- `carve ... hard` subtracts with `blendK: 0` for a crisp edge; smooth carves
  smear, because smin's blend is wider than a small feature. `face.ts`'s header
  records four failed rebuilds behind that lesson — geometric eye sockets never
  read as a face, so the shipped head is one textured ellipsoid with no carves
  at all. Reach for hard carves on wounds and stumps, not on faces.
- **`carve` is currently head-only.** A `carve on <bone> ...` line has no
  limb word and is hardcoded to `limb: 'head'` regardless of which bone it
  targets (`blob-parse.ts`'s `parseBodyLine`). A carved stump on a leg compiles
  but lands in the *head* cluster — wrong fold group, wrong bounding sphere.
  A carve on a non-head limb is a grammar gap to raise, not to route around.
- `wide`/`tall`/`deep` scale a part's axes; omitted axes default to 1.
- **`clearOf` (the interpenetration check in `blob-checks.ts`) samples along a
  primitive's own shaft, spaced to its effective radius.** For a primitive
  whose `length / effRadius` exceeds 32 the spacing can't keep up, so it warns
  with the limb and the spacing: a real crossing there could be stepped over
  and reported as a false "clear". The zombie never trips it (ratio ~4-5), but
  a slender limb, tail or held weapon will. Thicken, shorten, or split into
  more bones — do not read the warning as noise.
- **`dir=side` and `dir=fwd` bones don't take pitch/tilt the way `up`/`down`
  ones do** — on `side`, pitch is a no-op and tilt swings toward +y; on `fwd`,
  both are inert after normalization. `scripts/derive_blob_angles.mjs` labels
  them "not derivable" and expects a hand-written `dir=` with no pitch/tilt.
  A cast port hits this on clavicles, which WAM commonly rigs `dir=side`.
- **`stance` is optional, and omitting it means "not checked"** — not
  "humanoid". `checkStance` is the format's one INTENT check, and a defaulted
  intent is a guess: while it defaulted to humanoid, zombie.blob (hunched knees
  10.2 mm behind the hip-to-ankle line) reported two false errors in the lab.
- The `face` block is `FaceParams` (`face.ts`), not primitives — it's the one
  part of a `.blob` file that isn't geometry, and it stays live-tunable in
  the lab panel.

## Syntax lives in `reference.md`

`.claude/skills/authoring-sdf-characters/reference.md` has the grammar:

- **Sharp features — `r2=`, `tip=`, `chamfer`, `groove`:** points, tusks, cut lines, and why reach is the whole game.
- **Curved primitives — `bend=`:** one primitive for a horn or a tail instead of a chain of lumps.
- **Colour — the `palette` block:** the biggest lever you have; skip it and your character is the zombie in a different shape.
- **Paint — `color=`/`gloss=` and `core`:** a paint boundary is a primitive boundary; measure paint off the mesh's texture.
