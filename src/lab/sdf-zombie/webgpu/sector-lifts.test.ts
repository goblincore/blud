import { describe, expect, it } from 'vitest';
import type { SectorLiftDef, SectorMap } from './sector-def';
import { callsLift, liftBlockMesh, restingLift, stepLift, LIFT_BOARD_S } from './sector-lifts';

const def: SectorLiftDef = { id: 'l', sector: 1, low: 0, top: 2, speed: 2, wait: 3 };
// Sector 0 is the room (x 0..4), sector 1 the lift (x 4..6) with its floor at low.
const map = {
  vertices: [[0, 0], [4, 0], [6, 0], [6, 2], [4, 2], [0, 2]],
  sectors: [{ floor: 0, ceil: 5, zone: 0 }, { floor: 0, ceil: 5, zone: 0 }],
  lines: [{ v: [0, 1], front: 0, back: -1 }, { v: [1, 4], front: 0, back: 1 }, { v: [4, 5], front: 0, back: -1 }, { v: [5, 0], front: 0, back: -1 },
    { v: [1, 2], front: 1, back: -1 }, { v: [2, 3], front: 1, back: -1 }, { v: [3, 4], front: 1, back: -1 }],
} as unknown as SectorMap;

const run = (st: ReturnType<typeof restingLift>, s: number, called = false, aboard = false) => { for (let t = 0; t < s; t += 0.05) stepLift(def, st, 0.05, called, aboard); };

describe('a lift', () => {
  it('rests at the top', () => { const st = restingLift(def); run(st, 5); expect(st).toMatchObject({ phase: 'top', floor: 2 }); });

  it('comes down when called, and waits', () => {
    const st = restingLift(def);
    run(st, 1.2, true);
    expect(st).toMatchObject({ phase: 'bottom', floor: 0 });
    run(st, 2);
    expect(st.phase).toBe('bottom');
  });

  it('goes back up after the wait with nobody on it', () => {
    const st = restingLift(def);
    run(st, 1.2, true);
    run(st, 3.2);
    expect(st.phase).toBe('rising');
    run(st, 1.2);
    expect(st).toMatchObject({ phase: 'top', floor: 2 });
  });

  it('rises soon after someone stands on it', () => {
    const st = restingLift(def);
    run(st, 1.2, true);
    run(st, LIFT_BOARD_S + 0.1, false, true);
    expect(st.phase).toBe('rising');
  });

  it('keeps waiting while the player stays at its edge, without boarding', () => {
    const st = restingLift(def);
    run(st, 1.2, true);
    run(st, 6, true);
    expect(st.phase).toBe('bottom');
  });
});

describe('who calls it', () => {
  it('the player below it, at its edge', () => { expect(callsLift(map, def, 0, 3, 0, 1)).toBe(true); });
  it('not from far off', () => { expect(callsLift(map, def, 0, 1, 0, 1)).toBe(false); });
  it('not from on it', () => { expect(callsLift(map, def, 1, 5, 0, 1)).toBe(false); });
  it('not from the level of its top', () => { expect(callsLift(map, def, 0, 3, 1.8, 1)).toBe(false); });
});

describe('the block', () => {
  const m = liftBlockMesh(map, def);
  const P = (i: number) => [m.position[3 * i]!, m.position[3 * i + 1]!, m.position[3 * i + 2]!];

  it('caps the sector at low and hangs sides the whole travel below', () => {
    const ys = Array.from({ length: m.count }, (_, i) => P(i)[1]!);
    expect(Math.max(...ys)).toBe(0);
    expect(Math.min(...ys)).toBe(-2);
    for (let i = 0; i < m.count; i++) { expect(P(i)[0]).toBeGreaterThanOrEqual(4); expect(P(i)[0]).toBeLessThanOrEqual(6); }
  });

  it('winds every triangle toward its normal', () => {
    for (let i = 0; i < m.count; i += 3) {
      const [a, b, c] = [P(i), P(i + 1), P(i + 2)] as [number[], number[], number[]];
      const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      expect(n[0]! * m.normal[3 * i]! + n[1]! * m.normal[3 * i + 1]! + n[2]! * m.normal[3 * i + 2]!).toBeGreaterThan(0);
    }
  });

  it('its side normals point out of the sector', () => {
    for (let i = 0; i < m.count; i++) {
      if (m.normal[3 * i + 1] !== 0) continue;
      const [x, , z] = P(i) as [number, number, number];
      expect((5 - x) * m.normal[3 * i]! + (1 - z) * m.normal[3 * i + 2]!).toBeLessThan(0);
    }
  });
});
