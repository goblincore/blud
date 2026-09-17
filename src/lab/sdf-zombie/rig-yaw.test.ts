import { describe, expect, it } from 'vitest';
import zombieSrc from './characters/zombie.blob?raw';
import { parseBlob } from './blob-parse';
import { compileBlob } from './blob-compile';
import { buildBody } from './build-body';
import { bindRig, applyRig } from './rig-bind';
import { rotateYaw } from './gait';
import { translateBody } from './translate';
import { sdPrimitive, sdBody } from './validate';
import { add, sub } from './vec';
import { packBody } from './pack';
import type { Vec3 } from './types';

describe('zombie shape across rooms and headings', () => {
  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7])('preserves flesh distances at yaw %s', yaw => {
    for (const origin of [[-4.8,0,-4.8],[-4.8,0,4.8]] as Vec3[]) {
      const body = translateBody(buildBody(compileBlob(parseBlob(zombieSrc))), origin);
      const bound = bindRig(body), reference = applyRig(body, bound);
      const turn = (p: Vec3) => add(origin, rotateYaw(sub(p, origin), yaw));
      const turned = applyRig(body, { ...bound, rig: { ...bound.rig,
        points: bound.rig.points.map(p => ({ ...p, pos: turn(p.pos), prev: turn(p.prev) })) } }, yaw);
      for (let i=0;i<reference.prims.length;i++) {
        const p = reference.prims[i]!;
        for (const offset of [[.13,0,0],[0,.09,0],[0,0,.13],[.07,.04,-.06]] as Vec3[]) {
          const sample = add(p.a, offset);
          expect(sdPrimitive(turn(sample), turned.prims[i]!), `${p.limb}/${i}`).toBeCloseTo(sdPrimitive(sample,p), 6);
          expect(sdBody(turn(sample),turned)).toBeCloseTo(sdBody(sample,reference), 6);
        }
      }
      // GPU dispatch must select the existing oriented evaluator for the
      // chest and feet whenever their anisotropic axes have turned.
      if (Math.abs(yaw) > .001) {
        const packed = packBody(turned);
        for (const limb of ['torso','legL','legR']) {
          const index = turned.clusters.findIndex(c => c.limb===limb);
          expect(packed.clusterRange[index*4+3]! & 1, limb).toBe(1);
        }
      }
    }
  });
});
