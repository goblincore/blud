import { describe, it, expect } from 'vitest';
import type { Box, EnclosureWalls, Vec3 } from './ambient';
import {
  BOUNCE_PI_LITERAL,
  bounceSpotIrradiance,
  computeBounceSpot,
  type BeamParams,
} from './flashlight-bounce';

/** A 6 m room centred on the origin. */
const BOX: Box = { min: [-3, -3, -3], max: [3, 3, 3] };

/** Red -Z wall so the albedo of the hit is legible; everything else grey. */
const WALLS: EnclosureWalls = {
  negX: [0.2, 0.2, 0.2],
  posX: [0.2, 0.2, 0.2],
  negY: [0.1, 0.1, 0.1],
  posY: [0.1, 0.1, 0.1],
  negZ: [0.9, 0.2, 0.2],
  posZ: [0.2, 0.2, 0.2],
};

const DEG15 = Math.cos((15 * Math.PI) / 180);
const DEG30 = Math.cos((30 * Math.PI) / 180);

/** A straight-down-the--Z beam from the room centre, with overrides. */
function beam(overrides: Partial<BeamParams> = {}): BeamParams {
  return {
    pos: [0, 0, 0],
    axis: [0, 0, -1],
    intensity: 1,
    cosInner: DEG15,
    cosOuter: DEG30,
    range: 10,
    keyGain: 1,
    color: [1, 1, 1],
    ...overrides,
  };
}

describe('computeBounceSpot — finding the patch', () => {
  it('casts the beam axis and lands on the -Z wall at its centre, normal (0,0,1)', () => {
    const spot = computeBounceSpot(beam(), BOX, WALLS, []);
    expect(spot).not.toBeNull();
    expect(spot!.pos[0]).toBeCloseTo(0, 12);
    expect(spot!.pos[1]).toBeCloseTo(0, 12);
    expect(spot!.pos[2]).toBeCloseTo(-3, 12);
    expect(spot!.normal[0]).toBeCloseTo(0, 12);
    expect(spot!.normal[1]).toBeCloseTo(0, 12);
    expect(spot!.normal[2]).toBeCloseTo(1, 12);
  });

  it('sets the patch radius to dist*tan(acos(cosOuter))', () => {
    const spot = computeBounceSpot(beam(), BOX, WALLS, []);
    const expected = 3 * Math.tan(Math.acos(DEG30));
    expect(spot!.radius).toBeCloseTo(expected, 12);
  });

  it('clamps the patch radius into [0.1, 3.0]', () => {
    // A needle-thin cone undershoots the floor...
    const thin = computeBounceSpot(beam({ cosOuter: 0.9999999 }), BOX, WALLS, []);
    expect(thin!.radius).toBe(0.1);
    // ...and a near-hemisphere cone overshoots the ceiling.
    const wide = computeBounceSpot(beam({ cosOuter: 0.01 }), BOX, WALLS, []);
    expect(wide!.radius).toBe(3.0);
  });

  it('hits a crate in the way first, using the occluder albedo', () => {
    // Crate's +Z face sits at z = -1, a metre in front of the beam.
    const crate: Box = { min: [-1, -1, -2], max: [1, 1, -1] };
    const spot = computeBounceSpot(beam(), BOX, WALLS, [crate]);
    expect(spot).not.toBeNull();
    expect(spot!.pos[2]).toBeCloseTo(-1, 12);
    // The entry normal points back toward the beam origin (+Z).
    expect(spot!.normal).toEqual([0, 0, 1]);

    // E = distFall^2 * intensity * keyGain * color * NdotL, dist = 1, range = 10.
    const e = (1 - 1 / 10) ** 2;
    const occluder: Vec3 = [0.35, 0.33, 0.3];
    for (let c = 0; c < 3; c++) {
      expect(spot!.radiance[c]).toBeCloseTo((occluder[c]! * e) / Math.PI, 12);
    }
  });

  it('uses the hit wall albedo for a wall patch', () => {
    const spot = computeBounceSpot(beam(), BOX, WALLS, []);
    const e = (1 - 3 / 10) ** 2; // dist 3, range 10
    for (let c = 0; c < 3; c++) {
      expect(spot!.radiance[c]).toBeCloseTo((WALLS.negZ[c]! * e) / Math.PI, 12);
    }
  });

  it('scales radiance linearly with intensity and keyGain', () => {
    const base = computeBounceSpot(beam(), BOX, WALLS, [])!;
    const brighter = computeBounceSpot(beam({ intensity: 2.5 }), BOX, WALLS, [])!;
    const gain = computeBounceSpot(beam({ keyGain: 3 }), BOX, WALLS, [])!;
    for (let c = 0; c < 3; c++) {
      expect(brighter.radiance[c]).toBeCloseTo(base.radiance[c]! * 2.5, 12);
      expect(gain.radiance[c]).toBeCloseTo(base.radiance[c]! * 3, 12);
    }
  });

  it('goes to zero at range, and returns null there and beyond', () => {
    const justInside = computeBounceSpot(beam({ range: 3.001 }), BOX, WALLS, []);
    expect(justInside).not.toBeNull();
    for (let c = 0; c < 3; c++) {
      expect(justInside!.radiance[c]!).toBeGreaterThan(0);
      expect(justInside!.radiance[c]!).toBeLessThan(1e-5);
    }
    expect(computeBounceSpot(beam({ range: 3 }), BOX, WALLS, [])).toBeNull();
    expect(computeBounceSpot(beam({ range: 2.9 }), BOX, WALLS, [])).toBeNull();
  });

  it('gives ~zero radiance when the beam grazes a wall (cos ~0)', () => {
    // Origin skims just off the -Z wall, axis almost parallel to it, so the
    // exit face is met at a glancing angle: NdotL ~ 1e-3.
    const grazing = computeBounceSpot(
      beam({ pos: [0, 0, -2.999], axis: [1, 0, -0.001] }),
      BOX,
      WALLS,
      [],
    );
    const headOn = computeBounceSpot(beam(), BOX, WALLS, [])!;
    expect(grazing).not.toBeNull();
    for (let c = 0; c < 3; c++) {
      expect(grazing!.radiance[c]!).toBeGreaterThanOrEqual(0);
      expect(grazing!.radiance[c]!).toBeLessThan(headOn.radiance[c]! * 0.01);
    }
  });

  it('returns null for a non-positive intensity', () => {
    expect(computeBounceSpot(beam({ intensity: 0 }), BOX, WALLS, [])).toBeNull();
    expect(computeBounceSpot(beam({ intensity: -1 }), BOX, WALLS, [])).toBeNull();
  });

  it('returns null when the beam origin is outside the enclosure', () => {
    expect(computeBounceSpot(beam({ pos: [10, 0, 0] }), BOX, WALLS, [])).toBeNull();
    expect(computeBounceSpot(beam({ pos: [0, 0, 3.5] }), BOX, WALLS, [])).toBeNull();
  });

  it('ignores an occluder the beam never reaches', () => {
    const behind: Box = { min: [-1, -1, 4], max: [1, 1, 5] };
    const spot = computeBounceSpot(beam(), BOX, WALLS, [behind])!;
    expect(spot.pos[2]).toBeCloseTo(-3, 12);
  });
});

