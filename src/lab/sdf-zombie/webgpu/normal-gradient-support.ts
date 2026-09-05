import type { Body } from '../validate';
import type { NgReason } from './normal-gradient-reference';

/** Coarse capability report only. Internal ribs/organ rows are locally gated by
 * mapBody; their shapes must never veto otherwise intact flesh globally. */
export function classifyNormalSupport(body: Body): { commonFlesh: boolean; reasons: NgReason[] } {
  let commonFlesh = false;
  let unsupported = false;
  for (const c of body.clusters) {
    if (!c.alive) continue;
    for (const p of body.prims.slice(c.start, c.start + c.count)) {
      if (p.dead) continue;
      const supported = (!p.op || p.op === 'add') && p.radiusB === undefined &&
        p.bend === undefined && !p.shell && !p.box && !p.strand &&
        p.blendProfile !== 'chamfer' && p.scale.every(v => Number.isFinite(v) && v > 0);
      commonFlesh ||= supported;
      unsupported ||= !supported;
    }
  }
  return { commonFlesh, reasons: unsupported ? ['unsupported'] : commonFlesh ? [] : ['inactive'] };
}

/** CPU statement of the shader certificate. Scaled capsules have gradient
 * norm <= minScale * ||diag(1/scale)|| = 1; rotations preserve that bound.
 * excludedLower already bounds ALL points in the radius-R ball. */
export function stableNormalOwner(best: number, second: number, excludedLower: number): boolean {
  const radius = Math.sqrt(3) * .0015;
  return Number.isFinite(best) && second - best > 2 * radius && excludedLower > best + radius;
}

import type { Primitive, Vec3 } from '../types';
import { bendCtrl } from '../vec';
/** CPU statement of ngInternalLower. Uses applyBones' unrotated semantics. */
export function internalNormalLowerBound(p: Vec3, shape: Primitive): number {
  if (shape.strand || shape.box || shape.shell || shape.scale.some(v=>v<=0)) return -Infinity;
  const points=[shape.a,shape.b];
  if (shape.bend) points.push(bendCtrl(shape.a,shape.b,shape.bend));
  const outside=p.map((v,i)=> {
    const axis=points.map(q=>q[i]!/shape.scale[i]!);
    return Math.max(0,Math.min(...axis)-v/shape.scale[i]!,v/shape.scale[i]!-Math.max(...axis));
  });
  return (Math.hypot(...outside)-Math.max(shape.radius,shape.radiusB??shape.radius))*Math.min(...shape.scale)-Math.sqrt(3)*.0015;
}

import { Vector3, type Camera } from 'three/webgpu';
/** The march target stores WebGPU clip depth in alpha, not ray distance. */
export function normalHitPoint(x: number, y: number, width: number, height: number, depth: number, camera: Camera): Vec3 {
  return new Vector3((x+.5)/width*2-1,1-(y+.5)/height*2,depth).unproject(camera).toArray() as [number,number,number];
}
