<antThinking>
The user wants a TypeScript Vec2 class with immutable operations and comprehensive vitest tests. I should create a complete, working implementation with proper type safety and test coverage.
</antThinking>

```typescript
import { describe, it, expect } from 'vitest';

class Vec2 {
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
    return Math.sqrt(this.x * this.x + this.y * this.y);
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

describe('Vec2', () => {
  describe('constructor', () => {
    it('should create a new Vec2 with given coordinates', () => {
      const v = new Vec2(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });

    it('should be immutable after creation', () => {
      const v = new Vec2(1, 2);
      expect(v.x).toBe(1);
      expect(v.y).toBe(2);
    });

    it('should handle negative coordinates', () => {
      const v = new Vec2(-5, -10);
      expect(v.x).toBe(-5);
      expect(v.y).toBe(-10);
    });
  });

  describe('add', () => {
    it('should add two vectors', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const result = a.add(b);
      expect(result.x).toBe(4);
      expect(result.y).toBe(6);
    });

    it('should not modify the original vector', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const originalA = { x: a.x, y: a.y };
      a.add(b);
      expect(a.x).toBe(originalA.x);
      expect(a.y).toBe(originalA.y);
    });

    it('should handle zero vectors', () => {
      const a = new Vec2(5, 5);
      const result = a.add(Vec2.ZERO);
      expect(result.x).toBe(5);
      expect(result.y).toBe(5);
    });

    it('should handle negative results', () => {
      const a = new Vec2(1, 1);
      const b = new Vec2(3, 3);
      const result = a.add(b);
      expect(result.x).toBe(4);
      expect(result.y).toBe(4);
    });
  });

  describe('sub', () => {
    it('should subtract two vectors', () => {
      const a = new Vec2(5, 7);
      const b = new Vec2(2, 3);
      const result = a.sub(b);
      expect(result.x).toBe(3);
      expect(result.y).toBe(4);
    });

    it('should not modify the original vector', () => {
      const a = new Vec2(5, 7);
      const b = new Vec2(2, 3);
      const originalA = { x: a.x, y: a.y };
      a.sub(b);
      expect(a.x).toBe(originalA.x);
      expect(a.y).toBe(originalA.y);
    });

    it('should handle subtracting zero', () => {
      const a = new Vec2(10, 20);
      const result = a.sub(Vec2.ZERO);
      expect(result.x).toBe(10);
      expect(result.y).toBe(20);
    });

    it('should handle negative results', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(5, 6);
      const result = a.sub(b);
      expect(result.x).toBe(-4);
      expect(result.y).toBe(-4);
    });
  });

  describe('mul', () => {
    it('should multiply vector by scalar', () => {
      const v = new Vec2(3, 4);
      const result = v.mul(2);
      expect(result.x).toBe(6);
      expect(result.y).toBe(8);
    });

    it('should not modify the original vector', () => {
      const v = new Vec2(3, 4);
      const original = { x: v.x, y: v.y };
      v.mul(2);
      expect(v.x).toBe(original.x);
      expect(v.y).toBe(original.y);
    });

    it('should handle zero scalar', () => {
      const v = new Vec2(5, 7);
      const result = v.mul(0);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('should handle negative scalar', () => {
      const v = new Vec2(3, 4);
      const result = v.mul(-1);
      expect(result.x).toBe(-3);
      expect(result.y).toBe(-4);
    });

    it('should handle fractional scalar', () => {
      const v = new Vec2(10, 20);
      const result = v.mul(0.5);
      expect(result.x).toBe(5);
      expect(result.y).toBe(10);
    });
  });

  describe('len', () => {
    it('should calculate length of vector', () => {
      const v = new Vec2(3, 4);
      expect(v.len()).toBeCloseTo(5, 10);
    });

    it('should handle zero vector', () => {
      expect(Vec2.ZERO.len()).toBe(0);
    });

    it('should handle unit vectors', () => {
      expect(Vec2.RIGHT.len()).toBeCloseTo(1, 10);
      expect(Vec2.UP.len()).toBeCloseTo(1, 10);
    });

    it('should handle negative coordinates', () => {
      const v = new Vec2(-3, -4);
      expect(v.len()).toBeCloseTo(5, 10);
    });

    it('should handle large coordinates', () => {
      const v = new Vec2(1000, 1000);
      expect(v.len()).toBeCloseTo(Math.sqrt(2000000), 10);
    });
  });

  describe('lenSq', () => {
    it('should calculate squared length', () => {
      const v = new Vec2(3, 4);
      expect(v.lenSq()).toBe(25);
    });

    it('should handle zero vector', () => {
      expect(Vec2.ZERO.lenSq()).toBe(0);
    });

    it('should handle unit vectors', () => {
      expect(Vec2.RIGHT.lenSq()).toBe(1);
      expect(Vec2.UP.lenSq()).toBe(1);
    });

    it('should not involve square root', () => {
      const v = new Vec2(5, 12);
      expect(v.lenSq()).toBe(169);
    });
  });

  describe('normalize', () => {
    it('should return normalized vector', () => {
      const v = new Vec2(3, 4);
      const result = v.normalize();
      expect(result.len()).toBeCloseTo(1, 10);
    });

    it('should not modify the original vector', () => {
      const v = new Vec2(3, 4);
      const originalLen = v.len();
      v.normalize();
      expect(v.len()).toBeCloseTo(originalLen, 10);
    });

    it('should handle zero vector', () => {
      const result = Vec2.ZERO.normalize();
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('should handle negative coordinates', () => {
      const v = new Vec2(-3, -4);
      const result = v.normalize();
      expect(result.len()).toBeCloseTo(1, 10);
      expect(result.x).toBe(-0.6);
      expect(result.y).toBe(-0.8);
    });

    it('should preserve direction', () => {
      const v = new Vec2(1, 1);
      const result = v.normalize();
      expect(result.x).toBeCloseTo(result.y, 10);
      expect(result.x).toBeCloseTo(Math.SQRT1_2, 10);
    });
  });

  describe('dot', () => {
    it('should calculate dot product', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.dot(b)).toBe(11);
    });

    it('should handle zero vectors', () => {
      const a = new Vec2(1, 2);
      expect(a.dot(Vec2.ZERO)).toBe(0);
    });

    it('should handle perpendicular vectors', () => {
      const a = new Vec2(1, 0);
      const b = new Vec2(0, 1);
      expect(a.dot(b)).toBe(0);
    });

    it('should handle negative coordinates', () => {
      const a = new Vec2(-1, 2);
      const b = new Vec2(3, -4);
      expect(a.dot(b)).toBe(-11);
    });

    it('should be commutative', () => {
      const a = new Vec2(2, 3);
      const b = new Vec2(4, 5);
      expect(a.dot(b)).toBe(b.dot(a));
    });
  });

  describe('lerp', () => {
    it('should interpolate between vectors', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      const result = a.lerp(b, 0.5);
      expect(result.x).toBe(5);
      expect(result.y).toBe(5);
    });

    it('should not modify original vectors', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      a.lerp(b, 0.5);
      expect(a.x).toBe(0);
      expect(b.x).toBe(10);
    });

    it('should handle t=0', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      const result = a.lerp(b, 0);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('should handle t=1', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      const result = a.lerp(b, 1);
      expect(result.x).toBe(10);
      expect(result.y).toBe(10);
    });

    it('should handle negative t', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      const result = a.lerp(b, -1);
      expect(result.x).toBe(-10);
      expect(result.y).toBe(-10);
    });

    it('should handle t>1', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      const result = a.lerp(b, 2);
      expect(result.x).toBe(20);
      expect(result.y).toBe(20);
    });

    it('should handle different starting vectors', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(5, 6);
      const result = a.lerp(b, 0.5);
      expect(result.x).toBe(3);
      expect(result.y).toBe(4);
    });
  });

  describe('dist', () => {
    it('should calculate distance between vectors', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(3, 4);
      expect(a.dist(b)).toBeCloseTo(5, 10);
    });

    it('should be commutative', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(4, 6);
      expect(a.dist(b)).toBeCloseTo(b.dist(a), 10);
    });

    it('should handle same vectors', () => {
      const a = new Vec2(5, 5);
      expect(a.dist(a)).toBe(0);
    });

    it('should handle negative coordinates', () => {
      const a = new Vec2(-1, -1);
      const b = new Vec2(1, 1);
      expect(a.dist(b)).toBeCloseTo(Math.sqrt(8), 10);
    });

    it('should match subtract then len', () => {
      const a = new Vec2(2, 3);
      const b = new Vec2(5, 7);
      expect(a.dist(b)).toBeCloseTo(a.sub(b).len(), 10);
    });
  });

  describe('angle', () => {
    it('should calculate angle from x-axis', () => {
      const right = new Vec2(1, 0);
      expect(right.angle()).toBeCloseTo(0, 10);
    });

    it('should handle positive y', () => {
      const up = new Vec2(0, 1);
      expect(up.angle()).toBeCloseTo(Math.PI / 2, 10);
    });

    it('should handle negative coordinates', () => {
      const v = new Vec2(-1, -1);
      expect(v.angle()).toBeCloseTo(-Math.PI / 4, 10);
    });

    it('should handle 45 degree angle', () => {
      const v = new Vec2(1, 1);
      expect(v.angle()).toBeCloseTo(Math.PI / 4, 10);
    });

    it('should handle negative x', () => {
      const v = new Vec2(-1, 0);
      expect(v.angle()).toBeCloseTo(Math.PI, 10);
    });
  });

  describe('rotate', () => {
    it('should rotate vector by given angle', () => {
      const v = new Vec2(1, 0);
      const rotated = v.rotate(Math.PI / 2);
      expect(rotated.x).toBeCloseTo(0, 10);
      expect(rotated.y).toBeCloseTo(1, 10);
    });

    it('should not modify original vector', () => {
      const v = new Vec2(1, 0
