// src/lab/sdf-zombie/zap-arcs.ts
//
// THE ZAP'S CRAWL ARCS (look spike 2026-11-18): small arcs crawling over a zapped body and spark-like forks
// leaping off it. Pure path generation on the body's own posed primitives (each a capsule: two ends and a
// radius), so a ball, a dog and a man each get arcs where their flesh is; webgpu/game-zap-fx.ts draws the paths
// through the brain arcs' ribbons (character-effects.ts) and re-strikes them many times a second. The paths are
// brain-arcs.ts's: midpoint displacement over a base line.
import { ARC_POINTS, arcRng, jag } from './brain-arcs';
import type { Vec3 } from './types';

export const ZAP_ARCS = Object.freeze({
  /** Strikes a second. */
  hz: 24,
  /** An arc's ends sit this many radii from a part's axis, and a crawl's middle bows out to this many. */
  seat: 1.35,
  bow: 1.8,
  /** Shares of the three kinds: a crawl on one part, a bridge to another, a leap into the air; and how far off
   *  (m, centre to centre) a bridge looks for its other part. */
  crawl: 0.3,
  bridge: 0.45,
  reachM: [0.2, 0.75] as const,
  /** A leap's length (m), and how jagged each kind is (the kink per halving, as a share of the span). */
  leapM: [0.2, 0.55] as const,
  rough: 0.3,
  leapRough: 0.42,
});

/** A body part an arc can sit on: a posed primitive's two ends and its radius (world). A ball has a === b. */
export interface ZapArcPart { a: Vec3; b: Vec3; radius: number }

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const mixv = (a: Vec3, b: Vec3, u: number): Vec3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function dir(rng: () => number): Vec3 {
  const y = rng() * 2 - 1, a = rng() * Math.PI * 2, r = Math.sqrt(Math.max(0, 1 - y * y));
  return [Math.cos(a) * r, y, Math.sin(a) * r];
}
const mid = (p: ZapArcPart): Vec3 => mixv(p.a, p.b, 0.5);

/**
 * `count` arcs over `parts` for the strike `seed`: each a polyline of ARC_POINTS world points. No parts, no arcs.
 * The same seed and parts strike the same arcs.
 */
export function strikeZapArcs(seed: number, parts: readonly ZapArcPart[], count: number): Vec3[][] {
  if (parts.length === 0 || !(count > 0)) return [];
  const rng = arcRng(seed), arcs: Vec3[][] = [];
  const n = ARC_POINTS - 1;
  for (let k = 0; k < Math.round(count); k++) {
    const A = parts[Math.floor(rng() * parts.length) % parts.length]!;
    const u0 = rng(), d0 = dir(rng), axis0 = mixv(A.a, A.b, u0), a = add(axis0, scale(d0, A.radius * ZAP_ARCS.seat));
    const kind = rng();
    let base: Vec3[];
    if (kind < ZAP_ARCS.crawl || (kind < ZAP_ARCS.crawl + ZAP_ARCS.bridge && parts.length < 2)) {
      // A crawl: along and round the same part, bowed out over it.
      const u1 = rng(), d1 = unit(add(d0, scale(dir(rng), 1.1)));
      base = Array.from({ length: n + 1 }, (_, i) => {
        const u = i / n, d = unit(add(scale(d0, 1 - u), scale(d1, u)));
        const out = ZAP_ARCS.seat + (ZAP_ARCS.bow - ZAP_ARCS.seat) * Math.sin(Math.PI * u);
        return add(mixv(axis0, mixv(A.a, A.b, u1), u), scale(d, A.radius * out));
      });
      arcs.push(jag(base, ZAP_ARCS.rough, rng));
    } else if (kind < ZAP_ARCS.crawl + ZAP_ARCS.bridge) {
      // A bridge: to another part a reach away (a hand to the head, a hip to a wrist), so the arc spans the body;
      // with none in reach, to the nearest.
      let B = parts[0]!, best = Infinity;
      for (const p of parts) { if (p === A) continue; const d = len(sub(mid(p), axis0)); if (d < best) { best = d; B = p; } }
      for (let tries = 0; tries < 6; tries++) {
        const p = parts[Math.floor(rng() * parts.length) % parts.length]!;
        const d = len(sub(mid(p), axis0));
        if (p !== A && d >= ZAP_ARCS.reachM[0] && d <= ZAP_ARCS.reachM[1]) { B = p; break; }
      }
      const axis1 = mixv(B.a, B.b, rng());
      const b = add(axis1, scale(unit(add(unit(sub(axis0, axis1)), scale(dir(rng), 0.8))), B.radius * ZAP_ARCS.seat));
      base = Array.from({ length: n + 1 }, (_, i) => mixv(a, b, i / n));
      arcs.push(jag(base, ZAP_ARCS.rough, rng));
    } else {
      // A leap: off the body into the air, up more than down. Reads as a spark thrown off.
      const out = unit(add(d0, [0, 0.35, 0]));
      const b = add(a, scale(out, ZAP_ARCS.leapM[0] + (ZAP_ARCS.leapM[1] - ZAP_ARCS.leapM[0]) * rng()));
      base = Array.from({ length: n + 1 }, (_, i) => mixv(a, b, i / n));
      arcs.push(jag(base, ZAP_ARCS.leapRough, rng));
    }
  }
  return arcs;
}

/** The box round `parts` (both ends out to the radius): its centre and half sizes. Null with no parts. */
export function zapPartsBox(parts: readonly ZapArcPart[]): { center: Vec3; half: Vec3 } | null {
  if (parts.length === 0) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (const e of [p.a, p.b]) for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(lo[i]!, e[i]! - p.radius);
    hi[i] = Math.max(hi[i]!, e[i]! + p.radius);
  }
  return { center: [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2], half: [(hi[0]! - lo[0]!) / 2, (hi[1]! - lo[1]!) / 2, (hi[2]! - lo[2]!) / 2] };
}
