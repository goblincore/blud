# Hand detail height maps — grip & pinch (2026-08-17)

Two small grayscale **height maps** of posed hands, baked from geometry built
headlessly in Blender 5.2. These are flesh-detail sheets meant to be projected
onto hand geometry in a shader; the consuming shader masks by alpha and divides
the sampled value by the sheet's `mean` so the *pattern* survives and the
*level* is discarded.

**Originality:** all geometry in these sheets is original work, assembled from
Blender primitives (cubes, UV spheres, cones/cylinders) by
`scripts/bake_hand_detail.py`. **No downloaded, scanned, or third-party asset
of any kind is used** — no hand models, no textures, no reference images.

## Outputs

| Path | What |
| ---- | ---- |
| `public/assets/lab/hand-detail-grip.png` | 256×256 RGBA height map, right hand fisted |
| `public/assets/lab/hand-detail-pinch.png` | 256×256 RGBA height map, left hand with cigarette |
| `public/assets/lab/hand-detail.json` | manifest: per-sheet file + mean opaque luminance |
| `docs/dev-notes/2026-08-17-hand-detail-bake/grip-preview.png` | 512px lit preview (human review only) |
| `docs/dev-notes/2026-08-17-hand-detail-bake/pinch-preview.png` | 512px lit preview (human review only) |

## Re-running

```sh
blender --background --python scripts/bake_hand_detail.py
```

Idempotent — re-running overwrites in place and the two height maps come out
**pixel-identical** (verified by hashing decoded pixels across runs). The PNG
*file* bytes shift a little because Blender stamps `tEXt` metadata chunks, and
the lit previews can differ by ≤2 levels on a couple of pixels from EEVEE's
final-sample dither; neither affects the baked sheets. Nothing in the script is
random.

The script is dual-mode. Under Blender it builds, poses, bakes and previews.
Blender's bundled Python has no PIL, so after rendering it shells out to system
`python3` running the *same file*, which recomputes the manifest with PIL:

```sh
python3 scripts/bake_hand_detail.py --manifest-only   # remeasure means only
```

## What was built

A hand is assembled in its own local frame from:

- **Palm** — rounded slab + ellipsoid dome (flat-ish inside, domed back), a
  narrower rounded wrist stub, an ulnar-head knobble on the little-finger side,
  and thenar / hypothenar muscle pads bulging on the palm side.
- **Knuckles** — one metacarpal-head ellipsoid per finger, sitting ~4 mm proud
  of the palm back on an arced knuckle line (middle highest, pinky lowest).
- **Tendons** — four extensor ridges fanning from the wrist to each metacarpal
  head, flush at the wrist and ~2 mm proud at the knuckles.
- **Fingers** — three tapered capsule phalanges per finger with joint balls,
  driven by a `digit()` chain that takes a splay angle (fan in the palm plane,
  **positive = toward the thumb**) plus a per-joint flexion angle.
- **Thumb** — three explicit links plus a nail plate.

The primitive soup is then joined and pushed through a **voxel Remesh (1.6 mm)
+ Smooth** stack, which fuses the parts into one continuous flesh surface while
preserving knuckle bumps, tendon ridges and the valleys between fingers.

### Poses

- **`grip`** — right hand closed into a fist around a **30 mm-radius** dynamite
  bundle whose axis runs along the hand's X (parallel to the knuckle line, i.e.
  "vertical" with the forearm level). Fingers flexed ~150° total across the
  three joints so they wrap the bundle; thumb folded across the outside of the
  proximal phalanges.
- **`pinch`** — left hand with index and middle near-straight and splayed into a
  V, a **4 mm-radius** cigarette clamped between them at the middle phalanges;
  ring and pinky curled loosely; thumb abducted and relaxed alongside.

The bundle and cigarette are **posing aids only**. They are `hide_render`'d for
the height bake so no prop shading bleeds into the flesh sheet. They *are*
visible in the lit previews, deliberately, so a human can see the grip read.

