# Merged crowd march — stage (a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace N per-body march draws with one draw per character type that traces the union field of all that type's instances from a shared prim atlas and a per-instance record buffer, behind `?crowd=1`, bit-identical on the canonical room-1 march hash.

**Architecture:** (1) Per-instance march parameters move out of the WGSL signature into a 16-vec4 read-only storage record indexed by instance slot; `mapBody` loops over the slots present in the pixel's tile list, evaluating each slot's full field (fold, carves, wounds, owner re-fold, bones) and taking the min; every existing body becomes a one-slot crowd first, so the hash gate fires before any multi-instance code exists. (2) A `CrowdType` owns one prim atlas `DataTexture` (`MAX_PRIMS × DATA_ROWS·64`), one record buffer, one material, one instanced proxy-box mesh, one depth-prepass twin and one GPU tile binding; views attach to a slot and pack into their band through a `PrimSink`. (3) `game-main` wires spawn/despawn, per-type rebinding of shared texture nodes, and the deferred router registration. Spec: `docs/superpowers/specs/2026-09-13-merged-crowd-march-design.md`.

**Tech Stack:** TypeScript, three r185 WebGPU/TSL (`wgslFn`, `storage`, `InstancedBufferGeometry`), vitest, lab scripts (`scripts/march-hash.mjs`, `scripts/sdf-game-bench.mjs`, `scripts/refine-smoke.mjs`).

---

## Conventions

- Worktree: `/Users/donny/Projects/blud/.claude/worktrees/crowd-march-impl-plan-510ecf` (or the worktree the executor is given). Ports for browser scripts: `LAB_VITE_PORT=5323 LAB_CDP_PORT=9323` inside `scripts/lab-servers.sh` (source it, `lab_servers_up`, `trap lab_servers_down EXIT`). Never edit served source while a bench or hash boot is live.
- Gates on every task that touches `march.wgsl.ts`, `zombie-gpu.ts`, `sdf-layer.ts` or `game-main.ts`: `npx tsc --noEmit -p .` clean; `node scripts/march-hash.mjs` room1 = `a8ab4efac15fc0376c3e4e05420f13e34d1511bd` (run it twice; the script self-checks repeat == room1 and wounded != room1); the vitest files named in the task pass. Do not run the whole vitest suite while a bench is booting (24 GB machine).
- Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- WGSL rules: no `(` `)` `:` in comments inside a parameter list; `meta` is reserved; every removed parameter is removed from the `createMarchMaterial` binding object in the same commit; every added one is appended last, in signature order.
- Names fixed by this plan: `crowd-records.ts` (`REC_VEC4S`, `REC_*`, `MAX_CROWD_INSTANCES`, `CrowdRecords`), `crowd-atlas.ts` (`CrowdPrimAtlas`, `PrimSink`, `bandRowOffset`), `crowd-type.ts` (`CrowdType`, `createCrowdType`), WGSL `INSTANCE_STATE`, `loadInstance`, `inst`, `instCfg`, `gInst*`, `gSlot`; game `__sdfGame.setCrowd`, `crowdInfo()`, `spawnCrowd(name, n)`; bench leg `crowd-on`, env `BENCH_CROWD`.

## File map

| File | Change |
| --- | --- |
| `src/lab/sdf-zombie/webgpu/crowd-records.ts` (new) | record layout constants, `CrowdRecords` (Float32Array + `StorageBufferAttribute` + read-only storage node, `write(slot, src)`, `alive(slot, bool)`) |
| `src/lab/sdf-zombie/webgpu/crowd-records.test.ts` (new) | layout invariants, write/readback |
| `src/lab/sdf-zombie/webgpu/crowd-atlas.ts` (new) | `PrimSink` interface, `CrowdPrimAtlas` (tall DataTexture, per-band `writeRow`, wounds via `writeWounds` with row offset, dirty flag) |
| `src/lab/sdf-zombie/webgpu/crowd-atlas.test.ts` (new) | band arithmetic, single-band atlas equals a plain texture |
| `src/lab/sdf-zombie/webgpu/march.wgsl.ts` | `INSTANCE_STATE` block, banded `applyCarves`/`applyWounds`/owner re-fold/hit reads, per-slot loop in `mapBody`, new `MARCH_BODY_PARAMS` (−14 +2), depth-prepass entry reads records |
| `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`, `deferred-sdf.test.ts` | pins rewritten deliberately (param count, section equality, declared-name scans) |
| `src/lab/sdf-zombie/webgpu/zombie-gpu.ts` | `createMarchMaterial` binds `inst`/`instCfg`, drops the 14; `createZombieGpuView` owns a one-slot `CrowdRecords` + one-band atlas and writes per-instance values through `syncRecord()`; `PrimSink` routing in `upload`/`setWounds` |
| `src/lab/sdf-zombie/webgpu/crowd-type.ts` (new) | `CrowdType`: atlas, records, material, instanced box mesh, depth-pre twin, tile binding, `attach(view)`/`detach(slot)`/`sync(camera, grid)` |
| `src/lab/sdf-zombie/webgpu/crowd-type.test.ts` (new) | slot allocation, instance attribute packing |
| `src/lab/sdf-zombie/webgpu/tile-bin-compute.ts` | `MAX_TILE_GROUPS = 2048`, overflow returns `false` instead of throwing |
| `src/lab/sdf-zombie/webgpu/tile-bin-compute.test.ts` | cap + overflow behaviour |
| `src/lab/sdf-zombie/webgpu/sdf-layer.ts` | `setBodies` accepts crowd meshes (no change to signature; a comment); depth-pre layer gets the crowd twin |
| `src/lab/sdf-zombie/webgpu/game-main.ts` | `?crowd=1`, `crowdTypes` map, spawn/despawn attach, per-type rebinds, `setBodies`, deferred registration, `__sdfGame.setCrowd/crowdInfo/spawnCrowd`, frame-hash seam reads records |
| `scripts/sdf-game-bench.mjs` | legs `crowd-on`, `crowd-on-tiles-off`; `BENCH_CROWD=n` prelude |
| `scripts/march-hash.mjs` | `MARCH_HASH_QUERY` env passthrough (so `crowd=1` can be hashed) |
| `TASKS.md`, `docs/dev-notes/2026-09-13-merged-crowd-march-stage-a.md` | status + results |

---

## Task 0: Baselines and the crowd spawn seam

**Files:** `scripts/march-hash.mjs`, `scripts/sdf-game-bench.mjs`, `src/lab/sdf-zombie/webgpu/game-main.ts`, `docs/dev-notes/2026-09-13-merged-crowd-march-stage-a.md` (new)

- [x] **Step 1: Let march-hash take extra query flags.** In `scripts/march-hash.mjs`, where the page URL is built (`sdf-game.html?frozen=1&vhs=off&upscale=0`), append an env passthrough:

```js
const EXTRA_QUERY = process.env.MARCH_HASH_QUERY ? `&${process.env.MARCH_HASH_QUERY}` : '';
// ...
const url = `http://localhost:${VITE}/sdf-game.html?frozen=1&vhs=off&upscale=0${EXTRA_QUERY}`;
```

- [x] **Step 2: Record the tiles-on baseline.** Run, inside lab-servers:

```bash
node scripts/march-hash.mjs
MARCH_HASH_QUERY='tiles-playtest' BENCH_PRELUDE='' node scripts/march-hash.mjs
```

The second run needs tiles actually enabled: add to `march-hash.mjs`, after `applyShipDefaults`, `if (process.env.MARCH_HASH_TILES === '1') await evaluate('__sdfGame.setTiles(true)')`, and run it with `MARCH_HASH_TILES=1 MARCH_HASH_QUERY='tiles-playtest'`. Write both hashes into the dev note under `## Baselines (2026-09-13)`: `tiles-off room1 = a8ab4e…`, `tiles-on room1 = <value>`. If the two differ, the tile path is not bit-identical to the cluster walk today, and stage a-2's acceptance bar becomes "identical to the tiles-on baseline". Record which.

- [x] **Step 3: Add `__sdfGame.spawnCrowd(name, n)`.** In `game-main.ts` next to `spawnDebugCharacter` (the `__sdfGame` seam object, near the end of the file):

```ts
spawnCrowd: (name: string, n: number) => {
  let ok = 0;
  for (let i = 0; i < n; i++) {
    try { (window as any).__sdfGame.spawnDebugCharacter(name); ok++; }
    catch (e) { console.error('[sdf-game] spawnCrowd stopped at', i, e); break; }
  }
  return ok;
},
```

- [x] **Step 4: Bench env `BENCH_CROWD`.** In `scripts/sdf-game-bench.mjs` next to `PRELUDE`:

```js
const CROWD = Number(process.env.BENCH_CROWD ?? 0);
const CROWD_PRELUDE = CROWD > 0 ? `__sdfGame.spawnCrowd('zombie', ${CROWD})` : '';
```

and where `PRELUDE` is evaluated per leg, evaluate `CROWD_PRELUDE` first (after ship defaults, before the leg overrides). Add to `ALL_LEGS`:

