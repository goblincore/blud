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
