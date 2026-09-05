<!-- thinking (10776 chars) -->

Let me think through this carefully.

The question/task: You are a coding assistant. Be concise, produce clean working TypeScript. No explanations unless asked.

My reasoning: here's the Vec2 implementation with comprehensive vitest tests:

```typescript
// Vec2.ts

export class Vec2 {
  readonly x: number;
  readonly y: number;

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
    return Math.sqrt((this.x - v.x) ** 2 + (this.y - v.y) ** 2);
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

  // Static properties
  static readonly ZERO = new Vec2(0, 0);
  static readonly ONE = new Vec2(1, 1);
  static readonly UP = new Vec2(0, 1);
  static readonly RIGHT = new Vec2(1, 0);

  // Static factory
  static fromAngle(rad: number): Vec2 {
    return new Vec2(Math.cos(rad), Math.sin(rad));
  }
}
```

**vite.config.ts** (for testing setup):
```typescript
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

**Vec2.test.ts**:
```typescript
import { describe, it, expect } from 'vitest';
import { Vec2 } from './Vec2';

describe('Vec2', () => {
  describe('constructor', () => {
    it('should create a Vec2 with given coordinates', () => {
      const v = new Vec2(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });

    it('should default to (0, 0)', () => {
      const v = new Vec2();
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
    });
  });

  describe('add', () => {
    it('should return a new Vec2 with summed coordinates', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const sum = a.add(b);
      expect(sum.x).toBe(4);
      expect(sum.y).toBe(6);
      expect(sum).not.toBe(a);
      expect(sum).not.toBe(b);
    });

    it('should not mutate the original vectors', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      a.add(b);
      expect(a.x).toBe(1);
      expect(a.y).toBe(2);
    });
  });

  describe('sub', () => {
    it('should return a new Vec2 with subtracted coordinates', () => {
      const a = new Vec2(5, 7);
      const b = new Vec2(3, 4);
      const diff = a.sub(b);
      expect(diff.x).toBe(2);
      expect(diff.y).toBe(3);
    });

    it('should not mutate the original vectors', () => {
      const a = new Vec2(5, 7);
      const b = new Vec2(3, 4);
      a.sub(b);
      expect(a.x).toBe(5);
      expect(a.y).toBe(7);
    });
  });

  describe('mul', () => {
    it('should return a new Vec2 with scaled coordinates', () => {
      const v = new Vec2(2, 3);
      const scaled = v.mul(5);
      expect(scaled.x).toBe(10);
      expect(scaled.y).toBe(15);
    });

    it('should not mutate the original vector', () => {
      const v = new Vec2(2, 3);
      v.mul(5);
      expect(v.x).toBe(2);
      expect(v.y).toBe(3);
    });
  });

  describe('len', () => {
    it('should return the Euclidean length', () => {
      const v = new Vec2(3, 4);
      expect(v.len()).toBe(5);
    });

    it('should return 0 for zero vector', () => {
      const v = new Vec2(0, 0);
      expect(v.len()).toBe(0);
    });

    it('should handle floating point coordinates', () => {
      const v = new Vec2(1, 1);
      expect(v.len()).toBeCloseTo(Math.sqrt(2));
    });
  });

  describe('lenSq', () => {
    it('should return the squared length', () => {
      const v = new Vec2(3, 4);
      expect(v.lenSq()).toBe(25);
    });

    it('should return 0 for zero vector', () => {
      const v = new Vec2(0, 0);
      expect(v.lenSq()).toBe(0);
    });
  });

  describe('normalize', () => {
    it('should return a unit vector', () => {
      const v = new Vec2(3, 4);
      const normalized = v.normalize();
      expect(normalized.len()).toBeCloseTo(1);
    });

    it('should return zero vector for zero vector', () => {
      const v = new Vec2(0, 0);
      const normalized = v.normalize();
      expect(normalized.x).toBe(0);
      expect(normalized.y).toBe(0);
    });

    it('should not mutate the original vector', () => {
      const v = new Vec2(3, 4);
      v.normalize();
      expect(v.len()).toBe(5);
    });
  });

  describe('dot', () => {
    it('should return the dot product', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.dot(b)).toBe(1 * 3 + 2 * 4);
    });

    it('should return 0 for orthogonal vectors', () => {
      const a = new Vec2(1, 0);
      const b = new Vec2(0, 1);
      expect(a.dot(b)).toBe(0);
    });
  });

  describe('lerp', () => {
    it('should return the linear interpolation between two vectors', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      const mid = a.lerp(b, 0.5);
      expect(mid.x).toBe(5);
      expect(mid.y).toBe(5);
    });

    it('should return start when t=0', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.lerp(b, 0)).toEqual(a);
    });

    it('should return end when t=1', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.lerp(b, 1)).toEqual(b);
    });

    it('should not mutate the original vectors', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      a.lerp(b, 0.5);
      expect(a.x).toBe(1);
    });
  });

  describe('dist', () => {
    it('should return the Euclidean distance', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(3, 4);
      expect(a.dist(b)).toBe(5);
    });

    it('should return 0 for the same point', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(1, 2);
      expect(a.dist(b)).toBe(0);
    });
  });

  describe('angle', () => {
    it('should return the angle in radians', () => {
      const v = new Vec2(1, 0);
      expect(v.angle()).toBeCloseTo(0);
    });

    it('should return PI/2 for positive Y axis', () => {
      const v = new Vec2(0, 1);
      expect(v.angle()).toBeCloseTo(Math.PI / 2);
    });

    it('should handle negative angles', () => {
      const v = new Vec2(-1, 0);
      expect(v.angle()).toBeCloseTo(Math.PI);
    });
  });

  describe('rotate', () => {
    it('should rotate the vector by the given angle', () => {
      const v = new Vec2(1, 0);
      const rotated = v.rotate(Math.PI / 2);
      expect(rotated.x).toBeCloseTo(0);
      expect(rotated.y).toBeCloseTo(1);
    });

    it('should return PI/2 rotation for 90 degrees', () => {
      const v = new Vec2(1, 0);
      const rotated = v.rotate(Math.PI / 2);
      expect(rotated).toBeCloseTo(new Vec2(0, 1));
    });

    it('should not mutate the original vector', () => {
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

    it('should return false for unequal vectors', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('clone', () => {
    it('should return a new Vec2 with the same values', () => {
      const a = new Vec2(1, 2);
      const cloned = a.clone();
      expect(cloned.x).toBe(1);
      expect(cloned.y).toBe(2);
      expect(cloned).not.toBe(a);
    });

    it('should create an independent copy', () => {
      const a = new Vec2(1, 2);
      const cloned = a.clone();
      cloned.x = 10;
      expect(a.x).toBe(1);
    });
  });

  describe('static properties', () => {
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

  describe('fromAngle', () => {
    it('should create a unit vector from an angle', () => {
      const v = Vec2.fromAngle(0);
      expect(v.x).toBeCloseTo(1);
      expect(v.y).toBeCloseTo(0);
    });

    it('should create a unit vector at PI/2', () => {
      const v = Vec2.fromAngle(Math.PI / 2);
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(1);
    });

    it('should create a unit vector at PI', () => {
      const v = Vec2.fromAngle(Math.PI);
      expect(v.x).toBeCloseTo(-1);
      expect(v.y).toBeCloseTo(0);
    });

    it('should create a unit vector at 3PI/2', () => {
      const v = Vec2.fromAngle(3 * Math.PI / 2);
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(-1);
    });
  });

  describe('immutability', () => {
    it('should not mutate original vectors during chained operations', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const c = new Vec2(5, 6);

      const result = a.add(b).sub(c).mul(2);
      expect(a.x).toBe(1);
      expect(a.y).toBe(2);
      expect(b.x).toBe(3);
      expect(b.y).toBe(4);
      expect(c.x).toBe(5);
      expect(c.y).toBe(6);
    });
  });
});
```

This gives you:
- **100% immutable** Vec2 class — every method returns a new instance
- **15+ test cases** covering all methods, edge cases, and immutability guarantees
- **vite.config.ts** configured for vitest with globals
- Tests verify: correctness, immutability, edge cases (zero vectors, orthogonal vectors), and chained operations

<!-- answer (0 chars) -->

