// src/lab/sdf-zombie/melt-gate.test.ts
//
// MELT GATE A — the geometric half of "did the melt actually happen",
// measured on the real zombie.blob, in the suite, so it runs on every future
// change instead of living in a script someone remembers to run.
//
// WHY THIS GATE EXISTS: the previous attempt (c52b05b) shipped tested,
// green, correct-looking plumbing that produced literally zero visual change,
// and no test caught it. Any one of these three ratios would have failed it
// on its first run. THE THRESHOLDS ARE THE DEFINITION OF THE EFFECT — do not
// relax them to make a run pass. If a ratio misses, tune MELT_TUNING_BODY
// (crush drives height, spread drives width, poolHeight drives centroid).
//
// Width has a CEILING as well as a floor. Task 3's frames showed a melt that
// passed every lower bound by turning the zombie into a flat disc several
// metres across; "wider" is only right up to a point.
//
// FIXTURE NOTE — the body is placed ON THE FLOOR before measuring. The
// shipped zombie.blob floats: its lowest flesh extent is y≈0.199 above its
// local origin (verified in the live lab 2026-09-03 — the standing body
// hovers ~20 cm over the floor mesh). Melting the floating body pools goo at
// the world floor (poolHeight 0.09), which in prim space is BELOW the rest
// flesh bottom, and the AABB then "grows" downward mid-ramp while the crown
// is still up — a fixture artefact, not the melt rising. In any real scene
// the body stands on the floor, so the gate measures that body. The melt
// transform itself is untouched.
import { describe, it, expect } from 'vitest';
import src from './characters/zombie.blob?raw';
import { compileBlob } from './blob-compile';
import { parseBlob } from './blob-parse';
import { buildBody } from './build-body';
import { translateBody } from './translate';
import { applyMelt, meltInitBody, stepMelt } from './melt';
import type { Primitive } from './types';

/** World AABB of a prim set, radius and per-axis scale included. */
function aabb(prims: readonly Primitive[]) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const p of prims) {
    const rx = p.radius * p.scale[0];
    const ry = p.radius * p.scale[1];
    const rz = p.radius * p.scale[2];
    for (const e of [p.a, p.b]) {
      x0 = Math.min(x0, e[0] - rx); x1 = Math.max(x1, e[0] + rx);
      y0 = Math.min(y0, e[1] - ry); y1 = Math.max(y1, e[1] + ry);
      z0 = Math.min(z0, e[2] - rz); z1 = Math.max(z1, e[2] + rz);
    }
  }
  return {
    height: y1 - y0,
    width: Math.max(x1 - x0, z1 - z0),
    centroid: prims.reduce((s, p) => s + (p.a[1] + p.b[1]) / 2, 0) / prims.length - y0,
  };
}

/** Lowest flesh extent — where the feet touch the floor. */
function floorY(prims: readonly Primitive[]) {
  let y = Infinity;
  for (const p of prims) for (const e of [p.a, p.b]) y = Math.min(y, e[1] - p.radius * p.scale[1]);
  return y;
}

/** The real zombie, floor-placed (see the fixture note above). */
function zombie() {
  const body = buildBody(compileBlob(parseBlob(src)));
  return translateBody(body, [0, -floorY(body.prims), 0]);
}

describe('MELT GATE — the end state must be shorter, wider and lower', () => {
  it('sinks, spreads and drops its centroid by progress 1', () => {
    const body = zombie();
    const rest = aabb(body.prims);

    let s = meltInitBody(body.prims, 0);
    for (let i = 0; i < 600; i++) s = stepMelt(s, 1 / 60);
    const end = aabb(applyMelt(body.prims, s));

    const h = end.height / rest.height;
    const w = end.width / rest.width;
    const c = end.centroid / rest.centroid;
    // Printed so a failure says WHICH property is missing, not just "false".
    console.log(`melt gate: height ${h.toFixed(2)}x  width ${w.toFixed(2)}x  centroid ${c.toFixed(2)}x`);

    expect(h).toBeLessThanOrEqual(0.40);
    expect(w).toBeGreaterThanOrEqual(1.50);
    expect(w).toBeLessThanOrEqual(3.00);
    expect(c).toBeLessThanOrEqual(0.25);
  });

  it('never grows taller at any point in the ramp', () => {
    const body = zombie();
    let s = meltInitBody(body.prims, 0);
    let prev = aabb(body.prims).height;
    for (let i = 0; i < 600; i++) {
      s = stepMelt(s, 1 / 60);
      const now = aabb(applyMelt(body.prims, s)).height;
      expect(now).toBeLessThanOrEqual(prev + 1e-6);
      prev = now;
    }
  });
});
