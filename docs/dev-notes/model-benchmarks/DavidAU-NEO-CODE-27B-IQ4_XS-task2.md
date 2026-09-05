```typescript
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
    const len = this.len();
    if (len === 0) return new Vec2(0, 0);
    return new Vec2(this.x / len, this.y / len);
  }

  dot(v: Vec2): number {
    return this.x * v.x + this.y * v.y;
  }

  lerp(v: Vec2, t: number): Vec2 {
    return new Vec2(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t);
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
import { describe, it, expect } from 'vitest';
import { Vec2 } from './Vec2';

describe('Vec2', () => {
  it('should create a new Vec2 with default values', () => {
    const v = new Vec2();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });

  it('should create a new Vec2 with specified values', () => {
    const v = new Vec2(3, 4);
    expect(v.x).toBe(3);
    expect(v.y).toBe(4);
  });

  it('should add two Vec2s', () => {
    const v1 = new Vec2(1, 2);
    const v2 = new Vec2(3, 4);
    const result = v1.add(v2);
    expect(result.x).toBe(4);
    expect(result.y).toBe(6);
    expect(result).not.toBe(v1);
    expect(result).not.toBe(v2);
  });

  it('should subtract two Vec2s', () => {
    const v1 = new Vec2(5, 6);
    const v2 = new Vec2(1, 2);
    const result = v1.sub(v2);
    expect(result.x).toBe(4);
    expect(result.y).toBe(4);
    expect(result).not.toBe(v1);
    expect(result).not.toBe(v2);
  });

  it('should multiply Vec2 by scalar', () => {
    const v = new Vec2(2, 3);
    const result = v.mul(2);
    expect(result.x).toBe(4);
    expect(result.y).toBe(6);
    expect(result).not.toBe(v);
  });

  it('should calculate length', () => {
    const v = new Vec2(3, 4);
    expect(v.len()).toBeCloseTo(5);
  });

  it('should calculate squared length', () => {
    const v = new Vec2(3, 4);
    expect(v.lenSq()).toBe(25);
  });

  it('should normalize Vec2', () => {
    const v = new Vec2(3, 4);
    const normalized = v.normalize();
    expect(normalized.len()).toBeCloseTo(1);
    expect(normalized).not.toBe(v);
  });

  it('should handle zero vector normalization', () => {
    const v = Vec2.ZERO;
    const normalized = v.normalize();
    expect(normalized.x).toBe(0);
    expect(normalized.y).toBe(0);
  });

  it('should calculate dot product', () => {
    const v1 = new Vec2(1, 2);
    const v2 = new Vec2(3, 4);
    expect(v1.dot(v2)).toBe(11);
  });

  it('should perform linear interpolation', () => {
    const v1 = new Vec2(0, 0);
    const v2 = new Vec2(10, 10);
    const result = v1.lerp(v2, 0.5);
    expect(result.x).toBe(5);
    expect(result.y).toBe(5);
    expect(result).not.toBe(v1);
    expect(result).not.toBe(v2);
  });

  it('should calculate distance between two Vec2s', () => {
    const v1 = new Vec2(0, 0);
    const v2 = new Vec2(3, 4);
    expect(v1.dist(v2)).toBeCloseTo(5);
  });

  it('should calculate angle', () => {
    const v = new Vec2(1, 1);
    expect(v.angle()).toBeCloseTo(Math.PI / 4);
  });

  it('should rotate Vec2', () => {
    const v = new Vec2(1, 0);
    const rotated = v.rotate(Math.PI / 2);
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(1);
    expect(rotated).not.toBe(v);
  });

  it('should check equality', () => {
    const v1 = new Vec2(1, 2);
    const v2 = new Vec2(1, 2);
    const v3 = new Vec2(2, 3);
    expect(v1.equals(v2)).toBe(true);
    expect(v1.equals(v3)).toBe(false);
  });

  it('should clone Vec2', () => {
    const v = new Vec2(1, 2);
    const cloned = v.clone();
    expect(cloned).not.toBe(v);
    expect(cloned.x).toBe(v.x);
    expect(cloned.y).toBe(v.y);
  });

  it('should create Vec2 from angle', () => {
    const v = Vec2.fromAngle(0);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
  });

  it('should have correct static constants', () => {
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
