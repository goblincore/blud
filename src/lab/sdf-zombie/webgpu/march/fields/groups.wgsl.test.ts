// src/lab/sdf-zombie/webgpu/march/fields/groups.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `groups`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import {
  MAP_BODY,
  FOLD_GROUP,
  APPLY_CARVES,
  APPLY_WOUNDS,
  INSTANCE_STATE,
  SPLIT_MOVE_BACK,
  HELPERS,
  MARCH_BODY_PARAMS,
  MARCH_TRACE_SETUP,
  QUAD_TILE_EMPTY_WGSL,
} from '../../march.wgsl';
import { REC_VEC4S, REC_ANCHOR_BAND, REC_SPLIT_N, REC_SPLIT_H, REC_SPLIT_A, REC_SPLIT_R } from '../../crowd-records';
import { rotAxis } from '../../../head-split';
import { add, cross, dot, scale, sub } from '../../../vec';
import type { Vec3 } from '../../../types';

describe('crowd instance state', () => {
  it('declares the record loader and the per-instance globals', () => {
    // The vars ride FOLD_GROUP's tail (the same wgslFn parse-contract trick
    // the tile globals use), so the loader source still STARTS with fn.
    const globals = FOLD_GROUP + INSTANCE_STATE;
    for (const g of ['gInstCounts', 'gInstCounts2', 'gInstWoundBound', 'gInstAnchor', 'gInstWind',
      'gInstMelt', 'gInstFlash', 'gInstNoiseShift', 'gInstHeadCentre', 'gInstHeadQuat',
      'gInstVolPose0', 'gInstVolPose1', 'gInstCentre', 'gInstHalf', 'gBand', 'gSlot',
      'gTileEntryT']) {
      expect(globals).toContain(`var<private> ${g}`);
    }
    expect(INSTANCE_STATE).toContain(`fn loadInstance(inst: ptr<storage, array<vec4<f32>>, read>, slot: i32)`);
    expect(INSTANCE_STATE).toContain(`${REC_VEC4S}`);
    expect(INSTANCE_STATE).toContain(`+ ${REC_ANCHOR_BAND}]`);
    // The WGSL record stride IS REC_VEC4S (21 since the head split): a hard-coded
    // stride would misread every body after slot 0.
    expect(INSTANCE_STATE).toContain(`let base = slot * ${REC_VEC4S};`);
    expect(INSTANCE_STATE).toContain('let base = slot * 21;');
    expect(globals).toContain('var<private> gInstLights: vec4<f32>');
    expect(INSTANCE_STATE).toContain('gInstLights = (*inst)[base + 16];');
  });
  // THE HEAD SPLIT (head-split.ts SplitWarp; crowd-records.ts REC_SPLIT_*).
  it('loads the split: the plane normal always (it is the open test), the other three only when it is open', () => {
    const globals = FOLD_GROUP + INSTANCE_STATE;
    for (const g of ['gInstSplitN', 'gInstSplitH', 'gInstSplitA', 'gInstSplitR']) {
      expect(globals).toContain(`var<private> ${g}: vec4<f32> = vec4<f32>(0.0);`);
    }
    expect([REC_SPLIT_N, REC_SPLIT_H, REC_SPLIT_A, REC_SPLIT_R]).toEqual([17, 18, 19, 20]);
    const iN = INSTANCE_STATE.indexOf('gInstSplitN = (*inst)[base + 17];');
    // A zero record is a closed head; an open one carries a unit normal (crowd-records.ts write()). The test is made
    // ONCE, here, into gInstSplitOpen: mapBody and the post-hit read the flag, never the normal.
    expect(globals).toContain('var<private> gInstSplitOpen: bool = false;');
    const iFlag = INSTANCE_STATE.indexOf('gInstSplitOpen = dot(gInstSplitN.xyz, gInstSplitN.xyz) > 0.5;');
    const iOpen = INSTANCE_STATE.indexOf('if (gInstSplitOpen) {');
    expect(iN).toBeGreaterThan(-1);
    expect(iFlag).toBeGreaterThan(iN);
    expect(iOpen).toBeGreaterThan(iFlag);
    expect(MAP_BODY).toContain('let splitOpen = gInstSplitOpen;');
    expect(MAP_BODY).not.toContain('dot(gInstSplitN');
    const open = INSTANCE_STATE.slice(iOpen, INSTANCE_STATE.indexOf('}', iOpen));
    expect(open).toContain('gInstSplitH = (*inst)[base + 18];');
    expect(open).toContain('gInstSplitA = (*inst)[base + 19];');
    expect(open).toContain('gInstSplitR = (*inst)[base + 20];');
    // Nothing outside that branch reads the three.
    expect(INSTANCE_STATE.replace(open, '')).not.toMatch(/base \+ (18|19|20)\]/);
  });
  it('keeps the winning piece and its field before the caps next to the hit slot', () => {
    const globals = FOLD_GROUP + INSTANCE_STATE;
    expect(globals).toContain('var<private> gHitPiece: i32 = 0;');
    expect(globals).toContain('var<private> gHitSplitF: f32 = 0.0;');
  });
  // head-split.ts moveBack is the CPU mirror: h + rotAxis(p - h, a, -theta), Rodrigues.
  it('splitMoveBack is rotAxis by -theta about the hinge, term for term', () => {
    expect(SPLIT_MOVE_BACK).toMatch(/^fn splitMoveBack\(p: vec3<f32>, h: vec3<f32>, a: vec3<f32>, theta: f32\) -> vec3<f32> \{/);
    expect(SPLIT_MOVE_BACK).toContain('let v = p - h;');
    expect(SPLIT_MOVE_BACK).toContain('let c = cos(-theta);');
    expect(SPLIT_MOVE_BACK).toContain('let s = sin(-theta);');
    expect(SPLIT_MOVE_BACK).toContain('return h + v * c + cross(a, v) * s + a * (dot(a, v) * (1.0 - c));');
    // The pinned expression, in TypeScript, against rotAxis.
    const wgsl = (p: Vec3, h: Vec3, a: Vec3, theta: number): Vec3 => {
      const v = sub(p, h), c = Math.cos(-theta), s = Math.sin(-theta);
      return add(add(add(h, scale(v, c)), scale(cross(a, v), s)), scale(a, dot(a, v) * (1 - c)));
    };
    const h: Vec3 = [0.1, 1.6, -0.05], a: Vec3 = [0, 0.6, -0.8];
    for (const [p, theta] of [[[0.2, 1.7, 0.1], 0.55], [[-0.3, 1.5, 0.2], -0.9], [[0.1, 1.9, -0.4], 0]] as [Vec3, number][]) {
      const want = add(h, rotAxis(sub(p, h), a, -theta)), got = wgsl(p, h, a, theta);
      for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(want[i]!, 12);
    }
    // In the include list ahead of mapBody, which calls it.
    expect(HELPERS.indexOf(SPLIT_MOVE_BACK)).toBeGreaterThan(-1);
    expect(HELPERS.indexOf(SPLIT_MOVE_BACK)).toBeLessThan(HELPERS.indexOf(MAP_BODY));
  });
  it('removes every per-instance parameter from the signature and adds inst/instCfg/instCentre/instHalf last', () => {
    for (const p of ['counts:', 'counts2:', 'woundBound:', 'bodyCentre:', 'bodyHalf:', 'bodyAnchor:',
      'windDrift:', 'meltCfg:', 'bodyFlash:', 'headCentre:', 'headQuat:', 'volumePose0:', 'volumePose1:']) {
      expect(MARCH_BODY_PARAMS).not.toContain(p);
    }
    // Strip comments first: the crowd proxy-box comment sits between instCfg
    // and instCentre, and the wgslFn parser sees it as ordinary text.
    const sig = MARCH_BODY_PARAMS.replace(/\/\/[^\n]*/g, ' ').replace(/\s+/g, ' ');
    expect(sig).toMatch(/inst: ptr<storage, array<vec4<f32>>, read>, instCfg: vec4<f32>, instCentre: vec3<f32>, instHalf: vec3<f32>, burnCfg: vec4<f32>, burnNoiseScale: f32, burnRiseSpeed: f32, burnCharPatch: f32, burnFireGain: f32, burnFireCoverage: f32, burnSkeleton: f32, burnSkeletonDepth: f32, lightListCfg: vec4<f32>, lightList: ptr<storage, array<vec4<f32>>, read>\s*\)/);
  });
  it('bands the damage folds', () => {
    expect(APPLY_CARVES).toContain('fn applyCarves(dIn: f32, p: vec3<f32>, data: texture_2d<f32>, counts: vec4<f32>, band: i32)');
    expect(APPLY_WOUNDS).toContain('band: i32');
    expect(MAP_BODY).toContain('for (var k = 0; k < ${MAX_CROWD_INSTANCES}; k = k + 1)'.replace('${MAX_CROWD_INSTANCES}', '64'));
  });
});