## Sheet axis convention — read this before wiring the projection

Each sheet is authored in **its own hand's local frame**. The two sheets are
**NOT mirror images of each other** — the two hands are separately posed and
separately baked, and both are authored thumb-toward-image-right.

```
image +X (right) = that hand's THUMB side
image +Y (up)    = WRIST -> KNUCKLES
```

So in both PNGs: **fingers and knuckles at the top, thumb toward the right edge,
wrist at the bottom.** For the left (`pinch`) hand this means the thumb is still
on the right in *its* sheet, which is the opposite of what you would get by
mirroring the right-hand sheet. Sample each sheet in the local frame of the hand
it belongs to.

**Camera:** orthographic, on the back-of-hand side looking down the hand's
back-normal (identity rotation, view axis −Z, up +Y, right +X). Ortho scale is
sized per hand so its long axis fills 92% of the frame (~4% margin).

Pixel-to-hand mapping, for `u,v` in `[0,1]²` with `v` measured **from the bottom**:

```
x_local = centre_x + (u - 0.5) * ortho_scale
y_local = centre_y + (v - 0.5) * ortho_scale
```

| sheet | ortho centre (x, y) | ortho scale | visible depth band (z) |
| ----- | ------------------- | ----------- | ---------------------- |
| grip  | (+0.0117, +0.0082) m | 0.1612 m | −0.0167 … +0.0209 m |
| pinch | (+0.0155, +0.0428) m | 0.2365 m | −0.0021 … +0.0209 m |

Because the poses have different silhouettes, the two sheets have **different
ortho scales** — the `pinch` hand has extended fingers and is much taller, so it
is baked at a coarser metres-per-pixel than the compact fist. Do not assume a
shared scale between them.

## Height encoding

- Unlit **Emission** shader — no lighting whatsoever in the sheet. Emission
  colour is driven by `Geometry ▸ Position ▸ Z` through a clamped **Map Range**,
  so the render *is* the height field, view-independently.
- **Nearest to camera = white, furthest = black.**
- View transform **Standard** (not AgX/Filmic), so values land in the PNG
  unaltered by a tone curve. Stored 8-bit values are therefore sRGB-encoded
  height; the encoding is monotonic, and the measured means below are taken on
  the stored values, so the shader's divide-by-mean works directly on what it
  samples.
- `render.film_transparent = True`: alpha 0 off the hand, 255 on it, with a
  narrow anti-aliased rim in between. **Mask by alpha** — this is load-bearing.
- **Two-pass normalisation.** Pass 1 bakes with the provisional band = the whole
  mesh bbox depth, then the render is read back and its depth histogram
  measured. Pass 2 re-bakes normalised over that measured *visible* band, so the
  sheet spans the full 0..1. The low end of the band is a **5th-percentile
  floor**, not the absolute minimum: a naive min..max band is dominated by the
  single deepest feature (the thumb crossing the fist, the curled ring/pinky),
  which flattens the entire palm into a plateau near 1.0 and leaves knuckle and
  tendon relief occupying only a few percent of contrast. Clipping the bottom 5%
  spends the range on the relief the shader actually wants. The cost is that the
  furthest-away slivers — fingertips angling away, the far flank of the thumb —
  clamp to pure black.

## Measured means (mean luminance of OPAQUE pixels only)

| sheet | mean | opaque px | luminance min…max |
| ----- | ---- | --------- | ----------------- |
| grip  | **0.779** | 28 622 | 0.000 … 1.000 |
| pinch | **0.697** | 16 614 | 0.000 … 1.000 |

These are measured with PIL after rendering, not guessed, and are what
`hand-detail.json` contains:

```json
{ "sheets": { "grip":  { "file": "hand-detail-grip.png",  "mean": 0.779 },
              "pinch": { "file": "hand-detail-pinch.png", "mean": 0.697 } } }
```

## Verification performed

