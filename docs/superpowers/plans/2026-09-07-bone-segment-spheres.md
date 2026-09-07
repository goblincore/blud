# Bone segment spheres — implementation plan

> **For agentic workers:** one task, one branch, built ON TOP of the parked
> cluster-level bone cull (this branch). Same exactness contract: a hard-min
> cull, bit-identical frames, both gates required. Every step has a
> verification command.

**Goal:** Finish the bone cull at the right granularity. The cluster-level
cull on this branch is exact but recovers only ~5% of the wounded march
(`docs/dev-notes/2026-09-07-bone-sphere-cull/notes.md`, "Verdict"): a chest
crater's pixels sit in the TORSO cluster, whose one sphere holds ribs + spine
+ pelvis, so near a torso wound almost nothing is culled (bone evaluations
fell 18%, not ~80%). Bound bones instead per RIGID SEGMENT — the units the
rig already poses bones by (each vertebra's rib pair, the pelvis, the skull,
each limb bone) — plus one sphere for the organs, so a chest pixel skips the
pelvis, the skull and the shins. Target: bone evaluations down ≥ 50% on the
counter gate, and a wounded-march win approaching the `bone-mesh-on` leg's
13–23%.

**Architecture (what this branch already has, reuse all of it):**
- `pack.ts`: `packBoneClusters` option → bone rows written cluster by
  cluster + a tail, `boneClusterBounds`/`boneClusterRange` arrays
  `(MAX_CLUSTERS + 1) * CLUSTER_STRIDE`, spheres via `fitSphere`, factor via
  `distortOf`, the tail texel's `.w` = enabled flag. Written by
  `zombie-gpu.ts` `writeRow(row, src, count, col)` at column `MAX_CLUSTERS`
  of `ROW_CLUSTER_BOUNDS` / `ROW_CLUSTER_RANGE`.
- `march.wgsl.ts`: `FOLD_BONE_RANGE` (the single per-bone loop body) and
  `APPLY_BONES` reading the tail texel at column `2 * MAX_CLUSTERS`, cluster
  path when `.w > 0.5`, flat fallback otherwise, exact test
  `length(p - cb.xyz) - cb.w > d * cr.z`.
- Seam `__sdfGame.setBoneCull(on)` (body views re-pack the frozen pose on
  toggle; chunks stay flat), bench leg `bone-cull-on`, counter readback
  `__sdfGame.boneEvals` (rasterised / hits / bonesTotal).
- `rig-bind.ts` `applyRig`: poses each bone prim ONE of three ways — skull
  rigid (`rigid.bones`), axial `BoneFrame` (torso/head bones: `head`/`tail`
  joint indices), or per-end joint binding (limb bones: `boneBinding[i].a.point`
  / `.b.point`). Those three are exactly the rigid units this task groups by.
  `Primitive` (types.ts) has `limb`, `cluster`, `op` ('bone' | 'organ').

**Layout (extends the cluster layout, does not replace it):** the two
cluster rows are `MAX_PRIMS` (128) texels wide.

| column | `ROW_CLUSTER_RANGE` | `ROW_CLUSTER_BOUNDS` |
| --- | --- | --- |
| 0..5 | flesh cluster ranges | flesh cluster spheres |
| 6..11 | bone-CLUSTER ranges (existing) | bone-cluster spheres (existing) |
| 12 | HEADER: `[tailStart, tailCount, segCount, mode]` — mode 0 off, 1 cluster (existing `.w = 1`), **2 segment** | (unused) |
| 13..13+BONE_SEG_MAX−1 | **segment ranges** `[start, count, distort, 0]` | **segment spheres** `[cx, cy, cz, r]` |

`BONE_SEG_MAX = 32` (new const in `validate.ts`, exported; columns 13..44 —
all free). Segments beyond the cap go to the tail. Mode 1 output must stay
byte-identical to what this branch writes today (pinned by the existing
tests), so the cluster leg remains a valid A/B reference.

**Tech stack:** TypeScript, three r185 WebGPU/TSL, WGSL, vitest.

**Environment:** run `scripts/link-dev-assets.sh` once in your worktree or the
game will not boot. The vitest suite prints a pre-existing soldier `sheet`
warning — not a failure. WGSL comment trap: no parens and no colons inside
any comment within a `fn` PARAMETER LIST in march.wgsl.ts (an unlit-black
body after boot means you hit it). Do not bench with
`sysctl -n vm.loadavg` first value ≥ 4.5 — wait, and if a stray
`deferred-game-check.mjs` process is pegging a core it belongs to another
task; do not kill it, wait for its own timeout.

