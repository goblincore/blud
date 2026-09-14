// src/lab/sdf-zombie/webgpu/tile-bin-compute.test.ts
//
// Unit pins for the GPU tile binner. The REAL gate is the in-browser A/B
// against the CPU binner (__sdfLab.tileAB / scripts/tile-ab.mjs) — these
// tests pin everything that can be checked without a GPU: the structural
// cap argument, the sizing maths, the group-record packing, and the kernel
// sources' load-bearing shape (the WGSL template-literal trap has bitten
// before, so the shipped text itself is under test).

import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  GROUP_RECORD_SCALARS,
  K_TILE_COUNTS,
  K_TILE_RANGE,
  K_TILE_SCAN,
  K_TILE_WRITE,
  MAX_TILE_GROUPS,
  packGroups,
  worstCaseEntries,
  worstCaseTiles,
} from './tile-bin-compute';
import {
  TILE_MAX_ENTRIES,
  TILE_SIZE_PX,
  TileBinner,
  type TileGroupInput,
} from './tile-cull';

describe('tile-bin-compute structural caps', () => {
  it('MAX_TILE_GROUPS is the crowd type capacity — 64 instances x 32 groups', () => {
    // Shared by one crowd type's binding; the PER-TILE cap stays
    // TILE_MAX_ENTRIES and is enforced inside the kernels (kTileCounts) and
    // by kTileWrite. Raise this only with a matching groups-buffer allocation.
    expect(MAX_TILE_GROUPS).toBe(2048);
  });

  it('group records are three vec4s, matching the entry-stream stride', () => {
    expect(GROUP_RECORD_SCALARS).toBe(12);
  });
});

describe('worst-case sizing', () => {
  it('tiles from pixels round UP per axis', () => {
    expect(worstCaseTiles(960, 540)).toEqual({
      tilesX: Math.ceil(960 / TILE_SIZE_PX),
      tilesY: Math.ceil(540 / TILE_SIZE_PX),
    });
    expect(worstCaseTiles(1, 1)).toEqual({ tilesX: 1, tilesY: 1 });
    // A partial edge tile still gets its own column/row.
    const { tilesX } = worstCaseTiles(TILE_SIZE_PX + 1, TILE_SIZE_PX);
    expect(tilesX).toBe(2);
  });

  it('entry capacity covers every (tile, group) pair', () => {
    const { tilesX, tilesY } = worstCaseTiles(672, 378);
    expect(worstCaseEntries(tilesX, tilesY))
      .toBe(tilesX * tilesY * TILE_MAX_ENTRIES);
  });
});

describe('packGroups', () => {
  const g = (over: Partial<TileGroupInput> = {}): TileGroupInput => ({
    bodyIndex: 0, start: 7, count: 3,
    center: [1, 2, 3], radius: 0.5,
    distort: 2.25, flags: 3,
    ...over,
  });

  it('writes bounds, the ROW_GROUP_RANGE pack, and bodyIndex in order', () => {
    const out = new Float32Array(MAX_TILE_GROUPS * GROUP_RECORD_SCALARS);
    packGroups([g({ bodyIndex: 4 })], out);
    expect(out[0]).toBe(1);   // centre.x
    expect(out[1]).toBe(2);   // centre.y
    expect(out[2]).toBe(3);   // centre.z
    expect(out[3]).toBe(0.5); // radius
    expect(out[4]).toBe(7);   // start
    expect(out[5]).toBe(3);   // count
    expect(out[6]).toBe(2.25);// distort
    expect(out[7]).toBe(3);   // flags
    expect(out[8]).toBe(4);   // bodyIndex
  });

  it('zeroes slots past the live groups so stale records cannot leak', () => {
    const out = new Float32Array(MAX_TILE_GROUPS * GROUP_RECORD_SCALARS);
    out.fill(42);
    packGroups([g()], out);
    // Second record onwards must be zero.
    for (let i = GROUP_RECORD_SCALARS; i < out.length; i++) {
      expect(out[i]).toBe(0);
    }
  });

  it('returns null past MAX_TILE_GROUPS — callers fall back, never truncate', () => {
    const out = new Float32Array(MAX_TILE_GROUPS * GROUP_RECORD_SCALARS);
    const many = Array.from({ length: MAX_TILE_GROUPS + 1 }, (_, i) =>
      g({ start: i }));
    expect(packGroups(many, out)).toBeNull();
  });
});

