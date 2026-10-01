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
    expect(o.get('a')!.back).toBe(BACK_BATCH_BASE + 1);
    expect(o.get('c')!.back).toBe(BACK_BATCH_BASE + 2);
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
  it('back and front sorts are independent (order can disagree)', () => {
    const o = typeRenderOrder([
      { key: 'p', nearestBack: 0.2, nearestFront: 9 },
      { key: 'q', nearestBack: Infinity, nearestFront: 1 },
    ]);
    expect(o.get('p')!.back).toBeLessThan(o.get('q')!.back);
    expect(o.get('q')!.front).toBeLessThan(o.get('p')!.front);
  });
  it('NaN distances rank after finite ones', () => {
    const o = typeRenderOrder([
      { key: 'isEmpty', nearestBack: NaN, nearestFront: NaN },
      { key: 'notEmpty', nearestBack: 1, nearestFront: 2 },
    ]);
    expect(o.get('notEmpty')!.back).toBeLessThan(o.get('isEmpty')!.back);
    expect(o.get('notEmpty')!.front).toBeLessThan(o.get('isEmpty')!.front);
  });
});