describe('bounceSpotIrradiance — the analytic disc', () => {
  const spot = {
    pos: [0, 0, 0] as Vec3,
    normal: [0, 0, 1] as Vec3,
    radiance: [0.3, 0.6, 0.9] as Vec3,
    radius: 0.5,
  };

  it('evaluates L * pi * r^2 / (d^2 + r^2) per channel directly in front', () => {
    const d = 2;
    const e = bounceSpotIrradiance([0, 0, d], [0, 0, -1], spot);
    for (let c = 0; c < 3; c++) {
      const expected = (spot.radiance[c]! * Math.PI * spot.radius ** 2) / (d ** 2 + spot.radius ** 2);
      expect(Math.abs(e[c]! - expected)).toBeLessThanOrEqual(1e-9);
    }
  });

  it('is zero behind the disc', () => {
    const e = bounceSpotIrradiance([0, 0, -2], [0, 0, -1], spot);
    expect(e).toEqual([0, 0, 0]);
  });

  it('is zero for a surface facing away', () => {
    const e = bounceSpotIrradiance([0, 0, 2], [0, 0, 1], spot);
    expect(e).toEqual([0, 0, 0]);
  });

  it('is finite and non-negative at the disc centre (p == spot.pos)', () => {
    const e = bounceSpotIrradiance([0, 0, 0], [0, 0, 1], spot);
    for (let c = 0; c < 3; c++) {
      expect(Number.isFinite(e[c]!)).toBe(true);
      expect(e[c]!).toBeGreaterThanOrEqual(0);
    }
  });

  it('falls monotonically with distance in front of the disc', () => {
    const ds = [0.5, 1, 2, 4, 8];
    let prev = Infinity;
    for (const d of ds) {
      const e = bounceSpotIrradiance([0, 0, d], [0, 0, -1], spot);
      expect(e[1]!).toBeLessThan(prev);
      prev = e[1]!;
    }
  });
});

describe('BOUNCE_PI_LITERAL', () => {
  it('is the exact pi literal the WGSL twin pins', () => {
    expect(BOUNCE_PI_LITERAL).toBe(3.141592653589793);
    expect(`${BOUNCE_PI_LITERAL}`).toBe('3.141592653589793');
  });
});
