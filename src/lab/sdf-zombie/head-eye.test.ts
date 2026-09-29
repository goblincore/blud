// src/lab/sdf-zombie/head-eye.test.ts
//
import { describe, expect, it } from 'vitest';
import { EYE_STALK, HEAD_EYES, eyeLook, eyeRayStart, makeStalk, nearerEye, stalkPrims, stepStalk } from './head-eye';
import type { HeadFrame } from './head-deform';

const frame: HeadFrame = { centre: [0, 1.6, 0], quat: [0, 0, 0, 1], axes: [0.09, 0.11, 0.1] };
const d = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('eyes', () => {
  it('the face-sheet eye centroids sit left and right of the face, above the head centre', () => {
    const L = eyeRayStart(frame, 'L'), R = eyeRayStart(frame, 'R');
    expect(L[0]).toBeLessThan(frame.centre[0]); expect(R[0]).toBeGreaterThan(frame.centre[0]);
    expect(L[1]).toBeGreaterThan(frame.centre[1]); expect(R[1]).toBeGreaterThan(frame.centre[1]);
    expect(L[2]).toBeGreaterThan(frame.centre[2] + frame.axes[2]);   // starts in front of the face
    expect(HEAD_EYES.zombie.L[0]).toBeCloseTo(-0.498, 3);
  });
  it('picks the eye nearer the hit', () => {
    expect(nearerEye(frame, [-0.05, 1.62, 0.1])).toBe('L');
    expect(nearerEye(frame, [0.06, 1.6, 0.1])).toBe('R');
  });
});

describe('the stalk rope', () => {
  const socket: [number, number, number] = [0, 1.62, 0.1];
  it('pins node 0 on the socket and holds every link at its length', () => {
    let s = makeStalk(socket, [0, 0, 1], 2.5);
    for (let i = 0; i < 120; i++) {
      s = stepStalk(s, [socket[0] + 0.1 * Math.sin(i / 10), socket[1], socket[2]], 1 / 60);
      expect(d(s.p[0]!, [socket[0] + 0.1 * Math.sin(i / 10), socket[1], socket[2]])).toBeLessThan(1e-9);
      for (let k = 0; k < EYE_STALK.nodes - 1; k++) expect(d(s.p[k]!, s.p[k + 1]!)).toBeCloseTo(EYE_STALK.len / (EYE_STALK.nodes - 1), 6);
    }
  });
  it('springs out along the kick, then hangs below the socket', () => {
    let s = makeStalk(socket, [0, 0, 1], 2.5);
    s = stepStalk(s, socket, 1 / 30);
    expect(s.p[EYE_STALK.nodes - 1]![2]).toBeGreaterThan(socket[2] + 0.05);
    for (let i = 0; i < 240; i++) s = stepStalk(s, socket, 1 / 60);
    expect(s.p[EYE_STALK.nodes - 1]![1]).toBeLessThan(socket[1] - 0.12);
  });
  it('builds tapered capsules along the rope and an eyeball at its end', () => {
    const s = makeStalk(socket, [0, 0, 1], 0);
    const prims = stalkPrims(s, [1.9, 0.012, 0.005]);
    const caps = prims.filter(p => p.color && p.color[0] === 0.85);
    expect(caps.length).toBe(EYE_STALK.nodes - 1);
    expect(prims.some(p => p.glow)).toBe(true);
  });
  it('with a head forward, the eyeball faces 0.7·forward + 0.3·stalk direction (the iris looks out)', () => {
    const s = makeStalk(socket, [0, -1, 0], 0);                     // hanging straight down
    const prims = stalkPrims(s, [1.9, 0.012, 0.005], [0, 0, 1]);
    const eye = s.p[EYE_STALK.nodes - 1]!;
    const iris = prims.find(p => p.glow)!;
    const off = [iris.a[0] - eye[0], iris.a[1] - eye[1], iris.a[2] - eye[2]];
    const l = Math.hypot(off[0]!, off[1]!, off[2]!);
    const want = eyeLook([0, 0, 1], [0, -1, 0]);
    expect(want[2]).toBeCloseTo(0.7 / Math.hypot(0.7, 0.3), 6);
    expect(off[0]! / l).toBeCloseTo(want[0], 6);
    expect(off[1]! / l).toBeCloseTo(want[1], 6);
    expect(off[2]! / l).toBeCloseTo(want[2], 6);
    expect(prims.length).toBe(stalkPrims(s, [1.9, 0.012, 0.005]).length);   // same prims, only the facing
  });
  it('a zero kick direction hangs the rope straight down; a bad dt is ignored', () => {
    const s = makeStalk(socket, [0, 0, 0], 2.5);
    expect(s.p[EYE_STALK.nodes - 1]![1]).toBeCloseTo(socket[1] - EYE_STALK.len, 9);
    const t = stepStalk(s, socket, Number.NaN);
    expect(t.acc).toBe(0);
    expect(stepStalk(t, socket, -1).acc).toBe(0);
  });
});
