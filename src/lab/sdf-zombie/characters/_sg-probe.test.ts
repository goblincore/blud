import { it } from 'vitest';
import src from './schoolgirl.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';

it('probe extents', () => {
  const doc = parseBlob(src);
  const b = buildBody(compileBlob(doc, compileFace(doc)));
  for (const y of [0.852, 0.83, 0.81, 0.795, 0.78, 0.75, 0.72, 1.05, 1.10, 1.15, 1.20, 1.24]) {
    let lo = NaN, hi = NaN;
    for (let x = -0.4; x <= 0.4; x += 0.002)
      if (sdBody([x, y, 0], b) < 0) { if (Number.isNaN(lo)) lo = x; hi = x; }
    // count gaps
    let inSeg = false, segs = 0;
    for (let x = -0.4; x <= 0.4; x += 0.002) {
      const s = sdBody([x, y, 0], b) < 0;
      if (s && !inSeg) segs++;
      inSeg = s;
    }
    console.log(`y ${y.toFixed(3)}  x ${Number.isNaN(lo) ? '—' : lo.toFixed(3)} .. ${hi.toFixed(3)}  w ${(hi - lo).toFixed(3)}  segs ${segs}`);
  }
}, 120000);
