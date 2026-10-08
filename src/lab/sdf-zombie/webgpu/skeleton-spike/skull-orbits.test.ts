// src/lab/sdf-zombie/webgpu/skeleton-spike/skull-orbits.test.ts
//
// The orbit rule on plates whose answer is known by construction, then on the real anatomical skull
// (anatomical-skull.fixture.ts): where its two orbits are, pinned.
import { describe, it, expect } from 'vitest';
import {
  FRONT_CELLS, ORBIT_EYE_HOLD, ORBIT_EYE_RECESS, frontDepth, orbitEyePlacements, orbitEyeSeat, seenDisc, skullOrbits,
  type SkullSurface,
} from './skull-orbits';
import { anatomicalSkullSource } from './anatomical-skull.fixture';

/** A plate seen from the front, z = h(x, y), as triangles on a `step` grid. */
function plate(h: (x: number, y: number) => number, x0: number, x1: number, y0: number, y1: number, step = 0.0005): SkullSurface {
  const nx = Math.round((x1 - x0) / step) + 1, ny = Math.round((y1 - y0) / step) + 1;
  const positions: number[] = [], indices: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const x = x0 + i * step, y = y0 + j * step; positions.push(x, y, h(x, y)); }
  for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    indices.push(a, b, d, a, d, c);
  }
  return { positions, indices };
}
const quad = (x0: number, y0: number, x1: number, y1: number, z: number): SkullSurface =>
  ({ positions: [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z], indices: [0, 1, 2, 0, 2, 3] });

// A plate that leans (its front rises with x), with two round pits, a smaller third, and a trench wider than the
// first pit that runs out of the plate's lower edge.
const LEAN = 0.3, FACE = (x: number) => 0.05 + LEAN * x;
const PIT_A = { x: -0.030, y: 0.004, r: 0.012 }, PIT_B = { x: 0.034, y: -0.002, r: 0.015 }, PIT_C = { x: 0, y: 0.022, r: 0.005 };
const inPit = (p: { x: number; y: number; r: number }, x: number, y: number) => Math.hypot(x - p.x, y - p.y) < p.r;
const pitted = (x: number, y: number) => {
  const dug = inPit(PIT_A, x, y) || inPit(PIT_B, x, y) || inPit(PIT_C, x, y) || (Math.abs(x) < 0.012 && y < -0.010);
  return FACE(x) - (dug ? 0.02 : 0);
};
const PLATE = plate(pitted, -0.06, 0.06, -0.035, 0.035);

describe('frontDepth: what a ray straight in from the front meets first', () => {
  it('keeps the front-most surface per cell, and nothing where there is none', () => {
    const d = frontDepth([quad(0, 0, 0.01, 0.01, 0.01), quad(0.002, 0.002, 0.006, 0.006, 0.02)], 0.001);
    const at = (x: number, y: number) => d.z[Math.floor((y - d.y0) / d.cell) * d.nx + Math.floor((x - d.x0) / d.cell)]!;
    expect(at(0.0045, 0.0045)).toBeCloseTo(0.02, 6);
    expect(at(0.0085, 0.0045)).toBeCloseTo(0.01, 6);
    // One empty cell all round the surfaces: the outside the basins are closed against.
    expect(d.x0).toBeCloseTo(-0.001, 9);
    expect(d.nx).toBe(12);
    expect(at(-0.0005, 0.0045)).toBe(-Infinity);
    expect(at(0.0105, 0.0105)).toBe(-Infinity);
  });

  it('given no cell, tiles the surfaces\' bounds with FRONT_CELLS square cells', () => {
    const d = frontDepth([quad(0, 0, 0.03, 0.12, 0)]);
    expect(d.cell).toBeCloseTo(Math.sqrt(0.03 * 0.12 / FRONT_CELLS), 12);
    expect((d.nx - 2) * (d.ny - 2)).toBeGreaterThanOrEqual(FRONT_CELLS);
    expect((d.nx - 2) * (d.ny - 2)).toBeLessThan(FRONT_CELLS * 1.02);
    expect(frontDepth([]).nx).toBe(0);
  });
});

