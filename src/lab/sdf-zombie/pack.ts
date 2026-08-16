// src/lab/sdf-zombie/pack.ts
import type { BuiltBody } from './types';
import { MAX_CLUSTERS, MAX_PRIMS } from './validate';

export const PRIM_STRIDE = 4;    // vec4
export const CLUSTER_STRIDE = 4; // vec4

export interface PackedBody {
  primA: Float32Array;         // xyz = endpoint A, w = radius
  primB: Float32Array;         // xyz = endpoint B, w = blendK
  primScale: Float32Array;     // xyz = ellipsoid scale, w = 1 when this is a carve
  clusterBounds: Float32Array; // xyz = centre, w = radius
  clusterRange: Float32Array;  // x = start, y = count, z = alive, w = unused
  primCount: number;
  clusterCount: number;
  /** Cull margin: a cluster can still pull the surface from up to this far away. */
  maxBlendK: number;
  /** How many packed primitives are carves. Zero lets the shader skip the pass. */
  carveCount: number;
}

export function packBody(body: BuiltBody): PackedBody {
  const primA = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primB = new Float32Array(MAX_PRIMS * PRIM_STRIDE);
  const primScale = new Float32Array(MAX_PRIMS * PRIM_STRIDE);

  let maxBlendK = 0;
  let carveCount = 0;
  body.prims.forEach((p, i) => {
    const o = i * PRIM_STRIDE;
    // The carve flag rides primScale.w, which held a cluster id the shader
    // never actually read.
    //
    // It used to ride the SIGN of blendK, which was free but silently broken:
    // -0 is indistinguishable from 0 once stored in a Float32Array, so a carve
    // authored with blendK 0 folded in as ADDITIVE. That matters because
    // blendK 0 is the useful case — smin short-circuits to a hard min, giving
    // crisp-edged features instead of the smear that made carved eye sockets
    // fail. Never encode a flag in a sign whose zero is meaningful.
    const isCarve = p.op === 'sub';
    if (isCarve) carveCount++;
    primA.set([p.a[0], p.a[1], p.a[2], p.radius], o);
    primB.set([p.b[0], p.b[1], p.b[2], p.blendK], o);
    primScale.set([p.scale[0], p.scale[1], p.scale[2], isCarve ? 1 : 0], o);
    // Cull margin is a distance: always the magnitude, never the sign.
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
    carveCount,
  };
}
