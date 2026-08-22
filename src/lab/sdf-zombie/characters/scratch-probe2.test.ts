// SCRATCH probe2 — delete before commit. Silhouette metrics for any frame.
import { describe, it } from 'vitest';
import { execSync } from 'node:child_process';
import src from './mouse.blob?raw';
import { parseBlob } from '../blob-parse';
import { compileBlob, compileFace } from '../blob-compile';
import { buildBody } from '../build-body';
import { sdBody } from '../validate';

const doc = parseBlob(src);

describe('scratch metrics', () => {
  it('CPU raymarch silhouette vs reference', () => {
    const b = buildBody(compileBlob(doc, compileFace(doc)));
    // march columns of the front view (x from -0.30..0.30) at ground..1.12
    const topAt = (x: number, z = 0.02): number => {
      let top = -1;
      for (let y = 1.12; y >= 0.0; y -= 0.002) {
        if (sdBody([x, y, z], b) < 0) { top = y; break; }
      }
      return top;
    };
    // Silhouette width profile: for each y, count x where inside
    const inside = (x: number, y: number): boolean => sdBody([x, y, 0.02], b) < 0;
    const prof: string[] = [];
    for (const fy of [0.99, 0.95, 0.90, 0.85, 0.80, 0.75, 0.70, 0.65, 0.60, 0.55, 0.50, 0.45, 0.40, 0.35, 0.30, 0.25, 0.20, 0.15, 0.10, 0.05]) {
      const y = fy * 1.10;
      const xs: number[] = [];
      for (let x = -0.35; x <= 0.35; x += 0.004) if (inside(x, y)) xs.push(x);
      if (xs.length) {
        const lo = Math.min(...xs), hi = Math.max(...xs);
        prof.push(`y=${fy.toFixed(2)}h ${lo.toFixed(3)}..${hi.toFixed(3)} w=${(hi - lo).toFixed(3)}`);
      } else prof.push(`y=${fy.toFixed(2)}h empty`);
    }
    console.log(prof.join('\n'));
    console.log('crown between ears (x=0):', topAt(0).toFixed(3));
    console.log('ear top (x=0.174):', topAt(0.174).toFixed(3));
    console.log('outer extent ear (x, y=0.955):');
    for (let x = 0.34; x >= 0.28; x -= 0.004) {
      if (inside(x, 0.955)) { console.log('  outer edge at', x.toFixed(3)); break; }
    }
  });
});
