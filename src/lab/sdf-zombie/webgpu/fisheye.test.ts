// src/lab/sdf-zombie/webgpu/fisheye.test.ts
//
// The lens is pure maths, so it is tested as pure maths. Every property here
// is one the shader and the reticle both depend on: if the corner stops
// pinning, black creeps into the frame; if the inverse stops round-tripping,
// the crosshair stops sitting on what the shot hits.

import { describe, it, expect } from 'vitest';
import {
  FISHEYE_DEFAULTS, FISHEYE_WGSL, makeLens, cornerRadius, sampleRadius,
  screenRadius, reticleNdc, visibleFovDeg, warpUv, clampFovDeg,
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
    expect(visibleFovDeg(DEF)).toBeCloseTo(68.3, 1);
    expect(visibleFovDeg(makeLens(90, 90, ASPECT))).toBeCloseTo(90, 9);
  });

  it('reads its render FOV off the lens, not a caller-supplied echo', () => {
    // makeLens stores what it actually used (post-clamp), so visibleFovDeg
    // cannot be handed a stale or mismatched FOV by a forgetful caller.
    const clamped = makeLens(400, 60, ASPECT);
    expect(clamped.renderFovDeg).toBe(179);
    const lens90 = makeLens(90, 60, ASPECT);
    expect(lens90.renderFovDeg).toBe(90);
  });

  it('ships the owner-approved defaults', () => {
    expect(FISHEYE_DEFAULTS.renderFovDeg).toBe(90);
    expect(FISHEYE_DEFAULTS.centerFovDeg).toBe(60);
  });

  it('makeLens lands on exactly what clampFovDeg would, for any raw input', () => {
    // The real guarantee this pins: a caller that pre-clamps a FOV with
    // clampFovDeg (game-main.ts's seams do) can never end up with a camera
    // and a lens that disagree about the render FOV, because makeLens's own
    // internal clamp lands on the exact same number for the RAW, un-clamped
    // input. Calling makeLens directly with the raw value (not pre-clamped)
    // is what makes this exercise makeLens's own clamp rather than being a
    // no-op identity check — feeding it an already-clamped value would pass
    // even with no internal clamp at all.
    for (const deg of [500, -5, 0, 179, 1, 90, 180, 1e6]) {
      expect(makeLens(deg, 60, ASPECT).renderFovDeg).toBe(clampFovDeg(deg));
    }
  });
});

describe('warpUv, the executable mirror of FISHEYE_WGSL', () => {
  const L = DEF;

  it('leaves the centre at the centre', () => {
    expect(warpUv({ x: 0.5, y: 0.5 }, L)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('pins all four corners', () => {
    for (const st of [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 },
    ]) {
      const w = warpUv(st, L);
      expect(w.x).toBeCloseTo(st.x, 9);
      expect(w.y).toBeCloseTo(st.y, 9);
    }
  });

  it('stays within [0, 1] on both axes, across a grid, at a non-square aspect', () => {
    for (let i = 0; i <= 20; i++) {
      for (let j = 0; j <= 20; j++) {
        const w = warpUv({ x: i / 20, y: j / 20 }, L);
        expect(w.x).toBeGreaterThanOrEqual(0);
        expect(w.x).toBeLessThanOrEqual(1);
        expect(w.y).toBeGreaterThanOrEqual(0);
        expect(w.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is circular on screen, not elliptical, at aspect != 1', () => {
    // Two UV points equidistant from centre in half-height-radius terms, one
    // horizontal and one vertical, must warp by the same radial factor.
    const dx = 0.2 / L.aspect; // same half-height radius as dy below
    const dy = 0.2;
    const wx = warpUv({ x: 0.5 + dx, y: 0.5 }, L);
    const wy = warpUv({ x: 0.5, y: 0.5 + dy }, L);
    const outDx = (wx.x - 0.5) * L.aspect;
    const outDy = wy.y - 0.5;
    expect(outDx).toBeCloseTo(outDy, 9);
  });

  it('agrees with sampleRadius: warp a UV point, convert to half-height radius, compare', () => {
    for (let i = 0; i <= 20; i++) {
      for (let j = 0; j <= 20; j++) {
        const st = { x: i / 20, y: j / 20 };
        const qx = (st.x - 0.5) * 2 * L.aspect;
        const qy = (st.y - 0.5) * 2;
        const r = Math.hypot(qx, qy);
        if (r < 1e-6) continue;
        const w = warpUv(st, L);
        const wx = (w.x - 0.5) * 2 * L.aspect;
        const wy = (w.y - 0.5) * 2;
        const s = Math.hypot(wx, wy);
        expect(s).toBeCloseTo(sampleRadius(r, L), 9);
      }
    }
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

  // The UV<->half-height conversion is the half of the shader with no JS
  // mirror at all -- sampleRadius works in radii and never touches UV, and
  // warpUv is a hand-written COPY of these two lines, so it cannot notice if
  // they change. Drop the `aspect` from the first or the `2.0 *` from the
  // second and the frame warps elliptically or off-centre while every other
  // test in this file still passes. These two assertions are the only thing
  // standing between that and a green suite.
  it('the WGSL frames UV in half-height units, and un-frames it the same way', () => {
    expect(FISHEYE_WGSL).toContain(
      'let q = (st - vec2<f32>(0.5, 0.5)) * vec2<f32>(2.0 * aspect, 2.0);',
    );
    expect(FISHEYE_WGSL).toContain(
      'return vec2<f32>(w.x / (2.0 * aspect), w.y * 0.5) + vec2<f32>(0.5, 0.5);',
    );
  });

  it('is exactly one helper fn, for appending to the blit', () => {
    expect(FISHEYE_WGSL.startsWith('fn fisheyeWarp(')).toBe(true);
    expect(FISHEYE_WGSL.match(/\bfn\s+\w+\s*\(/g)).toHaveLength(1);
  });
});