- Script runs clean end to end from a fresh headless Blender, and is re-runnable.
- Both height maps and both lit previews inspected visually; each reads as a
  hand in the correct orientation (fingers up, thumb right, wrist bottom) with
  distinct knuckles, finger separation and tendon ridges.
- PIL: both PNGs are 256×256, mode RGBA, contain both fully-transparent and
  fully-opaque pixels, and their opaque luminance spans the full 0…1.
- Manifest parses, has exactly the agreed shape, and its means match PIL's
  measurement to three decimals.

---

## Update 2026-08-17 — rebaked from a REAL posed hand mesh (`pose_measure_hands.py`)

The sheets above were baked from geometry assembled out of Blender primitives. They
are now **rebaked from a real rigged hand model used as ground truth**, and the same
posed meshes also produce a capsule measurements table. New script:
`scripts/pose_measure_hands.py` (the old `bake_hand_detail.py` is superseded for
these three assets but left in place).

### Licence determination — read before touching either model pack

Two packs sit in `~/Downloads/fps hands`. They were treated very differently:

| Pack | Licence | Verdict |
| ---- | ------- | ------- |
| `first_person_hands_rigged/` | **CC-BY-4.0**, `license.txt` present (author DavidFischer, Sketchfab). Derivatives and commercial use allowed **with attribution**. | **USED.** |
| `free-fps-hands/` (incl. `source/hand.blend`, and the `free_fps-hands.glb` beside it) | **No licence file anywhere in the pack.** Terms unknown, so treated as all-rights-reserved. | **NEVER OPENED.** Not imported, not inspected, no textures taken. |

Consequences that are enforced by the script, not just by intention:

- The model is read from an **absolute path outside the repo**. Neither `scene.gltf`,
  `scene.bin`, nor any texture is ever copied in — not even to a temp dir. (The pack
  ships no textures at all: both materials are untextured, `bpy.data.images` is empty
  after import.)
- **Measurements are facts** and are freely committable — that is `hand-measured.ts`.
- The **height sheets are an adaptation**, which CC-BY permits *with credit*, so they
  now carry the attribution line. It is in `public/assets/lab/hand-detail.json` under
  a new top-level `"attribution"` key, verbatim from `license.txt`:

```
This work is based on "First Person hands rigged" (https://sketchfab.com/3d-models/first-person-hands-rigged-547a45535f0c4fe787948f7a7a6a88db) by DavidFischer (https://sketchfab.com/davidfischer) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
```

### What the import actually gives you — and why the rig is bypassed

`bpy.ops.import_scene.gltf` yields: empties `Sketchfab_model → fps-hands.fbx →
RootNode → basicRig` (scale 100), an **armature `Object_4` with 63 bones**, and two
skinned meshes — `Object_7` (4564 verts / 7966 tris, the hands + forearms) and
`Object_8` (170 verts / 186 tris, the ten **fingernails**). Bone chains are properly
named per side: `hand.{R,L}` → `palm_{index,middle,ring,pinky}` → `f_*.01/.02/.03`,
plus `thumb.01/.02/.03`, and a second disjoint `clavicle → deltoid → upper_arm →
forearm` chain that drives the arm geometry. The evaluated **rest** mesh is correct.

**The armature's rest data is not.** A spurious scale of 100 on the joint nodes leaves
every bone below the two root joints compressed ~100× toward its parent, and each
chain's `_end_` joint has a degenerate inverse-bind matrix (bogus 75-unit tails). Bone
heads therefore do **not** sit at the mesh's real joints, so rotating pose bones pivots
in the wrong places. Rest still renders fine only because `pose · rest⁻¹` is identity
at rest for *any* rest data — the error appears the moment you pose.

The glTF's `inverseBindMatrices` **are** self-consistent with the mesh: for every real
joint, `nodeGlobal @ IBM == 100·I`, and the inverse-IBM translations land inside the
mesh's own bbox, matching per-bone weighted centroids to a few mm. So the script takes
joint rest frames from `inverse(IBM)` and runs **its own linear-blend skinning** over
the glTF's `JOINTS_0`/`WEIGHTS_0`. The importer is still invoked, for the inspection
report and cross-checks.

