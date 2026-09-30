// src/lab/sdf-zombie/flesh-bits.test.ts
import { describe, expect, it } from 'vitest';
import { FLESH_BITS, fleshBitCount, fleshBits, fleshEviction, fleshOverCap, fleshRand, fleshShrink, swingBlow } from './flesh-bits';
import { GORE_COLORS } from './head-pop';
import type { Vec3 } from './types';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };

describe('fleshBitCount', () => {
  it('body 3-5, head 5-7, H x1.5', () => {
    const seen = { body: new Set<number>(), head: new Set<number>(), bodyH: new Set<number>(), headH: new Set<number>() };
    const r = fleshRand(7);
    for (let i = 0; i < 400; i++) {
      seen.body.add(fleshBitCount('body', 'R', r));
      seen.head.add(fleshBitCount('head', 'L', r));
      seen.bodyH.add(fleshBitCount('body', 'H', r));
      seen.headH.add(fleshBitCount('head', 'H', r));
    }
    expect([...seen.body].sort()).toEqual([3, 4, 5]);
    expect([...seen.head].sort()).toEqual([5, 6, 7]);
    expect(Math.min(...seen.bodyH)).toBe(Math.round(3 * 1.5));
    expect(Math.max(...seen.bodyH)).toBe(Math.round(5 * 1.5));
    expect(Math.min(...seen.headH)).toBe(Math.round(5 * 1.5));
    expect(Math.max(...seen.headH)).toBe(Math.round(7 * 1.5));
  });
});

