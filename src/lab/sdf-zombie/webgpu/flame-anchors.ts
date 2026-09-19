// src/lab/sdf-zombie/webgpu/flame-anchors.ts
//
// WHERE A BURNING BODY'S FLAME CARDS RIDE. The flame lab authored this rule
// (limbAnchors and its two helpers, formerly local to flame-lab-main.ts); the
// in-game burning harness needs the identical rule, so it lives here once and
// both hosts import it. Pure: reads a posed BuildResult, never a renderer.
//
// The rule, in the lab's own words:
//
//   The head anchor is the skull — the fattest ADDITIVE primitive in the head
//   cluster, with hair/hats skipped (they out-size the skull they cover, so
//   the face would project onto the hat).
//
//   Every other limb's anchor is that limb's fattest flesh primitive in the
//   POSED field, so a collapsed body's torso centre is where the torso
//   actually IS. The legs are the exception: they use the whole cluster's
//   refit mean, because their fattest prim is an end mass (the soldier's hip
//   ball, the zombie's splayed foot) which anchored the cards at the waist or
//   ankle. Missing limbs fall back to the torso's centre.

import { CLUSTER_ORDER, type LimbId } from '../types';
import type { BuildResult } from '../build-body';
import type { Vec3 } from '../types';
import type { FlameCardAnchors } from './flame-cards';

/**
 * The skull's centre and its three SEMI-AXES: the fattest additive primitive
 * in the head cluster, measured per axis. The painted-prims skip is
 * load-bearing — hair/hats out-size the skull they cover.
 */
export function headShape(b: BuildResult): { centre: Vec3; axes: Vec3 } | null {
  const head = b.clusters.find(c => c.limb === 'head');
  if (!head) return null;
  let best: Vec3 | null = null;
  let bestAxes: Vec3 | null = null;
  let bestR = -Infinity;
  const headPrims = b.prims.slice(head.start, head.start + head.count);
  const flesh = headPrims.filter(p => p.op !== 'sub' && p.color === undefined);
  for (const p of (flesh.length > 0 ? flesh : headPrims)) {
    if (p.op === 'sub') continue;
    const r = p.radius * Math.max(p.scale[0], p.scale[1], p.scale[2]);
    if (r > bestR) {
      bestR = r;
      best = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
      bestAxes = [p.radius * p.scale[0], p.radius * p.scale[1], p.radius * p.scale[2]];
    }
  }
  return best === null || bestAxes === null ? null : { centre: best, axes: bestAxes };
}

/**
 * The centre of a limb's fattest flesh primitive in the POSED field — the
 * headShape rule generalized to every limb. Null when the cluster is missing
 * or fully subtracted (a severed limb, say).
 */
export function limbCentre(b: BuildResult, limb: LimbId): Vec3 | null {
  const cluster = b.clusters.find(c => c.limb === limb);
  if (!cluster || !cluster.alive) return null;
  let best: Vec3 | null = null;
  let bestR = -Infinity;
  const prims = b.prims.slice(cluster.start, cluster.start + cluster.count);
  const flesh = prims.filter(p => p.op !== 'sub' && p.color === undefined);
  for (const p of (flesh.length > 0 ? flesh : prims)) {
    if (p.op === 'sub') continue;
    const r = p.radius * Math.max(p.scale[0], p.scale[1], p.scale[2]);
    if (r > bestR) {
      bestR = r;
      best = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
    }
  }
  return best;
}

/**
 * The posed centre of a limb's WHOLE prim cluster — the refitClusters mean of
 * its endpoints, which applyRig recomputes every frame, so it rides a collapse
 * exactly as the fattest-prim rule does. See the module header for why the
 * legs need it.
 */
export function limbClusterCentre(b: BuildResult, limb: LimbId): Vec3 | null {
  const cluster = b.clusters.find(c => c.limb === limb);
  return cluster && cluster.alive ? cluster.center : null;
}

/**
 * Every posed limb centre the cards anchor to, computed once per body per
 * frame from the posed field. Missing limbs fall back to the torso's centre
 * (a card that rides a severed limb's last known spot is worse than one that
 * keeps burning at the trunk).
 */
export function limbAnchors(b: BuildResult): FlameCardAnchors {
  const torso = limbCentre(b, 'torso') ?? [0, 1, 0];
  const out = { torso } as FlameCardAnchors;
  for (const limb of CLUSTER_ORDER) {
    if (limb === 'torso') continue;
    const centre = limb === 'legL' || limb === 'legR'
      ? (limbClusterCentre(b, limb) ?? limbCentre(b, limb))
      : limbCentre(b, limb);
    out[limb] = centre ?? torso;
  }
  return out;
}
