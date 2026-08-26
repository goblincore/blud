// src/lab/sdf-zombie/webgpu/gallery-lighting.test.ts
//
// Gates for the white-wall gallery pivot: the paint data itself, and the
// rule that makes the feature real — the bounce albedos handed to
// ambientAt must be EFFECTIVE LIT colours (paint x nearby accents), not raw
// paint, so the SDF characters see the same coloured light the walls do.
//
// Fixture note (degenerate-fixture house rule): the tint tests compare two
// DIFFERENT sample points at different distances from the accent — the near
// wall must shift MORE than the far one, in the accent's hue direction.
// A single point on an axis-aligned wall cannot fail for the right reason.
import { describe, expect, it } from 'vitest';
import {
  ROOMS, TUNNELS, enclosureOf, litWallAlbedo, ACCENT_ALBEDO_REF_DIST,
  type AccentLight,
} from './game-level';

describe('gallery paint', () => {
  it('walls are near-white; floors stay a step darker; ceilings brightest', () => {
    for (const r of ROOMS) {
      for (const ch of r.wallColor) expect(ch).toBeGreaterThanOrEqual(0.8);
      const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
      // The horizon: floor must NOT read as another white wall.
      expect(lum(r.floorColor)).toBeLessThan(lum(r.wallColor) - 0.3);
      expect(lum(r.ceilColor)).toBeGreaterThan(lum(r.wallColor));
    }
  });
});

describe('litWallAlbedo', () => {
  const RED: AccentLight = { pos: [0, 2.5, 0], color: [1, 0.1, 0.06], power: 14 };
  const WHITE: [number, number, number] = [0.88, 0.87, 0.85];

  it('a wall NEAR the accent shifts toward its hue more than a far wall', () => {
    // Two wall samples at different distances from the same red accent.
    const near = litWallAlbedo(WHITE, [1.0, 1.5, 0], [RED]);
    const far = litWallAlbedo(WHITE, [5.0, 1.5, 4.0], [RED]);
    const redness = (c: readonly number[]) => c[0]! - (c[1]! + c[2]!) / 2;
    // Near wall: clearly redder than bare paint...
    expect(redness(near)).toBeGreaterThan(redness(WHITE) + 0.08);
    // ...and strictly more than the far wall, which stays close to paint.
    expect(redness(near)).toBeGreaterThan(redness(far));
    expect(redness(far) - redness(WHITE)).toBeLessThan(redness(near) - redness(WHITE));
  });

  it('no accents = exactly the paint (tunnels must not drift)', () => {
    expect(litWallAlbedo(WHITE, [1, 1.5, 0], [])).toEqual(WHITE);
  });

  it('falloff halves at ACCENT_ALBEDO_REF_DIST', () => {
    const out = (d: number) => litWallAlbedo([1, 1, 1], [d, 2.5, 0], [RED])[0]!;
    const atRef = out(ACCENT_ALBEDO_REF_DIST);
    const nearHalf = out(ACCENT_ALBEDO_REF_DIST / Math.SQRT2); // t=0.707 -> f=2/3
    expect(atRef).toBeCloseTo(1.5, 5);                          // f=0.5
    expect(nearHalf).toBeCloseTo(1 + 2 / 3, 5);
  });
});

describe('enclosureOf carries the accents to the bounce', () => {
  it('room walls nearest an accent are tinted relative to the opposite wall', () => {
    for (const r of ROOMS) {
      const e = enclosureOf(r.name)!;
      for (const a of r.accents) {
        // Which x-side wall is nearer this accent?
        const nearKey = Math.abs(a.pos[0] - e.box.min[0]) < Math.abs(a.pos[0] - e.box.max[0])
          ? 'negX' as const : 'posX' as const;
        const farKey = nearKey === 'negX' ? 'posX' as const : 'negX' as const;
        const nearW = e.walls[nearKey];
        const farW = e.walls[farKey];
        // Project the albedo shift (effective - paint) onto THIS accent's
        // hue axis. A second accent may legitimately tint the 'far' wall
        // its own hue — that projects NEGATIVE here, which is the point.
        const meanC = (a.color[0] + a.color[1] + a.color[2]) / 3;
        const dir = [a.color[0] - meanC, a.color[1] - meanC, a.color[2] - meanC];
        const proj = (c: readonly number[]) =>
          (c[0]! - r.wallColor[0]) * dir[0]!
          + (c[1]! - r.wallColor[1]) * dir[1]!
          + (c[2]! - r.wallColor[2]) * dir[2]!;
        expect(proj(nearW)).toBeGreaterThan(0);
        expect(proj(nearW)).toBeGreaterThan(proj(farW));
      }
    }
  });

  it('tunnel enclosures are bare paint (no phantom bounce sources)', () => {
    for (const t of TUNNELS) {
      const e = enclosureOf(t.name)!;
      for (const w of [e.walls.negX, e.walls.posX, e.walls.negY, e.walls.posY, e.walls.negZ, e.walls.posZ]) {
        expect(w).toEqual(t.color);
      }
    }
  });

  it('every room still yields an enclosure with a valid box', () => {
    for (const r of ROOMS) {
      const e = enclosureOf(r.name)!;
      expect(e.box.max[1]).toBeCloseTo(r.height);
    }
  });
});
