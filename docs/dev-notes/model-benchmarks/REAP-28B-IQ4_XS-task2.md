```typescript
// vec2.ts
export class Vec2 {
  constructor(public readonly x: number, public readonly y: number) {}

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
    const length = this.len();
    if (length === 0) return new Vec2(0, 0);
    return new Vec2(this.x / length, this.y / length);
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
    it('creates a vector with given x and y', () => {
      const v = new Vec2(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });
  });

  describe('add', () => {
    it('adds two vectors', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.add(b)).toEqual(new Vec2(4, 6));
    });

    it('does not mutate original', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      a.add(b);
      expect(a.x).toBe(1);
      expect(a.y).toBe(2);
    });
  });

  describe('sub', () => {
    it('subtracts two vectors', () => {
      const a = new Vec2(5, 6);
      const b = new Vec2(3, 4);
      expect(a.sub(b)).toEqual(new Vec2(2, 2));
    });

    it('does not mutate original', () => {
      const a = new Vec2(5, 6);
      const b = new Vec2(3, 4);
      a.sub(b);
      expect(a.x).toBe(5);
      expect(a.y).toBe(6);
    });
  });

  describe('mul', () => {
    it('multiplies vector by scalar', () => {
      const v = new Vec2(2, 3);
      expect(v.mul(4)).toEqual(new Vec2(8, 12));
    });

    it('does not mutate original', () => {
      const v = new Vec2(2, 3);
      v.mul(4);
      expect(v.x).toBe(2);
      expect(v.y).toBe(3);
    });
  });

  describe('len', () => {
    it('returns length of vector', () => {
      const v = new Vec2(3, 4);
      expect(v.len()).toBeCloseTo(5);
    });

    it('returns 0 for zero vector', () => {
      expect(Vec2.ZERO.len()).toBe(0);
    });
  });

  describe('lenSq', () => {
    it('returns squared length', () => {
      const v = new Vec2(3, 4);
      expect(v.lenSq()).toBe(25);
    });
  });

  describe('normalize', () => {
    it('returns unit vector', () => {
      const v = new Vec2(3, 4);
      const n = v.normalize();
      expect(n.len()).toBeCloseTo(1, 10);
      expect(n).not.toBe(v);
    });

    it('returns zero vector for zero input', () => {
      expect(Vec2.ZERO.normalize()).toEqual(Vec2.ZERO);
    });

    it('does not mutate original', () => {
      const v = new Vec2(3, 4);
      v.normalize();
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });
  });

  describe('dot', () => {
    it('returns dot product', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.dot(b)).toBe(11);
    });
  });

  describe('lerp', () => {
    it('interpolates between two vectors', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      expect(a.lerp(b, 0)).toEqual(new Vec2(0, 0));
      expect(a.lerp(b, 1)).toEqual(new Vec2(10, 10));
      expect(a.lerp(b, 0.5)).toEqual(new Vec2(5, 5));
    });

    it('does not mutate originals', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      a.lerp(b, 0.5);
      expect(a.x).toBe(0);
      expect(b.x).toBe(10);
    });
  });

  describe('dist', () => {
    it('returns distance between two vectors', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(3, 4);
      expect(a.dist(b)).toBeCloseTo(5);
    });

    it('returns 0 for same vector', () => {
      const v = new Vec2(1, 2);
      expect(v.dist(v)).toBe(0);
    });
  });

  describe('angle', () => {
    it('returns angle in radians', () => {
      expect(Vec2.RIGHT.angle()).toBeCloseTo(0);
      expect(Vec2.UP.angle()).toBeCloseTo(Math.PI / 2);
      expect(new Vec2(-1, 0).angle()).toBeCloseTo(Math.PI);
      expect(new Vec2(0, -1).angle()).toBeCloseTo(-Math.PI / 2);
    });
  });

  describe('rotate', () => {
    it('rotates vector by given radians', () => {
      const v = new Vec2(1, 0);
      const rotated = v.rotate(Math.PI / 2);
      expect(rotated.x).toBeCloseTo(0);
      expect(rotated.y).toBeCloseTo(1);
    });

    it('does not mutate original', () => {
      const v = new Vec2(1, 0);
      v.rotate(Math.PI / 2);
      expect(v.x).toBe(1);
      expect(v.y).toBe(0);
    });
  });

  describe('equals', () => {
    it('returns true for equal vectors', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(1, 2);
      expect(a.equals(b)).toBe(true);
    });

    it('returns false for unequal vectors', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('clone', () => {
    it('returns a new vector with same values', () => {
      const v = new Vec2(3, 4);
      const cloned = v.clone();
      expect(cloned).toEqual(v);
      expect(cloned).not.toBe(v);
    });
  });

  describe('fromAngle', () => {
    it('creates unit vector from angle', () => {
      const v = Vec2.fromAngle(0);
      expect(v.x).toBeCloseTo(1);
      expect(v.y).toBeCloseTo(0);
      expect(v.len()).toBeCloseTo(1);
    });

    it('creates correct vector for PI/2', () => {
      const v = Vec2.fromAngle(Math.PI / 2);
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(1);
    });
  });

  describe('constants', () => {
    it('ZERO is (0, 0)', () => {
      expect(Vec2.ZERO).toEqual(new Vec2(0, 0));
    });

    it('ONE is (1, 1)', () => {
      expect(Vec2.ONE).toEqual(new Vec2(1, 1));
    });

    it('UP is (0, 1)', () => {
      expect(Vec2.UP).toEqual(new Vec2(0, 1));
    });

    it('RIGHT is (1, 0)', () => {
      expect(Vec2.RIGHT).toEqual(new Vec2(1, 0));
    });
  });
});
```
