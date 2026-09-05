import { readFileSync } from 'node:fs';
import { parseBlob } from '../../src/lab/sdf-zombie/blob-parse';
import { compileBlob } from '../../src/lab/sdf-zombie/blob-compile';
import { buildBody, DEFAULT_BUILD_OPTS } from '../../src/lab/sdf-zombie/build-body';
import { sdBody } from '../../src/lab/sdf-zombie/validate';
const raw = readFileSync('src/lab/sdf-zombie/characters/minotaur.blob', 'utf8');
const res: any = buildBody(compileBlob(parseBlob(raw)), DEFAULT_BUILD_OPTS);
const body = res.body ?? res;
console.log('keys:', Object.keys(res).join(','));
for (const y of [1.70, 1.73, 1.76, 1.79, 1.82]) {
  let surf: number | null = null;
  for (let z = 0.30; z > -0.10; z -= 0.002) {
    const d = sdBody([0.035, y, z], body);
    if (d < 0) { surf = z; break; }
  }
  console.log(`y=${y.toFixed(2)} front surface z=${surf === null ? 'none' : surf.toFixed(3)}`);
}
