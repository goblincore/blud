# Bone sphere cull — implementation plan

> **For agentic workers:** one task, one branch. This change must be EXACT
> (bit-identical frames) — it is a cull, not an approximation. Every step has
> a verification command. The parity gate and the bone counter are not
> optional.

**Goal:** Give the in-field bones and organs the same spatial culling the
flesh already has. Today `applyBones` (search `export const APPLY_BONES` in
`src/lab/sdf-zombie/webgpu/march.wgsl.ts`) folds EVERY bone and organ prim
(zombie: 68–90 rows) with no sphere test, on every march step and every
post-hit probe of every pixel inside a wound's `nearWound` zone. Run 8 in
`docs/dev-notes/2026-09-07-gpu-pass-attribution/notes.md` measured that
removing bones from the field cuts the wounded march by 25–30%. This task
keeps the bones in the field (the tubes failed the look verdict) and makes a
hip pixel fold the pelvis, not the skull: one bound sphere per flesh cluster's
bones, tested before the cluster's bone range is folded.

**Architecture:**
- `src/lab/sdf-zombie/pack.ts` (`packBody`) packs a posed body EVERY FRAME
  into Float32Array rows that `zombie-gpu.ts` `writeRow`s into a data
  texture (`DATA_ROWS` = 22 rows, all in use — see the `ROW_*` constants in
  march.wgsl.ts). Bone/organ rows are written AFTER the flesh at prim
  indices `[prims.length, prims.length + boneCount)` (search `BONE rows` in
  pack.ts).
- Flesh clusters (`body.clusters`, at most `MAX_CLUSTERS` = 6 from
  `validate.ts`) get `clusterBounds` / `clusterRange` texels 0..5 of
  `ROW_CLUSTER_BOUNDS` / `ROW_CLUSTER_RANGE`. Those rows are `MAX_PRIMS`
  (128) texels wide and only the first 6 are used — **texels 8..13 and 16 are
  free**, which is where this task stores the bone spheres and ranges, so
  no new row (and no `DATA_ROWS` bump, which would touch every band offset)
  is needed.
- Every bone prim carries `limb` (same `LimbId` type as clusters — see
  `types.ts`); `rig-bind.ts` already poses torso/head bones rigidly with
  their axial segment and limb bones with their limb. So "the bones of
  cluster c" = bone prims whose `limb` equals `body.clusters[c].limb`.
- Bones fold with a HARD `min` (no smin), so the exact skip test is
  `length(p - centre) - radius > d * distort` where `distort` is the same
  anisotropy factor the groups use (`distortOf` in pack.ts; sdPrim
  under-reports Euclidean distance by at most this factor). If the nearest
  possible bone surface is farther than the running `d`, `min(d, bone)` is
  `d` — the skip changes nothing.
- The gate is DATA-DRIVEN, not a new uniform channel (both spare channels
  are taken by other in-flight work): with the seam OFF, pack writes zeros
  into the bone-cluster texels and the shader takes the old flat loop.
  `__sdfGame.setBoneCull(on)` flips a pack option and takes effect on the
  next frame's pack.

**Tech stack:** TypeScript, three r185 `three/webgpu` + TSL, WGSL, vitest.
Bench: `scripts/sdf-game-bench.sh` with `BENCH_PASSES=1`.

**Environment:** run `scripts/link-dev-assets.sh` once in your worktree or the
game will not boot. The vitest suite prints a pre-existing soldier `sheet`
warning — not a failure. WGSL comment trap: no parens and no colons inside
any comment within a `fn` PARAMETER LIST in march.wgsl.ts. Do not bench with
`sysctl -n vm.loadavg` first value ≥ 4.5.

---

### Task 1: Per-cluster bone spheres, exact cull, seam, parity, bench

**Files:**
- Modify: `src/lab/sdf-zombie/pack.ts`
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts`
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`
- Modify: `scripts/sdf-game-bench.mjs`
- Test: `src/lab/sdf-zombie/pack.test.ts`, `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`
- Create: `docs/dev-notes/2026-09-07-bone-sphere-cull/notes.md` (+ captures, bench output)

