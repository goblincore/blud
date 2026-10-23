// Scratch probe (venus, 2026-10-22): half-width / front / back reach of a body per height on the CPU field, for
// judging a heavy body's CONTRAST (waist vs hips vs rear) before rendering. npx tsx scripts/tmp/venus-sections.ts [name]
import { readFileSync } from 'node:fs';
import { parseBlob } from '../../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../../src/lab/sdf-zombie/build-body';
import { sdBody } from '../../src/lab/sdf-zombie/validate';
const name = process.argv[2] ?? 'venus';
const doc = parseBlob(readFileSync(`src/lab/sdf-zombie/characters/${name}.blob`, 'utf8'));
const b = buildBody(compileBlob(doc, compileFace(doc)));
const reach = (y: number, dir: [number, number], ox = 0) => {
  if (sdBody([ox, y, 0], b) > 0) return NaN;
  for (let t = 0; t <= 0.6; t += 0.002) {
    if (sdBody([ox + dir[0] * t, y, dir[1] * t], b) > 0) return t;
  }
  return NaN;
};
for (let y = 1.75; y >= 0.0; y -= 0.05) {
  const x = reach(y, [1, 0]); const zf = reach(y, [0, 1]); const zb = reach(y, [0, -1]);
  const zfLeg = reach(y, [0, 1], 0.11); const zbLeg = reach(y, [0, -1], 0.11);
  console.log(`y ${y.toFixed(2)}  halfX ${x.toFixed(3)}  front ${zf.toFixed(3)}  back ${zb.toFixed(3)}  | x=.11 front ${zfLeg.toFixed(3)} back ${zbLeg.toFixed(3)}`);
}
