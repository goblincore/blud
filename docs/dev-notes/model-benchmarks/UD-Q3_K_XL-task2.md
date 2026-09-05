```typescript
import { describe, it, expect } from 'vitest';

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
    const len = this.len();
    if (len === 0) return new Vec2(0, 0);
    return this.mul(1 / len);
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

  static get ZERO(): Vec2 {
    return new Vec2(0, 0);
  }

  static get ONE(): Vec2 {
    return new Vec2(1, 1);
  }

  static get UP(): Vec2 {
    return new Vec2(0, 1);
  }

  static get RIGHT(): Vec2 {
    return new Vec2(1, 0);
  }
}

describe('Vec2', () => {
  it('should construct correctly', () => {
    const v = new Vec2(3, 4);
    expect(v.x).toBe(3);
    expect(v.y).toBe(4);
  });

  it('should add vectors', () => {
    const a = new Vec2(1, 2);
    const b = new Vec2(3, 4);
    const c = a.add(b);
    expect(c.x).toBe(4);
    expect(c.y).toBe(6);
    // Immutability check
    expect(a.x).toBe(1);
    expect(a.y).toBe(2);
  });

  it('should subtract vectors', () => {
    const a = new Vec2(5, 6);
    const b = new Vec2(1, 2);
    const c = a.sub(b);
    expect(c.x).toBe(4);
    expect(c.y).toBe(4);
  });

  it('should multiply by scalar', () => {
    const v = new Vec2(2, 3);
    const m = v.mul(3);
    expect(m.x).toBe(6);
    expect(m.y).toBe(9);
  });

  it('should calculate length', () => {
    const v = new Vec2(3, 4);
    expect(v.len()).toBeCloseTo(5);
  });

  it('should calculate squared length', () => {
    const v = new Vec2(3, 4);
    expect(v.lenSq()).toBe(25);
  });

  it('should normalize', () => {
    const v = new Vec2(3, 4);
    const n = v.normalize();
    expect(n.len()).toBeCloseTo(1);
    expect(n.x).toBeCloseTo(0.6);
    expect(n.y).toBeCloseTo(0.8);
  });

  it('should normalize zero vector', () => {
    const v = Vec2.ZERO;
    const n = v.normalize();
    expect(n.x).toBe(0);
    expect(n.y).toBe(0);
  });

  it('should calculate dot product', () => {
    const a = new Vec2(1, 2);
    const b = new Vec2(3, 4);
    expect(a.dot(b)).toBe(11);
  });

  it('should lerp', () => {
    const a = new Vec2(0, 0);
    const b = new Vec2(10, 10);
    const mid = a.lerp(b, 0.5);
    expect(mid.x).toBe(5);
    expect(mid.y).toBe(5);
  });

  it('should calculate distance', () => {
    const a = new Vec2(0, 0);
    const b = new Vec2(3, 4);
    expect(a.dist(b)).toBeCloseTo(5);
  });

  it('should calculate angle', () => {
    const right = new Vec2(1, 0);
    expect(right.angle()).toBeCloseTo(0);
    const up = new Vec2(0, 1);
    expect(up.angle()).toBeCloseTo(Math.PI / 2);
  });

  it('should rotate', () => {
    const right = new Vec2(1, 0);
    const rotated = right.rotate(Math.PI / 2);
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(1);
  });

  it('should check equality', () => {
    const a = new Vec2(1, 2);
    const b = new Vec2(1, 2);
    const c = new Vec2(3, 4);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('should clone', () => {
    const original = new Vec2(1, 2);
    const cloned = original.clone();
    expect(cloned.equals(original)).toBe(true);
    cloned.x = 3;
    expect(original.x).toBe(1);
  });

  it('should create from angle', () => {
    const v = Vec2.fromAngle(0);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
  });

  it('should have static constants', () => {
    expect(Vec2.ZERO.equals(new Vec2(0, 0))).toBe(true);
    expect(Vec2.ONE.equals(new Vec2(1, 1))).toBe(true);
    expect(Vec2.UP.equals(new Vec2(0, 1))).toBe(true);
    expect(Vec2.RIGHT.equals(new Vec2(1, 0))).toBe(true);
  });

  it('should be immutable - original not modified after operations', () => {
    const a = new Vec2(1, 1);
    const b = new Vec2(2, 2);
    const originalA = a.clone();
    const originalB = b.clone();

    a.add(b);
    b.sub(a);
    a.mul(2);
    b.normalize();
    a.dot(b);
    a.lerp(b, 0.5);
    a.dist(b);
    a.angle();
    a.rotate(Math.PI);
    a.equals(b);
    a.clone();

    expect(a.equals(originalA)).toBe(true);
    expect(b.equals(originalB)).toBe(true);
  });
});
```
