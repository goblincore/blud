# March Lean Walk Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A clean-body fast path for the march's walk (`mapLean`, chosen per pixel), behind `?leanwalk`, default off, bit-identical to the shipped picture.

**Spec:** `docs/superpowers/specs/2026-11-09-march-lean-walk-design.md` — read it first. The measurement behind it: `docs/dev-notes/2026-11-09-sdf-perf-research/LADDER.md`.

**Architecture:** One new non-barrel module, `march/lean-walk.wgsl.ts`, holds the WGSL (`mapLean`, the per-pixel test, the census) and the test's CPU mirror. Existing march modules splice that text in under a compile-time flag (`march/lean-walk-flag.ts`); with the flag off every existing string is byte-identical. Scripts under `scripts/` prove bit identity and time it.

**Tech Stack:** TypeScript, three.js WebGPU + TSL, WGSL string modules, Vitest, headless-Chrome capture scripts (`scripts/*.mjs`).

## Rules for every task

- Rendering goes in **hand-written WGSL** (`*.wgsl.ts` string modules); logic that can be pure is a pure function with its own test.
- Work ONLY in this worktree (`/Users/donny/Projects/blud/.claude/worktrees/march-lean-walk-40ed5e`). Never `git stash`. `node_modules` is symlinked: do not reinstall. **Do not commit**: the lead reviews the diff and commits.
- **Targeted tests only** (`npx vitest run <path>`, or `npm run test:changed`) plus `npm run typecheck`. Never the full suite.
- **The golden snapshot must not change** (`src/lab/sdf-zombie/webgpu/march/__snapshots__/march-golden.test.ts.snap`). It hashes every string export of the barrel `src/lab/sdf-zombie/webgpu/march.wgsl.ts`, the joined `HELPERS` list, its length and the SET OF EXPORT NAMES. So: add no export to any module the barrel re-exports, add nothing to `HELPERS`, and never run vitest with `-u`.
- **Never add a `mapBody(` call site.** Metal inlines each one (`docs/dev-notes/2026-09-21-march-cold-compile/NOTES.md`).
- Tasks 1 and 2 run no browser and no GPU. Task 3 may, and only while holding the machine's GPU lock: `until mkdir /tmp/blud-gpu-timing.lock 2>/dev/null; do sleep 10; done` before, `rm -rf /tmp/blud-gpu-timing.lock` after (also on failure), with `LAB_TMP=.lab-tmp` set. Headless capture only. Kill anything you start.
- Every new `.ts` module under `src/lab/sdf-zombie` starts with a header comment whose first sentence says what it owns (`scripts/module-index.test.ts`); after adding one run `npx tsx scripts/module-index.ts`.
- Never claim a GPU result from a unit test. Report what you ran and what you did not.

---

## Task 1: the flag, `mapLean`, the per-pixel test and its mirror

**Files:**
- Create: `src/lab/sdf-zombie/webgpu/march/lean-walk-flag.ts`
- Create: `src/lab/sdf-zombie/webgpu/march/lean-walk.wgsl.ts`
- Test: `src/lab/sdf-zombie/webgpu/march/lean-walk.wgsl.test.ts`
- Read first: `march/map-body.wgsl.ts` (all of `MAP_BODY`), `march/fields/groups.wgsl.ts` (`foldGroup`, the globals, `loadInstance`), `march/fields/carves.wgsl.ts` (`applyCarves`), `march/fields/wounds.wgsl.ts` lines 69-100, `crowd-records.ts`, `march/shade-bound-flag.ts`.

Nothing is wired in this task: no existing file changes.

- [ ] **Step 1: the flag module.** `lean-walk-flag.ts`, same shape as `raymask-flag.ts`:

```ts
// src/lab/sdf-zombie/webgpu/march/lean-walk-flag.ts
//
// COMPILE-TIME switch for the CLEAN-BODY FAST PATH of the march's walk (2026-11-09;
// docs/superpowers/specs/2026-11-09-march-lean-walk-design.md). With `?leanwalk` the march gains a second field
// function, mapLean (lean-walk.wgsl.ts): the tile-list fold and the carves, none of mapBody's wound, re-fold, bone,
// volume or head-split code. The setup decides once per pixel whether mapLean is exact for every slot in the pixel's
// table, and the walk and the temporal start's probe call it there. The picture is the same to the bit. Without the
// flag the shader text is byte-identical (the march-hash golden), the same contract as shade-bound-flag.ts.
export const LEAN_WALK: boolean = (() => {
  try {
    const search = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    return new URLSearchParams(search).has('leanwalk');
  } catch {
    return false;
  }
})();
```

- [ ] **Step 2: write the failing tests** (`lean-walk.wgsl.test.ts`). Cover:

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_CROWD_INSTANCES, REC_ANCHOR_BAND, REC_COUNTS, REC_COUNTS2, REC_HEAD_WCOUNT, REC_SPLIT_N, REC_VEC4S,
  REC_VOL_POSE0, REC_WIND_ALIVE, createCrowdRecords, type RecordSource,
} from '../crowd-records';
import { LEAN_WALK } from './lean-walk-flag';
import { LEAN_CENSUS_BLOCK, LEAN_TEST_BLOCK, MAP_LEAN, leanSlotExact } from './lean-walk.wgsl';