describe('crowd quad dispatch (stage a-2)', () => {
  it('has a quad entry mode gated on instCfg.y == 2 that discards empty tiles before stepping', () => {
    expect(MARCH_TRACE_SETUP).toContain('let quadMode = instCfg.y > 1.5;');
    expect(MARCH_TRACE_SETUP).toContain('if (quadMode && gTileN < 0.5) { discard;');
    expect(MARCH_TRACE_SETUP).toContain('gTileEntryT');
    expect(MARCH_TRACE_SETUP).toContain('let bodyEntry = select(boxEntry, gTileEntryT, quadMode);');
  });

  it('keeps the box entry text for instCfg.y <= 1', () => {
    expect(MARCH_TRACE_SETUP).toContain('let boxEntry = max(max(min(bLo.x, bHi.x), min(bLo.y, bHi.y)), max(min(bLo.z, bHi.z), 0.0));');
  });

  it('accumulates the nearest sphere entry only in quad mode, with the type max blend reach', () => {
    expect(MARCH_TRACE_SETUP).toContain('let reach = select(gInstCounts.w, instCfg.w, quadMode) * 4.0 +');
    expect(MARCH_TRACE_SETUP).toContain('gTileEntryT = entryT;');
    expect(MARCH_TRACE_SETUP).toContain('if (max(shellIn, bodyEntry) > prevT) { discard; return vec4<f32>(0.0, 0.0, 0.0, 0.0); }');
  });

  it('keeps the material-side empty-tile gate on the SAME tile index formula as the preload', () => {
    // The gate (QUAD_TILE_EMPTY_WGSL, called from createMarchMaterial before
    // the march) must address the SAME tile the preload does, or it would
    // discard a pixel whose real tile is non-empty. Pin the three lines that
    // define the mapping in both texts.
    for (const line of [
      'let gx = max(1, i32(tileCfg.y));',
      'let gy = max(1, i32(tileCfg.w));',
      'let tid = clamp(vec2<i32>(floor(screenUV * vec2<f32>(f32(gx), f32(gy)))), vec2<i32>(0, 0), vec2<i32>(gx - 1, gy - 1));',
    ]) {
      expect(MARCH_TRACE_SETUP).toContain(line);
      expect(QUAD_TILE_EMPTY_WGSL).toContain(line);
    }
  });
});
