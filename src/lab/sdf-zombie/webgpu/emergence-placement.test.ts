// src/lab/sdf-zombie/webgpu/emergence-placement.test.ts
import { describe, it, expect } from 'vitest';
import { FLAT_KOTATSU, placementFor, toWorld, fromWorld } from './emergence-placement';
import { DESK_Y, KOTATSU, TABLE_FRONT_Z } from './emergence-field';

const TABLE_CENTRE: [number, number, number] = [0, DESK_Y, TABLE_FRONT_Z - KOTATSU.d / 2];
const p = placementFor(FLAT_KOTATSU, TABLE_CENTRE, DESK_Y);

describe('emergence placement', () => {
  it('puts the table centre on the Flat kotatsu: game (0.12, board top 0.44, -2.36)', () => {
    const w = toWorld(p, TABLE_CENTRE);
    expect(w[0]).toBeCloseTo(0.12, 9);
    expect(w[1]).toBeCloseTo(0.44, 9);
    expect(w[2]).toBeCloseTo(-2.36, 9);
  });
  it('the floor he sits on is the tatami top (0.055 above the room floor): the board stands KOTATSU.top above it', () => {
    const floorW = toWorld(p, [0, DESK_Y - KOTATSU.top, 0]);
    expect(floorW[1]).toBeCloseTo(FLAT_KOTATSU.floor, 9);
  });
  it('the screen faces the room: +z in the screen frame is +z (south) in the game', () => {
    const a = toWorld(p, [0, 0, 0]), b = toWorld(p, [0, 0, 1]);
    expect(b[2] - a[2]).toBeCloseTo(1, 9);
    expect(b[0] - a[0]).toBeCloseTo(0, 9);
  });
  it('round-trips points exactly, including under a yaw', () => {
    for (const pl of [p, { ...p, yaw: 0.7 }]) for (const v of [[0, 0, 0], [0.3, -0.2, 0.5], [-1, 0.4, -0.2]] as const) {
      const b = fromWorld(pl, toWorld(pl, [...v]));
      for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo(v[i]!, 9);
    }
  });
});