```js
'crowd-on': { setCrowd: true },
'crowd-on-tiles-off': { setCrowd: true, setTiles: false },
```

and make the override applier call `__sdfGame.setCrowd(v)` for `setCrowd` (the seam lands in Task 6; until then the leg is a no-op like `setTiles` without the page flag — say so in the leg comment).

- [x] **Step 5: Baseline crowd bench (per-body path).** Run:

```bash
BENCH_PASSES=1 BENCH_ROOMS=1 BENCH_LEGS=baseline BENCH_CROWD=24 BENCH_OUT=docs/dev-notes/2026-09-13-merged-crowd-march-stage-a/crowd24-perbody node scripts/sdf-game-bench.mjs
```

Record `sdf:march` p50 and the census (bodies seen) in the dev note.

- [x] **Step 6: Commit**

```bash
git add scripts/march-hash.mjs scripts/sdf-game-bench.mjs src/lab/sdf-zombie/webgpu/game-main.ts docs/dev-notes/2026-09-13-merged-crowd-march-stage-a.md
git commit -m "bench(crowd): march-hash query passthrough, spawnCrowd seam, BENCH_CROWD prelude, baselines"
```

---

## Task 1: `crowd-records.ts` — the instance record

**Files:** Create `src/lab/sdf-zombie/webgpu/crowd-records.ts`, `src/lab/sdf-zombie/webgpu/crowd-records.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  REC_VEC4S, MAX_CROWD_INSTANCES, REC_COUNTS, REC_COUNTS2, REC_WOUND_BOUND, REC_ANCHOR_BAND,
  REC_WIND_ALIVE, REC_MELT, REC_FLASH, REC_NOISE_YAW, REC_HEAD_WCOUNT, REC_HEAD_QUAT,
  REC_VOL_POSE0, REC_VOL_POSE1, REC_CENTRE_SEED, REC_HALF_REV, createCrowdRecords,
} from './crowd-records';
import { DATA_ROWS } from './march.wgsl';

describe('crowd records', () => {
  it('gives every field a distinct vec4 inside the record', () => {
    const rows = [REC_COUNTS, REC_COUNTS2, REC_WOUND_BOUND, REC_ANCHOR_BAND, REC_WIND_ALIVE, REC_MELT,
      REC_FLASH, REC_NOISE_YAW, REC_HEAD_WCOUNT, REC_HEAD_QUAT, REC_VOL_POSE0, REC_VOL_POSE1,
      REC_CENTRE_SEED, REC_HALF_REV];
    expect(new Set(rows).size).toBe(rows.length);
    expect(Math.max(...rows)).toBeLessThan(REC_VEC4S);
    expect(REC_VEC4S).toBe(16);
    expect(MAX_CROWD_INSTANCES).toBe(64);
  });

  it('writes a slot and stores the band as slot * DATA_ROWS', () => {
    const r = createCrowdRecords(4);
    r.write(2, {
      counts: [56, 6, 3, 0.12], counts2: [10, 0, 0, 1], woundBound: [1, 2, 3, 0.5],
      bodyAnchor: [0.1, 0.2, 0.3], windDrift: [0, 0, 0], meltCfg: [0, 0, 0, 0], bodyFlash: [0, 0, 0, 0],
      noiseShift: [0.5, 0.6, 0.7], bodyYaw: 1.5, headCentre: [0, 1.6, 0], woundCount: 2,
      headQuat: [0, 0, 0, 1], volumePose0: [0, 0, 0, 0], volumePose1: [0, 0, 0, 0],
      bodyCentre: [0, 1, 0], variantSeed: 7, bodyHalf: [0.5, 1, 0.5], damageRevision: 3,
    });
    const f = r.floats;
    const base = 2 * REC_VEC4S * 4;
    expect(f[base + REC_COUNTS * 4]).toBe(56);
    expect(f[base + REC_ANCHOR_BAND * 4 + 3]).toBe(2 * DATA_ROWS);
    expect(f[base + REC_WIND_ALIVE * 4 + 3]).toBe(1);
    expect(f[base + REC_HEAD_WCOUNT * 4 + 3]).toBe(2);
    r.alive(2, false);
    expect(f[base + REC_WIND_ALIVE * 4 + 3]).toBe(0);
    expect(r.dirty).toBe(true);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/crowd-records.test.ts`
Expected: FAIL — cannot resolve `./crowd-records`.

- [x] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/webgpu/crowd-records.ts
// One record per march instance, read by the kernel through a read-only
// storage buffer (`inst` param). The slot index IS the prim-atlas band index.
// Layout is vec4-granular so the WGSL loader is `(*inst)[base + REC_X]`.
import * as THREE from 'three/webgpu';
import { storage } from 'three/tsl';
import { DATA_ROWS } from './march.wgsl';

export const REC_VEC4S = 16;
export const MAX_CROWD_INSTANCES = 64;

export const REC_COUNTS = 0;        // primCount, clusterCount, carveCount, maxBlendK
export const REC_COUNTS2 = 1;       // boneCount, bareBones, ownerRefoldGate, woundListGate
export const REC_WOUND_BOUND = 2;   // xyz centre, w radius (1e9 = no cull)
export const REC_ANCHOR_BAND = 3;   // bodyAnchor.xyz, w = band = slot * DATA_ROWS
export const REC_WIND_ALIVE = 4;    // windDrift.xyz, w = 1 alive / 0 free slot
export const REC_MELT = 5;          // meltCfg
export const REC_FLASH = 6;         // bodyFlash
export const REC_NOISE_YAW = 7;     // noiseShift.xyz, w = bodyYaw
export const REC_HEAD_WCOUNT = 8;   // headCentre.xyz, w = wound count
export const REC_HEAD_QUAT = 9;     // headQuat
export const REC_VOL_POSE0 = 10;    // volumePose0
export const REC_VOL_POSE1 = 11;    // volumePose1
export const REC_CENTRE_SEED = 12;  // bodyCentre.xyz, w = variantSeed
export const REC_HALF_REV = 13;     // bodyHalf.xyz, w = damageRevision
// 14, 15 spare

export interface RecordSource {
  counts: ArrayLike<number>; counts2: ArrayLike<number>; woundBound: ArrayLike<number>;
  bodyAnchor: ArrayLike<number>; windDrift: ArrayLike<number>; meltCfg: ArrayLike<number>;
  bodyFlash: ArrayLike<number>; noiseShift: ArrayLike<number>; bodyYaw: number;
  headCentre: ArrayLike<number>; woundCount: number; headQuat: ArrayLike<number>;
  volumePose0: ArrayLike<number>; volumePose1: ArrayLike<number>;
  bodyCentre: ArrayLike<number>; variantSeed: number; bodyHalf: ArrayLike<number>; damageRevision: number;
}

export interface CrowdRecords {
  readonly capacity: number;
  readonly floats: Float32Array;
  readonly attribute: THREE.StorageBufferAttribute;
  /** Read-only storage node to bind as the kernel's `inst` param. */
  readonly node: ReturnType<typeof storage>;
  dirty: boolean;
  write(slot: number, src: RecordSource): void;
  alive(slot: number, on: boolean): void;
  /** Flags the attribute for upload if dirty; call once per frame after all writes. */
  flush(): void;
}

export function createCrowdRecords(capacity = MAX_CROWD_INSTANCES): CrowdRecords {
  const floats = new Float32Array(capacity * REC_VEC4S * 4);
  const attribute = new THREE.StorageBufferAttribute(floats, 4);
  attribute.setUsage(THREE.DynamicDrawUsage);
  const node = storage(attribute, 'vec4', capacity * REC_VEC4S).toReadOnly();
  const put4 = (o: number, a: ArrayLike<number>, w?: number) => {
    floats[o] = a[0] ?? 0; floats[o + 1] = a[1] ?? 0; floats[o + 2] = a[2] ?? 0;
    floats[o + 3] = w ?? (a[3] ?? 0);
  };
  const rec: CrowdRecords = {
    capacity, floats, attribute, node, dirty: false,
    write(slot, s) {
      const b = slot * REC_VEC4S * 4;
      put4(b + REC_COUNTS * 4, s.counts);
      put4(b + REC_COUNTS2 * 4, s.counts2);
      put4(b + REC_WOUND_BOUND * 4, s.woundBound);
      put4(b + REC_ANCHOR_BAND * 4, s.bodyAnchor, slot * DATA_ROWS);
      put4(b + REC_WIND_ALIVE * 4, s.windDrift, 1);
      put4(b + REC_MELT * 4, s.meltCfg);
      put4(b + REC_FLASH * 4, s.bodyFlash);
      put4(b + REC_NOISE_YAW * 4, s.noiseShift, s.bodyYaw);
      put4(b + REC_HEAD_WCOUNT * 4, s.headCentre, s.woundCount);
      put4(b + REC_HEAD_QUAT * 4, s.headQuat);
      put4(b + REC_VOL_POSE0 * 4, s.volumePose0);
      put4(b + REC_VOL_POSE1 * 4, s.volumePose1);
      put4(b + REC_CENTRE_SEED * 4, s.bodyCentre, s.variantSeed);
      put4(b + REC_HALF_REV * 4, s.bodyHalf, s.damageRevision);
      rec.dirty = true;
    },
    alive(slot, on) {
      floats[slot * REC_VEC4S * 4 + REC_WIND_ALIVE * 4 + 3] = on ? 1 : 0;
      rec.dirty = true;
    },
    flush() { if (rec.dirty) { attribute.needsUpdate = true; rec.dirty = false; } },
  };
  return rec;
}

