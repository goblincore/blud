# X1.26 Baked Hand SDF — Design

**Date:** 2026-08-17  
**Status:** approved direction; implementation not dispatched  
**Owner gate:** one relaxed hand must immediately read as a proper human hand

## Why this spike exists

The source mesh already reads as a hand in Blender. The current first-person
render does not because it reduces that mesh to seven/eight smoothly blended
capsules per side. That reduction loses the web spaces, individual finger
silhouettes, knuckle breaks, thumb root, and palm planes before the shader ever
sees them. Another round of primitive tuning is therefore paused.

X1.26 proves the smallest materially different representation: pose one licensed
mesh once, bake its signed distance into a single-channel 3D texture, and march
that field in the existing WebGPU hands view. It is a look test, not the final
weapon-animation system.

## Research spike findings

### Source geometry

The chosen model is `first_person_hands_rigged/scene.gltf` from the user's local
download. It is “First Person hands rigged” by DavidFischer, licensed CC-BY-4.0.
The source stays outside the repository. The derived volume may be committed and
shipped with the existing attribution extended to name it.

The other `free-fps-hands` pack has no discoverable licence and remains unused.

The chosen glTF is useful but not watertight:

- body: 4,564 vertices / 7,966 triangles, four connected components, 1,174
  boundary edges;
- nails: 170 vertices / 186 triangles, ten components, 134 boundary edges;
- the current weight-threshold `Hand.hand_faces` extraction tears the surface
  further (27 components / 568 boundary or non-manifold edges).

The existing script's inverse-bind-matrix skinning is correct and must be reused.
Blender's imported armature rest data has the already-documented scale-100 fault.

### Rejected conversion routes

1. **OpenVDB directly from the source mesh:** OpenVDB's mesh-to-volume path
   expects a closed surface. This source is not one.
2. **Fill every hole, voxel-remesh, then OpenVDB:** a local probe produced a
   closed manifold, but it also bridged the open seams between fingers and
   visibly turned the hand into a mitten. “Watertight” was achieved by erasing
   the feature this milestone is meant to recover.
3. **Parity rays or flood-fill sign:** both can leak through the model's many
   open seams and make the result resolution/direction dependent.
4. **`mesh_to_sdf.mesh_to_voxels`:** it is designed for dirty meshes, but its
   canned voxelizer normalizes into a cubic `N³` grid. That wastes memory on
   this long, thin subject and discards the metre/axis contract the runtime
   needs.
5. **More capsule/smooth-min rounds:** already tried; they preserve fleshiness
   but not hand anatomy.

### Selected conversion route

Use libigl's BVH unsigned distance plus fast winding numbers directly on the
posed triangle soup. Fast winding numbers are intended for soups, holes, and
degenerate input. `libigl==2.6.2` was installed temporarily and verified on this
Apple-silicon machine; its Python binding exposes both operations:

```python
unsigned, _, _, _ = igl.signed_distance(
    points, vertices, faces,
    igl.SignedDistanceType.SIGNED_DISTANCE_TYPE_UNSIGNED,
)
winding = igl.fast_winding_number(vertices, faces, points)
signed = np.where(np.abs(winding) > 0.5, -unsigned, unsigned)
```

This split is deliberate. libigl's combined
`SIGNED_DISTANCE_TYPE_FAST_WINDING_NUMBER` scales distance magnitude by a
fractional sign on an open soup (a cube missing two triangles measured −0.667
at its center instead of the true −1.0). Using winding only as the inside/outside
classifier preserves the exact closest-triangle magnitude: that same dirty cube
measured winding 0.833 and combined cleanly to −1.0.

Do not globally repair or voxel-remesh the source. Preserve complete connected
face components, make one intentional planar cut below the wrist, and cap only
the edges created by that cut. Remaining source seams are handled by winding
number signing.

The Jin et al. mesh-fusion paper is useful later for a smooth hand/forearm
transition: it builds implicit section functions and joins topologically
incompatible cut openings with cubic Hermite blending. It is not a general
mesh-to-3D-SDF conversion method, and its direct 3D RBF experiment shrank the
blend, so it is not in X1.26's critical path.