describe('kernel sources', () => {
  it('all four kernels satisfy wgslFn’s ^fn parse contract', () => {
    for (const src of [K_TILE_RANGE, K_TILE_COUNTS, K_TILE_SCAN, K_TILE_WRITE]) {
      expect(src.trimStart().startsWith('fn ')).toBe(true);
    }
  });

  it('the projection block carries the deliberate Y flip', () => {
    // Getting this wrong mirrors the grid vertically and makes the body
    // vanish — it already happened once on the CPU path.
    expect(K_TILE_RANGE).toContain('Y IS FLIPPED HERE ON PURPOSE');
    expect(K_TILE_RANGE).toContain('(0.5 - ndcY * 0.5) * dims.y');
  });

  it('mirrors the CPU binner’s behind-camera cover-everything rule, widened', () => {
    // The 1e-6 guard (not 0) keeps eye-plane-grazing spheres out of the
    // projection branch, where f32-vs-f64 rounding could drop a boundary tile.
    expect(K_TILE_RANGE).toContain('nearDist <= 1e-6 || clip.w <= 0.0');
    expect(K_TILE_RANGE).toContain('i32(cfg.z) - 1');
    expect(K_TILE_RANGE).toContain('i32(cfg.w) - 1');
  });

  it('omits spheres FULLY behind the eye plane BEFORE the cover-all branch (perf 7e)', () => {
    // A group whose FAR end (-v4.z + rBlend) is behind the eye plane is
    // reachable by no forward ray; it must bind zero tiles, and the test must
    // sit before the nearDist cover-all branch or a behind-camera sphere
    // would still fold the whole level into every tile.
    expect(K_TILE_RANGE).toContain('let farDist = -v4.z + rBlend;');
    const farIdx = K_TILE_RANGE.indexOf('farDist <= 0.0');
    const coverIdx = K_TILE_RANGE.indexOf('nearDist <= 1e-6');
    expect(farIdx).toBeGreaterThan(-1);
    expect(coverIdx).toBeGreaterThan(farIdx);
  });

  it('pads the AABB edges sub-tile — GPU lists must SUPERSET the CPU’s', () => {
    // f32-vs-f64 boundary rounding flips floors at tile edges; the pad makes
    // the GPU conservative in the only safe direction. Missing entries are
    // holes; extras are fold work the per-step sphere cull eats.
    expect(K_TILE_RANGE).toContain('let pad = rpix * 1e-5 + 0.01;');
    expect(K_TILE_RANGE).toContain('cx - rpix - pad');
  });

  it('rejects off-screen spheres instead of clamping them inward', () => {
    expect(K_TILE_RANGE).toContain('cx - rpix - pad >= dims.x');
  });

  it('kTileWrite walks groups ascending — bit-parity with the CPU order', () => {
    // Smooth-min is not commutative in float arithmetic, so the ORDER of a
    // tile's list is part of the contract with the CPU reference.
    expect(K_TILE_WRITE).toContain('var slot = base;');
    expect(K_TILE_WRITE).toContain('for (var g = 0u; g < u32(cfg.x); g++)');
  });

  it('no kernel infers anything from resource dimensions', () => {
    // textureDimensions-based inference is exactly what broke under adaptive
    // resolution on the DataTexture path.
    for (const src of [K_TILE_RANGE, K_TILE_COUNTS, K_TILE_SCAN, K_TILE_WRITE]) {
      expect(src).not.toContain('textureDimensions');
    }
  });
});

// ---------------------------------------------------------------------------
// CPU-vs-GPU A/B fixture (perf 7e). The REAL bit-identity gate is the
// in-browser __sdfLab.tileAB / scripts/tile-ab.mjs; this is the CPU-side
// fixture that covers the same two groups the new behind-plane rule exists
// for, against a faithful JS transcription of PROJECTION_BLOCK. If those two
// disagree, the source pins above fail first.
// ---------------------------------------------------------------------------

/** Hand-checkable camera: 90 deg fov, square viewport, at the origin looking
 *  down -z. Same fixture as tile-cull.test.ts. */
function straightCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(90, 1, 0.01, 100);
  cam.position.set(0, 0, 0);
  cam.lookAt(0, 0, -1);
  cam.updateMatrixWorld();
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  return cam;
}

function fixtureGroup(over: Partial<TileGroupInput> = {}): TileGroupInput {
  return {
    bodyIndex: 0, start: 0, count: 3,
    center: [0, 0, -4], radius: 0.1, distort: 1, flags: 0,
    ...over,
  };
}

/** A line-for-line JS transcription of PROJECTION_BLOCK / kTileRange, v4 = the
 *  view-space centre. Only used to pin the CPU/GPU classification agreement. */