const clean = (): RecordSource => ({
  counts: [40, 6, 2, 0.02], counts2: [12, 0, 8, 1], woundBound: [0, 0, 0, 1e9], bodyAnchor: [0, 0, 0],
  windDrift: [0, 0, 0], meltCfg: [0, 0, 0, 0], bodyFlash: [0, 0, 0, 0], noiseShift: [0, 0, 0], bodyYaw: 0,
  headCentre: [0, 1.6, 0], woundCount: 0, headQuat: [0, 0, 0, 1], volumePose0: [0, 0, 0, 0],
  volumePose1: [0, 0, 0, 0], bodyCentre: [0, 1, 0], variantSeed: 1, bodyHalf: [0.5, 1, 0.5], damageRevision: 0,
  gore: 0, burn: 0, burnSec: 0, charAmount: 0,
});
const slotOk = (edit: (s: RecordSource) => void, slot = 1) => {
  const rec = createCrowdRecords(3);
  const src = clean();
  edit(src);
  rec.write(0, clean());
  rec.write(slot, src);
  return leanSlotExact(rec.floats, slot);
};

describe('the lean walk is compile-time gated (?leanwalk)', () => {
  it('is off without the flag', () => { expect(LEAN_WALK).toBe(false); });
});

describe('leanSlotExact: the per-slot conditions of the per-pixel test', () => {
  it('passes a clean, closed, alive body with bones but no bare-bones flag', () => {
    expect(slotOk(() => {})).toBe(true);
  });
  it('fails on any wound', () => { expect(slotOk((s) => { s.woundCount = 1; })).toBe(false); });
  it('fails on an open head split', () => {
    expect(slotOk((s) => { s.split = { n: [1, 0, 0], h: [0, 1.6, 0], a: [0, 0, 1], d0: 0, thetaP: 0.4, thetaM: -0.2, r: 0.3 } as RecordSource['split']; })).toBe(false);
  });
  it('fails on the baked-volume branch', () => { expect(slotOk((s) => { s.volumePose0 = [0, 0, 0, 1]; })).toBe(false); });
  it('fails on the bare-bones bypass when the body has bones', () => { expect(slotOk((s) => { s.counts2 = [12, 1, 8, 1]; })).toBe(false); });
  it('passes the bare-bones flag on a body with no bones (the bone fold needs counts2.x > 0)', () => {
    expect(slotOk((s) => { s.counts2 = [0, 1, 8, 1]; })).toBe(true);
  });
  it('passes a dead slot whatever it holds: it folds in neither function', () => {
    const rec = createCrowdRecords(2);
    const src = clean();
    src.woundCount = 5;
    rec.write(1, src);
    rec.alive(1, false);
    expect(leanSlotExact(rec.floats, 1)).toBe(true);
  });
  it('fails a NaN wound count', () => {
    const rec = createCrowdRecords(1);
    rec.write(0, clean());
    rec.floats[REC_HEAD_WCOUNT * 4 + 3] = Number.NaN;
    expect(leanSlotExact(rec.floats, 0)).toBe(false);
  });
});

