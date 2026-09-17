import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';

import {
  TILE_MAX_ENTRIES,
  TILE_SIZE_PX,
  TileBinner,
  type TileGroupInput,
} from './tile-cull';

/**
 * A camera whose projection arithmetic is hand-checkable: perspective 90 deg
 * vertical fov (focal length 1.0), square viewport of 4x4 tiles, sitting at
 * the origin looking down -z. At depth d the frustum spans [-d, d] on both
 * axes, and a sphere's screen radius in pixels is r / (d - r) * 32.
 */
function straightCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(90, 1, 0.01, 100);
  cam.position.set(0, 0, 0);
  cam.lookAt(0, 0, -1);
  cam.updateMatrixWorld();
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  return cam;
}

/** Viewport 64x64 -> 4x4 tiles of 16 px. */
function binner(): TileBinner {
  return new TileBinner(64, 64);
}

function group(overrides: Partial<TileGroupInput> = {}): TileGroupInput {
  return {
    bodyIndex: 0,
    start: 0,
    count: 3,
    center: [0, 0, -4],
    radius: 0.1,
    distort: 1,
    flags: 0,
    ...overrides,
  };
}

describe('TileBinner', () => {
  it('bins a sphere fully left of the frustum into zero tiles', () => {
    // Depth 10, so the frustum spans x in [-10, 10] there; the sphere's right
    // edge sits at -18, far outside. Radius 2 keeps the near-point depth at 8,
    // where the half-width is still only 8.
    const r = binner().bin([group({ center: [-20, 0, -10], radius: 2 })], straightCamera());
    expect(r.totalEntries).toBe(0);
    expect(r.clampedTiles).toBe(0);
  });

  it('bins a centre sphere into exactly the 4 tiles its AABB covers', () => {
    // World (0,0,-4), radius 4/3: near-point depth 8/3, screen radius
    // (4/3)/(8/3) * 32 = 16 px around the centre pixel (32,32). The AABB is
    // [16,48]^2 -> tiles x 1..2, y 1..2 -- exactly four.
    const r = binner().bin([group({ center: [0, 0, -4], radius: 4 / 3 })], straightCamera());
    expect(r.tilesX).toBe(4);
    expect(r.tilesY).toBe(4);
    let covered = 0;
    for (let ty = 0; ty < r.tilesY; ty++) {
      for (let tx = 0; tx < r.tilesX; tx++) {
        const n = r.countAt(tx, ty);
        if (tx >= 1 && tx <= 2 && ty >= 1 && ty <= 2) {
          expect(n).toBe(1);
          covered++;
        } else {
          expect(n).toBe(0);
        }
      }
    }
    expect(covered).toBe(4);
    expect(r.totalEntries).toBe(4);
  });

  it('binds a sphere fully BEHIND the eye plane to zero tiles (perf 7e)', () => {
    // Centre 5 m behind the camera (view +z), radius 0.5: the FARTHEST point
    // along the view axis is -5 + 0.5 < 0, so no forward ray can reach it and
    // it touches no pixel. Omitting it is sound.
    const r = binner().bin([group({ center: [0, 0, 5], radius: 0.5 })], straightCamera());
    expect(r.totalEntries).toBe(0);
    expect(r.clampedTiles).toBe(0);
    for (let ty = 0; ty < r.tilesY; ty++) {
      for (let tx = 0; tx < r.tilesX; tx++) expect(r.countAt(tx, ty)).toBe(0);
    }
  });

  it('bins a sphere STRADDLING the eye plane into every tile (conservative)', () => {
    // Centre 0.5 m behind the eye but radius 1: the near end is in front and
    // the far end behind, so a forward ray can still clip it. Cover-all is the
    // safe direction for a crossing sphere.
    const r = binner().bin([group({ center: [0, 0, 0.5], radius: 1 })], straightCamera());
    expect(r.totalEntries).toBe(16);
    for (let ty = 0; ty < r.tilesY; ty++) {
      for (let tx = 0; tx < r.tilesX; tx++) expect(r.countAt(tx, ty)).toBe(1);
    }
  });

  it('carries the distortion factor and flag bits packBody stored on every per-tile entry', () => {
    const r = binner().bin(
      [group({ bodyIndex: 3, start: 17, count: 5, distort: 22, flags: 3 })], straightCamera(),
    );
    // Centre tile (2,2) holds the entry; read it back through the packed view.
    const e = r.entryAt(2, 2, 0)!;
    expect(e.bodyIndex).toBe(3);
    expect(e.start).toBe(17);
    expect(e.count).toBe(5);
    expect(e.distort).toBeCloseTo(22, 5);
    expect(e.flags).toBe(3);
    // The bound sphere rides the entry too — the shader's per-step cull
    // needs it (tiles cut the list; spheres still cut per-step work).
    expect(e.radius).toBeCloseTo(group().radius, 5);
  });

  it('clamps at the 64-entry cap and flags, never wrapping or throwing', () => {
    const groups: TileGroupInput[] = [];
    for (let i = 0; i < TILE_MAX_ENTRIES + 30; i++) {
      groups.push(group({ bodyIndex: i % 16, start: i, center: [0, 0, -4], radius: 4 / 3 }));
    }
    const r = binner().bin(groups, straightCamera());
    // Every covered tile stopped at the cap.
    expect(r.countAt(2, 2)).toBe(TILE_MAX_ENTRIES);
    expect(r.clampedTiles).toBeGreaterThan(0);
    // The first TILE_MAX_ENTRIES groups survive in order; nothing wrapped
    // around into garbage beyond them.
    expect(r.entryAt(2, 2, 0)!.start).toBe(0);
    expect(r.entryAt(2, 2, TILE_MAX_ENTRIES - 1)!.start).toBe(TILE_MAX_ENTRIES - 1);
    expect(() => r.entryAt(2, 2, TILE_MAX_ENTRIES)).toThrow();
  });
});

describe('tile geometry constants', () => {
  it('tiles are ' + TILE_SIZE_PX + ' px at SDF-pass resolution', () => {
    // A 128x96 target gives 8x6 whole tiles plus a partial row/column, and
    // the partial edges must exist (ceil), not be dropped.
    const r = new TileBinner(130, 98).bin([], straightCamera());
    expect(r.tilesX).toBe(Math.ceil(130 / TILE_SIZE_PX));
    expect(r.tilesY).toBe(Math.ceil(98 / TILE_SIZE_PX));
  });
});