---

### Task 1: Segment tags, segment spheres, three-way seam, gates, bench

**Files:**
- Modify: `src/lab/sdf-zombie/types.ts` (one optional field)
- Modify: `src/lab/sdf-zombie/rig-bind.ts`
- Modify: `src/lab/sdf-zombie/validate.ts` (`BONE_SEG_MAX`)
- Modify: `src/lab/sdf-zombie/pack.ts`
- Modify: `src/lab/sdf-zombie/webgpu/march.wgsl.ts`
- Modify: `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`
- Modify: `src/lab/sdf-zombie/webgpu/game-main.ts`
- Modify: `scripts/sdf-game-bench.mjs`
- Test: `src/lab/sdf-zombie/rig-bind.test.ts`, `src/lab/sdf-zombie/pack.test.ts`, `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`
- Create: `docs/dev-notes/2026-09-07-bone-segment-spheres/notes.md` (+ gate artefacts, bench output)

#### Step 0 — orient (read only)

- [ ] `docs/dev-notes/2026-09-07-bone-sphere-cull/notes.md` end to end (layout, gates, the verdict and WHY the cluster sphere failed).
- [ ] `docs/dev-notes/2026-09-07-gpu-pass-attribution/notes.md` — runs 5–8 and "The root cause, stated once"; how `passes.md` is read (repeatability first).
- [ ] `rig-bind.ts`: `BoneFrame`, `BoundRig.boneFrames`, `rigid.bones`, `boneBinding`, and the bone-posing `map` in `applyRig` (search `Bones pose in the SAME pass`).
- [ ] `pack.ts`: the `packBoneClusters` block (`writeBone`, buckets, tail, `fitSphere`, `distortOf`).
- [ ] `march.wgsl.ts`: `FOLD_BONE_RANGE`, `APPLY_BONES`. `zombie-gpu.ts`: `writeRow` with `col`, `setBoneCull`, `lastUploadNext` re-pack. `game-main.ts`: `setBoneCull`, `boneEvals`.
- [ ] Existing tests for all of the above (`pack.test.ts` bone-cluster describe, `march.wgsl.test.ts` APPLY_BONES assertions) — you will extend them, not replace them.

#### Step 1 — failing tests

