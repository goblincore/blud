// src/lab/sdf-zombie/webgpu/game-arms-math.test.ts
import { describe, expect, it } from 'vitest';
import { ARM_NODES, FORE_LEN_M, UPPER_LEN_M, armBasis, armIk, armMaterialKind, type V3 } from './game-arms-math';

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];

describe('armBasis', () => {
  const dir: V3 = [-0.4, -0.5, 0.3];
  const hint: V3 = [0, 0, 1];
  const b = armBasis(dir, hint);

  it('points local +Y along the hand-to-elbow direction, unit length', () => {
    expect(len(b.y)).toBeCloseTo(1, 9);
    const d = len(dir);
    expect(dot(b.y, [dir[0] / d, dir[1] / d, dir[2] / d])).toBeCloseTo(1, 9);
  });
  it('is orthonormal and right-handed', () => {
    for (const v of [b.x, b.y, b.z]) expect(len(v)).toBeCloseTo(1, 9);
    expect(dot(b.x, b.y)).toBeCloseTo(0, 9);
    expect(dot(b.y, b.z)).toBeCloseTo(0, 9);
    expect(dot(b.x, b.z)).toBeCloseTo(0, 9);
    expect(dot(cross(b.x, b.y), b.z)).toBeCloseTo(1, 9);
  });
  it('turns the dorsal side (+Z) toward the hint as far as the arm allows', () => {
    // z is the hint with its along-arm component removed: positive dot, and
    // no other unit vector perpendicular to y is closer to the hint.
    expect(dot(b.z, hint)).toBeGreaterThan(0);
    const h = len(dir);
    const along = dot(hint, b.y);
    const rest: V3 = [hint[0] - b.y[0] * along, hint[1] - b.y[1] * along, hint[2] - b.y[2] * along];
    const r = len(rest);
    expect(dot(b.z, [rest[0] / r, rest[1] / r, rest[2] / r])).toBeCloseTo(1, 9);
    expect(h).toBeGreaterThan(0);
  });
  it('still returns an orthonormal basis when the hint is parallel to the arm', () => {
    const p = armBasis([0, 0, 2], [0, 0, 1]);
    for (const v of [p.x, p.y, p.z]) expect(len(v)).toBeCloseTo(1, 9);
    expect(dot(p.y, p.z)).toBeCloseTo(0, 9);
    expect(dot(cross(p.x, p.y), p.z)).toBeCloseTo(1, 9);
  });
});

describe('armMaterialKind', () => {
  it('maps every GLB material name, and strips Blender suffixes', () => {
    expect(armMaterialKind('Skin')).toBe('skin');
    expect(armMaterialKind('Skin.001')).toBe('skin');
    expect(armMaterialKind('Leather')).toBe('leather');
    expect(armMaterialKind('Steel')).toBe('steel');
    expect(armMaterialKind('Brass')).toBe('brass');
    expect(armMaterialKind('Band')).toBe('band');
    expect(armMaterialKind('WatchBody')).toBe('watchBody');
    expect(armMaterialKind('Screen')).toBe('screen');
  });
  it('is null for anything else, so the loader can be loud about it', () => {
    expect(armMaterialKind('Wood')).toBeNull();
    expect(armMaterialKind('')).toBeNull();
  });
});

describe('ARM_NODES', () => {
  it('names both arms, four locators each, the upper-arm nodes, and the screen', () => {
    expect([...ARM_NODES].sort()).toEqual([
      'Arm_L', 'Arm_R', 'Elbow_L', 'Elbow_R', 'Hand_L', 'Hand_R',
      'Shoulder_L', 'Shoulder_R', 'Upper_L', 'Upper_R', 'Watch_Screen', 'Wrist_L', 'Wrist_R',
    ]);
  });
});

describe('armIk', () => {
  const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const down: V3 = [-1, -0.6, 0];

  it('keeps the forearm its own length whatever the reach', () => {
    for (const shoulder of [[-0.22, -0.30, 0.10], [-0.05, -0.10, -0.30], [-0.9, -0.9, 0.9]] as V3[]) {
      const hand: V3 = [-0.02, -0.18, -0.45];
      const e = armIk(hand, shoulder, FORE_LEN_M, UPPER_LEN_M, down);
      expect(len(sub(e, hand))).toBeCloseTo(FORE_LEN_M, 9);
    }
  });
  it('meets the shoulder with the upper arm when in reach, bending toward the hint', () => {
    const hand: V3 = [-0.05, -0.05, -0.18];
    const shoulder: V3 = [-0.22, -0.30, 0.10];
    expect(len(sub(shoulder, hand))).toBeLessThan(FORE_LEN_M + UPPER_LEN_M);
    const e = armIk(hand, shoulder, FORE_LEN_M, UPPER_LEN_M, down);
    expect(len(sub(e, shoulder))).toBeCloseTo(UPPER_LEN_M, 9);
    // the elbow sits on the hint's side of the hand-shoulder line
    const line = sub(shoulder, hand); const L = len(line);
    const u: V3 = [line[0] / L, line[1] / L, line[2] / L];
    const eh = sub(e, hand); const along = dot(eh, u);
    const perp: V3 = [eh[0] - u[0] * along, eh[1] - u[1] * along, eh[2] - u[2] * along];
    expect(dot(perp, down)).toBeGreaterThan(0);
  });
  it('goes straight when the shoulder is out of reach', () => {
    const hand: V3 = [0, -0.18, -0.45];
    const shoulder: V3 = [-0.9, -0.9, 0.9];
    const e = armIk(hand, shoulder, FORE_LEN_M, UPPER_LEN_M, down);
    const line = sub(shoulder, hand); const L = len(line);
    expect(dot(sub(e, hand), [line[0] / L, line[1] / L, line[2] / L])).toBeCloseTo(FORE_LEN_M, 9);
  });
  it('does not blow up with the hint along the arm or the hand on the shoulder', () => {
    const e1 = armIk([0, 0, 0], [0, 0, 0.4], FORE_LEN_M, UPPER_LEN_M, [0, 0, 1]);
    expect(len(e1)).toBeCloseTo(FORE_LEN_M, 9);
    const e2 = armIk([0, 0, 0], [0, 0, 0], FORE_LEN_M, UPPER_LEN_M, [0, -1, 0]);
    expect(len(e2)).toBeCloseTo(FORE_LEN_M, 9);
  });
});
