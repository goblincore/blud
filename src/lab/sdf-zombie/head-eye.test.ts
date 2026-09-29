// src/lab/sdf-zombie/head-eye.test.ts
//
import { describe, expect, it } from 'vitest';
import { EYE_FLY, EYE_STALK, HEAD_EYES, eyeFlyLaunch, ORBIT_EYE_R, POP_GROW_S, eyeLook, eyeRayStart, makeStalk, nearerEye, popEyeR, stalkPrims, stepStalk } from './head-eye';
import { EYEBALL_R } from './head-pop';
import type { HeadFrame } from './head-deform';
import { makeChunk, stepChunk, type Chunk } from './gib-chunks';
import { mulberry32 } from './melt-bones';

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

describe('the eyeball size (spec §15 as built)', () => {
  it('in the orbit it is life-size (fits the socket); popped it grows to the cartoon size over POP_GROW_S', () => {
    expect(ORBIT_EYE_R).toBeGreaterThanOrEqual(0.017); expect(ORBIT_EYE_R).toBeLessThanOrEqual(0.02);
    expect(popEyeR(0)).toBeCloseTo(ORBIT_EYE_R, 9);
    expect(popEyeR(POP_GROW_S / 2)).toBeGreaterThan(ORBIT_EYE_R);
    expect(popEyeR(POP_GROW_S / 2)).toBeLessThan(EYEBALL_R);
    expect(popEyeR(POP_GROW_S)).toBeCloseTo(EYEBALL_R, 9);
    expect(popEyeR(5)).toBeCloseTo(EYEBALL_R, 9);
    expect(popEyeR(-1)).toBeCloseTo(ORBIT_EYE_R, 9);
    for (let t = 0; t < POP_GROW_S; t += 0.01) expect(popEyeR(t + 0.01)).toBeGreaterThanOrEqual(popEyeR(t));
  });
  it('stalkPrims scales the eyeball (white, iris, pupil) to eyeR; the rope is unchanged', () => {
    const s = makeStalk([0, 1, 0], [0, 0, 1], 0);
    const big = stalkPrims(s, [1.9, 0.012, 0.005], [0, 0, 1]);
    const small = stalkPrims(s, [1.9, 0.012, 0.005], [0, 0, 1], ORBIT_EYE_R);
    expect(small.length).toBe(big.length);
    const caps = EYE_STALK.nodes - 1;
    for (let k = 0; k < caps; k++) expect(small[k]).toEqual(big[k]);
    const k = ORBIT_EYE_R / EYEBALL_R;
    for (let i = caps; i < big.length; i++) expect(small[i]!.radius).toBeCloseTo(big[i]!.radius * k, 9);
    expect(big[caps]!.radius).toBe(EYEBALL_R);
  });
});

describe('the snapped eye flies off (EYE_FLY)', () => {
  const fwd: [number, number, number] = [0, 0, 1];
  const right: [number, number, number] = [1, 0, 0];
  const left: [number, number, number] = [-1, 0, 0];
  it('launches up and out, each eye toward its own side, spinning hard', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const blow: [number, number, number] = [0.3, -0.1, -0.95];   // a blow into the face (mostly against forward)
      const L = eyeFlyLaunch(blow, fwd, left, rand), R = eyeFlyLaunch(blow, fwd, right, rand);
      for (const l of [L, R]) {
        const h = Math.hypot(l.vel[0], l.vel[2]);
        expect(h).toBeGreaterThanOrEqual(EYE_FLY.speed[0] - 1e-9); expect(h).toBeLessThanOrEqual(EYE_FLY.speed[1] + 1e-9);
        expect(l.vel[1]).toBeGreaterThanOrEqual(EYE_FLY.up[0]); expect(l.vel[1]).toBeLessThanOrEqual(EYE_FLY.up[1]);
        const w = Math.hypot(...l.angVel);
        expect(w).toBeGreaterThanOrEqual(EYE_FLY.spin[0] - 1e-9); expect(w).toBeLessThanOrEqual(EYE_FLY.spin[1] + 1e-9);
      }
      // The left eye's heading is left of the right eye's.
      expect(L.vel[0] / Math.hypot(L.vel[0], L.vel[2])).toBeLessThan(R.vel[0] / Math.hypot(R.vel[0], R.vel[2]));
    }
  });
  it('a blow straight into the face throws the eyes out to either side', () => {
    const rand = mulberry32(5);
    for (let i = 0; i < 20; i++) {
      const L = eyeFlyLaunch([0, 0, -1], fwd, left, rand), R = eyeFlyLaunch([0, 0, -1], fwd, right, rand);
      expect(L.vel[0]).toBeLessThan(-3); expect(R.vel[0]).toBeGreaterThan(3);
    }
  });
  it('a death snap (no blow) flies forward', () => {
    const l = eyeFlyLaunch([0, 0, 0], fwd, right, mulberry32(3));
    expect(l.vel[2]).toBeGreaterThan(3);
  });
  it('rises >= 0.8 m, travels >= 2 m and bounces off the floor and a wall several times', () => {
    const rand = mulberry32(11);
    for (let i = 0; i < 20; i++) {
      const l = eyeFlyLaunch([0, 0, 1], fwd, right, rand);
      let c: Chunk = { ...makeChunk('torso', [0, 1.5, 0], l.vel, 0.1, [0, 1, 0], rand, 'gob', { angVel: l.angVel },
        [{ c: [0, 0, 0], r: 0.03 }]), restitution: EYE_FLY.restitution, wallRestitution: EYE_FLY.restitution };
      // A wall 4 m ahead.
      const boxes = [{ min: [-10, 0, 4] as [number, number, number], max: [10, 3, 4.2] as [number, number, number] }];
      let peak = 0, travel = 0, bounces = 0;
      for (let f = 0; f < 240; f++) {
        const v0 = c.vel;
        c = stepChunk(c, 1 / 60, { boxes, ceilingY: 3 });
        peak = Math.max(peak, c.pos[1] - 1.5);
        travel = Math.max(travel, Math.hypot(c.pos[0], c.pos[2]));
        if ((v0[1] < 0 && c.vel[1] > 0) || v0[2] * c.vel[2] < 0) bounces++;
      }
      expect(peak).toBeGreaterThanOrEqual(0.8);
      expect(travel).toBeGreaterThanOrEqual(2);
      expect(bounces).toBeGreaterThanOrEqual(3);
    }
  });
});
