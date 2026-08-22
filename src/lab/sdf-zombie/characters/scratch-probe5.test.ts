// SCRATCH — delete. Flesh cross-sections for kit rings.
import { describe, it } from 'vitest';
import src from './mouse.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';

const doc = parseBlob(src);
describe('flesh rings', () => {
  it('measures', () => {
    const b = buildBody(compileBlob(doc, compileFace(doc)));
    const xsAt = (y: number, z: number, xmax = 0.2) => {
      const a: number[] = [];
      for (let x = -xmax; x <= xmax; x += 0.001) if (sdBody([x, y, z], b) < 0) a.push(x);
      return a.length ? [Math.min(...a), Math.max(...a)] : null;
    };
    const zsAt = (y: number, x: number) => {
      const a: number[] = [];
      for (let z = -0.3; z <= 0.3; z += 0.001) if (sdBody([x, y, z], b) < 0) a.push(z);
      return a.length ? [Math.min(...a), Math.max(...a)] : null;
    };
    console.log('== TORSO (x at z=0; z at x=0), ignoring arms by capping |x|<0.16 ==');
    for (const y of [0.30, 0.33, 0.36, 0.39, 0.42, 0.45, 0.48, 0.51, 0.54, 0.57, 0.60]) {
      const xs = xsAt(y, 0, 0.16);
      const zs = zsAt(y, 0);
      console.log(`y=${y.toFixed(2)} ${xs ? 'x ' + xs[0].toFixed(3) + '..' + xs[1].toFixed(3) + ' w=' + (xs[1]-xs[0]).toFixed(3) : 'x -'}  ${zs ? 'z ' + zs[0].toFixed(3) + '..' + zs[1].toFixed(3) + ' d=' + (zs[1]-zs[0]).toFixed(3) : 'z -'}`);
    }
    console.log('== ARM cross-section (along upperarm/forearm axis approx: at y=0.44 sample x at arm) ==');
    for (const y of [0.36, 0.40, 0.44, 0.48]) {
      for (const x of [0.20, 0.22]) {
        const zs = zsAt(y, x);
        if (zs) console.log(`y=${y.toFixed(2)} x=${x.toFixed(2)} z ${zs[0].toFixed(3)}..${zs[1].toFixed(3)} d=${(zs[1]-zs[0]).toFixed(3)}`);
      }
    }
    console.log('== LEG (shorts zone) at x=±0.055 ==');
    for (const y of [0.15, 0.18, 0.21, 0.24, 0.27, 0.30]) {
      const zs = zsAt(y, 0.055);
      const xs = xsAt(y, zs ? (zs[0]+zs[1])/2 : 0, 0.14);
      console.log(`y=${y.toFixed(2)} z ${zs ? zs[0].toFixed(3)+'..'+zs[1].toFixed(3) : '-'}`);
    }
    console.log('== LEG x-extent (outer/inner) at y=0.18,0.24 ==');
    for (const y of [0.18, 0.22, 0.26]) {
      for (const z of [0.0]) {
        const xs = xsAt(y, z, 0.14);
        console.log(`y=${y.toFixed(2)} z=0 x ${xs ? xs[0].toFixed(3)+'..'+xs[1].toFixed(3) : '-'} (both legs merge if contiguous)`);
      }
    }
    console.log('== FOOT: y rows 0.02..0.14, x=0.045, full z ==');
    for (const y of [0.02, 0.05, 0.08, 0.11, 0.14]) {
      const zs = zsAt(y, 0.045);
      console.log(`foot y=${y.toFixed(2)} z ${zs ? zs[0].toFixed(3)+'..'+zs[1].toFixed(3) : '-'}`);
    }
    console.log('== HEAD for shades: z at eye height y=0.735..0.78 ==');
    for (const y of [0.71, 0.735, 0.76, 0.785, 0.81]) {
      const xs = xsAt(y, 0.02, 0.2);
      const zs = zsAt(y, 0);
      console.log(`head y=${y.toFixed(3)} ${xs ? 'xw=' + (xs[1]-xs[0]).toFixed(3) : ''} ${zs ? 'zmax=' + zs[1].toFixed(3) : ''}`);
    }
  });
});
