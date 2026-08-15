// src/lab/sdf-zombie/pack.ts
import type { BuiltBody } from './types';
import { MAX_CLUSTERS, MAX_PRIMS } from './validate';

export const PRIM_STRIDE = 4;    // vec4
export const CLUSTER_STRIDE = 4; // vec4

export interface PackedBody {
  primA: Float32Array;         // xyz = endpoint A, w = radius
  primB: Float32Array;         // xyz = endpoint B, w = blendK
  primScale: Float32Array;     // xyz = ellipsoid scale, w = cluster id
  clusterBounds: Float32Array; // xyz = centre, w = radius
  clusterRange: Float32Array;  // x = start, y = count, z = alive, w = unused
  primCount: number;
  clusterCount: number;
  /** Cull margin: a cluster can still pull the surface from up to this far away. */
  maxBlendK: number;
}

export function packBody(body: BuiltBody): PackedBody {
  const primA = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primB = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primScale = new Float32Array(MAX_PRIMS * PRIM_STRIDE);

  let maxBlendK = 0;
  body.prims.forEach((p, i) => {
    const o = i * PRIM_STRIDE;
    primA.set([p.a[0], p.a[1], p.a[2], p.radius], o);
    primB.set([p.b[0], p.b[1], p.b[2], p.blendK], o);
    primScale.set([p.scale[0], p.scale[1], p.scale[2], p.cluster], o);
    if (p.blendK > maxBlendK) maxBlendK = p.blendK;
  });

  const clusterBounds = new Float32Array(MAX_CLUSTERS * CLUSTER_STRIDE);
  const clusterRange = new Float32Array(MAX_CLUSTERS * CLUSTER_STRIDE);
  body.clusters.forEach((c, i) => {
    const o = i * CLUSTER_STRIDE;
    clusterBounds.set([c.center[0], c.center[1], c.center[2], c.radius], o);
    clusterRange.set([c.start, c.count, c.alive ? 1 : 0, 0], o);
  });

  return {
    primA, primB, primScale, clusterBounds, clusterRange,
    primCount: body.prims.length,
    clusterCount: body.clusters.length,
    maxBlendK,
  };
}
