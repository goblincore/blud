import { describe, expect, it } from 'vitest';
import type { SectorMap } from './sector-def';
import { createSwitchField, PLATE, shootLine, switchPlateMesh } from './sector-switches';

describe('gun switches', () => {
  const defs = [{ id: 'a', line: 2, event: 'switch.a' }, { id: 'b', line: 5, event: 'switch.b' }];

  it('a shot on the line presses its switch, once', () => {
    const f = createSwitchField(defs, 8);
    expect(shootLine(f, 5)).toBe(1);
    expect(f.pressed[1]).toBe(1);
    expect(shootLine(f, 5)).toBe(-1);
    expect(f.pressed[0]).toBe(0);
  });

  it('other lines, and no line at all, press nothing', () => {
    const f = createSwitchField(defs, 8);
    expect(shootLine(f, 3)).toBe(-1);
    expect(shootLine(f, -1)).toBe(-1);
    expect(shootLine(f, 99)).toBe(-1);
    expect([...f.pressed]).toEqual([0, 0]);
  });
});

describe('the plate', () => {
  // One square room, the sector on the left of its lines; line 0 runs along z = 0 with the room at z > 0.
  const map = {
    vertices: [[0, 0], [0, 4], [4, 4], [4, 0]],
    sectors: [{ floor: 1, ceil: 4, light: 1, zone: 0, materials: { floor: 'a', ceil: 'a', wall: 'a' } }],
    lines: [{ v: [0, 3], front: 0, back: -1 }, { v: [3, 2], front: 0, back: -1 }, { v: [2, 1], front: 0, back: -1 }, { v: [1, 0], front: 0, back: -1 }],
  } as unknown as SectorMap;
  const plate = (y: number[], i: number) => y[3 * i + 1]!;

  it('stands off the wall into the front sector, at the middle of the line, faces out', () => {
    const m = switchPlateMesh(map, { id: 'a', line: 0, event: 'e' });
    expect(m.count).toBeGreaterThan(0);
    let front = 0;
    for (let i = 0; i < m.count; i++) {
      const x = m.position[3 * i]!, z = m.position[3 * i + 2]!;
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(PLATE.proud + PLATE.lampProud + 1e-9);
      expect(Math.abs(x - 2)).toBeLessThanOrEqual(PLATE.width / 2 + 1e-9);
      if (m.normal[3 * i + 2] === 1) front++;
      expect(plate(m.position, i)).toBeGreaterThan(1);
    }
    expect(front).toBe(12);       // the plate's and the lamp's fronts
  });

  it('its triangles wind toward their normals', () => {
    const m = switchPlateMesh(map, { id: 'a', line: 0, event: 'e' });
    for (let i = 0; i < m.count; i += 3) {
      const p = (k: number) => [m.position[3 * (i + k)]!, m.position[3 * (i + k) + 1]!, m.position[3 * (i + k) + 2]!];
      const [a, b, c] = [p(0), p(1), p(2)] as [number[], number[], number[]];
      const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      expect(n[0]! * m.normal[3 * i]! + n[1]! * m.normal[3 * i + 1]! + n[2]! * m.normal[3 * i + 2]!).toBeGreaterThan(0);
    }
  });

  it('marks only the lamp faces', () => {
    const m = switchPlateMesh(map, { id: 'a', line: 0, event: 'e' });
    expect(m.lamp.filter(v => v === 1).length).toBe(m.count / 2);
  });
});