function kernelRanges(
  groups: TileGroupInput[], camera: THREE.PerspectiveCamera,
  tilesX: number, tilesY: number, widthPx: number, heightPx: number, maxBlendK: number,
): [number, number, number, number][] {
  const pe = camera.projectionMatrix.elements;
  const focalY = pe[5]!;
  const blendReach = maxBlendK * 4;
  const v = new THREE.Vector3();
  return groups.map((g) => {
    v.set(g.center[0], g.center[1], g.center[2]).applyMatrix4(camera.matrixWorldInverse);
    const rBlend = g.radius + blendReach;
    const nearDist = -v.z - rBlend;
    const farDist = -v.z + rBlend;
    const clipW = pe[3]! * v.x + pe[7]! * v.y + pe[11]! * v.z + pe[15]!;
    let tx0 = 0, tx1 = -1, ty0 = 0, ty1 = -1;
    if (farDist <= 0) {
      // Fully behind the eye plane: zero tiles (the empty default).
    } else if (nearDist <= 1e-6 || clipW <= 0) {
      tx1 = tilesX - 1; ty1 = tilesY - 1;
    } else {
      const clipX = pe[0]! * v.x + pe[4]! * v.y + pe[8]! * v.z;
      const clipY = pe[1]! * v.x + pe[5]! * v.y + pe[9]! * v.z;
      const ndcX = clipX / clipW, ndcY = clipY / clipW;
      const cx = (ndcX * 0.5 + 0.5) * widthPx;
      const cy = (0.5 - ndcY * 0.5) * heightPx;
      const rpix = (rBlend / nearDist) * focalY * (heightPx * 0.5);
      const pad = rpix * 1e-5 + 0.01;
      if (!(cx + rpix + pad <= 0 || cx - rpix - pad >= widthPx || cy + rpix + pad <= 0 || cy - rpix - pad >= heightPx)) {
        tx0 = Math.max(0, Math.floor((cx - rpix - pad) / TILE_SIZE_PX));
        tx1 = Math.min(tilesX - 1, Math.floor((cx + rpix + pad - 1e-6) / TILE_SIZE_PX));
        ty0 = Math.max(0, Math.floor((cy - rpix - pad) / TILE_SIZE_PX));
        ty1 = Math.min(tilesY - 1, Math.floor((cy + rpix + pad - 1e-6) / TILE_SIZE_PX));
      }
    }
    return [tx0, tx1, ty0, ty1];
  });
}

describe('CPU vs kTileRange fixture (perf 7e)', () => {
  const camera = straightCamera();
  const tilesX = 4, tilesY = 4, W = 64, H = 64;
  // The two new groups, plus a normal in-front group as a control.
  const fixture: TileGroupInput[] = [
    fixtureGroup({ bodyIndex: 0 }),
    fixtureGroup({ bodyIndex: 1, center: [0, 0, 5], radius: 0.5 }),
    fixtureGroup({ bodyIndex: 2, center: [0, 0, 0.5], radius: 1 }),
  ];
  const ranges = kernelRanges(fixture, camera, tilesX, tilesY, W, H, 0);
  const cpu = new TileBinner(W, H).bin(fixture, camera, 0);

  it('classifies the fully-behind and straddling groups exactly as the CPU binner', () => {
    expect(ranges[1]).toEqual([0, -1, 0, -1]); // fully behind -> zero tiles
    expect(ranges[2]).toEqual([0, tilesX - 1, 0, tilesY - 1]); // straddle -> every tile
  });

  it('keeps every CPU tile entry in the kernel list, in ascending order', () => {
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const cpuList: number[] = [];
        const n = cpu.countAt(tx, ty);
        for (let i = 0; i < n; i++) cpuList.push(cpu.entryAt(tx, ty, i)!.bodyIndex);
        // The kernel list (ascending group index); the sub-tile safety pad can
        // only ADD boundary groups, so the CPU list must be a subsequence.
        const kernelList: number[] = [];
        for (let gi = 0; gi < ranges.length; gi++) {
          const [x0, x1, y0, y1] = ranges[gi]!;
          if (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1) kernelList.push(gi);
        }
        let gi = 0;
        for (const k of kernelList) {
          if (gi < cpuList.length && k === cpuList[gi]) gi++;
        }
        expect({ tile: [tx, ty], cpu: cpuList, kernel: kernelList, matched: gi })
          .toMatchObject({ matched: cpuList.length });
      }
    }
  });
});