## Product scope

### In scope

- one real **right** hand;
- one relaxed, open-ish authored pose;
- one anisotropic R16F volume;
- a local-space hand volume sampled by the existing WebGPU marcher;
- the existing flesh material, lighting, legacy-gamma path, wounds, and normal
  detail;
- current Verlet motion represented as a small, clamped domain warp;
- an explicit `prims | baked` A/B switch;
- neutral-clay and normal-flesh visual captures;
- a visible-page GPU benchmark;
- deterministic bake metadata and validation.

### Out of scope

- left-hand bake;
- grip, pinch, throw, cigarette, or dynamite interaction in baked mode;
- pose sets or runtime skeletal skinning;
- blending two pose fields;
- changing third-person direction;
- automatic mesh repair;
- relief-sheet rebaking;
- WebGL support (the WebGL lab is frozen).

When baked mode is selected, it is acceptable to show only the relaxed right
hand and hide the primitive left hand plus held props. That isolation is a
feature of the look gate, not a regression in the shipping primitive mode.

## Offline bake contract

### Pose and extraction

`scripts/pose_measure_hands.py` becomes safely importable by guarding `main()`.
The new `scripts/bake_hand_sdf.py` imports its `Gltf`, `Hand`, inverse-bind LBS,
rotation helpers, and source/attribution constants.

The pose is deterministic:

| digit | MCP splay | MCP/PIP/DIP flex |
|---|---:|---:|
| index | 9° | 12° / 18° / 8° |
| middle | 0° | 15° / 22° / 10° |
| ring | 5° | 19° / 27° / 13° |
| pinky | 11° | 24° / 32° / 16° |

The thumb remains in the model's relaxed rest pose for this gate. The face
selection is component-based: retain whole non-nail components whose aggregate
right-hand weights exceed left-hand weights. Never select individual vertices
by a skin-weight threshold.

Cut 35 mm proximal to the measured wrist along the wrist-to-knuckles axis.
`bmesh.ops.holes_fill` receives only new boundary edges returned by that cut;
pre-existing source boundaries are left alone. No voxel remesh follows.

### Coordinate frame and grid

The volume is right-handed and anatomical:

- +X: across the hand toward the thumb;
- +Y: wrist toward knuckles/fingertips;
- +Z: out of the back/dorsal surface.

The baker derives this frame from the posed hand and flips X toward the thumb,
then recomputes Z so `cross(X, Y) == Z`. Vertices and the wrist-cut cap are
stored in metres in this frame.

Start with a 1.5 mm target pitch and 12 mm AABB margin. Dimensions are computed
per axis as `ceil(extent / pitch) + 1`; do not force a cube or a nominal 96³.
The observed hand bounds predict roughly 1–1.5 million samples and 2–3 MiB at
R16F, with about 8–10 voxels across a normal finger.

Query both operations in bounded chunks. Classify `abs(winding) > 0.5` as inside
and negate the unsigned closest-triangle distance there. Preserve metric
distance magnitude; negative is inside, positive is outside. Write IEEE-754
half-float little-endian with X fastest, then Y, then Z.

### Files and manifest

```text
public/assets/lab/hand-sdf-relaxed-r.r16f
public/assets/lab/hand-sdf-relaxed-r.json
```

Manifest version 1 records: binary file, `r16f-le`, `x-fastest-y-z`, dimensions,
metric min/max bounds, measured per-axis voxel size, anatomical axis names,
zero iso-value, source and binary SHA-256, and the exact attribution string.

Validation rejects wrong byte length, non-finite values, missing inside or
outside samples, an AABB boundary that is not wholly outside, or a measured
voxel pitch inconsistent with bounds/dimensions.

## Runtime contract

### Loader

`src/lab/sdf-zombie/webgpu/hand-volume.ts` owns the versioned manifest type and
strict validator, JSON/binary fetch, byte-order and byte-length checks, a
`THREE.Data3DTexture` built from `Uint16Array`/`RedFormat`/`HalfFloatType`, and a
1³ positive-distance fallback volume for non-volume views.

