# SDF lab skeleton reveal — design

**Date:** 2026-08-16
**Status:** approved (brainstormed with project owner; decisions recorded below)
**Scope:** SDF zombie lab only (`src/lab/sdf-zombie/`), **WebGPU path only** (WebGL lab frozen 2026-08-16). No game-side changes.
**Depends on:** the gore-feel pass landing first (`2026-08-16-sdf-lab-gore-feel-design.md`) —
this feature rides its per-prim chunks, 3D chunk stepper (`chunkPoint`), and
connectivity sphere-math. Its implementation chain must base off the gore
chain's final branch.

## Why

Chunks of flesh coming off should reveal a skeleton underneath. Owner
direction: bones are **traditional mesh objects, NOT a second SDF field** —
this supersedes the old "skeleton as a second SDF field" follow-up in
TASKS.md. The reveal uses the compositing the lab already proves out daily:
mesh geometry depth-interleaves with the raymarched flesh, so a bone sitting
INSIDE the flesh is hidden until a wound cavity or stump carves the flesh
away in front of it.

Decisions from brainstorm:

- **Full stylized skeleton** (not just stump caps): skull + jaw, ribcage,
  spine segments, pelvis, paired long bones. Any deep wound finds bone; ribs
  behind a torso blast are the money shot.
- **Two-state bone damage**: intact → pre-broken (jagged stub + ejected
  shards). No runtime mesh cutting.
- **Bloody ivory** look: off-white with a wet red gore gradient at flesh
  contact, same specular family as the latex flesh. Charred variant deferred.
- **Procedurally generated** bone meshes from the body definition — no asset
  pipeline; the cultist (and any future `BodyDef`) inherits its skeleton for
  free.

## 1. Bone generation — from the body definition

A pure module (`bone-gen.ts`) builds bone geometry descriptions from the
resolved rig:

- For each rig bone (head/tail from `resolveBones`), emit a **"dog-bone"
  lathe**: cylindrical shaft with flared knobs at both ends, radius derived
  from the local prim girth (same girth logic as `tornEndRadius`), length the
  bone segment minus a joint gap. Claymation-stylized: low segment counts,
  chunky proportions.
- Bespoke procedural shapes for the non-limb pieces: skull (squashed lathe +
  jaw wedge), ribcage (3–5 torus segments around the torso spine), spine
  (stacked short lathes), pelvis (flattened lathe).
- Output is renderer-agnostic geometry data (positions/normals/indices +
  per-vertex gore weight); the WebGPU view wraps it in a BufferGeometry.
- Every bone also gets a **pre-broken variant**: the same lathe terminated
  mid-shaft with a jagged crown (randomized vertex ring), generated at the
  same time.

Per body: ~12–14 bone meshes + variants, instanced-friendly, trivially cheap
next to the march.

## 2. Binding and reveal

- On the intact body, bone meshes parent to the verlet rig's resolved bones
  and update per frame exactly as the flesh prims do — bones ride the jiggle.
- Bones render in the ordinary geometry pass. **The depth composite IS the
  reveal**: flesh surface sits nearer the camera, so bone is invisible until
  wounds/stumps carve the flesh in front of it. No masks, no stencil, no
  shader coupling between flesh and bone.
- Severed stumps: the surviving bone segment protrudes ~2 cm past the torn
  flesh (offset along the bone axis), the classic look.
- Known risk (shared with the future cloth work): the SDF layer renders at
  reduced resolution (0.70x) and composites — tight bone/flesh boundaries may
  shimmer at the resolution seam. First implementation task must be a gray
  in-flesh placeholder to measure this before bone authoring polish.

## 3. Damage: intact → shattered

- Per-bone state, evaluated with the same sphere math as the gore pass's
  connectivity check: a bone **shatters** when wound carve spheres engulf
  enough of its axis (sampled like the attachment neck) or a blast wound
  lands within its radius. Burns never shatter bone.
- On shatter: swap to the pre-broken variant and eject 2–3 **bone-shard
  chunks** — driven by the gore pass's 3D chunk stepper (`makeChunk` /
  `stepChunk`), rendered as small mesh shards instead of raymarched flesh.
  Shards join the blood/trail economy (they trail briefly, stamp no splats).
- On **gib**, each per-prim flesh chunk carries its bone segment inside:
  the bone mesh rides the chunk transform (`chunkPoint` rotation + position,
  NO squash — bones are rigid). A shattered bone's chunk carries the stub.

## 4. Look

- **Bloody ivory**: off-white base, wet red gradient toward flesh-contact
  regions, baked as per-vertex gore weight by `bone-gen` and shaded with the
  same specular/fresnel family as the flesh material so the whole body reads
  as one latex puppet.
- Shading lives in a small shared-constants material per renderer path (like
  the blood views): no custom reveal logic, just lit mesh material tuned to
  sit with `henenlotter-latex`.

## 5. Testing

- `bone-gen`: one bone per rig bone; radii track local girth; broken variants
  exist for every bone; geometry is watertight-enough (no NaNs, index bounds);
  gore weights in [0,1]; deterministic under a seed.
- Shatter logic: engulfing wound ⇒ shattered; nick ⇒ intact; burn ⇒ never;
  blast radius trigger; state is monotonic (no un-shattering).
- Chunk carry: severed/gibbed pieces reference the right bone segment; stub
  follows shattered state.
- Visual: gray-placeholder compositing check first (resolution-seam risk),
  then full pass in the WebGPU lab: torso blast shows ribs; stump shows protruding
  bone; heavy fire shatters and ejects shards; gib pile has bone inside meat.

## Out of scope

- Cloth/robe work (zombie pants experiment, cultist pass) — separate thread,
  recorded in Obsidian `Claude Notes/Blud/2026-08-16-clothing-and-skeleton-reveal.md`.
- Charred bone variant (deferred by owner choice).
- Skeleton-driven animation (bones stay cosmetic riders on the verlet rig).
- Any change under `src/game/` or `src/sim/`.
