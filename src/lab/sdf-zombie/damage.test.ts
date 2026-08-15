// src/lab/sdf-zombie/damage.test.ts
import { describe, it, expect } from 'vitest';
import { worldHitToWound, woundWorldPos, pushWound, MAX_WOUNDS } from './damage';
import type { Primitive } from './types';
import { add, len, sub } from './vec';

const capsule = (a: [number, number, number], b: [number, number, number]): Primitive =>
  ({ a, b, radius: 0.1, scale: [1, 1, 1], blendK: 0.05, limb: 'armL', cluster: 2 });

describe('worldHitToWound / woundWorldPos', () => {
  const prims = [capsule([0, 1, 0], [0, 1.4, 0]), capsule([1, 1, 0], [1, 1.4, 0])];

  it('binds the wound to the nearest primitive', () => {
    expect(worldHitToWound(prims, [0.95, 1.2, 0], 0.06, 'pellet').primIdx).toBe(1);
    expect(worldHitToWound(prims, [0.05, 1.2, 0], 0.06, 'pellet').primIdx).toBe(0);
  });

  it('round-trips the hit point back to the same world position', () => {
    const hit: [number, number, number] = [0.09, 1.2, 0.02];
    const w = worldHitToWound(prims, hit, 0.06, 'pellet');
    const back = woundWorldPos(prims, w);
    expect(len(sub(back, hit))).toBeCloseTo(0, 8);
  });

  it('follows its primitive when the body moves — the crater stays on the flesh', () => {
    const hit: [number, number, number] = [0.09, 1.2, 0.02];
    const w = worldHitToWound(prims, hit, 0.06, 'pellet');
    const offset: [number, number, number] = [0.5, -0.3, 0.2];
    const moved = [{ ...prims[0]!, a: add(prims[0]!.a, offset), b: add(prims[0]!.b, offset) }, prims[1]!];
    const back = woundWorldPos(moved, w);
    expect(len(sub(back, add(hit, offset)))).toBeCloseTo(0, 8);
  });

  it('follows its primitive when the limb rotates', () => {
    const hit: [number, number, number] = [0.09, 1.2, 0.0];
    const w = worldHitToWound(prims, hit, 0.06, 'pellet');
    // Rotate the capsule 90° about its own head, from +Y to +X.
    const rotated = [{ ...prims[0]!, b: [0.4, 1, 0] as const }, prims[1]!];
    const back = woundWorldPos(rotated as Primitive[], w);
    // Still the same distance from the capsule axis head.
    expect(len(sub(back, rotated[0]!.a))).toBeCloseTo(len(sub(hit, prims[0]!.a)), 6);
  });

  it('records the wound type and radius', () => {
    const w = worldHitToWound(prims, [0.09, 1.2, 0], 0.09, 'burn');
    expect(w.type).toBe('burn');
    expect(w.radius).toBe(0.09);
    expect(w.ageSec).toBe(0);
  });
});

describe('pushWound', () => {
  const w = (r: number) => worldHitToWound([capsule([0, 1, 0], [0, 1.4, 0])], [0.09, 1.2, 0], r, 'pellet');

  it('appends below capacity', () => {
    expect(pushWound([w(0.01), w(0.02)], w(0.03), MAX_WOUNDS)).toHaveLength(3);
  });

  it('evicts the oldest at capacity and keeps length fixed', () => {
    const full = Array.from({ length: MAX_WOUNDS }, (_, i) => w(i / 1000));
    const out = pushWound(full, w(0.99), MAX_WOUNDS);
    expect(out).toHaveLength(MAX_WOUNDS);
    expect(out[out.length - 1]!.radius).toBe(0.99);
    expect(out[0]!.radius).toBe(1 / 1000); // index 0 evicted
  });
});
