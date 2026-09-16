# Settled gib appearance repair — 2026-09-15

The bake remains enabled. The mesh now carries the source flesh display mode,
wetness, specular exponent/intensity, fresnel and rest-local detail anchor through
the worker. Lighting follows the current flashlight on both sides of the swap.
Both renderers also paint broad dark clot patches on detached meat.

## Findings

- The march applies its legacy sRGB EOTF after lighting; the mesh omitted it.
  This lifted low channels and desaturated the material when Three encoded output.
- The mesh used a fixed broad highlight amplified by flashlight key intensity.
  The march weights its source roughness/specular highlight by wetness instead.
- Skin relief largely comes from the derivative of `fbm(anchor * 3) * marchCfg.z`.
  Copying only the much smaller fine-normal term did not reproduce that relief.
  The mesh now evaluates the noise gradient per fragment, without marching a field.
- `bakeData()` discarded every subtractive primitive, including the blast caps.
  The CPU field already supports them. Keeping them preserves the cut silhouette.
- Live detached views copied flashlight pose only at spawn; their beam now updates
  at draw time, including when simulation is locked.

The previous handoff's empty-torn-list diagnosis was misleading: `gibParts`
intentionally uses cap carves instead of torn-end spheres. Adding wound spheres
would remove the caps. The additional dark patches are material stains, applied
in both albedo paths without altering geometry or inventing a wound mask.

## Same-pose comparison

`scripts/sdf-gib-bake-parity.mjs` detonates a seeded zombie, settles and bakes 12
flesh pieces, locks simulation, then alternates the retained SDF proxies and mesh
at the same poses. It waits for GPU work, saves the presented canvas, checks browser
errors and verifies both references cover at least 1,000 foreground pixels.

| Camera | Shared foreground pixels | Live mean RGB | Baked mean RGB | Mean absolute channel error |
| --- | ---: | --- | --- | ---: |
| Front | 13,171 | 189.7 / 120.0 / 126.9 | 188.3 / 114.8 / 121.7 | 36.39 / 255 |
| Side | 11,189 | 154.9 / 96.0 / 100.7 | 149.2 / 91.6 / 96.1 | 30.56 / 255 |

Both runs: WebGPU, 12 completed bakes, zero runtime/rendering errors. VHS is off
for inspection; the game's default SDF/upscale settings are retained.

[Live front](live.png) · [Baked front](baked.png) ·
[Live side](live-side.png) · [Baked side](baked-side.png)

The mean colour now stays close across the transition; the baked pieces are
slightly darker. This is **not pixel identity**: mesh interpolation, per-primitive
SDF noise frames versus a chunk-local mesh frame, noise arithmetic, and the
existing approximate ambient/AO differ. Field-based scattering and wound shadow
are still not reproduced by the mesh. No GPU performance claim is made.

## Reproduce

Run from this worktree with Node 22:

```sh
export LAB_VITE_PORT=5418 LAB_CDP_PORT=9418
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up
node scripts/sdf-gib-bake-parity.mjs 5418 9418 /tmp/gib-parity
SIDE=1 node scripts/sdf-gib-bake-parity.mjs 5418 9418 /tmp/gib-parity-side
```

`__sdfGame.setBakedChunkReference(true)` displays retained SDF views for existing
bakes; `false` restores their meshes. This diagnostic is off by default. It does
not disable baking or allocate another set of views.

Do not force `setSdfScale(1)` in this rig while the default upscaler is active:
that configuration produced missing SDF coverage and invalid comparisons.

## Verification

- Production build and TypeScript checks passed.
- Focused tests cover source response and noise anchors through worker transfer,
  retained cap geometry, and dark stain variation without artificial wounds.
- Full suite under the default shell's Node 25.9.0: 328/329 files passed;
  5,162 tests passed and 11 failed, all in the existing `panel.test.ts` storage
  tests. Node 25 exposes a global `localStorage` without working methods in
  this environment (`localStorage.clear is not a function`).
- Re-ran that entire panel file plus five affected gib test files under Node
  22.22.1: all 6 files / 69 tests passed. This verifies the environment-specific
  failures separately; it is not a claim of a single green full-suite run.


## Follow-up: preserve the face

The settled mesh had no face texture binding at all. It now samples the original
actor atlas per fragment, using a projection snapshot taken at the swap. The face
colour, alpha, projection mode, relief, and eye-glow mask use the same
`FACE_LAYER_WGSL` source as the live march. Texture detail is not reduced to the
mesh's 1 cm vertex colours. Each textured head owns a small material instance;
the actor continues owning the atlas.

Two upstream issues were also corrected: live head gibs forced every face into
multiply mode and replaced the skull projection axes with the chunk's spherical
extent; their face frame did not rotate with the tumbling chunk. They now retain
the source mode/axes/centre and compose its rotation with the chunk's rotation.
Recycled view slots also receive their new actor's appearance instead of retaining
the original actor's template.

[Live head close-up](head-live.png) · [Baked head close-up](head-baked.png)

The seeded head capture uses the real blast/settle/worker path, then zooms toward
its actual face orientation. Across 25,663 shared foreground pixels, mean RGB is
150.7/88.9/94.7 live and 152.6/89.9/95.5 baked; channel MAE is 38.54/255. Facial
features remain aligned, while the previously documented shading/noise
approximation remains. No runtime/rendering errors were reported. Recycling the
head reduced registered materials from 2 to 1, confirming its owned material is
released. Reproduce by adding `HEAD=1` to the capture command above.

Follow-up validation: TypeScript and production build passed; 6 focused test
files / 292 tests passed under Node 22, including face frame rotation, source mode,
source atlas replacement on recycling, and the march shader regression suite.
The full-suite figures above are from the earlier shading repair, not a second
full-suite run after this follow-up.


The optional deferred check rendered the textured baked head, but its live SDF
reference failed to compile (`unresolved value gMarchAnchor`). That assignment
and its helper dependency setup also exist in the starting commit. The
comparison correctly failed its foreground-coverage check; this follow-up does
not claim deferred parity. The default forward renderer passes the capture.

## Owner review — 2026-09-16

The owner manually tested and accepted the current gib appearance, including
the face preservation. Further appearance polish is deferred.

Follow-ups explicitly left for later: pieces sometimes appear to float after
exploding or settle with limbs sticking upright; arms and legs should each
break into two shorter pieces rather than remain single long tubes. Root causes
of the settling problem have not been investigated. The separate body-to-gib
rupture/tearing transition remains the next main visual topic.
