// src/lab/sdf-zombie/webgpu/censer-head.test.ts
//
import { describe, expect, it } from 'vitest';
import {
  CENSER_HEAD, makeCenserHead, stepCenserHead, type Box, type CenserHead, type HeadWorld,
} from './censer-head';
import type { Vec3 } from '../types';

const OPEN: HeadWorld = { floorY: -100, boxes: [] };
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const speed = (h: CenserHead) => Math.hypot(h.vel[0], h.vel[1], h.vel[2]);
/** Kinetic + potential energy per unit mass. */
const energy = (h: CenserHead) => 0.5 * speed(h) ** 2 - CENSER_HEAD.gravity * h.pos[1];
/** Held out horizontally, rope taut, at rest. */
const swungOut = (anchor: Vec3): CenserHead =>
  ({ ...makeCenserHead(anchor), pos: [anchor[0] + CENSER_HEAD.ropeLen, anchor[1], anchor[2]] });

describe('censer head (rope pendulum)', () => {
  it('hangs straight down at rest', () => {
    const a: Vec3 = [0, 2, 0];
    let h = makeCenserHead(a);
    for (let i = 0; i < 120; i++) h = stepCenserHead(h, a, 1 / 60, OPEN);
    expect(h.pos[1]).toBeCloseTo(2 - CENSER_HEAD.ropeLen, 3);
    expect(speed(h)).toBeLessThan(0.01);
  });

  it('never stretches the rope, however the handle moves', () => {
    let h = makeCenserHead([0, 2, 0]);
    let worst = -Infinity;
    for (let i = 0; i < 240; i++) {
      const t = i / 60;
      const a: Vec3 = [0.3 * Math.cos(t * 12), 2 + 0.2 * Math.sin(t * 9), 0.3 * Math.sin(t * 12)];
      h = stepCenserHead(h, a, 1 / 60, OPEN);
      worst = Math.max(worst, dist(h.pos, a) - CENSER_HEAD.ropeLen);
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('goes slack when the handle moves toward the head', () => {
    let h = makeCenserHead([0, 2, 0]);
    h = stepCenserHead(h, [0, 1.7, 0], 1 / 60, OPEN);
    expect(dist(h.pos, [0, 1.7, 0])).toBeLessThan(CENSER_HEAD.ropeLen - 0.2);
  });

  it('loses energy with no input (drag)', () => {
    const a: Vec3 = [0, 2, 0];
    let h = swungOut(a);
    const e0 = energy(h);
    for (let i = 0; i < 180; i++) h = stepCenserHead(h, a, 1 / 60, OPEN);
    expect(energy(h)).toBeLessThan(e0 - 0.05);
  });

  it('is the same whatever the frame split (fixed step)', () => {
    const a: Vec3 = [0, 2, 0];
    let h1 = swungOut(a), h2 = swungOut(a);
    for (let i = 0; i < 60; i++) h1 = stepCenserHead(h1, a, 1 / 60, OPEN);
    for (let i = 0; i < 120; i++) h2 = stepCenserHead(h2, a, 1 / 120, OPEN);
    for (let k = 0; k < 3; k++) expect(h2.pos[k]).toBeCloseTo(h1.pos[k]!, 9);
  });

  it('the handle drags the head: a 0.22 s stroke gets it moving', () => {
    let a: Vec3 = [-0.32, 2, 0];
    let h = makeCenserHead(a);
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      const t = Math.min(1, i / 13);
      a = [-0.32 + 0.64 * t, 2, 0];
      h = stepCenserHead(h, a, 1 / 60, OPEN);
      peak = Math.max(peak, speed(h));
    }
    expect(peak).toBeGreaterThan(1.5);
  });

  it('scales the velocity by what the substep hook returns', () => {
    const a: Vec3 = [0, 2, 0];
    let free = swungOut(a), soaked = swungOut(a);
    for (let i = 0; i < 20; i++) {
      free = stepCenserHead(free, a, 1 / 60, OPEN);
      soaked = stepCenserHead(soaked, a, 1 / 60, OPEN, () => 0.9);
    }
    expect(speed(soaked)).toBeLessThan(speed(free) * 0.5);
  });

  it('hands the hook every substep\'s segment', () => {
    const a: Vec3 = [0, 2, 0];
    let calls = 0;
    stepCenserHead(swungOut(a), a, 1 / 60, OPEN, (from, to) => { calls++; expect(dist(from, to)).toBeLessThan(0.1); });
    expect(calls).toBe(CENSER_HEAD.stepHz / 60);
  });

  it('stays above the floor', () => {
    const a: Vec3 = [0, 0.3, 0];
    let h = makeCenserHead(a);
    let low = Infinity;
    for (let i = 0; i < 120; i++) {
      h = stepCenserHead(h, a, 1 / 60, { floorY: 0, boxes: [] });
      low = Math.min(low, h.pos[1]);
    }
    expect(low).toBeGreaterThanOrEqual(CENSER_HEAD.radius - 1e-9);
  });

  it('never ends a step inside a box', () => {
    const box: Box = { min: [0.1, 0, -0.5], max: [0.6, 3, 0.5] };
    const r = CENSER_HEAD.radius;
    const inside = (p: Vec3) => [0, 1, 2].every(k =>
      p[k]! > box.min[k]! - r + 1e-6 && p[k]! < box.max[k]! + r - 1e-6);
    const a: Vec3 = [0, 2, 0];
    let h: CenserHead = { ...makeCenserHead(a), pos: [-0.55, 2, 0] };
    for (let i = 0; i < 120; i++) {
      h = stepCenserHead(h, a, 1 / 60, { floorY: -100, boxes: [box] });
      expect(inside(h.pos)).toBe(false);
    }
  });

  /** Same 0.22s stroke as "the handle drags the head", but timed by real elapsed
   *  seconds rather than frame count, so it can be replayed at any dt. */
  function strokePeak(dt: number): number {
    const strokeDuration = 13 / 60;
    let a: Vec3 = [-0.32, 2, 0];
    let h = makeCenserHead(a);
    let peak = 0;
    let time = 0;
    const totalDuration = 0.5;
    const steps = Math.round(totalDuration / dt);
    for (let i = 0; i < steps; i++) {
      time += dt;
      const t = Math.min(1, time / strokeDuration);
      a = [-0.32 + 0.64 * t, 2, 0];
      h = stepCenserHead(h, a, dt, OPEN);
      peak = Math.max(peak, speed(h));
    }
    return peak;
  }

  it('the yank is frame-rate independent (time-based anchor interpolation)', () => {
    const p60 = strokePeak(1 / 60);
    const p165 = strokePeak(1 / 165);
    expect(Math.abs(p165 - p60) / p60).toBeLessThan(0.03);
  });

  it('a lag-spike frame does not inject extra energy into the yank', () => {
    const dt = 1 / 60;
    const strokeDuration = 13 / 60;
    const totalDuration = 0.5;
    const steps = Math.round(totalDuration / dt);
    const spikeAt = Math.round(steps / 2);
    let a: Vec3 = [-0.32, 2, 0];
    let h = makeCenserHead(a);
    let peak = 0;
    let time = 0;
    for (let i = 0; i < steps; i++) {
      const frameDt = i === spikeAt ? 0.25 : dt;
      time += frameDt;
      const t = Math.min(1, time / strokeDuration);
      a = [-0.32 + 0.64 * t, 2, 0];
      h = stepCenserHead(h, a, frameDt, OPEN);
      peak = Math.max(peak, speed(h));
    }
    const p60 = strokePeak(dt);
    expect(peak).toBeLessThanOrEqual(p60 * 1.05);
  });

  it('a teleporting handle re-hangs the head instead of flinging it', () => {
    const a: Vec3 = [0, 2, 0];
    let h = makeCenserHead(a);
    h = stepCenserHead(h, a, 1 / 60, OPEN);
    let hookCalled = false;
    const jumped: Vec3 = [5, 2, 0];
    h = stepCenserHead(h, jumped, 1 / 60, OPEN, () => { hookCalled = true; });
    expect(h.pos[0]).toBeCloseTo(jumped[0], 9);
    expect(h.pos[1]).toBeCloseTo(jumped[1] - CENSER_HEAD.ropeLen, 9);
    expect(h.pos[2]).toBeCloseTo(jumped[2], 9);
    expect(speed(h)).toBe(0);
    expect(hookCalled).toBe(false);
  });

  it('clamps the hook\'s return to soaking energy only, ignoring NaN and >1', () => {
    const a: Vec3 = [0, 2, 0];
    let vNaN = swungOut(a), vBig = swungOut(a), vRef = swungOut(a);
    for (let i = 0; i < 5; i++) {
      vNaN = stepCenserHead(vNaN, a, 1 / 60, OPEN, () => NaN);
      vBig = stepCenserHead(vBig, a, 1 / 60, OPEN, () => 1.1);
      vRef = stepCenserHead(vRef, a, 1 / 60, OPEN);
    }
    expect(speed(vNaN)).toBeCloseTo(speed(vRef), 9);
    expect(speed(vBig)).toBeCloseTo(speed(vRef), 9);
  });

  it('never gains energy from one frame to the next when the anchor is still', () => {
    const a: Vec3 = [0, 2, 0];
    let h = swungOut(a);
    let prevEnergy = energy(h);
    for (let i = 0; i < 180; i++) {
      h = stepCenserHead(h, a, 1 / 60, OPEN);
      const e = energy(h);
      expect(e).toBeLessThanOrEqual(prevEnergy + 1e-9);
      prevEnergy = e;
    }
  });

  it('ignores a zero or NaN dt (no time, no motion)', () => {
    const a: Vec3 = [0, 2, 0];
    const h = swungOut(a);
    const hZero = stepCenserHead(h, a, 0, OPEN);
    expect(hZero.pos).toEqual(h.pos);
    expect(hZero.vel).toEqual(h.vel);
    const hNaN = stepCenserHead(h, a, NaN, OPEN);
    expect(hNaN.pos).toEqual(h.pos);
    expect(hNaN.vel).toEqual(h.vel);
  });

  it('never exceeds a passed (shorter) rope length', () => {
    const L = 0.2;
    let h = makeCenserHead([0, 2, 0], L);
    expect(dist(h.pos, [0, 2, 0])).toBeCloseTo(L, 9);
    let worst = -Infinity;
    for (let i = 0; i < 240; i++) {
      const t = i / 60;
      const a: Vec3 = [0.3 * Math.cos(t * 12), 2 + 0.2 * Math.sin(t * 9), 0.3 * Math.sin(t * 12)];
      h = stepCenserHead(h, a, 1 / 60, OPEN, undefined, L);
      worst = Math.max(worst, dist(h.pos, a) - L);
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('reeling in pulls the head up without injecting speed (≤ anchor speed + 1 m/s)', () => {
    for (const av of [0, 2]) {
      let h = makeCenserHead([0, 2, 0]);
      const dt = 1 / 240;
      let worst = 0, len: number = CENSER_HEAD.ropeLen;
      // The reel window (0.1 s) and a beat after. Longer than that, a head
      // dragged by a moving anchor swings ahead of it on its own (pendulum
      // dynamics, same with a fixed rope), which is not what this pins.
      for (let i = 0; i < 36; i++) {
        const t = (i + 1) * dt;
        len = Math.max(0.2, CENSER_HEAD.ropeLen - t * 3.5);   // 0.35 m reeled in over 0.1 s
        const a: Vec3 = [av * t, 2, 0];
        h = stepCenserHead(h, a, dt, OPEN, undefined, len);
        worst = Math.max(worst, speed(h) - av);
        expect(dist(h.pos, a)).toBeLessThanOrEqual(len + 1e-6);
      }
      expect(h.pos[1]).toBeGreaterThan(2 - 0.2 - 0.02);
      expect(worst).toBeLessThan(1);
    }
  });
});

describe('the hand on the chain (HandHold)', () => {
  it('grip damps the swing relative to the hand: a gripped head settles, a free one keeps swinging', () => {
    const a: Vec3 = [0, 2, 0];
    let free = swungOut(a), held = swungOut(a);
    for (let i = 0; i < 30; i++) {
      free = stepCenserHead(free, a, 1 / 60, OPEN);
      held = stepCenserHead(held, a, 1 / 60, OPEN, undefined, CENSER_HEAD.ropeLen, { grip: 14, drive: null });
    }
    expect(speed(held)).toBeLessThan(0.3 * speed(free));
  });
  it('grip carries the head WITH a moving hand rather than stopping it', () => {
    let h = makeCenserHead([0, 2, 0]);
    const v = 1.5;   // m/s, the hand walking the knot along +x
    for (let i = 1; i <= 60; i++) {
      h = stepCenserHead(h, [v * i / 60, 2, 0], 1 / 60, OPEN, undefined, CENSER_HEAD.ropeLen, { grip: 14, drive: null });
    }
    expect(h.vel[0]).toBeCloseTo(v, 1);
  });
  it('the drive lifts a slow head up to its floor round the anchor, in its plane, and never brakes a faster one', () => {
    const a: Vec3 = [0, 2, 0];
    const drive = { normal: [0, 0, 1] as Vec3, speed: 6, gain: 8, maxAccel: 40 };
    let h = makeCenserHead(a);
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      h = stepCenserHead(h, a, 1 / 60, OPEN, undefined, CENSER_HEAD.ropeLen, { grip: 0, drive });
      peak = Math.max(peak, speed(h));
      expect(Math.abs(h.pos[2])).toBeLessThan(1e-9);   // stays in the drive's plane (z = 0)
    }
    expect(peak).toBeGreaterThan(5.5);
    // A head already going faster than the floor is not slowed by it.
    const fast: CenserHead = { ...swungOut(a), pos: [a[0], a[1] - CENSER_HEAD.ropeLen, a[2]], vel: [12, 0, 0] };
    const d1 = stepCenserHead(fast, a, 1 / 240, OPEN, undefined, CENSER_HEAD.ropeLen, { grip: 0, drive });
    const f1 = stepCenserHead(fast, a, 1 / 240, OPEN);
    expect(speed(d1)).toBeCloseTo(speed(f1), 9);
  });
});
