// SCRATCH — delete. z-max silhouette (what a camera sees) vs z=0 slice.
import { describe, it } from 'vitest';
import src from './mouse.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';

const doc = parseBlob(src);
describe('zmax silhouette', () => {
  it('profiles', () => {
    const b = buildBody(compileBlob(doc, compileFace(doc)));
    for (const ym of [0.90, 0.85, 0.80, 0.76, 0.72, 0.68, 0.64, 0.60]) {
      const xs: number[] = [];
      for (let x = -0.4; x <= 0.4; x += 0.003) {
        let hit = false;
        for (let z = 0.3; z >= -0.3; z -= 0.006) {
          if (sdBody([x, ym, z], b) < 0) { hit = true; break; }
        }
        if (hit) xs.push(x);
      }
      if (xs.length) console.log(`y=${ym.toFixed(2)} x ${Math.min(...xs).toFixed(3)}..${Math.max(...xs).toFixed(3)} w=${(Math.max(...xs)-Math.min(...xs)).toFixed(3)}`);
      else console.log(`y=${ym.toFixed(2)} empty`);
    }
  });
});