- [ ] `rig-bind.test.ts`: after `applyRig` on a rigged zombie (use the file's existing fixture), every posed bone prim has a numeric `boneSegment`; two torso bones whose `boneFrames` entries share `head`/`tail` share a tag; skull-rigid bones all share one tag; an upper-arm bone and a shin bone have different tags; every `op === 'organ'` prim shares one tag that no bone has. Tags are small non-negative ints, dense (`max tag + 1 === number of distinct tags`).
- [ ] `pack.test.ts`, new describe `bone segment spheres`, with `boneCullMode: 'segment'` on a posed (tagged) body:
  1. Header texel (index `MAX_CLUSTERS` of `boneClusterRange`, i.e. column 12): `.w === 2`, `.z === segCount`, `.x/.y` = tail start/count.
  2. New arrays `boneSegmentBounds` / `boneSegmentRange` (`BONE_SEG_MAX * CLUSTER_STRIDE`): for `s < segCount`, range `[start, count, distort, 0]` with `count ≥ 1`; ranges contiguous, non-overlapping; union of segment ranges + tail = `[prims.length, prims.length + boneCount)`.
  3. Every bone row in segment `s` (read back from the PACKED `primA/primB/primScale`) has both endpoints within `radius − thickness` of that segment's sphere centre; rest rows still pair with their posed rows.
  4. Organs occupy exactly one segment; the tail is EMPTY on a fully-tagged body.
  5. `boneCullMode: 'cluster'` produces byte-identical `boneClusterBounds`/`boneClusterRange` to `packBoneClusters: true` on this branch today (keep `packBoneClusters` as an alias); `'off'` (default) produces all-zero arrays and the original bone order.
  6. A body with UNTAGGED bones (no `boneSegment`) in `'segment'` mode falls back to cluster grouping and writes header `.w === 1` — lab bodies and chunks must not break.
- [ ] `march.wgsl.test.ts`: `APPLY_BONES` contains the mode-2 branch reading columns `${2 * MAX_CLUSTERS + 1} + s` of both rows with a `BONE_SEG_MAX` loop bound and `if (s >= i32(tail.z)) { break; }`, uses the exact test text `length(p - sb.xyz) - sb.w > d * sr.z`, calls `foldBoneRange` (never an inline copy), and still contains the mode-1 branch and the flat fallback verbatim.
- [ ] Run the three test files — expect the new assertions to FAIL.

#### Step 2 — segment tags (rig-bind.ts, types.ts)

- [ ] `types.ts`: on `Primitive`, add `/** Rigid-segment id for inside-flesh prims (bones/organs), assigned by applyRig; pack groups bone rows by it. CPU-only — never a GPU row. */ boneSegment?: number;`
- [ ] `applyRig`: build `const segIds = new Map<string, number>()` and `const segOf = (key: string) => { let v = segIds.get(key); if (v === undefined) { v = segIds.size; segIds.set(key, v); } return v; }`. In the bone-posing map, set the key: skull-rigid → `'head'`; `frame` → `` `axial:${frame.head}-${frame.tail}` ``; otherwise `` `limb:${p.limb}:${bound.boneBinding[i]!.a.point}-${bound.boneBinding[i]!.b.point}` ``. **Organs** (`p.op === 'organ'`) → `'organs'` regardless of how they posed. Return `{ ...p, ..., boneSegment: segOf(key) }`. The spread keeps every other field; there is no `placePrims`-style explicit copy on this path — verify by reading, then let the rig-bind test prove it.
- [ ] `npx vitest run src/lab/sdf-zombie/rig-bind.test.ts` green.

#### Step 3 — pack.ts

- [ ] `validate.ts`: `export const BONE_SEG_MAX = 32;` with a comment naming the columns it occupies.
- [ ] `PackOpts`: add `boneCullMode?: 'off' | 'cluster' | 'segment'`; `packBoneClusters: true` ⇒ `'cluster'` when `boneCullMode` is absent (alias, keep the old tests green).
- [ ] `PackedBody`: add `boneSegmentBounds`, `boneSegmentRange` (`BONE_SEG_MAX * CLUSTER_STRIDE`, zero unless mode 2).
- [ ] Mode `'segment'`: if any live inside-flesh row lacks `boneSegment`, run the EXISTING cluster path (header `.w = 1`). Else bucket by `boneSegment` (dense ids → array), write rows segment by segment in id order (first-seen order is fine; determinism matters, so sort ids ascending), `fitSphere` + `distortOf` per bucket into `boneSegmentBounds/Range[s]`; buckets beyond `BONE_SEG_MAX` overflow to the tail. Header at index `MAX_CLUSTERS` of `boneClusterRange`: `[tailStart, tailCount, segCount, 2]`. Leave `boneClusterBounds/Range[0..5]` ZERO in mode 2 (the shader ignores them; keeps the layout honest).
- [ ] `npx vitest run src/lab/sdf-zombie/pack.test.ts` green.

#### Step 4 — upload + shader

- [ ] `zombie-gpu.ts`: after the existing two bone-cluster `writeRow` calls, add `writeRow(ROW_CLUSTER_BOUNDS, p.boneSegmentBounds, BONE_SEG_MAX, 2 * MAX_CLUSTERS + 1)` and the same for `ROW_CLUSTER_RANGE` / `boneSegmentRange`. Replace the boolean `packBoneClusters` state with `boneCullMode` ('off' default); `setBoneCull(on)` keeps working (`on ? 'cluster' : 'off'`) and add `setBoneCullMode(mode)` with the same frozen-pose re-pack. Chunks: unchanged (flat).
- [ ] `march.wgsl.ts` `APPLY_BONES`: keep the header read; then
  ```wgsl
  if (tail.w > 1.5) {
    for (var s = 0; s < ${BONE_SEG_MAX}; s = s + 1) {
      if (s >= i32(tail.z)) { break; }
      let sr = textureLoad(data, vec2<i32>(${2 * MAX_CLUSTERS + 1} + s, ${ROW_CLUSTER_RANGE} + band), 0);
      let sb = textureLoad(data, vec2<i32>(${2 * MAX_CLUSTERS + 1} + s, ${ROW_CLUSTER_BOUNDS} + band), 0);
      if (length(p - sb.xyz) - sb.w > d * sr.z) { continue; }
      d = foldBoneRange(d, p, data, i32(sr.x), i32(sr.y), band);
    }
    d = foldBoneRange(d, p, data, i32(tail.x), i32(tail.y), band);
  } else if (tail.w > 0.5) { ...existing cluster path unchanged... } else { ...flat... }
  ```
  Import `BONE_SEG_MAX` from `../validate`. Same exactness comment as the cluster path (d is the WOUNDED running field). Add `FOLD_BONE_RANGE`/`APPLY_BONES` to nothing new — they are already in the assembly list.
- [ ] `npx tsc --noEmit -p .` clean; `npx vitest run src/lab/sdf-zombie/` green. Boot the game (lab-servers lifecycle, ports 5279/9279) and confirm bodies render lit with `__sdfGame.setBoneCullMode('segment')`.

#### Step 5 — seam + bench leg

- [ ] `game-main.ts`: `setBoneCullMode(mode)` → every actor view; `get boneCullMode`. Keep `setBoneCull(on)`.
- [ ] `scripts/sdf-game-bench.mjs`: leg `'bone-seg-on': { setBoneCullMode: 'segment' }` beside `'bone-cull-on'`; add `__sdfGame.setBoneCullMode('off');` to the ship-defaults reset. `node --check`.

#### Step 6 — exactness gates (both required)

- [ ] **Counter gate:** wounded frozen room-3 scene (carve via `await __sdfGame.bench({ room: 3, mode: 'throughput', warmup: 20, walkFrames: 10, fireFrames: 90, gibFrames: 10, chunkFrames: 10 })`, then `freeze(true)`), discard the first cold read, then `__sdfGame.boneEvals()` for modes off / cluster / segment on the SAME pose. **Hits must be identical across all three.** Report `bonesTotal` for each; the segment mode's drop is the headline number (target ≥ 50%; the cluster mode measured 18%).
- [ ] **Pixel gate:** captures `off-a`, `off-b`, `seg`, `off-c` (`setLoopRunning(false)` + 3× `step(1/60)` each, warm-up capture discarded); PIL channel delta > 8; `seg` vs `off-a` within the `off-a` vs `off-b` floor AND the mask (LOOK at it) is scattered noise, no bone- or crater-shaped region. If the mask shows a shape, the sphere is wrong — fix `fitSphere` inputs (a bent rib's control point, a bone's `radiusB`), never the test. Also run `__sdfGame.setBleed(false)` before the captures so mist does not inflate the floor; record the floor with and without.

#### Step 7 — bench

- [ ] Quiet machine. Run:
  ```sh
  BENCH_OUT=/tmp/bone-seg-bench BENCH_PASSES=1 BENCH_LEGS=baseline,bone-cull-on,bone-seg-on,bone-mesh-on BENCH_ROOMS=3,4 BENCH_REPEATS=3 LAB_VITE_PORT=5279 LAB_CDP_PORT=9279 scripts/sdf-game-bench.sh
  ```
- [ ] Copy `passes.md`/`passes.json` into the notes folder. Read `## Repeatability` first. Report `sdf:march` per segment per rep for all four legs; every delta next to its legs' spread; and the fraction of the `bone-mesh-on` win the segment cull recovers.

#### Step 8 — notes + commit

- [ ] `docs/dev-notes/2026-09-07-bone-segment-spheres/notes.md`: the column layout table, how many segments the zombie/soldier/goblin produce (read `tail.z` off a live pack), the counter table (three modes), the pixel-gate numbers and mask verdict, the bench table, and a plain verdict: ship-ON candidate / park / unresolved. If it ships, say what the remaining wounded-march cost is made of (it will be the wound zone's own steps and the flesh fold, not bones).
- [ ] Commit on the task branch; first line states the verdict.

## Acceptance criteria

- Tagging, three-way `boneCullMode` with `'cluster'` byte-identical to today's `packBoneClusters: true`, and `'off'` byte-identical to the shipped flat packing — all pinned by tests.
- Segment path exact: identical hit counts across modes; pixel gate at the noise floor with a noise-shaped mask.
- Bench on a quiet machine, four legs, three repeats, spread beside every delta. Notes with a verdict; committed.
