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
