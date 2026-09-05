// src/lab/sdf-zombie/glb-clip.test.ts
import { describe, it, expect } from 'vitest';
// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { parseGlb, curvesFromClip, jointWorldPositions } from './glb-clip';
import { sampleCurve, blendCurves } from './gait-curves';

const WALK = 'docs/dev-notes/refs/soldier-mesh/soldier.glb';
const RUN = 'docs/dev-notes/refs/soldier-mesh/zombie-biped-running.glb';
const load = (p: string) => parseGlb(new Uint8Array(readFileSync(p)));

describe('glb-clip sampler', () => {
  const walk = curvesFromClip(load(WALK), { name: 'soldier-walk' });
  const run = curvesFromClip(load(RUN), { name: 'soldier-run' });

  it('walk: 32 samples, ~0.93 Hz, a real knee, a walking duty, forward travel', () => {
    expect(walk.n).toBe(32);
    expect(walk.hipsY.length).toBe(32);
    expect(walk.freq).toBeCloseTo(1 / 1.07, 1);
    const peakKnee = Math.max(...walk.L.knee);
    expect(peakKnee).toBeGreaterThan(0.6);
    expect(peakKnee).toBeLessThan(1.4);
    const duty = walk.L.stance.filter(Boolean).length / 32;
    expect(duty).toBeGreaterThan(0.55);
    expect(duty).toBeLessThan(0.70);
    expect(walk.travel).toBeGreaterThan(0);
  });

  it('run: higher knees and a shorter stance than the walk', () => {
    expect(Math.max(...run.L.knee)).toBeGreaterThan(Math.max(...walk.L.knee));
    const duty = run.L.stance.filter(Boolean).length / 32;
    expect(duty).toBeLessThan(0.55);
  });

  it('phase 0 is left heel strike: the left foot is furthest forward there', () => {
    expect(walk.L.thigh[0]).toBe(Math.max(...walk.L.thigh));
  });

  it('the two legs are half a cycle apart', () => {
    const shift = 16;
    let err = 0;
    for (let i = 0; i < 32; i++) err += Math.abs(walk.L.thigh[i]! - walk.R.thigh[(i + shift) % 32]!);
    expect(err / 32).toBeLessThan(0.15);
  });

  it('jointWorldPositions composes the hierarchy (hips ~0.94 m up in metres)', () => {
    // t=0 of the clip is mid-cycle: the left foot is mid-swing there, so the
    // ground-contact check uses the planted (right) foot.
    const p = jointWorldPositions(load(WALK), 0, ['Hips', 'LeftFoot', 'RightFoot']);
    expect(p.get('Hips')![1]).toBeGreaterThan(0.8);
    expect(p.get('Hips')![1]).toBeLessThan(1.1);
    expect(Math.min(p.get('LeftFoot')![1], p.get('RightFoot')![1])).toBeLessThan(0.2);
  });

  it('sampleCurve wraps and interpolates; blendCurves lerps', () => {
    const c = [0, 1, 2, 3];
    expect(sampleCurve(c, 0.125)).toBeCloseTo(0.5, 9);
    expect(sampleCurve(c, 0.875)).toBeCloseTo(1.5, 9); // between 3 and 0
    const b = blendCurves(walk, run, 0.5);
    expect(b.L.knee[5]).toBeCloseTo((walk.L.knee[5]! + run.L.knee[5]!) / 2, 9);
    expect(b.freq).toBeCloseTo((walk.freq + run.freq) / 2, 9);
  });
});
