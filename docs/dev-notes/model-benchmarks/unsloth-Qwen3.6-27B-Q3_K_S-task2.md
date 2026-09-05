```typescript
// Vec2.ts
export class Vec2 {
  readonly x: number;
  readonly y: number;

  constructor(x: number, y: number) {
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
  it('constructor initializes coordinates', () => {
    const v = new Vec2(3, 4);
    expect(v.x).toBe(3);
    expect(v.y).toBe(4);
  });

  it('add returns new Vec2 with summed components', () => {
    const a = new Vec2(1, 2);
    const b = new Vec2(3, 4);
    const res = a.add(b);
    expect(res).not.toBe(a);
    expect(res.x).toBe(4);
    expect(res.y).toBe(6);
  });

  it('sub returns new Vec2 with subtracted components', () => {
    const a = new Vec2(5, 6);
    const b = new Vec2(1, 2);
    const res = a.sub(b);
    expect(res.x).toBe(4);
    expect(res.y).toBe(4);
  });

  it('mul returns new Vec2 scaled by scalar', () => {
    const v = new Vec2(2, 3);
    const res = v.mul(2);
    expect(res.x).toBe(4);
    expect(res.y).toBe(6);
  });

  it('lenSq returns sum of squares', () => {
    const v = new Vec2(3, 4);
    expect(v.lenSq()).toBe(25);
  });

  it('len returns Euclidean length', () => {
    const v = new Vec2(3, 4);
    expect(v.len()).toBe(5);
  });

  it('normalize returns unit vector', () => {
    const v = new Vec2(3, 4);
    const n = v.normalize();
    expect(n.len()).toBeCloseTo(1);
    expect(n.x).toBeCloseTo(0.6);
    expect(n.y).toBeCloseTo(0.8);
  });

  it('normalize handles zero vector', () => {
    const v = Vec2.ZERO;
    const n = v.normalize();
    expect(n.x).toBe(0);
    expect(n.y).toBe(0);
  });

  it('dot returns scalar product', () => {
    const a = new Vec2(1, 2);
    const b = new Vec2(3, 4);
    expect(a.dot(b)).toBe(11);
  });

  it('lerp interpolates between vectors', () => {
    const a = new Vec2(0, 0);
    const b = new Vec2(10, 10);
    const res = a.lerp(b, 0.5);
    expect(res.x).toBe(5);
    expect(res.y).toBe(5);
  });

  it('dist returns Euclidean distance', () => {
    const a = new Vec2(0, 0);
    const b = new Vec2(3, 4);
    expect(a.dist(b)).toBe(5);
  });

  it('angle returns atan2(y, x)', () => {
    const v = new Vec2(1, 1);
    expect(v.angle()).toBeCloseTo(Math.PI / 4);
  });

  it('rotate rotates vector by radians', () => {
    const v = Vec2.RIGHT;
    const res = v.rotate(Math.PI / 2);
    expect(res.x).toBeCloseTo(0);
    expect(res.y).toBeCloseTo(1);
  });

  it('equals checks component equality', () => {
    const a = new Vec2(1, 2);
    const b = new Vec2(1, 2);
    const c = new Vec2(1, 3);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('clone returns distinct instance with same values', () => {
    const v = new Vec2(1, 2);
    const c = v.clone();
    expect(c).not.toBe(v);
    expect(c.x).toBe(v.x);
    expect(c.y).toBe(v.y);
  });

  it('fromAngle creates unit vector at angle', () => {
    const v = Vec2.fromAngle(Math.PI / 2);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
  });

  it('static constants are correct', () => {
    expect(Vec2.ZERO.x).toBe(0);
    expect(Vec2.ZERO.y).toBe(0);
    expect(Vec2.ONE.x).toBe(1);
    expect(Vec2.ONE.y).toBe(1);
    expect(Vec2.UP.x).toBe(0);
    expect(Vec2.UP.y).toBe(1);
    expect(Vec2.RIGHT.x).toBe(1);
    expect(Vec2.RIGHT.y).toBe(0);
  });
});
```
