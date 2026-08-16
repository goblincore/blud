// src/lab/sdf-zombie/extent.ts
import type { Primitive, Vec3 } from './types';
import { len, sub } from './vec';

/**
 * Furthest reach of a set of primitives from `origin` (same recipe as
 * clusters.ts). Carves are excluded — they are holes, and counting them would
 * inflate both the collision radius and the proxy box.
 *
 * Lives in its own module rather than in zombie.ts because BOTH renderer paths
 * need it and zombie.ts imports `three`. A WebGPU module that reached into it
 * would pull a second copy of three into the bundle, which is the trap that
 * makes every standard material render black — see lab-renderer.ts.
 */
export function chunkExtent(prims: Primitive[], origin: Vec3): number {
  let r = 0;
  for (const p of prims) {
    if (p.op === 'sub') continue;
    const ms = Math.max(p.scale[0], p.scale[1], p.scale[2]);
    r = Math.max(r, len(sub(p.a, origin)) + p.radius * ms, len(sub(p.b, origin)) + p.radius * ms);
  }
  return r;
}

/**
 * Radius for a chunk's torn-end wound: the limb's cross-section girth at the
 * tear, scaled up just enough to read as the whole cross-section ripped open.
 *
 * It must NOT derive from the chunk's extent. Extent is dominated by limb
 * LENGTH, and every geometric term of the wound pipeline — the carve sphere
 * and the everted rim's amplitude, ring radius and width — scales with the
 * wound radius. At `extent * 0.55` the carve ate half the limb and the rim
 * inflated the rest, so every chunk rendered as a rounded blob (X1.16).
 */
export function tornEndRadius(prims: Primitive[], tornAt: Vec3): number {
  let bestD = Infinity;
  let girth = 0.05;
  for (const p of prims) {
    if (p.op === 'sub') continue;
    // Effective girth of an ellipsoid capsule is its radius on the thinnest
    // axis — the same min-scale sdPrim uses to keep its bound conservative.
    const g = p.radius * Math.min(p.scale[0], p.scale[1], p.scale[2]);
    for (const e of [p.a, p.b]) {
      const d = len(sub(e, tornAt));
      if (d < bestD) { bestD = d; girth = g; }
    }
  }
  return girth * 1.35;
}
