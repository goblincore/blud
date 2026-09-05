/**
 * Immutable 2D vector for game-space math (screen, velocity, direction, etc).
 * All mutating-style methods return a new Vec2 — the original is never changed.
 */
export class Vec2 {
  constructor(public readonly x: number, public readonly y: number) {}

  // ── arithmetic ────────────────────────────────────────────────────

  add(v: Vec2): Vec2 {
    return new Vec2(this.x + v.x, this.y + v.y);
  }

  sub(v: Vec2): Vec2 {
    return new Vec2(this.x - v.x, this.y - v.y);
  }

  mul(s: number): Vec2 {
    return new Vec2(this.x * s, this.y * s);
  }

  // ── length / distance ─────────────────────────────────────────────

  len(): number {
    return Math.sqrt(this.lenSq());
  }

  lenSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  dist(v: Vec2): number {
    return this.sub(v).len();
  }

  // ── normalisation ─────────────────────────────────────────────────

  normalize(): Vec2 {
    const l = this.len();
    if (l === 0) return new Vec2(0, 0);
    return this.mul(1 / l);
  }

  // ── vector ops ────────────────────────────────────────────────────

  dot(v: Vec2): number {
    return this.x * v.x + this.y * v.y;
  }

  lerp(v: Vec2, t: number): Vec2 {
    return new Vec2(
      this.x + (v.x - this.x) * t,
      this.y + (v.y - this.y) * t
    );
  }

  angle(): number {
    return Math.atan2(this.y, this.x);
  }

  rotate(rad: number): Vec2 {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return new Vec2(
      this.x * c - this.y * s,
      this.x * s + this.y * c
    );
  }

  // ── comparison ────────────────────────────────────────────────────

  equals(v: Vec2, eps: number = 1e-10): boolean {
    return Math.abs(this.x - v.x) < eps && Math.abs(this.y - v.y) < eps;
  }

  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  // ── static helpers ────────────────────────────────────────────────

  static fromAngle(rad: number): Vec2 {
    return new Vec2(Math.cos(rad), Math.sin(rad));
  }

  // ── constants ─────────────────────────────────────────────────────

  static readonly ZERO = new Vec2(0, 0);
  static readonly ONE = new Vec2(1, 1);
  static readonly UP = new Vec2(0, -1);
  static readonly RIGHT = new Vec2(1, 0);
}
