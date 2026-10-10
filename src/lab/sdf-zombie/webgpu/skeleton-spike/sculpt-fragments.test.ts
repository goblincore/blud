import { describe, expect, it } from 'vitest';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig } from '../../rig-bind';
import zombie from '../../characters/zombie.blob?raw';
import soldier from '../../characters/soldier.blob?raw';
import { createSkeletonSources } from './contract';
import { extractSegmentMesh, MESH_CELL } from './mesh';
import { SCULPT_FINE_CELL } from './sculpt-variant';
import {
  SCULPT_FRAGMENT_CUTS, SCULPT_FRAGMENT_IDS, fragmentVertexData, partitionSculptMesh, sculptFragmentAt,
} from './sculpt-fragments';

const headOf = (character: string, blob: string) => {
  const body = buildBody(compileBlob(parseBlob(blob)), DEFAULT_BUILD_OPTS);
  return createSkeletonSources(body, bindRig(body), { character }).find(s => s.segment === 'head')!;
};

describe('sculptFragmentAt: the head\'s regions', () => {
  it('names the parts of a skull where they are', () => {
    expect(sculptFragmentAt([0, 0.7, 0.8])).toBe('frontal');
    expect(sculptFragmentAt([0.4, 0.2, 0.8])).toBe('face-l');
    expect(sculptFragmentAt([-0.4, 0.2, 0.8])).toBe('face-r');
    expect(sculptFragmentAt([0, -0.27, 0.9])).toBe('maxilla');
    expect(sculptFragmentAt([0, -0.5, 0.9])).toBe('mandible');
    expect(sculptFragmentAt([0.6, 0.8, 0])).toBe('parietal-l');
    expect(sculptFragmentAt([-0.6, 0.8, 0])).toBe('parietal-r');
    expect(sculptFragmentAt([0.9, -0.1, 0])).toBe('temporal-l');
    expect(sculptFragmentAt([-0.9, -0.1, 0])).toBe('temporal-r');
    expect(sculptFragmentAt([0, 0.2, -0.9])).toBe('occipital');
  });
  it('the cheekbone outside the upper jaw is the face\'s, and the skull\'s base is not the jaw', () => {
    expect(sculptFragmentAt([SCULPT_FRAGMENT_CUTS.maxillaHalfW + 0.05, -0.2, 0.6])).toBe('face-l');
    expect(sculptFragmentAt([0, -0.7, SCULPT_FRAGMENT_CUTS.jawBack - 0.1])).toBe('occipital');
  });
  it('answers for every point: a fragment of the list', () => {
    for (let x = -1.2; x <= 1.2; x += 0.3) for (let y = -1.2; y <= 1.2; y += 0.3) for (let z = -1.2; z <= 1.2; z += 0.3) {
      expect(SCULPT_FRAGMENT_IDS).toContain(sculptFragmentAt([x, y, z]));
    }
  });
});

