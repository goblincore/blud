import { it } from 'vitest';
import src from './schoolgirl.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody, sdPrimitive } from '../validate';

it('eye/mouth own the surface', () => {
  const doc = parseBlob(src);
  const b = buildBody(compileBlob(doc, compileFace(doc)));
  for (const [x, y, tag] of [[0.028, 1.521, 'eye'], [-0.028, 1.521, 'eye'], [0, 1.49, 'mouth']] as const) {
    let ff = NaN;
    for (let z = 0.25; z > 0; z -= 0.0002) if (sdBody([x, y, z], b) < 0) { ff = z; break; }
    let best = '', bd = 1e9;
    for (const pr of b.prims) {
      const d = sdPrimitive([x, y, ff] as never, pr as never);
      if (Math.abs(d) < Math.abs(bd)) { bd = d; best = `${pr.limb}/r${pr.radius.toFixed(3)}/L${pr.src ?? '-'}`; }
    }
    console.log(`${tag} (${x},${y}): surface ${ff.toFixed(4)} -> ${best} (${bd.toFixed(4)})`);
  }
}, 60000);
