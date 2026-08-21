// TEMP measurement harness — deleted before commit.
import { describe, it } from 'vitest';
import src from './clown.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';
import { clearOf, daylightOf, fusedOf } from '../blob-checks';
import type { Vec3 } from '../types';

describe('measure clown', () => {
  it('prints cross-sections and landmarks', () => {
    const doc = parseBlob(src);
    const body = buildBody(compileBlob(doc, compileFace(doc)));
    console.log('errors:', body.errors);

    // March the field: at a given height y, find the flesh half-width in x
    // (from the axis, z=0) and half-depth in z (x=0) by bisecting sdBody.
    const probe = (y: number) => {
      const scanIn = (dir: Vec3) => {
        for (let d = 0.38; d > 0.001; d -= 0.0005)
          if (sdBody([dir[0] * d, y, dir[2] * d], body) < 0) return d;
        return NaN;
      };
      return { wx: scanIn([1, 0, 0]), wz: scanIn([0, 0, 1]) };
    };

    for (const y of [0.26, 0.30, 0.34, 0.36, 0.38, 0.40, 0.42, 0.44, 0.46, 0.48, 0.50, 0.52, 0.54, 0.56, 0.58]) {
      const { wx, wz } = probe(y);
      console.log(
        `y=${y.toFixed(3)}  halfW=${Number.isNaN(wx) ? 'axis-in' : wx.toFixed(4)}  halfD=${Number.isNaN(wz) ? 'axis-in' : wz.toFixed(4)}`,
      );
    }

    for (const name of ['skull.l', 'clavicle.l', 'upperarm.l', 'forearm.l', 'hand.l', 'thigh.l', 'shin.l', 'foot.l']) {
      const b = body.bones.get(name);
      if (b)
        console.log(name, 'head', b.head.map(n => n.toFixed(4)).join(','), 'tail', b.tail.map(n => n.toFixed(4)).join(','));
    }

    const clus = (l: string) => body.clusters.find(c => c.limb === l)!;
    const shoulder = body.bones.get('clavicle.l')!.tail;
    const elbow = body.bones.get('upperarm.l')!.tail;
    const torso = clus('torso');
    console.log('daylight armL vs torso @0.11 past shoulder:', daylightOf(body, clus('armL'), torso, shoulder, 0.11).toFixed(4));
    console.log('daylight armL vs torso below elbow:', daylightOf(body, clus('armL'), torso, shoulder, 0.135).toFixed(4));
    console.log('fusedOf armL/torso:', fusedOf(body, clus('armL'), torso).toFixed(4));
    console.log('clearOf armL/legL:', clearOf(body, clus('armL'), clus('legL')).toFixed(4));
    console.log('clearOf head/torso:', clearOf(body, clus('head'), torso).toFixed(4));

    // Nose reach: cranium front surface z at nose height vs nose tip.
    const noseY = 0.722;
    let front = 0;
    for (let z = 0; z < 0.4; z += 0.0005) {
      if (sdBody([0, noseY, z], body) < 0) front = z; else break;
    }
    console.log('face front z at y=0.722:', front.toFixed(4));
    for (let z = 0.24; z > 0.15; z -= 0.001) {
      if (sdBody([0, 0.655, z], body) < -0.0035) {
        console.log('smile groove cuts at z~', z.toFixed(3), '(depth reached)');
        break;
      }
    }
  });
});
