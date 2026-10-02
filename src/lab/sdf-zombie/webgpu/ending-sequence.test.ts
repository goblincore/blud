// src/lab/sdf-zombie/webgpu/ending-sequence.test.ts

import { describe, expect, it } from 'vitest';
import { FLASH_S, SEQUENCES, cameraAt, overlayAt, shotAt, totalDuration, type Sequence, type Vec3 } from './ending-sequence';

const ending = SEQUENCES.ending!;
const START = { eye: [0, 1.5, -132] as Vec3, look: [0, 1.5, -133] as Vec3 };
const ANCHORS = { 'inner-egg': [0, 1.48, -136.7] as Vec3 };

describe('the ending sequence (the plan-3 stub)', () => {
  it('is two shots, a pull then black, with an end event', () => {
    expect(ending.shots.map(s => s.id)).toEqual(['pull', 'black']);
    expect(ending.endEvent).toBe('ending.end');
    expect(totalDuration(ending)).toBeCloseTo(6, 6);
    for (const s of ending.shots) expect(s.duration).toBeGreaterThan(0);
  });
});

describe('shotAt', () => {
  it('picks the shot and the progress through it', () => {
    expect(shotAt(ending, 0)).toMatchObject({ index: 0, local: 0, u: 0, finished: false });
    expect(shotAt(ending, 3.999).index).toBe(0);
    expect(shotAt(ending, 4)).toMatchObject({ index: 1, local: 0, u: 0 });
    expect(shotAt(ending, 5).u).toBeCloseTo(0.5, 6);
    expect(shotAt(ending, 2).u).toBeCloseTo(0.5, 6);
  });
  it('holds the last shot, finished, past the end', () => {
    const s = shotAt(ending, 100);
    expect(s).toMatchObject({ index: 1, u: 1, finished: true });
    expect(shotAt(ending, 6).finished).toBe(true);
    expect(shotAt(ending, 5.99).finished).toBe(false);
  });
});

describe('cameraAt', () => {
  const drift = ending.shots[0]!.camera;
  it('starts at the player\'s view and ends 1.3 m short of the inner egg with the lens narrowed', () => {
    const a = cameraAt(drift, 0, START, ANCHORS)!;
    expect(a.eye).toEqual(START.eye);
    expect(a.fovDelta).toBe(0);
    const b = cameraAt(drift, 1, START, ANCHORS)!;
    const d = Math.hypot(b.eye[0] - 0, b.eye[1] - 1.48, b.eye[2] + 136.7);
    expect(d).toBeCloseTo(1.3, 6);
    for (let i = 0; i < 3; i++) expect(b.look[i]!).toBeCloseTo(ANCHORS['inner-egg'][i]!, 9);
    expect(b.fovDelta).toBeCloseTo(-25, 6);
  });
  it('eases: slow at the ends, faster in the middle', () => {
    const at = (u: number) => cameraAt(drift, u, START, ANCHORS)!.eye[2];
    const total = at(1) - at(0);
    expect((at(0.1) - at(0)) / total).toBeLessThan(0.1);
    expect((at(0.6) - at(0.4)) / total).toBeGreaterThan(0.2);
  });
  it('holds (null) for a hold shot or a missing anchor, and returns a fixed pose as given', () => {
    expect(cameraAt({ kind: 'hold' }, 0.5, START, ANCHORS)).toBeNull();
    expect(cameraAt(drift, 0.5, START, {})).toBeNull();
    const fixed = cameraAt({ kind: 'fixed', eye: [1, 2, 3], look: [4, 5, 6], fovDelta: -10 }, 0.3, START, ANCHORS)!;
    expect(fixed).toEqual({ eye: [1, 2, 3], look: [4, 5, 6], fovDelta: -10 });
  });
});

describe('overlayAt', () => {
  const flashy: Sequence = {
    id: 't', endEvent: 't.end',
    shots: [
      { id: 'a', duration: 1, cut: 'hard', camera: { kind: 'hold' } },
      { id: 'b', duration: 1, cut: 'flash', camera: { kind: 'hold' }, overlay: { rgb: [0, 0, 0], alpha: 0.5 } },
    ],
  };
  it('is clear in the pull and solid black with the title in the last shot', () => {
    expect(overlayAt(ending, 1).alpha).toBe(0);
    const o = overlayAt(ending, 4.5);
    expect(o).toMatchObject({ rgb: [0, 0, 0], alpha: 1, text: 'NIGHT TRAIN' });
    expect(overlayAt(ending, 1).text).toBeNull();
  });
  it('a flash cut starts white and falls to the shot\'s own overlay in FLASH_S', () => {
    const w0 = overlayAt(flashy, 1);
    expect(w0.rgb).toEqual([1, 1, 1]);
    expect(w0.alpha).toBeCloseTo(1, 6);
    const mid = overlayAt(flashy, 1 + FLASH_S / 2);
    expect(mid.alpha).toBeLessThan(w0.alpha);
    expect(mid.alpha).toBeGreaterThan(0.5);
    expect(overlayAt(flashy, 1 + FLASH_S + 0.01)).toMatchObject({ rgb: [0, 0, 0], alpha: 0.5 });
  });
  it('a hard cut never flashes', () => {
    expect(overlayAt(flashy, 0).alpha).toBe(0);
  });
});
