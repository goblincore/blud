# X1.27 Baked-SDF Dynamite Grip and Underhand Release — Design

**Date:** 2026-08-17  
**Status:** owner-approved design; implementation plan not yet written  
**Depends on:** X1.26 baked-hand owner gate pass  
**Owner gate:** the hand must visibly close around, carry, and underhand-release
a correctly scaled dynamite bundle without snapping, floating, melting, or a
discontinuous hand-to-flight transfer

## Why this slice exists

X1.26 proved that a signed-distance texture baked from the licensed hand mesh
can read immediately as a proper first-person hand. Its intentionally static,
open-ish pose cannot yet participate in the lab's dynamite interaction. The
next useful proof is not a generic idle motion: it is the smallest gameplay
action that requires articulated fingers and a prop.

X1.27 therefore answers two linked questions:

1. Can a short sequence of nearby, separately baked hand fields produce a
   convincing visible grip and release?
2. Can the held mesh become the existing flying dynamite at the exact moment
   it leaves the palm, preserving visual motion and gameplay ownership?

The Blood/Blud first-person dynamite animation is the timing and silhouette
reference. In particular, the throw is an **underhand toss**: the hand carries
the bundle forward and upward, opens late, and the bundle visibly continues
out of the palm. The reference is viewed only; no extracted Blood pixels or
geometry ship.

## Decisions already made

- Use a **short pre-baked multi-frame SDF clip**, not runtime skinning of the
  volume and not a mesh/SDF hybrid.
- Visible continuous closure and reopening are mandatory. Endpoint poses with
  a hidden snap do not pass.
- Replace the existing procedural four-cylinder bundle in this milestone.
- The downloaded dynamite is a licensed reference/source, not sacred geometry:
  it may be rescaled, reshaped, decimated, re-materialled, or partly rebuilt to
  fit the hand and Blud's silhouette.
- One final derived prop geometry and contact hull are authoritative for both
  pose authoring and runtime. A proxy of a different size is forbidden.
- Finger articulation and the larger underhand wrist motion are separate
  channels. They synchronize at one authored release marker.

## Product scope

### In scope

- one animated **right** baked-SDF hand;
- one derived, shippable dynamite-bundle GLB;
- six anatomical grip poses on one common volume grid;
- smooth adjacent-field interpolation for closure and release;
- a short underhand wrist swing and open-hand follow-through;
- continuous held-prop to flight-prop handoff;
- existing flesh material, wounds, lighting, clay diagnostic, and distal jiggle;
- lab scrub/playback/contact diagnostics;
- integration with the existing `idle | light | cook | throw | recover` flow;
- CC-BY attribution for both the hand-derived volume and dynamite-derived GLB.

### Out of scope

- the left hand as a baked volume;
- cigarette or lighter interaction;
- the cigarette-to-fuse lighting performance;
- general skeletal deformation of arbitrary SDFs;
- a reusable animation compressor;
- changing deterministic dynamite simulation, fuse rules, explosion behavior,
  or the wider game weapon system;
- replacing the primitive-hand path before this gate passes.

The cigarette-to-fuse interaction remains the intended later slice. X1.27
deliberately establishes the grip, contact, release, and prop infrastructure it
will need without attempting both performances at once.

## Licensed source and derived prop

The preferred downloaded source is `dynamite_bundle.glb` from the user's local
`additional blud assets test` folder: “Dynamite Bundle” by DJMaesen/bumstrum,
CC-BY-4.0, Sketchfab model
`dynamite-bundle-6d333be39e454b458d48ad86f8a78df4`. The original stays outside
the repository.

The source is small enough to be a good runtime starting point, but its current
scale and details are not a contract. An offline preparation step writes a
derived GLB under `public/assets/lab/` and may:

- set a believable first-person scale against the licensed hand mesh;
- adjust stick spacing, length, cross-section, bands, and fuse silhouette;
- simplify geometry and textures;
- replace materials with compact Blud-compatible PBR values;
- establish a stable local origin, long axis, grip anchor, and contact hull;
- add named fuse-tip and spark anchors.

The final derived GLB is inspected in the authoring scene before any grip pose
is approved. Its SHA-256, source URL, creator, licence, local grip anchor,
long-axis unit vector, and contact hull are recorded in the clip manifest. The
same attribution is added to `ATTRIBUTIONS.md`. Runtime must not apply a hidden
corrective scale that the baker did not see.

## Grip clip authoring

### Common anatomical space

Reuse X1.26's source hand, inverse-bind skinning, connected-component
extraction, intentional wrist cut, and local wrist cap. Every frame uses the
same right-handed anatomical frame and one shared metric AABB/grid:

- +X thumbward;
- +Y wrist to fingertips;
- +Z dorsal;
- one fixed wrist location and cap plane;
- one fixed final dynamite prop transform in hand-local space.

Keeping a common lattice makes a voxel mean the same anatomical location in
every frame and prevents bounds motion from masquerading as finger motion.

### Six authored poses

The clip contains these ordered hand fields:

| index | label | visual requirement |
|---:|---|---|
| 0 | `open` | relaxed readable hand; fingers clear of the bundle |
| 1 | `approach` | digits moving toward their assigned contact regions |
| 2 | `first-contact` | fingertips begin touching without interpenetrating deeply |
| 3 | `wrap` | index through pinky curl around the bundle with visible separation |
| 4 | `thumb-lock` | thumb crosses and visibly secures the wrapped digits |
| 5 | `firm-grip` | stable carried pose; pressure reads without swallowing the prop |

The bundle is **not** baked into the hand field. It remains a separate mesh so
it can be lit, sparked, released, flown, and removed independently.

The authoring script must render mesh previews of all six poses with the final
derived prop. It also emits quantitative contact diagnostics per digit. A pose
is rejected for major prop penetration, digit self-intersection that destroys
the silhouette, a closed web space/mitten bridge, a floating fingertip in the
firm grip, or wrist/cap drift between frames.

### Bake and atlas

Each posed triangle soup is signed with X1.26's libigl unsigned-distance plus
fast-winding classifier. All frames use identical dimensions, bounds, encoding,
axis order, and voxel size.

The six R16F fields are packed into one depth atlas:

```text
public/assets/lab/hand-sdf-dynamite-grip-r.r16f
public/assets/lab/hand-sdf-dynamite-grip-r.json
```

The physical texture dimensions are `[nx, ny, frameDepth * frameCount]` with X
fastest, then Y, then atlas Z. The manifest records `frameDepth`, `frameCount`,
ordered labels, normalized key positions, shared bounds, hashes, prop contract,
attribution, and recommended close/release timings. Six fields at X1.26-like
resolution are expected to cost roughly 24–30 MiB; 35 MiB is the investigation
threshold, not a target.

This atlas is versioned separately from the static manifest. The static v1
loader and asset remain valid so X1.26 can always be selected as a control.

## Runtime field interpolation

The clip loader validates the complete manifest before creating a
`Data3DTexture`. It rejects unsupported versions, wrong atlas byte length,
invalid or duplicate frame labels, inconsistent depth/dimensions, non-finite
timing/contact data, missing attribution, unsafe relative paths, or a prop hash
that does not match the derived GLB.

A normalized `grip01` selects two adjacent frames and a local alpha. The shader
samples each frame independently with X1.26's explicit eight-load trilinear
reconstruction, clamping all Z indices to that frame's slab so interpolation
can never bleed across an atlas boundary. It then mixes the two metric signed
distances:

```wgsl
d = mix(sampleFrame(frame0, p), sampleFrame(frame1, p), frameAlpha);
```

This is intentionally limited to nearby authored poses. Directly mixing the
open and firm-grip endpoints is forbidden because it can shrink, ghost, or fuse
digits. Six frames keep each topology-preserving motion small; authoring
previews and midpoint captures remain the decisive check.

The same frame pair and alpha are used for every `mapBody` call, including
normal estimation. Existing carves, wounds, material shading, and lighting
apply after the interpolated hand field. Existing jiggle remains a clamped
local-space domain warp applied to the sample point **before both frame
samples**, so it cannot make the two poses disagree about coordinates.

Volume mode retains conservative march settings. If midpoint blends require a
larger hit epsilon or smaller step multiplier, that tuning applies only to the
clip path and is recorded in the manifest/notes; primitive and static-v1 modes
do not change.

## Animation and state flow

### Pure clip controller

A small pure controller owns `grip01`, direction, playback, hold, and an
authored release marker. It has no wall-clock access and advances only from the
frame delta supplied by the lab. Recommended initial timings are:

- close: about **220 ms** from open to firm grip;
- held: indefinite while the state owns a bundle;
- throw swing: a short tuned underhand forward/upward arc;
- finger release: about **120 ms**, beginning late in that arc;
- recover: the existing cooldown window, with a new bundle closing only when
  the interaction presents one.

Exact values are tuning data, not baked into shader code.

### Underhand throw choreography

The throw is one continuous ownership sequence:

1. The firm-grip hand and held bundle begin a camera-local underhand
   forward/upward wrist swing.
2. The fingers start traversing the grip clip backward late in the swing.
3. At the authored release marker, the bundle is sampled at its current world
   transform and transfers from `hand` ownership to the existing `flight`
   ownership without changing position or orientation.
4. Initial flight motion inherits the hand-anchor velocity at the marker plus
   the existing tuned throw impulse. The result visibly continues out of the
   palm rather than spawning on an unrelated trajectory.
5. The open hand follows through, then recovers. When a replacement bundle is
   presented, closure plays again.

The release marker is **not** the beginning of the throw state. The prop remains
hand-owned through the first part of the swing. Physics still owns all motion
after the marker; the hand animator does not drive an already released bundle.

If deterministic simulation cannot accept a literal measured hand velocity,
the visual adapter may convert that velocity into an additive cosmetic/tuned
launch contribution at the existing deterministic command boundary. It must
not introduce a second projectile simulation or change fuse/explosion rules.

### Existing state mapping

