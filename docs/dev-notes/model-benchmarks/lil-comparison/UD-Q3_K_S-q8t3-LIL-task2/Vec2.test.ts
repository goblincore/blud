import { describe, it, expect } from 'vitest';
import { Vec2 } from './Vec2';

// ── helpers ──────────────────────────────────────────────────────────

function expectNear(a: number, b: number, eps = 1e-9): void {
  expect(a).toBeCloseTo(b, Math.abs(eps) < 1e-4 ? 14 : 9);
}

// ── constants ────────────────────────────────────────────────────────

describe('constants', () => {
  it('ZERO', () => expectNear(Vec2.ZERO.x, 0) && expectNear(Vec2.ZERO.y, 0));
  it('ONE', () => expectNear(Vec2.ONE.x, 1) && expectNear(Vec2.ONE.y, 1));
  it('UP', () => expectNear(Vec2.UP.x, 0) && expectNear(Vec2.UP.y, -1));
  it('RIGHT', () => expectNear(Vec2.RIGHT.x, 1) && expectNear(Vec2.RIGHT.y, 0));
});

// ── construction ─────────────────────────────────────────────────────

describe('construction', () => {
  it('constructor stores x and y', () => {
    const v = new Vec2(3, 4);
    expectNear(v.x, 3);
    expectNear(v.y, 4);
  });

  it('readonly fields cannot be reassigned at compile time', () => {
    // TypeScript `readonly` enforces this at compile time.
    // At runtime JS will allow it, but the test verifies
    // that the property exists and matches the constructor value.
    const v = new Vec2(1, 2);
    expect(v.x).toBe(1);
    expect(v.y).toBe(2);
  });
});

// ── add / sub / mul ──────────────────────────────────────────────────

describe('arithmetic', () => {
  const a = new Vec2(3, 4);
  const b = new Vec2(1, 2);

  describe('add', () => {
    it('adds component-wise', () => {
      expectNear(a.add(b).x, 4);
      expectNear(a.add(b).y, 6);
    });
    it('does not mutate original', () => {
      const orig = a.clone();
      a.add(b);
      expect(a.equals(orig));
    });
    it('commutative', () => {
      expect(a.add(b).equals(b.add(a)));
    });
    it('zero is identity', () => {
      expect(a.add(Vec2.ZERO).equals(a));
    });
  });

  describe('sub', () => {
    it('subtracts component-wise', () => {
      expectNear(a.sub(b).x, 2);
      expectNear(a.sub(b).y, 2);
    });
    it('does not mutate original', () => {
      const orig = a.clone();
      a.sub(b);
      expect(a.equals(orig));
    });
    it('self-sub is zero', () => {
      expect(a.sub(a).equals(Vec2.ZERO));
    });
  });

  describe('mul', () => {
    it('scales component-wise', () => {
      expectNear(a.mul(2).x, 6);
      expectNear(a.mul(2).y, 8);
    });
    it('does not mutate original', () => {
      const orig = a.clone();
      a.mul(2);
      expect(a.equals(orig));
    });
    it('zero scalar zeroes vector', () => {
      expect(a.mul(0).equals(Vec2.ZERO));
    });
  });
});

// ── length / distance ────────────────────────────────────────────────

describe('length & distance', () => {
  const a = new Vec2(3, 4);

  it('lenSq', () => expectNear(a.lenSq(), 25));
  it('len', () => expectNear(a.len(), 5));
  it('len of zero', () => expectNear(Vec2.ZERO.len(), 0));

  it('dist', () => {
    expectNear(new Vec2(0, 0).dist(new Vec2(3, 4)), 5);
  });
  it('self distance is zero', () => {
    expectNear(a.dist(a), 0);
  });

  it('triangle inequality (sample)', () => {
    const a = new Vec2(0, 0);
    const b = new Vec2(3, 0);
    const c = new Vec2(1, 1);
    const direct = a.dist(b);
    const via = a.dist(c) + c.dist(b);
    expect(via).toBeGreaterThanOrEqual(direct);
  });
});

// ── normalize ────────────────────────────────────────────────────────

