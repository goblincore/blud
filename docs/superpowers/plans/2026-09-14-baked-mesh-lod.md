# Baked mesh LOD — textured corpse bake, bake for every character, distance LOD for live bodies — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take far and dead bodies out of the SDF march by turning them into meshes that still look like the SDF: first make the existing corpse bake carry the march's texture, then open the bake to every character, then add a distance LOD that swaps live bodies to per-segment baked meshes posed per frame.

**Architecture:** (L1) The bake already visits every welded vertex with the field evaluator and nearest prim in hand; it gains two `vec4` attributes (`bakeAnchor` = the prim's rest-space anchor + tissue depth, `bakeAux` = prim index, wound rim, wound cavity, material class) and the shared baked shader runs the march's per-pixel terms from them (detail-normal fbm on the anchor, mottle, soldier meat detail, gloss-driven spec) instead of a frozen 15 mm vertex albedo. (L2) `corpseBakeEligible` drops the soldier name gate: any actor whose collapse reaches a settled terminal is baked, with palette and head partition per character. (L3) A distance LOD bakes each character TYPE once at spawn as one mesh per limb segment in rest pose (shared by every instance of that type, the `SegmentMeshCache` idiom), poses the pieces per frame with the segment renderer's origin+quaternion idiom, gates the swap with a hysteretic distance band copied from `gateRefineTwin`, and hides the body from the march (per-body proxies, or the crowd slot) while the LOD is on. Wounds on LOD bodies use the existing world-space crater texture. Prior art and cost facts: `docs/dev-notes/2026-09-05-chunk-bake-worker.md` (67 ms corpse bake, one job in flight), `soldier-corpse-bake.ts`, `baked-chunks.ts`, `chunk-bake-geometry.ts`, `skeleton-spike/mesh-renderer.ts`.

**Tech Stack:** TypeScript, three r185 WebGPU/TSL, worker bake (`chunk-bake.worker.ts`), vitest, lab scripts (`scripts/march-hash.mjs`, `scripts/refine-smoke.mjs`, `scripts/sdf-game-bench.mjs`, a new `scripts/bake-texture-smoke.mjs`).

---

## Conventions

- Gates on every task: `npx tsc --noEmit -p .` clean; `node scripts/march-hash.mjs` = `a8ab4efac15fc0376c3e4e05420f13e34d1511bd` twice (the frozen close-up bakes nothing, so the canonical march must not move); the vitest files named per task. Browser scripts run under bash inside `scripts/lab-servers.sh` with `LAB_VITE_PORT=5323 LAB_CDP_PORT=9323`.
- Do not change `cellSize` or the bake grid limits in this plan; texture comes from per-pixel shading, not finer voxels.
- Names fixed here: attributes `bakeAnchor` (vec4: rest anchor xyz, tissueDepth w) and `bakeAux` (vec4: primIdx, wmRim, wmCav, materialClass 0 flesh / 1 bone / 2 organ); WGSL `BAKED_DETAIL_WGSL`; `chunkBakeAttrs()`; `corpseBakeEligible()` generalised; `lodBand`, `setLodBand`, `lodInfo()`, `lodEligible()`; `createTypeLodBake(name)`, `TypeLodMesh`, `LodInstance`; `__sdfGame.setLod(on)`, `?lod=0|1`; bench legs `lod-on`, `lod-off`.
- Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File map

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/chunk-bake-geometry.ts` | emit `bakeAnchor`, `bakeAux` per welded vertex (`chunkBakeAttrs`) |
| `src/lab/sdf-zombie/webgpu/chunk-bake.worker.ts`, `chunk-bake-jobs.ts` (pack/unpack/transfers) | carry the two new buffers |
| `src/lab/sdf-zombie/webgpu/baked-chunks.ts` | `BAKED_DETAIL_WGSL`: per-pixel detail normal, mottle, meat detail, gloss spec from the attributes; surface mode writes the perturbed normal |
| `src/lab/sdf-zombie/webgpu/chunk-bake-geometry.test.ts`, `baked-chunks.test.ts` | attribute presence/values; WGSL pins |
| `scripts/bake-texture-smoke.mjs` (new) | numeric texture-energy gate SDF vs baked |
| `src/lab/sdf-zombie/webgpu/game-actor.ts` | `corpseBakeEligible()` for every character; `lodEligible()` |
| `src/lab/sdf-zombie/webgpu/soldier-corpse-bake.ts` → renamed `corpse-bake.ts` | palette from the character, head partition per character, `refineObject` already handled |
| `src/lab/sdf-zombie/webgpu/type-lod-bake.ts` (new) | per-type per-segment rest-pose bake + `TypeLodMesh` pool + per-frame posing |
| `src/lab/sdf-zombie/webgpu/type-lod-bake.test.ts` (new) | segment partition, cache keying, pose maths |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | LOD band gating in the cull loop; hide march proxies / crowd slot; seams; bench legs |
| `scripts/sdf-game-bench.mjs` | `lod-on` / `lod-off` legs |
| `docs/dev-notes/2026-09-14-baked-mesh-lod.md` (new), `TASKS.md` | results |

---

## Task L1: The bake carries the march's texture

**Files:** `chunk-bake-geometry.ts`, `chunk-bake.worker.ts`, `chunk-bake-jobs.ts`, `baked-chunks.ts`, tests, `scripts/bake-texture-smoke.mjs`

- [ ] **Step 1: Failing attribute test.** In `chunk-bake-geometry.test.ts` (extend the existing fixture that bakes a small body):

```ts
it('emits bakeAnchor and bakeAux per welded vertex', () => {
  const baked = bakeChunkGeometry(smallBodyData());
  expect(baked.anchor.length).toBe(baked.verts * 4);
  expect(baked.aux.length).toBe(baked.verts * 4);
  // anchor is finite and lies within the body's rest-space AABB (inflated by the largest radius)
  for (let i = 0; i < baked.verts; i++) {
    expect(Number.isFinite(baked.anchor[i * 4]!)).toBe(true);
    const cls = baked.aux[i * 4 + 3]!;
    expect([0, 1, 2]).toContain(cls);
    expect(baked.aux[i * 4]!).toBeGreaterThanOrEqual(0); // primIdx
  }
});
```

Run: `npx vitest run src/lab/sdf-zombie/webgpu/chunk-bake-geometry.test.ts` — FAIL (`anchor` undefined).

- [ ] **Step 2: Emit the attributes in the weld loop.** In `bakeChunkGeometry`, where `bakeChunkAlbedo(p, localOf(p), ev, look)` runs per unique vertex, add:

```ts
const primIdx = nearestPrim(p, data.body);              // already computed for the painted colour
const prim = data.body.prims[primIdx]!;
// Rest-space anchor: the same mapping restPoint() uses on the GPU — project p onto the posed
// prim's segment, take the parametric position and radial offset, and re-express them in the
// prim's REST frame (restA/restB from the pack). Use pack.ts's rest rows so CPU and GPU agree.
const anchor = restAnchorOf(p, prim);                   // new helper in pack.ts, mirrors WGSL restPoint
const depth = ev.preWound(p);                           // tissueDepth source the albedo already uses
const wm = ev.woundMask(p);                             // { wm, wmRim, wmCav } — extend the evaluator to return all three
const cls = ev.materialAt(p) === 'bone' ? 1 : ev.materialAt(p) === 'organ' ? 2 : 0;
anchorOut.set([anchor[0], anchor[1], anchor[2], depth], vi * 4);
auxOut.set([primIdx, wm.wmRim, wm.wmCav, cls], vi * 4);
```

`restAnchorOf` goes in `pack.ts` next to the rest-row packing and is tested against the WGSL `restPoint` text by a CPU/GPU parity fixture in `march.wgsl.test.ts` (same style as the existing `sdBody` parity tests: a grid of points × prims, tolerance 1e-5). Add `anchor` and `aux` to `PackedChunkBake`, the worker transfer list (`chunkBakeTransfers`), and `unpackChunkBake` (`geometry.setAttribute('bakeAnchor', new THREE.BufferAttribute(anchor, 4))`, same for `bakeAux`).

- [ ] **Step 3: Run the attribute test** — PASS.

- [ ] **Step 4: Failing shader pins.** `baked-chunks.test.ts`:

```ts
it('shades per pixel from bakeAnchor/bakeAux', () => {
  expect(BAKED_DETAIL_WGSL).toContain('fn bakedDetail(');
  expect(BAKED_DETAIL_WGSL).toContain('fbm(anchor * 22.0)');     // the march's micro-detail frequency
  expect(BAKED_DETAIL_WGSL).toContain('fbm(anchor * 38.0)');     // soldier clot
  expect(BAKED_DETAIL_WGSL).toContain('fbm(anchor * 57.0 + 3.0)'); // wound glint
  expect(CHUNK_SHADE_WGSL).toContain('bakedDetail(');
  expect(CHUNK_SURFACE_WGSL).toContain('bakedDetail(');
});
```

- [ ] **Step 5: `BAKED_DETAIL_WGSL`.** In `baked-chunks.ts`, add a helper that reproduces the march's light-independent per-pixel terms from the attributes (copy the constants from `MARCH_TRACE_POST` verbatim; the `fbm` helper is already shared with the bone shaders):

```wgsl
struct BakedDetail { n: vec3<f32>, albedo: vec3<f32>, gloss: f32, wet: f32 }
fn bakedDetail(nIn: vec3<f32>, albedoIn: vec3<f32>, anchor: vec3<f32>, tissueDepth: f32,
               wm: f32, wmRim: f32, wmCav: f32, cls: f32, look: vec4<f32>, look2: vec4<f32>) -> BakedDetail {
  var n = nIn;
  // micro-detail normal, as MARCH_TRACE_POST: three fbm taps on the rest anchor, amp = look2.y
  let d0 = fbm(anchor * 22.0); let d1 = fbm(anchor * 22.0 + vec3<f32>(17.3, 0.0, 0.0)); let d2 = fbm(anchor * 22.0 + vec3<f32>(0.0, 9.1, 0.0));
  n = normalize(n + look2.y * vec3<f32>(d0, d1, d2));
  // colour mottle per pixel (was per vertex, filtered away at 15 mm)
  let mottle = smoothstep(-0.35, 0.35, fbm(anchor * look2.w));
  var albedo = mix(albedoIn, look2.xyz * albedoIn, mottle * look2.z);   // look2.xyz carries mottleColor/albedo ratio — bind mottleColor separately if simpler
  // soldier meat detail inside wounds: clot / fibre / crevice / glint — same taps as the march
  let clot = fbm(anchor * 38.0);
  let fibre = fbm(anchor * vec3<f32>(9.0, 64.0, 9.0));
  let glint = fbm(anchor * 57.0 + 3.0);
  let meat = smoothstep(0.02, 0.62, wm);
  albedo = mix(albedo, albedo * (0.55 + 0.45 * clot) * (0.8 + 0.2 * fibre), meat);
  let wet = clamp(look.y * wm + glint * meat * 0.35 + wmRim * 0.5, 0.0, 1.0);
  let gloss = select(0.0, 0.35, cls > 0.5);   // bone/organ read glossier, as the march's per-prim gloss does
  return BakedDetail(n, albedo, gloss, wet);
}
```

Exact mix weights: read them off `MARCH_TRACE_POST`'s soldier detail block and use the same numbers; the pins only fix the taps. `chunkShade` calls it before lighting (`specPow = mix(mix(128.0, 4.0, look.y), 220.0, gloss)` replacing the hardcoded 48) and `chunkSurface` writes the perturbed `n` into `normalMetalness` and `albedo`/`rough = mix(0.9, 0.31, wet)`. Bind `mottleColor` and `surfCfg2.yw` (detail amp, mottle freq) into `bakedChunkUniforms()` from the look the bake snapshotted (the snapshot already copies `surfCfg2.zw`; add `.y`).

- [ ] **Step 6: Run the pins** — PASS. `npx tsc --noEmit -p .` clean.

- [ ] **Step 7: Numeric texture gate.** `scripts/bake-texture-smoke.mjs`: boot `sdf-game.html?frozen=1&vhs=off&upscale=0`, ship defaults, `setFieldStyle('off')`, `setSdfScale(1)`; stage room 1 via `stageCloseUp`; kill the soldier through the existing wound shots until `corpseBakeEligible()` (drive `step()` until `__sdfGame.corpseInfo().entries === 1`; add `corpseInfo()` if missing: `{ entries, pending, rejected }`). Capture the FINAL composited frame (`__sdfGameDebug.readOutput()` or the existing frame-PNG seam the bench uses) twice: once with the bake forced OFF (`__sdfGame.setCorpseBake(false)` → SDF corpse) and once ON (mesh corpse), same frozen frame. Over the corpse's screen bbox (from the OFF frame's march hit mask), compute the **high-frequency energy** `E = mean(|L(x,y) - blur3x3(L)(x,y)|)` of luminance. Gate: `E_mesh / E_sdf >= 0.6` (a smooth mesh today scores ≈ 0.1–0.2; record the number) and mean luminance within 10 %. Write both PNGs to `docs/dev-notes/2026-09-14-baked-mesh-lod/` for eyeballing. Run it; if the ratio is below 0.6 the detail amp binding is the usual culprit (`look2.y` zero → check `bakedChunkUniforms` values at runtime).

- [ ] **Step 8: Gates + commit**

```bash
npx tsc --noEmit -p .
npx vitest run src/lab/sdf-zombie/webgpu/chunk-bake-geometry.test.ts src/lab/sdf-zombie/webgpu/baked-chunks.test.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts
node scripts/march-hash.mjs        # a8ab4e…, twice
node scripts/bake-texture-smoke.mjs
git add -A src/lab/sdf-zombie/webgpu/chunk-bake-geometry.ts src/lab/sdf-zombie/webgpu/chunk-bake.worker.ts src/lab/sdf-zombie/webgpu/chunk-bake-jobs.ts src/lab/sdf-zombie/webgpu/baked-chunks.ts src/lab/sdf-zombie/pack.ts src/lab/sdf-zombie/webgpu/*.test.ts scripts/bake-texture-smoke.mjs docs/dev-notes/2026-09-14-baked-mesh-lod.md docs/dev-notes/2026-09-14-baked-mesh-lod/
git commit -m "feat(bake): baked meshes carry the march's texture — rest anchor + aux attributes, per-pixel detail/mottle/meat/gloss (bake-texture-smoke gate)"
```

---

## Task L2: Corpse bake for every character

**Files:** `game-actor.ts`, `soldier-corpse-bake.ts` → `corpse-bake.ts`, `game-main.ts`, tests

- [ ] **Step 1: Failing test.** `game-actor.test.ts`: a zombie actor (non-soldier profile) whose collapse reaches its terminal phase reports `corpseBakeEligible() === true`; a standing one reports false; a melting one reports false until melt completes. Find the zombie terminal: `collapse.ts` / `melt.ts` — if zombies have no `'settled'`, add a `terminal()` predicate on the collapse state machine (`phase === 'settled' || (melt done && phase === 'collapsed')`) and use it.

- [ ] **Step 2: Generalise eligibility.** `corpseBakeEligible: () => state.collapse.terminal() && !meltActive()` (drop `soldierDamage`). Keep `soldierDamage` for everything else it gates (injury model, wounds, sever policy).

- [ ] **Step 3: Rename and de-soldier the baker.** `git mv soldier-corpse-bake.ts corpse-bake.ts`; `createCorpseBakes`; the snapshot takes the actor's own palette (`actor.view.uniforms` already — verify `baseColor` etc. reflect `character.palette ?? flesh` applied in `spawnEnemy`; they do since `applyMaterial` writes them). `corpsePartition`'s head split stays; for characters without a head cluster `hasHead === false` hides the whole SDF (already handled). `restore()` already re-shows `refineObject`. In crowd mode (`actor.crowd`), on swap-in call `type.setVisibleOverride(slot, false)` — a new `CrowdType` method that excludes a slot from `visibleSlots` regardless of the cull — and clear it on restore; the head half then needs its own draw: for stage 1 keep crowd-attached corpses on the SDF (skip the bake when `actor.crowd` is set and log once) and record it as a gap.

- [ ] **Step 4: Bake budget.** One job in flight is the existing rule; with every character eligible, add `MAX_CORPSE_MESHES = 24` (oldest entry is restored to SDF when exceeded — it is dead, cheap to re-march at distance) and expose `corpseInfo()`.

- [ ] **Step 5: Gates + commit.** tsc; `npx vitest run src/lab/sdf-zombie/webgpu/game-actor.test.ts src/lab/sdf-zombie/webgpu/corpse-bake.test.ts`; `node scripts/march-hash.mjs` ×2; `node scripts/bake-texture-smoke.mjs` extended to also kill the zombie and assert `corpseInfo().entries === 2`. Commit `feat(bake): corpse bake for every character (terminal collapse), MAX_CORPSE_MESHES, corpseInfo`.

---

## Task L3: Distance LOD for live bodies (per-type segment bake, posed per frame)

**Files:** `type-lod-bake.ts` (new), `type-lod-bake.test.ts`, `game-actor.ts`, `game-main.ts`, `scripts/sdf-game-bench.mjs`, dev note

- [ ] **Step 1: Segment partition test.** `type-lod-bake.test.ts`: `segmentPartition(restBody)` returns one `ChunkBakeData` per limb segment (cluster) of the REST pose, each with only that cluster alive (the `corpsePartition` idiom generalised to `cluster.id === target`), `quat` identity, and the segment's rest origin; the union of prim sets equals the body's prims; head is its own segment (face stays SDF at LOD? — no: at LOD distance the face sheet is sub-pixel; bake the head too and accept no face).

- [ ] **Step 2: `createTypeLodBake(name, restBody, jobs)`.** Bakes the segments through the existing worker (`cellSize: 0.02` — LOD is far, and the anchor attributes from L1 give it texture), one job at a time, caching `BufferGeometry` per `(characterName, bodyRevision, segmentId)` (the `SegmentMeshCache` idiom). Status `pending → ready`; until ready, actors stay on the march. Geometry is shared by every instance of the type.

- [ ] **Step 3: `LodInstance`.** Per actor at LOD: one `THREE.Mesh` per segment (shared geometry, the shared baked material from L1), posed each frame with the segment's `pose()` origin + quaternion from the actor's posed body (exactly `createSegmentMeshRenderer.update`'s idiom; rigid per segment, the 1.26 mm two-anchor approximation is far below LOD pixel size). Wounds: the world-space crater texture (`MAX_WOUNDS_TEX = 64`) the segment renderer already binds. Meshes live in a pooled `THREE.Group` registered `'mesh'`/`'level-only'` with the deferred router.

- [ ] **Step 4: Gating, copied from `gateRefineTwin`.** `lodBand = { near: 6.0, far: 7.0, hysteresis: 0.5 }` (metres, camera distance from `updateVisibleActors`'s per-actor `dist`; the level's diagonal is 11 m, so 6 m is "the far half of the room"). `on = kept && lodReady(type) && a.lodEligible() && inBand(dist)` where `lodEligible = standing && !melting && !bakePaused`. When on: `LodInstance` visible, and the body leaves the march — per-body path: `view.object/coneObject/depthPreObject/refineObject.visible = false`; crowd path: `type.setVisibleOverride(slot, false)`. When off: reverse. `setLodBand({near, far, hysteresis})`, `lodBand()`, `lodInfo()` = `{ on, bodies, ready: [types], pending }`; `?lod=0|1` (default 1 once L3's bench passes; until then default 0), `__sdfGame.setLod(on)`.

- [ ] **Step 5: Tests.** Band hysteresis (enter at < near, leave at > far + h), pose maths (segment origin/quat applied → mesh matrix equals the posed segment's frame within 1e-6), pool reuse on despawn.

- [ ] **Step 6: Bench.** `scripts/sdf-game-bench.mjs` legs `'lod-on': { setLod: true }`, `'lod-off': { setLod: false }`. Run the distance scene from the crowd bench (`BENCH_SCENE=distance`, 16 and 24 bodies) with `baseline,lod-on,lod-off` and, under `crowd=1`, `crowd-quad` with and without LOD. Record `sdf:march` and the polygon pass, `lodInfo().bodies`, and the LOD bake time per type. Acceptance: at 24 bodies at distance, `lod-on` frame p50 ≤ 50 % of `lod-off`, `sdf:march` tracks only the in-band bodies, no visible pop at the band edge in a 10-frame capture crossing the band (write both PNGs).

- [ ] **Step 7: Note + TASKS + commit.** `docs/dev-notes/2026-09-14-baked-mesh-lod.md` `## L3` with the table and the band chosen; `TASKS.md` crowd entry updated (LOD is the answer to "bodies at distance"; the crowd march covers the near case). Commit `feat(lod): distance LOD — per-type segment bake, posed per frame, hysteretic band; lod-on/off bench`.

---

## Not in this plan (deliberately)

- **Mipmaps.** The SDF has no texture to mip; its distance filtering is the AA footprint epsilon (`aaCfg.y`), which already ships. The LOD replaces the march at distance instead.
- **Skinned meshes.** No bone-weighted mesh path exists in the repo; rigid-per-segment posing is what the segment renderer does today and is sub-pixel at LOD range. Joints show seams only inside the near band, where the march owns the body.
- **Crowd-attached corpses with a head** (L2 gap) and **LOD faces** (L3 bakes the head without the sheet): both are far-distance cases; revisit if visible.

## Self-review notes

- L1 is the owner's "easily fixed" item and stands alone: the attributes and shader are used by corpses and detached chunks immediately.
- L2 is the spec's stage-4 corpse item; L3 depends on L1 (texture) and reuses L2's baker and the segment renderer's posing.
- Names consistent: `bakeAnchor`/`bakeAux`, `restAnchorOf`, `bakedDetail`, `corpseBakeEligible`, `MAX_CORPSE_MESHES`, `setVisibleOverride`, `lodBand`/`setLodBand`/`lodInfo`/`lodEligible`, `createTypeLodBake`, `LodInstance`, legs `lod-on`/`lod-off`.
