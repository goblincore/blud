```typescript
// vec2.ts
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
    return this.mul(1 / l);
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
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return Math.sqrt(dx * dx + dy * dy);
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
    it('should create a vector with given x and y', () => {
      const v = new Vec2(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });
  });

  describe('add', () => {
    it('should add two vectors', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const result = a.add(b);
      expect(result.x).toBe(4);
      expect(result.y).toBe(6);
      // original unchanged
      expect(a.x).toBe(1);
      expect(a.y).toBe(2);
    });
  });

  describe('sub', () => {
    it('should subtract two vectors', () => {
      const a = new Vec2(5, 6);
      const b = new Vec2(3, 4);
      const result = a.sub(b);
      expect(result.x).toBe(2);
      expect(result.y).toBe(2);
    });
  });

  describe('mul', () => {
    it('should multiply vector by scalar', () => {
      const v = new Vec2(2, 3);
      const result = v.mul(4);
      expect(result.x).toBe(8);
      expect(result.y).toBe(12);
    });
  });

  describe('len', () => {
    it('should return length of vector', () => {
      const v = new Vec2(3, 4);
      expect(v.len()).toBeCloseTo(5);
    });

    it('should return 0 for zero vector', () => {
      const v = new Vec2(0, 0);
      expect(v.len()).toBe(0);
    });
  });

  describe('lenSq', () => {
    it('should return squared length', () => {
      const v = new Vec2(3, 4);
      expect(v.lenSq()).toBe(25);
    });
  });

  describe('normalize', () => {
    it('should return normalized vector', () => {
      const v = new Vec2(3, 4);
      const n = v.normalize();
      expect(n.len()).toBeCloseTo(1);
      expect(n.x).toBeCloseTo(0.6);
      expect(n.y).toBeCloseTo(0.8);
    });

    it('should return zero vector for zero vector', () => {
      const v = new Vec2(0, 0);
      const n = v.normalize();
      expect(n.x).toBe(0);
      expect(n.y).toBe(0);
    });
  });

  describe('dot', () => {
    it('should compute dot product', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.dot(b)).toBe(1 * 3 + 2 * 4);
    });
  });

  describe('lerp', () => {
    it('should interpolate between two vectors', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      const mid = a.lerp(b, 0.5);
      expect(mid.x).toBe(5);
      expect(mid.y).toBe(5);
    });

    it('should return start vector when t=0', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.lerp(b, 0).equals(a)).toBe(true);
    });

    it('should return end vector when t=1', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.lerp(b, 1).equals(b)).toBe(true);
    });
  });

  describe('dist', () => {
    it('should return distance between two vectors', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(3, 4);
      expect(a.dist(b)).toBeCloseTo(5);
    });
  });

  describe('angle', () => {
    it('should return angle in radians', () => {
      const v = new Vec2(1, 0);
      expect(v.angle()).toBeCloseTo(0);
    });

    it('should return PI/2 for UP vector', () => {
      const v = new Vec2(0, 1);
      expect(v.angle()).toBeCloseTo(Math.PI / 2);
    });
  });

  describe('rotate', () => {
    it('should rotate vector by given radians', () => {
      const v = new Vec2(1, 0);
      const rotated = v.rotate(Math.PI / 2);
      expect(rotated.x).toBeCloseTo(0);
      expect(rotated.y).toBeCloseTo(1);
    });

    it('should preserve length after rotation', () => {
      const v = new Vec2(3, 4);
      const l = v.len();
      const rotated = v.rotate(Math.PI / 4);
      expect(rotated.len()).toBeCloseTo(l);
    });
  });

  describe('equals', () => {
    it('should return true for equal vectors', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(1, 2);
      expect(a.equals(b)).toBe(true);
    });

    it('should return false for different vectors', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('clone', () => {
    it('should return a new equal vector', () => {
      const original = new Vec2(5, 6);
      const cloned = original.clone();
      expect(cloned.equals(original)).toBe(true);
      expect(cloned).not.toBe(original);
    });
  });

  describe('fromAngle', () => {
    it('should create unit vector from angle', () => {
      const v = Vec2.fromAngle(0);
      expect(v.x).toBeCloseTo(1);
      expect(v.y).toBeCloseTo(0);
    });

    it('should create UP vector at PI/2', () => {
      const v = Vec2.fromAngle(Math.PI / 2);
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(1);
    });

    it('should return unit length', () => {
      const v = Vec2.fromAngle(1.234);
      expect(v.len()).toBeCloseTo(1);
    });
  });

  describe('constants', () => {
    it('ZERO should be (0,0)', () => {
      expect(Vec2.ZERO.x).toBe(0);
      expect(Vec2.ZERO.y).toBe(0);
    });

    it('ONE should be (1,1)', () => {
      expect(Vec2.ONE.x).toBe(1);
      expect(Vec2.ONE.y).toBe(1);
    });

    it('UP should be (0,1)', () => {
      expect(Vec2.UP.x).toBe(0);
      expect(Vec2.UP.y).toBe(1);
    });

    it('RIGHT should be (1,0)', () => {
      expect(Vec2.RIGHT.x).toBe(1);
      expect(Vec2.RIGHT.y).toBe(0);
    });
  });

  describe('immutability', () => {
    it('should not modify original vector on add', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      a.add(b);
      expect(a.x).toBe(1);
      expect(a.y).toBe(2);
    });

    it('should not modify original vector on sub', () => {
      const a = new Vec2(5, 6);
      const b = new Vec2(3, 4);
      a.sub(b);
      expect(a.x).toBe(5);
      expect(a.y).toBe(6);
    });

    it('should not modify original vector on mul', () => {
      const v = new Vec2(2, 3);
      v.mul(4);
      expect(v.x).toBe(2);
      expect(v.y).toBe(3);
    });

    it('should not modify original vector on normalize', () => {
      const v = new Vec2(3, 4);
      v.normalize();
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });

    it('should not modify original vector on lerp', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      a.lerp(b, 0.5);
      expect(a.x).toBe(0);
      expect(a.y).toBe(0);
    });

    it('should not modify original vector on rotate', () => {
      const v = new Vec2(1, 0);
      v.rotate(Math.PI / 2);
      expect(v.x).toBe(1);
      expect(v.y).toBe(0);
    });
  });
});
```