#### Step 0 — orient (read only)

- [ ] Read `docs/dev-notes/2026-09-07-gpu-pass-attribution/notes.md` (runs 5–8 and "The root cause, stated once").
- [ ] In `pack.ts`: `packBody` end to end, especially the `BONE rows` block, `distortOf`, `boundGroups`, and how `clusterBounds`/`clusterRange` are filled and sized (`MAX_CLUSTERS * CLUSTER_STRIDE`). Note `PackOpts` (`packBones`, `singleGroup`).
- [ ] In `zombie-gpu.ts`: the `writeRow(ROW_CLUSTER_BOUNDS, p.clusterBounds, p.clusterCount)` / `ROW_CLUSTER_RANGE` calls (there are TWO pack sites: the body view ~L1424 and the chunk view ~L2032 — both call `packBody`; both `writeRow` sites must be found and updated). Note how `packBones` reaches `packBody`.
- [ ] In `march.wgsl.ts`: `APPLY_BONES`, the call site `applyBones(dmg, p, data, counts, counts2.x, 0)` inside `MAP_BODY` (search `inside-flesh rows`), the cluster walk in `MAP_BODY` for how `ROW_CLUSTER_BOUNDS`/`ROW_CLUSTER_RANGE` texels are read (`textureLoad(data, vec2<i32>(c, ${ROW_CLUSTER_BOUNDS}), 0)`), and `gDebugBones`.
- [ ] In `game-main.ts`: `setBoneMesh` / `boneTubes()` (the `bonesTotal` counter readback near L4988 — you will use it as the exactness-independent instrument), `setOwnerRefold` (the seam shape to copy).
- [ ] In `march.wgsl.test.ts` find the existing `APPLY_BONES` assertions (~L1758–1770) and in `pack.test.ts` how a body is built for packing tests.

#### Step 1 — failing tests

- [ ] `pack.test.ts`: add a describe `bone cluster spheres` that packs a body with bones on at least two limbs (reuse whatever fixture the file already builds bones with; if none, `compileBlob` the zombie or build a minimal body with two clusters and two bone prims each) and asserts, with `packBoneClusters: true`:
  1. `packed.boneClusterRange` (new, `Float32Array((MAX_CLUSTERS + 1) * CLUSTER_STRIDE)`): for each cluster `c` with bones, texel `c` = `[start, count, distort, 0]` with `start >= prims.length`, ranges contiguous and non-overlapping, and the union of all ranges plus the TAIL range (texel `MAX_CLUSTERS`, for bones/organs matching no cluster) equals `[prims.length, prims.length + boneCount)`.
  2. `packed.boneClusterBounds` (new, same size): for each cluster with bones, every one of that cluster's bone prims has BOTH endpoints at distance ≤ `radius - max(r, r2 ?? r)` from the sphere centre (endpoints plus thickness inside the sphere), computed against the POSED rows actually written (read them back from `primA`/`primB`/`primScale` at the packed indices, not from the input array — the pack may reorder).
  3. Every bone row's REST row (`restA`/`restB`) still corresponds to the same bone as its posed row (reordering must move rest and posed together; pick a fixture where bones differ so a mismatch is detectable).
  4. With `packBoneClusters: false` (default), both new arrays are all zero and the bone rows are in the ORIGINAL order (bit-for-bit the pre-task packing).
- [ ] `march.wgsl.test.ts`: assert `APPLY_BONES` contains the cluster loop reading texel `${MAX_CLUSTERS} + c` of `ROW_CLUSTER_RANGE` and `ROW_CLUSTER_BOUNDS` (write the exact string you will emit and pin it), contains the tail fold at texel `2 * MAX_CLUSTERS`, and still contains the flat fallback loop; and that the exact cull test text `length(p - cb.xyz) - cb.w > d * cr.z` appears.
- [ ] Run both test files — expect the new tests to FAIL.