describe('partitionSculptMesh: both sculpts, both cells, the zombie and the soldier', () => {
  const heads = [['zombie', headOf('zombie', zombie)], ['soldier', headOf('soldier', soldier)]] as const;
  const meshes = heads.flatMap(([name, head]) => ([[1, MESH_CELL], [2, MESH_CELL], [2, SCULPT_FINE_CELL]] as const).map(([shape, cell]) => {
    const geometry = extractSegmentMesh(head, cell, undefined, shape).geometry;
    return { label: `${name}, sculpt ${shape}, ${cell * 1000} mm`, head, geometry, fragments: partitionSculptMesh(geometry.getAttribute('position').array, geometry.index!.array, head.bounds) };
  }));

  it.each(meshes)('$label: every triangle is in exactly one fragment', ({ geometry, fragments }) => {
    const index = geometry.index!.array, seen = new Map<string, number>();
    for (const f of fragments) for (let t = 0; t < f.indices.length; t += 3) {
      const key = `${f.indices[t]},${f.indices[t + 1]},${f.indices[t + 2]}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    expect(fragments.reduce((n, f) => n + f.indices.length, 0)).toBe(index.length);
    for (let t = 0; t < index.length; t += 3) expect(seen.get(`${index[t]},${index[t + 1]},${index[t + 2]}`)).toBe(1);
    expect(fragments.map(f => f.id)).toEqual([...SCULPT_FRAGMENT_IDS]);
  });

  it.each(meshes)('$label: no fragment is empty or tiny, and none is most of the skull', ({ fragments }) => {
    const total = fragments.reduce((a, f) => a + f.area, 0), triangles = fragments.reduce((n, f) => n + f.indices.length / 3, 0);
    for (const f of fragments) {
      expect(f.indices.length / 3 / triangles, f.id).toBeGreaterThan(0.04);
      expect(f.area / total, f.id).toBeGreaterThan(0.04);
      expect(f.area / total, f.id).toBeLessThan(0.25);
    }
  });

  it.each(meshes)('$label: a fragment\'s pivot is inside its box, and the two sides mirror each other', ({ fragments }) => {
    const by = new Map(fragments.map(f => [f.id, f]));
    for (const f of fragments) for (let k = 0; k < 3; k++) {
      expect(f.pivot[k]!).toBeGreaterThanOrEqual(f.min[k]!);
      expect(f.pivot[k]!).toBeLessThanOrEqual(f.max[k]!);
    }
    for (const part of ['parietal', 'temporal', 'face'] as const) {
      const l = by.get(`${part}-l`)!, r = by.get(`${part}-r`)!;
      expect(l.pivot[0]).toBeGreaterThan(0);
      expect(r.pivot[0]).toBeLessThan(0);
      expect(l.pivot[0] + r.pivot[0]).toBeCloseTo(0, 2);
      expect(l.area / r.area).toBeGreaterThan(0.9);
      expect(l.area / r.area).toBeLessThan(1.1);
    }
    // The lower jaw hangs under the upper, and the brow is over the face.
    expect(by.get('mandible')!.pivot[1]).toBeLessThan(by.get('maxilla')!.pivot[1]);
    expect(by.get('frontal')!.pivot[1]).toBeGreaterThan(by.get('face-l')!.pivot[1]);
    expect(by.get('occipital')!.pivot[2]).toBeLessThan(by.get('frontal')!.pivot[2]);
  });
});

describe('fragmentVertexData: a fragment\'s own vertices', () => {
  it('renumbers the vertices its triangles use and carries every attribute over, unmoved', () => {
    // Two triangles of a five-vertex mesh; the fragment has the second only.
    const position = [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5, 6, 5, 5];
    const feature = [10, 11, 12, 13, 20, 21, 22, 23, 30, 31, 32, 33, 40, 41, 42, 43, 50, 51, 52, 53];
    const data = fragmentVertexData({ indices: Uint32Array.from([4, 2, 3]) }, {
      position: { array: position, itemSize: 3 }, meshFeature: { array: feature, itemSize: 4 },
    });
    expect(data.count).toBe(3);
    expect([...data.index]).toEqual([0, 1, 2]);
    expect([...data.attributes.position!]).toEqual([6, 5, 5, 0, 1, 0, 5, 5, 5]);
    expect([...data.attributes.meshFeature!]).toEqual([50, 51, 52, 53, 30, 31, 32, 33, 40, 41, 42, 43]);
  });
  it('a vertex two triangles share is kept once', () => {
    const data = fragmentVertexData({ indices: Uint32Array.from([0, 1, 2, 2, 1, 3]) }, { position: { array: new Array(12).fill(0), itemSize: 3 } });
    expect(data.count).toBe(4);
    expect([...data.index]).toEqual([0, 1, 2, 2, 1, 3]);
  });
  it('a real head\'s fragments together hold every triangle\'s three corners', () => {
    const head = headOf('zombie', zombie), geometry = extractSegmentMesh(head, MESH_CELL, undefined, 2).geometry;
    const position = geometry.getAttribute('position');
    let triangles = 0;
    for (const f of partitionSculptMesh(position.array, geometry.index!.array, head.bounds)) {
      const data = fragmentVertexData(f, { position: { array: position.array, itemSize: 3 } });
      triangles += data.index.length / 3;
      expect(Math.max(...data.index)).toBe(data.count - 1);
    }
    expect(triangles).toBe(geometry.index!.count / 3);
  });
});