- entering the lab/demo with a presented bundle: play `open → firm-grip`;
- `idle`, `light`, and `cook`: hold `firm-grip`;
- `throw`: play underhand swing, late finger release, and marker handoff;
- `recover`: finish open follow-through and recovery;
- next presented bundle: close again.

The primitive-hand path retains its current pose system. Baked mode no longer
derives a prop anchor from primitive capsule means. Instead it transforms the
manifest's fixed `gripLocal` and `axisLocal` through the current volume pose,
which is the same contract used during authoring.

## GLB prop view

Replace `createStickProp` in baked mode with an asynchronous GLB-backed wrapper
that preserves the useful existing interface:

- `hand`: transform from the baked hand's authored anchor;
- `flight`: transform from the existing flight/simulation state;
- `gone`: hidden;
- fuse-tip/flicker: use named anchors from the derived asset;
- `dispose`: release cloned geometry, material, and texture ownership cleanly.

The procedural four-cylinder prop remains only as the primitive path's control
and as a diagnostic fallback if required by a clean checkout. It must not be
silently displayed inside the accepted baked clip, because its dimensions do
not match the authored contact.

## Lab controls and diagnostics

The WebGPU FPV panel gains a compact `grip clip` section:

- `static | clip` hand field choice, preserving the existing `prims` control;
- pause/play and auto-loop;
- `grip01` scrubber;
- playback-speed control;
- jiggle toggle;
- fixed inspection views for open, first contact, thumb lock, and firm grip;
- prop-anchor/contact-hull diagnostic;
- clip load/error text.

The default demo loop is:

```text
open → close → short hold → underhand toss/release → open follow-through
```

Scrubbing never advances gameplay or spawns a projectile. The scripted throw
button/state is the only path that performs an ownership handoff.

## Failure handling

- A missing or invalid clip falls back to the accepted X1.26 static baked hand
  and exposes a clear lab error.
- A missing, invalid, or hash-mismatched derived GLB refuses the animated clip;
  it never combines the authored hand poses with a differently sized prop.
- A failed GLB load cannot leave an invisible hand-owned projectile.
- Switching back to primitive mode restores its hand sheets, props, controls,
  and current behavior exactly.
- The browser must survive all failures without a rejected-promise loop or
  partial GPU resource leak.

## Gates

### Offline and automated

- existing Vitest suite, TypeScript check, Python bake tests, and production
  build remain green;
- bake validation covers all frames, common bounds/grid, wrist cap, binary
  order, finite distances, interior/exterior samples, and attribution;
- contact tests cover final prop scale, grip/axis agreement, per-digit contact,
  and bounded penetration;
- loader tests cover atlas addressing, slab clamping, hashes, labels, and
  invalid manifests;
- shader tests cover adjacent-frame selection, interpolation before wounds,
  shared frame state in normal estimation, and default-off behavior;
- state tests cover closure, held pose, late release marker, exactly-once
  ownership handoff, follow-through, recovery, and primitive-mode parity;
- every WGSL-touching task includes a live WebGPU browser smoke because string
  tests cannot detect WGSL type errors.

### Visual evidence

Produce fixed-frame captures of:

1. open;
2. approach/first contact;
3. wrap;
4. thumb lock;
5. firm grip;
6. the release marker;
7. bundle just clear of the palm;
8. open follow-through.

Also capture one normal-speed loop with jiggle off and one with it on. Inspect
the adjacent-pose midpoints as well as the six authored fields: defects often
appear only during SDF interpolation.

### Single decisive owner gate

The slice passes only if the owner sees one coherent performance: a believable
right hand visibly closes around a correctly scaled dynamite bundle, carries it
through an underhand toss, opens late, and releases a bundle that visibly flies
from the hand. Five digits and the thumb lock must remain legible. There must be
no distracting pose snap, field ghost, fused fingers, melting silhouette,
floating prop, major hand/prop penetration, wrist discontinuity, or positional
jump when ownership transfers to flight.

If the static authored poses fail, fix the poses or prop before runtime work.
If only midpoints fail, add/reposition an authored frame or investigate a local
warp; do not conceal the defect with faster playback. If the handoff fails,
fix the shared release transform/velocity; do not hide it with particles.

### Performance and memory

Benchmark the loop on a visible page with wounds enabled, the derived GLB
visible, and `hiddenSteps == 0`, alternating against the accepted X1.26 static
case. Record GPU median/p05/p95 and loaded asset/GPU memory estimates. A clip
near 30 MiB is acceptable for this prototype. Crossing 35 MiB or adding more
than 0.75 ms median GPU time versus the static hand requires investigation;
performance cannot rescue a failed hand or throw read.

## Expected implementation seams

The implementation plan should keep these concerns independently reviewable:

1. prepare/attribute the final derived prop and author the six poses;
2. bake and validate the depth-packed clip plus manifest;
3. load/sample/interpolate the clip while preserving static-v1 compatibility;
4. load and anchor the GLB prop;
5. add the pure grip controller and underhand release handoff;
6. wire lab controls, live smoke, captures, benchmark, and owner gate.

The slice remains outside the dispatch queue until its implementation plan has
been reviewed and explicitly dispatched.
