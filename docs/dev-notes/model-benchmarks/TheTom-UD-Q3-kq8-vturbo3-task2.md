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
// vec2.test.ts
import { describe, it, expect } from 'vitest';
import { Vec2 } from './vec2';

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
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const c = a.add(b);
      expect(c.x).toBe(4);
      expect(c.y).toBe(6);
    });

    it('should not mutate original', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      a.add(b);
      expect(a.x).toBe(1);
      expect(a.y).toBe(2);
    });
  });

  describe('sub', () => {
    it('should subtract two vectors', () => {
      const a = new Vec2(5, 6);
      const b = new Vec2(3, 4);
      const c = a.sub(b);
      expect(c.x).toBe(2);
      expect(c.y).toBe(2);
    });

    it('should not mutate original', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      a.sub(b);
      expect(a.x).toBe(1);
    });
  });

  describe('mul', () => {
    it('should multiply by scalar', () => {
      const a = new Vec2(2, 3);
      const b = a.mul(4);
      expect(b.x).toBe(8);
      expect(b.y).toBe(12);
    });

    it('should not mutate original', () => {
      const a = new Vec2(1, 1);
      a.mul(5);
      expect(a.x).toBe(1);
    });
  });

  describe('len', () => {
    it('should return length', () => {
      const v = new Vec2(3, 4);
      expect(v.len()).toBeCloseTo(5);
    });

    it('should return 0 for zero vector', () => {
      expect(Vec2.ZERO.len()).toBe(0);
    });
  });

  describe('lenSq', () => {
    it('should return squared length', () => {
      const v = new Vec2(3, 4);
      expect(v.lenSq()).toBe(25);
    });
  });

  describe('normalize', () => {
    it('should normalize vector', () => {
      const v = new Vec2(3, 4);
      const n = v.normalize();
      expect(n.len()).toBeCloseTo(1);
      expect(n.x).toBeCloseTo(0.6);
      expect(n.y).toBeCloseTo(0.8);
    });

    it('should return zero vector for zero vector', () => {
      const n = Vec2.ZERO.normalize();
      expect(n.x).toBe(0);
      expect(n.y).toBe(0);
    });

    it('should not mutate original', () => {
      const v = new Vec2(3, 4);
      v.normalize();
      expect(v.len()).toBeCloseTo(5);
    });
  });

  describe('dot', () => {
    it('should compute dot product', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.dot(b)).toBe(11);
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

    it('should return start when t=0', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.lerp(b, 0).equals(a)).toBe(true);
    });

    it('should return end when t=1', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.lerp(b, 1).equals(b)).toBe(true);
    });

    it('should not mutate original', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      a.lerp(b, 0.5);
      expect(a.x).toBe(0);
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
      const right = new Vec2(1, 0);
      expect(right.angle()).toBeCloseTo(0);

      const up = new Vec2(0, 1);
      expect(up.angle()).toBeCloseTo(Math.PI / 2);
    });
  });

  describe('rotate', () => {
    it('should rotate vector by angle', () => {
      const right = new Vec2(1, 0);
      const up = right.rotate(Math.PI / 2);
      expect(up.x).toBeCloseTo(0);
      expect(up.y).toBeCloseTo(1);
    });

    it('should not mutate original', () => {
      const v = new Vec2(1, 0);
      v.rotate(Math.PI / 2);
      expect(v.x).toBe(1);
      expect(v.y).toBe(0);
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
    it('should return a new vector with same values', () => {
      const original = new Vec2(1, 2);
      const cloned = original.clone();
      expect(cloned.x).toBe(1);
      expect(cloned.y).toBe(2);
      expect(cloned).not.toBe(original);
    });
  });

  describe('fromAngle', () => {
    it('should create unit vector from angle', () => {
      const v = Vec2.fromAngle(0);
      expect(v.x).toBeCloseTo(1);
      expect(v.y).toBeCloseTo(0);

      const v2 = Vec2.fromAngle(Math.PI / 2);
      expect(v2.x).toBeCloseTo(0);
      expect(v2.y).toBeCloseTo(1);
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

  describe('immutability', () => {
    it('should not mutate in any operation', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);

      a.add(b);
      a.sub(b);
      a.mul(2);
      a.normalize();
      a.lerp(b, 0.5);
      a.rotate(Math.PI / 4);

      expect(a.x).toBe(1);
      expect(a.y).toBe(2);
    });
  });
});
```