A weights-only pivot estimator (centroid of the blend band between parent and child)
was also tried and validated against the IBMs: mean error 3.6 mm, max 8.9 mm at an
85 mm knuckle span. Good enough to sanity-check the IBMs, not good enough to pose with.

### Normalisation

Knuckle span = index MCP → pinky MCP, i.e. the two `f_*.01` joint origins. Measured in
the model's arbitrary units and scaled so that span is exactly **0.085 m**. The two
hands are very slightly different, so **each is normalised by its own span** (they are
posed, framed and baked independently anyway, so both report `knuckleSpanM = 0.085`
truthfully):

| hand | raw span | **scale factor applied** |
| ---- | -------- | ------------------------ |
| `grip` (RIGHT) | 0.04656 | **× 1.82546** |
| `pinch` (LEFT) | 0.04697 | **× 1.80969** |

The reference model contains **both** hands, so nothing is mirrored to fake a side:
`grip` is the real right hand, `pinch` the real left.

### Posing

All flexion is about the hand's own measured **across** axis A (index MCP → pinky MCP);
splay is about the back-of-hand normal B. Every sign is *measured* by probing the rig
rather than assumed, and B's sign comes from a real anatomical fact: **fingernails sit
dorsally**, so the perpendicular offset from each distal phalanx's axis to its nail
centroid points out the back of the hand (confidence ±0.95).

Two subtleties that cost real debugging time and are worth not rediscovering:

- **Rotation axes must be pre-composed against everything upstream.** Naming an axis in
  a bone's local frame lets every ancestor's tilt bend it. Cancelling the index's 22°
  rest fan tilts the MCP frame by 22°, after which PIP/DIP flexion swung out of the
  finger's column and the fist's fingertips spread **wider** than its knuckles. See
  `local_axis()`.
- **The reference hand rests with its digits fanned** (measured: index +22°, middle
  +10°). Flexion about a shared axis preserves that fan exactly, so a fist built
  straight on the rest pose is a splayed claw. `align_splay()` cancels it first.

`grip` — right hand, fist round a **vertical 30 mm-radius bundle** whose axis runs
along A (parallel to the knuckle line; that is what "vertical" means with the forearm
level). The bundle is placed tangent to the palm, then each finger is wrapped
**one joint at a time, proximal to distal**, bisecting each joint until *its own*
phalanx is tangent. (Solving a single global curl scalar stops the moment the proximal
phalanx kisses the prop and leaves the rest of the finger sticking out straight — a
cradle, not a fist.) All twelve phalanges end up 0.3–3.7 mm into the surface, which is
the deliberate `GRIP_BITE` soft-tissue press.

**The thumb does not lock over the fingers, and cannot.** Two measured facts: the rest
thumb lies **32 mm inside** a 30 mm bundle placed against this palm, so it must abduct
clear of the prop before it can do anything; and the fingers hug the prop ~40 mm from
its axis while the thumb reaches ~41 mm, so "thumb over the fingers" would need both in
the same shell 20 mm apart. Aiming at the fingers just rams the thumb through the
dynamite. It is therefore posed the way a hand really holds something this fat: the pad
is placed on a shell just off the bundle, its height along the prop **solved from the
thumb's own reach**, swung as far round toward the fingers as it can go without
touching them (+41° from dorsal) — clamping the bare bundle and closing the top of the
fist. Verified: 5 mm press into the prop, 18 mm clear of the fingers.

`pinch` — left hand, **4.5 mm-radius cigarette** clamped between index and middle. The
scissor angle is bisected until the gap between the two middle phalanges equals the
cigarette's diameter (residual 0.00 mm). Ring and pinky curl loosely, thumb relaxed.
The holding fingers are **extended by a solved 30°** because the model's rest digits sit
13–20° palmward of the palm plane; without it the cigarette's axis dived 37° out of that
plane and the frame's `+X` would no longer have been the back-of-hand normal.

