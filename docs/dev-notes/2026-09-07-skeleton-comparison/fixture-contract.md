# Fixture contract — skeleton representation comparison

Audience: Task 2 (mesh) and Task 3 (volume) implementers. This is the exact
API surface and fixture state produced by Task 1, plus the constraints both
prototypes must honour. Status notes are honest: nothing here is GPU- or
visually validated yet.

## Exported API (src/lab/sdf-zombie/webgpu/skeleton-spike/contract.ts)

```ts
export type SkeletonMode = 'procedural' | 'mesh' | 'volume';
export type Point3 = readonly [number, number, number];
export interface SegmentPose { origin: Point3; quat: readonly [number, number, number, number]; }

export interface BoneFieldSource {
  character: string;
  segment: string;        // 'head' | 'axial:<head>-<tail>' | 'limb:<limb>:<bindA>-<bindB>'
  revision: string;       // content hash: '<character>:<segment>:<prims>:<hash>'
  bounds: { min: Point3; max: Point3 };  // segment-local surface AABB
  distance(p: Point3): number;           // segment-local metres, bone-only, hard min
  rigidity: 'rigid' | 'limb';
  primCount: number;
  pose(): SegmentPose;                   // CURRENT local->world frame (live rig)
  toLocal(p: Point3): Vec3;              // exact inverse of toWorld
  toWorld(p: Point3): Vec3;
  poseEndpointError(): number;           // metres; 0 for rigid, measured for limb
  isLive(): boolean;                     // false once owning flesh cluster is severed
}

export function createSkeletonSources(
  body: BuildResult, bound: BoundRig, opts?: SkeletonSourceOpts,
): BoneFieldSource[];
export function composedBoneDistance(sources, world: Point3): number; // world-space reference

export interface SkeletonSourceOpts {
  character?: string;
  bodyYaw?: number | (() => number);
  rig?: () => RigState;   // REQUIRED for anything that steps the rig — see below
}
```

### Usage recipe (the only supported one)

```ts
const body  = buildBody(compileBlob(parseBlob(zombieSrc)), DEFAULT_BUILD_OPTS);
const bound = bindRig(body);                       // rig MUST be at rest here
let rig = bound.rig;
const sources = createSkeletonSources(body, bound, { character: 'zombie', rig: () => rig });
// per frame after stepping: rig = stepRig(rig, ...); sources pose from the live rig
```

## Rebuild / invalidation obligations (MUST)

1. **Live rig accessor is mandatory under animation.** `opts.rig` must return
   the CURRENT RigState. `stepRig` returns a new state; if the accessor is
   omitted, `pose()`/`toLocal()` read the rest bind forever — measured as a
   ~1 cm phantom distance error under a moved pose (caught by
   contract.test.ts).
2. **Recreate sources when `body.bonePrims` changes** — anatomy re-derive,
   ratio change, sever re-derive. `revision` is a content hash over every
   float that reaches the field; mesh/volume cache keys MUST include
   `revision`. A stale-revision cache hit is the silent wrong-skeleton
   failure mode.
3. **Sever is per-frame, not a rebuild.** `isLive()` reads cluster aliveness
   from the body passed at creation. `composedBoneDistance` skips dead
   segments; a mesh/volume must drop the segment the same frame pack.ts
   drops its bone rows.
4. **Bind at rest.** `bindRig(body)` before any `stepRig`. A pre-posed rig
   bakes the pose into the local geometry.
5. **No per-frame bake.** Sources are created once and ride the whole
   animation; prototypes cache geometry/grids per `(revision, resolution)`
   with explicit disposal.

## Deterministic fixtures

### Available NOW (CPU, vitest — all green, no GPU)

Command:
```
npx vitest run src/lab/sdf-zombie/webgpu/skeleton-spike/contract.test.ts \
  src/lab/sdf-zombie/webgpu/skeleton-spike/segment-diagnostics.test.ts \
  --maxWorkers=2 --minWorkers=1
```

| Fixture | Where | What it pins |
| --- | --- | --- |
| Rest identity | contract.test.ts | frames identity at rest; `toLocal∘toWorld` round trip < 1e-9; `poseEndpointError` < 1e-9 |
| Rest distance parity | contract.test.ts | composed field == procedural oracle < 1e-6 over sample clouds at skull/pelvis/rib |
| Head-wound cavity | contract.test.ts | 5 cm crater on the cranium front surface, smax-carved then bone hard-min — matches oracle < 1e-6, bone provably reached (`boneWon > 0`) |
| Sever | contract.test.ts | head cluster `alive=false` drops the skull from the composed field; matches oracle to 9 digits |
| Posed (verlet settle) | contract.test.ts | 60 × `stepRig(1/60, gravity -9.8, damping 0.04, iterations 4, restStiffness 0.2)`; rigid endpoints exact, limb error measured |
| Segment census + bounds | segment-diagnostics.test.ts | 18 segments (4 rigid, 14 limb), 60 bone / 8 organ / 23 flesh prims; bounds ±0.42 m of anchor |

