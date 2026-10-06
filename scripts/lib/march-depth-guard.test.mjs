// scripts/lib/march-depth-guard.test.mjs
//
// The capture gates' depth guard on synthetic frames: a camera at (0, 1.6, 3) looking down -z, a 4 x 4 target, one
// proxy box about the origin's column (a texel's point at d metres is the eye + d x (-z + nx x + 0.75 ny y)). A guard
// that passes everything is worse than none, so each arm is shown to fail: a point behind the camera, a point off
// every bound, and a run of texels at the world origin's depth to the bit, counted wherever they land.
import { describe, expect, it } from 'vitest';
import {
  DEPTH_CHUNK, DEPTH_ORIGIN, DEPTH_ORIGIN_RUN, depthGuardAdd, depthGuardControl, depthGuardControlLine, depthGuardControlOk,
  depthGuardLine, depthGuardOk, depthGuardTexels, depthGuardTotals,
} from './march-depth-guard.mjs';

const NEAR = 0.1, FAR = 100, EYE = [0, 1.6, 3];
/** WebGPU clip depth of a point `d` metres along the view axis. */
const depthAt = (d) => FAR / (FAR - NEAR) - FAR * NEAR / ((FAR - NEAR) * d);
/** The probe's answer for that camera: rays per metre of view distance, half-width 1 and half-height 0.75 at 1 m. */
const probe = (boxes) => ({ c: EYE, f: [0, 0, -1], x: [1, 0, -1], y: [0, 0.75, -1], z1: depthAt(0.5), z2: depthAt(2), z0: depthAt(3), boxes });
const BOX = [[0, 1.2, 0, 1.0, 1.2, 0.3]];
const MISS = 1;
/** A 4 x 4 target, every texel a miss but those given as [x, y, clip depth]. */
const target = (hits) => { const f = new Float32Array(64).fill(MISS); for (const [x, y, z] of hits) f[(y * 4 + x) * 4 + 3] = z; return { w: 4, h: 4, f, miss: MISS }; };

