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
