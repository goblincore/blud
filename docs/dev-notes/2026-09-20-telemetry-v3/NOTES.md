# Telemetry v3 and what the first capture says (2026-09-20)

Recordings are `captureVersion: 3` from `c16673b1`.

## New fields

- `frames[].selfPhases` — EXCLUSIVE ms per span (a span minus the spans inside
  it). Sum and rank these. `phases` stays inclusive.
- `frames[].unattributedCpuMs` — tick + draw CPU no span covered. Was ~half the
  frame (3.5 of 6.3 ms tick, 2.5 ms of draw); now 0.0 p50.
- Region laps `tick:*` / `draw:*` partition the frame (`GameTelemetry.lap`:
  a span that ends at the next lap on its channel — no token crosses a block).
- `cpu:<passLabel>` — CPU submission per GPU pass, driven by the existing
  `setPassLabel` calls (`setPassLabelObserver`, set only while recording).
- Events: `long-frame` (tick+draw >= 20 ms; `top` = heaviest self spans),
  `shader-build` (three r186 `renderer.debug.onNodeBuilderCreated`; `mode: sync`
  is the one that stalls a frame), `flare-shot`.

## First capture (headless, room 1, 30 fps cap, ~7 s — a first look)

| self p50 | ms |
| --- | --- |
| `cpu:sdf:polys` | **5.0** of a 7.6 ms draw |
| `body-step` | 2.3 |
| `tick:burn-kit-viewtime` | 1.8 |
| `tick:occluder-hull` | 1.7 |
| `cpu:sdf:shell-hull` | 0.6 |
| `skeleton-mesh` | 0.5 |
| `cpu:sdf:march` | 0.2 |

**The CPU draw cost is three submitting the POLYGONAL level scene, not the SDF
pass chain.** The flat ~4 ms `crowd-sdf-inner` (3.8 ms at 0 bodies) was the poly
pass all along. Levers: merge static level geometry, `BatchedMesh`, render
bundles (`BundleGroup`). Second: the occluder hull costs 1.7 ms every frame.

The `long-frame` event found one more hitch on its first run: the first flare
ignite builds the `flame-cards` material synchronously (4 sync `shader-build`s,
20 ms draw). The boot warm-up covers the fire volume but not the card pool.

## The two hitches the OLD recording hid (both fixed)

- Weapon switch: muzzle `PointLight` under the hideable `gunRig` re-keyed the
  LightsNode — 16-19 pipeline rebuilds, 115-445 ms, exactly 166 ms after every
  switch to/from the shotgun (`df51f66a`). Lights live under never-hidden parents.
- Flare shot: `traceSlugHitFrom` ran 240 segments x full `sdBody` per actor,
  61-86 ms; now a cluster-sphere broad phase, bit-identical over 720 poses,
  85.7 -> 0.2 ms (`b0c1b051`).

## Not done

Per-frame GPU span + `gpu:idle` in the recording — the piece that answers
"are we GPU-bound?". `gpu-pass-timing.ts` has the exclusive attribution; the
hazard is the `resolveGpu()` drain cadence.

## telemetry v4: GPU per frame, and what the poly pass really is

Merged: `f3900e74` (v4) + `335b178a` (collector fix — recordings BEFORE it
undercount ~25% of frames; use only frames that contain render passes).

### Are we GPU-bound? (owner's machine, 79 s session, 30 fps cap, complete frames only)

| | p50 | p95 | p99 |
| --- | --- | --- | --- |
| GPU busy | **21.0** | 28.2 | 34.0 (of 33.3 budget) |
| CPU tick+draw | 12.7 | 15.3 | 19.1 |

- **The GPU is the tighter side.** ~63% utilised at the median, over budget ~1%
  of frames. CPU has 2x headroom and overlaps the GPU, so CPU savings buy
  headroom and hitch resistance, not frame time. The 4–5 ms that matters most
  is GPU, and it is the march.
- GPU exclusive (mean): `sdf:march` **12.3** (p95 20.4), `sdf:polys` 3.0,
  `post:fire-march` 1.3 (2.0 while burning, p95 4.3), `gib:selected` 0.6,
  `sdf:shell-hull` 0.45, upscaler ~0.6 total, post chain ~1.
- March scales with bodies and proximity: 7.9 ms at 1 body → 17.6 at 8;
  ~14 ms with a body inside 3 m, 2.7 ms beyond 6 m.
- **One genuinely GPU-bound episode**: 8 bodies, coverage 1.0, nearest 1.6 m,
  fire burning → march 28–38 ms, frames 48 ms for ~0.5 s. That is the case to
  optimise for (crowded close-up), not the average.

### Why `cpu:sdf:polys` is 3–5 ms — it is NOT the level rectangles

`__sdfGame.sceneCensus()`: **815 visible meshes**: 426 `skeleton-segment-meshes`
+ 46 eyes, 147 `ring-level` level meshes, the rest weapon/kit/props. And
`sdf:polys` runs **3 passes per frame** (main + 2 flashlight shadow maps), so
three walks all of it three times.

Skeleton segments are NOT instanced. Geometry IS shared (SegmentMeshCache keys by
segment revision) and there is one material, so GPU memory and pipelines are
fine — but every segment of every actor is its own `THREE.Mesh`
(`skeleton-spike/mesh-renderer.ts`, `new THREE.Mesh(baked.geometry, material)`
in a flat group), for all 23 actors in every room (`spawnAll`).

Plan, in order:
1. **Visible-actors-only visual work** (cheap, fits the code): `mesh.visible =
   live && ownerVisible` and skip pose writes for hidden owners; hulls + wound
   exclusion spheres + kit/setTime/headShape for `visibleActors` only. ~426 →
   60–100 objects in a typical room. Est. 4–6 ms CPU. Gate with march-hash;
   eyeball shadows at the edge of view.
2. Instancing (one InstancedMesh per segment geometry, ~18–20 draws per
   character type). Real refactor: sever re-keys geometry, eyes are child meshes
   with per-owner hidden state, culling becomes per batch, debris is loose.
   Matters less after 1.
3. Merge the 147 static level meshes by material (counts 3x via shadow passes).
4. Mesh simplification is a GPU lever only (`sdf:polys` GPU ~3 ms); CPU cost is
   per object, not per triangle. One-number experiment (`cellSize`) if wanted.

### Occluder / outer hull: why per-frame

Rebuilt every frame because it is POSED (follows the animation), not because of
wounds. Wounds add exclusion spheres (the pale-disc-in-crater fix), recomputed
for every wound of every actor each frame (~230 `woundWorldPos` calls late in a
session). The waste is doing both for all actors incl. other rooms: 1.5 ms even
with 0 bodies on screen.

### Other things the recordings showed

- Per-sever material rebuild: almost every `chunk-bake-swap` is followed by a
  sync `shader-build` of `MeshBasicNodeMaterial` on a `gib-asset-*` mesh
  (~2–3 ms; 30 in one session). Each baked chunk gets a fresh material →
  share/cached-by-asset.
- First-use sync builds still unwarmed: `plate` (detached armour, 15–19 ms),
  `flame-cards` (7 ms), explosion materials (13 builds, ~12 ms).
- First dynamite gib: `chunks-and-guts` 33–56 ms once, 10–18 ms after.
- `ShadowMaterial` rebuilt 59x in a session (~0.4 ms each).
