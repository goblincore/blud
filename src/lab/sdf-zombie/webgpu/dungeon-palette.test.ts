// Fixture note: each assertion contrasts two different surfaces or two
// channels, so a uniform-grey constant cannot satisfy them all.
import { describe, expect, it } from 'vitest';
import { ROOMS, TUNNELS } from './game-level';

const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

describe('dungeon palette', () => {
  it('walls are DARK stone — the gallery white is gone', () => {
    for (const r of ROOMS) {
      expect(lum(r.wallColor), r.name).toBeLessThan(0.28);
      expect(lum(r.ceilColor), r.name).toBeLessThan(0.28);
      expect(lum(r.floorColor), r.name).toBeLessThan(lum(r.wallColor));
    }
  });

  it('stone is COLD, never sepia — red must not lead blue', () => {
    for (const r of ROOMS) {
      for (const c of [r.wallColor, r.floorColor, r.ceilColor]) {
        expect(c[0]!).toBeLessThanOrEqual(c[2]! + 0.012);
      }
    }
    for (const t of TUNNELS) expect(t.color[0]!).toBeLessThanOrEqual(t.color[2]! + 0.012);
  });

  it('tunnels are darker than the rooms they join — a throat, not a gallery', () => {
    for (const t of TUNNELS) expect(lum(t.color)).toBeLessThan(lum(ROOMS[0]!.wallColor));
  });
});
