```typescript
import { describe, it, expect } from 'vitest';

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

describe('Vec2', () => {
  const epsilon = 1e-6;

  const approx = (a: number, b: number) => {
    expect(Math.abs(a - b)).toBeLessThan(epsilon);
  };

  describe('constructor', () => {
    it('should initialize x and y', () => {
      const v = new Vec2(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });
  });

  describe('add', () => {
    it('should return a new Vec2', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const c = a.add(b);
      expect(c).not.toBe(a);
      expect(c).not.toBe(b);
    });

    it('should add components correctly', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const c = a.add(b);
      expect(c.x).toBe(4);
      expect(c.y).toBe(6);
    });
  });

  describe('sub', () => {
    it('should return a new Vec2', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const c = a.sub(b);
      expect(c).not.toBe(a);
      expect(c).not.toBe(b);
    });

    it('should subtract components correctly', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const c = a.sub(b);
      expect(c.x).toBe(-2);
      expect(c.y).toBe(-2);
    });
  });

  describe('mul', () => {
    it('should return a new Vec2', () => {
      const a = new Vec2(1, 2);
      const c = a.mul(2);
      expect(c).not.toBe(a);
    });

    it('should multiply components correctly', () => {
      const a = new Vec2(1, 2);
      const c = a.mul(3);
      expect(c.x).toBe(3);
      expect(c.y).toBe(6);
    });
  });

  describe('len', () => {
    it('should return magnitude', () => {
      const v = new Vec2(3, 4);
      approx(v.len(), 5);
    });

    it('should return 0 for zero vector', () => {
      const v = new Vec2(0, 0);
      expect(v.len()).toBe(0);
    });
  });

  describe('lenSq', () => {
    it('should return squared magnitude', () => {
      const v = new Vec2(3, 4);
      expect(v.lenSq()).toBe(25);
    });
  });

  describe('normalize', () => {
    it('should return a new Vec2', () => {
      const v = new Vec2(1, 0);
      const n = v.normalize();
      expect(n).not.toBe(v);
    });

    it('should return unit vector', () => {
      const v = new Vec2(3, 4);
      const n = v.normalize();
      approx(n.len(), 1);
      approx(n.x, 3 / 5);
      approx(n.y, 4 / 5);
    });

    it('should return zero vector for zero vector', () => {
      const v = new Vec2(0, 0);
      const n = v.normalize();
      expect(n.x).toBe(0);
      expect(n.y).toBe(0);
    });
  });

  describe('dot', () => {
    it('should return dot product', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.dot(b)).toBe(1 * 3 + 2 * 4);
    });
  });

  describe('lerp', () => {
    it('should return a new Vec2', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      const c = a.lerp(b, 0.5);
      expect(c).not.toBe(a);
      expect(c).not.toBe(b);
    });

    it('should interpolate correctly', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      const c = a.lerp(b, 0.5);
      expect(c.x).toBe(5);
      expect(c.y).toBe(5);
    });

    it('should return a when t is 0', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const c = a.lerp(b, 0);
      expect(c.x).toBe(1);
      expect(c.y).toBe(2);
    });

    it('should return b when t is 1', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const c = a.lerp(b, 1);
      expect(c.x).toBe(3);
      expect(c.y).toBe(4);
    });
  });

  describe('dist', () => {
    it('should return distance', () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(3, 4);
      approx(a.dist(b), 5);
    });

    it('should be symmetric', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(4, 6);
      approx(a.dist(b), b.dist(a));
    });
  });

  describe('angle', () => {
    it('should return angle in radians', () => {
      const v = new Vec2(1, 0);
      expect(v.angle()).toBe(0);
    });

    it('should handle other quadrants', () => {
      const v = new Vec2(0, 1);
      expect(v.angle()).toBe(Math.PI / 2);
    });
  });

  describe('rotate', () => {
    it('should return a new Vec2', () => {
      const v = new Vec2(1, 0);
      const r = v.rotate(Math.PI / 2);
      expect(r).not.toBe(v);
    });

    it('should rotate correctly', () => {
      const v = new Vec2(1, 0);
      const r = v.rotate(Math.PI / 2);
      approx(r.x, 0);
      approx(r.y, 1);
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
      const b = new Vec2(2, 1);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('clone', () => {
    it('should return a new Vec2', () => {
      const v = new Vec2(1, 2);
      const c = v.clone();
      expect(c).not.toBe(v);
      expect(c.x).toBe(v.x);
      expect(c.y).toBe(v.y);
    });
  });

  describe('fromAngle', () => {
    it('should return unit vector', () => {
      const v = Vec2.fromAngle(Math.PI / 4);
      approx(v.len(), 1);
      approx(v.x, Math.cos(Math.PI / 4));
      approx(v.y, Math.sin(Math.PI / 4));
    });
  });

  describe('constants', () => {
    it('should have correct values', () => {
      expect(Vec2.ZERO.x).toBe(0);
      expect(Vec2.ZERO.y).toBe(0);
      expect(Vec2.ONE.x).toBe(1);
      expect(Vec2.ONE.y).toBe(1);
      expect(Vec2.UP.x).toBe(0);
      expect(Vec2.UP.y).toBe(1);
      expect(Vec2.RIGHT.x).toBe(1);
      expect(Vec2.RIGHT.y).toBe(0);
    });
  });

  describe('immutability', () => {
    it('should not modify original vector', () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      a.add(b);
      expect(a.x).toBe(1);
      expect(a.y).toBe(2);
    });
  });
});
```