#### Step 2 — pack.ts

- [ ] Add `packBoneClusters?: boolean` to `PackOpts` (default false).
- [ ] When ON: group `body.bonePrims` indices by owning cluster (`bone.limb === cluster.limb`; a bone matching no cluster, and every organ, goes to the tail). Write bone rows cluster by cluster, then the tail, keeping `writePrim(b, index, w, restBones[j])` paired by ORIGINAL index `j` so rest rows follow. Skip rules (`!packBones && op === 'bone'`) unchanged.
- [ ] For each cluster with ≥ 1 bone row: sphere = the same routine `boundGroups` uses for a group's sphere applied to that cluster's posed bone prims (extract the sphere-of-prims helper if it is inline; do NOT hand-roll a second formula), `distort = distortOf(thoseBones)`. Write `boneClusterBounds[c] = [cx, cy, cz, radius]`, `boneClusterRange[c] = [start, count, distort, 0]`. Tail: `boneClusterRange[MAX_CLUSTERS] = [tailStart, tailCount, 1, 0]`. Bent prims: confirm the sphere helper accounts for `bend` (the group spheres cover bent flesh prims today — if it does, so does yours; if it does not, add the bend sagitta to the radius and note it).
- [ ] When OFF: arrays stay zero, order unchanged.
- [ ] Return both arrays from `packBody`; add them to `PackedBody`.
- [ ] `npx vitest run src/lab/sdf-zombie/pack.test.ts` — pack tests green.

#### Step 3 — zombie-gpu.ts upload

- [ ] At BOTH pack sites, after the existing `writeRow(ROW_CLUSTER_BOUNDS, ...)` / `ROW_CLUSTER_RANGE` calls, write the bone texels at column offset `MAX_CLUSTERS`: `writeRow` writes from column 0, so either extend `writeRow` with a `col` offset parameter (preferred; default 0, so every existing call is unchanged) or widen the cluster arrays. Write `MAX_CLUSTERS + 1` texels of each new array at column `MAX_CLUSTERS`. Zeros when the option is off (pack already zeroed them) — that is the shader's fallback signal.
- [ ] Thread the option: a view-level `setBoneCull(on)` that sets the `packBoneClusters` flag used by the per-frame pack (find where `packBones` is stored and mirror it), on BOTH the body view and the chunk view (chunk views copy settings from the template — check how `packBones` reaches chunks and do the same).
- [ ] `npx tsc --noEmit -p .` clean.

#### Step 4 — shader

- [ ] In `APPLY_BONES`, before the flat loop, read the tail texel `textureLoad(data, vec2<i32>(${2 * MAX_CLUSTERS}, ${ROW_CLUSTER_RANGE} + band), 0)` AND the first cluster texel; if BOTH the tail count and every cluster count are zero (i.e. the packer wrote no bone-cluster data) fall through to the existing flat loop unchanged. Cheapest form: `let tail = textureLoad(...); let anyCluster = ...` — or simpler: pack writes the tail texel's `.w = 1` as an "enabled" flag when the option is on; test `.w > 0.5` once. Use the flag; document it in both files.
- [ ] Enabled path:
  ```wgsl
  for (var c = 0; c < ${MAX_CLUSTERS}; c = c + 1) {
    let cr = textureLoad(data, vec2<i32>(${MAX_CLUSTERS} + c, ${ROW_CLUSTER_RANGE} + band), 0);
    if (cr.y < 0.5) { continue; }
    let cb = textureLoad(data, vec2<i32>(${MAX_CLUSTERS} + c, ${ROW_CLUSTER_BOUNDS} + band), 0);
    if (length(p - cb.xyz) - cb.w > d * cr.z) { continue; }
    d = foldBoneRange(d, p, data, i32(cr.x), i32(cr.y), band);
  }
  d = foldBoneRange(d, p, data, i32(tail.x), i32(tail.y), band);
  ```
  where `foldBoneRange` is the existing per-bone loop body extracted into a helper (one place for the shape/bend reads, the `gDebugBones` count and the hard min — do not duplicate the loop). The flat fallback calls the same helper over `[first, last)`. Keep `MAX_PRIMS` bound checks. Note `d` here is the running field INCLUDING wounds (the call site passes `dmg`), which is what the exactness argument needs — say so in a comment.
