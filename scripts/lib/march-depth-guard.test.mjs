// scripts/lib/march-depth-guard.test.mjs
//
// The capture gates' depth guard on synthetic frames: a camera at (0, 1.6, 3) looking down -z, a 4 x 4 target, one
// proxy box about the origin's column (a texel's point at d metres is the eye + d x (-z + nx x + 0.75 ny y)). A guard that passes everything is worse than none, so each way a texel can be
// wrong is shown to fail: the world origin's depth, a point behind the camera, a point off every box.
import { describe, expect, it } from 'vitest';
import { DEPTH_ORIGIN, depthGuardLine, depthGuardTexels } from './march-depth-guard.mjs';

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
    const r = depthGuardTexels(target([[1, 1, depthAt(3)], [2, 2, depthAt(2.8)]]), probe(BOX));
    expect(r).toEqual({ texels: 2, behind: 0, outside: 0, origin: 0, worst: null });
  });
  it('counts no miss texel', () => {
    expect(depthGuardTexels(target([]), probe(BOX)).texels).toBe(0);
  });
  it('FAILS a texel at the world origin\'s depth off the box, and counts it as the fault\'s signature', () => {
    // The corner texel's ray at the origin's view distance is 2.25 m to the side: the origin's depth, no body there.
    const r = depthGuardTexels(target([[0, 0, depthAt(3)]]), probe(BOX));
    expect(r.outside).toBe(1);
    expect(r.origin).toBe(1);
    expect(r.worst).toMatchObject({ texel: [0, 0], why: 'outside', distance: 3 });
  });
  it('FAILS a texel behind the camera (a clip depth past 1)', () => {
    const r = depthGuardTexels(target([[1, 1, 1.0107716]]), { ...probe(BOX), z0: 1.0107717 });
    expect(r.behind).toBe(1);
    expect(r.origin).toBe(1);
    expect(Math.abs(1.0107716 - 1.0107717)).toBeLessThanOrEqual(DEPTH_ORIGIN);
    expect(r.worst.why).toBe('behind');
  });
  it('FAILS a texel in front of every box, and one beyond them', () => {
    const r = depthGuardTexels(target([[1, 1, depthAt(1)], [2, 1, depthAt(9)]]), probe(BOX));
    expect(r.outside).toBe(2);
    expect(r.origin).toBe(0);
  });
  it('a texel passes when ANY actor\'s box holds it', () => {
    // Texel (1, 1) at 9 m is (-2.25, 3.29, -6).
    const far = [-2.25, 3.29, -6, 0.4, 0.9, 0.3];
    expect(depthGuardTexels(target([[1, 1, depthAt(9)]]), probe(BOX)).outside).toBe(1);
    expect(depthGuardTexels(target([[1, 1, depthAt(9)]]), probe([...BOX, far])).outside).toBe(0);
  });
  it('the check line names the first bad texel only when there is one', () => {
    expect(depthGuardLine({ captures: 2, texels: 10, behind: 0, outside: 0, origin: 0, worst: null })).not.toContain('the first');
    expect(depthGuardLine({ captures: 2, texels: 10, behind: 1, outside: 0, origin: 1, worst: { texel: [1, 1] } })).toContain('1 of those at the world origin\'s depth; the first {"texel":[1,1]}');
  });
});