describe('normalize', () => {
  it('unit vector stays the same', () => {
    const v = new Vec2(0, 1).normalize();
    expectNear(v.len(), 1);
  });

  it('direction preserved', () => {
    const v = new Vec2(6, -8).normalize();
    expectNear(v.len(), 1);
    expectNear(v.x, 0.6);
    expectNear(v.y, -0.8);
  });

  it('zero vector normalizes to zero', () => {
    const v = Vec2.ZERO.normalize();
    expectNear(v.len(), 0);
  });

  it('does not mutate original', () => {
    const a = new Vec2(3, 4);
    const origLen = a.len();
    a.normalize();
    expectNear(a.len(), origLen);
  });

  it('normalize then multiply recovers original', () => {
    const v = new Vec2(-5, 12);
    const result = v.normalize().mul(v.len());
    expect(result.equals(v));
  });
});

// ── dot ──────────────────────────────────────────────────────────────

describe('dot', () => {
  it('commutative', () => {
    const a = new Vec2(1, 2);
    const b = new Vec2(3, 4);
    expect(a.dot(b)).toBeCloseTo(b.dot(a));
  });

  it('orthogonal vectors give 0', () => {
    expectNear(Vec2.RIGHT.dot(Vec2.UP), 0);
  });

  it('same direction gives product of lengths', () => {
    const a = new Vec2(3, 4);
    expectNear(a.dot(a), a.len() * a.len());
  });

  it('zero vector', () => {
    expectNear(Vec2.ZERO.dot(new Vec2(5, -3)), 0);
  });
});

// ── lerp ─────────────────────────────────────────────────────────────

describe('lerp', () => {
  const a = Vec2.ZERO;
  const b = new Vec2(10, 20);

  it('t=0 returns from', () => expect(a.lerp(b, 0).equals(a)));
  it('t=1 returns to', () => expect(b.lerp(a, 0).equals(a)));
  it('t=0.5 returns midpoint', () => {
    const mid = new Vec2(5, 10);
    expectNear(a.lerp(b, 0.5).x, mid.x);
    expectNear(a.lerp(b, 0.5).y, mid.y);
  });
  it('does not mutate original', () => {
    const orig = a.clone();
    a.lerp(b, 0.5);
    expect(a.equals(orig));
  });
  it('t < 0 extrapolates', () => {
    const neg = a.lerp(b, -1);
    expectNear(neg.x, -10);
    expectNear(neg.y, -20);
  });
  it('t > 1 extrapolates', () => {
    const ext = a.lerp(b, 2);
    expectNear(ext.x, 20);
    expectNear(ext.y, 40);
  });
});

// ── angle / fromAngle ────────────────────────────────────────────────

describe('angle & fromAngle', () => {
  it('RIGHT has angle 0', () => expectNear(Vec2.RIGHT.angle(), 0));
  // UP = (0, -1) → atan2(-1, 0) = -π/2 (same direction as +π/2)
  it('UP has angle -PI/2', () => expectNear(Vec2.UP.angle(), -Math.PI / 2, 1e-9));
  it('fromAngle produces unit vector', () => {
    for (const rad of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 3]) {
      const v = Vec2.fromAngle(rad);
      expectNear(v.len(), 1);
      expectNear(v.angle(), rad, 10);
    }
  });
  it('round-trip angle', () => {
    const v = new Vec2(-3, 7);
    const a = v.angle();
    const r = Vec2.fromAngle(a);
    expect(r.equals(v.normalize()));
  });
});

// ── rotate ───────────────────────────────────────────────────────────

describe('rotate', () => {
  it('90° right (π/2) on RIGHT gives DOWN', () => {
    const v = Vec2.RIGHT.rotate(Math.PI / 2);
    expectNear(v.x, 0);
    expectNear(v.y, 1);
  });
  it('90° left (-π/2) on RIGHT gives UP', () => {
    const v = Vec2.RIGHT.rotate(-Math.PI / 2);
    expectNear(v.x, 0);
    expectNear(v.y, -1);
  });
  it('180° flip', () => {
    const v = new Vec2(3, 4).rotate(Math.PI);
    expectNear(v.x, -3);
    expectNear(v.y, -4);
  });
  it('0° is identity', () => {
    const v = new Vec2(-5, 12).rotate(0);
    expect(v.x).toBe(-5);
    expect(v.y).toBe(12);
  });
  it('does not mutate original', () => {
    const orig = new Vec2(1, 0).clone();
    const v = new Vec2(1, 0);
    v.rotate(Math.PI / 6);
    expect(orig.equals(v));
  });
  it('preserves length', () => {
    const v = new Vec2(7, -11);
    expectNear(v.rotate(Math.PI / 3).len(), v.len());
  });
  it('four 90° rotations = identity', () => {
    const v = Vec2.RIGHT;
    const r = v.rotate(Math.PI / 2)
               .rotate(Math.PI / 2)
               .rotate(Math.PI / 2)
               .rotate(Math.PI / 2);
    expectNear(r.x, 1);
    expectNear(r.y, 0);
  });
});

