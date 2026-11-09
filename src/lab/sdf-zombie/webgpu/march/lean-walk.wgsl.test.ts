import { describe, expect, it } from 'vitest';
import {
  MAX_CROWD_INSTANCES, REC_ANCHOR_BAND, REC_COUNTS, REC_COUNTS2, REC_HEAD_WCOUNT, REC_SPLIT_N, REC_VEC4S,
  REC_VOL_POSE0, REC_WIND_ALIVE, createCrowdRecords, type RecordSource,
} from '../crowd-records';
import type { SplitWarp } from '../../head-split';
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
    const split: SplitWarp = { n: [1, 0, 0], d0: 0, h: [0, 1.6, 0], a: [0, 0, 1], thetaP: 0.4, thetaM: -0.2, r: 0.3, full: 0.6, stage: 0.6 };
    expect(slotOk((s) => { s.split = split; })).toBe(false);
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
  it('keeps mapBody\'s piece skip for a closed slot', () => {
    // map-body.wgsl.ts: `if (piece.x >= min(dUnion, splitShell)) { break; }` with the closed piece (-1e9) and no shell.
    expect(MAP_LEAN).toContain('if (-1e9 >= dUnion) { continue; }');
    expect(MAP_LEAN.indexOf('if (-1e9 >= dUnion)')).toBeGreaterThan(MAP_LEAN.indexOf('if (wa.w < 0.5) { continue; }'));
    expect(MAP_LEAN.indexOf('if (-1e9 >= dUnion)')).toBeLessThan(MAP_LEAN.indexOf('foldGroup('));
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
    // abs(): -23 is the census with the runtime switch held (leanOk reads debugCfg.x > -0.5).
    expect(LEAN_CENSUS_BLOCK).toContain('if (abs(debugCfg.x) > 22.5 && abs(debugCfg.x) < 23.5) {');
    expect(LEAN_CENSUS_BLOCK).toContain('return vec4<f32>(select(0.0, 1.0, leanOk), f32(gPixN), gDebugSteps + select(0.0, 1000.0, hit), t);');
  });
});
