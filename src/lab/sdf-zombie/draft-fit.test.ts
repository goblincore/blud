// src/lab/sdf-zombie/draft-fit.test.ts
import { describe, it, expect } from 'vitest';
import type { Vec3 } from './types';
import { basisFromAxis, dot, len, normalize, scale as vscale, sub } from './vec';
import { medialLine } from './draft-fit';

// All clouds below are deterministic lattices — no RNG — so a failure is
// reproducible by construction rather than by seed. Surface sampling (fixed
// radius) also gives a straight tube an EXACT expected residual of R, which
// pins medialLine's residual as the RMS of perpendicular distance.

/**
 * Surface points of a straight tube: stations along the axis (endpoints
 * INCLUDED, so the lattice's extremes sit exactly at ±L/2) × evenly spaced
 * angles. Symmetric stations plus a full angle sweep put the centroid exactly
 * on the axis midpoint, so expected t0/t1 are exact, not statistical.
 */
function tubeCloud(axis: Vec3, L: number, R: number, offset: Vec3 = [0, 0, 0]): Vec3[] {
  const nT = 25, nTheta = 12;
  const { u, v, w } = basisFromAxis(axis);
  const pts: Vec3[] = [];
  for (let i = 0; i < nT; i++) {
    const t = -L / 2 + (L * i) / (nT - 1);
    for (let j = 0; j < nTheta; j++) {
      const th = (2 * Math.PI * j) / nTheta;
      const ru = R * Math.cos(th), rv = R * Math.sin(th);
      pts.push([
        offset[0] + t * w[0] + ru * u[0] + rv * v[0],
        offset[1] + t * w[1] + ru * u[1] + rv * v[1],
        offset[2] + t * w[2] + ru * u[2] + rv * v[2],
      ]);
    }
  }
  return pts;
}

/** A banana: a tube bent along a circular arc of radius `Rc`, sweeping ±`Phi`
 *  radians (arc length 2·Rc·Phi), thickness `r`. Bending plane is x-y, arc
 *  centre at the origin. A straight line cannot fit this cloud — the residual
 *  about the best line is dominated by the sagitta Rc·(1-cos Phi). */
function bananaCloud(Rc: number, Phi: number, r: number): Vec3[] {
  const nT = 31, nTheta = 12;
  const pts: Vec3[] = [];
  for (let i = 0; i < nT; i++) {
    const phi = -Phi + (2 * Phi * i) / (nT - 1);
    const cx = Rc * Math.sin(phi), cy = Rc * Math.cos(phi);
    const nx = Math.sin(phi), ny = Math.cos(phi); // in-plane normal at phi
    for (let j = 0; j < nTheta; j++) {
      const th = (2 * Math.PI * j) / nTheta;
      const rad = r * Math.cos(th), ax = r * Math.sin(th);
      pts.push([cx + rad * nx, cy + rad * ny, ax]);
    }
  }
  return pts;
}

/** Angle between two LINES — the medial axis is a line, its sign is not
 *  meaningful, so the dot is taken absolute before the arccos. */
function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.min(1, Math.abs(dot(normalize(a), normalize(b)))));
}

describe('medialLine', () => {
  it('recovers the axis of a synthetic cylinder', () => {
    // Direction deliberately off every world axis: an axis solver that only
    // looks right on x/y/z-aligned fixtures must fail here.
    const D = normalize([1, 2, 3]);
    const L = 1.0, R = 0.1;
    const fit = medialLine(tubeCloud(D, L, R));

    expect(angleBetween(fit.dir, D)).toBeLessThan(Math.PI / 180);
    expect(Math.abs(len(fit.dir) - 1)).toBeLessThan(1e-9);
    // Stations include the endpoints, so the extent IS the tube length.
    expect(fit.t0).toBeCloseTo(-L / 2, 3);
    expect(fit.t1).toBeCloseTo(L / 2, 3);
    // Every surface point sits at perpendicular distance R from the true
    // axis, so the RMS residual is R — this pins RMS, not max or mean-of-|d|.
    expect(fit.residual).toBeCloseTo(R, 2);
  });

  it('is NOT the joint-to-joint line when the cloud is offset from it', () => {
    // The trap, as a test. Rig joints sit 9-13 cm off the skin, so the real
    // cloud never straddles the joint line. Build a tube whose whole cloud is
    // displaced 0.10 perpendicular from a "joint" line through the world
    // origin along the same direction: the fit must follow the CLOUD —
    // origin on the cloud's centroid, 0.10 away from the joint line — and
    // still recover the cloud's own axis.
    const D = normalize([2, 1, -1]);
    // cross(D, s) is perpendicular to D by construction; magnitude exactly 0.10.
    const s: Vec3 = [0.31, 0.17, 0.91];
    const perp = normalize([
      D[1] * s[2] - D[2] * s[1],
      D[2] * s[0] - D[0] * s[2],
      D[0] * s[1] - D[1] * s[0],
    ]);
    const offset: Vec3 = vscale(perp, 0.1);

    const L = 1.0, R = 0.08;
    const fit = medialLine(tubeCloud(D, L, R, offset));

    for (let k = 0; k < 3; k++) expect(fit.origin[k]).toBeCloseTo(offset[k]!, 3);
    // Distance from the fitted line's origin to the JOINT line (through the
    // world origin, along D) is the full 0.10 — the fit did not snap back.
    const onJoint = vscale(D, dot(fit.origin, D));
    expect(len(sub(fit.origin, onJoint))).toBeCloseTo(0.1, 3);
    expect(angleBetween(fit.dir, D)).toBeLessThan(Math.PI / 180);
    // Extent is measured along the CLOUD's own axis, unaffected by the offset.
    expect(fit.t1 - fit.t0).toBeCloseTo(L, 3);
  });

  it('reports a large residual for a curved cloud', () => {
    // A banana-shaped cloud: a straight line cannot fit it, and this residual
    // is how the draft tells an author that bone wants a `bend=` it cannot
    // emit. Same thickness as the straight control (so the floor residual R is
    // identical) but bent enough that the sagitta dwarfs it — measured on this
    // lattice the ratio is ~4.8x, comfortably clear of the 3x bar below.
    const r = 0.05;
    const straight = medialLine(tubeCloud(normalize([1, 2, 3]), 2.0, r));
    const banana = medialLine(bananaCloud(1.0, 1.3, r));
    expect(straight.residual).toBeCloseTo(r, 2);
    expect(banana.residual).toBeGreaterThan(3 * straight.residual);
  });
});
