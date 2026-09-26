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
});
