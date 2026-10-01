import { describe, it, expect } from 'vitest';
import { typeRenderOrder, SEED_RENDER_ORDER, BACK_BATCH_BASE, FRONT_BATCH_BASE } from './type-order';

describe('typeRenderOrder (spec D7, amended)', () => {
  it('seed < every back batch < every front batch', () => {
    expect(SEED_RENDER_ORDER).toBeLessThan(BACK_BATCH_BASE);
    expect(BACK_BATCH_BASE + 64).toBeLessThan(FRONT_BATCH_BASE);
  });
  it('ranks each batch kind near-to-far independently; empty batches (Infinity) last', () => {
    const o = typeRenderOrder([
      { key: 'a', nearestBack: Infinity, nearestFront: 6 },
      { key: 'b', nearestBack: 0.3, nearestFront: 2 },
      { key: 'c', nearestBack: Infinity, nearestFront: Infinity },
    ]);
    expect(o.get('b')!.back).toBe(BACK_BATCH_BASE);
    expect(o.get('b')!.front).toBe(FRONT_BATCH_BASE);
    expect(o.get('a')!.front).toBe(FRONT_BATCH_BASE + 1);
    expect(o.get('c')!.front).toBe(FRONT_BATCH_BASE + 2);
  });
  it('ties keep the input order (stable)', () => {
    const o = typeRenderOrder([
      { key: 'x', nearestBack: Infinity, nearestFront: 3 },
      { key: 'y', nearestBack: Infinity, nearestFront: 3 },
    ]);
    expect(o.get('x')!.front).toBeLessThan(o.get('y')!.front);
  });
});
