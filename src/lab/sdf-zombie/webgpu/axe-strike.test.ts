// src/lab/sdf-zombie/webgpu/axe-strike.test.ts
import { describe, expect, it } from 'vitest';
import { AXE_CALIBRE, AXE_CUT, AXE_HIT, axeCutSeg } from './axe-strike';
import { strikeActorsFrom } from './flail-strike';
import { CUT, CUT_SHADE, ROD_CALIBRE } from '../cut-wound';
import { prim } from '../head-pop';
import type { Body } from '../validate';
import type { Vec3 } from '../types';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

describe('axeCutSeg: the chop\'s blade line, in world, centred on the hit', () => {
  const eye: Vec3 = [0, 1.62, 0], point: Vec3 = [0, 1.3, -1];
  const view: Vec3 = (() => { const d = sub(point, eye); const l = len(d); return [d[0] / l, d[1] / l, d[2] / l]; })();
  it('H at yaw 0: a vertical segment, top end first, 2 x halfLen long, midpoint on the hit, across the view', () => {
    const s = axeCutSeg(eye, 0, 0, 'H', point, view);
    const d = sub(s.b, s.a);
    expect(len(d)).toBeCloseTo(2 * AXE_CUT.halfLen, 6);
    expect(s.a[1]).toBeGreaterThan(s.b[1]);
    expect(Math.abs(d[0])).toBeLessThan(1e-9);
    const mid: Vec3 = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2];
    expect(len(sub(mid, point))).toBeLessThan(1e-9);
    expect(Math.abs(dot(d, s.view))).toBeLessThan(1e-9);
    expect(s.view).toEqual(view);
  });
  it('R at yaw 0 runs from upper right to lower left (world +x is right at yaw 0)', () => {
    const s = axeCutSeg(eye, 0, 0, 'R', point, view);
    expect(s.a[0]).toBeGreaterThan(s.b[0]);
    expect(s.a[1]).toBeGreaterThan(s.b[1]);
  });
  it('L at yaw 0 runs from upper left to lower right', () => {
    const s = axeCutSeg(eye, 0, 0, 'L', point, view);
    expect(s.a[0]).toBeLessThan(s.b[0]);
    expect(s.a[1]).toBeGreaterThan(s.b[1]);
  });
  it('turned (yaw 1.1, pitch 0): R runs right-to-left across the aim\'s right vector, L left-to-right', () => {
    const yaw = 1.1;
    const right: Vec3 = [Math.cos(yaw), 0, Math.sin(yaw)];
    const v: Vec3 = [Math.sin(yaw), 0, -Math.cos(yaw)];
    const p: Vec3 = [eye[0] + v[0], eye[1] + v[1], eye[2] + v[2]];
    const r = axeCutSeg(eye, yaw, 0, 'R', p, v), l = axeCutSeg(eye, yaw, 0, 'L', p, v);
    expect(dot(sub(r.b, r.a), right)).toBeLessThan(0);
    expect(r.a[1]).toBeGreaterThan(r.b[1]);
    expect(dot(sub(l.b, l.a), right)).toBeGreaterThan(0);
    expect(l.a[1]).toBeGreaterThan(l.b[1]);
  });
  it('degenerate: the view lying along the H blade (straight down) still gives a full-length cut across the view', () => {
    const down: Vec3 = [0, -1, 0];
    const p: Vec3 = [eye[0], eye[1] - 1, eye[2]];
    const s = axeCutSeg(eye, 0, 0, 'H', p, down);
    const d = sub(s.b, s.a);
    expect(len(d)).toBeCloseTo(2 * AXE_CUT.halfLen, 6);
    expect(Math.abs(dot(d, down))).toBeLessThan(1e-9);
    const mid: Vec3 = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2];
    expect(len(sub(mid, p))).toBeLessThan(1e-9);
  });
  it('turned and pitched: still perpendicular to the view, still centred, still 2 x halfLen', () => {
    const yaw = 1.1, pitch = -0.4;
    const v: Vec3 = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    const p: Vec3 = [eye[0] + v[0], eye[1] + v[1], eye[2] + v[2]];
    for (const side of ['H', 'R', 'L'] as const) {
      const s = axeCutSeg(eye, yaw, pitch, side, p, v);
      expect(Math.abs(dot(sub(s.b, s.a), v))).toBeLessThan(1e-9);
      expect(len(sub(s.b, s.a))).toBeCloseTo(2 * AXE_CUT.halfLen, 6);
      const mid: Vec3 = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, (s.a[2] + s.b[2]) / 2];
      expect(len(sub(mid, p))).toBeLessThan(1e-9);
    }
  });
});

