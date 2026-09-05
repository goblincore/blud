// src/lab/sdf-zombie/webgpu/game-arms-math.test.ts
import { describe, expect, it } from 'vitest';
import { ARM_NODES, armBasis, armMaterialKind, type V3 } from './game-arms-math';

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
  it('names both arms, three locators each, and the screen', () => {
    expect([...ARM_NODES].sort()).toEqual([
      'Arm_L', 'Arm_R', 'Elbow_L', 'Elbow_R', 'Hand_L', 'Hand_R',
      'Watch_Screen', 'Wrist_L', 'Wrist_R',
    ]);
  });
});
