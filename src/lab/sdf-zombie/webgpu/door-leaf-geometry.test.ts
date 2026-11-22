// src/lab/sdf-zombie/webgpu/door-leaf-geometry.test.ts
import { describe, expect, it } from 'vitest';
import { doorFaceSigns, doorLeafMesh, LEAF_INSET_M, LEAF_TOP_GAP_M } from './door-leaf-geometry';
import type { SectorDoorDef } from './sector-def';

// A doorway along z at x 0.25 (faces x 0 and x 0.5), 2 m wide, 0.5 m deep, 2.5 m tall.
const def: SectorDoorDef = { id: 'd', sector: 1, faces: [1, 5], a: [0.25, -1], b: [0.25, 1], width: 2, depth: 0.5, height: 2.5,
  zones: [0, 1], style: 'split', speed: 3, wait: 4, key: null };
const signs = doorFaceSigns(def, [[0, 0], [0.5, 0]]);
const tri = (d: ReturnType<typeof doorLeafMesh>, k: number) => [0, 1, 2].map(i => d.position.slice((k * 3 + i) * 3, (k * 3 + i) * 3 + 3));

describe('door leaf mesh data', () => {
  it('faces[0] (x 0) lies left of a -> b (left of +z is -x), faces[1] right', () => {
    expect(signs).toEqual([1, -1]);
  });
  it('side 0 is its face plane (inset) and the leading edges; side 1 only its face', () => {
    const s0 = doorLeafMesh(def, 0, 0, signs), s1 = doorLeafMesh(def, 1, 0, signs);
    expect(s0.count).toBe(24);                       // 2 leaves × (face + leading edge) × 6
    expect(s1.count).toBe(12);
    const xs1 = new Set(s1.position.filter((_, i) => i % 3 === 0).map(v => +v.toFixed(6)));
    expect([...xs1]).toEqual([+(0.5 - LEAF_INSET_M).toFixed(6)]);
    const ys = s0.position.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(2.5 - LEAF_TOP_GAP_M, 9);
    expect(Math.min(...ys)).toBe(0);
  });
  it('every triangle winds toward its normal; each leaf slides half the width toward its jamb', () => {
    const s0 = doorLeafMesh(def, 0, 0, signs);
    for (let k = 0; k < s0.count / 3; k++) {
      const [a, b, c] = tri(s0, k) as [number[], number[], number[]];
      const n = s0.normal.slice(k * 9, k * 9 + 3);
      const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      const cr = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      expect(cr[0]! * n[0]! + cr[1]! * n[1]! + cr[2]! * n[2]!).toBeGreaterThan(0);
      const slide = s0.slide.slice(k * 9, k * 9 + 3);
      // Leaf 0 spans z -1..0; the two leading edges both sit at z 0, leaf 0's facing +z (toward leaf 1).
      const edge = Math.max(Math.abs(a[2]!), Math.abs(b[2]!), Math.abs(c[2]!)) <= 1e-9;
      const leaf0 = edge ? n[2]! > 0 : Math.max(a[2]!, b[2]!, c[2]!) <= 1e-9;
      const want = leaf0 ? [0, 0, -1] : [0, 0, 1];
      slide.forEach((v, i) => expect(v).toBeCloseTo(want[i]!, 9));
    }
  });
});
