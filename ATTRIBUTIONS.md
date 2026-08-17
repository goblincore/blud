# Third-party attributions

Credits that must travel with Blud wherever it is shared, including in the
shipped game's credits screen. One section per third-party work.

Everything else in this repo is original work. **Extracted Blood (1997) assets
are dev placeholders only** — they are gitignored, never committed and never
shipped (see `CLAUDE.md`), so they carry no attribution here.

---

## First Person hands rigged — DavidFischer (CC-BY-4.0)

**Required credit (verbatim, as the model's `license.txt` specifies):**

> This work is based on "First Person hands rigged"
> (https://sketchfab.com/3d-models/first-person-hands-rigged-547a45535f0c4fe787948f7a7a6a88db)
> by DavidFischer (https://sketchfab.com/davidfischer) licensed under CC-BY-4.0
> (http://creativecommons.org/licenses/by/4.0/)

- **Licence:** [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) —
  attribution required, derivatives allowed, commercial use allowed.
- **Author:** DavidFischer — https://sketchfab.com/davidfischer
- **Source:** https://sketchfab.com/3d-models/first-person-hands-rigged-547a45535f0c4fe787948f7a7a6a88db

### What in this repo derives from it

The model is posed in headless Blender by `scripts/pose_measure_hands.py` and
used as ground truth for the SDF lab's first-person hands, in two ways:

1. **`public/assets/lab/hand-detail-{grip,pinch}.png`** — greyscale height
   sheets rendered from the posed mesh, projected onto the marched hand flesh
   for relief. These ARE a derivative work, and they are the reason this
   attribution exists.
2. **`src/lab/sdf-zombie/hand-measured.ts`** — capsule measurements (axis
   endpoints and cross-section radii) taken off the posed mesh, from which the
   SDF prim silhouettes are built. Measurements are facts about dimensions
   rather than copyrightable expression, so this file would carry no obligation
   on its own; it is listed for honesty about provenance, not because the
   licence compels it.
3. **`public/assets/lab/hand-sdf-relaxed-r.r16f` (+ its `.json` manifest)** —
   a signed-distance volume baked from one relaxed right-hand pose of the same
   mesh by `scripts/bake_hand_sdf.py` (X1.26). The volume reproduces the mesh's
   surface shape in sampled form, so it is a derivative work and carries this
   attribution, embedded verbatim in the manifest's `attribution` field as
   well. **`docs/dev-notes/2026-08-17-sdf-hand-bake/mesh-preview.png`** is a
   neutral render of the same posed mesh taken during the bake and is covered
   by the same credit.

### What does NOT derive from it

- **The model itself is never redistributed.** No mesh, `.bin`, `.gltf`,
  `.glb`, `.usdz` or texture from the pack is committed to this repo, and
  `scripts/pose_measure_hands.py` reads it from a path outside the repo.
- The hand prim *language*, poses, gestures, props, jiggle and shading are
  original.
- `src/lab/sdf-zombie/webgpu/hands-sheet.ts` ships a **procedural fallback**
  pair of sheets, drawn from authored stroke data with no third-party input.
  Deleting the two PNGs above activates it and removes this obligation
  entirely, at the cost of cruder relief.

### Not used

A second pack (`free-fps-hands`, including `source/hand.blend` and its
textures) was available locally but contains **no licence file anywhere**,
including inside its archive. Its terms are therefore unknown, it is treated as
all-rights-reserved, and **nothing in this repo derives from it** — it was never
imported, opened or measured.

---

## Dynamite bundle — DJMaesen / bumstrum (CC-BY-4.0)

**Required credit (verbatim, as the model's embedded asset metadata specifies):**

> This work is based on "Dynamite bundle"
> (https://sketchfab.com/3d-models/dynamite-bundle-6d333be39e454b458d48ad86f8a78df4)
> by DJMaesen (https://sketchfab.com/bumstrum) licensed under CC-BY-4.0
> (http://creativecommons.org/licenses/by/4.0/)

- **Licence:** [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) —
  attribution required, derivatives allowed, commercial use allowed.
- **Author:** DJMaesen (https://sketchfab.com/bumstrum)
- **Source:** https://sketchfab.com/3d-models/dynamite-bundle-6d333be39e454b458d48ad86f8a78df4

### What in this repo derives from it

1. **`public/assets/lab/dynamite-bundle-grip.glb`** — one derived,
   self-contained runtime prop produced by `scripts/author_dynamite_grip.py`
   (X1.27). Permitted modifications applied to the downloaded original:
   - wrapper-node transforms collapsed, geometry joined;
   - rescaled deterministically (long axis 0.32 m, larger transverse axis
     0.074 m) and re-seated on its mesh-bounds centre;
   - named anchor nodes added (`FlightPivot`, `GripAnchor`, `FuseTip`);
   - embedded textures resized to at most 512×512.
   The authored PBR material is preserved.
2. **`public/assets/lab/dynamite-bundle-grip.json`** — the machine-readable
   prop contract (hashes, dimensions, contact hull, anchors, this credit)
   consumed by the pose authoring stage and the runtime clip loader.
3. **`docs/dev-notes/2026-08-17-sdf-dynamite-grip/`** — preview renders of the
   derived prop and of hand poses solved against it.

### What does NOT derive from it

- **The downloaded original is not redistributed.** It stays at a path outside
  the repository and is only read by the authoring script; only the derived
  GLB above (with modified scale, transforms and texture sizes) is committed.
