```typescript
// vec2.ts
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

  mul(scalar: number): Vec2 {
    return new Vec2(this.x * scalar, this.y * scalar);
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
```

```typescript
// vec2.test.ts
import { describe, it, expect } from 'vitest';
import { Vec2 } from './vec2';

describe('Vec2', () => {
  describe('constructor', () => {
    it('defaults to zero', () => {
      const v = new Vec2();
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
    });

    it('accepts explicit values', () => {
      const v = new Vec2(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });
  });

  describe('add', () => {
    it('adds two vectors', () => {
      expect(new Vec2(1, 2).add(new Vec2(3, 4))).toEqual(new Vec2(4, 6));
    });

    it('is commutative', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.add(b)).toEqual(b.add(a));
    });

    it('returns new vector (immutable)', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const result = a.add(b);
      expect(result).not.toBe(a);
      expect(result).not.toBe(b);
    });
  });

  describe('sub', () => {
    it('subtracts vectors', () => {
      expect(new Vec2(5, 6).sub(new Vec2(3, 4))).toEqual(new Vec2(2, 2));
    });
  });

  describe('mul', () => {
    it('scales by a scalar', () => {
      expect(new Vec2(2, 3).mul(4)).toEqual(new Vec2(8, 12));
    });

    it('scales by zero', () => {
      expect(new Vec2(1, 1).mul(0)).toEqual(new Vec2(0, 0));
    });

    it('scales by negative', () => {
      expect(new Vec2(1, 2).mul(-1)).toEqual(new Vec2(-1, -2));
    });
  });

  describe('len', () => {
    it('returns length of zero vector', () => {
      expect(new Vec2(0, 0).len()).toBe(0);
    });

    it('returns correct length for (3,4)', () => {
      expect(new Vec2(3, 4).len()).toBe(5);
    });

    it('returns length for (1,1)', () => {
      expect(new Vec2(1, 1).len()).toBeCloseTo(Math.sqrt(2));
    });
  });

  describe('lenSq', () => {
    it('returns squared length', () => {
      expect(new Vec2(3, 4).lenSq()).toBe(25);
    });

    it('lenSq of zero is zero', () => {
      expect(new Vec2(0, 0).lenSq()).toBe(0);
    });
  });

  describe('normalize', () => {
    it('normalizes (3,4) to (0.6, 0.8)', () => {
      const v = new Vec2(3, 4).normalize();
      expect(v.x).toBeCloseTo(0.6);
      expect(v.y).toBeCloseTo(0.8);
    });

    it('zero vector stays zero', () => {
      expect(Vec2.ZERO.normalize()).toEqual(Vec2.ZERO);
    });

    it('returns unit vector (length ~1)', () => {
      const v = new Vec2(5, 12).normalize();
      expect(v.len()).toBeCloseTo(1);
    });
  });

  describe('dot', () => {
    it('dot product of (1,0) and (0,1) is 0', () => {
      expect(Vec2.RIGHT.dot(Vec2.UP)).toBe(0);
    });

    it('dot product of (1,1) and (1,1) is 2', () => {
      expect(Vec2.ONE.dot(Vec2.ONE)).toBe(2);
    });

    it('dot is commutative', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.dot(b)).toBe(b.dot(a));
    });
  });

  describe('lerp', () => {
    it('lerps halfway between (0,0) and (2,2) to (1,1)', () => {
      expect(Vec2.ZERO.lerp(new Vec2(2, 2), 0.5)).toEqual(new Vec2(1, 1));
    });

    it('lerp at t=0 returns start', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.lerp(b, 0)).toEqual(a);
    });

    it('lerp at t=1 returns end', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.lerp(b, 1)).toEqual(b);
    });
  });

  describe('dist', () => {
    it('distance between (0,0) and (3,4) is 5', () => {
      expect(Vec2.ZERO.dist(new Vec2(3, 4))).toBe(5);
    });

    it('distance is symmetric', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(4, 6);
      expect(a.dist(b)).toBeCloseTo(b.dist(a));
    });

    it('distance to self is 0', () => {
      expect(Vec2.ZERO.dist(Vec2.ZERO)).toBe(0);
    });
  });

  describe('angle', () => {
    it('RIGHT has angle 0', () => {
      expect(Vec2.RIGHT.angle()).toBeCloseTo(0);
    });

    it('UP has angle PI/2', () => {
      expect(Vec2.UP.angle()).toBeCloseTo(Math.PI / 2);
    });

    it('LEFT has angle PI', () => {
      expect(new Vec2(-1, 0).angle()).toBeCloseTo(Math.PI);
    });

    it('DOWN has angle -PI/2', () => {
      expect(new Vec2(0, -1).angle()).toBeCloseTo(-Math.PI / 2);
    });
  });

  describe('rotate', () => {
    it('rotates RIGHT by PI/2 to UP', () => {
      expect(Vec2.RIGHT.rotate(Math.PI / 2)).toEqual(Vec2.UP);
    });

    it('rotates UP by PI/2 to LEFT', () => {
      expect(Vec2.UP.rotate(Math.PI / 2)).toEqual(new Vec2(-1, 0));
    });

    it('rotates by 0 returns self', () => {
      const v = new Vec2(3, 4);
      expect(v.rotate(0)).toEqual(v);
    });

    it('preserves length', () => {
      const v = new Vec2(3, 4);
      const rotated = v.rotate(Math.PI / 4);
      expect(rotated.len()).toBeCloseTo(v.len());
    });
  });

  describe('equals', () => {
    it('same values are equal', () => {
      expect(new Vec2(1, 2).equals(new Vec2(1, 2))).toBe(true);
    });

    it('different values are not equal', () => {
      expect(new Vec2(1, 2).equals(new Vec2(1, 3))).toBe(false);
    });

    it('different types are not equal', () => {
      expect(new Vec2(1, 2).equals(new Vec2(3, 4))).toBe(false);
    });
  });

  describe('clone', () => {
    it('returns equal but not same reference', () => {
      const original = new Vec2(1, 2);
      const cloned = original.clone();
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
    });
  });

  describe('fromAngle', () => {
    it('creates unit vector at given angle', () => {
      const v = Vec2.fromAngle(Math.PI / 4);
      expect(v.len()).toBeCloseTo(1);
      expect(v.x).toBeCloseTo(v.y);
    });

    it('at PI/2 gives UP', () => {
      expect(Vec2.fromAngle(Math.PI / 2)).toEqual(Vec2.UP);
    });

    it('at PI gives LEFT', () => {
      expect(Vec2.fromAngle(Math.PI)).toEqual(new Vec2(-1, 0));
    });
  });

  describe('constants', () => {
    it('ZERO is (0,0)', () => {
      expect(Vec2.ZERO).toEqual(new Vec2(0, 0));
    });

    it('ONE is (1,1)', () => {
      expect(Vec2.ONE).toEqual(new Vec2(1, 1));
    });

    it('UP is (0,1)', () => {
      expect(Vec2.UP).toEqual(new Vec2(0, 1));
    });

    it('RIGHT is (1,0)', () => {
      expect(Vec2.RIGHT).toEqual(new Vec2(1, 0));
    });

    it('are all immutable singletons', () => {
      const a = Vec2.ZERO;
      const b = Vec2.ZERO;
      expect(a).toBe(b);
    });
  });

  describe('immutability', () => {
    it('chaining operations does not mutate originals', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      a.add(b);
      expect(a).toEqual(new Vec2(1, 2));
      expect(b).toEqual(new Vec2(3, 4));
    });

    it('normalize does not mutate', () => {
      const v = new Vec2(3, 4);
      v.normalize();
      expect(v).toEqual(new Vec2(3, 4));
    });
  });
});
```
