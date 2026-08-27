import { describe, it, expect } from 'vitest';
import { projectToSurface, sampleBodySurface } from './ring-fit';
import { sdBody } from './validate';
import type { Primitive, ClusterInfo } from './types';

/**
 * One upright capsule, radius 0.1, from y=0 to y=1.
 *
 * ClusterInfo requires id/limb/center/radius as well as start/count/alive —
 * write the whole literal rather than casting a subset, so a future field
 * addition breaks here loudly instead of being silently cast away.
 */
function oneCapsule(scale: [number, number, number] = [1, 1, 1]): {
  prims: Primitive[]; clusters: ClusterInfo[];
} {
  const prims: Primitive[] = [{
    a: [0, 0, 0], b: [0, 1, 0], radius: 0.1, scale,
    blendK: 0.01, limb: 'torso', cluster: 0, bone: 'spine1', src: 42,
  }];
  const clusters: ClusterInfo[] = [
    { id: 0, limb: 'torso', start: 0, count: 1, center: [0, 0.5, 0], radius: 1, alive: true },
  ];
  return { prims, clusters };
}

describe('projectToSurface', () => {
  it('lands a point on the zero level set', () => {
    const body = oneCapsule();
    const q = projectToSurface([0.4, 0.5, 0], body);
    expect(Math.abs(sdBody(q, body))).toBeLessThan(1e-6);
  });

  it('converges from inside as well as outside', () => {
    const body = oneCapsule();
    const q = projectToSurface([0.01, 0.5, 0], body);
    expect(Math.abs(sdBody(q, body))).toBeLessThan(1e-6);
  });
});

describe('sampleBodySurface', () => {
  it('returns points on the surface, grouped by the bone they came from', () => {
    const body = oneCapsule();
    const byBone = sampleBodySurface(body, 200);
    const pts = byBone.get('spine1')!;
    expect(pts.length).toBeGreaterThan(100);
    for (const p of pts) expect(Math.abs(sdBody(p, body))).toBeLessThan(1e-5);
  });

  it('reflects anisotropy — a deep=2 capsule reaches twice as far in z', () => {
    const byBone = sampleBodySurface(oneCapsule([1, 1, 2]), 400);
    const pts = byBone.get('spine1')!;
    const maxX = Math.max(...pts.map((p) => Math.abs(p[0])));
    const maxZ = Math.max(...pts.map((p) => Math.abs(p[2])));
    expect(maxZ / maxX).toBeGreaterThan(1.7);
  });
});
