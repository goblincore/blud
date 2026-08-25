// src/lab/sdf-zombie/shell.test.ts
//
// The shell field (`sdShellWrap`, and its WGSL twin `sdShell`) is the whole
// point of the shell primitive: a thin sheet off a closed primitive's field,
// clipped against a plane with a ROUNDED rim. These tests pin the four things
// that make the construction read as cloth rather than a cut — a point on the
// sheet is ~0, a point `thickness` away is ~thickness, the clipped side is
// outside even where the sheet is solid, and the rim is rounded rather than a
// razor edge when you sample across the sheet/plane intersection curve.
//
// The CPU mirror is exercised directly because it is the field click-to-shoot
// and the checks run on; the WGSL mirror is a string pin (see march.wgsl.test):
// both must be edited in the same commit.
import { describe, it, expect } from 'vitest';
import { sdShellWrap } from './validate';

// Clip plane: keep the half-space where p·n - o < 0, i.e. z < 0.05.
const N: readonly [number, number, number] = [0, 0, 1];
const O = 0.05;
const T = 0.01; // half-thickness
const RIM = 0.004;

describe('sdShellWrap — the thin clipped sheet', () => {
  it('a point on the sheet (abs(dBase) == thickness) is ~0, on the kept side', () => {
    // dBase == +thickness puts the sample on the sheet's OUTER face. On the
    // kept side (z=0 ⇒ dPlane = -0.05 < 0), the plane does not bind.
    const d = sdShellWrap(T, [0, 0, 0], T, N, O, RIM);
    expect(Math.abs(d)).toBeLessThan(0.001);
  });

  it('a point `thickness` beyond the sheet reads ~`thickness`', () => {
    // dBase == 2*thickness ⇒ one thickness past the outer face. Still well on
    // the kept side, so the value is pure `abs(dBase) - thick`.
    const d = sdShellWrap(2 * T, [0, 0, 0], T, N, O, RIM);
    expect(d).toBeCloseTo(T, 3);
  });

  it('the clipped side is outside even where the sheet is solid', () => {
    // dBase == 0 (on the sheet mid-surface, inside the sheet) but p.z = 0.1
    // puts it PAST the plane (dPlane = +0.05 > 0). The clip removes it.
    const d = sdShellWrap(0, [0, 0, 0.1], T, N, O, RIM);
    expect(d).toBeGreaterThanOrEqual(O); // at the plane's own distance, outside
  });

  it('the rim is rounded, not a razor — it cuts the sheet corner', () => {
    // Sample across the sheet/plane intersection curve: a point inside both the
    // sheet (dShell < 0) AND the kept half-space (dPlane < 0), but within `rim`
    // of the curve. The SHARP max keeps it material (negative); the ROUNDED rim
    // must cut that corner (positive) — that is what turns a razor edge into a
    // folded hem.
    const dShell = -0.005;          // abs(0.005) - 0.01
    const dPlane = -0.005;          // p.z = 0.045 - 0.05
    const sharp = Math.max(dShell, dPlane);
    const rounded = sdShellWrap(0.005, [0, 0, 0.045], T, N, O, 0.01);
    expect(sharp).toBeLessThan(0);          // razor: material is present
    expect(rounded).toBeGreaterThan(0);     // rounded: the corner is cut away
  });

  it('far from the clip plane the field is just the thinned sheet', () => {
    // Deep inside the kept half-space the plane never binds, so the value
    // reduces to abs(dBase) - thickness: a closed shell with no visible edge.
    const d = sdShellWrap(0, [0, 0, 0], T, N, O, RIM); // dShell = -T
    expect(d).toBeCloseTo(-T, 3);
  });
});