describe('skullOrbits: the two largest closed basins of the front view', () => {
  const depth = frontDepth([PLATE], 0.001);
  const orbits = skullOrbits(depth);

  it('finds the two pits, the -x one first, and neither the small pit nor the open trench', () => {
    expect(orbits).toHaveLength(2);
    for (const [o, pit] of [[orbits[0]!, PIT_A], [orbits[1]!, PIT_B]] as const) {
      expect(Math.hypot(o.centre[0] - pit.x, o.centre[1] - pit.y)).toBeLessThan(0.0006);
      expect(o.radius).toBeCloseTo(pit.r, 3);
    }
  });

  it('puts each orbit\'s depth at the lowest point of its rim', () => {
    // The plate leans, so a pit's rim is lowest at its -x edge.
    for (const [o, pit] of [[orbits[0]!, PIT_A], [orbits[1]!, PIT_B]] as const)
      expect(Math.abs(o.centre[2] - FACE(pit.x - pit.r))).toBeLessThan(0.0006);
  });

  it('answers with what there is: one pit, one orbit; a flat plate, none', () => {
    const one = frontDepth([plate((x, y) => 0.05 - (inPit(PIT_B, x, y) ? 0.02 : 0), -0.06, 0.06, -0.035, 0.035, 0.001)], 0.001);
    expect(skullOrbits(one)).toHaveLength(1);
    expect(skullOrbits(frontDepth([quad(-0.05, -0.03, 0.05, 0.03, 0.05)], 0.001))).toEqual([]);
  });
});

describe('seenDisc: how much of an eye shows past the bone, and where that part lies', () => {
  // A wall at z = 0 with a round window, 3 mm off the eye's centre and wholly inside its disc.
  const windowAt = { x: 0.003, y: 0, r: 0.010 };
  const wall = frontDepth([plate((x, y) => (inPit(windowAt, x, y) ? -1 : 0), -0.03, 0.03, -0.03, 0.03)], 0.0005);

  it('an eye behind a window shows the window', () => {
    const s = seenDisc(wall, [0, 0, -0.02], 0.015);
    // The plate's window is a grid step (0.5 mm) of sloping wall wider than drawn.
    expect(s.seen).toBeGreaterThan((0.0100 / 0.015) ** 2);
    expect(s.seen).toBeLessThan((0.0105 / 0.015) ** 2);
    expect(s.offset[0]).toBeCloseTo(0.003, 4);
    expect(s.offset[1]).toBeCloseTo(0, 4);
  });

  it('an eye in front of the wall shows whole; one wholly behind it, not at all', () => {
    expect(seenDisc(wall, [0.02, 0.02, 0.02], 0.005)).toEqual({ seen: 1, offset: [expect.closeTo(0, 9), expect.closeTo(0, 9)] });
    expect(seenDisc(wall, [-0.02, 0.02, -0.02], 0.005)).toEqual({ seen: 0, offset: [0, 0] });
  });
});

describe('orbitEyeSeat: the eye whose seen part is centred on it', () => {
  it('a round straight-walled orbit seats the eye on its axis, its pole the recess behind the rim', () => {
    const depth = frontDepth([PLATE], 0.001), [a] = skullOrbits(depth), r = 0.014;
    const seat = orbitEyeSeat(depth, a!, r);
    expect(Math.hypot(seat[0] - PIT_A.x, seat[1] - PIT_A.y)).toBeLessThan(0.0006);
    expect(seat[2] + r).toBeCloseTo(a!.centre[2] - ORBIT_EYE_RECESS * r, 9);
  });

  it('a wall that leans in over one side pushes the eye off it until what shows is centred', () => {
    // A pit whose +x half has a floor rising to the rim: it hides the eye's +x side.
    const pit = { x: 0, y: 0, r: 0.016 };
    const ramp = (x: number, y: number) => (!inPit(pit, x, y) ? 0.05 : x > 0 ? 0.02 + x / pit.r * 0.03 : 0.02);
    const depth = frontDepth([plate(ramp, -0.03, 0.03, -0.03, 0.03)], 0.001), [o] = skullOrbits(depth), r = 0.016;
    const start = seenDisc(depth, [o!.centre[0], o!.centre[1], o!.centre[2] - r * (1 + ORBIT_EYE_RECESS)], r);
    expect(start.offset[0]).toBeLessThan(-0.001);
    const seat = orbitEyeSeat(depth, o!, r), end = seenDisc(depth, seat, r);
    expect(seat[0]).toBeLessThan(o!.centre[0] - 0.001);
    expect(Math.abs(seat[1] - o!.centre[1])).toBeLessThan(0.0005);
    // It rests where the opening's hold balances what is left of the offset: a small share of the way it moved.
    expect(end.offset[0]).toBeCloseTo(ORBIT_EYE_HOLD * (seat[0] - o!.centre[0]), 4);
    expect(Math.hypot(...end.offset)).toBeLessThan(0.0004);
  });
});