describe('the depth guard', () => {
  it('passes body texels on the box: 3 m along the axis, by the frame centre', () => {
    // Two texels near the origin's depth, at two depths: no run.
    const r = depthGuardTexels(target([[1, 1, depthAt(3)], [2, 2, depthAt(2.8)]]), probe(BOX));
    expect(r).toEqual({ texels: 2, behind: 0, outside: 0, originRun: 1, worst: null });
  });
  it('counts no miss texel', () => {
    expect(depthGuardTexels(target([]), probe(BOX)).texels).toBe(0);
  });
  it('FAILS a texel at the world origin\'s depth off the box (OUTSIDE), and counts it at the origin\'s depth', () => {
    // The corner texel's ray at the origin's view distance is 2.25 m to the side: the origin's depth, no body there.
    const r = depthGuardTexels(target([[0, 0, depthAt(3)]]), probe(BOX));
    expect(r.outside).toBe(1);
    expect(r.originRun).toBe(1);
    expect(r.worst).toMatchObject({ texel: [0, 0], why: 'outside', distance: 3 });
  });
  it('FAILS a texel behind the camera (a clip depth past 1)', () => {
    const r = depthGuardTexels(target([[1, 1, 1.0107716]]), { ...probe(BOX), z0: 1.0107717 });
    expect(r.behind).toBe(1);
    expect(r.originRun).toBe(1);
    expect(Math.abs(1.0107716 - 1.0107717)).toBeLessThanOrEqual(DEPTH_ORIGIN);
    expect(r.worst.why).toBe('behind');
  });
  it('FAILS a texel in front of every box, and one beyond them', () => {
    const r = depthGuardTexels(target([[1, 1, depthAt(1)], [2, 1, depthAt(9)]]), probe(BOX));
    expect(r.outside).toBe(2);
    expect(r.originRun).toBe(0);
  });
  it('a texel passes when ANY actor\'s box holds it', () => {
    // Texel (1, 1) at 9 m is (-2.25, 3.29, -6).
    const far = [-2.25, 3.29, -6, 0.4, 0.9, 0.3];
    expect(depthGuardTexels(target([[1, 1, depthAt(9)]]), probe(BOX)).outside).toBe(1);
    expect(depthGuardTexels(target([[1, 1, depthAt(9)]]), probe([...BOX, far])).outside).toBe(0);
  });
  it('THE ORIGIN ARM is counted over EVERY body texel: a run at the origin\'s depth INSIDE a body\'s box fails', () => {
    // Three texels by the frame centre at the origin's depth to the bit: each lands on the box, so neither other arm
    // objects (an origin count taken only among texels already judged bad read 0 here and passed).
    const z = Math.fround(depthAt(3));
    const r = depthGuardTexels(target([[1, 1, z], [2, 1, z], [1, 2, z]]), probe(BOX));
    expect(r).toEqual({ texels: 3, behind: 0, outside: 0, originRun: 3, worst: null });
    const D = depthGuardTotals(); depthGuardAdd(D, r, probe(BOX));
    expect(r.originRun).toBeGreaterThan(DEPTH_ORIGIN_RUN);
    expect(depthGuardOk(D)).toBe(false);
    expect(D.worst).toMatchObject({ capture: 1, why: 'origin', originRun: 3 });
  });
  it('a surface that really crosses the origin\'s depth is no run: the same texels at depths a float apart pass', () => {
    const z = Math.fround(depthAt(3)), up = (v, n) => { const f = new Float32Array([v]), i = new Uint32Array(f.buffer); i[0] += n; return f[0]; };
    const r = depthGuardTexels(target([[1, 1, z], [2, 1, up(z, 1)], [1, 2, up(z, 2)], [2, 2, up(z, 3)]]), probe(BOX));
    expect(Math.abs(up(z, 3) - depthAt(3))).toBeLessThanOrEqual(DEPTH_ORIGIN);
    expect(r.originRun).toBe(1);
    const D = depthGuardTotals(); depthGuardAdd(D, r, probe(BOX));
    expect(depthGuardOk(D)).toBe(true);
  });
  it('A GIB CHUNK is a bound: a texel off every box passes inside a live chunk\'s sphere, and fails beyond it', () => {
    // Texel (1, 1) at 9 m is (-2.25, 3.29, -6): on no box.
    const at = [-2.25, 3.29, -6], g = probe(BOX);
    expect(depthGuardTexels(target([[1, 1, depthAt(9)]]), g).outside).toBe(1);
    expect(depthGuardTexels(target([[1, 1, depthAt(9)]]), { ...g, chunks: [[...at, 0.1]] }).outside).toBe(0);
    // DEPTH_CHUNK x the radius, plus the slack (0.05 + 0.03 x 9 = 0.32 m): a chunk 1 m off does not hold it.
    expect(DEPTH_CHUNK * 0.1 + 0.32).toBeLessThan(1);
    expect(depthGuardTexels(target([[1, 1, depthAt(9)]]), { ...g, chunks: [[at[0] + 1, at[1], at[2], 0.1]] }).outside).toBe(1);
    // A probe with no chunks at all (an older page) is a probe with none.
    expect(depthGuardTexels(target([[1, 1, depthAt(3)]]), { ...g, chunks: undefined }).outside).toBe(0);
  });
  it('the totals: counts summed, the longest run and the most chunks kept, the first failing capture named', () => {
    const D = depthGuardTotals(), g = probe(BOX);
    expect(depthGuardOk(D)).toBe(false);          // nothing captured is not a pass
    depthGuardAdd(D, depthGuardTexels(target([[1, 1, depthAt(3)], [2, 2, depthAt(2.8)]]), g), { ...g, chunks: [[9, 9, 9, 0.1]] });
    expect(depthGuardOk(D)).toBe(true);
    expect(D).toMatchObject({ captures: 1, texels: 2, behind: 0, outside: 0, originRun: 1, chunks: 1, worst: null });
    depthGuardAdd(D, depthGuardTexels(target([[1, 1, depthAt(1)]]), g), g, 'K-kill');
    expect(depthGuardOk(D)).toBe(false);
    expect(D).toMatchObject({ captures: 2, texels: 3, outside: 1, chunks: 1 });
    expect(D.worst).toMatchObject({ capture: 'K-kill', why: 'outside', texel: [1, 1] });
  });
  it('the check line names the first bad texel only when there is one, and always the origin run', () => {
    const clean = depthGuardLine({ captures: 2, texels: 10, behind: 0, outside: 0, originRun: 1, chunks: 0, worst: null });
    expect(clean).not.toContain('the first');
    expect(clean).toContain(`the largest run of bit-equal texels in a capture is 1 (<= ${DEPTH_ORIGIN_RUN})`);
    expect(depthGuardLine({ captures: 2, texels: 10, behind: 1, outside: 0, originRun: 3, chunks: 2, worst: { texel: [1, 1] } })).toContain('2 chunks live at most); at the world origin\'s clip depth the largest run of bit-equal texels in a capture is 3 (<= 2); the first {"texel":[1,1]}');
  });
});

describe('the positive control the gates run', () => {
  const k = depthGuardControl();
  it('the faulty target trips each arm once: one texel behind, one outside every bound, a run of three at the origin\'s depth inside a body\'s box', () => {
    expect(k.faulty).toEqual({ texels: 6, behind: 1, outside: 1, originRun: 3 });
  });
  it('the clean target trips none', () => {
    expect(k.clean).toEqual({ texels: 5, behind: 0, outside: 0, originRun: 0 });
  });
  it('and the gates\' check reads it so', () => {
    expect(depthGuardControlOk(k)).toBe(true);
    expect(depthGuardControlOk({ ...k, faulty: { ...k.faulty, originRun: 0 } })).toBe(false);
    expect(depthGuardControlOk({ ...k, faulty: { ...k.faulty, outside: 0 } })).toBe(false);
    expect(depthGuardControlOk({ ...k, clean: { ...k.clean, behind: 1 } })).toBe(false);
    expect(depthGuardControlLine(k)).toContain('of 6, 1 behind the camera, 1 outside every bound and a run of 3');
  });
});