Actual measured figures are in task-1.md. Character configuration: zombie
only, `DEFAULT_BUILD_OPTS`, real `characters/zombie.blob`.

### Planned (NOT built — no GPU/visual acceptance is claimed or implied)

- GPU capture fixtures (intact / head wound / pelvis wound / rib exposure /
  bent limb / sever) reusing the deterministic freeze already proven by
  scripts/crowd-capture.mjs and scripts/refactor-baseline.sh: `pauseLoop` +
  `holdStill`. Do NOT use `setMotionEnabled(false)` alone — it freezes the
  shamble mid-pose and makes two captures of identical code differ (this
  caused two false conclusions on 2026-09-06). Camera/light/timestep/
  resolution pins to be defined by Task 4 in scripts/skeleton-compare.mjs.
- A genuinely TILTED pose fixture to re-measure the bent-rib gap (the
  gravity settle leaves the spine near-upright; current measurement is ~0
  and uninformative — see below).
- Soldier transfer fixtures (contract is character-agnostic but only the
  zombie is exercised).

## Rigidity and wound-composition constraints (the rules prototypes must follow)

1. **Hard min, never smin.** Bone folding is `foldBoneRange`'s hard min over
   `sdPrimitive` — "meat meeting bone should crease". Bone `blendK` is
   unread on this path. Authored ops preserved: taper (`radiusB`), ellipsoid
   `scale`, quadratic Bezier `bend`, `box`.
2. **Wound composition order is smax-then-min.** Wounds are sequential
   `smax` against the FLESH field; the bone field is hard-min'd afterwards.
   A mesh/volume must reproduce this order or wounds won't reveal bone.
3. **Organs are permanently procedural.** `op === 'organ'` prims and the
   `organs` segment are excluded by construction (census test enforces the
   partition). They shade differently (isOrgan branch) and ride no rigid
   frame.

### Known differences from the shipped oracle — classify correctly

**Reference quirks (acceptable to CHANGE, must be RECORDED, not bugs):**
- *World-axis bend vectors.* `Primitive.bend` is a world-axis displacement
  applyRig never rotates; a rigid bake rotates it with the segment. Zombie
  ribs carry bend up to 0.162 m, so this is the rib case. Per the 2026-09-08
  owner clarification, intentionally improved rigid bend behaviour is
  allowed — label it as an art difference, don't revert to imitate the quirk.
- *World-axis limb squash.* applyRig sets `orient` only on head/axial paths,
  so limb ellipsoid scale never turns with the limb in the shipped field. A
  rigid bake rotating the squash is geometrically nicer — allowed, record it.
- *Two-anchor limb approximation.* Limb endpoints follow independent joint
  anchors; one rigid frame reproduces endpoint A exactly and B up to verlet
  slack. Measured 1.25 mm worst on the left leg in the settle pose (budget
  5 mm). Compare against your extraction cell size before worrying.

**Unacceptable (these ARE bugs, regardless of the parity relaxation):**
- Holes in bone surfaces inside their own segment bounds.
- Bone leaking through intact flesh (wrong bounds, stale revision, or
  missing flesh-union handling).
- Broken wound reveals: bone not appearing in a cavity that reaches it, or
  appearing before the carve reaches it.
- Severed segments still rendering.
- Distracting shading mismatch against the authored forward lighting.

## What Task 2 must implement (minimum)

1. Consume `BoneFieldSource[]`; extract segment-local bone meshes within
   each source's `bounds`, resolution keyed into the cache with `revision`.
2. Pose via `pose()`/`toWorld()` per frame; drop segments when `!isLive()`.
3. Wound/flesh exposure rule equivalent to smax-then-min (depth hiding
   alone is explicitly insufficient per the spec).
4. Opt-in `skeleton=mesh` dev selector; absence preserves baseline
   procedural exactly.
5. Tests: bounds/surface agreement with the CHOSEN anatomy within
   extraction-cell error, holes/disconnected components preserved, cache
   invalidation + disposal. `contract.test.ts` must stay green unmodified.
6. Explicit disposal; no per-frame allocation in the pose path.