describe('orbitEyePlacements', () => {
  it('seats one eye of the given radius in each orbit, in the orbits\' order', () => {
    const depth = frontDepth([PLATE], 0.001), orbits = skullOrbits(depth), r = 0.006;
    const eyes = orbitEyePlacements(depth, orbits, r);
    expect(eyes.map(e => e.radius)).toEqual([r, r]);
    eyes.forEach((e, i) => expect(e.center).toEqual(orbitEyeSeat(depth, orbits[i]!, r)));
    expect(eyes[0]!.center[0]).toBeLessThan(eyes[1]!.center[0]);
  });
});

describe('the real anatomical skull\'s orbits', () => {
  const surfaces = anatomicalSkullSource().map(p => ({ positions: p.geometry.getAttribute('position').array, indices: p.geometry.getIndex()!.array }));
  const mm = (v: number) => v * 1000;

  it('are where they were measured: off-centre, the skull\'s face is not symmetric', () => {
    const [right, left] = skullOrbits(frontDepth(surfaces, 0.001));
    // Asset frame, mm: x toward the skull's own left, y up, z out of the face.
    expect([mm(right!.centre[0]), mm(right!.centre[1]), mm(right!.centre[2])].map(v => +v.toFixed(0))).toEqual([-32, 1, 56]);
    expect([mm(left!.centre[0]), mm(left!.centre[1]), mm(left!.centre[2])].map(v => +v.toFixed(0))).toEqual([25, 0, 57]);
    expect(mm(right!.radius)).toBeCloseTo(16.9, 0);
    expect(mm(left!.radius)).toBeCloseTo(17.3, 0);
  });

  it('are found on a skull however it was fitted: bent, its eyes still show centred', () => {
    // Not a scale and a shift: the face widens toward the crown and bows sideways.
    const bent = surfaces.map(s => {
      const positions = Float32Array.from(s.positions);
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i]!, y = positions[i + 1]!;
        positions[i] = x * (1 + 2 * y) + 3 * y * y;
        positions[i + 1] = 0.8 * y + 4 * x * x;
      }
      return { positions, indices: s.indices };
    });
    const depth = frontDepth(bent), orbits = skullOrbits(depth), plain = skullOrbits(frontDepth(surfaces));
    expect(orbits).toHaveLength(2);
    orbits.forEach((o, i) => {
      // The bend carries each orbit with the bone around it (to the bend's own stretch across an orbit)...
      const [x, y] = plain[i]!.centre, want = [x * (1 + 2 * y) + 3 * y * y, 0.8 * y + 4 * x * x];
      expect(Math.hypot(o.centre[0] - want[0]!, o.centre[1] - want[1]!)).toBeLessThan(0.0015);
      // ...and the eye seated there shows centred, within half a cell.
      const eye = orbitEyePlacements(depth, [o], 0.017)[0]!, s = seenDisc(depth, eye.center, eye.radius);
      expect(s.seen).toBeGreaterThan(0.3);
      expect(s.seen).toBeLessThan(0.7);
      expect(Math.hypot(...s.offset)).toBeLessThan(0.0005);
    });
  });

  it('do not depend on the cell they are measured with', () => {
    const coarse = skullOrbits(frontDepth(surfaces, 0.001)), fine = skullOrbits(frontDepth(surfaces, 0.0005));
    coarse.forEach((o, i) => {
      expect(Math.hypot(...o.centre.map((v, k) => v - fine[i]!.centre[k]!))).toBeLessThan(0.0004);
      expect(Math.abs(o.radius - fine[i]!.radius)).toBeLessThan(0.0003);
    });
  });
});