describe('fleshBits', () => {
  const point: Vec3 = [1, 1.3, -2];
  const normal: Vec3 = [0, 0, 1];          // the wound faces +z
  const blow: Vec3 = unit([1, 0, -1]);     // a sideways blow into the body
  const colours = new Set([GORE_COLORS.meat, GORE_COLORS.fat].map(c => c.join(',')));

  it('returns `count` valid gob pieces with 2-4 prims, sized FLESH_BITS.size (x scale)', () => {
    for (const scale of [1, 1.5]) {
      const bits = fleshBits(point, blow, normal, 6, fleshRand(3), scale);
      expect(bits).toHaveLength(6);
      for (const b of bits) {
        expect(b.kind).toBe('gob');
        expect(b.tag).toBe('flesh');
        expect(b.limb).toBe('torso');
        expect(b.tornAt).toEqual([]);
        expect(b.bones).toEqual([]);
        expect(b.prims.length).toBeGreaterThanOrEqual(2);
        expect(b.prims.length).toBeLessThanOrEqual(4);
        expect(b.restitution).toBe(FLESH_BITS.restitution);
        expect(b.wallRestitution).toBe(FLESH_BITS.restitution);
        const main = b.prims[0]!;
        expect(main.radius).toBeGreaterThanOrEqual(FLESH_BITS.size[0] * scale - 1e-9);
        expect(main.radius).toBeLessThanOrEqual(FLESH_BITS.size[1] * scale + 1e-9);
        for (const p of b.prims) {
          expect(p.op ?? 'add').toBe('add');
          expect(p.gloss ?? 0).toBeGreaterThan(0);
          expect([...p.a, ...p.b, p.radius, ...p.scale].every(Number.isFinite)).toBe(true);
          // Every prim sits near the piece's origin (the chunk's extent is measured from it).
          expect(len([p.a[0] - b.origin[0], p.a[1] - b.origin[1], p.a[2] - b.origin[2]])).toBeLessThan(FLESH_BITS.size[1] * scale * 1.5);
        }
        expect([...b.origin, ...b.vel, ...b.angVel].every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('colours: meat always, skin (unpainted = the zombie\'s own) or fat on the side; glossy meat', () => {
    const bits = fleshBits(point, blow, normal, 40, fleshRand(11), 1);
    let skin = 0, fat = 0;
    for (const b of bits) {
      expect(b.prims[0]!.color).toEqual(expect.any(Array));
      // The main gob is meat (a brightness jitter of GORE_COLORS.meat: red-dominant).
      const m = b.prims[0]!.color!;
      expect(m[0]).toBeGreaterThan(m[1] * 4);
      expect(b.prims[0]!.gloss!).toBeGreaterThanOrEqual(0.6);
      expect(b.prims[1]!.color![0]).toBeGreaterThan(b.prims[1]!.color![1] * 4);   // the second meat lobe
      for (const p of b.prims.slice(2)) {
        if (p.color === undefined) skin++;
        else { expect(colours.has(p.color.join(','))).toBe(true); fat++; }
      }
    }
    expect(skin).toBeGreaterThan(5);
    expect(fat).toBeGreaterThan(2);
  });

  it('throws outward along the normal, along the blow, inside the cone, at 2-5 m/s (x sqrt scale), spinning', () => {
    for (const scale of [1, 1.5]) {
      const bits = fleshBits(point, blow, normal, 60, fleshRand(5), scale);
      const tang = unit([blow[0], blow[1], 0]);   // blow minus its normal part
      let along = 0;
      for (const b of bits) {
        const s = len(b.vel);
        expect(s).toBeGreaterThanOrEqual(FLESH_BITS.speed[0] * Math.sqrt(scale) - 1e-9);
        expect(s).toBeLessThanOrEqual(FLESH_BITS.speed[1] * Math.sqrt(scale) + 1e-9);
        const d = unit(b.vel);
        expect(dot(d, normal)).toBeGreaterThan(0.05);     // never back into the body
        const axis = unit([tang[0] * FLESH_BITS.blowW + normal[0] * FLESH_BITS.outW, tang[1] * FLESH_BITS.blowW + FLESH_BITS.upW, tang[2] * FLESH_BITS.blowW + normal[2] * FLESH_BITS.outW]);
        expect(Math.acos(Math.min(1, dot(d, axis)))).toBeLessThanOrEqual(FLESH_BITS.cone + 1e-6);
        if (dot(d, tang) > 0) along++;
        const w = len(b.angVel);
        expect(w).toBeGreaterThanOrEqual(FLESH_BITS.spin[0] - 1e-9);
        expect(w).toBeLessThanOrEqual(FLESH_BITS.spin[1] + 1e-9);
      }
      expect(along / bits.length).toBeGreaterThan(0.8);  // mostly along the blow
    }
  });

  it('a blow straight into the wound still throws every bit out of it (no NaN)', () => {
    const bits = fleshBits(point, [0, 0, -1], normal, 10, fleshRand(9), 1);
    for (const b of bits) expect(dot(unit(b.vel), normal)).toBeGreaterThan(0.09);
  });

  it('is deterministic from the seeded rand', () => {
    const a = fleshBits(point, blow, normal, 5, fleshRand(42), 1.5);
    const b = fleshBits(point, blow, normal, 5, fleshRand(42), 1.5);
    const c = fleshBits(point, blow, normal, 5, fleshRand(43), 1.5);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('flesh lifetime and eviction', () => {
  it('shrinks over the last FLESH_BITS.shrinkS of its life, then is gone', () => {
    const { lifeS, shrinkS } = FLESH_BITS;
    expect(fleshShrink(0)).toBe(1);
    expect(fleshShrink(lifeS - shrinkS)).toBe(1);
    expect(fleshShrink(lifeS - shrinkS / 2)).toBeCloseTo(0.5, 6);
    expect(fleshShrink(lifeS)).toBe(0);
    expect(fleshShrink(lifeS + 3)).toBe(0);
  });

  it('over the cap: the oldest flesh bit goes', () => {
    const live = [{ tag: 'eye' as const }, {}, { tag: 'flesh' as const }, { tag: 'flesh' as const }, {}];
    expect(fleshOverCap(live, 3)).toBe(-1);
    expect(fleshOverCap(live, 2)).toBe(2);
  });

  it('a full budget evicts flesh first, then a baked gib, then other live gibs, eyes last — never an eye for flesh', () => {
    const E = { tag: 'eye' as const }, F = { tag: 'flesh' as const }, G = {};
    expect(fleshEviction([E, G, F, F], 2)).toEqual({ from: 'live', index: 2 });
    expect(fleshEviction([E, G], 2)).toEqual({ from: 'baked' });
    expect(fleshEviction([E, G], 0)).toEqual({ from: 'live', index: 1 });
    expect(fleshEviction([E, E], 0)).toEqual({ from: 'live', index: 0 });
    expect(fleshEviction([], 0)).toEqual(null);
    // Flesh spam over a live eye: every eviction takes flesh, the eye survives.
    const live: { tag?: 'eye' | 'flesh' }[] = [E];
    for (let i = 0; i < 50; i++) {
      live.push(F);
      if (live.length > 8) {
        const e = fleshEviction(live, 0)!;
        expect(e.from).toBe('live');
        if (e.from === 'live') { expect(live[e.index]!.tag).toBe('flesh'); live.splice(e.index, 1); }
      }
    }
    expect(live[0]).toBe(E);
  });
});

describe('swingBlow', () => {
  it('turns the eye → hit direction into the swing\'s sweep across the view', () => {
    const fwd: Vec3 = [0, 0, -1];   // looking down −z: right is +x
    const R = swingBlow(fwd, 'R'), L = swingBlow(fwd, 'L'), H = swingBlow(fwd, 'H');
    expect(R[0]).toBeLessThan(-0.4); expect(R[1]).toBeLessThan(-0.5);
    expect(L[0]).toBeGreaterThan(0.8);
    expect(H[0]).toBeLessThan(-0.9); expect(Math.abs(H[1])).toBeLessThan(1e-9);
    for (const v of [R, L, H]) { expect(len(v)).toBeCloseTo(1, 9); expect(v[2]).toBeLessThan(0); }
    // Yawed 90° (looking down +x): right is +z.
    expect(swingBlow([1, 0, 0], 'L')[2]).toBeGreaterThan(0.8);
  });
});
