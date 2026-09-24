// src/lab/sdf-zombie/webgpu/march/body/blocks/setup/tile-preload.wgsl.test.ts
//
// Moved verbatim from march.wgsl.test.ts (march split task 3, 2026-09-19):
// the assertions that pin `tile-preload`. Nothing here compiles a shader; these guard
// what CAN be checked from text. See march/helpers.test.ts for the parse
// contract and docs/dev-notes/2026-09-18-march-split/ for the split.

import { describe, it, expect } from 'vitest';
import { TILE_MAX_ENTRIES } from '../../../../tile-cull';
import { HELPERS, MARCH_BODY, MAP_BODY, ROW_PRIM_B, ROW_PRIM_SCALE, MARCH_TRACE_SETUP } from '../../../../march.wgsl';

describe('tile-list fold path (raymarcher-perf task 5)', () => {
  it('preloads the tile list ONCE per pixel at the march entry, under an enable guard', () => {
    const pre = MARCH_BODY.indexOf('gTileActive = select(0.0, 1.0, tileCfg.x > 0.5);');
    expect(pre).toBeGreaterThan(-1);
    // The preload must precede the march loop and its mapBody call.
    expect(pre).toBeLessThan(MARCH_BODY.indexOf('let dres = mapBody('));
    // One read loop, bounded by the same cap the CPU binner clamps to.
    expect(MARCH_BODY).toContain(`for (var e = 0; e < ${TILE_MAX_ENTRIES}; e = e + 1) {`);
    // The per-pixel slot table (perf 7d) is built in SETUP, once, from that
    // same preloaded, slot-sorted entry list.
    expect(MARCH_TRACE_SETUP).toContain('gPixSlot[gPixN] = s;');
    expect(MARCH_TRACE_SETUP).toContain('gPixEnd[gPixN - 1] = e + 1;');
    expect(MARCH_BODY).toContain('if (e >= i32(n)) { break; }');
  });

  it('reads tile lists from STORAGE BUFFERS with the grid carried in tileCfg', () => {
    // The compute port's whole point: no resource-dimension inference (the
    // defect that broke every scale except the one allocated at), no texture
    // bindings for the lists.
    expect(MARCH_BODY).toContain('tileHdr: ptr<storage, array<vec2<u32>>, read>');
    expect(MARCH_BODY).toContain('tileEnt: ptr<storage, array<vec4<f32>>, read>');
    expect(MARCH_BODY).not.toContain('tileHead: texture_2d<f32>');
    expect(MARCH_BODY).not.toContain('textureDimensions(tileHead');
    // Grid dims come from tileCfg (y tilesX, w tilesY), clamped in-shader.
    expect(MARCH_BODY).toContain('let gx = max(1, i32(tileCfg.y));');
    expect(MARCH_BODY).toContain('let gy = max(1, i32(tileCfg.w));');
    // Entry addressing is LINEAR over vec4 records, three per entry.
    expect(MARCH_BODY).toContain('let lin = (head.x + u32(e)) * 3u;');
  });

  it('mapBody walks the per-pixel slot table: tile range vs cluster walk, both through foldGroup', () => {
    expect(MAP_BODY).toContain('let tiled = gTileActive > 0.5;');
    // crowd stage a, task 7c: a shared-record single-field material offsets the
    // slot index by its base record slot.
    expect(MAP_BODY).toContain('let base = i32(instCfg.z);');
    expect(MAP_BODY).toContain('loadInstance(inst, base + s);');
    expect(MAP_BODY).toContain('bestSlot = base + s;');
    expect(MAP_BODY).toContain('let nIter = select(nInst, gPixN, tiled);');
    expect(MAP_BODY).toContain('let s = select(k, gPixSlot[k], tiled);');
    // The range walk folds exactly this slot's contiguous entry run; the
    // per-step slot scan is gone.
    expect(MAP_BODY).toContain('for (var e = gPixFirst[k]; e < gPixEnd[k]; e = e + 1) {');
    expect(MAP_BODY).not.toContain('tileHasSlot');
    expect(MAP_BODY).toContain('d = foldGroup(d, p, data, counts, band, gTileBounds[e], gTileGrp[e]);');
    expect(MAP_BODY).toContain('d = foldGroup(d, p, data, counts, band, bounds, range);');
  });

  it('keeps the per-step sphere cull WITH the distortion factor inside foldGroup', () => {
    const foldGroup = HELPERS.find(h => /^fn foldGroup\(/.test(h))!;
    expect(foldGroup).toContain(
      'if (length(p - bounds.xyz) - bounds.w > (min(d, gCullRef) + counts.w * 4.0) * grp.z) { return d; }'); // ?limbs adds gLimbSlack (limbs-flag.ts); gCullRef = upper-bound cull (groups.wgsl.ts)
  });

  it('band-offsets every prim-row load so one shared texture serves all bodies', () => {
    const foldGroup = HELPERS.find(h => /^fn foldGroup\(/.test(h))!;
    expect(foldGroup).toContain(`vec2<i32>(idx, ${ROW_PRIM_SCALE} + band)`);
    expect(foldGroup).toContain(`vec2<i32>(idx, ${ROW_PRIM_B} + band)`);
  });
});
