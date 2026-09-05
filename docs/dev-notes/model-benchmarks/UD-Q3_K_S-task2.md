```typescript
// Vec2.ts
export class Vec2 {
  public readonly x: number;
  public readonly y: number;

  constructor(x: number = 0, y: number = 0) {
    this.x = x;
    this.y = y;
  }

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
    return Math.sqrt(this.lenSq());
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
      this.y + (v.y - this.y) * t
    );
  }

  dist(v: Vec2): number {
    return this.sub(v).len();
  }

  angle(): number {
    return Math.atan2(this.y, this.x);
  }

  rotate(rad: number): Vec2 {
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return new Vec2(
      this.x * cos - this.y * sin,
      this.x * sin + this.y * cos
    );
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
  it('constructor defaults', () => {
    const v = new Vec2();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });

  it('constructor sets values', () => {
    const v = new Vec2(3, 4);
    expect(v.x).toBe(3);
    expect(v.y).toBe(4);
  });

  it('add', () => {
    const a = new Vec2(1, 2);
    const b = new Vec2(3, 4);
    const c = a.add(b);
    expect(c.x).toBe(4);
    expect(c.y).toBe(6);
    // Immutability
    expect(a.x).toBe(1);
    expect(a.y).toBe(2);
  });

  it('sub', () => {
    const a = new Vec2(5, 6);
    const b = new Vec2(3, 4);
    const c = a.sub(b);
    expect(c.x).toBe(2);
    expect(c.y).toBe(2);
  });

  it('mul', () => {
    const v = new Vec2(2, 3);
    const c = v.mul(4);
    expect(c.x).toBe(8);
    expect(c.y).toBe(12);
  });

  it('lenSq', () => {
    const v = new Vec2(3, 4);
    expect(v.lenSq()).toBe(25);
  });

  it('len', () => {
    const v = new Vec2(3, 4);
    expect(v.len()).toBe(5);
  });

  it('normalize', () => {
    const v = new Vec2(0, 10);
    const n = v.normalize();
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(1);
  });

  it('normalize zero vector', () => {
    const v = new Vec2(0, 0);
    const n = v.normalize();
    expect(n.x).toBe(0);
    expect(n.y).toBe(0);
  });

  it('dot', () => {
    const a = new Vec2(1, 2);
    const b = new Vec2(3, 4);
    expect(a.dot(b)).toBe(1 * 3 + 2 * 4); // 11
  });

  it('lerp', () => {
    const a = new Vec2(0, 0);
    const b = new Vec2(10, 10);
    const c = a.lerp(b, 0.5);
    expect(c.x).toBeCloseTo(5);
    expect(c.y).toBeCloseTo(5);
  });

  it('dist', () => {
    const a = new Vec2(0, 0);
    const b = new Vec2(3, 4);
    expect(a.dist(b)).toBe(5);
  });

  it('angle', () => {
    const right = new Vec2(1, 0);
    expect(right.angle()).toBeCloseTo(0);
    const up = new Vec2(0, 1);
    expect(up.angle()).toBeCloseTo(Math.PI / 2);
  });

  it('rotate', () => {
    const right = new Vec2(1, 0);
    const up = right.rotate(Math.PI / 2);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(1);
  });

  it('equals', () => {
    const a = new Vec2(1, 2);
    const b = new Vec2(1, 2);
    const c = new Vec2(3, 4);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('clone', () => {
    const a = new Vec2(1, 2);
    const b = a.clone();
    expect(b.x).toBe(1);
    expect(b.y).toBe(2);
    expect(b).not.toBe(a);
  });

  it('fromAngle', () => {
    const v = Vec2.fromAngle(0);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
  });

  it('constants', () => {
    expect(Vec2.ZERO.x).toBe(0);
    expect(Vec2.ZERO.y).toBe(0);
    expect(Vec2.ONE.x).toBe(1);
    expect(Vec2.ONE.y).toBe(1);
    expect(Vec2.UP.x).toBe(0);
    expect(Vec2.UP.y).toBe(1);
    expect(Vec2.RIGHT.x).toBe(1);
    expect(Vec2.RIGHT.y).toBe(0);
  });

  it('immutability of operations', () => {
    const a = new Vec2(1, 1);
    const b = new Vec2(2, 2);
    const c = a.add(b);
    expect(c.x).toBe(3);
    expect(c.y).toBe(3);
    expect(a.x).toBe(1);
    expect(a.y).toBe(1);
    expect(b.x).toBe(2);
    expect(b.y).toBe(2);
  });
});
```
