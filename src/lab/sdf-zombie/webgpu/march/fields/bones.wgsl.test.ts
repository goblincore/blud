// src/lab/sdf-zombie/webgpu/march/fields/bones.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `bones`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import {
  MARCH_BODY,
  MAP_BODY,
  APPLY_CARVES,
  ROW_CLUSTER_BOUNDS,
  ROW_CLUSTER_RANGE,
  ROW_PRIM_SHAPE,
  ROW_PRIM_BEND,
  APPLY_BONES,
  FOLD_BONE_RANGE,
} from '../../march.wgsl';
import { MAX_CLUSTERS, BONE_SEG_MAX, MAX_PRIMS } from '../../../validate';

describe('bone fold (wound pass r2)', () => {
  it('guards the bone counter too — debugCfg.x == 0 pays no counting', () => {
    // gore r3 refinement 3. The counter exists because the timing bench could
    // not resolve the bone fold at all (+0.0% under a 4% spread); it must not
    // become a cost of its own on the shipping path. It lives in the extracted
    // foldBoneRange helper, the one place the per-bone loop exists.
    expect(FOLD_BONE_RANGE).toContain('if (gDebugMode > 0.5) { gDebugBones');
  });

  it('reads the shape and bend rows, so authored curvature actually renders', () => {
    // These were hard-coded to -1.0 / 0.0 / vec3(0), so every bone drew as a
    // straight untapered capsule while the packer wrote its bend rows. Two
    // rounds of rib-curvature feedback were spent on geometry the GPU could
    // not draw. If this regresses, curved bones silently go straight again.
    // The row constants are template-interpolated, so the emitted WGSL holds
    // their NUMBERS — assert against the constants, not their names.
    expect(FOLD_BONE_RANGE).toContain(`vec2<i32>(i, ${ROW_PRIM_SHAPE}`);
    expect(FOLD_BONE_RANGE).toContain(`vec2<i32>(i, ${ROW_PRIM_BEND}`);
    expect(FOLD_BONE_RANGE).not.toContain('sdPrim(p, i, data, -1.0, 0.0');
  });

  it('bounds the groove test so W_BONE is not read as a groove', () => {
    expect(APPLY_CARVES).toContain('S.w > 2.5 && S.w < 3.5');
  });

  it('folds bone as a hard min, never a smooth min', () => {
    expect(FOLD_BONE_RANGE).toContain('min(');
    expect(FOLD_BONE_RANGE).not.toContain('smin(');
  });

  it('gates the bone loop on nearWound so undamaged bodies pay nothing', () => {
    expect(MAP_BODY).toMatch(/nearWound\s*>\s*0\.5/);
  });

  it('returns the pre-wound field in .w for the tissue-depth ramp', () => {
    // Both return sites — the noiseAmp early-out and the full path — must
    // carry `carved`, or the ramp reads 0 on whichever path is taken. bestIdx
    // rides the return as the bare f32 global: an f32(bestIdx) cast INSIDE
    // the vec4 would not even lex past the nested paren, and task 6 reads
    // .w per march step.
    expect(MAP_BODY).toContain('carvedU = carved;');
    expect(MAP_BODY).toMatch(/return vec4<f32>\(dUnion, bestIdxU, nearWoundU, carvedU\)/);
  });

  it('lets a bone prim win bestIdx so shading can identify it', () => {
    expect(FOLD_BONE_RANGE).toContain('gFoldBestIdx');
  });

  // DEVIATION GUARDS. The dispatched task text carried boneCount on
  // woundCfg2.w "the slot documented as spare" — but that channel is the
  // VOLUME HIT-EPSILON override, pinned by the hit-eps test above and
  // documented NOT spare in zombie-gpu.ts; and it is 0 in every
  // primitive-mode path, so the gate would never fire and bones would never
  // render. boneCount rides a NEW counts2 uniform (x = boneCount, yzw
  // spare) instead. These tests keep it there.
  it('carries boneCount on counts2.x, never on the taken woundCfg2.w', () => {
    expect(MAP_BODY).toContain('counts2.x > 0.0');
    // The nearWound gate, plus the melt's BARE-BONES bypass (counts2.y):
    // bone-only chunks and melting bodies fold the inside-flesh rows
    // without a wound. The bypass must never REPLACE the gate — an intact
    // body still skips the bone fold exactly.
    expect(MAP_BODY).toMatch(/\(nearWound > 0\.5 \|\| counts2\.y > 0\.5\) && counts2\.x > 0\.0/);
    expect(MAP_BODY).toContain('applyBones(dmg, p, data, counts, counts2.x, band, segVolumeAtlas, segVolumeMeta)');
    expect(MAP_BODY).toContain('let counts2 = gInstCounts2;');
    expect(MARCH_BODY).not.toMatch(/woundCfg2\.w[^;]*applyBones/);
  });

  it('bounds the bone loop by the packed range, not a material scan', () => {
    // Bones occupy the contiguous rows [counts.x, counts.x + boneCount) —
    // bounded, never filtered by primScale.w == 4: nothing to get wrong if a
    // flesh prim's w ever changes meaning.
    expect(APPLY_BONES).toContain('i32(counts.x)');
    expect(APPLY_BONES).toContain('i32(boneCount)');
    expect(APPLY_BONES).not.toContain('> 4.5');
  });
});

