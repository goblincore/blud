// src/lab/sdf-zombie/webgpu/shell-hull.test.ts
import { describe, it, expect } from 'vitest';
import { buildHullMesh } from './shell-hull';

/** Signed distance of a unit sphere at the origin: < 0 inside, 0 on surface. */
function sphereField(p: [number, number, number]): number {
  const [x, y, z] = p;
  return Math.sqrt(x * x + y * y + z * z) - 1;
}

describe('buildHullMesh', () => {
  it('extracts a closed unit-sphere mesh at the correct radius', () => {
    const m = buildHullMesh(
      (p) => sphereField(p),
      [-1.5, -1.5, -1.5], [1.5, 1.5, 1.5], 16,
    );
    expect(m.triCount).toBeGreaterThan(0);
    expect(m.vertCount).toBeGreaterThan(0);

    // Every vertex must sit on (or very near) the unit sphere.
    let sum = 0;
    for (let i = 0; i < m.vertCount; i++) {
      const x = m.positions[i * 3]!;
      const y = m.positions[i * 3 + 1]!;
      const z = m.positions[i * 3 + 2]!;
      sum += Math.sqrt(x * x + y * y + z * z);
    }
    const mean = sum / m.vertCount;
    expect(mean).toBeGreaterThan(0.96);
    expect(mean).toBeLessThan(1.04);
  });

  it('produces a watertight mesh (every edge shared by exactly two triangles)', () => {
    const m = buildHullMesh(
      (p) => sphereField(p),
      [-1.5, -1.5, -1.5], [1.5, 1.5, 1.5], 12,
    );
    expect(m.triCount).toBeGreaterThan(0);

    const edges = new Map<string, number>();
    for (let t = 0; t < m.triCount; t++) {
      const a = m.indices[t * 3]!;
      const b = m.indices[t * 3 + 1]!;
      const c = m.indices[t * 3 + 2]!;
      for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
        const key = u < v ? `${u}_${v}` : `${v}_${u}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    // A closed 2-manifold has no boundary: every edge has exactly 2 faces.
    let boundary = 0;
    for (const count of edges.values()) if (count !== 2) boundary++;
    expect(boundary).toBe(0);
  });
});
