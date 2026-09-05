```typescript
// Vec2.ts
export class Vec2 {
  constructor(readonly x: number, readonly y: number) {}

  add(v: Vec2): Vec2 {
    return new Vec2(this.x + v.x, this.y + v.y);
  }

  sub(v: Vec2): Vec2 {
    return new Vec2(this.x - v.x, this.y - v.y);
  }

  mul(s: number): Vec2 {
    return new Vec2(this.x * s, this.y * s);
  }

  len(): number {
    return Math.hypot(this.x, this.y);
  }

  lenSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  normalize(): Vec2 {
    const l = this.len();
    if (l === 0) return new Vec2(0, 0);
    return new Vec2(this.x / l, this.y / l);
  }

  dot(v: Vec2): number {
    return this.x * v.x + this.y * v.y;
  }

  lerp(v: Vec2, t: number): Vec2 {
    return new Vec2(
      this.x + (v.x - this.x) * t,
      this.y + (v.y - this.y) * t,
    );
  }

  dist(v: Vec2): number {
    return this.sub(v).len();
  }

  angle(): number {
    return Math.atan2(this.y, this.x);
  }

  rotate(rad: number): Vec2 {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return new Vec2(this.x * c - this.y * s, this.x * s + this.y * c);
  }

  equals(v: Vec2): boolean {
    return this.x === v.x && this.y === v.y;
  }

  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  static fromAngle(rad: number): Vec2 {
    return new Vec2(Math.cos(rad), Math.sin(rad));
  }

  static readonly ZERO = new Vec2(0, 0);
  static readonly ONE = new Vec2(1, 1);
  static readonly UP = new Vec2(0, 1);
  static readonly RIGHT = new Vec2(1, 0);
}
```

```typescript
// Vec2.test.ts
import { describe, it, expect } from 'vitest';
import { Vec2 } from './Vec2';

describe('Vec2', () => {
  it('constructor', () => {
    const v = new Vec2(3, 4);
    expect(v.x).toBe(3);
    expect(v.y).toBe(4);
  });

  it('add', () => {
    expect(new Vec2(1, 2).add(new Vec2(3, 4))).toStrictEqual(new Vec2(4, 6));
  });

  it('sub', () => {
    expect(new Vec2(5, 6).sub(new Vec2(1, 2))).toStrictEqual(new Vec2(4, 4));
  });

  it('mul', () => {
    expect(new Vec2(2, 3).mul(4)).toStrictEqual(new Vec2(8, 12));
  });

  it('len', () => {
    expect(new Vec2(3, 4).len()).toBeCloseTo(5);
  });

  it('lenSq', () => {
    expect(new Vec2(3, 4).lenSq()).toBe(25);
  });

  it('normalize', () => {
    const v = new Vec2(3, 4).normalize();
    expect(v.x).toBeCloseTo(0.6);
    expect(v.y).toBeCloseTo(0.8);
  });

  it('normalize zero vector', () => {
    expect(Vec2.ZERO.normalize()).toStrictEqual(Vec2.ZERO);
  });

  it('dot', () => {
    expect(new Vec2(1, 2).dot(new Vec2(3, 4))).toBe(11);
  });

  it('lerp', () => {
    const a = new Vec2(0, 0);
    const b = new Vec2(10, 20);
    expect(a.lerp(b, 0.5)).toStrictEqual(new Vec2(5, 10));
    expect(a.lerp(b, 1)).toStrictEqual(b);
    expect(a.lerp(b, 0)).toStrictEqual(a);
  });

  it('dist', () => {
    expect(new Vec2(0, 0).dist(new Vec2(3, 4))).toBeCloseTo(5);
  });

  it('angle', () => {
    expect(Vec2.RIGHT.angle()).toBeCloseTo(0);
    expect(Vec2.UP.angle()).toBeCloseTo(Math.PI / 2);
  });

  it('rotate', () => {
    const r = Vec2.RIGHT.rotate(Math.PI / 2);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
  });

  it('equals', () => {
    expect(new Vec2(1, 2).equals(new Vec2(1, 2))).toBe(true);
    expect(new Vec2(1, 2).equals(new Vec2(2, 1))).toBe(false);
  });

  it('clone', () => {
    const v = new Vec2(1, 2);
    const c = v.clone();
    expect(c).toStrictEqual(v);
    expect(c).not.toBe(v);
  });

  it('fromAngle', () => {
    const v = Vec2.fromAngle(0);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
  });

  it('static constants', () => {
    expect(Vec2.ZERO).toStrictEqual(new Vec2(0, 0));
    expect(Vec2.ONE).toStrictEqual(new Vec2(1, 1));
    expect(Vec2.UP).toStrictEqual(new Vec2(0, 1));
    expect(Vec2.RIGHT).toStrictEqual(new Vec2(1, 0));
  });

  it('immutability', () => {
    const a = new Vec2(1, 2);
    const b = new Vec2(3, 4);
    const c = a.add(b);
    expect(c).not.toBe(a);
    expect(c).not.toBe(b);
    expect(a.x).toBe(1);
    expect(b.x).toBe(3);
  });
});
```

Run with `npx vitest run`. The class exposes `readonly` fields so internal mutation is prevented, and all methods return new instances rather than modifying `this`.