/** Zero-filled singleton for materials built without a crowd (tests, hands view). */
let fallback: CrowdRecords | null = null;
export function fallbackCrowdRecords(): CrowdRecords {
  if (!fallback) fallback = createCrowdRecords(1);
  return fallback;
}
```

- [x] **Step 4: Run the test**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/crowd-records.test.ts`
Expected: PASS (2 tests). If `storage(...)` throws outside a renderer in vitest, wrap node creation in a lazy getter (`get node()`), and keep the test on `floats` only.

- [x] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/crowd-records.ts src/lab/sdf-zombie/webgpu/crowd-records.test.ts
git commit -m "feat(crowd): instance record layout and storage buffer (crowd-records.ts)"
```

---

## Task 2: `crowd-atlas.ts` — shared prim atlas with bands

**Files:** Create `src/lab/sdf-zombie/webgpu/crowd-atlas.ts`, `src/lab/sdf-zombie/webgpu/crowd-atlas.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createCrowdPrimAtlas, bandRowOffset } from './crowd-atlas';
import { DATA_ROWS, ROW_PRIM_A, ROW_WOUND } from './march.wgsl';
import { MAX_PRIMS } from '../validate';

describe('crowd prim atlas', () => {
  it('offsets rows by band', () => {
    expect(bandRowOffset(0)).toBe(0);
    expect(bandRowOffset(3)).toBe(3 * DATA_ROWS);
  });
  it('writes a band row at the banded texel offset and marks dirty', () => {
    const atlas = createCrowdPrimAtlas(4);
    expect(atlas.texture.image.height).toBe(4 * DATA_ROWS);
    const src = new Float32Array(MAX_PRIMS * 4); src[0] = 42;
    const sink = atlas.sink(2);
    sink.writeRow(ROW_PRIM_A, src, MAX_PRIMS);
    const o = ((2 * DATA_ROWS + ROW_PRIM_A) * MAX_PRIMS) * 4;
    expect(atlas.texels[o]).toBe(42);
    expect(atlas.dirty).toBe(true);
    expect(sink.woundLayout.woundRow).toBe(2 * DATA_ROWS + ROW_WOUND);
    expect(sink.texels).toBe(atlas.texels);
  });
  it('a one-band atlas has the legacy single-body shape', () => {
    const atlas = createCrowdPrimAtlas(1);
    expect(atlas.texture.image.width).toBe(MAX_PRIMS);
    expect(atlas.texture.image.height).toBe(DATA_ROWS);
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/crowd-atlas.test.ts` — Expected: FAIL, module missing. ✅ (`Failed to resolve import "./crowd-atlas"`)

- [x] **Step 3: Implement**

```ts
// src/lab/sdf-zombie/webgpu/crowd-atlas.ts
// The shared prim texture of a crowd type: MAX_PRIMS wide, DATA_ROWS rows per
// band, one band per instance slot. A DataTexture cannot resize in place, so
// the band count is fixed at creation.
import * as THREE from 'three/webgpu';
import { DATA_ROWS, ROW_WOUND, ROW_WOUND_META, ROW_WOUND_CAP, ROW_WOUND_FLAGS } from './march.wgsl';
import { MAX_PRIMS } from '../validate';
import { MAX_WOUNDS } from '../damage';

export function bandRowOffset(band: number): number { return band * DATA_ROWS; }

/** What a view needs to pack into "its" texture, whether it owns it or not. */
export interface PrimSink {
  readonly band: number;
  readonly texels: Float32Array;
  /** Row inside the band; same contract as the legacy writeRow(row, src, count, col). */
  writeRow(row: number, src: Float32Array, count: number, col?: number): void;
  /** Layout for `writeWounds(texels, ..., layout)` so wound rows land in this band. */
  readonly woundLayout: { maxWounds: number; woundRow: number; metaRow: number; capRow: number; flagsRow: number; stride: number };
  markDirty(): void;
}

export interface CrowdPrimAtlas {
  readonly bands: number;
  readonly texture: THREE.DataTexture;
  readonly texels: Float32Array;
  dirty: boolean;
  sink(band: number): PrimSink;
  /** Uploads if dirty; once per frame. */
  flush(): void;
}

export function createCrowdPrimAtlas(bands: number): CrowdPrimAtlas {
  const texels = new Float32Array(MAX_PRIMS * DATA_ROWS * bands * 4);
  const texture = new THREE.DataTexture(texels, MAX_PRIMS, DATA_ROWS * bands, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter; texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  const atlas: CrowdPrimAtlas = {
    bands, texture, texels, dirty: false,
    sink(band) {
      const r0 = bandRowOffset(band);
      return {
        band, texels,
        writeRow(row, src, count, col = 0) {
          texels.set(src.subarray(0, count * 4), ((r0 + row) * MAX_PRIMS + col) * 4);
          atlas.dirty = true;
        },
        woundLayout: {
          maxWounds: MAX_WOUNDS, stride: MAX_PRIMS,
          woundRow: r0 + ROW_WOUND, metaRow: r0 + ROW_WOUND_META,
          capRow: r0 + ROW_WOUND_CAP, flagsRow: r0 + ROW_WOUND_FLAGS,
        },
        markDirty() { atlas.dirty = true; },
      };
    },
    flush() { if (atlas.dirty) { texture.needsUpdate = true; atlas.dirty = false; } },
  };
  return atlas;
}
```

Check `WriteWoundsLayout` in `zombie-gpu.ts` for the exact field names (`maxWounds/woundRow/metaRow/capRow/flagsRow/stride`) and match them; the test asserts `woundRow` only.

- [x] **Step 4: Run the test** — Expected: PASS (3 tests). ✅ (3 passed)

- [x] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/crowd-atlas.ts src/lab/sdf-zombie/webgpu/crowd-atlas.test.ts
git commit -m "feat(crowd): banded prim atlas and PrimSink (crowd-atlas.ts)"
```

---

## Task 3: Kernel — instance state, banded damage, per-slot fold

**Files:** `src/lab/sdf-zombie/webgpu/march.wgsl.ts`, `src/lab/sdf-zombie/webgpu/march.wgsl.test.ts`, `src/lab/sdf-zombie/webgpu/deferred-sdf.test.ts`

This task changes WGSL text only; the material binding follows in Task 4. Between them the build is broken on purpose, so Tasks 3 and 4 are committed together at the end of Task 4 (one commit, per the signature rule). Run vitest string tests after each step.

- [x] **Step 1: Write the failing pin tests.** In `march.wgsl.test.ts` add:

```ts
import { INSTANCE_STATE, MARCH_BODY_PARAMS, MARCH_BODY, MAP_BODY, APPLY_CARVES, APPLY_WOUNDS } from './march.wgsl';
import { REC_VEC4S, REC_ANCHOR_BAND, REC_COUNTS } from './crowd-records';

describe('crowd instance state', () => {
  it('declares the record loader and the per-instance globals', () => {
    for (const g of ['gInstCounts', 'gInstCounts2', 'gInstWoundBound', 'gInstAnchor', 'gInstWind',
      'gInstMelt', 'gInstFlash', 'gInstNoiseShift', 'gInstHeadCentre', 'gInstHeadQuat',
      'gInstVolPose0', 'gInstVolPose1', 'gInstCentre', 'gInstHalf', 'gBand', 'gSlot']) {
      expect(INSTANCE_STATE).toContain(`var<private> ${g}`);
    }
    expect(INSTANCE_STATE).toContain(`fn loadInstance(inst: ptr<storage, array<vec4<f32>>, read>, slot: i32)`);
    expect(INSTANCE_STATE).toContain(`${REC_VEC4S}`);
    expect(INSTANCE_STATE).toContain(`+ ${REC_ANCHOR_BAND}]`);
  });
  it('removes every per-instance parameter from the signature and adds inst/instCfg last', () => {
    for (const p of ['counts:', 'counts2:', 'woundBound:', 'bodyCentre:', 'bodyHalf:', 'bodyAnchor:',
      'windDrift:', 'meltCfg:', 'bodyFlash:', 'headCentre:', 'headQuat:', 'volumePose0:', 'volumePose1:']) {
      expect(MARCH_BODY_PARAMS).not.toContain(p);
    }
    expect(MARCH_BODY_PARAMS.replace(/\s+/g, ' ')).toMatch(/inst: ptr<storage, array<vec4<f32>>, read>, instCfg: vec4<f32>\)$/);
  });
  it('bands the damage folds', () => {
    expect(APPLY_CARVES).toContain('fn applyCarves(dIn: f32, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, band: i32)');
    expect(APPLY_WOUNDS).toContain('band: i32');
    expect(MAP_BODY).toContain('for (var s = 0; s < ${MAX_CROWD_INSTANCES}; s = s + 1)'.replace('${MAX_CROWD_INSTANCES}', '64'));
  });
});
```

Also update the existing pins: `deferred-sdf.test.ts` `expect(legacy.length).toBe(100)` → `toBe(88)` (100 − 14 + 2; `woundCfg` stays because `.yzw` are per type) with a comment `// crowd stage a: 14 per-instance params moved into the record, +inst +instCfg`. Keep the `surface` deep-equals `legacy` assertion.

- [x] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/deferred-sdf.test.ts` — Expected: FAIL on the new tests and the 100-count pin.

- [x] **Step 3: Add `INSTANCE_STATE` to `march.wgsl.ts`** (export it; append it to `HELPERS` right after the tile globals block that declares `gTileActive`, so every entry chain gets it):

```ts
import { REC_VEC4S, REC_COUNTS, REC_COUNTS2, REC_WOUND_BOUND, REC_ANCHOR_BAND, REC_WIND_ALIVE, REC_MELT,
  REC_FLASH, REC_NOISE_YAW, REC_HEAD_WCOUNT, REC_HEAD_QUAT, REC_VOL_POSE0, REC_VOL_POSE1,
  REC_CENTRE_SEED, REC_HALF_REV, MAX_CROWD_INSTANCES } from './crowd-records';

// Per-instance state, loaded from the record buffer by slot. Everything that
// used to be a per-body uniform parameter is a private global now, so the
// section text that reads it changes by NAME ONLY (counts -> gInstCounts).
export const INSTANCE_STATE = /* wgsl */ `
var<private> gSlot: i32 = 0;
var<private> gBand: i32 = 0;
var<private> gInstCounts: vec4<f32> = vec4<f32>(0.0);
var<private> gInstCounts2: vec4<f32> = vec4<f32>(0.0);
var<private> gInstWoundBound: vec4<f32> = vec4<f32>(0.0, 0.0, 0.0, 1e9);
var<private> gInstAnchor: vec3<f32> = vec3<f32>(0.0);
var<private> gInstWind: vec3<f32> = vec3<f32>(0.0);
var<private> gInstMelt: vec4<f32> = vec4<f32>(0.0);
var<private> gInstFlash: vec4<f32> = vec4<f32>(0.0);
var<private> gInstNoiseShift: vec3<f32> = vec3<f32>(0.0);
var<private> gInstYaw: f32 = 0.0;
var<private> gInstHeadCentre: vec3<f32> = vec3<f32>(0.0);
var<private> gInstWoundCount: f32 = 0.0;
var<private> gInstHeadQuat: vec4<f32> = vec4<f32>(0.0, 0.0, 0.0, 1.0);
var<private> gInstVolPose0: vec4<f32> = vec4<f32>(0.0);
var<private> gInstVolPose1: vec4<f32> = vec4<f32>(0.0);
var<private> gInstCentre: vec3<f32> = vec3<f32>(0.0);
var<private> gInstSeed: f32 = 0.0;
var<private> gInstHalf: vec3<f32> = vec3<f32>(0.0);
var<private> gInstRevision: f32 = 0.0;
fn loadInstance(inst: ptr<storage, array<vec4<f32>>, read>, slot: i32) {
  let base = slot * ${REC_VEC4S};
  gSlot = slot;
  gInstCounts = (*inst)[base + ${REC_COUNTS}];
  gInstCounts2 = (*inst)[base + ${REC_COUNTS2}];
  gInstWoundBound = (*inst)[base + ${REC_WOUND_BOUND}];
  let ab = (*inst)[base + ${REC_ANCHOR_BAND}];
  gInstAnchor = ab.xyz;
  gBand = i32(ab.w);
  gInstWind = (*inst)[base + ${REC_WIND_ALIVE}].xyz;
  gInstMelt = (*inst)[base + ${REC_MELT}];
  gInstFlash = (*inst)[base + ${REC_FLASH}];
  let ny = (*inst)[base + ${REC_NOISE_YAW}];
  gInstNoiseShift = ny.xyz;
  gInstYaw = ny.w;
  let hw = (*inst)[base + ${REC_HEAD_WCOUNT}];
  gInstHeadCentre = hw.xyz;
  gInstWoundCount = hw.w;
  gInstHeadQuat = (*inst)[base + ${REC_HEAD_QUAT}];
  gInstVolPose0 = (*inst)[base + ${REC_VOL_POSE0}];
  gInstVolPose1 = (*inst)[base + ${REC_VOL_POSE1}];
  let cs = (*inst)[base + ${REC_CENTRE_SEED}];
  gInstCentre = cs.xyz;
  gInstSeed = cs.w;
  let hr = (*inst)[base + ${REC_HALF_REV}];
  gInstHalf = hr.xyz;
  gInstRevision = hr.w;
}
`;
```

- [x] **Step 4: Band the damage folds.** In `APPLY_CARVES` change the signature to `fn applyCarves(dIn: f32, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, band: i32)` and every `textureLoad(data, vec2<i32>(X, ${ROW_*}), 0)` inside it to `vec2<i32>(X, ${ROW_*} + band)`. Same for `APPLY_WOUNDS` (add `band: i32` after `woundBound`; band all `ROW_WOUND*` loads) and for the per-ray wound list build in `MARCH_TRACE_SETUP` (uses `gBand`). Grep the file for every `textureLoad(data,` whose row constant is not already `+ band`: the hit-material and rest-anchor reads in `MARCH_TRACE_POST` (`ROW_PRIM_COLOR`, `ROW_REST_A/B`, `ROW_PRIM_A/B`, `ROW_PRIM_CLIP`, `ROW_PRIM_SHELL`…), the wound-owner re-fold's cluster/group reads in `MAP_BODY`, and `calcNormal`'s callers. Each becomes `+ gBand` (POST runs after the hit slot is loaded, Step 6).

- [x] **Step 5: Rewrite `MAP_BODY` as a per-slot loop.** Replace the signature with `fn mapBody(p: vec3<f32>, data: texture_2d<f32>, noiseCfg: vec4<f32>, woundCfg: vec4<f32>, woundCfg2: vec4<f32>, volumeTex: texture_3d<f32>, volumeMin: vec3<f32>, volumeInvExtent: vec3<f32>, volumeWarp: vec4<f32>, volumeClip: vec4<f32>, segVolumeAtlas: texture_3d<f32>, segVolumeMeta: texture_2d<f32>, perfCfg: vec4<f32>, inst: ptr<storage, array<vec4<f32>>, read>, instCfg: vec4<f32>) -> vec4<f32>` and structure the body as:

```wgsl
  var dUnion = 1e9;
  var bestSlot = gSlot;          // the slot POST will reload
  var bestIdxU = -1.0; var bestU = 1e9; var bestDistortU = 1.0;
  var nearWoundU = 0.0; var carvedU = 0.0;
  let nInst = i32(instCfg.x);
  for (var s = 0; s < ${MAX_CROWD_INSTANCES}; s = s + 1) {
    if (s >= nInst) { break; }
    // tile path: skip slots with no entry in this pixel's list; the list is
    // sorted by slot so a slot's entries are one contiguous run
    if (gTileActive > 0.5 && !tileHasSlot(s)) { continue; }
    loadInstance(inst, s);
    if ((*inst)[s * ${REC_VEC4S} + ${REC_WIND_ALIVE}].w < 0.5) { continue; }
    let counts = gInstCounts; let counts2 = gInstCounts2;
    let woundBound = gInstWoundBound; let noiseShift = gInstNoiseShift;
    let volumePose0 = gInstVolPose0; let volumePose1 = gInstVolPose1;
    let band = gBand;
    var d = 1e9;
    gFoldBest = 1e9; gFoldBestIdx = -1.0; gFoldBestDistort = 1.0; gWoundCluster = 0.0; gWoundOwners = 0u;
    // ---- the EXISTING body of mapBody follows here verbatim, with these
    // substitutions only: `foldGroup(d, p, data, counts, 0, ...)` -> band,
    // `applyCarves(d, p, data, counts)` -> `applyCarves(d, p, data, counts, band)`,
    // `applyWounds(..., woundBound)` -> `applyWounds(..., woundBound, band)`,
    // tile fold: `for (var e ...) { if (i32(gTileSlot[e]) != s) { continue; } d = foldGroup(d, p, data, counts, band, gTileBounds[e], gTileGrp[e]); }`
    // ---- end existing body; its result is the local `dmg`, `nearWound`, `carved`
    if (dmg < dUnion) {
      dUnion = dmg; bestSlot = s; nearWoundU = nearWound; carvedU = select(0.0, 1.0, carved != d);
      bestIdxU = gFoldBestIdx; bestU = gFoldBest; bestDistortU = gFoldBestDistort;
    }
  }
  gFoldBest = bestU; gFoldBestIdx = bestIdxU; gFoldBestDistort = bestDistortU;
  gHitSlot = bestSlot;
  return vec4<f32>(dUnion, bestIdxU, nearWoundU, carvedU);
```

Add `var<private> gHitSlot: i32 = 0;` and `gTileSlot: array<f32, TILE_MAX_ENTRIES>` (filled in the tile preload from entry C's x, alongside `gTileBand`) and `fn tileHasSlot(s: i32) -> bool { for (var e = 0; e < TILE_MAX_ENTRIES; e++) { if (f32(e) >= gTileN) { break; } if (i32(gTileSlot[e]) == s) { return true; } } return false; }` to the tile globals block. Keep the return vec4 layout (`d, bestIdx, nearWound, carved`) so every caller (`MARCH_TRACE_LOOP`, `calcNormal`, `REFINE_LOOP`, deferred) is unchanged except for the argument list: update all `mapBody(` call sites to the new list (grep `mapBody(`).

Single-instance bit-identity argument, written as a comment above the loop: with `nInst == 1` and `gTileActive == 0` the loop body is the pre-change `mapBody` verbatim with band 0; the trailing min against `1e9` and the global save/restore add no float ops to `d`.

- [x] **Step 6: Rename the parameter reads in the sections.** In `MARCH_TRACE_SETUP`, `MARCH_TRACE_LOOP`, `MARCH_TRACE_POST`, `MARCH_BODY_SURFACE_PREP`, `MARCH_BODY_LIGHT`, `REFINE_LOOP`, `MARCH_SURFACE_PROLOGUE/TAIL` (deferred-sdf.ts) replace reads of the removed params: `counts`→`gInstCounts`, `counts2`→`gInstCounts2`, `woundBound`→`gInstWoundBound`, `bodyCentre`→`gInstCentre`, `bodyHalf`→`gInstHalf`, `bodyAnchor`→`gInstAnchor`, `windDrift`→`gInstWind`, `meltCfg`→`gInstMelt`, `bodyFlash`→`gInstFlash`, `headCentre`→`gInstHeadCentre`, `headQuat`→`gInstHeadQuat`, `volumePose0/1`→`gInstVolPose0/1`, `woundCfg.x`→`gInstWoundCount`, `lodCfg.z`→`gInstYaw`, `faceCfg3.z`/`.w` (noise shift channels)→`gInstNoiseShift.x/.z` (mirror the existing `noiseShift` reconstruction exactly: today it is `vec3(faceCfg3.z, lodCfg.z, faceCfg3.w)` — keep that order in the record write). At the top of `MARCH_TRACE_SETUP` insert `loadInstance(inst, 0);` (so a one-instance body behaves as today and `gInstCentre/gInstHalf` are valid for the box entry); at the top of `MARCH_TRACE_POST`, right after `if (!hit) { discard; }`, insert `loadInstance(inst, gHitSlot);`. Use `sed`-style whole-word replacement and then read every diff hunk: `counts` also appears in comments and in `foldGroup`'s own parameter (leave function parameters named `counts` alone; only the section bodies change).

- [x] **Step 7: New `MARCH_BODY_PARAMS`.** Delete the 14 declarations listed in Step 1's test, append `, inst: ptr<storage, array<vec4<f32>>, read>, instCfg: vec4<f32>` before the closing `)`. `instCfg = (instanceCount, 0, 0, 0)`. Update `REFINE_PARAMS` (it truncates `MARCH_BODY_PARAMS` at the last `)` and appends four — verify the regex still lands after `instCfg`). Update `DEPTH_PREPASS_MARCH` and `CONE_MARCH` signatures the same way (they read `counts`, `bodyCentre`, `bodyHalf`, `volumePose*` today: same renames, `loadInstance(inst, 0)` at their top; cone is unsupported for crowd but must still compile for the per-body path).

- [x] **Step 8: Run the pin tests**

Run: `npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/deferred-sdf.test.ts src/lab/sdf-zombie/webgpu/tile-cull.test.ts`
Expected: PASS, including the "REFINE_LOOP declares every name the later sections read" scan and the reserved-word scan (no `meta`). The CPU/GPU parity fixtures that build `Float32Array(MAX_PRIMS*DATA_ROWS*4)` are unaffected (band 0).

(No commit yet — Task 4 completes the binding side.)

---

## Task 4: Material binding + every view becomes a one-slot crowd

**Files:** `src/lab/sdf-zombie/webgpu/zombie-gpu.ts`, `src/lab/sdf-zombie/webgpu/deferred-sdf.ts` (call sites only), `src/lab/sdf-zombie/webgpu/game-main.ts` (frame-hash seam)

- [x] **Step 1: `createMarchMaterial` binds records.** Add two trailing optional parameters `crowd?: { inst: ReturnType<typeof storage>; instCfg: ReturnType<typeof uniform> }` (after `segVolumeMetaNodeIn`). In the binding object delete the keys `counts, counts2, woundBound, bodyCentre, bodyHalf, bodyAnchor, windDrift, meltCfg, bodyFlash, headCentre, headQuat, volumePose0, volumePose1` and append, last before `...(extra ?? {})`:

```ts
inst: (crowd?.inst ?? fallbackCrowdRecords().node) as never,
instCfg: crowd?.instCfg ?? fallbackInstCfg(),
```

with `let fallbackInstCfgNode: ReturnType<typeof uniform> | null = null; function fallbackInstCfg() { return (fallbackInstCfgNode ??= uniform(new THREE.Vector4(1, 0, 0, 0))); }` next to `fallbackTileBindings`. Update the "tail order" comment to end `..., temporalCfg, inst, instCfg`. Do the same for the cone and depth-pre material literals in `createZombieGpuView` (they bind `counts`, `bodyCentre`, `bodyHalf`, `volumePose*` today).

- [x] **Step 2: The view owns a one-slot record and a one-band atlas.** In `createZombieGpuView`: replace `const dataTex = createDataTexture()` with

```ts
const ownAtlas = opts.sink ? null : createCrowdPrimAtlas(1);
const sink: PrimSink = opts.sink ?? ownAtlas!.sink(0);
const dataTex = opts.sink ? opts.sinkTexture! : ownAtlas!.texture;   // the texture node the material binds
const ownRecords = opts.records ? null : createCrowdRecords(1);
const records = opts.records ?? ownRecords!;
const slot = opts.slot ?? 0;
const instCfg = uniform(new THREE.Vector4(1, 0, 0, 0));
```

(`opts.sink/sinkTexture/records/slot` are new optional `ZombieGpuViewOptions` fields, used by Task 5.) Replace the view's local `writeRow(row, src, count, col)` with `sink.writeRow(...)`; replace `dataTex.needsUpdate = true` at the end of `upload()` with `sink.markDirty()` and, for an owned atlas, `ownAtlas.flush()`; in `setWounds` pass `sink.texels` and `sink.woundLayout` to `writeWounds` and call `sink.markDirty()`. Set `lastGroups[].bodyIndex = slot`.

- [x] **Step 3: `syncRecord()`.** Add to the view:

```ts
function syncRecord() {
  records.write(slot, {
    counts: u.counts.value.toArray(), counts2: u.counts2.value.toArray(),
    woundBound: u.woundBound.value.toArray(), bodyAnchor: u.bodyAnchor.value.toArray(),
    windDrift: u.windDrift.value.toArray(), meltCfg: u.meltCfg.value.toArray(),
    bodyFlash: u.bodyFlash.value.toArray(),
    noiseShift: [u.faceCfg3.value.z, u.lodCfg.value.z, u.faceCfg3.value.w], bodyYaw: u.lodCfg.value.z,
    headCentre: u.headCentre.value.toArray(), woundCount: u.woundCfg.value.x,
    headQuat: u.headQuat.value.toArray(), volumePose0: u.volumePose0.value.toArray(),
    volumePose1: u.volumePose1.value.toArray(),
    bodyCentre: mesh.position.toArray(), variantSeed: 0, bodyHalf: u.bodyHalf.value.toArray(),
    damageRevision: 0,
  });
  if (ownRecords) ownRecords.flush();
}
```

Keep the uniform nodes in `MarchUniforms` for now (every setter in the game writes them); call `syncRecord()` at the end of `update()`, `setTime()`, `setWounds()`, `setMelt()`, `setRootShift()`, `setHeadShape()`, `setHeadRotation()`, `setWoundCull()`, and wherever `u.bodyFlash` is stamped from game-main (that is a direct uniform write in the draw fn: add `a.view.syncRecord()` after the per-actor uniform block there, and expose `syncRecord` on the view interface). Pass `{ inst: records.node, instCfg }` as the new `createMarchMaterial` argument for the main, refine, cone and depth-pre materials of the view.

- [x] **Step 4: Frame-hash seam.** In `game-main.ts` where the debug hash enumerates `view.uniforms` (excluding `normalGradientCfg`, `debugCfg`) and reads `view.dataTexture`, also hash `view.records.floats` (expose `records` on the view) so the seam still covers pose/wound state. `view.dataTexture` keeps pointing at the (one-band) atlas texture.

- [x] **Step 5: Build and gate**

```bash
npx tsc --noEmit -p .
npx vitest run src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/deferred-sdf.test.ts src/lab/sdf-zombie/webgpu/zombie-gpu.test.ts src/lab/sdf-zombie/webgpu/write-wounds.test.ts src/lab/sdf-zombie/webgpu/game-actor-bounded-wounds.test.ts
node scripts/march-hash.mjs
node scripts/march-hash.mjs
node scripts/refine-smoke.mjs
UPSCALE_SMOKE_REFINE=1 node scripts/upscale-smoke.mjs
```

Expected: tsc clean; tests pass; both hash runs print `room1: a8ab4efac15fc0376c3e4e05420f13e34d1511bd`; refine-smoke PASS; upscale-smoke no `not found in Fn` lines. If the hash moved: bisect with `debugCfg.y` flat-albedo (field-only) to separate field from shading; the usual causes are a missed `+ gBand` (harmless at band 0), a missed rename (the shader then reads a zero — shows as a `not found in 'Fn()'` console line, check `read_console_messages`), or `syncRecord()` not called on a path the frozen frame uses.

- [x] **Step 6: Commit (Tasks 3 + 4 together)**

```bash
git add src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/deferred-sdf.test.ts src/lab/sdf-zombie/webgpu/deferred-sdf.ts src/lab/sdf-zombie/webgpu/zombie-gpu.ts src/lab/sdf-zombie/webgpu/game-main.ts
git commit -m "feat(crowd): per-instance march state lives in a storage record; every body is a one-slot crowd (hash bit-identical)"
```

---

### Executor notes (2026-09-13, Tasks 3+4)

- The plan's `deferred-sdf.test.ts` arithmetic said `100 − 14 + 2 = 88`. The signature has
  **13** removable per-instance params (the 14th record row is `noiseShift`+yaw, which was never a
  param), so the parser count is **89**. The pin is 89, with a comment recording the off-by-one.
- Every view that calls `createMarchMaterial` now needs a record bound, not just the main body
  view: the zero-filled fallback makes a shader with `instCfg.x = 1` march an empty field. The
  main `createZombieGpuView` (main, refine, cone, depth-pre) is converted here. **Follow-up:**
  `fpv-view.ts` (hands), `createChunkGpuView` (private + `createSharedChunkGpuMaterial`), and
  `hull-refine-view.ts` still bind the fallback and will render empty until converted. The
  shared chunk material needs a per-draw `records` node alongside `dataNode` (see
  `bindObjectValue`/`CHUNK_MATERIAL_STATE`).

## Task 5: `CrowdType` — atlas, records, one material, instanced boxes, depth-pre twin, tile binding

**Files:** Create `src/lab/sdf-zombie/webgpu/crowd-type.ts`, `crowd-type.test.ts`; modify `tile-bin-compute.ts`, `tile-bin-compute.test.ts`, `zombie-gpu.ts` (view options from Task 4 Step 2, `createCrowdMaterial` export)

- [x] **Step 1: Raise the group cap and stop throwing.** `tile-bin-compute.ts`: `export const MAX_TILE_GROUPS = 2048;` and `packGroups` returns `null` when `groups.length > MAX_TILE_GROUPS` (callers treat `null` as "fallback this frame" and count it). Update `tile-bin-compute.test.ts`: the `MAX_TILE_GROUPS === TILE_MAX_ENTRIES` assertion becomes `expect(MAX_TILE_GROUPS).toBe(2048)` and add `expect(packGroups(new Array(2049).fill(g), out)).toBeNull()`. Run: `npx vitest run src/lab/sdf-zombie/webgpu/tile-bin-compute.test.ts` — PASS.

- [x] **Step 2: Failing test for slot allocation and instance attributes**

```ts
// crowd-type.test.ts
import { describe, it, expect } from 'vitest';
import { allocateSlot, packInstanceAttrs, INST_FLOATS } from './crowd-type';

describe('crowd type slots', () => {
  it('hands out the lowest free slot and recycles', () => {
    const free = new Set([0, 1, 2, 3]);
    expect(allocateSlot(free)).toBe(0);
    expect(allocateSlot(free)).toBe(1);
    free.add(0);
    expect(allocateSlot(free)).toBe(0);
    free.clear();
    expect(allocateSlot(free)).toBe(-1);
  });
  it('packs centre, half and slot per instance', () => {
    const out = new Float32Array(2 * INST_FLOATS);
    const n = packInstanceAttrs([
      { slot: 3, centre: [1, 2, 3], half: [0.5, 1, 0.5], visible: true },
      { slot: 5, centre: [0, 0, 0], half: [1, 1, 1], visible: false },
    ], out);
    expect(n).toBe(1);
    expect(Array.from(out.subarray(0, INST_FLOATS))).toEqual([1, 2, 3, 0.5, 1, 0.5, 3]);
  });
});
```

Run: `npx vitest run src/lab/sdf-zombie/webgpu/crowd-type.test.ts` — FAIL, module missing.

- [x] **Step 3: Implement `crowd-type.ts`**

```ts
import * as THREE from 'three/webgpu';
import { uniform, attribute } from 'three/tsl';
import { createCrowdPrimAtlas, type CrowdPrimAtlas } from './crowd-atlas';
import { createCrowdRecords, MAX_CROWD_INSTANCES, type CrowdRecords } from './crowd-records';
import { createComputeTileBinding, type ComputeTileBinding } from './tile-bin-compute';
import type { TileGroupInput } from './tile-cull';
import { createCrowdMaterial, type MarchUniforms, type ZombieGpuView } from './zombie-gpu';

export const INST_FLOATS = 7; // iCentre.xyz, iHalf.xyz, iSlot

export function allocateSlot(free: Set<number>): number {
  let best = -1;
  for (const s of free) if (best < 0 || s < best) best = s;
  if (best >= 0) free.delete(best);
  return best;
}

export interface InstanceAttrSource { slot: number; centre: ArrayLike<number>; half: ArrayLike<number>; visible: boolean }

export function packInstanceAttrs(list: InstanceAttrSource[], out: Float32Array): number {
  let n = 0;
  for (const s of list) {
    if (!s.visible) continue;
    const o = n * INST_FLOATS;
    out[o] = s.centre[0]!; out[o + 1] = s.centre[1]!; out[o + 2] = s.centre[2]!;
    out[o + 3] = s.half[0]!; out[o + 4] = s.half[1]!; out[o + 5] = s.half[2]!;
    out[o + 6] = s.slot;
    n++;
  }
  return n;
}

export interface CrowdType {
  readonly name: string;
  readonly atlas: CrowdPrimAtlas;
  readonly records: CrowdRecords;
  readonly uniforms: MarchUniforms;          // the per-TYPE block
  readonly mesh: THREE.Mesh;                 // instanced proxy boxes, SDF_LAYER
  readonly depthPreMesh: THREE.Mesh;         // instanced twin, DEPTH_PREPASS_LAYER
  readonly levelShadowTex: ReturnType<typeof import('three/tsl').texture>;
  readonly tiles: ComputeTileBinding;
  readonly instCfg: ReturnType<typeof uniform>;
  attach(view: ZombieGpuView): number;       // returns slot, -1 when full
  detach(slot: number): void;
  /** Per frame: repack instance attrs, flush atlas + records, bin tiles. */
  sync(camera: THREE.PerspectiveCamera, grid: { tilesX: number; tilesY: number; tilePx: number }): void;
  setSkeletonVolume(atlas: THREE.Texture, meta: THREE.Texture): void;
  info(): { attached: number; visible: number; tileFallbacks: number };
}
```

`createCrowdType(renderer, name, uniforms, maxW, maxH)`:
- `atlas = createCrowdPrimAtlas(MAX_CROWD_INSTANCES)`, `records = createCrowdRecords()`, `instCfg = uniform(new THREE.Vector4(0,0,0,0))`, `tiles = createComputeTileBinding(renderer, maxW, maxH)`.
- Geometry: `const geo = new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(1, 1, 1))`; `const ib = new THREE.InstancedInterleavedBuffer(new Float32Array(MAX_CROWD_INSTANCES * INST_FLOATS), INST_FLOATS)` with `DynamicDrawUsage`; `geo.setAttribute('iCentre', new THREE.InterleavedBufferAttribute(ib, 3, 0))`, `'iHalf'` (3, 3), `'iSlot'` (1, 6).
- Material: `createCrowdMaterial(atlas.texture, uniforms, { inst: records.node, instCfg }, tiles)` — a thin wrapper in `zombie-gpu.ts` around `createMarchMaterial` that (i) sets `positionNode = attribute('iCentre','vec3').add(positionLocal.mul(attribute('iHalf','vec3')))` so the unit box is placed per instance, (ii) passes `iCentre`/`iHalf` as the `bodyCentre`/`bodyHalf` **overrides** used by the box entry maths in SETUP (add two optional `extra` inputs `instCentre`, `instHalf`; in `MARCH_TRACE_SETUP` use `select(gInstCentre, instCentre, instCfg.y > 0.5)` — `instCfg.y = 1` marks a crowd material; declare both in `MARCH_BODY_PARAMS` as the last two params after `instCfg`, bound to zero uniforms in per-body materials, and bump the param-count pin to 90), (iii) `frustumCulled = false`, and (iv) the depth-pre twin the same way with `depthPreMarch`. The fragment reads `attribute('iSlot')` only to seed the box entry; the fold set is the tile list.
- `attach(view)`: `slot = allocateSlot(free)`; `view.rebind({ sink: atlas.sink(slot), records, slot })` — a new view method that swaps the view's `sink`, `records`, `slot` and re-uploads its last `upload(next, rest)` + `setWounds` args (the view keeps `lastUploadNext/lastUploadRest` already) and calls `syncRecord()`; `records.alive(slot, true)`; store `view` in `slots[slot]`.
- `detach(slot)`: `records.alive(slot, false)`, `slots[slot] = undefined`, `free.add(slot)`.
- `sync(camera, grid)`: build `groups: TileGroupInput[]` by concatenating `view.getTileGroups()` for attached, visible views (their `bodyIndex` is already the slot); `const ok = tiles.bin(groups, camera, maxBlendK, grid)`; on `null`/overflow increment `tileFallbacks` and set `uniforms.tileCfg.value.x = 0` for this frame (the per-slot loop then does the cluster walk for every slot — correct, slower); pack instance attrs (`visible = view.object.visible`), `geo.instanceCount = n`, `ib.needsUpdate = true`, `instCfg.value.set(MAX_CROWD_INSTANCES, 1, 0, 0)` — the loop's `nInst` upper bound is the capacity; the alive flag skips free slots; then `atlas.flush(); records.flush();`.

- [x] **Step 4: Run tests** — `npx vitest run src/lab/sdf-zombie/webgpu/crowd-type.test.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/deferred-sdf.test.ts` — PASS (param pin now 91; the plan wrote 90 from the wrong 88 baseline).

- [x] **Step 5: Gate the per-body path again** — `npx tsc --noEmit -p .` clean, `node scripts/march-hash.mjs` ×2 → both `room1: a8ab4efac15fc0376c3e4e05420f13e34d1511bd`, `room1-wounded: da785297…`.

- [x] **Step 6: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/crowd-type.ts src/lab/sdf-zombie/webgpu/crowd-type.test.ts src/lab/sdf-zombie/webgpu/tile-bin-compute.ts src/lab/sdf-zombie/webgpu/tile-bin-compute.test.ts src/lab/sdf-zombie/webgpu/zombie-gpu.ts src/lab/sdf-zombie/webgpu/march.wgsl.ts src/lab/sdf-zombie/webgpu/march.wgsl.test.ts src/lab/sdf-zombie/webgpu/deferred-sdf.test.ts
git commit -m "feat(crowd): CrowdType — shared atlas, records, one material, instanced proxy boxes, per-type tile binding"
```

### Executor notes (2026-09-13, Task 5)

- **Raising `MAX_TILE_GROUPS` above `TILE_MAX_ENTRIES` needed two kernel changes the plan
  omitted.** With 2048 group slots a dense tile really can be covered by >64 groups, so
  `kTileCounts` now clamps each tile's count at `TILE_MAX_ENTRIES` (exactly the CPU
  `TileBinner`'s clamp) and `kTileWrite` stops at that count. Without them the entry stream
  could write past `worstCaseEntries` and the GPU list would diverge from the CPU reference —
  which is the Task 7 masked-parity gate. `tile-bin-compute.test.ts` pins the clamp only
  structurally; the A/B (tile-ab.mjs) is the real check, and the room-2 masked parity in
  Task 7 covers the crowd case.
- **Param pin 91, not 90.** The plan's 88 base was wrong (13 removable per-instance params,
  not 14); 89 + `instCentre` + `instHalf` = 91.
- **`createCrowdMaterial` returns `{ material, depthPreMaterial, setSkeletonVolume }`** rather
  than a bare material: the depth-pre twin binds `depthPreMarch` directly (its signature has
  no `instCentre`/`instHalf` — it needs only the record + the placement `positionNode`), and
  the type's `setSkeletonVolume` must rebind both materials' shared atlas/meta nodes.
- **`createCrowdType` takes an optional `depthPre?: DepthPreSource` 6th arg** so the game can
  hand the crowd twin the layer's depth-pre cfg (`sdfLayer.depthPre`). Omitted, the twin's cfg
  is a fresh all-zero uniform and the pass does not run. Task 6 should pass `sdfLayer.depthPre`.
- **Visibility: attach/detach is the gate.** The packed instance is always `visible` while
  attached (the game hides the per-body proxy when it attaches — Task 6 Step 2 — so
  `view.object.visible` is false and cannot be the crowd's visibility source). `detach` marks
  the record dead and frees the slot; `info().visible` counts live attached slots.
- **Rollback gap.** `view.rebind` re-points the view's sink/records but the view's own material
  still references its ORIGINAL one-slot record node, so `setCrowd(false)` needs Task 6 to
  re-sync (rebind back or rebuild) the per-body view; a plain `detach` alone leaves the hidden
  per-body material reading a stale record. Stage-a rollback is expected to be a page reload
  (`?crowd=0`), which Task 8 makes the canonical opt-out.

---

## Task 6: Game wiring behind `?crowd=1`

**Files:** `src/lab/sdf-zombie/webgpu/game-main.ts`, `src/lab/sdf-zombie/webgpu/sdf-layer.ts`

- [ ] **Step 1: Flag and registry.** Near the `?tiles-playtest` parse: `const crowdFlag = params.get('crowd') === '1'; let crowdOn = crowdFlag;` and `const crowdTypes = new Map<string, CrowdType>();` with `function crowdTypeFor(name: string, palette, light): CrowdType` that lazily creates one via `createCrowdType(renderer, name, defaultUniforms(blankFaceTexture()), sdfLayer.maxWidth, sdfLayer.maxHeight)`, applies the same per-TYPE stamping `spawnEnemy` does today (`applyMaterial(palette ?? flesh, LIGHT_PRESETS['practical-hard-key'])`, `applyWoundRamp`, `woundCfg2.y = GAME_RELAX`, `perfCfg`, `marchCfg.y`, `normalGradientCfg`, `aaCfg`, `levelShadowCfg.x`, face texture/`faceCfg`/`faceProj` from `compileCharacterSheet(characterEntry(name))`) onto `type.uniforms`, sets `type.mesh.layers.set(SDF_LAYER)`, `type.depthPreMesh.layers.set(DEPTH_PREPASS_LAYER)`, `scene.add` both, and `deferredApi?.router.register(type.mesh, 'sdf')` + `register(type.depthPreMesh, 'exclude')`.

- [ ] **Step 2: Spawn/despawn.** In `spawnEnemy`, after the view is built: `if (crowdOn) { const t = crowdTypeFor(name, palette, light); const slot = t.attach(view); if (slot < 0) console.warn('[crowd] type full', name); else { actor.crowd = { type: t, slot }; view.object.visible = false; view.depthPreObject && (view.depthPreObject.visible = false); } }` — the per-body proxy objects stay in the scene but hidden (cheap rollback via `setCrowd(false)`). Skip the per-body `deferredApi.router.register(view.object, 'sdf')` when attached. In `releaseSkeletonActor` / `rebuildCast` / corpse-bake retire: `actor.crowd?.type.detach(actor.crowd.slot)`.

- [ ] **Step 3: Per-frame.** In the draw fn's legacy branch, after the per-actor uniform block (which now ends with `a.view.syncRecord()`): `for (const t of crowdTypes.values()) { if (map !== null) t.levelShadowTex.value = map; t.uniforms.<global lighting members>.value.copy(...)` — copy the same global values the loop writes per actor (`spotPos, spotAxis, spotCfg, spotColor, spotCfg2, bounceSpot*, levelShadowMatrix, levelShadowCfg.x`) onto `t.uniforms`; then `t.sync(camera, tileGridFor(sdfLayer.targetSize))` (reuse `refreshActorTiles`'s grid computation) timed under a `crowd-sync` telemetry label. In `bindSkeletonVolume`, when the actor is attached, also call `t.setSkeletonVolume(shared.texture, binding.metaTexture)` — note the meta texture is per actor today (`SegmentVolumeBinding` owns one per actor): for stage (a) the crowd type binds the FIRST attached actor's meta and logs once; `segVolumeMeta` per instance is a known gap recorded in the dev note (bone-tube culling in `segment` mode is per-instance pose; the visible effect is bone-cull mode falling back to `cluster` for non-first instances — set `setBoneCullMode('cluster')` for attached views to keep it honest).

- [ ] **Step 4: Bodies list.** `sdfLayer.setBodies(crowdOn ? [...crowdTypes.values()].map(t => t.mesh).concat(visibleActors.filter(a => !a.crowd).map(a => a.view.object)) : visibleActors.map(a => a.view.object), chunkObjects())`. In `sdf-layer.ts` add a comment on `setBodies` that a crowd mesh is one Object3D for N instances and that `sortFrontToBack`/`temporalMarginForMotion` treat it as one body at its mesh position (the temporal-start margin becomes conservative for crowds; acceptable in stage a).

- [ ] **Step 5: Seams.** `__sdfGame.setCrowd(on)` toggles `crowdOn`, and for every actor attaches/detaches accordingly (hide/show `view.object` and `view.depthPreObject`); `__sdfGame.crowdInfo()` returns `{ on, types: [...crowdTypes].map(([n, t]) => ({ name: n, ...t.info() })) }`. Refine/cone: in `spawnEnemy`, when attached and `view.refineObject` exists, set it invisible and log once `[crowd] refine twins are not supported in crowd mode (stage 3)`.

- [ ] **Step 6: Gate**

```bash
npx tsc --noEmit -p .
node scripts/march-hash.mjs                                # per-body path: a8ab4e…
MARCH_HASH_QUERY='crowd=1' node scripts/march-hash.mjs      # crowd path, tiles off inside the type → expect a8ab4e…
MARCH_HASH_QUERY='crowd=1&tiles-playtest' MARCH_HASH_TILES=1 node scripts/march-hash.mjs   # expect the Task-0 tiles-on baseline
```

If `crowd=1` differs from canonical: check `crowdInfo()` reports 2 types attached in room 1 (zombie + soldier), then compare with `debugCfg.y` flat albedo. The likely culprits: `syncRecord()` written before `attach` rebound the slot (the record went to the one-slot buffer), `instCentre/instHalf` select not taken (`instCfg.y`), or the type's uniforms missing a per-type stamp `spawnEnemy` applied to the view (diff `type.uniforms` against `view.uniforms` member by member in the console).

- [ ] **Step 7: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts src/lab/sdf-zombie/webgpu/sdf-layer.ts
git commit -m "feat(crowd): ?crowd=1 wires one CrowdType per character, per-type rebinds, setCrowd/crowdInfo seams"
```

---

## Task 7: Room-2 parity diagnostic and the crowd bench

**Files:** `src/lab/sdf-zombie/webgpu/game-main.ts` (debug seam), `scripts/march-hash.mjs`, `docs/dev-notes/2026-09-13-merged-crowd-march-stage-a.md`, `TASKS.md`

- [ ] **Step 1: Multi-slot tile mask seam.** Add `__sdfGameDebug.readTileSlotMask()` that reads back, per tile, whether the crowd binding's entry list holds ≥2 distinct slots (CPU-side from the last `groups` the type binned: reuse `TileBinner` on the same inputs to get per-tile slot sets — it is the bit-identical reference) and returns a `Uint8Array(tilesX*tilesY)`.

- [ ] **Step 2: Room-2 hash with mask.** In `march-hash.mjs`, add `MARCH_HASH_ROOM=2` support (`stageCloseUp(evaluate, { room: 2 }, fail)`) and, when `MARCH_HASH_MASK=1`, hash only the texels whose tile mask is 0 (single-slot tiles) and report the masked fraction. Run room 2 per-body vs `crowd=1`: the masked hashes must match; record the unmasked hashes and the masked fraction in the dev note. If they do not match on single-slot tiles, that is a real bug (a banded read still at band 0, or `gHitSlot` stale in `calcNormal`'s four `mapBody` calls — each call re-loads slots; `calcNormal` must run the same slot loop, which it does by construction).

- [ ] **Step 3: Bench.** Inside lab-servers:

```bash
BENCH_PASSES=1 BENCH_ROOMS=1,2 BENCH_LEGS=baseline,crowd-on BENCH_QUERY='crowd=1&tiles-playtest' BENCH_OUT=docs/dev-notes/2026-09-13-merged-crowd-march-stage-a/rooms12 node scripts/sdf-game-bench.mjs
BENCH_PASSES=1 BENCH_ROOMS=1 BENCH_LEGS=baseline,crowd-on BENCH_CROWD=24 BENCH_QUERY='crowd=1&tiles-playtest' BENCH_OUT=docs/dev-notes/2026-09-13-merged-crowd-march-stage-a/crowd24 node scripts/sdf-game-bench.mjs
BENCH_PASSES=1 BENCH_ROOMS=1 BENCH_LEGS=baseline,crowd-on BENCH_CROWD=48 BENCH_QUERY='crowd=1&tiles-playtest' BENCH_OUT=docs/dev-notes/2026-09-13-merged-crowd-march-stage-a/crowd48 node scripts/sdf-game-bench.mjs
```

(`baseline` under `crowd=1` query still runs per-body because `setCrowd` defaults to the flag — make the `baseline` leg apply `setCrowd: false` explicitly in `ALL_LEGS` so the A/B is honest.) Record in the dev note: `sdf:march` and `sdf:depth-pre` p50 per leg, `crowd-sync` CPU ms, `crowdInfo().tileFallbacks`, and the acceptance verdict against spec §5 a-3 (flat at 3–5 bodies; 24→48 grows with covered pixels, not 2×).

- [ ] **Step 4: TASKS.md.** Under the MERGED CROWD MARCH entry add `- [x] stage a-1 (records, one-slot kernel) <commit>`, `- [x] a-2 (?crowd=1)` with the hash results, `- [ ] a-3 default flip` with the bench numbers and what blocks the flip if anything.

- [ ] **Step 5: Commit**

```bash
git add src/lab/sdf-zombie/webgpu/game-main.ts scripts/march-hash.mjs docs/dev-notes/2026-09-13-merged-crowd-march-stage-a.md docs/dev-notes/2026-09-13-merged-crowd-march-stage-a/ TASKS.md
git commit -m "bench(crowd): room-2 masked parity, crowd 24/48 legs, results"
```

---

## Task 8: Default flip (only if Task 7's bars hold)

**Files:** `src/lab/sdf-zombie/webgpu/game-main.ts`, `scripts/march-hash.mjs`, `scripts/sdf-game-bench.mjs`, `TASKS.md`

- [ ] **Step 1:** `crowdOn` defaults to `true`; `?crowd=0` opts out. `march-hash.mjs` canonical value becomes the `crowd=1` hash from Task 6 Step 6 (identical to `a8ab4e…` if a-2 held; otherwise the recorded new value, with the reason written next to it). Bench: `baseline` leg is now the crowd path; add `crowd-off` `{ setCrowd: false }`.
- [ ] **Step 2:** Gate: `node scripts/march-hash.mjs` ×2, `node scripts/refine-smoke.mjs` with `?crowd=0` (refine is not supported under crowd until stage 3 — add `crowd=0` to refine-smoke's boot query and a comment pointing at stage 3), `UPSCALE_SMOKE_REFINE=1 node scripts/upscale-smoke.mjs`.
- [ ] **Step 3:** Commit `feat(crowd): crowd march is the default; ?crowd=0 opts out`.

---

## Follow-on plans (not in this document)

- **Stage a-2 dispatch:** per-tile screen quads replacing instanced boxes (one ray per pixel), acceptance = masked parity + bench delta on the overlap-heavy crowd48 leg.
- **Stage 3:** refine as one fullscreen record-reading pass; delete `REFINE_LAYER` twins, `refineTailUniforms`, Task E.
- **Stage 4:** chunk type (gibs as slots; `createSharedChunkGpuMaterial` retired), corpse bake for every character (`corpseBakeEligible` off the soldier name gate; `refineObject` handled in restore).
- **Stage b:** GPU posing from the type's rest template.

## Self-review notes

- Spec coverage: D1–D10 map to Tasks 1–6; §5 bars a-0…a-3 map to Tasks 0, 4, 6, 7; D7 twins handled in Task 5 (depth-pre) and Task 6 Step 5 (refine/cone off); D8 noise shift is the record's `REC_NOISE_YAW`; D9 is Task 6 Step 1.
- Names: `syncRecord`, `rebind`, `records`, `sink`, `instCfg`, `gHitSlot`, `tileHasSlot`, `gTileSlot`, `instCentre/instHalf`, `createCrowdMaterial`, `crowdTypeFor`, `actor.crowd` are used consistently across Tasks 4–7; the param-count pin goes 100 → 88 (Task 3) → 90 (Task 5).
- Known gaps stated, not hidden: per-instance `segVolumeMeta` (Task 6 Step 3), temporal-start margin per crowd mesh (Task 6 Step 4), refine/cone unsupported under crowd (Task 6 Step 5), duplicate traces on overlapping boxes (spec D5, measured in Task 7).
