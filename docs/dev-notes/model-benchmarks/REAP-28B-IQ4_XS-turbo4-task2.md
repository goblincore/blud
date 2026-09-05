```typescript
// Vec2.ts
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

  equals(v: Vec2, epsilon = 1e-10): boolean {
    return (
      Math.abs(this.x - v.x) < epsilon &&
      Math.abs(this.y - v.y) < epsilon
    );
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
  describe('constructor', () => {
    it('creates instance with x and y', () => {
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
      expect(a).toEqual(new Vec2(1, 2));
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
      expect(a).toEqual(new Vec2(5, 6));
    });
  });

  describe('mul', () => {
    it('scales vector by scalar', () => {
      const v = new Vec2(3, 4);
      expect(v.mul(2)).toEqual(new Vec2(6, 8));
    });

    it('scales by zero', () => {
      const v = new Vec2(3, 4);
      expect(v.mul(0)).toEqual(new Vec2(0, 0));
    });

    it('does not mutate original', () => {
      const v = new Vec2(3, 4);
      v.mul(2);
      expect(v).toEqual(new Vec2(3, 4));
    });
  });

  describe('len', () => {
    it('returns length', () => {
      const v = new Vec2(3, 4);
      expect(v.len()).toBeCloseTo(5);
    });

    it('returns 0 for zero vector', () => {
      expect(Vec2.ZERO.len()).toBe(0);
    });

    it('does not mutate original', () => {
      const v = new Vec2(3, 4);
      v.len();
      expect(v).toEqual(new Vec2(3, 4));
    });
  });

  describe('lenSq', () => {
    it('returns squared length', () => {
      const v = new Vec2(3, 4);
      expect(v.lenSq()).toBe(25);
    });

    it('returns 0 for zero vector', () => {
      expect(Vec2.ZERO.lenSq()).toBe(0);
    });
  });

  describe('normalize', () => {
    it('returns unit vector', () => {
      const v = new Vec2(3, 4);
      const n = v.normalize();
      expect(n.len()).toBeCloseTo(1);
      expect(n).toEqual(new Vec2(3 / 5, 4 / 5));
    });

    it('returns zero for zero vector', () => {
      expect(Vec2.ZERO.normalize()).toEqual(Vec2.ZERO);
    });

    it('does not mutate original', () => {
      const v = new Vec2(3, 4);
      v.normalize();
      expect(v).toEqual(new Vec2(3, 4));
    });
  });

  describe('dot', () => {
    it('computes dot product', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.dot(b)).toBe(11);
    });

    it('does not mutate original', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      a.dot(b);
      expect(a).toEqual(new Vec2(1, 2));
    });
  });

  describe('lerp', () => {
    it('interpolates between vectors', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      expect(a.lerp(b, 0)).toEqual(new Vec2(0, 0));
      expect(a.lerp(b, 1)).toEqual(new Vec2(10, 10));
      expect(a.lerp(b, 0.5)).toEqual(new Vec2(5, 5));
    });

    it('does not mutate original', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      a.lerp(b, 0.5);
      expect(a).toEqual(new Vec2(0, 0));
    });
  });

  describe('dist', () => {
    it('computes distance between vectors', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(3, 4);
      expect(a.dist(b)).toBeCloseTo(5);
    });

    it('distance to self is 0', () => {
      const v = new Vec2(3, 4);
      expect(v.dist(v)).toBe(0);
    });

    it('does not mutate original', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(3, 4);
      a.dist(b);
      expect(a).toEqual(new Vec2(0, 0));
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
    it('rotates vector by radians', () => {
      const v = new Vec2(1, 0);
      const rotated = v.rotate(Math.PI / 2);
      expect(rotated).toEqual(new Vec2(0, 1));
    });

    it('180 degree rotation', () => {
      const v = new Vec2(1, 0);
      const rotated = v.rotate(Math.PI);
      expect(rotated).toEqual(new Vec2(-1, 0));
    });

    it('does not mutate original', () => {
      const v = new Vec2(1, 0);
      v.rotate(Math.PI / 2);
      expect(v).toEqual(new Vec2(1, 0));
    });
  });

  describe('equals', () => {
    it('checks equality', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(1, 2);
      const c = new Vec2(1, 3);
      expect(a.equals(b)).toBe(true);
      expect(a.equals(c)).toBe(false);
    });

    it('uses epsilon for floating point comparison', () => {
      const a = new Vec2(0.1 + 0.2, 0);
      const b = new Vec2(0.3, 0);
      expect(a.equals(b)).toBe(true);
    });
  });

  describe('clone', () => {
    it('creates a copy', () => {
      const v = new Vec2(1, 2);
      const copy = v.clone();
      expect(copy).toEqual(new Vec2(1, 2));
      expect(copy).not.toBe(v);
    });

    it('independent mutation', () => {
      const v = new Vec2(1, 2);
      const copy = v.clone();
      copy.x = 10;
      expect(v.x).toBe(1);
    });
  });

  describe('static fromAngle', () => {
    it('creates unit vector from angle', () => {
      const v = Vec2.fromAngle(0);
      expect(v).toEqual(new Vec2(1, 0));
      expect(v.len()).toBeCloseTo(1);
    });

    it('creates correct vector for PI/4', () => {
      const v = Vec2.fromAngle(Math.PI / 4);
      expect(v.x).toBeCloseTo(Math.cos(Math.PI / 4));
      expect(v.y).toBeCloseTo(Math.sin(Math.PI / 4));
    });
  });

  describe('static constants', () => {
    it('ZERO', () => {
      expect(Vec2.ZERO).toEqual(new Vec2(0, 0));
    });

    it('ONE', () => {
      expect(Vec2.ONE).toEqual(new Vec2(1, 1));
    });

    it('UP', () => {
      expect(Vec2.UP).toEqual(new Vec2(0, 1));
    });

    it('RIGHT', () => {
      expect(Vec2.RIGHT).toEqual(new Vec2(1, 0));
    });
  });

  describe('immutability', () => {
    it('all methods return new instances', () => {
      const v = new Vec2(3, 4);
      expect(v.add(Vec2.ONE)).not.toBe(v);
      expect(v.sub(Vec2.ONE)).not.toBe(v);
      expect(v.mul(2)).not.toBe(v);
      expect(v.normalize()).not.toBe(v);
      expect(v.lerp(Vec2.ONE, 0.5)).not.toBe(v);
      expect(v.dist(Vec2.ZERO)); // just call to ensure no error
      expect(v.rotate(Math.PI / 2)).not.toBe(v);
      expect(v.clone()).not.toBe(v);
    });
  });
});
```