describe('the axe\'s numbers', () => {
  it('the calibre is a deep, wide cut inside the cut model\'s limits', () => {
    expect(AXE_CALIBRE.depth).toBeLessThanOrEqual(CUT.maxDepth);
    expect(AXE_CALIBRE.lip).toBeLessThanOrEqual(CUT_SHADE.maxLipScale);
    expect(AXE_CALIBRE.depth).toBeGreaterThan(ROD_CALIBRE.depth);   // deeper than the rod
    expect(AXE_CALIBRE.lip).toBeGreaterThan(ROD_CALIBRE.lip);       // lippier than the rod
    expect(AXE_CALIBRE.kerf).toBeGreaterThanOrEqual(ROD_CALIBRE.kerf);
    expect(AXE_CALIBRE.kerf).toBeLessThanOrEqual(0.015);            // the widest cut-wound.test.ts measured at this depth and lip
    expect(2 * AXE_CUT.halfLen).toBeGreaterThanOrEqual(CUT.minLen);
    expect(2 * AXE_CUT.halfLen).toBeLessThanOrEqual(CUT.maxLen);
  });
  it('the overhead hits hardest', () => {
    expect(AXE_HIT.H.meterCredit).toBeGreaterThan(AXE_HIT.R.meterCredit);
    expect(AXE_HIT.R).toEqual(AXE_HIT.L);
  });
});

describe('strikeActorsFrom: the strike list the flail and the axe share', () => {
  const torso = prim([0, 1.0, 0], [0, 1.4, 0], 0.15, [1, 1, 1], { limb: 'torso', cluster: 0 });
  const head = prim([0, 1.55, 0], [0, 1.62, 0], 0.1, [1, 1, 1], { limb: 'head', cluster: 1 });
  const body = (alive = true): Body => ({ prims: [torso, head], clusters: [
    { id: 0, limb: 'torso', start: 0, count: 1, center: [0, 1.2, 0], radius: 0.3, alive: true },
    { id: 1, limb: 'head', start: 1, count: 1, center: [0, 1.58, 0], radius: 0.15, alive },
  ] });
  it('one entry per actor with a torso: the torso centre, the body field, and the live head (centre + its own field)', () => {
    const list = strikeActorsFrom([{ id: 7, posed: () => body() }]);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(7);
    expect(list[0]!.centre).toEqual([0, 1.2, 0]);
    expect(list[0]!.head!.centre).toEqual([0, 1.58, 0]);
    expect(list[0]!.field([0, 1.2, 0])).toBeLessThan(0);
    expect(list[0]!.head!.field([0, 1.58, 0])).toBeLessThan(0);    // inside the head
    expect(list[0]!.head!.field([0, 1.2, 0])).toBeGreaterThan(0);   // the head field ignores the torso
  });
  it('a dead head cluster gives no head entry', () => {
    expect(strikeActorsFrom([{ id: 1, posed: () => body(false) }])[0]!.head).toBeUndefined();
  });
  it('an actor with no torso cluster is skipped', () => {
    const noTorso: Body = { prims: [head], clusters: [{ id: 1, limb: 'head', start: 0, count: 1, center: [0, 1.58, 0], radius: 0.15, alive: true }] };
    expect(strikeActorsFrom([{ id: 2, posed: () => noTorso }])).toHaveLength(0);
  });
});
