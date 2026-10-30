import { describe, expect, it, vi } from 'vitest';
import { PLANE_GROUND } from '../debris-ground';
import { createKitRemains } from './kit-remains';
import type { SurrenderedEquipment } from './character-view';

function fakeLeft(indexCount = 100, stepsToRest = 2) {
  let left = stepsToRest;
  const disposed = vi.fn();
  const eq = {
    kit: { object: { removeFromParent() {} }, dispose: disposed },
    wreck: { indexCount, step: () => --left > 0, report: () => [] },
    prop: null,
  } as unknown as SurrenderedEquipment;
  return { eq, disposed };
}

describe('kit remains', () => {
  it('steps a wreck until it lands, then not again', () => {
    const r = createKitRemains();
    const { eq } = fakeLeft();
    const step = vi.spyOn(eq.wreck!, 'step');
    r.add(eq);
    expect(r.moving).toBe(true);
    for (let i = 0; i < 5; i++) r.step(1 / 60, PLANE_GROUND);
    expect(step).toHaveBeenCalledTimes(2);
    expect(r.moving).toBe(false);
  });
  it('keeps at most maxBodies, disposing the oldest', () => {
    const r = createKitRemains({ maxBodies: 2, maxIndices: 1e9 });
    const a = fakeLeft(), b = fakeLeft(), c = fakeLeft();
    r.add(a.eq); r.add(b.eq); r.add(c.eq);
    expect(r.count).toBe(2);
    expect(a.disposed).toHaveBeenCalledOnce();
    expect(b.disposed).not.toHaveBeenCalled();
  });
  it('caps the indices kept, but always keeps the newest', () => {
    const r = createKitRemains({ maxBodies: 9, maxIndices: 150 });
    const a = fakeLeft(100), b = fakeLeft(100), c = fakeLeft(1000);
    r.add(a.eq); r.add(b.eq);
    expect(a.disposed).toHaveBeenCalledOnce();
    r.add(c.eq);
    expect(b.disposed).toHaveBeenCalledOnce();
    expect(r.count).toBe(1);
  });
  it('clear disposes everything', () => {
    const r = createKitRemains();
    const a = fakeLeft();
    r.add(a.eq);
    r.clear();
    expect(a.disposed).toHaveBeenCalledOnce();
    expect(r.count).toBe(0);
  });
  it('stops a gun that never comes to rest', () => {
    const r = createKitRemains();
    const step = vi.fn();
    r.add({ kit: null, wreck: null, prop: { step, dropped: () => ({ pos: [0, 0, 0], resting: false }), object: { removeFromParent() {} }, dispose() {} } } as unknown as SurrenderedEquipment);
    for (let i = 0; i < 400; i++) r.step(1 / 60, PLANE_GROUND);
    expect(r.moving).toBe(false);
    expect(step.mock.calls.length).toBeLessThan(370);
  });
});