### Measurement frame (per hand)

```
O  = the point on the prop's axis where the hand closes on it
     (for `pinch`, the pinch point between index and middle)
+Z = along the prop axis toward the business end
     (grip: up out of the fist;  pinch: toward the lit end)
+X = the back-of-hand outward normal (away from the palm)
+Y = Z × X
```

Right-handed by construction, metres. `+X` is reprojected perpendicular to `+Z` to make
the frame orthonormal; how much it had to move is **0.00° for `grip`** and **8.06° for
`pinch`** (the cigarette genuinely does not lie exactly in the palm plane).

**`+Y` means opposite anatomical things in the two frames**, because one is a right hand
and the other a left. Measured thumb-tip positions say which is which:

| hand | thumb tip in its own frame |
| ---- | -------------------------- |
| `grip` | (+0.0391, +0.0343, +0.1082) m |
| `pinch` | (−0.0746, +0.0756, −0.0472) m |

### Sheet axes — the mirror is inherent, not a bug

The pre-existing contract (and `hands.ts`) wants **image +X = thumb side, image +Y =
wrist → knuckles, viewed down the back-normal** for *both* sheets. For a right hand
`(thumb, knuckles, back)` is a **left-handed** triple and for a left hand it is
right-handed — so forcing thumb-right on both means exactly one sheet is a mirror of its
true back view. The script builds the bake basis from the hand's own `(A, K, B)` and
prints its determinant, so the mirror happens in one place:

| sheet | basis determinant | view |
| ----- | ----------------- | ---- |
| `grip` (right hand) | **−1** | mirrored back view |
| `pinch` (left hand) | **+1** | true back view |

The **measurements table is NOT mirrored** — it is true geometry in the frame above.
Only the sheets carry the flip.

### Height encoding change — clamped floor

Same recipe as before (unlit Emission, `Geometry ▸ Position ▸ Z` through a clamped Map
Range, view transform Standard, `film_transparent`, prop excluded, two-pass
normalisation), with two changes:

- **The floor is clamped.** The previous bake let the darkest regions go to near-black,
  which stained the flesh in the consuming shader. The **stored (sRGB-encoded)** range
  is now **0.35 … 1.0**, so the Map Range's *linear* floor is
  `srgb_to_linear(0.35) = 0.1004`. Measured minimum opaque luminance: **0.345** on both
  sheets.
- **Both histogram ends are clipped** (34th percentile floor, 99th ceiling, was a 5th
  percentile floor only). The relief worth having — knuckle bumps, extensor tendons —
  occupies ~8 mm of the ~50 mm the posed hand spans front-to-back, so the old band spent
  the contrast on the fingers wrapped round the far side and left the back of the hand a
  flat white plateau.

### Measured means and half-scales

Means are mean luminance over **fully opaque pixels only**, measured with PIL after
rendering. `halfScaleM` is the **orthographic half-extent in metres**, in the same
normalised units as the measurements table — i.e. the sheet spans ±`halfScaleM` about
its centre. **The camera is SQUARE**: 256×256 at a single `ortho_scale`, so the half
extent is identical on the image X and Y axes. Consumers projecting through
`halfExtent` should use this number for *both* the `w` and `u` extents.

| sheet | mean | **halfScaleM** | ortho scale | opaque px | luminance min…max |
| ----- | ---- | -------------- | ----------- | --------- | ----------------- |
| `grip` | **0.631** | **0.08629 m** | 0.17258 m | 34 846 | 0.345 … 1.000 |
| `pinch` | **0.593** | **0.12909 m** | 0.25818 m | 18 321 | 0.345 … 1.000 |

```json
{ "sheets": { "grip":  { "file": "hand-detail-grip.png",  "mean": 0.631, "halfScaleM": 0.08629 },
              "pinch": { "file": "hand-detail-pinch.png", "mean": 0.593, "halfScaleM": 0.12909 } },
  "attribution": "This work is based on \"First Person hands rigged\" …" }
```

