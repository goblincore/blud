import { describe, it, expect } from 'vitest';
import { reliefCells, CELL, MIN_VERTS } from './blob-relief-core';

/** `n` copies of one point, so a cell clears MIN_VERTS. */
const many = (x: number, y: number, z: number, n = MIN_VERTS) =>
  Array.from({ length: n }, () => [x, y, z] as [number, number, number]);

describe('reliefCells', () => {
  it('keeps the FRONT-most vertex in a cell, not the last or the mean', () => {
    // The whole tool is a front-wall probe: a cell holding both a chest
    // vertex and the back vertex behind it must report the chest.
    const cells = reliefCells([...many(0, 1, 0.2, 3), ...many(0, 1, -0.2, 3)], 1);
    expect(cells).toHaveLength(1);
    expect(cells[0]!.z).toBe(0.2);
    expect(cells[0]!.n).toBe(6);
  });

  it('drops thin cells, where the max-z pick is a stray', () => {
    expect(reliefCells(many(0, 1, 0.2, MIN_VERTS - 1), 1)).toHaveLength(0);
    expect(reliefCells(many(0, 1, 0.2, MIN_VERTS), 1)).toHaveLength(1);
  });

  it('scales mesh units into body metres BEFORE binning', () => {
    // Two points a whole cell apart only after scaling: at scale 1 they share
    // a bin, at scale 4 they do not. Binning before scaling would make the
    // cell size mean something different on every character.
    // CELL/4, not CELL/2: half a cell is exactly the bin BOUNDARY, and
    // Math.round(0.5) goes up, so the two would separate at scale 1 too.
    const pts = [...many(0, 0, 0.1), ...many(CELL / 4, 0, 0.1)];
    expect(reliefCells(pts, 1)).toHaveLength(1);
    expect(reliefCells(pts, 4).length).toBeGreaterThan(1);
    // A point at mesh (0.5, 0.25) under scale 2 lands at body (1.0, 0.5).
    const c = reliefCells(many(0.5, 0.25, 0.1), 2, { xLimit: 2 })[0]!;
    expect(c.x).toBeCloseTo(Math.round(1.0 / CELL) * CELL, 9);
    expect(c.y).toBeCloseTo(Math.round(0.5 / CELL) * CELL, 9);
  });

  it('excludes the arms by an x window, never by joint name', () => {
    // The vertices this tool exists to see are the ones NO single joint owns
    // (readRefSkin drops them by default; a whole band at the minotaur's
    // chest height held zero). So the arm cut has to be geometric.
    const pts = [...many(0, 1.2, 0.2), ...many(0.6, 1.2, 0.2)];
    expect(reliefCells(pts, 1).map((c) => c.x)).toEqual([0]);
    expect(reliefCells(pts, 1, { xLimit: 0.9 })).toHaveLength(2);
  });

  it('honours the height window', () => {
    const pts = [...many(0, 0.5, 0.2), ...many(0, 1.5, 0.2)];
    expect(reliefCells(pts, 1, { yMin: 1.0 }).map((c) => Math.round(c.y / CELL))).toEqual([Math.round(1.5 / CELL)]);
    expect(reliefCells(pts, 1, { yMax: 1.0 }).map((c) => Math.round(c.y / CELL))).toEqual([Math.round(0.5 / CELL)]);
  });
});
