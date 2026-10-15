# Goblin facial expressions: notes (2026-10-13/14)

Spec: [`docs/superpowers/specs/2026-10-13-goblin-expressions-design.md`](../../superpowers/specs/2026-10-13-goblin-expressions-design.md).
Plan: [`docs/superpowers/plans/2026-10-13-goblin-expressions.md`](../../superpowers/plans/2026-10-13-goblin-expressions.md).
Task 3b's own notes (the mouth moved to the lip line, the per-body hinge): [`grin/NOTES-grin.md`](grin/NOTES-grin.md).

## Task 14 (2026-10-15): mesh teeth in the cinematic kit

Owner: make the teeth POLYGON MESH in `goblin-cinematic-kit` (the 11 SDF tooth prims cost about 23 ms on a face close-up and
were hard to light). The base goblin and every other character stay as they are.

### Investigation (written before building)

**How the kit is posed.** `character-view.ts` `pose()` calls `boneFrames(body, bound, bodyYaw)` (rig-frames.ts) and hands the
frames to `kit.pose()` (kit-overlay.ts), which writes each bone node's `matrixWorld` as `compose(frame.pos, frame.quat)`. A
frame is the bone's HEAD rig point plus `segmentQuat(restDir, head->tail, yaw)`: the shortest arc that turns the bone's rest
direction onto its posed one, about the bone's head. three skins a vertex as `matrixWorld * inverseBind * v`, and WAM's inverse
binds are translations to the kit bone's rest head, so a vertex skinned to a bone lands at `frame.pos + frame.quat * (v - head)`.

