import { describe, expect, it } from 'vitest';
import { parseBlob } from '../../blob-parse';
import { compileBlob } from '../../blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../build-body';
import { bindRig } from '../../rig-bind';
import { sdBody } from '../../validate';
import zombie from '../../characters/zombie.blob?raw';
import soldier from '../../characters/soldier.blob?raw';
import { createSkeletonSources, type BoneFieldSource, type Point3 } from './contract';
import { meshBoneSource } from './mesh-skull';
import { extractSegmentMesh } from './mesh';

function at(source: BoneFieldSource, x: number, y: number, z: number): Point3 {
  return [x, y, z].map((v, i) => source.bounds.min[i]! + (v + 1) * 0.5 * (source.bounds.max[i]! - source.bounds.min[i]!)) as unknown as Point3;
}
function front(source: BoneFieldSource, x: number, y: number): number {
  for (let z = 1; z >= -1; z -= 0.002) if (source.distance(at(source, x, y, z)) <= 0) return z;
  return -1;
}

describe.each([['zombie', zombie], ['soldier', soldier]])('%s mesh skull sculpt', (character, blob) => {
  const body = buildBody(compileBlob(parseBlob(blob)), DEFAULT_BUILD_OPTS);
  const sources = createSkeletonSources(body, bindRig(body), { character });
  const original = sources.find(s => s.segment === 'head')!;
  const skull = meshBoneSource(original);

  it('leaves the shared field and non-head sources unchanged', () => {
    expect(skull).not.toBe(original);
    expect(skull.revision).not.toBe(original.revision);
    expect(meshBoneSource(skull)).toBe(skull);
    expect(meshBoneSource(sources.find(s => s.segment !== 'head')!)).toBe(sources.find(s => s.segment !== 'head'));
    for (let x = -1; x <= 1; x += 0.1) for (let y = -1; y <= 1; y += 0.1) for (let z = -1; z <= 1; z += 0.1) {
      const p = at(original, x, y, z);
      expect(skull.distance(p)).toBeGreaterThanOrEqual(original.distance(p));
    }
  });

  it('cuts deep nasal, orbital, cheek and bite recesses with retained dental ledges', () => {
    for (const [x, y] of [[0, -0.06], [0.36, 0.22], [0.55, -0.19], [0, -0.38]]) {
      expect(front(original, x!, y!) - front(skull, x!, y!), `${x},${y}`).toBeGreaterThan(0.12);
    }
    expect(front(skull, 0, -0.30)).toBeGreaterThan(front(skull, 0, -0.38) + 0.15);
    expect(front(skull, 0, -0.46)).toBeGreaterThan(front(skull, 0, -0.38) + 0.15);
    expect(skull.distance(at(skull, 0.6, -0.75, 0))).toBeGreaterThan(0);
    expect(front(skull, 0, -0.70)).toBeCloseTo(0.70, 2);
    expect(front(skull, 0.20, -0.70)).toBeCloseTo(0.70, 2);
    expect(skull.distance(at(skull, 0, -0.87, 0))).toBeGreaterThan(0);
  });

  it('keeps all extracted skull vertices behind intact flesh', () => {
    const mesh = extractSegmentMesh(original);
    const positions = mesh.geometry.getAttribute('position');
    let worst = -Infinity;
    for (let i = 0; i < positions.count; i++) {
      worst = Math.max(worst, sdBody(original.toWorld([positions.getX(i), positions.getY(i), positions.getZ(i)]), body));
    }
    mesh.geometry.dispose();
    expect(worst).toBeLessThanOrEqual(-0.003);
  });
});