The shader performs explicit trilinear reconstruction from eight
`textureLoad`s. Since the baker includes both AABB endpoints, voxel coordinates
are `uv * (dimensions - 1)`, not normalized-sampler `uv*dimensions-0.5`. This
avoids threading a raw WGSL sampler through Three's `wgslFn` bridge while
retaining true trilinear 3D sampling without a half-voxel shift.

### Shared field branch

Do not fork the large march/shading function. Extend the shared field contract
with one disabled-by-default volume branch before the existing wound pass:

```wgsl
if (volumePose0.w > 0.5) {
  d = sampleHandVolume(p, volumeTex, volumePose0, volumePose1,
                       volumeMin, volumeInvExtent, volumeWarp);
} else {
  // existing primitive/cluster fold
}
let dmg = applyWounds(applyCarves(d, p, data, counts), p, data,
                      woundCfg, woundCfg2);
```

The new parameters propagate through `mapBody`, `calcNormal`, and every
`mapBody` call in `MARCH_BODY`. Body, chunk, and primitive-hand views bind the
fallback and keep the enable flag zero.

The volume transform carries world centre, local-to-world quaternion, local
bounds, and inverse extent. Outside `[0,1]³`, return distance to the box plus
the nearest boundary sample so clamp-to-edge cannot extend the hand as a slab.

Because discrete trilinear interpolation is not a mathematically exact SDF,
baked mode uses conservative stepping: relaxation 1.0, step multiplier 0.75,
and hit epsilon at least half the largest voxel pitch. Primitive mode retains
its current values.

### Jiggle as domain warp

The baked texture never changes. A pure CPU helper compares current jiggled
right-hand prim midpoints with their unjiggled targets and returns a rigid
wrist/palm offset plus a distal residual. Clamp the residual to 12 mm and pass
it in local volume coordinates. The sampler applies it progressively:

```wgsl
let distal = smoothstep(0.15, 0.9, uv.y);
localPoint = localPoint - volumeWarp.xyz * distal;
```

The wrist stays pinned and the fingers lag softly. Warp is independently
toggleable; static/unwarped is always the first visual gate.

### Hands view and lab mode

`createHandsGpuView` gains optional volume pose/warp/diagnostic controls while
retaining its wound data texture. The lab exposes `prims | baked`, warp, and
neutral-clay toggles plus matching `window.__sdfLab` methods and load/error
state. Baked mode shows only the right relaxed hand and suppresses held props.
Primitive mode remains the current complete interaction path and default until
the owner accepts the baked look.

## Gates

### Automated

- existing Vitest suite and production build remain green;
- baker self-test proves sign, sample order, and half encoding on a known cube;
- checked-in volume validates against its manifest;
- shader tests prove the volume branch precedes wounds and defaults off;
- primitive mode retains its views and public controls.

### Visual — single decisive gate

Capture identical FPV framing in four states:

1. primitive hand, flesh;
2. baked hand, neutral clay, warp off;
3. baked hand, flesh, warp off;
4. baked hand, flesh, warp on.

States 2 and 3 pass only if they immediately read as a proper hand: five
separate digits, believable thumb root/opposition, visible web spaces,
recognizable knuckles/palm, no mitten bridges, and no obvious voxel stair-step
at normal FPV size. Warp is judged separately for swimming or collapse.

If the static baked field fails, stop. Compare it with the extracted posed-mesh
preview and diagnose grid resolution, sign, runtime transform, or the broader
third-person pivot. Do not add poses, props, or field blending.

### Performance

Run the existing visible-page `benchGpu` control and baked case with identical
settings, twice in alternating order. Reject `hiddenSteps > 0`. The baked case
is acceptable if it is no slower than the primitive hand by more than 0.5 ms
median or 5%, whichever is larger. Performance cannot rescue a hand that does
not read.

## Follow-up only after a pass

Do not assume `mix(sdfA, sdfB,t)` is safe: field mixing across large pose
differences can shrink, double, fuse, or ghost fingers. Pose interpolation needs
its own experiment, likely local warps or a common deformation map. Jin-style
Hermite section blending is a candidate for the wrist seam, not digit motion.
