```typescript
import { describe, it, expect } from 'vitest';

class Vec2 {
  public readonly x: number;
  public readonly y: number;

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
    return Math.sqrt(this.x * this.x + this.y * this.y);
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

describe('Vec2', () => {
  describe('constructor', () => {
    it('should set x and y', () => {
      const v = new Vec2(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });
  });

  describe('add', () => {
    it('should add two vectors', () => {
      const v1 = new Vec2(1, 2);
      const v2 = new Vec2(3, 4);
      const result = v1.add(v2);
      expect(result.x).toBe(4);
      expect(result.y).toBe(6);
    });

    it('should not modify original vector', () => {
      const v1 = new Vec2(1, 2);
      const v2 = new Vec2(3, 4);
      v1.add(v2);
      expect(v1.x).toBe(1);
      expect(v1.y).toBe(2);
    });
  });

  describe('sub', () => {
    it('should subtract two vectors', () => {
      const v1 = new Vec2(5, 6);
      const v2 = new Vec2(3, 4);
      const result = v1.sub(v2);
      expect(result.x).toBe(2);
      expect(result.y).toBe(2);
    });

    it('should not modify original vector', () => {
      const v1 = new Vec2(1, 2);
      const v2 = new Vec2(3, 4);
      v1.sub(v2);
      expect(v1.x).toBe(1);
      expect(v1.y).toBe(2);
    });
  });

  describe('mul', () => {
    it('should multiply by scalar', () => {
      const v = new Vec2(2, 3);
      const result = v.mul(3);
      expect(result.x).toBe(6);
      expect(result.y).toBe(9);
    });

    it('should not modify original vector', () => {
      const v = new Vec2(2, 3);
      v.mul(3);
      expect(v.x).toBe(2);
      expect(v.y).toBe(3);
    });
  });

  describe('len', () => {
    it('should calculate length', () => {
      const v = new Vec2(3, 4);
      expect(v.len()).toBe(5);
    });

    it('should calculate zero length for zero vector', () => {
      const v = new Vec2(0, 0);
      expect(v.len()).toBe(0);
    });

    it('should calculate length for negative components', () => {
      const v = new Vec2(-3, -4);
      expect(v.len()).toBe(5);
    });
  });

  describe('lenSq', () => {
    it('should calculate squared length', () => {
      const v = new Vec2(3, 4);
      expect(v.lenSq()).toBe(25);
    });

    it('should be equal to len() squared', () => {
      const v = new Vec2(5, 12);
      expect(v.lenSq()).toBeCloseTo(v.len() ** 2);
    });
  });

  describe('normalize', () => {
    it('should normalize a vector', () => {
      const v = new Vec2(3, 4);
      const normalized = v.normalize();
      expect(normalized.len()).toBeCloseTo(1);
    });

    it('should not modify original vector', () => {
      const v = new Vec2(3, 4);
      v.normalize();
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });

    it('should return zero vector for zero vector', () => {
      const v = new Vec2(0, 0);
      const normalized = v.normalize();
      expect(normalized.x).toBe(0);
      expect(normalized.y).toBe(0);
    });
  });

  describe('dot', () => {
    it('should calculate dot product', () => {
      const v1 = new Vec2(1, 2);
      const v2 = new Vec3(3, 4);
      expect(v1.dot(v2)).toBe(11);
    });

    it('should calculate dot product with negative values', () => {
      const v1 = new Vec2(1, -2);
      const v2 = new Vec2(3, 4);
      expect(v1.dot(v2)).toBe(-5);
    });

    it('should be commutative', () => {
      const v1 = new Vec2(1, 2);
      const v2 = new Vec2(3, 4);
      expect(v1.dot(v2)).toBe(v2.dot(v1));
    });
  });

  describe('lerp', () => {
    it('should lerp between two vectors', () => {
      const v1 = new Vec2(0, 0);
      const v2 = new Vec2(10, 10);
      const result = v1.lerp(v2, 0.5);
      expect(result.x).toBe(5);
      expect(result.y).toBe(5);
    });

    it('should return start vector when t is 0', () => {
      const v1 = new Vec2(0, 0);
      const v2 = new Vec2(10, 10);
      const result = v1.lerp(v2, 0);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('should return end vector when t is 1', () => {
      const v1 = new Vec2(0, 0);
      const v2 = new Vec2(10, 10);
      const result = v1.lerp(v2, 1);
      expect(result.x).toBe(10);
      expect(result.y).toBe(10);
    });

    it('should not modify original vectors', () => {
      const v1 = new Vec2(0, 0);
      const v2 = new Vec2(10, 10);
      v1.lerp(v2, 0.5);
      expect(v1.x).toBe(0);
      expect(v1.y).toBe(0);
      expect(v2.x).toBe(10);
      expect(v2.y).toBe(10);
    });
  });

  describe('dist', () => {
    it('should calculate distance between two vectors', () => {
      const v1 = new Vec2(0, 0);
      const v2 = new Vec2(3, 4);
      expect(v1.dist(v2)).toBe(5);
    });

    it('should be symmetric', () => {
      const v1 = new Vec2(1, 2);
      const v2 = new Vec2(4, 6);
      expect(v1.dist(v2)).toBeCloseTo(v2.dist(v1));
    });

    it('should return zero for same vector', () => {
      const v = new Vec2(1, 2);
      expect(v.dist(v)).toBe(0);
    });
  });

  describe('angle', () => {
    it('should calculate angle', () => {
      const v = new Vec2(1, 0);
      expect(v.angle()).toBeCloseTo(0);
    });

    it('should calculate angle for UP', () => {
      const v = new Vec2(0, 1);
      expect(v.angle()).toBeCloseTo(Math.PI / 2);
    });

    it('should calculate angle for negative X', () => {
      const v = new Vec2(-1, 0);
      expect(v.angle()).toBeCloseTo(Math.PI);
    });
  });

  describe('rotate', () => {
    it('should rotate a vector by 90 degrees', () => {
      const v = new Vec2(1, 0);
      const result = v.rotate(Math.PI / 2);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(1);
    });

    it('should rotate a vector by 180 degrees', () => {
      const v = new Vec2(1, 0);
      const result = v.rotate(Math.PI);
      expect(result.x).toBeCloseTo(-1);
      expect(result.y).toBeCloseTo(0);
    });

    it('should not modify original vector', () => {
      const v = new Vec2(1, 0);
      v.rotate(Math.PI / 2);
      expect(v.x).toBe(1);
      expect(v.y).toBe(0);
    });
  });

  describe('equals', () => {
    it('should return true for equal vectors', () => {
      const v1 = new Vec2(1, 2);
      const v2 = new Vec2(1, 2);
      expect(v1.equals(v2)).toBe(true);
    });

    it('should return false for unequal vectors', () => {
      const v1 = new Vec2(1, 2);
      const v2 = new Vec2(3, 4);
      expect(v1.equals(v2)).toBe(false);
    });

    it('should return false for different types', () => {
      const v1 = new Vec2(1, 2);
      const v2 = new Vec2(1, 3);
      expect(v1.equals(v2)).toBe(false);
    });
  });

  describe('clone', () => {
    it('should create a copy of the vector', () => {
      const v1 = new Vec2(1, 2);
      const v2 = v1.clone();
      expect(v2.x).toBe(1);
      expect(v2.y).toBe(2);
    });

    it('should not be the same reference', () => {
      const v1 = new Vec2(1, 2);
      const v2 = v1.clone();
      expect(v1).not.toBe(v2);
    });

    it('should not be affected by modifications to original', () => {
      const v1 = new Vec2(1, 2);
      const v2 = v1.clone();
      v1.x = 3;
      expect(v2.x).toBe(1);
    });
  });

  describe('fromAngle', () => {
    it('should create a unit vector from angle', () => {
      const v = Vec2.fromAngle(0);
      expect(v.x).toBeCloseTo(1);
      expect(v.y).toBeCloseTo(0);
    });

    it('should create a unit vector for PI/2', () => {
      const v = Vec2.fromAngle(Math.PI / 2);
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(1);
    });

    it('should have length of 1', () => {
      const v = Vec2.fromAngle(Math.PI / 4);
      expect(v.len()).toBeCloseTo(1);
    });
  });

  describe('constants', () => {
    it('should have ZERO constant', () => {
      expect(Vec2.ZERO.x).toBe(0);
      expect(Vec2.ZERO.y).toBe(0);
    });

    it('should have ONE constant', () => {
      expect(Vec2.ONE.x).toBe(1);
      expect(Vec2.ONE.y).toBe(1);
    });

    it('should have UP constant', () => {
      expect(Vec2.UP.x).toBe(0);
      expect(Vec2.UP.y).toBe(1);
    });

    it('should have RIGHT constant', () => {
      expect(Vec2.RIGHT.x).toBe(1);
      expect(Vec2.RIGHT.y).toBe(0);
    });
  });
});
```
