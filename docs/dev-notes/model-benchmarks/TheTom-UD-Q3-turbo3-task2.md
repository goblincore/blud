```typescript
// vec2.ts
export class Vec2 {
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
    if (len === 0) return Vec2.ZERO;
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

  static ZERO = new Vec2(0, 0);
  static ONE = new Vec2(1, 1);
  static UP = new Vec2(0, 1);
  static RIGHT = new Vec2(1, 0);
}
```

```typescript
// vec2.test.ts
import { describe, it, expect } from 'vitest';
import { Vec2 } from './vec2';

describe('Vec2', () => {
  describe('constructor', () => {
    it('should set x and y correctly', () => {
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
  });

  describe('mul', () => {
    it('should multiply vector by scalar', () => {
      const v = new Vec2(2, 3);
      const result = v.mul(2);
      expect(result.x).toBe(4);
      expect(result.y).toBe(6);
    });

    it('should handle negative scalar', () => {
      const v = new Vec2(2, 3);
      const result = v.mul(-1);
      expect(result.x).toBe(-2);
      expect(result.y).toBe(-3);
    });
  });

  describe('len', () => {
    it('should calculate length', () => {
      const v = new Vec2(3, 4);
      expect(v.len()).toBeCloseTo(5);
    });

    it('should return 0 for zero vector', () => {
      expect(Vec2.ZERO.len()).toBe(0);
    });
  });

  describe('lenSq', () => {
    it('should calculate squared length', () => {
      const v = new Vec2(3, 4);
      expect(v.lenSq()).toBe(25);
    });
  });

  describe('normalize', () => {
    it('should normalize vector', () => {
      const v = new Vec2(3, 4);
      const result = v.normalize();
      expect(result.len()).toBeCloseTo(1);
    });

    it('should return zero vector if original is zero', () => {
      const result = Vec2.ZERO.normalize();
      expect(result).toBe(Vec2.ZERO);
    });

    it('should not modify original vector', () => {
      const v = new Vec2(3, 4);
      v.normalize();
      expect(v.len()).toBeCloseTo(5);
    });
  });

  describe('dot', () => {
    it('should calculate dot product', () => {
      const v1 = new Vec2(1, 2);
      const v2 = new Vec2(3, 4);
      expect(v1.dot(v2)).toBe(1 * 3 + 2 * 4);
    });

    it('should return 0 for orthogonal vectors', () => {
      const v1 = new Vec2(1, 0);
      const v2 = new Vec2(0, 1);
      expect(v1.dot(v2)).toBe(0);
    });
  });

  describe('lerp', () => {
    it('should interpolate between two vectors', () => {
      const v1 = new Vec2(0, 0);
      const v2 = new Vec2(10, 10);
      const result = v1.lerp(v2, 0.5);
      expect(result.x).toBe(5);
      expect(result.y).toBe(5);
    });

    it('should return v2 when t is 1', () => {
      const v1 = new Vec2(0, 0);
      const v2 = new Vec2(10, 10);
      const result = v1.lerp(v2, 1);
      expect(result.x).toBe(10);
      expect(result.y).toBe(10);
    });

    it('should return v1 when t is 0', () => {
      const v1 = new Vec2(0, 0);
      const v2 = new Vec2(10, 10);
      const result = v1.lerp(v2, 0);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });
  });

  describe('dist', () => {
    it('should calculate distance between two vectors', () => {
      const v1 = new Vec2(0, 0);
      const v2 = new Vec2(3, 4);
      expect(v1.dist(v2)).toBeCloseTo(5);
    });
  });

  describe('angle', () => {
    it('should calculate angle in radians', () => {
      const v1 = new Vec2(1, 0);
      expect(v1.angle()).toBeCloseTo(0);

      const v2 = new Vec2(0, 1);
      expect(v2.angle()).toBeCloseTo(Math.PI / 2);

      const v3 = new Vec2(-1, 0);
      expect(v3.angle()).toBeCloseTo(Math.PI);
    });
  });

  describe('rotate', () => {
    it('should rotate vector by 90 degrees', () => {
      const v = new Vec2(1, 0);
      const result = v.rotate(Math.PI / 2);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(1);
    });

    it('should rotate vector by 180 degrees', () => {
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

    it('should return false for different vectors', () => {
      const v1 = new Vec2(1, 2);
      const v2 = new Vec2(2, 1);
      expect(v1.equals(v2)).toBe(false);
    });
  });

  describe('clone', () => {
    it('should return a new vector with same values', () => {
      const v1 = new Vec2(1, 2);
      const v2 = v1.clone();
      expect(v1.x).toBe(v2.x);
      expect(v1.y).toBe(v2.y);
      expect(v1).not.toBe(v2);
    });
  });

  describe('fromAngle', () => {
    it('should create vector from angle', () => {
      const v = Vec2.fromAngle(0);
      expect(v.x).toBeCloseTo(1);
      expect(v.y).toBeCloseTo(0);

      const v2 = Vec2.fromAngle(Math.PI / 2);
      expect(v2.x).toBeCloseTo(0);
      expect(v2.y).toBeCloseTo(1);
    });
  });

  describe('constants', () => {
    it('ZERO should be (0, 0)', () => {
      expect(Vec2.ZERO.x).toBe(0);
      expect(Vec2.ZERO.y).toBe(0);
    });

    it('ONE should be (1, 1)', () => {
      expect(Vec2.ONE.x).toBe(1);
      expect(Vec2.ONE.y).toBe(1);
    });

    it('UP should be (0, 1)', () => {
      expect(Vec2.UP.x).toBe(0);
      expect(Vec2.UP.y).toBe(1);
    });

    it('RIGHT should be (1, 0)', () => {
      expect(Vec2.RIGHT.x).toBe(1);
      expect(Vec2.RIGHT.y).toBe(0);
    });

    it('constants should be single instances', () => {
      expect(Vec2.ZERO).toBe(Vec2.ZERO);
      expect(Vec2.ONE).toBe(Vec2.ONE);
      expect(Vec2.UP).toBe(Vec2.UP);
      expect(Vec2.RIGHT).toBe(Vec2.RIGHT);
    });
  });
});
```