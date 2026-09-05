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

  toString(): string {
    return `Vec2(${this.x}, ${this.y})`;
  }

  // Static Constants
  static readonly ZERO = new Vec2(0, 0);
  static readonly ONE = new Vec2(1, 1);
  static readonly UP = new Vec2(0, -1);
  static readonly RIGHT = new Vec2(1, 0);

  // Static Factory
  static fromAngle(rad: number): Vec2 {
    return new Vec2(Math.cos(rad), Math.sin(rad));
  }
}
```

```typescript
// vec2.test.ts
import { describe, it, expect } from 'vitest';
import { Vec2 } from './vec2';

describe('Vec2', () => {
  describe('constructor', () => {
    it('should create instance with x and y', () => {
      const v = new Vec2(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });
  });

  describe('add', () => {
    it('should add two vectors', () => {
      const v1 = new Vec2(1, 2);
      const v2 = new Vec2(3, 4);
      expect(v1.add(v2)).toEqual(new Vec2(4, 6));
    });
  });

  describe('sub', () => {
    it('should subtract two vectors', () => {
      const v1 = new Vec2(5, 6);
      const v2 = new Vec2(1, 2);
      expect(v1.sub(v2)).toEqual(new Vec2(4, 4));
    });
  });

  describe('mul', () => {
    it('should multiply by scalar', () => {
      const v = new Vec2(2, 3);
      expect(v.mul(2)).toEqual(new Vec2(4, 6));
    });
  });

  describe('len', () => {
    it('should return length', () => {
      expect(new Vec2(3, 4).len()).toBeCloseTo(5);
    });
    it('should return 0 for zero vector', () => {
      expect(Vec2.ZERO.len()).toBe(0);
    });
  });

  describe('lenSq', () => {
    it('should return squared length', () => {
      expect(new Vec2(3, 4).lenSq()).toBe(25);
    });
  });

  describe('normalize', () => {
    it('should normalize vector', () => {
      const v = new Vec2(3, 4);
      const n = v.normalize();
      expect(n.len()).toBeCloseTo(1);
    });
    it('should return zero vector for zero vector', () => {
      expect(Vec2.ZERO.normalize()).toEqual(Vec2.ZERO);
    });
  });

  describe('dot', () => {
    it('should calculate dot product', () => {
      const v1 = new Vec2(1, 2);
      const v2 = new Vec2(3, 4);
      expect(v1.dot(v2)).toBe(11);
    });
  });

  describe('lerp', () => {
    it('should interpolate between vectors', () => {
      const v1 = new Vec2(0, 0);
      const v2 = new Vec2(10, 10);
      expect(v1.lerp(v2, 0.5)).toEqual(new Vec2(5, 5));
      expect(v1.lerp(v2, 0)).toEqual(v1);
      expect(v1.lerp(v2, 1)).toEqual(v2);
    });
  });

  describe('dist', () => {
    it('should calculate distance', () => {
      const v1 = new Vec2(0, 0);
      const v2 = new Vec2(3, 4);
      expect(v1.dist(v2)).toBeCloseTo(5);
    });
  });

  describe('angle', () => {
    it('should return angle in radians', () => {
      expect(new Vec2(1, 0).angle()).toBeCloseTo(0);
      expect(new Vec2(0, 1).angle()).toBeCloseTo(Math.PI / 2);
    });
  });

  describe('rotate', () => {
    it('should rotate vector by radians', () => {
      const v = new Vec2(1, 0);
      const rotated = v.rotate(Math.PI / 2);
      expect(rotated.x).toBeCloseTo(0);
      expect(rotated.y).toBeCloseTo(1);
    });
  });

  describe('equals', () => {
    it('should check equality', () => {
      expect(new Vec2(1, 2).equals(new Vec2(1, 2))).toBe(true);
      expect(new Vec2(1, 2).equals(new Vec2(1, 3))).toBe(false);
    });
  });

  describe('clone', () => {
    it('should return a new instance', () => {
      const v1 = new Vec2(1, 2);
      const v2 = v1.clone();
      expect(v1.equals(v2)).toBe(true);
      expect(v1).not.toBe(v2);
    });
  });

  describe('static constants', () => {
    it('should have correct values', () => {
      expect(Vec2.ZERO).toEqual(new Vec2(0, 0));
      expect(Vec2.ONE).toEqual(new Vec2(1, 1));
      expect(Vec2.UP).toEqual(new Vec2(0, -1));
      expect(Vec2.RIGHT).toEqual(new Vec2(1, 0));
    });
  });

  describe('fromAngle', () => {
    it('should create unit vector from angle', () => {
      const v = Vec2.fromAngle(0);
      expect(v.x).toBeCloseTo(1);
      expect(v.y).toBeCloseTo(0);
    });
  });
});
```
