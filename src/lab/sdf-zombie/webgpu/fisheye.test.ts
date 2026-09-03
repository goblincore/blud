// src/lab/sdf-zombie/webgpu/fisheye.test.ts
//
// The lens is pure maths, so it is tested as pure maths. Every property here
// is one the shader and the reticle both depend on: if the corner stops
// pinning, black creeps into the frame; if the inverse stops round-tripping,
// the crosshair stops sitting on what the shot hits.

import { describe, it, expect } from 'vitest';
import {
  FISHEYE_DEFAULTS, FISHEYE_WGSL, makeLens, cornerRadius, sampleRadius,
  screenRadius, reticleNdc, visibleFovDeg,
} from './fisheye';

const ASPECT = 16 / 9;
const DEF = makeLens(
  FISHEYE_DEFAULTS.renderFovDeg, FISHEYE_DEFAULTS.centerFovDeg, ASPECT,
);

describe('fisheye lens geometry', () => {
  it('the corner radius is the diagonal in half-height units', () => {
    expect(cornerRadius(ASPECT)).toBeCloseTo(Math.hypot(ASPECT, 1), 12);
    expect(cornerRadius(1)).toBeCloseTo(Math.SQRT2, 12);
  });

  it('pins the corner to the corner at every aspect', () => {
    for (const aspect of [1, 4 / 3, 16 / 9, 21 / 9, 0.75]) {
      const lens = makeLens(90, 60, aspect);
      expect(sampleRadius(lens.rmax, lens)).toBeCloseTo(lens.rmax, 10);
    }
  });

  it('leaves the centre at the centre', () => {
    expect(sampleRadius(0, DEF)).toBe(0);
  });

  it('never samples outside the source (no black corners, by construction)', () => {
    for (let i = 0; i <= 200; i++) {
      const r = (DEF.rmax * i) / 200;
      expect(sampleRadius(r, DEF)).toBeLessThanOrEqual(r + 1e-12);
    }
  });

  it('is monotonic in r', () => {
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const s = sampleRadius((DEF.rmax * i) / 200, DEF);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
  });

  it('magnifies the centre by exactly the FOV ratio', () => {
    // sampleRadius'(0) = tan(centre/2) / tan(render/2): the knob is honest.
    const want = Math.tan((60 * Math.PI) / 360) / Math.tan((90 * Math.PI) / 360);
    const h = 1e-5;
    expect(sampleRadius(h, DEF) / h).toBeCloseTo(want, 8);
  });

  it('is an exact identity when the centre FOV is not narrower', () => {
    for (const [rf, cf] of [[90, 90], [60, 75], [75, 75]] as const) {
      const lens = makeLens(rf, cf, ASPECT);
      expect(lens.k).toBe(0);
      expect(sampleRadius(0.731, lens)).toBe(0.731);
      expect(screenRadius(0.731, lens)).toBe(0.731);
      expect(reticleNdc({ x: 0.4, y: -0.7 }, lens)).toEqual({ x: 0.4, y: -0.7 });
    }
  });
});

describe('fisheye inverse', () => {
  it('round-trips the forward map across the whole radius range', () => {
    for (let i = 0; i <= 200; i++) {
      const r = (DEF.rmax * i) / 200;
      expect(screenRadius(sampleRadius(r, DEF), DEF)).toBeCloseTo(r, 9);
    }
  });

  it('pushes an off-centre reticle outward, and pins the corner', () => {
    const mid = reticleNdc({ x: 0.5, y: 0 }, DEF);
    expect(mid.x).toBeGreaterThan(0.5);
    expect(mid.y).toBe(0);
    // The screen corner is the fixed point of the map in both directions.
    const corner = reticleNdc({ x: 1, y: 1 }, DEF);
    expect(corner.x).toBeCloseTo(1, 9);
    expect(corner.y).toBeCloseTo(1, 9);
  });

  it('leaves dead centre alone', () => {
    expect(reticleNdc({ x: 0, y: 0 }, DEF)).toEqual({ x: 0, y: 0 });
  });
});

describe('fisheye reporting', () => {
  it('reports the vertical FOV actually visible, not the one rendered', () => {
    // Mid-edges are cropped by the warp: 90 rendered reads as ~68.3 on screen.
    expect(visibleFovDeg(90, DEF)).toBeCloseTo(68.3, 1);
    expect(visibleFovDeg(90, makeLens(90, 90, ASPECT))).toBeCloseTo(90, 9);
  });

  it('ships the owner-approved defaults', () => {
    expect(FISHEYE_DEFAULTS.renderFovDeg).toBe(90);
    expect(FISHEYE_DEFAULTS.centerFovDeg).toBe(60);
  });
});

describe('fisheye shader/JS agreement', () => {
  // JS and WGSL cannot literally share an expression, so this is a tripwire
  // instead: edit one side of the map and this fails until the other side
  // matches. A silent divergence here puts the crosshair off the shot.
  it('the WGSL scale mirrors sampleRadius', () => {
    expect(FISHEYE_WGSL).toContain(
      'let scale = (1.0 + k * r * r) / (1.0 + k * rmax * rmax);',
    );
  });

  it('the WGSL takes the same off switch', () => {
    expect(FISHEYE_WGSL).toContain('if (k <= 0.0) { return st; }');
  });

  it('is exactly one helper fn, for appending to the blit', () => {
    expect(FISHEYE_WGSL.trim().startsWith('fn fisheyeWarp(')).toBe(true);
    expect(FISHEYE_WGSL.match(/\bfn\s+\w+\s*\(/g)).toHaveLength(1);
  });
});
