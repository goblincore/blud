<!-- thinking (0 chars) -->


<!-- answer (14120 chars) -->
```typescript
// Vec2.ts

export class Vec2 {
  public readonly x: number;
  public readonly y: number;

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
    return Math.hypot(this.x, this.y);
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

  static ZERO = new Vec2(0, 0);
  static ONE = new Vec2(1, 1);
  static UP = new Vec2(0, 1);
  static RIGHT = new Vec2(1, 0);
}
```

```typescript
// Vec2.test.ts

import { describe, it, expect } from "vitest";
import { Vec2 } from "./Vec2";

describe("Vec2", () => {
  describe("constructor", () => {
    it("stores x and y", () => {
      const v = new Vec2(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });

    it("is immutable after construction", () => {
      const v = new Vec2(1, 2);
      expect(() => {
        (v as any).x = 99;
      }).toThrow();
    });
  });

  describe("add", () => {
    it("adds two vectors", () => {
      expect(new Vec2(1, 2).add(new Vec2(3, 4))).toEqual(new Vec2(4, 6));
    });

    it("does not modify the original", () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      a.add(b);
      expect(a).toEqual(new Vec2(1, 2));
    });

    it("returns a new Vec2", () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const result = a.add(b);
      expect(result).not.toBe(a);
      expect(result).not.toBe(b);
    });
  });

  describe("sub", () => {
    it("subtracts two vectors", () => {
      expect(new Vec2(5, 6).sub(new Vec2(3, 4))).toEqual(new Vec2(2, 2));
    });

    it("does not modify the original", () => {
      const a = new Vec2(5, 6);
      const b = new Vec2(3, 4);
      a.sub(b);
      expect(a).toEqual(new Vec2(5, 6));
    });

    it("returns a new Vec2", () => {
      const a = new Vec2(5, 6);
      const b = new Vec2(3, 4);
      expect(a.sub(b)).not.toBe(a);
    });
  });

  describe("mul", () => {
    it("scales by a scalar", () => {
      expect(new Vec2(2, 3).mul(4)).toEqual(new Vec2(8, 12));
    });

    it("does not modify the original", () => {
      const v = new Vec2(1, 2);
      v.mul(5);
      expect(v).toEqual(new Vec2(1, 2));
    });

    it("returns a new Vec2", () => {
      expect(new Vec2(1, 2).mul(3)).not.toBe(new Vec2(1, 2));
    });

    it("handles negative scalar", () => {
      expect(new Vec2(1, 2).mul(-2)).toEqual(new Vec2(-2, -4));
    });

    it("handles zero scalar", () => {
      expect(new Vec2(1, 2).mul(0)).toEqual(new Vec2(0, 0));
    });
  });

  describe("len", () => {
    it("computes magnitude correctly", () => {
      expect(new Vec2(3, 4).len()).toBeCloseTo(5);
    });

    it("returns 0 for zero vector", () => {
      expect(Vec2.ZERO.len()).toBe(0);
    });

    it("returns 1 for unit vector", () => {
      expect(Vec2.UP.len()).toBeCloseTo(1);
    });

    it("does not modify the original", () => {
      const v = new Vec2(3, 4);
      v.len();
      expect(v).toEqual(new Vec2(3, 4));
    });
  });

  describe("lenSq", () => {
    it("computes squared magnitude", () => {
      expect(new Vec2(3, 4).lenSq()).toBe(25);
    });

    it("returns 0 for zero vector", () => {
      expect(Vec2.ZERO.lenSq()).toBe(0);
    });

    it("returns 2 for (1,1)", () => {
      expect(Vec2.ONE.lenSq()).toBe(2);
    });

    it("does not modify the original", () => {
      const v = new Vec2(3, 4);
      v.lenSq();
      expect(v).toEqual(new Vec2(3, 4));
    });
  });

  describe("normalize", () => {
    it("returns a unit vector", () => {
      const v = new Vec2(3, 4);
      const n = v.normalize();
      expect(n.len()).toBeCloseTo(1);
    });

    it("preserves direction", () => {
      const v = new Vec2(3, 4);
      const n = v.normalize();
      expect(n.x).toBeCloseTo(0.6);
      expect(n.y).toBeCloseTo(0.8);
    });

    it("returns zero vector for zero vector", () => {
      expect(Vec2.ZERO.normalize()).toEqual(Vec2.ZERO);
    });

    it("does not modify the original", () => {
      const v = new Vec2(3, 4);
      v.normalize();
      expect(v).toEqual(new Vec2(3, 4));
    });

    it("returns a new Vec2", () => {
      expect(new Vec2(3, 4).normalize()).not.toBe(new Vec2(3, 4));
    });
  });

  describe("dot", () => {
    it("computes dot product", () => {
      expect(new Vec2(1, 2).dot(new Vec2(3, 4))).toBe(11);
    });

    it("computes dot product of orthogonal vectors as 0", () => {
      expect(Vec2.UP.dot(Vec2.RIGHT)).toBe(0);
    });

    it("does not modify the original", () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      a.dot(b);
      expect(a).toEqual(new Vec2(1, 2));
      expect(b).toEqual(new Vec2(3, 4));
    });
  });

  describe("lerp", () => {
    it("interpolates between two vectors", () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      expect(a.lerp(b, 0.5)).toEqual(new Vec2(5, 5));
    });

    it("returns start when t is 0", () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(5, 6);
      expect(a.lerp(b, 0)).toEqual(a);
    });

    it("returns b when t is 1", () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(5, 6);
      expect(a.lerp(b, 1)).toEqual(b);
    });

    it("does not modify either original", () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      a.lerp(b, 0.5);
      expect(a).toEqual(new Vec2(0, 0));
      expect(b).toEqual(new Vec2(10, 10));
    });

    it("returns a new Vec2", () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 10);
      expect(a.lerp(b, 0.5)).not.toBe(a);
      expect(a.lerp(b, 0.5)).not.toBe(b);
    });
  });

  describe("dist", () => {
    it("computes Euclidean distance", () => {
      expect(new Vec2(0, 0).dist(new Vec2(3, 4))).toBeCloseTo(5);
    });

    it("is symmetric", () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(4, 6);
      expect(a.dist(b)).toBeCloseTo(b.dist(a));
    });

    it("returns 0 when comparing to self", () => {
      const v = new Vec2(1, 2);
      expect(v.dist(v)).toBe(0);
    });

    it("does not modify the original", () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(3, 4);
      a.dist(b);
      expect(a).toEqual(new Vec2(0, 0));
    });
  });

  describe("angle", () => {
    it("returns angle of vector in radians", () => {
      expect(Vec2.RIGHT.angle()).toBeCloseTo(0);
    });

    it("returns PI/2 for UP", () => {
      expect(Vec2.UP.angle()).toBeCloseTo(Math.PI / 2);
    });

    it("returns PI for LEFT", () => {
      expect(Vec2.RIGHT.mul(-1).angle()).toBeCloseTo(Math.PI);
    });

    it("returns -PI/2 for DOWN", () => {
      expect(Vec2.UP.mul(-1).angle()).toBeCloseTo(-Math.PI / 2);
    });

    it("returns 0 for zero vector", () => {
      expect(Vec2.ZERO.angle()).toBe(0);
    });

    it("does not modify the original", () => {
      const v = new Vec2(1, 1);
      v.angle();
      expect(v).toEqual(new Vec2(1, 1));
    });
  });

  describe("rotate", () => {
    it("rotates vector by given radians", () => {
      const v = new Vec2(1, 0);
      const rotated = v.rotate(Math.PI / 2);
      expect(rotated).toEqual(new Vec2(0, 1));
    });

    it("rotates 180 degrees", () => {
      const v = new Vec2(1, 0);
      const rotated = v.rotate(Math.PI);
      expect(rotated).toEqual(new Vec2(-1, 0));
    });

    it("does not modify the original", () => {
      const v = new Vec2(1, 0);
      v.rotate(Math.PI / 2);
      expect(v).toEqual(new Vec2(1, 0));
    });

    it("returns a new Vec2", () => {
      const v = new Vec2(1, 0);
      expect(v.rotate(Math.PI / 2)).not.toBe(v);
    });

    it("rotates 90 degrees counterclockwise", () => {
      const v = new Vec2(1, 0);
      expect(v.rotate(Math.PI / 2)).toEqual(new Vec2(0, 1));
      expect(v.rotate(Math.PI)).toEqual(new Vec2(-1, 0));
      expect(v.rotate((3 * Math.PI) / 2)).toEqual(new Vec2(0, -1));
    });

    it("rotates 45 degrees", () => {
      const v = new Vec2(1, 0);
      const rotated = v.rotate(Math.PI / 4);
      expect(rotated.len()).toBeCloseTo(1);
      expect(rotated.x).toBeCloseTo(Math.cos(Math.PI / 4));
      expect(rotated.y).toBeCloseTo(Math.sin(Math.PI / 4));
    });

    it("preserves length", () => {
      const v = new Vec2(3, 4);
      const rotated = v.rotate(Math.PI / 4);
      expect(rotated.len()).toBeCloseTo(v.len());
    });
  });

  describe("equals", () => {
    it("returns true for equal vectors", () => {
      expect(new Vec2(1, 2).equals(new Vec2(1, 2))).toBe(true);
    });

    it("returns false for different vectors", () => {
      expect(new Vec2(1, 2).equals(new Vec2(2, 1))).toBe(false);
    });

    it("returns true for self", () => {
      const v = new Vec2(1, 2);
      expect(v.equals(v)).toBe(true);
    });

    it("returns true for cloned vector", () => {
      const v = new Vec2(1, 2);
      expect(v.equals(v.clone())).toBe(true);
    });

    it("returns true for zero vectors", () => {
      expect(Vec2.ZERO.equals(new Vec2(0, 0))).toBe(true);
    });

    it("returns false for NaN comparison", () => {
      // NaN !== NaN in JavaScript
      expect(Vec2.ZERO.equals(new Vec2(NaN, 0))).toBe(false);
    });
  });

  describe("clone", () => {
    it("creates a new independent Vec2", () => {
      const original = new Vec2(1, 2);
      const cloned = original.clone();
      expect(cloned).not.toBe(original);
      expect(cloned).toEqual(original);
    });

    it("is independent after modification", () => {
      const original = new Vec2(1, 2);
      const cloned = original.clone();
      // Mutate original via addition (which returns new, so reassign)
      const mutated = original.add(new Vec2(5, 5));
      expect(mutated).toEqual(new Vec2(6, 7));
      expect(cloned).toEqual(new Vec2(1, 2));
    });

    it("does not modify the original", () => {
      const v = new Vec2(1, 2);
      v.clone();
      expect(v).toEqual(new Vec2(1, 2));
    });
  });

  describe("fromAngle", () => {
    it("creates a unit vector from angle", () => {
      const v = Vec2.fromAngle(0);
      expect(v.len()).toBeCloseTo(1);
      expect(v.x).toBeCloseTo(1);
      expect(v.y).toBeCloseTo(0);
    });

    it("creates correct unit vector for PI/2", () => {
      const v = Vec2.fromAngle(Math.PI / 2);
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(1);
    });

    it("creates correct unit vector for PI", () => {
      const v = Vec2.fromAngle(Math.PI);
      expect(v.x).toBeCloseTo(-1);
      expect(v.y).toBeCloseTo(0);
    });

    it("creates correct unit vector for 3PI/2", () => {
      const v = Vec2.fromAngle((3 * Math.PI) / 2);
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(-1);
    });

    it("produces a unit vector", () => {
      const v = Vec2.fromAngle(1.5);
      expect(v.len()).toBeCloseTo(1);
    });
  });

  describe("constants", () => {
    it("ZERO is (0,0)", () => {
      expect(Vec2.ZERO).toEqual(new Vec2(0, 0));
    });

    it("ONE is (1,1)", () => {
      expect(Vec2.ONE).toEqual(new Vec2(1, 1));
    });

    it("UP is (0,1)", () => {
      expect(Vec2.UP).toEqual(new Vec2(0, 1));
    });

    it("RIGHT is (1,0)", () => {
      expect(Vec2.RIGHT).toEqual(new Vec2(1, 0));
    });

    it("constants are read-only", () => {
      expect(() => {
        (Vec2.ZERO as any).x = 99;
      }).toThrow();
    });
  });

  describe("composability", () => {
    it("chaining add and mul", () => {
      const v = new Vec2(1, 1)
        .add(new Vec2(2, 3))
        .mul(2)
        .add(new Vec2(-1, -1));
      expect(v).toEqual(new Vec2(5, 9));
    });

    it("rotate then normalize", () => {
      const v = new Vec2(3, 4)
        .rotate(Math.PI / 2)
        .normalize();
      expect(v.len()).toBeCloseTo(1);
    });

    it("lerp then normalize", () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 0);
      const v = a.lerp(b, 0.5).normalize();
      expect(v.len()).toBeCloseTo(1);
      expect(v.x).toBeCloseTo(1);
      expect(v.y).toBeCloseTo(0);
    });
  });

  describe("edge cases", () => {
    it("handles negative coordinates", () => {
      const v = new Vec2(-3, -4);
      expect(v.len()).toBeCloseTo(5);
      expect(v.normalize()).toEqual(new Vec2(-0.6, -0.8));
    });

    it("handles zero in one component", () => {
      const v = new Vec2(0, 5);
      expect(v.len()).toBeCloseTo(5);
      expect(v.normalize()).toEqual(new Vec2(0, 1));
    });

    it("handles very large coordinates", () => {
      const v = new Vec2(1e10, 1e10);
      expect(v.len()).toBeCloseTo(Math.sqrt(2) * 1e10);
    });

    it("handles very small coordinates", () => {
      const v = new Vec2(1e-10, 1e-10);
      expect(v.len()).toBeCloseTo(Math.sqrt(2) * 1e-10);
    });

    it("handles zero vector in dot", () => {
      expect(Vec2.ZERO.dot(new Vec2(5, 5))).toBe(0);
    });

    it("handles zero vector in dist", () => {
      expect(Vec2.ZERO.dist(new Vec2(5, 5))).toBeCloseTo(Math.sqrt(50));
    });
  });
});
```