describe('LEAN_TEST_BLOCK: the same conditions, read from the record layout', () => {
  it('reads each lane the mirror reads, by its REC_ index', () => {
    expect(LEAN_TEST_BLOCK).not.toMatch(/undefined|NaN/);
    expect(LEAN_TEST_BLOCK).toContain(`* ${REC_VEC4S};`);
    expect(LEAN_TEST_BLOCK).toContain(`(*inst)[lrb + ${REC_WIND_ALIVE}].w < 0.5) { continue; }`);
    expect(LEAN_TEST_BLOCK).toContain(`!((*inst)[lrb + ${REC_HEAD_WCOUNT}].w < 0.5)`);
    expect(LEAN_TEST_BLOCK).toContain(`(*inst)[lrb + ${REC_SPLIT_N}].xyz`);
    expect(LEAN_TEST_BLOCK).toContain('dot(lsn, lsn) > 0.5');
    expect(LEAN_TEST_BLOCK).toContain(`(*inst)[lrb + ${REC_VOL_POSE0}].w > 0.5`);
    expect(LEAN_TEST_BLOCK).toContain(`(*inst)[lrb + ${REC_COUNTS2}]`);
    expect(LEAN_TEST_BLOCK).toContain('(lc2.y > 0.5 && lc2.x > 0.0)');
  });
  it('reads no record lane but those five', () => {
    const reads = [...LEAN_TEST_BLOCK.matchAll(/\(\*inst\)\[lrb \+ (\d+)\]/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
    expect(reads).toEqual([REC_COUNTS2, REC_WIND_ALIVE, REC_HEAD_WCOUNT, REC_VOL_POSE0, REC_SPLIT_N].sort((a, b) => a - b));
  });
  it('is tiled pixels only, honours the runtime switch and refuses a non-empty per-ray wound list', () => {
    expect(LEAN_TEST_BLOCK).toContain('var leanOk = gTileActive > 0.5 && debugCfg.x > -0.5 && !(gWoundListOn > 0.5 && gWoundN > 0);');
  });
  it('walks the slot table with mapBody\'s own bound', () => {
    expect(LEAN_TEST_BLOCK).toContain(`lk < ${MAX_CROWD_INSTANCES};`);
    expect(LEAN_TEST_BLOCK).toContain('if (lk >= gPixN) { break; }');
    expect(LEAN_TEST_BLOCK).toContain('gPixSlot[lk]');
  });
});

describe('MAP_LEAN: the tile-list fold and the carves, and mapBody\'s exit state', () => {
  it('begins with its declaration and names no undefined constant', () => {
    expect(MAP_LEAN).toMatch(/^fn mapLean\(pIn: vec3<f32>, data: texture_2d<f32>, inst: ptr<storage, array<vec4<f32>>, read>, instCfg: vec4<f32>\) -> vec4<f32> \{/);
    expect(MAP_LEAN).not.toMatch(/undefined|NaN/);
  });
  it('reads three records a slot and no more', () => {
    const reads = [...MAP_LEAN.matchAll(/\(\*inst\)\[rb \+ (\d+)\]/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
    expect(reads).toEqual([REC_COUNTS, REC_ANCHOR_BAND, REC_WIND_ALIVE].sort((a, b) => a - b));
    expect(MAP_LEAN).toContain(`let rb = (base + s) * ${REC_VEC4S};`);
  });
  it('folds the slot\'s tile run through foldGroup, once, then the carves, once', () => {
    expect(MAP_LEAN.split('foldGroup(').length - 1).toBe(1);
    expect(MAP_LEAN.split('applyCarves(').length - 1).toBe(1);
    expect(MAP_LEAN).toContain('for (var e = gPixFirst[k]; e < gPixEnd[k]; e = e + 1) {');
    expect(MAP_LEAN).toContain('d = foldGroup(d, pIn, data, counts, band, gTileBounds[e], gTileGrp[e]);');
    expect(MAP_LEAN.indexOf('foldGroup(')).toBeLessThan(MAP_LEAN.indexOf('applyCarves('));
  });
  it('calls nothing a clean body does not need', () => {
    expect(MAP_LEAN).not.toMatch(/mapBody\(|applyWounds\(|applyBones\(|sampleHandVolume\(|splitMoveBack\(|fbm\(/);
  });
  it('keeps the upper-bound cull for the slot and piece it was measured on, and clears it', () => {
    expect(MAP_LEAN).toContain('gCullRef = select(1e9, gCullUB, base + s == gCullSlot && gCullPiece == 0);');
    expect(MAP_LEAN.indexOf('gCullRef = 1e9;')).toBeGreaterThan(MAP_LEAN.indexOf('foldGroup('));
    expect(MAP_LEAN.indexOf('gCullRef = 1e9;')).toBeLessThan(MAP_LEAN.indexOf('applyCarves('));
  });
  it('sets the per-slot shell globals the fold reads and puts them back on the loaded instance', () => {
    expect(MAP_LEAN).toContain('gWindDrift = wa.xyz;');
    expect(MAP_LEAN).toContain('gBodyAnchor = ab.xyz;');
    const tail = MAP_LEAN.slice(MAP_LEAN.indexOf('if (gSlot != wantSlot)'));
    expect(tail).toContain('gWindDrift = gInstWind;');
    expect(tail).toContain('gBodyAnchor = gInstAnchor;');
  });
  it('leaves every global the walk reads after mapBody', () => {
    for (const line of [
      'gRefoldWin = 0.0;', 'gWalkGapNew = 1e9;', 'gWalkAttempted = 0.0;',
      'gLastFold = foldU;', 'gLastFoldSlot = bestSlot;', 'gLastFoldPiece = 0;',
      'gFoldBest = bestU;', 'gFoldBestIdx = bestIdxU;', 'gFoldBestDistort = bestDistortU;',
      'gHitSlot = bestSlot;', 'gHitPiece = 0;', 'gHitSplitF = splitFU;',
    ]) expect(MAP_LEAN).toContain(line);
  });
  it('reloads the instance with mapBody\'s own tail, and nowhere else', () => {
    expect(MAP_LEAN.split('loadInstance(').length - 1).toBe(1);
    expect(MAP_LEAN).toContain('let wantSlot = select(bestSlot, gPinSlot, gPinSlot >= 0);');
    expect(MAP_LEAN).toContain('if (gSlot != wantSlot) { loadInstance(inst, wantSlot); }');
  });
  it('returns mapBody\'s packing: the union, the dominant prim, no near-wound flag, the carved field', () => {
    expect(MAP_LEAN).toContain('return vec4<f32>(dUnion, bestIdxU, 0.0, carvedU);');
    expect(MAP_LEAN).toContain('var carvedU = 0.0;');
    expect(MAP_LEAN).toContain('var splitFU = 1e9;');
  });
});

describe('LEAN_CENSUS_BLOCK (debug mode 23)', () => {
  it('returns the per-pixel choice, the slot count and the steps before the miss discard', () => {
    expect(LEAN_CENSUS_BLOCK).toContain('if (debugCfg.x > 22.5 && debugCfg.x < 23.5) {');
    expect(LEAN_CENSUS_BLOCK).toContain('return vec4<f32>(select(0.0, 1.0, leanOk), f32(gPixN), gDebugSteps + select(0.0, 1000.0, hit), t);');
  });
});
```

If the `split` literal does not satisfy `SplitWarp` (`src/lab/sdf-zombie/head-split.ts`), build it with that type's real fields; the test must write an OPEN split through `createCrowdRecords().write`.

- [ ] **Step 3: run it, see it fail** (`npx vitest run src/lab/sdf-zombie/webgpu/march/lean-walk.wgsl.test.ts`: the module does not exist).

- [ ] **Step 4: write `lean-walk.wgsl.ts`.** Header comment first (what it owns, the spec's path, the exactness table in brief, and that it is NOT re-exported by the barrel because the golden snapshot hashes the barrel's export names). Import the `REC_*` constants and `MAX_CROWD_INSTANCES` from `'../crowd-records'` exactly as `march/fields/groups.wgsl.ts` and `march/map-body.wgsl.ts` do (there is an import cycle through the barrel that those modules already live with; the `not.toMatch(/undefined|NaN/)` tests are the guard). The text:

```ts
export const MAP_LEAN = /* wgsl */ `fn mapLean(pIn: vec3<f32>, data: texture_2d<f32>, inst: ptr<storage, array<vec4<f32>>, read>, instCfg: vec4<f32>) -> vec4<f32> {
  gRefoldWin = 0.0;
  gWalkGapNew = 1e9;
  gWalkAttempted = 0.0;
  var dUnion = 1e9;
  var bestSlot = gSlot;
  var bestIdxU = -1.0;
  var bestU = 1e9;
  var bestDistortU = 1.0;
  var foldU = 1e9;
  var carvedU = 0.0;
  var splitFU = 1e9;
  let base = i32(instCfg.z);
  for (var k = 0; k < ${MAX_CROWD_INSTANCES}; k = k + 1) {
    if (k >= gPixN) { break; }
    let s = gPixSlot[k];
    // THREE record reads a slot, not loadInstance's twenty-two: what the fold and the carves read.
    let rb = (base + s) * ${REC_VEC4S};
    let wa = (*inst)[rb + ${REC_WIND_ALIVE}];
    if (wa.w < 0.5) { continue; }
    let counts = (*inst)[rb + ${REC_COUNTS}];
    let ab = (*inst)[rb + ${REC_ANCHOR_BAND}];
    let band = i32(ab.w);
    // loadInstance's two writes that foldGroup reads (sdShell's wind and noise frame), per slot.
    gWindDrift = wa.xyz;
    gBodyAnchor = ab.xyz;
    var d = 1e9;
    gFoldBest = 1e9;
    gFoldBestIdx = -1.0;
    gFoldBestDistort = 1.0;
    // UPPER-BOUND CULL, mapBody's expression for a closed slot (piece 0, no limb mode).
    gCullRef = select(1e9, gCullUB, base + s == gCullSlot && gCullPiece == 0);
    for (var e = gPixFirst[k]; e < gPixEnd[k]; e = e + 1) {
      d = foldGroup(d, pIn, data, counts, band, gTileBounds[e], gTileGrp[e]);
    }
    gCullRef = 1e9;
    let carved = applyCarves(d, pIn, data, counts, band);
    if (carved < dUnion) {
      dUnion = carved;
      bestSlot = base + s;
      carvedU = carved;
      bestIdxU = gFoldBestIdx;
      bestU = gFoldBest;
      bestDistortU = gFoldBestDistort;
      foldU = d;
      splitFU = carved;
    }
  }
  gLastFold = foldU;
  gLastFoldSlot = bestSlot;
  gLastFoldPiece = 0;
  gFoldBest = bestU;
  gFoldBestIdx = bestIdxU;
  gFoldBestDistort = bestDistortU;
  gHitSlot = bestSlot;
  gHitPiece = 0;
  gHitSplitF = splitFU;
  // THE LOADED INSTANCE, as mapBody leaves it: the winning slot (the pinned one after a hit). gSlot names a fully
  // loaded instance (loadInstance is its only writer), so this reloads only when the winner changes.
  let wantSlot = select(bestSlot, gPinSlot, gPinSlot >= 0);
  if (gSlot != wantSlot) { loadInstance(inst, wantSlot); }
  gWindDrift = gInstWind;
  gBodyAnchor = gInstAnchor;
  return vec4<f32>(dUnion, bestIdxU, 0.0, carvedU);
}`;

export const LEAN_TEST_BLOCK = /* wgsl */ `  // LEAN WALK (?leanwalk, lean-walk-flag.ts). Once per pixel, after the tile preload, the slot table and the wound
  // list. True only when mapLean is exact for EVERY slot of the pixel's table (the argument, branch by branch, is in
  // docs/superpowers/specs/2026-11-09-march-lean-walk-design.md). debugCfg.x == -1 is the runtime A/B switch
  // (__sdfGame.setLeanWalk(false)). A non-empty per-ray wound list rules the pixel out whatever its bodies carry,
  // because applyWounds walks that list for every slot, not the slot's own wound count.
  var leanOk = gTileActive > 0.5 && debugCfg.x > -0.5 && !(gWoundListOn > 0.5 && gWoundN > 0);
  if (leanOk) {
    let leanBase = i32(instCfg.z);
    for (var lk = 0; lk < ${MAX_CROWD_INSTANCES}; lk = lk + 1) {
      if (lk >= gPixN) { break; }
      let lrb = (leanBase + gPixSlot[lk]) * ${REC_VEC4S};
      // A dead slot folds in neither function.
      if ((*inst)[lrb + ${REC_WIND_ALIVE}].w < 0.5) { continue; }
      let lc2 = (*inst)[lrb + ${REC_COUNTS2}];
      let lsn = (*inst)[lrb + ${REC_SPLIT_N}].xyz;
      // Wounds, an open head split, the baked-volume branch, the bare-bones bone fold. Written so a NaN lane fails.
      if (!((*inst)[lrb + ${REC_HEAD_WCOUNT}].w < 0.5) || dot(lsn, lsn) > 0.5 || (*inst)[lrb + ${REC_VOL_POSE0}].w > 0.5 || (lc2.y > 0.5 && lc2.x > 0.0)) { leanOk = false; break; }
    }
  }`;

export const LEAN_CENSUS_BLOCK = /* wgsl */ `
  // LEAN WALK CENSUS (debugCfg.x == 23, ?leanwalk only). Raw counters, returned before the miss discard.
  // r = 1 where the walk took mapLean, g = slots in the pixel's table, b = steps + 1000 * hit. Only ever read back.
  if (debugCfg.x > 22.5 && debugCfg.x < 23.5) {
    return vec4<f32>(select(0.0, 1.0, leanOk), f32(gPixN), gDebugSteps + select(0.0, 1000.0, hit), t);
  }`;

/** The per-slot part of LEAN_TEST_BLOCK on the CPU: is mapLean exact for the body in `slot` of a record buffer
 *  (`CrowdRecords.floats`)? Term for term the WGSL above. */
export function leanSlotExact(floats: ArrayLike<number>, slot: number): boolean {
  const b = slot * REC_VEC4S * 4;
  if (floats[b + REC_WIND_ALIVE * 4 + 3]! < 0.5) return true;
  const n = b + REC_SPLIT_N * 4;
  const open = floats[n]! * floats[n]! + floats[n + 1]! * floats[n + 1]! + floats[n + 2]! * floats[n + 2]! > 0.5;
  const c2 = b + REC_COUNTS2 * 4;
  const bareBones = floats[c2 + 1]! > 0.5 && floats[c2]! > 0;
  return floats[b + REC_HEAD_WCOUNT * 4 + 3]! < 0.5 && !open && !(floats[b + REC_VOL_POSE0 * 4 + 3]! > 0.5) && !bareBones;
}
```

- [ ] **Step 5: run the tests, see them pass.** Also `npx vitest run src/lab/sdf-zombie/webgpu/march/march-golden.test.ts scripts/module-index.test.ts` (run `npx tsx scripts/module-index.ts` first) and `npm run typecheck`.

- [ ] **Step 6: report.** Files changed, test output tail, anything in `MAP_BODY` that disagrees with the spec's table (read it against the table and say so explicitly, branch by branch: this review is part of the task).

---

## Task 2: wire it in

**Files:**
- Modify: `src/lab/sdf-zombie/webgpu/march/map-body.wgsl.ts` (the tail of `MAP_BODY` only)
- Modify: `src/lab/sdf-zombie/webgpu/march/body/trace.wgsl.ts` (`MARCH_TRACE_SETUP`'s block list, the walk's call)
- Modify: `src/lab/sdf-zombie/webgpu/march/body/blocks/setup/start-bounds.wgsl.ts` (the probe's call)
- Modify: `src/lab/sdf-zombie/webgpu/march/body/blocks/loop/debug-counters.wgsl.ts` (the census)
- Modify: `src/lab/sdf-zombie/webgpu/game-seams-march-debug.ts` (`setLeanWalk`, `leanWalkState`)
- Test: `src/lab/sdf-zombie/webgpu/march/lean-walk-wiring.test.ts`

Every splice is `${LEAN ? '<new text>' : ''}` (import `{ LEAN_WALK as LEAN } from` the flag module) around text that does not otherwise change. With the flag off each exported string must be the same bytes as before.

- [ ] **Step 1: write the failing test** (`lean-walk-wiring.test.ts`):

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as OFF from '../march.wgsl';
import { LEAN_CENSUS_BLOCK, LEAN_TEST_BLOCK, MAP_LEAN } from './lean-walk.wgsl';

const count = (s: string, needle: string) => s.split(needle).length - 1;
const loadOn = async () => {
  vi.resetModules();
  vi.stubGlobal('location', { search: '?leanwalk' });
  return await import('../march.wgsl');
};
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

const WALK_ON = '    var dres = vec4<f32>(0.0);\n    if (leanOk) { dres = mapLean(camPos + rd * t, data, inst, instCfg); } else { dres = ';
const PROBE_ON = 'if (leanOk) { dres0 = mapLean(camPos + rd * s, data, inst, instCfg); } else { ';

describe('lean walk wiring, flag off', () => {
  it('leaves no trace in the shipped text', () => {
    const all = [OFF.MAP_BODY, OFF.MARCH_TRACE_SETUP, OFF.MARCH_TRACE_LOOP, OFF.MARCH_TRACE_POST, (OFF.HELPERS as string[]).join('\n')].join('\n');
    expect(all).not.toMatch(/mapLean|leanOk|debugCfg\.x > 22\.5/);
  });
});

describe('lean walk wiring, ?leanwalk', () => {
  it('appends mapLean to mapBody\'s tail and changes nothing else in it', async () => {
    const ON = await loadOn();
    expect(ON.MAP_BODY).toBe(`${OFF.MAP_BODY}\n${MAP_LEAN}`);
    expect((ON.HELPERS as string[]).length).toBe((OFF.HELPERS as string[]).length);
  });
  it('puts the per-pixel test after the wound list and before the hull bounds', async () => {
    const ON = await loadOn();
    expect(count(ON.MARCH_TRACE_SETUP, LEAN_TEST_BLOCK)).toBe(1);
    const at = ON.MARCH_TRACE_SETUP.indexOf('var leanOk');
    expect(at).toBeGreaterThan(ON.MARCH_TRACE_SETUP.indexOf('gWoundListOn = select('));
    expect(at).toBeGreaterThan(ON.MARCH_TRACE_SETUP.indexOf('gPixN = gPixN + 1;'));
    expect(at).toBeLessThan(ON.MARCH_TRACE_SETUP.indexOf('dres0 = mapBody('));
  });
  it('the walk chooses per pixel at ONE mapBody call site', async () => {
    const ON = await loadOn();
    expect(count(ON.MARCH_TRACE_LOOP, 'mapBody(')).toBe(count(OFF.MARCH_TRACE_LOOP, 'mapBody('));
    expect(count(ON.MARCH_TRACE_LOOP, 'mapLean(')).toBe(1);
    const back = ON.MARCH_TRACE_LOOP.replace(WALK_ON, '    let dres = ').replace('segVolumeMeta, perfCfg, inst, instCfg); }\n    gWalkStep = 0.0;', 'segVolumeMeta, perfCfg, inst, instCfg);\n    gWalkStep = 0.0;').replace(LEAN_CENSUS_BLOCK, '');
    expect(back).toBe(OFF.MARCH_TRACE_LOOP);
  });
  it('the temporal start\'s probe chooses per pixel at ONE mapBody call site', async () => {
    const ON = await loadOn();
    expect(count(ON.MARCH_TRACE_SETUP, 'mapBody(')).toBe(count(OFF.MARCH_TRACE_SETUP, 'mapBody('));
    expect(count(ON.MARCH_TRACE_SETUP, 'mapLean(')).toBe(1);
    const back = ON.MARCH_TRACE_SETUP.replace(`${LEAN_TEST_BLOCK}\n`, '').replace(PROBE_ON, '').replace('segVolumeMeta, perfCfg, inst, instCfg); }\n        if (probe == 3', 'segVolumeMeta, perfCfg, inst, instCfg);\n        if (probe == 3');
    expect(back).toBe(OFF.MARCH_TRACE_SETUP);
  });
  it('the census sits with the other raw-counter modes, before the miss discard', async () => {
    const ON = await loadOn();
    expect(ON.MARCH_TRACE_LOOP.endsWith(`${LEAN_CENSUS_BLOCK}\n`)).toBe(true);
  });
});
```

The round-trip `back === OFF` assertions are the point: **the splices are pure insertions**. Adjust the literal anchors to the real surrounding text if they differ, never the shipped text to the test.

- [ ] **Step 2: run it, see it fail.**

- [ ] **Step 3: `map-body.wgsl.ts`.** Import `LEAN_WALK as LEAN` and `MAP_LEAN`. The template's last line is

```ts
var<private> gShadePiece: i32 = 0;` : ''}`;
```

make it

```ts
var<private> gShadePiece: i32 = 0;` : ''}${LEAN ? `\n${MAP_LEAN}` : ''}`;
```

(`FOLD_GROUP`'s tail carries `limbLoad` and friends the same way under `?limbs`; three's `wgslFn` parses the first `fn` of an include and passes the rest through.) Add a short comment ABOVE `export const MAP_BODY` (outside the template) saying the tail carries `mapLean` under `?leanwalk`.

- [ ] **Step 4: `trace.wgsl.ts`.** Import `LEAN_WALK as LEAN` and `LEAN_TEST_BLOCK`. In `MARCH_TRACE_SETUP`:

```ts
${WOUND_LIST_BLOCK}
${LEAN ? `${LEAN_TEST_BLOCK}
` : ''}${HULL_BOUNDS_BLOCK}
```

The walk's call (one line today, `    let dres = mapBody(camPos + rd * t, ...);`) becomes

```ts
${LEAN ? `    var dres = vec4<f32>(0.0);
    if (leanOk) { dres = mapLean(camPos + rd * t, data, inst, instCfg); } else { dres = ` : '    let dres = '}mapBody(camPos + rd * t, data, vec4<f32>(0.0), woundCfg, woundCfg2, volumeTex, volumeMin, volumeInvExtent, volumeWarp, volumeClip, segVolumeAtlas, segVolumeMeta, perfCfg, inst, instCfg);${LEAN ? ' }' : ''}
```

with the `mapBody(...)` argument text left exactly as it is. Confirm (grep) that every program that includes `MARCH_TRACE_LOOP` or `START_BOUNDS_BLOCK` also includes `MARCH_TRACE_SETUP` ahead of it, so `leanOk` is always declared; report the list.

- [ ] **Step 5: `start-bounds.wgsl.ts`.** Import the flag. The probe line

```
        dres0 = mapBody(camPos + rd * s, ...);
```

becomes `        ${LEAN ? 'if (leanOk) { dres0 = mapLean(camPos + rd * s, data, inst, instCfg); } else { ' : ''}dres0 = mapBody(camPos + rd * s, ...);${LEAN ? ' }' : ''}` (argument text untouched).

- [ ] **Step 6: `debug-counters.wgsl.ts`.** Import the flag and `LEAN_CENSUS_BLOCK`; append `${LEAN ? LEAN_CENSUS_BLOCK : ''}` at the very end of the template (after the `RAYMASK` splice). `LEAN_CENSUS_BLOCK` begins with a newline, as the `RAYMASK` block does.

- [ ] **Step 7: the runtime switch** in `game-seams-march-debug.ts`, beside `setFlatAlbedo`:

```ts
    /** LEAN WALK runtime A/B (a `?leanwalk` page; march/lean-walk-flag.ts). false writes debugCfg.x = -1, which the
     *  per-pixel test reads as "stay on mapBody" (LEAN_TEST_BLOCK), so one compiled program draws both legs. To every
     *  other reader -1 is 0 (each tests `> 0.5` or a mode's own band), and a page without the flag has no reader at
     *  all. It overwrites the debug mode: set that after, not before. Bodies spawned later start at 0 (lean on). */
    setLeanWalk(on: boolean) {
      const x = on ? 0 : -1;
      for (const a of ctx.world.actors) a.view.uniforms.debugCfg.value.x = x;
      for (const c of ctx.bake.views) c.uniforms.debugCfg.value.x = x;
      for (const t of ctx.crowd.types.values()) t.uniforms.debugCfg.value.x = x;
    },
    /** Whether this page compiled the lean walk in, and whether the runtime switch leaves it on. */
    leanWalkState() {
      const x = ctx.world.actors[0]?.view.uniforms.debugCfg.value.x ?? 0;
      return { compiled: LEAN_WALK, enabled: LEAN_WALK && x > -0.5 };
    },
```

Check how the seam objects reach `__sdfGame` (a spread, a typed list, a coverage test) and register the two members the way `setFlatAlbedo` is; say what you found.

- [ ] **Step 8: run** `npx vitest run src/lab/sdf-zombie/webgpu/march/ scripts/module-index.test.ts` (the whole march directory: the golden snapshot, the trace and setup block tests, both lean tests), `npm run typecheck`, and `git status --short` (the snapshot file must not appear). Then `npm run test:changed`.

- [ ] **Step 9: report.** The diff summary, the test tails, the list from step 4, anything surprising.

---

## Task 3: the proof scripts

**Files:**
- Modify: `scripts/march-hash.mjs` (one new env, no pin touched)
- Create: `scripts/lean-walk-parity.mjs`
- Create: `scripts/native-spike/lean-ab.mjs`
- Read first: `scripts/march-hash.mjs` (how it boots, pins the state, stamps wounds, reads the target), `scripts/lib/sdf-closeup-stage.mjs`, `scripts/native-spike/capture.mjs` (its `crowd` scene, `SPIKE_VARIANTS`, `SPIKE_QUERY`, `SPIKE_PRELUDE`), `scripts/native-spike/ladder.mjs` (the rotation timing), `scripts/native-spike/replay-chrome.mjs`, `scripts/native-spike/compare.mjs`, `scripts/lab-servers.sh`.

The page API this task relies on (built in tasks 1 and 2, which may still be landing: until then only the flag-off legs can be smoke-tested):
- URL flag `?leanwalk` compiles the fast path in.
- `__sdfGame.setLeanWalk(false)` forces every walk onto `mapBody` in a `?leanwalk` page; `setLeanWalk(true)` puts it back. `__sdfGame.leanWalkState()` returns `{ compiled, enabled }`.
- `__sdfGame.setMarchDebugMode(23)` (flag-on pages only): the march target's r = 1 where the walk took `mapLean`, g = the pixel's slot count, b = steps + 1000 × hit. `setMarchDebugMode(0)` puts the picture back.

- [ ] **Step 1: `march-hash.mjs`: `MARCH_HASH_FLAGS`.** An extra query string appended in EVERY mode (today `MARCH_HASH_QUERY` loses to `MARCH_HASH_PERBODY` / `_CROWD` / `_BOXES`): `MARCH_HASH_FLAGS=leanwalk MARCH_HASH_BOXES=1 node scripts/march-hash.mjs` boots `...&crowddispatch=boxes&leanwalk`. Document it beside the other env notes. Touch no pin, no comparison.

- [ ] **Step 2: `scripts/lean-walk-parity.mjs`.** The multi-body bit-identity gate. Two boots under one `lab-servers` session, the page pinned exactly as `march-hash.mjs` pins it (fields off, light clock 0, frozen sim, the settle loops; lift those steps into a shared helper in `scripts/lib/` only if that does not change `march-hash.mjs`'s behaviour, else copy them with a comment naming the source):
  1. Boot WITHOUT the flag. Stage a deterministic multi-body frame: at least four bodies of one crowd type close enough that their silhouettes overlap on screen (reuse `capture.mjs`'s crowd staging), then stamp wounds on exactly ONE of them, a body that overlaps another on screen. Read the float march target (`__sdfGameDebug.readMarchTarget()`): buffer `OFF`.
  2. Boot WITH `?leanwalk`, stage the same frame the same way. Read `ON` (lean enabled), then `HELD` after `setLeanWalk(false)`, then `ON2` after `setLeanWalk(true)` again, then the census with `setMarchDebugMode(23)`.
  3. Compare `OFF` with `ON`, `ON` with `HELD`, `ON` with `ON2`, float for float: texels differing, the largest absolute difference, and the first few differing texels (x, y, both values). Bit identity is the pass.
  4. From the census: pixels by (slot count 1 / 2 / 3+, lean yes / no, hit / miss). The run FAILS as "frame does not exercise the claim" unless there are lean pixels with two or more slots (two clean bodies in one tile) AND non-lean hit pixels with two or more slots (a clean body sharing a tile with the wounded one).
  5. One JSON line to stdout with all of the above plus `leanWalkState()` of each boot; exit 1 on any difference or an unexercised frame. `LEAN_PARITY_OUT=<dir>` also writes the raw buffers.
  If the two boots do not agree even between two flag-OFF boots (run that once as the script's own determinism check: `LEAN_PARITY_AA=1` boots flag-off twice), say so and report what moves; do not loosen the comparison.

- [ ] **Step 3: `scripts/native-spike/lean-ab.mjs`.** Timing by alternation over captured passes: `node scripts/native-spike/lean-ab.mjs <reps> name=<captureDir> name=<captureDir> ...`. The first named capture is the base. Warm each once (cold Metal compile; print the seconds and each capture's parity against its own game readback), then `<reps>` rotations, the order rotated each repeat as `ladder.mjs` does, each run through `replay-chrome.mjs` (`SPIKE_REPEAT`, `SPIKE_ROUNDS` as in the ladder). Print per repeat: each capture's median ms and its difference from the base IN THAT REPEAT; then per capture the median, minimum and maximum of those paired differences and the same as a percentage of the base's median. A name given twice with the same directory is the A/A control. Write `<first captureDir>-lean-ab.json` with everything. In the header document the capture commands for the three scenes, each flag off and flag on:

```bash
# clean close-up, flag off and on (one boot each), plus the runtime-held leg from the flag-on boot
LAB_TMP=.lab-tmp scripts/native-spike/servers.sh node scripts/native-spike/capture.mjs 5291 9291 .scratch/lean/closeup-off
LAB_TMP=.lab-tmp SPIKE_QUERY=leanwalk SPIKE_VARIANTS='on=__sdfGame.setLeanWalk(true);held=__sdfGame.setLeanWalk(false)' \
  scripts/native-spike/servers.sh node scripts/native-spike/capture.mjs 5291 9291 .scratch/lean/closeup
```

and the same with `SPIKE_SCENE=crowd` and with a wounded close-up (`SPIKE_PRELUDE` stamping the wounds `march-hash.mjs` stamps for `room1-wounded`). Confirm `SPIKE_QUERY` and `SPIKE_VARIANTS` compose in `capture.mjs`; if not, fix `capture.mjs` minimally and say so.

- [ ] **Step 4: smoke-test under the GPU lock** what can be run: `MARCH_HASH_FLAGS=` (empty) leaves `march-hash.mjs` output as before; `LEAN_PARITY_AA=1 node scripts/lean-walk-parity.mjs` (two flag-off boots agree, the frame has overlapping bodies); `lean-ab.mjs 2 a=<dir> b=<dir>` on one flag-off capture named twice. If task 2 has landed (`grep -c leanOk src/lab/sdf-zombie/webgpu/march/body/trace.wgsl.ts` is non-zero) also run the full parity script once. Release the lock.

- [ ] **Step 5: report.** What ran, the output lines, what could not be run and why.

---

## Task 4 (lead): the gates

- [ ] `npm run typecheck`, `npm run test:changed`, `git status` (snapshot untouched).
- [ ] Under the GPU lock, `LAB_TMP=.lab-tmp`: `march-hash.mjs` in its three modes (default, `MARCH_HASH_BOXES=1`, `MARCH_HASH_PERBODY=1`), flag off, then each again with `MARCH_HASH_FLAGS=leanwalk`. Six lines; clean and wounded against the pins in the script's header. A moved pin: find the pixel (`MARCH_HASH_RAW`, `scripts/march-raw-diff.mjs`) and the reason before anything else.
- [ ] `node scripts/lean-walk-parity.mjs`: the multi-body frame.
- [ ] The census on each timed scene: the share of walked pixels that took the fast path.

## Task 5 (lead): time and cold compile

- [ ] Captures for the clean close-up, the crowd and the wounded close-up: flag off, flag on, flag on with the switch held. `lean-ab.mjs` with the base listed twice (A/A), 6 or more repeats, twice on separate occasions if the machine is noisy.
- [ ] Cold compile: `CENSUS_QUERY='pipelinelog=1&seed=20260919' node scripts/compile-census.mjs 1 --out .scratch/lean/census-off-N.json` against `...&leanwalk`, alternated off / on / off / on, fresh profiles (the script's own). Report the `sdf:march` pipelines' creation times and the boot's ready time.

## Task 6 (lead): the write-up

- [ ] `docs/dev-notes/2026-11-09-march-lean-walk/NOTES.md`: what was built, the numbers, what is not verified, how to run it.
- [ ] `docs/tasks/rendering.md`, "The march's ceiling": the fast path's state and the owner's decision.
- [ ] `docs/architecture/module-index.md` regenerated; commits on the branch; nothing pushed.
