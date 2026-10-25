// src/lab/sdf-zombie/webgpu/barrel-state.ts
//
// EXPLODING BARRELS (spec 2026-10-24 §8, plan 2026-10-25-sector-levels-3b): hit points, hits by kind, the blast
// catch (every intact barrel within catchRadiusM of a blast, unless shielded, lights after a 0.1–0.3 s delay hashed
// from its id and the blast's count — deterministic, no RNG stream), the fuse step, and the segment-vs-drum test the
// projectiles use. A barrel shot to 0 HP is lit with fuse 0 and goes up on the NEXT stepBarrels — never inside the
// caller's pellet loop.
//
// Pure: no three.js, no DOM.
import type { Vec3 } from '../types';

export const BARREL = {
  radiusM: 0.3,
  heightM: 0.95,
  hp: 20,
  damage: { pellet: 4, slug: 20, melee: 10, round: 3 },
  /** Centre to centre, 3D. Doom-like reach (owner, 2026-10-25): E1M1's closest pair, b48–b50, is 4.3 m apart. */
  catchRadiusM: 4.5,
  chainDelaySec: [0.1, 0.3] as const,
} as const;

export type BarrelHitKind = keyof typeof BARREL.damage;
export type BarrelPhase = 'intact' | 'lit' | 'gone';
export interface BarrelState { id: string; pos: Vec3; hp: number; phase: BarrelPhase; fuse: number }

export function makeBarrels(defs: readonly { id: string; pos: Vec3 }[]): BarrelState[] {
  return defs.map(d => ({ id: d.id, pos: [d.pos[0], d.pos[1], d.pos[2]] as Vec3, hp: BARREL.hp, phase: 'intact' as const, fuse: 0 }));
}

/** Where a barrel explodes: the middle of the drum. */
export function barrelCentre(b: BarrelState): Vec3 {
  return [b.pos[0], b.pos[1] + BARREL.heightM * 0.5, b.pos[2]];
}

export function hitBarrel(b: BarrelState, kind: BarrelHitKind): BarrelState {
  if (b.phase !== 'intact') return b;
  const hp = b.hp - BARREL.damage[kind];
  return hp > 0 ? { ...b, hp } : { ...b, hp: 0, phase: 'lit', fuse: 0 };
}

/** FNV-1a 32 of `id:blast` mapped into chainDelaySec. */
export function chainDelay(id: string, blast: number): number {
  let h = 0x811c9dc5;
  const s = `${id}:${blast}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  const [lo, hi] = BARREL.chainDelaySec;
  return lo + (hi - lo) * (h / 0x100000000);
}

export function catchBlast(barrels: readonly BarrelState[], at: Vec3, blast: number,
  shielded?: (from: Vec3, to: Vec3) => boolean): BarrelState[] {
  return barrels.map(b => {
    if (b.phase !== 'intact') return b;
    const c = barrelCentre(b);
    if (Math.hypot(c[0] - at[0], c[1] - at[1], c[2] - at[2]) > BARREL.catchRadiusM) return b;
    if (shielded?.(at, c)) return b;
    return { ...b, phase: 'lit' as const, fuse: chainDelay(b.id, blast) };
  });
}

export function stepBarrels(barrels: readonly BarrelState[], dt: number): { barrels: BarrelState[]; detonations: { id: string; at: Vec3 }[] } {
  const detonations: { id: string; at: Vec3 }[] = [];
  const next = barrels.map(b => {
    if (b.phase !== 'lit') return b;
    const fuse = b.fuse - dt;
    if (fuse > 0) return { ...b, fuse };
    detonations.push({ id: b.id, at: barrelCentre(b) });
    return { ...b, fuse: 0, phase: 'gone' as const };
  });
  return { barrels: next, detonations };
}

/** Segment a→b vs the upright drum (radius + pad, feet to top): the first t in 0..1, 0 when a is inside, or null. */
export function segmentHitsBarrel(a: Vec3, b: Vec3, barrel: BarrelState, pad = 0): number | null {
  const r = BARREL.radiusM + pad, y0 = barrel.pos[1], y1 = barrel.pos[1] + BARREL.heightM;
  const ox = a[0] - barrel.pos[0], oz = a[2] - barrel.pos[2];
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const inside = (t: number) => { const y = a[1] + dy * t; return y >= y0 && y <= y1; };
  if (ox * ox + oz * oz <= r * r && inside(0)) return 0;
  let best: number | null = null;
  const A = dx * dx + dz * dz;
  if (A > 1e-12) {
    const B = 2 * (ox * dx + oz * dz), C = ox * ox + oz * oz - r * r, disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const t = (-B - Math.sqrt(disc)) / (2 * A);
      if (t >= 0 && t <= 1 && inside(t)) best = t;
    }
  }
  for (const capY of [y1, y0]) {
    if (Math.abs(dy) < 1e-12) continue;
    const t = (capY - a[1]) / dy;
    if (t < 0 || t > 1) continue;
    const x = ox + dx * t, z = oz + dz * t;
    if (x * x + z * z <= r * r && (best === null || t < best)) best = t;
  }
  return best;
}

/** The point ON the drum's surface (side, lid or foot) nearest q — where an impact effect sits. From outside: the
 *  solid's nearest point (radial and height clamped). From inside: pushed out through the nearest face. */
export function barrelSurfacePoint(barrel: BarrelState, q: Vec3): Vec3 {
  const R = BARREL.radiusM, [cx, y0, cz] = barrel.pos, y1 = y0 + BARREL.heightM;
  const ox = q[0] - cx, oz = q[2] - cz, d = Math.hypot(ox, oz);
  const insideR = d <= R, insideY = q[1] >= y0 && q[1] <= y1;
  if (!(insideR && insideY)) {
    const s = d > R ? R / d : 1;
    return [cx + ox * s, Math.min(y1, Math.max(y0, q[1])), cz + oz * s];
  }
  const toSide = R - d, toTop = y1 - q[1], toFoot = q[1] - y0;
  if (toTop <= toSide && toTop <= toFoot) return [q[0], y1, q[2]];
  if (toFoot <= toSide) return [q[0], y0, q[2]];
  if (d < 1e-12) return [cx + R, q[1], cz];
  return [cx + ox * (R / d), q[1], cz + oz * (R / d)];
}
