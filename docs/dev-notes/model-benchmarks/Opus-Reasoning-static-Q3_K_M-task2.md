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
import { describe, it, expect } from "vitest";
import { Vec2 } from "./vec2";

describe("Vec2", () => {
  describe("constructor", () => {
    it("stores x and y", () => {
      const v = new Vec2(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });
  });

  describe("immutable operations", () => {
    it("add returns new Vec2", () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      const c = a.add(b);
      expect(c).not.toBe(a);
      expect(c).not.toBe(b);
      expect(c.x).toBe(4);
      expect(c.y).toBe(6);
    });

    it("sub returns new Vec2", () => {
      const a = new Vec2(5, 7);
      const b = new Vec2(2, 3);
      const c = a.sub(b);
      expect(c.x).toBe(3);
      expect(c.y).toBe(4);
    });

    it("mul returns new Vec2", () => {
      const a = new Vec2(2, 3);
      const c = a.mul(3);
      expect(c.x).toBe(6);
      expect(c.y).toBe(9);
    });

    it("normalize returns new Vec2", () => {
      const a = new Vec2(3, 4);
      const n = a.normalize();
      expect(n.len()).toBeCloseTo(1);
    });

    it("rotate returns new Vec2", () => {
      const a = new Vec2(1, 0);
      const r = a.rotate(Math.PI / 2);
      expect(r.x).toBeCloseTo(0);
      expect(r.y).toBeCloseTo(1);
    });

    it("clone returns new Vec2", () => {
      const a = new Vec2(1, 2);
      const c = a.clone();
      expect(c).not.toBe(a);
      expect(c.x).toBe(1);
      expect(c.y).toBe(2);
    });
  });

  describe("len / lenSq", () => {
    it("len of (3,4) is 5", () => {
      expect(new Vec2(3, 4).len()).toBeCloseTo(5);
    });
    it("lenSq of (3,4) is 25", () => {
      expect(new Vec2(3, 4).lenSq()).toBeCloseTo(25);
    });
  });

  describe("dot", () => {
    it("1,2 · 3,4 = 11", () => {
      expect(new Vec2(1, 2).dot(new Vec2(3, 4))).toBeCloseTo(11);
    });
  });

  describe("lerp", () => {
    it("t=0 returns first, t=1 returns second", () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 20);
      expect(a.lerp(b, 0)).toStrictEqual(a);
      expect(a.lerp(b, 1)).toStrictEqual(b);
    });
    it("t=0.5 returns midpoint", () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(4, 6);
      expect(a.lerp(b, 0.5)).toStrictEqual(new Vec2(2, 3));
    });
  });

  describe("dist", () => {
    it("distance between (0,0) and (3,4) is 5", () => {
      expect(new Vec2(0, 0).dist(new Vec2(3, 4))).toBeCloseTo(5);
    });
  });

  describe("angle", () => {
    it("(1,0) → 0, (0,1) → PI/2", () => {
      expect(new Vec2(1, 0).angle()).toBeCloseTo(0);
      expect(new Vec2(0, 1).angle()).toBeCloseTo(Math.PI / 2);
    });
  });

  describe("equals", () => {
    it("true for same values", () => {
      expect(new Vec2(1, 2).equals(new Vec2(1, 2))).toBe(true);
    });
    it("false for different values", () => {
      expect(new Vec2(1, 2).equals(new Vec2(3, 4))).toBe(false);
    });
  });

  describe("fromAngle", () => {
    it("(0) → (1,0)", () => {
      expect(Vec2.fromAngle(0)).toStrictEqual(new Vec2(1, 0));
    });
    it("(PI/2) → (0,1)", () => {
      expect(Vec2.fromAngle(Math.PI / 2)).toStrictEqual(new Vec2(0, 1));
    });
  });

  describe("constants", () => {
    it("ZERO", () => expect(Vec2.ZERO).toStrictEqual(new Vec2(0, 0)));
    it("ONE", () => expect(Vec2.ONE).toStrictEqual(new Vec2(1, 1)));
    it("UP", () => expect(Vec2.UP).toStrictEqual(new Vec2(0, 1)));
    it("RIGHT", () => expect(Vec2.RIGHT).toStrictEqual(new Vec2(1, 0)));
  });
});
```
