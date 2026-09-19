// src/lab/sdf-zombie/webgpu/march/layout.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `layout`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import {
  HELPERS,
  DATA_ROWS,
  ROW_PRIM_COLOR,
  ROW_GROUP_BOUNDS,
  ROW_GROUP_RANGE,
  ROW_CLUSTER_GROUPS,
  ROW_PRIM_A,
  ROW_PRIM_B,
  ROW_PRIM_SCALE,
  ROW_PRIM_QUAT,
  ROW_REST_A,
  ROW_REST_B,
  ROW_CLUSTER_BOUNDS,
  ROW_CLUSTER_RANGE,
  ROW_WOUND,
  ROW_WOUND_META,
  ROW_PRIM_SHAPE,
  ROW_PRIM_BEND,
  ROW_PRIM_SHELL,
  ROW_PRIM_WARP,
  ROW_PRIM_STRAND,
  ROW_PRIM_CLIP,
  ROW_WOUND_CAP,
  ROW_WOUND_FLAGS,
} from '../march.wgsl';
import { MAX_WOUNDS } from '../../damage';
import { MAX_PRIMS } from '../../validate';
import { declaredName } from '../march-test-support';

describe('data texture layout', () => {
  it('gives every row a distinct index inside DATA_ROWS', () => {
    const rows = [
      ROW_PRIM_A, ROW_PRIM_B, ROW_PRIM_SCALE, ROW_PRIM_QUAT,
      ROW_CLUSTER_BOUNDS, ROW_CLUSTER_RANGE, ROW_WOUND, ROW_WOUND_META,
      ROW_REST_A, ROW_REST_B, ROW_PRIM_SHAPE, ROW_PRIM_BEND, ROW_PRIM_COLOR,
      ROW_GROUP_BOUNDS, ROW_GROUP_RANGE, ROW_CLUSTER_GROUPS,
      ROW_PRIM_SHELL, ROW_PRIM_CLIP, ROW_WOUND_CAP, ROW_WOUND_FLAGS,
      ROW_PRIM_WARP, ROW_PRIM_STRAND,
    ];
    expect(new Set(rows).size).toBe(rows.length);
    expect(Math.max(...rows)).toBe(DATA_ROWS - 1);
  });

  it('is wide enough for the wound ring, which shares the primitive rows', () => {
    // Wounds ride the same texture as the primitives, indexed along the same
    // axis, so the sheet has to be at least MAX_WOUNDS wide.
    expect(MAX_PRIMS).toBeGreaterThanOrEqual(MAX_WOUNDS);
  });

  it('bounds the wound loops at MAX_WOUNDS', () => {
    // The loop bound is a WGSL literal — a uniform cannot size a loop — so it
    // is the one constant that can drift from damage.ts silently.
    for (const src of HELPERS) {
      const name = declaredName(src);
      if (!name || !/wound/i.test(name)) continue;
      // Only helpers that ITERATE the wound grid carry the bound. Others
      // with "wound" in the name but no wound-count loop (woundShadow's
      // 14-step penumbra march) are pinned by their own tests instead.
      if (!src.includes('i32(woundCfg.x)')) continue;
      // The loop variable name can change (the per-ray wound list folds by k);
      // pin only the BOUND, which is the MAX_WOUNDS literal that can drift
      // from damage.ts. Match `var x = 0; x < 16` for any identifier x.
      expect(src).toMatch(new RegExp(`var\\s+[a-z]\\w*\\s*=\\s*0\\s*;\\s*[a-z]\\w*\\s*<\\s*${MAX_WOUNDS}\\b`));
    }
  });
});
