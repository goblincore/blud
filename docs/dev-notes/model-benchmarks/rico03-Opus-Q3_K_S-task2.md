<|think|>
Let me think through this carefully.

The question/task: /no_think
Write a TypeScript Vec2 class with immutable operations: constructor(x,y), add(v), sub(v), mul(s), len(), lenSq(), normalize(), dot(v), lerp(v,t), dist(v), angle(), rotate(rad), equals(v), clone(), static ZERO/ONE/UP/RIGHT constants. All methods return new Vec2. Then write comprehensive vitest tests.

My reasoning: I'll implement the Vec2 class with all requested immutable operations, then create comprehensive vitest tests.

1. 2. 3. 4.
<|/think|>

Here is the implementation of the `Vec2` class with immutable operations, followed by comprehensive `vitest` tests.

### `vec2.ts`

```typescript
export class Vec2 {
  constructor(readonly x: number, readonly y: number) {}

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

  static readonly ZERO = new Vec2(0, 0);
  static readonly ONE = new Vec2(1, 1);
  static readonly UP = new Vec2(0, 1);
  static readonly RIGHT = new Vec2(1, 0);
}
```

### `vec2.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { Vec2 } from './vec2';

describe('Vec2', () => {
  describe('constructor', () => {
    it('should initialize with given coordinates', () => {
      const v = new Vec2(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });
  });

  describe('add', () => {
    it('should return a new Vec2 with summed coordinates', () => {
      const v1 = new Vec2(1, 2);
      const v2 = new Vec2(3, 4);
      const result = v1.add(v2);
      expect(result.x).toBe(4);
      expect(result.y).toBe(6);
    });

    it('should not mutate the original Vec2', () => {
      const v1 = new Vec2(1, 2);
      const originalX = v1.x;
      const originalY = v1.y;
      v1.add(new Vec2(10, 10));
      expect(v1.x).toBe(originalX);
      expect(v1.y).toBe(originalY);
    });
  });

  describe('sub', () => {
    it('should return a new Vec2 with subtracted coordinates', () => {
      const v1 = new Vec2(5, 5);
      const v2 = new Vec2(2, 1);
      const result = v1.sub(v2);
      expect(result.x).toBe(3);
      expect(result.y).toBe(4);
    });

    it('should not mutate the original Vec2', () => {
      const v1 = new Vec2(10, 10);
      const originalX = v1.x;
      const originalY = v1.y;
      v1.sub(new Vec2(5, 5));
      expect(v1.x).toBe(originalX);
      expect(v1.y).toBe(originalY);
    });
  });

  describe('mul', () => {
    it('should return a new Vec2 with scaled coordinates', () => {
      const v = new Vec2(2, 3);
      const result = v.mul(2);
      expect(result.x).toBe(4);
      expect(result.y).toBe(6);
    });

    it('should handle negative scaling', () => {
      const v = new Vec2(2, 3);
      const result = v.mul(-1);
      expect(result.x).toBe(-2);
      expect(result.y).toBe(-3);
    });

    it('should handle zero scaling', () => {
      const v = new Vec2(2, 3);
      const result = v.mul(0);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });
  });

  describe('len', () => {
    it('should return the length of the vector', () => {
      const v = new Vec2(3, 4);
      expect(v.len()).toBeCloseTo(5);
    });

    it('should return zero for a zero vector', () => {
      const v = new Vec2(0, 0);
      expect(v.len()).toBe(0);
    });
  });

  describe('lenSq', () => {
    it('should return the squared length of the vector', () => {
      const v = new Vec2(3, 4);
      expect(v.lenSq()).toBe(25);
    });

    it('should return zero for a zero vector', () => {
      const v = new Vec2(0, 0);
      expect(v.lenSq()).toBe(0);
    });
  });

  describe('normalize', () => {
    it('should return a normalized vector', () => {
      const v = new Vec2(3, 4);
      const result = v.normalize();
      expect(result.x).toBeCloseTo(0.6);
      expect(result.y).toBeCloseTo(0.8);
      expect(result.len()).toBeCloseTo(1);
    });

    it('should return a zero vector for a zero vector', () => {
      const v = new Vec2(0, 0);
      const result = v.normalize();
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });
  });

  describe('dot', () => {
    it('should return the dot product of two vectors', () => {
      const v1 = new Vec2(1, 2);
      const v2 = new Vec2(3, 4);
      const result = v1.dot(v2);
      expect(result).toBe(11);
    });

    it('should return zero for perpendicular vectors', () => {
      const v1 = new Vec2(1, 0);
      const v2 = new Vec2(0, 1);
      const result = v1.dot(v2);
      expect(result).toBe(0);
    });
  });

  describe('lerp', () => {
    it('should return a vector that is t% of the way from this to v', () => {
      const v1 = new Vec2(0, 0);
      const v2 = new Vec2(10, 10);
      const result = v1.lerp(v2, 0.5);
      expect(result.x).toBe(5);
      expect(result.y).toBe(5);
    });

    it('should return this when t is 0', () => {
      const v1 = new Vec2(1, 2);
      const v2 = new Vec2(3, 4);
      const result = v1.lerp(v2, 0);
      expect(result.x).toBe(1);
      expect(result.y).toBe(2);
    });

    it('should return v when t is 1', () => {
      const v1 = new Vec2(1, 2);
      const v2 = new Vec2(3, 4);
      const result = v1.lerp(v2, 1);
      expect(result.x).toBe(3);
      expect(result.y).toBe(4);
    });
  });

  describe('dist', () => {
    it('should return the distance between two vectors', () => {
      const v1 = new Vec2(0, 0);
      const v2 = new Vec2(3, 4);
      expect(v1.dist(v2)).toBeCloseTo(5);
    });
  });

  describe('angle', () => {
    it('should return the angle in radians', () => {
      const v = new Vec2(1, 0);
      expect(v.angle()).toBeCloseTo(0);
    });

    it('should return PI/2 for UP vector', () => {
      const v = new Vec2(0, 1);
      expect(v.angle()).toBeCloseTo(Math.PI / 2);
    });

    it('should return PI for LEFT vector', () => {
      const v = new Vec2(-1, 0);
      expect(v.angle()).toBeCloseTo(Math.PI);
    });
  });

  describe('rotate', () => {
    it('should return a rotated vector', () => {
      const v = new Vec2(1, 0);
      const result = v.rotate(Math.PI / 2);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(1);
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
      const v2 = new Vec2(2, 1);
      expect(v1.equals(v2)).toBe(false);
    });
  });

  describe('clone', () => {
    it('should return a new Vec2 with the same coordinates', () => {
      const v1 = new Vec2(1, 2);
      const v2 = v1.clone();
      expect(v1.x).toBe(v2.x);
      expect(v1.y).toBe(v2.y);
      expect(v1).not.toBe(v2);
    });
  });

  describe('static constants', () => {
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
