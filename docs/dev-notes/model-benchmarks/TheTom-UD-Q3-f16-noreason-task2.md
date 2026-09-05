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
    it('should return a new vector with summed components', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const c = a.add(b);
      expect(c).toBeInstanceOf(Vec2);
      expect(c.x).toBe(4);
      expect(c.y).toBe(6);
      // Immutability: original unchanged
      expect(a.x).toBe(1);
      expect(a.y).toBe(2);
      expect(b.x).toBe(3);
      expect(b.y).toBe(4);
    });

    it('should handle negative values', () => {
      const a = new Vec2(-1, -2);
      const b = new Vec2(3, -4);
      const c = a.add(b);
      expect(c.x).toBe(2);
      expect(c.y).toBe(-6);
    });
  });

  describe('sub', () => {
    it('should return a new vector with subtracted components', () => {
      const a = new Vec2(5, 7);
      const b = new Vec2(3, 2);
      const c = a.sub(b);
      expect(c.x).toBe(2);
      expect(c.y).toBe(5);
      expect(a.x).toBe(5);
      expect(a.y).toBe(7);
    });
  });

  describe('mul', () => {
    it('should return a new vector with scaled components', () => {
      const a = new Vec2(2, 3);
      const c = a.mul(4);
      expect(c.x).toBe(8);
      expect(c.y).toBe(12);
      expect(a.x).toBe(2);
      expect(a.y).toBe(3);
    });

    it('should handle zero scalar', () => {
      const a = new Vec2(5, 10);
      const c = a.mul(0);
      expect(c.x).toBe(0);
      expect(c.y).toBe(0);
    });

    it('should handle negative scalar', () => {
      const a = new Vec2(2, 3);
      const c = a.mul(-1);
      expect(c.x).toBe(-2);
      expect(c.y).toBe(-3);
    });
  });

  describe('len', () => {
    it('should return the magnitude', () => {
      const v = new Vec2(3, 4);
      expect(v.len()).toBeCloseTo(5);
    });

    it('should return 0 for zero vector', () => {
      expect(Vec2.ZERO.len()).toBe(0);
    });

    it('should handle negative components', () => {
      const v = new Vec2(-3, -4);
      expect(v.len()).toBeCloseTo(5);
    });
  });

  describe('lenSq', () => {
    it('should return the squared magnitude', () => {
      const v = new Vec2(3, 4);
      expect(v.lenSq()).toBe(25);
    });

    it('should be equal to len() * len()', () => {
      const v = new Vec2(5, 12);
      expect(v.lenSq()).toBeCloseTo(v.len() * v.len());
    });
  });

  describe('normalize', () => {
    it('should return a unit vector', () => {
      const v = new Vec2(3, 4);
      const n = v.normalize();
      expect(n.len()).toBeCloseTo(1);
      expect(n).toBeInstanceOf(Vec2);
      expect(n.x).toBeCloseTo(0.6);
      expect(n.y).toBeCloseTo(0.8);
    });

    it('should return zero vector for zero input', () => {
      const n = Vec2.ZERO.normalize();
      expect(n.x).toBe(0);
      expect(n.y).toBe(0);
    });

    it('should handle negative vectors', () => {
      const v = new Vec2(-3, -4);
      const n = v.normalize();
      expect(n.len()).toBeCloseTo(1);
      expect(n.x).toBeCloseTo(-0.6);
      expect(n.y).toBeCloseTo(-0.8);
    });
  });

  describe('dot', () => {
    it('should return the dot product', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.dot(b)).toBe(11);
    });

    it('should be commutative', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.dot(b)).toBe(b.dot(a));
    });

    it('should return 0 for orthogonal vectors', () => {
      const a = new Vec2(1, 0);
      const b = new Vec2(0, 1);
      expect(a.dot(b)).toBe(0);
    });
  });

  describe('lerp', () => {
    it('should return interpolated vector at t=0', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 20);
      const c = a.lerp(b, 0);
      expect(c.x).toBeCloseTo(0);
      expect(c.y).toBeCloseTo(0);
    });

    it('should return interpolated vector at t=1', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 20);
      const c = a.lerp(b, 1);
      expect(c.x).toBeCloseTo(10);
      expect(c.y).toBeCloseTo(20);
    });

    it('should return interpolated vector at t=0.5', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 20);
      const c = a.lerp(b, 0.5);
      expect(c.x).toBeCloseTo(5);
      expect(c.y).toBeCloseTo(10);
    });

    it('should handle t outside [0,1]', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 20);
      const c = a.lerp(b, 2);
      expect(c.x).toBeCloseTo(20);
      expect(c.y).toBeCloseTo(40);
    });
  });

  describe('dist', () => {
    it('should return the distance between two vectors', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(3, 4);
      expect(a.dist(b)).toBeCloseTo(5);
    });

    it('should be symmetric', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(4, 6);
      expect(a.dist(b)).toBeCloseTo(b.dist(a));
    });

    it('should return 0 for same point', () => {
      const a = new Vec2(5, 5);
      expect(a.dist(a)).toBe(0);
    });
  });

  describe('angle', () => {
    it('should return angle in radians', () => {
      const v = new Vec2(1, 0);
      expect(v.angle()).toBeCloseTo(0);
    });

    it('should return PI/2 for positive y-axis', () => {
      const v = new Vec2(0, 1);
      expect(v.angle()).toBeCloseTo(Math.PI / 2);
    });

    it('should return -PI/2 for negative y-axis', () => {
      const v = new Vec2(0, -1);
      expect(v.angle()).toBeCloseTo(-Math.PI / 2);
    });

    it('should handle negative x', () => {
      const v = new Vec2(-1, 0);
      expect(v.angle()).toBeCloseTo(Math.PI);
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
      const len = v.len();
      const rotated = v.rotate(1.5);
      expect(rotated.len()).toBeCloseTo(len);
    });

    it('should return new vector (immutability)', () => {
      const v = new Vec2(1, 0);
      const rotated = v.rotate(Math.PI / 2);
      expect(v.x).toBe(1);
      expect(v.y).toBe(0);
    });

    it('should handle 180 degree rotation', () => {
      const v = new Vec2(1, 0);
      const rotated = v.rotate(Math.PI);
      expect(rotated.x).toBeCloseTo(-1);
      expect(rotated.y).toBeCloseTo(0);
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
      const b = new Vec2(1, 3);
      expect(a.equals(b)).toBe(false);
    });

    it('should return false for different x', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(2, 2);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('clone', () => {
    it('should return a new vector with same values', () => {
      const a = new Vec2(3, 4);
      const b = a.clone();
      expect(b.x).toBe(3);
      expect(b.y).toBe(4);
      expect(b).not.toBe(a);
    });

    it('should be independent after cloning', () => {
      const a = new Vec2(3, 4);
      const b = a.clone();
      b.x = 10;
      expect(a.x).toBe(3);
    });
  });

  describe('fromAngle', () => {
    it('should create a unit vector from angle', () => {
      const v = Vec2.fromAngle(0);
      expect(v.x).toBeCloseTo(1);
      expect(v.y).toBeCloseTo(0);
      expect(v.len()).toBeCloseTo(1);
    });

    it('should create unit vector at PI/2', () => {
      const v = Vec2.fromAngle(Math.PI / 2);
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(1);
    });

    it('should create unit vector at PI', () => {
      const v = Vec2.fromAngle(Math.PI);
      expect(v.x).toBeCloseTo(-1);
      expect(v.y).toBeCloseTo(0);
    });
  });

  describe('static constants', () => {
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

  describe('chaining', () => {
    it('should allow method chaining', () => {
      const result = Vec2.ZERO
        .add(new Vec2(1, 2))
        .mul(2)
        .normalize()
        .mul(5);
      expect(result.x).toBeCloseTo(5 / Math.sqrt(5));
      expect(result.y).toBeCloseTo(10 / Math.sqrt(5));
    });
  });

  describe('immutability', () => {
    it('should not modify original vector in add', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      a.add(b);
      expect(a.x).toBe(1);
      expect(a.y).toBe(2);
    });

    it('should not modify original vector in sub', () => {
      const a = new Vec2(5, 7);
      const b = new Vec2(3, 2);
      a.sub(b);
      expect(a.x).toBe(5);
      expect(a.y).toBe(7);
    });

    it('should not modify original vector in mul', () => {
      const a = new Vec2(2, 3);
      a.mul(4);
      expect(a.x).toBe(2);
      expect(a.y).toBe(3);
    });

    it('should not modify original vector in normalize', () => {
      const a = new Vec2(3, 4);
      a.normalize();
      expect(a.x).toBe(3);
      expect(a.y).toBe(4);
    });

    it('should not modify original vector in rotate', () => {
      const a = new Vec2(1, 0);
