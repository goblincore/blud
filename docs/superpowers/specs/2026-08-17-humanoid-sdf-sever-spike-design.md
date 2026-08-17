# Textured Humanoid SDF Forearm-Sever Spike Design

**Date:** 2026-08-17
**Status:** Approved design, pending implementation plan

## Purpose

Prove that a detailed, rigged, source-textured humanoid can be converted into
bone-local signed-distance volumes without losing the qualities that make the
existing procedural SDF zombie compelling: seamless organic joints, live
wounds, soft latex-like motion, and convincing volumetric severing.

The prototype is deliberately narrower than the complete zombie replacement.
It renders the full humanoid in a dedicated WebGPU page, exposes one controlled
right-elbow articulation, and performs one classic mid-forearm sever. It is a
decision gate for the production character pipeline, not a walking or combat
feature pass.

## Owner-created source asset

The canonical input comes from `/Users/donny/Downloads/zombietest2/`. It is an
owner-created zombie model with a rigged GLB, source textures, and Blender
working files. The implementation plan must inspect the available exports and
select the coherent rigged+textured GLB rather than guessing from a truncated
Finder filename.

The selected source GLB and the generated distance/color atlases will be
committed. Normalize the committed source name and record its original
filename, byte length, and SHA-256 in the generated manifest. Do not overwrite
or edit the files in Downloads.

## Product decisions

- Use a weight-partitioned, bone-local volume atlas rather than one monolithic
  body volume.
- Use the model's source texture in the first live prototype; generic clay-only
  shading is insufficient for the acceptance question.
- Build a separate `humanoid-sdf-spike.html` page while reusing the existing
  WebGPU marcher, camera, lighting, and gib-physics modules.
- The first articulation control is a 0–100 degree right-elbow scrubber, not a
  walk animation.
- The first damage interaction is a button-triggered mid-forearm sever, not
  click-to-shoot.
- The detached hand and distal forearm inherit instantaneous motion, then fall
  and tumble under the existing gib physics.
- A broad flesh-softness control must span rigid through exaggerated latex so
  the owner can judge whether baking retains the desired SDF feel.
- Atlas memory and offline bake time are diagnostic, not initial rejection
  gates. Do not silently lower fidelity to hit an arbitrary asset-size target.
- Pressing the sever button must not compile a material/pipeline or create the
  detached renderer for the first time. The no-pause requirement is a hard
  gate even while general performance optimization is deferred.

## Offline pipeline

### Canonical bind-pose import

The baker loads the normalized rigged GLB and validates one coherent skinned
character. It may contain multiple primitives only when they share the same
skeleton and bind space. Joint indices, inverse bind matrices, normalized
vertex weights, UVs, and a readable base-color texture are required.
Unsupported or missing data is a hard error with the mesh, primitive, or
accessor named in the message. The baker never substitutes a static mesh or an
untextured material because either fallback would invalidate the experiment.

All spatial output uses metres and one documented right-handed coordinate
convention. The manifest records the source-to-runtime basis and per-bone bind
matrices explicitly.

### Weight-derived bone partitions

Each source triangle contributes to its dominant bone-local surface. Adjacent
parent/child regions also retain a narrow duplicate overlap derived from the
two leading skin weights. Joint boundaries are placed from the equal-influence
cross-section along the measured limb axis, not from overlapping spherical or
capsule masks.

For the right elbow, use the previously validated planar strategy: a 30 mm
axial overlap centred on the weight-derived boundary. Both the upper-arm and
forearm partitions include this band. The baker emits joint landmarks and
coverage diagnostics so the runtime does not invent a separate elbow point.

The same algorithm is applied to all bones needed to reconstruct the visible
body. Tiny helper, twist, or zero-area bones may be folded into their nearest
deforming parent only through a deterministic named rule recorded in the
manifest. The right upper arm, right forearm, and right hand may never be
folded together because their independent transforms and sever mask are the
core experiment.

### Distance bricks and atlas packing

Each bone-local partition is voxelized inside a tightly cropped brick with a
positive exterior margin and padding sufficient for trilinear sampling. The
initial target pitch is at most 6 mm for torso and limb masses and at most 3 mm
for the head and hands. The baker may choose a finer pitch. It may not choose a
coarser pitch without stopping and reporting measured dimensions and the visual
reason for requesting a design change.

Distance is stored as R16F. Bricks are packed deterministically into the
smallest supported 3D atlas container that satisfies padding and the target
adapter's `maxTextureDimension3D`. The manifest records, for every brick:

- bone name and joint index;
- atlas offset, dimensions, padding, and page index;
- local bounds and voxel pitch;
- bind and inverse-bind transforms;
- parent/child joint landmarks and overlap bands;
- occupied bounds and signed-field validation results.