- [ ] `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts` green; `npx tsc --noEmit -p .` clean. Boot the game (`scripts/lab-servers.sh` lifecycle, port 5277/9277) and confirm bodies render lit (an unlit-black body = the WGSL parse trap; check the console).

#### Step 5 — seam + bench leg

- [ ] `game-main.ts`, beside `setOwnerRefold`: `setBoneCull(on)` → every actor view's `setBoneCull(on)`; `get boneCull`. Default OFF for this task (the bench flips it; promotion to ON is the owner's call after the numbers).
- [ ] `scripts/sdf-game-bench.mjs`: leg `'bone-cull-on': { setBoneCull: true }` next to `'bone-mesh-on'`; `__sdfGame.setBoneCull(false);` in the ship-defaults reset block. `node --check`.

#### Step 6 — exactness gates (both required)

- [ ] **Counter gate (load-immune):** with a wounded scene (carve wounds via `await __sdfGame.bench({ room: 3, mode: 'throughput', warmup: 20, walkFrames: 10, fireFrames: 90, gibFrames: 10, chunkFrames: 10 })`, then `freeze(true)`), read the bone counter readback used by `boneTubes()` / `bonesTotal` with the cull OFF and ON. Expect `bonesTotal` to DROP substantially (the cull's whole point) while the hit-pixel counts in the same readback are IDENTICAL (exactness: the same pixels hit at the same steps). Record both.
- [ ] **Pixel gate:** four captures as in the attribution notes' parity recipe — `off-a`, `off-b`, `on`, `off-c` — via CDP `Page.captureScreenshot` after `setLoopRunning(false)` + 3× `step(1/60)`. PIL diff (channel delta > 8): `on` vs `off-a` must be within the `off-a` vs `off-b` noise floor, and the mask must be scattered pixels only. LOOK at the mask PNG. A crater-shaped or bone-shaped region means the sphere is too tight — the cull is then WRONG, and the fix is the sphere (Step 2), never the threshold.

#### Step 7 — bench

- [ ] Quiet machine (loadavg < 4.5). Run:
  ```sh
  BENCH_OUT=/tmp/bone-cull-bench BENCH_PASSES=1 BENCH_LEGS=baseline,bone-cull-on,bone-mesh-on BENCH_ROOMS=3,4 BENCH_REPEATS=3 LAB_VITE_PORT=5277 LAB_CDP_PORT=9277 scripts/sdf-game-bench.sh
  ```
  (`bone-mesh-on` is the reference: the cull should recover a large fraction of what removing bones entirely recovers.)
- [ ] Copy `passes.md`/`passes.json` into the notes folder. Read `## Repeatability` first; report `sdf:march` per segment per rep for all three legs, and each delta next to its legs' spread.

#### Step 8 — notes + commit

- [ ] `docs/dev-notes/2026-09-07-bone-sphere-cull/notes.md`: the texel layout (which columns of which rows, the `.w` flag), the counter numbers, the pixel-gate numbers with the mask verdict, the bench table, and a verdict: ship-ON candidate / park / unresolved. Say what fraction of the bone-mesh-on win the cull recovers.
- [ ] Commit on the task branch; first line states the verdict.

## Acceptance criteria

- Both new arrays + `packBoneClusters` option; OFF is bit-for-bit the old packing (pinned by test).
- Shader falls back to the flat loop when the flag texel is 0; enabled path uses the exact `d * distort` sphere test; the loop body exists once.
- Counter gate: hit counts identical, `bonesTotal` reduced. Pixel gate at the noise floor with a noise-shaped mask.
- Bench on a quiet machine, three legs, three repeats, spread beside every delta. Notes committed with a plain verdict.