**The catch, measured** (`goblin-cinematic.blob`, a lower tooth root at (-0.026, 1.121, 0.085); the kit's jaw bone head is the
skull pivot, (0, 1.1186, 0.0129), the same point as the .blob's within 0.04 mm; the SDF hinge is at (0, 1.1326, -0.0083)). The
`on jaw` prims get `origin + qHead * (hinge + qGape * (v - pivot - hinge))` (rig-bind `headTransform`: `openAboutHinge`, then the
head's rigid turn). Against that, a kit vertex skinned to `jaw` is:

| gape (rad) | lab statue path (captures, held expressions) | motion path |
|---|---|---|
| 0.1 | 9.4 mm off | 1.3 mm off |
| 0.3 | 28.1 mm off | 3.1 mm off |
| 0.5 | 46.6 mm off | 3.9 mm off |

Two separate problems. (1) In the lab's statue path (every capture, every held expression) the gape never reaches the rig: lab-main
puts it on a copy of the bound (`boundForPose`) that only `applyRig` sees, and `heroView.pose` gets `heroMotion.bound`, whose jaw
point sits at rest, so the kit jaw would not open at all. (2) In the motion path the jaw point IS opened about the hinge
(motion.ts pins it to `jawTargetAt`), but the kit's frame is then the shortest arc about the jaw bone's head (the skull pivot,
1.4 cm lower and 2.1 cm forward of the hinge), which is a different rotation of a different point: the lower teeth would drift
1-4 mm off the lip, the catch the plan names.

**Depth.** The kit DOES depth-test against the SDF (kit-overlay.ts and sdf-layer.ts headers): the kit draws on the default layer
with depth writes, the march writes its depth into the target's alpha, and the composite quad feeds that to `depthNode` with depth
testing on. So a tooth polygon behind the rest face fails against the flesh and does not show, exactly as the armour's buried
inner rims do. The one caveat is the seam's resolution: the SDF layer is drawn at `sdfScale` (0.7 in the lab) and upscaled
pixelated, so the flesh's depth edge is quantised to its pixels; a tooth only millimetres behind the skin at a silhouette could
flicker through. The teeth sit 1.5-2 cm behind the lips' front and their tips inside the upper ridge, so no visibility toggle is
planned; the rest frames and a kit-vertex burial test decide it.

**What to build (the smallest mechanism).** Give the kit's `jaw` bone the SDF jaw's own transform: `pos = origin + qHead *
openAboutHinge(jawHead - pivot)`, `quat = qHead * qGape` (jaw.ts `jawOrient`), with `origin`, `qHead` and the clamped gape taken
from the same computation `headTransform` does. Then `pos + quat * (v - jawHead)` equals the jaw prims' transform for EVERY rest
point v (a rigid motion is fixed by one point and its rotation). One exported function in rig-bind.ts, used by `boneFrames` for
the `jaw` bone of a body whose bound head has a jaw, and lab-main hands `heroView.pose` the same `boundForPose` that `applyRig`
gets. No other kit has a vertex weighted to `jaw` (the bride's kit carries the bone line with no geometry on it), so no other
character can change.

### What was built

- **The mechanism** (`49d88e2f`): rig-bind.ts `kitFrames(body, bound, bodyYaw)` = `boneFrames`, except the `jaw` frame of a body
  whose rigid head has a jaw, which is computed from `headPose` (headTransform's first half, factored out unchanged: the origin with
  its bounded drift, the CLAMPED head rotation, the clamped gape). character-view.ts poses kits with it; lab-main.ts passes
  `boundForPose` (the bound with the expression's gape and morphs) to `heroView.pose`. Tests: rig-bind.test.ts (every `on jaw` prim
  endpoint of the bride and the cinematic goblin is carried exactly, 1e-9 m, at gapes 0-0.6 with the head level, nodded, past the
  cone and the body turned; every other bone and every jawless body is exactly `boneFrames`).
- **The teeth** (`f8d8e278`; `goblin-cinematic-kit.wam`, the TEETH block): 11 `sweep`s, one segment each to a point, 8 sides; 7 on `skull` (fangs
  the 2nd and 6th), 4 on `jaw`; transcribed from the SDF prims' resolved geometry (root = the prim's `a`, along its `tip` for its
  length plus the 1 mm rounded end, root radius = the prim's `r`), offsets from the .blob's pivot so they draw where the prims were.
  Material `tooth`, `#e8e2d2`, kit-overlay.ts LOOK `tooth` (dielectric, roughness 0.38, env 0.55, no glow). +121 vertices, 176
  triangles; the 849 armour vertices, normals and skin weights are byte-identical. **One side effect:** WAM bakes one texture-atlas
  cell per PART, and 27 -> 38 parts took the grid from 6x6 to 7x7, so the armour's rust/leather textures are re-baked into cells of
  146 px instead of 170 (UVs moved; texel colour at the armour's vertices differs by 1.5/255 on average, 17 at most). Not visible
  in the frames I looked at; to undo it the teeth would have to be at most 9 parts.
- **The .blob**: the 11 tooth prims are gone (the throat bar and the floor stay); the comments say where the teeth went.
  pack-golden `goblin-cinematic.blob` `fdd6c28ddf941d0d -> 2e5d52c91ee41b5a`, which is exactly the hash of the Task 13 .blob with its
  11 tooth lines deleted (checked with a scratch test before re-pinning); pack.test.ts: the prof row loses 11 zeros, and the variant
  leaves the glow allowlist (its 11 glowing prims were the teeth). The base goblin is untouched (`git diff f81e5b10 -- goblin.blob
  goblin-kit.wam goblin-kit.gltf goblin-blob.test.ts` is empty).
- **Tests** (goblin-cinematic-blob.test.ts): the SDF-teeth tests became mesh tests that read the COMPILED glTF and pose it as the lab
  does (`kitFrames` + three's skinning `pos + quat * (v - kit bone head)`, the heads from the inverse binds): 11 teeth, 7 rigid on the
  skull and 4 on the jaw; each tooth's point within 1 mm and its root ring within 0.5 mm of the old prim; **buried at rest: every
  vertex and triangle centroid at least 0.5 mm inside the flesh (measured: the worst is 1.7 mm inside)**; every upper tooth bared from
  the front at gape 0.15 and every tooth at 0.3; the grin (morphs on) still bares every upper tooth; **the drift test: a lower-tooth
  vertex (each tooth's point and a root corner) against a 1 mm SDF probe prim authored `on jaw` at the same drawn rest point, under
  `applyRig`, at gapes 0.1 / 0.3 / 0.5 with the head level, nodded 0.3, tilted 0.4 sideways, the body turned 1.1 rad, and the head
  past its cone: worst 6.5e-10 m** (the plan's bar was 0.5 mm); the upper row against a skull probe the same way inside the cone; and
  the catch itself pinned (a plain bone frame is > 1 mm off at 0.1, > 3 mm at 0.5 in the motion path; 9.6 / 47 mm in the statue
  path). The mouth-interior tests (buried, paints nothing at rest, shows at 0.3) stay SDF tests.

**Depth, verified:** the neutral frames front and 45 degrees show no tooth ([`mesh-teeth/neutral-before-after.png`](mesh-teeth/neutral-before-after.png)),
so the SDF face hides the buried mesh as the investigation expected; no visibility toggle was built.

### The number: teeth against the gap (Task 12's marker method)

Marker renders of the same shots ([`mesh-teeth/markers-grin.png`](mesh-teeth/markers-grin.png)): the mesh teeth repainted flat
magenta in the page (a `BLOB_PROBE` that sets the kit's `tooth` material black with a magenta emissive), the SDF teeth (before)
`color=ff00ff glow=1`, the throat bar and the floor `color=00ffff glow=1` in both; masks eroded a pixel; the gap is the interior
pixels inside the teeth's bounding box; Rec. 709 luma of the normal frame. Before = the Task 13 files (`7587c2a0`: SDF teeth, the
kit without teeth), after = this branch, both the cinematic goblin with the kit, `BLOB_DIST=0.3 BLOB_TARGET_Y=1.14 BLOB_PITCH=0.05`.

| shot | tooth px before -> after | tooth luma before -> after | gap luma before -> after | ratio before -> after |
|---|---|---|---|---|
| grin, front | 4758 -> 1316 | 81.9 -> 177.4 | 7.6 -> 8.2 | 10.7 -> **21.5** |
| grin, 45 degrees | 2857 -> 1003 | 93.7 -> 167.4 | 28.4 -> 22.1 | 3.3 -> **7.6** |
| shout, front | 5104 -> 1267 | 82.0 -> 170.0 | 4.4 -> 6.2 | 18.6 -> **27.2** |
| shout, 45 degrees | 2891 -> 884 | 106.3 -> 161.6 | 8.9 -> 10.6 | 11.9 -> **15.2** |

(The "before" ratios are this variant's, without sunglasses; Task 12 measured 9.4 / 2.2 on the goblin with them, 9.3 / 3.2 with the
morphs.) **Each tooth is twice as bright and the ratio is 2-2.3x better, but the teeth cover a quarter to a third of the pixels they
did.** The marker frames show why: an SDF tooth painted the flesh nearest to it too (paint is the nearest prim), so the gum around
each root and the floor round the lower teeth read as tooth; the SDF teeth also rendered at the SDF layer's 0.7 scale and looked
fatter. The mesh shows only the geometry: the same roots, lengths and radii, but as slim pointed cones.

### What the frames show ([`mesh-teeth/`](mesh-teeth/): `grin/`, `shout/`, `neutral/` frame-00 front, frame-01 45 degrees; `before-after-*.png`)

- **Grin, front:** seven separate white, sharp, pointed upper teeth over the dark gap, the two fangs longest; the lower row shows as
  three or four small bright points standing on the dark floor. Crisper and whiter than the SDF teeth, which were fat beige pegs with
  rounded ends. It reads as a row of FANGS: more evil, less "teeth in a gum". The polygons are drawn at full resolution against the
  pixelated SDF (the armour's contrast, now in the mouth).
- **Grin, 45 degrees:** the upper row hangs as white spikes under the lip, the lower tips glint on the floor; clearly readable.
- **Shout:** the upper row is a clean jagged white fringe across the box mouth; **the lower teeth are only small bright tips just
  above the lower lip and the floor's edge** (front), a couple of glints at 45 degrees. The SDF version's four "studs" were mostly
  painted floor; the real geometry sits behind the lower lip as authored. If the lower row should read in the shout, lengthen it or
  bring it 3-4 mm forward (`tooth_l*` in the .wam): owner's call.
- **Neutral:** no tooth anywhere, front or 45 degrees.
- The lower teeth sit on the floor and behind the lip in every open frame: in the statue path they would have stayed at their rest
  pose (about 4.5 cm from where the floor goes at the shout's 0.48 rad) without `kitFrames`.

### Cost (face close-up, Task 11/12 method)

Same method as Task 11/12: `__sdfLab.benchGpu()` legs (hand-stepped, 20-frame chunks with the queue full, `hiddenSteps` 0 on every
leg) on `?character=goblin-cinematic`, headless Chrome at 1380 x 820, `sdfScale` 0.7, the kit on, statue mode,
`setCam(0, 0.05, 0.3, 1.14)`, three legs per expression (`holdExpression('neutral')`, then `'grin'`) per boot. BEFORE = the Task 13
files (`7587c2a0`: the .blob with the 11 SDF teeth, the kit without teeth) copied over the working files, AFTER = this branch; the
two alternated boot by boot (order flipped each round) and the files were restored afterwards (checked with `cmp`). A cell is the
median over boots of each boot's median leg (ms per frame), with the range.

**The machine was NOT quiet for the first batch** (6 rounds; load average 3-5 at first, then up to 43 while other sessions ran: one
file read 95 ms in one boot and 191 in another), so that batch says little. The second batch (4 rounds, load 1.4-3, then 1.5 in
the last two) is the one to trust:

| face close-up | before (SDF teeth, 58 prims) | after (mesh teeth, 47 prims) | delta |
|---|---|---|---|
| neutral, quiet batch | 121.6 (119.4-123.1) | 101.0 (94.0-132.6) | **-20.6** |
| grin, quiet batch | 131.4 (129.8-149.6) | 100.1 (98.6-103.6) | **-31.3** |
| neutral, quietest two rounds (load 1.5) | 122.6 / 122.2 | 95.5 / 94.0 | -27 / -28 |
| neutral, all 10 boots (noisy) | 129.3 (119.4-170.8) | 117.6 (94.0-190.7) | -11.7 |
| grin, all 10 boots (noisy) | 141.2 (105.9-206.3) | 112.1 (98.6-174.8) | -29.1 |

So the mesh teeth give back **about 20-28 ms at rest and about 30 ms on the grin** on the face close-up, the size Task 11's
ablation put on the 11 SDF teeth (23 ms). The polygons cost nothing measurable. The absolute numbers sit above Task 11's (101 ms
then for the expression-pass head) because the machine runs hotter today; the deltas are what to read. The after-neutral range
includes one 132.6 ms boot in the quiet batch (round 2, its three legs 131.8-135.0, while the before boots either side read 119-125)
that I cannot explain beyond noise; the other three after-neutral boots read 94.0-106.5. The dark floor and throat bar (about 7 ms) are still SDF and still paid at rest.

### Open items (Task 14)

1. **The look (owner):** the teeth are now slim, white, sharp cones (the SDF prims' own radii); the SDF pegs read fatter because
   paint bled onto the gum and the SDF layer is chunkier. Stouter teeth are one number per sweep (`r=`, or a two-segment profile that
   stays wide longer) in `goblin-cinematic-kit.wam`. The lower row barely shows in the shout (tips over the lip): lengthen it or bring
   it forward if it should read.
2. **The kit's SKULL frame is not the SDF head's past the head's cone.** `boneFrames` turns the skull bone by the raw pivot->tip
   direction; the SDF face uses the CLAMPED one (and a bounded drift). Inside the cone they agree exactly (tested); outside it the
   upper teeth (and every skull-skinned kit piece on any character, e.g. the base goblin's sunglasses) would leave the face. Pre-existing;
   `kitFrames` could give the skull the same `headPose` treatment (one more line), but that changes every kit's head past the cone,
   so it is left for a decision.
3. **The armour's atlas re-bake** (27 -> 38 WAM parts, cells 170 -> 146 px): no visible change in the frames; noted in case the
   rust is ever judged up close.
4. Hiding the kit (`NOKIT=1` in the expression sheet, the BLOB_PROBE that hides SkinnedMeshes) now hides the teeth too.
5. The skip of the buried mouth at rest (Task 12's sketch) is now worth only the floor and the throat bar, about 7 ms.

## Task 13 (2026-10-15): the face rig moved to `goblin-cinematic`; the base goblin went back

Owner: "we would have a base goblin without the facial head complexity" and "the cinematic goblin has bare eyes (no
sunglasses)". **Everything below this section that says `goblin.blob` describes what is now `goblin-cinematic.blob`.**

What is where now:

| piece | where |
|---|---|
| base goblin (lab, game, first-person arms) | `goblin.blob`, `goblin-kit.wam`, `public/assets/lab/goblin-kit.gltf`, `goblin-blob.test.ts`: **byte-identical to `f81e5b10`** (`git diff f81e5b10 -- <those four>` is empty). No jaw bone, no teeth, no morphs, no expressions, the sunglasses on, the pre-expression head and cost. pack-golden `goblin.blob` is back to `41812d68d01256d7`. |
| the face rig | `characters/goblin-cinematic.blob` (`model goblin-cinematic`): the expression-pass goblin.blob as of `c3f72173`, unchanged but for its header, the model line and test references. Packs to `fdd6c28ddf941d0d`, the hash goblin.blob had before Task 13, so it IS that goblin. |
| its kit | `characters/goblin-cinematic-kit.wam` -> `public/assets/lab/goblin-cinematic-kit.gltf` (`scripts/build-wam-kit.sh goblin-cinematic`): the goblin kit with the `jaw` bone line and WITHOUT the round lenses, the ear-hook temple arms, the nose bridge and their `glass`/`black` materials (9870 -> 6792 vertices). A change to the armour in `goblin-kit.wam` has to be copied here. Since Task 14 it also carries the TEETH (mesh). |
| registry and libraries | `character-registry.ts` `goblin-cinematic` (its kit, `motionProfileFor('goblin-cinematic')` = `GOBLIN_PROFILE`, listed in motion-profile.ts `BY_NAME` because lab-main looks the profile up by name); `pose-library.ts` gives it `GOBLIN_POSES`; `expression-library.ts` keys the clips `goblin-cinematic` only (`expressionsFor('goblin')` is null). |
| tests | the expression-pass tests moved from `goblin-blob.test.ts` to `goblin-cinematic-blob.test.ts`, which also pins that the variant is the base goblin below the neck (every non-head prim and every bone but `jaw` equal), that the base goblin has no jaw/morph/hinge/head paint and keeps the ORIGINAL head profile, and that the cinematic kit has no lens/frame material. `goblin-head-profile.ts` has two probe sets (`GOBLIN_PROFILE_PROBES`, the Task 1 pins; `CINEMATIC_PROFILE_PROBES`, the Task 3b mouth re-pin); `scripts/goblin-head-profile.ts [file.blob] [--probes goblin|goblin-cinematic]` picks by the file's `model` line. `rig-bind.test.ts`'s morph block and `goblin-expressions.test.ts` read the variant; `pack.test.ts` pins both prof rows and moves the 11 glowing teeth to `goblin-cinematic.blob`. |
| captures | `?character=goblin-cinematic`; `scripts/goblin-expression-sheet.sh` shoots `goblin-cinematic` (`CHARACTER=` to change it); its kit-hidden row is off by default now (`NOKIT=1` adds it) because the kit no longer hides the eyes. |

Frames ([`cinematic/`](cinematic/), `BLOB_DIST=0.3 BLOB_TARGET_Y=1.14 BLOB_PITCH=0.05`, 8-frame turntable, frame-00 front,
frame-01 45 degrees): `cin-grin/` and `cin-neutral/` (the variant), `base/` (the base goblin, no expression). Measured in the eye
band (y 40-300, x 380-1000 of the 1380x820 frame): red-eye pixels / neutral-grey (lens and frame) pixels are base front 0 /
33067, base 45 2596 / 21628; cinematic neutral front 4155 / 1700, 45 2819 / 18; grin front 4225 / 1701, 45 2729 / 74. The
cinematic face is bare: both red eyes show from the front and nothing grey but the nose's highlight is left. The grin reads
as it did in Task 12 (the upper row and fangs over the dark gap, the lower lip pushed down into a U); the brows still barely
read even bare (Task 10's finding). The base frame shows the pre-expression mouth (the pursed, sculpted crease and the tapered
chin of `tuning/rest-before-after.png`'s "before" panel), not the expression pass's rounded lower roll.

**Adopting it in PR #47's `goblin-home`** (not on this branch): `goblin-home` is the Flat's cinematic goblin. Either point its
registry entry at `goblin-cinematic.blob` and `goblin-cinematic-kit.gltf` (and add `'goblin-home'` to `expression-library.ts`,
`pose-library.ts` and motion-profile.ts `BY_NAME` next to `goblin-cinematic`), or, if `goblin-home` has its own .blob edits,
carry the face block over: the `jaw` bone line with `hinge=0.06`, the head block from the lower lip to the teeth, the `face`
block's jaw trio and the `morph=` words, then the kit's `jaw` bone line. `goblin-cinematic-blob.test.ts` is the checklist.

## What was built

The goblin's face moves. `goblin.blob` has a `jaw` carrier bone (the bride's jaw system) with **its own hinge** (`hinge=0.06` on
the bone, y 1.1326, the lip line); the lower face (lower lip, chin, mouth corners, a dark mouth floor) rides it, and the
mouth opens AT THE LIP LINE (Task 3b: the groove is gone, an upper ridge, a cheek-fill pair, a mouth-corner pair and the floor
were added). Eleven jagged teeth (5 small upper, 2 upper fangs, 4 small lower; `color=8f8266 gloss=0.15`, brightened in Task 12) and a dark throat
bar are buried in the flesh at rest. The pure `expression.ts` turns keyed clips of five face channels (`gape`, `smile`,
`browDown`, `lipCurl`, `lid`) into a jaw gape (radians) and overrides on the goblin's authored face sheet; `blinkLid`/`withBlink`
overlay a blink on any expression. The goblin's tuning and clips (neutral, grin, scowl, shout) are data in
`characters/goblin-expressions.ts`, registered in `expression-library.ts`. The lab regenerates the 64x64 face sheet in place
only when its quantised params change (`sheetToRgba`), rides `rig.jawGape`, and has a panel section, an `__sdfLab` API and
capture env vars; the actor path takes `MotionConfig.jawGape`. No new WGSL.

## The contact sheet (final, 2026-10-14)

[`frames/index.html`](frames/index.html), made by `scripts/goblin-expression-sheet.sh` (camera 0.3 m from the mouth line,
`BLOB_DIST=0.3 BLOB_TARGET_Y=1.14 BLOB_PITCH=0.05`; the plan's 0.7 m framing makes the mouth too small to judge). Each
expression has `frame-00.png` (front) and `frame-01.png` (45 degrees), with the kit (`<name>/`, as the goblin ships) and
without it (`<name>-nokit/`; the kit is the sunglasses AND the armour, so those frames show bare shoulders). What I see:

| frame | gape (rad) | what it looks like |
|---|---|---|
| `neutral` | 0 | Closed, no tooth anywhere. A thin straight mouth line under the upper lip; the lower face is a rounded roll (see "the rest face" below). |
| `grin` | 0.204 | The upper row and both fangs hang long over a dark gap, the lower lip pushed down. Reads as a toothy snarl or leer: menacing rather than friendly, but not a SMILE: nothing turns up at the corners, and at 45 degrees the dropped lower jaw looks slack. |
| `scowl` | 0.144 | A narrower dark slit with the fang tips standing out of the row: bared, clenched teeth. With the kit on it differs from the grin by the gape alone. |
| `shout` | 0.48 | A wide dark mouth, the upper row on top, the four lower teeth as studs along the floor's front edge, the lower jaw dropped about 5 cm. Clearly a shout; the opening is a box (flat top, flat floor, straight sides). |
| `blink` | 0 | From the front: nothing (the sunglasses cover the eyes). At 45 degrees the red eye beside the lens is shut to a slit (two red texels left at its corners). Without the kit both eyes shut, each leaving two red texels at its corners. |

Teeth at rest: none shows in `neutral` or `blink`, front or 45 degrees, with or without the kit.

## Tuning by eye (Task 10)

Only numbers in `characters/goblin-expressions.ts` changed; each change carries a comment naming the frame that asked for it
(the frames are in [`tuning/`](tuning/)). Two rounds on the grin, one each on the scowl and the shout:

- **The grin's painted U** (`smileCurve 0.9 -> 0.35`, `smileWiden 0.25 -> 0.5`, `smileMouthOpen 0.01 -> 0.015`;
  [`tuning/paint-locate.png`](tuning/paint-locate.png)). Painting the grin's mouth 2.7x thick showed where it lands: at 0.9 the
  U bottomed out about 2.8 cm under the seam, ON the lower lip, a dark band across it (a second mouth whenever it shows).
  The sheet cannot paint corners ABOVE the seam (the formula pins the corners at `mouthRise` and moves the middle), so the
  best it can do is a shallow, wide U whose middle falls inside the opening and whose arms rise outside it. Honestly: at
  normal thickness those arms are lost in the grain and the cheek's shadow; I cannot see them in the final frames. The
  change mostly removes the lower-lip band.
- **The brows** (`browAngle 10 -> 25` deg per unit, `browHeavy 0.2 -> 0.3`; grin `browDown 0.35 -> 1`;
  [`tuning/brow-nokit.png`](tuning/brow-nokit.png), [`tuning/kit-hides-brows.png`](tuning/kit-hides-brows.png)). At 10 deg
  the scowl's brows were indistinguishable from the neutral's EVEN WITHOUT THE KIT (the brow ridge's own shadow swamps the
  paint); at 30 an angry slash over each eye reads. **With the kit on, the round sunglasses cover the painted brows
  completely from the front**: the brows carry nothing in the shipped look.
- **The grin's gape** (`0.28 -> 0.34`, 0.168 -> 0.204 rad; [`tuning/grin-gape-sweep.png`](tuning/grin-gape-sweep.png)): at
  0.12 rad the teeth are a stubby clenched row (a grimace), at 0.24 the fangs hang long but the side seam opens into a dark
  notch at 45 degrees; 0.204 shows the fangs' length.
- **The scowl's gape** (`0.18 -> 0.24`, 0.108 -> 0.144 rad) and **the shout's** (`1 -> 0.8`, 0.6 -> 0.48 rad;
  [`tuning/scowl-shout-gape.png`](tuning/scowl-shout-gape.png)): the scowl's fangs did not stand out from the small teeth; the
  shout at 0.6 rad dropped the lower jaw about 6 cm onto the collar, a nutcracker at 45 degrees.

`npx vitest run src/lab/sdf-zombie/characters/goblin-expressions.test.ts`: 10 passed after every round.

## Candid assessment

- **Is the grin evil?** It is menacing, not friendly, but it is not a grin: it reads as a toothy snarl or leer. Everything
  that would make it a SMILE is out of reach of numbers in `goblin-expressions.ts`: the painted brows are under the sunglasses,
  the painted mouth cannot lift its corners above the seam, and the geometry (lips, corners, cheeks) does not move except by
  the jaw's rotation. **With the kit on, the four expressions differ by the jaw and the teeth alone.**
- **The rest face is puffier than the pre-expression head** ([`tuning/rest-before-after.png`](tuning/rest-before-after.png),
  the head of `f81e5b10` rendered beside today's neutral at the same framing): before, the mouth was a sculpted, pursed,
  slightly smiling crease and the chin tapered into it; now the mouth is a thin line and the lower face reads as a separate
  rounded roll ("puck") with a crease under the lower lip, as if rolled under it; at 45 degrees the chin is a rounded blob
  rather than a taper. The head-profile pins still hold (every probe within 2.5 mm, one re-pinned), so this is shape and
  shading the probes do not see, not a silhouette change. It came with Task 3b's lip-line seam.
- **The opening is a box** from about 0.3 rad (flat top from the upper ridge, flat floor, near-vertical corner walls): the
  shout reads as a puppet's or a nutcracker's mouth rather than a lipped one.
- **At 45 degrees the side seam shows**: a dark notch at the mouth's corner in the grin and the scowl, and a thin line back
  along the cheek at big gapes.
- **The lower teeth are small**: they barely show in the grin and read as four studs in the shout.
- **The eyes and the blink** only show at 45 degrees (one red eye beside a lens) or without the kit.

## The spike and the owner's gate (Task 4, then Task 3b)

The Task 4 spike ([`spike/`](spike/), [`spike-close/`](spike-close/)) put the opening in the muzzle's bevel at the chin
(y 1.10-1.115), 2-3 cm below the lips and the painted mouth, so the teeth hid in shadow. The owner saw the same ("hard to see
any teeth ... a big bevel to make the lips"), floated big lipstick-red lips, then backtracked: "the main thing is getting a
viable toothy grin with teeth". Task 3b moved the mouth to the lip line with natural flesh lips about today's size; after it
every upper tooth shows at 0.15 rad ([`grin/NOTES-grin.md`](grin/NOTES-grin.md)).

## `eyeSquash` is dead

`blob-face-sheet.ts` declares and defaults `eyeSquash` in `FaceSheetParams`, but `generateFaceSheet` never reads it (the eye's
vertical scale is a fixed 1.25), so the goblin's authored `eyeSquash 1.70` has never taken effect. The blink uses a new `eyeLid`
param instead (default 0, so no existing sheet changes). Wiring `eyeSquash` in would change every character's eyes: an owner
decision.

## The jaw hinge is per body now

The plan assumed the bride's global `JAW_HINGE` (0.30 of the skull, her upper lip line). For the goblin that sits about 5.6 cm
above the lip line: the jaw lever hung straight down from it and opening swung the chin back into the throat (at 0.5 rad the
lower lip's middle dropped 4.7 cm and moved back 4.5 cm; at the old 0.6 rad shout the lower jaw vanished into the neck,
[`grin/old-hinge/`](grin/old-hinge/)). Task 3b added a **per-body hinge**: `hinge=<0..1>` on a `.blob` jaw bone (an error on
any other bone), carried by `blob-parse.ts` -> `BoneDef`/`ResolvedBone.jawHinge` (`resolve.ts`) -> `jaw.ts` `jawRestOf(..., hingeAt)`,
which `rig-bind.ts` and `motion.ts` both call. The goblin uses `hinge=0.06` (y 1.1326, 2 cm behind the skull axis): at 0.5 rad
the lower lip now drops 5.1 cm and moves back 1.7. Bodies without `hinge=` keep `JAW_HINGE` exactly (the bride is unchanged).

## The kit

`goblin-kit.wam` got the transcribed jaw line (`bone jaw parent=neck dir=up pitch=112 len=0.0638`, the blob's 0.083 / 1.30) and
`public/assets/lab/goblin-kit.gltf` WAS rebuilt with WAM in the jaw-bone commit (`6f550a08`): vertex data byte-identical, the only
new node `jaw`. The goblin has no kit skeleton-parity test (the bride's kit test has one); `goblin-kit.test.ts` passes.

## Frame cost (Task 11)

**The expressions made the goblin's head much more expensive: +47 ms a frame on a face close-up (54 -> 101 ms, +86%), far over
the plan's 1.5 ms line.** Nothing was trimmed (the plan says not without the owner).

How it was measured. `scripts/frame-cost.mjs` has no goblin scene (its close-up is a zombie on the game page), so this is the lab's
own `__sdfLab.benchGpu()` (hand-stepped frames, wall clock per chunk of 20 with the queue full, `hiddenSteps` 0 on every leg),
headless Chrome at 1380 x 820, `sdfScale` 0.7, the kit on, on this M3. A scratch driver booted `?character=goblin` and took three
`benchGpu` legs per camera; the BEFORE is `goblin.blob` from `f81e5b10` copied over the file, the AFTER is HEAD; boots
alternated after/before three times (load average 2-5) and the file was restored with `git checkout --` (the tree is clean).
Each cell is the median over the boots of each boot's median leg (ms per frame):

| camera | before (40 prims) | after, rest (58 prims) | after, grin | after, shout | delta at rest |
|---|---|---|---|---|---|
| face close-up (0.3 m, the sheet's framing) | 54.1 (53.9-54.2) | 100.7 (99.9-101.5) | 87.3 | 95.6 | **+46.6** |
| head (0.8 m, 45 degrees) | 42.0 (41.6-42.9) | 74.5 (74.2-75.1) | 73.4 | 64.4 | **+32.5** |
| whole body (2.4 m) | 10.1 (9.4-10.2) | 15.6 (14.6-16.1) | 13.3 | 14.1 | **+5.4** |

The boot-to-boot spread is under 2 ms for every cell; the three legs inside one boot spread more (the fastest about 10-25% under the median).
The whole-body rest leg is the first measured in each boot; its grin and shout legs read 2 ms lower, so +5.4 may be a little high.

Where it goes (an ablation, two more alternated boots of four variants, rest pose; the variant files were scratch copies):

| variant | prims | close-up | head |
|---|---|---|---|
| after (HEAD) | 58 | 99.8 | 74.7 |
| without the 11 teeth | 47 | 77.1 | 57.6 |
| without the teeth, the floor and the throat bar | 45 | 70.3 | 52.3 |
| before (`f81e5b10`) | 40 | 54.3 | 41.2 |

So on the close-up: **the teeth about 23 ms, the dark floor and throat bar about 7 ms, and the jaw split plus Task 3b's lip-line
prims (net +5) about 16 ms.** All of it is paid at rest, where the teeth and the interior are buried and draw nothing.

Cheapest trims, in order of what they would save for what they cost the look (owner's call):
1. **Skip the teeth and the interior when the jaw is shut** (gape 0 shows none of them; pinned): about 30 ms back on a close-up at
   rest, no visual change. Needs a per-prim "only when open" flag or a cull in the rig output, not a `.blob` edit.
2. A near-distance gate on the same prims (the plan's idea), on top of 1.
3. Fewer teeth (the plan's list: the two outer upper small teeth, then two lower): roughly 2 ms each on a close-up.
4. Look at why the 5 net lip-line prims cost 16 ms (overlapping blends on the face's front: they sit where every face ray ends).

For scale: the goblin is the protagonist seen in cutscenes and the screen lab (the first-person game shows only its arms), so the
close-up is the shot that matters for it, and it is a worst case (the face fills the frame).

## Task 12 (2026-10-15): brighter teeth

Owner, on the Task 10 sheet: "its better. maybe we should like light the teeth somehow or make them brighter - hard to see them
tbh". Frames in [`teeth/`](teeth/) (same framing as the sheet, ports 5301/9301).

**What changed:** the 11 teeth went from `color=8f8266 gloss=0.15` (the cultist's dirty ivory) to `color=e0d8c0 gloss=0.35
glow=0.15`: a light, near-neutral ivory (the warm key yellows it), a little more gloss, and a faint per-prim glow (15% of the
lit colour replaced by the flat albedo; free, it is a field of the prim's row). Nothing else moved: same geometry, the interior
untouched (its front-view gap is already near black, luma 9).

**Why they were dark:** the mouth is a cavity, so the field AO sits on its 0.35 floor inside it and the key reaches the teeth only
from the front; a 0.27-linear brown under that rendered at a mean luma of 26 of 255.

**The number** (`teeth/before-after-front.png`, `teeth/before-after-45.png`: before, after with the kit, after without). Tooth
pixels and gap pixels come from a MARKER render of the same shot (the teeth repainted `color=ff00ff glow=1`, the throat bar and the
floor `color=00ffff glow=1`, the file restored afterwards), each mask eroded by a pixel; the gap is the interior pixels inside the
teeth's bounding box; luma is Rec. 709 on the 8-bit frame.

| grin close-up | tooth luma before -> after | gap luma | ratio before -> after |
|---|---|---|---|
| kit, front | 26.5 -> 82.4 | 9.3 -> 8.7 | 2.86 -> **9.42** |
| kit, 45 degrees | 32.7 -> 93.4 | 34.4 -> 43.1 | 0.95 -> **2.17** |
| no kit, front | 26.6 -> 82.3 | 9.3 -> 9.6 | 2.87 -> **8.58** |
| no kit, 45 degrees | 32.4 -> 93.8 | 34.5 -> 41.3 | 0.94 -> **2.27** |
| shout, kit, front / 45 | 25.7 -> 84.8 / 35.5 -> 104.5 | 4.4 / 9.5 | 5.8 -> 17.4 / 3.7 -> 10.3 |

At 45 degrees the "gap" between the grin's teeth is not dark: it is the interior's grey specular sheen (painted prims keep the
flesh's wetness, so a near-black albedo still takes a white highlight at a grazing angle) plus a little spill from the teeth.
That is why the 45-degree ratio only just clears 2. Variants tried (`teeth/glow-sweep-front.png`, top to bottom glow 0, 0.15,
0.3, all `e0d8c0 gloss=0.35`): glow 0 gave 6.8 front but 1.98 at 45 degrees; glow 0.3 flattened the row toward a pale clump
(9.5 / 2.6). 0.15 keeps each tooth's shading and its own outline.

**What I see:** front, each of the seven upper teeth and both fangs is a separate pale peg with a dark gap on either side; the
fangs read as the longest. At 45 degrees the row is pale and visible under the overhanging lip; the gaps between teeth are grey
rather than black. In the shout the four lower teeth now read as small pale teeth along the floor instead of brown studs.
Neutral is unchanged (the teeth are buried; `goblin-blob.test.ts` still pins that no tooth paints the rest face).

## Task 12 (2026-10-15): the smile moves the face (per-prim morphs)

Owner: "we might have to distort the face further like when smiling i feel his face geometry isnt changing enough like his
chins n stuff should get wider". Approach C, minimal, as the spec's 2026-10-15 amendment describes: a `.blob` prim may carry
`morph=<channel>:<terms>` (`(dx,dy,dz)` move, `tip(...)`, `bend(...)`, `*k` radius, `*(sx,sy,sz)` axes); `morph.ts` is the pure
core; `applyRig` moves the prim's REST geometry by the channel's weight before the jaw opens and the head turns; `actuate`
returns its clamped channels as `morphs`, which the lab's statue path and the actor path (`ActorStepInput.morphs`) put on
`rig.morphs`. At weight 0 nothing moves: the morph data is never packed, `pack-golden.test.ts` did not move when the morph words
were added, and `rig-bind.test.ts` proves no-weight and zero-weight poses identical to a body without morphs (rest, open jaw,
turned body). Frames in [`morphs/`](morphs/).

**What moves on `smile`** (8 existing prims, none added; `morphs/which-prim.png` paints each a colour, neutral left, grin right):
the lower lip (blue: ends out and back, the middle sagging 7 mm under them, thinner), the mouth corners (red: up 8 mm and back
8, smaller), the chin (magenta: 12% wider, 3 mm lower), the cheek fill (yellow: up 7, out 3, bigger), the upper ridge (cyan:
ends up 2 mm, out 4) and the upper lip (orange: up 2 mm, 8% wider). The numbers and why are in `goblin.blob` ("THE SMILE MOVES
THE FACE").

**Measured** (CPU field, grin pose, gape 0.204 rad, front half-width of the head from the axis): with the morphs vs the same grin
without them, +10.5 mm a side at y 1.07, +9.5 at 1.08, +7 at 1.09 (the chin); -2.5 mm at 1.11 (the corners tuck back).
`goblin-blob.test.ts` pins more than 7 mm at 1.07-1.08, the same prims as the `.blob` without its morph words, and every upper tooth
still bared. The teeth/gap ratio of the grin (Task 12 A's method) is 9.3 front / 3.2 at 45 degrees with the kit (10.6 / 3.4
without): the curled corners close the side notch, so the 45-degree gap is darker than before.

**What I see** (`morphs/grin-before-after.png`: left the grin with only the brighter teeth, right with the morphs; rows front kit,
45 degrees kit, front no kit):

- **Front: it reads as a SMILE now.** The opening is a U: the lower lip sags in the middle and its ends turn up into the corners,
  which sit level with the upper row's roots; the upper row and both fangs hang over a dark crescent. The lower face is visibly
  wider than the neutral's (the chin ring sticks out past the cheeks). With the sunglasses on, this is the first expression whose
  mouth SHAPE differs from the others, not only the gape.
- **45 degrees:** the side notch (the dark gap at the mouth's corner) is gone; the corner turns up into a small knob with a dark
  crease round it (the corner prim against the lower lip's chamfer), and the cheek bunches above it as a separate round bump. It
  reads as a cartoon grin with jowls; the knob and its crease are the least natural part.
- **The chin is a ring.** Widening it makes the lower face read as a fat roll (the "puck" the Task 10 notes describe, wider). It
  is what the owner asked for ("chins wider"), but it is a lot of chin; `*(1.12,1,1)` is the knob to turn.
- **The shout and the scowl do not change** (no `gape`/`lipCurl`/`browDown` morphs). Two `gape` morphs to round the shout's box
  were tried (the upper ridge arched, the corners in and up, the lower lip sagging): `morphs/shout-gape-try.png` (left without,
  right with). The top stayed flat (the face block's ellipsoid makes that edge, and it cannot morph), the corners swallowed the two
  outer lower teeth, and at the grin's 0.34 gape the opening became a V. Dropped.
- `goblin-expressions.ts` needed no retune: the painted sheet's smile was already invisible in the frames, the geometry does the
  job now.

## Task 12 cost (2026-10-15)

Same method as Task 11 (`__sdfLab.benchGpu()` legs on `?character=goblin`, 1380 x 820 headless, `sdfScale` 0.7, kit on, the face
close-up `setCam(0, 0.05, 0.3, 1.14)`, the expression held with `holdExpression`), with three files alternated boot by boot:
BEFORE = `goblin.blob` at `bb702620` (pre-Task 12), AFTER = this branch's head (brighter teeth + morphs), SKIP = AFTER with the 11
teeth, the throat bar and the floor deleted (what "skip the buried teeth and interior while the jaw is shut" would draw at rest).
**The machine was NOT quiet:** another session ran an iOS simulator through part of it (load average up to 90; the same file read
98 ms in one boot and 181 in another). Ten boots per variant over three sessions; each cell is the median over boots of each boot's
median leg, with the range:

| face close-up | before Task 12 | after Task 12 | skip the buried mouth (at rest) |
|---|---|---|---|
| neutral (rest) | 121.1 (106.6-180.8) | 118.1 (98.1-140.7) | **89.5** (78.2-110.9) |
| grin | 147.1 (114.4-192.5) | 132.9 (112.7-188.1) | - |
| shout | 124.8 (114.2-183.4, 6 boots) | 118.0 (108.7-181.1, 6 boots) | - |

In the two quiet rounds (load under 3) the pairs were 128/118 vs 120/120 (rest) and 132/126 vs 126/126 (grin).

- **Task 12 itself costs nothing measurable.** At rest the geometry is identical (the morph data is not packed; the teeth only
  changed paint), and the grin with the morphs is no slower than the grin without them (if anything faster in the medians; within
  the noise). The absolute numbers sit about 20% over Task 11's 101 ms for the same "before" file: a hotter, busier machine.
- **The skip idea is worth about 29 ms at rest** on the close-up (118 -> 89.5, a quarter of the frame), the same size Task 11's
  ablation found (99.8 -> 70.3). Not implemented (owner's go-ahead needed).
- The 0.8 m head camera was also measured in the first session, but its spread (47-102 ms for one file) makes it unusable.

**Sketch of the skip (not built).** The engine already has the switch: a prim with `dead` packs `primScale.w = 2` and every field
(the shader's add fold, the carve pass, the CPU mirror) skips it without disturbing the fold order (pack.ts `W_DEAD`, used by
mid-limb severs). So: (1) a `.blob` bare word, e.g. `open` (or `when=open`), on the 11 teeth, the throat bar and the floor,
carried like `when=` to `Primitive.whenOpen`; (2) in `applyRig`, mark those prims `dead` while the face is EXACTLY neutral
(`rig.jawGape` 0 and every morph weight 0; any nonzero gape or smile brings them back that frame, so the first millimetre of
opening still shows teeth); (3) pinned by the existing buried-at-rest tests (they prove nothing changes visually) plus a new one
that every `open` prim is dead at rest and alive at gape 0.001. Two caveats: a dead row still costs the loop a flag check, so the
saving may be a little under the deletion's 29 ms (measure it the same way); and the goblin's packed bytes at rest WOULD change
(the dead flags), so `pack-golden` re-pins once, deliberately. The near-distance gate (Task 11's trim 2) would stack on top.

## How to run

- The lab: `?character=goblin` on `/sdf-lab-webgpu.html`, panel section "expression" (hold, play, blink).
- Console: `__sdfLab.holdExpression('grin', t = 10, lid = 0)`, `__sdfLab.playExpression('grin')`, `__sdfLab.blink()`,
  `__sdfLab.setJawGape(0.2)` (a hand-set gape holds until an expression is held or played), `__sdfLab.expressionNames()`.
- Captures: `BLOB_EXPR=grin npm run blob:shot -- goblin <out> 2` (`BLOB_EXPR=<name>[:<t>[:<lid>]]`, e.g. `neutral:10:1` for a
  blink); `BLOB_GAPE=0.3` for a raw gape. Use your own `LAB_VITE_PORT`/`LAB_CDP_PORT`; never the owner's 5173.
- The sheet: `LAB_VITE_PORT=5291 LAB_CDP_PORT=9291 scripts/goblin-expression-sheet.sh [outDir]` (about 3.5 minutes;
  `NOKIT=0` skips the kit-hidden row).
- Tests: `npx vitest run src/lab/sdf-zombie/expression.test.ts src/lab/sdf-zombie/characters/goblin-expressions.test.ts
  src/lab/sdf-zombie/characters/goblin-blob.test.ts`.

## Open items for the owner

1. **Is the grin evil enough?** It is a toothy snarl, not a smile (see the assessment). With the sunglasses on, only the jaw
   and teeth carry the expressions.
2. *(Task 12 built it, see "the smile moves the face"; what is left: the corner knob at 45 degrees, how much chin, the shout's box.)* **Approach C, the pre-approved per-prim morph, was NOT built.** Task 3b found the teeth read without it, and Task 10 was
   numbers only. The reasons it may still be wanted, all observed in the frames: the grin's corners do not curl up (the sheet
   cannot paint above the seam, and nothing in the geometry lifts them); the opening is box-shaped from about 0.3 rad; the lower
   teeth are small; and cheeks bunching on a smile would be the obvious next cue. The pre-approved shape: a `.blob` prim may
   declare a morph (channel + offset and/or radius scale), `applyRig` applies it by the channel's weight, `actuate` outputs
   the weights; neutral stays bit-identical.
3. **The rest face's lower jaw is puffier** than the pre-expression head ([`tuning/rest-before-after.png`](tuning/rest-before-after.png)).
   Acceptable, or should the lower lip and chin be re-sculpted toward the old taper?
4. **The brows**: tuned stronger for the no-kit look; invisible with the kit. Raise them above the lenses (`browRise` or the
   brow block), or accept that the goblin's expressions are all mouth?
5. Surprise and sneer (clip data only); the screen-emergence lab wiring after PRs #46/#47.
6. The dead `eyeSquash` (fix for every character, or leave).
7. **The cost: +47 ms a frame on a face close-up** (see Frame cost). The first trim (skip the buried teeth and interior while the
   jaw is shut) should give about 30 ms back with no visible change; it needs your go-ahead and a small engine change.
8. **Task 12:** the teeth are light ivory with a faint glow now (tooth/gap 9.4 front); the smile morphs are a first by-eye pass, judge
   `morphs/grin-before-after.png`. Task 12 cost nothing measurable; the skip of the buried mouth at rest is worth about 29 ms on the
   close-up (sketch in "Task 12 cost"), waiting for your go-ahead.
