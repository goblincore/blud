import { describe, it, expect } from 'vitest';
import { createEnclosure, DEFAULT_WALLS, ENCLOSURE_BOX } from './enclosure';

describe('createEnclosure', () => {
  it('builds six walls and parents them to one group', () => {
    const e = createEnclosure();
    expect(e.group.children).toHaveLength(6);
  });

  it('starts hidden — the lab must look unchanged until it is switched on', () => {
    const e = createEnclosure();
    expect(e.group.visible).toBe(false);
  });

  it('exposes a box matching the wall placement', () => {
    // ambientAt derives every wall position from these bounds, so a
    // mismatch here means the shader lights a room the eye cannot see.
    expect(ENCLOSURE_BOX.min[1]).toBe(0);
    expect(ENCLOSURE_BOX.max[0]).toBeGreaterThan(ENCLOSURE_BOX.min[0]);
    expect(ENCLOSURE_BOX.max[1]).toBeGreaterThan(ENCLOSURE_BOX.min[1]);
    expect(ENCLOSURE_BOX.max[2]).toBeGreaterThan(ENCLOSURE_BOX.min[2]);
  });

  it('places each wall on its own plane of the box', () => {
    const e = createEnclosure();
    const xs = e.group.children.map((c) => +c.position.x.toFixed(4));
    expect(xs).toContain(+ENCLOSURE_BOX.min[0].toFixed(4));
    expect(xs).toContain(+ENCLOSURE_BOX.max[0].toFixed(4));
  });

  it('defaults to the classic Cornell colours — red left, green right', () => {
    expect(DEFAULT_WALLS.negX[0]).toBeGreaterThan(DEFAULT_WALLS.negX[1]);
    expect(DEFAULT_WALLS.posX[1]).toBeGreaterThan(DEFAULT_WALLS.posX[0]);
  });

  it('recolours a wall live, on both the mesh and the returned state', () => {
    const e = createEnclosure();
    e.setWall('negZ', [0.1, 0.2, 0.3]);
    expect(e.walls.negZ).toEqual([0.1, 0.2, 0.3]);
  });

  it('hides only the ceiling when the ceiling is toggled off', () => {
    const e = createEnclosure();
    e.setCeiling(false);
    expect(e.group.children.filter((c) => c.visible)).toHaveLength(5);
    e.setCeiling(true);
    expect(e.group.children.filter((c) => c.visible)).toHaveLength(6);
  });
});
