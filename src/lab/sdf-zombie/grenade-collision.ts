// Swept sphere vs level boxes/planes and live SDF actors. Nearest contact wins.
import type { Vec3 } from './types';
import type { FlightBox } from './dynamite-flight';
import type { BuildResult } from './build-body';
import type { GrenadeContact } from './grenade-flight';
import { sdBody } from './validate';
import { worldHitToWound } from './damage';
import { add, sub, scale, len, normalize, lerp } from './vec';

export interface GrenadeBody { id: number; body: BuildResult; yaw: number; flesh: boolean }
function boxHit(from: Vec3, to: Vec3, r: number, b: FlightBox): GrenadeContact | null {
  const d = sub(to, from);
  let enter = 0, exit = 1, normal: Vec3 = [0, 1, 0];
  const inside = from.every((x, i) => x >= b.min[i]! - r && x <= b.max[i]! + r);
  if (inside) {
    let depth = Infinity;
    for (let i = 0; i < 3; i++) for (const sign of [-1, 1]) {
      const gap = sign < 0 ? from[i]! - b.min[i]! + r : b.max[i]! + r - from[i]!;
      if (gap < depth) { depth = gap; normal = i === 0 ? [sign, 0, 0] : i === 1 ? [0, sign, 0] : [0, 0, sign]; }
    }
    const center = add(from, scale(normal, depth));
    return { t: 0, center, point: sub(center, scale(normal, r)), normal };
  }
  for (let i = 0; i < 3; i++) {
    const lo = b.min[i]! - r, hi = b.max[i]! + r;
    if (Math.abs(d[i]!) < 1e-12) { if (from[i]! < lo || from[i]! > hi) return null; continue; }
    let near = (lo - from[i]!) / d[i]!, far = (hi - from[i]!) / d[i]!;
    const sign = near > far ? 1 : -1;
    if (near > far) [near, far] = [far, near];
    if (near > enter) { enter = near; normal = i === 0 ? [sign, 0, 0] : i === 1 ? [0, sign, 0] : [0, 0, sign]; }
    exit = Math.min(exit, far);
    if (enter > exit) return null;
  }
  if (enter < 0 || enter > 1) return null;
  const center = lerp(from, to, enter);
  return { t: enter, center, point: sub(center, scale(normal, r)), normal };
}
function bodyHit(from: Vec3, to: Vec3, r: number, entry: GrenadeBody): GrenadeContact | null {
  const delta = sub(to, from), distance = len(delta), dir = normalize(delta);
  // Bounds of the actual prims, including scale and blending (not a fixed torso sphere).
  const near = entry.body.prims.some(p => {
    if (p.dead || p.op === 'sub' || p.op === 'groove') return false;
    const extent = Math.max(p.radius, p.radiusB ?? p.radius) * Math.max(...p.scale) + p.blendK + r + .15;
    return from.every((v, i) => Math.max(v, to[i]!) >= Math.min(p.a[i]!, p.b[i]!) - extent
      && Math.min(v, to[i]!) <= Math.max(p.a[i]!, p.b[i]!) + extent);
  });
  if (!near) return null;
  let travel = 0;
  for (let i = 0; i < 128 && travel <= distance + 1e-9; i++) {
    const center = add(from, scale(dir, travel));
    const d = sdBody(center, entry.body) - r;
    if (d <= .0005) {
      const e = .001;
      const gradient = (axis: number) => {
        const offset: Vec3 = axis === 0 ? [e, 0, 0] : axis === 1 ? [0, e, 0] : [0, 0, e];
        return sdBody(add(center, offset), entry.body) - sdBody(sub(center, offset), entry.body);
      };
      const normal = normalize([gradient(0), gradient(1), gradient(2)]);
      const point = sub(center, scale(normal, r));
      const prim = entry.body.prims[worldHitToWound(entry.body.prims, point, 0, 'pellet', entry.yaw).primIdx];
      return { t: distance > 0 ? travel / distance : 0, center, point, normal,
        actorId: entry.id, flesh: entry.flesh && !prim?.metal };
    }
    travel += Math.max(.0005, d * .8);
  }
  return null;
}
export function sweepGrenade(from: Vec3, to: Vec3, radius: number, boxes: readonly FlightBox[], ceiling: number,
  bodies: readonly GrenadeBody[] = []): GrenadeContact | null {
  let best: GrenadeContact | null = null;
  const consider = (hit: GrenadeContact | null) => { if (hit && (!best || hit.t < best.t)) best = hit; };
  for (const box of boxes) consider(boxHit(from, to, radius, box));
  for (const [height, normal] of [[radius, [0, 1, 0]], [ceiling - radius, [0, -1, 0]]] as const) {
    const crossing = normal[1] > 0 ? to[1] <= height && to[1] < from[1] : to[1] >= height && to[1] > from[1];
    if (!Number.isFinite(height) || !crossing) continue;
    const t = Math.max(0, Math.min(1, (height - from[1]) / (to[1] - from[1])));
    const p = lerp(from, to, t), center: Vec3 = [p[0], height, p[2]];
    consider({ t, center, normal, point: sub(center, scale(normal, radius)) });
  }
  for (const body of bodies) consider(bodyHit(from, to, radius, body));
  return best;
}