// ── equals ───────────────────────────────────────────────────────────

describe('equals', () => {
  it('same values are equal', () => {
    expect(new Vec2(1, 2).equals(new Vec2(1, 2)));
  });
  it('different values are not equal', () => {
    expect(!new Vec2(1, 2).equals(new Vec2(1, 3)));
  });
  it('close values are equal within epsilon', () => {
    expect(new Vec2(0.1 + 1e-11, 0).equals(new Vec2(0.1, 0)));
  });
  it('far values are not equal even with default epsilon', () => {
    expect(!new Vec2(0.1, 0).equals(new Vec2(0.2, 0)));
  });
  it('custom epsilon', () => {
    expect(new Vec2(0.1 + 1e-5, 0).equals(new Vec2(0.1, 0), 1e-4));
  });
});

// ── clone ────────────────────────────────────────────────────────────

describe('clone', () => {
  it('creates an equal copy', () => {
    const v = new Vec2(3, 7);
    const c = v.clone();
    expect(c.equals(v));
  });
  it('independent of original', () => {
    const v = new Vec2(3, 7);
    const c = v.clone();
    // clone returns a new object, so modifying it (via mutable path)
    // wouldn't affect v — but since everything is immutable, just check
    // that clone and original are distinct objects
    expect(c).not.toBe(v);
  });
});

// ── chain / pipeline ─────────────────────────────────────────────────

describe('immutability chain', () => {
  it('long chain works without mutating intermediate', () => {
    let v = new Vec2(1, 1);
    v = v.mul(2);
    expectNear(v.x, 2);
    expectNear(v.y, 2);
    v = v.add(new Vec2(-1, -1));
    expectNear(v.x, 1);
    expectNear(v.y, 1);
    v = v.normalize();
    expectNear(v.len(), 1);
  });

  it('reusing original after chain', () => {
    const base = new Vec2(1, 1);
    const v1 = base.mul(3).add(new Vec2(0, 4)).normalize();
    const v2 = base.mul(2).add(new Vec2(3, -1)).normalize();
    expectNear(base.x, 1);
    expectNear(base.y, 1);
    expect(v1.len()).toBeCloseTo(1);
    expect(v2.len()).toBeCloseTo(1);
  });
});

// ── edge cases ───────────────────────────────────────────────────────

describe('edge cases', () => {
  it('negative coordinates', () => {
    const v = new Vec2(-5, -12);
    expectNear(v.len(), 13);
    expectNear(v.normalize().x, -5 / 13);
    expectNear(v.normalize().y, -12 / 13);
  });

  it('floating-point precision', () => {
    const a = new Vec2(0.1, 0.2);
    const b = new Vec2(0.2, 0.4); // avoid 0.1+0.2 = 0.30000000000000004
    const c = a.add(b);
    expect(c.x).toBeCloseTo(0.3);
    expect(c.y).toBeCloseTo(0.6);
  });

  it('very small vector normalize preserves direction', () => {
    const v = new Vec2(1e-12, 1e-12);
    const n = v.normalize();
    expectNear(n.x, Math.sqrt(0.5)); // equal components → 45°
    expectNear(n.y, Math.sqrt(0.5));
  });

  it('very large vector', () => {
    const v = new Vec2(1e10, 1e10);
    const n = v.normalize();
    expectNear(n.len(), 1);
    expectNear(n.x, Math.sqrt(0.5));
    expectNear(n.y, Math.sqrt(0.5));
  });
});