describe('bone cluster cull (packBoneClusters)', () => {
  // The sphere cull: one bound sphere per flesh cluster's bone rows, stored
  // in the free texels (columns MAX_CLUSTERS.. and 2*MAX_CLUSTERS) of
  // ROW_CLUSTER_BOUNDS/ROW_CLUSTER_RANGE. Data-driven — the tail texel's .w
  // is the enabled flag; zeros = the old flat loop.
  it('reads the cluster bone-range texels at column MAX_CLUSTERS + c', () => {
    expect(APPLY_BONES).toContain(`vec2<i32>(${MAX_CLUSTERS} + c, ${ROW_CLUSTER_RANGE}`);
    expect(APPLY_BONES).toContain(`vec2<i32>(${MAX_CLUSTERS} + c, ${ROW_CLUSTER_BOUNDS}`);
  });

  it('reads the tail texel at column 2 * MAX_CLUSTERS and folds it', () => {
    expect(APPLY_BONES).toContain(`vec2<i32>(${2 * MAX_CLUSTERS}, ${ROW_CLUSTER_RANGE}`);
    expect(APPLY_BONES).toContain('foldBoneRange(d, p, data, i32(tail.x), i32(tail.y), band)');
  });

  it('uses the exact hard-min cull test (no blendK smin margin)', () => {
    expect(APPLY_BONES).toContain('length(p - cb.xyz) - cb.w > d * cr.z');
  });

  it('keeps the flat fallback for the zero-texel gate', () => {
    expect(APPLY_BONES).toContain('tail.w > 0.5');
    expect(APPLY_BONES).toContain('foldBoneRange(d, p, data, first, i32(boneCount), band)');
  });

  it('extracts the per-bone loop into ONE helper — no duplicated loop body', () => {
    expect(FOLD_BONE_RANGE).toContain('fn foldBoneRange');
    expect(APPLY_BONES).toContain('foldBoneRange(d, p, data, i32(cr.x), i32(cr.y), band)');
    // The shape read, counter and hard min must live only in the helper, so
    // the cluster path and the flat fallback cannot drift.
    expect(FOLD_BONE_RANGE).toContain('gDebugBones');
    expect(FOLD_BONE_RANGE).toContain('d = min(d, sd)');
    expect(FOLD_BONE_RANGE).toContain(`vec2<i32>(i, ${ROW_PRIM_SHAPE}`);
    expect(FOLD_BONE_RANGE).toContain(`if (i >= ${MAX_PRIMS}) { break; }`);
  });
});

describe('bone segment cull (boneCullMode: segment, mode 2)', () => {
  // The finer granularity: one sphere per RIGID SEGMENT (skull / axial
  // BoneFrame / limb bone / organs) in the free columns 2*MAX_CLUSTERS+1..
  // of the same two rows, gated by the header texel's mode in .w.
  it('branches on the header mode: 2 segment, 1 cluster, 0 flat', () => {
    expect(APPLY_BONES).toContain('tail.w > 1.5');
    expect(APPLY_BONES).toContain('} else if (tail.w > 0.5) {');
  });

  it('reads the segment texels at column 2*MAX_CLUSTERS+1 + s, bounded by BONE_SEG_MAX and the header count', () => {
    expect(APPLY_BONES).toContain(`for (var s = 0; s < ${BONE_SEG_MAX}; s = s + 1)`);
    expect(APPLY_BONES).toContain('if (s >= i32(tail.z)) { break; }');
    expect(APPLY_BONES).toContain(`vec2<i32>(${2 * MAX_CLUSTERS + 1} + s, ${ROW_CLUSTER_RANGE}`);
    expect(APPLY_BONES).toContain(`vec2<i32>(${2 * MAX_CLUSTERS + 1} + s, ${ROW_CLUSTER_BOUNDS}`);
  });

  it('uses the exact hard-min cull test against the WOUNDED running field', () => {
    expect(APPLY_BONES).toContain('length(p - sb.xyz) - sb.w > d * sr.z');
  });

  it('folds through foldBoneRange — never an inline copy — and still folds the tail', () => {
    expect(APPLY_BONES).toContain('foldBoneRange(d, p, data, i32(sr.x), i32(sr.y), band)');
    expect(APPLY_BONES).toContain('foldBoneRange(d, p, data, i32(tail.x), i32(tail.y), band)');
    // The mode-1 branch and the flat fallback stay verbatim.
    expect(APPLY_BONES).toContain('foldBoneRange(d, p, data, i32(cr.x), i32(cr.y), band)');
    expect(APPLY_BONES).toContain('foldBoneRange(d, p, data, first, i32(boneCount), band)');
  });
});