### Outputs

| Path | What |
| ---- | ---- |
| `src/lab/sdf-zombie/hand-measured.ts` | capsule measurements table, data only |
| `public/assets/lab/hand-detail-{grip,pinch}.png` | 256×256 RGBA height maps (overwritten) |
| `public/assets/lab/hand-detail.json` | means + `halfScaleM` + `attribution` |
| `docs/dev-notes/2026-08-17-hand-detail-bake/{grip,pinch}-preview.png` | 512px lit previews (overwritten) |

```sh
blender --background --python scripts/pose_measure_hands.py
blender --background --python scripts/pose_measure_hands.py -- --debug-views  # extra angles to /tmp
python3 scripts/pose_measure_hands.py --manifest-only                        # remeasure means only
```

### Verification performed

- Script runs clean end to end from a fresh headless Blender, **twice**, and is
  idempotent: both height maps come out **pixel-identical** across runs (sha256 of
  decoded pixels) and the log is byte-identical. Nothing in it is random; every angle is
  either a fixed constant or the result of a fixed-iteration bisection/scan.
- Both height maps **and** both lit previews inspected visually. The fist's four fingers
  are visibly closed on the cylinder with the thumb clamping its top; the cigarette is
  visibly held between index and middle and protrudes past the fingertips. Both sheets
  read as a hand with knuckles up, thumb right, wrist bottom.
- PIL: both PNGs are 256×256 RGBA, contain both fully-transparent and fully-opaque
  pixels, opaque luminance min 0.345 ≥ 0.30, and the JSON means match PIL to 3 dp.
- `npx tsc --noEmit` passes with `hand-measured.ts` in place (strict, no `any`).
- Measurements sanity-checked: no NaN/inf; all radii positive and within **9.8–39.8 mm**
  (inside the plausible 3–60 mm band); `fist` (33.5 mm) and `palm` (33.9 mm) larger than
  every digit segment in their pose.

#### The `0.030 + radius` check, and its four legitimate exceptions

For `grip`, digit segments wrapped **on** the bundle should sit at roughly
`0.030 + their own radius` from the +Z axis. Measured deltas:

| segment | end | dist | expected | delta |
| ------- | --- | ---- | -------- | ----- |
| `knuckleRidge` | a | 52.7 | 43.8 | **+8.9** |
| `knuckleRidge` | b | 42.7 | 43.8 | −1.1 |
| `fingerWrap` | a / b | 39.0 / 38.0 | 43.3 | −4.3 / −5.2 |
| `fingerTips` | a / b | 39.4 / 39.7 | 42.8 | −3.4 / −3.0 |
| `thumbBase` | a | 73.7 | 45.3 | **+28.3** |
| `thumbBase` | b | 38.7 | 45.3 | **−6.6** |
| `thumbTip` | a | 38.7 | 39.8 | −1.1 |
| `thumbTip` | b | 52.0 | 39.8 | **+12.2** |

All units mm. The wrapped rows land 3–5 mm *inside* the ideal shell for two reasons:
`radius` is the **mean** distance to the surface while contact happens at the **closest**
surface point, and the deliberate soft-tissue press is another 0.3–3.7 mm. The four
flagged rows are not violations:

- `knuckleRidge` a — the index knuckle is on the **dorsal outside** of the fist and is
  not wrapped on the prop at all, so it belongs further out.
- `thumbBase` a — the thumb's CMC joint sits in the **thenar mass** at the far side of
  the palm, ~74 mm from the bundle axis. Nothing about it should touch the prop.
- `thumbBase` b / `thumbTip` b — the thumb runs **up** the bundle and past the gripped
  zone, angling outward above the fist, so its far end leaves the shell. `thumbTip` a
  (−1.1 mm) is the pad, and that one sits on the shell exactly as expected.