The first implementation should use one distance-atlas page when it fits. If
the validated bricks cannot fit one supported page, the baker must fail with
the required dimensions rather than silently reducing resolution. Multi-page
runtime support is a follow-up design decision, not an implicit fallback.

### Textured color bricks

The color atlas uses the same brick layout as the distance atlas and stores
RGBA8 source color. For each voxel in the surface extension band, the baker
finds the closest source triangle for that bone partition, calculates
barycentric UV, and samples the GLB base-color texture. Nearest-surface color
is extended through the small inside/outside sampling band so trilinear reads
remain stable during deformation.

The manifest hashes the source GLB, source texture payload, distance atlas,
color atlas, and all bake parameters. Re-running the baker against identical
inputs must reproduce byte-identical manifests and atlases.

## Runtime architecture

### Dedicated spike page

`humanoid-sdf-spike.html` owns only the prototype scene and compact controls.
It reuses existing renderer setup, lighting, camera conventions, SDF shader
helpers, and Rapier/gib stepping where those modules are already separable. It
must not duplicate the entire current lab or add humanoid-only behavior to the
normal game entry point.

The page contains:

- right-elbow angle scrubber, 0–100 degrees;
- flesh-softness slider with a documented rigid-to-latex range;
- **Sever Forearm** button;
- **Reset Arm** button;
- **Pause Physics** checkbox for cut-surface inspection;
- a small status/readout region for backend, asset state, angle, sever state,
  physics state, and last-frame timing.

### Clustered bone sampling

Rendering one body-map sample across every bone for every ray step would make
the spike needlessly expensive. Instead, construct spatial body clusters using
the existing lab's cluster/bounds patterns. Each cluster samples only its
member bones and the adjacent joint bones needed for a smooth boundary.

The right-arm cluster includes the shoulder/upper arm, forearm, and hand. It
therefore evaluates the elbow union and the mid-forearm cut inside one marched
field. Other clusters may remain in bind pose during this spike. Cluster proxy
bounds must expand for the complete 0–100 degree elbow sweep and the configured
surface deformation so the arm cannot be clipped by its proxy.

Per-frame bone transforms are uploaded through fixed-size uniforms or storage
already allocated at load. No per-frame material, texture, geometry, or typed-
array allocation is allowed in the elbow or sever path.

### Distance and color composition

Each bone sample transforms the world point into that bone's bind-local brick,
samples its distance, and applies bone-local surface deformation. Adjacent
bones are joined with a conservative smooth minimum inside their manifest
overlap band. Outside a joint band, composition uses a hard minimum so fingers,
face detail, clothing edges, and distant anatomy are not globally blurred.

Color follows the same local samples. Joint color is blended using the same
distance/overlap weights that produced the surface union. Texture may not
switch abruptly at a bone boundary or swim when the elbow moves.

## Articulation and flesh softness

The elbow scrubber sets a target flexion between 0 and 100 degrees around the
rig's measured elbow axis. At zero softness the runtime reaches that target
without secondary lag. Increasing softness lowers the critically damped
angular response and increases a bounded, low-frequency bone-local domain
warp.

The softness control affects three related cues:

- modest acceleration lag while the attached arm follows the scrubber;
- a few millimetres of rest-space surface wobble that remains continuous
  across overlap bands;
- stronger impact-excited deformation on the detached piece, decaying toward
  rest, with a subtle settling pulse at the torn cap.

This is not a soft-body solver. Rapier owns the detached piece's rigid-body
translation, rotation, contacts, and sleep state. The shader adds bounded
visual deformation driven by acceleration/impact impulses. The highest slider
value may be intentionally exaggerated for diagnosis; the default is moderate.

## Mid-forearm sever

### Complementary cut masks

The sever location is a named plane in right-forearm bone-local space,
positioned through the middle portion of the forearm rather than at the elbow.
The attached and detached renderers sample the same forearm brick with
complementary half-space masks:

- the attached body retains the proximal forearm and removes the distal side;
- the detached piece retains the distal forearm plus the hand and removes the
  proximal side.

The masks share one plane and irregularity seed, guaranteeing coincident cut
geometry without duplicating or rebaking the atlas. A narrow analytic torn rim
wraps each opening. The new interior uses explicit layered flesh material:
skin edge, wet red tissue, and a darker central depth. Source exterior texture
never stretches across the cut cap.

The irregularity is deterministic in forearm-local coordinates and small
enough that the two complementary pieces neither overlap visibly nor leave a
gap. Cap deformation may pulse after severing but must remain complementary.

### Ownership transfer and physics

Before severing, the attached body owns all right-arm volumes. On the sever
frame, the runtime snapshots the forearm and hand transforms relative to a
pre-created detached root, plus their linear and angular velocities. It then
activates the hidden, pre-warmed detached view/collider and enables the
complementary masks.

After transfer:

- the proximal stump continues following the animated upper arm/elbow;
- the distal forearm and hand stop following live skeleton transforms;
- Rapier advances the detached root;
- the internal forearm-to-hand relationship remains frozen at the sever pose;
- reset disables and re-parks the detached object, restores the intact masks,
  clears impulses, and returns the elbow to its inspectable initial state.

The first sever after a clean page load must behave identically to subsequent
severs. All render pipelines, materials, proxies, physics bodies, and shader
variants used by severing are constructed and warmed before the control is
enabled.

## Failure handling

- WebGPU or required texture-feature failure displays a clear blocking message;
  the page does not silently fall back to a mesh renderer.
- Source/manifest/hash mismatch is fatal and names the mismatched artifact.
- Invalid brick bounds, non-finite transforms, missing bone mappings, or a
  non-manifold/sign-invalid field fail before GPU upload.
- If the target adapter cannot hold the atlas at approved pitch, report the
  required dimensions and stop. Do not coarsen automatically.
- If the detached object cannot be pre-created or warmed, disable the sever
  button and surface the reason rather than allowing a first-use freeze.

## Validation strategy

### Offline deterministic gates

- Re-import and bake are byte deterministic.
- All distance bricks contain finite values, a negative interior core, and a
  positive padded boundary.
- Manifest dimensions, byte lengths, hashes, bone names, transforms, atlas
  offsets, and pitches agree with checked-in files.
- Every mapped surface sample has valid UV/color and no uninitialized color
  band reaches the zero isosurface.
- Parent/child overlap coverage remains non-empty through the full elbow sweep.
- Planar joint diagnostics reject capsule-like overlap that causes the forearm
  to impale the upper arm.

### Runtime and pure tests

- Elbow transforms are finite and continuous at 0, intermediate angles, and
  100 degrees.
- Cluster bounds contain every sampled brick across articulation and maximum
  configured deformation.
- Joint blending is restricted to declared overlap bands.
- Cut masks are complementary and share the same plane/seed.
- Sever ownership transfers exactly once and reset is idempotent.
- Detached position/orientation is continuous on the sever frame.
- Pipeline/material creation counters do not change when sever is pressed.
- Source texture samples remain stable on landmark points across articulation.

### Mandatory live visual gate

Capture a deterministic contact sheet containing:

1. textured bind pose;
2. elbow at 0 degrees;
3. elbow at 50 degrees;
4. elbow at 100 degrees;
5. moderate-softness motion frame;
6. pre-sever mid-forearm;
7. sever frame with both matching cut surfaces visible;
8. detached piece in flight;
9. first ground impact;
10. settled detached piece and animated proximal stump.

Reject the spike if any capture shows elbow impalement, a dark/light joint
crease, volume pumping, a texture seam or swimming, a rigid-looking detached
piece at moderate softness, a sever pop, mismatched cut profiles, a hollow cap,
or a physics piece that remains attached to the skeleton.

The exact input and camera sequence must be scriptable so later bakes can be
compared to the same frames. Numeric image checks may verify component
continuity, occupied bounds, and texture landmarks, but the owner retains the
final organic/fleshy appearance gate.

### Performance evidence

Report load time, bake time, atlas dimensions/bytes, steady GPU timing, and
sever-frame timing. General steady-state performance is diagnostic during this
spike. The hard interaction gate is that no sever frame exceeds 50 ms because
of first-use allocation or pipeline compilation; an ordinary
physics/render fluctuation must be distinguished from a deterministic first-
use stall.

## Acceptance criteria

The spike passes only when all of the following are true:

- the committed owner-created rigged zombie is reproduced as a recognizable,
  source-textured SDF humanoid;
- the right elbow scrubs continuously from 0 to 100 degrees without a visible
  seam, impalement, collapse, or texture discontinuity;
- the flesh-softness range visibly spans rigid through exaggerated latex, with
  a useful moderate default;
- a button-triggered mid-forearm sever produces complementary, layered fleshy
  cut surfaces with no pop or gap;
- the detached hand/forearm inherits motion, becomes physics-owned, tumbles,
  deforms on impact, and settles while the proximal stump remains animated;
- reset is repeatable and the first sever is as smooth as later severs;
- severing introduces no on-demand pipeline/material compilation and no
  deterministic frame over the 50 ms interaction gate;
- deterministic baker, manifest, runtime, typecheck, build, and live capture
  gates pass;
- the owner accepts the resulting textured silhouette and fleshy motion before
  the architecture is promoted into the main zombie lab.

## Explicitly deferred

- walking/running clip playback and full locomotion;
- generalized arbitrary bullet targeting or click-to-shoot;
- torso blasts, multiple simultaneous wounds, and whole-body gib chains;
- production atlas compression, streaming, paging, or LOD;
- full soft-body physics;
- integration into the game or replacement of the current procedural zombie;
- final material art direction beyond proving stable source texture plus live
  flesh/wound overrides.
